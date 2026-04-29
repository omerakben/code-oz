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
}

export const DEFAULT_CONFIG: CodeOzConfig = {
  version: '0.4.0-alpha.0',
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
}
