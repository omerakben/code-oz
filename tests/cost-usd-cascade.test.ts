// M13 Commit 5: estimateCostUSD + actualCostUSD cascade.
//
// Codex Q4 lock (CODEX_RESPONSE_M13.md): priceTable wins (operator,
// per-model); capabilityOf fallback (registry, per-provider). Both
// helpers return undefined when neither source has a value (Q3 token-only
// fallback).

import { describe, test, expect } from 'bun:test'
import {
  estimateCostUSD,
  actualCostUSD,
  type CostEstimateContext,
} from '../src/providers/cost.ts'
import { generateUlid } from '../src/state/schemas.ts'
import type { PreparedProviderRequest, ProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

function agent(provider = 'claude'): AgentDefinition {
  return {
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent',
    phase: 'build',
    provider: provider as AgentDefinition['provider'],
    modelPolicy: 'any',
    permissions: { read: '*', write: '*', bash: 'deny' },
    description: 'stub',
    body: 'stub',
  } as AgentDefinition
}

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'go',
    files: [],
    ...overrides,
  }
}

function prepared(
  tokensEstimate: number,
  modelOrOmit: string | { omit: true } = 'claude-opus-4-7',
): PreparedProviderRequest {
  // JavaScript default-param quirk: passing `undefined` explicitly
  // resolves to the default. Use an `{ omit: true }` sentinel for the
  // "no model" path so tests can exercise the missing-model branch.
  const omit = typeof modelOrOmit === 'object'
  const model = omit ? undefined : (modelOrOmit as string)
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'go',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate, fieldsRemovedByScope: 0 },
    ...(model !== undefined ? { model } : {}),
  } as PreparedProviderRequest
}

const emptyContext: CostEstimateContext = {
  priceTable: undefined,
  capabilityOf: () => undefined,
}

const tableOnly: CostEstimateContext = {
  priceTable: {
    'claude:claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  },
  capabilityOf: () => undefined,
}

const capOnly: CostEstimateContext = {
  priceTable: undefined,
  capabilityOf: (provider) =>
    provider === 'claude' ? { costPerMTok: { input: 4, output: 20 } } : undefined,
}

const both: CostEstimateContext = {
  priceTable: {
    'claude:claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  },
  capabilityOf: () => ({ costPerMTok: { input: 999, output: 999 } }),
}

describe('estimateCostUSD — cascade', () => {
  test('priceTable hit returns estimate (input * inputPerMTok + output * outputPerMTok)', () => {
    // 100 tokens input, no maxOutput -> 100 * 5 / 1e6 = 0.0005
    const cost = estimateCostUSD(req(), prepared(100), tableOnly)
    expect(cost).toBeCloseTo(100 * 5 / 1_000_000)
  })

  test('priceTable + maxOutputTokens combines input + output prices', () => {
    // 100 input * 5 + 200 output * 25 = 500 + 5000 = 5500 / 1e6
    const cost = estimateCostUSD(
      req({ maxOutputTokens: 200 }),
      prepared(100),
      tableOnly,
    )
    expect(cost).toBeCloseTo((100 * 5 + 200 * 25) / 1_000_000)
  })

  test('falls back to capabilityOf.costPerMTok when priceTable misses', () => {
    // capOnly: input=4, output=20. 100 input only -> 100 * 4 / 1e6
    const cost = estimateCostUSD(req(), prepared(100), capOnly)
    expect(cost).toBeCloseTo(100 * 4 / 1_000_000)
  })

  test('priceTable wins when both sources resolve (operator > registry)', () => {
    // tableOnly: 5/25, capOnly: 999/999. Should use tableOnly.
    const cost = estimateCostUSD(req(), prepared(100), both)
    expect(cost).toBeCloseTo(100 * 5 / 1_000_000)
  })

  test('returns undefined when neither source resolves (token-only fallback)', () => {
    expect(estimateCostUSD(req(), prepared(100), emptyContext)).toBeUndefined()
  })

  test('returns undefined when prepared.model is missing', () => {
    expect(estimateCostUSD(req(), prepared(100, { omit: true }), tableOnly)).toBeUndefined()
  })

  test('returns undefined when prepared.model not in priceTable and no capability', () => {
    const ctx: CostEstimateContext = {
      priceTable: { 'claude:other-model': { inputPerMTok: 1, outputPerMTok: 2 } },
      capabilityOf: () => undefined,
    }
    expect(estimateCostUSD(req(), prepared(100, 'claude-opus-4-7'), ctx)).toBeUndefined()
  })

  test('Map-shaped priceTable also works (resolver tolerance)', () => {
    const ctx: CostEstimateContext = {
      priceTable: new Map([
        ['claude:claude-opus-4-7', { inputPerMTok: 5, outputPerMTok: 25 }],
      ]),
      capabilityOf: () => undefined,
    }
    const cost = estimateCostUSD(req(), prepared(100), ctx)
    expect(cost).toBeCloseTo(100 * 5 / 1_000_000)
  })
})

describe('actualCostUSD — output-tokens-only semantics', () => {
  test('priceTable hit returns tokensUsed * outputPerMTok / 1e6', () => {
    // 1000 tokensUsed * 25 outputPerMTok = 25000 / 1e6 = 0.025
    const cost = actualCostUSD('claude', 'claude-opus-4-7', tableOnly, 1000)
    expect(cost).toBeCloseTo(1000 * 25 / 1_000_000)
  })

  test('falls back to capability when priceTable misses', () => {
    const cost = actualCostUSD('claude', 'claude-opus-4-7', capOnly, 500)
    expect(cost).toBeCloseTo(500 * 20 / 1_000_000)
  })

  test('returns undefined when no rates resolve', () => {
    expect(actualCostUSD('claude', 'claude-opus-4-7', emptyContext, 100)).toBeUndefined()
  })

  test('returns undefined when model is undefined', () => {
    expect(actualCostUSD('claude', undefined, tableOnly, 100)).toBeUndefined()
  })

  test('zero tokensUsed yields zero (not undefined)', () => {
    expect(actualCostUSD('claude', 'claude-opus-4-7', tableOnly, 0)).toBe(0)
  })

  test('matches the documented semantics: only output rate applied (input ignored)', () => {
    // Even if priceTable has very different input/output rates, only
    // outputPerMTok is applied. Codex scope correction:
    // tokensUsed reflects output_tokens only.
    const cost = actualCostUSD('claude', 'claude-opus-4-7', tableOnly, 100)
    expect(cost).toBeCloseTo(100 * 25 / 1_000_000)
    // Not 100 * (5+25)
  })
})
