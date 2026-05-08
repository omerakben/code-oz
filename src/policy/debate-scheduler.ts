// M15 commit 2 — pure debate-policy scheduler decision function.
//
// Authority: orchestrator-owned mechanical predicate (CLAUDE.md rule 1 +
// rule 20). The scheduler is NOT an LLM; it is a deterministic function over
// a typed snapshot of REVIEW state, persona permission, run history,
// budget preflight, concurrency, and policy config.
//
// Layered relationship to surrounding M15 surfaces (per
// docs/contracts/DEBATE_POLICY.md, commit 7):
//   - Layer 1 (this module) is the algorithm: SchedulerInput -> SchedulerDecision.
//     Pure; no I/O; no global state; no LLM.
//   - Layer 2 (src/phases/review.ts + review-panel.ts post-verdict hook,
//     commits 4a + 4b) is the runtime caller. It builds SchedulerInput from
//     in-scope state, calls this function, emits the corresponding event,
//     and on `fire: true` invokes requestDebate + the post-debate REVIEW
//     round under the existing .review.lock (factored into runReviewRoundLocked
//     to avoid lock recursion — Codex Risk #4 in CODEX_RESPONSE_M15.md).
//   - Layer 3 (cost preflight in src/providers/cost.ts, commit 5) computes
//     SchedulerInput.budget.aggregatePreflightWouldTip BEFORE this function
//     runs. Aggregate cost = opposing turn + synthesis turn + post-debate
//     REVIEW round (panel-aware). Mid-debate budget kill is the chokepoint
//     backup, never the gate.
//   - Layer 4 (doctor --debate-policy-baseline, commit 6b) is the rule-21
//     ship gate. It runs the canonical fixture set under mode=off (control)
//     and mode=auto (treatment), reduces the resulting events.jsonl pair,
//     and gates on corrective verdict delta (>= 0.10) + new-actionable-finding
//     rate (>= 0.30).
//
// Per Codex pushback Q2 (CODEX_RESPONSE_M15.md §"Where I disagree"):
// verdict-confidence is NOT a primary signal. Persona-authored confidence
// shares the same prior as the verdict it accompanies; using it as the
// trigger would let weak BUILDs slip through. Objective signals only —
// score grey-zone + needs-revision-with-high-score (single mode) and
// eligible-voter disagreement (panel mode).
//
// Per Codex pushback Q5: panel-mode triggers fire ONLY on eligible-voter
// disagreement. Advisory-`block` is NOT a trigger (advisory authority
// laundering through the scheduler — REVIEW_PANEL.md authority shape).
//
// Per Codex Risk #1: panel REVIEW has no numeric Score.Final score (the
// canonical artifact uses literal 'panel' and review_resolved.finalScore=10
// is a compatibility sentinel). Score-grey-zone and
// needs-revision-with-high-score are SINGLE-MODE ONLY.

import type { ProviderId } from '../providers/types.ts'
import type {
  DebateSchedulerMode,
  PanelVerdict,
  PanelistRole,
  SchedulerBudgetTipReason,
  SchedulerFireReason,
  SchedulerSkipReason,
} from '../state/schemas.ts'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Per-panelist verdict snapshot the scheduler observes from M14 panel REVIEW.
 *  `authorityImpact` distinguishes voters (count toward quorum + disagreement
 *  trigger) from advisory panelists (do NOT count — Codex Q5 rejection). */
export interface PanelistVerdictSnapshot {
  readonly id: string
  readonly verdict: PanelVerdict
  readonly authorityImpact: PanelistRole
}

/** REVIEW state at the moment the scheduler runs (post-verdict computation,
 *  pre-gate-write). The `mode: 'panel'` branch carries panelistVerdicts and
 *  `score === null`; the `mode: 'single'` branch carries a finite score and
 *  empty panelistVerdicts. Validators in the runtime caller (commit 4a) ensure
 *  the discriminated-union invariant. */
export type SchedulerReviewState =
  | {
      readonly mode: 'single'
      readonly score: number
      readonly verdict: 'ready' | 'needs-revision' | 'block'
    }
  | {
      readonly mode: 'panel'
      readonly score: null
      readonly verdict: 'panel'
      readonly panelistVerdicts: readonly PanelistVerdictSnapshot[]
    }

/** Run history accumulators. The runtime caller derives these from
 *  events.jsonl reduction (rule 19 + rule 1 — no parallel state). */
export interface SchedulerHistorySnapshot {
  readonly debatesFiredThisRun: number
  readonly debatesFiredThisTask: number
  readonly priorFingerprintsThisTask: ReadonlySet<string>
  /** Fingerprint of the current decision, computed by the runtime caller
   *  (commit 4a) from `(taskId, attempt, preReviewReportSha256)`. Dedup
   *  check is set membership: `priorFingerprintsThisTask.has(currentFingerprint)`. */
  readonly currentFingerprint: string
}

/** Cost preflight result (commit 5). Aggregate over opposing turn +
 *  synthesis turn + post-debate REVIEW round; panel-aware. `tipReason`
 *  is `undefined` when `wouldTip` is false. */
export interface SchedulerBudgetSnapshot {
  readonly aggregatePreflightWouldTip: boolean
  readonly tipReason?: SchedulerBudgetTipReason
}

export interface SchedulerPersonaSnapshot {
  readonly hasDebatePermission: boolean
  /** Post-M11-eligibility-filter list. Empty when the persona declared
   *  `tool_use.debate.opposingProviders` but every entry failed eligibility. */
  readonly opposingProviders: readonly ProviderId[]
}

export interface SchedulerConcurrencySnapshot {
  /** True when M10 `requestDebate` is already in-flight for this
   *  (runId, phase). Scheduler-fired debate counts against the
   *  M10 maxConcurrent: 1 cap. */
  readonly debateInFlight: boolean
}

export interface SchedulerManifestSnapshot {
  /** Projected file count = changed-file manifest from BUILD_REPORT.md +
   *  BUILD_REPORT.md itself + VERIFY.md + REVIEW.md (kickoff §2.11). */
  readonly projectedFileCount: number
  readonly maxFiles: number
}

export interface SchedulerPolicyTriggers {
  readonly reviewScoreGreyZone: { readonly min: number; readonly max: number }
  readonly panelVoterDisagreement: boolean
  readonly needsRevisionWithHighScore: boolean
}

export interface SchedulerPolicyCooldown {
  readonly dedupByFingerprint: boolean
}

export interface SchedulerPolicySnapshot {
  readonly maxPerRun: number
  readonly maxPerTask: number
  readonly triggers: SchedulerPolicyTriggers
  readonly cooldown: SchedulerPolicyCooldown
}

/** The full decision input. The runtime caller (commit 4a) constructs this
 *  snapshot from in-scope state; this module never reads files, never reads
 *  global state, never invokes a provider. */
export interface SchedulerInput {
  readonly mode: DebateSchedulerMode
  readonly review: SchedulerReviewState
  readonly history: SchedulerHistorySnapshot
  readonly budget: SchedulerBudgetSnapshot
  readonly persona: SchedulerPersonaSnapshot
  readonly concurrency: SchedulerConcurrencySnapshot
  readonly manifest: SchedulerManifestSnapshot
  readonly policy: SchedulerPolicySnapshot
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SchedulerFireDecision = {
  readonly fire: true
  readonly reason: SchedulerFireReason
}

export type SchedulerSkipDecision = {
  readonly fire: false
  readonly reason: SchedulerSkipReason
  /** Optional discriminator on `reason: 'budget_exhausted'` naming which
   *  budgets.global cap would tip. Mirrors the optional event field. */
  readonly budgetTipReason?: SchedulerBudgetTipReason
}

export type SchedulerDecision = SchedulerFireDecision | SchedulerSkipDecision

// ---------------------------------------------------------------------------
// Decision function
// ---------------------------------------------------------------------------

/**
 * Evaluate the scheduler decision for a single REVIEW post-verdict moment.
 *
 * Pure: no I/O, no global state, no LLM. Deterministic on the input snapshot.
 * Skip ordering is locked in kickoff §5 — short-circuits on first match so
 * the events.jsonl reducer can attribute every skip to a single reason.
 *
 * Returns `{ fire: true, reason }` ONLY when every gate passes AND a trigger
 * matches. Otherwise returns `{ fire: false, reason, budgetTipReason? }`.
 */
export function evaluateSchedulerDecision(input: SchedulerInput): SchedulerDecision {
  // Gate 1 — mode discriminator (rule 21: `off` is the rule-21 baseline
  // control; `manual` preserves M10 behavior unchanged).
  if (input.mode === 'off') {
    return { fire: false, reason: 'mode_off' }
  }
  if (input.mode === 'manual') {
    return { fire: false, reason: 'mode_manual' }
  }

  // Gate 2 — persona permission. Path A (M15 locked): the bundled reviewer
  // has tool_use.debate granted in commit 8. A persona without the
  // permission still reaches this gate (e.g., a custom reviewer or a
  // future persona) and skips cleanly.
  if (!input.persona.hasDebatePermission) {
    return { fire: false, reason: 'persona_no_debate_permission' }
  }
  if (input.persona.opposingProviders.length === 0) {
    return { fire: false, reason: 'persona_no_eligible_opponent' }
  }

  // Gate 3 — concurrency. Scheduler-fired debate counts against M10
  // maxConcurrent: 1 (Codex Q11 sub-item, kickoff §2.6). If a manual
  // <debate-request> debate is already in flight for this (runId, phase),
  // skip rather than block-wait — gate writes from the original REVIEW
  // verdict, not from an aborted scheduler attempt.
  if (input.concurrency.debateInFlight) {
    return { fire: false, reason: 'concurrent_limit' }
  }

  // Gate 4 — hysteresis caps.
  if (input.history.debatesFiredThisRun >= input.policy.maxPerRun) {
    return { fire: false, reason: 'max_per_run_exhausted' }
  }
  if (input.history.debatesFiredThisTask >= input.policy.maxPerTask) {
    return { fire: false, reason: 'max_per_task_exhausted' }
  }

  // Gate 5 — fingerprint dedup.
  if (
    input.policy.cooldown.dedupByFingerprint &&
    input.history.priorFingerprintsThisTask.has(input.history.currentFingerprint)
  ) {
    return { fire: false, reason: 'dedup_fingerprint_already_debated' }
  }

  // Gate 6 — aggregate budget preflight (Codex Q6 — strict; kickoff §2.5).
  // The runtime caller computed this from priceTable + persona maxTokens
  // + post-debate REVIEW round estimate (panel-aware). Mid-debate kill is
  // the chokepoint backup, never the gate.
  if (input.budget.aggregatePreflightWouldTip) {
    return {
      fire: false,
      reason: 'budget_exhausted',
      ...(input.budget.tipReason !== undefined ? { budgetTipReason: input.budget.tipReason } : {}),
    }
  }

  // Gate 7 — manifest size pre-skip (Codex Q11 sub-item; kickoff §2.11).
  // Better to pre-skip than to throw after firing.
  if (input.manifest.projectedFileCount > input.manifest.maxFiles) {
    return { fire: false, reason: 'manifest_size_exceeds_maxFiles' }
  }

  // Gate 8 — trigger evaluation (mode-aware).
  const trigger = evaluateTrigger(input)
  if (trigger !== null) {
    return { fire: true, reason: trigger }
  }

  return { fire: false, reason: 'no_trigger_matched' }
}

// ---------------------------------------------------------------------------
// Internal: trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Mode-aware trigger evaluation. Returns the matching SchedulerFireReason or
 * null when no trigger fires.
 *
 * Panel mode: voter-disagreement only (Codex Risk #1 + Q5). Single mode:
 * grey-zone OR needs-revision-with-high-score (Codex Risk #1 — single mode
 * is the only path with a numeric Score.Final score).
 */
function evaluateTrigger(input: SchedulerInput): SchedulerFireReason | null {
  if (input.review.mode === 'panel') {
    if (
      input.policy.triggers.panelVoterDisagreement &&
      eligibleVotersDisagree(input.review.panelistVerdicts)
    ) {
      return 'panel_voter_disagreement'
    }
    return null
  }

  // Single mode below.
  const greyZone = input.policy.triggers.reviewScoreGreyZone
  if (
    input.review.score >= greyZone.min &&
    input.review.score <= greyZone.max
  ) {
    return 'score_in_grey_zone'
  }
  if (
    input.policy.triggers.needsRevisionWithHighScore &&
    input.review.verdict === 'needs-revision' &&
    input.review.score >= 6
  ) {
    return 'needs_revision_with_high_score'
  }
  return null
}

/**
 * Panel disagreement check: at least two eligible voters return distinct
 * verdicts. Advisory panelists are excluded entirely (Codex Q5 + REVIEW_PANEL.md
 * authority shape — advisory verdicts do not corroborate or oppose voter
 * verdicts).
 */
function eligibleVotersDisagree(
  panelists: readonly PanelistVerdictSnapshot[],
): boolean {
  const voterVerdicts = new Set<PanelVerdict>()
  for (const p of panelists) {
    if (p.authorityImpact === 'voter') {
      voterVerdicts.add(p.verdict)
    }
  }
  return voterVerdicts.size >= 2
}
