// M7 BUILD-lite e2e: DEFINE → approve → PLAN → approve → BUILD against
// the greenfield-baby-name fixture. FakeProvider for DEFINE/PLAN; the
// BUILD persona is invoked through a canned-response shim because BUILD's
// runner currently takes invokePersona directly (M7 simplification —
// hooking BUILD into the InvokeContext loop is M8 work).
//
// Per Codex M7 implementation review accept-with-mods on decision 9
// (CODEX_RESPONSE_M7.md, thread 019ddeea): extend the existing
// greenfield-baby-name fixture; do NOT preempt M9's greenfield-web name.

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { cp, mkdtemp, mkdir, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

import { runDefine } from '../../src/phases/define.ts'
import { runPlan, PLAN_READY_SIGNAL } from '../../src/phases/plan.ts'
import { runBuild, type RunBuildOptions } from '../../src/phases/build.ts'
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
import { createRunWorktree, runGit } from '../../src/worktree/create-run-worktree.ts'
import { parseBuildReport } from '../../src/artifacts/build-report.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'

const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/greenfield-baby-name', import.meta.url))
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-04-30T12:00:00.000Z'
const INIT_NOW = '2026-04-30T11:00:00.000Z'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`build-lite e2e requires git >= 2.40`)
  }
})

let tmp: string
let projectRoot: string
let codeOz: ReturnType<typeof codeOzPaths>
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-bl-'))
  projectRoot = join(tmp, 'project')
  await cp(FIXTURE_SRC, projectRoot, { recursive: true })
  await initProject({ cwd: projectRoot, force: false })
  codeOz = codeOzPaths(projectRoot)
  paths = runPathsFor(codeOz.state, codeOz.artifacts, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => INIT_NOW })
  await writeActiveRun(paths.activeFile, RUN)

  // Initialize git in projectRoot so worktree creation has a base commit.
  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'test@example.com'])
  await runGit(projectRoot, ['config', 'user.name', 'Test'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await runGit(projectRoot, ['add', '-A'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init fixture'])
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function baAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/ba.md', name: 'ba', type: 'agent', phase: 'define',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({ read: '*', write: ['SPEC.md'], bash: 'deny' }),
    description: 'ba stub', body: '## BA persona\n\nelicit SPEC.',
  })
}

function leadAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/lead.md', name: 'lead', type: 'agent', phase: 'plan',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['PLAN.md', 'SOURCE_CHECK.md'], bash: 'deny',
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.']),
          maxResults: 50, maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20, timeoutMs: 5000, network: 'none',
        }),
      }),
    }),
    description: 'lead stub', body: '## Lead persona\n\nproduce PLAN + SOURCE_CHECK.',
  })
}

function scientistAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/scientist.md', name: 'scientist', type: 'agent', phase: 'plan',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({ read: '*', write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'], bash: 'deny' }),
    description: 'scientist stub', body: '## Scientist\n\nemit sidecars.',
  })
}

function builderAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md', name: 'builder', type: 'agent', phase: 'build',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['.code-oz/runs/<runId>/worktree/'], bash: 'deny',
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxResults: 50, maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20, timeoutMs: 5000, network: 'none',
        }),
        write: Object.freeze({
          tools: Object.freeze(['apply-patch'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxBytesPerPatch: 65536, timeoutMs: 5000,
        }),
      }),
    }),
    description: 'builder stub', body: '## Builder\n\napply patches.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry, runPaths: paths, projectRoot, config: DEFAULT_CONFIG,
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

### T-001: Add docstring to topN helper

- Files: src/candidates.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: docstring drift if topN signature changes later.
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

## H-001: topN docstring describes the contract

- Phase: plan
- Status: open
- Falsifier: docstring contradicts the topN signature.
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

// Patch that lands cleanly against the fixture's src/candidates.ts.
// Adds a JSDoc-style docstring above topN.
const BUILDER_RESPONSE = `<build-ready/>

\`\`\`diff
diff --git a/src/candidates.ts b/src/candidates.ts
--- a/src/candidates.ts
+++ b/src/candidates.ts
@@ -5,6 +5,7 @@ export interface Candidate {
   readonly score: number
 }

+/** Returns the top N candidates by score, descending. Stable for ties. */
 export function topN(candidates: readonly Candidate[], n: number): readonly Candidate[] {
   return [...candidates].sort((a, b) => b.score - a.score).slice(0, n)
 }
\`\`\`

## Title
Add docstring describing topN contract

## Notes
- Risk: docstring drift if topN signature changes later.
`

describe('M7 BUILD-lite e2e — DEFINE → approve → PLAN → approve → BUILD', () => {
  test('full greenfield flow lands BUILD_REPORT.md and preserves worktree at the BUILD gate', async () => {
    // 1. DEFINE
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: BA_READY_REPLY })
    const defineResult = await runDefine({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN, agent: baAgent(),
      config: askMeConfig(), initialUserInput: 'Help me name my baby.',
      readNextUserInput: async () => null, fsyncDir: false, now: () => FIXED_NOW,
    })
    expect(defineResult.status).toBe('complete')

    const approveDefine = await runApprove({ cwd: projectRoot, phase: 'define', now: () => FIXED_NOW })
    expect(approveDefine.approved).toBe(true)

    // 2. PLAN
    fake.reset()
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const planResult = await runPlan({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN,
      leadAgent: leadAgent(), scientistAgent: scientistAgent(),
      fsyncDir: false, now: () => FIXED_NOW,
    })
    expect(planResult.status).toBe('complete')

    const approvePlan = await runApprove({ cwd: projectRoot, phase: 'plan', now: () => FIXED_NOW })
    expect(approvePlan.approved).toBe(true)

    // 3. Create worktree (lazy creation per Codex's accept-with-mods on decision 2)
    const created = await createRunWorktree({ cwd: projectRoot, runId: RUN })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // 4. BUILD — orchestrator pins PLAN.md sha, looks up T-001 from PLAN, runs builder.
    const planText = await readFile(join(codeOz.artifacts, 'PLAN.md'), 'utf8')
    const planSha = createHash('sha256').update(planText, 'utf8').digest('hex')

    const buildOpts: RunBuildOptions = {
      runPaths: paths, runId: RUN, cwd: projectRoot,
      builderAgent: builderAgent(),
      task: {
        taskId: 'T-001',
        validationCommand: {
          command: 'bun test tests/candidate-select.test.ts',
          workingDirectory: '.code-oz/runs/<runId>/worktree/',
          timeoutMs: 60000,
          expectedExitCode: 0,
        },
        riskNote: 'Risk: docstring drift if topN signature changes later.',
        referencedFiles: ['src/candidates.ts'],
      },
      worktree: {
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
        dirtyAtBase: false,
      },
      planSha,
      invokePersona: async () => BUILDER_RESPONSE,
      now: () => FIXED_NOW,
    }

    const buildResult = await runBuild(buildOpts)
    expect(buildResult.status).toBe('complete')
    if (buildResult.status !== 'complete') return

    expect(buildResult.changedFileCount).toBe(1)
    expect(buildResult.worktreePreserved).toBe(true)

    // 5. Assert artifacts on disk
    const reportText = await readFile(buildResult.buildReportPath, 'utf8')
    const data = parseBuildReport(reportText)
    expect(data.task.taskId).toBe('T-001')
    expect(data.task.attempt).toBe(1)
    expect(data.task.planSha).toBe(planSha)
    expect(data.changedFiles[0]?.path).toBe('src/candidates.ts')
    expect(data.changedFiles[0]?.change).toBe('modified')
    expect(data.validationCommand.command).toBe('bun test tests/candidate-select.test.ts')
    expect(data.failureCarryForward).toBeNull()

    // Worktree survives BUILD-lite (Codex C3 — cleanup-on-success is M8+)
    expect(await pathExists(created.worktreePath)).toBe(true)

    // BUILD gate fired (gate_required event in events.jsonl)
    const eventsText = await readFile(paths.eventsFile, 'utf8')
    const eventLines = eventsText.split('\n').filter((l) => l.length > 0)
    const buildGateEvent = eventLines
      .map((l) => JSON.parse(l) as { type?: string; phase?: string })
      .find((e) => e.type === 'gate_required' && e.phase === 'build')
    expect(buildGateEvent).toBeDefined()

    // Run state
    const loaded = await loadRun(paths)
    expect(loaded).not.toBeNull()
    expect([...loaded!.state.phasesCompleted].sort()).toEqual(['define', 'plan'])
    // BUILD has not yet been approved; current is still 'build' (gate fired).
    expect(loaded!.state.currentPhase).toBe('build')

    // Patch artifact retained under runs/<runId>/patches/
    expect(await pathExists(buildResult.patchPath)).toBe(true)
  })
})
