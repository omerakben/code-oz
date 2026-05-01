// REVIEW remediation coordinator.
//
// Decides what happens after a REVIEW round N exits with verdict
// `needs-revision`. NOT scheduleAttemptNPlus1 (kickoff Decision 1):
// scheduleAttemptNPlus1 is VERIFY-specific — it emits
// verify_restart_initiated + worktree_destroyed. REVIEW remediation
// emits a different shape because it crosses an authority boundary
// (REVIEW → BUILD attempt N+1, with VERIFY restart preserved as a
// VERIFY-owned cap and not double-counted).
//
// The two monotonic global counters scoped to (runId, taskId) per
// CODEX_RESPONSE_M9.md decision 4:
//
//   - reviewRoundsUsed: count of `review_round_completed` events for
//     (runId, taskId). REVIEW round N counts iff its canonical
//     REVIEW.md was atomically written. Cap = REVIEW_ROUND_CAP (4).
//
//   - buildAttemptsUsed: count of `build_completed` events for
//     (runId, taskId). Cap = BUILD_ATTEMPT_CAP (4 from
//     restart-policy.MAX_BUILD_ATTEMPTS).
//
// Whichever cap trips first owns the intervention. Authority overlap
// (decision 4): VERIFY-restart cap exhaustion *during* a REVIEW
// remediation BUILD attempt is VERIFY-owned with "while addressing
// REVIEW round N" context — REVIEW round count does NOT advance and
// `review_blocked` is NOT emitted.
//
// Ping-pong detection (decision 2): when REVIEW cap exhausts and a
// previously-resolved finding has been reopened, the intervention
// names the reopened finding ids explicitly. Reopened-id list comes
// from canonicalizeFindings's `reopenedIds` output; this module
// merely surfaces them.

import type { LoggedEvent } from '../state/schemas.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'
import {
  serializeReviewCarryForward,
  REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
  REVIEW_ROUND_CAP,
  type ReviewFinding,
} from '../artifacts/review-report.ts'
import type { BuildReportCarryForward } from '../artifacts/build-report.ts'
import { MAX_BUILD_ATTEMPTS } from './restart-policy.ts'

/** Locked at MAX_BUILD_ATTEMPTS (4) per restart-policy.ts. Re-exported
 *  so tests can import without pulling restart-policy.ts directly. */
export const BUILD_ATTEMPT_CAP = MAX_BUILD_ATTEMPTS

/** Locked at REVIEW_ROUND_CAP (4) per CLAUDE.md non-negotiable rule 6.
 *  Re-exported for the same reason. */
export { REVIEW_ROUND_CAP }

// --- decision input + output types --------------------------------

export interface ReviewRemediationInput {
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
  /** The REVIEW round that just exited with verdict `needs-revision`. */
  readonly priorRound: number
  /** The BUILD attempt that REVIEW just reviewed (= attempt that BUILD ran). */
  readonly priorAttempt: number
  /** Persona-canonicalized findings from the REVIEW.md just written. The
   *  coordinator selects the unresolved block / fix-first findings to
   *  synthesize summary + constraint for BUILD attempt N+1. */
  readonly priorFindings: readonly ReviewFinding[]
  /** Path of the canonical REVIEW.md just written. */
  readonly reviewReportPath: string
  /** sha256 of the canonical REVIEW.md just written. */
  readonly reviewReportSha256: string
  /** validationCommand from the BUILD_REPORT.md just reviewed; copied
   *  verbatim into the carry-forward block's priorValidationCommand. */
  readonly priorValidationCommand: string
  /** Findings reopened by the round just completed (from
   *  canonicalizeFindings.reopenedIds). Surfaced in the cap-exhausted
   *  intervention message per decision 2. */
  readonly reopenedIds: readonly string[]
}

export type ReviewRemediationDecision =
  | {
      readonly action: 'continue'
      /** BUILD attempt number to schedule next (= priorAttempt + 1). */
      readonly nextBuildAttempt: number
      /** Carry-forward block for BUILD attempt N+1 (Source: review-needs-revision). */
      readonly carryForward: BuildReportCarryForward
      /** REVIEW round number to drive after BUILD+VERIFY pass. */
      readonly nextReviewRound: number
    }
  | {
      readonly action: 'review_cap_exhausted'
      /** Human-readable reason; surfaces reopened ids when present. */
      readonly reason: string
      /** Reopened finding ids (subset of input.reopenedIds + any prior
       *  rounds' reopened findings derivable from priorFindings). */
      readonly reopenedIds: readonly string[]
    }
  | {
      readonly action: 'build_cap_blocked'
      readonly reason: string
      /** Always non-zero: indicates this is the BUILD-side cap, not REVIEW. */
      readonly buildAttemptsUsed: number
    }

// --- pure decision function ---------------------------------------

export function decideReviewRemediation(
  input: ReviewRemediationInput,
): ReviewRemediationDecision {
  const known = input.events.filter(isKnownPhaseEvent)

  // Tally completed REVIEW rounds for (runId, taskId).
  let reviewRoundsUsed = 0
  for (const e of known) {
    if (
      e.type === 'review_round_completed' &&
      e.runId === input.runId &&
      e.taskId === input.taskId
    ) {
      if (e.round > reviewRoundsUsed) reviewRoundsUsed = e.round
    }
  }
  // Tally completed BUILD attempts for (runId, taskId).
  let buildAttemptsUsed = 0
  for (const e of known) {
    if (
      e.type === 'build_completed' &&
      e.runId === input.runId &&
      e.taskId === input.taskId
    ) {
      if (e.attempt > buildAttemptsUsed) buildAttemptsUsed = e.attempt
    }
  }

  // REVIEW cap is the precedent: round 4 exiting needs-revision means the
  // 4-round cap is exhausted and REVIEW owns the intervention.
  if (reviewRoundsUsed >= REVIEW_ROUND_CAP) {
    const reopenedIds = collectReopenedIds(input)
    const ridSuffix =
      reopenedIds.length > 0
        ? ` (reopened: ${reopenedIds.join(', ')})`
        : ''
    return Object.freeze({
      action: 'review_cap_exhausted' as const,
      reason: `REVIEW round cap reached (${reviewRoundsUsed}/${REVIEW_ROUND_CAP}); no ready exit${ridSuffix}`,
      reopenedIds,
    })
  }

  // BUILD cap can trip independently when a prior chain exhausted clean
  // BUILD attempts (e.g., 4 attempts that all VERIFY-failed, but
  // simultaneously a REVIEW round is asking us to plan another). The
  // intervention is BUILD-owned with "while addressing REVIEW round N"
  // context per decision 4.
  if (buildAttemptsUsed >= BUILD_ATTEMPT_CAP) {
    return Object.freeze({
      action: 'build_cap_blocked' as const,
      reason: `BUILD attempt cap reached (${buildAttemptsUsed}/${BUILD_ATTEMPT_CAP}) while addressing REVIEW round ${input.priorRound}; VERIFY-owned intervention`,
      buildAttemptsUsed,
    })
  }

  // Continue path: synthesize summary + constraint from unresolved
  // findings, then build the typed carry-forward.
  const { summary, constraint } = synthesizeRemediationDirective(input.priorFindings)
  const carryForward = serializeReviewCarryForward({
    reviewReportPath: input.reviewReportPath,
    reviewReportSha256: input.reviewReportSha256,
    priorRound: input.priorRound,
    summary,
    constraint,
    priorAttempt: input.priorAttempt,
    priorValidationCommand: input.priorValidationCommand,
  })
  return Object.freeze({
    action: 'continue' as const,
    nextBuildAttempt: input.priorAttempt + 1,
    carryForward,
    nextReviewRound: input.priorRound + 1,
  })
}

/**
 * Synthesizes a bounded summary + constraint pair from a set
 * of findings. Selects unresolved block / fix-first findings (the ones
 * that gate ready), formats them into a compact summary listing ids
 * and a constraint joining recommendations. Both fields are clipped to
 * REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS per BUILD_REPORT.md grammar.
 *
 * The orchestrator owns this synthesis (kickoff Decision 6: timeline +
 * orchestrator-shaped fields belong to the orchestrator). The persona's
 * Recommendation text is the source of truth for what to fix; the
 * orchestrator concatenates and clips.
 */
export function synthesizeRemediationDirective(
  findings: readonly ReviewFinding[],
): { summary: string; constraint: string } {
  const blocking = findings.filter(
    (f) =>
      f.roundResolved === 'unresolved' &&
      (f.severity === 'block' || f.severity === 'fix-first'),
  )
  if (blocking.length === 0) {
    // Defensive path: needs-revision exit should have at least one
    // unresolved blocker OR score < 6. If no blockers, the persona's
    // score must have driven the verdict; surface that.
    return {
      summary: 'persona score < 6 with no unresolved block / fix-first findings',
      constraint: 'address feedback noted in REVIEW.md and re-submit',
    }
  }
  const ids = blocking.map((f) => f.id).join(', ')
  const summary = clip(
    `${blocking.length} unresolved finding(s): ${ids}; see REVIEW.md`,
    REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
  )
  const constraint = clip(
    blocking.map((f) => `${f.id}: ${f.recommendation}`).join('; '),
    REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS,
  )
  return { summary, constraint }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// --- ping-pong reopen tracking ------------------------------------

/**
 * Collects every id that has been reopened during the REVIEW loop. The
 * canonicalizeFindings output for the just-finished round names ids
 * reopened in *that* round; ids reopened in earlier rounds are inferred
 * from the findings shape (`roundRaised` < final-round AND
 * `roundResolved` is unresolved despite an earlier resolved-then-not
 * pattern). For the cap-exhausted intervention message, the union of
 * both sources is what's surfaced.
 *
 * v0.1 simplification: priorFindings carries the final state of every
 * id at cap-exhaust time. An id whose `roundRaised` is less than the
 * cap round AND whose `roundResolved` is `'unresolved'` AND whose
 * severity is block / fix-first counts as a "still-open issue at cap".
 * The ids passed via `input.reopenedIds` are guaranteed to belong here
 * (they reopen prior-resolved findings); we union them in.
 */
function collectReopenedIds(input: ReviewRemediationInput): readonly string[] {
  const reopened = new Set<string>(input.reopenedIds)
  for (const f of input.priorFindings) {
    if (
      f.roundResolved === 'unresolved' &&
      (f.severity === 'block' || f.severity === 'fix-first') &&
      f.roundRaised < input.priorRound
    ) {
      reopened.add(f.id)
    }
  }
  return Object.freeze([...reopened].sort())
}
