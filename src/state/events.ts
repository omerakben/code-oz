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

    case 'repo_context_searched': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'repo_context_searched', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'repo_context_searched.agent', line)
      if (agentIssue) return agentIssue
      const allowedTools = ['glob', 'grep', 'read', 'symbol']
      if (typeof e.tool !== 'string' || !allowedTools.includes(e.tool)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: `repo_context_searched.tool must be one of: ${allowedTools.join(' | ')}`,
          detail: `got ${JSON.stringify(e.tool)}`,
          line,
        }
      }
      const queryIssue = nonEmptyString(file, e.query, 'repo_context_searched.query', line)
      if (queryIssue) return queryIssue
      if (!Array.isArray(e.roots) || !e.roots.every((r) => typeof r === 'string')) {
        return strArrInvalid(file, 'repo_context_searched.roots', line)
      }
      if (!Array.isArray(e.resultPaths) || !e.resultPaths.every((r) => typeof r === 'string')) {
        return strArrInvalid(file, 'repo_context_searched.resultPaths', line)
      }
      if (!Array.isArray(e.selectedPaths) || !e.selectedPaths.every((r) => typeof r === 'string')) {
        return strArrInvalid(file, 'repo_context_searched.selectedPaths', line)
      }
      const bytesIssue = nonNegativeInteger(file, e.resultBytes, 'repo_context_searched.resultBytes', line)
      if (bytesIssue) return bytesIssue
      const tokenIssue = nonNegativeInteger(
        file,
        e.resultTokensEstimate,
        'repo_context_searched.resultTokensEstimate',
        line,
      )
      if (tokenIssue) return tokenIssue
      break
    }

    case 'science_emitted': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'science_emitted', e.phase, line)
      const hyp = nonNegativeInteger(file, e.hypothesesCount, 'science_emitted.hypothesesCount', line)
      if (hyp) return hyp
      const q = nonNegativeInteger(file, e.openQuestionsCount, 'science_emitted.openQuestionsCount', line)
      if (q) return q
      break
    }

    case 'hypothesis_added': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'hypothesis_added', e.phase, line)
      const idIssue = idMatches(file, e.id, /^H-\d{3,}$/, 'hypothesis_added.id', line)
      if (idIssue) return idIssue
      const HSTAT = ['open', 'confirmed', 'rejected', 'obsolete']
      if (typeof e.status !== 'string' || !HSTAT.includes(e.status)) {
        return enumInvalid(file, 'hypothesis_added.status', HSTAT, e.status, line)
      }
      const fIssue = nonEmptyString(file, e.falsifier, 'hypothesis_added.falsifier', line)
      if (fIssue) return fIssue
      break
    }

    case 'hypothesis_updated': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'hypothesis_updated', e.phase, line)
      const idIssue = idMatches(file, e.id, /^H-\d{3,}$/, 'hypothesis_updated.id', line)
      if (idIssue) return idIssue
      const HSTAT = ['open', 'confirmed', 'rejected', 'obsolete']
      if (typeof e.prevStatus !== 'string' || !HSTAT.includes(e.prevStatus)) {
        return enumInvalid(file, 'hypothesis_updated.prevStatus', HSTAT, e.prevStatus, line)
      }
      if (typeof e.nextStatus !== 'string' || !HSTAT.includes(e.nextStatus)) {
        return enumInvalid(file, 'hypothesis_updated.nextStatus', HSTAT, e.nextStatus, line)
      }
      if (!Array.isArray(e.changedFields) || !e.changedFields.every((s) => typeof s === 'string')) {
        return strArrInvalid(file, 'hypothesis_updated.changedFields', line)
      }
      break
    }

    case 'question_added': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'question_added', e.phase, line)
      const idIssue = idMatches(file, e.id, /^Q-\d{3,}$/, 'question_added.id', line)
      if (idIssue) return idIssue
      const QSTAT = ['open', 'resolved', 'deferred']
      if (typeof e.status !== 'string' || !QSTAT.includes(e.status)) {
        return enumInvalid(file, 'question_added.status', QSTAT, e.status, line)
      }
      const QIMP = ['low', 'medium', 'high', 'blocking']
      if (typeof e.importance !== 'string' || !QIMP.includes(e.importance)) {
        return enumInvalid(file, 'question_added.importance', QIMP, e.importance, line)
      }
      if (e.dueBy !== null && (typeof e.dueBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.dueBy))) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'question_added.dueBy must be ISO YYYY-MM-DD or null',
          detail: `got ${JSON.stringify(e.dueBy)}`,
          line,
        }
      }
      break
    }

    case 'question_resolved': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'question_resolved', e.phase, line)
      const idIssue = idMatches(file, e.id, /^Q-\d{3,}$/, 'question_resolved.id', line)
      if (idIssue) return idIssue
      if (typeof e.resolvedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.resolvedAt)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'question_resolved.resolvedAt must be ISO YYYY-MM-DD',
          detail: `got ${JSON.stringify(e.resolvedAt)}`,
          line,
        }
      }
      const rIssue = nonEmptyString(file, e.resolution, 'question_resolved.resolution', line)
      if (rIssue) return rIssue
      break
    }

    case 'question_deferred': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'question_deferred', e.phase, line)
      const idIssue = idMatches(file, e.id, /^Q-\d{3,}$/, 'question_deferred.id', line)
      if (idIssue) return idIssue
      if (typeof e.deferredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.deferredAt)) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'question_deferred.deferredAt must be ISO YYYY-MM-DD',
          detail: `got ${JSON.stringify(e.deferredAt)}`,
          line,
        }
      }
      break
    }

    case 'budget_warning': {
      const BMETRICS = ['maxTurns', 'maxProviderCalls', 'maxTokensEstimate', 'maxWallTimeMinutes']
      if (typeof e.metric !== 'string' || !BMETRICS.includes(e.metric)) {
        return enumInvalid(file, 'budget_warning.metric', BMETRICS, e.metric, line)
      }
      if (typeof e.ratio !== 'number' || !Number.isFinite(e.ratio) || e.ratio < 0 || e.ratio > 1) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'budget_warning.ratio must be a number in [0, 1]',
          detail: `got ${JSON.stringify(e.ratio)}`,
          line,
        }
      }
      const cIssue = nonNegativeInteger(file, e.current, 'budget_warning.current', line)
      if (cIssue) return cIssue
      const lIssue = nonNegativeInteger(file, e.limit, 'budget_warning.limit', line)
      if (lIssue) return lIssue
      break
    }

    case 'worktree_created': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_created', e.phase, line)
      const baseIssue = idMatches(file, e.baseCommitSha, /^[0-9a-f]{40}$/, 'worktree_created.baseCommitSha', line)
      if (baseIssue) return baseIssue
      const wpIssue = nonEmptyString(file, e.worktreePath, 'worktree_created.worktreePath', line)
      if (wpIssue) return wpIssue
      const POLICIES = ['clean-base', 'stash-and-pin']
      if (typeof e.dirtyTreePolicy !== 'string' || !POLICIES.includes(e.dirtyTreePolicy)) {
        return enumInvalid(file, 'worktree_created.dirtyTreePolicy', POLICIES, e.dirtyTreePolicy, line)
      }
      break
    }

    case 'worktree_failed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_failed', e.phase, line)
      if (typeof e.step !== 'number' || ![1, 2, 3, 4].includes(e.step)) {
        return enumInvalid(file, 'worktree_failed.step', ['1', '2', '3', '4'], e.step, line)
      }
      const codeIssue = nonEmptyString(file, e.code, 'worktree_failed.code', line)
      if (codeIssue) return codeIssue
      const reasonIssue = nonEmptyString(file, e.reason, 'worktree_failed.reason', line)
      if (reasonIssue) return reasonIssue
      break
    }

    case 'worktree_patch_applied': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_patch_applied', e.phase, line)
      const shaIssue = idMatches(
        file, e.patchSha256, /^[0-9a-f]{64}$/, 'worktree_patch_applied.patchSha256', line,
      )
      if (shaIssue) return shaIssue
      const ppIssue = nonEmptyString(file, e.patchPath, 'worktree_patch_applied.patchPath', line)
      if (ppIssue) return ppIssue
      const aIssue = positiveInteger(file, e.attempt, 'worktree_patch_applied.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'worktree_patch_applied.taskId', line)
      if (tIssue) return tIssue
      break
    }

    case 'worktree_patch_failed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_patch_failed', e.phase, line)
      const codeIssue = nonEmptyString(file, e.code, 'worktree_patch_failed.code', line)
      if (codeIssue) return codeIssue
      const aIssue = positiveInteger(file, e.attempt, 'worktree_patch_failed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'worktree_patch_failed.taskId', line)
      if (tIssue) return tIssue
      const rIssue = nonEmptyString(file, e.reason, 'worktree_patch_failed.reason', line)
      if (rIssue) return rIssue
      break
    }

    case 'worktree_forensics_preserved': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_forensics_preserved', e.phase, line)
      const aIssue = positiveInteger(file, e.attempt, 'worktree_forensics_preserved.attempt', line)
      if (aIssue) return aIssue
      const fpIssue = nonEmptyString(file, e.forensicsPath, 'worktree_forensics_preserved.forensicsPath', line)
      if (fpIssue) return fpIssue
      if (!Array.isArray(e.entries) || !e.entries.every((s: unknown) => typeof s === 'string')) {
        return strArrInvalid(file, 'worktree_forensics_preserved.entries', line)
      }
      if (e.entries.length === 0) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'worktree_forensics_preserved.entries must have at least one entry',
          line,
        }
      }
      break
    }

    case 'worktree_destroyed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'worktree_destroyed', e.phase, line)
      const aIssue = positiveInteger(file, e.attempt, 'worktree_destroyed.attempt', line)
      if (aIssue) return aIssue
      const wpIssue = nonEmptyString(file, e.worktreePath, 'worktree_destroyed.worktreePath', line)
      if (wpIssue) return wpIssue
      break
    }

    case 'build_started': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'build_started', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'build_started.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'build_started.attempt', line)
      if (aIssue) return aIssue
      const baseIssue = idMatches(file, e.baseCommitSha, /^[0-9a-f]{40}$/, 'build_started.baseCommitSha', line)
      if (baseIssue) return baseIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'build_started.taskId', line)
      if (tIssue) return tIssue
      break
    }

    case 'build_patch_applied': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'build_patch_applied', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'build_patch_applied.agent', line)
      if (agentIssue) return agentIssue
      const shaIssue = idMatches(
        file, e.patchSha256, /^[0-9a-f]{64}$/, 'build_patch_applied.patchSha256', line,
      )
      if (shaIssue) return shaIssue
      const aIssue = positiveInteger(file, e.attempt, 'build_patch_applied.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'build_patch_applied.taskId', line)
      if (tIssue) return tIssue
      break
    }

    case 'build_completed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'build_completed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'build_completed.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'build_completed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'build_completed.taskId', line)
      if (tIssue) return tIssue
      const cIssue = nonNegativeInteger(file, e.changedFileCount, 'build_completed.changedFileCount', line)
      if (cIssue) return cIssue
      const reportIssue = idMatches(
        file, e.buildReportSha256, /^[0-9a-f]{64}$/, 'build_completed.buildReportSha256', line,
      )
      if (reportIssue) return reportIssue
      break
    }

    case 'build_failed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'build_failed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'build_failed.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'build_failed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'build_failed.taskId', line)
      if (tIssue) return tIssue
      const codeIssue = nonEmptyString(file, e.code, 'build_failed.code', line)
      if (codeIssue) return codeIssue
      const reasonIssue = nonEmptyString(file, e.reason, 'build_failed.reason', line)
      if (reasonIssue) return reasonIssue
      break
    }

    case 'build_provider_recorded': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'build_provider_recorded', e.phase, line)
      const aIssue = positiveInteger(file, e.attempt, 'build_provider_recorded.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'build_provider_recorded.taskId', line)
      if (tIssue) return tIssue
      const provIssue = nonEmptyString(file, e.provider, 'build_provider_recorded.provider', line)
      if (provIssue) return provIssue
      const famIssue = nonEmptyString(file, e.family, 'build_provider_recorded.family', line)
      if (famIssue) return famIssue
      // model is optional (agents may not pin a model in frontmatter); when
      // present it must be a non-empty string.
      if (e.model !== undefined) {
        if (typeof e.model !== 'string' || e.model.length === 0) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'build_provider_recorded.model must be a non-empty string when present',
            detail: `got ${JSON.stringify(e.model)}`,
            line,
          }
        }
      }
      break
    }

    case 'verify_started': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'verify_started', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'verify_started.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'verify_started.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'verify_started.taskId', line)
      if (tIssue) return tIssue
      const baseIssue = idMatches(
        file, e.baseCommitSha, /^[0-9a-f]{40}$/, 'verify_started.baseCommitSha', line,
      )
      if (baseIssue) return baseIssue
      const patchIssue = idMatches(
        file, e.patchSha256, SHA256_REGEX, 'verify_started.patchSha256', line,
      )
      if (patchIssue) return patchIssue
      const reportIssue = idMatches(
        file, e.buildReportSha256, SHA256_REGEX, 'verify_started.buildReportSha256', line,
      )
      if (reportIssue) return reportIssue
      break
    }

    case 'verify_completed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'verify_completed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'verify_completed.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'verify_completed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'verify_completed.taskId', line)
      if (tIssue) return tIssue
      const reportIssue = idMatches(
        file, e.verifyReportSha256, SHA256_REGEX, 'verify_completed.verifyReportSha256', line,
      )
      if (reportIssue) return reportIssue
      // Mutation gate semantics: verdict=pass requires status ∈ {pass, not-applicable}
      // (VERIFY.md § Verdict). Status='fail' would mean verdict=fail → verify_failed event.
      const allowedMutation = ['pass', 'not-applicable'] as const
      if (typeof e.mutationStatus !== 'string' || !(allowedMutation as readonly string[]).includes(e.mutationStatus)) {
        return enumInvalid(file, 'verify_completed.mutationStatus', allowedMutation, e.mutationStatus, line)
      }
      break
    }

    case 'verify_failed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'verify_failed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'verify_failed.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'verify_failed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'verify_failed.taskId', line)
      if (tIssue) return tIssue
      const reportIssue = idMatches(
        file, e.verifyReportSha256, SHA256_REGEX, 'verify_failed.verifyReportSha256', line,
      )
      if (reportIssue) return reportIssue
      const allowedReasons = ['exit', 'timeout', 'stdout-cap', 'stderr-cap', 'spawn-error'] as const
      if (typeof e.terminationReason !== 'string' || !(allowedReasons as readonly string[]).includes(e.terminationReason)) {
        return enumInvalid(file, 'verify_failed.terminationReason', allowedReasons, e.terminationReason, line)
      }
      // exitCode: number | null (null on spawn-error / never-exited)
      if (e.exitCode !== null && (typeof e.exitCode !== 'number' || !Number.isInteger(e.exitCode))) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'verify_failed.exitCode must be an integer or null',
          detail: `got ${JSON.stringify(e.exitCode)}`,
          line,
        }
      }
      const summaryIssue = nonEmptyString(file, e.failureSummary, 'verify_failed.failureSummary', line)
      if (summaryIssue) return summaryIssue
      // 200-char cap matches VERIFY.md § "Failure constraint" grammar.
      if (typeof e.failureSummary === 'string' && e.failureSummary.length > 200) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'verify_failed.failureSummary must be ≤ 200 characters (VERIFY.md grammar)',
          detail: `got ${e.failureSummary.length}`,
          line,
        }
      }
      break
    }

    case 'verify_restart_initiated': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'verify_restart_initiated', e.phase, line)
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'verify_restart_initiated.taskId', line)
      if (tIssue) return tIssue
      const aIssue = positiveInteger(file, e.attempt, 'verify_restart_initiated.attempt', line)
      if (aIssue) return aIssue
      const allowedActions = ['restart', 'intervention'] as const
      if (typeof e.nextAction !== 'string' || !(allowedActions as readonly string[]).includes(e.nextAction)) {
        return enumInvalid(file, 'verify_restart_initiated.nextAction', allowedActions, e.nextAction, line)
      }
      // nextAttempt is required iff nextAction === 'restart' and must equal attempt + 1.
      if (e.nextAction === 'restart') {
        const naIssue = positiveInteger(file, e.nextAttempt, 'verify_restart_initiated.nextAttempt', line)
        if (naIssue) return naIssue
        if (typeof e.attempt === 'number' && typeof e.nextAttempt === 'number' && e.nextAttempt !== e.attempt + 1) {
          return {
            file,
            code: 'event_invalid_value',
            rule: 'verify_restart_initiated.nextAttempt must equal attempt + 1 when nextAction=restart',
            detail: `attempt=${e.attempt}, nextAttempt=${e.nextAttempt}`,
            line,
          }
        }
      } else if (e.nextAttempt !== undefined) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'verify_restart_initiated.nextAttempt must be omitted when nextAction=intervention',
          line,
        }
      }
      const fpIssue = nonEmptyString(file, e.forensicsPath, 'verify_restart_initiated.forensicsPath', line)
      if (fpIssue) return fpIssue
      break
    }

    case 'review_started': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'review_started', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'review_started.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'review_started.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'review_started.taskId', line)
      if (tIssue) return tIssue
      const baseIssue = idMatches(
        file, e.baseCommitSha, /^[0-9a-f]{40}$/, 'review_started.baseCommitSha', line,
      )
      if (baseIssue) return baseIssue
      const patchIssue = idMatches(
        file, e.patchSha256, SHA256_REGEX, 'review_started.patchSha256', line,
      )
      if (patchIssue) return patchIssue
      const buildReportIssue = idMatches(
        file, e.buildReportSha256, SHA256_REGEX, 'review_started.buildReportSha256', line,
      )
      if (buildReportIssue) return buildReportIssue
      const verifyReportIssue = idMatches(
        file, e.verifyReportSha256, SHA256_REGEX, 'review_started.verifyReportSha256', line,
      )
      if (verifyReportIssue) return verifyReportIssue
      const buildFamilyIssue = nonEmptyString(file, e.buildFamily, 'review_started.buildFamily', line)
      if (buildFamilyIssue) return buildFamilyIssue
      const reviewerFamilyIssue = nonEmptyString(
        file, e.reviewerFamily, 'review_started.reviewerFamily', line,
      )
      if (reviewerFamilyIssue) return reviewerFamilyIssue
      // Cross-family invariant: families must differ. The runtime check
      // in src/tools/review-request.ts is authoritative; this validator
      // catches a corrupted log line that would otherwise be accepted.
      if (e.buildFamily === e.reviewerFamily) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_started.buildFamily must differ from review_started.reviewerFamily (cross-family invariant)',
          detail: `both = ${JSON.stringify(e.buildFamily)}`,
          line,
        }
      }
      break
    }

    case 'review_round_completed': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'review_round_completed', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'review_round_completed.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'review_round_completed.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'review_round_completed.taskId', line)
      if (tIssue) return tIssue
      // round must be 1..4 (CLAUDE.md rule 6).
      if (typeof e.round !== 'number' || !Number.isInteger(e.round) || e.round < 1 || e.round > 4) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_round_completed.round must be an integer in [1, 4]',
          detail: `got ${JSON.stringify(e.round)}`,
          line,
        }
      }
      // score must be 0..10 inclusive.
      if (typeof e.score !== 'number' || !Number.isInteger(e.score) || e.score < 0 || e.score > 10) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_round_completed.score must be an integer in [0, 10]',
          detail: `got ${JSON.stringify(e.score)}`,
          line,
        }
      }
      const allowedVerdicts = ['ready', 'needs-revision', 'block'] as const
      if (typeof e.verdict !== 'string' || !(allowedVerdicts as readonly string[]).includes(e.verdict)) {
        return enumInvalid(file, 'review_round_completed.verdict', allowedVerdicts, e.verdict, line)
      }
      const raisedIssue = nonNegativeInteger(
        file, e.findingsRaised, 'review_round_completed.findingsRaised', line,
      )
      if (raisedIssue) return raisedIssue
      const resolvedIssue = nonNegativeInteger(
        file, e.findingsResolved, 'review_round_completed.findingsResolved', line,
      )
      if (resolvedIssue) return resolvedIssue
      break
    }

    case 'review_resolved': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'review_resolved', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'review_resolved.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'review_resolved.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'review_resolved.taskId', line)
      if (tIssue) return tIssue
      if (typeof e.finalRound !== 'number' || !Number.isInteger(e.finalRound) || e.finalRound < 1 || e.finalRound > 4) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_resolved.finalRound must be an integer in [1, 4]',
          detail: `got ${JSON.stringify(e.finalRound)}`,
          line,
        }
      }
      // finalScore must be >= 6 for review_resolved (CLAUDE.md rule 6
      // exit condition: score≥6 AND verdict=ready).
      if (typeof e.finalScore !== 'number' || !Number.isInteger(e.finalScore) || e.finalScore < 6 || e.finalScore > 10) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_resolved.finalScore must be an integer in [6, 10] (rule 6 exit condition)',
          detail: `got ${JSON.stringify(e.finalScore)}`,
          line,
        }
      }
      const reportIssue = idMatches(
        file, e.reviewReportSha256, SHA256_REGEX, 'review_resolved.reviewReportSha256', line,
      )
      if (reportIssue) return reportIssue
      break
    }

    case 'review_blocked': {
      if (!isPhase(e.phase)) return phaseInvalid(file, 'review_blocked', e.phase, line)
      const agentIssue = nonEmptyString(file, e.agent, 'review_blocked.agent', line)
      if (agentIssue) return agentIssue
      const aIssue = positiveInteger(file, e.attempt, 'review_blocked.attempt', line)
      if (aIssue) return aIssue
      const tIssue = idMatches(file, e.taskId, /^T-\d{3,}$/, 'review_blocked.taskId', line)
      if (tIssue) return tIssue
      const allowedReasons = ['block', 'cap_exhausted'] as const
      if (typeof e.reason !== 'string' || !(allowedReasons as readonly string[]).includes(e.reason)) {
        return enumInvalid(file, 'review_blocked.reason', allowedReasons, e.reason, line)
      }
      if (typeof e.finalRound !== 'number' || !Number.isInteger(e.finalRound) || e.finalRound < 1 || e.finalRound > 4) {
        return {
          file,
          code: 'event_invalid_value',
          rule: 'review_blocked.finalRound must be an integer in [1, 4]',
          detail: `got ${JSON.stringify(e.finalRound)}`,
          line,
        }
      }
      const reportIssue = idMatches(
        file, e.reviewReportSha256, SHA256_REGEX, 'review_blocked.reviewReportSha256', line,
      )
      if (reportIssue) return reportIssue
      break
    }
  }

  return null
}

function strArrInvalid(file: string, field: string, line?: number): EventLogIssue {
  return {
    file,
    code: 'event_invalid_value',
    rule: `${field} must be an array of strings`,
    line,
  }
}

function enumInvalid(
  file: string,
  field: string,
  allowed: readonly string[],
  got: unknown,
  line?: number,
): EventLogIssue {
  return {
    file,
    code: 'event_invalid_value',
    rule: `${field} must be one of: ${allowed.join(' | ')}`,
    detail: `got ${JSON.stringify(got)}`,
    line,
  }
}

function idMatches(
  file: string,
  value: unknown,
  pattern: RegExp,
  field: string,
  line?: number,
): EventLogIssue | null {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return {
      file,
      code: 'event_invalid_value',
      rule: `${field} must match /${pattern.source}/`,
      detail: `got ${JSON.stringify(value)}`,
      line,
    }
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

function positiveInteger(
  file: string,
  value: unknown,
  field: string,
  line?: number,
): EventLogIssue | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return {
      file,
      code: 'event_invalid_value',
      rule: `${field} must be a positive integer (>= 1)`,
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
