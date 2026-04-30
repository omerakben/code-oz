import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runScientistPhaseTail } from '../src/phases/scientist.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-sci-'))
  // M6 rule 13 fix: artifactRoot lives INSIDE projectRoot.
  projectRoot = tmp
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => '2026-04-30T11:00:00.000Z' })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function scientistAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/scientist.md',
    name: 'scientist',
    type: 'agent',
    phase: 'plan',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'] as readonly string[],
      bash: 'deny' as const,
    }),
    description: 'scientist stub',
    body: '## Scientist persona\n\nemit sidecars after primary artifact.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => '2026-04-30T12:00:00.000Z',
  }
}

const PRIMARY_PLAN = `# PLAN

## Goals

- Decompose SPEC.

## Tasks

### T-001: Write the scorer

- Files: src/score.ts
- Validation: bun test
- Risk: edge case on empty input.
- Hypotheses: H-001
- Sources: SC-SPEC-001

## Sources

- SPEC.md.

## Out of scope

- Network.

## Open questions

- None known at plan time.
`

const READY_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: scorer ranks within 50ms

- Phase: plan
- Status: open
- Falsifier: microbenchmark shows median > 50ms.
- Evidence: SPEC.md AC-1.
- Risk if false: SPEC AC fails.

# OPEN QUESTIONS

## Q-001: device baseline?

- Phase: plan
- Status: open
- Importance: medium
- DueBy: 2026-05-15
- Context: H-001 falsifier needs concrete profile.
- Resolution attempts: none yet.
`

describe('runScientistPhaseTail — success', () => {
  test('writes both sidecars on first run and emits diff events', async () => {
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: READY_RESPONSE })
    const planPath = join(paths.artifactRoot, 'PLAN.md')
    await writeFile(planPath, PRIMARY_PLAN)

    const result = await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')
    if (result.status === 'complete') {
      expect(result.hypothesesAdded).toBe(1)
      expect(result.questionsAdded).toBe(1)
      const hypText = await readFile(result.hypothesesPath, 'utf8')
      expect(hypText).toContain('## H-001')
      const oqText = await readFile(result.openQuestionsPath, 'utf8')
      expect(oqText).toContain('## Q-001')
    }

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('hypothesis_added')
    expect(types).toContain('question_added')
    expect(types).toContain('science_emitted')
  })

  test('records updated/resolved diffs across two runs', async () => {
    const planPath = join(paths.artifactRoot, 'PLAN.md')
    await writeFile(planPath, PRIMARY_PLAN)

    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: READY_RESPONSE })
    await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })

    const SECOND = `<scientist-ready/>
# HYPOTHESES

## H-001: scorer ranks within 50ms

- Phase: plan
- Status: confirmed
- Falsifier: microbenchmark shows median > 50ms.
- Evidence: SPEC.md AC-1; benchmark M1.
- Risk if false: SPEC AC fails.

# OPEN QUESTIONS

## Q-001: device baseline?

- Phase: plan
- Status: resolved
- Importance: medium
- DueBy: 2026-05-15
- Context: H-001 falsifier needs concrete profile.
- Resolution attempts: 2026-04-30 — M1 baseline confirmed.
- Resolved: 2026-04-30 — baseline locked.
`
    fake.reset()
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SECOND })

    const result = await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })

    expect(result.status).toBe('complete')
    if (result.status === 'complete') {
      expect(result.hypothesesUpdated).toBe(1)
      expect(result.questionsResolved).toBe(1)
      expect(result.hypothesesAdded).toBe(0)
    }
  })
})

describe('runScientistPhaseTail — interventions', () => {
  test('returns intervention when primary artifact missing', async () => {
    const result = await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: join(paths.artifactRoot, 'NONEXISTENT.md'),
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('scientist_primary_missing')
    }
  })

  test('returns intervention when persona omits ready token', async () => {
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({
      content: '# HYPOTHESES\n\n## H-001: x\n\n# OPEN QUESTIONS\n',
    })
    const planPath = join(paths.artifactRoot, 'PLAN.md')
    await writeFile(planPath, PRIMARY_PLAN)

    const result = await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('scientist_no_ready_token')
    }
  })

  test('returns intervention when HYPOTHESES draft fails validation', async () => {
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({
      content: '<scientist-ready/>\n# HYPOTHESES\n\n## BAD-1: missing\n\n# OPEN QUESTIONS\n',
    })
    const planPath = join(paths.artifactRoot, 'PLAN.md')
    await writeFile(planPath, PRIMARY_PLAN)

    const result = await runScientistPhaseTail({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('scientist_hypotheses_invalid')
    }
  })
})

describe('parseScientistResponse', () => {
  test('exists as a public helper for testing', async () => {
    const { parseScientistResponse } = await import('../src/phases/scientist.ts')
    expect(parseScientistResponse('no token')).toBeNull()
    const valid = parseScientistResponse(READY_RESPONSE)
    expect(valid).not.toBeNull()
    expect(valid!.hypothesesText).toContain('# HYPOTHESES')
    expect(valid!.openQuestionsText).toContain('# OPEN QUESTIONS')
  })
})

describe('runScientistPhaseTail — universal-rules injection (Codex M6 review block-push #5)', () => {
  test('the Scientist persona prompt contains the universal rule sheet', async () => {
    const planPath = join(paths.artifactRoot, 'PLAN.md')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(planPath, PRIMARY_PLAN))
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: READY_RESPONSE })

    let observedPrompt = ''
    const observerFake = {
      id: 'fake' as const,
      family: 'fake' as const,
      async *invoke(req: { prompt: string }) {
        observedPrompt = req.prompt
        yield { type: 'turn_started' as const, model: 'fake-default' }
        const r = READY_RESPONSE
        yield { type: 'content_chunk' as const, text: r }
        yield {
          type: 'turn_completed' as const,
          response: { content: r, model: 'fake-default', stopReason: 'end_turn' as const },
        }
      },
      async health() {
        return {
          provider: 'fake' as const,
          authStatus: 'ok' as const,
          modelDefaultAvailable: true,
          latencyMs: 0,
        }
      },
    }
    const observerRegistry = new ProviderRegistry({ providers: [observerFake] })
    const observerCtx: InvokeContext = {
      registry: observerRegistry,
      runPaths: paths,
      projectRoot,
      config: DEFAULT_CONFIG,
      now: () => '2026-04-30T12:00:00.000Z',
    }

    await runScientistPhaseTail({
      invokeCtx: observerCtx,
      runPaths: paths,
      runId: RUN,
      agent: scientistAgent(),
      phase: 'plan',
      primaryArtifactPath: planPath,
      fsyncDir: false,
    })

    expect(observedPrompt).toContain('code-oz universal rules')
    expect(observedPrompt).toContain('You will not')
    expect(observedPrompt).toContain('You will:')
  })
})
