// M12 commit 5: model propagation through provider invoke.
//
// Pre-M12, src/providers/manifest.ts only forwarded `req.model` to the
// adapter. Phase logic generally constructs `ProviderRequest` without
// setting `req.model`, so the agent's bound model (`req.agent.model`)
// was silently dropped during prepare. M12 defaults
// `req.model ?? req.agent.model` so the resolved model reaches the
// adapter, AND the `agent_invoked.model` event records the resolved
// value for audit + future cost-policy tooling. Per Codex Risk #3 in
// CODEX_RESPONSE_M12.md (thread 019de4bb).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildManifest } from '../src/providers/manifest.ts'
import { invokeAgent, type InvokeContext } from '../src/providers/invoke.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type {
  ProviderRequest,
  ProviderEvent,
  PreparedProviderRequest,
} from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-model-prop-'))
  projectRoot = join(tmp, 'project')
  const stateDir = join(tmp, 'state')
  const artifactRoot = join(tmp, 'artifacts')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md',
    name: 'builder',
    type: 'agent' as const,
    phase: 'build' as const,
    provider: 'fake' as const,
    modelPolicy: 'any' as const,
    permissions: {
      read: '*' as const,
      write: '*' as const,
      bash: 'deny' as const,
    },
    description: 'builder stub',
    body: '# stub\n## Overview\nstub',
    ...overrides,
  })
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'do the thing',
    files: [],
    ...overrides,
  }
}

function makeCtx(reg: ProviderRegistry): InvokeContext {
  return {
    registry: reg,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG as CodeOzConfig,
    now: () => '2026-05-01T18:00:00Z',
  }
}

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('buildManifest — model resolution (M12 commit 5)', () => {
  test('agent.model is the resolved model when req.model is undefined', async () => {
    const a = agent({ model: 'claude-opus-4-7' })
    const r = request({ agent: a })
    const prepared = await buildManifest(r, { projectRoot })
    expect(prepared.model).toBe('claude-opus-4-7')
  })

  test('req.model overrides agent.model', async () => {
    const a = agent({ model: 'agent-model' })
    const r = request({ agent: a, model: 'request-override' })
    const prepared = await buildManifest(r, { projectRoot })
    expect(prepared.model).toBe('request-override')
  })

  test('model is omitted when neither req.model nor agent.model is set', async () => {
    const a = agent() // no model field
    const r = request({ agent: a })
    const prepared = await buildManifest(r, { projectRoot })
    expect(prepared.model).toBeUndefined()
    // The optional spread should leave the key off the object entirely
    // (not present as `undefined`).
    expect('model' in prepared).toBe(false)
  })

  test('req.model alone (no agent.model) propagates', async () => {
    const a = agent() // no model
    const r = request({ agent: a, model: 'request-only' })
    const prepared = await buildManifest(r, { projectRoot })
    expect(prepared.model).toBe('request-only')
  })
})

describe('invokeAgent — adapter receives resolved model', () => {
  test('FakeProvider sees prepared.model matching agent.model when req omits it', async () => {
    let captured: PreparedProviderRequest | undefined
    class CapturingFake extends FakeProvider {
      override async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
        captured = req
        yield* super.invoke(req)
      }
    }
    const fake = new CapturingFake()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent({ model: 'claude-opus-4-7' })
    const r = request({ agent: a }) // no req.model
    await consumeAll(invokeAgent(makeCtx(reg), r))

    expect(captured?.model).toBe('claude-opus-4-7')
  })

  test('FakeProvider sees prepared.model === req.model when both present', async () => {
    let captured: PreparedProviderRequest | undefined
    class CapturingFake extends FakeProvider {
      override async *invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
        captured = req
        yield* super.invoke(req)
      }
    }
    const fake = new CapturingFake()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent({ model: 'agent-model' })
    const r = request({ agent: a, model: 'request-override' })
    await consumeAll(invokeAgent(makeCtx(reg), r))

    expect(captured?.model).toBe('request-override')
  })
})

describe('invokeAgent — agent_invoked event records resolved model', () => {
  test('event.model === agent.model when req.model is undefined', async () => {
    const fake = new FakeProvider()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent({ model: 'claude-opus-4-7' })
    const r = request({ agent: a })
    await consumeAll(invokeAgent(makeCtx(reg), r))

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = events.find((e) => isKnownPhaseEvent(e) && e.type === 'agent_invoked')
    expect(invoked).toBeDefined()
    expect((invoked as { model?: string }).model).toBe('claude-opus-4-7')
  })

  test('event.model === req.model when both present', async () => {
    const fake = new FakeProvider()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent({ model: 'agent-model' })
    const r = request({ agent: a, model: 'request-override' })
    await consumeAll(invokeAgent(makeCtx(reg), r))

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = events.find((e) => isKnownPhaseEvent(e) && e.type === 'agent_invoked')
    expect((invoked as { model?: string }).model).toBe('request-override')
  })

  test('event.model is omitted when neither req.model nor agent.model is set', async () => {
    const fake = new FakeProvider()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent() // no model
    const r = request({ agent: a })
    await consumeAll(invokeAgent(makeCtx(reg), r))

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = events.find((e) => isKnownPhaseEvent(e) && e.type === 'agent_invoked')
    expect(invoked).toBeDefined()
    // The optional spread keeps `model` off the JSON entirely.
    const raw = invoked as Record<string, unknown>
    expect('model' in raw).toBe(false)
  })

  test('forward-compat: M11 readers parsing M12-emitted events with model field do not reject', async () => {
    // The validator treats `model` as an unknown extra field, ignoring it.
    // Pre-M12 readers continue to parse new events identically (no
    // strict-extras check). This test pins the read-side compatibility.
    const fake = new FakeProvider()
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'b' })
    const reg = new ProviderRegistry({ providers: [fake] })

    const a = agent({ model: 'claude-opus-4-7' })
    const r = request({ agent: a })
    await consumeAll(invokeAgent(makeCtx(reg), r))

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    // No throw, agent_invoked is a known event with all required fields.
    const known = events.filter(isKnownPhaseEvent)
    expect(known.length).toBeGreaterThanOrEqual(1)
    expect(known.some((e) => e.type === 'agent_invoked')).toBe(true)
  })
})
