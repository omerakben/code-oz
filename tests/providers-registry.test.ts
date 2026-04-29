import { describe, test, expect } from 'bun:test'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderId,
} from '../src/providers/types.ts'

// Minimal stub adapter for registry shape testing. Real adapters land in
// commit 5 (FakeProvider) and commit 8 (Claude/Codex/Gemini).
function stubProvider(id: ProviderId): IAgentProvider {
  return {
    id,
    family: id,
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
})
