// CLI exit code contract — pinned by Codex R0 Risk #8 closure for M16.
//
// The contract has exactly three values:
//
//   0  EXIT_OK            phase reached its gate-ready terminal state.
//   1  EXIT_INTERVENTION  phase ended without reaching gate-ready: an
//                         intervention was written, REVIEW returned
//                         needs_revision or blocked, VERIFY returned
//                         failed, etc. The run is recoverable (resume
//                         with the suggested fix) but `code-oz approve`
//                         would not pass.
//   2  EXIT_USAGE         CLI usage / config errors detected before
//                         dispatch (bad flag, missing manifest, malformed
//                         config). Never used for phase outcomes.
//
// Codex R0 flagged the load-bearing distinction the lean missed: a
// REVIEW round returning `needs_revision` is an EXPECTED outcome of the
// review-debate loop, not a failure. But it is NOT a successful gate-
// ready phase either — the next `code-oz approve` would refuse. Mapping
// it to 0 would let CI green-light a run that still has open findings.
// The fix is to collapse every non-gate-ready phase status onto 1 so
// shell scripts and CI guards behave uniformly.

/** Phase reached its gate-ready terminal state; awaiting `approve`. */
export const EXIT_OK = 0

/**
 * Phase ended without reaching gate-ready. Includes:
 *  - any phase returning `status: 'intervention'`
 *  - VERIFY returning `status: 'failed'` (tests or mutation gate failed)
 *  - REVIEW returning `status: 'needs_revision'` (carry-forward expected)
 *  - REVIEW returning `status: 'blocked'` (hit max rounds without ready)
 *
 * The run is recoverable; the operator inspects NEEDS_INTERVENTION (or
 * REVIEW.md) and either fixes-and-resumes or aborts.
 */
export const EXIT_INTERVENTION = 1

/** CLI usage / configuration error detected before any phase dispatch. */
export const EXIT_USAGE = 2

/**
 * The closed set of phase result statuses produced by the M5–M9 phase
 * functions (`runDefine`, `runPlan`, `runBuild`, `runVerify`, `runReview`).
 * Adding a new status here without updating `exitCodeForPhaseResult` is
 * a type error — the switch is exhaustive by design.
 */
export type PhaseResultStatus =
  | 'complete' // DEFINE / PLAN / BUILD: gate-ready
  | 'completed' // VERIFY: gate-ready (note the trailing -d, historical)
  | 'resolved' // REVIEW: gate-ready, verdict 'ready'
  | 'intervention' // any phase: NEEDS_INTERVENTION written
  | 'needs_revision' // REVIEW: round produced needs-revision verdict
  | 'blocked' // REVIEW: hit max rounds without convergence
  | 'failed' // VERIFY: tests or mutation gate failed

/**
 * Map a phase result onto the CLI exit code. Consumers (C6/C7/C8
 * dispatchers) call this at the boundary between phase function and
 * `process.exit` so the mapping lives in exactly one place.
 *
 * Three gate-ready statuses (`complete`, `completed`, `resolved`)
 * collapse to 0; everything else collapses to 1. Codex R0 Risk #8 lock.
 */
export function exitCodeForPhaseResult(result: {
  readonly status: PhaseResultStatus
}): typeof EXIT_OK | typeof EXIT_INTERVENTION {
  switch (result.status) {
    case 'complete':
    case 'completed':
    case 'resolved':
      return EXIT_OK
    case 'intervention':
    case 'needs_revision':
    case 'blocked':
    case 'failed':
      return EXIT_INTERVENTION
  }
}
