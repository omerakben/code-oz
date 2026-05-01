import { describe, test, expect } from 'bun:test'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { capabilityOf } from '../src/providers/capabilities.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderId,
} from '../src/providers/types.ts'

// Minimal stub adapter for registry shape testing. Real adapters land in
// commit 5 (FakeProvider) and commit 8 (Claude/Codex/Gemini). M11 added
// the static `capability` field; the stub reads from `capabilityOf(id)`
// so the registry's structural-equality cross-check passes by default.
function stubProvider(id: ProviderId): IAgentProvider {
  return {
    id,
    family: id,
    capability: capabilityOf(id),
    invoke: async function* (_req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
      yield {
        type: 'turn_completed',
        response: {
          content: 'stub',
          model: 'stub-model',
          stopReason: 'end_turn',
        },
      }
    },
    async health(): Promise<ProviderHealth> {
      return { provider: id, authStatus: 'ok', modelDefaultAvailable: true }
    },
  }
}

describe('ProviderRegistry', () => {
  test('constructs with no providers and reports empty', () => {
    const r = new ProviderRegistry({ providers: [] })
    expect(r.ids()).toEqual([])
    expect(r.all()).toEqual([])
    expect(r.has('claude')).toBe(false)
  })

  test('registers and retrieves adapters by id', () => {
    const claude = stubProvider('claude')
    const fake = stubProvider('fake')
    const r = new ProviderRegistry({ providers: [claude, fake] })
    expect(r.has('claude')).toBe(true)
    expect(r.has('fake')).toBe(true)
    expect(r.has('codex')).toBe(false)
    expect(r.get('claude')).toBe(claude)
    expect(r.get('fake')).toBe(fake)
  })

  test('rejects duplicate ids', () => {
    expect(
      () => new ProviderRegistry({ providers: [stubProvider('claude'), stubProvider('claude')] }),
    ).toThrow(/duplicate provider id/)
  })

  test('get throws for unregistered ids', () => {
    const r = new ProviderRegistry({ providers: [] })
    expect(() => r.get('claude')).toThrow(/no adapter registered/)
  })

  test('familyOf returns identity mapping in v0.1', () => {
    const r = new ProviderRegistry({ providers: [] })
    expect(r.familyOf('claude')).toBe('claude')
    expect(r.familyOf('codex')).toBe('codex')
    expect(r.familyOf('gemini')).toBe('gemini')
    expect(r.familyOf('fake')).toBe('fake')
  })

  test('familyOverrides remap a single id without disturbing the rest', () => {
    const r = new ProviderRegistry({
      providers: [],
      familyOverrides: { codex: 'claude' }, // Hypothetical: codex declared as same-family as claude
    })
    expect(r.familyOf('codex')).toBe('claude')
    // Other ids stay on their default family.
    expect(r.familyOf('claude')).toBe('claude')
    expect(r.familyOf('gemini')).toBe('gemini')
  })

  test('cross-family check uses familyOf, not direct id comparison', () => {
    // Simulates the v0.3+ scenario where two distinct ProviderIds share a
    // family (claude-cli + anthropic-api both family='claude'). The current
    // ProviderId union doesn't carry these literals — we simulate via the
    // familyOverrides escape hatch on a v0.1-known id pair.
    const r = new ProviderRegistry({
      providers: [],
      // Pretend codex is actually a second claude-family adapter.
      familyOverrides: { codex: 'claude' },
    })
    // Use string-typed locals so we exercise the runtime semantics; the
    // typed `ProviderId !== ProviderId` would be a static literal compare
    // TypeScript would optimize away.
    const buildProvider = 'claude' as ProviderId
    const reviewerProvider = 'codex' as ProviderId
    // Direct id comparison would say "different — passes review."
    expect((buildProvider as string) !== (reviewerProvider as string)).toBe(true)
    // Family comparison correctly reports they're the same family.
    expect(r.familyOf(buildProvider)).toBe(r.familyOf(reviewerProvider))
  })

  test('ids() preserves insertion order from the constructor', () => {
    const ids: ProviderId[] = ['gemini', 'fake', 'claude', 'codex']
    const r = new ProviderRegistry({ providers: ids.map(stubProvider) })
    expect(r.ids()).toEqual(ids)
  })

  test('all() returns every registered adapter', () => {
    const claude = stubProvider('claude')
    const fake = stubProvider('fake')
    const r = new ProviderRegistry({ providers: [claude, fake] })
    expect(r.all()).toEqual([claude, fake])
  })

  test('M9 commit 13 bp#4: rejects an adapter whose declared family does not match familyOf(id)', () => {
    // Misregistered adapter: declares id='claude' but family='codex'.
    // Without the bp#4 check, this would launder cross-family REVIEW
    // (the BUILD adapter would record family='codex' but operate as
    // a claude-id adapter; reviewer_family would compare against
    // 'codex' even though the operational adapter is claude).
    const lying: IAgentProvider = {
      id: 'claude',
      family: 'codex' as 'claude',
      capability: capabilityOf('claude'),
      invoke: async function* (): AsyncIterable<ProviderEvent> {
        yield {
          type: 'turn_completed',
          response: { content: 'stub', model: 'stub', stopReason: 'end_turn' },
        }
      },
      async health(): Promise<ProviderHealth> {
        return { provider: 'claude', authStatus: 'ok', modelDefaultAvailable: true }
      },
    }
    expect(
      () => new ProviderRegistry({ providers: [lying] }),
    ).toThrow(/declares family "codex" but the registry resolved family "claude"/)
  })

  test('M9 commit 13 bp#4: accepts an adapter whose family matches a familyOverrides entry', () => {
    // Same misregistered shape as above, but the operator supplies an
    // override that legitimately remaps id='claude' to family='codex'.
    // Treated as an explicit-acknowledgement escape hatch (e.g., a
    // future adapter that ships with claude-id but operates under
    // codex family). Override wins; no throw.
    const adapter: IAgentProvider = {
      id: 'claude',
      family: 'codex' as 'claude',
      capability: capabilityOf('claude'),
      invoke: async function* (): AsyncIterable<ProviderEvent> {
        yield {
          type: 'turn_completed',
          response: { content: 'stub', model: 'stub', stopReason: 'end_turn' },
        }
      },
      async health(): Promise<ProviderHealth> {
        return { provider: 'claude', authStatus: 'ok', modelDefaultAvailable: true }
      },
    }
    const r = new ProviderRegistry({
      providers: [adapter],
      familyOverrides: { claude: 'codex' },
    })
    expect(r.familyOf('claude')).toBe('codex')
  })
})

describe('ProviderRegistry — capability authority (M11 commit 3)', () => {
  test('capabilityOf returns DEFAULT_CAPABILITY_BY_ID entries when no override is supplied', () => {
    const r = new ProviderRegistry({
      providers: [stubProvider('claude'), stubProvider('codex'), stubProvider('gemini'), stubProvider('fake')],
    })
    expect(r.capabilityOf('claude')).toBe(capabilityOf('claude'))
    expect(r.capabilityOf('codex')).toBe(capabilityOf('codex'))
    expect(r.capabilityOf('gemini')).toBe(capabilityOf('gemini'))
    expect(r.capabilityOf('fake')).toBe(capabilityOf('fake'))
  })

  test('capabilityOverrides remap a single id without disturbing the rest', () => {
    const customClaude = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['build', 'verify'] as const),
    })
    // The overridden adapter must declare the matching capability so the
    // registry's structural-equality cross-check succeeds.
    const claudeStub: IAgentProvider = {
      id: 'claude',
      family: 'claude',
      capability: customClaude,
      invoke: async function* (): AsyncIterable<ProviderEvent> {
        yield {
          type: 'turn_completed',
          response: { content: 'stub', model: 'stub-model', stopReason: 'end_turn' },
        }
      },
      async health(): Promise<ProviderHealth> {
        return { provider: 'claude', authStatus: 'ok', modelDefaultAvailable: true }
      },
    }
    const r = new ProviderRegistry({
      providers: [claudeStub, stubProvider('codex')],
      capabilityOverrides: { claude: customClaude },
    })
    expect(r.capabilityOf('claude')).toBe(customClaude)
    // codex unaffected — stays at default
    expect(r.capabilityOf('codex')).toBe(capabilityOf('codex'))
  })

  test('rejects an adapter whose capability does not structurally match registry-resolved (no override)', () => {
    // Misregistered: adapter declares a custom capability but the registry
    // has no matching override. M11's anti-laundering check fires:
    // load-time eligibility would be laundered (adapter could declare
    // expanded eligibility while the registry sees the default).
    const lying: IAgentProvider = {
      id: 'gemini',
      family: 'gemini',
      capability: Object.freeze({
        authSource: 'gemini-stub' as const,
        eligiblePhases: Object.freeze(['build'] as const),  // gemini default is []
      }),
      invoke: async function* (): AsyncIterable<ProviderEvent> {
        yield {
          type: 'turn_completed',
          response: { content: 'stub', model: 'stub', stopReason: 'end_turn' },
        }
      },
      async health(): Promise<ProviderHealth> {
        return { provider: 'gemini', authStatus: 'unsupported', modelDefaultAvailable: false }
      },
    }
    expect(() => new ProviderRegistry({ providers: [lying] })).toThrow(
      /declares a capability that does not structurally match/,
    )
  })

  test('rejects an adapter declaring default capability when registry has an override (laundering protection)', () => {
    // Adapter declares the DEFAULT capability for claude but the registry
    // is constructed with a NON-DEFAULT override. The cross-check fails
    // because the adapter's declared capability does not honor the
    // override — exactly the laundering shape the test for
    // familyOverrides establishes for primitive families.
    const customClaude = Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: Object.freeze(['build', 'verify'] as const),
    })
    expect(
      () =>
        new ProviderRegistry({
          providers: [stubProvider('claude')], // capability: capabilityOf('claude') (default)
          capabilityOverrides: { claude: customClaude },
        }),
    ).toThrow(/declares a capability that does not structurally match/)
  })

  test('throws when capabilityOf is called for an unknown id', () => {
    const r = new ProviderRegistry({ providers: [] })
    expect(() => r.capabilityOf('nope' as ProviderId)).toThrow(
      /no capability registered for id/,
    )
  })
})
