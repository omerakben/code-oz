// Integration tests for PLAN orchestrator <debate-request> extraction.
//
// Covers:
//   1. Happy path: PLAN turn 1 emits <debate-request>; debate runs;
//      continuation turn produces final PLAN+SOURCE_CHECK; gate signals.
//   2. Terminal-directive: trailing PLAN prose after </debate-request>
//      lands in discarded-drafts and is NOT used as the final PLAN.
//   3. Multiple <debate-request> blocks → fail-fast intervention
//      (plan_multiple_debate_requests).
//   4. Unauthorized opposingProvider → intervention
//      (plan_debate_opposing_provider_unauthorized).
//   5. Persona has no tool_use.debate but emits a block → intervention
//      (plan_debate_permission_missing).
//   6. Parse-error in the YAML body → intervention
//      (plan_debate_request_invalid).
//   7. Second debate request inside the continuation turn →
//      plan_debate_round_exceeded (MAX_DEBATE_ROUNDS = 1).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPlan, PLAN_READY_SIGNAL } from '../src/phases/plan.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderFamily,
  ProviderHealth,
  ProviderId,
} from '../src/providers/types.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import { parsePlan } from '../src/artifacts/plan.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

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

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-plan-debate-'))
  projectRoot = tmp
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({
    providers: [
      fake,
      new ProxyAdapter('claude', 'claude', fake),
      new ProxyAdapter('codex', 'codex', fake),
    ],
  })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => '2026-05-01T11:00:00.000Z' })
  await writeFile(
    join(paths.artifactRoot, 'SPEC.md'),
    `# SPEC

## Goals

- Help a parent name their newborn.

## Users

- New parents.

## Constraints

- Runs locally.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.

## Open questions

- None known at define time.

## Explicit non-goals

- Not building a name registry.
`,
  )
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function leadAgent(opts: {
  provider?: ProviderId
  withDebate?: boolean
  opposingProviders?: readonly ProviderId[]
} = {}): AgentDefinition {
  const provider = opts.provider ?? 'claude'
  const withDebate = opts.withDebate ?? true
  const opposingProviders = opts.opposingProviders ?? (['codex'] as const)
  const tool_use: Record<string, unknown> = {
    repo_context: Object.freeze({
      tools: Object.freeze(['glob', 'grep', 'read'] as const),
      roots: Object.freeze(['.']),
      maxResults: 50,
      maxBytesPerResult: 16384,
      maxFilesForNextManifest: 20,
      timeoutMs: 5000,
      network: 'none' as const,
    }),
  }
  if (withDebate) {
    tool_use.debate = Object.freeze({
      opposingProviders: Object.freeze([...opposingProviders]),
      maxConcurrent: 1,
      previewBeforeSend: true as const,
      maxFiles: 20,
      timeoutMs: 600_000,
    })
  }
  return Object.freeze({
    file: '/tmp/lead.md',
    name: 'lead',
    type: 'agent',
    phase: 'plan',
    provider,
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['PLAN.md', 'SOURCE_CHECK.md'] as readonly string[],
      bash: 'deny' as const,
      tool_use: Object.freeze(tool_use),
    }),
    description: 'lead test stub with optional debate scope',
    body: '## Lead persona\n\ndraft plan with optional debate.',
  })
}

function scientistAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/scientist.md',
    name: 'scientist',
    type: 'agent',
    phase: 'plan',
    provider: 'claude',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'] as readonly string[],
      bash: 'deny' as const,
    }),
    description: 'scientist stub',
    body: '## Scientist persona\n\nemit sidecars.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => '2026-05-01T12:00:00.000Z',
  }
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
  'resolved_by: "Ozzy + Lead"',
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
  'After weighing the opposing critique that strict ordering creates over-reliance on a single source, the calling persona modified the decision to add a per-feature caveat clause that addresses the concern without abandoning the priority itself. This is independent reasoning grounded in the project context.',
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

const FINAL_PLAN_MD = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose SPEC into atomic tasks.

## Tasks

### T-001: Implement candidate selector

- Files: src/candidates/select.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: edge case on empty surname.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Surname generation.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

## Reference sources

### SC-REF-NONE-001: No template adapter for candidate selection

- Searched: glob agents/templates/**/select-*.ts
- Result: no relevant pattern found.
- Why explicit: clean-room design from SPEC.

## Docs sources

### SC-DOC-NONE-001: No external library used

- Why explicit: scorer is hand-written, no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: candidate selector handles empty surname

- Phase: plan
- Status: open
- Falsifier: empty surname returns five candidates without throwing.
- Evidence: SPEC.md AC-1.
- Risk if false: PLAN T-001 needs rework.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: plan
- Status: open
- Importance: medium
- DueBy: 2026-12-31
- Context: SPEC open questions deferred at DEFINE.
- Resolution attempts: none yet.
`

function buildDebateRequestBlock(overrides: {
  topic?: string
  opposingProvider?: string
  trailing?: string
} = {}): string {
  const topic = overrides.topic ?? 'plan-source-priority'
  const opposingProvider = overrides.opposingProvider ?? 'codex'
  const trailing = overrides.trailing ?? ''
  return [
    `<debate-request>`,
    `topic: ${topic}`,
    `opposingProvider: ${opposingProvider}`,
    `question: Should Anthropic docs always win?`,
    `files: []`,
    `sections:`,
    `  whatYouAreReading: Cross-family debate on docs precedence.`,
    `  whereWeStand: M10 in progress; tests passing.`,
    `  whatIsLocked: CLAUDE.md rules 7 and 9.`,
    `  whatIsUpForDebate: Strict-priority vs per-feature override.`,
    `  recommendedPath: Anthropic > OpenAI; per-feature only on measurable need.`,
    `  decisionPrompts: 1. Verdict?`,
    `  whatIWantFromYou: Verdict + risks.`,
    `</debate-request>`,
    trailing,
  ].join('\n')
}

describe('PLAN debate extraction — happy path', () => {
  test('extracts <debate-request>, runs debate, and continues to final PLAN', async () => {
    // Turn 1 (Lead): emit <debate-request>.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: buildDebateRequestBlock() })
    // Turn A (debate-opponent): RESPONSE.codex.md.
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    // Turn B (Lead, synthesis): DECISION.md.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: VALID_DECISION_MD })
    // Turn C (Lead, continuation): final PLAN+SOURCE_CHECK.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: FINAL_PLAN_MD })
    // Scientist phase-tail.
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')
    if (result.status === 'complete') {
      const planText = await readFile(result.planPath, 'utf8')
      const reparsed = parsePlan(planText)
      expect(reparsed.tasks.length).toBe(1)
      expect(reparsed.tasks[0]!.id).toBe('T-001')
    }

    // debate_started + debate_resolved emitted under runId.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('debate_started')
    expect(types).toContain('debate_resolved')

    // The debate artifact dir was written.
    const debateDir = join(paths.runDir, 'artifacts', 'debates', 'plan-source-priority')
    const decisionStat = await stat(join(debateDir, 'DECISION.md'))
    expect(decisionStat.isFile()).toBe(true)
  })
})

describe('PLAN debate extraction — terminal directive (D1)', () => {
  test('trailing PLAN prose lands in discarded-drafts, not in final PLAN', async () => {
    const stalePlanText =
      `${PLAN_READY_SIGNAL}\n# PLAN\n\n## Goals\n\n- Stale pre-decision draft.\n` +
      `\n## Tasks\n\n### T-999: stale\n\n- Files: stale.ts\n` +
      `- Validation: bun test\n- Risk: stale.\n- Hypotheses: none\n` +
      `- Sources: SC-SPEC-001\n\n## Sources\n\n- (none)\n\n## Out of scope\n\n- (none)\n` +
      `\n## Open questions\n\n- None known at plan time.\n`
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({
      content: buildDebateRequestBlock({ trailing: stalePlanText }),
    })
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: VALID_DECISION_MD })
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: FINAL_PLAN_MD })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')

    // Discarded-drafts file exists under runDir/.
    const discardedPath = join(
      paths.runDir,
      'discarded-drafts',
      'plan-plan-source-priority.draft.md',
    )
    const discardedStat = await stat(discardedPath)
    expect(discardedStat.isFile()).toBe(true)
    const discarded = await readFile(discardedPath, 'utf8')
    expect(discarded).toContain('T-999')
    expect(discarded).toContain('Stale pre-decision draft')

    // Final PLAN reflects the post-decision continuation, not the stale draft.
    if (result.status === 'complete') {
      const planText = await readFile(result.planPath, 'utf8')
      expect(planText).not.toContain('T-999')
      expect(planText).not.toContain('Stale pre-decision draft')
      expect(planText).toContain('T-001')
    }
  })
})

describe('PLAN debate extraction — fail-fast cases', () => {
  test('multiple <debate-request> blocks → plan_multiple_debate_requests', async () => {
    const twoBlocks = buildDebateRequestBlock() + '\n' + buildDebateRequestBlock({ topic: 'second-topic' })
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: twoBlocks })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('plan_multiple_debate_requests')
    }
  })

  test('parse-error in YAML body → plan_debate_request_invalid', async () => {
    const malformed = [
      '<debate-request>',
      'topic: BAD CASE WITH SPACES',
      'opposingProvider: codex',
      'question: hi',
      'files: []',
      'sections:',
      '  whatYouAreReading: A',
      '  whereWeStand: B',
      '  whatIsLocked: C',
      '  whatIsUpForDebate: D',
      '  recommendedPath: E',
      '  decisionPrompts: F',
      '  whatIWantFromYou: G',
      '</debate-request>',
    ].join('\n')
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: malformed })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('plan_debate_request_invalid')
    }
  })

  test('persona without tool_use.debate → plan_debate_permission_missing', async () => {
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: buildDebateRequestBlock() })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent({ withDebate: false }),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('plan_debate_permission_missing')
    }
  })

  test('opposingProvider not in declared list → plan_debate_opposing_provider_unauthorized', async () => {
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({
      content: buildDebateRequestBlock({ opposingProvider: 'codex' }),
    })

    // Persona only allows opposingProviders=['gemini'] (cross-family vs claude),
    // but the YAML names 'codex'. The orchestrator clamps this BEFORE calling
    // requestDebate.
    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent({ opposingProviders: ['gemini'] as readonly ProviderId[] }),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('plan_debate_opposing_provider_unauthorized')
    }
  })
})

describe('PLAN debate extraction — round cap', () => {
  test('second <debate-request> in continuation → plan_debate_round_exceeded', async () => {
    // Turn 1: first debate request.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: buildDebateRequestBlock() })
    // Opposing-party RESPONSE.
    fake
      .expect({ phase: 'plan', agent: 'debate-opponent' })
      .respondWith({ content: VALID_RESPONSE_MD })
    // Synthesis turn (still 'lead'): DECISION.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: VALID_DECISION_MD })
    // Continuation turn (still 'lead'): a SECOND <debate-request> with a
    // different topic to keep requestDebate's topic-collision guard out
    // of the way.
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({
      content: buildDebateRequestBlock({ topic: 'plan-additional' }),
    })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('plan_debate_round_exceeded')
    }
  })
})
