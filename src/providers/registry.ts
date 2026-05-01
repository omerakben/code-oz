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
}

export class ProviderRegistry {
  private readonly providersById: ReadonlyMap<ProviderId, IAgentProvider>
  private readonly familyById: ReadonlyMap<ProviderId, ProviderFamily>

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

    const providersById = new Map<ProviderId, IAgentProvider>()
    for (const provider of opts.providers) {
      if (providersById.has(provider.id)) {
        throw new Error(
          `ProviderRegistry: duplicate provider id ${JSON.stringify(provider.id)}`,
        )
      }
      // M9 commit 13 bp#4 (Codex review): adapter.family must match the
      // registry-resolved family for adapter.id. Without this check, a
      // misregistered adapter (e.g., declares family='codex' but is
      // registered under id='claude') could launder cross-family REVIEW
      // — REVIEW's invocation-time check compares families derived
      // from the recorded adapter id, not the adapter's own declared
      // family. Honor familyOverrides when present (test seams + W3+
      // when adapters legitimately share families).
      const expectedFamily = familyById.get(provider.id)
      if (expectedFamily !== undefined && provider.family !== expectedFamily) {
        throw new Error(
          `ProviderRegistry: adapter for id ${JSON.stringify(provider.id)} declares family ` +
            `${JSON.stringify(provider.family)} but the registry resolved family ${JSON.stringify(expectedFamily)}. ` +
            `Cross-family REVIEW would be laundered. Either correct the adapter's declared family or supply a familyOverrides entry.`,
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
