// Live integration test for XaiProvider — opt-in only.
//
// Gated behind two env vars (Codex Q8 + Risk #5):
//   - CODE_OZ_LIVE_PROVIDER_TESTS — comma-separated set; must contain "xai"
//   - CODE_OZ_LIVE_XAI_MODEL      — explicit Grok variant id (model names
//                                    rotate; pinning a default in source
//                                    would rot)
//
// To run locally:
//   export XAI_API_KEY=<your-key>
//   export CODE_OZ_LIVE_PROVIDER_TESTS=xai
//   export CODE_OZ_LIVE_XAI_MODEL=grok-4-1-fast-reasoning
//   bun test tests/providers-xai-live.test.ts
//
// Default offline runs skip every test in this file, preserving the
// rule-8 offline discipline. CI does not run live tests.

import { describe, test, expect } from 'bun:test'

import { XaiProvider } from '../src/providers/xai.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function liveGateOpen(): { ok: true; model: string } | { ok: false; reason: string } {
  const set = (process.env.CODE_OZ_LIVE_PROVIDER_TESTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (!set.includes('xai')) {
    return {
      ok: false,
      reason: 'CODE_OZ_LIVE_PROVIDER_TESTS does not include "xai" (skipping live xai tests)',
    }
  }
  const model = (process.env.CODE_OZ_LIVE_XAI_MODEL ?? '').trim()
  if (model === '') {
    return {
      ok: false,
      reason: 'CODE_OZ_LIVE_XAI_MODEL is unset; refusing to hardcode a default Grok variant in source',
    }
  }
  const key = (process.env.XAI_API_KEY ?? '').trim()
  if (key === '') {
    return {
      ok: false,
      reason: 'XAI_API_KEY is unset; cannot run live xai tests without a key',
    }
  }
  return { ok: true, model }
}

function agent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/xai-live-builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'xai' as const,
    modelPolicy: 'any' as const,
    permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
    description: 'xai live test',
    body: '# stub\n## Overview\nstub',
  })
}

function preparedRequest(model: string, prompt: string): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt,
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
    model,
  }
}

describe('XaiProvider — live integration (opt-in via CODE_OZ_LIVE_PROVIDER_TESTS=xai)', () => {
  const gate = liveGateOpen()

  test('health() returns ok against the real /v1/models endpoint', async () => {
    if (!gate.ok) {
      console.log(`skipping live test: ${gate.reason}`)
      return
    }
    const p = new XaiProvider()
    const h = await p.health()
    if (h.authStatus !== 'ok') {
      throw new Error(
        `live health probe expected authStatus=ok, got ${h.authStatus}: ${
          h.lastError?.rule ?? 'no error rule'
        }`,
      )
    }
    expect(h.authStatus).toBe('ok')
    expect(h.modelDefaultAvailable).toBe(true)
  })

  test(
    'invoke() round-trips a tiny prompt and reports tokensUsed > 0',
    async () => {
      if (!gate.ok) {
        console.log(`skipping live test: ${gate.reason}`)
        return
      }
      const p = new XaiProvider()
      const prompt =
        'Reply with exactly the single word "PE1" (no punctuation, no other text).'
      const resp = await collectProviderResponse(
        p.invoke(preparedRequest(gate.model, prompt)),
      )
      expect(typeof resp.content).toBe('string')
      expect(resp.content.length).toBeGreaterThan(0)
      expect(resp.stopReason).toBe('end_turn')
      if (resp.tokensUsed === undefined) {
        throw new Error(
          'live invoke expected tokensUsed (xAI returns usage.completion_tokens); the upstream API may have changed shape',
        )
      }
      expect(resp.tokensUsed).toBeGreaterThan(0)
      // Defensive: response should mention the model. (xAI returns the
      // resolved model id; PE-1 records it.)
      expect(typeof resp.model).toBe('string')
      expect(resp.model.length).toBeGreaterThan(0)
    },
    // 60s — Grok reasoning models can take a while on a single buffered
    // turn even for tiny prompts. Live tests are opt-in; the offline
    // suite still completes in seconds (rule 8 unaffected).
    60_000,
  )
})
