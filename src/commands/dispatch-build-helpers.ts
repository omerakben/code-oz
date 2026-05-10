// Helpers used by `dispatchBuild` in src/commands/run.ts.
//
// Extracted out of run.ts so the dispatcher's pre-flight logic (gate
// reads, restart-signal resolution, plan loading) is unit-testable
// without spawning a subprocess. The dispatcher composes them; nothing
// here writes events.jsonl or mutates run state.
//
// Codex M16 C6 pre-design review notes pinned in
// docs/design/SESSION_M16_C6_C13_LOOP_PLAN.md called out three load-
// bearing concerns this module addresses:
//
//   1. NEEDS_INTERVENTION refusal MUST happen before bootstrap +
//      persona lookup so an operator-resolvable run does not consume
//      provider quota or surface a misleading error.
//   2. Attempt > 1 MUST require a `verify_restart_initiated` event
//      whose taskId/attempt/nextAttempt match the new attempt number.
//      Absent or mismatched signals → drift refusal, never silent
//      attempt N+1.
//   3. Open `build_started` without a terminal `build_completed`
//      / `build_failed` for the same attempt is a half-finished
//      crash; dispatchBuild refuses rather than racing with whatever
//      wrote the half-event.

import { readFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import {
  parsePlan,
  type PlanArtifact,
} from '../artifacts/plan.ts'
import {
  parseVerifyReport,
  VerifyReportLoadError,
  type VerifyReportData,
} from '../artifacts/verify-report.ts'
import {
  parseBuildReport,
  BuildReportLoadError,
} from '../artifacts/build-report.ts'
import {
  parseReviewReport,
  parseReviewPanelReport,
  detectReviewReportMode,
  ReviewReportLoadError,
  serializeReviewCarryForward,
  REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
} from '../artifacts/review-report.ts'
import {
  prepareCarryForward,
  type VerifiedFailedAttempt,
} from '../phases/restart-policy.ts'
import type { BuildReportCarryForward } from '../artifacts/build-report.ts'
import type { LoggedEvent, NeedsInterventionGate, Phase } from '../state/schemas.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'
import type { RunPaths } from '../state/run.ts'

// --- NEEDS_INTERVENTION read --------------------------------------

export class NeedsInterventionReadError extends Error {
  readonly path: string
  override readonly cause: string
  constructor(path: string, cause: string) {
    super(`NEEDS_INTERVENTION.json at ${path} is unreadable: ${cause}`)
    this.name = 'NeedsInterventionReadError'
    this.path = path
    this.cause = cause
  }
}

/**
 * Returns the run's NEEDS_INTERVENTION.json content if the gate file
 * exists; `null` when it does not. Throws `NeedsInterventionReadError`
 * on malformed JSON or schema violations (corruption is a different
 * failure mode than absence and should surface to the operator
 * unchanged).
 *
 * Q7 (kickoff line 60) places this read at the very top of every
 * dispatcher so operators get the actionable suggestions before any
 * persona invocation is attempted.
 *
 * Inline parse (rather than `readGate`) because `readGate`'s shared
 * validator returns `GateFile` and does not enforce the
 * NeedsInterventionGate-specific fields (`code`, `rule`,
 * `actionableSuggestions`).
 */
export async function tryReadNeedsInterventionGate(
  runPaths: RunPaths,
): Promise<NeedsInterventionGate | null> {
  const gatePath = join(runPaths.runDir, 'NEEDS_INTERVENTION.json')
  let raw: string
  try {
    raw = await readFile(gatePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new NeedsInterventionReadError(
      gatePath,
      err instanceof Error ? err.message : String(err),
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new NeedsInterventionReadError(
      gatePath,
      err instanceof Error ? err.message : String(err),
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NeedsInterventionReadError(gatePath, 'top-level value is not an object')
  }
  const obj = parsed as Record<string, unknown>
  for (const required of [
    'version',
    'runId',
    'phase',
    'agent',
    'code',
    'rule',
    'actionableSuggestions',
    'createdAt',
  ]) {
    if (!(required in obj)) {
      throw new NeedsInterventionReadError(gatePath, `missing required field '${required}'`)
    }
  }
  if (obj.version !== 1) {
    throw new NeedsInterventionReadError(gatePath, `unsupported version: ${String(obj.version)}`)
  }
  if (
    !Array.isArray(obj.actionableSuggestions) ||
    !obj.actionableSuggestions.every((s) => typeof s === 'string' && s.length > 0)
  ) {
    throw new NeedsInterventionReadError(gatePath, 'actionableSuggestions must be a non-empty-string array')
  }
  return Object.freeze(obj as unknown as NeedsInterventionGate)
}

// --- in-flight build_started detection ----------------------------

export interface OpenBuildAttempt {
  readonly attempt: number
  readonly ts: string
}

/**
 * Returns the `build_started` event whose `(runId, taskId, attempt)`
 * has no matching `build_completed`/`build_failed` for the same
 * attempt. Used by dispatchBuild to refuse re-dispatching while a
 * previous attempt is mid-flight (process crash + lock not held →
 * stale event without a closing pair).
 *
 * `null` when every `build_started` for this `(runId, taskId)` has a
 * terminal pair, or when none exists.
 */
export function detectOpenBuildStarted(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): OpenBuildAttempt | null {
  // Pair `build_started` (per attempt) against the union of
  // `build_completed` + `build_failed` for the same attempt. Any
  // started event without a terminal pair is open.
  const startedByAttempt = new Map<number, string>() // attempt → ts
  const closedAttempts = new Set<number>()
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.runId !== runId) continue
    if (e.type === 'build_started') {
      const started = e as Extract<LoggedEvent, { type: 'build_started' }>
      if (started.taskId !== taskId) continue
      // Last-write-wins on duplicates — dispatcher only reports the
      // most recent stale start, never tracks duplicates.
      startedByAttempt.set(started.attempt, started.ts)
      continue
    }
    if (e.type === 'build_completed') {
      const completed = e as Extract<LoggedEvent, { type: 'build_completed' }>
      if (completed.taskId !== taskId) continue
      closedAttempts.add(completed.attempt)
      continue
    }
    if (e.type === 'build_failed') {
      const failed = e as Extract<LoggedEvent, { type: 'build_failed' }>
      if (failed.taskId !== taskId) continue
      closedAttempts.add(failed.attempt)
      continue
    }
  }
  for (const [attempt, ts] of startedByAttempt) {
    if (!closedAttempts.has(attempt)) {
      return Object.freeze({ attempt, ts })
    }
  }
  return null
}

/**
 * True when a prior `task_started` event exists for `(runId, taskId)`.
 * dispatchBuild uses this to gate `task_started` emission idempotently
 * across pre-build crashes.
 *
 * R1 finding 5 (fix-soon): the prior shape gated emission on
 * `attempt === 1`. A crash AFTER `task_started` and BEFORE
 * `build_started` re-enters dispatchBuild on the next run with attempt
 * still === 1, double-emitting `task_started`. Keying on event
 * presence (rather than attempt) closes that crash window.
 */
export function hasTaskStartedFor(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): boolean {
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'task_started') continue
    if (e.runId !== runId) continue
    const started = e as Extract<LoggedEvent, { type: 'task_started' }>
    if (started.taskId === taskId) return true
  }
  return false
}

// --- PLAN.md load --------------------------------------------------

/**
 * Read PLAN.md from `<artifactRoot>/PLAN.md` and parse it. Throws on
 * absent / unparseable files. The dispatcher catches and surfaces the
 * error message so the operator can re-run after fixing the artifact.
 */
export async function loadPlanArtifact(
  artifactRoot: string,
): Promise<PlanArtifact> {
  const planPath = join(artifactRoot, 'PLAN.md')
  const raw = await readFile(planPath, 'utf8')
  return parsePlan(raw, planPath)
}

// --- carry-forward resolver ---------------------------------------

export type ResolveCarryForwardResult =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'present'
      readonly cf: BuildReportCarryForward
      readonly priorAttempt: number
    }
  | { readonly kind: 'awaiting-approve'; readonly priorAttempt: number }
  | { readonly kind: 'drift'; readonly reason: string }

export interface ResolveCarryForwardInput {
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
  readonly artifactRoot: string
}

/**
 * Resolve the carry-forward block for a BUILD invocation:
 *
 *   - attempt === 1 → `{ kind: 'none' }` (fresh attempt, no carry-forward)
 *   - attempt > 1 with valid `verify_restart_initiated` for `attempt-1`
 *     and parseable VERIFY.md showing verdict='fail' for the same
 *     `(taskId, attempt-1)` → `{ kind: 'present', cf, priorAttempt }`
 *     where `cf` is the structured carry-forward block runBuild
 *     consumes (source='verify-fail').
 *   - attempt > 1 with valid `review_remediation_recorded` for
 *     `(taskId, attempt-1)` with `remediationIntent='continue'` and a
 *     parseable REVIEW.md whose upstreamRefs match → carry-forward
 *     with source='review-needs-revision'. (M16 C9 Mod #8 — extends
 *     the existing M9 review-needs-revision shape `BuildReportCarryForward`
 *     already supports.)
 *   - attempt > 1 with `build_completed` for `attempt-1` but neither a
 *     verify-restart nor review-remediation signal → `{ kind:
 *     'awaiting-approve' }` so the dispatcher can tell the operator
 *     to run `code-oz approve build`.
 *   - attempt > 1 with the restart signal but VERIFY.md / REVIEW.md is
 *     missing / malformed / mismatched → `{ kind: 'drift', reason }`.
 *
 * Source-aware: when both signals are present (e.g., a verify-fail
 * happened earlier in the same task and was followed by a
 * review-needs-revision later), the most recent matching signal wins
 * — file order is the ordering authority (validation rule 8).
 */
export async function resolveBuildCarryForward(
  input: ResolveCarryForwardInput,
): Promise<ResolveCarryForwardResult> {
  if (input.attempt === 1) {
    return Object.freeze({ kind: 'none' as const })
  }

  const priorAttempt = input.attempt - 1

  // Find verify_restart_initiated for this (taskId, priorAttempt) AND
  // review_remediation_recorded for this (taskId, priorAttempt) with
  // intent=continue. The latest event among the two wins (file order
  // is the ordering authority per rule 8).
  let restartSignal:
    | Extract<LoggedEvent, { type: 'verify_restart_initiated' }>
    | undefined
  let restartSignalIdx = -1
  let remediationSignal:
    | Extract<LoggedEvent, { type: 'review_remediation_recorded' }>
    | undefined
  let remediationSignalIdx = -1
  for (let i = 0; i < input.events.length; i++) {
    const e = input.events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.runId !== input.runId) continue
    if (e.type === 'verify_restart_initiated') {
      const restart = e as Extract<LoggedEvent, { type: 'verify_restart_initiated' }>
      if (restart.taskId !== input.taskId) continue
      if (restart.attempt !== priorAttempt) continue
      if (restart.nextAction !== 'restart') continue
      if (restart.nextAttempt !== input.attempt) continue
      restartSignal = restart
      restartSignalIdx = i
      continue
    }
    if (e.type === 'review_remediation_recorded') {
      const remediation = e as Extract<
        LoggedEvent,
        { type: 'review_remediation_recorded' }
      >
      if (remediation.taskId !== input.taskId) continue
      if (remediation.attempt !== priorAttempt) continue
      if (remediation.remediationIntent !== 'continue') continue
      remediationSignal = remediation
      remediationSignalIdx = i
    }
  }

  if (restartSignal === undefined && remediationSignal === undefined) {
    // Either there's a build_completed for priorAttempt without any
    // restart / remediation signal (awaiting-approve case) or there is
    // no prior BUILD record at all (drift — caller bumped attempt
    // without a completed prior attempt).
    let priorCompleted = false
    for (const e of input.events) {
      if (!isKnownPhaseEvent(e)) continue
      if (e.type !== 'build_completed') continue
      if (e.runId !== input.runId) continue
      const completed = e as Extract<LoggedEvent, { type: 'build_completed' }>
      if (completed.taskId !== input.taskId) continue
      if (completed.attempt === priorAttempt) {
        priorCompleted = true
        break
      }
    }
    if (priorCompleted) {
      return Object.freeze({
        kind: 'awaiting-approve' as const,
        priorAttempt,
      })
    }
    return Object.freeze({
      kind: 'drift' as const,
      reason: `attempt=${input.attempt} but no build_completed, verify_restart_initiated, or review_remediation_recorded for (taskId=${input.taskId}, attempt=${priorAttempt})`,
    })
  }

  // M16 C9 Mod #8 — when both signals exist, last-wins by file order.
  // When only one is present, that one wins.
  if (
    remediationSignal !== undefined &&
    (restartSignal === undefined || remediationSignalIdx > restartSignalIdx)
  ) {
    return await resolveReviewRemediationCarryForward({
      input,
      priorAttempt,
      remediation: remediationSignal,
    })
  }
  if (restartSignal === undefined) {
    // Defensive — narrowed by the conditional above. Should be unreachable
    // because the !restartSignal && !remediationSignal case is the early
    // return above; this exists for the type narrower.
    return Object.freeze({
      kind: 'drift' as const,
      reason: 'resolveBuildCarryForward: signal narrowing bug',
    })
  }

  // Restart signal present — read VERIFY.md and validate.
  const verifyPath = join(input.artifactRoot, 'VERIFY.md')
  let verifyData: VerifyReportData
  try {
    const raw = await readFile(verifyPath, 'utf8')
    verifyData = parseVerifyReport(raw, verifyPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `verify_restart_initiated present but VERIFY.md not found at ${verifyPath}`,
      })
    }
    if (err instanceof VerifyReportLoadError) {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `VERIFY.md is malformed: ${err.message}`,
      })
    }
    throw err
  }

  if (verifyData.verdict.verdict !== 'fail') {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `VERIFY.md verdict is '${verifyData.verdict.verdict}', expected 'fail' for restart`,
    })
  }
  if (verifyData.buildRef.taskId !== input.taskId) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `VERIFY.md buildRef.taskId='${verifyData.buildRef.taskId}' does not match dispatched taskId='${input.taskId}'`,
    })
  }
  if (verifyData.buildRef.attempt !== priorAttempt) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `VERIFY.md buildRef.attempt=${verifyData.buildRef.attempt} does not match priorAttempt=${priorAttempt}`,
    })
  }
  if (
    verifyData.failureConstraint === null ||
    verifyData.failureConstraint.attempt !== priorAttempt
  ) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `VERIFY.md failureConstraint missing or attempt mismatch (expected ${priorAttempt})`,
    })
  }

  const vfa: VerifiedFailedAttempt = Object.freeze({
    attempt: verifyData.failureConstraint.attempt,
    forensicsPath: verifyData.failureConstraint.forensicsPath,
    validationCommand: verifyData.failureConstraint.validationCommand,
    verdict: verifyData.failureConstraint.verdict,
    failureSummary: verifyData.failureConstraint.failureSummary,
    constraint: verifyData.failureConstraint.constraint,
  })
  const cf = prepareCarryForward(vfa)
  return Object.freeze({
    kind: 'present' as const,
    cf,
    priorAttempt,
  })
}

// --- review-needs-revision carry-forward (M16 C9 Mod #8) ---------

/**
 * Build the `review-needs-revision` carry-forward block for BUILD
 * attempt N+1. Reads the canonical REVIEW.md, validates it parses + the
 * upstream refs match the dispatched taskId/attempt, validates the sha
 * matches the `review_remediation_recorded.reviewMdSha256`, then maps
 * onto BuildReportCarryForward via `serializeReviewCarryForward`.
 *
 * Mirrors the `verify-fail` path's strictness: every drift case
 * surfaces with `kind: 'drift'` and a specific reason. The sha check
 * is the operator-hand-edit detector for the REVIEW path.
 */
async function resolveReviewRemediationCarryForward(args: {
  readonly input: ResolveCarryForwardInput
  readonly priorAttempt: number
  readonly remediation: Extract<
    LoggedEvent,
    { type: 'review_remediation_recorded' }
  >
}): Promise<ResolveCarryForwardResult> {
  const { input, priorAttempt, remediation } = args
  const reviewPath = join(input.artifactRoot, 'REVIEW.md')
  let reviewText: string
  try {
    reviewText = await readFile(reviewPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `review_remediation_recorded present but REVIEW.md not found at ${reviewPath}`,
      })
    }
    throw err
  }
  const actualSha = createHash('sha256').update(reviewText, 'utf8').digest('hex')
  if (actualSha !== remediation.reviewMdSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `REVIEW.md sha ${actualSha.slice(0, 8)}… does not match review_remediation_recorded.reviewMdSha256 ${remediation.reviewMdSha256.slice(0, 8)}… (post-edit detected)`,
    })
  }

  // Parse REVIEW.md — accept single OR panel mode (the panelist
  // emits remediation events too via the panel-flatten path). Fail if
  // the upstream refs disagree with our dispatched (taskId, attempt).
  const mode = detectReviewReportMode(reviewText)
  if (mode === 'unknown') {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `REVIEW.md is neither single nor panel mode (expected '## Reviewer' xor '## Reviewers')`,
    })
  }
  let reviewData:
    | ReturnType<typeof parseReviewReport>
    | ReturnType<typeof parseReviewPanelReport>
  try {
    reviewData = mode === 'panel'
      ? parseReviewPanelReport(reviewText, reviewPath)
      : parseReviewReport(reviewText, reviewPath)
  } catch (err) {
    if (err instanceof ReviewReportLoadError) {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `REVIEW.md is malformed: ${err.message}`,
      })
    }
    throw err
  }
  if (reviewData.upstreamRefs.taskId !== input.taskId) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `REVIEW.md upstreamRefs.taskId='${reviewData.upstreamRefs.taskId}' does not match dispatched taskId='${input.taskId}'`,
    })
  }
  if (reviewData.upstreamRefs.attempt !== priorAttempt) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `REVIEW.md upstreamRefs.attempt=${reviewData.upstreamRefs.attempt} does not match priorAttempt=${priorAttempt}`,
    })
  }

  // Read the prior BUILD_REPORT.md so we can copy its
  // priorValidationCommand into the new carry-forward (the persona's
  // existing snapshot is the source of truth for the validation
  // command). Skip parsing — only the validation command is needed.
  const buildReportPath = join(input.artifactRoot, 'BUILD_REPORT.md')
  let priorValidationCommand: string
  try {
    const buildReportText = await readFile(buildReportPath, 'utf8')
    const parsed = parseBuildReport(buildReportText, buildReportPath)
    priorValidationCommand = parsed.validationCommand.command
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `review_remediation_recorded present but BUILD_REPORT.md not found at ${buildReportPath}`,
      })
    }
    if (err instanceof BuildReportLoadError) {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `BUILD_REPORT.md is malformed: ${err.message}`,
      })
    }
    throw err
  }

  // Build the typed carry-forward from REVIEW.md fields. The summary +
  // constraint come from REVIEW.md's score field, which both single
  // and panel parsers populate. v0.1: use the ready/needs-revision
  // exit reason for the summary and a stub constraint when the
  // artifact does not carry an operator-authored directive (the
  // M9 review-remediation pipeline supplies one in production via
  // serializeReviewCarryForward; we re-create that here).
  const summary = truncateForCarryForward(
    reviewData.score.exitReason,
    REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
  )
  const constraint = truncateForCarryForward(
    `Address REVIEW round ${remediation.reviewRound} findings; re-run validation command before BUILD attempt ${input.attempt} BUILD_REPORT.md.`,
    REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
  )
  const cf = serializeReviewCarryForward({
    reviewReportPath: reviewPath,
    reviewReportSha256: remediation.reviewMdSha256,
    priorRound: remediation.reviewRound,
    summary,
    constraint,
    priorAttempt,
    priorValidationCommand,
  })
  return Object.freeze({
    kind: 'present' as const,
    cf,
    priorAttempt,
  })
}

function truncateForCarryForward(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

// --- intervention formatter ---------------------------------------

/**
 * Format a NEEDS_INTERVENTION gate body for stderr. Pulled out of the
 * dispatcher for testability and to keep the operator-facing output
 * consistent across phases (C7/C8 will use the same formatter).
 */
export function formatInterventionRefusal(
  gate: NeedsInterventionGate,
  runId: string,
): string {
  const lines: string[] = []
  lines.push(`code-oz run: an intervention is required for run ${runId}.`)
  lines.push(`  Phase: ${gate.phase}`)
  lines.push(`  Code: ${gate.code}`)
  lines.push(`  Rule: ${gate.rule}`)
  if (gate.detail !== undefined && gate.detail.length > 0) {
    lines.push(`  Detail: ${gate.detail}`)
  }
  if (gate.actionableSuggestions.length > 0) {
    lines.push('  Actionable suggestions:')
    for (const s of gate.actionableSuggestions) {
      lines.push(`    - ${s}`)
    }
  }
  lines.push(
    '  Resolve the issue, then remove .code-oz/state/runs/<runId>/NEEDS_INTERVENTION.json before re-running.',
  )
  return lines.join('\n') + '\n'
}

// Re-export for symmetry with future C7/C8 dispatchers that share the
// same Phase string union.
export type { Phase }

// --- task-boundary gate-file lifecycle (M16 C9 follow-on) ---------

export interface ClearStaleGateFileResult {
  /** Whether a stale gate file was deleted. False on the no-op paths
   *  (file absent, no prior task_completed, prior task equals current). */
  readonly cleared: boolean
  /** When `cleared` is true, the artifactSha256 of the deleted gate.
   *  Used by the dispatcher to construct the `gate_file_cleared` event
   *  payload. */
  readonly priorArtifactSha256?: string
  /** When `cleared` is true, the priorTaskId sourced from the latest
   *  `task_completed` event. */
  readonly priorTaskId?: string
}

export interface ClearStaleGateFileInput {
  readonly runDir: string
  readonly phase: 'build' | 'verify' | 'review'
  readonly events: readonly LoggedEvent[]
  readonly currentTaskId: string
  /**
   * The attempt number the upcoming dispatch is about to run for
   * `currentTaskId`. When provided (BUILD, VERIFY), the resume guard
   * tightens: it short-circuits only when `<phase>_started` exists for
   * the SAME `(currentTaskId, currentAttempt)` pair, treating a fresh
   * attempt N+1 as a new boundary that requires clearing the prior
   * attempt's stale gate file. When omitted (REVIEW), the resume guard
   * stays at the task-only granularity — REVIEW gates are written only
   * on `ready` verdict, so within-task attempt-boundary cannot produce
   * a stale gate file. (M16 C9 follow-on 4 — Bug 6.)
   */
  readonly currentAttempt?: number
}

/**
 * Resolve and (if stale) delete the per-phase `GATE_<PHASE>_PASSED.json`
 * file when the upcoming dispatch's `(currentTaskId, currentAttempt)`
 * does not match the gate file's underlying artifact. Idempotent and
 * safe to call on every dispatcher invocation; returns `{cleared:
 * false}` on every non-boundary path:
 *
 *   1. A `<phase>_started` event already exists for `(runId,
 *      currentTaskId, currentAttempt)` (or `(runId, currentTaskId)` when
 *      `currentAttempt` is omitted) → the dispatcher is resuming a
 *      partially-started phase. The gate file (if any) belongs to this
 *      task/attempt; a deletion here would race with whatever wrote the
 *      started event. (`{cleared: false}`)
 *   2. `currentAttempt` is omitted (REVIEW path) AND no prior
 *      `task_completed` exists / the latest equals `currentTaskId` →
 *      first-task / same-task no-op. (`{cleared: false}`)
 *   3. The gate file does not exist on disk → already cleaned by a
 *      prior dispatcher / operator. (`{cleared: false}`)
 *
 * On a true boundary (task or attempt) the gate file is read for its
 * `artifactSha256` field (used in the audit event payload), then
 * deleted. The dispatcher emits a `gate_file_cleared` event after this
 * function returns so the audit trail captures the deletion.
 *
 * Why this lives here: per-phase gate files are filename-keyed
 * (`GATE_<PHASE>_PASSED.json`) but task-AND-attempt-keyed at the
 * artifact-sha level. Bug 2 (M16 C9 follow-on, c262efd) closed the
 * cross-task case: after T-001 ships and T-002 BUILD writes a fresh
 * BUILD_REPORT.md, the prior gate's `artifactSha256` no longer matches.
 * Bug 6 (this commit, M16 C9 follow-on 4) closes the within-task
 * cross-attempt case: T-002 BUILD a1 → approve build → REVIEW r1
 * needs_revision → BUILD a2 overwrites BUILD_REPORT.md → approve build
 * a2 must not see a stale a1 gate. Same `gate_file_cleared` event-driven
 * supersedence in `validateRunIntegrity` (loadRun) handles both cases;
 * only the trigger criteria here change.
 *
 * Throws `NeedsInterventionReadError`-shaped errors only on truly
 * unexpected conditions (gate file present but unreadable / unparseable
 * JSON / no `artifactSha256` field) — these signal corruption rather
 * than the routine boundary case the helper is designed for.
 */
export async function clearStaleGateFile(
  input: ClearStaleGateFileInput,
): Promise<ClearStaleGateFileResult> {
  // Find the latest `task_completed` event in events.jsonl order. The
  // task-boundary fast paths (no task_completed / same task) only apply
  // when `currentAttempt` is omitted — under attempt-aware semantics,
  // an in-flight task with prior approved attempts is itself a stale-
  // gate trigger that must reach the started-event check below.
  let latestTaskCompletedTaskId: string | null = null
  for (const e of input.events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'task_completed') {
      latestTaskCompletedTaskId = e.taskId
    }
  }
  if (input.currentAttempt === undefined) {
    if (latestTaskCompletedTaskId === null) {
      // First task: no prior boundary to cross.
      return Object.freeze({ cleared: false })
    }
    if (latestTaskCompletedTaskId === input.currentTaskId) {
      // Same-task resume: the prior gate file IS this task's gate file.
      return Object.freeze({ cleared: false })
    }
  }

  // Resume guard: if a `<phase>_started` event already exists for the
  // current task (and, when provided, the current attempt), a prior
  // dispatcher invocation already ran runBuild / runVerify / runReview
  // for THIS attempt. The gate file (if any) is associated with this
  // attempt; a deletion here would race with whatever wrote the started
  // event. Trust that the prior dispatcher already cleared (or had
  // nothing to clear).
  //
  // M16 C9 follow-on 4 (Bug 6): the original guard fired on `taskId`
  // alone, treating any `build_started` for the current task as a
  // resume. That's wrong for fresh attempt N+1 (review needs-revision
  // restart, verify-fail restart) — the prior attempt's gate file is
  // genuinely stale and must be cleared before the new attempt writes
  // its artifact. Comparing on `(taskId, attempt)` lets the resume
  // guard fire only for true mid-attempt resumes.
  const startedEventType =
    input.phase === 'build'
      ? 'build_started'
      : input.phase === 'verify'
        ? 'verify_started'
        : 'review_started'
  const hasStartedForCurrentAttempt = input.events.some((e) => {
    if (!isKnownPhaseEvent(e)) return false
    if (e.type !== startedEventType) return false
    if (e.type === 'build_started' || e.type === 'verify_started' || e.type === 'review_started') {
      if (e.taskId !== input.currentTaskId) return false
      if (input.currentAttempt !== undefined && e.attempt !== input.currentAttempt) return false
      return true
    }
    return false
  })
  if (hasStartedForCurrentAttempt) {
    return Object.freeze({ cleared: false })
  }

  // Resolve the gate file path. The filename is canonical
  // (GATE_<PHASE>_PASSED.json); we inline the construction here rather
  // than importing `gateFilename` to keep this helper free of state-
  // module coupling beyond the schemas types.
  const gateFile = `GATE_${input.phase.toUpperCase()}_PASSED.json`
  const gatePath = join(input.runDir, gateFile)
  let raw: string
  try {
    raw = await readFile(gatePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ cleared: false })
    }
    throw err
  }

  // Parse just enough to extract `artifactSha256` for the audit event.
  // A malformed JSON here means the gate file was corrupted, not a
  // routine task-boundary state — surface to the caller.
  let priorArtifactSha256: string | undefined
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (typeof obj.artifactSha256 === 'string') {
      priorArtifactSha256 = obj.artifactSha256
    }
  } catch {
    // Treat as corruption: don't delete; let validateRunIntegrity
    // surface the actual error to the operator.
    return Object.freeze({ cleared: false })
  }
  if (priorArtifactSha256 === undefined) {
    // Gate without artifactSha256 — pre-sha runs (or schema drift).
    // Skip cleanup so the operator can inspect manually.
    return Object.freeze({ cleared: false })
  }

  // Delete idempotently — a concurrent unlink between the readFile
  // above and unlink here is harmless; the file would not exist for
  // the next `loadRun`, which is the goal.
  try {
    await unlink(gatePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  // Audit-event priorTaskId: when crossing a task boundary, this is
  // the prior task; when crossing an attempt boundary within the same
  // task (M16 C9 follow-on 4 — Bug 6), the gate file belongs to a
  // prior attempt of the SAME task, so priorTaskId IS currentTaskId.
  // Both cases populate the field with the meaningful prior owner.
  const priorTaskId = latestTaskCompletedTaskId ?? input.currentTaskId
  return Object.freeze({
    cleared: true,
    priorArtifactSha256,
    priorTaskId,
  })
}
