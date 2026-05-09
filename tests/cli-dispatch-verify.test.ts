// CLI dispatchVerify tests (M16 C7).
//
// Same scope discipline as C6: helper unit tests + dispatcher refusal
// cases. The happy-path VERIFY pass against a real BUILD output lives
// in the C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts).
//
// Codex C7 pre-design review pinned three load-bearing concerns the
// helpers + dispatcher implement:
//
//   1. scheduleAttemptNPlus1 owns the post-fail orchestration —
//      worktree removal + worktree_destroyed + verify_restart_initiated.
//      dispatchVerify calls it on result.status==='failed'.
//   2. handleActiveRun's pre-route to dispatchBuild closes the
//      restart loop (verify_restart_initiated does NOT change
//      currentPhase via the reducer).
//   3. resolveVerifyArtifacts re-validates BUILD_REPORT.md / patch
//      / prompt shas before invoking runVerify (closes the
//      approve-build → run-verify hand-edit window).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { dispatchVerify } from '../src/commands/run.ts'
import {
  findLatestBuildCompleted,
  findLatestVerifyCompleted,
  findLatestVerifyRestart,
  hasGateRequired,
  resolveVerifyArtifacts,
  shouldRouteToBuildRestart,
} from '../src/commands/dispatch-verify-helpers.ts'
import { parsePlan } from '../src/artifacts/plan.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const FIXED_TS = '2026-05-09T12:00:00.000Z'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let stateDir: string
let artifactRoot: string
let runPaths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c7-'))
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

async function writePlan(): Promise<void> {
  await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
}

function buildCompleted(opts: {
  taskId: string
  attempt: number
  buildReportSha: string
  promptSha: string
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'build_completed',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'build' as const,
    agent: 'builder',
    attempt: opts.attempt,
    taskId: opts.taskId,
    changedFileCount: 1,
    buildReportSha256: opts.buildReportSha,
    promptSnapshotSha256: opts.promptSha,
  } as unknown as LoggedEvent
}

function verifyRestart(opts: {
  taskId: string
  attempt: number
  nextAction: 'restart' | 'intervention'
  nextAttempt?: number
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'verify_restart_initiated',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'verify' as const,
    taskId: opts.taskId,
    attempt: opts.attempt,
    nextAction: opts.nextAction,
    ...(opts.nextAttempt !== undefined ? { nextAttempt: opts.nextAttempt } : {}),
    forensicsPath: join(runPaths.runDir, `forensics/${opts.attempt}/`),
  } as unknown as LoggedEvent
}

function verifyCompleted(opts: { taskId: string; attempt: number }): LoggedEvent {
  return {
    version: 1 as const,
    type: 'verify_completed',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'verify' as const,
    agent: 'verifier',
    attempt: opts.attempt,
    taskId: opts.taskId,
    baseCommitSha: 'a'.repeat(40),
    patchSha256: 'c'.repeat(64),
    verifyReportSha256: 'd'.repeat(64),
    mutationStatus: 'not-applicable' as const,
  } as unknown as LoggedEvent
}

function gateRequired(phase: 'build' | 'verify' | 'review'): LoggedEvent {
  return {
    version: 1 as const,
    type: 'gate_required',
    ts: FIXED_TS,
    runId: RUN,
    phase,
    agent: 'orchestrator',
    artifactPath: 'VERIFY.md',
  } as unknown as LoggedEvent
}

function buildStarted(opts: { taskId: string; attempt: number }): LoggedEvent {
  return {
    version: 1 as const,
    type: 'build_started',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'build' as const,
    agent: 'builder',
    attempt: opts.attempt,
    baseCommitSha: 'a'.repeat(40),
    taskId: opts.taskId,
  } as unknown as LoggedEvent
}

// --- findLatestBuildCompleted -------------------------------------

describe('findLatestBuildCompleted', () => {
  test('returns null when no events match', () => {
    expect(findLatestBuildCompleted([], RUN, 'T-001')).toBeNull()
  })

  test('returns the only matching event', () => {
    const ev = buildCompleted({
      taskId: 'T-001',
      attempt: 1,
      buildReportSha: 'a'.repeat(64),
      promptSha: 'b'.repeat(64),
    })
    const result = findLatestBuildCompleted([ev], RUN, 'T-001')
    expect(result).not.toBeNull()
    expect(result!.attempt).toBe(1)
    expect(result!.buildReportSha256).toBe('a'.repeat(64))
  })

  test('returns the most recent when multiple match', () => {
    const result = findLatestBuildCompleted(
      [
        buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
        buildCompleted({ taskId: 'T-001', attempt: 2, buildReportSha: 'c'.repeat(64), promptSha: 'd'.repeat(64) }),
      ],
      RUN,
      'T-001',
    )
    expect(result!.attempt).toBe(2)
  })

  test('does not match a different taskId', () => {
    const ev = buildCompleted({ taskId: 'T-002', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) })
    expect(findLatestBuildCompleted([ev], RUN, 'T-001')).toBeNull()
  })
})

// --- findLatestVerifyRestart --------------------------------------

describe('findLatestVerifyRestart', () => {
  test('returns null when no events match', () => {
    expect(findLatestVerifyRestart([], RUN, 'T-001')).toBeNull()
  })

  test('returns restart event with nextAttempt', () => {
    const ev = verifyRestart({ taskId: 'T-001', attempt: 1, nextAction: 'restart', nextAttempt: 2 })
    const result = findLatestVerifyRestart([ev], RUN, 'T-001')
    expect(result).not.toBeNull()
    expect(result!.nextAction).toBe('restart')
    expect(result!.nextAttempt).toBe(2)
  })

  test('returns intervention event without nextAttempt', () => {
    const ev = verifyRestart({ taskId: 'T-001', attempt: 4, nextAction: 'intervention' })
    const result = findLatestVerifyRestart([ev], RUN, 'T-001')
    expect(result!.nextAction).toBe('intervention')
    expect(result!.nextAttempt).toBeUndefined()
  })
})

// --- hasGateRequired ----------------------------------------------

describe('hasGateRequired', () => {
  test('false when no events', () => {
    expect(hasGateRequired([], RUN, 'verify')).toBe(false)
  })

  test('true when gate_required matches phase', () => {
    expect(hasGateRequired([gateRequired('verify')], RUN, 'verify')).toBe(true)
  })

  test('false when gate_required is for a different phase', () => {
    expect(hasGateRequired([gateRequired('build')], RUN, 'verify')).toBe(false)
  })
})

// --- findLatestVerifyCompleted ------------------------------------

describe('findLatestVerifyCompleted', () => {
  test('returns null when no events match', () => {
    expect(findLatestVerifyCompleted([], RUN, 'T-001')).toBeNull()
  })

  test('returns latest matching attempt', () => {
    const result = findLatestVerifyCompleted(
      [verifyCompleted({ taskId: 'T-001', attempt: 1 }), verifyCompleted({ taskId: 'T-001', attempt: 2 })],
      RUN,
      'T-001',
    )
    expect(result!.attempt).toBe(2)
  })
})

// --- shouldRouteToBuildRestart ------------------------------------

describe('shouldRouteToBuildRestart', () => {
  const plan = parsePlan(PLAN_TXT, 'PLAN.md')

  test('false when no events', () => {
    expect(shouldRouteToBuildRestart([], plan, RUN)).toBe(false)
  })

  test('true when restart=restart with no subsequent build_started', () => {
    const events: LoggedEvent[] = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      verifyRestart({ taskId: 'T-001', attempt: 1, nextAction: 'restart', nextAttempt: 2 }),
    ]
    expect(shouldRouteToBuildRestart(events, plan, RUN)).toBe(true)
  })

  test('false when next BUILD attempt has already started', () => {
    const events: LoggedEvent[] = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      verifyRestart({ taskId: 'T-001', attempt: 1, nextAction: 'restart', nextAttempt: 2 }),
      buildStarted({ taskId: 'T-001', attempt: 2 }),
    ]
    expect(shouldRouteToBuildRestart(events, plan, RUN)).toBe(false)
  })

  test('false when restart is intervention', () => {
    const events: LoggedEvent[] = [
      buildCompleted({ taskId: 'T-001', attempt: 4, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      verifyRestart({ taskId: 'T-001', attempt: 4, nextAction: 'intervention' }),
    ]
    expect(shouldRouteToBuildRestart(events, plan, RUN)).toBe(false)
  })
})

// --- resolveVerifyArtifacts ---------------------------------------

describe('resolveVerifyArtifacts', () => {
  test("returns 'drift' when no build_completed event present", async () => {
    const result = await resolveVerifyArtifacts({
      events: [],
      runId: RUN,
      taskId: 'T-001',
      cwd: tmp,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') {
      expect(result.reason).toContain('build_completed')
    }
  })

  test("returns 'drift' when BUILD_REPORT.md is missing", async () => {
    const result = await resolveVerifyArtifacts({
      events: [
        buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      ],
      runId: RUN,
      taskId: 'T-001',
      cwd: tmp,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') {
      expect(result.reason).toContain('BUILD_REPORT.md not found')
    }
  })

  test("returns 'drift' on BUILD_REPORT.md sha mismatch", async () => {
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'tampered content', 'utf8')
    const wrongSha = 'a'.repeat(64) // not the sha of "tampered content"
    const result = await resolveVerifyArtifacts({
      events: [
        buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: wrongSha, promptSha: 'b'.repeat(64) }),
      ],
      runId: RUN,
      taskId: 'T-001',
      cwd: tmp,
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') {
      expect(result.reason).toContain('does not match build_completed.buildReportSha256')
    }
  })
})

// --- dispatchVerify refusal paths ---------------------------------

describe('dispatchVerify — refusal cases', () => {
  test('NEEDS_INTERVENTION present → EXIT_INTERVENTION', async () => {
    await writePlan()
    await writeFile(
      join(runPaths.runDir, 'NEEDS_INTERVENTION.json'),
      JSON.stringify(
        {
          version: 1,
          runId: RUN,
          phase: 'verify',
          agent: 'orchestrator',
          code: 'sample_code',
          rule: 'sample rule',
          actionableSuggestions: ['inspect events.jsonl'],
          createdAt: FIXED_TS,
        },
        null,
        2,
      ),
      'utf8',
    )
    const result = await dispatchVerify({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('sample_code')
  })

  test('PLAN.md missing → EXIT_INTERVENTION', async () => {
    const result = await dispatchVerify({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('PLAN.md')
  })

  test('drift on missing build_completed → EXIT_INTERVENTION', async () => {
    await writePlan()
    const result = await dispatchVerify({
      stateDir,
      artifactRoot,
      runId: RUN,
      cwd: tmp,
      now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('VERIFY pre-flight failed')
  })
})
