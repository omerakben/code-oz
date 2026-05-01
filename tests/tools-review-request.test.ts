import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { requestReview, type ReviewRequest } from '../src/tools/review-request.ts'
import { type InvokeContext } from '../src/providers/invoke.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { capabilityOf, type ProviderCapability } from '../src/providers/capabilities.ts'
import { collectProviderResponse } from '../src/providers/fake.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderHealth,
  ProviderId,
  ProviderFamily,
} from '../src/providers/types.ts'
import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-review-'))
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

// Lightweight test provider — implements IAgentProvider and yields a canned
// turn sequence. Lets us register adapters under arbitrary (id, family)
// pairs without subclassing FakeProvider.
class TestProvider implements IAgentProvider {
  constructor(
    public readonly id: ProviderId,
    public readonly family: ProviderFamily,
    private readonly response: string = 'reviewed',
    public readonly capability: ProviderCapability = capabilityOf(id),
  ) {}

  async *invoke(_req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    yield { type: 'turn_started', model: 'test' }
    yield { type: 'content_chunk', text: this.response }
    yield {
      type: 'turn_completed',
      response: { content: this.response, model: 'test', stopReason: 'end_turn' },
    }
  }

  async health(): Promise<ProviderHealth> {
    return Object.freeze({
      provider: this.id,
      authStatus: 'ok' as const,
      modelDefaultAvailable: true,
    })
  }
}

function reviewerAgent(provider: ProviderId, name: string = 'reviewer'): AgentDefinition {
  return Object.freeze({
    file: `/tmp/${name}.md`,
    name,
    type: 'agent' as const,
    phase: 'review' as const,
    provider,
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

function makeCtx(registry: ProviderRegistry): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => '2026-04-29T18:00:00Z',
  }
}

describe('requestReview — cross-family enforcement (rule 2)', () => {
  test('builder=claude + reviewer.provider=claude → rejects with provider_permissions_violation', async () => {
    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('claude', 'claude'),
        new TestProvider('codex', 'codex'),
      ],
    })
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('claude'),
      files: [],
      question: 'review please',
      runId: RUN,
    }
    let caught: ProviderError | null = null
    try {
      for await (const _ of requestReview(makeCtx(reg), req)) {
        // unreachable
      }
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught).not.toBeNull()
    expect(caught?.issues[0]?.code).toBe('provider_permissions_violation')
    expect(caught?.issues[0]?.rule).toContain('must differ from BUILD provider family')
  })

  test('builder=claude + reviewer.provider=codex → passes the family check', async () => {
    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('claude', 'claude'),
        new TestProvider('codex', 'codex', 'codex says: looks good'),
      ],
    })
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('codex'),
      files: [],
      question: 'review please',
      runId: RUN,
    }
    const response = await collectProviderResponse(requestReview(makeCtx(reg), req))
    expect(response.content).toBe('codex says: looks good')
  })

  test('builder=fake + reviewer.provider=fake → rejects (same-family)', async () => {
    const reg = new ProviderRegistry({
      providers: [new TestProvider('fake', 'fake')],
    })
    const req: ReviewRequest = {
      buildProvider: 'fake',
      reviewer: reviewerAgent('fake'),
      files: [],
      question: 'review please',
      runId: RUN,
    }
    let caught: ProviderError | null = null
    try {
      for await (const _ of requestReview(makeCtx(reg), req)) {
        // unreachable
      }
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_permissions_violation')
  })

  test('builder=fake + reviewer.provider=claude → passes', async () => {
    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('fake', 'fake'),
        new TestProvider('claude', 'claude', 'claude reviewing fake build'),
      ],
    })
    const req: ReviewRequest = {
      buildProvider: 'fake',
      reviewer: reviewerAgent('claude'),
      files: [],
      question: 'review please',
      runId: RUN,
    }
    const response = await collectProviderResponse(requestReview(makeCtx(reg), req))
    expect(response.content).toBe('claude reviewing fake build')
  })

  test('family check uses registry.familyOf — supports family overrides', async () => {
    // Hypothetical future: two adapters share family 'claude' (e.g.,
    // claude-cli + anthropic-api). REVIEW must reject them as same-family
    // even though their ProviderIds differ.
    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('claude', 'claude'),
        new TestProvider('codex', 'claude'), // forced same family via constructor
      ],
      // Override codex's family to be 'claude' for this test.
      familyOverrides: { codex: 'claude' },
    })
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('codex'),
      files: [],
      question: 'review please',
      runId: RUN,
    }
    let caught: ProviderError | null = null
    try {
      for await (const _ of requestReview(makeCtx(reg), req)) {
        // unreachable
      }
    } catch (err) {
      if (err instanceof ProviderError) caught = err
    }
    expect(caught?.issues[0]?.code).toBe('provider_permissions_violation')
    expect(caught?.issues[0]?.detail).toContain('family=claude')
  })
})

describe('requestReview — delegation to invokeAgent', () => {
  test('passing case writes agent_invoked + agent_completed to events.jsonl with phase=review', async () => {
    const reg = new ProviderRegistry({
      providers: [
        new TestProvider('claude', 'claude'),
        new TestProvider('codex', 'codex'),
      ],
    })
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('codex'),
      files: [],
      question: 'review',
      runId: RUN,
    }
    await collectProviderResponse(requestReview(makeCtx(reg), req))

    const { readEvents } = await import('../src/state/events.ts')
    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = logged.map((e) => e.type)
    expect(types).toEqual(['agent_invoked', 'agent_completed'])
    // Both events carry phase=review (the canonical REVIEW phase).
    expect(logged.every((e) => 'phase' in e && e.phase === 'review')).toBe(true)
  })

  test('rejecting case writes NO events (failure is in the family check, before invokeAgent acquires the lock)', async () => {
    const reg = new ProviderRegistry({
      providers: [new TestProvider('claude', 'claude')],
    })
    const req: ReviewRequest = {
      buildProvider: 'claude',
      reviewer: reviewerAgent('claude'),
      files: [],
      question: 'review',
      runId: RUN,
    }
    try {
      await collectProviderResponse(requestReview(makeCtx(reg), req))
    } catch {
      // expected
    }
    const { readEvents } = await import('../src/state/events.ts')
    const logged = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    expect(logged.length).toBe(0)
  })
})
