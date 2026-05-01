// GeminiProvider — v0.1 stub. Gemini support lands in W3+; the kickoff is
// explicit: "Gemini stays a stub. health() should return an explicit
// unsupported state, not pretend auth is merely unknown."
//
// The `experimental: true` flag on agent frontmatter (added in M2) prevents
// loader-level rejection of agents declaring provider: gemini, but invoke()
// still refuses with a typed error so the wrapper writes
// NEEDS_INTERVENTION.json + intervention rather than a stack trace.

import { capabilityOf, type ProviderCapability } from './capabilities.ts'
import { providerError } from './errors.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
} from './types.ts'

export class GeminiProvider implements IAgentProvider {
  readonly id = 'gemini' as const
  readonly family = 'gemini' as const
  readonly capability: ProviderCapability = capabilityOf('gemini')

  // eslint-disable-next-line require-yield
  async *invoke(_req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    throw providerError(
      'provider_gemini_not_yet_supported',
      'Gemini adapter is a stub in v0.1; real invocation lands in W3+',
      [
        'use a different provider (claude, codex, fake) for v0.1',
        'wait for the W3 milestone for real Gemini support',
      ],
    )
  }

  async health(): Promise<ProviderHealth> {
    return Object.freeze({
      provider: 'gemini' as const,
      authStatus: 'unsupported' as const,
      modelDefaultAvailable: false,
    })
  }
}
