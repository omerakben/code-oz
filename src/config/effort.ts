// B1a Commit 1 — pure config transform for the `--effort` flag.
//
// `applyEffort(config, level)` returns a NEW `CodeOzConfig` whose budget
// envelope (run-shape caps in `budgets.global`, scalable rows under
// `budgets.global.byRole`, and every present `budgets.perPhase.<phase>`)
// is multiplied by the level's multiplier. Every other field is preserved
// byte-identically so the loader's invariants (frozen `byRole` rows,
// frozen `priceTable`, unchanged `softWarnAtRatio`, etc.) survive.
//
// Rounding: `Math.floor(original * multiplier)`, with a minimum of 1
// when the original was strictly positive. Explicit zero is preserved.
// Matches the loader's non-negative-integer field shape at
// src/config/load.ts:543, :683-708, :819-839.
//
// Wiring (CLI flag, event emission, active-run replay, e2e) ships in
// Commit 2; this module is pure.

import type {
  ByRoleBudget,
  Budgets,
  CodeOzConfig,
  CompanyRole,
  GlobalBudget,
  Phase,
  PhaseBudget,
} from './schema.ts'

export const EFFORT_LEVELS = ['lite', 'balanced', 'max', 'beast'] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const EFFORT_MULTIPLIERS: Readonly<Record<EffortLevel, number>> = Object.freeze({
  lite: 0.4,
  balanced: 1.0,
  max: 2.5,
  beast: 6.0,
})

function scaleCap(original: number, multiplier: number): number {
  if (original === 0) return 0
  const scaled = Math.floor(original * multiplier)
  return scaled < 1 ? 1 : scaled
}

function scaleGlobal(global: GlobalBudget, multiplier: number): GlobalBudget {
  const out: GlobalBudget = {
    maxTurns: scaleCap(global.maxTurns, multiplier),
    maxProviderCalls: scaleCap(global.maxProviderCalls, multiplier),
    maxTokensEstimate: scaleCap(global.maxTokensEstimate, multiplier),
    maxReviewRounds: global.maxReviewRounds,
    maxToolCallsPerTurn: global.maxToolCallsPerTurn,
    maxWallTimeMinutes: scaleCap(global.maxWallTimeMinutes, multiplier),
    softWarnAtRatio: global.softWarnAtRatio,
  }
  if (global.toolCallBudgetMultiplier !== undefined) {
    out.toolCallBudgetMultiplier = global.toolCallBudgetMultiplier
  }
  if (global.priceTable !== undefined) {
    out.priceTable = global.priceTable
  }
  if (global.byRole !== undefined) {
    out.byRole = scaleByRole(global.byRole, multiplier)
  }
  return out
}

function scaleByRole(
  byRole: Readonly<Partial<Record<CompanyRole, ByRoleBudget>>>,
  multiplier: number,
): Readonly<Partial<Record<CompanyRole, ByRoleBudget>>> {
  const out: Partial<Record<CompanyRole, ByRoleBudget>> = {}
  for (const [role, row] of Object.entries(byRole) as Array<[CompanyRole, ByRoleBudget]>) {
    const scaled: ByRoleBudget = {}
    if (row.maxProviderCalls !== undefined) {
      scaled.maxProviderCalls = scaleCap(row.maxProviderCalls, multiplier)
    }
    if (row.maxTokensEstimate !== undefined) {
      scaled.maxTokensEstimate = scaleCap(row.maxTokensEstimate, multiplier)
    }
    out[role] = Object.freeze(scaled)
  }
  return Object.freeze(out)
}

function scalePerPhase(
  perPhase: Record<Phase, PhaseBudget>,
  multiplier: number,
): Record<Phase, PhaseBudget> {
  const out = {} as Record<Phase, PhaseBudget>
  for (const [phase, row] of Object.entries(perPhase) as Array<[Phase, PhaseBudget]>) {
    out[phase] = {
      maxTurns: scaleCap(row.maxTurns, multiplier),
      maxProviderCalls: scaleCap(row.maxProviderCalls, multiplier),
      maxTokensEstimate: scaleCap(row.maxTokensEstimate, multiplier),
    }
  }
  return out
}

export function applyEffort(config: CodeOzConfig, effort: EffortLevel): CodeOzConfig {
  const multiplier = EFFORT_MULTIPLIERS[effort]
  const scaledBudgets: Budgets = {
    global: scaleGlobal(config.budgets.global, multiplier),
    perPhase: scalePerPhase(config.budgets.perPhase, multiplier),
  }
  return {
    ...config,
    budgets: scaledBudgets,
  }
}
