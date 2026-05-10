// CLI task-loop dispatch tests (M16 C9).
//
// C9 lands the glue between approve-review and the per-task BUILD/VERIFY/REVIEW
// loop. The state-machine reducer is unchanged (M16 L1); multi-task semantics
// live in event projection. The two surface points exercised here:
//
//   - `approveReviewTaskGate` (state primitive): atomically writes
//     GATE_REVIEW_PASSED.json + appends task_completed for the just-approved
//     task, and ONLY appends phase_entered(ship) when every PLAN task is
//     complete (the cursor decides). All under one per-run lock.
//
//   - `shouldRouteReviewToBuildRestart` + cursor-based BUILD pre-route in
//     `handleActiveRun`: when `currentPhase: 'review'` but the cursor's
//     pending task is not_started (next task) OR a remediation event with
//     no follow-up build_started exists (same task, attempt N+1), the
//     run dispatches BUILD instead of looping into REVIEW.
//
// Codex C9 pre-design review (7 block-push + 2 fix-soon + 1 nit) pinned
// these load-bearing concerns the helpers + primitive implement:
//
//   1. task_completed sourced from review_resolved (canonical ready
//      signal), not review_round_completed (per-round outcome).
//   2. phase_entered(ship) ONLY when cursor.allCompleted=true.
//   3. task_completed emission is idempotent under the lock.
//   4. The transaction lives inside the locked primitive — concurrent
//      `code-oz run` cannot observe gate file before task event.
//   5. dispatchBuild remains the sole task_started emitter for N+1.
//   6. Worktree task-boundary recreation lives in load-or-create
//      wrapper (separate test file).
//   7. handleActiveRun has a review-remediation pre-route (extends C7
//      pattern for verify_restart).
//   8. PLAN.md drift refusal before any state change (cursor-driven).
//   9. Defense-in-depth review_resolved assertion in approve primitive.
//  10. Cursor stays a pure projection — only a read-only helper added.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import {
  approveGate,
  approveReviewTaskGate,
  ApproveReviewTaskGateError,
  initRun,
  loadRun,
  requireGate,
  runPathsFor,
  type RunPaths,
} from '../src/state/run.ts'
import type { GateFile } from '../src/state/schemas.ts'
import { writeGate } from '../src/state/gates.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { appendEvent, readEvents } from '../src/state/events.ts'
import { isKnownPhaseEvent, type LoggedEvent, type Phase } from '../src/state/schemas.ts'
import { parsePlan } from '../src/artifacts/plan.ts'
import {
  serializeReviewReport,
  type ReviewReportData,
} from '../src/artifacts/review-report.ts'
import {
  serializeBuildReport,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'
import {
  findLatestReviewResolved,
  projectTaskCursor,
} from '../src/state/task-cursor.ts'
import {
  shouldRouteReviewToBuildRestart,
} from '../src/commands/dispatch-review-helpers.ts'
import { emitPhaseEnteredBuildIfNeeded } from '../src/commands/run.ts'
import {
  clearStaleGateFile,
  resolveBuildCarryForward,
} from '../src/commands/dispatch-build-helpers.ts'

const FIXED_TS = '2026-05-09T12:00:00.000Z'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

const PLAN_TXT = `# PLAN

## Goals

- Two atomic slices.
- Each independently testable.

## Tasks

### T-001: first slice

- Files: src/foo.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

### T-002: second slice

- Files: src/bar.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Anything beyond the two slices.

## Open questions

- None known at plan time.
`

const PLAN_TXT_SINGLE = `# PLAN

## Goals

- One atomic slice.

## Tasks

### T-001: only slice

- Files: src/foo.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Anything beyond the one slice.

## Open questions

- None known at plan time.
`

let tmp: string
let stateDir: string
let artifactRoot: string
let runPaths: RunPaths

const SHA = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex')

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c9-'))
  stateDir = join(tmp, 'state')
  artifactRoot = join(tmp, 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  runPaths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(runPaths.runDir, { recursive: true })
  // Do NOT pre-create runPaths.lockDir — withLock uses mkdir-as-lock-file,
  // so a pre-existing directory at lockDir means "lock held". The dir is
  // created and removed transparently by withLock during initRun and
  // every subsequent locked operation.
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// --- shared fixtures ----------------------------------------------

async function initFreshRun(): Promise<void> {
  await initRun({
    paths: runPaths,
    profile: 'greenfield',
    runId: RUN,
    now: () => FIXED_TS,
  })
}

async function appendReviewResolved(taskId: string, attempt: number, sha: string): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'review_resolved',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId,
      finalRound: 1,
      finalScore: 8,
      reviewReportSha256: sha,
    },
  )
}

async function appendReviewPanelCompletedReady(
  taskId: string,
  attempt: number,
  sha: string,
): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'review_panel_completed',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId,
      finalRound: 1,
      panelVerdict: 'ready',
      reviewReportSha256: sha,
      eligibleVoterFamilies: ['claude', 'codex'],
      panelistCount: 2,
      voterCount: 2,
      advisoryCount: 0,
    },
  )
}

async function appendReviewRemediation(
  taskId: string,
  attempt: number,
  reviewRound: number,
  nextReviewRound: number,
): Promise<void> {
  const sha = 'b'.repeat(64)
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'review_remediation_recorded',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId,
      reviewRound,
      nextReviewRound,
      decisionId: generateUlid({ now: 1_000_000_000_000 + attempt, random: new Uint8Array(10) }),
      reviewMdSha256: sha,
      remediationIntent: 'continue',
      refsTo: { type: 'review_round_completed', reviewReportSha256: sha },
    },
  )
}

async function appendBuildStarted(taskId: string, attempt: number, taskIndex: number): Promise<void> {
  // build_started carries baseCommitSha; appendEvent validates it.
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'build_started',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'build',
      agent: 'builder',
      attempt,
      baseCommitSha: 'a'.repeat(40),
      taskId,
    },
  )
  // task_started co-emitted by dispatchBuild for attempt 1; mirror that
  // for the cursor projection.
  if (attempt === 1) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_started',
        ts: FIXED_TS,
        runId: RUN,
        taskId,
        taskIndex,
      },
    )
  }
}

async function setupReviewReadyForTask(opts: {
  taskId: string
  attempt: number
  reviewSha: string
}): Promise<void> {
  // The approve primitive needs:
  //   - PLAN.md on disk
  //   - REVIEW.md on disk (the canonical artifact at <artifactRoot>/REVIEW.md)
  //   - gate_required(review) event present
  //   - review_resolved or review_panel_completed event for (taskId, attempt)
  //
  // We don't write REVIEW.md here because the approve primitive reads
  // it via the gate writer's sha-of-artifact step. The gate-write path
  // requires the canonical artifact to exist at the recorded path.
  await writeFile(join(artifactRoot, 'REVIEW.md'), opts.reviewSha + '\n', 'utf8')
  // Re-derive the actual sha of what we wrote.
  const actual = SHA(opts.reviewSha + '\n')
  await appendReviewResolved(opts.taskId, opts.attempt, actual)
  await requireGate({
    paths: runPaths,
    runId: RUN,
    phase: 'review',
    blockedOn: 'test fixture',
  })
}

function makeReviewGate(_taskId: string): {
  readonly version: 1
  readonly runId: string
  readonly phase: 'review'
  readonly artifact: string
  readonly agent: string
  readonly agentProvider: string
  readonly approvedBy: string
  readonly approvedAt: string
} {
  return {
    version: 1,
    runId: RUN,
    phase: 'review',
    artifact: 'REVIEW.md',
    agent: 'reviewer',
    agentProvider: 'fake',
    approvedBy: 'test',
    approvedAt: FIXED_TS,
  }
}

// --- approveReviewTaskGate: Mod #1 (review_resolved sourcing) -------

describe('approveReviewTaskGate — Mod #1: task_completed sourced from review_resolved', () => {
  test('emits task_completed when matching review_resolved exists', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    expect(result.gateExisted).toBe(false)
    expect(result.taskCompletedExisted).toBe(false)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const taskCompleted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_completed')
    expect(taskCompleted).toHaveLength(1)
    if (taskCompleted[0]?.type !== 'task_completed') return
    expect(taskCompleted[0].taskId).toBe('T-001')
    expect(taskCompleted[0].taskIndex).toBe(0)
    expect(taskCompleted[0].reviewGatePath).toContain('GATE_REVIEW_PASSED.json')
  })

  test('panel-mode review_panel_completed (panelVerdict=ready) is accepted as fallback', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'panel body\n', 'utf8')
    const sha = SHA('panel body\n')
    await appendReviewPanelCompletedReady('T-001', 1, sha)
    await requireGate({ paths: runPaths, runId: RUN, phase: 'review', blockedOn: 'test fixture' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    expect(result.taskCompletedExisted).toBe(false)
  })

  test('throws ApproveReviewTaskGateError when no review_resolved or panel-ready event exists', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'fixture body\n', 'utf8')
    await requireGate({ paths: runPaths, runId: RUN, phase: 'review', blockedOn: 'test fixture' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    let caught: Error | undefined
    try {
      await approveReviewTaskGate({
        paths: runPaths,
        gate: makeReviewGate('T-001'),
        profile: 'greenfield',
        plan,
        upstreamAttempt: 1,
        upstreamTaskId: 'T-001',
        now: () => FIXED_TS,
      })
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeInstanceOf(ApproveReviewTaskGateError)
    expect((caught as ApproveReviewTaskGateError).code).toBe('review_resolved_event_missing')
  })
})

// --- approveReviewTaskGate: Mod #2 (cursor decides ship) -----------

describe('approveReviewTaskGate — Mod #2: cursor decides phase_entered(ship|build)', () => {
  test('mid-PLAN approval (T-001 of T-001+T-002): NO phase_entered(ship); phase_entered(build) emitted for next task; currentPhase=build', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    // Walk the FSM from define → plan → build → verify → review BEFORE approve-review
    // by emitting the transition events the regression already exercises.
    // For C9 we simulate the post-VERIFY-pass review-pending state with
    // a minimal event chain. Simplest: set currentPhase=review by the
    // helper sequence that loadRun already supports.
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'fixture body\n', 'utf8')
    const sha = SHA('fixture body\n')
    // Emit the chain explicitly so currentPhase=review.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'define', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'plan' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'plan', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'build' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'build', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'verify' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'verify', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'review' },
    )
    await appendReviewResolved('T-001', 1, sha)
    await requireGate({ paths: runPaths, runId: RUN, phase: 'review', blockedOn: 'test fixture' })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Mod #2: cursor.allCompleted=false → no phase_entered(ship). The
    // iterate half (M16 C9 follow-on (2) Bug 3) emits phase_entered(build)
    // instead so currentPhase advances for the next task's BUILD attempt 1.
    expect(result.nextPhase).toBe('build')
    expect(result.state.currentPhase).toBe('build')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(0)

    // The iterate-half phase_entered(build) for the next task lands AFTER
    // the just-emitted task_completed(T-001). The original BUILD's
    // phase_entered(build) is also still present from the FSM walk.
    const phaseEnteredBuild = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    expect(phaseEnteredBuild.length).toBeGreaterThanOrEqual(2)

    // task_completed for T-001 IS appended.
    const taskCompleted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_completed')
    expect(taskCompleted).toHaveLength(1)
    if (taskCompleted[0]?.type !== 'task_completed') return
    expect(taskCompleted[0].taskId).toBe('T-001')
  })

  test('last-task approval (T-001 of single-task PLAN): emits phase_entered(ship); currentPhase advances to ship', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    expect(result.nextPhase).toBe('ship')
    expect(result.state.currentPhase).toBe('ship')
  })
})

// --- approveReviewTaskGate: Mod #3 (idempotency) -------------------

describe('approveReviewTaskGate — Mod #3: task_completed idempotency under the lock', () => {
  test('second call with same inputs is a no-op for task_completed', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const opts = {
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield' as const,
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    }

    const first = await approveReviewTaskGate(opts)
    expect(first.taskCompletedExisted).toBe(false)

    const second = await approveReviewTaskGate(opts)
    expect(second.taskCompletedExisted).toBe(true)
    expect(second.gateExisted).toBe(true)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const taskCompleted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_completed' && e.taskId === 'T-001')
    expect(taskCompleted).toHaveLength(1)
  })
})

// --- approveReviewTaskGate: Mod #5 (no task_started for N+1) -------

describe('approveReviewTaskGate — Mod #5: never emits task_started for N+1', () => {
  test('after T-001 approval, no task_started(T-002) event is emitted', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const taskStarted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_started')
    // No task_started events at all — dispatchBuild emits them.
    expect(taskStarted).toHaveLength(0)
  })
})

// --- approveReviewTaskGate: Mod #8 (PLAN.md drift refusal) --------

describe('approveReviewTaskGate — Mod #8: PLAN.md drift refusal', () => {
  test('refuses with task_cursor_unknown_id when REVIEW.md upstream taskId is not in current PLAN.md', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-999', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    let caught: Error | undefined
    try {
      await approveReviewTaskGate({
        paths: runPaths,
        gate: makeReviewGate('T-999'),
        profile: 'greenfield',
        plan,
        upstreamAttempt: 1,
        upstreamTaskId: 'T-999',
        now: () => FIXED_TS,
      })
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeInstanceOf(ApproveReviewTaskGateError)
    expect((caught as ApproveReviewTaskGateError).code).toBe('task_cursor_unknown_id')
    // Verify the gate file is NOT written before refusal.
    let gateRead: string | null = null
    try {
      gateRead = await readFile(join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'), 'utf8')
    } catch {
      gateRead = null
    }
    expect(gateRead).toBeNull()
  })

  test('rejects gate with phase != review', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    let caught: Error | undefined
    try {
      await approveReviewTaskGate({
        paths: runPaths,
        gate: { ...makeReviewGate('T-001'), phase: 'build' as const } as never,
        profile: 'greenfield',
        plan,
        upstreamAttempt: 1,
        upstreamTaskId: 'T-001',
        now: () => FIXED_TS,
      })
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    // GateLoadError carries `gate_invalid_phase` in its issues.
    expect(String(caught)).toContain('review')
  })
})

// --- findLatestReviewResolved (Mod #10 helper) --------------------

describe('findLatestReviewResolved — read-only cursor helper', () => {
  test('returns null when no events match', () => {
    expect(findLatestReviewResolved([], RUN, 'T-001', 1)).toBeNull()
  })

  test('returns the latest review_resolved by event order (last-wins)', async () => {
    await initFreshRun()
    await appendReviewResolved('T-001', 1, 'a'.repeat(64))
    await appendReviewResolved('T-001', 1, 'b'.repeat(64))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const result = findLatestReviewResolved(events, RUN, 'T-001', 1)
    expect(result?.reviewReportSha256).toBe('b'.repeat(64))
  })

  test('does not match on different attempt', async () => {
    await initFreshRun()
    await appendReviewResolved('T-001', 1, 'a'.repeat(64))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    expect(findLatestReviewResolved(events, RUN, 'T-001', 2)).toBeNull()
  })

  test('does not match on different runId', async () => {
    await initFreshRun()
    await appendReviewResolved('T-001', 1, 'a'.repeat(64))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const otherRun = generateUlid({ now: 9_000_000_000_000, random: new Uint8Array(10) })
    expect(findLatestReviewResolved(events, otherRun, 'T-001', 1)).toBeNull()
  })
})

// --- shouldRouteReviewToBuildRestart (Mod #7) ---------------------

describe('shouldRouteReviewToBuildRestart — Mod #7: review-remediation → BUILD pre-route', () => {
  test('returns true when latest remediation has no follow-up build_started for attempt N+1', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await appendBuildStarted('T-001', 1, 0)
    await appendReviewRemediation('T-001', 1, 1, 2)

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    expect(shouldRouteReviewToBuildRestart(events, plan, RUN)).toBe(true)
  })

  test('returns false when build_started for attempt N+1 already exists', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await appendBuildStarted('T-001', 1, 0)
    await appendReviewRemediation('T-001', 1, 1, 2)
    await appendBuildStarted('T-001', 2, 0)

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    expect(shouldRouteReviewToBuildRestart(events, plan, RUN)).toBe(false)
  })

  test('returns false when no remediation event exists for the pending task', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await appendBuildStarted('T-001', 1, 0)

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    expect(shouldRouteReviewToBuildRestart(events, plan, RUN)).toBe(false)
  })

  test('returns false when no pending task (all completed)', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    // Append task_completed for the only PLAN task.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_completed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/test/GATE_REVIEW_PASSED.json',
      },
    )

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    expect(shouldRouteReviewToBuildRestart(events, plan, RUN)).toBe(false)
  })
})

// --- resolveBuildCarryForward extension (Mod #8) ------------------

describe('resolveBuildCarryForward — Mod #8: review-needs-revision source', () => {
  test('returns kind=present with source=review-needs-revision when remediation event matches', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')

    // Write minimal-valid REVIEW.md whose sha matches the remediation
    // event's reviewMdSha256 — the resolver re-validates the sha.
    const reviewBody = makeMinimalSingleReviewMd('T-001', 1)
    await writeFile(join(artifactRoot, 'REVIEW.md'), reviewBody, 'utf8')
    const reviewSha = SHA(reviewBody)

    // Write minimal-valid BUILD_REPORT.md so the resolver can read its
    // validation command.
    const buildReportBody = makeMinimalBuildReport()
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), buildReportBody, 'utf8')

    // Append remediation event whose sha matches the on-disk REVIEW.md.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'review_remediation_recorded',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        reviewRound: 1,
        nextReviewRound: 2,
        decisionId: generateUlid({ now: 1_000_000_001_000, random: new Uint8Array(10) }),
        reviewMdSha256: reviewSha,
        remediationIntent: 'continue',
        refsTo: { type: 'review_round_completed', reviewReportSha256: reviewSha },
      },
    )

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const result = await resolveBuildCarryForward({
      events,
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('present')
    if (result.kind !== 'present') return
    expect(result.cf.source).toBe('review-needs-revision')
    expect(result.priorAttempt).toBe(1)
  })

  test('returns kind=drift when REVIEW.md sha does not match remediation event', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    const reviewBody = makeMinimalSingleReviewMd('T-001', 1)
    await writeFile(join(artifactRoot, 'REVIEW.md'), reviewBody, 'utf8')

    // Write BUILD_REPORT.md too so we surface the sha-mismatch path
    // before BUILD_REPORT.md absence (resolver reads sha first).
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), makeMinimalBuildReport(), 'utf8')

    // Remediation event with a deliberately wrong sha.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'review_remediation_recorded',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        reviewRound: 1,
        nextReviewRound: 2,
        decisionId: generateUlid({ now: 1_000_000_002_000, random: new Uint8Array(10) }),
        reviewMdSha256: 'd'.repeat(64),
        remediationIntent: 'continue',
        refsTo: { type: 'review_round_completed', reviewReportSha256: 'd'.repeat(64) },
      },
    )

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const result = await resolveBuildCarryForward({
      events,
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind !== 'drift') return
    expect(result.reason).toContain('post-edit detected')
  })

  test('verify-fail wins over review-remediation when both are present and verify-restart is later', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')

    // Append remediation FIRST, then verify_restart_initiated LATER.
    // Last-wins by file order means verify-restart should be selected.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'review_remediation_recorded',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        reviewRound: 1,
        nextReviewRound: 2,
        decisionId: generateUlid({ now: 1_000_000_003_000, random: new Uint8Array(10) }),
        reviewMdSha256: 'b'.repeat(64),
        remediationIntent: 'continue',
        refsTo: { type: 'review_round_completed', reviewReportSha256: 'b'.repeat(64) },
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'verify_restart_initiated',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'verify',
        taskId: 'T-001',
        attempt: 1,
        nextAction: 'restart',
        nextAttempt: 2,
        forensicsPath: '.code-oz/runs/abc/forensics/1/',
      },
    )

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    // VERIFY.md not on disk → verify-fail path returns kind=drift with the
    // verify-fail reason. Confirms the verify-restart branch was the one
    // taken (otherwise the message would mention REVIEW.md).
    const result = await resolveBuildCarryForward({
      events,
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind !== 'drift') return
    expect(result.reason.toLowerCase()).toContain('verify')
  })
})

// --- atomicity scenario: T-001 → T-002 cursor walk ----------------

describe('multi-task scenario: T-001 approve-review → cursor advances → T-002 BUILD eligible', () => {
  test('cursor pending advances from T-001 to T-002 after approveReviewTaskGate', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const { cursor } = projectTaskCursor(plan, events)
    expect(cursor.pending?.taskId).toBe('T-002')
    expect(cursor.pending?.status).toBe('not_started')
    expect(cursor.allCompleted).toBe(false)
  })

  test('after both T-001 and T-002 are approved: cursor.allCompleted=true; phase_entered(ship) lands; currentPhase=ship', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    // First approval: T-001 with two-task PLAN — mid-PLAN, no ship.
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body T-001' })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const first = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    // Mid-PLAN approval (Bug 3): iterate half emits phase_entered(build).
    expect(first.nextPhase).toBe('build')
    expect(first.state.currentPhase).toBe('build')

    // Now overwrite REVIEW.md for T-002 and emit a fresh review_resolved.
    // Production-flow parity (M16 C9 follow-on Bug 2): the dispatchers
    // call `clearStaleGateFile` at the task boundary to remove the prior
    // task's `GATE_REVIEW_PASSED.json` before the new task's
    // approveReviewTaskGate writes a fresh gate file. We invoke the same
    // helper here instead of a raw rm so the test stays aligned with the
    // production cleanup path.
    const eventsBeforeT002 = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const clearance = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'review',
      events: eventsBeforeT002,
      currentTaskId: 'T-002',
    })
    expect(clearance.cleared).toBe(true)
    expect(clearance.priorTaskId).toBe('T-001')
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'fixture body T-002\n', 'utf8')
    const t002Sha = SHA('fixture body T-002\n')
    await appendReviewResolved('T-002', 1, t002Sha)
    // gate_required for review already exists from the T-001 prereq;
    // it is idempotent so re-calling is a no-op.

    const second = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-002'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-002',
      now: () => FIXED_TS,
    })
    // Last-task approval: cursor.allCompleted=true → ship transition.
    expect(second.nextPhase).toBe('ship')
    expect(second.state.currentPhase).toBe('ship')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const taskCompleted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_completed')
    expect(taskCompleted).toHaveLength(2)
    const taskIds = taskCompleted.map((e) =>
      e.type === 'task_completed' ? e.taskId : '',
    )
    expect(taskIds).toEqual(['T-001', 'T-002'])
    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(1)

    // Mod #5 reconfirmation at the multi-task scope: dispatchBuild is
    // the sole task_started emitter. The primitive emitted ZERO
    // task_started events across both approvals.
    const taskStarted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_started')
    expect(taskStarted).toHaveLength(0)
  })
})

// --- approveReviewTaskGate: Mod #4 (atomicity under one lock) -----

describe('approveReviewTaskGate — Mod #4: gate_written + task_completed appear together (atomic transaction)', () => {
  test('when an event-log read happens after the primitive returns, both gate_written(review) and task_completed are present', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    expect(result.gateExisted).toBe(false)

    // Read events.jsonl after the primitive returns. The lock has been
    // released. Both events MUST be present — concurrent processes
    // never observe a torn intermediate state where the gate file is
    // visible without task_completed in the log.
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const types = new Set(
      events.filter(isKnownPhaseEvent).map((e) => e.type),
    )
    expect(types.has('gate_written')).toBe(true)
    expect(types.has('task_completed')).toBe(true)

    // Gate file is also on disk after the primitive returned.
    const gateText = await readFile(
      join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'),
      'utf8',
    )
    expect(gateText.length).toBeGreaterThan(0)
  })
})

// --- runApprove integration smoke test ----------------------------

describe('runApprove (high-level) — REVIEW path routes through approveReviewTaskGate', () => {
  test('mid-PLAN approve review: result.nextPhase=build; ship not entered; next task BUILD unblocks at runApprove', async () => {
    // We exercise runApprove via the same shape commands-approve.test.ts
    // uses but driving the REVIEW path with the C9 wiring. The setup
    // mirrors state-regression's stageReviewApprovalPrereqs, with two
    // tasks instead of one so the cursor reports allCompleted=false.
    const { initProject } = await import('../src/commands/init.ts')
    const { runApprove } = await import('../src/commands/approve.ts')
    const { appendEvent } = await import('../src/state/events.ts')

    const tmp2 = await mkdtemp(join(tmpdir(), 'code-oz-c9-approve-'))
    try {
      await initProject({ cwd: tmp2 })
      const stateDir2 = join(tmp2, '.code-oz', 'state')
      const artifactRoot2 = join(tmp2, '.code-oz', 'artifacts')
      const paths2 = runPathsFor(stateDir2, artifactRoot2, RUN)
      await mkdir(artifactRoot2, { recursive: true })
      await writeFile(join(artifactRoot2, 'PLAN.md'), PLAN_TXT, 'utf8')
      const reviewBody = makeMinimalSingleReviewMd('T-001', 1)
      await writeFile(join(artifactRoot2, 'REVIEW.md'), reviewBody, 'utf8')
      const reviewSha = SHA(reviewBody)

      await initRun({
        paths: paths2,
        profile: 'greenfield',
        runId: RUN,
        now: () => FIXED_TS,
      })
      // FSM must be at currentPhase='review' for runApprove to bind
      // the review gate. Drive the chain with phase_exited / phase_entered
      // events the regression already exercises.
      const phases = [
        ['define', 'plan'],
        ['plan', 'build'],
        ['build', 'verify'],
        ['verify', 'review'],
      ] as const
      for (const [from, to] of phases) {
        await appendEvent(
          { file: paths2.eventsFile, lockDir: paths2.lockDir },
          { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: from, outcome: 'passed' },
        )
        await appendEvent(
          { file: paths2.eventsFile, lockDir: paths2.lockDir },
          { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: to },
        )
      }
      // build_provider_recorded for preApproveReviewHook's defense
      // check.
      await appendEvent(
        { file: paths2.eventsFile, lockDir: paths2.lockDir },
        {
          version: 1, type: 'build_provider_recorded',
          ts: FIXED_TS, runId: RUN, phase: 'build',
          attempt: 1, taskId: 'T-001',
          provider: 'fake', family: 'fake',
        },
      )
      // review_resolved for the REVIEW.md sha.
      await appendEvent(
        { file: paths2.eventsFile, lockDir: paths2.lockDir },
        {
          version: 1, type: 'review_resolved',
          ts: FIXED_TS, runId: RUN, phase: 'review',
          agent: 'reviewer', attempt: 1, taskId: 'T-001',
          finalRound: 1, finalScore: 8,
          reviewReportSha256: reviewSha,
        },
      )
      // gate_required(review) for the upstream M5 finding-B check.
      await requireGate({
        paths: paths2, runId: RUN, phase: 'review',
        blockedOn: 'test fixture',
        now: () => FIXED_TS,
      })

      const result = await runApprove({
        cwd: tmp2,
        phase: 'review',
        now: () => FIXED_TS,
      })

      expect(result.approved).toBe(true)
      expect(result.phase).toBe('review')
      // Mid-PLAN: cursor.allCompleted=false → no ship transition. The
      // iterate half (M16 C9 follow-on (2) Bug 3) emits
      // phase_entered(build) so currentPhase advances for the next task.
      expect(result.nextPhase).toBe('build')

      // Regression for Bug 3: runApprove for the next task's build phase
      // succeeds because currentPhase is now 'build'. Without the fix,
      // approve.ts:117 rejects with "current phase is 'review', not 'build'".
      const loaded = await loadRun(paths2)
      expect(loaded?.state.currentPhase).toBe('build')
    } finally {
      await rm(tmp2, { recursive: true, force: true })
    }
  })
})

// --- gate_required satisfaction after gate_written ---------------

describe('handleActiveRun-side: gate_required(review) is satisfied by gate_written(review) for task-loop progress', () => {
  test('after approveReviewTaskGate, the gate_written(review) event is appended; gate_required check reads as satisfied', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const knownTypes = events
      .filter(isKnownPhaseEvent)
      .map((e) => e.type)
    // Both gate_required(review) and gate_written(review) must be present;
    // the run.ts gate_required check walks events and resets to false on
    // gate_written so the run does not falsely report "awaiting approval"
    // for a satisfied gate.
    expect(knownTypes).toContain('gate_required')
    expect(knownTypes).toContain('gate_written')
    // The post-approval phase_exited(review) is also present.
    expect(knownTypes).toContain('phase_exited')
    // No phase_entered(ship) (mid-PLAN of two-task plan). The fixture
    // setup uses initFreshRun which only emits phase_entered(define).
    // The iterate-half (Bug 3) appends phase_entered(build) for the next
    // task — so the canonical sequence is ['define', 'build'].
    const phaseEntered = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered')
      .map((e) => (e.type === 'phase_entered' ? e.phase : ''))
    expect(phaseEntered).toEqual(['define', 'build'])
  })
})

// --- minimal artifact builders -----------------------------------

function makeMinimalSingleReviewMd(taskId: string, attempt: number): string {
  const data: ReviewReportData = Object.freeze({
    upstreamRefs: Object.freeze({
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: 'a'.repeat(64),
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256: 'b'.repeat(64),
      taskId,
      attempt,
      baseCommitSha: '0'.repeat(40),
      patchSha256: 'c'.repeat(64),
    }),
    reviewer: Object.freeze({
      providerFamily: 'codex',
      providerId: 'codex',
      modelPolicy: 'any',
      crossFamilyCheck: 'passed' as const,
      buildFamily: 'claude',
    }),
    roundTimeline: Object.freeze([
      Object.freeze({
        round: 1,
        timestamp: FIXED_TS,
        findingsRaised: 0,
        score: 8,
        verdict: 'ready' as const,
      }),
    ]),
    findings: Object.freeze([]),
    score: Object.freeze({
      roundCount: 1,
      finalScore: 8,
      finalVerdict: 'ready' as const,
      exitReason: 'score>=6 + verdict=ready (round 1)',
    }),
    capStatus: Object.freeze({ cap: 4, roundsUsed: 1, capExhausted: false }),
  })
  return serializeReviewReport(data)
}

function makeMinimalBuildReport(): string {
  const data: BuildReportData = Object.freeze({
    task: Object.freeze({
      taskId: 'T-001',
      title: 'minimal fixture for c9',
      planSha: 'd'.repeat(64),
      attempt: 1,
    }),
    base: Object.freeze({
      worktreePath: '.code-oz/runs/abc/worktree/',
      baseCommitSha: 'b'.repeat(40),
      dirtyAtBase: false,
    }),
    patch: Object.freeze({
      patchPath: '.code-oz/runs/abc/patches/T-001-attempt-1.patch',
      patchSha256: 'c'.repeat(64),
      patchBytes: 100,
    }),
    changedFiles: Object.freeze([
      Object.freeze({
        path: 'src/stub.ts',
        sha256: 'a'.repeat(64),
        change: 'added' as const,
      }),
    ]),
    validationCommand: Object.freeze({
      command: 'bun test',
      workingDirectory: '.code-oz/runs/abc/worktree/',
      timeoutMs: 60000,
      expectedExitCode: 0,
    }),
    failureCarryForward: null,
    notes: Object.freeze(['minimal C9 fixture.']),
  })
  return serializeBuildReport(data)
}

// --- M16 C9 follow-on Bug 1: cursor-aware ship transition in -------
// completeIncompleteTransitions (the completion step inside loadRun).

// Minimal phase-event walker that brings the run from `define` to
// `review` so loadRun's reducer derives currentPhase='review'. Mirrors
// the inline walk used in the existing Mod #2 test (line 432-462).
async function walkFsmToReview(): Promise<void> {
  for (const [exit, enter] of [
    ['define', 'plan'] as const,
    ['plan', 'build'] as const,
    ['build', 'verify'] as const,
    ['verify', 'review'] as const,
  ]) {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'phase_exited',
        ts: FIXED_TS,
        runId: RUN,
        phase: exit,
        outcome: 'passed',
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'phase_entered',
        ts: FIXED_TS,
        runId: RUN,
        phase: enter,
      },
    )
  }
}

describe('completeIncompleteTransitions — Bug 1 + Bug 3: cursor-aware review→{ship,build} transition', () => {
  test('mid-PLAN approve-review: subsequent loadRun does NOT auto-fill phase_entered(ship); emits phase_entered(build) for next task instead', async () => {
    // Repro for two related bugs the C12 e2e + C9 follow-on (1)
    // implementation flagged: every `loadRun` after T-001 approve-review
    // walked `gate_written(review)` and (Bug 1) unconditionally appended
    // `phase_entered(ship)` — defeating the C9 task-loop. After Bug 1's
    // initial fix, no transition was emitted at all (Bug 3) and
    // currentPhase stayed at `review`, so `code-oz approve build` for
    // T-002 failed at approve.ts:117. The full fix emits
    // `phase_entered(build)` instead so currentPhase advances.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body T-001',
    })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    expect(result.nextPhase).toBe('build')
    expect(result.state.currentPhase).toBe('build')

    // The fix: loadRun walks gate_written(review), notices the next
    // phase is 'ship', projects the cursor against PLAN.md, and (because
    // cursor.allCompleted is false but cursor.pending exists) emits
    // phase_entered(build) instead of phase_entered(ship).
    const loaded = await loadRun(runPaths)
    expect(loaded).not.toBeNull()
    expect(loaded?.state.currentPhase).toBe('build')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(0)
  })

  test('last-task approve-review: subsequent loadRun honors phase_entered(ship) from approveReviewTaskGate', async () => {
    // Companion: when the cursor IS allCompleted, the ship transition
    // is preserved. The fix only blocks the spurious auto-fill case.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    const loaded = await loadRun(runPaths)
    expect(loaded?.state.currentPhase).toBe('ship')
  })

  test('PLAN.md missing: completion step conservatively skips ship transition', async () => {
    // Guard: when PLAN.md cannot be loaded, the completion step must
    // not crash AND must not blindly append phase_entered(ship). The
    // authority for the ship transition is approveReviewTaskGate; the
    // completion step defers when it cannot project the cursor.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    // Approve via the task primitive — for a single-task PLAN this
    // legitimately enters ship.
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Now remove PLAN.md and re-run loadRun. The state already holds
    // phase_entered(ship); the completion step is idempotent.
    await rm(join(artifactRoot, 'PLAN.md'), { force: true })
    const loaded = await loadRun(runPaths)
    expect(loaded?.state.currentPhase).toBe('ship')
  })

  test('idempotency: a second loadRun after the cursor advances does not retroactively emit duplicate phase_entered(build|ship)', async () => {
    // After T-001 approve-review (mid-PLAN), running loadRun multiple
    // times must not accumulate duplicate phase_entered events nor
    // spuriously emit phase_entered(ship). The iterate-half emission
    // (Bug 3 fix) lands once.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    for (let i = 0; i < 5; i++) {
      const loaded = await loadRun(runPaths)
      expect(loaded?.state.currentPhase).toBe('build')
    }

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(0)

    // Idempotency: walkFsmToReview emits one phase_entered(build) for
    // the original FSM walk. The iterate-half (Bug 3) emits a SECOND
    // one after task_completed(T-001). Five subsequent loadRun calls
    // must not accumulate any further build-entry events.
    const phaseEnteredBuild = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    expect(phaseEnteredBuild).toHaveLength(2)
  })
})

// --- M16 C9 follow-on Bug 2: stale gate-file cleanup at task -------
// boundary in dispatchers (helper-level coverage; full-dispatcher
// coverage lives in the C12 e2e test).

describe('clearStaleGateFile — Bug 2: helper unit coverage', () => {
  test('no prior task_completed → no-op (first task)', async () => {
    await initFreshRun()
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events: [],
      currentTaskId: 'T-001',
    })
    expect(result.cleared).toBe(false)
  })

  test('prior task_completed for same task → no-op (resume, not boundary)', async () => {
    await initFreshRun()
    // Simulate a fresh dispatch that just emitted task_completed for T-001
    // — but the dispatcher is now re-running for T-001 itself (resume).
    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-001',
    })
    expect(result.cleared).toBe(false)
  })

  test('boundary + gate file absent → no-op', async () => {
    await initFreshRun()
    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-002',
    })
    expect(result.cleared).toBe(false)
  })

  test('boundary + gate file present → cleared with priorTaskId + priorArtifactSha256', async () => {
    await initFreshRun()
    // Plant a stale GATE_BUILD_PASSED.json with a synthetic sha.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-002',
    })
    expect(result.cleared).toBe(true)
    expect(result.priorTaskId).toBe('T-001')
    expect(result.priorArtifactSha256).toBe(fakeSha)

    // The file is gone.
    let exists = true
    try {
      await readFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), 'utf8')
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test('current task already has build_started → no-op (resume guard)', async () => {
    await initFreshRun()
    // Plant a stale gate file AND a build_started for T-002. The helper
    // must NOT delete because T-002 has already started — the prior
    // dispatcher must have already cleaned up (or had nothing to clean).
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
      Object.freeze({
        version: 1 as const,
        type: 'build_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build' as const,
        agent: 'builder',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        taskId: 'T-002',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-002',
    })
    expect(result.cleared).toBe(false)

    // The file remains untouched.
    const stillThere = await readFile(
      join(runPaths.runDir, 'GATE_BUILD_PASSED.json'),
      'utf8',
    )
    expect(stillThere.length).toBeGreaterThan(0)
  })

  test('all three phases share the same boundary semantics (verify, review)', async () => {
    await initFreshRun()
    // Plant stale gates for all three phases.
    const sha = 'a'.repeat(64)
    for (const phase of ['build', 'verify', 'review'] as const) {
      const filename = `GATE_${phase.toUpperCase()}_PASSED.json`
      const gateContent = JSON.stringify(
        {
          version: 1,
          runId: RUN,
          phase,
          artifact:
            phase === 'build'
              ? 'BUILD_REPORT.md'
              : phase === 'verify'
                ? 'VERIFY.md'
                : 'REVIEW.md',
          artifactSha256: sha,
          agent: phase === 'build' ? 'builder' : phase === 'verify' ? 'verifier' : 'reviewer',
          approvedBy: 'test',
          approvedAt: FIXED_TS,
        },
        null,
        2,
      )
      await writeFile(join(runPaths.runDir, filename), gateContent + '\n')
    }
    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
    ]

    for (const phase of ['build', 'verify', 'review'] as const) {
      const result = await clearStaleGateFile({
        runDir: runPaths.runDir,
        phase,
        events,
        currentTaskId: 'T-002',
      })
      expect(result.cleared).toBe(true)
      expect(result.priorTaskId).toBe('T-001')
    }
  })
})

// --- M16 C9 follow-on 4 Bug 6: attempt-boundary supersedence -------
//
// When `currentAttempt` is provided (BUILD / VERIFY dispatchers), the
// resume guard fires only when a started event for `(currentTaskId,
// currentAttempt)` exists — a fresh attempt N+1 (after review-needs-
// revision OR verify-fail) sees no matching started event and clears
// the prior attempt's stale gate. Bug 2 closed the cross-task case;
// these tests close the within-task cross-attempt case.

describe('clearStaleGateFile — Bug 6: attempt-boundary supersedence', () => {
  test('build attempt 2 within same task with prior attempt-1 build_started + stale gate → cleared', async () => {
    await initFreshRun()
    // Bug 6 reproducer (BUILD path): T-001 BUILD a1 done, approve build,
    // VERIFY a1 approved, REVIEW r1 needs_revision → BUILD a2 about to
    // run. The prior approve build wrote GATE_BUILD_PASSED.json with a1
    // sha; that file is now stale because BUILD a2 will overwrite the
    // BUILD_REPORT.md the gate's sha was computed against.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'build_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build' as const,
        agent: 'builder',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        taskId: 'T-001',
      }),
    ]
    // Pre-Bug-6 behavior: helper short-circuited because build_started
    // for T-001 existed at all. Post-fix: with currentAttempt=2 the
    // helper sees no build_started for (T-001, 2) and clears the gate.
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-001',
      currentAttempt: 2,
    })
    expect(result.cleared).toBe(true)
    expect(result.priorArtifactSha256).toBe(fakeSha)
    // Within-task attempt boundary: priorTaskId IS currentTaskId.
    expect(result.priorTaskId).toBe('T-001')

    let exists = true
    try {
      await readFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), 'utf8')
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test('verify attempt 2 within same task with prior attempt-1 verify_started + stale gate → cleared', async () => {
    await initFreshRun()
    // Bug 6 reproducer (VERIFY path): BUILD a1 → approve build → VERIFY a1
    // → approve verify → GATE_VERIFY_PASSED.json (a1 sha). VERIFY a1
    // failed somehow, BUILD a2 ran and completed → VERIFY a2 about to
    // dispatch. The a1 gate file is stale.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'verify',
        artifact: 'VERIFY.md',
        artifactSha256: fakeSha,
        agent: 'verifier',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_VERIFY_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'verify_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'verify' as const,
        agent: 'verifier',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        patchSha256: 'b'.repeat(64),
        buildReportSha256: 'c'.repeat(64),
        taskId: 'T-001',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'verify',
      events,
      currentTaskId: 'T-001',
      currentAttempt: 2,
    })
    expect(result.cleared).toBe(true)
    expect(result.priorArtifactSha256).toBe(fakeSha)
    expect(result.priorTaskId).toBe('T-001')
  })

  test('mid-attempt resume: build_started exists for (currentTaskId, currentAttempt) → no-op', async () => {
    await initFreshRun()
    // Idempotency: a re-invocation of dispatchBuild during the SAME
    // attempt (e.g., transient process restart between build_started
    // and build_completed) must not clear the gate. With
    // currentAttempt=1 and a matching build_started(T-001, 1), the
    // resume guard fires and the helper returns no-op.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'build_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build' as const,
        agent: 'builder',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        taskId: 'T-001',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-001',
      currentAttempt: 1,
    })
    expect(result.cleared).toBe(false)

    // The file remains intact.
    const stillThere = await readFile(
      join(runPaths.runDir, 'GATE_BUILD_PASSED.json'),
      'utf8',
    )
    expect(stillThere.length).toBeGreaterThan(0)
  })

  test('first-task fresh attempt 1 with no prior task_completed and no started events → cleared if gate present', async () => {
    await initFreshRun()
    // Edge case: T-001 BUILD a1 → approve build → REVIEW r1 needs_revision
    // → BUILD a2 dispatches. There is NO `task_completed` for any task
    // yet (T-001 not done). The pre-Bug-6 task-boundary fast path
    // returned no-op on `latestTaskCompletedTaskId === null`. Post-fix:
    // when currentAttempt is provided, that fast path is bypassed and
    // the started-event scan correctly identifies the boundary.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'build_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build' as const,
        agent: 'builder',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        taskId: 'T-001',
      }),
      // No task_completed for any task yet — T-001 is mid-cycle.
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-001',
      currentAttempt: 2,
    })
    expect(result.cleared).toBe(true)
    expect(result.priorTaskId).toBe('T-001')
    expect(result.priorArtifactSha256).toBe(fakeSha)
  })

  test('REVIEW path: omitting currentAttempt preserves task-boundary semantics (back-compat)', async () => {
    await initFreshRun()
    // REVIEW gate is special — only written on `ready` verdict, so
    // within-task attempt-boundary cannot produce a stale gate. The
    // dispatchReview wiring intentionally omits `currentAttempt` and
    // falls back to the original task-only checks. This test asserts
    // the back-compat path still no-ops on same-task / first-task
    // even when stale-looking events exist.
    const events: LoggedEvent[] = [
      // No task_completed — first-task no-op.
      Object.freeze({
        version: 1 as const,
        type: 'review_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review' as const,
        agent: 'reviewer',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        patchSha256: 'b'.repeat(64),
        buildReportSha256: 'c'.repeat(64),
        verifyReportSha256: 'd'.repeat(64),
        taskId: 'T-001',
        buildFamily: 'fake',
        reviewerFamily: 'fake',
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'review',
      events,
      currentTaskId: 'T-001',
      // No currentAttempt — back-compat path.
    })
    expect(result.cleared).toBe(false)
  })

  test('attempt-aware: build_started for different task at same attempt → cleared (the started event scan still scopes to taskId)', async () => {
    await initFreshRun()
    // Defensive: a build_started for T-001 at attempt=1 must NOT
    // satisfy the resume guard for currentTaskId=T-002 at attempt=1.
    // Both fields must match.
    const fakeSha = 'a'.repeat(64)
    const gateContent = JSON.stringify(
      {
        version: 1,
        runId: RUN,
        phase: 'build',
        artifact: 'BUILD_REPORT.md',
        artifactSha256: fakeSha,
        agent: 'builder',
        approvedBy: 'test',
        approvedAt: FIXED_TS,
      },
      null,
      2,
    )
    await writeFile(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), gateContent + '\n')

    const events: LoggedEvent[] = [
      Object.freeze({
        version: 1 as const,
        type: 'task_completed' as const,
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '.code-oz/state/runs/abc/GATE_REVIEW_PASSED.json',
      }),
      Object.freeze({
        version: 1 as const,
        type: 'build_started' as const,
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build' as const,
        agent: 'builder',
        attempt: 1,
        baseCommitSha: 'a'.repeat(40),
        taskId: 'T-001', // different task
      }),
    ]
    const result = await clearStaleGateFile({
      runDir: runPaths.runDir,
      phase: 'build',
      events,
      currentTaskId: 'T-002',
      currentAttempt: 1,
    })
    expect(result.cleared).toBe(true)
    expect(result.priorTaskId).toBe('T-001')
  })
})

// --- M16 C9 follow-on Bug 2: validateRunIntegrity tolerates ---------
// gate_written events superseded by gate_file_cleared. This is the
// state-level invariant the dispatchers rely on for the multi-task
// flow to survive `loadRun`.

describe('validateRunIntegrity — Bug 2: cleared gates do not throw', () => {
  test('gate_written → gate_file_cleared sequence: loadRun succeeds without sha or missing-file errors', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body T-001',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Plant a gate_file_cleared event (as the dispatcher would emit at
    // the T-001 → T-002 boundary).
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
        priorTaskId: 'T-001',
        currentTaskId: 'T-002',
        gateFile: 'GATE_REVIEW_PASSED.json',
        priorArtifactSha256: 'a'.repeat(64),
      },
    )

    // Delete the gate file (mirroring dispatcher cleanup) and replace
    // the artifact with new bytes (mirroring runBuild for a new task).
    await rm(join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'), { force: true })
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'fresh T-002 bytes\n', 'utf8')

    // loadRun must NOT throw. validateRunIntegrity skips the prior
    // gate_written(review) event because gate_file_cleared(review)
    // supersedes it.
    const loaded = await loadRun(runPaths)
    expect(loaded).not.toBeNull()
  })

  test('gate_written sequence WITHOUT a clear: validation still fires (regression guard)', async () => {
    // The skip is conditional on a later gate_file_cleared for the
    // same phase. Without the clear, validateRunIntegrity continues to
    // throw when the gate file's recorded sha mismatches the artifact.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body T-001',
    })
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Mutate REVIEW.md WITHOUT emitting a gate_file_cleared event.
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'tampered bytes\n', 'utf8')

    let caught: Error | undefined
    try {
      await loadRun(runPaths)
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    expect(String(caught)).toMatch(/sha256_mismatch|sha256/i)
  })

  test('gate_written → cleared → gate_written → cleared (Bug 6 trail): loadRun succeeds without throwing on the historical first gate_written', async () => {
    // Bug 6 induces this exact sequence in events.jsonl:
    //   1. approve build T-002 a1 → gate_written(build) #1
    //   2. dispatchBuild T-002 a2 (review-needs-revision restart) →
    //      gate_file_cleared(build) #1 (my new emission), unlinks file.
    //
    // The cross-task supersedence (Bug 2) trail extends this to four
    // events when there's a prior task: gate_written(T-001 a1) → cleared
    // (T-001 → T-002) → gate_written(T-002 a1) → cleared (T-002 a1 → a2).
    // The pre-Bug-6 supersedence logic in validateRunIntegrity treated
    // the FIRST gate_written as un-superseded because a LATER
    // gate_written existed for the same phase, even though the LATER
    // gate_written was itself superseded by a still-later cleared.
    // Result: the validator tried to read GATE_BUILD_PASSED.json and
    // found it missing.
    //
    // Post-fix: ALL gate_written(phase) events earlier than the latest
    // are historical (they reference the same file as the latest), and
    // when the latest gate_written is itself superseded by a later
    // gate_file_cleared, that one is historical too. loadRun succeeds.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')

    // Plant the four-event chain manually. We don't need to spin up
    // real approve flows — the validator only inspects events + on-
    // disk file state.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_written',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build',
        file: 'GATE_BUILD_PASSED.json',
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build',
        priorTaskId: 'T-001',
        currentTaskId: 'T-002',
        gateFile: 'GATE_BUILD_PASSED.json',
        priorArtifactSha256: 'a'.repeat(64),
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_written',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build',
        file: 'GATE_BUILD_PASSED.json',
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_file_cleared',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build',
        priorTaskId: 'T-002',
        currentTaskId: 'T-002',
        gateFile: 'GATE_BUILD_PASSED.json',
        priorArtifactSha256: 'b'.repeat(64),
      },
    )
    // No GATE_BUILD_PASSED.json on disk — the dispatcher unlinked it.

    // loadRun must NOT throw. validateRunIntegrity skips ALL
    // gate_written(build) events: the first because it's not the
    // latest, the latest because it's superseded by the later
    // gate_file_cleared.
    const loaded = await loadRun(runPaths)
    expect(loaded).not.toBeNull()
  })
})

// --- M16 C9 follow-on (2) Bug 3: cursor-aware iterate-half transition --
// (review→build for the next pending task on mid-PLAN approve-review)
//
// Bug 1 (c262efd) closed the terminal half (review→ship) by gating
// `phase_entered(ship)` emission on `cursor.allCompleted=true`. After that
// fix, mid-PLAN approve-review correctly skipped the ship transition, but
// also emitted no `phase_entered(build)` for the next task — leaving
// `currentPhase=review`. The next task's `code-oz approve build` then
// failed at src/commands/approve.ts:117 with the currentPhase mismatch.
//
// Bug 3 closes the iterate half: when `cursor.allCompleted=false` and
// `cursor.pending !== null`, emit `phase_entered(build)` instead of
// `phase_entered(ship)`. The same gate lives in `approveReviewTaskGate`
// and `completeIncompleteTransitions` so loadRun stays idempotent.

describe('approveReviewTaskGate — Bug 3: iterate-half emits phase_entered(build) for next task', () => {
  test('mid-PLAN approve-review: phase_entered(build) lands AFTER task_completed(T-001)', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body T-001',
    })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    const taskCompletedIdx = known.findIndex(
      (e) => e.type === 'task_completed' && e.taskId === 'T-001',
    )
    expect(taskCompletedIdx).toBeGreaterThanOrEqual(0)
    // The iterate-half phase_entered(build) is the LAST phase_entered in
    // the log and lands at an index strictly greater than task_completed.
    const lastBuildEntryIdx = known.reduce(
      (acc: number, e, i) =>
        e.type === 'phase_entered' && e.phase === 'build' ? i : acc,
      -1,
    )
    expect(lastBuildEntryIdx).toBeGreaterThan(taskCompletedIdx)
  })

  test('mid-PLAN: currentPhase advances to build; subsequent runApprove(build) for T-002 is unblocked', async () => {
    // The actual operator-facing regression: after `code-oz approve review`
    // for T-001, `code-oz approve build` for T-002 must succeed.
    // approve.ts:117 asserts `candidate === loaded.state.currentPhase`,
    // so currentPhase must be 'build' for the assertion to pass.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Result-level: the iterate half reports build, not null.
    expect(result.nextPhase).toBe('build')
    expect(result.state.currentPhase).toBe('build')

    // loadRun-level: the assertion that approve.ts:117 evaluates against.
    const loaded = await loadRun(runPaths)
    expect(loaded?.state.currentPhase).toBe('build')

    // Simulate approve.ts:117: candidate === loaded.state.currentPhase.
    expect('build' === loaded?.state.currentPhase).toBe(true)
  })

  test('idempotency: re-calling approveReviewTaskGate emits no duplicate phase_entered(build)', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })

    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const opts = {
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield' as const,
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    }

    await approveReviewTaskGate(opts)
    await approveReviewTaskGate(opts)
    await approveReviewTaskGate(opts)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    // Original walkFsmToReview emits one phase_entered(build); the
    // iterate-half emits a second after task_completed(T-001). Three
    // approve calls must accumulate exactly one iterate-half entry, so
    // total phase_entered(build) === 2.
    const phaseEnteredBuild = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    expect(phaseEnteredBuild).toHaveLength(2)

    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(0)
  })

  test('last-task approval (single-task PLAN): emits phase_entered(ship), NOT phase_entered(build)', async () => {
    // Sanity: the terminal half (Bug 1) is preserved. When the just-
    // approved task is the last, allCompleted=true → ship, not build.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })

    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const result = await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    expect(result.nextPhase).toBe('ship')
    expect(result.state.currentPhase).toBe('ship')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(1)
  })
})

describe('completeIncompleteTransitions — Bug 3: iterate-half on loadRun recovery', () => {
  test('loadRun on a run halted between approveReviewTaskGate steps fills phase_entered(build) for the next task', async () => {
    // Repro: drive approveReviewTaskGate to its full happy path (which
    // already emits phase_entered(build)), then surgically excise that
    // tail event from events.jsonl to simulate a crash between
    // task_completed and the iterate-half emission. loadRun must then
    // re-emit phase_entered(build) via completeIncompleteTransitions.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Excise the iterate-half phase_entered(build) (last line in
    // events.jsonl after approveReviewTaskGate) to simulate a crash
    // between task_completed and the iterate-half emission.
    const raw = await readFile(runPaths.eventsFile, 'utf8')
    const lines = raw.split('\n').filter((l) => l.length > 0)
    const lastLine = lines[lines.length - 1]
    expect(lastLine).toBeDefined()
    const lastEvent = JSON.parse(lastLine!) as {
      type: string
      phase?: string
    }
    expect(lastEvent.type).toBe('phase_entered')
    expect(lastEvent.phase).toBe('build')
    await writeFile(
      runPaths.eventsFile,
      lines.slice(0, -1).join('\n') + '\n',
      'utf8',
    )

    // loadRun runs completeIncompleteTransitions and fills the missing
    // iterate-half transition.
    const loaded = await loadRun(runPaths)
    expect(loaded?.state.currentPhase).toBe('build')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredBuild = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    // walkFsmToReview wrote one + completeIncompleteTransitions wrote one.
    expect(phaseEnteredBuild).toHaveLength(2)

    const phaseEnteredShip = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'ship')
    expect(phaseEnteredShip).toHaveLength(0)
  })

  test('loadRun idempotency: a second loadRun does not duplicate the iterate-half emission', async () => {
    // After approveReviewTaskGate emits the iterate-half transition,
    // subsequent loadRun calls must NOT re-emit it. The completion
    // step's idempotency check uses post-gate-index dedup so the
    // existing phase_entered(build) from the original FSM walk does
    // not mask the just-added iterate-half entry.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'fixture body',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    await loadRun(runPaths)
    await loadRun(runPaths)
    await loadRun(runPaths)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const phaseEnteredBuild = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    expect(phaseEnteredBuild).toHaveLength(2)
  })
})

// --- M16 C9 follow-on (3) Bug 4 class fix: task-boundary supersedence --
// across phase-transition helpers in src/state/run.ts.
//
// The C12 e2e agent caught Bug 4 in `completeTransitionForPhase`: after
// T-001 BUILD/VERIFY/REVIEW approves and T-002's dispatcher emits
// `gate_file_cleared(build)` at the boundary, T-002's `approve build`
// would read T-001's still-present gate_written(build) +
// phase_exited(build) + phase_entered(verify) and skip ALL emissions —
// the FSM would never advance from `build` to `verify`.
//
// The class-fix audit found three more sibling helpers with the same
// bare `events.some(e => e.phase === phase)` dedup that ignores
// gate_file_cleared supersedence:
//
//   - completeTransitionForPhase (Bug 4 — primary)
//   - requireGate (gate_required emission across task boundaries)
//   - approveReviewTaskGate (gate_written + phase_exited dedup; sibling
//     to Bug 3's phase_entered fix already handled in 5d21d9be)
//   - completeIncompleteTransitions (linear-FSM phase_exited /
//     phase_entered; iterate-half was index-based, linear was global)
//   - recoverOrphanGates (gateWrittenPhases membership check ignored
//     supersedence, so a fresh gate file at a re-cleared phase was not
//     recovered)
//
// All five are extended to use the same supersedence anchor: the index
// of the latest `gate_file_cleared(phase)`. Records with idx > anchor
// are "active"; records with idx < anchor are "historical" and do not
// dedupe the new task's emission.

const ARTIFACT_FOR: Record<'build' | 'verify' | 'review', string> = {
  build: 'BUILD_REPORT.md',
  verify: 'VERIFY.md',
  review: 'REVIEW.md',
}

function makeNonReviewGate(opts: {
  phase: 'build' | 'verify' | 'review'
  artifact?: string
}): GateFile {
  return {
    version: 1,
    runId: RUN,
    phase: opts.phase,
    artifact: opts.artifact ?? ARTIFACT_FOR[opts.phase],
    agent: 'tester',
    agentProvider: 'fake',
    approvedBy: 'test',
    approvedAt: FIXED_TS,
  }
}

async function appendGateFileCleared(opts: {
  phase: 'build' | 'verify' | 'review'
  priorTaskId: string
  currentTaskId: string
}): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'gate_file_cleared',
      ts: FIXED_TS,
      runId: RUN,
      phase: opts.phase,
      priorTaskId: opts.priorTaskId,
      currentTaskId: opts.currentTaskId,
      gateFile: opts.phase === 'build'
        ? 'GATE_BUILD_PASSED.json'
        : opts.phase === 'verify'
          ? 'GATE_VERIFY_PASSED.json'
          : 'GATE_REVIEW_PASSED.json',
      priorArtifactSha256: 'a'.repeat(64),
    },
  )
}

describe('completeTransitionForPhase — Bug 4: task-boundary supersedence', () => {
  test('multi-task BUILD: after gate_file_cleared(build), T-002 approveGate emits fresh gate_written + phase_exited + phase_entered', async () => {
    // T-001 lifecycle: walk to build, approve build (emits gate_written
    // (build) + phase_exited(build) + phase_entered(verify)). Then
    // simulate the dispatcher emitting gate_file_cleared(build) at the
    // T-002 boundary, write a fresh BUILD_REPORT.md, and call
    // approveGate(build) again. The class fix must emit a fresh trio
    // of events for T-002 instead of deduping against T-001's records.
    await initFreshRun()
    // Walk define→plan→build.
    for (const [exit, enter] of [
      ['define', 'plan'] as const,
      ['plan', 'build'] as const,
    ]) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: exit, outcome: 'passed' },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }

    // T-001 BUILD approve.
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-001 build body\n', 'utf8')
    const t1Result = await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })
    expect(t1Result.gateExisted).toBe(false)
    expect(t1Result.nextPhase).toBe('verify')
    expect(t1Result.state.currentPhase).toBe('verify')

    // Simulate the dispatcher's task-boundary cleanup: emit
    // gate_file_cleared(build) and remove the prior task's gate file.
    await appendGateFileCleared({
      phase: 'build',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
    })
    await rm(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), { force: true })

    // Mirror T-002 BUILD: walk verify→build (FSM moves back to BUILD
    // for the new task), write fresh BUILD_REPORT.md, approveGate.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'verify', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'build' },
    )
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-002 build body\n', 'utf8')

    const t2Result = await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })
    expect(t2Result.gateExisted).toBe(false)
    expect(t2Result.nextPhase).toBe('verify')
    // The class fix: currentPhase advances to verify for T-002 because
    // a fresh phase_entered(verify) is emitted post-clear. Without the
    // fix, T-001's phase_entered(verify) would have masked the new
    // emission and the reducer would still report some other state.
    expect(t2Result.state.currentPhase).toBe('verify')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    const buildGateWritten = known.filter(
      (e) => e.type === 'gate_written' && e.phase === 'build',
    )
    expect(buildGateWritten).toHaveLength(2)
    const buildPhaseExited = known.filter(
      (e) => e.type === 'phase_exited' && e.phase === 'build' && e.outcome === 'passed',
    )
    expect(buildPhaseExited).toHaveLength(2)
    const verifyPhaseEntered = known.filter(
      (e) => e.type === 'phase_entered' && e.phase === 'verify',
    )
    // walkFsmToReview equivalent didn't fire here — only the two
    // approveGate(build) calls produced phase_entered(verify).
    expect(verifyPhaseEntered).toHaveLength(2)
  })

  test('single-task BUILD (no gate_file_cleared): repeat approveGate is idempotent (regression guard)', async () => {
    // The fix must not regress the existing idempotency contract.
    // Without a gate_file_cleared event, a second approveGate call
    // with identical inputs is still a no-op.
    await initFreshRun()
    for (const [exit, enter] of [
      ['define', 'plan'] as const,
      ['plan', 'build'] as const,
    ]) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: exit, outcome: 'passed' },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'body\n', 'utf8')
    const first = await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })
    expect(first.gateExisted).toBe(false)
    const second = await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })
    expect(second.gateExisted).toBe(true)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    expect(known.filter((e) => e.type === 'gate_written' && e.phase === 'build')).toHaveLength(1)
    expect(known.filter((e) => e.type === 'phase_exited' && e.phase === 'build')).toHaveLength(1)
  })
})

describe('requireGate — Bug 4: task-boundary supersedence', () => {
  test('multi-task BUILD: after gate_file_cleared(build), requireGate emits fresh gate_required for T-002', async () => {
    await initFreshRun()
    // Plant T-001's gate_required(build) directly (mirrors what
    // runBuild emits via requireGate after BUILD_REPORT.md write).
    await requireGate({
      paths: runPaths,
      runId: RUN,
      phase: 'build',
      blockedOn: 'T-001 awaiting approval',
      now: () => FIXED_TS,
    })

    // Boundary cleanup.
    await appendGateFileCleared({
      phase: 'build',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
    })

    // T-002's runBuild calls requireGate(build) again. With the class
    // fix, this emits a fresh gate_required(build) event because the
    // prior one is superseded by the gate_file_cleared.
    const result = await requireGate({
      paths: runPaths,
      runId: RUN,
      phase: 'build',
      blockedOn: 'T-002 awaiting approval',
      now: () => FIXED_TS,
    })
    expect(result.appended).toBe(true)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    const gateRequired = known.filter(
      (e) => e.type === 'gate_required' && e.phase === 'build',
    )
    expect(gateRequired).toHaveLength(2)
    expect((gateRequired[1] as { blockedOn: string }).blockedOn).toBe('T-002 awaiting approval')
  })

  test('single-task BUILD (no gate_file_cleared): repeat requireGate is idempotent (regression guard)', async () => {
    await initFreshRun()
    const first = await requireGate({
      paths: runPaths,
      runId: RUN,
      phase: 'build',
      blockedOn: 'T-001 awaiting approval',
      now: () => FIXED_TS,
    })
    expect(first.appended).toBe(true)
    const second = await requireGate({
      paths: runPaths,
      runId: RUN,
      phase: 'build',
      blockedOn: 'T-001 awaiting approval (re-run)',
      now: () => FIXED_TS,
    })
    expect(second.appended).toBe(false)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    expect(known.filter((e) => e.type === 'gate_required' && e.phase === 'build')).toHaveLength(1)
  })
})

describe('approveReviewTaskGate — Bug 4: task-boundary supersedence on gate_written + phase_exited', () => {
  test('multi-task REVIEW: after gate_file_cleared(review), T-002 approveReviewTaskGate emits fresh gate_written(review) + phase_exited(review)', async () => {
    // Drive T-001 through to approveReviewTaskGate, then simulate the
    // T-002 dispatchReview boundary cleanup, then approve T-002. The
    // class fix must emit a fresh gate_written(review) and a fresh
    // phase_exited(review) for T-002 — not just the phase_entered(build)
    // already covered by Bug 3.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    await walkFsmToReview()
    await setupReviewReadyForTask({
      taskId: 'T-001',
      attempt: 1,
      reviewSha: 'T-001 review body',
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })

    // Boundary cleanup: gate_file_cleared + remove the gate file.
    await appendGateFileCleared({
      phase: 'review',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
    })
    await rm(join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'), { force: true })

    // T-002 fixture: fresh REVIEW.md + review_resolved for T-002 +
    // gate_required(review) (already supersedence-aware via
    // requireGate).
    await writeFile(join(artifactRoot, 'REVIEW.md'), 'T-002 review body\n', 'utf8')
    const t2Sha = SHA('T-002 review body\n')
    await appendReviewResolved('T-002', 1, t2Sha)
    await requireGate({
      paths: runPaths,
      runId: RUN,
      phase: 'review',
      blockedOn: 'T-002 awaiting approval',
      now: () => FIXED_TS,
    })

    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-002'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-002',
      now: () => FIXED_TS,
    })

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    const reviewGateWritten = known.filter(
      (e) => e.type === 'gate_written' && e.phase === 'review',
    )
    expect(reviewGateWritten).toHaveLength(2)
    const reviewPhaseExited = known.filter(
      (e) => e.type === 'phase_exited' && e.phase === 'review' && e.outcome === 'passed',
    )
    expect(reviewPhaseExited).toHaveLength(2)
    // task_completed for both tasks; cursor.allCompleted=true → ship.
    const taskCompleted = known.filter((e) => e.type === 'task_completed')
    expect(taskCompleted).toHaveLength(2)
    const phaseEnteredShip = known.filter(
      (e) => e.type === 'phase_entered' && e.phase === 'ship',
    )
    expect(phaseEnteredShip).toHaveLength(1)
  })
})

describe('completeIncompleteTransitions — Bug 4: linear-FSM index-based dedup', () => {
  test('multi-task BUILD: missing T-002 phase_exited(build) + phase_entered(verify) are filled on loadRun without masking by T-001 records', async () => {
    // Build a multi-task scenario where T-002's gate_written(build) is
    // present but the trailing phase_exited / phase_entered are
    // missing (mirrors a crash window between approveGate's gate
    // append and the transition append). The class fix must emit
    // fresh phase_exited(build) AFTER T-002's gate_written(build),
    // regardless of T-001's earlier phase_exited(build) being present.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    // Walk define→plan→build, approve T-001 build (full transition).
    for (const [exit, enter] of [
      ['define', 'plan'] as const,
      ['plan', 'build'] as const,
    ]) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: exit, outcome: 'passed' },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-001 body\n', 'utf8')
    await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })

    // Boundary cleanup, walk back to build for T-002.
    await appendGateFileCleared({
      phase: 'build',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
    })
    await rm(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), { force: true })
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'verify', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'build' },
    )

    // Write T-002's gate file + emit gate_written(build) but truncate
    // the events.jsonl just before phase_exited(build) to simulate a
    // crash. Use writeGate + a manual gate_written append.
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-002 body\n', 'utf8')
    await writeGate({
      paths: { runDir: runPaths.runDir, artifactRoot: runPaths.artifactRoot, lockDir: runPaths.lockDir },
      gate: makeNonReviewGate({ phase: 'build' }),
    })
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'gate_written',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'build',
        file: 'GATE_BUILD_PASSED.json',
      },
    )

    // loadRun runs completeIncompleteTransitions. With the class fix,
    // it emits fresh phase_exited(build) + phase_entered(verify) for
    // T-002 even though T-001's pair is in the log.
    const loaded = await loadRun(runPaths)
    expect(loaded?.state.currentPhase).toBe('verify')

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    expect(known.filter((e) => e.type === 'phase_exited' && e.phase === 'build' && e.outcome === 'passed')).toHaveLength(2)
    expect(known.filter((e) => e.type === 'phase_entered' && e.phase === 'verify')).toHaveLength(2)
  })
})

describe('recoverOrphanGates — Bug 4: task-boundary supersedence on phase coverage', () => {
  test('multi-task BUILD: after gate_file_cleared(build), an orphan T-002 gate file IS recovered (not masked by T-001 gate_written)', async () => {
    // T-001 BUILD approve emits gate_written(build) and creates
    // GATE_BUILD_PASSED.json. The dispatcher then emits
    // gate_file_cleared(build) and removes the file. T-002 BUILD
    // writes a fresh GATE_BUILD_PASSED.json but a crash leaves the
    // gate_written event missing. recoverOrphanGates must NOT skip
    // the recovery on the basis that gate_written(build) appears
    // somewhere in the log — it must check supersedence.
    await initFreshRun()
    for (const [exit, enter] of [
      ['define', 'plan'] as const,
      ['plan', 'build'] as const,
    ]) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: exit, outcome: 'passed' },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-001 body\n', 'utf8')
    await approveGate({
      paths: runPaths,
      gate: makeNonReviewGate({ phase: 'build' }),
      profile: 'greenfield',
      now: () => FIXED_TS,
    })

    // Boundary cleanup + T-002 dispatch (back to BUILD).
    await appendGateFileCleared({
      phase: 'build',
      priorTaskId: 'T-001',
      currentTaskId: 'T-002',
    })
    await rm(join(runPaths.runDir, 'GATE_BUILD_PASSED.json'), { force: true })
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_exited', ts: FIXED_TS, runId: RUN, phase: 'verify', outcome: 'passed' },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'build' },
    )

    // T-002 writes fresh BUILD_REPORT.md and the gate file, but
    // crashes before appending gate_written.
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'T-002 body\n', 'utf8')
    await writeGate({
      paths: { runDir: runPaths.runDir, artifactRoot: runPaths.artifactRoot, lockDir: runPaths.lockDir },
      gate: makeNonReviewGate({ phase: 'build' }),
    })

    // loadRun → recoverOrphanGates must detect the orphan and emit a
    // fresh gate_written(build). Without the class fix, T-001's
    // gate_written(build) keeps phase=build covered forever and the
    // orphan is silently ignored.
    const loaded = await loadRun(runPaths)
    expect(loaded?.recovered).toBe(true)

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const known = events.filter(isKnownPhaseEvent)
    const buildGateWritten = known.filter(
      (e) => e.type === 'gate_written' && e.phase === 'build',
    )
    expect(buildGateWritten).toHaveLength(2)
  })
})

// ---------------------------------------------------------------
// M16 C9 follow-on (5) — Bug 7: phase_entered(build) on attempt-
// boundary BUILD pre-routes (verify-restart + review-remediation).
//
// `dispatchBuild` never emits `phase_entered(build)` itself — the
// upstream caller is authoritative for the transition. After 5d21d9be
// closed the task-boundary half (approveReviewTaskGate emits
// phase_entered(build) on the iterate half), the attempt-boundary
// half remained: both pre-routes in handleActiveRun call dispatchBuild
// without emitting the transition. currentPhase stays at 'verify' (or
// 'review') and the operator's `code-oz approve build` for attempt
// N+1 fails at approve.ts:117 with `current phase is '<phase>',
// not 'build'`.
//
// Tests below cover the helper directly (not handleActiveRun's flow,
// which spans process boundaries). The helper's contract mirrors the
// approveReviewTaskGate dedup pattern: idempotent on currentPhase
// already 'build'.
// ---------------------------------------------------------------

describe('emitPhaseEnteredBuildIfNeeded — Bug 7: attempt-boundary phase_entered(build)', () => {
  test('currentPhase=verify (verify-restart pre-route): emits phase_entered(build)', async () => {
    await initFreshRun()
    // Drop synthetic events that put currentPhase at 'verify' for a
    // BUILD attempt 1 that just completed and has a verify-restart
    // signal pending. The reducer's currentPhase derives from the
    // last phase_entered, so we mirror what handleActiveRun reads.
    const synthSequence: Array<{ exit: Phase; enter: Phase }> = [
      { exit: 'define', enter: 'plan' },
      { exit: 'plan', enter: 'build' },
      { exit: 'build', enter: 'verify' },
    ]
    for (const { exit, enter } of synthSequence) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'phase_exited',
          ts: FIXED_TS,
          runId: RUN,
          phase: exit,
          outcome: 'passed',
        },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    const events = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const result = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: 'verify',
      now: () => FIXED_TS,
    })
    expect(result.emitted).toBe(true)
    const after = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const enteredPhases = after
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered')
      .map((e) => (e.type === 'phase_entered' ? e.phase : ''))
    // The last phase_entered must be 'build' so the reducer's
    // currentPhase advances. Prior entries (define, plan, build,
    // verify) remain.
    expect(enteredPhases[enteredPhases.length - 1]).toBe('build')
    // The reducer projects the same.
    const reloaded = await loadRun(runPaths)
    expect(reloaded?.state.currentPhase).toBe('build')
  })

  test('currentPhase=review (review-remediation pre-route): emits phase_entered(build)', async () => {
    await initFreshRun()
    // The review-remediation pre-route fires when REVIEW r1 returns
    // needs_revision and a review_remediation_recorded event is
    // present. currentPhase is 'review' because review_remediation_
    // recorded does not change phase. Synthesize that state.
    const synthSequence: Array<{ exit: Phase; enter: Phase }> = [
      { exit: 'define', enter: 'plan' },
      { exit: 'plan', enter: 'build' },
      { exit: 'build', enter: 'verify' },
      { exit: 'verify', enter: 'review' },
    ]
    for (const { exit, enter } of synthSequence) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'phase_exited',
          ts: FIXED_TS,
          runId: RUN,
          phase: exit,
          outcome: 'passed',
        },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    const events = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const result = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: 'review',
      now: () => FIXED_TS,
    })
    expect(result.emitted).toBe(true)
    const reloaded = await loadRun(runPaths)
    expect(reloaded?.state.currentPhase).toBe('build')
  })

  test('idempotency: currentPhase already \'build\' → short-circuit, no duplicate emit', async () => {
    await initFreshRun()
    // Synthesize a state where currentPhase is already 'build'
    // (e.g., the first pre-route call already emitted, and we are
    // re-entering on a benign resume).
    const synthSequence: Array<{ exit: Phase; enter: Phase }> = [
      { exit: 'define', enter: 'plan' },
      { exit: 'plan', enter: 'build' },
    ]
    for (const { exit, enter } of synthSequence) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'phase_exited',
          ts: FIXED_TS,
          runId: RUN,
          phase: exit,
          outcome: 'passed',
        },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    const eventsBefore = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const result = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events: eventsBefore,
      runId: RUN,
      currentPhase: 'build',
      now: () => FIXED_TS,
    })
    expect(result.emitted).toBe(false)
    // The events.jsonl tail is unchanged.
    const eventsAfter = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    expect(eventsAfter.length).toBe(eventsBefore.length)
  })

  test('three repeat invocations: emit once, skip twice', async () => {
    await initFreshRun()
    // Initial state: currentPhase='verify' (mid verify-restart).
    const synthSequence: Array<{ exit: Phase; enter: Phase }> = [
      { exit: 'define', enter: 'plan' },
      { exit: 'plan', enter: 'build' },
      { exit: 'build', enter: 'verify' },
    ]
    for (const { exit, enter } of synthSequence) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'phase_exited',
          ts: FIXED_TS,
          runId: RUN,
          phase: exit,
          outcome: 'passed',
        },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    // First call: currentPhase=verify → emits.
    let events = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const r1 = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: 'verify',
      now: () => FIXED_TS,
    })
    expect(r1.emitted).toBe(true)
    // Second + third calls: currentPhase is now 'build' (per reducer),
    // so the helper short-circuits.
    events = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const reloaded = await loadRun(runPaths)
    expect(reloaded?.state.currentPhase).toBe('build')
    const r2 = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: reloaded!.state.currentPhase,
      now: () => FIXED_TS,
    })
    expect(r2.emitted).toBe(false)
    const r3 = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: reloaded!.state.currentPhase,
      now: () => FIXED_TS,
    })
    expect(r3.emitted).toBe(false)
    // Exactly one phase_entered(build) appears AFTER the upstream
    // build entry from the synth sequence (we record the canonical
    // build entry plus exactly one re-entry on the verify→build
    // boundary).
    const after = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const buildEntries = after
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'phase_entered' && e.phase === 'build')
    expect(buildEntries).toHaveLength(2)
  })

  test('runApprove(build) for the next BUILD attempt is unblocked after emit', async () => {
    // Operator-facing regression: after the pre-route emits
    // phase_entered(build), runApprove(build) for the next attempt
    // must succeed (currentPhase==='build' is the precondition at
    // src/commands/approve.ts:117).
    await initFreshRun()
    const synthSequence: Array<{ exit: Phase; enter: Phase }> = [
      { exit: 'define', enter: 'plan' },
      { exit: 'plan', enter: 'build' },
      { exit: 'build', enter: 'verify' },
    ]
    for (const { exit, enter } of synthSequence) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'phase_exited',
          ts: FIXED_TS,
          runId: RUN,
          phase: exit,
          outcome: 'passed',
        },
      )
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: enter },
      )
    }
    const events = await readEvents({ file: runPaths.eventsFile, lockDir: runPaths.lockDir })
    const result = await emitPhaseEnteredBuildIfNeeded({
      runPaths,
      events,
      runId: RUN,
      currentPhase: 'verify',
      now: () => FIXED_TS,
    })
    expect(result.emitted).toBe(true)
    // currentPhase advances; that is the precondition for
    // runApprove(build) at approve.ts:117. The approve primitive
    // itself requires more state (BUILD_REPORT.md, gate file, etc.);
    // this test verifies the phase precondition only — the operator-
    // facing failure mode at line 117 is `currentPhase !== 'build'`.
    const reloaded = await loadRun(runPaths)
    expect(reloaded?.state.currentPhase).toBe('build')
  })
})

// --- task_review_passed semantics (Bug 10 — M16 C9 follow-on 7) ---

/**
 * Bug 10: `task_review_passed` is declared in the schema
 * (src/state/schemas.ts:1355) and consumed by the cursor projection
 * (src/state/task-cursor.ts:115, 149, 182), but no call site emitted it
 * before this follow-on. The C12 e2e (cli-multi-task-cycle.test.ts:438)
 * caught the gap by asserting `taskReviewPassed.length === 3` and
 * observing 0.
 *
 * Semantic A (chosen): the event is emitted by `dispatchReview` when
 * `runReview` returns `status === 'resolved'`, BEFORE the operator's
 * `code-oz approve review` lands `task_completed`. The gap between
 * `task_review_passed` and `task_completed` is the
 * "review-ready, awaiting approve review" window surfaced by
 * `TaskCursorEntry.reviewPassed`. Semantic B (emit at
 * `approveReviewTaskGate`) would make the boolean redundant with
 * `status === 'completed'`, contradicting the cursor doc at
 * src/state/task-cursor.ts:49-53.
 *
 * These tests verify the cursor-projection contract that the dispatcher's
 * emit must satisfy. The dispatcher integration boundary is exercised by
 * the C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts).
 */
describe('task_review_passed — cursor projection contract (Bug 10)', () => {
  test('cursor sets reviewPassed=true when task_review_passed is present and task_completed is absent (Semantic A: pre-approval gap)', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    // Seed the lifecycle up to "review resolved, awaiting approve":
    //   task_started (attempt 1) + task_review_passed (final round 1).
    // No task_completed yet — that's what the operator's `approve review`
    // would emit.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_started',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_review_passed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        finalRound: 1,
        reviewReportSha256: 'a'.repeat(64),
      },
    )

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const { cursor } = projectTaskCursor(plan, events)

    expect(cursor.entries).toHaveLength(1)
    expect(cursor.entries[0]!.taskId).toBe('T-001')
    expect(cursor.entries[0]!.status).toBe('in_progress')
    expect(cursor.entries[0]!.reviewPassed).toBe(true)
    // The pending entry is still T-001; allCompleted is false.
    expect(cursor.pending?.taskId).toBe('T-001')
    expect(cursor.allCompleted).toBe(false)
  })

  test('cursor reports status=completed AND reviewPassed=true when both events are present', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_started',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_review_passed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        finalRound: 1,
        reviewReportSha256: 'a'.repeat(64),
      },
    )
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_completed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        reviewGatePath: '/tmp/GATE_REVIEW_PASSED.json',
      },
    )

    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const { cursor } = projectTaskCursor(plan, events)
    expect(cursor.entries[0]!.status).toBe('completed')
    expect(cursor.entries[0]!.reviewPassed).toBe(true)
    expect(cursor.allCompleted).toBe(true)
  })

  test('event-log ordering: task_review_passed precedes task_completed for the same task', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })
    // Inject task_review_passed BEFORE the approve primitive runs, so the
    // ordering invariant matches what dispatchReview produces in
    // production (the dispatcher emits before requireGate's blocked-on
    // signal reaches the operator's approve invocation).
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_review_passed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
        finalRound: 1,
        reviewReportSha256: SHA('fixture body\n'),
      },
    )
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const passIdx = events.findIndex(
      (e) => isKnownPhaseEvent(e) && e.type === 'task_review_passed' && e.taskId === 'T-001',
    )
    const completedIdx = events.findIndex(
      (e) => isKnownPhaseEvent(e) && e.type === 'task_completed' && e.taskId === 'T-001',
    )
    expect(passIdx).toBeGreaterThanOrEqual(0)
    expect(completedIdx).toBeGreaterThanOrEqual(0)
    expect(passIdx).toBeLessThan(completedIdx)
  })

  test('approveReviewTaskGate does NOT emit task_review_passed (Semantic A: dispatcher owns the emit)', async () => {
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await setupReviewReadyForTask({ taskId: 'T-001', attempt: 1, reviewSha: 'fixture body' })
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    await approveReviewTaskGate({
      paths: runPaths,
      gate: makeReviewGate('T-001'),
      profile: 'greenfield',
      plan,
      upstreamAttempt: 1,
      upstreamTaskId: 'T-001',
      now: () => FIXED_TS,
    })
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const taskReviewPassed = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_review_passed')
    // The approve primitive emits task_completed (Semantic B's
    // putative slot), but task_review_passed is dispatcher authority
    // (Semantic A). The fixture seeded review_resolved + REVIEW.md
    // but did NOT call dispatchReview, so no task_review_passed is
    // expected here. This confirms the emit site lives in the
    // dispatcher, not the approve primitive.
    expect(taskReviewPassed).toHaveLength(0)
    // Sanity: task_completed IS emitted by approveReviewTaskGate.
    const taskCompleted = events
      .filter(isKnownPhaseEvent)
      .filter((e) => e.type === 'task_completed')
    expect(taskCompleted).toHaveLength(1)
  })

  test('duplicate task_review_passed events for the same (taskId, finalRound) do not corrupt the cursor projection', async () => {
    // Defensive: the dispatcher emit is idempotent on
    // `(runId, taskId, finalRound)` (src/commands/run.ts), but a
    // hand-edited or corrupted event log could carry duplicates. The
    // cursor projection must remain stable under such input — it just
    // sets `reviewPassed = true` regardless of how many duplicate
    // events land.
    await initFreshRun()
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT_SINGLE, 'utf8')
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_started',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 0,
      },
    )
    for (let i = 0; i < 3; i++) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'task_review_passed',
          ts: FIXED_TS,
          runId: RUN,
          taskId: 'T-001',
          taskIndex: 0,
          finalRound: 1,
          reviewReportSha256: 'a'.repeat(64),
        },
      )
    }
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const plan = parsePlan(PLAN_TXT_SINGLE, join(artifactRoot, 'PLAN.md'))
    const { cursor, issues } = projectTaskCursor(plan, events)
    expect(cursor.entries[0]!.reviewPassed).toBe(true)
    expect(cursor.entries[0]!.status).toBe('in_progress')
    // No projection issues raised by duplicates — they simply set the
    // boolean idempotently.
    expect(issues).toHaveLength(0)
  })

  test('task_review_passed.taskIndex mismatch with current PLAN.md surfaces a non-fatal cursor issue', async () => {
    // Mirrors the existing index-mismatch test pattern for task_started
    // / task_completed — task_review_passed is in the same family of
    // task-keyed events the cursor projects (src/state/task-cursor.ts:131).
    await initFreshRun()
    // Multi-task PLAN to establish a known taskIndex space.
    await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
    // Emit task_review_passed with the wrong taskIndex (2 instead of 0).
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'task_review_passed',
        ts: FIXED_TS,
        runId: RUN,
        taskId: 'T-001',
        taskIndex: 2,
        finalRound: 1,
        reviewReportSha256: 'a'.repeat(64),
      },
    )
    const events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
    const plan = parsePlan(PLAN_TXT, join(artifactRoot, 'PLAN.md'))
    const { cursor, issues } = projectTaskCursor(plan, events)
    // Issue surfaced; cursor still records the lifecycle bit at the
    // PLAN-canonical index (0) per the existing
    // task_cursor_index_mismatch policy.
    expect(issues.some((i) => i.code === 'task_cursor_index_mismatch')).toBe(true)
    expect(cursor.entries[0]!.reviewPassed).toBe(true)
  })
})
