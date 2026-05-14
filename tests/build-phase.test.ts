import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runBuild,
  parseBuildResponse,
  type RunBuildOptions,
} from '../src/phases/build.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { parseBuildReport } from '../src/artifacts/build-report.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`build-phase tests require git >= 2.40`)
  }
})

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const BUILDER_BODY = '# Builder\n\nTest builder persona body.\n'

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: Patch correctly handles two-syllable surnames

- Phase: build
- Status: open
- Falsifier: VERIFY mutation test passes when stress logic reverts.
- Evidence: BUILD_REPORT.md changed-file manifest.
- Risk if false: BUILD output incorrect; VERIFY rejects.

# OPEN QUESTIONS

## Q-001: Edge case for zero-syllable input

- Phase: build
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: Out of scope for T-001.
- Resolution attempts: none yet.
`

const SCIENTIST_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/scientist.md',
  name: 'scientist',
  type: 'agent',
  phase: 'build',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['HYPOTHESES.md', 'OPEN_QUESTIONS.md']),
    bash: 'deny' as const,
  }),
  description: 'scientist stub',
  body: '## Scientist\n\nemit sidecars.',
})

const BUILDER_AGENT: AgentDefinition = Object.freeze({
  file: 'src/agents/defaults/builder.md',
  name: 'builder',
  type: 'agent',
  phase: 'build',
  provider: 'claude',
  modelPolicy: 'opus-default',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
    bash: 'deny' as const,
    tool_use: Object.freeze({
      repo_context: Object.freeze({
        tools: Object.freeze(['glob', 'grep', 'read'] as const),
        roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
        maxResults: 50,
        maxBytesPerResult: 16384,
        maxFilesForNextManifest: 20,
        timeoutMs: 5000,
        network: 'none' as const,
      }),
      write: Object.freeze({
        tools: Object.freeze(['apply-patch'] as const),
        roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
        maxBytesPerPatch: 65536,
        timeoutMs: 5000,
      }),
    }),
  }),
  description: 'Test builder persona.',
  body: BUILDER_BODY,
})

const TASK_ID = 'T-001'

const VALID_PERSONA_RESPONSE = `<build-ready/>

\`\`\`diff
diff --git a/src/scoring/syllable.ts b/src/scoring/syllable.ts
--- a/src/scoring/syllable.ts
+++ b/src/scoring/syllable.ts
@@ -1,1 +1,1 @@
-export const stress = 'first'
+export const stress = 'last'
\`\`\`

## Title
Apply last-syllable stress to two-syllable surnames

## Notes
- Risk: edge case for 3+ syllable names not addressed.
`

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-build-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })

  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })

  // Init git repo + commit fixture so worktree can be created
  await runGit(tmp, ['init', '-q', '-b', 'main'])
  await runGit(tmp, ['config', 'user.email', 'test@example.com'])
  await runGit(tmp, ['config', 'user.name', 'Test'])
  await runGit(tmp, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(tmp, 'src/scoring'), { recursive: true })
  await writeFile(join(tmp, 'src/scoring/syllable.ts'), `export const stress = 'first'\n`)
  await runGit(tmp, ['add', '.'])
  await runGit(tmp, ['commit', '-q', '-m', 'init'])

  await initRun({
    paths,
    profile: 'greenfield',
    runId: RUN,
    now: () => '2026-04-30T11:00:00.000Z',
  })
})

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: DEFAULT_CONFIG,
    now: () => '2026-04-30T11:01:00.000Z',
  }
}

function buildOptsBase(wt: { worktreePath: string; baseCommitSha: string }): Omit<RunBuildOptions, 'invokePersona'> {
  fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
  return {
    runPaths: paths,
    runId: RUN,
    cwd: tmp,
    builderAgent: BUILDER_AGENT,
    scientistAgent: SCIENTIST_AGENT,
    taskId: TASK_ID,
    worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
    invokeCtx: invokeCtx(),
    now: () => '2026-04-30T11:01:00.000Z',
  }
}

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

const VALID_PLAN_TEXT = `# PLAN

## Goals

- Test plan for BUILD-phase fixture.

## Tasks

### T-001: Test syllable rule

- Files: src/scoring/syllable.ts
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: Risk: edge case for 3+ syllable names not addressed.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Beyond M7.

## Open questions

- None known at plan time.
`

async function setupWorktree(): Promise<{ worktreePath: string; baseCommitSha: string }> {
  const created = await createRunWorktree({ cwd: tmp, runId: RUN })
  if (!created.ok) throw new Error(`worktree create failed: step ${created.step} ${created.code}`)
  await writeFile(join(paths.artifactRoot, 'PLAN.md'), VALID_PLAN_TEXT)
  return {
    worktreePath: created.worktreePath,
    baseCommitSha: created.baseCommitSha,
  }
}

describe('parseBuildResponse', () => {
  test('parses valid persona response', () => {
    const parsed = parseBuildResponse(VALID_PERSONA_RESPONSE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.title).toBe('Apply last-syllable stress to two-syllable surnames')
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.patchContent).toContain('diff --git a/src/scoring/syllable.ts')
  })

  test('rejects response without ready marker', () => {
    const parsed = parseBuildResponse('no marker here\n```diff\ndiff content\n```\n## Title\nx\n## Notes\n- y\n')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.code).toBe('build_persona_protocol_violation')
    expect(parsed.reason).toContain('build-ready')
  })

  test('rejects response without fenced diff block', () => {
    const parsed = parseBuildResponse(`<build-ready/>\n\nNo diff here.\n## Title\nx\n## Notes\n- y\n`)
    expect(parsed.ok).toBe(false)
  })

  test('rejects response with multiple fenced diff blocks', () => {
    const parsed = parseBuildResponse(`<build-ready/>

\`\`\`diff
first
\`\`\`

\`\`\`diff
second
\`\`\`

## Title
x

## Notes
- y
`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('multiple')
  })

  test('rejects response without ## Notes section', () => {
    const parsed = parseBuildResponse(`<build-ready/>

\`\`\`diff
x
\`\`\`

## Title
hello
`)
    expect(parsed.ok).toBe(false)
  })

  test('rejects multiline title', () => {
    const parsed = parseBuildResponse(`<build-ready/>

\`\`\`diff
x
\`\`\`

## Title
line one
line two

## Notes
- ok
`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('single line')
  })

  test('rejects title > 120 chars', () => {
    const longTitle = 'X'.repeat(121)
    const parsed = parseBuildResponse(`<build-ready/>

\`\`\`diff
x
\`\`\`

## Title
${longTitle}

## Notes
- ok
`)
    expect(parsed.ok).toBe(false)
  })

  test('rejects empty notes section', () => {
    const parsed = parseBuildResponse(`<build-ready/>

\`\`\`diff
x
\`\`\`

## Title
hello

## Notes
`)
    expect(parsed.ok).toBe(false)
  })
})

describe('runBuild — happy path', () => {
  test('produces canonical BUILD_REPORT.md and preserves worktree', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return

    expect(result.changedFileCount).toBe(1)
    expect(result.patchSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.worktreePreserved).toBe(true)

    const reportText = await readFile(result.buildReportPath, 'utf8')
    const data = parseBuildReport(reportText)
    expect(data.task.taskId).toBe('T-001')
    expect(data.task.title).toBe('Apply last-syllable stress to two-syllable surnames')
    expect(data.task.attempt).toBe(1)
    expect(data.base.baseCommitSha).toBe(wt.baseCommitSha)
    expect(data.patch.patchSha256).toBe(result.patchSha256)
    expect(data.changedFiles).toHaveLength(1)
    expect(data.changedFiles[0]?.path).toBe('src/scoring/syllable.ts')
    expect(data.changedFiles[0]?.change).toBe('modified')
    expect(data.validationCommand.command).toBe('bun test tests/scoring-syllable.test.ts')
    expect(data.failureCarryForward).toBeNull()
    expect(data.notes.length).toBeGreaterThan(0)
  })

  test('worktree still exists after BUILD completes (Codex C3)', async () => {
    const wt = await setupWorktree()
    await runBuild({ ...buildOptsBase(wt), invokePersona: async () => VALID_PERSONA_RESPONSE })
    expect(await pathExists(wt.worktreePath)).toBe(true)
  })

  test('emits build_started, worktree_patch_applied, build_patch_applied, build_completed', async () => {
    const wt = await setupWorktree()
    await runBuild({ ...buildOptsBase(wt), invokePersona: async () => VALID_PERSONA_RESPONSE })
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('build_started')
    expect(types).toContain('worktree_patch_applied')
    expect(types).toContain('build_patch_applied')
    expect(types).toContain('build_completed')
    expect(types).toContain('gate_required')
    expect(types).toContain('science_emitted') // Scientist tail ran
  })

  test('validation command is copied verbatim from PLAN task (Codex M2)', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({ ...buildOptsBase(wt), invokePersona: async () => VALID_PERSONA_RESPONSE })
    if (result.status !== 'complete') return
    const data = parseBuildReport(await readFile(result.buildReportPath, 'utf8'))
    expect(data.validationCommand.command).toBe('bun test tests/scoring-syllable.test.ts')
    expect(data.validationCommand.timeoutMs).toBeGreaterThan(0)
    expect(data.validationCommand.expectedExitCode).toBe(0)
  })
})

describe('runBuild — failure paths', () => {
  test('persona response missing marker → intervention with draft', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => 'I refuse to follow the protocol\n',
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_persona_protocol_violation')
    expect(result.draftPath).toBeDefined()
    if (result.draftPath !== undefined) {
      expect(await pathExists(result.draftPath)).toBe(true)
    }
  })

  test('patch fails git apply --check → intervention', async () => {
    const wt = await setupWorktree()
    const badResponse = `<build-ready/>

\`\`\`diff
diff --git a/src/scoring/syllable.ts b/src/scoring/syllable.ts
--- a/src/scoring/syllable.ts
+++ b/src/scoring/syllable.ts
@@ -99,1 +99,1 @@
-this line does not exist
+nope
\`\`\`

## Title
hunk mismatch test

## Notes
- N/A
`
    const result = await runBuild({ ...buildOptsBase(wt), invokePersona: async () => badResponse })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_patch_apply_check_failed')
  })

  test('persona invoke throws → intervention', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => {
        throw new Error('provider went down')
      },
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_persona_invoke_failed')
  })

  test('NEEDS_INTERVENTION.json written on failure', async () => {
    const wt = await setupWorktree()
    await runBuild({ ...buildOptsBase(wt), invokePersona: async () => 'no marker' })
    const niPath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    expect(await pathExists(niPath)).toBe(true)
    const gate = JSON.parse(await readFile(niPath, 'utf8')) as { actionableSuggestions?: string[] }
    expect(gate.actionableSuggestions?.length ?? 0).toBeGreaterThan(0)
  })

  test('unknown taskId fails with build_task_id_unknown', async () => {
    const wt = await setupWorktree()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-999',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_task_id_unknown')
  })

  test('missing PLAN.md fails with build_plan_missing', async () => {
    const wt = await setupWorktree()
    await rm(join(paths.artifactRoot, 'PLAN.md'))
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_plan_missing')
  })
})

describe('runBuild — restart-state drift (M8 commit 7)', () => {
  test('attempt 1 with carryForward set → intervention restart_state_drift', async () => {
    const wt = await setupWorktree()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      attempt: 1,
      carryForward: {
        source: 'verify-fail',
        priorAttempt: 0,
        priorForensicsPath: '/x/forensics/0/',
        priorValidationCommand: 'bun t',
        priorVerdict: 'fail',
        priorFailureSummary: 's',
        constraint: 'c',
      },
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') expect(result.code).toBe('restart_state_drift')
  })

  test('attempt > 1 without carryForward → intervention restart_state_drift', async () => {
    const wt = await setupWorktree()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      attempt: 2,
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') expect(result.code).toBe('restart_state_drift')
  })

  test('attempt 3 with carryForward.priorAttempt=1 (drift, +1 mismatch) → intervention', async () => {
    const wt = await setupWorktree()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      attempt: 3,
      carryForward: {
        source: 'verify-fail',
        priorAttempt: 1,
        priorForensicsPath: '/x/forensics/1/',
        priorValidationCommand: 'bun t',
        priorVerdict: 'fail',
        priorFailureSummary: 's',
        constraint: 'c',
      },
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('restart_state_drift')
      expect(result.rule).toContain('priorAttempt=1')
      expect(result.rule).toContain('attempt=3')
    }
  })

  test('attempt 2 with carryForward.priorAttempt=1 → success; BUILD_REPORT.md carries the section', async () => {
    const wt = await setupWorktree()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      attempt: 2,
      carryForward: {
        source: 'verify-fail',
        priorAttempt: 1,
        priorForensicsPath: '.code-oz/runs/01HX/forensics/1/',
        priorValidationCommand: 'bun test tests/scoring-syllable.test.ts',
        priorVerdict: 'fail (exit code 1, duration 100 ms)',
        priorFailureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
        constraint: 'prefer last-syllable stress for two-syllable surnames.',
      },
      now: () => '2026-04-30T11:01:00.000Z',
    })
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    const reportText = await readFile(
      join(paths.artifactRoot, 'BUILD_REPORT.md'),
      'utf8',
    )
    expect(reportText).toContain('## Failure carry-forward')
    expect(reportText).toContain('- Prior attempt: 1')
    expect(reportText).toContain('- Constraint: prefer last-syllable stress')
    expect(reportText).not.toContain('- None (attempt 2).')
    expect(reportText).toContain('- Attempt: 2')
  })
})
