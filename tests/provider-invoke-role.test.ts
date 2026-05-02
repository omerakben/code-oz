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

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
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
