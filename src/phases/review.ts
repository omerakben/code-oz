// REVIEW phase orchestration.
//
// Mirrors src/phases/verify.ts ordering:
//
//   1. Read BUILD_REPORT.md (changed-file manifest + base/patch refs)
//   2. Read VERIFY.md (verdict.verdict must be 'pass' to enter REVIEW)
//   3. Read prior REVIEW.md when round > 1
//   4. Cross-family invocation-time check: events.jsonl latest
//      build_provider_recorded.family vs familyOf(reviewerAgent.provider).
//      Equal → intervention 'review_cross_family_violation'.
//   5. Compose review prompt with rendered REVIEW_CONTEXT block
//   6. Emit review_started (cross-family pair recorded)
//   7. Invoke persona for the SMALL structured response (Findings + Score).
//      Two drafts max: initial + at most one bounded repair prompt
//      (renderRepairPrompt from review-report.ts; ≤5 clipped offending
//      lines; full failed drafts NEVER appended).
//   8. Persist rejected drafts to .code-oz/runs/<runId>/review-drafts/
//      round-N-attempt-M.md per kickoff Decision 10.
//   9. Canonicalize findings (canonicalizeFindings; fingerprint reuse +
//      ping-pong reopen)
//  10. Compute orchestrator-owned verdict (computeCanonicalVerdict)
//  11. Assemble ReviewReportData (round timeline = prior + this round's
//      bullet; cap status from round number)
//  12. Round-trip serializeReviewReport → parseReviewReport (with the
//      changed-file manifest) for grammar lock-in
//  13. Atomic write REVIEW.md
//  14. Emit review_round_completed
//  15. Branch on canonical verdict:
//        ready          → review_resolved (sha256 + finalScore + finalRound),
//                         run Scientist phase-tail, requireGate('review'),
//                         return { status: 'resolved' }.
//        needs-revision → run the REVIEW remediation coordinator and either
//                         return carry-forward for BUILD attempt N+1 or surface
//                         the owning cap intervention. This orchestrator must
//                         NOT call scheduleAttemptNPlus1 (that function is
//                         VERIFY-specific, kickoff Decision 1).
//        block          → review_blocked (reason='block') + NEEDS_INTERVENTION
//                         'review_block_terminal' + Scientist phase-tail,
//                         return { status: 'blocked' }.
//
// Resume mismatch detection (kickoff Decision 10): if a partial draft
// from a prior session exists under .code-oz/runs/<runId>/review-drafts/
// AND its sha does not match a recorded review_round_completed event for
// the same round, runReview refuses to replay — surfaces
// 'review_resume_mismatch' intervention. The orchestrator does not auto-
// continue from a draft; the operator must inspect and clear the draft
// dir.
//
// Worktree cleanup is NOT runReview's job. The cleanup-on-REVIEW-approve
// hook (preApproveReviewHook) removes the worktree when the
// operator runs `code-oz approve review`. runReview keeps the worktree
// alive so REVIEW and any remediating BUILD attempt N+1
// can read changed files.
//
// Tested in tests/review-phase.test.ts.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { runPaths as worktreePathsFor } from '../worktree/paths.ts'
import {
  cleanupReviewDraftsForRound,
  persistReviewDraft,
  probeReviewResume,
  reviewDraftPath,
} from './review-resume.ts'
import {
  parseBuildReport,
  BuildReportLoadError,
} from '../artifacts/build-report.ts'
import type { ManifestEntry } from '../worktree/manifest.ts'
import {
  parseVerifyReport,
  VerifyReportLoadError,
} from '../artifacts/verify-report.ts'
import {
  parseReviewReport,
  serializeReviewReport,
  canonicalizeFindings,
  computeCanonicalVerdict,
  fingerprintFinding,
  renderRepairPrompt,
  ReviewReportLoadError,
  REVIEW_REPAIR_OFFENDING_LINES_MAX,
  REVIEW_ROUND_CAP,
  REVIEW_SCORE_MIN,
  REVIEW_SCORE_MAX,
  REVIEW_SEVERITIES,
  REVIEW_TITLE_MAX_CHARS,
  REVIEW_RECOMMENDATION_MAX_CHARS,
  isReviewSeverity,
  type ReviewFinding,
  type ReviewReportData,
  type ReviewSeverity,
  type ReviewVerdict,
  type ReviewTimelineEntry,
} from '../artifacts/review-report.ts'
import { composeReviewPrompt } from '../prompts/index.ts'
import { runScientistPhaseTail } from './scientist.ts'
import { validateScientistSidecars } from './gate-preflight.ts'
import {
  decideReviewRemediation,
  type ReviewRemediationDecision,
} from './review-remediation.ts'
import type { BuildReportCarryForward } from '../artifacts/build-report.ts'
import {
  runReviewPanel,
  shouldUseReviewPanel,
  type PanelistInvoker,
  type RunReviewPanelResult,
} from './review-panel.ts'
import {
  parseReviewPanelReport,
  detectReviewReportMode,
  type ReviewReportPanelData,
} from '../artifacts/review-report.ts'
import { estimateTokens } from '../providers/cost.ts'
import type { ProviderFamily } from '../providers/types.ts'
import { stat as fsStat } from 'node:fs/promises'
import {
  appendEvent,
  readEvents,
  type EventLogPaths,
} from '../state/events.ts'
import type { LoggedEvent } from '../state/schemas.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import { LockBusyError, withLock } from '../state/lock.ts'
import { isKnownPhaseEvent } from '../state/schemas.ts'

// --- public constants ---------------------------------------------

export const REVIEW_READY_SIGNAL = '<review-ready/>'

// --- public types --------------------------------------------------

export interface RunReviewOptions {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly cwd: string
  readonly reviewerAgent: AgentDefinition
  readonly scientistAgent: AgentDefinition
  readonly taskId: string
  readonly invokeCtx: InvokeContext
  /**
   * Persona-response shim. Returns the persona's raw draft text. Called up
   * to twice: initial draft + at most one repair (Codex M9 decision 9).
   * The composed prompt embeds the full {{REVIEW_CONTEXT}} block so the
   * persona's Findings + Score can be evidence-grounded.
   */
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  /**
   * Panel-mode invocation seam (Codex M14 R1 finding #1). When
   * `invokeCtx.config.company.reviewer.panel` declares two or more
   * panelists, runReview dispatches to runReviewPanel and uses this
   * callback to invoke each panelist. Required iff panel mode is
   * configured; ignored otherwise. Production callers wire this to
   * invokeAgent in the CLI bootstrap layer; tests inject deterministic
   * fakes (matching the contract used by tests/review-panel-orchestrator).
   */
  readonly panelistInvoker?: PanelistInvoker
  readonly now?: () => string
  /** REVIEW round being driven. Validated against REVIEW_ROUND_CAP. */
  readonly round: number
  /** Prior canonical REVIEW.md content when round > 1. `null` for round 1. */
  readonly priorReviewMd?: string | null
}

export type ReviewStatus = 'resolved' | 'needs_revision' | 'blocked' | 'intervention'

export interface ReviewResolved {
  readonly status: 'resolved'
  readonly reviewReportPath: string
  readonly reviewReportSha256: string
  readonly verdict: 'ready'
  readonly score: number
  readonly findings: readonly ReviewFinding[]
  readonly round: number
}

export interface ReviewNeedsRevision {
  readonly status: 'needs_revision'
  readonly reviewReportPath: string
  readonly reviewReportSha256: string
  readonly verdict: 'needs-revision'
  readonly score: number
  readonly findings: readonly ReviewFinding[]
  readonly round: number
  /** Remediation decision from review-remediation.ts.
   *  When `action === 'continue'`, the caller schedules BUILD attempt
   *  N+1 with `carryForward` and then drives REVIEW round
   *  `nextReviewRound`. */
  readonly remediation: ReviewRemediationDecision
  /** Convenience accessor: present iff `remediation.action === 'continue'`. */
  readonly carryForward?: BuildReportCarryForward
}

export interface ReviewBlocked {
  readonly status: 'blocked'
  readonly reviewReportPath: string
  readonly reviewReportSha256: string
  readonly verdict: 'block'
  readonly score: number
  readonly findings: readonly ReviewFinding[]
  readonly round: number
}

export interface ReviewIntervention {
  readonly status: 'intervention'
  readonly code: string
  readonly rule: string
  readonly draftPath?: string
}

export type ReviewResult =
  | ReviewResolved
  | ReviewNeedsRevision
  | ReviewBlocked
  | ReviewIntervention

// --- helpers -------------------------------------------------------

const SHA = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const INTERVENTION_DETAIL_MAX_CHARS = 200
const FILE_READ_DETAIL_MAX_CHARS = 100

interface LoadIssueSummary {
  readonly code: string
  readonly rule: string
}

function clipDetail(text: string, max = INTERVENTION_DETAIL_MAX_CHARS): string {
  return text.slice(0, max)
}

function errorDetail(err: unknown, max = INTERVENTION_DETAIL_MAX_CHARS): string {
  return clipDetail(err instanceof Error ? err.message : String(err), max)
}

function loadIssuesDetail(issues: readonly LoadIssueSummary[]): string {
  return clipDetail(issues.map((i) => `${i.code}: ${i.rule}`).join('; '))
}

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function gatePathsFor(paths: RunPaths): GatePaths {
  return {
    runDir: paths.runDir,
    artifactRoot: paths.artifactRoot,
    lockDir: paths.lockDir,
  }
}

interface InterventionContext {
  readonly runPaths: RunPaths
  readonly runId: string
  readonly agent: string
  readonly taskId: string
  readonly attempt: number
  readonly now: () => string
}

async function recordReviewIntervention(
  ctx: InterventionContext,
  code: string,
  rule: string,
  detail?: string,
  draftPath?: string,
): Promise<ReviewIntervention> {
  const eventPaths = eventPathsFor(ctx.runPaths)
  const gatePaths = gatePathsFor(ctx.runPaths)
  await writeNeedsInterventionGate(gatePaths, {
    version: 1,
    runId: ctx.runId,
    phase: 'review',
    agent: ctx.agent,
    code,
    rule,
    detail,
    actionableSuggestions: actionableSuggestionsFor(code),
    createdAt: ctx.now(),
  })
  await appendEvent(eventPaths, {
    version: 1,
    type: 'intervention',
    ts: ctx.now(),
    runId: ctx.runId,
    phase: 'review',
    code,
  })
  return Object.freeze({
    status: 'intervention' as const,
    code,
    rule,
    ...(draftPath !== undefined ? { draftPath } : {}),
  })
}

function actionableSuggestionsFor(code: string): readonly string[] {
  switch (code) {
    case 'review_build_report_missing':
      return Object.freeze([
        'Confirm BUILD completed and BUILD_REPORT.md was atomically written.',
        'Inspect events.jsonl for build_completed; if absent, BUILD failed prior to writing the report.',
      ])
    case 'review_build_report_invalid':
      return Object.freeze([
        'BUILD_REPORT.md failed to parse. Inspect the artifact for hand-edits or partial writes.',
      ])
    case 'review_verify_report_missing':
      return Object.freeze([
        'Confirm VERIFY completed and VERIFY.md was atomically written.',
        'REVIEW only runs after VERIFY pass; inspect events.jsonl for verify_completed.',
      ])
    case 'review_verify_report_invalid':
      return Object.freeze([
        'VERIFY.md failed to parse. Inspect the artifact for hand-edits or partial writes.',
      ])
    case 'review_verify_not_passed':
      return Object.freeze([
        'VERIFY.md verdict is not pass. REVIEW must not run on a failed VERIFY.',
        'Inspect VERIFY.md verdict + Failure constraint and either fix or schedule attempt N+1.',
      ])
    case 'review_build_ref_mismatch':
      return Object.freeze([
        'BUILD_REPORT.md and VERIFY.md taskId/attempt do not agree.',
        'This is a routing bug; do not retry without correcting the orchestrator state.',
      ])
    case 'review_upstream_mismatch':
      return Object.freeze([
        'BUILD_REPORT.md and VERIFY.md upstream refs (baseCommitSha or patchSha256) disagree.',
        'VERIFY likely passed for a different patch than the one BUILD recorded; reject and re-run BUILD + VERIFY.',
      ])
    case 'review_no_build_provider':
      return Object.freeze([
        'No build_provider_recorded event for this (runId, taskId, attempt).',
        'BUILD must complete and emit build_provider_recorded before REVIEW can run.',
      ])
    case 'review_cross_family_violation':
      return Object.freeze([
        'BUILD provider family equals reviewer provider family — cross-family invariant violated at runtime.',
        'Inspect agent config: the reviewer and the BUILD agent that produced the artifact must be different families.',
      ])
    case 'review_persona_invoke_failed':
      return Object.freeze(['The reviewer persona invocation threw. Inspect provider logs.'])
    case 'review_persona_missing_ready_signal':
      return Object.freeze([
        `The reviewer persona did not emit ${REVIEW_READY_SIGNAL}. Confirm the persona prompt is correct.`,
      ])
    case 'review_validation_failed':
      return Object.freeze([
        'Persona response failed grammar validation after the repair turn.',
        'Inspect the persisted draft under .code-oz/runs/<runId>/review-drafts/.',
      ])
    case 'review_finding_path_unknown':
      return Object.freeze([
        'A finding cited a file path that is not in BUILD_REPORT.md Changed files.',
        'Persona may not raise findings against unmodified files in v0.1.',
      ])
    case 'review_finding_path_deleted':
      return Object.freeze([
        'A finding cited a deleted-file path; deleted-file findings are rejected in M9.',
        'No locked convention for deleted-file review yet — manual remediation required.',
      ])
    case 'review_finding_line_out_of_range':
      return Object.freeze([
        'A finding cited a line / range that is outside the current file in the run worktree.',
        'Inspect REVIEW.md and verify the cited line numbers against the actual file content.',
      ])
    case 'review_finding_file_unreadable':
      return Object.freeze([
        'A cited finding file is not readable under the run worktree.',
        'Check the worktree state and the manifest entry; the file may have been removed manually.',
      ])
    case 'review_round_out_of_range':
      return Object.freeze([
        `Round number must be an integer in [1, ${REVIEW_ROUND_CAP}] (CLAUDE.md non-negotiable rule 6).`,
      ])
    case 'review_resume_mismatch':
      return Object.freeze([
        'A partial draft exists from a prior session but no matching review_round_completed event.',
        'Inspect .code-oz/runs/<runId>/review-drafts/ and clear it before retrying, or restart the round.',
      ])
    case 'review_scientist_tail_failed':
      return Object.freeze([
        'The Scientist phase-tail produced an intervention. Inspect HYPOTHESES.md / OPEN_QUESTIONS.md drafts.',
      ])
    case 'review_block_terminal':
      return Object.freeze([
        'Reviewer issued a block-severity finding (verdict=block); REVIEW loop terminated.',
        'Inspect REVIEW.md Findings + Recommendation; remediate manually or restart with a corrected PLAN.',
      ])
    case 'review_cap_exhausted_terminal':
      return Object.freeze([
        `REVIEW round cap reached (${REVIEW_ROUND_CAP}/${REVIEW_ROUND_CAP}) without a ready exit.`,
        'Inspect REVIEW.md Round timeline + Findings; remediate manually or restart with a corrected PLAN.',
      ])
    case 'review_build_cap_overlap':
      return Object.freeze([
        'BUILD attempt cap reached during a REVIEW remediation chain; VERIFY-owned intervention.',
        'Inspect attempt forensics under .code-oz/runs/<runId>/forensics/ and the latest BUILD_REPORT.md.',
        'Reset by starting a new run with a corrected PLAN; do not re-run REVIEW on the same chain.',
      ])
    case 'review_already_in_flight':
      return Object.freeze([
        'Another runReview is in progress for this run (.review.lock present).',
        'Wait for it to complete; if it crashed, inspect and remove .code-oz/runs/<runId>/.review.lock manually.',
      ])
    default:
      return Object.freeze(['Inspect REVIEW.md, events.jsonl, and the relevant draft directory.'])
  }
}

// --- main entry point ---------------------------------------------

/**
 * Mkdir-as-mutex over the runReview orchestration. Two concurrent
 * runReview calls for the same (runId, round) would otherwise both
 * pass the resume probe (no draft yet), both invoke the persona, both
 * write REVIEW.md (last-writer-wins via atomic rename), and both
 * append review_round_completed with different scores + shas. The
 * sha-mismatch probe surfaces the divergence later, but only after
 * both sessions complete.
 *
 * The lock is a SEPARATE dir from runPaths.lockDir (which serializes
 * appendEvent / writeGate). runReview's lock is held for the duration
 * of the persona invocation (seconds to minutes); holding the per-run
 * lock that long would block other event-log writes (status reads,
 * concurrent worktree-destroyed events, etc.). Using a dedicated
 * `<runDir>/.review.lock/` keeps writers unblocked while still
 * serializing review orchestration for the run.
 */
export async function runReview(opts: RunReviewOptions): Promise<ReviewResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  // Bound the round number up-front. The reviewer agent's review_request
  // permissions cap maxRounds at REVIEW_ROUND_CAP at load time; this is a
  // belt-and-suspenders runtime check that catches an orchestrator bug.
  if (
    !Number.isInteger(opts.round) ||
    opts.round < 1 ||
    opts.round > REVIEW_ROUND_CAP
  ) {
    return Object.freeze({
      status: 'intervention' as const,
      code: 'review_round_out_of_range',
      rule: `RunReviewOptions.round must be an integer in [1, ${REVIEW_ROUND_CAP}], got ${opts.round}`,
    })
  }

  // Acquire the review-orchestration mutex. If another runReview holds
  // it (concurrent invocation for the same run), surface
  // review_already_in_flight rather than racing.
  const reviewLockDir = join(opts.runPaths.runDir, '.review.lock')
  try {
    return await withLock(reviewLockDir, async () => runReviewInner(opts, now))
  } catch (err) {
    if (err instanceof LockBusyError) {
      return Object.freeze({
        status: 'intervention' as const,
        code: 'review_already_in_flight',
        rule: `another runReview is in progress for run ${opts.runId} (lock at ${reviewLockDir})`,
      })
    }
    throw err
  }
}

async function runReviewInner(
  opts: RunReviewOptions,
  now: () => string,
): Promise<ReviewResult> {
  const interventionCtx: InterventionContext = {
    runPaths: opts.runPaths,
    runId: opts.runId,
    agent: opts.reviewerAgent.name,
    taskId: opts.taskId,
    attempt: 0, // resolved below from build_provider_recorded
    now,
  }

  // 1. Read BUILD_REPORT.md (orchestrator-owned upstream ref).
  const buildReportPath = join(opts.runPaths.artifactRoot, 'BUILD_REPORT.md')
  let buildReportText: string
  try {
    buildReportText = await readFile(buildReportPath, 'utf8')
  } catch (err) {
    return recordReviewIntervention(
      interventionCtx,
      'review_build_report_missing',
      `BUILD_REPORT.md not readable: ${errorDetail(err)}`,
    )
  }
  const buildReportSha256 = SHA(buildReportText)
  let buildReport: ReturnType<typeof parseBuildReport>
  try {
    buildReport = parseBuildReport(buildReportText)
  } catch (err) {
    const reason =
      err instanceof BuildReportLoadError
        ? loadIssuesDetail(err.issues)
        : errorDetail(err)
    return recordReviewIntervention(interventionCtx, 'review_build_report_invalid', reason)
  }
  if (buildReport.task.taskId !== opts.taskId) {
    return recordReviewIntervention(
      interventionCtx,
      'review_build_ref_mismatch',
      `BUILD_REPORT.md taskId=${buildReport.task.taskId} != opts.taskId=${opts.taskId}`,
    )
  }
  const attempt = buildReport.task.attempt
  // refresh interventionCtx with the resolved attempt for subsequent calls
  const ictx: InterventionContext = { ...interventionCtx, attempt }

  // 2. Read VERIFY.md and confirm verdict=pass.
  const verifyReportPath = join(opts.runPaths.artifactRoot, 'VERIFY.md')
  let verifyReportText: string
  try {
    verifyReportText = await readFile(verifyReportPath, 'utf8')
  } catch (err) {
    return recordReviewIntervention(
      ictx,
      'review_verify_report_missing',
      `VERIFY.md not readable: ${errorDetail(err)}`,
    )
  }
  const verifyReportSha256 = SHA(verifyReportText)
  let verifyReport: ReturnType<typeof parseVerifyReport>
  try {
    verifyReport = parseVerifyReport(verifyReportText)
  } catch (err) {
    const reason =
      err instanceof VerifyReportLoadError
        ? loadIssuesDetail(err.issues)
        : errorDetail(err)
    return recordReviewIntervention(ictx, 'review_verify_report_invalid', reason)
  }
  if (
    verifyReport.buildRef.taskId !== opts.taskId ||
    verifyReport.buildRef.attempt !== attempt
  ) {
    return recordReviewIntervention(
      ictx,
      'review_build_ref_mismatch',
      `VERIFY.md buildRef=(${verifyReport.buildRef.taskId}, ${verifyReport.buildRef.attempt}) != BUILD_REPORT.md=(${opts.taskId}, ${attempt})`,
    )
  }
  // VERIFY.md and BUILD_REPORT.md must also agree on the upstream commit
  // and patch refs. Same task/attempt does not prove same patch.
  if (verifyReport.buildRef.baseCommitSha !== buildReport.base.baseCommitSha) {
    return recordReviewIntervention(
      ictx,
      'review_upstream_mismatch',
      `VERIFY.md baseCommitSha=${verifyReport.buildRef.baseCommitSha} != BUILD_REPORT.md baseCommitSha=${buildReport.base.baseCommitSha}`,
    )
  }
  if (verifyReport.buildRef.patchSha256 !== buildReport.patch.patchSha256) {
    return recordReviewIntervention(
      ictx,
      'review_upstream_mismatch',
      `VERIFY.md patchSha256=${verifyReport.buildRef.patchSha256} != BUILD_REPORT.md patchSha256=${buildReport.patch.patchSha256}`,
    )
  }
  if (verifyReport.verdict.verdict !== 'pass') {
    return recordReviewIntervention(
      ictx,
      'review_verify_not_passed',
      `VERIFY.md verdict=${verifyReport.verdict.verdict}; REVIEW only runs on pass.`,
    )
  }

  // 3. Read prior REVIEW.md when round > 1. Resume mismatch (kickoff
  // Decision 10) is checked against the review-drafts directory below.
  // Codex M14 R2 finding #1 closure: detect the prior artifact's grammar
  // (single vs panel) and dispatch to the matching parser. A panel
  // round 1 → needs-revision → round 2 cycle ships the panel REVIEW.md
  // back in opts.priorReviewMd; pre-R2 this fell into the single-mode
  // parser and rejected as malformed before the panel branch was even
  // reached.
  let priorReport: ReviewReportData | null = null
  let priorPanelReport: ReviewReportPanelData | null = null
  if (opts.round > 1 && opts.priorReviewMd != null) {
    const priorMode = detectReviewReportMode(opts.priorReviewMd)
    if (priorMode === 'unknown') {
      return recordReviewIntervention(
        ictx,
        'review_validation_failed',
        "priorReviewMd contains neither '## Reviewer' nor '## Reviewers' (or both)",
      )
    }
    try {
      if (priorMode === 'panel') {
        priorPanelReport = parseReviewPanelReport(opts.priorReviewMd)
      } else {
        priorReport = parseReviewReport(opts.priorReviewMd)
      }
    } catch (err) {
      // Prior REVIEW.md should already be canonical; corruption is a routing bug.
      const reason =
        err instanceof ReviewReportLoadError
          ? loadIssuesDetail(err.issues)
          : errorDetail(err)
      return recordReviewIntervention(ictx, 'review_validation_failed', reason)
    }
  }

  // 4. Resume-mismatch check (kickoff Decision 10). If a draft from a prior
  //    session exists for THIS round but events.jsonl has no matching
  //    review_round_completed for that round, refuse to replay.
  const events = await readEvents(eventPathsFor(opts.runPaths))
  const known = events.filter(isKnownPhaseEvent)
  const probe = await probeReviewResume({
    runDir: opts.runPaths.runDir,
    events,
    taskId: opts.taskId,
    attempt,
    round: opts.round,
    reviewReportPath: join(opts.runPaths.artifactRoot, 'REVIEW.md'),
  })
  if (probe.mismatched) {
    // Differentiate recovery paths: sha_mismatch means the event exists
    // but the canonical artifact no longer matches it.
    const reasonText =
      probe.reason === 'sha_mismatch'
        ? `review_round_completed event exists for round=${opts.round} but its reviewReportSha256 does not match the on-disk REVIEW.md`
        : `no review_round_completed event for round=${opts.round}`
    return recordReviewIntervention(
      ictx,
      'review_resume_mismatch',
      `partial draft exists at ${probe.draftPath}; ${reasonText}`,
      undefined,
      probe.draftPath,
    )
  }
  const draftAttempt1Path = reviewDraftPath(opts.runPaths.runDir, opts.round, 1)
  const draftAttempt2Path = reviewDraftPath(opts.runPaths.runDir, opts.round, 2)

  // 5. Cross-family invocation-time check (decision 5).
  let buildFamily: string | null = null
  for (let i = known.length - 1; i >= 0; i--) {
    const e = known[i]!
    if (
      e.type === 'build_provider_recorded' &&
      e.taskId === opts.taskId &&
      e.attempt === attempt
    ) {
      buildFamily = e.family
      break
    }
  }
  if (buildFamily === null) {
    return recordReviewIntervention(
      ictx,
      'review_no_build_provider',
      `events.jsonl has no build_provider_recorded for taskId=${opts.taskId} attempt=${attempt}`,
    )
  }

  // Codex M14 R1 finding #1: panel-mode dispatch. When the company config
  // declares a 2-voter panel under reviewer.panel, the panel orchestrator
  // owns per-panelist family resolution + cross-family enforcement
  // (registry.familyOf), so the single-reviewer cross-family check below
  // is skipped in this branch. The branch returns through the same
  // ReviewResult contract (resolved/needs_revision/blocked/intervention).
  if (shouldUseReviewPanel(opts.invokeCtx.config.company)) {
    return runReviewPanelBranch({
      opts,
      ictx,
      now,
      buildFamily: buildFamily as ProviderFamily,
      buildReport,
      buildReportSha256,
      verifyReportSha256,
      attempt,
      events: known,
      priorReport,
      priorPanelReport,
    })
  }

  // Use the runtime ProviderRegistry's family lookup, which validates
  // adapter.family vs familyOf(adapter.id) at registration. This keeps
  // BUILD and REVIEW on the same registry-resolved authority.
  const reviewerFamily = opts.invokeCtx.registry.familyOf(
    opts.reviewerAgent.provider,
  )
  if (buildFamily === reviewerFamily) {
    return recordReviewIntervention(
      ictx,
      'review_cross_family_violation',
      `BUILD family=${buildFamily} equals reviewer family=${reviewerFamily}; runtime cross-family invariant violated`,
    )
  }

  // 6. Render REVIEW_CONTEXT and compose the persona prompt.
  const changedFilePaths: readonly string[] = Object.freeze(
    buildReport.changedFiles.map((f) => f.path),
  )
  const reviewContext = renderReviewContext({
    round: opts.round,
    taskId: opts.taskId,
    attempt,
    buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
    buildReportSha256,
    verifyReportPath: '.code-oz/artifacts/VERIFY.md',
    verifyReportSha256,
    baseCommitSha: buildReport.base.baseCommitSha,
    patchSha256: buildReport.patch.patchSha256,
    changedFiles: buildReport.changedFiles,
    verifyVerdict: verifyReport.verdict.verdict,
    verifyRationale: verifyReport.verdict.rationale,
    mutationStatus: verifyReport.mutation.status,
    priorReport,
  })
  const composed = await composeReviewPrompt({
    agentBody: opts.reviewerAgent.body,
    readySignal: REVIEW_READY_SIGNAL,
    availableTools: collectToolNames(opts.reviewerAgent),
    reviewContext,
  })

  // 7. Emit review_started (cross-family pair recorded).
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'review_started',
    ts: now(),
    runId: opts.runId,
    phase: 'review',
    agent: opts.reviewerAgent.name,
    attempt,
    taskId: opts.taskId,
    baseCommitSha: buildReport.base.baseCommitSha,
    patchSha256: buildReport.patch.patchSha256,
    buildReportSha256,
    verifyReportSha256,
    buildFamily,
    reviewerFamily,
  })

  // 8. Invoke persona (initial draft + at most one bounded repair).
  const priorFindings: readonly ReviewFinding[] = priorReport?.findings ?? Object.freeze([])
  const repairResult = await invokeWithRepair({
    invokePersona: opts.invokePersona,
    composedPrompt: composed,
    round: opts.round,
    changedFilePaths,
    runDir: opts.runPaths.runDir,
  })
  if (!repairResult.ok) {
    // Persist any drafts captured before the failure (already done in
    // invokeWithRepair) and surface the intervention. The intervention
    // points to the first draft path so the operator can inspect.
    return recordReviewIntervention(
      ictx,
      repairResult.code,
      repairResult.reason,
      undefined,
      repairResult.firstDraftPath,
    )
  }

  // 9. Canonicalize findings (fingerprint reuse + ping-pong reopen).
  // Wrap canonicalizeFindings so a duplicate-id collision after
  // fingerprint canonicalization surfaces an actionable intervention
  // instead of crashing the phase.
  let canonical: ReturnType<typeof canonicalizeFindings>
  try {
    canonical = canonicalizeFindings({
      draftFindings: repairResult.findings,
      priorFindings,
      round: opts.round,
    })
  } catch (err) {
    return recordReviewIntervention(
      ictx,
      'review_validation_failed',
      `canonicalizeFindings threw: ${errorDetail(err)}`,
      undefined,
      reviewDraftPath(opts.runPaths.runDir, opts.round, 1),
    )
  }

  // Finalize-time path validation per kickoff Decision 7: reject
  // deleted-file findings and verify cited line ranges are within the
  // worktree files. Runs after canonicalization so stable ids are what
  // gets validated.
  const worktreeRoot = worktreePathsFor(opts.cwd, opts.runId).worktree
  const pathIssue = await validateFindingPaths({
    findings: canonical.findings,
    manifest: buildReport.changedFiles,
    worktreeRoot,
  })
  if (pathIssue !== null) {
    return recordReviewIntervention(
      ictx,
      pathIssue.code,
      pathIssue.detail,
      undefined,
      reviewDraftPath(opts.runPaths.runDir, opts.round, 1),
    )
  }

  // 10. Compute orchestrator-owned verdict.
  const personaScore = repairResult.finalScore
  const verdict = computeCanonicalVerdict(canonical.findings, personaScore)

  // 11. Assemble ReviewReportData. Round timeline is orchestrator-only
  //     (kickoff Decision 6): prior rounds + this round's bullet.
  const ts = now()
  const newTimelineEntry: ReviewTimelineEntry = Object.freeze({
    round: opts.round,
    timestamp: ts,
    findingsRaised: canonical.newIds.length,
    score: personaScore,
    verdict,
  })
  const roundTimeline: readonly ReviewTimelineEntry[] = priorReport
    ? Object.freeze([...priorReport.roundTimeline, newTimelineEntry])
    : Object.freeze([newTimelineEntry])

  const exitReason = renderExitReason(verdict, opts.round, canonical.reopenedIds)
  const data: ReviewReportData = Object.freeze({
    upstreamRefs: Object.freeze({
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256,
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256,
      taskId: opts.taskId,
      attempt,
      baseCommitSha: buildReport.base.baseCommitSha,
      patchSha256: buildReport.patch.patchSha256,
    }),
    reviewer: Object.freeze({
      providerFamily: reviewerFamily,
      providerId: opts.reviewerAgent.provider,
      modelPolicy: opts.reviewerAgent.modelPolicy,
      crossFamilyCheck: 'passed' as const,
      buildFamily,
    }),
    roundTimeline,
    findings: canonical.findings,
    score: Object.freeze({
      roundCount: opts.round,
      finalScore: personaScore,
      finalVerdict: verdict,
      exitReason,
    }),
    capStatus: Object.freeze({
      cap: REVIEW_ROUND_CAP,
      roundsUsed: opts.round,
      capExhausted: opts.round >= REVIEW_ROUND_CAP && verdict !== 'ready',
    }),
  })

  // 12. Round-trip serialize → parse for grammar lock-in.
  const reviewText = serializeReviewReport(data)
  try {
    parseReviewReport(reviewText, 'REVIEW.md', { changedFilePaths })
  } catch (err) {
    const reason =
      err instanceof ReviewReportLoadError
        ? loadIssuesDetail(err.issues)
        : errorDetail(err)
    return recordReviewIntervention(ictx, 'review_validation_failed', reason)
  }

  // 13. Atomic write REVIEW.md.
  const reviewReportPath = join(opts.runPaths.artifactRoot, 'REVIEW.md')
  await atomicWriteFile(reviewReportPath, reviewText)
  const reviewReportSha256 = SHA(reviewText)

  // 14. Emit review_round_completed.
  const findingsResolvedCount = canonical.findings.filter(
    (f) =>
      typeof f.roundResolved === 'number' &&
      f.roundResolved === opts.round,
  ).length
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'review_round_completed',
    ts: now(),
    runId: opts.runId,
    phase: 'review',
    agent: opts.reviewerAgent.name,
    attempt,
    taskId: opts.taskId,
    round: opts.round,
    score: personaScore,
    verdict,
    findingsRaised: canonical.newIds.length,
    findingsResolved: findingsResolvedCount,
    // Bind the event to the canonical artifact via sha256 so resume
    // probes can verify event/artifact agreement.
    reviewReportSha256,
  })

  // Clean up the round's draft directory now that the canonical write
  // succeeded — drafts only have value when there is no canonical output.
  await cleanupReviewDraftsForRound([draftAttempt1Path, draftAttempt2Path])

  // 15. Branch on verdict.
  if (verdict === 'ready') {
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_resolved',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      finalRound: opts.round,
      finalScore: personaScore,
      reviewReportSha256,
    })
    // Scientist phase-tail (rule 15). Mirrors verify.ts: runs on resolution.
    const tail = await runScientistPhaseTail({
      invokeCtx: opts.invokeCtx,
      runPaths: opts.runPaths,
      runId: opts.runId,
      agent: opts.scientistAgent,
      phase: 'review',
      primaryArtifactPath: reviewReportPath,
      now,
    })
    if (tail.status === 'intervention') {
      return recordReviewIntervention(ictx, 'review_scientist_tail_failed', tail.rule)
    }
    // Gate-preflight (CLAUDE.md rule 15): block overdue / blocking open
    // questions before the operator-facing gate. Mirrors plan.ts + build.ts.
    const preflight = await validateScientistSidecars({
      phase: 'review',
      artifactRoot: opts.runPaths.artifactRoot,
      today: now().slice(0, 10),
    })
    if (!preflight.ok) {
      return recordReviewIntervention(
        ictx,
        preflight.code,
        preflight.rule,
        preflight.detail,
      )
    }
    await requireGate({
      paths: opts.runPaths,
      runId: opts.runId,
      phase: 'review',
      blockedOn: 'code-oz approve review',
      now,
    })
    return Object.freeze({
      status: 'resolved' as const,
      reviewReportPath,
      reviewReportSha256,
      verdict: 'ready' as const,
      score: personaScore,
      findings: canonical.findings,
      round: opts.round,
    })
  }

  if (verdict === 'block') {
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_blocked',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      reason: 'block',
      finalRound: opts.round,
      reviewReportSha256,
    })
    await recordReviewIntervention(
      ictx,
      'review_block_terminal',
      'reviewer issued a block-severity finding (verdict=block); REVIEW loop terminated',
    )
    // Scientist tail still runs on block — the artifact is canonical and
    // the persona has knowledge worth lifting into HYPOTHESES.md /
    // OPEN_QUESTIONS.md (mirror verify.ts dual-branch invocation).
    const tail = await runScientistPhaseTail({
      invokeCtx: opts.invokeCtx,
      runPaths: opts.runPaths,
      runId: opts.runId,
      agent: opts.scientistAgent,
      phase: 'review',
      primaryArtifactPath: reviewReportPath,
      now,
    })
    if (tail.status === 'intervention') {
      // Layered intervention: surface the Scientist failure but the
      // primary terminal state is already 'review_block_terminal'.
      // Returning blocked is correct; the caller sees both NEEDS_INTERVENTION
      // entries via gate inspection.
    }
    return Object.freeze({
      status: 'blocked' as const,
      reviewReportPath,
      reviewReportSha256,
      verdict: 'block' as const,
      score: personaScore,
      findings: canonical.findings,
      round: opts.round,
    })
  }

  // verdict === 'needs-revision'. Per kickoff Decision 1, the BUILD
  // attempt N+1 trigger is delegated to the review-remediation
  // coordinator: runReview hands it the canonical findings + REVIEW.md
  // ref + the prior validation command and receives a
  // ReviewRemediationDecision. Two outcomes alter runReview's terminal
  // status:
  //   - 'review_cap_exhausted' (round 4 needs-revision): emit
  //     review_blocked(reason='cap_exhausted') + NEEDS_INTERVENTION
  //     review_cap_exhausted_terminal; return blocked.
  //   - 'build_cap_blocked': BUILD attempts already at cap; the
  //     coordinator's reason is the VERIFY-owned context.
  //   - 'continue': return needs_revision with the carry-forward
  //     attached so the caller can drive BUILD attempt N+1.
  // Read the latest events to pick up THIS round's review_round_completed.
  const eventsForRemediation = await readEvents(eventPathsFor(opts.runPaths))
  const remediation = decideReviewRemediation({
    events: eventsForRemediation,
    runId: opts.runId,
    taskId: opts.taskId,
    priorRound: opts.round,
    priorAttempt: attempt,
    priorFindings: canonical.findings,
    reviewReportPath,
    reviewReportSha256,
    priorValidationCommand: buildReport.validationCommand.command,
    reopenedIds: canonical.reopenedIds,
  })
  if (remediation.action === 'review_cap_exhausted') {
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_blocked',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      reason: 'cap_exhausted',
      finalRound: opts.round,
      reviewReportSha256,
    })
    await recordReviewIntervention(
      ictx,
      'review_cap_exhausted_terminal',
      remediation.reason,
    )
    return Object.freeze({
      status: 'blocked' as const,
      reviewReportPath,
      reviewReportSha256,
      verdict: 'block' as const,
      score: personaScore,
      findings: canonical.findings,
      round: opts.round,
    })
  }
  if (remediation.action === 'build_cap_blocked') {
    // The intervention is VERIFY-owned per Decision 4; runReview surfaces
    // the message but does NOT emit review_blocked (no double-terminal
    // state).
    await recordReviewIntervention(
      ictx,
      'review_build_cap_overlap',
      remediation.reason,
    )
    return Object.freeze({
      status: 'intervention' as const,
      code: 'review_build_cap_overlap',
      rule: remediation.reason,
    })
  }
  // remediation.action === 'continue'
  return Object.freeze({
    status: 'needs_revision' as const,
    reviewReportPath,
    reviewReportSha256,
    verdict: 'needs-revision' as const,
    score: personaScore,
    findings: canonical.findings,
    round: opts.round,
    remediation,
    carryForward: remediation.carryForward,
  })
}

// --- persona-response parsing -------------------------------------

interface PersonaParsedFields {
  /** Raw persona-emitted findings (id may be F-NEW; canonicalizer assigns). */
  readonly findings: readonly ReviewFinding[]
  readonly finalScore: number
}

type ParsePersonaResult =
  | { readonly ok: true; readonly value: PersonaParsedFields }
  | { readonly ok: false; readonly violation: string; readonly offendingLines: readonly string[] }

/**
 * Parses the persona's small structured response. Format:
 *
 *   <review-ready/>
 *
 *   ## Findings
 *
 *   ### F-NEW: <one-line title>
 *   - File: <path>
 *   - Line: <single or range>
 *   - Severity: <block | fix-first | nit | fyi>
 *   - Recommendation: <≤ 500-char single line>
 *   - Round raised: <N>
 *   - Round resolved: <unresolved | N>
 *
 *   (more H3 blocks, or `- None.` if no findings raised)
 *
 *   ## Score
 *   - Final score: <0..10>
 *
 * The canonicalizer (review-report.ts) normalizes ids and reopens prior-
 * resolved findings by fingerprint. The orchestrator computes verdict
 * from findings + score per the locked verdict rule.
 */
export function parseReviewPersonaResponse(
  text: string,
  round: number,
): ParsePersonaResult {
  const lines = text.split(/\r?\n/)
  const readyIdx = lines.findIndex((l) => l.trim() === REVIEW_READY_SIGNAL)
  if (readyIdx === -1) {
    return {
      ok: false,
      violation: `missing ${REVIEW_READY_SIGNAL} marker`,
      offendingLines: clipFirstLines(lines, REVIEW_REPAIR_OFFENDING_LINES_MAX),
    }
  }
  const after = lines.slice(readyIdx + 1)

  // Walk into ## Findings, then ## Score.
  let cursor = 0
  while (cursor < after.length && after[cursor]!.trim() !== '## Findings') cursor++
  if (cursor >= after.length) {
    return {
      ok: false,
      violation: 'missing `## Findings` section after <review-ready/>',
      offendingLines: clipFirstLines(after, REVIEW_REPAIR_OFFENDING_LINES_MAX),
    }
  }
  cursor++
  // Collect findings until ## Score.
  const findingLines: string[] = []
  while (cursor < after.length && after[cursor]!.trim() !== '## Score') {
    findingLines.push(after[cursor]!)
    cursor++
  }
  if (cursor >= after.length) {
    return {
      ok: false,
      violation: 'missing `## Score` section',
      offendingLines: clipFirstLines(findingLines, REVIEW_REPAIR_OFFENDING_LINES_MAX),
    }
  }
  cursor++ // step past `## Score` heading
  const scoreLines: string[] = []
  while (cursor < after.length && !after[cursor]!.startsWith('## ')) {
    scoreLines.push(after[cursor]!)
    cursor++
  }

  // Parse findings.
  const findingsResult = parseFindingsBlock(findingLines, round)
  if (!findingsResult.ok) return findingsResult

  // Parse score.
  let finalScore: number | null = null
  for (const l of scoreLines) {
    const m = l.match(/^- Final score:\s*(\d+)\s*$/)
    if (m) {
      finalScore = Number.parseInt(m[1]!, 10)
      break
    }
  }
  if (finalScore === null) {
    return {
      ok: false,
      violation: '`## Score` must contain a `- Final score: <0-10>` bullet',
      offendingLines: clipFirstLines(scoreLines, REVIEW_REPAIR_OFFENDING_LINES_MAX),
    }
  }
  if (!Number.isInteger(finalScore) || finalScore < 0 || finalScore > REVIEW_SCORE_MAX) {
    return {
      ok: false,
      violation: `\`## Score.Final score\` must be an integer in [0, ${REVIEW_SCORE_MAX}]`,
      offendingLines: [`- Final score: ${finalScore}`],
    }
  }

  return { ok: true, value: Object.freeze({ findings: findingsResult.findings, finalScore }) }
}

interface ParseFindingsResultOk {
  readonly ok: true
  readonly findings: readonly ReviewFinding[]
}
type ParseFindingsResult =
  | ParseFindingsResultOk
  | { readonly ok: false; readonly violation: string; readonly offendingLines: readonly string[] }

function parseFindingsBlock(lines: readonly string[], round: number): ParseFindingsResult {
  // Trim leading blank lines.
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++
  // Empty form: `- None.`
  if (i < lines.length && lines[i]!.trim() === '- None.') {
    return { ok: true, findings: Object.freeze([]) }
  }

  const findings: ReviewFinding[] = []
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    if (!line.startsWith('### ')) {
      return {
        ok: false,
        violation: '`## Findings` entries must be `### F-NEW: <title>` or `### F-NNN: <title>` H3 blocks',
        offendingLines: [line],
      }
    }
    const heading = line.slice(4).trim()
    const headingMatch = heading.match(/^(F-NEW|F-\d{3,}): (.+)$/)
    if (!headingMatch) {
      return {
        ok: false,
        violation:
          'Findings H3 heading must match `### F-NEW: <title>` or `### F-NNN: <title>` (NNN = 3+ digits)',
        offendingLines: [line],
      }
    }
    const id = headingMatch[1]!
    const title = headingMatch[2]!
    if (title.length === 0) {
      return {
        ok: false,
        violation: 'finding title must be non-empty',
        offendingLines: [line],
      }
    }
    if (title.length > REVIEW_TITLE_MAX_CHARS) {
      return {
        ok: false,
        violation: `finding title must be ≤ ${REVIEW_TITLE_MAX_CHARS} characters`,
        offendingLines: [line],
      }
    }
    i++
    // Collect bullets up to the next ### or end of block.
    const bullets: string[] = []
    while (i < lines.length && !lines[i]!.startsWith('### ')) {
      const l = lines[i]!
      if (l.startsWith('- ')) bullets.push(l.slice(2))
      i++
    }
    const bm = bulletMap(bullets)
    const filePath = bm.get('File')
    const lineCite = bm.get('Line')
    const severity = bm.get('Severity')
    const recommendation = bm.get('Recommendation')
    const roundRaisedStr = bm.get('Round raised')
    const roundResolvedStr = bm.get('Round resolved')
    if (
      filePath === undefined ||
      lineCite === undefined ||
      severity === undefined ||
      recommendation === undefined ||
      roundRaisedStr === undefined ||
      roundResolvedStr === undefined
    ) {
      return {
        ok: false,
        violation:
          `finding ${id} requires bullets: File, Line, Severity, Recommendation, Round raised, Round resolved`,
        offendingLines: bullets.length > 0 ? bullets : [line],
      }
    }
    if (!isReviewSeverity(severity)) {
      return {
        ok: false,
        violation: `Severity must be one of: ${REVIEW_SEVERITIES.join(', ')}`,
        offendingLines: [`- Severity: ${severity}`],
      }
    }
    if (!/^\d+(?:-\d+)?$/.test(lineCite)) {
      return {
        ok: false,
        violation: 'Finding Line must be a single line "42" or range "42-58"',
        offendingLines: [`- Line: ${lineCite}`],
      }
    }
    if (recommendation.length > REVIEW_RECOMMENDATION_MAX_CHARS) {
      return {
        ok: false,
        violation: `Recommendation must be ≤ ${REVIEW_RECOMMENDATION_MAX_CHARS} characters`,
        offendingLines: [`- Recommendation: ${recommendation.slice(0, 80)}…`],
      }
    }
    const roundRaisedParsed = Number.parseInt(roundRaisedStr, 10)
    if (
      !Number.isInteger(roundRaisedParsed) ||
      roundRaisedParsed < 1 ||
      roundRaisedParsed > REVIEW_ROUND_CAP ||
      roundRaisedParsed > round
    ) {
      return {
        ok: false,
        violation: `Round raised must be an integer in [1, ${round}] (current round)`,
        offendingLines: [`- Round raised: ${roundRaisedStr}`],
      }
    }
    let roundResolved: number | 'unresolved'
    if (roundResolvedStr === 'unresolved') {
      roundResolved = 'unresolved'
    } else {
      const r = Number.parseInt(roundResolvedStr, 10)
      if (
        !Number.isInteger(r) ||
        r < 1 ||
        r > REVIEW_ROUND_CAP ||
        r < roundRaisedParsed ||
        r > round
      ) {
        return {
          ok: false,
          violation: `Round resolved must be 'unresolved' or an integer in [Round raised, ${round}]`,
          offendingLines: [`- Round resolved: ${roundResolvedStr}`],
        }
      }
      roundResolved = r
    }
    findings.push(
      Object.freeze({
        id,
        title,
        file: filePath,
        line: lineCite,
        severity,
        recommendation,
        roundRaised: roundRaisedParsed,
        roundResolved,
      }),
    )
  }
  return { ok: true, findings: Object.freeze(findings) }
}

function bulletMap(bullets: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of bullets) {
    const idx = b.indexOf(': ')
    if (idx === -1) continue
    out.set(b.slice(0, idx), b.slice(idx + 2))
  }
  return out
}

function clipFirstLines(lines: readonly string[], n: number): readonly string[] {
  return Object.freeze(lines.slice(0, n))
}

// --- repair loop ---------------------------------------------------

interface InvokeWithRepairInput {
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  readonly composedPrompt: string
  readonly round: number
  readonly changedFilePaths: readonly string[]
  readonly runDir: string
}

type InvokeWithRepairResult =
  | { readonly ok: true; readonly findings: readonly ReviewFinding[]; readonly finalScore: number }
  | {
      readonly ok: false
      readonly code: string
      readonly reason: string
      readonly firstDraftPath?: string
    }

async function invokeWithRepair(input: InvokeWithRepairInput): Promise<InvokeWithRepairResult> {
  // Initial draft.
  let draft1: string
  try {
    draft1 = await input.invokePersona(input.composedPrompt)
  } catch (err) {
    return {
      ok: false,
      code: 'review_persona_invoke_failed',
      reason: errorDetail(err),
    }
  }
  await persistDraft(input.runDir, input.round, 1, draft1)
  const parse1 = parseReviewPersonaResponse(draft1, input.round)
  if (parse1.ok) {
    // Path-validate the persona-cited files against the BUILD changed manifest.
    const pathIssue = findUnknownPath(parse1.value.findings, input.changedFilePaths)
    if (pathIssue === null) {
      return { ok: true, findings: parse1.value.findings, finalScore: parse1.value.finalScore }
    }
    // Path violation: surface a bounded repair prompt and try once more.
    const repairPrompt = renderRepairPrompt({
      errorCode: 'review_finding_path_unknown',
      violatedRule:
        'Finding File must be a path present in BUILD_REPORT.md Changed files manifest (deleted-file findings rejected in M9)',
      offendingLines: [pathIssue.line],
    })
    return await runRepair({
      invokePersona: input.invokePersona,
      composedPrompt: input.composedPrompt,
      repairPrompt,
      round: input.round,
      runDir: input.runDir,
      firstDraftPath: reviewDraftPath(input.runDir, input.round, 1),
      changedFilePaths: input.changedFilePaths,
    })
  }
  // Grammar repair: bounded prompt with the violation + clipped offending lines.
  const repairPrompt = renderRepairPrompt({
    errorCode:
      parse1.violation === `missing ${REVIEW_READY_SIGNAL} marker`
        ? 'review_persona_missing_ready_signal'
        : 'review_validation_failed',
    violatedRule: parse1.violation,
    offendingLines: parse1.offendingLines,
  })
  return await runRepair({
    invokePersona: input.invokePersona,
    composedPrompt: input.composedPrompt,
    repairPrompt,
    round: input.round,
    runDir: input.runDir,
    firstDraftPath: reviewDraftPath(input.runDir, input.round, 1),
    changedFilePaths: input.changedFilePaths,
  })
}

interface RunRepairInput {
  readonly invokePersona: (composedPrompt: string) => Promise<string>
  readonly composedPrompt: string
  readonly repairPrompt: string
  readonly round: number
  readonly runDir: string
  readonly firstDraftPath: string
  readonly changedFilePaths: readonly string[]
}

async function runRepair(input: RunRepairInput): Promise<InvokeWithRepairResult> {
  const repairCombined = `${input.composedPrompt}\n\n## Prior draft was rejected\n\n${input.repairPrompt}\n\nBegin again with ${REVIEW_READY_SIGNAL} on its own line.\n`
  let draft2: string
  try {
    draft2 = await input.invokePersona(repairCombined)
  } catch (err) {
    return {
      ok: false,
      code: 'review_persona_invoke_failed',
      reason: `repair turn threw: ${errorDetail(err)}`,
      firstDraftPath: input.firstDraftPath,
    }
  }
  await persistDraft(input.runDir, input.round, 2, draft2)
  const parse2 = parseReviewPersonaResponse(draft2, input.round)
  if (!parse2.ok) {
    return {
      ok: false,
      code:
        parse2.violation === `missing ${REVIEW_READY_SIGNAL} marker`
          ? 'review_persona_missing_ready_signal'
          : 'review_validation_failed',
      reason: `persona response failed both initial draft and repair: ${parse2.violation}`,
      firstDraftPath: input.firstDraftPath,
    }
  }
  const pathIssue = findUnknownPath(parse2.value.findings, input.changedFilePaths)
  if (pathIssue !== null) {
    return {
      ok: false,
      code: 'review_finding_path_unknown',
      reason: `repair draft still cites unknown file ${pathIssue.file} (finding ${pathIssue.id})`,
      firstDraftPath: input.firstDraftPath,
    }
  }
  return { ok: true, findings: parse2.value.findings, finalScore: parse2.value.finalScore }
}

interface UnknownPathIssue {
  readonly id: string
  readonly file: string
  readonly line: string
}

function findUnknownPath(
  findings: readonly ReviewFinding[],
  changedFilePaths: readonly string[],
): UnknownPathIssue | null {
  for (const f of findings) {
    if (!changedFilePaths.includes(f.file)) {
      return { id: f.id, file: f.file, line: `- File: ${f.file} (finding ${f.id})` }
    }
  }
  return null
}

// --- bp#3 validation: deleted-file rejection + line-range existence ---

interface PathValidationIssue {
  readonly code:
    | 'review_finding_path_unknown'
    | 'review_finding_path_deleted'
    | 'review_finding_line_out_of_range'
    | 'review_finding_file_unreadable'
  readonly id: string
  readonly file: string
  readonly line: string
  readonly detail: string
}

interface ValidateFindingPathsInput {
  readonly findings: readonly ReviewFinding[]
  readonly manifest: readonly ManifestEntry[]
  readonly worktreeRoot: string
}

/**
 * Finalize-time path validation per kickoff Decision 7:
 *
 *   - Reject `change: deleted` findings (deleted-file findings are not
 *     a locked M9 convention; they go to operator intervention).
 *   - For `added` | `modified`, read the file under the run worktree
 *     and verify the cited Line / Line range is within the current
 *     file's line count.
 *   - Path-not-in-manifest produces review_finding_path_unknown.
 *
 * Returns `null` if all findings pass; the first violating finding's
 * issue otherwise. The orchestrator surfaces the issue via the bounded
 * repair prompt path.
 */
async function validateFindingPaths(
  input: ValidateFindingPathsInput,
): Promise<PathValidationIssue | null> {
  const { readFile, realpath } = await import('node:fs/promises')
  const { resolve, relative, isAbsolute } = await import('node:path')
  const manifestByPath = new Map(input.manifest.map((m) => [m.path, m]))
  // Realpath the worktree root once for the symlink-escape check below.
  // If the worktree directory itself is missing, every file check will
  // surface review_finding_file_unreadable per-finding; we handle that
  // path inside the loop rather than throwing here.
  let worktreeRootReal: string | null = null
  try {
    worktreeRootReal = await realpath(input.worktreeRoot)
  } catch {
    worktreeRootReal = null
  }
  for (const f of input.findings) {
    const entry = manifestByPath.get(f.file)
    if (entry === undefined) {
      return {
        code: 'review_finding_path_unknown',
        id: f.id,
        file: f.file,
        line: `- File: ${f.file} (finding ${f.id})`,
        detail: `File ${f.file} is not in BUILD_REPORT.md Changed files manifest`,
      }
    }
    if (entry.change === 'deleted') {
      return {
        code: 'review_finding_path_deleted',
        id: f.id,
        file: f.file,
        line: `- File: ${f.file} (finding ${f.id}; manifest change=deleted)`,
        detail: `Finding ${f.id} cites a deleted-file path; deleted-file findings are rejected in M9`,
      }
    }
    if (isAbsolute(f.file)) {
      return {
        code: 'review_finding_path_unknown',
        id: f.id,
        file: f.file,
        line: `- File: ${f.file} (finding ${f.id}; absolute path rejected)`,
        detail: `Finding ${f.id} cites an absolute path; only relative paths under the worktree are allowed`,
      }
    }
    // Lexical pre-check: reject paths that lexically escape the worktree
    // (e.g., "../foo" or "src/../../escape").
    const absResolved = resolve(input.worktreeRoot, f.file)
    const lexRel = relative(input.worktreeRoot, absResolved)
    if (lexRel.startsWith('..') || isAbsolute(lexRel)) {
      return {
        code: 'review_finding_path_unknown',
        id: f.id,
        file: f.file,
        line: `- File: ${f.file} (finding ${f.id}; resolves outside worktree)`,
        detail: `Finding ${f.id} cites a path that escapes the run worktree`,
      }
    }
    // Realpath-based symlink-escape check. A symlink inside the worktree
    // pointing outside the worktree would lexically pass the prefix
    // check above; realpath dereferences it so we can verify the
    // canonical target is still under the canonical worktree root.
    // Done before readFile, which would otherwise follow the symlink.
    let absResolvedReal: string | null = null
    try {
      absResolvedReal = await realpath(absResolved)
    } catch {
      absResolvedReal = null
    }
    if (worktreeRootReal !== null && absResolvedReal !== null) {
      const realRel = relative(worktreeRootReal, absResolvedReal)
      if (realRel === '' || (!realRel.startsWith('..') && !isAbsolute(realRel))) {
        // Stays within worktree after realpath — accept.
      } else {
        return {
          code: 'review_finding_path_unknown',
          id: f.id,
          file: f.file,
          line: `- File: ${f.file} (finding ${f.id}; symlink escape rejected)`,
          detail:
            `Finding ${f.id} cited file ${f.file} is a symlink whose realpath ${absResolvedReal} ` +
            `lies outside the run worktree ${worktreeRootReal}`,
        }
      }
    }
    let text: string
    try {
      text = await readFile(absResolved, 'utf8')
    } catch (err) {
      return {
        code: 'review_finding_file_unreadable',
        id: f.id,
        file: f.file,
        line: `- File: ${f.file} (finding ${f.id}; not readable under worktree)`,
        detail: `Finding ${f.id} cited file ${absResolved} is not readable: ${errorDetail(err, FILE_READ_DETAIL_MAX_CHARS)}`,
      }
    }
    const lineCount = countLines(text)
    const range = parseLineRange(f.line)
    // Reject impossible line citations. The persona-response parser
    // accepts any digits (`/^\d+(?:-\d+)?$/`), so `Line: 0` would
    // survive without this lower-bound guard. Lines are 1-indexed in
    // REVIEW.md citations.
    if (!Number.isInteger(range.start) || range.start < 1) {
      return {
        code: 'review_finding_line_out_of_range',
        id: f.id,
        file: f.file,
        line: `- Line: ${f.line} (finding ${f.id}; line numbers are 1-indexed)`,
        detail: `Finding ${f.id} cites Line ${f.line} (start=${range.start}); line numbers must start at 1`,
      }
    }
    // Reject reversed line ranges. Without this check, "Line: 10-5"
    // would silently pass (start=10 >= 1, end=5 <= lineCount).
    if (range.end < range.start) {
      return {
        code: 'review_finding_line_out_of_range',
        id: f.id,
        file: f.file,
        line: `- Line: ${f.line} (finding ${f.id}; range end < start)`,
        detail: `Finding ${f.id} cites reversed Line range ${f.line} (start=${range.start} > end=${range.end})`,
      }
    }
    if (range.end > lineCount) {
      return {
        code: 'review_finding_line_out_of_range',
        id: f.id,
        file: f.file,
        line: `- Line: ${f.line} (finding ${f.id}; file has ${lineCount} lines)`,
        detail: `Finding ${f.id} cites Line ${f.line} but ${f.file} has only ${lineCount} lines in the worktree`,
      }
    }
  }
  return null
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  // Newline-separated lines, with the convention that "X" (no trailing
  // newline) and "X\n" both count as 1 line. "X\nY" counts as 2.
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      count++
    }
  }
  // Trailing newline at EOF is canonical and shouldn't bump the count.
  if (text.charCodeAt(text.length - 1) === 0x0a) count--
  return count
}

function parseLineRange(spec: string): { start: number; end: number } {
  const dashIdx = spec.indexOf('-')
  if (dashIdx === -1) {
    const n = Number.parseInt(spec, 10)
    return { start: n, end: n }
  }
  const start = Number.parseInt(spec.slice(0, dashIdx), 10)
  const end = Number.parseInt(spec.slice(dashIdx + 1), 10)
  return { start, end }
}

async function persistDraft(
  runDir: string,
  round: number,
  attempt: 1 | 2,
  text: string,
): Promise<void> {
  await persistReviewDraft(runDir, round, attempt, text)
}

// --- review context renderer --------------------------------------

interface RenderReviewContextInput {
  readonly round: number
  readonly taskId: string
  readonly attempt: number
  readonly buildReportPath: string
  readonly buildReportSha256: string
  readonly verifyReportPath: string
  readonly verifyReportSha256: string
  readonly baseCommitSha: string
  readonly patchSha256: string
  readonly changedFiles: readonly { readonly path: string; readonly change: string }[]
  readonly verifyVerdict: 'pass' | 'fail'
  readonly verifyRationale: string
  readonly mutationStatus: string
  readonly priorReport: ReviewReportData | null
}

function renderReviewContext(input: RenderReviewContextInput): string {
  const lines: string[] = []
  lines.push('### Round')
  lines.push(`- Round: ${input.round} of ${REVIEW_ROUND_CAP}`)
  lines.push(`- Task: ${input.taskId}`)
  lines.push(`- Attempt: ${input.attempt}`)
  lines.push('')
  lines.push('### Upstream refs')
  lines.push(`- BUILD_REPORT.md: ${input.buildReportPath} (sha256: ${input.buildReportSha256})`)
  lines.push(`- VERIFY.md: ${input.verifyReportPath} (sha256: ${input.verifyReportSha256})`)
  lines.push(`- Base commit: ${input.baseCommitSha}`)
  lines.push(`- Patch sha256: ${input.patchSha256}`)
  lines.push('')
  lines.push('### Changed files')
  for (const f of input.changedFiles) {
    lines.push(`- ${f.path} (${f.change})`)
  }
  lines.push('')
  lines.push('### VERIFY summary')
  lines.push(`- Verdict: ${input.verifyVerdict}`)
  lines.push(`- Mutation status: ${input.mutationStatus}`)
  lines.push(`- Rationale: ${input.verifyRationale}`)
  lines.push('')
  if (input.priorReport !== null) {
    lines.push('### Prior rounds')
    for (const t of input.priorReport.roundTimeline) {
      lines.push(
        `- Round ${t.round}: score ${t.score}, verdict ${t.verdict}, findings raised ${t.findingsRaised}`,
      )
    }
    lines.push('')
    lines.push('### Prior findings (carry-over)')
    if (input.priorReport.findings.length === 0) {
      lines.push('- None.')
    } else {
      for (const f of input.priorReport.findings) {
        const status =
          f.roundResolved === 'unresolved' ? 'unresolved' : `resolved round ${f.roundResolved}`
        lines.push(
          `- ${f.id} | ${f.severity} | ${f.file}:${f.line} | ${status} | ${f.title}`,
        )
      }
    }
    lines.push('')
  }
  lines.push('### What you must author')
  lines.push(
    '- `## Findings` — H3 blocks, one per finding, with bullets File / Line / Severity / Recommendation / Round raised / Round resolved. Use `F-NEW` as the id placeholder for new findings; the orchestrator assigns canonical F-NNN ids.',
  )
  lines.push('- `## Score` — `- Final score: <0..10>`. The orchestrator computes the final verdict from your findings + score.')
  lines.push('')
  lines.push(
    `Emit only the \`${REVIEW_READY_SIGNAL}\` marker followed by these two sections. Do not author the Round timeline, Reviewer block, Cap status, or final verdict — those are orchestrator-owned.`,
  )
  return lines.join('\n')
}

function renderExitReason(
  verdict: ReviewVerdict,
  round: number,
  reopenedIds: readonly string[],
): string {
  if (verdict === 'ready') return `score≥${REVIEW_SCORE_MIN} + verdict=ready (round ${round})`
  if (verdict === 'block') return `block-severity finding raised (round ${round})`
  // needs-revision
  if (reopenedIds.length > 0) {
    return `needs-revision (round ${round}); reopened ${reopenedIds.join(', ')}`
  }
  return `needs-revision (round ${round})`
}

// --- helpers --------------------------------------------------------

function collectToolNames(agent: AgentDefinition): readonly string[] {
  const names: string[] = []
  const tu = agent.permissions.tool_use
  if (!tu) return Object.freeze(names)
  if (tu.repo_context) for (const t of tu.repo_context.tools) names.push(t)
  if (tu.execute) for (const t of tu.execute.tools) names.push(t)
  if (tu.write) for (const t of tu.write.tools) names.push(t)
  if (tu.review_request) for (const t of tu.review_request.tools) names.push(t)
  return Object.freeze(names)
}

// --- panel-mode dispatch (Codex M14 R1 finding #1) ----------------

interface RunReviewPanelBranchInput {
  readonly opts: RunReviewOptions
  readonly ictx: InterventionContext
  readonly now: () => string
  readonly buildFamily: ProviderFamily
  readonly buildReport: ReturnType<typeof parseBuildReport>
  readonly buildReportSha256: string
  readonly verifyReportSha256: string
  readonly attempt: number
  readonly events: readonly LoggedEvent[]
  readonly priorReport: ReviewReportData | null
  /** Codex M14 R2 finding #1 closure: prior canonical panel REVIEW.md
   *  parsed via parseReviewPanelReport. Forwarded to runReviewPanel so
   *  multi-round panel runs preserve finding ids + timeline. */
  readonly priorPanelReport: ReviewReportPanelData | null
}

/**
 * Panel-mode REVIEW dispatch. Runs runReviewPanel with the wired
 * panelistInvoker, translates RunReviewPanelResult to ReviewResult,
 * and emits the gate-completion signals (review_resolved /
 * review_blocked) the approve.ts hook expects so panel-mode REVIEW.md
 * can pass `code-oz approve review`.
 *
 * Flow per kickoff finding #1:
 *   - resolved → emit review_resolved + Scientist tail + requireGate('review')
 *   - blocked  → emit review_blocked(reason='block') +
 *                review_block_terminal intervention + Scientist tail
 *   - needs_revision → parse REVIEW.md, run decideReviewRemediation
 *     against synthesized findings, return ReviewNeedsRevision (mirrors
 *     single-reviewer remediation chain so BUILD attempt N+1 routing
 *     works for panel mode too)
 *   - intervention → recordReviewIntervention with the panel code
 */
async function runReviewPanelBranch(
  input: RunReviewPanelBranchInput,
): Promise<ReviewResult> {
  const { opts, ictx, now, buildFamily, buildReport, attempt, events } = input
  const company = opts.invokeCtx.config.company
  const panel = company?.reviewer?.panel
  if (panel === undefined || panel.length < 2) {
    return recordReviewIntervention(
      ictx,
      'review_panel_config_invariant_violated',
      'shouldUseReviewPanel returned true but company.reviewer.panel is missing or has fewer than 2 entries',
    )
  }
  if (opts.panelistInvoker === undefined) {
    return recordReviewIntervention(
      ictx,
      'review_panel_invoker_missing',
      'panel mode is configured but RunReviewOptions.panelistInvoker was not provided; ' +
        'wire it via the CLI bootstrap or pass a deterministic fake from a test',
    )
  }

  // Conservative per-panelist token estimate. Manifest equality means
  // each panelist sees the same files; we sum the sizes of the BUILD
  // changed files (best-effort: missing files contribute 0, mirroring
  // the pre-call estimator's tolerance for absent metadata) and add a
  // small allowance for the prompt itself.
  const worktreeRoot = worktreePathsFor(opts.cwd, opts.runId).worktree
  let totalChangedBytes = 0
  for (const f of buildReport.changedFiles) {
    try {
      const s = await fsStat(join(worktreeRoot, f.path))
      if (s.isFile()) totalChangedBytes += s.size
    } catch {
      // File absent (deleted, or panel running outside a real worktree
      // in tests). Estimate as 0 and let the per-call estimator inside
      // invokeAgent catch hard caps later.
    }
  }
  const PANEL_PROMPT_OVERHEAD = 4096 // characters; accounts for persona body + REVIEW_CONTEXT
  const perPanelistTokensEstimate = estimateTokens({
    prompt: ' '.repeat(PANEL_PROMPT_OVERHEAD),
    files: [
      {
        path: 'panel-manifest-aggregate',
        sha256: '0'.repeat(64),
        sizeBytes: totalChangedBytes,
        content: Buffer.alloc(0),
      },
    ],
  })

  const upstreamRefs = {
    buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
    buildReportSha256: input.buildReportSha256,
    verifyReportPath: '.code-oz/artifacts/VERIFY.md',
    verifyReportSha256: input.verifyReportSha256,
    taskId: opts.taskId,
    attempt,
    baseCommitSha: buildReport.base.baseCommitSha,
    patchSha256: buildReport.patch.patchSha256,
  }

  let panelResult: RunReviewPanelResult
  try {
    panelResult = await runReviewPanel({
      runPaths: opts.runPaths,
      runId: opts.runId,
      cwd: opts.cwd,
      panelistInvoker: opts.panelistInvoker,
      panel,
      buildFamily,
      registry: opts.invokeCtx.registry,
      config: opts.invokeCtx.config,
      events,
      perPanelistTokensEstimate,
      ...(input.priorPanelReport !== null
        ? { priorPanelReport: input.priorPanelReport }
        : {}),
      upstreamRefs,
      round: opts.round,
      orchestratorAgent: opts.reviewerAgent.name,
      now,
    })
  } catch (err) {
    return recordReviewIntervention(
      ictx,
      'review_panel_runtime_error',
      `runReviewPanel threw: ${errorDetail(err)}`,
    )
  }

  if (panelResult.status === 'intervention') {
    return recordReviewIntervention(
      ictx,
      panelResult.code,
      panelResult.rule,
      panelResult.detail,
    )
  }

  // Re-parse canonical REVIEW.md for synthesized findings — needed for
  // result.findings + (on needs-revision) the remediation coordinator.
  let panelData: ReturnType<typeof parseReviewPanelReport>
  try {
    const reviewText = await readFile(panelResult.reviewReportPath, 'utf8')
    panelData = parseReviewPanelReport(reviewText)
  } catch (err) {
    return recordReviewIntervention(
      ictx,
      'review_panel_artifact_unreadable',
      `panel REVIEW.md unreadable after orchestrator success: ${errorDetail(err)}`,
    )
  }
  const findings: readonly ReviewFinding[] = panelData.findings

  if (panelResult.status === 'resolved') {
    // Emit review_resolved so preApproveReviewHook (single source of
    // truth for the approve gate) finds the canonical ready signal.
    // F2 makes the parser mode-aware; this emission keeps the event
    // log compatible with both single- and panel-mode parsers.
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_resolved',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      finalRound: panelResult.round,
      // Panel mode does not have a single persona-authored score; the
      // canonical artifact records `finalScore: 'panel'`. The
      // review_resolved event still wants a numeric finalScore for
      // approve.ts's existing schema; use the cap (10) as a sentinel.
      finalScore: REVIEW_SCORE_MAX,
      reviewReportSha256: panelResult.reviewReportSha256,
    })
    const tail = await runScientistPhaseTail({
      invokeCtx: opts.invokeCtx,
      runPaths: opts.runPaths,
      runId: opts.runId,
      agent: opts.scientistAgent,
      phase: 'review',
      primaryArtifactPath: panelResult.reviewReportPath,
      now,
    })
    if (tail.status === 'intervention') {
      return recordReviewIntervention(ictx, 'review_scientist_tail_failed', tail.rule)
    }
    const preflight = await validateScientistSidecars({
      phase: 'review',
      artifactRoot: opts.runPaths.artifactRoot,
      today: now().slice(0, 10),
    })
    if (!preflight.ok) {
      return recordReviewIntervention(
        ictx,
        preflight.code,
        preflight.rule,
        preflight.detail,
      )
    }
    await requireGate({
      paths: opts.runPaths,
      runId: opts.runId,
      phase: 'review',
      blockedOn: 'code-oz approve review',
      now,
    })
    return Object.freeze({
      status: 'resolved' as const,
      reviewReportPath: panelResult.reviewReportPath,
      reviewReportSha256: panelResult.reviewReportSha256,
      verdict: 'ready' as const,
      score: REVIEW_SCORE_MAX,
      findings,
      round: panelResult.round,
    })
  }

  if (panelResult.status === 'blocked') {
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_blocked',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      reason: 'block',
      finalRound: panelResult.round,
      reviewReportSha256: panelResult.reviewReportSha256,
    })
    await recordReviewIntervention(
      ictx,
      'review_block_terminal',
      `panel verdict block (${panelResult.quorumReason}); REVIEW loop terminated`,
    )
    const tail = await runScientistPhaseTail({
      invokeCtx: opts.invokeCtx,
      runPaths: opts.runPaths,
      runId: opts.runId,
      agent: opts.scientistAgent,
      phase: 'review',
      primaryArtifactPath: panelResult.reviewReportPath,
      now,
    })
    if (tail.status === 'intervention') {
      // Layered intervention; primary terminal already recorded above.
    }
    return Object.freeze({
      status: 'blocked' as const,
      reviewReportPath: panelResult.reviewReportPath,
      reviewReportSha256: panelResult.reviewReportSha256,
      verdict: 'block' as const,
      score: REVIEW_SCORE_MIN,
      findings,
      round: panelResult.round,
    })
  }

  // panelResult.status === 'needs_revision'. Mirror single-reviewer
  // remediation: re-read events for THIS round's panel-completed entry
  // and hand the synthesized findings to decideReviewRemediation. The
  // BUILD attempt N+1 chain works the same shape — REVIEW does not need
  // to know panel-vs-single beyond this branch.
  const eventsForRemediation = await readEvents(eventPathsFor(opts.runPaths))
  const remediation = decideReviewRemediation({
    events: eventsForRemediation,
    runId: opts.runId,
    taskId: opts.taskId,
    priorRound: panelResult.round,
    priorAttempt: attempt,
    priorFindings: findings,
    reviewReportPath: panelResult.reviewReportPath,
    reviewReportSha256: panelResult.reviewReportSha256,
    priorValidationCommand: buildReport.validationCommand.command,
    reopenedIds: [], // panel mode does not surface reopened-id ping-pong yet (M14 v1)
  })
  if (remediation.action === 'review_cap_exhausted') {
    await appendEvent(eventPathsFor(opts.runPaths), {
      version: 1,
      type: 'review_blocked',
      ts: now(),
      runId: opts.runId,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      attempt,
      taskId: opts.taskId,
      reason: 'cap_exhausted',
      finalRound: panelResult.round,
      reviewReportSha256: panelResult.reviewReportSha256,
    })
    await recordReviewIntervention(
      ictx,
      'review_cap_exhausted_terminal',
      remediation.reason,
    )
    return Object.freeze({
      status: 'blocked' as const,
      reviewReportPath: panelResult.reviewReportPath,
      reviewReportSha256: panelResult.reviewReportSha256,
      verdict: 'block' as const,
      score: REVIEW_SCORE_MIN,
      findings,
      round: panelResult.round,
    })
  }
  if (remediation.action === 'build_cap_blocked') {
    await recordReviewIntervention(
      ictx,
      'review_build_cap_overlap',
      remediation.reason,
    )
    return Object.freeze({
      status: 'intervention' as const,
      code: 'review_build_cap_overlap',
      rule: remediation.reason,
    })
  }
  // remediation.action === 'continue'
  return Object.freeze({
    status: 'needs_revision' as const,
    reviewReportPath: panelResult.reviewReportPath,
    reviewReportSha256: panelResult.reviewReportSha256,
    verdict: 'needs-revision' as const,
    score: REVIEW_SCORE_MIN,
    findings,
    round: panelResult.round,
    remediation,
    carryForward: remediation.carryForward,
  })
}

// --- intentionally exported for tests + future commits ------------

export { fingerprintFinding, runReviewPanelBranch }
export type { ReviewFinding, ReviewReportData, ReviewVerdict, ReviewSeverity }
