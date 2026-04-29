// Conservative token estimator + cost-budget assertions for the wrapper.
//
// estimateTokens: deliberately rough heuristic — ~4 characters per token
// English upper bound. The bound is "refuse before catastrophic spend," not
// "predict to within 5%." No tokenizer dependency. Adapters can override
// later (M5+) without changing this module's contract.
//
// summarizeBudgetUse + assertWithinBudget: pre-call refusal (rule 10).
// Pairs each `agent_invoked.tokensEstimate` with its matching
// `agent_completed.tokensUsed` (when present) to avoid double-counting; an
// in-flight `agent_invoked` without a paired `agent_completed` falls back to
// the recorded estimate so a crashed turn still counts toward the budget.

import { providerError } from './errors.ts'
import { isKnownPhaseEvent, type LoggedEvent, type Phase } from '../state/schemas.ts'
import type { CodeOzConfig } from '../config/schema.ts'
import type { PreparedProviderRequest, ProviderFile, ProviderRequest } from './types.ts'

const CHARS_PER_TOKEN_UPPER_BOUND = 4

export interface EstimateInput {
  readonly prompt: string
  readonly files: readonly ProviderFile[]
}

/**
 * Conservative upper-bound estimate of the token cost of a provider call.
 * The estimate is the sum of character counts (prompt + every file's
 * content) divided by the upper-bound chars-per-token ratio, rounded up.
 *
 * Used by the wrapper layer for two purposes:
 *   1. Pre-call cost-budget refusal (provider_budget_exceeded).
 *   2. The tokensEstimate metric on agent_invoked events (rule 13 in
 *      docs/references/file-based-gates.md).
 */
export function estimateTokens(input: EstimateInput): number {
  let chars = input.prompt.length
  for (const f of input.files) {
    chars += f.sizeBytes
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_UPPER_BOUND)
}

export interface BudgetCounts {
  /** Sum of paired tokensUsed (or fallback tokensEstimate) for `phase`. */
  readonly perPhaseTokens: number
  /** Sum of paired tokensUsed (or fallback tokensEstimate) across all phases. */
  readonly globalTokens: number
  /** Count of `phase_entered` events for `phase`. */
  readonly perPhaseTurns: number
  /** Count of `agent_invoked` events for `phase`. */
  readonly perPhaseProviderCalls: number
}

/**
 * Walk the event log and produce per-phase + global running totals used by
 * `assertWithinBudget`. Each `agent_invoked` event reserves its
 * `tokensEstimate`; the matching `agent_completed.tokensUsed` (FIFO within
 * a phase) replaces the estimate when present. Unmatched (in-flight)
 * agent_invoked entries keep their estimate as a conservative bound — a
 * crashed turn still counts.
 */
export function summarizeBudgetUse(
  events: readonly LoggedEvent[],
  phase: Phase,
): BudgetCounts {
  let perPhaseTokens = 0
  let globalTokens = 0
  let perPhaseTurns = 0
  let perPhaseProviderCalls = 0

  // FIFO per-phase queue of pending tokensEstimate values. agent_completed
  // for the same phase shifts the head and replaces the estimate with
  // tokensUsed (when present) or keeps the estimate (when absent).
  const pendingByPhase = new Map<Phase, number[]>()

  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'phase_entered' && e.phase === phase) {
      perPhaseTurns++
      continue
    }
    if (e.type === 'agent_invoked') {
      const queue = pendingByPhase.get(e.phase) ?? []
      queue.push(e.tokensEstimate)
      pendingByPhase.set(e.phase, queue)
      if (e.phase === phase) perPhaseProviderCalls++
      continue
    }
    if (e.type === 'agent_completed') {
      const queue = pendingByPhase.get(e.phase) ?? []
      const estimate = queue.shift() ?? 0
      const cost = e.tokensUsed ?? estimate
      globalTokens += cost
      if (e.phase === phase) perPhaseTokens += cost
      continue
    }
  }

  // Unmatched agent_invoked entries (no agent_completed yet) — count their
  // recorded estimate so a crashed turn still consumes its reserved budget.
  for (const [phaseKey, queue] of pendingByPhase) {
    for (const est of queue) {
      globalTokens += est
      if (phaseKey === phase) perPhaseTokens += est
    }
  }

  return Object.freeze({
    perPhaseTokens,
    globalTokens,
    perPhaseTurns,
    perPhaseProviderCalls,
  })
}

/**
 * Pre-call budget refusal. Throws ProviderError(provider_budget_exceeded)
 * on the first cap that the next call would push over (or already has). The
 * actionable suggestion names the exact config key to raise in
 * `.code-oz/config.yaml` so the user can recover without digging through
 * source.
 *
 * Order of checks: per-phase tokens, global tokens, per-phase turns,
 * per-phase provider calls. First breach wins (no aggregation).
 */
export function assertWithinBudget(
  config: CodeOzConfig,
  req: ProviderRequest,
  prepared: PreparedProviderRequest,
  events: readonly LoggedEvent[],
): void {
  const counts = summarizeBudgetUse(events, req.phase)
  const perPhase = config.budgets.perPhase[req.phase]
  const global = config.budgets.global
  const next = prepared.metrics.tokensEstimate

  if (counts.perPhaseTokens + next > perPhase.maxTokensEstimate) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} would exceed maxTokensEstimate`,
      [`raise budgets.perPhase.${req.phase}.maxTokensEstimate in .code-oz/config.yaml`],
      `running=${counts.perPhaseTokens}, next=${next}, cap=${perPhase.maxTokensEstimate}`,
    )
  }
  if (counts.globalTokens + next > global.maxTokensEstimate) {
    throw providerError(
      'provider_budget_exceeded',
      `global maxTokensEstimate would be exceeded`,
      [`raise budgets.global.maxTokensEstimate in .code-oz/config.yaml`],
      `running=${counts.globalTokens}, next=${next}, cap=${global.maxTokensEstimate}`,
    )
  }
  if (counts.perPhaseTurns > perPhase.maxTurns) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} has exceeded maxTurns`,
      [`raise budgets.perPhase.${req.phase}.maxTurns in .code-oz/config.yaml`],
      `running=${counts.perPhaseTurns}, cap=${perPhase.maxTurns}`,
    )
  }
  if (counts.perPhaseProviderCalls + 1 > perPhase.maxProviderCalls) {
    throw providerError(
      'provider_budget_exceeded',
      `phase ${req.phase} would exceed maxProviderCalls`,
      [`raise budgets.perPhase.${req.phase}.maxProviderCalls in .code-oz/config.yaml`],
      `running=${counts.perPhaseProviderCalls}, next=1, cap=${perPhase.maxProviderCalls}`,
    )
  }
}
