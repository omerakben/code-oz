// M16 R1 fix-first 5/6 — VERIFY-fail restart e2e variant.
//
// Codex flagged this as a critical coverage gap: the C12 e2e
// (cli-multi-task-cycle.test.ts) drives the happy path and the
// review-needs-revision restart, but never the verify-fail restart.
// The verify-fail restart path is structurally distinct because:
//
//   - VERIFY emits `verify_failed` (not `review_needs_revision`).
//   - scheduleAttemptNPlus1 destroys the worktree (review-restart
//     preserves it).
//   - The next `code-oz run` routes via `shouldRouteToBuildRestart`
//     (verify-helpers), not `shouldRouteReviewToBuildRestart`
//     (review-helpers).
//   - The carry-forward block carries a verifier-authored constraint
//     and a forensicsPath, NOT a reviewer's findings list.
//
// Coverage:
//   - T-001 BUILD attempt 1 → VERIFY attempt 1 returns FAILED →
//     `worktree_destroyed` + `verify_restart_initiated` events.
//   - Next `code-oz run` routes via shouldRouteToBuildRestart →
//     dispatchBuild attempt 2 → fresh worktree (NOT a delta on
//     attempt 1's worktree — verify-fail restart destroys it).
//   - VERIFY attempt 2 passes → REVIEW round 1 ready → approve.
//
// Mirrors the C12 shape: per-spawn JSONL via `dispatch()`, Bun.spawn
// for the binary, success-path no-dangling-lock assertion.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  findDanglingLocks,
  readActiveRunId,
  readCurrentJson,
  readEventsRaw,
  rmTmp,
  runCli,
  runDirFor,
  writeFakeScript,
  type CliResult,
  type FakeScriptEntryLiteral,
  type RawEvent,
} from './helpers/multi-task-cli.ts'
import {
  BA_READY_REPLY,
  PLAN_RESPONSE,
  buildBuilderEntry,
  buildReviewerEntry,
  buildScientistEntry,
  buildVerifierEntry,
  setupVerifyFailProject,
  type VerifyFailProject,
} from './helpers/verify-fail-cli.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('M16 R1 verify-fail e2e requires git >= 2.40 on PATH')
  }
})

let project: VerifyFailProject
let scriptCounter = 0

beforeEach(async () => {
  project = await setupVerifyFailProject()
  scriptCounter = 0
})

afterEach(async () => {
  if (project !== undefined) {
    await rmTmp(project.tmpRoot)
  }
})

interface SpawnContext {
  readonly label: string
  readonly script: readonly FakeScriptEntryLiteral[]
  readonly args: readonly string[]
  readonly skipFakeProvider?: boolean
}

async function dispatch(
  expectedExit: number,
  ctx: SpawnContext,
): Promise<CliResult> {
  scriptCounter += 1
  const filename = `${String(scriptCounter).padStart(2, '0')}-${ctx.label}.jsonl`
  const scriptPath = join(project.scriptDir, filename)
  await writeFakeScript(scriptPath, ctx.script)

  const args = ctx.skipFakeProvider
    ? ctx.args
    : [...ctx.args, '--provider', 'fake', '--fake-script', scriptPath]
  const result = await runCli(project.projectRoot, args)
  if (result.exitCode !== expectedExit) {
    throw new Error(
      `dispatch ${ctx.label}: expected exit ${expectedExit}, got ${result.exitCode}\n` +
        `args=${JSON.stringify(args)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

describe('M16 R1 fix-first — CLI VERIFY-fail restart cycle', () => {
  test(
    'drives DEFINE → PLAN → BUILD a1 → VERIFY a1 (fail) → BUILD a2 → VERIFY a2 → REVIEW → ship via CLI alone',
    async () => {
      // 1. DEFINE
      await dispatch(0, {
        label: 'define',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'Stamp alpha and make verify pass.'],
      })
      const runId = await readActiveRunId(project.stateDir)
      await dispatch(0, {
        label: 'approve-define',
        script: [],
        args: ['approve', 'define'],
        skipFakeProvider: true,
      })

      // 2. PLAN
      await dispatch(0, {
        label: 'plan',
        script: [
          {
            matcher: { phase: 'plan', agent: 'lead' },
            response: { content: PLAN_RESPONSE },
          },
          buildScientistEntry('plan'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 'approve-plan',
        script: [],
        args: ['approve', 'plan'],
        skipFakeProvider: true,
      })

      // 3. BUILD attempt 1
      await dispatch(0, {
        label: 'build-a1',
        script: [buildBuilderEntry(1), buildScientistEntry('build')],
        args: ['run'],
      })
      await dispatch(0, {
        label: 'approve-build-a1',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })

      // 4. VERIFY attempt 1 — verify-script.sh exits 1, runner
      //    classifies fail, persona authors fail-shape VERIFY.md,
      //    scheduleAttemptNPlus1 emits worktree_destroyed +
      //    verify_restart_initiated. Exit code 1 (intervention).
      await dispatch(1, {
        label: 'verify-a1-fail',
        script: [buildVerifierEntry('fail'), buildScientistEntry('verify')],
        args: ['run'],
      })

      // Verify the failure-side event sequence.
      const eventsAfterA1 = await readEventsRaw(project.stateDir, runId)
      const verifyFailedA1 = eventsAfterA1.filter(
        (e) => e.type === 'verify_failed' && e.taskId === 'T-001',
      )
      expect(verifyFailedA1.length).toBe(1)
      expect(verifyFailedA1[0]!.attempt).toBe(1)

      const worktreeDestroyedA1 = eventsAfterA1.filter(
        (e) => e.type === 'worktree_destroyed' && e.phase === 'verify',
      )
      expect(worktreeDestroyedA1.length).toBe(1)

      const restartA1 = eventsAfterA1.filter(
        (e) => e.type === 'verify_restart_initiated' && e.taskId === 'T-001',
      )
      expect(restartA1.length).toBe(1)
      expect(restartA1[0]!.attempt).toBe(1)
      // Locked next-action under the 4-attempt cap is restart.
      expect((restartA1[0]! as RawEvent & { nextAction?: string }).nextAction).toBe('restart')
      expect((restartA1[0]! as RawEvent & { nextAttempt?: number }).nextAttempt).toBe(2)

      // 5. Next `code-oz run` routes via shouldRouteToBuildRestart →
      //    dispatchBuild attempt 2. The new BUILD recreates the
      //    worktree from base; the patch flips verify-script.sh to
      //    `exit 0`.
      await dispatch(0, {
        label: 'build-a2-via-route',
        script: [buildBuilderEntry(2), buildScientistEntry('build')],
        args: ['run'],
      })
      await dispatch(0, {
        label: 'approve-build-a2',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })

      // 6. VERIFY attempt 2 — verify-script.sh now exits 0 (attempt 2's
      //    patch flipped it). Persona authors pass-shape VERIFY.md.
      await dispatch(0, {
        label: 'verify-a2-pass',
        script: [buildVerifierEntry('pass'), buildScientistEntry('verify')],
        args: ['run'],
      })
      await dispatch(0, {
        label: 'approve-verify-a2',
        script: [],
        args: ['approve', 'verify'],
        skipFakeProvider: true,
      })

      // 7. REVIEW round 1 ready → approve.
      await dispatch(0, {
        label: 'review',
        script: [buildReviewerEntry(), buildScientistEntry('review')],
        args: ['run'],
      })
      await dispatch(0, {
        label: 'approve-review',
        script: [],
        args: ['approve', 'review'],
        skipFakeProvider: true,
      })

      // 8. Ship oracle.
      const current = await readCurrentJson(project.stateDir, runId)
      expect(current.currentPhase).toBe('ship')

      const finalEvents = await readEventsRaw(project.stateDir, runId)
      const taskCompleted = finalEvents.filter((e) => e.type === 'task_completed')
      expect(taskCompleted.length).toBe(1)
      expect(taskCompleted[0]!.taskId).toBe('T-001')

      const shipEntered = finalEvents.filter(
        (e) => e.type === 'phase_entered' && e.phase === 'ship',
      )
      expect(shipEntered.length).toBe(1)

      // 9. Restart-signal coverage: exactly one verify_failed + one
      //    verify_restart_initiated for T-001 attempt 1; verify_completed
      //    fires for attempt 2.
      const verifyFailedAll = finalEvents.filter((e) => e.type === 'verify_failed')
      expect(verifyFailedAll.length).toBe(1)
      const verifyCompletedAll = finalEvents.filter((e) => e.type === 'verify_completed')
      expect(verifyCompletedAll.length).toBe(1)
      expect(verifyCompletedAll[0]!.attempt).toBe(2)

      // 10. BUILD attempt 2's worktree is FRESH (verify-fail restart
      //     destroys + recreates). The audit trail must show:
      //     - worktree_created (initial, attempt 1's BUILD)
      //     - worktree_destroyed (verify-fail teardown)
      //     - worktree_created (attempt 2's BUILD on fresh worktree)
      //     - worktree_destroyed (post-approve-review cleanup)
      const worktreeCreatedAll = finalEvents.filter(
        (e) => e.type === 'worktree_created',
      )
      expect(worktreeCreatedAll.length).toBe(2)
      const worktreeDestroyedAll = finalEvents.filter(
        (e) => e.type === 'worktree_destroyed',
      )
      expect(worktreeDestroyedAll.length).toBe(2)

      // 11. task_started idempotency (R1 finding 5): exactly one
      //     task_started across both attempts. Attempt 2 dispatches
      //     fresh BUILD but does NOT re-emit task_started.
      const taskStartedAll = finalEvents.filter((e) => e.type === 'task_started')
      expect(taskStartedAll.length).toBe(1)
      expect(taskStartedAll[0]!.taskId).toBe('T-001')

      // 12. No dangling locks on the success path (.worktree.lock
      //     included in the audit set as of R1 finding 2).
      const dangling = await findDanglingLocks(project.projectRoot)
      expect(dangling).toEqual([])

      // 13. Final gate files present.
      const runDir = runDirFor(project.stateDir, runId)
      for (const gateFile of [
        'GATE_DEFINE_PASSED.json',
        'GATE_PLAN_PASSED.json',
        'GATE_BUILD_PASSED.json',
        'GATE_VERIFY_PASSED.json',
        'GATE_REVIEW_PASSED.json',
      ]) {
        expect(existsSync(join(runDir, gateFile))).toBe(true)
      }
    },
    120_000,
  )
})
