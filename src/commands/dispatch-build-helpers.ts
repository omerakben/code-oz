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

import { readFile } from 'node:fs/promises'
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
 *     consumes.
 *   - attempt > 1 with `build_completed` for `attempt-1` but neither a
 *     restart signal nor (the dispatcher's caller already checked for
 *     gate_required) → `{ kind: 'awaiting-approve' }` so the
 *     dispatcher can tell the operator to run `code-oz approve build`.
 *   - attempt > 1 with the restart signal but VERIFY.md is missing /
 *     malformed / mismatched → `{ kind: 'drift', reason }`.
 *
 * Source-aware: today we honor `source: 'verify-fail'`. When M9
 * review-needs-revision starts producing carry-forward (BuildReport
 * already supports the source field), this resolver is the place to
 * extend.
 */
export async function resolveBuildCarryForward(
  input: ResolveCarryForwardInput,
): Promise<ResolveCarryForwardResult> {
  if (input.attempt === 1) {
    return Object.freeze({ kind: 'none' as const })
  }

  const priorAttempt = input.attempt - 1

  // Find verify_restart_initiated for this (taskId, priorAttempt).
  let restartSignal:
    | Extract<LoggedEvent, { type: 'verify_restart_initiated' }>
    | undefined
  for (const e of input.events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'verify_restart_initiated') continue
    if (e.runId !== input.runId) continue
    const restart = e as Extract<LoggedEvent, { type: 'verify_restart_initiated' }>
    if (restart.taskId !== input.taskId) continue
    if (restart.attempt !== priorAttempt) continue
    if (restart.nextAction !== 'restart') continue
    if (restart.nextAttempt !== input.attempt) continue
    restartSignal = restart
    // Don't break — let later events overwrite earlier ones (last-wins).
  }

  if (restartSignal === undefined) {
    // Either there's a build_completed for priorAttempt without any
    // restart signal (awaiting-approve case) or there is no prior
    // BUILD record at all (drift — caller bumped attempt without a
    // completed prior attempt).
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
      reason: `attempt=${input.attempt} but no build_completed or verify_restart_initiated for (taskId=${input.taskId}, attempt=${priorAttempt})`,
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
