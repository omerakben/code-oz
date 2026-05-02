// M13 Commit 3: invokeAgent threads ProviderRequest.role into the
// agent_invoked event when present. Codex Q9 lock — role is explicit
// per invocation; absent role omits the event field (back-compat).

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
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-invoke-role-'))
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
    file: '/tmp/agent.md',
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
    description: 'stub',
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

function ctx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG as CodeOzConfig,
    now: () => '2026-05-01T18:00:00Z',
  }
}

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<void> {
  for await (const _ of stream) void _
}

describe('invokeAgent — ProviderRequest.role threading', () => {
  test('records agent_invoked.role when req.role is a canonical CompanyRole', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({
      content: 'ok',
      tokensUsed: 10,
      model: 'fake-1',
    })

    await consumeAll(invokeAgent(ctx(), request({ role: 'builder' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.role).toBe('builder')
  })

  test('omits agent_invoked.role when req.role is undefined', async () => {
    fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: 'ok' })

    await consumeAll(invokeAgent(ctx(), request()))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged[0] as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.role).toBeUndefined()
  })

  test('records every canonical role correctly', async () => {
    const roles = ['ba', 'lead', 'builder', 'verifier', 'reviewer', 'scientist'] as const
    for (const role of roles) {
      const f2 = new FakeProvider()
      const r2 = new ProviderRegistry({ providers: [f2] })
      const c2: InvokeContext = {
        registry: r2,
        runPaths: paths,
        projectRoot,
        config: DEFAULT_CONFIG as CodeOzConfig,
        now: () => `2026-05-01T18:00:00Z`,
      }
      f2.expect({}).respondWith({ content: 'ok' })
      // Use a fresh runId per iteration to keep events.jsonl readable
      // line by line; reuse the same paths so we just verify the latest.
      // Instead: verify each role records in its own append.
      await consumeAll(invokeAgent(c2, request({ role })))
    }

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invokedRoles = logged
      .filter((e): e is Extract<LoggedEvent, { type: 'agent_invoked' }> => e.type === 'agent_invoked')
      .map((e) => e.role)
    expect(invokedRoles).toEqual(['ba', 'lead', 'builder', 'verifier', 'reviewer', 'scientist'])
  })

  test('rejects malformed role at write time (validator-enforced)', async () => {
    fake.expect({}).respondWith({ content: 'ok' })

    // role: 'agile-coach' is not in M12_COMPANY_ROLES — the event-log
    // validator rejects on append. The wrapper turns this into a
    // throwing event-log error rather than silently dropping the field.
    await expect(
      consumeAll(invokeAgent(ctx(), request({ role: 'agile-coach' }))),
    ).rejects.toThrow(/agent_invoked\.role/)
  })
})

// M13 review block-push #1 + fix-soon #2 closure (CODEX_REVIEW_M13.md):
// the detector returns SoftBudgetWarning.role, but the writer in
// invoke.ts must propagate it to the appended budget_warning event.
// Without this regression test, the writer could silently drop the role
// (which is what shipped in commit 6 before this closure).
describe('invokeAgent — budget_warning.role persists round-trip', () => {
  test('per-role soft warning lands on events.jsonl with role field set', async () => {
    fake.expect({}).respondWith({ content: 'ok', tokensUsed: 10 })

    // Configure a byRole cap small enough that the next call hits 75%.
    // tokensEstimate for prompt 'do the thing' is ceil(12/4) = 3.
    // With cap = 4 and current = 0, next call = 3 -> 3/4 = 0.75 = ratio.
    const c: InvokeContext = {
      registry,
      runPaths: paths,
      projectRoot,
      config: {
        ...DEFAULT_CONFIG,
        budgets: {
          ...DEFAULT_CONFIG.budgets,
          global: {
            ...DEFAULT_CONFIG.budgets.global,
            byRole: { builder: { maxTokensEstimate: 4 } },
          },
        },
      } as CodeOzConfig,
      now: () => '2026-05-01T18:00:00Z',
    }

    await consumeAll(invokeAgent(c, request({ role: 'builder' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const warnings = logged.filter(
      (e): e is Extract<LoggedEvent, { type: 'budget_warning' }> => e.type === 'budget_warning',
    )
    const roleWarning = warnings.find((w) => w.role === 'builder')
    expect(roleWarning).toBeDefined()
    expect(roleWarning!.metric).toBe('maxTokensEstimate')
    expect(roleWarning!.limit).toBe(4)
  })

  test('global soft warning still omits role (back-compat)', async () => {
    fake.expect({}).respondWith({ content: 'ok' })

    // Configure a tight global maxTokensEstimate so the global warning
    // fires at 75%. No byRole cap, so no per-role warning.
    const c: InvokeContext = {
      registry,
      runPaths: paths,
      projectRoot,
      config: {
        ...DEFAULT_CONFIG,
        budgets: {
          ...DEFAULT_CONFIG.budgets,
          global: { ...DEFAULT_CONFIG.budgets.global, maxTokensEstimate: 4 },
        },
      } as CodeOzConfig,
      now: () => '2026-05-01T18:00:00Z',
    }

    await consumeAll(invokeAgent(c, request({ role: 'builder' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const warnings = logged.filter(
      (e): e is Extract<LoggedEvent, { type: 'budget_warning' }> => e.type === 'budget_warning',
    )
    const globalWarning = warnings.find((w) => w.role === undefined)
    expect(globalWarning).toBeDefined()
    expect(globalWarning!.metric).toBe('maxTokensEstimate')
    expect(globalWarning!.role).toBeUndefined()
  })
})
