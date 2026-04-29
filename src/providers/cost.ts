// Conservative token estimator. v0.1 uses a deliberately rough heuristic:
// ~4 characters per token English upper bound, plus a per-provider safety
// multiplier (deferred — single shared estimator for now). The bound is
// "refuse before catastrophic spend," not "predict to within 5%."
//
// No tokenizer dependency. When a provider's actual token cost matters
// (M5+ when real spend is on the line), adapters can override via a
// provider-specific estimator without changing this module's contract.

import type { ProviderFile } from './types.ts'

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
 * Used by the wrapper layer (commit 7) for two purposes:
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
