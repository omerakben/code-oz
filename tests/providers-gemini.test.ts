import { describe, test, expect } from 'bun:test'

import { GeminiProvider } from '../src/providers/gemini.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function preparedRequest(): PreparedProviderRequest {
  const agent: AgentDefinition = Object.freeze({
    file: '/tmp/x.md',
    name: 'x',
    type: 'agent' as const,
    phase: 'define' as const,
    provider: 'gemini' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'x',
    body: '# stub\n## Overview\nstub',
  })
  return {
    agent,
    phase: 'define',
    runId: RUN,
    prompt: 'hi',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
  }
}

describe('GeminiProvider', () => {
  test('id and family', () => {
    const g = new GeminiProvider()
    expect(g.id).toBe('gemini')
    expect(g.family).toBe('gemini')
  })

  test('invoke throws provider_gemini_not_yet_supported', async () => {
    const g = new GeminiProvider()
    let caught: ProviderError | null = null
    try {
      for await (const _ of g.invoke(preparedRequest())) {
        // unreachable
      }
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught).not.toBeNull()
    expect(caught?.issues[0]?.code).toBe('provider_gemini_not_yet_supported')
    expect(caught?.issues[0]?.actionableSuggestions.length).toBeGreaterThan(0)
  })

  test('health reports unsupported', async () => {
    const g = new GeminiProvider()
    const h = await g.health()
    expect(h.provider).toBe('gemini')
    expect(h.authStatus).toBe('unsupported')
    expect(h.modelDefaultAvailable).toBe(false)
  })
})
