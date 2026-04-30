import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPlan, splitPlanResponse, PLAN_READY_SIGNAL } from '../src/phases/plan.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
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

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-plan-'))
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
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => '2026-04-30T11:00:00.000Z' })
  // Seed an approved SPEC.md to enable PLAN.
  await writeFile(
    join(artifactRoot, 'SPEC.md'),
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

function leadAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/lead.md',
    name: 'lead',
    type: 'agent',
    phase: 'plan',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['PLAN.md', 'SOURCE_CHECK.md'] as readonly string[],
      bash: 'deny' as const,
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.']),
          maxResults: 50,
          maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20,
          timeoutMs: 5000,
          network: 'none' as const,
        }),
      }),
    }),
    description: 'lead stub',
    body: '## Lead persona\n\ndraft plan.',
  })
}

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
    body: '## Scientist persona\n\nemit sidecars.',
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

const LEAD_RESPONSE = `${PLAN_READY_SIGNAL}
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

describe('runPlan — success path', () => {
  test('writes PLAN.md, SOURCE_CHECK.md, HYPOTHESES.md, OPEN_QUESTIONS.md and signals gate', async () => {
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: LEAD_RESPONSE })
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
      expect(await readFile(result.sourceCheckPath, 'utf8')).toContain('SC-SPEC-001')
      expect(await readFile(result.hypothesesPath, 'utf8')).toContain('## H-001')
      expect(await readFile(result.openQuestionsPath, 'utf8')).toContain('## Q-001')
    }

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('agent_invoked')
    expect(types).toContain('hypothesis_added')
    expect(types).toContain('science_emitted')
    expect(types).toContain('gate_required')
  })
})

describe('runPlan — interventions', () => {
  test('returns plan_spec_missing when SPEC.md absent', async () => {
    await rm(join(paths.artifactRoot, 'SPEC.md'))

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') expect(result.code).toBe('plan_spec_missing')
  })

  test('returns plan_no_ready_token when persona omits the marker', async () => {
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({
      content: '# PLAN\n\n(no ready token here)\n',
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
    if (result.status === 'intervention') expect(result.code).toBe('plan_no_ready_token')
  })

  test('returns plan_validation_failed when PLAN draft is malformed', async () => {
    const bad = `${PLAN_READY_SIGNAL}\n# PLAN\n\n## Goals\n\n- a\n\n## Tasks\n\n### XYZ-1: bad id\n\n- Files: x\n- Validation: y\n- Risk: z\n- Hypotheses: none\n- Sources: w\n\n## Sources\n\n- s\n\n## Out of scope\n\n- o\n\n## Open questions\n\n- None known at plan time.\n\n# SOURCE_CHECK\n\n## Spec sources\n\n### SC-SPEC-001: x\n\n- Spec: a\n- Quote: b\n\n## Reference sources\n\n### SC-REF-001: x\n\n- Path: a\n- Lines: 1-2\n- Why: c\n\n## Docs sources\n\n### SC-DOC-001: x\n\n- Library: a\n- URL: b\n- Section: c\n- Why: d\n\n## Coverage\n\n- T-001 -> SC-SPEC-001\n`
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: bad })

    const result = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
    })

    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') expect(result.code).toBe('plan_validation_failed')
  })
})

describe('splitPlanResponse', () => {
  test('returns null when ready token absent', () => {
    expect(splitPlanResponse('# PLAN\n')).toBeNull()
  })

  test('splits ready token and # SOURCE_CHECK boundary', () => {
    const r = splitPlanResponse(`${PLAN_READY_SIGNAL}\n# PLAN\n\nhello\n\n# SOURCE_CHECK\n\nworld\n`)
    expect(r).not.toBeNull()
    expect(r!.planText).toContain('# PLAN')
    expect(r!.sourceCheckText).toContain('# SOURCE_CHECK')
  })
})
