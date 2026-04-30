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
  DEFAULT_FAMILY_BY_ID,
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
}

export class ProviderRegistry {
  private readonly providersById: ReadonlyMap<ProviderId, IAgentProvider>
  private readonly familyById: ReadonlyMap<ProviderId, ProviderFamily>

  constructor(opts: ProviderRegistryOptions) {
    const providersById = new Map<ProviderId, IAgentProvider>()
    for (const provider of opts.providers) {
      if (providersById.has(provider.id)) {
        throw new Error(
          `ProviderRegistry: duplicate provider id ${JSON.stringify(provider.id)}`,
        )
      }
      providersById.set(provider.id, provider)
    }
    this.providersById = providersById

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
