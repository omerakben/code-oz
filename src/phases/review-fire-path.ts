// M15 Phase 2 C13b — pure helpers for the REVIEW production fire path.
//
// These functions support the closure-based `firePathExecutor` wired in
// `runReviewRoundLocked` step 14b. They are extracted from review.ts to
// keep the orchestration body manageable; each helper is pure and tested
// in isolation. The closure itself stays inline in review.ts because the
// post-debate REVIEW round is invoked through the private
// `runReviewRoundLocked` function (Codex Risk #4 closure: the recursive
// call must NOT re-acquire `.review.lock`, so it cannot go through the
// public `runReview` entry point).
//
// Authority surface:
//   - `selectEligibleOpponent`: filters reviewer's declared
//     `opposingProviders` by M11 capability eligibility (`eligiblePhases`
//     includes 'review') AND by cross-family vs the reviewer's own
//     family. Drops the BUILD-family-exclusion clause per M15 Phase 2 A1
//     lock (`docs/research/CODEX_RESPONSE_M15_REPLAN.md` § Q2): rule 2
//     already enforces BUILD vs REVIEW cross-family at the gate; debate
//     opponent only needs to differ from REVIEW family.
//   - `buildDebateTopicForReview`: deterministic topic derivation from
//     (taskId, attempt, round). Lowercase-kebab, ≤48 chars, unique within
//     run for the (taskId, attempt, round) tuple. requestDebate's per-run
//     topic-uniqueness invariant (D7 lock) is preserved.
//   - `buildDebateBriefingSections`: assembles the seven H2 sections
//     `DebateRequestInput.briefingSections` requires. Section content is
//     derived mechanically from REVIEW state — the reviewer is not
//     re-prompted for the briefing.
//   - `diffFindingsForPostDebateBasic`: id-based finding diff for the
//     `findingsAddedCount` / `actionableFindingsAddedCount` scalars
//     `debate_scheduler_postreview` carries. Severity filter:
//     {block, fix-first} only. C15 will replace this with a richer
//     fingerprint+severity diff helper; the surface is stable.
//   - `mapProviderErrorToFireResult`: translates a `requestDebate` failure
//     (or arbitrary executor exception) into either an `intervention`
//     status (operator-actionable: auth, permissions, concurrent limit,
//     topic collision, manifest blocked) or an `error_degrade` status
//     (artifact_invalid / transient_io / other). Mirrors the Failure
//     surface table in `docs/contracts/DEBATE_POLICY.md`.
//   - `buildSchedulerPreflightInputForSingle`: constructs the preflight
//     request shape for single-mode REVIEW. Conservative token estimates
//     keep the heuristic simple; `assertWithinBudget` chokepoints remain
//     the per-call backstop.

import type { AgentDefinition } from '../agents/schema.ts'
import { ProviderError } from '../providers/errors.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import type { ProviderFamily, ProviderId } from '../providers/types.ts'
import {
  fingerprintFinding,
  type ReviewFinding,
  type ReviewSeverity,
} from '../artifacts/review-report.ts'
import type { SchedulerFirePathResult } from './review-scheduler-hook.ts'
import type { SchedulerPreflightInput } from '../providers/cost.ts'
import { isKnownPhaseEvent, type LoggedEvent } from '../state/schemas.ts'

// Conservative single-turn token estimate. The aggregate preflight covers
// opposing + synthesis + post-debate REVIEW = 3 turns. Per-call
// `assertWithinBudget` chokepoints catch any actual overage. This is a
// refuse-before-fire heuristic, not a hard budget. C15 may refine.
const DEBATE_TURN_TOKEN_ESTIMATE = 20_000

/**
 * Pick the first opposingProvider declared on the reviewer that is also
 * (a) M11-eligible for the 'review' phase and (b) cross-family with the
 * reviewer's own provider family. Returns null when no candidate qualifies
 * — the caller surfaces this as `error_degrade` reason='other' with code
 * `no_eligible_opponent` (the persona-level eligibility gate inside the
 * pure scheduler decision function only checks `length > 0`; runtime M11
 * filtering must happen here in the executor).
 *
 * Drops the BUILD-family-exclusion clause that M15 Phase 1 implied per
 * `docs/design/SESSION_M15_IMPL_KICKOFF.md`. The replan A1 lock makes
 * REVIEW-family != opposing-family the only load-bearing invariant; rule 2
 * already enforces BUILD-family != REVIEW-family at the REVIEW gate, and
 * the bundled reviewer intentionally allows a BUILD-family opponent so the
 * BUILD-favorable side has a steel-manning voice.
 */
export function selectEligibleOpponent(
  reviewer: AgentDefinition,
  registry: ProviderRegistry,
): ProviderId | null {
  const debate = reviewer.permissions.tool_use?.debate
  if (debate === undefined) return null
  const reviewerFamily = registry.familyOf(reviewer.provider as ProviderId)
  for (const candidateFamily of debate.opposingProviders) {
    // ProviderFamily and ProviderId share string values in v0.1 (the load-
    // time validator at src/agents/schema.ts:402-424 enforces opposingProviders
    // entries are PROVIDER_FAMILIES strings, which are identical to the
    // PROVIDER_IDS set in src/providers/types.ts).
    const candidateId = candidateFamily as unknown as ProviderId
    let cap
    try {
      cap = registry.capabilityOf(candidateId)
    } catch {
      // Unknown id at runtime (overrides removed it). Skip.
      continue
    }
    if (!cap.eligiblePhases.includes('review')) continue
    let candidateFam: ProviderFamily
    try {
      candidateFam = registry.familyOf(candidateId)
    } catch {
      continue
    }
    if (candidateFam === reviewerFamily) continue
    return candidateId
  }
  return null
}

/**
 * Build the per-(taskId, attempt, round) debate topic. Lowercase-kebab,
 * ≤48 chars. The format encodes round + attempt so multi-round runs do
 * not collide on requestDebate's per-run topic-uniqueness invariant.
 */
export function buildDebateTopicForReview(input: {
  readonly taskId: string
  readonly attempt: number
  readonly round: number
}): string {
  // Allow a-z, 0-9, hyphen; collapse other characters to '-'; trim leading
  // hyphens; cap to 24 chars so the prefix has room.
  const taskShort =
    input.taskId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .slice(0, 24) || 'task'
  const topic = `review-r${input.round}-a${input.attempt}-${taskShort}`
  return topic.slice(0, 48)
}

export interface DebateBriefingSectionInputs {
  readonly reviewerAgent: AgentDefinition
  readonly opposingProvider: ProviderId
  readonly round: number
  readonly attempt: number
  readonly taskId: string
  readonly preReviewVerdict: 'ready' | 'needs-revision' | 'block'
  readonly preReviewScore: number
  readonly preReviewFindings: readonly ReviewFinding[]
  readonly buildReportPath: string
  readonly verifyReportPath: string
  readonly reviewReportPath: string
  readonly changedFilePaths: readonly string[]
  readonly fireReason: 'score_in_grey_zone' | 'needs_revision_with_high_score' | 'panel_voter_disagreement'
}

export interface DebateBriefingSections {
  readonly whatYouAreReading: string
  readonly whereWeStand: string
  readonly whatIsLocked: string
  readonly whatIsUpForDebate: string
  readonly recommendedPath: string
  readonly decisionPrompts: string
  readonly whatIWantFromYou: string
}

/**
 * Mechanical briefing-section assembly. The reviewer never re-prompts for
 * these; the orchestrator authors them deterministically from the REVIEW
 * state at fire time so the rule-21 baseline is reproducible.
 */
export function buildDebateBriefingSections(
  input: DebateBriefingSectionInputs,
): DebateBriefingSections {
  const findingsList =
    input.preReviewFindings.length === 0
      ? '- (no findings raised)'
      : input.preReviewFindings
          .map(
            (f) =>
              `- ${f.id} | ${f.severity} | ${f.file}:${f.line} | ${f.title}`,
          )
          .join('\n')
  const reasonLine = renderFireReasonForBriefing(input)
  return Object.freeze({
    whatYouAreReading: [
      `Cross-family debate request for REVIEW round ${input.round} of task ${input.taskId} (attempt ${input.attempt}).`,
      `Caller persona: ${input.reviewerAgent.name} (${input.reviewerAgent.provider}). Opposing provider: ${input.opposingProvider}.`,
      `${reasonLine} The orchestrator's debate-policy scheduler decided this verdict warrants a cross-family challenge before the REVIEW gate locks in.`,
    ].join('\n\n'),
    whereWeStand: [
      `Pre-debate REVIEW verdict: ${input.preReviewVerdict} (score=${input.preReviewScore}).`,
      'Findings:',
      findingsList,
      `Upstream artifacts: ${input.buildReportPath}, ${input.verifyReportPath}, ${input.reviewReportPath}.`,
      `Changed files (count=${input.changedFilePaths.length}): see BUILD_REPORT.md manifest.`,
    ].join('\n\n'),
    whatIsLocked: [
      'REVIEW gate authority belongs to the orchestrator. Your DECISION.md is evidence the post-debate REVIEW round will consider; it is NOT a gate decision (CLAUDE.md non-negotiable rule 1: file-based gate signals only).',
      'Cross-family invariant: your provider family must differ from the caller family. The runtime enforces this; if you contest the assignment, raise an `intervention` rather than authoring DECISION.md.',
      'Scope: do not propose architectural redesigns or test additions. Read the changed-file manifest, decide whether the reviewer missed bugs or misweighted findings, author RESPONSE.<your-side>.md.',
    ].join('\n\n'),
    whatIsUpForDebate: [
      `Did the reviewer miss bugs in the changed-file manifest? Did the reviewer misweight findings (block vs fix-first vs nit)? Should the verdict have been '${altVerdictsFor(input.preReviewVerdict)}' instead of '${input.preReviewVerdict}'?`,
    ].join('\n'),
    recommendedPath: [
      'Steel-man the side the reviewer rejected:',
      input.preReviewVerdict === 'needs-revision'
        ? '- If the score is in the high grey zone (>=6), argue the verdict should be `ready` because the findings are addressable in-place without a full BUILD attempt.'
        : input.preReviewVerdict === 'block'
          ? '- If the cited issue is fix-first severity, argue the verdict should be `needs-revision` instead of `block` so BUILD attempt N+1 can resolve it.'
          : '- If a correctness/security regression is in the changed files, argue the verdict should be `needs-revision` or `block`.',
      "The orchestrator wants your strongest counter-argument to the reviewer's call.",
    ].join('\n'),
    decisionPrompts: [
      "1. What is the strongest counter-argument to the reviewer's verdict?",
      '2. Are there bugs in the changed files the reviewer overlooked (correctness, readability, architecture, security, performance)?',
      '3. Should the verdict change, and if so, in which direction and why?',
    ].join('\n'),
    whatIWantFromYou: [
      "Author RESPONSE.<your-side>.md per the schema (Overall verdict + substantive rationale citing specific files in the manifest). Do not exact-copy reviewer findings — your rationale must be original analysis. The caller will then synthesize DECISION.md.",
    ].join('\n'),
  })
}

function renderFireReasonForBriefing(input: DebateBriefingSectionInputs): string {
  switch (input.fireReason) {
    case 'score_in_grey_zone':
      return `The reviewer raised score=${input.preReviewScore} in the grey zone (verdict='${input.preReviewVerdict}').`
    case 'needs_revision_with_high_score':
      return `The reviewer raised score=${input.preReviewScore} (>=6) but verdict='${input.preReviewVerdict}', which suggests the findings may be in-place addressable rather than gate-blocking.`
    case 'panel_voter_disagreement':
      return 'The voter panel disagreed on the verdict (panel mode).'
  }
}

function altVerdictsFor(v: 'ready' | 'needs-revision' | 'block'): string {
  switch (v) {
    case 'ready':
      return 'needs-revision or block'
    case 'needs-revision':
      return 'ready or block'
    case 'block':
      return 'needs-revision'
  }
}

const ACTIONABLE_SEVERITIES: ReadonlySet<ReviewSeverity> = new Set(['block', 'fix-first'])

/**
 * Severity rank for actionable-escalation detection. Higher rank = more
 * actionable. The rule-21 reducer cares whether the post-debate REVIEW
 * round produced NEW signal, so a fingerprint that was nit/fyi pre-debate
 * but escalated to fix-first/block post-debate counts as actionable
 * added — the post-debate reviewer realized the issue was load-bearing.
 */
const SEVERITY_RANK: Readonly<Record<ReviewSeverity, number>> = Object.freeze({
  fyi: 0,
  nit: 1,
  'fix-first': 2,
  block: 3,
})

function isEscalatedToActionable(
  preSeverity: ReviewSeverity | null,
  postSeverity: ReviewSeverity,
): boolean {
  if (!ACTIONABLE_SEVERITIES.has(postSeverity)) return false
  if (preSeverity === null) return true
  return SEVERITY_RANK[postSeverity] > SEVERITY_RANK[preSeverity]
}

/**
 * Fingerprint+severity diff for the rule-21 baseline reducer.
 *
 * Closes Codex R1 #5 (`docs/research/CODEX_REVIEW_M15.md`): the M15 Phase 1
 * `actionableFindingsAddedCount` scalar was authored from fixture JSONL
 * directly because no production code computed it from real pre/post
 * REVIEW artifacts. The post-debate event schema only validated the
 * scalar as a non-negative integer, so fixtures could lie. C15 wires the
 * production diff so the scalar becomes a derived measurement.
 *
 * Definitions (DEBATE_POLICY.md § "New-actionable-finding rate"):
 *   - findingsAddedCount: count of post-debate findings whose
 *     fingerprint (file + normalized title) does NOT appear in the pre-
 *     debate set.
 *   - actionableFindingsAddedCount: count of post-debate findings that
 *     are EITHER (a) new fingerprints with severity in {block, fix-first},
 *     OR (b) re-used fingerprints whose severity escalated FROM nit/fyi
 *     TO {block, fix-first} (the post-debate reviewer recognized a
 *     previously-cosmetic finding as load-bearing).
 *
 * Severity ranks: fyi=0, nit=1, fix-first=2, block=3. Same-rank or
 * lower-rank fingerprint reuse does NOT count as actionable added —
 * those are noise per Codex Q7.
 */
export function diffFindingsForPostDebate(
  pre: readonly ReviewFinding[],
  post: readonly ReviewFinding[],
): { findingsAddedCount: number; actionableFindingsAddedCount: number } {
  const preByFingerprint = new Map<string, ReviewSeverity>()
  for (const f of pre) {
    const fp = fingerprintFinding(f.file, f.title)
    // If duplicate fingerprints exist in pre (rare), keep the highest
    // severity so escalation detection compares against the strongest
    // pre-existing severity.
    const existing = preByFingerprint.get(fp)
    if (existing === undefined || SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing]) {
      preByFingerprint.set(fp, f.severity)
    }
  }
  let added = 0
  let actionableAdded = 0
  for (const f of post) {
    const fp = fingerprintFinding(f.file, f.title)
    const preSeverity = preByFingerprint.get(fp) ?? null
    if (preSeverity === null) {
      added++
      if (ACTIONABLE_SEVERITIES.has(f.severity)) actionableAdded++
    } else if (isEscalatedToActionable(preSeverity, f.severity)) {
      // Fingerprint reuse with severity escalation: counts as actionable
      // added but NOT as findingsAddedCount (it's the same finding, just
      // re-weighted).
      actionableAdded++
    }
  }
  return { findingsAddedCount: added, actionableFindingsAddedCount: actionableAdded }
}

/**
 * Map a `requestDebate` failure (or arbitrary executor exception) to a
 * `SchedulerFirePathResult`. Operator-actionable codes return
 * `status: 'intervention'`; degraded codes return `status: 'error_degrade'`
 * with a typed `errorReason`. Mirrors `docs/contracts/DEBATE_POLICY.md`
 * § "Failure surface".
 */
export function mapProviderErrorToFireResult(
  err: unknown,
  opposingProvider: string,
  debateTopic: string,
): SchedulerFirePathResult {
  if (err instanceof ProviderError) {
    const code = err.issues[0]?.code ?? 'other'
    switch (code) {
      case 'provider_auth_missing':
      case 'provider_auth_expired':
        return {
          status: 'intervention',
          opposingProvider,
          debateTopic,
          interventionCode: 'debate_scheduler_auth_missing',
          interventionRule:
            'opposing provider authentication missing or expired; configure credentials before re-running',
          underlyingErrorCode: code,
        }
      case 'provider_permissions_violation':
        return {
          status: 'intervention',
          opposingProvider,
          debateTopic,
          interventionCode: 'debate_scheduler_permissions_violation',
          interventionRule:
            'requestDebate cross-family or persona permission check failed at runtime',
          underlyingErrorCode: code,
        }
      case 'debate_concurrent_limit_exceeded':
        return {
          status: 'intervention',
          opposingProvider,
          debateTopic,
          interventionCode: 'debate_scheduler_concurrent_limit',
          interventionRule:
            'concurrent debate cap exceeded; resolve open debates before re-running',
          underlyingErrorCode: code,
        }
      case 'debate_topic_collision':
        return {
          status: 'intervention',
          opposingProvider,
          debateTopic,
          interventionCode: 'debate_scheduler_topic_collision',
          interventionRule:
            'debate topic collides with an existing debate dir or events.jsonl entry',
          underlyingErrorCode: code,
        }
      case 'debate_manifest_blocked':
        return {
          status: 'intervention',
          opposingProvider,
          debateTopic,
          interventionCode: 'debate_scheduler_manifest_blocked',
          interventionRule:
            'debate manifest blocked by .code-ozignore or path-safety; fix policy or raise maxFiles',
          underlyingErrorCode: code,
        }
      case 'debate_response_invalid':
      case 'debate_decision_invalid':
        return {
          status: 'error_degrade',
          opposingProvider,
          debateTopic,
          errorReason: 'artifact_invalid',
          underlyingErrorCode: code,
        }
      case 'provider_io_error':
      case 'provider_rate_limit':
        return {
          status: 'error_degrade',
          opposingProvider,
          debateTopic,
          errorReason: 'transient_io',
          underlyingErrorCode: code,
        }
      default:
        return {
          status: 'error_degrade',
          opposingProvider,
          debateTopic,
          errorReason: 'other',
          underlyingErrorCode: code,
        }
    }
  }
  // Non-ProviderError exception (e.g., synchronous throw from helper).
  // Treat as opaque degrade; the message is clipped for events.jsonl.
  const message =
    err instanceof Error ? err.message : String(err)
  return {
    status: 'error_degrade',
    opposingProvider,
    debateTopic,
    errorReason: 'other',
    underlyingErrorCode: message.slice(0, 200),
  }
}

/**
 * Single-mode preflight input. Token estimates use a conservative
 * per-turn default; the per-call `assertWithinBudget` chokepoint catches
 * actual overage. Post-review = 1 reviewer call (single mode).
 */
export function buildSchedulerPreflightInputForSingle(): SchedulerPreflightInput {
  return Object.freeze({
    phase: 'review' as const,
    role: 'reviewer',
    opposingMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE,
    synthesisMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE,
    postReviewMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE,
    postReviewProviderCalls: 1,
  })
}

/**
 * Panel-mode preflight input. Post-review = N reviewer calls (one per
 * panelist; manifest equality means every panelist sees the same files,
 * so per-panelist token estimate equals the single-mode reviewer's).
 *
 * v0.1 panel post-debate REVIEW round is debate-evidence-only (no full
 * panel re-run with DECISION.md surfaced to all panelists; deferred per
 * the replan locked in `docs/research/CODEX_RESPONSE_M15_REPLAN.md` —
 * "panel can contribute new-actionable and no-signal telemetry in M15").
 * The preflight still budgets for the would-be re-run so the gate is
 * honest about full-cost firing once the panel re-run lands.
 */
export function buildSchedulerPreflightInputForPanel(input: {
  readonly panelSize: number
}): SchedulerPreflightInput {
  return Object.freeze({
    phase: 'review' as const,
    role: 'reviewer',
    opposingMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE,
    synthesisMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE,
    postReviewMaxTokens: DEBATE_TURN_TOKEN_ESTIMATE * Math.max(1, input.panelSize),
    postReviewProviderCalls: Math.max(1, input.panelSize),
  })
}

export interface PanelBriefingSectionInputs {
  readonly reviewerAgent: AgentDefinition
  readonly opposingProvider: ProviderId
  readonly round: number
  readonly attempt: number
  readonly taskId: string
  readonly panelistVerdicts: readonly {
    readonly id: string
    readonly verdict: string
    readonly authorityImpact: string
  }[]
  readonly panelVerdict: 'ready' | 'needs-revision' | 'block'
  readonly preReviewFindings: readonly ReviewFinding[]
  readonly buildReportPath: string
  readonly verifyReportPath: string
  readonly reviewReportPath: string
  readonly changedFilePaths: readonly string[]
}

/**
 * Panel-mode briefing assembly. Mirrors the single-mode helper but
 * substitutes the "score=N" language with the per-panelist verdicts
 * (panel REVIEW has no numeric Score.Final score; the literal `panel`
 * sentinel is not oracle-comparable). Only fires from
 * `panel_voter_disagreement` per the pure scheduler decision function.
 */
export function buildDebatePanelBriefingSections(
  input: PanelBriefingSectionInputs,
): DebateBriefingSections {
  const findingsList =
    input.preReviewFindings.length === 0
      ? '- (no findings raised)'
      : input.preReviewFindings
          .map(
            (f) =>
              `- ${f.id} | ${f.severity} | ${f.file}:${f.line} | ${f.title}`,
          )
          .join('\n')
  const verdictsList = input.panelistVerdicts
    .map((p) => `- ${p.id} (${p.authorityImpact}): ${p.verdict}`)
    .join('\n')
  return Object.freeze({
    whatYouAreReading: [
      `Cross-family debate request for panel-mode REVIEW round ${input.round} of task ${input.taskId} (attempt ${input.attempt}).`,
      `Caller persona: ${input.reviewerAgent.name} (${input.reviewerAgent.provider}, panel orchestrator). Opposing provider: ${input.opposingProvider}.`,
      `The voter panel disagreed on the verdict (panel mode). Panel REVIEW has no single numeric score; the literal panel sentinel is not oracle-comparable. The orchestrator's debate-policy scheduler decided this disagreement warrants a cross-family challenge before the REVIEW gate locks in.`,
    ].join('\n\n'),
    whereWeStand: [
      `Synthesized panel verdict: ${input.panelVerdict}.`,
      'Per-panelist verdicts:',
      verdictsList,
      'Findings (synthesized across panelists):',
      findingsList,
      `Upstream artifacts: ${input.buildReportPath}, ${input.verifyReportPath}, ${input.reviewReportPath}.`,
      `Changed files (count=${input.changedFilePaths.length}): see BUILD_REPORT.md manifest.`,
    ].join('\n\n'),
    whatIsLocked: [
      'REVIEW gate authority belongs to the orchestrator. Your DECISION.md is evidence the post-debate REVIEW round will consider; it is NOT a gate decision (CLAUDE.md non-negotiable rule 1: file-based gate signals only).',
      'Cross-family invariant: your provider family must differ from the caller family. The runtime enforces this; if you contest the assignment, raise an `intervention` rather than authoring DECISION.md.',
      'Panel mode v0.1 contributes new-actionable + no-signal telemetry only — DECISION.md will land in events.jsonl for operator inspection. A full panel re-run with DECISION.md surfaced to all panelists is deferred to M16+.',
    ].join('\n\n'),
    whatIsUpForDebate: [
      'Did the disagreement reflect a real correctness/security/architecture issue one of the panelists missed? Or was it noise (a stylistic disagreement that does not warrant blocking the gate)?',
    ].join('\n'),
    recommendedPath: [
      'Steel-man the side the dissenting panelist took:',
      "If a voter said 'block' or 'needs-revision' while the other said 'ready', argue why the dissent is correct (or why the consensus is correct).",
      'Cite specific files in the changed-file manifest; do not exact-copy panelist findings.',
    ].join('\n'),
    decisionPrompts: [
      '1. Which panelist verdict was load-bearing on the disagreement, and why?',
      '2. Are there bugs in the changed files that the dissent surfaces but the consensus missed?',
      '3. Should the synthesized verdict change, and if so, in which direction and why?',
    ].join('\n'),
    whatIWantFromYou: [
      "Author RESPONSE.<your-side>.md per the schema (Overall verdict + substantive rationale citing specific files in the manifest). Do not exact-copy panelist findings — your rationale must be original analysis. The caller will then synthesize DECISION.md.",
    ].join('\n'),
  })
}

/**
 * Build the file manifest for the debate request. Cap = `maxFiles` from
 * the reviewer's `tool_use.debate.maxFiles`. The three artifact files
 * (BUILD_REPORT.md, VERIFY.md, REVIEW.md) are always included; remaining
 * slots fill from the changed-files manifest in declaration order.
 *
 * Returns repo-relative paths only (no content; the wrapper resolves).
 */
export function buildDebateFilesManifest(input: {
  readonly buildReportPath: string
  readonly verifyReportPath: string
  readonly reviewReportPath: string
  readonly changedFilePaths: readonly string[]
  readonly maxFiles: number
}): readonly string[] {
  const required = [input.buildReportPath, input.verifyReportPath, input.reviewReportPath]
  if (input.maxFiles <= required.length) {
    return Object.freeze(required.slice(0, input.maxFiles))
  }
  const remaining = input.maxFiles - required.length
  const extras = input.changedFilePaths.slice(0, remaining)
  return Object.freeze([...required, ...extras])
}

// ---------------------------------------------------------------------------
// M15 Phase 2 C18 — minimal scheduler-resume mismatch detection
// ---------------------------------------------------------------------------
//
// Per `docs/contracts/DEBATE_POLICY.md` § "Resume semantics", three crash
// points need detection on a fresh runReview() invocation:
//
//   1. `evaluated` emitted, no `fired`/`skipped`. The pure scheduler ran
//      but the orchestrator crashed before recording its decision.
//      Recovery: re-evaluate (the earlier event stays in events.jsonl;
//      rule-21 reducer dedups by latest decisionId).
//   2. `fired` emitted, no `debate_started`. The orchestrator emitted
//      the fire event but `requestDebate` never started its own debate
//      lifecycle. Re-firing is unsafe (cost double-charge); halt with
//      NEEDS_INTERVENTION.
//   3. `debate_resolved` emitted, no `postreview`. The debate completed
//      but the post-debate REVIEW round never produced its event.
//      Recovery: post-debate REVIEW round runs on resume (DECISION.md is
//      on disk). v0.1 minimal: surface a halt; broader auto-resume UX
//      deferred to M16+.
//
// Detection runs at the top of `runReviewRoundLocked` (after the
// existing `probeReviewResume`) and only for `schedulerEnabled === 'enabled'`
// rounds — the post-debate round (`disabled_post_debate`) is itself
// part of resume territory.

export type SchedulerResumeMismatchKind =
  | 'evaluated_no_terminal'
  | 'fired_no_debate_started'
  | 'debate_resolved_no_postreview'

export interface SchedulerResumeMismatch {
  readonly kind: SchedulerResumeMismatchKind
  /** The orphan decisionId that triggered the mismatch. */
  readonly decisionId: string
  /** Pretty-printed orphan summary for the intervention detail. */
  readonly detail: string
}

interface FiredHeaderForResume {
  readonly decisionId: string
  readonly topic?: string
}

/**
 * Scan events.jsonl for a scheduler-resume mismatch on the (runId,
 * taskId, attempt, round) tuple this round body is about to drive.
 *
 * Returns `null` when no mismatch is detected (the round may proceed
 * normally). Returns a `SchedulerResumeMismatch` describing the orphan
 * scheduler event that needs operator inspection.
 *
 * Detection is conservative: any of the three crash patterns triggers
 * a halt + NEEDS_INTERVENTION. Broader auto-resume (re-fire after a
 * partial completion) is deferred to M16+; v0.1 prioritizes safety over
 * convenience, since re-firing risks cost double-charge and topic
 * collision.
 */
export function detectSchedulerResumeMismatch(
  events: readonly LoggedEvent[],
  scope: {
    readonly runId: string
    readonly taskId: string
    readonly attempt: number
    readonly round: number
  },
): SchedulerResumeMismatch | null {
  const evaluatedByDecision = new Map<string, true>()
  const skippedByDecision = new Map<string, true>()
  const firedByDecision = new Map<string, FiredHeaderForResume>()
  const errorByDecision = new Map<string, true>()
  const postreviewByDecision = new Map<string, true>()
  const debateStartedByTopic = new Map<string, true>()
  const debateResolvedByTopic = new Map<string, true>()

  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.runId !== scope.runId) continue
    if (
      e.type === 'debate_scheduler_evaluated' ||
      e.type === 'debate_scheduler_skipped' ||
      e.type === 'debate_scheduler_fired' ||
      e.type === 'debate_scheduler_error' ||
      e.type === 'debate_scheduler_postreview'
    ) {
      if (e.taskId !== scope.taskId || e.attempt !== scope.attempt) continue
      if (e.reviewRound !== scope.round) continue
      switch (e.type) {
        case 'debate_scheduler_evaluated':
          evaluatedByDecision.set(e.decisionId, true)
          break
        case 'debate_scheduler_skipped':
          skippedByDecision.set(e.decisionId, true)
          break
        case 'debate_scheduler_fired':
          firedByDecision.set(e.decisionId, {
            decisionId: e.decisionId,
            topic: e.debateTopic,
          })
          break
        case 'debate_scheduler_error':
          errorByDecision.set(e.decisionId, true)
          break
        case 'debate_scheduler_postreview':
          postreviewByDecision.set(e.decisionId, true)
          break
      }
      continue
    }
    // M10 debate primitive lifecycle — keyed by topic, scoped by runId.
    if (e.type === 'debate_started' && e.runId === scope.runId) {
      debateStartedByTopic.set(e.topic, true)
    } else if (e.type === 'debate_resolved' && e.runId === scope.runId) {
      debateResolvedByTopic.set(e.topic, true)
    }
  }

  // Check 2 (highest priority — re-fire is unsafe): fired without
  // matching debate_started.
  for (const [decisionId, fired] of firedByDecision) {
    const topic = fired.topic ?? ''
    if (topic !== '' && !debateStartedByTopic.has(topic)) {
      return {
        kind: 'fired_no_debate_started',
        decisionId,
        detail: `debate_scheduler_fired emitted (decisionId=${decisionId}, topic=${topic}) but no matching debate_started; re-firing risks cost double-charge`,
      }
    }
  }

  // Check 3: debate_resolved without postreview (and no error).
  for (const [decisionId, fired] of firedByDecision) {
    const topic = fired.topic ?? ''
    if (
      topic !== '' &&
      debateResolvedByTopic.has(topic) &&
      !postreviewByDecision.has(decisionId) &&
      !errorByDecision.has(decisionId)
    ) {
      return {
        kind: 'debate_resolved_no_postreview',
        decisionId,
        detail: `debate completed (decisionId=${decisionId}, topic=${topic}) but no debate_scheduler_postreview emitted; post-debate REVIEW round did not record its outcome`,
      }
    }
  }

  // Check 1: evaluated without any terminal (skipped, fired, error,
  // postreview). The pure scheduler ran but no decision was recorded.
  for (const [decisionId] of evaluatedByDecision) {
    if (
      !skippedByDecision.has(decisionId) &&
      !firedByDecision.has(decisionId) &&
      !errorByDecision.has(decisionId) &&
      !postreviewByDecision.has(decisionId)
    ) {
      return {
        kind: 'evaluated_no_terminal',
        decisionId,
        detail: `debate_scheduler_evaluated emitted (decisionId=${decisionId}) without a terminal event; the pure scheduler ran but the orchestrator crashed before recording the decision`,
      }
    }
  }

  return null
}
