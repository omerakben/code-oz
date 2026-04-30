// M9 commit 1 substrate: worktree lifetime through REVIEW.
//
// The M8 design originally cleaned up the worktree at VERIFY-approve.
// REVIEW (M9) needs `.code-oz/runs/<runId>/worktree/` alive to read
// the changed files BUILD recorded — VERIFY-approve cleanup left
// REVIEW with nothing to read (Codex CODEX_RESPONSE_M9.md decision 5
// + risk #1, thread 019de05a).
//
// M9 commit 1:
//   - preApproveVerifyHook narrowed to verdict-pass guard only;
//     no worktree removal.
//   - preApproveReviewHook added: removes worktree at REVIEW approval,
//     emits `worktree_destroyed` (phase: review), idempotent when
//     worktree is already gone, fails when no build_provider_recorded
//     event exists for the run.
//   - The hook resolves `attempt` from the latest
//     `build_provider_recorded` event. M9 commit 7 (REVIEW orchestrator)
//     will replace that derivation with REVIEW.md's recorded BUILD ref;
//     the hook signature stays stable.

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { preApproveVerifyHook, preApproveReviewHook } from '../src/commands/approve.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { appendEvent, readEvents } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_TS = '2026-04-30T11:00:00.000Z'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('worktree-lifetime tests require git >= 2.40')
  }
})

let cwd: string
let paths: RunPaths

async function setupGitRepo(): Promise<void> {
  await runGit(cwd, ['init', '-q', '-b', 'main'])
  await runGit(cwd, ['config', 'user.email', 'test@example.com'])
  await runGit(cwd, ['config', 'user.name', 'Test'])
  await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, 'src/foo.ts'), 'export const a = 1\n')
  await runGit(cwd, ['add', '.'])
  await runGit(cwd, ['commit', '-q', '-m', 'init'])
}

async function writePassVerifyMd(): Promise<string> {
  const baseSha = '0'.repeat(40)
  const patchSha = 'c'.repeat(64)
  const reportSha = 'e'.repeat(64)
  const text = `# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${reportSha})
- Task: T-001
- Attempt: 1
- Base commit: ${baseSha}
- Patch sha256: ${patchSha}

## Validation command

- Command: bun test foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: 0
- Duration (ms): 100
- Stdout bytes: 0
- Stderr bytes: 0
- Stdout log: .code-oz/runs/<runId>/forensics/1/stdout.log
- Stderr log: .code-oz/runs/<runId>/forensics/1/stderr.log

## Verdict

- Verdict: pass
- Rationale: stub.

## Mutation

- Status: not-applicable
- Notes: stub.

## Failure constraint

- None (verdict pass).
`
  const verifyPath = join(paths.artifactRoot, 'VERIFY.md')
  await writeFile(verifyPath, text)
  return verifyPath
}

async function recordBuildProvider(opts: {
  attempt: number
  taskId: string
  provider: string
  family: string
  model?: string
}): Promise<void> {
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_provider_recorded',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'build',
      attempt: opts.attempt,
      taskId: opts.taskId,
      provider: opts.provider,
      family: opts.family,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    },
  )
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-wt-lifetime-'))
  const stateDir = join(cwd, '.code-oz/state')
  const artifactRoot = join(cwd, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await setupGitRepo()
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('preApproveVerifyHook (M9 commit 1 narrowing): worktree survives', () => {
  test('verify-approve no longer removes the worktree (REVIEW needs it)', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    const verifyPath = await writePassVerifyMd()

    await preApproveVerifyHook({ verifyPath })

    // Worktree must still exist — REVIEW will read changed files from it.
    expect(await pathExists(created.worktreePath)).toBe(true)
  })

  test('verify-approve does not emit worktree_destroyed', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    const verifyPath = await writePassVerifyMd()

    await preApproveVerifyHook({ verifyPath })

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.filter((e) => e.type === 'worktree_destroyed')
    expect(destroyed).toHaveLength(0)
  })
})

describe('preApproveReviewHook (M9 commit 1 substrate): cleanup-on-REVIEW-approve', () => {
  test('removes the worktree and emits worktree_destroyed (phase: review)', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    await recordBuildProvider({ attempt: 1, taskId: 'T-001', provider: 'claude', family: 'claude' })

    await preApproveReviewHook({ cwd, runId: RUN, runPaths: paths, now: () => FIXED_TS })

    expect(await pathExists(created.worktreePath)).toBe(false)
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.find((e) => e.type === 'worktree_destroyed') as
      | { phase: string; attempt: number; worktreePath: string }
      | undefined
    expect(destroyed).toBeDefined()
    expect(destroyed?.phase).toBe('review')
    expect(destroyed?.attempt).toBe(1)
    expect(destroyed?.worktreePath).toBe(created.worktreePath)
  })

  test('resolves attempt from the LATEST build_provider_recorded event (multi-attempt run)', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    // Simulate a run that went through 3 BUILD attempts (e.g., two VERIFY
    // failures, third pass). The latest attempt is what REVIEW just
    // approved.
    await recordBuildProvider({ attempt: 1, taskId: 'T-001', provider: 'claude', family: 'claude' })
    await recordBuildProvider({ attempt: 2, taskId: 'T-001', provider: 'claude', family: 'claude' })
    await recordBuildProvider({ attempt: 3, taskId: 'T-001', provider: 'claude', family: 'claude' })

    await preApproveReviewHook({ cwd, runId: RUN, runPaths: paths, now: () => FIXED_TS })

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.find((e) => e.type === 'worktree_destroyed') as
      | { attempt: number }
      | undefined
    expect(destroyed?.attempt).toBe(3)
  })

  test('idempotent when worktree already gone (no event emitted, no throw)', async () => {
    // Create + manually remove worktree to simulate prior cleanup or resume.
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    await runGit(cwd, ['worktree', 'remove', '--force', created.worktreePath])
    await recordBuildProvider({ attempt: 1, taskId: 'T-001', provider: 'claude', family: 'claude' })

    // Should not throw.
    await preApproveReviewHook({ cwd, runId: RUN, runPaths: paths, now: () => FIXED_TS })

    // No worktree_destroyed event for the no-op idempotent path.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.filter((e) => e.type === 'worktree_destroyed')
    expect(destroyed).toHaveLength(0)
  })

  test('refuses when no build_provider_recorded event exists', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    // Note: NO recordBuildProvider() call here.

    await expect(
      preApproveReviewHook({ cwd, runId: RUN, runPaths: paths, now: () => FIXED_TS }),
    ).rejects.toThrow(/no build_provider_recorded event/)

    // Worktree must still exist on the failed path.
    expect(await pathExists(created.worktreePath)).toBe(true)
  })
})

describe('end-to-end: VERIFY then REVIEW lifecycle (M9 commit 1)', () => {
  test('worktree survives VERIFY-approve, removed at REVIEW-approve', async () => {
    const created = await createRunWorktree({ cwd, runId: RUN })
    if (!created.ok) throw new Error('worktree create failed')
    const verifyPath = await writePassVerifyMd()
    await recordBuildProvider({ attempt: 1, taskId: 'T-001', provider: 'claude', family: 'claude' })

    // Step 1: VERIFY-approve hook fires; worktree must still exist.
    await preApproveVerifyHook({ verifyPath })
    expect(await pathExists(created.worktreePath)).toBe(true)

    // Step 2: REVIEW-approve hook fires; worktree gone, event recorded.
    await preApproveReviewHook({ cwd, runId: RUN, runPaths: paths, now: () => FIXED_TS })
    expect(await pathExists(created.worktreePath)).toBe(false)

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.find((e) => e.type === 'worktree_destroyed') as
      | { phase: string }
      | undefined
    expect(destroyed?.phase).toBe('review')
  })
})
