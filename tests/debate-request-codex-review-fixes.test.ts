// Regression tests for Codex CODEX_REVIEW_M10.md findings.
//
// Closes:
//   - bp#1: requestDebate enforces tool_use.debate scope generically
//           (caller must declare it; opposingProvider must be in declared
//           list; files.length must not exceed maxFiles).
//   - bp#2: D8 sha-bound resume — debate_started without debate_resolved
//           and DECISION absent triggers resume; sha mismatch and
//           opposing-provider mismatch reject as collision.
//   - bp#3: lock-wrapped uniqueness/preview/briefing/started window —
//           tested implicitly via the ordering invariants the resume
//           detection relies on (no concurrent test, but the lock is
//           load-bearing for resume to work at all).
//   - fs#1: IgnorePolicyError from buildDebateManifestPreview wraps as
//           debate_manifest_blocked.
//   - fs#2: parseDecision rejects opposing_verdict mismatch vs RESPONSE
//           overallVerdict.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderFamily,
  ProviderHealth,
  ProviderId,
} from '../src/providers/types.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { capabilityOf, type ProviderCapability } from '../src/providers/capabilities.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { requestDebate } from '../src/tools/debate-request.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { parseDecision, parseResponse } from '../src/artifacts/debate.ts'

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

class ProxyAdapter implements IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  readonly capability: ProviderCapability
  constructor(
    id: ProviderId,
    family: ProviderFamily,
    private readonly backing: FakeProvider,
    capability: ProviderCapability = capabilityOf(id),
  ) {
    this.id = id
    this.family = family
    this.capability = capability
  }
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    return this.backing.invoke(req)
  }
  health(): Promise<ProviderHealth> {
    return this.backing.health()
  }
}

function makeCallerAgent(opts: {
  withDebate?: boolean
  opposingProviders?: readonly ProviderId[]
  maxFiles?: number
} = {}): AgentDefinition {
  const withDebate = opts.withDebate ?? true
  const opposingProviders = opts.opposingProviders ?? (['codex'] as const)
  const maxFiles = opts.maxFiles ?? 20
  const tool_use: Record<string, unknown> = {}
  if (withDebate) {
    tool_use.debate = Object.freeze({
      opposingProviders: Object.freeze([...opposingProviders]),
      maxConcurrent: 1,
      previewBeforeSend: true as const,
      maxFiles,
      timeoutMs: 600_000,
    })
  }
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
      tool_use: Object.freeze(tool_use),
    }),
    description: 'Test PLAN persona.',
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

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-debate-fixes-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => NOW })
  fake = new FakeProvider()
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

describe('requestDebate — bp#1 generic permission enforcement', () => {
  test('rejects caller without tool_use.debate scope', async () => {
    const callerNoScope = makeCallerAgent({ withDebate: false })
    const runner = requestDebate(invokeCtx(), makeRequest({ caller: callerNoScope }))
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('provider_permissions_violation')
    expect(threw?.issues[0]?.rule).toContain('tool_use.debate')
  })

  test('rejects opposingProvider not in declared list', async () => {
    // M11 update: this fixture used to declare opposingProviders=['gemini']
    // to test "requested opposingProvider not in declared list" by
    // requesting codex. After M11 (CODEX_REVIEW_M11.md bp#1) gemini
    // would fail at the loader for phase ineligibility; this test
    // bypasses the loader to exercise requestDebate's runtime check
    // directly, but the fixture is updated to use 'fake' (eligible
    // for every phase, still a not-in-list distinct family from codex).
    const caller = makeCallerAgent({ opposingProviders: ['fake'] as readonly ProviderId[] })
    const runner = requestDebate(
      invokeCtx(),
      makeRequest({ caller, opposingProvider: 'codex' }),
    )
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('provider_permissions_violation')
    expect(threw?.issues[0]?.rule).toContain('opposingProvider')
  })

  test('rejects file count exceeding maxFiles', async () => {
    const caller = makeCallerAgent({ maxFiles: 2 })
    const tooManyFiles = [
      { path: 'a.md' },
      { path: 'b.md' },
      { path: 'c.md' },
    ]
    const runner = requestDebate(
      invokeCtx(),
      makeRequest({ caller, files: tooManyFiles }),
    )
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_manifest_blocked')
    expect(threw?.issues[0]?.rule).toContain('maxFiles=2')
  })
})

describe('requestDebate — bp#2 D8 sha-bound resume', () => {
  test('resume from synthesis when BRIEFING + RESPONSE present, DECISION absent', async () => {
    // Run debate to completion (writes all artifacts + emits both events).
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })

    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }
    expect(runner1.result()).not.toBeNull()

    // Simulate crash AFTER debate_started + RESPONSE write but BEFORE
    // DECISION write + debate_resolved append: rip out DECISION.md and
    // the debate_resolved event.
    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'DECISION.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    // Re-fire requestDebate with the same topic. Should detect resume,
    // skip opposing turn, re-invoke synthesis, and complete.
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const runner2 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner2) { /* drain */ }
    const result = runner2.result()
    expect(result).not.toBeNull()
    expect(result?.callerVerdict).toBe('accept-with-modifications')
  })

  test('reject resume when BRIEFING.md sha mismatches debate_started', async () => {
    // Run to completion.
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }

    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'DECISION.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    // Tamper with BRIEFING.md (sha will not match recorded value).
    const briefingPath = join(debateDir, 'BRIEFING.md')
    const briefingRaw = await readFile(briefingPath, 'utf8')
    await writeFile(briefingPath, briefingRaw + '\nTAMPERED\n')

    const runner2 = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner2) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_topic_collision')
    expect(threw?.issues[0]?.rule).toContain('sha mismatch')
  })

  test('reject resume when opposingProvider does not match prior debate_started', async () => {
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }

    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'DECISION.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    // Re-fire with a different opposingProvider; persona allows both.
    // M11 update: this used gemini before CODEX_REVIEW_M11.md bp#1
    // closed the synthetic-debate-opponent eligibility bypass. The
    // unit test bypasses the loader to exercise requestDebate runtime
    // collision behavior, but the fixture should not normalize
    // gemini-as-eligible-opposing — it's not eligible for any phase
    // in v0.1. Replaced with `fake` (different family from codex,
    // eligible for every phase).
    const callerWithBoth = makeCallerAgent({
      opposingProviders: ['codex', 'fake'] as readonly ProviderId[],
    })
    registry = new ProviderRegistry({
      providers: [
        fake,
        new ProxyAdapter('claude', 'claude', fake),
        new ProxyAdapter('codex', 'codex', fake),
      ],
    })
    const runner2 = requestDebate(
      invokeCtx(),
      makeRequest({ caller: callerWithBoth, opposingProvider: 'fake' }),
    )
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner2) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_topic_collision')
    expect(threw?.issues[0]?.rule).toContain('opposingProvider')
  })
})

describe('parseDecision — fs#2 opposing_verdict mismatch', () => {
  test('rejects DECISION whose opposing_verdict differs from RESPONSE.overallVerdict', async () => {
    const response = parseResponse(VALID_RESPONSE_MD, 'codex')
    expect(response.overallVerdict).toBe('accept-with-modifications')

    const tamperedDecision = VALID_DECISION_MD.replace(
      'opposing_verdict: accept-with-modifications',
      'opposing_verdict: reject',
    )
    let threw: Error | null = null
    try {
      parseDecision(tamperedDecision, response)
    } catch (err) {
      threw = err as Error
    }
    expect(threw).not.toBeNull()
    expect(threw?.message).toContain('opposing_verdict')
  })

  test('passes when opposing_verdict matches RESPONSE.overallVerdict', () => {
    const response = parseResponse(VALID_RESPONSE_MD, 'codex')
    const decision = parseDecision(VALID_DECISION_MD, response)
    expect(decision.frontmatter.callerVerdict).toBe('accept-with-modifications')
    expect(decision.frontmatter.opposingVerdict).toBe('accept-with-modifications')
  })

  test('skips check when no opposingResponse is provided', () => {
    // Same as 'passes' but with null opposingResponse — exact-copy
    // heuristic + verdict-match check both skip.
    const decision = parseDecision(VALID_DECISION_MD, null)
    expect(decision.frontmatter.opposingVerdict).toBe('accept-with-modifications')
  })
})

describe('requestDebate — bp#4 in-flight or crashed-before-RESPONSE rejects', () => {
  test('priorStarted + no RESPONSE rejects as debate_concurrent_limit_exceeded', async () => {
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }

    // Simulate "in-flight": rip RESPONSE.codex.md AND DECISION.md AND
    // debate_resolved event. priorStarted persists; no RESPONSE on disk.
    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'RESPONSE.codex.md'))
    await rm(join(debateDir, 'DECISION.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    // Re-fire — should reject as concurrent limit (cannot distinguish
    // crashed-before-RESPONSE from a still-running debate without
    // process-liveness probing).
    const runner2 = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner2) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_concurrent_limit_exceeded')
    expect(threw?.issues[0]?.rule).toContain('crash-before-RESPONSE')
  })
})

describe('requestDebate — bp#5 resume binds files to sha-checked BRIEFING.md', () => {
  test('resume-synthesis allowed-files come from BRIEFING.md frontmatter, not req.files', async () => {
    // Stage a real file so the manifest validates.
    await mkdir(join(tmp, 'src'), { recursive: true })
    await writeFile(join(tmp, 'src/x.ts'), 'export const x = 1\n')
    await writeFile(join(tmp, 'src/y.ts'), 'export const y = 2\n')

    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })

    // Original session: BRIEFING.md captures only src/x.ts.
    const originalRunner = requestDebate(
      invokeCtx(),
      makeRequest({ files: [{ path: 'src/x.ts' }] }),
    )
    for await (const _ev of originalRunner) { /* drain */ }
    expect(originalRunner.result()).not.toBeNull()

    // Crash AFTER RESPONSE persisted but BEFORE DECISION.
    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'DECISION.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    // Resume session attempts to ADD a file via req.files. BRIEFING.md
    // already pinned src/x.ts; the resume must NOT honor src/y.ts.
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const resumeRunner = requestDebate(
      invokeCtx(),
      makeRequest({ files: [{ path: 'src/x.ts' }, { path: 'src/y.ts' }] }),
    )
    for await (const _ev of resumeRunner) { /* drain */ }
    const result = resumeRunner.result()
    expect(result).not.toBeNull()

    // BRIEFING.md still lists only src/x.ts (not tampered).
    const briefingText = await readFile(join(debateDir, 'BRIEFING.md'), 'utf8')
    expect(briefingText).toContain('src/x.ts')
    expect(briefingText).not.toContain('src/y.ts')
  })
})

describe('requestDebate — fs#4 DECISION-orphan check fires before RESPONSE', () => {
  test('priorStarted + DECISION present + RESPONSE absent → collision (orphan)', async () => {
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead-test' }).respondWith({ content: VALID_DECISION_MD })
    const runner1 = requestDebate(invokeCtx(), makeRequest())
    for await (const _ev of runner1) { /* drain */ }

    // Simulate corrupted state: DECISION.md still present, RESPONSE.md
    // gone (impossible with atomic writes but the parser must guard
    // against it). debate_resolved event removed.
    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    await rm(join(debateDir, 'RESPONSE.codex.md'))
    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const filtered = eventsRaw
      .split('\n')
      .filter((line) => !line.includes('"debate_resolved"'))
      .join('\n')
    await writeFile(paths.eventsFile, filtered)

    const runner2 = requestDebate(invokeCtx(), makeRequest())
    let threw: ProviderError | null = null
    try {
      for await (const _ev of runner2) { /* drain */ }
    } catch (err) {
      threw = err as ProviderError
    }
    expect(threw?.issues[0]?.code).toBe('debate_topic_collision')
    expect(threw?.issues[0]?.rule).toContain('orphan')
  })
})

describe('requestDebate — fs#1 IgnorePolicyError surfaces as debate_manifest_blocked', () => {
  test('unsupported .code-ozignore syntax fails closed and wraps as ProviderError', async () => {
    // .code-ozignore with a negation pattern (unsupported per D6 lock).
    await writeFile(join(tmp, '.code-ozignore'), '!exception.env\n')
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
    // The error message should mention the fail-closed parse failure.
    expect(threw?.issues[0]?.rule).toContain('fail-closed')
  })
})
