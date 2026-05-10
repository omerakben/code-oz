// CLI dispatchBuild tests (M16 C6).
//
// Exercises the BUILD-phase dispatcher and its helpers. The goal is to
// lock the refusal cases (Codex Mod #1-#7 from the C6 pre-design
// review) and the structural mapping onto exit codes / stdout / stderr.
//
// Happy-path BUILD execution against a real git worktree is exercised
// by the C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts) — that test
// spawns the binary and walks DEFINE → REVIEW. Doing it inline here
// would duplicate the heavy fixture.
//
// The helper functions in src/commands/dispatch-build-helpers.ts are
// also covered here so the dispatcher can be built up from
// independently-tested pieces.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { dispatchBuild } from '../src/commands/run.ts'
import {
  detectOpenBuildStarted,
  formatInterventionRefusal,
  hasTaskStartedFor,
  loadPlanArtifact,
  NeedsInterventionReadError,
  resolveBuildCarryForward,
  tryReadNeedsInterventionGate,
} from '../src/commands/dispatch-build-helpers.ts'
import type { LoggedEvent, NeedsInterventionGate } from '../src/state/schemas.ts'

const FIXED_TS = '2026-05-09T12:00:00.000Z'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let stateDir: string
let artifactRoot: string
let runPaths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c6-'))
  stateDir = join(tmp, 'state')
  artifactRoot = join(tmp, 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  runPaths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(runPaths.runDir, { recursive: true })
  await mkdir(runPaths.lockDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// --- helpers ------------------------------------------------------

const PLAN_TWO_TASKS = `# PLAN

## Goals

- Decompose into two atomic slices.
- Each slice is independently testable.

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

- SPEC.md acceptance criteria 1 (covered by T-001 and T-002).

## Out of scope

- Anything beyond T-001 and T-002.

## Open questions

- None known at plan time.
`

async function writePlan(): Promise<void> {
  await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TWO_TASKS, 'utf8')
}

async function writeNeedsIntervention(
  gate: Partial<NeedsInterventionGate>,
): Promise<NeedsInterventionGate> {
  const full: NeedsInterventionGate = Object.freeze({
    version: 1 as const,
    runId: RUN,
    phase: 'build' as const,
    agent: 'orchestrator',
    code: 'test_intervention',
    rule: 'a synthetic rule for the test',
    actionableSuggestions: ['inspect events.jsonl', 'remove the gate when resolved'],
    createdAt: FIXED_TS,
    ...gate,
  } as NeedsInterventionGate)
  await writeFile(
    join(runPaths.runDir, 'NEEDS_INTERVENTION.json'),
    JSON.stringify(full, null, 2) + '\n',
    'utf8',
  )
  return full
}

function buildStartedEvent(taskId: string, attempt: number): LoggedEvent {
  return {
    version: 1 as const,
    type: 'build_started',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'build' as const,
    agent: 'builder',
    attempt,
    baseCommitSha: 'a'.repeat(40),
    taskId,
  } as unknown as LoggedEvent
}

function buildCompletedEvent(taskId: string, attempt: number): LoggedEvent {
  return {
    version: 1 as const,
    type: 'build_completed',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'build' as const,
    agent: 'builder',
    attempt,
    taskId,
    baseCommitSha: 'a'.repeat(40),
    buildReportPath: join(artifactRoot, 'BUILD_REPORT.md'),
    buildReportSha256: 'b'.repeat(64),
    patchSha256: 'c'.repeat(64),
    patchByteCount: 100,
    promptSnapshotSha256: 'd'.repeat(64),
  } as unknown as LoggedEvent
}

function verifyRestartEvent(taskId: string, attempt: number): LoggedEvent {
  return {
    version: 1 as const,
    type: 'verify_restart_initiated',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'verify' as const,
    taskId,
    attempt,
    nextAction: 'restart' as const,
    nextAttempt: attempt + 1,
    forensicsPath: join(runPaths.runDir, `forensics/${attempt}/`),
  } as unknown as LoggedEvent
}

function taskStartedEvent(taskId: string, taskIndex: number): LoggedEvent {
  return {
    version: 1 as const,
    type: 'task_started',
    ts: FIXED_TS,
    runId: RUN,
    taskId,
    taskIndex,
  } as unknown as LoggedEvent
}

// --- tryReadNeedsInterventionGate ---------------------------------

describe('tryReadNeedsInterventionGate', () => {
  test('returns null when the file does not exist', async () => {
    const result = await tryReadNeedsInterventionGate(runPaths)
    expect(result).toBeNull()
  })

  test('returns the parsed gate when present', async () => {
    const gate = await writeNeedsIntervention({})
    const result = await tryReadNeedsInterventionGate(runPaths)
    expect(result).not.toBeNull()
    expect(result!.code).toBe(gate.code)
    expect(result!.rule).toBe(gate.rule)
    expect(result!.actionableSuggestions).toEqual([...gate.actionableSuggestions])
  })

  test('throws NeedsInterventionReadError on malformed JSON', async () => {
    await writeFile(join(runPaths.runDir, 'NEEDS_INTERVENTION.json'), '{not valid json', 'utf8')
    await expect(tryReadNeedsInterventionGate(runPaths)).rejects.toBeInstanceOf(
      NeedsInterventionReadError,
    )
  })

  test('throws NeedsInterventionReadError on missing required field', async () => {
    await writeFile(
      join(runPaths.runDir, 'NEEDS_INTERVENTION.json'),
      JSON.stringify({ version: 1, runId: RUN }) + '\n',
      'utf8',
    )
    await expect(tryReadNeedsInterventionGate(runPaths)).rejects.toBeInstanceOf(
      NeedsInterventionReadError,
    )
  })
})

// --- detectOpenBuildStarted ---------------------------------------

describe('detectOpenBuildStarted', () => {
  test('returns null when no build events are present', () => {
    expect(detectOpenBuildStarted([], RUN, 'T-001')).toBeNull()
  })

  test('returns null when build_started has a matching build_completed', () => {
    const events: LoggedEvent[] = [
      buildStartedEvent('T-001', 1),
      buildCompletedEvent('T-001', 1),
    ]
    expect(detectOpenBuildStarted(events, RUN, 'T-001')).toBeNull()
  })

  test('returns the open attempt when build_started has no terminal pair', () => {
    const events: LoggedEvent[] = [buildStartedEvent('T-001', 1)]
    const result = detectOpenBuildStarted(events, RUN, 'T-001')
    expect(result).not.toBeNull()
    expect(result!.attempt).toBe(1)
  })

  test('does not surface events for a different taskId', () => {
    const events: LoggedEvent[] = [buildStartedEvent('T-002', 1)]
    expect(detectOpenBuildStarted(events, RUN, 'T-001')).toBeNull()
  })

  test('surfaces only the most recent unclosed attempt when multiple complete normally', () => {
    const events: LoggedEvent[] = [
      buildStartedEvent('T-001', 1),
      buildCompletedEvent('T-001', 1),
      buildStartedEvent('T-001', 2),
      buildCompletedEvent('T-001', 2),
      buildStartedEvent('T-001', 3),
    ]
    const result = detectOpenBuildStarted(events, RUN, 'T-001')
    expect(result).not.toBeNull()
    expect(result!.attempt).toBe(3)
  })
})

// --- hasTaskStartedFor (R1 finding 5) -----------------------------
//
// dispatchBuild's task_started emission gates on this helper instead
// of `attempt === 1`. Pre-build crash at attempt 1 (after task_started
// but before build_started) leaves attempt still === 1 on retry; the
// presence-keyed gate prevents a duplicate emit.

describe('hasTaskStartedFor', () => {
  test('false on empty event log', () => {
    expect(hasTaskStartedFor([], RUN, 'T-001')).toBe(false)
  })

  test('true when task_started exists for the (runId, taskId)', () => {
    expect(hasTaskStartedFor([taskStartedEvent('T-001', 0)], RUN, 'T-001')).toBe(true)
  })

  test('false when only a different taskId has task_started', () => {
    expect(hasTaskStartedFor([taskStartedEvent('T-002', 1)], RUN, 'T-001')).toBe(false)
  })

  // R1 finding 5 — pre-build crash scenario. attempt === 1 is the
  // common case; the prior shape would re-emit task_started on retry.
  test('detects prior task_started even when no build_started followed (pre-build-crash)', () => {
    const events: LoggedEvent[] = [taskStartedEvent('T-001', 0)]
    expect(hasTaskStartedFor(events, RUN, 'T-001')).toBe(true)
  })
})

// --- loadPlanArtifact ---------------------------------------------

describe('loadPlanArtifact', () => {
  test('returns the parsed plan when PLAN.md exists', async () => {
    await writePlan()
    const plan = await loadPlanArtifact(artifactRoot)
    expect(plan.tasks.length).toBe(2)
    expect(plan.tasks[0]!.id).toBe('T-001')
    expect(plan.tasks[1]!.id).toBe('T-002')
  })

  test('throws when PLAN.md is missing', async () => {
    await expect(loadPlanArtifact(artifactRoot)).rejects.toThrow()
  })
})

// --- resolveBuildCarryForward -------------------------------------

describe('resolveBuildCarryForward', () => {
  test("attempt 1 returns 'none'", async () => {
    const result = await resolveBuildCarryForward({
      events: [],
      runId: RUN,
      taskId: 'T-001',
      attempt: 1,
      artifactRoot,
    })
    expect(result.kind).toBe('none')
  })

  test("attempt > 1 with no prior completion or restart returns 'drift'", async () => {
    const result = await resolveBuildCarryForward({
      events: [],
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
  })

  test("attempt > 1 with build_completed but no restart returns 'awaiting-approve'", async () => {
    const result = await resolveBuildCarryForward({
      events: [buildCompletedEvent('T-001', 1)],
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('awaiting-approve')
    if (result.kind === 'awaiting-approve') {
      expect(result.priorAttempt).toBe(1)
    }
  })

  test("attempt > 1 with restart signal but missing VERIFY.md returns 'drift'", async () => {
    const result = await resolveBuildCarryForward({
      events: [
        buildStartedEvent('T-001', 1),
        buildCompletedEvent('T-001', 1),
        verifyRestartEvent('T-001', 1),
      ],
      runId: RUN,
      taskId: 'T-001',
      attempt: 2,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
  })
})

// --- formatInterventionRefusal ------------------------------------

describe('formatInterventionRefusal', () => {
  test('renders code, rule, and actionable suggestions', async () => {
    const gate = await writeNeedsIntervention({})
    const text = formatInterventionRefusal(gate, RUN)
    expect(text).toContain(gate.code)
    expect(text).toContain(gate.rule)
    for (const s of gate.actionableSuggestions) {
      expect(text).toContain(s)
    }
    expect(text).toContain(RUN)
  })
})

// --- dispatchBuild refusal paths ----------------------------------
//
// These exercise dispatchBuild WITHOUT reaching runBuild — the
// refusals fire before persona invocation. The happy path lands in
// the C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts).

describe('dispatchBuild — refusal cases', () => {
  test('NEEDS_INTERVENTION present → EXIT_INTERVENTION + structured stderr', async () => {
    await writePlan()
    await writeNeedsIntervention({ code: 'sample_code', rule: 'sample rule' })
    const result = await dispatchBuild({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('sample_code')
    expect(result.stderr).toContain('sample rule')
    expect(result.stdout).toBeUndefined()
  })

  test('PLAN.md missing → EXIT_INTERVENTION', async () => {
    const result = await dispatchBuild({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('PLAN.md')
  })

  test('--task not in PLAN.md → EXIT_USAGE', async () => {
    await writePlan()
    const result = await dispatchBuild({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      taskOverride: 'T-999',
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('T-999')
    expect(result.stderr).toContain('not found')
  })
})
