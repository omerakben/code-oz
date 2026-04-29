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
  if (typeof e.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(e.type)) {
    return {
      file,
      code: 'event_invalid_type',
      rule: `event.type must be one of: ${EVENT_TYPES.join(' | ')}`,
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
      if (e.manifest !== undefined) {
        const m = e.manifest
        if (m === null || typeof m !== 'object' || Array.isArray(m)) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'agent_invoked.manifest must be { files: [...] } when present',
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
      }
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

/**
 * Append a validated event to events.jsonl. Acquires the per-run lock,
 * appends one JSON line + newline, fsyncs, then releases the lock.
 *
 * Throws EventLogError on validation failure, lock contention, or I/O error.
 */
export async function appendEvent(paths: EventLogPaths, event: PhaseEvent): Promise<void> {
  const issue = validateEvent(event, paths.file)
  if (issue !== null) {
    throw new EventLogError([issue])
  }

  const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')

  try {
    await withLock(paths.lockDir, async () => {
      const fh = await open(paths.file, 'a')
      try {
        await fh.write(buf, 0, buf.length)
        await fh.sync()
      } finally {
        await fh.close()
      }
    })
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
 */
export async function readEvents(paths: EventLogPaths): Promise<readonly PhaseEvent[]> {
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
  const events: PhaseEvent[] = []

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
      events.push(raw as PhaseEvent)
    }
  }

  if (issues.length > 0) {
    throw new EventLogError(issues)
  }

  return Object.freeze(events.map((e) => Object.freeze(e)))
}
