// 09-byterover-cli B3 (Codex thread `019e1318`):
// invokeAgent threads ProviderRequest.parentTaskId onto both
// agent_invoked and agent_completed when present; absent parentTaskId
// omits both event fields (back-compat with pre-B3 readers).

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
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-invoke-parent-'))
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
    name: 'reviewer-A',
    type: 'agent' as const,
    phase: 'review' as const,
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
    phase: 'review',
    runId: RUN,
    prompt: 'review the build',
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
    now: () => '2026-05-10T18:00:00Z',
  }
}

async function consumeAll(stream: AsyncIterable<ProviderEvent>): Promise<void> {
  for await (const _ of stream) void _
}

describe('invokeAgent — ProviderRequest.parentTaskId threading', () => {
  test('records parentTaskId on both agent_invoked and agent_completed when set', async () => {
    fake.expect({ phase: 'review', agent: 'reviewer-A' }).respondWith({
      content: 'ok',
      tokensUsed: 25,
      model: 'fake-1',
    })

    await consumeAll(invokeAgent(ctx(), request({ parentTaskId: 'T-007' })))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged.find((e) => e.type === 'agent_invoked') as Extract<LoggedEvent, { type: 'agent_invoked' }>
    const completed = logged.find((e) => e.type === 'agent_completed') as Extract<LoggedEvent, { type: 'agent_completed' }>
    expect(invoked.parentTaskId).toBe('T-007')
    expect(completed.parentTaskId).toBe('T-007')
  })

  test('omits parentTaskId field when ProviderRequest.parentTaskId is undefined (back-compat)', async () => {
    fake.expect({ phase: 'review', agent: 'reviewer-A' }).respondWith({ content: 'ok' })

    await consumeAll(invokeAgent(ctx(), request()))

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged.find((e) => e.type === 'agent_invoked') as Record<string, unknown>
    const completed = logged.find((e) => e.type === 'agent_completed') as Record<string, unknown>
    expect('parentTaskId' in invoked).toBe(false)
    expect('parentTaskId' in completed).toBe(false)
  })

  test('parentTaskId co-exists with role on the same event', async () => {
    fake.expect({ phase: 'review', agent: 'reviewer-A' }).respondWith({
      content: 'ok',
      tokensUsed: 10,
    })

    await consumeAll(
      invokeAgent(ctx(), request({ role: 'reviewer', parentTaskId: 'T-042' })),
    )

    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const invoked = logged.find((e) => e.type === 'agent_invoked') as Extract<LoggedEvent, { type: 'agent_invoked' }>
    expect(invoked.role).toBe('reviewer')
    expect(invoked.parentTaskId).toBe('T-042')
  })
})
