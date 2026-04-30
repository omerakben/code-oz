// Append-only event log for a run. JSONL with one event per line.
//
// Contract pinned in docs/references/file-based-gates.md section 5
// (events.jsonl) and validation rules 1, 8.
//
// Atomicity: each appendEvent() call writes a single line via FileHandle.write
// followed by FileHandle.sync(). On POSIX, single write() syscalls up to
// PIPE_BUF (4096) are atomic; for larger lines, the write+sync sequence is
// still durable on success because the per-run lock prevents interleaving
// from concurrent processes.
//
// Ordering: replay is by line position only — `ts` is human-readable audit
// metadata, not the sort key (validation rule 8). The reader returns events
// in file order.
//
// Hard-fail semantics: any malformed or partial line in events.jsonl causes
// readEvents() to throw EventLogError. A future `code-oz status --tail` can
// implement partial-line tolerance separately.

import { open, readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import {
  EVENT_TYPES,
  PHASE_OUTCOMES,
  RUN_OUTCOMES,
  isUlid,
  isPhase,
  isProfile,
  isIsoTimestamp,
  type PhaseEvent,
  type LoggedEvent,
} from './schemas.ts'
import { EventLogError, type EventLogIssue } from './errors.ts'
import { LockBusyError, withLock } from './lock.ts'

export interface EventLogPaths {
  /** Absolute path to the events.jsonl file (events.jsonl in the run subdir). */
  readonly file: string
  /** Absolute path to the per-run lock directory. */
  readonly lockDir: string
}

const SHA256_REGEX = /^[0-9a-f]{64}$/

/**
 * Validate an in-memory event object against the v1 schema. Returns null when
 * valid, or a single EventLogIssue when invalid (first violation wins; this
 * keeps the happy-path validation cost small).
 */
export function validateEvent(
  raw: unknown,
  file: string,
  line?: number,
): EventLogIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      file,
      code: 'event_invalid_json',
      rule: 'event must be a non-array JSON object',
      line,
    }
  }
  const e = raw as Record<string, unknown>

  if (e.version !== 1) {
    return {
      file,
      code: 'event_invalid_version',
      rule: 'event must have version: 1',
      detail: `got ${JSON.stringify(e.version)}`,
      line,
    }
  }
  if (typeof e.type !== 'string' || e.type.length === 0) {
    return {
      file,
      code: 'event_invalid_type',
      rule: 'event.type must be a non-empty string',
      detail: `got ${JSON.stringify(e.type)}`,
      line,
    }
  }
  if (!isIsoTimestamp(e.ts)) {
    return {
      file,
      code: 'event_invalid_timestamp',
      rule: 'event.ts must be an ISO 8601 timestamp',
      detail: `got ${JSON.stringify(e.ts)}`,
      line,
    }
  }
  if (!isUlid(e.runId)) {
    return {
      file,
      code: 'event_invalid_runid',
      rule: 'event.runId must be a 26-char Crockford ULID',
      detail: `got ${JSON.stringify(e.runId)}`,
      line,
    }
  }
  // Open-type-union (validation rule 12, M4): the four-field envelope above
  // (version, type, ts, runId) applies to ALL events. Recognized types fall
  // through to the per-type switch below for strict per-type field
  // validation; unrecognized types are accepted as-is and survive verbatim
  // in the log so future milestones can extend the type set without bumping
  // `version: 1`.
  const isKnown = (EVENT_TYPES as readonly string[]).includes(e.type)
  if (!isKnown) {
    return null
  }

  switch (e.type) {
    case 'run_started':
      if (!isProfile(e.profile)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: "run_started.profile must be 'greenfield' or 'brownfield'",
          detail: `got ${JSON.stringify(e.profile)}`,
          line,
        }
      }
      break

    case 'phase_entered':
      if (!isPhase(e.phase)) {
        return phaseInvalid(file, 'phase_entered', e.phase, line)
      }
      break

    case 'phase_exited':
      if (!isPhase(e.phase)) return phaseInvalid(file, 'phase_exited', e.phase, line)
      if (typeof e.outcome !== 'string' || !(PHASE_OUTCOMES as readonly string[]).includes(e.outcome)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: `phase_exited.outcome must be one of: ${PHASE_OUTCOMES.join(' | ')}`,
          detail: `got ${JSON.stringify(e.outcome)}`,
          line,
        }
      }
      break

    case 'agent_invoked': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'agent_invoked', e.phase, line)
      const stringIssue =
        nonEmptyString(file, e.agent, 'agent_invoked.agent', line) ??
        nonEmptyString(file, e.provider, 'agent_invoked.provider', line)
      if (stringIssue) return stringIssue
      // Manifest + four metric fields are required-when-agent_invoked per
      // validation rule 13 (M4). The wrapper layer in src/providers/invoke.ts
      // is the only emitter; its events always satisfy this rule.
      const m = e.manifest
      if (m === null || m === undefined || typeof m !== 'object' || Array.isArray(m)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'agent_invoked.manifest is required and must be { files: [...] }',
          line,
        }
      }
      const files = (m as Record<string, unknown>).files
      if (!Array.isArray(files)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'agent_invoked.manifest.files must be an array',
          line,
        }
      }
      for (const entry of files) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'agent_invoked.manifest.files[] entries must be objects',
            line,
          }
        }
        const f = entry as Record<string, unknown>
        const pathIssue = nonEmptyString(file, f.path, 'agent_invoked.manifest.files[].path', line)
        if (pathIssue) return pathIssue
        if (typeof f.sha256 !== 'string' || !SHA256_REGEX.test(f.sha256)) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'agent_invoked.manifest.files[].sha256 must be a 64-char lowercase hex string',
            detail: `got ${JSON.stringify(f.sha256)}`,
            line,
          }
        }
        if (typeof f.sizeBytes !== 'number' || !Number.isInteger(f.sizeBytes) || f.sizeBytes < 0) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'agent_invoked.manifest.files[].sizeBytes must be a non-negative integer',
            detail: `got ${JSON.stringify(f.sizeBytes)}`,
            line,
          }
        }
      }
      const metricIssue =
        nonNegativeInteger(file, e.filesSent, 'agent_invoked.filesSent', line) ??
        nonNegativeInteger(file, e.bytesSent, 'agent_invoked.bytesSent', line) ??
        nonNegativeInteger(file, e.tokensEstimate, 'agent_invoked.tokensEstimate', line) ??
        nonNegativeInteger(file, e.fieldsRemovedByScope, 'agent_invoked.fieldsRemovedByScope', line)
      if (metricIssue) return metricIssue
      break
    }

    case 'agent_completed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'agent_completed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'agent_completed.agent', line)
      if (agentIssue) return agentIssue
      if (e.tokensUsed !== undefined) {
        if (typeof e.tokensUsed !== 'number' || !Number.isInteger(e.tokensUsed) || e.tokensUsed < 0) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'agent_completed.tokensUsed must be a non-negative integer when present',
            detail: `got ${JSON.stringify(e.tokensUsed)}`,
            line,
          }
        }
      }
      break
    }

    case 'gate_written':
      if (!isPhase(e.phase)) return phaseInvalid(file, 'gate_written', e.phase, line)
      if (typeof e.file !== 'string' || e.file.length === 0) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'gate_written.file must be a non-empty string',
          line,
        }
      }
      // gate_written.file is a filename inside the run dir, not a path with separators.
      if (e.file.includes('/') || e.file.includes('\\')) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'gate_written.file must be a filename relative to the run subdirectory (no separators)',
          detail: `got ${JSON.stringify(e.file)}`,
          line,
        }
      }
      break

    case 'gate_required': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'gate_required', e.phase, line)
      const blockedIssue = nonEmptyString(file, e.blockedOn, 'gate_required.blockedOn', line)
      if (blockedIssue) return blockedIssue
      break
    }

    case 'intervention': {
      const codeIssue = nonEmptyString(file, e.code, 'intervention.code', line)
      if (codeIssue) return codeIssue
      if (e.phase !== undefined && !isPhase(e.phase)) {
        return phaseInvalid(file, 'intervention', e.phase, line)
      }
      break
    }

    case 'ask_me_user_input': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'ask_me_user_input', e.phase, line)
      const turnIssue = nonNegativeInteger(file, e.turn, 'ask_me_user_input.turn', line)
      if (turnIssue) return turnIssue
      // Empty input is meaningless and likely a bug — reject.
      if (typeof e.input !== 'string' || e.input.length === 0) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'ask_me_user_input.input must be a non-empty string',
          detail: `got ${JSON.stringify(e.input)}`,
          line,
        }
      }
      break
    }

    case 'ask_me_persona_reply': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'ask_me_persona_reply', e.phase, line)
      const turnIssue = nonNegativeInteger(file, e.turn, 'ask_me_persona_reply.turn', line)
      if (turnIssue) return turnIssue
      const agentIssue = nonEmptyString(file, e.agent, 'ask_me_persona_reply.agent', line)
      if (agentIssue) return agentIssue
      // Empty response is meaningless — reject.
      if (typeof e.response !== 'string' || e.response.length === 0) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'ask_me_persona_reply.response must be a non-empty string',
          detail: `got ${JSON.stringify(e.response)}`,
          line,
        }
      }
      if (typeof e.ready !== 'boolean') {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'ask_me_persona_reply.ready must be a boolean',
          detail: `got ${JSON.stringify(e.ready)}`,
          line,
        }
      }
      break
    }

    case 'run_ended':
      if (typeof e.outcome !== 'string' || !(RUN_OUTCOMES as readonly string[]).includes(e.outcome)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: `run_ended.outcome must be one of: ${RUN_OUTCOMES.join(' | ')}`,
          detail: `got ${JSON.stringify(e.outcome)}`,
          line,
        }
      }
      break
  }

  return null
}

function phaseInvalid(file: string, evtType: string, value: unknown, line?: number): EventLogIssue {
  return {
    file,
    code: 'event_invalid_phase',
    rule: `${evtType}.phase must be a canonical phase`,
    detail: `got ${JSON.stringify(value)}`,
    line,
  }
}

function nonEmptyString(
  file: string,
  value: unknown,
  field: string,
  line?: number,
): EventLogIssue | null {
  if (typeof value !== 'string' || value.length === 0) {
    return {
      file,
      code: 'event_invalid_value',
      rule: `${field} must be a non-empty string`,
      detail: `got ${JSON.stringify(value)}`,
      line,
    }
  }
  return null
}

function nonNegativeInteger(
  file: string,
  value: unknown,
  field: string,
  line?: number,
): EventLogIssue | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return {
      file,
      code: 'event_invalid_value',
      rule: `${field} must be a non-negative integer`,
      detail: `got ${JSON.stringify(value)}`,
      line,
    }
  }
  return null
}

export interface AppendEventOptions {
  /** When true, the caller already holds the per-run lock; do not re-acquire. */
  readonly skipLock?: boolean
}

/**
 * Append a validated event to events.jsonl. Acquires the per-run lock,
 * appends one JSON line + newline, fsyncs, then releases the lock.
 *
 * Pass `skipLock: true` when the caller (e.g., run.ts) already holds the
 * per-run lock for a multi-step transaction.
 *
 * Throws EventLogError on validation failure, lock contention, or I/O error.
 */
export async function appendEvent(
  paths: EventLogPaths,
  event: PhaseEvent,
  options: AppendEventOptions = {},
): Promise<void> {
  const issue = validateEvent(event, paths.file)
  if (issue !== null) {
    throw new EventLogError([issue])
  }

  const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')

  const writeOnce = async (): Promise<void> => {
    const fh = await open(paths.file, 'a')
    try {
      await fh.write(buf, 0, buf.length)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  try {
    if (options.skipLock) {
      await writeOnce()
    } else {
      await withLock(paths.lockDir, writeOnce)
    }
  } catch (err: unknown) {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: paths.file,
          code: 'event_lock_busy',
          rule: 'per-run lock is busy; another writer holds it',
          detail: err.lockDir,
        },
      ])
    }
    if (err instanceof EventLogError) throw err
    throw new EventLogError([
      {
        file: paths.file,
        code: 'event_io_error',
        rule: 'failed to append event',
        detail: (err as Error).message,
      },
    ])
  }
}

/**
 * Read every validated event from events.jsonl in file order. Throws
 * EventLogError on any malformed line; missing file returns an empty
 * frozen array.
 *
 * Returns LoggedEvent (PhaseEvent | UnknownPhaseEvent) so callers can
 * tolerate forward-extended event types written by future milestones
 * without needing a schema-version bump (validation rule 12, M4).
 */
export async function readEvents(paths: EventLogPaths): Promise<readonly LoggedEvent[]> {
  let content: string
  try {
    content = await readFile(paths.file, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze([] as PhaseEvent[])
    }
    throw new EventLogError([
      {
        file: paths.file,
        code: 'event_io_error',
        rule: 'failed to read events.jsonl',
        detail: (err as Error).message,
      },
    ])
  }

  const lines = content.split('\n')
  // A trailing newline produces a final empty entry; drop it (canonical).
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const issues: EventLogIssue[] = []
  const events: LoggedEvent[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    if (line === '') {
      issues.push({
        file: paths.file,
        code: 'event_partial_line',
        rule: 'empty line in events.jsonl is not permitted',
        line: lineNum,
      })
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (err: unknown) {
      issues.push({
        file: paths.file,
        code: 'event_invalid_json',
        rule: 'JSON parse failed (likely partial or malformed line)',
        detail: (err as Error).message,
        line: lineNum,
      })
      continue
    }
    const issue = validateEvent(raw, paths.file, lineNum)
    if (issue !== null) {
      issues.push(issue)
    } else {
      events.push(raw as LoggedEvent)
    }
  }

  if (issues.length > 0) {
    throw new EventLogError(issues)
  }

  return Object.freeze(events.map((e) => Object.freeze(e)))
}
