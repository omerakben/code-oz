import type { AgentProvider } from '../agents/schema.ts'

export type Profile = 'greenfield' | 'brownfield'

export type Phase = 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'audit'

export type PresetName = 'auto' | 'paranoid' | 'interactive'

export const PRESET_NAMES: readonly PresetName[] = Object.freeze([
  'auto',
  'paranoid',
  'interactive',
])

// M12 (rule 20: role-to-provider routing authority). The shipped roster
// of company roles is defined in `src/agents/role.ts` (the leaf module
// that owns role-identity vocabulary, per the M13 review fix-soon #1
// closure in CODEX_REVIEW_M13.md). Re-exported here for back-compat
// with every existing consumer (loader, validator, tests). Project-local
// personas with names outside this constant are NOT routable as company
// roles in v0.1; the locked list is the single authority. Custom role
// routing is M16+ only when measurable need is evidenced.
export { M12_COMPANY_ROLES, type CompanyRole } from '../agents/role.ts'
import type { CompanyRole } from '../agents/role.ts'

// v0.1 ships `{ provider?, model? }` only. Per Codex Decision B, budgets
// are M13 and permissions stay persona-shaped; unsupported row keys
// (`permissions`, `budgets`, `bash`) raise a typed config issue at
// load time so users do not get false authority over a deferred surface.
//
// M14 (rule 20: panel quorum + cross-family enforcement + synthesis):
// the optional `panel` field is valid ONLY on the `reviewer` role. When
// present, it declares a multi-provider Reviewer panel; the loader
// rejects panels with !==2 voters, voters whose family matches the
// resolved BUILD family, or `panel` on any role other than reviewer.
// Same-family advisory entries are allowed but carry NO gate authority
// (positive or negative). See docs/contracts/REVIEW_PANEL.md.
export interface Panelist {
  readonly provider: AgentProvider
  readonly model?: string
  readonly role: 'voter' | 'advisory'
}

export const PANELIST_ROLES = ['voter', 'advisory'] as const

export interface CompanyRoleOverride {
  readonly provider?: AgentProvider
  readonly model?: string
  /** M14: panel applies to the `reviewer` role only; loader rejects elsewhere. */
  readonly panel?: readonly Panelist[]
}

export type CompanyConfig = Readonly<Partial<Record<CompanyRole, CompanyRoleOverride>>>

export interface PhaseBudget {
  maxTurns: number
  maxProviderCalls: number
  maxTokensEstimate: number
}

// M13 (rule 20: per-role budget gating + preflight cost estimates).
// Per-role overrides under `budgets.global.byRole.<role>`. Layered between
// per-phase and global checks: a call running on role X consumes the
// `byRole[X]` cap when present in addition to the existing global / per-phase
// caps. Codex Q9 lock (CODEX_RESPONSE_M13.md): role identity is bound
// explicitly via `ProviderRequest.role`; absent role omits per-role gating
// (project-local personas + synthetic debate opponents fall back to
// global + per-phase). Codex Blocker 2 lock: `maxTurns` is intentionally
// absent — the existing `maxTurns` reducer counts `phase_entered`, not
// agent calls, so a role dimension on it has no event-model meaning.
export interface ByRoleBudget {
  maxProviderCalls?: number
  maxTokensEstimate?: number
}

export interface GlobalBudget extends PhaseBudget {
  maxReviewRounds: number
  /**
   * Hard cap on tool_call events per provider turn. Enforced at the wrapper
   * layer in src/providers/invoke.ts as a streaming counter — the cap fires
   * exactly when the (toolCallBudgetMultiplier-scaled) ceiling is exceeded.
   * PLAN.md advisory estimatedToolCalls (M6+) is recorded for observability
   * but never compared against this value (addendum item c).
   */
  maxToolCallsPerTurn: number
  /**
   * Optional multiplier on top of maxToolCallsPerTurn. The hard ceiling is
   * floor(maxToolCallsPerTurn * toolCallBudgetMultiplier); when omitted, the
   * default multiplier is 1.5. Lets users set a soft cap (maxToolCallsPerTurn)
   * with a hard ceiling (maxToolCallsPerTurn * 1.5) without two config keys.
   */
  toolCallBudgetMultiplier?: number
  /**
   * M6 (rule 19): hard cap on wall-time minutes from `run_started.ts` to the
   * current provider call. Counts only run-active time; pauses (intervention,
   * NEEDS_INTERVENTION) still accumulate wall-time because the bar is
   * "operator wall-time," not "active CPU."
   */
  maxWallTimeMinutes: number
  /**
   * M6 (rule 19): ratio at which the wrapper emits a `budget_warning` event
   * for a metric the next call would push into the warning band. 0.75 means
   * "warn at 75% of cap." Hard kills still fire at 1.0.
   */
  softWarnAtRatio: number
  /**
   * M6 (rule 19, optional): per-model price table for dollar telemetry. Keys
   * are `<provider>:<model>` (e.g. `claude:claude-opus-4-7`). Values are the
   * per-MTok prices from platform.claude.com. Telemetry only — never used
   * for budget enforcement.
   *
   * M13 (Codex Q4 lock): the priceTable is the primary authority for
   * `costEstimateUSD` / `costActualUSD`; the runtime fallback is
   * `ProviderRegistry.capabilityOf(provider).costPerMTok`. Per Codex
   * Blocker 3, model-level Claude defaults live here in `priceTable`,
   * not on provider-level `capabilityOf`.
   */
  priceTable?: Readonly<Record<string, { readonly inputPerMTok: number; readonly outputPerMTok: number }>>
  /**
   * M13 (rule 20: per-role budget gating). Optional per-role overrides
   * keyed by `M12_COMPANY_ROLES`. Absent rows inherit the global caps;
   * missing field on a present row also inherits. Project-local personas
   * outside the roster do not gate per-role — global + per-phase still
   * enforce. Validation rejects non-canonical role keys with
   * `loader_company_role_unknown` (symmetric with M12 `mergeCompany`
   * fail-closed).
   */
  byRole?: Readonly<Partial<Record<CompanyRole, ByRoleBudget>>>
}

export type PresetValues = Readonly<{
  permissions: Readonly<
    Pick<CodeOzConfig['permissions'], 'allowEscapeHatch' | 'requireApprovalForBuild'>
  >
  softWarnAtRatio: number
}>

// B4 named approval presets are aliases that expand into explicit resolved
// config, not hidden semantic modes. Per CLAUDE.md rule 19, budgets stay
// concrete config values; per rule 20 and
// docs/comparison/06-codex/SYNTHESIS.md B4, presets are limited to this
// typed shape: permissions.allowEscapeHatch,
// permissions.requireApprovalForBuild, and budgets.global.softWarnAtRatio.
// Presets must not become a second authority surface.
export const PRESET_VALUES: Readonly<Record<PresetName, PresetValues>> = Object.freeze({
  auto: Object.freeze({
    permissions: Object.freeze({
      allowEscapeHatch: true,
      requireApprovalForBuild: false,
    }),
    softWarnAtRatio: 0.9,
  }),
  paranoid: Object.freeze({
    permissions: Object.freeze({
      allowEscapeHatch: false,
      requireApprovalForBuild: true,
    }),
    softWarnAtRatio: 0.5,
  }),
  interactive: Object.freeze({
    permissions: Object.freeze({
      allowEscapeHatch: false,
      requireApprovalForBuild: true,
    }),
    softWarnAtRatio: 0.75,
  }),
})

export interface Budgets {
  global: GlobalBudget
  perPhase: Record<Phase, PhaseBudget>
}

export type OnMaxRoundsBehavior = 'finalize' | 'fail'

export interface AskMeConfig {
  /** Cap on user→ba exchanges. Round (maxRounds) triggers onMaxRounds. */
  maxRounds: number
  /**
   * Literal token the BA persona emits to signal readiness. The orchestrator
   * matches `^\s*<readySignal>\s*$` against the most recent persona response,
   * regex-escaping the value before insertion.
   */
  readySignal: string
  /**
   * Behavior when the loop hits maxRounds without a ready signal.
   *  - 'finalize': run up to maxFinalizeTurns extra turns asking the persona
   *    to produce the best SPEC.md it can with current information.
   *  - 'fail': write NEEDS_INTERVENTION (code: ask_me_max_rounds_exceeded)
   *    and exit. No SPEC.md, no draft.
   */
  onMaxRounds: OnMaxRoundsBehavior
  /** Bounded extra turns for the finalize ritual. 0 disables. */
  maxFinalizeTurns: number
  /** Bounded extra turns when SPEC validation fails after a ready signal. */
  maxRepairTurns: number
}

export interface DefinePhaseConfig {
  askMe: AskMeConfig
}

/**
 * M6 (rule 15): Scientist phase-tail configuration. retroSeedDefine is
 * opt-in; when true, DEFINE runs the Scientist tail to seed initial
 * HYPOTHESES.md / OPEN_QUESTIONS.md from SPEC.md. Default false because M5
 * shipped a valid DEFINE flow whose canonical artifact is SPEC.md, not
 * sidecars; flipping the default would re-open M5.
 */
export interface ScientistPhaseConfig {
  retroSeedDefine: boolean
}

export interface PhasesConfig {
  define: DefinePhaseConfig
  scientist: ScientistPhaseConfig
}

// M15 (rule 20: orchestrator-side automatic-trigger policy for the existing
// single-opponent requestDebate() runtime built in M10). Optional. Absent =
// effective `mode: manual` (M10 behavior preserved). When present, validates
// every field against the locked defaults from
// docs/design/SESSION_M15_IMPL_KICKOFF.md §2.12 + §11.3. The decision
// function in src/policy/debate-scheduler.ts is the algorithm; this block
// is the surface users see in `.code-oz/config.yaml`.
export type DebateSchedulerModeConfig = 'off' | 'manual' | 'auto'

export interface DebatePolicyTriggers {
  /** Single-mode REVIEW score band that fires `score_in_grey_zone`. Bounds
   *  are inclusive. Validation: `min <= max`, both in [0, 10] (matches the
   *  REVIEW.md Score.Final range). Panel-mode REVIEW does NOT consult this
   *  (Codex Risk #1). */
  reviewScoreGreyZone: { min: number; max: number }
  /** Panel-mode trigger: at least two eligible voters return distinct
   *  verdicts. Advisory voters NEVER count (Codex Q5). */
  panelVoterDisagreement: boolean
  /** Single-mode trigger: verdict='needs-revision' AND score>=6. Boundary
   *  case — almost ready. */
  needsRevisionWithHighScore: boolean
}

export interface DebatePolicyCooldown {
  /** When true, dedup by `(taskId, attempt, preReviewReportSha256)`
   *  fingerprint — the same scheduler decision context cannot re-fire on
   *  the same task in the same run. */
  dedupByFingerprint: boolean
}

export interface DebatePolicyConfig {
  mode: DebateSchedulerModeConfig
  maxPerRun: number
  maxPerTask: number
  triggers: DebatePolicyTriggers
  cooldown: DebatePolicyCooldown
}

/** Locked defaults from kickoff §2.12. Runtime callers that observe an
 *  absent `debatePolicy` field resolve via `cfg.debatePolicy ?? DEFAULT_DEBATE_POLICY`.
 *  Default mode='manual' preserves M10 behavior unchanged. */
export const DEFAULT_DEBATE_POLICY: Readonly<DebatePolicyConfig> = Object.freeze({
  mode: 'manual',
  maxPerRun: 2,
  maxPerTask: 1,
  triggers: Object.freeze({
    reviewScoreGreyZone: Object.freeze({ min: 5, max: 7 }),
    panelVoterDisagreement: true,
    needsRevisionWithHighScore: true,
  }),
  cooldown: Object.freeze({ dedupByFingerprint: true }),
}) as DebatePolicyConfig

export const DEBATE_SCHEDULER_MODE_VALUES: readonly DebateSchedulerModeConfig[] = [
  'off',
  'manual',
  'auto',
] as const

export interface CodeOzConfig {
  preset?: PresetName
  version: string
  profile: Profile
  defaultProvider: 'claude' | 'codex' | 'gemini' | 'fake' | 'xai'
  models: {
    primary: string
    reviewer: string
  }
  budgets: Budgets
  permissions: {
    allowEscapeHatch: boolean
    requireApprovalForBuild: boolean
  }
  phases: PhasesConfig
  // M12 (rule 20: role-to-provider routing). Optional. Absent = identity
  // routing — every persona's frontmatter `provider` and `model` are the
  // resolved values. When present, the company:block wins over persona
  // frontmatter; the resolved values feed cross-family REVIEW, provider
  // eligibility, debate-opposing-family, and runtime invocation. See
  // docs/contracts/COMPANY.md.
  company?: CompanyConfig
  // M15 (rule 20: automatic-trigger policy for M10 single-opponent
  // requestDebate). Optional. Absent = `mode: manual` (M10 behavior).
  // Runtime callers resolve via `cfg.debatePolicy ?? DEFAULT_DEBATE_POLICY`.
  // See docs/contracts/DEBATE_POLICY.md.
  debatePolicy?: DebatePolicyConfig
}

export const DEFAULT_CONFIG: CodeOzConfig = {
  version: '0.21.0-alpha.0',
  profile: 'greenfield',
  defaultProvider: 'claude',
  models: {
    primary: 'claude-opus-4-7',
    reviewer: 'gpt-5.5',
  },
  budgets: {
    global: {
      maxTurns: 100,
      maxProviderCalls: 50,
      maxTokensEstimate: 2_000_000,
      maxReviewRounds: 4,
      maxToolCallsPerTurn: 10,
      toolCallBudgetMultiplier: 1.5,
      maxWallTimeMinutes: 240,
      softWarnAtRatio: 0.75,
      // M13 (Codex Q4-bis lock + Blocker 3): out-of-box USD telemetry
      // for the three Claude shipped models. Per-model rates live here
      // (priceTable is keyed by `<provider>:<model>`); the M11 capability
      // record has no model dimension and stays without `costPerMTok`.
      // xAI / Codex / Gemini / Fake stay omitted — Grok prices rotate
      // fast, Codex is a ChatGPT-CLI subscription rather than API spend,
      // Gemini is a stub, Fake is the offline test runtime. Operator
      // overrides via `.code-oz/config.yaml budgets.global.priceTable`.
      // Source: https://platform.claude.com/docs/en/about-claude/pricing
      // Lookup date: 2026-05-01
      priceTable: Object.freeze({
        'claude:claude-opus-4-7': Object.freeze({ inputPerMTok: 5, outputPerMTok: 25 }),
        'claude:claude-sonnet-4-6': Object.freeze({ inputPerMTok: 3, outputPerMTok: 15 }),
        'claude:claude-haiku-4-5-20251001': Object.freeze({
          inputPerMTok: 1,
          outputPerMTok: 5,
        }),
      }),
    },
    perPhase: {
      // M16 R1 finding 4 — per-phase budgets are CUMULATIVE across the
      // run, not per-task. The original values targeted a single-task
      // PLAN; multi-task runs (M16 C9+ task-loop) exhaust them quickly.
      // Concrete failure mode Codex flagged: default
      // verify.maxProviderCalls=5 is exhausted by 3 tasks × 2 calls
      // (verifier + scientist tail). Locked R1 decision: raise the
      // defaults to handle a 5-task PLAN with up to 2 attempts each
      // (verify-fail restart × 1 round of needs-revision).
      //
      // The values below give generous headroom while staying
      // conservative against a fully-real provider (the
      // `budgets.global` cumulative cap still fires first under
      // pathological prompt loops). Per-task budget scaling is a
      // future milestone (rule 19 already covers run-level enforcement;
      // task-level adds a new dimension).
      //
      // The C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts) writes
      // its own override of 60/60/1_000_000 for every phase — that
      // remains in place to also exercise the override path.
      define: { maxTurns: 30, maxProviderCalls: 15, maxTokensEstimate: 300_000 },
      plan: { maxTurns: 30, maxProviderCalls: 15, maxTokensEstimate: 300_000 },
      build: { maxTurns: 60, maxProviderCalls: 30, maxTokensEstimate: 1_500_000 },
      verify: { maxTurns: 30, maxProviderCalls: 30, maxTokensEstimate: 600_000 },
      review: { maxTurns: 60, maxProviderCalls: 30, maxTokensEstimate: 1_500_000 },
      ship: { maxTurns: 5, maxProviderCalls: 2, maxTokensEstimate: 50_000 },
      audit: { maxTurns: 30, maxProviderCalls: 15, maxTokensEstimate: 300_000 },
    },
  },
  permissions: {
    allowEscapeHatch: false,
    requireApprovalForBuild: true,
  },
  phases: {
    define: {
      askMe: {
        maxRounds: 8,
        readySignal: '<spec-ready/>',
        onMaxRounds: 'finalize',
        maxFinalizeTurns: 1,
        maxRepairTurns: 1,
      },
    },
    scientist: {
      retroSeedDefine: false,
    },
  },
}
