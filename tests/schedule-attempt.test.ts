// Integration tests for scheduleAttemptNPlus1 (M8 fix 4).
//
// Closes Codex review M8 finding bp-next-milestone#2: the remaining
// two canonical events after a VERIFY fail (worktree_destroyed,
// verify_restart_initiated) fire from this orchestrator after
// runVerify returns a VerifyFailed result.

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { readEvents } from '../src/state/events.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { scheduleAttemptNPlus1 } from '../src/phases/schedule-attempt.ts'
import type { VerifyFailed } from '../src/phases/verify.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('schedule-attempt tests require git >= 2.40')
  }
})

let tmp: string
let paths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-sched-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => '2026-04-30T20:00:00.000Z' })

  // Real git repo + worktree
  await runGit(tmp, ['init', '-q', '-b', 'main'])
  await runGit(tmp, ['config', 'user.email', 'test@example.com'])
  await runGit(tmp, ['config', 'user.name', 'Test'])
  await runGit(tmp, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(tmp, 'src'), { recursive: true })
  await writeFile(join(tmp, 'src/foo.ts'), 'export const a = 1\n')
  await runGit(tmp, ['add', '.'])
  await runGit(tmp, ['commit', '-q', '-m', 'init'])
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

describe('scheduleAttemptNPlus1 — restart path', () => {
  test('emits worktree_destroyed + verify_restart_initiated, removes worktree', async () => {
    const created = await createRunWorktree({ cwd: tmp, runId: RUN })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const verifyFailed: VerifyFailed = {
      status: 'failed',
      verifyReportPath: join(paths.artifactRoot, 'VERIFY.md'),
      forensicsPath: join(paths.runDir, 'forensics', '1'),
      nextAction: 'restart',
      nextAttempt: 2,
      carryForward: {
        priorAttempt: 1,
        priorForensicsPath: join(paths.runDir, 'forensics', '1'),
        priorValidationCommand: 'bun test foo.test.ts',
        priorVerdict: 'fail (exit code 1, duration 100 ms)',
        priorFailureSummary: 's',
        constraint: 'c',
      },
    }

    const result = await scheduleAttemptNPlus1({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      verifierAgent: 'verifier',
      verifyFailed,
      now: () => '2026-04-30T20:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextAction).toBe('restart')
    expect(result.nextAttempt).toBe(2)

    // Worktree gone
    expect(await pathExists(created.worktreePath)).toBe(false)

    // Events emitted in canonical order
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const destroyed = events.findIndex((e) => e.type === 'worktree_destroyed')
    const restart = events.findIndex((e) => e.type === 'verify_restart_initiated')
    expect(destroyed).toBeGreaterThanOrEqual(0)
    expect(restart).toBeGreaterThanOrEqual(0)
    expect(restart).toBeGreaterThan(destroyed) // canonical order
    const restartEvent = events[restart] as {
      nextAction: string
      nextAttempt: number
      attempt: number
    }
    expect(restartEvent.nextAction).toBe('restart')
    expect(restartEvent.nextAttempt).toBe(2)
    expect(restartEvent.attempt).toBe(1)
  })
})

describe('scheduleAttemptNPlus1 — intervention path', () => {
  test('cap-exhausted: emits worktree_destroyed + verify_restart_initiated with intervention action', async () => {
    const created = await createRunWorktree({ cwd: tmp, runId: RUN })
    if (!created.ok) return

    const verifyFailed: VerifyFailed = {
      status: 'failed',
      verifyReportPath: join(paths.artifactRoot, 'VERIFY.md'),
      forensicsPath: join(paths.runDir, 'forensics', '4'),
      nextAction: 'intervention',
    }

    const result = await scheduleAttemptNPlus1({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      verifierAgent: 'verifier',
      verifyFailed,
      now: () => '2026-04-30T20:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextAction).toBe('intervention')
    expect(await pathExists(created.worktreePath)).toBe(false)

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const restart = events.find((e) => e.type === 'verify_restart_initiated') as {
      nextAction: string
      attempt: number
    } | undefined
    expect(restart).toBeDefined()
    expect(restart?.nextAction).toBe('intervention')
    expect(restart?.attempt).toBe(4)
  })
})

describe('scheduleAttemptNPlus1 — worktree removal failure', () => {
  test('writes NEEDS_INTERVENTION.json + intervention event when removal fails', async () => {
    // Don't create the worktree → removeRunWorktree will fail because
    // the worktree path doesn't exist in git's worktree list.
    const verifyFailed: VerifyFailed = {
      status: 'failed',
      verifyReportPath: join(paths.artifactRoot, 'VERIFY.md'),
      forensicsPath: join(paths.runDir, 'forensics', '1'),
      nextAction: 'restart',
      nextAttempt: 2,
      carryForward: {
        priorAttempt: 1,
        priorForensicsPath: join(paths.runDir, 'forensics', '1'),
        priorValidationCommand: 'bun test',
        priorVerdict: 'fail',
        priorFailureSummary: 's',
        constraint: 'c',
      },
    }

    const result = await scheduleAttemptNPlus1({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      verifierAgent: 'verifier',
      verifyFailed,
      now: () => '2026-04-30T20:00:00.000Z',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('verify_worktree_cleanup_failed')

    // NEEDS_INTERVENTION.json written
    const gatePath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    await access(gatePath)
    const gate = JSON.parse(await readFile(gatePath, 'utf8')) as Record<string, unknown>
    expect(gate.code).toBe('verify_worktree_cleanup_failed')
  })
})
