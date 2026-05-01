// Restart-on-fail policy for the VERIFY → BUILD attempt-N+1 loop.
//
// Per docs/contracts/VERIFY.md § "Restart-on-fail policy" + Codex M8
// decisions 2 (modification) + 6 (modification):
//
//   1. Attempts 1-4 are clean BUILD invocations against the same approved
//      PLAN. The cap covers BUILD attempts that produced a valid
//      BUILD_REPORT.md and were then VERIFIED with Verdict=fail.
//   2. Attempt 5 → NEEDS_INTERVENTION.json. The orchestrator does not
//      invoke a 5th BUILD.
//   3. Counter source-of-truth: max(build_completed.attempt) + 1, scoped
//      to the (runId, taskId) pair, derived from events.jsonl. NOT raw
//      count, NOT separate state file.
//   4. BUILD protocol failures, runner spawn failures, and
//      verify_build_ref_mismatch do NOT pass through this module.
//      They produce intervention directly per BUILD.md and VERIFY.md
//      contracts. Only VERIFY-fail with a validated VERIFY.md routes
//      through here.
//
// The VerifiedFailedAttempt type is the typed gate that enforces (4):
// callers can only construct one when they have parsed VERIFY.md and
// confirmed Verdict=fail with the persona-authored Failure summary +
// Constraint. BUILD-protocol failures cannot construct it because they
// have no VERIFY.md to read.

import type { LoggedEvent } from '../state/schemas.ts'
import type { BuildReportCarryForward } from '../artifacts/build-report.ts'

/** 4-attempt cap per VERIFY.md § Restart-on-fail policy step 4. */
export const MAX_BUILD_ATTEMPTS = 4

export interface DeriveAttemptInput {
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
}

/**
 * Returns the attempt number for the NEXT BUILD invocation, scoped to
 * the (runId, taskId) pair. Counts only `build_completed` events
 * (clean BUILD attempts that produced a valid BUILD_REPORT.md). Does
 * not count `build_started`, `build_failed`, or
 * `verify_build_ref_mismatch` per Codex M8 decision 2 modification.
 */
export function deriveNextAttempt(input: DeriveAttemptInput): number {
  let max = 0
  for (const e of input.events) {
    if (e.type !== 'build_completed') continue
    if (e.runId !== input.runId) continue
    const completed = e as Extract<LoggedEvent, { type: 'build_completed' }>
    if (completed.taskId !== input.taskId) continue
    if (completed.attempt > max) max = completed.attempt
  }
  return max + 1
}

/**
 * Typed input that gates restart-on-fail. Per Codex M8 decision 6
 * (modification): only events validated against VERIFY.md with
 * Verdict=fail produce a VerifiedFailedAttempt. BUILD protocol
 * failures, runner spawn failures, and verify_build_ref_mismatch
 * cannot construct this type — they go straight to
 * NEEDS_INTERVENTION.json without reaching the cap.
 *
 * Field-for-field this mirrors VERIFY.md § "Failure constraint"
 * grammar, plus the orchestrator-set `attempt` (the just-failed
 * attempt N) and `forensicsPath`.
 */
export interface VerifiedFailedAttempt {
  /** The just-failed attempt number (1..4 for restart, ≥4 → intervention). */
  readonly attempt: number
  readonly forensicsPath: string
  /** Verbatim from VERIFY.md § "Failure constraint" Validation command bullet. */
  readonly validationCommand: string
  /** Verbatim from VERIFY.md § "Failure constraint" Verdict bullet. */
  readonly verdict: string
  /** Persona-authored, ≤ 200 chars. */
  readonly failureSummary: string
  /** Persona-authored, ≤ 200 chars. The active directive for attempt N+1. */
  readonly constraint: string
}

/**
 * Maps a VerifiedFailedAttempt to the carry-forward block that BUILD
 * attempt N+1 will read (per VERIFY.md § "M8 → M7-restart handoff
 * seam"). The orchestrator does this rename mechanically; the persona
 * never sees both labels. `Constraint` stays unprefixed because it is
 * the active directive for the next attempt.
 */
export function prepareCarryForward(
  vfa: VerifiedFailedAttempt,
): BuildReportCarryForward {
  return Object.freeze({
    source: 'verify-fail' as const,
    priorAttempt: vfa.attempt,
    priorForensicsPath: vfa.forensicsPath,
    priorValidationCommand: vfa.validationCommand,
    priorVerdict: vfa.verdict,
    priorFailureSummary: vfa.failureSummary,
    constraint: vfa.constraint,
  })
}

export type RestartDecision =
  | {
      readonly action: 'restart'
      readonly nextAttempt: number
      readonly carryForward: BuildReportCarryForward
    }
  | {
      readonly action: 'intervention'
      readonly reason: string
      readonly attemptsExhausted: number
    }

export interface DecideRestartInput {
  readonly verifiedFailedAttempt: VerifiedFailedAttempt
  /** Defaults to MAX_BUILD_ATTEMPTS (4). Tests may override. */
  readonly maxAttempts?: number
}

/**
 * Cap-aware restart decision. When the just-failed attempt N has
 * reached or exceeded the cap, returns intervention (no N+1
 * scheduled, NEEDS_INTERVENTION.json should be written by the
 * caller). Otherwise returns restart with N+1 and the carry-forward
 * block.
 *
 * Per VERIFY.md § Restart-on-fail step 5: at attempt 4, the next
 * action is intervention (because attempt 5 is the cap line).
 */
export function decideRestart(input: DecideRestartInput): RestartDecision {
  const max = input.maxAttempts ?? MAX_BUILD_ATTEMPTS
  const failedAt = input.verifiedFailedAttempt.attempt
  if (failedAt >= max) {
    return Object.freeze({
      action: 'intervention',
      reason: `${max}-attempt cap reached; ${failedAt} clean BUILD attempts produced VERIFY=fail. Manual intervention required.`,
      attemptsExhausted: failedAt,
    })
  }
  return Object.freeze({
    action: 'restart',
    nextAttempt: failedAt + 1,
    carryForward: prepareCarryForward(input.verifiedFailedAttempt),
  })
}
