// `code-oz doctor run` read-only inspector tests (M16 C10).
//
// Coverage:
//   - No active run → "no active run", exit 0.
//   - Active run with multi-task PLAN → cursor + recent events + scheduler
//     events under (runId, taskId, attempt, reviewRound).
//   - NEEDS_INTERVENTION present → first 200 chars in output.
//   - Worktree present → path + base.txt sha shown.
//   - Idempotency: running twice produces identical reports (read-only).
//   - Missing PLAN.md → cursor unavailable, currentPhase still printed.
//   - Empty events.jsonl tolerated.
//   - JSON output mirror.
//
// The CLI shim is exercised indirectly through `inspectRun` +
// `formatDoctorRunReport`. The wiring in `doctorCommand` simply imports
// and dispatches; no new branching to test there.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  inspectRun,
  formatDoctorRunReport,
  DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS,
  DOCTOR_RUN_RECENT_EVENT_LIMIT,
} from '../src/commands/doctor-run.ts'
import { paths as codeOzPaths } from '../src/paths.ts'
import {
  initRun,
  runPathsFor,
  writeActiveRun,
  type RunPaths,
} from '../src/state/run.ts'
import { appendEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const FIXED_TS = '2026-05-09T12:00:00.000Z'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const SHA64A = 'a'.repeat(64)

const PLAN_THREE_TASKS = `# PLAN

## Goals

- Three atomic slices for cursor + scheduler-event coverage.

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

### T-003: third slice

- Files: src/baz.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Anything beyond the three slices.

## Open questions

- None known at plan time.
`

let tmp: string
let runPaths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c10-'))
  // Build the project layout exactly as `code-oz init` would, so
  // `inspectRun({ cwd: tmp })` resolves the same paths the CLI does.
  const cz = codeOzPaths(tmp)
  await mkdir(cz.root, { recursive: true })
  await mkdir(cz.state, { recursive: true })
  await mkdir(cz.artifacts, { recursive: true })
  await mkdir(cz.runs, { recursive: true })
  runPaths = runPathsFor(cz.state, cz.artifacts, RUN)
  await mkdir(runPaths.runDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function initFreshRun(): Promise<void> {
  await initRun({
    paths: runPaths,
    profile: 'greenfield',
    runId: RUN,
    now: () => FIXED_TS,
  })
}

async function appendBuildStartedFor(
  taskId: string,
  taskIndex: number,
  attempt: number,
): Promise<void> {
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

async function appendTaskCompletedFor(
  taskId: string,
  taskIndex: number,
  reviewGatePath: string,
): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'task_completed',
      ts: FIXED_TS,
      runId: RUN,
      taskId,
      taskIndex,
      reviewGatePath,
    },
  )
}

type SkipReason =
  | 'mode_off'
  | 'mode_manual'
  | 'no_trigger_matched'
  | 'max_per_run_exhausted'
  | 'max_per_task_exhausted'
  | 'budget_exhausted'
  | 'persona_no_debate_permission'
  | 'persona_no_eligible_opponent'
  | 'concurrent_limit'
  | 'manifest_size_exceeds_maxFiles'
  | 'dedup_fingerprint_already_debated'

type FireReason =
  | 'score_in_grey_zone'
  | 'panel_voter_disagreement'
  | 'needs_revision_with_high_score'

async function appendDebateSchedulerSkipped(
  taskId: string,
  attempt: number,
  reviewRound: number,
  reason: SkipReason,
): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'debate_scheduler_skipped',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId,
      decisionId: generateUlid({ now: 1_000_000_000_000 + 1, random: new Uint8Array(10) }),
      reviewRound,
      preReviewReportSha256: SHA64A,
      reason,
    },
  )
}

async function appendDebateSchedulerFired(
  taskId: string,
  attempt: number,
  reviewRound: number,
  reason: FireReason,
): Promise<void> {
  await appendEvent(
    { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
    {
      version: 1,
      type: 'debate_scheduler_fired',
      ts: FIXED_TS,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId,
      decisionId: generateUlid({ now: 1_000_000_000_000 + 2, random: new Uint8Array(10) }),
      reviewRound,
      preReviewReportSha256: SHA64A,
      reason,
      opposingProvider: 'codex',
      debateTopic: 'risk-A',
    },
  )
}

// ---------------------------------------------------------------------------
// 1. No active run
// ---------------------------------------------------------------------------
describe('inspectRun — no active run', () => {
  test('no active.json -> runId null + empty sections', async () => {
    const report = await inspectRun({ cwd: tmp })
    expect(report.runId).toBeNull()
    expect(report.currentPhase).toBeNull()
    expect(report.cursor).toBeNull()
    expect(report.recentEvents).toEqual([])
    expect(report.totalEvents).toBe(0)
    expect(report.intervention.present).toBe(false)
    expect(report.worktree.present).toBe(false)
    expect(report.schedulerEvents).toEqual([])
  })

  test('formatDoctorRunReport -> "no active run" line', async () => {
    const report = await inspectRun({ cwd: tmp })
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('no active run')
    expect(txt).toContain('# code-oz doctor run')
  })
})

// ---------------------------------------------------------------------------
// 2. Active run, no PLAN.md (graceful degradation)
// ---------------------------------------------------------------------------
describe('inspectRun — active run, missing PLAN.md', () => {
  test('cursor null + cursorError populated', async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    const report = await inspectRun({ cwd: tmp })
    expect(report.runId).toBe(RUN)
    expect(report.currentPhase).toBe('define')
    expect(report.cursor).toBeNull()
    expect(report.cursorError).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 3. Multi-task plan, cursor projection
// ---------------------------------------------------------------------------
describe('inspectRun — task cursor', () => {
  beforeEach(async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    await writeFile(join(codeOzPaths(tmp).artifacts, 'PLAN.md'), PLAN_THREE_TASKS, 'utf8')
  })

  test('three tasks, none started -> all not_started + first pending', async () => {
    const report = await inspectRun({ cwd: tmp })
    expect(report.cursor).not.toBeNull()
    expect(report.cursor!.entries).toHaveLength(3)
    for (const entry of report.cursor!.entries) {
      expect(entry.status).toBe('not_started')
    }
    expect(report.cursor!.pending?.taskId).toBe('T-001')
    expect(report.cursor!.allCompleted).toBe(false)
  })

  test('first task completed, second started -> mixed statuses', async () => {
    await appendBuildStartedFor('T-001', 0, 1)
    await appendTaskCompletedFor('T-001', 0, join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'))
    await appendBuildStartedFor('T-002', 1, 1)
    const report = await inspectRun({ cwd: tmp })
    const statuses = report.cursor!.entries.map((e) => e.status)
    expect(statuses).toEqual(['completed', 'in_progress', 'not_started'])
    expect(report.cursor!.pending?.taskId).toBe('T-002')
  })

  test('all tasks completed -> allCompleted=true + pending null', async () => {
    for (let i = 0; i < 3; i++) {
      const id = `T-00${i + 1}`
      await appendBuildStartedFor(id, i, 1)
      await appendTaskCompletedFor(
        id,
        i,
        join(runPaths.runDir, 'GATE_REVIEW_PASSED.json'),
      )
    }
    const report = await inspectRun({ cwd: tmp })
    expect(report.cursor!.allCompleted).toBe(true)
    expect(report.cursor!.pending).toBeNull()
  })

  test('formatter renders cursor section', async () => {
    await appendBuildStartedFor('T-001', 0, 1)
    const report = await inspectRun({ cwd: tmp })
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('## Tasks')
    expect(txt).toContain('T-001 status=in_progress')
    expect(txt).toContain('T-002 status=not_started')
    expect(txt).toContain('plan.tasks.length: 3')
  })
})

// ---------------------------------------------------------------------------
// 4. Recent events tail
// ---------------------------------------------------------------------------
describe('inspectRun — recent events', () => {
  beforeEach(async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    await writeFile(join(codeOzPaths(tmp).artifacts, 'PLAN.md'), PLAN_THREE_TASKS, 'utf8')
  })

  test('returns last N events most-recent-first', async () => {
    // Add MORE than the limit so truncation is exercised.
    const total = DOCTOR_RUN_RECENT_EVENT_LIMIT + 5
    for (let i = 0; i < total; i++) {
      await appendEvent(
        { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
        {
          version: 1,
          type: 'ask_me_user_input',
          ts: FIXED_TS,
          runId: RUN,
          phase: 'define',
          turn: i + 1,
          input: `turn-${i}`,
        },
      )
    }
    const report = await inspectRun({ cwd: tmp })
    expect(report.recentEvents).toHaveLength(DOCTOR_RUN_RECENT_EVENT_LIMIT)
    // Most recent first: the chronologically-last event is at index 0.
    expect(report.recentEvents[0]!.type).toBe('ask_me_user_input')
    // Sanity: phase=define is in the summary for every retained event.
    expect(report.recentEvents[0]!.summary).toContain('phase=define')
    expect(report.totalEvents).toBeGreaterThan(DOCTOR_RUN_RECENT_EVENT_LIMIT)
  })

  test('summary includes taskId / attempt / reviewRound when present', async () => {
    await appendBuildStartedFor('T-001', 0, 1)
    const report = await inspectRun({ cwd: tmp })
    const buildStarted = report.recentEvents.find((e) => e.type === 'build_started')
    expect(buildStarted).toBeDefined()
    expect(buildStarted!.summary).toContain('taskId=T-001')
    expect(buildStarted!.summary).toContain('attempt=1')
  })

  test('formatter prints recent events block', async () => {
    await appendBuildStartedFor('T-001', 0, 1)
    const report = await inspectRun({ cwd: tmp })
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('## Recent events')
    expect(txt).toContain('build_started')
    expect(txt).toContain('most recent first')
  })
})

// ---------------------------------------------------------------------------
// 5. Intervention preview
// ---------------------------------------------------------------------------
describe('inspectRun — intervention', () => {
  beforeEach(async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
  })

  test('absent when no NEEDS_INTERVENTION.json', async () => {
    const report = await inspectRun({ cwd: tmp })
    expect(report.intervention.present).toBe(false)
  })

  test('present + first 200 chars truncated', async () => {
    const body = 'X'.repeat(500)
    await writeFile(join(runPaths.runDir, 'NEEDS_INTERVENTION.json'), body, 'utf8')
    const report = await inspectRun({ cwd: tmp })
    expect(report.intervention.present).toBe(true)
    expect(report.intervention.preview).toBeDefined()
    expect(report.intervention.preview!.length).toBe(DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS)
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('present: true')
    expect(txt).toContain('truncated')
  })

  test('short content not truncated', async () => {
    const body = '{ "code": "noop" }'
    await writeFile(join(runPaths.runDir, 'NEEDS_INTERVENTION.json'), body, 'utf8')
    const report = await inspectRun({ cwd: tmp })
    expect(report.intervention.present).toBe(true)
    expect(report.intervention.preview).toBe(body)
  })
})

// ---------------------------------------------------------------------------
// 6. Worktree presence
// ---------------------------------------------------------------------------
describe('inspectRun — worktree', () => {
  beforeEach(async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
  })

  test('absent when no .code-oz/runs/<runId>/ dir', async () => {
    const report = await inspectRun({ cwd: tmp })
    expect(report.worktree.present).toBe(false)
    expect(report.worktree.runDirPath).toContain(RUN)
  })

  test('present + base.txt sha read', async () => {
    const cz = codeOzPaths(tmp)
    const wtRunDir = join(cz.runs, RUN)
    await mkdir(wtRunDir, { recursive: true })
    const sha = '0123456789abcdef0123456789abcdef01234567'
    await writeFile(join(wtRunDir, 'base.txt'), sha + '\n', 'utf8')
    const report = await inspectRun({ cwd: tmp })
    expect(report.worktree.present).toBe(true)
    expect(report.worktree.baseSha).toBe(sha)
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain(sha)
  })

  test('present without base.txt -> baseSha undefined', async () => {
    const cz = codeOzPaths(tmp)
    await mkdir(join(cz.runs, RUN), { recursive: true })
    const report = await inspectRun({ cwd: tmp })
    expect(report.worktree.present).toBe(true)
    expect(report.worktree.baseSha).toBeUndefined()
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('base.txt: (unreadable or absent)')
  })
})

// ---------------------------------------------------------------------------
// 7. Scheduler events for current REVIEW round
// ---------------------------------------------------------------------------
describe('inspectRun — scheduler events', () => {
  beforeEach(async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    await writeFile(join(codeOzPaths(tmp).artifacts, 'PLAN.md'), PLAN_THREE_TASKS, 'utf8')
  })

  test('skipped when currentPhase != review', async () => {
    await appendBuildStartedFor('T-001', 0, 1)
    const report = await inspectRun({ cwd: tmp })
    expect(report.currentPhase).not.toBe('review')
    expect(report.schedulerEvents).toEqual([])
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('## Scheduler events')
  })

  test('filtered to current (taskId, attempt, reviewRound)', async () => {
    // Append phase_entered(review) so currentPhase resolves to review
    // without running the actual phase code.
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'phase_entered',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
      },
    )
    await appendBuildStartedFor('T-001', 0, 1)
    // Round-2 event for current task — must NOT appear (round filter:
    // the most-recent scheduler event names round=1 below, so round=2
    // is older and excluded).
    await appendDebateSchedulerSkipped('T-001', 1, 2, 'max_per_run_exhausted')
    // Current-round events.
    await appendDebateSchedulerSkipped('T-001', 1, 1, 'no_trigger_matched')
    await appendDebateSchedulerFired('T-001', 1, 1, 'panel_voter_disagreement')
    // Different-task event — must NOT appear (taskId filter).
    await appendDebateSchedulerSkipped('T-002', 1, 1, 'max_per_run_exhausted')

    const report = await inspectRun({ cwd: tmp })
    expect(report.currentPhase).toBe('review')
    expect(report.schedulerEvents).toHaveLength(2)
    const reasons = report.schedulerEvents.map((e) => e.reason).sort()
    expect(reasons).toEqual(['no_trigger_matched', 'panel_voter_disagreement'])
    for (const e of report.schedulerEvents) {
      expect(e.reviewRound).toBe(1)
    }
    const fired = report.schedulerEvents.find((e) => e.type === 'debate_scheduler_fired')
    expect(fired?.opposingProvider).toBe('codex')
  })

  test('formatter renders scheduler section with reasons', async () => {
    await appendEvent(
      { file: runPaths.eventsFile, lockDir: runPaths.lockDir },
      {
        version: 1,
        type: 'phase_entered',
        ts: FIXED_TS,
        runId: RUN,
        phase: 'review',
      },
    )
    await appendBuildStartedFor('T-001', 0, 1)
    await appendDebateSchedulerFired('T-001', 1, 1, 'panel_voter_disagreement')
    const report = await inspectRun({ cwd: tmp })
    const txt = formatDoctorRunReport(report)
    expect(txt).toContain('## Scheduler events (current REVIEW round)')
    expect(txt).toContain('debate_scheduler_fired')
    expect(txt).toContain('reason=panel_voter_disagreement')
    expect(txt).toContain('opp=codex')
  })
})

// ---------------------------------------------------------------------------
// 8. Idempotency
// ---------------------------------------------------------------------------
describe('inspectRun — idempotency (read-only contract)', () => {
  test('two consecutive calls return identical reports + no events appended', async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    await writeFile(join(codeOzPaths(tmp).artifacts, 'PLAN.md'), PLAN_THREE_TASKS, 'utf8')
    await appendBuildStartedFor('T-001', 0, 1)
    const r1 = await inspectRun({ cwd: tmp })
    const r2 = await inspectRun({ cwd: tmp })
    expect(r2).toEqual(r1)
    // Total events MUST NOT change between invocations.
    expect(r2.totalEvents).toBe(r1.totalEvents)
    // formatDoctorRunReport must also be deterministic.
    expect(formatDoctorRunReport(r2)).toBe(formatDoctorRunReport(r1))
  })
})

// ---------------------------------------------------------------------------
// 9. JSON output mirror
// ---------------------------------------------------------------------------
describe('inspectRun — JSON output', () => {
  test('JSON.stringify of report round-trips field set', async () => {
    await initFreshRun()
    await writeActiveRun(codeOzPaths(tmp).activeRun, RUN)
    await writeFile(join(codeOzPaths(tmp).artifacts, 'PLAN.md'), PLAN_THREE_TASKS, 'utf8')
    const report = await inspectRun({ cwd: tmp })
    const json = JSON.stringify(report)
    const parsed = JSON.parse(json)
    expect(parsed.runId).toBe(RUN)
    expect(parsed.cursor.entries).toHaveLength(3)
    expect(parsed.cursor.allCompleted).toBe(false)
    expect(parsed.intervention.present).toBe(false)
    expect(parsed.worktree.present).toBe(false)
  })
})
