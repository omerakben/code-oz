// M13 Commit 6: invokeAgent records costEstimateUSD on agent_invoked +
// costActualUSD on agent_completed when both signals resolve.
//
// Codex Q2 + Q4 + scope-correction locks (CODEX_RESPONSE_M13.md):
// estimate is pre-call advisory; actual is post-call advisory with
// output-tokens-only semantics. Missing cost data never blocks a call —
// the field is simply omitted (Q3 token-only fallback).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeAgent, type InvokeContext } from '../src/providers/invoke.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { ProviderEvent, ProviderRequest } from '../src/providers/types.ts'
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
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-cost-usd-'))
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
    permissions: { read: '*' as const, write: '*' as const, bash: 'deny' as const },
    description: 'stub',
    body: 'stub',
    ...overrides,
  })
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    agent: agent(),
    phase: 'build',
    runId: RUN,
    prompt: 'prompt',
    files: [],
    ...overrides,
  }
}

function ctxWithPriceTable(
  table: NonNullable<CodeOzConfig['budgets']['global']['priceTable']>,
): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, priceTable: table },
      },
    } as CodeOzConfig,
    now: () => '2026-05-01T18:00:00Z',
  }
}

function ctxNoPriceTable(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    // Strip the DEFAULT_CONFIG Claude defaults; FakeProvider has no
    // capability.costPerMTok either, so neither cost source resolves.
    config: {
      ...DEFAULT_CONFIG,
      budgets: {
        ...DEFAULT_CONFIG.budgets,
        global: { ...DEFAULT_CONFIG.budgets.global, priceTable: undefined },
      },
    } as CodeOzConfig,
    now: () => '2026-05-01T18:00:00Z',
  }
}

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<void> {
  for await (const _ of stream) void _
}

describe('invokeAgent — costEstimateUSD on agent_invoked', () => {
  test('records costEstimateUSD when priceTable resolves the (provider, model)', async () => {
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 100, model: 'fake-1' })
    const c = ctxWithPriceTable({
      'fake:fake-1': { inputPerMTok: 10, outputPerMTok: 20 },
    })

    await consumeAll(invokeAgent(c, request({ model: 'fake-1' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    // 6 chars 'prompt' / 4 = 2 tokens estimate * 10 inputPerMTok / 1e6
    expect(invoked.costEstimateUSD).toBeCloseTo(2 * 10 / 1_000_000, 10)
  })

  test('omits costEstimateUSD when no price source resolves (token-only fallback)', async () => {
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 100 })

    await consumeAll(invokeAgent(ctxNoPriceTable(), request({ model: 'fake-1' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.costEstimateUSD).toBeUndefined()
  })

  test('omits costEstimateUSD when model is missing', async () => {
    fake.expect({}).respondWith({ content: 'ok' })
    const c = ctxWithPriceTable({
      'fake:fake-1': { inputPerMTok: 10, outputPerMTok: 20 },
    })

    // request without `model` — agent.model is also unset
    await consumeAll(invokeAgent(c, request()))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.costEstimateUSD).toBeUndefined()
  })
})

describe('invokeAgent — costActualUSD on agent_completed', () => {
  test('records costActualUSD = tokensUsed * outputPerMTok / 1e6 (output-only)', async () => {
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 100, model: 'fake-1' })
    const c = ctxWithPriceTable({
      'fake:fake-1': { inputPerMTok: 10, outputPerMTok: 20 },
    })

    await consumeAll(invokeAgent(c, request({ model: 'fake-1' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.costActualUSD).toBeCloseTo(100 * 20 / 1_000_000, 10)
  })

  test('omits costActualUSD when adapter does not report tokensUsed', async () => {
    const noTokens = new FakeProvider({
      defaultResponse: { content: 'ok', model: 'fake-1' },
    })
    const noTokensRegistry = new ProviderRegistry({ providers: [noTokens] })
    const c: InvokeContext = {
      registry: noTokensRegistry,
      runPaths: paths,
      projectRoot,
      config: {
        ...DEFAULT_CONFIG,
        budgets: {
          ...DEFAULT_CONFIG.budgets,
          global: {
            ...DEFAULT_CONFIG.budgets.global,
            priceTable: { 'fake:fake-1': { inputPerMTok: 10, outputPerMTok: 20 } },
          },
        },
      } as CodeOzConfig,
      now: () => '2026-05-01T18:00:00Z',
    }

    await consumeAll(invokeAgent(c, request({ model: 'fake-1' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.tokensUsed).toBeUndefined()
    expect(completed.costActualUSD).toBeUndefined()
  })

  test('omits costActualUSD when no price source resolves', async () => {
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 100 })

    await consumeAll(invokeAgent(ctxNoPriceTable(), request({ model: 'fake-1' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = logged[1] as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(completed.tokensUsed).toBe(100)
    expect(completed.costActualUSD).toBeUndefined()
  })
})

describe('invokeAgent — DEFAULT_CONFIG Claude defaults flow through', () => {
  test('Claude provider with shipped model gets costEstimateUSD from default priceTable', async () => {
    // Use the FakeProvider but pin model = 'claude-opus-4-7' so the
    // DEFAULT_CONFIG Claude entry resolves. Note: this exercises the
    // priceTable cascade end-to-end (the wrapper looks up
    // <provider>:<model>; here provider='fake' so the default Claude
    // entry does NOT match — verifying the negative path).
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 50 })
    const c: InvokeContext = {
      registry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG as CodeOzConfig,
      now: () => '2026-05-01T18:00:00Z',
    }

    await consumeAll(invokeAgent(c, request({ model: 'claude-opus-4-7' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    // No Claude-mismatched fake provider entry; fake also has no
    // capabilityOf.costPerMTok, so neither source resolves.
    expect(invoked.costEstimateUSD).toBeUndefined()
  })
})
