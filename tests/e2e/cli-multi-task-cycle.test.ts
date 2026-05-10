// M16 C12 — CLI e2e: binary spawn drives DEFINE → PLAN (3 tasks) →
// BUILD/VERIFY/REVIEW × 3 → ship using `bun run src/cli.ts` only.
//
// This is the milestone-level proof that the M16 dispatch surface
// (C6 dispatchBuild, C7 dispatchVerify, C8 dispatchReview, C9 task-loop
// dispatch + review-remediation pre-route + cursor-aware approve, C10
// doctor run, C11 fake-provider banner) ALL compose end-to-end via the
// CLI binary. Per L4 in docs/design/SESSION_M16_KICKOFF.md, the test
// MUST spawn the binary — direct imports of dispatchers replicate the
// test omission that hid the M7-M15 CLI gap.
//
// Codex pre-design review pinned 4 block-push + 5 fix-soon + 1 nit
// modifications. They are documented in tests/e2e/helpers/multi-task-cli.ts
// and applied throughout this file. See the helper module for closure
// detail per Mod #.
//
// Coverage map (Codex Mod #8):
//   T-001 happy: BUILD attempt 1 → VERIFY pass → REVIEW round 1 ready → approve.
//   T-002 needs-revision-restart:
//     BUILD attempt 1 → VERIFY pass → REVIEW round 1 needs-revision
//     → review_remediation_recorded fires
//     → next `code-oz run` routes to BUILD attempt 2 (review-remediation
//        pre-route, src/commands/run.ts:825-857)
//     → VERIFY attempt 2 pass → REVIEW round 2 ready → approve.
//   T-003 happy: BUILD attempt 1 → VERIFY pass → REVIEW round 1 ready → approve
//     → cursor.allCompleted=true → phase_entered(ship).
//
// Stop conditions enforced upstream by the worktree wrapper, the lock
// primitive, and the dispatchers; this test asserts the integrated
// behaviour, not the unit-level stop conditions.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildBuilderEntry,
  buildReviewerEntry,
  buildScientistEntry,
  buildVerifierEntry,
  BA_READY_REPLY,
  PLAN_RESPONSE,
  findDanglingLocks,
  readActiveRunId,
  readCurrentJson,
  readEventsRaw,
  rmTmp,
  runCli,
  runDirFor,
  setupMultiTaskProject,
  writeFakeScript,
  type CliResult,
  type FakeScriptEntryLiteral,
  type MultiTaskProject,
  type RawEvent,
} from './helpers/multi-task-cli.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'

// --- preflight -----------------------------------------------------

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('M16 C12 e2e requires git >= 2.40 on PATH')
  }
})

let project: MultiTaskProject
let scriptCounter = 0

beforeEach(async () => {
  project = await setupMultiTaskProject()
  scriptCounter = 0
})

// Codex Mod #4 — `withLock` only removes the dir in finally
// (src/state/lock.ts:26). Killed subprocesses leave .build.lock /
// .verify.lock / .review.lock behind; rm -rf the project on every
// teardown so the next test starts clean. The success-path
// no-dangling-lock assertion lives inside the test.
afterEach(async () => {
  if (project !== undefined) {
    await rmTmp(project.tmpRoot)
  }
})

// --- spawn helper --------------------------------------------------

interface SpawnContext {
  readonly label: string
  readonly script: readonly FakeScriptEntryLiteral[]
  readonly args: readonly string[]
  /** When set, override the default --provider fake / --fake-script flags. */
  readonly skipFakeProvider?: boolean
}

/**
 * Run a single CLI invocation with the given fake-script and assert the
 * exit code. Each invocation gets its own JSONL file at
 * `<scriptDir>/<NN>-<label>.jsonl` so failures are traceable.
 *
 * Codex Mod #2 — per-spawn JSONL is mandatory because FakeMatch only
 * supports phase + agent. Tests CANNOT pass three different BUILDER
 * responses through a single static fixture: the FIFO queue would
 * dequeue T-001's body for T-002's BUILD spawn (a fresh FakeProvider
 * per process resets the queue).
 */
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

// --- the e2e test --------------------------------------------------

describe('M16 C12 — CLI multi-task lifecycle (binary spawn)', () => {
  test(
    'drives DEFINE → PLAN (3 tasks) → BUILD/VERIFY/REVIEW × 3 → ship via CLI alone',
    async () => {
      // ===============================================================
      // 1. DEFINE — single BA turn with <spec-ready/> in the reply.
      //    --request supplies turn 0; stdin is closed (`stdin: 'ignore'`)
      //    so subsequent turns return null which ask-me treats as EOF.
      // ===============================================================
      const defineResult = await dispatch(0, {
        label: 'define',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'Add identity stamps to alpha, beta, and gamma helpers.'],
      })
      expect(defineResult.stdout).toContain('DEFINE phase complete')
      // Codex Mod #11 (nit): banner fires once per `code-oz run` with
      // --provider fake. Assert banner text on the DEFINE spawn (every
      // spawn surfaces it; one assertion is enough).
      expect(defineResult.stderr).toContain('--provider fake is active')

      const runId = await readActiveRunId(project.stateDir)

      // approve define (no fake-script needed; approve does not invoke
      // a provider). Always succeeds with explicit phase argument.
      await dispatch(0, {
        label: 'approve-define',
        script: [],
        args: ['approve', 'define'],
        skipFakeProvider: true,
      })

      // ===============================================================
      // 2. PLAN — lead writes PLAN.md (3 tasks) + SOURCE_CHECK.md;
      //    scientist tail emits HYPOTHESES + OPEN_QUESTIONS.
      // ===============================================================
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

      // ===============================================================
      // 3. T-001 cycle — happy path: BUILD attempt 1 → VERIFY → REVIEW
      //    round 1 ready → approve. Cursor advances to T-002.
      // ===============================================================
      await dispatch(0, {
        label: 't1-build',
        script: [
          buildBuilderEntry('T-001', 1),
          buildScientistEntry('build'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't1-approve-build',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't1-verify',
        script: [
          buildVerifierEntry(),
          buildScientistEntry('verify'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't1-approve-verify',
        script: [],
        args: ['approve', 'verify'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't1-review',
        script: [
          buildReviewerEntry('ready'),
          buildScientistEntry('review'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't1-approve-review',
        script: [],
        args: ['approve', 'review'],
        skipFakeProvider: true,
      })

      // After T-001 approve-review: phase_entered(ship) MUST NOT yet
      // have fired (cursor.allCompleted=false; T-002 + T-003 still
      // pending). currentPhase stays at 'review' for the next task.
      const eventsAfterT1 = await readEventsRaw(project.stateDir, runId)
      expect(eventsAfterT1.some((e) => e.type === 'phase_entered' && e.phase === 'ship')).toBe(false)
      const t1Completed = eventsAfterT1.filter(
        (e) => e.type === 'task_completed' && e.taskId === 'T-001',
      )
      expect(t1Completed.length).toBe(1)

      // ===============================================================
      // 4. T-002 cycle — needs-revision restart. Round 1 → needs_revision
      //    (exits 1 per Mod #4 in C8) → next `code-oz run` routes to
      //    BUILD attempt 2 via review-remediation pre-route → VERIFY 2
      //    → REVIEW round 2 ready → approve. Cursor advances to T-003.
      // ===============================================================
      await dispatch(0, {
        label: 't2-build-a1',
        script: [
          buildBuilderEntry('T-002', 1),
          buildScientistEntry('build'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't2-approve-build-a1',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't2-verify-a1',
        script: [
          buildVerifierEntry(),
          buildScientistEntry('verify'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't2-approve-verify-a1',
        script: [],
        args: ['approve', 'verify'],
        skipFakeProvider: true,
      })
      // Round 1 returns needs_revision — exit code 1 per
      // exitCodeForPhaseResult (src/cli/exit-codes.ts).
      await dispatch(1, {
        label: 't2-review-r1',
        script: [
          buildReviewerEntry('needs-revision'),
          buildScientistEntry('review'),
        ],
        args: ['run'],
      })
      // Verify the review_remediation_recorded event fired.
      const eventsAfterT2R1 = await readEventsRaw(project.stateDir, runId)
      const t2Remediation = eventsAfterT2R1.filter(
        (e) =>
          e.type === 'review_remediation_recorded' &&
          e.taskId === 'T-002' &&
          e.remediationIntent === 'continue',
      )
      expect(t2Remediation.length).toBe(1)
      expect(t2Remediation[0]!.attempt).toBe(1)
      expect(t2Remediation[0]!.reviewRound).toBe(1)
      expect(t2Remediation[0]!.nextReviewRound).toBe(2)

      // Next `code-oz run` enters review branch but pre-routes to
      // dispatchBuild for T-002 attempt 2 (M16 C9 Mod #7).
      await dispatch(0, {
        label: 't2-build-a2-via-route',
        script: [
          buildBuilderEntry('T-002', 2),
          buildScientistEntry('build'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't2-approve-build-a2',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't2-verify-a2',
        script: [
          buildVerifierEntry(),
          buildScientistEntry('verify'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't2-approve-verify-a2',
        script: [],
        args: ['approve', 'verify'],
        skipFakeProvider: true,
      })
      // Round 2: ready (the previously raised F-001 is marked resolved).
      await dispatch(0, {
        label: 't2-review-r2',
        script: [
          buildReviewerEntry('round2-ready'),
          buildScientistEntry('review'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't2-approve-review',
        script: [],
        args: ['approve', 'review'],
        skipFakeProvider: true,
      })

      const eventsAfterT2 = await readEventsRaw(project.stateDir, runId)
      expect(eventsAfterT2.some((e) => e.type === 'phase_entered' && e.phase === 'ship')).toBe(false)
      const t2Completed = eventsAfterT2.filter(
        (e) => e.type === 'task_completed' && e.taskId === 'T-002',
      )
      expect(t2Completed.length).toBe(1)

      // ===============================================================
      // 5. T-003 cycle — happy path. Last task: cursor.allCompleted
      //    becomes true on approve-review and phase_entered(ship) fires.
      // ===============================================================
      await dispatch(0, {
        label: 't3-build',
        script: [
          buildBuilderEntry('T-003', 1),
          buildScientistEntry('build'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't3-approve-build',
        script: [],
        args: ['approve', 'build'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't3-verify',
        script: [
          buildVerifierEntry(),
          buildScientistEntry('verify'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't3-approve-verify',
        script: [],
        args: ['approve', 'verify'],
        skipFakeProvider: true,
      })
      await dispatch(0, {
        label: 't3-review',
        script: [
          buildReviewerEntry('ready'),
          buildScientistEntry('review'),
        ],
        args: ['run'],
      })
      await dispatch(0, {
        label: 't3-approve-review',
        script: [],
        args: ['approve', 'review'],
        skipFakeProvider: true,
      })

      // ===============================================================
      // 6. Ship oracle (Codex Mod #5):
      //    a. current.json.currentPhase === 'ship'
      //    b. exactly 3 task_completed events in PLAN order T-001/2/3
      //    c. exactly 1 phase_entered(ship) event
      // ===============================================================
      const current = await readCurrentJson(project.stateDir, runId)
      expect(current.currentPhase).toBe('ship')

      const finalEvents = await readEventsRaw(project.stateDir, runId)
      const taskCompleted = finalEvents.filter((e) => e.type === 'task_completed')
      expect(taskCompleted.length).toBe(3)
      expect(taskCompleted.map((e) => e.taskId)).toEqual(['T-001', 'T-002', 'T-003'])

      const shipEntered = finalEvents.filter(
        (e) => e.type === 'phase_entered' && e.phase === 'ship',
      )
      expect(shipEntered.length).toBe(1)

      // ===============================================================
      // 7. Coverage assertions for the C8/C9/C10/C11 surfaces.
      // ===============================================================

      // C9 cursor — 3 task_started events, one per task (attempt 1 only
      // per src/commands/run.ts:1185-1196 dispatchBuild Codex Mod #5).
      // T-002's attempt 2 build does NOT emit a second task_started.
      const taskStarted = finalEvents.filter((e) => e.type === 'task_started')
      expect(taskStarted.length).toBe(3)
      expect(taskStarted.map((e) => e.taskId)).toEqual(['T-001', 'T-002', 'T-003'])

      // C9 task_review_passed — emitted in approveReviewTaskGate per
      // task. 3 total (last successful round per task: T-001 round 1,
      // T-002 round 2, T-003 round 1).
      const taskReviewPassed = finalEvents.filter((e) => e.type === 'task_review_passed')
      expect(taskReviewPassed.length).toBe(3)
      const t1Pass = taskReviewPassed.find((e) => e.taskId === 'T-001')
      const t2Pass = taskReviewPassed.find((e) => e.taskId === 'T-002')
      const t3Pass = taskReviewPassed.find((e) => e.taskId === 'T-003')
      expect((t1Pass as RawEvent & { finalRound: number }).finalRound).toBe(1)
      expect((t2Pass as RawEvent & { finalRound: number }).finalRound).toBe(2)
      expect((t3Pass as RawEvent & { finalRound: number }).finalRound).toBe(1)

      // C8 + C9 — review_remediation_recorded for T-002 round 1 only.
      const allRemediation = finalEvents.filter(
        (e) => e.type === 'review_remediation_recorded',
      )
      expect(allRemediation.length).toBe(1)
      expect(allRemediation[0]!.taskId).toBe('T-002')

      // C9 worktree task-boundary recreate — worktree_destroyed fires on
      // every approve-review (3 total, one per task). worktree_created
      // fires on first BUILD per task (3 total: T-001 first build,
      // T-002 first build, T-003 first build); attempt 2 within T-002
      // shares the in-flight worktree (the previous approve-review for
      // T-001 destroyed it; T-002's first BUILD re-created; attempt 2
      // is idempotent — already-existing worktree path).
      const worktreeDestroyed = finalEvents.filter(
        (e) => e.type === 'worktree_destroyed' && e.phase === 'review',
      )
      expect(worktreeDestroyed.length).toBe(3)

      // C11 — fake-provider warning event recorded exactly once per
      // `code-oz run` invocation that uses --provider fake. We dispatched
      // 14 such spawns:
      //   1 define + 1 plan
      //   T-001: 3 (build, verify, review)
      //   T-002: 6 (build-a1, verify-a1, review-r1, build-a2, verify-a2, review-r2)
      //   T-003: 3 (build, verify, review)
      // The non-`run` commands (init, approve, doctor) do NOT emit this
      // event because banner+event live inside runCommand.
      const fakeWarnings = finalEvents.filter(
        (e) => e.type === 'fake_provider_warning_emitted',
      )
      expect(fakeWarnings.length).toBe(14)
      expect(fakeWarnings.every((e) => e.providerAlias === 'fake')).toBe(true)

      // Codex Mod #10 (nit) — manual debate-policy mode is the default
      // (src/config/schema.ts:214); scheduler skips at
      // src/policy/debate-scheduler.ts:197. NO debate_scheduler_fired
      // event should appear in events.jsonl.
      const debateFired = finalEvents.filter(
        (e) => e.type === 'debate_scheduler_fired',
      )
      expect(debateFired.length).toBe(0)

      // ===============================================================
      // 8. Codex Mod #4 — success-path NO-DANGLING-LOCK assertion.
      //    src/state/lock.ts:26 only removes the lock dir in finally;
      //    a successful run must release every phase lock. Catches
      //    subtle bugs where a happy path leaks a lock dir.
      // ===============================================================
      const dangling = await findDanglingLocks(project.projectRoot)
      expect(dangling).toEqual([])

      // ===============================================================
      // 9. Gate files — every approve-* writes a GATE_<PHASE>_PASSED.json
      //    under <runDir>/. After ship, all six gates must exist (define,
      //    plan, build, verify, review — per-phase gates accumulate;
      //    review's gate is for the last task because the gate file is
      //    overwritten as new tasks are approved).
      // ===============================================================
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
