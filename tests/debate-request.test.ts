// M10 commit 7: requestDebate primitive tests.
//
// Covers the runtime orchestration of a debate end-to-end with FakeProvider:
//   - cross-family invocation-time check (load + invocation layered)
//   - manifest preview written before any provider call (D9, risk #7)
//   - BRIEFING.md atomically written + debate_started emitted with
//     all four sha bindings
//   - opposing-party invocation via invokeAgent (D11: counts under budget)
//   - synthesis-turn invocation (D11: also counts under budget)
//   - DECISION.md atomic write + debate_resolved emitted with dual verdicts
//   - topic-collision check (D7: events.jsonl + artifact dir)
//   - manifest-blocked intervention (D6 + D9)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import type { IAgentProvider, ProviderEvent, ProviderHealth, PreparedProviderRequest, ProviderId, ProviderFamily } from '../src/providers/types.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { requestDebate } from '../src/tools/debate-request.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { readEvents } from '../src/state/events.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-05-01T12:00:00.000Z'

const DEFAULT_CONFIG = {
  budgets: {
    global: {
      maxTurns: 100,
      maxProviderCalls: 100,
      maxTokensEstimate: 100_000,
      maxWallTimeMinutes: 60,
      softWarnAtRatio: 0.75,
    },
    perPhase: {
      define: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      plan: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      build: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      verify: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      review: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      ship: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
      audit: { maxTurns: 50, maxProviderCalls: 50, maxTokensEstimate: 50_000 },
    },
  },
} as never

function makeCallerAgent(): AgentDefinition {
  return Object.freeze({
    file: 'src/agents/defaults/lead-test.md',
    name: 'lead-test',
    type: 'agent' as const,
    phase: 'plan' as const,
    provider: 'claude' as const,
    modelPolicy: 'any' as const,
    permissions: Object.freeze({
      read: '*' as const,
      write: Object.freeze(['.code-oz/artifacts/PLAN.md']),
      bash: 'deny' as const,
      tool_use: Object.freeze({
        debate: Object.freeze({
          opposingProviders: Object.freeze(['codex' as const]),
          maxConcurrent: 1,
          previewBeforeSend: true as const,
          maxFiles: 20,
          timeoutMs: 600_000,
        }),
      }),
    }),
    description: 'Test PLAN persona with tool_use.debate.',
    body: '# Lead\n\n## Overview\nTest agent.\n',
  })
}

const VALID_RESPONSE_MD = [
  '---',
  'thread: 019de3ca-9641-7f83-b479-f65ad390c179',
  'date: 2026-05-01',
  'model: gpt-5.5 xhigh',
  'brief: ./BRIEFING.md',
  '---',
  '# Response',
  '',
  '## Verdict on the decisions',
  '',
  'Overall verdict: accept-with-modifications',
  '',
  '1. accept-with-modifications - the lean is right; modify the X bit.',
  '',
  '## Risks the proposing side missed',
  '',
  'Risk: docs precedence may shift over time.',
  '',
  '## Where I disagree',
  '',
  'I disagree with the strict ordering; allow per-feature overrides.',
  '',
  '## What I would defer',
  '',
  'Defer per-feature overrides until measurable need.',
  '',
  '## Recommended next step',
  '',
  'Lock priority + add caveat; proceed.',
  '',
].join('\n')

const VALID_DECISION_MD = [
  '---',
  'date: 2026-05-01',
  'resolved_by: "Ozzy + Claude"',
  'caller_verdict: accept-with-modifications',
  'opposing_verdict: accept-with-modifications',
  '---',
  '# Decision - plan-source-priority',
  '',
  '## Verdict',
  '',
  'accept-with-modifications: lock priority but document caveat.',
  '',
  '## Rationale',
  '',
  'After weighing the opposing critique that strict ordering creates over-reliance, the calling persona modified the decision to add a per-feature caveat clause that addresses the concern without abandoning the priority itself. This independent reasoning resolves both concerns.',
  '',
  '## What changes (artifact deltas)',
  '',
  '- Add caveat to PLAN.md.',
  '',
  '## What does not change',
  '',
  '- Anthropic-first priority.',
  '',
  '## Open follow-ups',
  '',
  '- Q-001: revisit if measurable bias appears.',
  '',
].join('\n')

// Test-only adapter that proxies a backing FakeProvider but reports a
// configurable id/family. Lets us register two adapters in one registry
// (one for caller='claude', one for opposing='codex') without modifying
// FakeProvider's hardcoded id='fake' constant.
class ProxyAdapter implements IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  constructor(
    id: ProviderId,
    family: ProviderFamily,
    private readonly backing: FakeProvider,
  ) {
    this.id = id
    this.family = family
  }
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    return this.backing.invoke(req)
  }
  health(): Promise<ProviderHealth> {
    return this.backing.health()
  }
}

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-debate-request-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => NOW })
  fake = new FakeProvider()
  // Register both 'claude' (for caller) and 'codex' (for opposing)
  // via proxy adapters around the single backing fake. familyOverrides
  // are not needed since each proxy declares its own family.
  registry = new ProviderRegistry({
    providers: [
      fake,
      new ProxyAdapter('claude', 'claude', fake),
      new ProxyAdapter('codex', 'codex', fake),
    ],
  })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: DEFAULT_CONFIG,
    now: () => NOW,
  }
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    caller: makeCallerAgent(),
    phase: 'plan' as const,
    topic: 'plan-source-priority',
    opposingProvider: 'codex' as const,
    question: 'Should Anthropic docs always win?',
    files: [],
    runId: RUN,
    date: '2026-05-01',
    callerLabel: 'Claude',
    targetLabel: 'gpt-5.5 xhigh',
    cycle: 'plan',
    status: 'thesis' as const,
    briefingSections: {
      whatYouAreReading: 'Cross-family debate on docs precedence.',
      whereWeStand: 'M10 in progress; tests passing.',
      whatIsLocked: 'CLAUDE.md rules 7 + 9.',
      whatIsUpForDebate: 'Strict-priority vs per-feature override.',
      recommendedPath: 'Anthropic > OpenAI; per-feature only on measurable need.',
      decisionPrompts: '1. Verdict?',
      whatIWantFromYou: 'Verdict + risks.',
    },
    projectRoot: tmp,
    resolvedBy: 'Ozzy + Claude',
    ...overrides,
  }
}

describe('requestDebate - happy path', () => {
  test('end-to-end debate writes all four artifacts and emits both events', async () => {
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake
      .expect({ phase: 'plan', agent: 'lead-test' })
      .respondWith({ content: VALID_DECISION_MD })

    const runner = requestDebate(invokeCtx(), makeRequest())
    const events: string[] = []
    for await (const ev of runner) events.push(ev.type)

    const result = runner.result()
    expect(result).not.toBeNull()
    expect(result?.callerVerdict).toBe('accept-with-modifications')
    expect(result?.responseVerdict).toBe('accept-with-modifications')
    expect(result?.briefingSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result?.decisionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result?.manifestPreviewSha256).toMatch(/^[0-9a-f]{64}$/)

    // All four artifacts written.
    const briefing = await readFile(result!.briefingPath, 'utf-8')
    expect(briefing).toContain('topic: plan-source-priority')
    expect(briefing).toContain('## What you are reading')

    const response = await readFile(result!.responsePath, 'utf-8')
    expect(response).toContain('Overall verdict: accept-with-modifications')

    const decision = await readFile(result!.decisionPath, 'utf-8')
    expect(decision).toContain('## Rationale')

    const preview = await readFile(result!.previewPath, 'utf-8')
    expect(preview).toContain('Debate manifest preview')

    // RESPONSE filename includes the opposing side suffix.
    expect(result!.responsePath.endsWith('RESPONSE.codex.md')).toBe(true)

    // Both events emitted.
    const allEvents = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = allEvents.map((e) => e.type)
    expect(types).toContain('debate_started')
    expect(types).toContain('debate_resolved')

    // Provider events streamed (D11: both turns flow through invokeAgent).
    expect(events).toContain('turn_completed')
  })
})

describe('requestDebate - cross-family invariant', () => {
  test('rejects same-family opposing provider', async () => {
    // Caller is family=claude. Try debating against another claude
    // provider (synthetic — registry needs to recognize it; for the
    // test, attempt opposing=fake with caller=fake to trip same-family).
    const sameFamilyAgent = Object.freeze({
      ...makeCallerAgent(),
      provider: 'fake' as const,
      permissions: Object.freeze({
        ...makeCallerAgent().permissions,
        tool_use: Object.freeze({
          debate: Object.freeze({
            opposingProviders: Object.freeze(['fake' as const]),
            maxConcurrent: 1,
            previewBeforeSend: true as const,
            maxFiles: 20,
            timeoutMs: 600_000,
          }),
        }),
      }),
    })
    const runner = requestDebate(
      invokeCtx(),
      makeRequest({ caller: sameFamilyAgent, opposingProvider: 'fake' }),
    )
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw).not.toBeNull()
    expect(threw?.issues[0]?.code).toBe('provider_permissions_violation')
  })
})

describe('requestDebate - topic collision', () => {
  test('second debate with same topic in same run fails fast', async () => {
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake
      .expect({ phase: 'plan', agent: 'lead-test' })
      .respondWith({ content: VALID_DECISION_MD })

    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }
    expect(runner1.result()).not.toBeNull()

    // Re-fire with same topic. Should fail fast (events.jsonl scan).
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    const runner2 = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner2) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_topic_collision')
  })
})

describe('requestDebate - manifest blocked', () => {
  test('blocked file in .code-ozignore halts debate before any provider call', async () => {
    // Write a .code-ozignore that blocks one of the requested files.
    await writeFile(join(tmp, '.code-ozignore'), '.env\n')
    await writeFile(join(tmp, '.env'), 'SECRET=x')

    const runner = requestDebate(
      invokeCtx(),
      makeRequest({ files: [{ path: '.env' }] }),
    )
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_manifest_blocked')

    // No debate_started event should have been emitted.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    expect(events.find((e) => e.type === 'debate_started')).toBeUndefined()
  })
})

describe('requestDebate - decision validation', () => {
  test('exact-copy rationale > 200 chars rejected (D5 lock)', async () => {
    const longText =
      'A long rationale text that intentionally exceeds two hundred characters so the heuristic can engage. ' +
      'The exact same text appears verbatim in the opposing response below to trigger the heuristic correctly. ' +
      'Padding for length.'
    expect(longText.length).toBeGreaterThan(200)

    const opposingMd = VALID_RESPONSE_MD.replace(
      'I disagree with the strict ordering; allow per-feature overrides.',
      longText,
    )
    const decisionMd = VALID_DECISION_MD.replace(
      /## Rationale\n\n[^#]+\n\n## What changes/,
      `## Rationale\n\n${longText}\n\n## What changes`,
    )
    fake.expect({ phase: 'plan', agent: 'debate-opponent' }).respondWith({ content: opposingMd })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: decisionMd })

    const runner = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_decision_invalid')
  })

  test('malformed RESPONSE (missing Overall verdict) raises debate_response_invalid', async () => {
    const badResponse = VALID_RESPONSE_MD.replace(
      'Overall verdict: accept-with-modifications',
      'Some prose first.',
    )
    fake.expect({ phase: 'plan', agent: 'debate-opponent' }).respondWith({ content: badResponse })
    const runner = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_response_invalid')
  })
})
