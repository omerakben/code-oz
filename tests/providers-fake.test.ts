import { describe, test, expect } from 'bun:test'
import { FakeProvider, collectProviderResponse } from '../src/providers/fake.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { PreparedProviderRequest } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = '01J0000000000000000000000A'

function agent(name: string): AgentDefinition {
  return Object.freeze({
    file: `/tmp/${name}.md`,
    name,
    type: 'agent' as const,
    phase: 'define' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: `${name} stub`,
    body: '# stub\n## Overview\nstub',
  })
}

function request(
  name: string,
  phase: 'define' | 'plan' | 'build' | 'verify' | 'review' = 'define',
): PreparedProviderRequest {
  return {
    agent: agent(name),
    phase,
    runId: RUN,
    prompt: 'test',
    files: [],
    manifest: { files: [] },
    metrics: { filesSent: 0, bytesSent: 0, tokensEstimate: 0, fieldsRemovedByScope: 0 },
  }
}

describe('FakeProvider — scripted expectations', () => {
  test('happy path: scripted match returns the canned response', async () => {
    const fake = new FakeProvider()
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({
      content: 'canned spec',
      tokensUsed: 123,
    })
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('canned spec')
    expect(response.tokensUsed).toBe(123)
  })

  test('FIFO consumption: same match queue is drained in order', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'ba' })
      .respondWith({ content: 'first', tokensUsed: 1 })
      .respondWith({ content: 'second', tokensUsed: 2 })
    const r1 = await collectProviderResponse(fake.invoke(request('ba')))
    const r2 = await collectProviderResponse(fake.invoke(request('ba')))
    expect(r1.content).toBe('first')
    expect(r2.content).toBe('second')
  })

  test('most-specific match wins (phase + agent > phase-only > agent-only)', async () => {
    const fake = new FakeProvider()
    fake.expect({}).respondWith({ content: 'broad' })
    fake.expect({ phase: 'define' }).respondWith({ content: 'phase-only' })
    fake.expect({ agent: 'ba' }).respondWith({ content: 'agent-only' })
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'specific' })
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('specific')
  })

  test('fallback default response when no expectation matches', async () => {
    const fake = new FakeProvider({ defaultResponse: { content: 'default!' } })
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('default!')
  })

  test('strict mode: unscripted call throws ProviderError', async () => {
    const fake = new FakeProvider({ strict: true })
    try {
      await collectProviderResponse(fake.invoke(request('ba')))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_io_error')
      expect(e.issues[0]?.actionableSuggestions.length).toBeGreaterThan(0)
    }
  })

  test('strict mode: scripted match still works', async () => {
    const fake = new FakeProvider({ strict: true })
    fake.expect({ agent: 'ba' }).respondWith({ content: 'staged' })
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('staged')
  })

  test('reset() drops every expectation', async () => {
    const fake = new FakeProvider({ defaultResponse: { content: 'fallback' } })
    fake.expect({ agent: 'ba' }).respondWith({ content: 'staged' })
    fake.reset()
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('fallback')
  })
})

describe('FakeProvider — failure injection', () => {
  test('fail() queues a ProviderError that invoke throws', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'ba' }).fail({
      code: 'provider_rate_limit',
      rule: 'too many requests',
      actionableSuggestions: ['back off'],
    })
    try {
      await collectProviderResponse(fake.invoke(request('ba')))
      throw new Error('expected ProviderError')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      const e = err as ProviderError
      expect(e.issues[0]?.code).toBe('provider_rate_limit')
    }
  })

  test('queue mixes responses and failures in order', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'ba' })
      .fail({
        code: 'provider_rate_limit',
        rule: 'first call rate-limited',
        actionableSuggestions: ['retry'],
      })
      .respondWith({ content: 'second call succeeded' })
    // First call fails.
    let firstFailed = false
    try {
      await collectProviderResponse(fake.invoke(request('ba')))
    } catch {
      firstFailed = true
    }
    expect(firstFailed).toBe(true)
    // Second call succeeds.
    const response = await collectProviderResponse(fake.invoke(request('ba')))
    expect(response.content).toBe('second call succeeded')
  })

  test('fail() accepts an array of issues', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'ba' }).fail([
      {
        code: 'provider_auth_missing',
        rule: 'no auth',
        actionableSuggestions: ['login'],
      },
      {
        code: 'provider_io_error',
        rule: 'also EIO',
        actionableSuggestions: ['retry'],
      },
    ])
    try {
      await collectProviderResponse(fake.invoke(request('ba')))
      throw new Error('expected ProviderError')
    } catch (err) {
      const e = err as ProviderError
      expect(e.issues.length).toBe(2)
    }
  })
})

describe('FakeProvider — streaming', () => {
  test('emits turn_started, content_chunks, turn_completed', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'ba' }).respondWith({
      content: 'full',
      chunks: ['hel', 'lo ', 'world'],
    })
    const events: string[] = []
    for await (const ev of fake.invoke(request('ba'))) {
      events.push(ev.type)
    }
    expect(events[0]).toBe('turn_started')
    expect(events.filter((t) => t === 'content_chunk').length).toBe(3)
    expect(events[events.length - 1]).toBe('turn_completed')
  })

  test('emits tool_call events when scripted', async () => {
    const fake = new FakeProvider()
    fake.expect({ agent: 'builder' }).respondWith({
      content: 'used a tool',
      stopReason: 'tool_use',
      toolCalls: [{ id: 't1', name: 'edit', input: { file: 'x' } }],
    })
    const eventTypes: string[] = []
    for await (const ev of fake.invoke(request('builder', 'build'))) {
      eventTypes.push(ev.type)
    }
    expect(eventTypes).toContain('tool_call')
  })
})

describe('FakeProvider — health', () => {
  test('reports authStatus: ok and modelDefaultAvailable: true', async () => {
    const fake = new FakeProvider()
    const h = await fake.health()
    expect(h.provider).toBe('fake')
    expect(h.authStatus).toBe('ok')
    expect(h.modelDefaultAvailable).toBe(true)
  })
})

describe('collectProviderResponse', () => {
  test('throws when stream ends without turn_completed', async () => {
    async function* incomplete() {
      yield { type: 'turn_started' as const, model: 'm' }
      yield { type: 'content_chunk' as const, text: 'hi' }
    }
    let threw = false
    try {
      await collectProviderResponse(incomplete())
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
