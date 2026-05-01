// ProviderRegistry — typed lookup of adapters by ProviderId, plus the
// familyOf() authority for cross-family REVIEW enforcement (rule 2).
//
// The registry is constructed once per process via getProviderRegistry() in
// src/cli/bootstrap.ts. Adapters register themselves by passing an
// IAgentProvider instance to the constructor; the registry stores them in
// an internal map keyed by id.
//
// Cross-family enforcement (src/tools/review-request.ts, commit 9) compares
// registry.familyOf(buildProvider) === registry.familyOf(reviewer.provider)
// — never a direct ProviderId comparison. Future adapters that share a
// family (e.g., claude-cli + anthropic-api both family='claude') stay
// correct without any code change in review-request.ts.

import {
  DEFAULT_CAPABILITY_BY_ID,
  capabilitiesEqual,
  type ProviderCapability,
} from './capabilities.ts'
import { DEFAULT_FAMILY_BY_ID } from './families.ts'
import {
  type IAgentProvider,
  type ProviderFamily,
  type ProviderId,
} from './types.ts'

export interface ProviderRegistryOptions {
  readonly providers: readonly IAgentProvider[]
  /**
   * Optional override: map a ProviderId to a ProviderFamily that differs
   * from DEFAULT_FAMILY_BY_ID. Useful for tests and for W3+ when new
   * adapters share a family with existing ones.
   */
  readonly familyOverrides?: Readonly<Partial<Record<ProviderId, ProviderFamily>>>
  /**
   * Optional override: map a ProviderId to a ProviderCapability that
   * differs from DEFAULT_CAPABILITY_BY_ID. Useful for tests and for W3+
   * when HTTP-OAuth adapters land with divergent capability records.
   * Pinned in M11 (CLAUDE.md rule 20: provider eligibility authority);
   * structural-equality cross-check at registration time prevents
   * capability laundering.
   */
  readonly capabilityOverrides?: Readonly<Partial<Record<ProviderId, ProviderCapability>>>
}

export class ProviderRegistry {
  private readonly providersById: ReadonlyMap<ProviderId, IAgentProvider>
  private readonly familyById: ReadonlyMap<ProviderId, ProviderFamily>
  private readonly capabilityById: ReadonlyMap<ProviderId, ProviderCapability>

  constructor(opts: ProviderRegistryOptions) {
    // Resolve familyById FIRST so the adapter validation below can use
    // the canonical lookup with overrides applied.
    const familyById = new Map<ProviderId, ProviderFamily>()
    for (const id of Object.keys(DEFAULT_FAMILY_BY_ID) as ProviderId[]) {
      familyById.set(id, DEFAULT_FAMILY_BY_ID[id])
    }
    if (opts.familyOverrides) {
      for (const [id, family] of Object.entries(opts.familyOverrides)) {
        if (family !== undefined) {
          familyById.set(id as ProviderId, family)
        }
      }
    }
    this.familyById = familyById

    // Resolve capabilityById alongside familyById — same defaults+overrides
    // pattern. Pinned in M11 (Codex CODEX_RESPONSE_M11.md Decision H lock:
    // structural equality, not reference; constructor override only).
    const capabilityById = new Map<ProviderId, ProviderCapability>()
    for (const id of Object.keys(DEFAULT_CAPABILITY_BY_ID) as ProviderId[]) {
      capabilityById.set(id, DEFAULT_CAPABILITY_BY_ID[id])
    }
    if (opts.capabilityOverrides) {
      for (const [id, capability] of Object.entries(opts.capabilityOverrides)) {
        if (capability !== undefined) {
          capabilityById.set(id as ProviderId, capability)
        }
      }
    }
    this.capabilityById = capabilityById

    const providersById = new Map<ProviderId, IAgentProvider>()
    for (const provider of opts.providers) {
      if (providersById.has(provider.id)) {
        throw new Error(
          `ProviderRegistry: duplicate provider id ${JSON.stringify(provider.id)}`,
        )
      }
      // adapter.family must match the registry-resolved family for
      // adapter.id. Without this check, a misregistered adapter (e.g.,
      // declares family='codex' but is registered under id='claude')
      // could launder cross-family REVIEW — REVIEW's invocation-time
      // check compares families derived from the recorded adapter id,
      // not the adapter's own declared family. Honor familyOverrides
      // when present (test seams + W3+ when adapters legitimately
      // share families).
      const expectedFamily = familyById.get(provider.id)
      if (expectedFamily !== undefined && provider.family !== expectedFamily) {
        throw new Error(
          `ProviderRegistry: adapter for id ${JSON.stringify(provider.id)} declares family ` +
            `${JSON.stringify(provider.family)} but the registry resolved family ${JSON.stringify(expectedFamily)}. ` +
            `Cross-family REVIEW would be laundered. Either correct the adapter's declared family or supply a familyOverrides entry.`,
        )
      }
      // adapter.capability must match the registry-resolved capability for
      // adapter.id under STRUCTURAL EQUALITY (not reference equality —
      // capability is a composite object). Same anti-laundering shape as
      // the family check: a misregistered adapter (e.g., declares
      // eligiblePhases=['build'] but is registered under id='gemini'
      // whose default is []) could launder M11's load-time eligibility
      // gate. Honor capabilityOverrides when present (test seams + W3+
      // when HTTP adapters land with divergent capability records).
      const expectedCapability = capabilityById.get(provider.id)
      if (
        expectedCapability !== undefined &&
        !capabilitiesEqual(provider.capability, expectedCapability)
      ) {
        throw new Error(
          `ProviderRegistry: adapter for id ${JSON.stringify(provider.id)} declares a capability ` +
            `that does not structurally match the registry-resolved capability. ` +
            `Provider eligibility (M11) would be laundered. Either correct the adapter's declared ` +
            `capability or supply a capabilityOverrides entry.`,
        )
      }
      providersById.set(provider.id, provider)
    }
    this.providersById = providersById
  }

  /**
   * Returns true when an adapter is registered for the given id.
   */
  has(id: ProviderId): boolean {
    return this.providersById.has(id)
  }

  /**
   * Returns the adapter registered for `id`, or throws when absent. The
   * ProviderRegistry contract is "ask only for what you registered" — the
   * wrapper layer and tools modules look up by the agent's frontmatter
   * `provider` field which is already validated against PROVIDER_IDS at
   * agent-load time.
   */
  get(id: ProviderId): IAgentProvider {
    const provider = this.providersById.get(id)
    if (provider === undefined) {
      throw new Error(`ProviderRegistry: no adapter registered for id ${JSON.stringify(id)}`)
    }
    return provider
  }

  /**
   * The single authority for cross-family REVIEW enforcement. Never compare
   * ProviderId fields directly — always go through this method.
   */
  familyOf(id: ProviderId): ProviderFamily {
    const family = this.familyById.get(id)
    if (family === undefined) {
      throw new Error(`ProviderRegistry: no family registered for id ${JSON.stringify(id)}`)
    }
    return family
  }

  /**
   * The single authority for runtime provider-capability lookup. Seeded
   * from DEFAULT_CAPABILITY_BY_ID, layered with optional
   * capabilityOverrides. Pinned in M11 (CLAUDE.md rule 20: provider
   * eligibility authority).
   *
   * Load-time callers (src/agents/loader.ts) import the pure
   * `capabilityOf()` from src/providers/capabilities.ts directly because
   * no registry exists at load time — same load/runtime split as
   * `familyOf()`.
   */
  capabilityOf(id: ProviderId): ProviderCapability {
    const capability = this.capabilityById.get(id)
    if (capability === undefined) {
      throw new Error(`ProviderRegistry: no capability registered for id ${JSON.stringify(id)}`)
    }
    return capability
  }

  /**
   * List the ProviderIds the registry knows about. Stable order matches
   * insertion order (the order the constructor's providers array supplied).
   */
  ids(): readonly ProviderId[] {
    return Object.freeze(Array.from(this.providersById.keys()))
  }

  /**
   * List every registered adapter. Used by `code-oz doctor providers` to
   * aggregate health() results.
   */
  all(): readonly IAgentProvider[] {
    return Object.freeze(Array.from(this.providersById.values()))
  }
}
