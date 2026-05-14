// Shared schemas and types for the M3 state machine, event log, and gate writers.
// The canonical contract is pinned in docs/references/file-based-gates.md.

import type { PresetName } from '../config/schema.ts'

export const PHASES = ['define', 'plan', 'build', 'verify', 'review', 'ship', 'audit'] as const
export type Phase = (typeof PHASES)[number]

export const PROFILES = ['greenfield', 'brownfield'] as const
export type Profile = (typeof PROFILES)[number]

export const GREENFIELD_SEQUENCE: readonly Phase[] = Object.freeze([
  'define',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
])

export const BROWNFIELD_SEQUENCE: readonly Phase[] = Object.freeze([
  'audit',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
])

// Canonical phase -> artifact mapping. Pinned in docs/references/file-based-gates.md
// "Canonical phase -> artifact map". Paths are relative to the run's artifact
// root (v0.1: .code-oz/artifacts/), so the values here are bare filenames.
export const CANONICAL_ARTIFACTS: Readonly<Record<Phase, string>> = Object.freeze({
  define: 'SPEC.md',
  audit: 'AUDIT.md',
  plan: 'PLAN.md',
  build: 'BUILD_REPORT.md',
  verify: 'VERIFY.md',
  review: 'REVIEW.md',
  ship: 'SHIP.md',
})

// ULID: 26-char Crockford base32. 48-bit timestamp + 80-bit random.
// Crockford alphabet excludes I, L, O, U.
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value)
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LEN = 10
const RAND_LEN = 16
const MAX_TIME_MS = 0xffffffffffff // 2^48 - 1

function encodeBase32(value: bigint, len: number): string {
  let chars = ''
  let n = value
  for (let i = 0; i < len; i++) {
    chars = CROCKFORD[Number(n & 0x1fn)] + chars
    n >>= 5n
  }
  return chars
}

export interface UlidOptions {
  readonly now?: number
  readonly random?: Uint8Array
}

export function generateUlid(opts: UlidOptions = {}): string {
  const now = opts.now ?? Date.now()
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIME_MS) {
    throw new RangeError(`ULID timestamp out of range: ${now} (must be 0..${MAX_TIME_MS})`)
  }
  let randomBytes: Uint8Array
  if (opts.random !== undefined) {
    if (opts.random.length !== 10) {
      throw new RangeError(`ULID requires 10 random bytes, got ${opts.random.length}`)
    }
    randomBytes = opts.random
  } else {
    randomBytes = new Uint8Array(10)
    crypto.getRandomValues(randomBytes)
  }
  let randomBits = 0n
  for (const b of randomBytes) randomBits = (randomBits << 8n) | BigInt(b)
  return encodeBase32(BigInt(now), TIME_LEN) + encodeBase32(randomBits, RAND_LEN)
}

// Event-log line schema — version 1. Future schema bumps increment this number.
// Required on every event: version, type, ts (ISO 8601), runId.

export const EVENT_TYPES = [
  'run_started',
  // B4 — resolved config telemetry. This event is a mirror of the already
  // resolved config object, not an enforcement authority. The run-start
  // emitter is intentionally deferred to the follow-up that owns that path
  // (docs/comparison/06-codex/SYNTHESIS.md B4; CLAUDE.md rule 19).
  'config_resolved',
  'phase_entered',
  'phase_exited',
  'agent_invoked',
  'agent_completed',
  'gate_written',
  'gate_required',
  'intervention',
  'run_ended',
  // M5 — ask-me conversation content. Reducer treats both as no-ops; the
  // events exist for the audit trail and W2+ replay tooling.
  'ask_me_user_input',
  'ask_me_persona_reply',
  // M6 — repo-context tool calls (per docs/contracts/REPO_CONTEXT.md).
  // Counts against the existing tool-call cap when model-issued; never
  // increments maxProviderCalls (Codex decision 2 in CODEX_RESPONSE_M6.md).
  'repo_context_searched',
  // M6 — Scientist phase-tail audit trail (per docs/contracts/SCIENTIST.md,
  // HYPOTHESES.md, OPEN_QUESTIONS.md). All no-ops in the reducer.
  'science_emitted',
  'hypothesis_added',
  'hypothesis_updated',
  'question_added',
  'question_resolved',
  'question_deferred',
  // M6 — soft budget warning at budgets.global.softWarnAtRatio. The hard
  // kill at 100% still produces a NEEDS_INTERVENTION; the warning is a
  // forward-looking signal so operators can plan ahead.
  'budget_warning',
  // M7 — worktree subsystem (per docs/contracts/WORKTREE.md). Orchestrator-
  // owned events covering the per-run isolated worktree lifecycle. None of
  // these fire on BUILD-pass alone; cleanup is gated on VERIFY-pass (M8+).
  'worktree_created',
  'worktree_failed',
  'worktree_patch_applied',
  'worktree_patch_failed',
  'worktree_forensics_preserved',
  'worktree_destroyed',
  'worktree_reset_to_base',
  // M7 — BUILD phase (per docs/contracts/BUILD.md). build_failed is distinct
  // from worktree_patch_failed: the worktree event names the apply-side
  // failure; build_failed names the phase-level failure that produces
  // NEEDS_INTERVENTION (rule 11).
  'build_started',
  'build_patch_applied',
  'build_completed',
  'build_failed',
  // M9 substrate (per docs/contracts/REVIEW.md § "Cross-family enforcement"
  // + CODEX_RESPONSE_M9.md decision 5). Records the BUILD adapter's resolved
  // provider id + family + model durably so REVIEW's invocation-time check
  // can compare BUILD family to reviewer adapter family without re-deriving
  // either. Lighter than a BUILD_REPORT.md schema extension. Emitted
  // immediately after build_completed; durable across resume.
  'build_provider_recorded',
  // M8 — VERIFY phase (per docs/contracts/VERIFY.md). The four-event shape
  // is locked in VERIFY.md § "Event types emitted". Ordering against
  // worktree_destroyed is the orchestrator's responsibility (Codex M8
  // decision 8 modification: verify_restart_initiated only after
  // worktree_destroyed); the schema does not enforce ordering, only event
  // shape.
  'verify_started',
  'verify_completed',
  'verify_failed',
  'verify_restart_initiated',
  // M9 — REVIEW phase (per docs/contracts/REVIEW.md § "Event types
  // emitted"). The four-event shape covers the lifecycle from invocation
  // through one of two terminal events. `review_blocked` is NOT emitted
  // when REVIEW round N's follow-up BUILD attempt exhausts VERIFY's
  // 4-attempt cap (authority overlap rule, CODEX_RESPONSE_M9.md
  // decision 4): VERIFY-restart owns the intervention with "while
  // addressing REVIEW round N" context.
  'review_started',
  'review_round_completed',
  'review_resolved',
  'review_blocked',
  // M16 C8 — REVIEW remediation persistence. Emitted by `dispatchReview`
  // when `runReview` returns `status: 'needs_revision'`. Persists the
  // resolved `nextReviewRound` so the next `code-oz run` can pick up
  // round N+1 without re-deriving it from `priorRound + 1` (which would
  // race with concurrent BUILD restarts in the carry-forward chain).
  // Joins to the just-emitted `review_round_completed` event via
  // `refsTo.reviewReportSha256` so audit trails can reconstruct the
  // remediation chain without trusting attempt/round arithmetic alone.
  'review_remediation_recorded',
  // M10 — Debate runtime (per docs/contracts/DEBATE.md § "Event types").
  // Two events cover the lifecycle: debate_started (BRIEFING.md +
  // MANIFEST.preview.md atomically written; opposing-party invocation
  // begins) and debate_resolved (DECISION.md atomically written; control
  // returns to the calling phase). DEBATE.md pins exactly two events;
  // M10 does NOT introduce additional warning events (per Codex M10
  // response risk #4: "warning events are contract drift").
  // Authority-data distinction (CLAUDE.md rule 9): the calling persona
  // authors DECISION.md; the orchestrator validates shape and records
  // both opposing and caller verdicts in the debate_resolved event for
  // audit. The orchestrator never auto-merges the opposing party's
  // verdict — that would defeat rule 9.
  'debate_started',
  'debate_resolved',
  // M14 — Reviewer panel v1 (per docs/contracts/REVIEW_PANEL.md). Six events
  // cover the lifecycle of a multi-provider reviewer panel:
  //   review_panel_started — orchestrator invoked panel; panel composition
  //     logged with resolved provider families and build family.
  //   review_panelist_completed — one panelist finished; per-panelist staging
  //     draft written; manifest hash recorded for the manifest equality
  //     invariant.
  //   review_panel_disagreement — two panelists rate the same fingerprint
  //     differently (severity, verdict, presence, or advisory-unratified).
  //   panel_quorum_rejected_same_family_vote — positive-control event
  //     for rule-21 measurement. v0.1 emits ONLY from the doctor
  //     baseline command (layer='config-load'); the discriminator's
  //     later-layer values (runtime-registry / artifact-parse /
  //     quorum-time) are reserved for future use. Runtime layer-4
  //     same-family rejection surfaces as the
  //     `panel_voter_same_family_at_runtime` intervention.
  //   review_panel_completed — synthesis wrote canonical REVIEW.md; panel
  //     verdict recorded. Validator backstop (layer 5): when panelVerdict
  //     is 'ready', eligibleVoterFamilies count MUST be 2.
  //   review_panel_baseline_completed — doctor --panel-baseline command's
  //     rule-21 ship-gate metric event.
  // No `panel_cost_warn` event — M13's `budget_warning` is reused for
  // panel-aggregate cost warnings (per Codex pushback Q6).
  'review_panel_started',
  'review_panelist_completed',
  'review_panel_disagreement',
  'panel_quorum_rejected_same_family_vote',
  'review_panel_completed',
  'review_panel_baseline_completed',
  // M15 — Debate-policy scheduler v1 (per docs/contracts/DEBATE_POLICY.md
  // and docs/design/SESSION_M15_IMPL_KICKOFF.md). Six events cover the
  // scheduler's mechanical decision lifecycle at the post-REVIEW call site.
  // The scheduler is NOT an LLM — it is a pure predicate over typed REVIEW
  // state + cost/policy state + cooldown counters; rule 1 + rule 20 + rule
  // 21 invariants pinned in the kickoff. Correlation across the disjoint
  // (evaluated → fired/skipped → postreview) trace flows through `decisionId`
  // (run-scoped ULID) + `reviewRound` + `preReviewReportSha256`. The
  // baseline command is the rule-21 ship gate.
  //   debate_scheduler_evaluated — always fires per scheduler decision; logs
  //     the canonicalized SchedulerInput digest for reproducibility.
  //   debate_scheduler_fired — fires when the scheduler decided to fire;
  //     names the chosen opposingProvider + debate topic for join-key.
  //   debate_scheduler_skipped — fires when the scheduler decided to skip;
  //     names the SchedulerSkipReason. Optional budgetTipReason on the
  //     `budget_exhausted` reason names which cap would tip.
  //   debate_scheduler_error — fires when the scheduler fired but
  //     requestDebate threw at runtime; reason is the degraded-error
  //     classification (artifact_invalid / transient_io / resume_after_fire_no_start
  //     / other). Operator-actionable errors (auth / permission / concurrent /
  //     topic-collision / manifest-blocked) raise NEEDS_INTERVENTION instead.
  //   debate_scheduler_postreview — fires after the post-debate REVIEW round
  //     completes (synchronous reissue under the existing `.review.lock` via
  //     factored runReviewRoundLocked); records pre/post REVIEW.md sha256
  //     + verdict pair + finding deltas. Round counter does NOT increment
  //     for the post-debate round (4-round cap from M9 unchanged).
  //   debate_policy_baseline_completed — doctor --debate-policy-baseline
  //     command's rule-21 ship-gate metric event.
  'debate_scheduler_evaluated',
  'debate_scheduler_fired',
  'debate_scheduler_skipped',
  'debate_scheduler_error',
  'debate_scheduler_postreview',
  'debate_policy_baseline_completed',
  // M16 — Per-task lifecycle cursor (per docs/research/CODEX_RESPONSE_M16.md
  // Risk #1 closure). PLAN.md supports multiple `T-NNN` tasks; the
  // state machine only knows phases. Without these events, the cursor
  // helper at src/state/task-cursor.ts cannot tell which task BUILD
  // attempt N+1 should target, and `approve review` for task T-001
  // would advance currentPhase to `ship` while T-002 / T-003 were
  // never built. The three events form a strict ordering per task:
  //   task_started — emitted by `dispatchBuild` (src/commands/run.ts)
  //     before the first BUILD attempt for a task. Subsequent attempts
  //     (BUILD-restart from VERIFY-fail) do NOT re-emit; the
  //     `build_started` event already carries attempt N.
  //   task_review_passed — emitted by `dispatchReview` (src/commands/run.ts)
  //     when `runReview` returns `status === 'resolved'` (verdict='ready').
  //     Mirrors `review_resolved` but carries the `taskIndex` from the
  //     cursor's pending entry so the cursor projection is O(1). Emitted
  //     at the dispatcher level (not inside `runReview`) because
  //     `RunReviewOptions` does not carry taskIndex — the cursor
  //     projection is dispatcher authority. Idempotent on
  //     `(runId, taskId, finalRound)`: a second `dispatchReview` for the
  //     same resolving round will skip the emission. Fires BEFORE the
  //     operator approves; the gap between this event and `task_completed`
  //     is the "review-ready, awaiting approve review" window the cursor
  //     surfaces via `TaskCursorEntry.reviewPassed`. M16 C9 follow-on (7)
  //     wired the emit site; bug 10 (3081-test baseline) caught the
  //     missing-emitter gap.
  //   task_completed — emitted by preApproveReviewHook AFTER the
  //     GATE_REVIEW_PASSED.json gate write succeeds. This is the
  //     durable "task is fully done" signal; `code-oz run` reads this
  //     to decide whether to advance to BUILD for task N+1 or to SHIP.
  // No state-machine change in C1 — this commit defines the events +
  // the projection helper. Runtime emit sites land in C5 (BUILD prompt
  // snapshot + preApproveBuildHook), C6 (dispatchBuild), C8 (dispatchReview),
  // and C9 (task-loop dispatch) per docs/design/SESSION_M16_KICKOFF.md.
  'task_started',
  'task_review_passed',
  'task_completed',
  // M16 C11 — `--provider fake` warning event. Loud stderr banner + this
  // event fire once per `code-oz run` invocation when the fake provider
  // override is active. Surfaces accidental fake-provider runs in
  // production logs (CI safety net). Schema-light: envelope plus the
  // overrideAlias and the optional fake-script path. No phase / agent /
  // runId-only-when-active-run discriminator — the banner fires before
  // initRun in greenfield invocations, so runId is optional.
  'fake_provider_warning_emitted',
  // M16 C9 follow-on — task-boundary gate-file lifecycle. Per-phase
  // GATE_<PHASE>_PASSED.json files are filename-keyed (one slot per
  // phase) but task-keyed at the artifact-sha level. After T-001 ships
  // a gate file with sha=S1 and T-002's BUILD/VERIFY/REVIEW writes new
  // artifact bytes, the prior gate's artifactSha256 no longer matches
  // the artifact on disk; the next `loadRun` would throw
  // `gate_artifact_sha256_mismatch` from validateRunIntegrity. The
  // dispatchers (`dispatchBuild` / `dispatchVerify` / `dispatchReview`)
  // detect this at the task boundary (latest `task_completed` for a
  // prior task + no `<phase>_started` for the new task) and clear the
  // stale gate file before invoking the phase. The deletion is recorded
  // here as an audit event so operators can grep events.jsonl for
  // every cross-task gate-file replacement.
  //   `phase` — which gate file was cleared (`build` / `verify` / `review`).
  //   `priorTaskId` — the task whose approval wrote the just-cleared
  //     gate file (sourced from the latest `task_completed` event).
  //   `currentTaskId` — the task whose dispatcher is about to fire and
  //     drove the cleanup.
  //   `gateFile` — the canonical filename (`GATE_<PHASE>_PASSED.json`).
  //   `priorArtifactSha256` — 64-char lowercase hex of the
  //     artifactSha256 the deleted gate referenced. Operators can
  //     correlate against the previous task's gate audit trail.
  'gate_file_cleared',
  // B1a Commit 2 — `--effort` flag forensics. Reducer no-op; the event
  // records the original + effective `CodeOzConfig['budgets']` snapshots
  // so active-run dispatchers can reconstruct the post-`applyEffort`
  // envelope after every `loadConfig({ cwd })`. See PhaseEvent variant
  // below for the full payload shape and validator invariants.
  'effort_envelope_applied',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** M14: panelist role values (mirrors src/artifacts/review-report.ts). */
export const PANELIST_ROLES = ['voter', 'advisory'] as const
export type PanelistRole = (typeof PANELIST_ROLES)[number]

/** M14: panel verdict values (mirrors src/artifacts/review-report.ts). */
export const PANEL_VERDICTS = ['ready', 'needs-revision', 'block'] as const
export type PanelVerdict = (typeof PANEL_VERDICTS)[number]

/** M14: review_panel_disagreement.kind discriminator. */
export const PANEL_DISAGREEMENT_KINDS = [
  'severity',
  'verdict',
  'presence',
  'advisory_unratified',
] as const
export type PanelDisagreementKind = (typeof PANEL_DISAGREEMENT_KINDS)[number]

/** M14: panel_quorum_rejected_same_family_vote.layer discriminator. */
export const PANEL_QUORUM_REJECTION_LAYERS = [
  'config-load',
  'runtime-registry',
  'artifact-parse',
  'quorum-time',
] as const
export type PanelQuorumRejectionLayer = (typeof PANEL_QUORUM_REJECTION_LAYERS)[number]

/** M15: debate-policy scheduler runtime modes (per docs/contracts/DEBATE_POLICY.md
 *  + kickoff §2.12). `manual` is the default and preserves M10 behavior.
 *  `auto` opts in to the scheduler. `off` disables both manual <debate-request>
 *  blocks and the scheduler — used by the rule-21 baseline control run. */
export const DEBATE_SCHEDULER_MODES = ['off', 'manual', 'auto'] as const
export type DebateSchedulerMode = (typeof DEBATE_SCHEDULER_MODES)[number]

/** M15: SchedulerFireReason — objective signals only (verdict-confidence
 *  rejected per Codex Q2). Single-mode triggers fire on score grey-zone or
 *  needs-revision-with-high-score; panel-mode triggers fire on eligible
 *  voter disagreement only (panel REVIEW has no numeric Score.Final score
 *  per Codex Risk #1). */
export const SCHEDULER_FIRE_REASONS = [
  'score_in_grey_zone',
  'panel_voter_disagreement',
  'needs_revision_with_high_score',
] as const
export type SchedulerFireReason = (typeof SCHEDULER_FIRE_REASONS)[number]

/** M15: SchedulerSkipReason — every skip path carries an explicit reason
 *  (rule 21 baseline reducer breaks down skipped fires by reason). */
export const SCHEDULER_SKIP_REASONS = [
  'mode_off',
  'mode_manual',
  'no_trigger_matched',
  'max_per_run_exhausted',
  'max_per_task_exhausted',
  'budget_exhausted',
  'persona_no_debate_permission',
  'persona_no_eligible_opponent',
  'concurrent_limit',
  'manifest_size_exceeds_maxFiles',
  'dedup_fingerprint_already_debated',
] as const
export type SchedulerSkipReason = (typeof SCHEDULER_SKIP_REASONS)[number]

/** M15: SchedulerErrorReason — degraded-error classifications when the
 *  scheduler fired but requestDebate threw at runtime. Operator-actionable
 *  errors (auth / permission / concurrent / topic-collision / manifest-blocked)
 *  raise NEEDS_INTERVENTION and do NOT emit `debate_scheduler_error` (kickoff
 *  §2.7 table). */
export const SCHEDULER_ERROR_REASONS = [
  'artifact_invalid',
  'transient_io',
  'resume_after_fire_no_start',
  'other',
] as const
export type SchedulerErrorReason = (typeof SCHEDULER_ERROR_REASONS)[number]

/** M15: budget tip reasons — when SchedulerSkipReason='budget_exhausted',
 *  optional `budgetTipReason` names which `budgets.global` cap would tip
 *  under aggregate preflight. Mirrors the four caps in M13 cost.ts. */
export const SCHEDULER_BUDGET_TIP_REASONS = [
  'maxTokensEstimate',
  'maxProviderCalls',
  'maxTurns',
  'maxWallTimeMinutes',
] as const
export type SchedulerBudgetTipReason = (typeof SCHEDULER_BUDGET_TIP_REASONS)[number]

/** M15: REVIEW.md verdict values as observed by the scheduler postreview event.
 *  Single-mode REVIEW emits 'ready' | 'needs-revision' | 'block'. Panel-mode
 *  REVIEW emits the literal sentinel 'panel' (per M14 — `Final score: panel`,
 *  `review_resolved.finalScore=10` is a compatibility marker; panel verdicts
 *  travel through PanelVerdict). The postreview event records both verdictPre
 *  and verdictPost as the union below to stay symmetric across modes. */
export const SCHEDULER_REVIEW_VERDICTS = ['ready', 'needs-revision', 'block', 'panel'] as const
export type SchedulerReviewVerdict = (typeof SCHEDULER_REVIEW_VERDICTS)[number]

export const PHASE_OUTCOMES = ['passed', 'failed', 'paused'] as const
export type PhaseOutcome = (typeof PHASE_OUTCOMES)[number]

export const RUN_OUTCOMES = ['shipped', 'stopped', 'paused'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export interface AgentManifestEntry {
  readonly path: string
  readonly sha256: string
  readonly sizeBytes: number
}

export interface AgentManifest {
  readonly files: readonly AgentManifestEntry[]
}

export interface OptionalActorAttribution {
  /** Optional now, required in v0.2. Names the event emitter for §3.5 actor attribution. */
  readonly actor?: string
}

type OptionalActorAttributed<T> = T & OptionalActorAttribution

// PhaseEvent is the STRICT write-side type. Code that constructs and appends
// events uses this discriminated union of every known event variant. The
// agent_invoked variant requires manifest + four metric fields per the M4
// contract pinned in docs/references/file-based-gates.md § 13.
export type PhaseEvent =
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'run_started'; readonly ts: string; readonly runId: string; readonly profile: Profile }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'config_resolved'
      readonly ts: string
      readonly runId: string
      readonly presetApplied: PresetName | null
      readonly permissions: {
        readonly allowEscapeHatch: boolean
        readonly requireApprovalForBuild: boolean
      }
      readonly budgets: {
        readonly global: {
          readonly softWarnAtRatio: number
          readonly maxReviewRounds: number
          readonly maxProviderCalls: number
          readonly maxTokensEstimate: number
          readonly maxWallTimeMinutes: number
        }
      }
    }>
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'phase_entered'; readonly ts: string; readonly runId: string; readonly phase: Phase }>
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'phase_exited'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly outcome: PhaseOutcome }>
  | {
      readonly version: 1
      readonly type: 'agent_invoked'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly provider: string
      readonly manifest: AgentManifest
      readonly filesSent: number
      readonly bytesSent: number
      readonly tokensEstimate: number
      readonly fieldsRemovedByScope: number
      /** M12 (Codex Risk #3 in CODEX_RESPONSE_M12.md, thread 019de4bb):
       *  durable record of the resolved model the wrapper sent to the
       *  adapter. Present when either the persona's frontmatter or the
       *  company:block declared a model — `req.model ?? req.agent.model`
       *  in src/providers/manifest.ts. Omitted when neither did, so M11
       *  and earlier readers parse new events identically. M13's
       *  role-cost policy reads this against `budgets.global.priceTable`. */
      readonly model?: string
      /** M13 (Codex Q9 lock, CODEX_RESPONSE_M13.md, thread 019de672):
       *  optional CompanyRole identity the wrapper bound from
       *  `ProviderRequest.role`. Present only when phase logic explicitly
       *  passed a role (the six bundled-persona invocation sites);
       *  project-local personas + synthetic debate opponents omit it.
       *  Validator restricts the value to `M12_COMPANY_ROLES`. Per-role
       *  budget enforcement and `byRole` soft warnings key off this
       *  field. */
      readonly role?: string
      /** M13 (Codex Q2 + Q4 lock): advisory dollar estimate for the
       *  upcoming call. Present when `priceTable` (operator-specific) or
       *  `capabilityOf(provider).costPerMTok` (registry fallback) yields
       *  a value for the resolved (provider, model). Stored as a finite
       *  non-negative number — never used to gate calls in M13
       *  (tokensEstimate stays authoritative); USD enforcement is M14+
       *  with measurable demand. Display layers may format. */
      readonly costEstimateUSD?: number
      /** M10 forward-compat correlation. Present only when the call is
       *  inside a debate; the runtime sets it from the debate context.
       *  Consumers ignore unknown fields, so M9 readers are unaffected.
       *  M14+ panel territory will rely on these to pair provider calls
       *  with debate dirs once concurrency >1 is unlocked. */
      readonly debateTopic?: string
      /** M10 forward-compat. 'opposing' = opposing-party turn;
       *  'synthesis' = caller's DECISION-authoring turn; 'continuation'
       *  = caller's post-decision phase-continuation invocation. */
      readonly debateTurn?: 'opposing' | 'synthesis' | 'continuation'
      /** 09-byterover-cli B3 (Codex thread `019e1318`):
       *  orchestrator-operation correlation id (`T-NNN`). Set by fan-out
       *  call sites — REVIEW panel via the production-seam invoker, debate
       *  runtime via `requestDebate`. Per-provider cost rows under one
       *  panel run or one debate now correlate back to the parent
       *  orchestrator step instead of appearing as N detached billing
       *  rows. Optional and forward-compatible: M14/M15 readers parse new
       *  events identically; reducers in `src/providers/cost.ts` ignore
       *  unknown fields. The runtime validator at `src/state/events.ts`
       *  enforces the canonical task-id pattern when present. */
      readonly parentTaskId?: string
    }
  | {
      readonly version: 1
      readonly type: 'agent_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly tokensUsed?: number
      /** M13 (Codex Q2 + scope correction): advisory dollar cost from the
       *  reported tokensUsed value. **Output-tokens-only semantics** — the
       *  current Claude adapter reads `usage.output_tokens` and the xAI
       *  adapter reads `usage.completion_tokens`; neither is full request
       *  cost. Operators reading this field as full invoice will
       *  understate spend. Documented in COMPANY.md and the per-role
       *  budgets contract. Present only when both `tokensUsed` is
       *  reported AND a price source resolves; missing either yields no
       *  field. */
      readonly costActualUSD?: number
      /** M10 forward-compat correlation; mirrors agent_invoked. */
      readonly debateTopic?: string
      readonly debateTurn?: 'opposing' | 'synthesis' | 'continuation'
      /** 09-byterover-cli B3: mirrors agent_invoked.parentTaskId so
       *  reducer pairing keeps the parent correlation across the
       *  invoke/complete pair. */
      readonly parentTaskId?: string
    }
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'gate_written'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly file: string }>
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'gate_required'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly blockedOn: string }>
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'intervention'; readonly ts: string; readonly runId: string; readonly code: string; readonly phase?: Phase }>
  | OptionalActorAttributed<{ readonly version: 1; readonly type: 'run_ended'; readonly ts: string; readonly runId: string; readonly outcome: RunOutcome }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'ask_me_user_input'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly turn: number
      readonly input: string
    }>
  | {
      readonly version: 1
      readonly type: 'ask_me_persona_reply'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly turn: number
      readonly agent: string
      readonly response: string
      readonly ready: boolean
    }
  | {
      readonly version: 1
      readonly type: 'repo_context_searched'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly tool: 'glob' | 'grep' | 'read' | 'symbol'
      readonly query: string
      readonly roots: readonly string[]
      readonly resultPaths: readonly string[]
      readonly selectedPaths: readonly string[]
      readonly resultBytes: number
      readonly resultTokensEstimate: number
    }
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'science_emitted'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly hypothesesCount: number
      readonly openQuestionsCount: number
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'hypothesis_added'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly status: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly falsifier: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'hypothesis_updated'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly prevStatus: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly nextStatus: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly changedFields: readonly string[]
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'question_added'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly status: 'open' | 'resolved' | 'deferred'
      readonly importance: 'low' | 'medium' | 'high' | 'blocking'
      readonly dueBy: string | null
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'question_resolved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly resolvedAt: string
      readonly resolution: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'question_deferred'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly deferredAt: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'budget_warning'
      readonly ts: string
      readonly runId: string
      readonly metric:
        | 'maxTurns'
        | 'maxProviderCalls'
        | 'maxTokensEstimate'
        | 'maxWallTimeMinutes'
      readonly ratio: number
      readonly current: number
      readonly limit: number
      /** M13 (Codex Q8 lock): optional `CompanyRole` discriminator.
       *  Present when the warning is for a per-role cap under
       *  `budgets.global.byRole.<role>`; absent when the warning is for
       *  the existing global cap (back-compat). The duplicate-emit guard
       *  in `detectBudgetSoftWarnings` becomes
       *  `(metric, role ?? "global")`. Validator restricts to
       *  `M12_COMPANY_ROLES`. Note: `maxTurns` and `maxWallTimeMinutes`
       *  are global-only metrics (no per-role dimension); a `role` value
       *  paired with either is rejected. */
      readonly role?: string
    }>
  // M7 worktree events (orchestrator-owned).
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_created'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** 40-char lower-case hex sha of the base commit. */
      readonly baseCommitSha: string
      /** Absolute path to the worktree directory. */
      readonly worktreePath: string
      readonly dirtyTreePolicy: 'clean-base' | 'stash-and-pin'
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Step in the four-step creation sequence (1=rev-parse, 2=worktree add,
       * 3=mkdir supporting dirs, 4=write base.txt+README). */
      readonly step: 1 | 2 | 3 | 4
      readonly code: string
      readonly reason: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_patch_applied'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** 64-char lower-case hex sha of the patch file bytes. */
      readonly patchSha256: string
      /** Path relative to project root. */
      readonly patchPath: string
      readonly attempt: number
      readonly taskId: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_patch_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly code: string
      readonly attempt: number
      readonly taskId: string
      readonly reason: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_forensics_preserved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly attempt: number
      /** Absolute path to the forensics/<N>/ directory. */
      readonly forensicsPath: string
      /** Names of files written under forensicsPath. */
      readonly entries: readonly string[]
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_destroyed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /**
       * The attempt this destruction belongs to. On a VERIFY-pass approve,
       * this is the just-passed attempt's number. On a VERIFY-fail
       * scheduling, this is the just-failed attempt's number. The field
       * lets the canonical-event-order validator scope worktree_destroyed
       * to a specific attempt without ambiguity in retry chains.
       */
      readonly attempt: number
      readonly worktreePath: string
    }>
  // v0.20.3 #1 — BUILD-entry worktree-normalization event. Emitted on
  // success of `resetWorktreeToBase` for every BUILD attempt > 1, before
  // prompt composition / provider file-ref derivation / persona invocation.
  // Codex debate `019e28d9-bd57-71e0-b1a2-262cae205234` locked this shape.
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'worktree_reset_to_base'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Attempt number this reset prepares (always > 1). */
      readonly attempt: number
      /** 40-char lower-case hex sha the worktree was reset to. */
      readonly baseCommitSha: string
      /** Wall time for `git reset --hard` + `git clean -fdx` together. */
      readonly durationMs: number
    }>
  // M7 BUILD phase events (per docs/contracts/BUILD.md).
  | {
      readonly version: 1
      readonly type: 'build_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly baseCommitSha: string
      readonly taskId: string
    }
  | {
      readonly version: 1
      readonly type: 'build_patch_applied'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly patchSha256: string
      readonly attempt: number
      readonly taskId: string
    }
  | {
      readonly version: 1
      readonly type: 'build_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly changedFileCount: number
      /** 64-char lower-case hex sha of the canonical BUILD_REPORT.md content. */
      readonly buildReportSha256: string
      /**
       * 64-char lower-case hex sha of the BUILD prompt snapshot persisted at
       * `.code-oz/runs/<runId>/build-attempt-<N>.prompt.txt` (M16 C5). Required
       * since C5 — every `build_completed` event after the schema bump carries
       * it. Pre-C5 runs are not resumable across the schema change.
       */
      readonly promptSnapshotSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'build_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly code: string
      readonly reason: string
    }
  // M9 substrate: durable BUILD provider/family/model record. Emitted
  // immediately after build_completed. REVIEW's invocation-time check
  // reads the latest build_provider_recorded for the (runId, taskId)
  // pair and compares its `family` to the reviewer
  // adapter's family. provider is the AgentProvider id from the BUILD
  // agent's frontmatter; family is the resolved ProviderFamily via
  // src/providers/families.ts familyOf(); model is the agent's optional
  // `model` field, omitted when the agent did not pin a model.
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'build_provider_recorded'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly attempt: number
      readonly taskId: string
      readonly provider: string
      readonly family: string
      readonly model?: string
    }>
  // M8 VERIFY phase events (per docs/contracts/VERIFY.md § "Event types
  // emitted"). All four bind to the BUILD attempt being verified via
  // taskId + attempt; verify_started additionally carries the BUILD ref
  // immutable-binding triple (baseCommitSha, patchSha256, buildReportSha256)
  // so the events.jsonl reader can reconstruct what was verified without
  // re-reading BUILD_REPORT.md.
  | {
      readonly version: 1
      readonly type: 'verify_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 40-char lower-case hex; copied from BUILD_REPORT.md Base.Base commit. */
      readonly baseCommitSha: string
      /** 64-char lower-case hex; copied from BUILD_REPORT.md Patch.Patch sha256. */
      readonly patchSha256: string
      /** 64-char lower-case hex of the canonical BUILD_REPORT.md content at VERIFY-read time. */
      readonly buildReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'verify_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 64-char lower-case hex of the canonical VERIFY.md content. */
      readonly verifyReportSha256: string
      /**
       * Verdict: pass requires Mutation.Status ∈ {pass, not-applicable}, so
       * the completed event constrains to those two values. A 'fail'
       * mutation status means VERIFY.md verdict was 'fail', emitting
       * verify_failed instead.
       */
      readonly mutationStatus: 'pass' | 'not-applicable'
    }
  | {
      readonly version: 1
      readonly type: 'verify_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly verifyReportSha256: string
      /** Forwarded from the test runner's terminationReason field. */
      readonly terminationReason: 'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'
      /** Process exit code, or null on spawn-error / never-exited. */
      readonly exitCode: number | null
      /** Persona-authored Failure summary line; ≤ 200 chars per VERIFY.md grammar. */
      readonly failureSummary: string
    }
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'verify_restart_initiated'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly taskId: string
      /** The just-failed attempt number N (1..4). */
      readonly attempt: number
      /**
       * 'restart' for attempts 1-3 → next BUILD attempt scheduled at attempt+1.
       * 'intervention' for attempt 4 → cap reached, NEEDS_INTERVENTION.json written.
       */
      readonly nextAction: 'restart' | 'intervention'
      /** Present iff nextAction === 'restart'; equals attempt + 1. */
      readonly nextAttempt?: number
      /** Absolute path to the preserved forensics/<N>/ directory for the failed attempt. */
      readonly forensicsPath: string
    }>
  // M9 REVIEW phase events. All four bind to the BUILD attempt that
  // produced the artifact under review via taskId + attempt; review_started
  // additionally records the cross-family pair (buildFamily, reviewerFamily)
  // so the events.jsonl reader can reconstruct the cross-family proof
  // without re-reading REVIEW.md.
  | {
      readonly version: 1
      readonly type: 'review_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 40-char lower-case hex; copied from BUILD_REPORT.md Base.Base commit. */
      readonly baseCommitSha: string
      /** 64-char lower-case hex; copied from BUILD_REPORT.md Patch.Patch sha256. */
      readonly patchSha256: string
      /** 64-char lower-case hex of the canonical BUILD_REPORT.md content. */
      readonly buildReportSha256: string
      /** 64-char lower-case hex of the canonical VERIFY.md content (REVIEW
       *  reads VERIFY.md too — REVIEW.md § "Upstream refs" carries both). */
      readonly verifyReportSha256: string
      /** ProviderFamily of the BUILD agent that produced the artifact. */
      readonly buildFamily: string
      /** ProviderFamily of the reviewer agent (must differ from buildFamily). */
      readonly reviewerFamily: string
    }
  | {
      readonly version: 1
      readonly type: 'review_round_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** Round number, 1..4 (CLAUDE.md non-negotiable rule 6). */
      readonly round: number
      /** Persona-authored score, 0..10 inclusive. */
      readonly score: number
      /** Orchestrator-computed verdict per the canonical verdict rule. */
      readonly verdict: 'ready' | 'needs-revision' | 'block'
      /** Count of findings raised in this round (non-negative). */
      readonly findingsRaised: number
      /** Count of findings resolved in this round (non-negative). May
       *  exceed findingsRaised when prior-round findings are resolved. */
      readonly findingsResolved: number
      /** 64-char lower-case hex of the canonical REVIEW.md content
       *  written for this round. Kickoff Decision 10 says a round is
       *  complete only when canonical REVIEW.md AND the round-completed
       *  event agree. The sha lets resume probes verify that agreement
       *  instead of trusting event presence alone. */
      readonly reviewReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'review_resolved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** The round that exited with score≥6 + verdict=ready (1..4). */
      readonly finalRound: number
      /** Final score; must be >= 6 for review_resolved. */
      readonly finalScore: number
      /** 64-char lower-case hex of the canonical REVIEW.md content. */
      readonly reviewReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'review_blocked'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /**
       * Why the loop blocked:
       *   - 'block': any round emitted verdict=block.
       *   - 'cap_exhausted': 4-round cap reached without ready exit.
       * NOT emitted when VERIFY's 4-attempt cap exhausts during a
       * REVIEW round (authority overlap rule, decision 4): that path
       * is VERIFY-owned with context "while addressing REVIEW round N".
       */
      readonly reason: 'block' | 'cap_exhausted'
      /** Round at which the loop blocked (1..4). */
      readonly finalRound: number
      /** 64-char lower-case hex of the canonical REVIEW.md content
       *  (REVIEW.md is written even on block / cap-exhausted exits). */
      readonly reviewReportSha256: string
    }
  // M16 C8 — REVIEW remediation persistence. `dispatchReview` emits this
  // event once per `needs_revision` REVIEW round (single-mode AND panel-
  // mode), immediately after the round-completed / resolution event the
  // round produced. Carries `nextReviewRound` resolved by the orchestrator
  // (via `ReviewRemediationDecision.nextReviewRound`) so resumed runs can
  // pick up the next round without re-running the remediation decision.
  // The `refsTo` field joins back to the round just completed; `decisionId`
  // is a run-scoped ULID minted at emit time and is opaque to the schema.
  | {
      readonly version: 1
      readonly type: 'review_remediation_recorded'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** Round just completed (1..4); same value as the upstream
       *  `review_round_completed.round` this remediation references. */
      readonly reviewRound: number
      /** Next REVIEW round to drive after BUILD attempt N+1 lands a
       *  passing VERIFY (2..4 — never 1 since round 1 produces the FIRST
       *  needs-revision; round-cap rejection is `review_blocked` instead). */
      readonly nextReviewRound: number
      /** Run-scoped ULID minted at emit time. Lets future sweepers join
       *  remediation events to follow-up restart signals without
       *  trusting attempt arithmetic. */
      readonly decisionId: string
      /** sha256 of the canonical REVIEW.md the remediation refers to.
       *  Equals the upstream `review_round_completed.reviewReportSha256`
       *  so resume probes can verify event/artifact agreement. */
      readonly reviewMdSha256: string
      /** The remediation decision's `action` value: `'continue'` for
       *  carry-forward, `'review_cap_exhausted'` / `'build_cap_blocked'`
       *  for terminal cap paths. v0.1 `dispatchReview` only emits this
       *  event on `'continue'`; cap paths surface as `review_blocked`
       *  (REVIEW-owned) or BUILD-owned interventions. */
      readonly remediationIntent: 'continue' | 'review_cap_exhausted' | 'build_cap_blocked'
      /** Reference to the upstream `review_round_completed` event the
       *  remediation chains off. Joins by canonical sha so the audit
       *  trail does not depend on attempt arithmetic. */
      readonly refsTo: {
        readonly type: 'review_round_completed'
        readonly reviewReportSha256: string
      }
    }
  // M10 Debate runtime events. Two events cover one debate lifecycle.
  // Both events bind the calling phase via `phase`; both tie the artifact
  // directory by `topic` (run-scoped unique slug `<phase>-<topic>`).
  | {
      readonly version: 1
      readonly type: 'debate_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Calling persona name (e.g., 'lead'). */
      readonly agent: string
      /** Topic slug (lowercase-kebab-case, ≤ 48 chars; phase-prefixed:
       *  `<phase>-<topic>`). Run-scoped unique. */
      readonly topic: string
      /** Absolute path to .code-oz/artifacts/debates/<topic>/. */
      readonly debateDirPath: string
      /** 64-char lower-case hex of the canonical BRIEFING.md content. */
      readonly briefingSha256: string
      /** 64-char lower-case hex of the canonical MANIFEST.preview.md
       *  content (D9 lock: non-interactive audit; sha bound to event). */
      readonly manifestPreviewSha256: string
      /** Calling persona's provider family (cross-family invariant
       *  recorded for audit; opposingFamily must differ). */
      readonly callerFamily: string
      /** Opposing party's provider id (e.g., 'codex'); resolves via
       *  registry to opposingFamily at invocation time. */
      readonly opposingProvider: string
      /** Opposing party's provider family. Must NOT equal callerFamily
       *  (CLAUDE.md rule 2; validated at write time). */
      readonly opposingFamily: string
    }
  | {
      readonly version: 1
      readonly type: 'debate_resolved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Calling persona name (matches debate_started.agent). */
      readonly agent: string
      /** Topic slug (matches debate_started.topic). */
      readonly topic: string
      /** Absolute path to .code-oz/artifacts/debates/<topic>/. */
      readonly debateDirPath: string
      /** 64-char lower-case hex of the canonical DECISION.md content. */
      readonly decisionSha256: string
      /** Caller persona's verdict (DECISION.md authority — rule 9). */
      readonly callerVerdict: 'accept' | 'accept-with-modifications' | 'reject' | 'feature-with-modifications'
      /** Opposing party's verdict (RESPONSE.{codex,claude}.md data —
       *  recorded for audit; never auto-merged into authority). */
      readonly responseVerdict: 'accept' | 'accept-with-modifications' | 'reject' | 'feature-with-modifications'
      /** One-line rationale summary, ≤ 200 characters. The full
       *  rationale lives in DECISION.md § Rationale. */
      readonly rationaleSummary: string
    }
  // M14 Reviewer panel events. See docs/contracts/REVIEW_PANEL.md for the
  // panel grammar + 5-layer defense-in-depth + manifest equality invariant +
  // rule-21 ship-gate metric event payload.
  | {
      readonly version: 1
      readonly type: 'review_panel_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Orchestrator name (the panel runner; not a panelist persona). */
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** Panel composition with each panelist's resolved provider + family + role.
       *  Order is the canonical config order. */
      readonly panelComposition: readonly {
        readonly id: string
        readonly providerId: string
        readonly providerFamily: string
        readonly role: PanelistRole
      }[]
      /** Resolved BUILD family at the time of REVIEW. Same value across all
       *  panelists in the round. */
      readonly buildFamily: string
    }
  | {
      readonly version: 1
      readonly type: 'review_panelist_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly round: number
      readonly panelistId: string
      readonly providerId: string
      readonly providerFamily: string
      readonly modelPolicy: string
      readonly role: PanelistRole
      readonly score: number
      readonly verdict: PanelVerdict
      /** sha256 of the canonical PreparedProviderRequest.files manifest the
       *  panelist saw. Manifest equality invariant: must match across all
       *  panelists in the same round. */
      readonly manifestHash: string
      /** Path to the per-panelist staging draft
       *  (.code-oz/runs/<runId>/review-panel/round-<N>/panelist-<id>.md). */
      readonly stagingPath: string
      /** sha256 of the staging file contents. */
      readonly stagingSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'review_panel_disagreement'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly round: number
      /** fingerprintFinding(file, title) — same M9 fingerprint used for
       *  ping-pong dedup. */
      readonly fingerprint: string
      readonly kind: PanelDisagreementKind
      /** Panelist ids involved in the disagreement (≥ 2 typically; advisory
       *  unratified may have 1 advisory + 0 corroborating voters). */
      readonly reviewerIds: readonly string[]
      /** Optional structured details per disagreement kind. */
      readonly detail?: string
    }
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'panel_quorum_rejected_same_family_vote'
      readonly ts: string
      readonly runId: string
      /** Phase optional — config-load layer fires before any phase enters. */
      readonly phase?: Phase
      readonly panelistId: string
      readonly providerId: string
      readonly providerFamily: string
      readonly buildFamily: string
      /** Which of the 5-layer defense rejected the vote. */
      readonly layer: PanelQuorumRejectionLayer
      readonly detail?: string
    }>
  | {
      readonly version: 1
      readonly type: 'review_panel_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly finalRound: number
      readonly panelVerdict: PanelVerdict
      /** 64-hex sha256 of the canonical (synthesized) REVIEW.md content. */
      readonly reviewReportSha256: string
      /** Eligible cross-family voter families recorded at synthesis. Validator
       *  layer-5 backstop: when panelVerdict is 'ready', length MUST be 2. */
      readonly eligibleVoterFamilies: readonly string[]
      readonly panelistCount: number
      readonly voterCount: number
      readonly advisoryCount: number
    }
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'review_panel_baseline_completed'
      readonly ts: string
      readonly runId: string
      /** Path or hash of the test fixture used by `doctor --panel-baseline`. */
      readonly fixtureId: string
      readonly singleRunId: string
      readonly panelRunId: string
      readonly singleFindingCount: number
      readonly panelFindingCount: number
      /** Findings raised by panel that single-mode missed. */
      readonly panelOnlyFindingCount: number
      /** panelOnly AND severity in {block, fix-first} AND authorityImpact === 'voter'.
       *  Rule-21 ship gate requires this > 0. */
      readonly panelOnlyActionableFindingCount: number
      /** Optional, present when fixture has an oracle. */
      readonly expectedFindingRecallDelta?: number
      /** Count of review_panel_disagreement events in panel run. Supporting
       *  evidence for rule-21; not the core gate. */
      readonly disagreementCount: number
      /** Count of panel_quorum_rejected_same_family_vote events. Positive
       *  control for rule-21. */
      readonly sameFamilyVoteRejectionCount: number
      /** True when all panelists in panel run shared same manifest hash. */
      readonly manifestEqualityHeld: boolean
      readonly singleReviewArtifactHash: string
      readonly panelReviewArtifactHash: string
      /** Telemetry; non-gating. */
      readonly costOverheadRatio: number
      readonly wallClockOverheadMs: number
    }>
  // M15 Debate-policy scheduler events. See docs/contracts/DEBATE_POLICY.md
  // (commit 7) for the surface + defense-in-depth + common errors. The
  // scheduler is mechanical orchestrator code at the post-REVIEW call site;
  // events here are written by the orchestrator, never by an LLM. Correlation
  // through `decisionId` (run-scoped ULID) joins evaluated → fired/skipped →
  // postreview into a single trace.
  | {
      readonly version: 1
      readonly type: 'debate_scheduler_evaluated'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** Run-scoped ULID joining this scheduler decision's events together. */
      readonly decisionId: string
      /** Pre-debate REVIEW round (1-indexed) that produced the input. The
       *  4-round cap from M9 is unchanged; the post-debate round, when fired,
       *  consumes the same `reviewRound` value (no increment). */
      readonly reviewRound: number
      readonly mode: DebateSchedulerMode
      /** sha256 of the canonicalized SchedulerInput (rule-21 reproducibility). */
      readonly inputDigest: string
      /** sha256 of the pre-debate REVIEW.md content (canonical artifact at
       *  decision time). Joins to debate_scheduler_postreview's
       *  preReviewReportSha256 for verdict-flip metric attribution. */
      readonly preReviewReportSha256: string
      /** Single-mode review's Final score, when present; `null` for panel
       *  mode (panel REVIEW has no numeric Score.Final score per Codex Risk
       *  #1). */
      readonly reviewMode: 'single' | 'panel'
    }
  | {
      readonly version: 1
      readonly type: 'debate_scheduler_fired'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly decisionId: string
      readonly reviewRound: number
      readonly reason: SchedulerFireReason
      /** Selected from the calling persona's `tool_use.debate.opposingProviders`
       *  list (M10 selection logic reused). */
      readonly opposingProvider: string
      /** Topic slug (matches debate_started.topic for join-key). */
      readonly debateTopic: string
      readonly preReviewReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'debate_scheduler_skipped'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly decisionId: string
      readonly reviewRound: number
      readonly reason: SchedulerSkipReason
      readonly preReviewReportSha256: string
      /** Optional discriminator on the `budget_exhausted` reason naming which
       *  `budgets.global` cap would tip under aggregate preflight. Absent on
       *  any other reason. */
      readonly budgetTipReason?: SchedulerBudgetTipReason
    }
  | {
      readonly version: 1
      readonly type: 'debate_scheduler_error'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly decisionId: string
      readonly reviewRound: number
      readonly reason: SchedulerErrorReason
      /** Optional free-form provider error code from the underlying
       *  ProviderError; recorded for triage. */
      readonly underlyingErrorCode?: string
    }
  | {
      readonly version: 1
      readonly type: 'debate_scheduler_postreview'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly decisionId: string
      /** Same round value as the pre-debate evaluated/fired event — round
       *  counter does NOT increment for the post-debate round. */
      readonly reviewRound: number
      readonly preReviewReportSha256: string
      /** sha256 of the canonical (post-debate) REVIEW.md content. */
      readonly postReviewReportSha256: string
      readonly verdictPre: SchedulerReviewVerdict
      readonly verdictPost: SchedulerReviewVerdict
      /** Count of finding fingerprints present in post-debate REVIEW that were
       *  absent from the pre-debate REVIEW (post \ pre). */
      readonly findingsAddedCount: number
      /** findingsAddedCount restricted to severity ∈ {block, fix-first}. The
       *  rule-21 new-actionable-finding-rate metric numerator. */
      readonly actionableFindingsAddedCount: number
    }
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'debate_policy_baseline_completed'
      readonly ts: string
      readonly runId: string
      /** Path or hash of the canonical fixture set used by
       *  `doctor --debate-policy-baseline`. */
      readonly fixtureSet: string
      /** % of fired debates whose post-debate REVIEW round produces a verdict
       *  closer to the fixture oracle's labeled-correct verdict than the
       *  pre-debate verdict was. Rule-21 floor: ≥ 0.10. */
      readonly correctiveDeltaRate: number
      /** Count of fires that flipped in the wrong direction (oracle says X,
       *  pre-debate said X, post-debate said not-X). Surfaced as a regression
       *  signal alongside corrective rate. */
      readonly antiCorrectiveCount: number
      /** % of fires whose post-debate REVIEW raised ≥1 actionable
       *  (block | fix-first) finding by fingerprint vs pre-debate. Rule-21
       *  floor: ≥ 0.30. */
      readonly newActionableFindingRate: number
      /** % of fires whose post-debate REVIEW returned the SAME verdict and
       *  added zero new findings. Telemetry — surfaces wasted fires. No
       *  floor. */
      readonly noSignalFireRate: number
      /** Per-trigger breakdown — useful for tuning grey-zone min/max and
       *  panel-disagreement gating thresholds. */
      readonly perTriggerBreakdown: readonly {
        readonly reason: SchedulerFireReason
        readonly fired: number
        readonly correctiveCount: number
        readonly newActionableCount: number
      }[]
      /** Telemetry; non-gating. */
      readonly costOverheadAvgTokens: number
      readonly latencyOverheadAvgMs: number
      /** `correctiveDeltaRate >= 0.10 && newActionableFindingRate >= 0.30`. */
      readonly passedRuleTwentyOne: boolean
    }>
  // M16 — Per-task lifecycle cursor events (Codex R0 Risk #1 closure).
  // `taskIndex` is 0-based position in PLAN.md tasks declared order;
  // `taskId` is the canonical `T-NNN` id (validated against
  // src/artifacts/plan.ts TASK_ID_PATTERN). Both fields are carried so
  // the cursor projection can validate consistency between event log
  // and current PLAN.md without re-parsing PLAN per event.
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'task_started'
      readonly ts: string
      readonly runId: string
      /** PLAN.md task id (`T-NNN`). */
      readonly taskId: string
      /** 0-based index in PLAN.md tasks declared order at time of emit. */
      readonly taskIndex: number
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'task_review_passed'
      readonly ts: string
      readonly runId: string
      readonly taskId: string
      readonly taskIndex: number
      /** REVIEW round that resolved with verdict='ready' (1..4 per
       *  REVIEW_ROUND_CAP). Mirrors review_resolved.finalRound for the
       *  same task; carried here so the cursor projection does not need
       *  to re-correlate review_resolved events. */
      readonly finalRound: number
      /** 64-char lower-case hex of the canonical REVIEW.md content for
       *  the round that resolved as ready. */
      readonly reviewReportSha256: string
    }>
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'task_completed'
      readonly ts: string
      readonly runId: string
      readonly taskId: string
      readonly taskIndex: number
      /** Path to GATE_REVIEW_PASSED.json that was written by approve
       *  review. The cursor consumes this as the durable "task done"
       *  signal — emitted ONLY after the gate file write succeeds, so
       *  rule 1 (file-based gate signals) is honored. */
      readonly reviewGatePath: string
    }>
  // M16 C11 — `--provider fake` warning event. CI safety net: surfaces
  // accidental fake-provider runs in production logs. Banner stderr text
  // + this event fire ONCE per `code-oz run` invocation (not once per
  // dispatcher) when the runtime override resolves to the shared
  // FakeProvider. Tests assert both signals.
  //   `providerAlias` — the override value passed on the CLI (`'fake'`).
  //   `providerFamily` — `'fake'`. Carried for log-search ergonomics
  //     even though it equals providerAlias today; keeps the event shape
  //     symmetric with debate-scheduler events that distinguish alias /
  //     family.
  //   `fakeScriptPath` — present only when `--fake-script <path>` was
  //     supplied alongside `--provider fake`. Operators can grep the
  //     event log to find which fixture script ran.
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'fake_provider_warning_emitted'
      readonly ts: string
      readonly runId: string
      readonly providerAlias: 'fake'
      readonly providerFamily: 'fake'
      readonly fakeScriptPath?: string
    }>
  // M16 C9 follow-on — task-boundary gate-file lifecycle audit event.
  // Emitted by `dispatchBuild` / `dispatchVerify` / `dispatchReview` when
  // a stale `GATE_<PHASE>_PASSED.json` file from a prior `task_completed`
  // is deleted before the new task's dispatcher invokes `loadRun`. The
  // deletion prevents `validateRunIntegrity` from throwing
  // `gate_artifact_sha256_mismatch` against the prior task's recorded
  // artifact sha when the new task has overwritten the artifact bytes.
  // Idempotent on the dispatcher side — when the file does not exist or
  // when the latest gate's recorded sha equals the current artifact's
  // sha, no event is emitted.
  | OptionalActorAttributed<{
      readonly version: 1
      readonly type: 'gate_file_cleared'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly priorTaskId: string
      readonly currentTaskId: string
      readonly gateFile: string
      readonly priorArtifactSha256: string
    }>
  // B1a Commit 2 — `--effort` flag forensics. Emitted by `initRun`
  // immediately after `run_started` (and before `phase_entered(<initial>)`)
  // so the originals + multiplier + effective envelope are durable from
  // run start, ahead of any phase work. Reducer is a no-op (rule 23:
  // forensics-only); active-run replay reads `effectiveBudgets` from
  // this event directly (Codex R0 B1, thread 019e17f8) — replay does
  // NOT re-apply `applyEffort` to the currently-loaded config. Editing
  // `.code-oz/config.yaml` mid-run cannot change the recorded envelope.
  // Recording is conditional on `initRun` being called with budgets
  // supplied (Codex R1 F4, thread 019e1807): CLI fresh runs always
  // supply both `originalBudgets` and `effectiveBudgets`; low-level
  // state-machine tests / fixture helpers that omit them emit no
  // envelope event.
  //
  // Schema-light on `originalBudgets` / `effectiveBudgets`: the loader
  // is the schema-of-record for `CodeOzConfig['budgets']`. The validator
  // checks only the top-level shape (`global` object + `perPhase`
  // object). `byRole` lives NESTED under `global` per
  // `GlobalBudget.byRole` in `src/config/schema.ts` — NOT at top level
  // (Codex R0 F6, thread 019e17f8).
  | {
      readonly version: 1
      readonly type: 'effort_envelope_applied'
      readonly ts: string
      readonly runId: string
      /** `lite` | `balanced` | `max` | `beast` (mirrors `EFFORT_LEVELS`
       *  in `src/config/effort.ts`). */
      readonly effort: 'lite' | 'balanced' | 'max' | 'beast'
      /** Numeric multiplier from `EFFORT_MULTIPLIERS[effort]`; the
       *  validator asserts the pair is consistent with the level. */
      readonly multiplier: number
      /** Pre-`applyEffort` `CodeOzConfig['budgets']` snapshot. Shape
       *  mirrors the loader output: `{ global, perPhase }`. The `byRole`
       *  field, when present, lives NESTED under `global` (see
       *  `GlobalBudget.byRole` in `src/config/schema.ts`). The validator
       *  is schema-light on the nested shape per the comment above. */
      readonly originalBudgets: {
        readonly global: Record<string, unknown>
        readonly perPhase: Record<string, unknown>
      }
      /** Post-`applyEffort` `CodeOzConfig['budgets']` snapshot — what
       *  every consumer in the run reads (assertWithinBudget, byRole
       *  preflight, debate-policy scheduler aggregate preflight, etc.).
       *  Same shape rules as `originalBudgets`. */
      readonly effectiveBudgets: {
        readonly global: Record<string, unknown>
        readonly perPhase: Record<string, unknown>
      }
    }

// UnknownPhaseEvent is the lenient read-side fallback. The validator (rule 12)
// accepts events whose `type` is a non-empty string it doesn't recognize, so
// long as version + ts + runId are valid. Future milestones (e.g., M7's
// failure_recorded) extend the known set without bumping `version: 1`.
export interface UnknownPhaseEvent {
  readonly version: 1
  readonly type: string
  readonly ts: string
  readonly runId: string
}

// LoggedEvent is the READ-side type. readEvents() returns these; reducers and
// recovery code switch on `type` and ignore unknown variants via default:
// no-op.
export type LoggedEvent = PhaseEvent | UnknownPhaseEvent

/**
 * Narrows a LoggedEvent to a known PhaseEvent by checking against EVENT_TYPES.
 * Required for TypeScript discriminant narrowing — UnknownPhaseEvent's
 * `type: string` would otherwise subsume literal types in the PhaseEvent
 * variants, defeating switch-case narrowing on `e.type`.
 */
export function isKnownPhaseEvent(e: LoggedEvent): e is PhaseEvent {
  return (EVENT_TYPES as readonly string[]).includes(e.type)
}

// Success gate: GATE_<PHASE>_PASSED.json
export interface GateFile {
  readonly version: 1
  readonly runId: string
  readonly phase: Phase
  readonly artifact: string
  readonly artifactSha256?: string
  readonly agent: string
  readonly agentProvider?: string
  readonly approvedBy: string
  readonly approvedAt: string
  readonly notes?: string
}

// Intervention/control gates.
export interface NeedsInterventionGate {
  readonly version: 1
  readonly runId: string
  readonly phase: Phase
  readonly agent: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly actionableSuggestions: readonly string[]
  readonly eventPointer: string
  readonly createdAt: string
}

export interface PauseGate {
  readonly version: 1
  readonly runId: string
  readonly reason: string
  readonly createdAt: string
}

export interface StopGate {
  readonly version: 1
  readonly runId: string
  readonly reason: string
  readonly createdAt: string
}

// Active-run pointer at .code-oz/state/active.json
export interface ActiveRunPointer {
  readonly version: 1
  readonly runId: string
}

// Derived state at .code-oz/state/runs/<runId>/current.json
export interface RunState {
  readonly version: 1
  readonly runId: string
  readonly profile: Profile
  readonly currentPhase: Phase
  readonly phasesCompleted: readonly Phase[]
  readonly lastEventAt: string
}

// Helpers shared by validators in events.ts and gates.ts.

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO8601_REGEX.test(value)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

export function isProfile(value: unknown): value is Profile {
  return typeof value === 'string' && (PROFILES as readonly string[]).includes(value)
}

export function sequenceFor(profile: Profile): readonly Phase[] {
  return profile === 'greenfield' ? GREENFIELD_SEQUENCE : BROWNFIELD_SEQUENCE
}
