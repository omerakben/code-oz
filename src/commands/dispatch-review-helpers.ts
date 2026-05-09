// Helpers used by `dispatchReview` in src/commands/run.ts (M16 C8).
//
// Codex C8 pre-design review (5 block-push + 4 fix-soon + 1 nit) pinned
// these load-bearing concerns this module addresses:
//
//   1. `nextReviewRound` is persisted via a new `review_remediation_recorded`
//      event. `resolveNextReviewRound` reads the latest such event for the
//      current `(runId, taskId, attempt)` and returns the next round number
//      (1 when no prior remediation exists).
//   2. `resolveReviewArtifacts` re-validates BUILD_REPORT.md sha against the
//      latest `build_completed.buildReportSha256` and VERIFY.md sha against
//      `verify_completed.verifyReportSha256`. Operator hand-edits between
//      `approve verify` and `code-oz run` (REVIEW dispatch) would otherwise
//      silently run with edited bytes. This mirrors C7's verify-side
//      `resolveVerifyArtifacts` (Mod #3 in C7) transposed onto REVIEW's
//      upstream pair. The BUILD prompt snapshot is NOT re-validated here —
//      `runReview` does not consume it.
//
// Shared helpers (NEEDS_INTERVENTION read, plan loader, intervention
// formatter, build_completed lookup, verify_completed lookup) live in
// dispatch-build-helpers.ts and dispatch-verify-helpers.ts and are
// imported by the dispatcher; this module owns only the REVIEW-specific
// resolvers.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isKnownPhaseEvent, type LoggedEvent } from '../state/schemas.ts'

// --- review remediation event lookup ------------------------------

const SHA = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex')

export interface ReviewRemediationRecord {
  readonly reviewRound: number
  readonly nextReviewRound: number
  readonly reviewMdSha256: string
  readonly attempt: number
  readonly taskId: string
  readonly ts: string
}

/**
 * Returns the most recent `review_remediation_recorded` event for the
 * given `(runId, taskId, attempt)` or `null` when none exists. "Most
 * recent" is last-occurrence in event order (events.jsonl is append-
 * only); equal rounds keep last-wins.
 */
export function findLatestReviewRemediation(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): ReviewRemediationRecord | null {
  let latest: ReviewRemediationRecord | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'review_remediation_recorded') continue
    if (e.runId !== runId) continue
    const rec = e as Extract<LoggedEvent, { type: 'review_remediation_recorded' }>
    if (rec.taskId !== taskId) continue
    if (rec.attempt !== attempt) continue
    if (i > latestIndex) {
      latest = Object.freeze({
        reviewRound: rec.reviewRound,
        nextReviewRound: rec.nextReviewRound,
        reviewMdSha256: rec.reviewMdSha256,
        attempt: rec.attempt,
        taskId: rec.taskId,
        ts: rec.ts,
      })
      latestIndex = i
    }
  }
  return latest
}

/**
 * Resolve the REVIEW round number to drive next for a given
 * `(runId, taskId, attempt)`. Reads the latest
 * `review_remediation_recorded` event and returns its `nextReviewRound`,
 * or `1` when no prior remediation exists.
 *
 * Codex C8 Mod #1 — round resolution must read durably-persisted
 * remediation state, not re-derive from `priorRound + 1`. The
 * carry-forward chain involves a BUILD attempt N+1 + VERIFY pass between
 * REVIEW round N and REVIEW round N+1; without persistence the resumed
 * dispatch would have to re-run `decideReviewRemediation` against the
 * pre-restart REVIEW.md (and re-walk the canonical findings) every time.
 */
export function resolveNextReviewRound(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): number {
  const rec = findLatestReviewRemediation(events, runId, taskId, attempt)
  if (rec === null) return 1
  return rec.nextReviewRound
}

// --- build_completed + verify_completed shape --------------------

export interface BuildCompletedSlim {
  readonly attempt: number
  readonly buildReportSha256: string
  readonly promptSnapshotSha256: string
  readonly ts: string
}

export interface VerifyCompletedSlim {
  readonly attempt: number
  readonly verifyReportSha256: string
  readonly ts: string
}

/**
 * Returns the most recent `build_completed` event for `(runId, taskId)`,
 * or `null`. Mirrors `findLatestBuildCompleted` in dispatch-verify-helpers
 * but returns the slim shape `dispatchReview` needs.
 */
export function findLatestBuildCompletedForReview(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): BuildCompletedSlim | null {
  let latest: BuildCompletedSlim | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'build_completed') continue
    if (e.runId !== runId) continue
    const completed = e as Extract<LoggedEvent, { type: 'build_completed' }>
    if (completed.taskId !== taskId) continue
    if (i > latestIndex) {
      latest = Object.freeze({
        attempt: completed.attempt,
        buildReportSha256: completed.buildReportSha256,
        promptSnapshotSha256: completed.promptSnapshotSha256,
        ts: completed.ts,
      })
      latestIndex = i
    }
  }
  return latest
}

/**
 * Returns the most recent `verify_completed` event for `(runId, taskId)`
 * with the verify report sha included, or `null`. The `findLatestVerifyCompleted`
 * helper in dispatch-verify-helpers strips the sha; REVIEW needs it for
 * sha re-validation, so this variant carries it.
 */
export function findLatestVerifyCompletedForReview(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
): VerifyCompletedSlim | null {
  let latest: VerifyCompletedSlim | null = null
  let latestIndex = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'verify_completed') continue
    if (e.runId !== runId) continue
    const completed = e as Extract<LoggedEvent, { type: 'verify_completed' }>
    if (completed.taskId !== taskId) continue
    if (i > latestIndex) {
      latest = Object.freeze({
        attempt: completed.attempt,
        verifyReportSha256: completed.verifyReportSha256,
        ts: completed.ts,
      })
      latestIndex = i
    }
  }
  return latest
}

// --- artifact resolution + sha re-validation ----------------------

export interface ReviewArtifactBytes {
  readonly buildReportText: string
  readonly buildReportSha256: string
  readonly verifyReportText: string
  readonly verifyReportSha256: string
  readonly attempt: number
  readonly taskId: string
}

export type ResolveReviewArtifactsResult =
  | { readonly kind: 'ok'; readonly artifacts: ReviewArtifactBytes }
  | { readonly kind: 'drift'; readonly reason: string }

export interface ResolveReviewArtifactsInput {
  readonly events: readonly LoggedEvent[]
  readonly runId: string
  readonly taskId: string
  readonly artifactRoot: string
}

/**
 * Read REVIEW's upstream artifacts (BUILD_REPORT.md + VERIFY.md) and
 * re-validate every sha against the most recent `build_completed` /
 * `verify_completed` events. On any mismatch, missing file, or absent
 * upstream event, returns `kind: 'drift'` with a specific reason — the
 * dispatcher refuses with EXIT_INTERVENTION before invoking runReview.
 *
 * Codex C8 Mod #3 — preApproveBuildHook + preApproveVerifyHook validate
 * upstream shas at approve time, but operator hand-edits between
 * `approve verify` and `code-oz run` (REVIEW dispatch) would silently
 * run with edited bytes. The BUILD prompt snapshot is NOT re-validated
 * here — `runReview` does not consume it.
 *
 * Both upstream events must be present: BUILD without VERIFY means the
 * cursor advanced into REVIEW prematurely; VERIFY without BUILD is
 * impossible by the event ordering contract but checked defensively.
 */
export async function resolveReviewArtifacts(
  input: ResolveReviewArtifactsInput,
): Promise<ResolveReviewArtifactsResult> {
  const buildCompleted = findLatestBuildCompletedForReview(
    input.events, input.runId, input.taskId,
  )
  if (buildCompleted === null) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `no build_completed event for (runId=${input.runId}, taskId=${input.taskId})`,
    })
  }
  const verifyCompleted = findLatestVerifyCompletedForReview(
    input.events, input.runId, input.taskId,
  )
  if (verifyCompleted === null) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `no verify_completed event for (runId=${input.runId}, taskId=${input.taskId})`,
    })
  }
  // The cursor's pending task should have build_completed.attempt ===
  // verify_completed.attempt at the point REVIEW dispatches. A mismatch
  // means the carry-forward / restart loop is mid-flight (BUILD has
  // landed for attempt N+1 but VERIFY has not yet).
  if (buildCompleted.attempt !== verifyCompleted.attempt) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `build_completed.attempt=${buildCompleted.attempt} disagrees with verify_completed.attempt=${verifyCompleted.attempt}; restart loop mid-flight`,
    })
  }
  const attempt = buildCompleted.attempt

  // 1. BUILD_REPORT.md
  const buildReportPath = join(input.artifactRoot, 'BUILD_REPORT.md')
  let buildReportText: string
  try {
    buildReportText = await readFile(buildReportPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `BUILD_REPORT.md not found at ${buildReportPath}`,
      })
    }
    throw err
  }
  const buildReportSha256 = SHA(buildReportText)
  if (buildReportSha256 !== buildCompleted.buildReportSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `BUILD_REPORT.md sha ${buildReportSha256.slice(0, 8)}… does not match build_completed.buildReportSha256 ${buildCompleted.buildReportSha256.slice(0, 8)}… (post-edit detected)`,
    })
  }

  // 2. VERIFY.md
  const verifyReportPath = join(input.artifactRoot, 'VERIFY.md')
  let verifyReportText: string
  try {
    verifyReportText = await readFile(verifyReportPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        kind: 'drift' as const,
        reason: `VERIFY.md not found at ${verifyReportPath}`,
      })
    }
    throw err
  }
  const verifyReportSha256 = SHA(verifyReportText)
  if (verifyReportSha256 !== verifyCompleted.verifyReportSha256) {
    return Object.freeze({
      kind: 'drift' as const,
      reason: `VERIFY.md sha ${verifyReportSha256.slice(0, 8)}… does not match verify_completed.verifyReportSha256 ${verifyCompleted.verifyReportSha256.slice(0, 8)}… (post-edit detected)`,
    })
  }

  return Object.freeze({
    kind: 'ok' as const,
    artifacts: Object.freeze({
      buildReportText,
      buildReportSha256,
      verifyReportText,
      verifyReportSha256,
      attempt,
      taskId: input.taskId,
    }),
  })
}

// --- prior REVIEW.md loader ---------------------------------------

/**
 * Read the canonical REVIEW.md at `<artifactRoot>/REVIEW.md` for
 * round > 1 invocations. Returns `null` when the file does not exist
 * (round 1 — runReview validates `priorReviewMd === null` for round 1).
 * Throws on any other read error.
 */
export async function readPriorReviewMd(
  artifactRoot: string,
): Promise<string | null> {
  const reviewPath = join(artifactRoot, 'REVIEW.md')
  try {
    return await readFile(reviewPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// --- scheduler one-liner detection --------------------------------

export interface SchedulerFireSummary {
  readonly opposingProvider: string
  readonly verdict: 'accept' | 'accept-with-modifications' | 'reject' | 'feature-with-modifications' | 'unknown'
  readonly actionableFindingsAddedCount: number
}

/**
 * Inspect the slice of events appended during `runReview`'s execution
 * and return a summary if the scheduler fired a debate for this round.
 * Reads two events: the `debate_scheduler_fired` event (for the
 * opposing provider) and the `debate_scheduler_postreview` event (for
 * the post-debate actionable-findings count). Joins them by `decisionId`.
 *
 * Returns `null` when no scheduler fire happened (the common case —
 * scheduler may evaluate but skip, or auto-mode may be off entirely).
 *
 * The verdict comes from the post-debate `debate_resolved` event's
 * `callerVerdict` if present in the slice; falls back to `'unknown'`
 * when the debate executor recorded `findingsAddedCount` but the
 * resolver event is unreachable in this slice (degraded fire path).
 *
 * Codex C8 Mod #8 — events.jsonl is the canonical replay surface; the
 * scheduler one-liner reads from it without introducing a parallel
 * `ReviewResult` field.
 */
export function detectSchedulerFireOneLine(
  newEvents: readonly LoggedEvent[],
  filter: {
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly reviewRound: number
  },
): SchedulerFireSummary | null {
  let firedDecisionId: string | null = null
  let opposingProvider: string | null = null
  for (const e of newEvents) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'debate_scheduler_fired') continue
    if (e.runId !== filter.runId) continue
    if (e.taskId !== filter.taskId) continue
    if (e.attempt !== filter.attempt) continue
    if (e.reviewRound !== filter.reviewRound) continue
    firedDecisionId = e.decisionId
    opposingProvider = e.opposingProvider
    // Don't break — last fire wins if multiple (defensive; same-round
    // re-fires aren't expected by M15 contract).
  }
  if (firedDecisionId === null || opposingProvider === null) return null

  let actionableFindingsAddedCount = 0
  for (const e of newEvents) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'debate_scheduler_postreview') continue
    if (e.decisionId !== firedDecisionId) continue
    actionableFindingsAddedCount = e.actionableFindingsAddedCount
  }

  // Pick up the caller verdict from debate_resolved if it shares the
  // same opposing-provider context. The scheduler postreview event
  // doesn't carry the verdict directly — it carries verdictPre/verdictPost
  // which are the REVIEW-side verdicts. The debate verdict is on
  // debate_resolved (M10). Match by topic where possible, but the slice
  // is narrow enough that the latest debate_resolved is reliable.
  let verdict: SchedulerFireSummary['verdict'] = 'unknown'
  for (const e of newEvents) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'debate_resolved') continue
    if (e.runId !== filter.runId) continue
    verdict = e.callerVerdict
  }

  return Object.freeze({
    opposingProvider,
    verdict,
    actionableFindingsAddedCount,
  })
}
