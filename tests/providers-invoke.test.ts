import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeAgent, type InvokeContext } from '../src/providers/invoke.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { ProviderRequest, ProviderEvent } from '../src/providers/types.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, type LoggedEvent } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG, type CodeOzConfig } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-invoke-'))
  projectRoot = join(tmp, 'project')
  const stateDir = join(tmp, 'state')
  const artifactRoot = join(tmp, 'artifacts')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
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

function ctx(configOverrides: Partial<CodeOzConfig> = {}): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: { ...DEFAULT_CONFIG, ...configOverrides } as CodeOzConfig,
    now: () => '2026-04-29T18:00:00Z',
  }
}

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('invokeAgent — happy path', () => {
  test('emits adapter stream and writes agent_invoked + agent_completed events', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'built',
      tokensUsed: 42,
      model: 'fake-1',
    })

    const events = await consumeAll(invokeAgent(ctx(), request()))

    expect(events.map((e) => e.type)).toEqual(['turn_started', 'content_chunk', 'turn_completed'])

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = logged.map((e) => e.type)
    expect(types).toEqual(['agent_invoked', 'agent_completed'])

    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.agent).toBe('builder')
    expect(invoked.provider).toBe('fake')
    expect(invoked.phase).toBe('build')
    expect(invoked.manifest.files).toEqual([])
    expect(invoked.filesSent).toBe(0)
    expect(invoked.bytesSent).toBe(0)
    expect(invoked.fieldsRemovedByScope).toBe(0)
    // tokensEstimate is the conservative ~4-chars/token bound on the prompt.
    expect(invoked.tokensEstimate).toBe(Math.ceil('do the thing'.length / 4))

    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.agent).toBe('builder')
    expect(completed.tokensUsed).toBe(42)
  })

  test('manifest contains sha256 + sizeBytes for each file in the request', async () => {
    const filePath = join(projectRoot, 'data.txt')
    await writeFile(filePath, 'hello world', 'utf8')

    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 10 })

    await consumeAll(invokeAgent(ctx(), request({ files: [{ path: 'data.txt' }] })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.manifest.files.length).toBe(1)
    expect(invoked.manifest.files[0]?.path).toBe('data.txt')
    expect(invoked.manifest.files[0]?.sizeBytes).toBe('hello world'.length)
    expect(invoked.manifest.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(invoked.filesSent).toBe(1)
    expect(invoked.bytesSent).toBe('hello world'.length)
  })

  test('fieldsRemovedByScope counts droppedFields across the manifest', async () => {
    const a = join(projectRoot, 'a.txt')
    const b = join(projectRoot, 'b.txt')
    await writeFile(a, 'a', 'utf8')
    await writeFile(b, 'b', 'utf8')

    fake.expect({}).respondWith({ content: 'ok' })

    await consumeAll(
      invokeAgent(
        ctx(),
        request({
          files: [
            { path: 'a.txt', droppedFields: ['secrets', 'private'] },
            { path: 'b.txt', droppedFields: ['internal'] },
          ],
        }),
      ),
    )

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.fieldsRemovedByScope).toBe(3)
  })
})

describe('invokeAgent — tokensUsed provenance', () => {
  test('omits agent_completed.tokensUsed when adapter does not report it', async () => {
    // FakeProvider's defaultResponse sets tokensUsed: 50; override with an
    // explicit undefined so the adapter doesn't report a value.
    const f2 = new FakeProvider({
      defaultResponse: { content: 'no usage', model: 'fake-1', stopReason: 'end_turn' },
    })
    f2.expect({}).respondWith({ content: 'no usage', model: 'fake-1', stopReason: 'end_turn' })
    const reg = new ProviderRegistry({ providers: [f2] })
    const c: InvokeContext = { ...ctx(), registry: reg }

    await consumeAll(invokeAgent(c, request()))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect('tokensUsed' in completed).toBe(false)
  })
})

describe('invokeAgent — provider audit fields', () => {
  test('projects adapter responseId to agent_completed', async () => {
    fake.expect({}).respondWith({
      content: 'ok',
      model: 'fake-1',
      responseId: 'resp_fake_123',
    })

    await consumeAll(invokeAgent(ctx(), request()))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.responseId).toBe('resp_fake_123')
  })

  test('projects requestedModel when the responding model differs from prepared.model', async () => {
    fake.expect({}).respondWith({
      content: 'ok',
      model: 'fake-routed',
    })

    await consumeAll(invokeAgent(ctx(), request({ model: 'fake-requested' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.requestedModel).toBe('fake-requested')
  })

  test('omits requestedModel when the responding model equals prepared.model', async () => {
    fake.expect({}).respondWith({
      content: 'ok',
      model: 'fake-requested',
    })

    await consumeAll(invokeAgent(ctx(), request({ model: 'fake-requested' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect('requestedModel' in completed).toBe(false)
  })
})

describe('invokeAgent — budget refusal', () => {
  test('writes NEEDS_INTERVENTION + intervention when per-phase tokens would exceed cap', async () => {
    // Pre-load the event log with a completed call that already burned the
    // entire build phase tokens budget. The next invoke must refuse.
    const phaseCap = DEFAULT_CONFIG.budgets.perPhase.build.maxTokensEstimate
    await writeFile(
      paths.eventsFile,
      [
        { version: 1, type: 'run_started', ts: '2026-04-29T17:00:00Z', runId: RUN, profile: 'greenfield' },
        {
          version: 1,
          type: 'agent_invoked',
          ts: '2026-04-29T17:00:01Z',
          runId: RUN,
          phase: 'build',
          agent: 'builder',
          provider: 'fake',
          manifest: { files: [] },
          filesSent: 0,
          bytesSent: 0,
          tokensEstimate: phaseCap,
          fieldsRemovedByScope: 0,
        },
        {
          version: 1,
          type: 'agent_completed',
          ts: '2026-04-29T17:00:02Z',
          runId: RUN,
          phase: 'build',
          agent: 'builder',
          tokensUsed: phaseCap,
        },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n',
      'utf8',
    )

    fake.expect({}).respondWith({ content: 'never reached' })

    let caught: ProviderError | null = null
    try {
      await consumeAll(invokeAgent(ctx(), request()))
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }

    expect(caught).not.toBeNull()
    expect(caught?.issues[0]?.code).toBe('provider_budget_exceeded')
    expect(caught?.issues[0]?.actionableSuggestions[0]).toContain('budgets.perPhase.build.maxTokensEstimate')

    // NEEDS_INTERVENTION.json was written.
    const gateContent = await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8')
    const gate = JSON.parse(gateContent)
    expect(gate.code).toBe('provider_budget_exceeded')
    expect(gate.phase).toBe('build')
    expect(gate.agent).toBe('builder')
    expect(gate.runId).toBe(RUN)

    // intervention event was appended; agent_invoked was NOT (the budget
    // check fired before the append).
    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = logged.map((e) => e.type)
    expect(types).toEqual(['run_started', 'agent_invoked', 'agent_completed', 'intervention'])
    const intervention = logged[3] as Extract<LoggedEvent, { type: 'intervention' }>
    expect(intervention.code).toBe('provider_budget_exceeded')
    expect(intervention.phase).toBe('build')
  })
})

describe('invokeAgent — tool-call cap', () => {
  test('throws provider_tool_call_cap_exceeded mid-stream and records intervention', async () => {
    // Configure a tiny cap for this test: 2 * 1.0 = floor(2) = 2.
    const tinyConfig: CodeOzConfig = {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: {
          ...DEFAULT_CONFIG.budgets.global,
          maxToolCallsPerTurn: 2,
          toolCallBudgetMultiplier: 1,
        },
      },
    }

    // Adapter emits 3 tool_call events — the third trips the cap (cap=2).
    fake.expect({}).respondWith({
      content: 'used many tools',
      stopReason: 'tool_use',
      toolCalls: [
        { id: 't1', name: 'edit', input: {} },
        { id: 't2', name: 'edit', input: {} },
        { id: 't3', name: 'edit', input: {} },
      ],
    })

    const c: InvokeContext = { ...ctx(), config: tinyConfig }
    let caught: ProviderError | null = null
    const collected: ProviderEvent[] = []
    try {
      for await (const ev of invokeAgent(c, request())) {
        collected.push(ev)
      }
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }

    expect(caught).not.toBeNull()
    expect(caught?.issues[0]?.code).toBe('provider_tool_call_cap_exceeded')
    // First two tool_calls landed in the consumer stream; the third never did.
    expect(collected.filter((e) => e.type === 'tool_call').length).toBe(2)

    const gateContent = await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8')
    const gate = JSON.parse(gateContent)
    expect(gate.code).toBe('provider_tool_call_cap_exceeded')

    // agent_invoked landed (pre-call lock succeeded); agent_completed did NOT
    // (the stream threw); intervention was appended.
    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = logged.map((e) => e.type)
    expect(types).toEqual(['agent_invoked', 'intervention'])
  })
})

describe('invokeAgent — permission violation', () => {
  test('throws before any lock acquisition and writes no events', async () => {
    // File outside the agent's permissions.read upper bound.
    const filePath = join(projectRoot, 'forbidden.txt')
    await writeFile(filePath, 'secret', 'utf8')

    fake.expect({}).respondWith({ content: 'never reached' })

    const restrictiveAgent = agent({
      permissions: {
        read: ['allowed/**'],
        write: '*' as const,
        bash: 'deny' as const,
      },
    })

    let caught: ProviderError | null = null
    try {
      await consumeAll(
        invokeAgent(
          ctx(),
          request({
            agent: restrictiveAgent,
            files: [{ path: 'forbidden.txt' }],
          }),
        ),
      )
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }

    expect(caught).not.toBeNull()
    expect(caught?.issues[0]?.code).toBe('provider_permissions_violation')

    // No NEEDS_INTERVENTION (the failure fired before the wrapper acquired
    // the run lock; no run-state perturbation).
    let gateExists = true
    try {
      await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8')
    } catch {
      gateExists = false
    }
    expect(gateExists).toBe(false)

    // No events appended either.
    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    expect(logged.length).toBe(0)
  })
})
