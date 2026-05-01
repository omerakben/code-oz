// Per-round atomic resume primitives for runReview (M9 commit 7).
//
// Three concerns live here, each scoped to a single (round, attempt-within-
// round) coordinate so commit 10's multi-round orchestrator can reuse them
// without re-deriving paths:
//
//   1. Path naming. Drafts are persisted under
//      `.code-oz/runs/<runId>/review-drafts/round-<N>-attempt-<M>.md`.
//      M is bounded {1, 2}: initial draft + at most one bounded repair.
//   2. Draft persistence. After every persona invocation (whether the
//      response parses or not) the raw text lands at the canonical path
//      via atomicWriteFile. CODEX_RESPONSE_M9.md decision 10 + kickoff
//      Decision 10 forbid silent-discard; if the run crashes between
//      the persona invocation and the canonical REVIEW.md write, the
//      draft is the only forensic evidence.
//   3. Resume-mismatch detection. On a fresh runReview() call for round N,
//      if a draft from a prior session is on disk but events.jsonl has no
//      `review_round_completed` for that (taskId, attempt, round), the
//      orchestrator must NOT replay — kickoff Decision 10 locks this as
//      `review_resume_mismatch` intervention. The operator inspects the
//      draft, decides whether the prior session's persona response is
//      trustworthy, and either clears the draft directory or hand-replays
//      the round.
//
// Cleanup-on-canonical-write: once REVIEW.md is atomically written for the
// round, the round's drafts have no remaining forensic value (the canonical
// artifact is the source of truth). cleanupDraftsForRound() unlinks them
// best-effort.

import { mkdir, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import type { LoggedEvent } from '../state/schemas.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'

// --- canonical paths -----------------------------------------------

/**
 * Directory holding ignored review drafts for the run. One sibling
 * directory per run; entries are named by (round, attempt-within-round).
 * Lives outside the artifact root so a `.code-oz/artifacts/REVIEW.md`
 * write is independent of draft cleanup.
 */
export function reviewDraftsDir(runDir: string): string {
  return join(runDir, 'review-drafts')
}

/** Per-round, per-attempt persona draft path. attempt ∈ {1, 2}: 1 is the
 *  initial draft, 2 is the bounded repair. */
export function reviewDraftPath(runDir: string, round: number, attempt: 1 | 2): string {
  return join(reviewDraftsDir(runDir), `round-${round}-attempt-${attempt}.md`)
}

// --- draft persistence ---------------------------------------------

/**
 * Atomic-write a persona draft to its canonical path. Creates the
 * `review-drafts/` directory on first call. Mirrors the discipline used
 * elsewhere (verify-mutation forensics, build patches): write to
 * temp + rename + dir fsync via atomicWriteFile so a partial draft never
 * lands on disk.
 *
 * Drafts are not validated here — the orchestrator's parser may have
 * rejected the response, but the raw text is what we want forensically.
 */
export async function persistReviewDraft(
  runDir: string,
  round: number,
  attempt: 1 | 2,
  text: string,
): Promise<string> {
  const dir = reviewDraftsDir(runDir)
  await mkdir(dir, { recursive: true })
  const path = reviewDraftPath(runDir, round, attempt)
  await atomicWriteFile(path, text)
  return path
}

/**
 * Remove a round's drafts after the canonical REVIEW.md has been written.
 * Best-effort: unlink failures are swallowed (the canonical artifact is
 * the source of truth; a stale draft file is harmless and will be
 * overwritten by the next round's persistence). Returns the count of
 * paths actually removed for telemetry.
 */
export async function cleanupReviewDraftsForRound(
  paths: readonly string[],
): Promise<number> {
  let removed = 0
  for (const p of paths) {
    try {
      await rm(p, { force: true })
      removed++
    } catch {
      // best-effort
    }
  }
  return removed
}

// --- resume-mismatch detection -------------------------------------

export interface ResumeProbeInput {
  readonly runDir: string
  readonly events: readonly LoggedEvent[]
  readonly taskId: string
  readonly attempt: number
  readonly round: number
  /** Optional path to the canonical REVIEW.md the orchestrator is about
   *  to check. M9 commit 13 fs#2: when a review_round_completed event
   *  is present for the active round, the probe verifies its
   *  reviewReportSha256 matches the on-disk artifact. Without this
   *  verification, an orphan event whose canonical artifact was
   *  overwritten or never written would falsely suppress the
   *  resume-mismatch signal. Pass undefined to skip the check (legacy
   *  callers / tests that don't have a canonical artifact path). */
  readonly reviewReportPath?: string
}

export interface ResumeProbeResult {
  /** True iff a partial draft from a prior session exists for the round
   *  WITHOUT a matching review_round_completed event, OR a matching
   *  event exists but its reviewReportSha256 does not match the
   *  on-disk REVIEW.md (M9 commit 13 fs#2). */
  readonly mismatched: boolean
  /** When mismatched, the path of the partial draft for the operator to
   *  inspect. Undefined when the round is fresh. */
  readonly draftPath?: string
  /** When mismatched due to sha disagreement, names the violation. */
  readonly reason?: 'no_completed_event' | 'sha_mismatch'
}

/**
 * Detects the resume-mismatch condition (kickoff Decision 10):
 *
 *   - A draft for round N exists on disk under
 *     `<runDir>/review-drafts/round-N-attempt-1.md`, AND
 *   - No `review_round_completed` event for `(taskId, attempt, round=N)`
 *     is present in `events`.
 *
 * Together these mean "a prior runReview crashed mid-round and left a
 * draft behind, but never published the canonical REVIEW.md or a
 * round-completed event". The orchestrator must surface
 * `review_resume_mismatch` intervention rather than re-invoking the
 * persona blindly — the prior session's response could be tainted
 * (truncated, rejected, etc.) and re-running could change the verdict.
 */
export async function probeReviewResume(input: ResumeProbeInput): Promise<ResumeProbeResult> {
  const draftPath = reviewDraftPath(input.runDir, input.round, 1)
  const draftText = await readIfExists(draftPath)
  if (draftText === null) {
    return { mismatched: false }
  }
  const known = input.events.filter(isKnownPhaseEvent)
  const completed = known.find(
    (e) =>
      e.type === 'review_round_completed' &&
      e.taskId === input.taskId &&
      e.attempt === input.attempt &&
      e.round === input.round,
  )
  if (completed === undefined) {
    return { mismatched: true, draftPath, reason: 'no_completed_event' }
  }
  // M9 commit 13 fs#2: verify the event's reviewReportSha256 matches
  // the on-disk canonical REVIEW.md. If not, the artifact was
  // overwritten or never written — treat as mismatch.
  if (input.reviewReportPath !== undefined) {
    const onDisk = await readIfExists(input.reviewReportPath)
    if (onDisk === null) {
      return { mismatched: true, draftPath, reason: 'sha_mismatch' }
    }
    const eventSha = (completed as { readonly reviewReportSha256?: unknown })
      .reviewReportSha256
    const onDiskSha = sha256Of(onDisk)
    if (typeof eventSha !== 'string' || eventSha !== onDiskSha) {
      return { mismatched: true, draftPath, reason: 'sha_mismatch' }
    }
  }
  return { mismatched: false }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
