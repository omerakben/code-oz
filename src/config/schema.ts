import type { AgentProvider } from '../agents/schema.ts'

export type Profile = 'greenfield' | 'brownfield'

export type Phase = 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'audit'

// M12 (rule 20: role-to-provider routing authority). The shipped roster of
// company roles. Project-local personas with names outside this constant
// are NOT routable as company roles in v0.1; the locked list is the single
// authority. Custom role routing is M16+ only when measurable need is
// evidenced. Per Codex Decision A flip in CODEX_RESPONSE_M12.md (thread
// 019de4bb): without the constant, M12 quietly becomes "custom role
// routing" — a feature the project does not yet earn.
export const M12_COMPANY_ROLES = [
  'ba',
  'lead',
  'builder',
  'verifier',
  'reviewer',
  'scientist',
] as const
export type CompanyRole = (typeof M12_COMPANY_ROLES)[number]

// v0.1 ships `{ provider?, model? }` only. Per Codex Decision B, budgets
// are M13 and permissions stay persona-shaped; unsupported row keys
// (`permissions`, `budgets`, `bash`) raise a typed config issue at
// load time so users do not get false authority over a deferred surface.
export interface CompanyRoleOverride {
  readonly provider?: AgentProvider
  readonly model?: string
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

export interface CodeOzConfig {
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
}

export const DEFAULT_CONFIG: CodeOzConfig = {
  version: '0.13.0-alpha.0',
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
      define: { maxTurns: 30, maxProviderCalls: 15, maxTokensEstimate: 300_000 },
      plan: { maxTurns: 30, maxProviderCalls: 15, maxTokensEstimate: 300_000 },
      build: { maxTurns: 50, maxProviderCalls: 25, maxTokensEstimate: 800_000 },
      verify: { maxTurns: 10, maxProviderCalls: 5, maxTokensEstimate: 100_000 },
      review: { maxTurns: 20, maxProviderCalls: 10, maxTokensEstimate: 400_000 },
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
