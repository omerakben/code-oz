// Pure ProviderId -> ProviderCapability lookup, shared by load-time and
// runtime eligibility enforcement.
//
// Background: CLAUDE.md non-negotiable rule 20 — one new authority boundary
// per milestone. M11's authority is provider eligibility. The load-time
// loader (src/agents/loader.ts) must reject impossible (provider, phase)
// combinations before any run begins; it imports `capabilityOf()` directly
// from this module because no ProviderRegistry exists at load time. The
// runtime registry (src/providers/registry.ts) seeds from the same defaults
// and layers optional `capabilityOverrides` on top — same pattern as
// `families.ts` (M9 family substrate).
//
// Strict-minimal TS shape (locked in CODEX_RESPONSE_M11.md, thread
// 019de44e-e8a7-7441-9d82-d79a0595f591): authSource, eligiblePhases,
// optional costPerMTok, optional rateLimits. The four traits the M11
// ROADMAP row originally named (editSemantics, shellSemantics, mcpSupport,
// sandboxProfile) are deferred W3 contract territory — see
// docs/references/provider-contract.md § "Capability and eligibility (M11)".
// Load-bearing reason: v0.1 tool_use runtime is provider-uniform, so those
// fields would mark orchestrator-owned behavior as provider-owned behavior.

import { AGENT_PHASES, type AgentPhase } from '../agents/schema.ts'
import { type ProviderId } from './types.ts'

// authSource records the AUTHENTICATION MECHANISM, not the user's
// subscription tier. Max / Plus / Pro are SKU labels outside the code-oz
// trust boundary and may rebrand; the upstream CLI handles them
// transparently. Adapters that authenticate via direct HTTP OAuth+PKCE
// (W3+) gain new mechanism values like 'claude-anthropic-api-oauth-pkce'
// alongside the existing CLI variants.
export const AUTH_SOURCES = [
  'claude-cli-oauth',
  'chatgpt-cli-oauth',
  'gemini-stub',
  'in-process-fake',
] as const
export type AuthSource = (typeof AUTH_SOURCES)[number]

export interface ProviderCostPerMTok {
  /** USD per 1M input tokens. */
  readonly input: number
  /** USD per 1M output tokens. */
  readonly output: number
}

export interface ProviderRateLimits {
  readonly requestsPerMinute?: number
  readonly tokensPerMinute?: number
  readonly outputTokensPerMinute?: number
}

export interface ProviderCapability {
  readonly authSource: AuthSource
  /**
   * Phases this provider is eligible to run an agent for. v0.1 default:
   * claude/codex/fake get every value in AGENT_PHASES; gemini gets [].
   * "Eligible for phase X" means the provider may run an agent declared
   * with `phase: X`; it does not mean phase X's runtime exists.
   */
  readonly eligiblePhases: readonly AgentPhase[]
  /**
   * Advisory in M11. Recorded for telemetry; M13 may consume under
   * existing budgets.global namespace. v0.1 defaults omit this field
   * for every provider — concrete dollar/token values rot quickly and
   * model-vs-provider granularity is M13's contract decision.
   */
  readonly costPerMTok?: ProviderCostPerMTok
  /**
   * Advisory in M11. Recorded for telemetry; M13 may consume.
   */
  readonly rateLimits?: ProviderRateLimits
}

const ALL_PHASES: readonly AgentPhase[] = Object.freeze([...AGENT_PHASES])
const NO_PHASES: readonly AgentPhase[] = Object.freeze([])

// v0.1 defaults. Every populated cost / rate-limit value (none today)
// MUST carry a dated source comment explaining provenance. Omitted is
// the honest default when no verified source is available (per Codex
// CODEX_RESPONSE_M11.md "Risks the proposing side missed").
export const DEFAULT_CAPABILITY_BY_ID: Readonly<Record<ProviderId, ProviderCapability>> =
  Object.freeze({
    claude: Object.freeze({
      authSource: 'claude-cli-oauth' as const,
      eligiblePhases: ALL_PHASES,
      // costPerMTok / rateLimits omitted: per-provider granularity is
      // M13's decision. Opus 4.7 / Sonnet 4.6 / Haiku 4.5 prices are
      // model-level, not provider-level.
    }),
    codex: Object.freeze({
      authSource: 'chatgpt-cli-oauth' as const,
      eligiblePhases: ALL_PHASES,
      // costPerMTok / rateLimits omitted: ChatGPT Plus / Pro tier
      // pricing is platform-internal; opaque to code-oz.
    }),
    gemini: Object.freeze({
      authSource: 'gemini-stub' as const,
      eligiblePhases: NO_PHASES,
      // No costs declared: provider is a stub. Real Gemini lands W3+.
    }),
    fake: Object.freeze({
      authSource: 'in-process-fake' as const,
      eligiblePhases: ALL_PHASES,
      // No costs declared: in-process test runtime, no real billing.
    }),
  })

/**
 * Pure default-capability lookup. Throws on unknown ids — by the time a
 * provider id reaches this function it has already been validated against
 * PROVIDER_IDS at agent-load time, so an unknown id here is a programmer
 * error worth surfacing loudly.
 *
 * Runtime callers that need test-injected capability overrides go through
 * ProviderRegistry.capabilityOf() instead; that method seeds from this
 * lookup and layers overrides on top. Load-time callers (src/agents/
 * loader.ts) import this function directly because no registry exists at
 * load time — same split as families.ts.
 */
export function capabilityOf(id: ProviderId): ProviderCapability {
  const capability = DEFAULT_CAPABILITY_BY_ID[id]
  if (capability === undefined) {
    throw new Error(
      `capabilityOf: no capability registered for provider id ${JSON.stringify(id)}`,
    )
  }
  return capability
}
