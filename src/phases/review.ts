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
  probePanelResume,
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
  runReviewSchedulerHook,
  type SchedulerFirePathExecutor,
  type SchedulerFirePathResult,
} from './review-scheduler-hook.ts'
import {
  selectEligibleOpponent,
  buildDebateTopicForReview,
  buildDebateBriefingSections,
  diffFindingsForPostDebateBasic,
  mapProviderErrorToFireResult,
  buildSchedulerPreflightInputForSingle,
  buildDebateFilesManifest,
} from './review-fire-path.ts'
import { requestDebate } from '../tools/debate-request.ts'
import { aggregateDebateSchedulerPreflight } from '../providers/cost.ts'
import type { PanelistVerdictSnapshot } from '../policy/debate-scheduler.ts'
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
  /**
   * M15 Phase 2 C13b: post-debate REVIEW round evidence carrier.
   * Populated by the production fire-path executor when it re-invokes
   * `runReviewRoundLocked` for the post-debate round on the same round
   * number. Surfaces DECISION.md content + the pre-debate REVIEW state
   * into the persona prompt so the reviewer can reconsider their verdict.
   * Production callers never set this; only the executor closure does.
   */
  readonly postDebateEvidence?: PostDebateEvidence | null
}

/**
 * M15 Phase 2 C13b: evidence the post-debate REVIEW round receives so the
 * persona can reconsider their pre-debate verdict in light of the cross-
 * family debate. Authored mechanically by the fire-path executor; the
 * persona never sees the raw event log — only the canonical artifacts +
 * this block.
 */
export interface PostDebateEvidence {
  /** Repo-relative path to DECISION.md (for reference; the persona's
   *  prompt embeds the full content). */
  readonly decisionPath: string
  /** Full DECISION.md content. Surfaced inline in REVIEW_CONTEXT. */
  readonly decisionMd: string
  /** The pre-debate verdict the persona authored before the debate. */
  readonly preReviewVerdict: 'ready' | 'needs-revision' | 'block'
  /** The pre-debate Final score the persona authored. */
  readonly preReviewScore: number
  /** The pre-debate findings carried in the canonical REVIEW.md. */
  readonly preReviewFindings: readonly ReviewFinding[]
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
    case 'review_panel_resume_mismatch':
      return Object.freeze([
        'Partial panel staging exists from a prior session, and either no review_panel_completed event matches the round OR the canonical REVIEW.md sha256 does not match the recorded event sha.',
        'Inspect .code-oz/runs/<runId>/review-panel/round-<N>/ for per-panelist staging drafts.',
        'Inspect .code-oz/artifacts/REVIEW.md against the review_panel_completed event in events.jsonl; restore the canonical artifact or clear the staging dir before retrying the round.',
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
    case 'debate_scheduler_auth_missing':
      return Object.freeze([
        'The opposing provider for the scheduler-fired debate could not authenticate.',
        'Configure the provider credentials (CLI OAuth or API-key env var) before re-running.',
        'Inspect events.jsonl for the underlying provider_auth_missing or provider_auth_expired code.',
      ])
    case 'debate_scheduler_permissions_violation':
      return Object.freeze([
        'requestDebate rejected the scheduler-fired debate at runtime: the cross-family invariant or persona permission check failed.',
        "Verify the reviewer persona's tool_use.debate.opposingProviders entries and that none equal the reviewer's own family.",
      ])
    case 'debate_scheduler_concurrent_limit':
      return Object.freeze([
        'Another debate is in flight for this run, exceeding maxConcurrent=1.',
        'Wait for the in-flight debate to resolve or inspect events.jsonl for an orphaned debate_started without debate_resolved.',
      ])
    case 'debate_scheduler_topic_collision':
      return Object.freeze([
        'The scheduler chose a debate topic that collides with an existing per-run debate dir or events.jsonl entry.',
        'Inspect .code-oz/runs/<runId>/artifacts/debates/ and remove the conflicting topic dir, or restart the run.',
      ])
    case 'debate_scheduler_manifest_blocked':
      return Object.freeze([
        'The debate file manifest was blocked by .code-ozignore policy or path-safety.',
        "Inspect the persona's tool_use.debate.maxFiles cap and the manifest preview at .code-oz/runs/<runId>/artifacts/debates/<topic>/MANIFEST.preview.md.",
        'Adjust .code-ozignore exclusions or raise maxFiles only after explicit operator approval.',
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

/**
 * Scheduler-hook activation flag for the lock-free round body.
 *
 * 'enabled' (default): the post-verdict scheduler hook (step 14b) runs.
 *   This is the only flag value used today; M15 Phase 2 commit C13b will
 *   pass 'disabled_post_debate' for the post-debate REVIEW round invoked
 *   by the production fire-path executor, so a grey-zone post-debate
 *   verdict does not recursively schedule another debate.
 *
 * 'disabled_post_debate': the scheduler hook is skipped on this round.
 *   Reserved for the post-debate REVIEW round (C13b). Today no caller
 *   passes this value; the flag exists for forward compatibility.
 */
type SchedulerEnabledFlag = 'enabled' | 'disabled_post_debate'

interface RunReviewRoundLockedOptions extends RunReviewOptions {
  readonly schedulerEnabled: SchedulerEnabledFlag
}

/** Successful round completion. Carries the locals step 15 (terminal
 *  branching: ready / block / needs-revision) consumes. The locked body
 *  never writes terminal events itself — `finalizeReviewRound` is the
 *  authority for `review_resolved`, `review_blocked`, scientist-tail,
 *  gate-required, and remediation. */
interface RoundCompleteOutcome {
  readonly kind: 'round_complete'
  readonly attempt: number
  readonly verdict: 'ready' | 'needs-revision' | 'block'
  readonly personaScore: number
  readonly reviewReportPath: string
  readonly reviewReportSha256: string
  readonly canonical: {
    readonly findings: readonly ReviewFinding[]
    readonly reopenedIds: readonly string[]
  }
  readonly buildReportValidationCommand: string
  readonly interventionCtx: InterventionContext
}

/** Result of the lock-free round body. Either a successful round
 *  (`RoundCompleteOutcome`, narrowed by `kind: 'round_complete'`) that
 *  the caller passes to `finalizeReviewRound`, or a `ReviewResult` that
 *  the caller returns unchanged (intervention from steps 1-13, or the
 *  panel-branch's terminal status). */
type RoundLockedResult = RoundCompleteOutcome | ReviewResult

async function runReviewInner(
  opts: RunReviewOptions,
  now: () => string,
): Promise<ReviewResult> {
  const round = await runReviewRoundLocked(
    { ...opts, schedulerEnabled: 'enabled' },
    now,
  )
  if (!('kind' in round)) return round
  return finalizeReviewRound(round, opts, now)
}

/**
 * Lock-free single-mode REVIEW round body (steps 1-14b + draft cleanup).
 *
 * Authority: produces the canonical REVIEW.md artifact and emits the
 * `review_round_completed` event for this round. Optionally invokes the
 * post-verdict scheduler hook (step 14b) when `schedulerEnabled` is
 * 'enabled'. NEVER writes terminal events (`review_resolved`,
 * `review_blocked`), never invokes the scientist phase-tail, never
 * writes the operator-facing gate. Those effects live in
 * `finalizeReviewRound` so the M15 fire path (commit C13b) can settle
 * the scheduler decision before the gate result is locked in.
 *
 * The function presumes `runReview` already holds `.review.lock`. It
 * does not acquire any lock state itself, so the production fire-path
 * executor (C13b) can re-invoke it for the post-debate REVIEW round
 * without colliding on `.review.lock` (Codex R0 Risk #4 closure).
 */
async function runReviewRoundLocked(
  opts: RunReviewRoundLockedOptions,
  now: () => string,
): Promise<RoundLockedResult> {
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
    // Codex M14 R2 finding #2 closure: refuse to replay a panel round
    // that has partial staging from a prior crashed session. The
    // single-mode `probeReviewResume` only inspects `review-drafts/`;
    // panel mode writes per-panelist staging under
    // `review-panel/round-<N>/panelist-*.md`. If those files are
    // present without a matching `review_panel_completed` event, the
    // staging-vs-canonical authority guarantee in REVIEW_PANEL.md
    // would be violated by re-invoking panelist 0.
    const panelProbe = await probePanelResume({
      runDir: opts.runPaths.runDir,
      events,
      taskId: opts.taskId,
      attempt,
      round: opts.round,
      reviewReportPath: join(opts.runPaths.artifactRoot, 'REVIEW.md'),
    })
    if (panelProbe.mismatched) {
      const reasonText =
        panelProbe.reason === 'sha_mismatch'
          ? `review_panel_completed event exists for round=${opts.round} but its reviewReportSha256 does not match the on-disk REVIEW.md (or REVIEW.md is missing)`
          : `no review_panel_completed event for round=${opts.round}`
      return recordReviewIntervention(
        ictx,
        'review_panel_resume_mismatch',
        `partial panel staging exists at ${panelProbe.stagingDir} (${panelProbe.stagingFileCount ?? 0} panelist file(s)); ${reasonText}`,
        undefined,
        panelProbe.stagingDir,
      )
    }
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
    postDebateEvidence: opts.postDebateEvidence ?? null,
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

  // The pre-debate RoundCompleteOutcome the round body produced. When the
  // M15 fire path runs and converges on a `success` post-debate REVIEW
  // round, the executor closure overwrites this reference so the value
  // returned from `runReviewRoundLocked` reflects the post-debate state.
  let outcome: RoundCompleteOutcome = {
    kind: 'round_complete',
    attempt,
    verdict,
    personaScore,
    reviewReportPath,
    reviewReportSha256,
    canonical: {
      findings: canonical.findings,
      reopenedIds: canonical.reopenedIds,
    },
    buildReportValidationCommand: buildReport.validationCommand.command,
    interventionCtx: ictx,
  }

  // 14b. Post-verdict scheduler hook (single mode).
  //
  // Phase 1 (commit 4a) shipped the evaluate-only hook: always emits
  // `debate_scheduler_evaluated`, plus `debate_scheduler_skipped` for skip
  // decisions; fire decisions degraded to no-op because no executor was
  // wired. M15 Phase 2 C13b wires the production executor here. The
  // executor closure selects the opposing provider, builds the debate
  // request, calls `requestDebate`, then re-invokes
  // `runReviewRoundLocked` recursively with
  // `schedulerEnabled: 'disabled_post_debate'` so the post-debate REVIEW
  // round runs inside the same outer `.review.lock` envelope (Codex R0
  // Risk #4 closure) and cannot itself trigger another debate (Codex
  // replan Risk #5 closure).
  //
  // The recursive call replaces the canonical `REVIEW.md` for this same
  // round number and emits a SECOND `review_round_completed` event for
  // the same round (per `m15_phase2_replan.md` § "Locked semantic
  // decision"). Reducers distinguish via the `debate_scheduler_postreview`
  // event's `preReviewReportSha256 → postReviewReportSha256` link.
  //
  // schedulerEnabled === 'disabled_post_debate' callers skip this hook
  // entirely so a grey-zone post-debate verdict does not recursively
  // schedule another debate.
  if (opts.schedulerEnabled === 'enabled') {
    const eventsForScheduler = await readEvents(eventPathsFor(opts.runPaths))

    // Aggregate budget preflight (Codex R1 #2 closure). Refuses-before-
    // fire when the full scheduler transaction (opposing turn + synthesis
    // turn + post-debate REVIEW round) would tip a `budgets.global` cap.
    // The mid-debate `assertWithinBudget` chokepoints stay as the per-
    // call backstop; this is the gate.
    const preflightInput = buildSchedulerPreflightInputForSingle()
    const preflight = aggregateDebateSchedulerPreflight(
      opts.invokeCtx.config,
      preflightInput,
      eventsForScheduler,
      new Date(now()),
    )

    // Closure-captured pre-debate state. The opposing provider reads the
    // canonical REVIEW.md path from disk via the wrapper's manifest
    // resolution; that read happens BEFORE the recursive runReview round
    // overwrites the file. The pre-debate findings + verdict + score are
    // surfaced to the post-debate persona via `postDebateEvidence` and
    // the diff helper compares them against the post-debate findings.
    const preDebateFindings: readonly ReviewFinding[] = canonical.findings
    const preDebateVerdict = verdict
    const preDebateScore = personaScore
    const preDebateReviewSha = reviewReportSha256

    // Closure-captured post-debate outcome. The hook's executor seam
    // returns a `SchedulerFirePathResult` (success / error_degrade /
    // intervention); when status==='success', the executor stashes the
    // post-debate `RoundCompleteOutcome` here so the caller can swap it
    // for the pre-debate outcome before returning to `finalizeReviewRound`.
    let postDebateOutcome: RoundCompleteOutcome | null = null

    const executor: SchedulerFirePathExecutor = async (input, hooks) => {
      // 1. Eligibility filter (M11). The pure decision function only
      //    checks `length > 0` on opposingProviders; runtime capability
      //    + cross-family vs reviewer-family filtering happens here.
      const opposing = selectEligibleOpponent(opts.reviewerAgent, opts.invokeCtx.registry)
      if (opposing === null) {
        return {
          status: 'error_degrade',
          opposingProvider: 'unknown',
          debateTopic: 'unknown',
          errorReason: 'other',
          underlyingErrorCode: 'no_eligible_opponent',
        } satisfies SchedulerFirePathResult
      }

      // 2. Topic + briefing + manifest. Authored mechanically from the
      //    pre-debate REVIEW state (rule-21 reproducibility).
      const debateTopic = buildDebateTopicForReview({
        taskId: opts.taskId,
        attempt: input.attempt,
        round: opts.round,
      })
      const briefingSections = buildDebateBriefingSections({
        reviewerAgent: opts.reviewerAgent,
        opposingProvider: opposing,
        round: opts.round,
        attempt: input.attempt,
        taskId: opts.taskId,
        preReviewVerdict: preDebateVerdict,
        preReviewScore: preDebateScore,
        preReviewFindings: preDebateFindings,
        buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
        verifyReportPath: '.code-oz/artifacts/VERIFY.md',
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        changedFilePaths: changedFilePaths as readonly string[],
        fireReason: input.fireReason,
      })
      const personaDebatePerm = opts.reviewerAgent.permissions.tool_use?.debate
      const filesPaths = buildDebateFilesManifest({
        buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
        verifyReportPath: '.code-oz/artifacts/VERIFY.md',
        reviewReportPath: '.code-oz/artifacts/REVIEW.md',
        changedFilePaths: changedFilePaths as readonly string[],
        maxFiles: personaDebatePerm?.maxFiles ?? 16,
      })

      // 3. C13a contract: emit `fired` BEFORE invoking `requestDebate`.
      //    `requestDebate` synchronously appends `debate_started` inside
      //    its body, so without this seam the trace would be
      //    `evaluated → debate_started → fired`, breaking the resume
      //    contract in `docs/contracts/DEBATE_POLICY.md` § "Resume
      //    semantics".
      await hooks.emitFired({ opposingProvider: opposing, debateTopic })

      // 4. Run the debate. Drain all yielded ProviderEvents (they flow
      //    through invokeAgent's appendEvent chokepoint already).
      let runner
      try {
        runner = requestDebate(opts.invokeCtx, {
          caller: opts.reviewerAgent,
          phase: 'review',
          topic: debateTopic,
          opposingProvider: opposing,
          question: 'Did the cross-family REVIEW miss a bug or misweight a finding? Reconsider the verdict given the changed-file manifest.',
          files: filesPaths.map((p) => ({ path: p })),
          runId: opts.runId,
          date: now().slice(0, 10),
          callerLabel: opts.reviewerAgent.name,
          targetLabel: opposing,
          cycle: 'review',
          status: 'review',
          briefingSections,
          projectRoot: opts.invokeCtx.projectRoot,
          resolvedBy: `${opts.reviewerAgent.name} (REVIEW debate scheduler, round ${opts.round})`,
          readySignal: REVIEW_READY_SIGNAL,
        })
        for await (const _ev of runner) {
          // ProviderEvents already flow through invokeAgent's
          // appendEvent chokepoint; the orchestrator does not mirror.
        }
      } catch (err) {
        return mapProviderErrorToFireResult(err, opposing, debateTopic)
      }

      const debateResult = runner.result()
      if (debateResult === null) {
        return {
          status: 'error_degrade',
          opposingProvider: opposing,
          debateTopic,
          errorReason: 'other',
          underlyingErrorCode: 'debate_runtime_no_result',
        } satisfies SchedulerFirePathResult
      }

      // 5. Read DECISION.md (the synthesis turn wrote it atomically).
      let decisionMd: string
      try {
        decisionMd = await readFile(debateResult.decisionPath, 'utf8')
      } catch (err) {
        return {
          status: 'error_degrade',
          opposingProvider: opposing,
          debateTopic,
          errorReason: 'artifact_invalid',
          underlyingErrorCode: errorDetail(err),
        } satisfies SchedulerFirePathResult
      }

      // 6. Recursively run the post-debate REVIEW round. The recursive
      //    call MUST NOT acquire `.review.lock` (it stays inside this
      //    invocation's outer lock envelope) and MUST NOT itself trigger
      //    the scheduler hook (Codex replan Risk #5). The DECISION.md
      //    + pre-debate findings/score/verdict are passed through
      //    `postDebateEvidence` so the persona can reconsider.
      const postDebateOpts: RunReviewRoundLockedOptions = {
        ...opts,
        schedulerEnabled: 'disabled_post_debate',
        postDebateEvidence: {
          decisionPath: debateResult.decisionPath,
          decisionMd,
          preReviewVerdict: preDebateVerdict,
          preReviewScore: preDebateScore,
          preReviewFindings: preDebateFindings,
        },
      }
      const postRound = await runReviewRoundLocked(postDebateOpts, now)
      if (!('kind' in postRound) || postRound.kind !== 'round_complete') {
        // The post-debate round produced an intervention (e.g. validation
        // failure on the persona's response). Surface as error_degrade so
        // the gate writes from the pre-debate verdict; the post-debate
        // intervention itself is already recorded via
        // `recordReviewIntervention` and surfaces in events.jsonl.
        return {
          status: 'error_degrade',
          opposingProvider: opposing,
          debateTopic,
          errorReason: 'other',
          underlyingErrorCode: 'post_debate_round_intervention',
        } satisfies SchedulerFirePathResult
      }

      // 7. Stash the post-debate outcome for the outer caller and report
      //    finding deltas to the hook so it can emit
      //    `debate_scheduler_postreview` with non-zero scalars.
      postDebateOutcome = postRound
      const diff = diffFindingsForPostDebateBasic(
        preDebateFindings,
        postRound.canonical.findings,
      )
      return {
        status: 'success',
        opposingProvider: opposing,
        debateTopic,
        newReviewReportSha256: postRound.reviewReportSha256,
        verdictPost: postRound.verdict,
        findingsAddedCount: diff.findingsAddedCount,
        actionableFindingsAddedCount: diff.actionableFindingsAddedCount,
      } satisfies SchedulerFirePathResult
    }

    const hookResult = await runReviewSchedulerHook({
      runId: opts.runId,
      taskId: opts.taskId,
      attempt,
      reviewRound: opts.round,
      phase: 'review',
      agent: opts.reviewerAgent.name,
      reviewerAgent: opts.reviewerAgent,
      preReviewReportSha256: preDebateReviewSha,
      reviewState: {
        mode: 'single',
        score: personaScore,
        verdict,
      },
      debatePolicyFromConfig: opts.invokeCtx.config.debatePolicy,
      buildReportChangedFileCount: buildReport.changedFiles.length,
      events: eventsForScheduler,
      eventPaths: eventPathsFor(opts.runPaths),
      now,
      firePathExecutor: executor,
      aggregatePreflightWouldTip: preflight.wouldTip,
      ...(preflight.tipReason !== undefined
        ? { aggregatePreflightTipReason: preflight.tipReason }
        : {}),
    })

    // Post-hook branch:
    //   - intervention: clean up drafts + write NEEDS_INTERVENTION + return
    //     ReviewIntervention immediately. Pre-debate REVIEW.md remains
    //     canonical, but no gate write happens (caller halts the run).
    //   - success: the recursive call already replaced REVIEW.md and
    //     emitted a second `review_round_completed`; swap `outcome` for
    //     the post-debate one so `finalizeReviewRound` consumes the
    //     post-debate verdict for gate writes.
    //   - error_degrade or no fire: keep the pre-debate `outcome` so
    //     gate writes proceed from the pre-debate verdict (DEBATE_POLICY
    //     § "Failure surface" guarantees: degraded fires fall back).
    if (hookResult.fireOutcome.fired && hookResult.fireOutcome.result?.status === 'intervention') {
      const r = hookResult.fireOutcome.result
      await cleanupReviewDraftsForRound([draftAttempt1Path, draftAttempt2Path])
      return recordReviewIntervention(
        ictx,
        r.interventionCode,
        r.interventionRule,
        r.underlyingErrorCode,
      )
    }
    if (hookResult.fireOutcome.fired && hookResult.fireOutcome.result?.status === 'success' && postDebateOutcome !== null) {
      outcome = postDebateOutcome
    }
  }

  // Clean up the round's draft directory now that the canonical write
  // succeeded — drafts only have value when there is no canonical output.
  await cleanupReviewDraftsForRound([draftAttempt1Path, draftAttempt2Path])

  return outcome
}

/**
 * Step 15 — terminal branching for a successfully completed REVIEW round.
 *
 * Owns the `review_resolved` / `review_blocked` events, the scientist
 * phase-tail invocation, the gate-preflight + `requireGate` write, and
 * the remediation coordinator dispatch for needs-revision verdicts.
 * Separated from the round body (M15 Phase 2 C12) so the scheduler
 * fire-path executor (C13b) can run a post-debate REVIEW round and
 * settle its result before the terminal effects lock in.
 */
async function finalizeReviewRound(
  round: RoundCompleteOutcome,
  opts: RunReviewOptions,
  now: () => string,
): Promise<ReviewResult> {
  const {
    attempt,
    verdict,
    personaScore,
    reviewReportPath,
    reviewReportSha256,
    canonical,
    buildReportValidationCommand,
    interventionCtx: ictx,
  } = round

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
    priorValidationCommand: buildReportValidationCommand,
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
  /** M15 Phase 2 C13b: when present, the post-debate REVIEW round prompt
   *  surfaces DECISION.md content + the pre-debate verdict the persona
   *  is being asked to reconsider. */
  readonly postDebateEvidence: PostDebateEvidence | null
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
  if (input.postDebateEvidence !== null) {
    // M15 Phase 2 C13b: post-debate REVIEW round. The orchestrator's
    // debate-policy scheduler fired a cross-family debate after the
    // pre-debate verdict landed in this same round number. The persona is
    // re-invoked with the debate's DECISION.md as evidence and may revise
    // their findings + score. REVIEW remains the gate authority; DECISION
    // is evidence, not a vote.
    const ev = input.postDebateEvidence
    lines.push('### Pre-debate verdict (your prior take this round)')
    lines.push(
      `- Verdict: ${ev.preReviewVerdict} | Final score: ${ev.preReviewScore}`,
    )
    if (ev.preReviewFindings.length === 0) {
      lines.push('- Findings: (none)')
    } else {
      lines.push('- Findings:')
      for (const f of ev.preReviewFindings) {
        const status =
          f.roundResolved === 'unresolved' ? 'unresolved' : `resolved round ${f.roundResolved}`
        lines.push(
          `  - ${f.id} | ${f.severity} | ${f.file}:${f.line} | ${status} | ${f.title}`,
        )
      }
    }
    lines.push('')
    lines.push('### Cross-family debate evidence (DECISION.md)')
    lines.push(`- Source: ${ev.decisionPath}`)
    lines.push(
      'The orchestrator ran a cross-family debate against your pre-debate verdict. The opposing provider authored RESPONSE.<side>.md, and the caller persona synthesized DECISION.md below. Reconsider your findings + score in light of this evidence. You may revise the verdict; you may also stand by it. REVIEW remains the gate authority — DECISION is data, not a vote.',
    )
    lines.push('')
    lines.push('```')
    lines.push(ev.decisionMd.trimEnd())
    lines.push('```')
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

  // M15 commit 4a — post-verdict scheduler evaluate hook (panel mode).
  // Fires after `review_panel_completed` is on disk and panelData is parsed,
  // before the resolved/needs_revision/blocked branch. Always emits
  // `debate_scheduler_evaluated`; emits `debate_scheduler_skipped` for skip
  // decisions. NO fire path yet (commit 4b).
  const panelistVerdictsForScheduler: readonly PanelistVerdictSnapshot[] =
    panelData.reviewers.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      authorityImpact: r.role,
    }))
  const eventsForPanelScheduler = await readEvents(eventPathsFor(opts.runPaths))
  await runReviewSchedulerHook({
    runId: opts.runId,
    taskId: opts.taskId,
    attempt,
    reviewRound: opts.round,
    phase: 'review',
    agent: opts.reviewerAgent.name,
    reviewerAgent: opts.reviewerAgent,
    preReviewReportSha256: panelResult.reviewReportSha256,
    reviewState: {
      mode: 'panel',
      panelistVerdicts: panelistVerdictsForScheduler,
    },
    debatePolicyFromConfig: opts.invokeCtx.config.debatePolicy,
    buildReportChangedFileCount: buildReport.changedFiles.length,
    events: eventsForPanelScheduler,
    eventPaths: eventPathsFor(opts.runPaths),
    now,
  })

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
