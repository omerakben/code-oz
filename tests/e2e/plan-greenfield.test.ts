// M6 spine e2e: DEFINE → approve → PLAN → approve, against the
// greenfield-baby-name fixture. FakeProvider only — no network, no live
// providers. The fixture's reference files ground the PLAN persona's
// repo-context surface (M7+ when a real provider issues tool_use blocks).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDefine } from '../../src/phases/define.ts'
import { runPlan, PLAN_READY_SIGNAL } from '../../src/phases/plan.ts'
import { runApprove } from '../../src/commands/approve.ts'
import { FakeProvider } from '../../src/providers/fake.ts'
import { ProviderRegistry } from '../../src/providers/registry.ts'
import type { InvokeContext } from '../../src/providers/invoke.ts'
import type { AgentDefinition } from '../../src/agents/schema.ts'
import {
  initRun,
  loadRun,
  runPathsFor,
  type RunPaths,
} from '../../src/state/run.ts'
import { generateUlid } from '../../src/state/schemas.ts'
import { DEFAULT_CONFIG, type AskMeConfig } from '../../src/config/schema.ts'
import { writeActiveRun } from '../../src/state/run.ts'
import { paths as codeOzPaths } from '../../src/paths.ts'
import { initProject } from '../../src/commands/init.ts'

const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/greenfield-baby-name', import.meta.url))
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let projectRoot: string
let codeOz: ReturnType<typeof codeOzPaths>
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const FIXED_NOW = '2026-04-30T12:00:00.000Z'
const INIT_NOW = '2026-04-30T11:00:00.000Z'

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-e2e-'))
  projectRoot = join(tmp, 'project')
  // Copy the fixture into projectRoot so the project actually exists on disk.
  await cp(FIXTURE_SRC, projectRoot, { recursive: true })
  // Run init programmatically so .code-oz/ matches what the CLI would create.
  await initProject({ cwd: projectRoot, force: false })
  codeOz = codeOzPaths(projectRoot)
  paths = runPathsFor(codeOz.state, codeOz.artifacts, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({
    paths,
    profile: 'greenfield',
    runId: RUN,
    now: () => INIT_NOW,
  })
  await writeActiveRun(paths.activeFile, RUN)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function baAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/ba.md',
    name: 'ba',
    type: 'agent',
    phase: 'define',
    provider: 'fake',
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: ['SPEC.md'] as readonly string[],
      bash: 'deny' as const,
    }),
    description: 'ba stub',
    body: '## BA persona\n\nelicit SPEC.',
  })
}

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
    body: '## Lead persona\n\nproduce PLAN + SOURCE_CHECK.',
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
    body: '## Scientist\n\nemit sidecars.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot,
    config: DEFAULT_CONFIG,
    now: () => FIXED_NOW,
  }
}

function askMeConfig(): AskMeConfig {
  return DEFAULT_CONFIG.phases.define.askMe
}

const BA_READY_REPLY = `<spec-ready/>
# SPEC

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
`

const LEAD_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose SPEC into atomic tasks.

## Tasks

### T-001: Implement candidate selector

- Files: src/candidates/select.ts, tests/candidate-select.test.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: edge case on empty surname.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001

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

### SC-REF-001: Existing top-N selector pattern in fixture

- Path: src/candidates.ts
- Lines: 4-8
- Why: tested topN pattern reusable for selector.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: scorer is hand-written, no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001
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
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`

describe('M6 spine e2e — DEFINE → approve → PLAN → approve', () => {
  test('full greenfield flow produces every spine artifact and signs both gates', async () => {
    // 1. DEFINE phase
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: BA_READY_REPLY })
    const defineResult = await runDefine({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      agent: baAgent(),
      config: askMeConfig(),
      initialUserInput: 'Help me name my baby.',
      readNextUserInput: async () => null,
      fsyncDir: false,
      now: () => FIXED_NOW,
    })
    expect(defineResult.status).toBe('complete')

    const specPath = join(codeOz.artifacts, 'SPEC.md')
    expect((await stat(specPath)).isFile()).toBe(true)

    // 2. Approve DEFINE (auto-confirm).
    const approveDefine = await runApprove({
      cwd: projectRoot,
      phase: 'define',
      now: () => FIXED_NOW,
    })
    expect(approveDefine.approved).toBe(true)
    expect(approveDefine.nextPhase).toBe('plan')

    // 3. PLAN phase
    fake.reset()
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const planResult = await runPlan({
      invokeCtx: invokeCtx(),
      runPaths: paths,
      runId: RUN,
      leadAgent: leadAgent(),
      scientistAgent: scientistAgent(),
      fsyncDir: false,
      now: () => FIXED_NOW,
    })
    expect(planResult.status).toBe('complete')

    // 4. Verify all spine artifacts exist on disk
    if (planResult.status === 'complete') {
      expect((await stat(planResult.planPath)).isFile()).toBe(true)
      expect((await stat(planResult.sourceCheckPath)).isFile()).toBe(true)
      expect((await stat(planResult.hypothesesPath)).isFile()).toBe(true)
      expect((await stat(planResult.openQuestionsPath)).isFile()).toBe(true)
      const planText = await readFile(planResult.planPath, 'utf8')
      expect(planText).toContain('### T-001:')
      const sourceCheckText = await readFile(planResult.sourceCheckPath, 'utf8')
      expect(sourceCheckText).toContain('SC-REF-001')
      expect(sourceCheckText).toContain('## Coverage')
    }

    // 5. Approve PLAN
    const approvePlan = await runApprove({
      cwd: projectRoot,
      phase: 'plan',
      now: () => FIXED_NOW,
    })
    expect(approvePlan.approved).toBe(true)
    expect(approvePlan.nextPhase).toBe('build')

    // 6. Final state check
    const loaded = await loadRun(paths)
    expect(loaded).not.toBeNull()
    expect(loaded!.state.currentPhase).toBe('build')
    expect([...loaded!.state.phasesCompleted].sort()).toEqual(['define', 'plan'])
  })
})
