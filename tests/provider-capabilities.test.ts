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
  capabilityOf,
  type AuthSource,
  type ProviderCapability,
} from '../src/providers/capabilities.ts'
import { PROVIDER_IDS, type ProviderId } from '../src/providers/types.ts'
import { AGENT_PHASES } from '../src/agents/schema.ts'

describe('AUTH_SOURCES enum', () => {
  test('contains exactly the four mechanism-specific values', () => {
    expect(AUTH_SOURCES).toEqual([
      'claude-cli-oauth',
      'chatgpt-cli-oauth',
      'gemini-stub',
      'in-process-fake',
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
