// Pure ProviderId -> ProviderFamily lookup, shared by load-time and runtime
// cross-family enforcement.
//
// Background: CLAUDE.md non-negotiable rule 2 (cross-family review at REVIEW
// gate) is layered. Load-time enforcement runs in src/agents/loader.ts before
// any provider registry exists, so it cannot call registry.familyOf().
// Runtime enforcement runs in src/tools/review-request.ts via the registry's
// instance method (which honors test/W3+ familyOverrides). Both paths must
// answer the same question — "are these two ids the same family?" — without
// drifting.
//
// This module is the single source of truth for the default mapping. The
// loader imports `familyOf()` directly. The registry imports
// `DEFAULT_FAMILY_BY_ID` and seeds its internal map with it, then layers
// optional overrides on top (test seams, W3+ when claude-cli vs anthropic-api
// adapters land sharing family 'claude'). Pinned by Codex's M9 substrate
// catch (CODEX_RESPONSE_M9.md, decision 5): a 'codex'-declared reviewer with
// a misconfigured adapter could otherwise be operationally same-family at
// runtime; family comparison via shared lookup closes that hole at the
// load-time check that runs before any agent invocation.

import { type ProviderFamily, type ProviderId } from './types.ts'

// v0.1 default mapping. Every ProviderId maps to its same-named family. In
// W3+ when adapters share families (claude-cli + anthropic-api both family
// 'claude'), the data here gains entries; the function signature stays the
// same.
export const DEFAULT_FAMILY_BY_ID: Readonly<Record<ProviderId, ProviderFamily>> = Object.freeze({
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  fake: 'fake',
})

/**
 * Pure default-family lookup. Throws on unknown ids — by the time a provider
 * id reaches this function it has already been validated against
 * PROVIDER_IDS at agent-load time, so an unknown id here is a programmer
 * error worth surfacing loudly.
 *
 * Runtime callers that need test-injected family overrides go through
 * ProviderRegistry.familyOf() instead; that method seeds from this lookup
 * and layers overrides on top.
 */
export function familyOf(id: ProviderId): ProviderFamily {
  const family = DEFAULT_FAMILY_BY_ID[id]
  if (family === undefined) {
    throw new Error(`familyOf: no family registered for provider id ${JSON.stringify(id)}`)
  }
  return family
}
