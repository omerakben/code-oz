export type Profile = 'greenfield' | 'brownfield'

export type Phase = 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'audit'

export interface PhaseBudget {
  maxTurns: number
  maxProviderCalls: number
  maxTokensEstimate: number
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

export interface PhasesConfig {
  define: DefinePhaseConfig
}

export interface CodeOzConfig {
  version: string
  profile: Profile
  defaultProvider: 'claude' | 'codex' | 'gemini' | 'fake'
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
}

export const DEFAULT_CONFIG: CodeOzConfig = {
  version: '0.5.0-alpha.0',
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
  },
}
