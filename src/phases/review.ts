// REVIEW phase orchestration (M9 commit 7).
//
// Mirrors src/phases/verify.ts ordering:
//
//   1. Read BUILD_REPORT.md (changed-file manifest + base/patch refs)
//   2. Read VERIFY.md (verdict.verdict must be 'pass' to enter REVIEW)
//   3. Read prior REVIEW.md when round > 1 (commit 10 path)
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
//        needs-revision → return { status: 'needs_revision' }. Multi-round
//                         remediation is M9 commit 10's job; this orchestrator
//                         must NOT call scheduleAttemptNPlus1 (that function
//                         is VERIFY-specific, kickoff Decision 1).
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
// hook (preApproveReviewHook, commit 1) removes the worktree when the
// operator runs `code-oz approve review`. runReview keeps the worktree
// alive so REVIEW (and a remediating BUILD attempt N+1 in commit 10)
// can read changed files.
//
// Tested in tests/review-phase.test.ts.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
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
  REVIEW_SEVERITIES,
  REVIEW_TITLE_MAX_CHARS,
  REVIEW_RECOMMENDATION_MAX_CHARS,
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
import { familyOf } from '../providers/families.ts'
import type { ProviderId } from '../providers/types.ts'
import {
  appendEvent,
  readEvents,
  type EventLogPaths,
} from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
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
  readonly now?: () => string
  /** REVIEW round being driven (1 in commit 7; 2..4 will arrive via
   *  review-remediation.ts in commit 10). Validated against REVIEW_ROUND_CAP. */
  readonly round: number
  /** Prior canonical REVIEW.md content when round > 1. `null` for round 1.
   *  Commit 7 always passes null; commit 10 wires the carry. */
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
  /** Remediation decision from review-remediation.ts (M9 commit 10).
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
    default:
      return Object.freeze(['Inspect REVIEW.md, events.jsonl, and the relevant draft directory.'])
  }
}

// --- main entry point ---------------------------------------------

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
      `BUILD_REPORT.md not readable: ${(err as Error).message.slice(0, 200)}`,
    )
  }
  const buildReportSha256 = SHA(buildReportText)
  let buildReport: ReturnType<typeof parseBuildReport>
  try {
    buildReport = parseBuildReport(buildReportText)
  } catch (err) {
    const reason =
      err instanceof BuildReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
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
      `VERIFY.md not readable: ${(err as Error).message.slice(0, 200)}`,
    )
  }
  const verifyReportSha256 = SHA(verifyReportText)
  let verifyReport: ReturnType<typeof parseVerifyReport>
  try {
    verifyReport = parseVerifyReport(verifyReportText)
  } catch (err) {
    const reason =
      err instanceof VerifyReportLoadError
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
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
  // M9 commit 13 bp#2 (Codex review): VERIFY.md and BUILD_REPORT.md must
  // also agree on the upstream commit + patch refs. Same task/attempt
  // does not prove same patch — a misrouted VERIFY pass against a
  // different patch would otherwise be blessed by REVIEW.
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

  // 3. Read prior REVIEW.md when round > 1. Commit 7 only sees round=1.
  // Resume mismatch (kickoff Decision 10) is checked against the
  // review-drafts directory below.
  let priorReport: ReviewReportData | null = null
  if (opts.round > 1 && opts.priorReviewMd != null) {
    try {
      priorReport = parseReviewReport(opts.priorReviewMd)
    } catch (err) {
      // Prior REVIEW.md should already be canonical; corruption is a routing bug.
      const reason =
        err instanceof ReviewReportLoadError
          ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
          : (err as Error).message.slice(0, 200)
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
  })
  if (probe.mismatched) {
    return recordReviewIntervention(
      ictx,
      'review_resume_mismatch',
      `partial draft exists at ${probe.draftPath} but no review_round_completed event for round=${opts.round}`,
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
  const reviewerFamily = familyOf(opts.reviewerAgent.provider as ProviderId)
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
  const canonical = canonicalizeFindings({
    draftFindings: repairResult.findings,
    priorFindings,
    round: opts.round,
  })

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
        ? err.issues.map((i) => `${i.code}: ${i.rule}`).join('; ').slice(0, 200)
        : (err as Error).message.slice(0, 200)
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
  // coordinator (M9 commit 10): runReview hands it the canonical
  // findings + REVIEW.md ref + the prior validation command and
  // receives a ReviewRemediationDecision. Two outcomes alter
  // runReview's terminal status:
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
  if (!Number.isInteger(finalScore) || finalScore < 0 || finalScore > 10) {
    return {
      ok: false,
      violation: '`## Score.Final score` must be an integer in [0, 10]',
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
    if (!(REVIEW_SEVERITIES as readonly string[]).includes(severity)) {
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
        severity: severity as ReviewSeverity,
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
      reason: (err as Error).message.slice(0, 200),
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
      reason: `repair turn threw: ${(err as Error).message.slice(0, 200)}`,
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

// --- intentionally exported for tests + future commits ------------

export {
  // The fingerprint helper is re-exported so commit 10's remediation
  // coordinator can compute fingerprints over carry-forward findings
  // without re-importing review-report.ts directly.
  fingerprintFinding,
}
export type { ReviewFinding, ReviewReportData, ReviewVerdict, ReviewSeverity }
