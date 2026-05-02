// Tests for src/providers/capabilities.ts (M11 commit 2/4).
//
// Covers the strict-minimal ProviderCapability contract: every provider has
// a declared capability; v0.1 default eligibility (claude/codex/fake all
// AGENT_PHASES, gemini []); authSource enum is mechanism-not-SKU; cost and
// rate-limit fields are advisory and omitted by default per Codex's
// data-rotting guard; capability records and tables are frozen against
// mutation; capabilityOf throws on unknown ids.
//
// The contract surface lives in docs/references/provider-contract.md
// § "Capability and eligibility (M11)" and the v0.1 defaults table in
// docs/contracts/PROVIDERS.md § "Capabilities and eligibility (M11)".

import { describe, test, expect } from 'bun:test'
import {
  AUTH_SOURCES,
  DEFAULT_CAPABILITY_BY_ID,
  capabilitiesEqual,
  capabilityOf,
  type AuthSource,
  type ProviderCapability,
} from '../src/providers/capabilities.ts'
import { PROVIDER_IDS, type ProviderId } from '../src/providers/types.ts'
import { AGENT_PHASES } from '../src/agents/schema.ts'

describe('AUTH_SOURCES enum', () => {
  test('contains exactly the v0.1 mechanism-specific values', () => {
    // PE-1 added `xai-api-key` as the first API-key transmission auth
    // source. Future API-key adapters land their own per-mechanism value
    // (e.g., openrouter-api-key in PE-2 if PE-2 commits) — never a generic
    // shared name. See docs/references/provider-contract.md § "Capability
    // and eligibility (M11)" Forward-compat for the discipline.
    expect(AUTH_SOURCES).toEqual([
      'claude-cli-oauth',
      'chatgpt-cli-oauth',
      'gemini-stub',
      'in-process-fake',
      'xai-api-key',
    ])
  })

  test('does NOT contain SKU labels (Max / Plus / Pro live in prose only)', () => {
    const sku = ['claude-max', 'chatgpt-plus', 'chatgpt-pro', 'claude-pro'] as const
    for (const label of sku) {
      expect((AUTH_SOURCES as readonly string[]).includes(label)).toBe(false)
    }
  })
})

describe('DEFAULT_CAPABILITY_BY_ID', () => {
  test('every ProviderId has a declared capability', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_CAPABILITY_BY_ID[id]).toBeDefined()
    }
  })

  test('claude declares claude-cli-oauth + every AGENT_PHASES value eligible', () => {
    const cap = DEFAULT_CAPABILITY_BY_ID.claude
    expect(cap.authSource).toBe('claude-cli-oauth')
    expect([...cap.eligiblePhases]).toEqual([...AGENT_PHASES])
  })

  test('codex declares chatgpt-cli-oauth + every AGENT_PHASES value eligible', () => {
    const cap = DEFAULT_CAPABILITY_BY_ID.codex
    expect(cap.authSource).toBe('chatgpt-cli-oauth')
    expect([...cap.eligiblePhases]).toEqual([...AGENT_PHASES])
  })

  test('gemini declares gemini-stub + zero eligible phases (rule-20 teeth)', () => {
    const cap = DEFAULT_CAPABILITY_BY_ID.gemini
    expect(cap.authSource).toBe('gemini-stub')
    expect(cap.eligiblePhases.length).toBe(0)
  })

  test('fake declares in-process-fake + every AGENT_PHASES value eligible', () => {
    const cap = DEFAULT_CAPABILITY_BY_ID.fake
    expect(cap.authSource).toBe('in-process-fake')
    expect([...cap.eligiblePhases]).toEqual([...AGENT_PHASES])
  })

  test('xai declares xai-api-key + every AGENT_PHASES value eligible (PE-1)', () => {
    const cap = DEFAULT_CAPABILITY_BY_ID.xai
    expect(cap.authSource).toBe('xai-api-key')
    expect([...cap.eligiblePhases]).toEqual([...AGENT_PHASES])
  })

  test('costPerMTok is omitted on every v0.1 default (no rotting data)', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_CAPABILITY_BY_ID[id].costPerMTok).toBeUndefined()
    }
  })

  test('rateLimits is omitted on every v0.1 default (advisory in M11; M13 may populate)', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_CAPABILITY_BY_ID[id].rateLimits).toBeUndefined()
    }
  })

  test('each capability uses an AuthSource enum value', () => {
    for (const id of PROVIDER_IDS) {
      const cap = DEFAULT_CAPABILITY_BY_ID[id]
      expect((AUTH_SOURCES as readonly string[]).includes(cap.authSource)).toBe(true)
    }
  })

  test('capability table itself is frozen (cannot reassign or add ids)', () => {
    expect(Object.isFrozen(DEFAULT_CAPABILITY_BY_ID)).toBe(true)
    expect(() => {
      ;(DEFAULT_CAPABILITY_BY_ID as Record<string, ProviderCapability>).novel = {
        authSource: 'in-process-fake',
        eligiblePhases: [],
      }
    }).toThrow()
  })

  test('each capability object is frozen', () => {
    for (const id of PROVIDER_IDS) {
      expect(Object.isFrozen(DEFAULT_CAPABILITY_BY_ID[id])).toBe(true)
    }
  })

  test('eligiblePhases array is frozen against mutation', () => {
    expect(Object.isFrozen(DEFAULT_CAPABILITY_BY_ID.claude.eligiblePhases)).toBe(true)
    expect(() => {
      ;(DEFAULT_CAPABILITY_BY_ID.claude.eligiblePhases as unknown as string[]).push('audit')
    }).toThrow()
  })

  test('gemini eligiblePhases array is frozen too (the empty array is the data)', () => {
    expect(Object.isFrozen(DEFAULT_CAPABILITY_BY_ID.gemini.eligiblePhases)).toBe(true)
  })
})

describe('capabilityOf()', () => {
  test('returns the same capability instance for each registered id', () => {
    for (const id of PROVIDER_IDS) {
      expect(capabilityOf(id)).toBe(DEFAULT_CAPABILITY_BY_ID[id])
    }
  })

  test('throws on unknown id with an actionable message', () => {
    expect(() => capabilityOf('unknown' as ProviderId)).toThrow(
      /capabilityOf: no capability registered for provider id "unknown"/,
    )
  })

  test('typed return value is ProviderCapability', () => {
    const cap: ProviderCapability = capabilityOf('claude')
    const src: AuthSource = cap.authSource
    expect(src).toBe('claude-cli-oauth')
  })
})

describe('capabilitiesEqual() — structural equality', () => {
  const baseCap: ProviderCapability = Object.freeze({
    authSource: 'claude-cli-oauth' as const,
    eligiblePhases: Object.freeze(['plan', 'build', 'verify'] as const),
  })

  test('returns true for the same reference', () => {
    expect(capabilitiesEqual(baseCap, baseCap)).toBe(true)
  })

  test('returns true for distinct objects with identical contents', () => {
    const copy: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build', 'verify'] as const),
    })
    expect(capabilitiesEqual(baseCap, copy)).toBe(true)
  })

  test('returns false on different authSource', () => {
    const other: ProviderCapability = Object.freeze({
      authSource: 'codex-cli-oauth' as unknown as AuthSource,
      eligiblePhases: Object.freeze(['plan', 'build', 'verify'] as const),
    })
    expect(capabilitiesEqual(baseCap, other)).toBe(false)
  })

  test('returns false on different eligiblePhases length', () => {
    const shorter: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build'] as const),
    })
    expect(capabilitiesEqual(baseCap, shorter)).toBe(false)
  })

  test('returns false on different eligiblePhases order (order-sensitive)', () => {
    // eligiblePhases is a list; order is part of the value identity. If a
    // future change wants order-insensitive equality, that is a contract
    // decision, not a quiet flip.
    const reordered: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['build', 'plan', 'verify'] as const),
    })
    expect(capabilitiesEqual(baseCap, reordered)).toBe(false)
  })

  test('costPerMTok asymmetric presence is not equal', () => {
    const withCost: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build', 'verify'] as const),
      costPerMTok: Object.freeze({ input: 5, output: 25 }),
    })
    expect(capabilitiesEqual(baseCap, withCost)).toBe(false)
    expect(capabilitiesEqual(withCost, baseCap)).toBe(false)
  })

  test('costPerMTok with different values is not equal', () => {
    const a: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan'] as const),
      costPerMTok: Object.freeze({ input: 5, output: 25 }),
    })
    const b: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan'] as const),
      costPerMTok: Object.freeze({ input: 5, output: 30 }),
    })
    expect(capabilitiesEqual(a, b)).toBe(false)
  })

  test('rateLimits asymmetric presence is not equal', () => {
    const withRate: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build', 'verify'] as const),
      rateLimits: Object.freeze({ requestsPerMinute: 60 }),
    })
    expect(capabilitiesEqual(baseCap, withRate)).toBe(false)
    expect(capabilitiesEqual(withRate, baseCap)).toBe(false)
  })

  test('rateLimits with different values is not equal', () => {
    const a: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan'] as const),
      rateLimits: Object.freeze({ requestsPerMinute: 60, tokensPerMinute: 1_000_000 }),
    })
    const b: ProviderCapability = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan'] as const),
      rateLimits: Object.freeze({ requestsPerMinute: 60, tokensPerMinute: 2_000_000 }),
    })
    expect(capabilitiesEqual(a, b)).toBe(false)
  })

  test('two capabilities with identical optional nested records compare equal', () => {
    const a: ProviderCapability = Object.freeze({
      authSource: 'chatgpt-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build'] as const),
      costPerMTok: Object.freeze({ input: 1, output: 5 }),
      rateLimits: Object.freeze({
        requestsPerMinute: 60,
        tokensPerMinute: 1_000_000,
        outputTokensPerMinute: 250_000,
      }),
    })
    const b: ProviderCapability = Object.freeze({
      authSource: 'chatgpt-cli-oauth' as const,
      eligiblePhases: Object.freeze(['plan', 'build'] as const),
      costPerMTok: Object.freeze({ input: 1, output: 5 }),
      rateLimits: Object.freeze({
        requestsPerMinute: 60,
        tokensPerMinute: 1_000_000,
        outputTokensPerMinute: 250_000,
      }),
    })
    expect(capabilitiesEqual(a, b)).toBe(true)
  })

  test('every default capability equals itself', () => {
    for (const id of PROVIDER_IDS) {
      const cap = DEFAULT_CAPABILITY_BY_ID[id]
      expect(capabilitiesEqual(cap, cap)).toBe(true)
    }
  })

  test('different default capabilities are not equal to each other', () => {
    expect(capabilitiesEqual(DEFAULT_CAPABILITY_BY_ID.claude, DEFAULT_CAPABILITY_BY_ID.gemini)).toBe(
      false,
    )
    expect(capabilitiesEqual(DEFAULT_CAPABILITY_BY_ID.codex, DEFAULT_CAPABILITY_BY_ID.gemini)).toBe(
      false,
    )
  })
})

describe('M11 anti-pattern guards (the deferred W3 fields are not present)', () => {
  // These tests fail loudly if a future change quietly reintroduces the
  // four traits Codex flipped to deferred-W3 status (decision C). The TS
  // shape is checked via runtime "in" guards; these are the structural
  // checks that go red if someone re-adds the slot before the milestone
  // that owns it.
  const W3_DEFERRED_FIELDS = [
    'editSemantics',
    'shellSemantics',
    'mcpSupport',
    'sandboxProfile',
  ] as const

  for (const id of PROVIDER_IDS) {
    test(`${id} capability does not carry any deferred W3 trait field`, () => {
      const cap = DEFAULT_CAPABILITY_BY_ID[id] as unknown as Record<string, unknown>
      for (const field of W3_DEFERRED_FIELDS) {
        expect(field in cap).toBe(false)
      }
    })
  }
})
