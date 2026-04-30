import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

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

const BUILDER_BODY = '# Builder\n\nTest builder persona body.\n'

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

const TASK = {
  taskId: 'T-001' as const,
  validationCommand: {
    command: 'bun test tests/scoring-syllable.test.ts',
    workingDirectory: '.code-oz/runs/<runId>/worktree/',
    timeoutMs: 60000,
    expectedExitCode: 0,
  },
  riskNote: 'Risk: edge case for 3+ syllable names not addressed.',
  referencedFiles: Object.freeze(['src/scoring/syllable.ts']),
}

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

async function setupWorktree(): Promise<{ worktreePath: string; baseCommitSha: string; planSha: string }> {
  const created = await createRunWorktree({ cwd: tmp, runId: RUN })
  if (!created.ok) throw new Error(`worktree create failed: step ${created.step} ${created.code}`)
  // Stub PLAN.md sha (the orchestrator pins it; the test only needs a 64-hex value)
  const planText = '# PLAN\n\n(test stub)\n'
  await writeFile(join(paths.artifactRoot, 'PLAN.md'), planText)
  const planSha = createHash('sha256').update(planText, 'utf8').digest('hex')
  return {
    worktreePath: created.worktreePath,
    baseCommitSha: created.baseCommitSha,
    planSha,
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
    const opts: RunBuildOptions = {
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: {
        worktreePath: wt.worktreePath,
        baseCommitSha: wt.baseCommitSha,
        dirtyAtBase: false,
      },
      planSha: wt.planSha,
      invokePersona: async () => VALID_PERSONA_RESPONSE,
      now: () => '2026-04-30T11:01:00.000Z',
    }

    const result = await runBuild(opts)
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return

    expect(result.changedFileCount).toBe(1)
    expect(result.patchSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.worktreePreserved).toBe(true)

    // BUILD_REPORT.md exists, parses, and round-trips
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
    expect(data.validationCommand.command).toBe(TASK.validationCommand.command)
    expect(data.failureCarryForward).toBeNull()
    expect(data.notes.length).toBeGreaterThan(0)
  })

  test('worktree still exists after BUILD completes (Codex C3)', async () => {
    const wt = await setupWorktree()
    await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })
    expect(await pathExists(wt.worktreePath)).toBe(true)
  })

  test('emits build_started, worktree_patch_applied, build_patch_applied, build_completed', async () => {
    const wt = await setupWorktree()
    await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('build_started')
    expect(types).toContain('worktree_patch_applied')
    expect(types).toContain('build_patch_applied')
    expect(types).toContain('build_completed')
    expect(types).toContain('gate_required') // requireGate(build, ...)
  })

  test('validation command is copied verbatim from PLAN task (Codex M2)', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })
    if (result.status !== 'complete') return
    const data = parseBuildReport(await readFile(result.buildReportPath, 'utf8'))
    expect(data.validationCommand.command).toBe(TASK.validationCommand.command)
    expect(data.validationCommand.timeoutMs).toBe(TASK.validationCommand.timeoutMs)
    expect(data.validationCommand.expectedExitCode).toBe(TASK.validationCommand.expectedExitCode)
  })
})

describe('runBuild — failure paths', () => {
  test('persona response missing marker → intervention with draft', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
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
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
      invokePersona: async () => badResponse,
    })
    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_patch_apply_check_failed')
  })

  test('persona invoke throws → intervention', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
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
    await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      task: TASK,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      planSha: wt.planSha,
      invokePersona: async () => 'no marker',
    })
    const niPath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    expect(await pathExists(niPath)).toBe(true)
  })
})
