// Tests for XaiProvider — the first HTTP-based IAgentProvider in code-oz.
//
// All tests are offline: every test injects a FetchRunner mock; no test
// touches the real https://api.x.ai endpoint. Live integration tests
// land separately in tests/providers-xai-live.test.ts (PE-1 commit 6),
// gated behind both CODE_OZ_LIVE_PROVIDER_TESTS=xai and
// CODE_OZ_LIVE_XAI_MODEL.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Buffer } from 'node:buffer'

import { XaiProvider, type FetchRunner, _buildRequestBody } from '../src/providers/xai.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import { getProviderRegistry } from '../src/cli/bootstrap.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'
const TEST_KEY = 'sk-test-xai-not-real-do-not-use'

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return Object.freeze({
    file: '/tmp/xai-builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'xai' as const,
    modelPolicy: 'any' as const,
    permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
    description: 'xai builder',
    body: '# stub\n## Overview\nstub',
    ...overrides,
  })
}

function preparedRequest(
  overrides: Partial<PreparedProviderRequest> = {},
): PreparedProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do the thing',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
    model: 'grok-4-1-fast-reasoning',
    ...overrides,
  }
}

interface RunnerCall {
  url: string
  init: RequestInit
}

function makeRunner(handler: (call: RunnerCall) => Response): {
  runner: FetchRunner
  calls: RunnerCall[]
} {
  const calls: RunnerCall[] = []
  const runner: FetchRunner = async (url, init) => {
    const call: RunnerCall = { url, init }
    calls.push(call)
    return handler(call)
  }
  return { runner, calls }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function okResponse(content: string, completionTokens?: number, model = 'grok-4-1-fast-reasoning'): Response {
  return jsonResponse(200, {
    id: 'chatcmpl-test',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: completionTokens !== undefined
      ? { prompt_tokens: 32, completion_tokens: completionTokens, total_tokens: 32 + completionTokens }
      : undefined,
  })
}

// --- env management -----------------------------------------------

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.XAI_API_KEY
  process.env.XAI_API_KEY = TEST_KEY
})

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.XAI_API_KEY
  } else {
    process.env.XAI_API_KEY = savedKey
  }
})

// --- identity / capability ----------------------------------------

describe('XaiProvider — identity', () => {
  test('id, family, and capability declare xai correctly', () => {
    const p = new XaiProvider()
    expect(p.id).toBe('xai')
    expect(p.family).toBe('xai')
    expect(p.capability.authSource).toBe('xai-api-key')
    expect(p.capability.eligiblePhases.length).toBeGreaterThan(0)
  })

  test('production bootstrap registers an XaiProvider under id "xai"', () => {
    // Closes PE-1 commit 4 wiring: getProviderRegistry() resolves xai
    // through the standard registry constructor (which structurally
    // cross-checks adapter.family + adapter.capability against the
    // registry-resolved values, preventing capability laundering).
    const registry = getProviderRegistry()
    expect(registry.has('xai')).toBe(true)
    const adapter = registry.get('xai')
    expect(adapter).toBeInstanceOf(XaiProvider)
    expect(adapter.id).toBe('xai')
    expect(adapter.family).toBe('xai')
  })
})

// --- request body allowlist ---------------------------------------

describe('XaiProvider — strict request-body allowlist', () => {
  test('allowlisted fields only: model + messages + optional max_tokens', () => {
    const body = JSON.parse(_buildRequestBody(preparedRequest({ maxOutputTokens: 256 })))
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model'])
  })

  test('without max_tokens: just model + messages', () => {
    const body = JSON.parse(_buildRequestBody(preparedRequest()))
    expect(Object.keys(body).sort()).toEqual(['messages', 'model'])
  })

  test('does NOT include any tool / search / store fields (Codex Q3 lock)', () => {
    const body = JSON.parse(_buildRequestBody(preparedRequest()))
    const forbidden = [
      'tools',
      'tool_choice',
      'parallel_tool_calls',
      'search_parameters',
      'background',
      'store',
      'stream',
    ]
    for (const key of forbidden) {
      expect(key in body).toBe(false)
    }
  })

  test('messages is a single user message with the prompt', () => {
    const body = JSON.parse(_buildRequestBody(preparedRequest({ prompt: 'hello world' })))
    expect(body.messages).toEqual([{ role: 'user', content: 'hello world' }])
  })

  test('with files: prompt + file blocks concatenated', () => {
    const body = JSON.parse(
      _buildRequestBody(
        preparedRequest({
          prompt: 'review this',
          files: [
            { path: 'src/a.ts', content: Buffer.from('const a = 1\n', 'utf8'), sha256: 'a', sizeBytes: 12 },
          ],
        }),
      ),
    )
    expect(body.messages.length).toBe(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('review this')
    expect(body.messages[0].content).toContain('=== src/a.ts ===')
    expect(body.messages[0].content).toContain('const a = 1')
  })
})

// --- invoke happy path -------------------------------------------

describe('XaiProvider — invoke happy path', () => {
  test('POSTs to /chat/completions with Bearer auth', async () => {
    const { runner, calls } = makeRunner(() => okResponse('hi back', 5))
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest()))
    expect(resp.content).toBe('hi back')
    expect(calls.length).toBe(1)
    expect(calls[0]?.url).toBe('https://api.x.ai/v1/chat/completions')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TEST_KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
  })

  test('records tokensUsed from usage.completion_tokens', async () => {
    const { runner } = makeRunner(() => okResponse('output text', 42))
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest()))
    expect(resp.tokensUsed).toBe(42)
    expect(resp.stopReason).toBe('end_turn')
  })

  test('omits tokensUsed when usage absent', async () => {
    const { runner } = makeRunner(() => okResponse('output text'))
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest()))
    expect(resp.tokensUsed).toBeUndefined()
  })

  test('omits tokensUsed when usage.completion_tokens is non-numeric', async () => {
    const { runner } = makeRunner(() =>
      jsonResponse(200, {
        choices: [{ message: { content: 'hi' } }],
        usage: { completion_tokens: 'thirty' },
      }),
    )
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest()))
    expect(resp.tokensUsed).toBeUndefined()
  })

  test('records the upstream-reported model when present', async () => {
    const { runner } = makeRunner(() => okResponse('content', 5, 'grok-4-1-fast-reasoning'))
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest({ model: 'grok-4-1-fast-reasoning' })))
    expect(resp.model).toBe('grok-4-1-fast-reasoning')
  })

  test('falls back to req.model if upstream omits model', async () => {
    const { runner } = makeRunner(() =>
      jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }),
    )
    const p = new XaiProvider({ runner })
    const resp = await collectProviderResponse(p.invoke(preparedRequest({ model: 'grok-explicit' })))
    expect(resp.model).toBe('grok-explicit')
  })

  test('yields turn_started + content_chunk + turn_completed in order', async () => {
    const { runner } = makeRunner(() => okResponse('hello', 5))
    const p = new XaiProvider({ runner })
    const events: string[] = []
    for await (const ev of p.invoke(preparedRequest())) {
      events.push(ev.type)
    }
    expect(events).toEqual(['turn_started', 'content_chunk', 'turn_completed'])
  })

  test('honors injected baseUrl override (test seam)', async () => {
    const { runner, calls } = makeRunner(() => okResponse('hi', 1))
    const p = new XaiProvider({ runner, baseUrl: 'https://mock.local/v1' })
    await collectProviderResponse(p.invoke(preparedRequest()))
    expect(calls[0]?.url).toBe('https://mock.local/v1/chat/completions')
  })
})

// --- invoke error paths ------------------------------------------

describe('XaiProvider — invoke errors', () => {
  test('throws provider_auth_missing when XAI_API_KEY is undefined', async () => {
    delete process.env.XAI_API_KEY
    const { runner } = makeRunner(() => okResponse('unused', 0))
    const p = new XaiProvider({ runner })
    await expect(collectProviderResponse(p.invoke(preparedRequest()))).rejects.toThrow(ProviderError)
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_auth_missing')
    }
  })

  test('throws provider_auth_missing when XAI_API_KEY is whitespace-only', async () => {
    process.env.XAI_API_KEY = '   \t  '
    const { runner } = makeRunner(() => okResponse('unused', 0))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_auth_missing')
    }
  })

  test('throws provider_model_missing when req.model is undefined (Codex Blocker #2)', async () => {
    const { runner, calls } = makeRunner(() => okResponse('unused', 0))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest({ model: undefined })))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_model_missing')
      // Failure is BEFORE the network call — no fetch should have happened.
      expect(calls.length).toBe(0)
    }
  })

  test('401 -> provider_auth_missing', async () => {
    const { runner } = makeRunner(() => new Response('unauthorized', { status: 401 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_auth_missing')
      expect((err as ProviderError).issues[0]?.detail).toBe('HTTP 401')
    }
  })

  test('403 -> provider_permissions_violation', async () => {
    const { runner } = makeRunner(() => new Response('forbidden', { status: 403 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_permissions_violation')
    }
  })

  test('429 -> provider_rate_limit', async () => {
    const { runner } = makeRunner(() => new Response('too many requests', { status: 429 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_rate_limit')
    }
  })

  test('500 -> provider_io_error', async () => {
    const { runner } = makeRunner(() => new Response('internal server error', { status: 500 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_io_error')
    }
  })

  test('400 -> provider_io_error (not provider_malformed_response)', async () => {
    const { runner } = makeRunner(() => new Response('bad request', { status: 400 }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_io_error')
    }
  })

  test('network failure -> provider_io_error with sanitized detail', async () => {
    const runner: FetchRunner = async () => {
      const e = new Error('connection refused')
      e.name = 'TypeError'
      throw e
    }
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      const issue = (err as ProviderError).issues[0]
      expect(issue?.code).toBe('provider_io_error')
      // Detail is sanitized: just <name>: <message>, no headers, no body.
      expect(issue?.detail).toContain('TypeError')
      expect(issue?.detail).toContain('connection refused')
    }
  })

  test('malformed JSON body -> provider_malformed_response', async () => {
    const { runner } = makeRunner(() =>
      new Response('this is not JSON', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_malformed_response')
    }
  })

  test('missing choices array -> provider_malformed_response', async () => {
    const { runner } = makeRunner(() => jsonResponse(200, { id: 'no-choices' }))
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_malformed_response')
    }
  })

  test('empty content -> provider_malformed_response', async () => {
    const { runner } = makeRunner(() =>
      jsonResponse(200, { choices: [{ message: { content: '' } }] }),
    )
    const p = new XaiProvider({ runner })
    try {
      await collectProviderResponse(p.invoke(preparedRequest()))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect((err as ProviderError).issues[0]?.code).toBe('provider_malformed_response')
    }
  })
})

// --- health() ----------------------------------------------------

describe('XaiProvider — health()', () => {
  test('GET /v1/models 200 -> authStatus ok', async () => {
    const { runner, calls } = makeRunner(() => jsonResponse(200, { data: [{ id: 'grok-4-1-fast-reasoning' }] }))
    const p = new XaiProvider({ runner })
    const h = await p.health()
    expect(h.authStatus).toBe('ok')
    expect(h.modelDefaultAvailable).toBe(true)
    expect(calls[0]?.url).toBe('https://api.x.ai/v1/models')
    expect(calls[0]?.init.method).toBe('GET')
  })

  test('401 -> authStatus missing', async () => {
    const { runner } = makeRunner(() => new Response('unauthorized', { status: 401 }))
    const p = new XaiProvider({ runner })
    const h = await p.health()
    expect(h.authStatus).toBe('missing')
    expect(h.lastError?.code).toBe('provider_auth_missing')
  })

  test('5xx -> authStatus unknown', async () => {
    const { runner } = makeRunner(() => new Response('boom', { status: 503 }))
    const p = new XaiProvider({ runner })
    const h = await p.health()
    expect(h.authStatus).toBe('unknown')
    expect(h.lastError?.code).toBe('provider_io_error')
  })

  test('network failure -> authStatus unknown with sanitized detail', async () => {
    const runner: FetchRunner = async () => {
      const e = new Error('DNS resolution failed for api.x.ai')
      e.name = 'TypeError'
      throw e
    }
    const p = new XaiProvider({ runner })
    const h = await p.health()
    expect(h.authStatus).toBe('unknown')
    expect(h.lastError?.detail).toContain('TypeError')
  })

  test('missing XAI_API_KEY -> authStatus missing without making any request', async () => {
    delete process.env.XAI_API_KEY
    const { runner, calls } = makeRunner(() => jsonResponse(200, { data: [] }))
    const p = new XaiProvider({ runner })
    const h = await p.health()
    expect(h.authStatus).toBe('missing')
    expect(calls.length).toBe(0)
  })
})
