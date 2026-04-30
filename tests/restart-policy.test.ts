import { describe, test, expect } from 'bun:test'
import {
  MAX_BUILD_ATTEMPTS,
  decideRestart,
  deriveNextAttempt,
  prepareCarryForward,
  type VerifiedFailedAttempt,
} from '../src/phases/restart-policy.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const RUN = '01HX0000000000000000000000'
const RUN_OTHER = '01HX0000000000000000000001'
const TASK = 'T-001'

function buildCompletedEvent(over: {
  attempt: number
  runId?: string
  taskId?: string
}): LoggedEvent {
  return {
    version: 1,
    type: 'build_completed',
    ts: '2026-04-30T19:00:00Z',
    runId: over.runId ?? RUN,
    phase: 'build',
    agent: 'builder',
    attempt: over.attempt,
    taskId: over.taskId ?? TASK,
    changedFileCount: 1,
    buildReportSha256: 'a'.repeat(64),
  } as LoggedEvent
}

function buildFailedEvent(attempt: number): LoggedEvent {
  return {
    version: 1,
    type: 'build_failed',
    ts: '2026-04-30T19:00:00Z',
    runId: RUN,
    phase: 'build',
    agent: 'builder',
    attempt,
    taskId: TASK,
    code: 'whatever',
    reason: 'r',
  } as LoggedEvent
}

function buildStartedEvent(attempt: number): LoggedEvent {
  return {
    version: 1,
    type: 'build_started',
    ts: '2026-04-30T19:00:00Z',
    runId: RUN,
    phase: 'build',
    agent: 'builder',
    attempt,
    baseCommitSha: 'a'.repeat(40),
    taskId: TASK,
  } as LoggedEvent
}

describe('deriveNextAttempt', () => {
  test('zero events → 1', () => {
    expect(deriveNextAttempt({ events: [], runId: RUN, taskId: TASK })).toBe(1)
  })

  test('one build_completed at attempt=1 → 2', () => {
    expect(
      deriveNextAttempt({
        events: [buildCompletedEvent({ attempt: 1 })],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(2)
  })

  test('multiple build_completed → max + 1', () => {
    expect(
      deriveNextAttempt({
        events: [
          buildCompletedEvent({ attempt: 1 }),
          buildCompletedEvent({ attempt: 2 }),
          buildCompletedEvent({ attempt: 3 }),
        ],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(4)
  })

  test('out-of-order events: still picks max', () => {
    expect(
      deriveNextAttempt({
        events: [
          buildCompletedEvent({ attempt: 3 }),
          buildCompletedEvent({ attempt: 1 }),
          buildCompletedEvent({ attempt: 2 }),
        ],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(4)
  })

  test('build_failed events are NOT counted', () => {
    expect(
      deriveNextAttempt({
        events: [buildCompletedEvent({ attempt: 1 }), buildFailedEvent(2), buildFailedEvent(3)],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(2)
  })

  test('build_started events are NOT counted', () => {
    expect(
      deriveNextAttempt({
        events: [buildStartedEvent(1), buildStartedEvent(2), buildStartedEvent(3)],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(1)
  })

  test('events from a different runId are filtered out', () => {
    expect(
      deriveNextAttempt({
        events: [
          buildCompletedEvent({ attempt: 5, runId: RUN_OTHER }),
          buildCompletedEvent({ attempt: 1, runId: RUN }),
        ],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(2)
  })

  test('events from a different taskId are filtered out', () => {
    expect(
      deriveNextAttempt({
        events: [
          buildCompletedEvent({ attempt: 5, taskId: 'T-999' }),
          buildCompletedEvent({ attempt: 1, taskId: TASK }),
        ],
        runId: RUN,
        taskId: TASK,
      }),
    ).toBe(2)
  })
})

describe('prepareCarryForward', () => {
  const vfa: VerifiedFailedAttempt = {
    attempt: 2,
    forensicsPath: '.code-oz/runs/01HX/forensics/2/',
    validationCommand: 'bun test tests/scoring.test.ts',
    verdict: 'fail (exit code 1, duration 100 ms)',
    failureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
    constraint: 'prefer last-syllable stress for two-syllable surnames.',
  }

  test('field-by-field rename (5 prefixed + 1 unprefixed)', () => {
    const cf = prepareCarryForward(vfa)
    expect(cf.priorAttempt).toBe(2)
    expect(cf.priorForensicsPath).toBe(vfa.forensicsPath)
    expect(cf.priorValidationCommand).toBe(vfa.validationCommand)
    expect(cf.priorVerdict).toBe(vfa.verdict)
    expect(cf.priorFailureSummary).toBe(vfa.failureSummary)
    // Constraint stays unprefixed — it is the active directive.
    expect(cf.constraint).toBe(vfa.constraint)
  })

  test('output is frozen', () => {
    expect(Object.isFrozen(prepareCarryForward(vfa))).toBe(true)
  })
})

describe('decideRestart', () => {
  function vfa(attempt: number): VerifiedFailedAttempt {
    return {
      attempt,
      forensicsPath: `.code-oz/runs/01HX/forensics/${attempt}/`,
      validationCommand: 'bun test t.test.ts',
      verdict: `fail (exit code 1, duration 100 ms)`,
      failureSummary: 's',
      constraint: 'c',
    }
  }

  test('attempt 1 fail → restart at 2', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(1) })
    expect(d.action).toBe('restart')
    if (d.action === 'restart') {
      expect(d.nextAttempt).toBe(2)
      expect(d.carryForward.priorAttempt).toBe(1)
    }
  })

  test('attempt 2 fail → restart at 3', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(2) })
    expect(d.action).toBe('restart')
    if (d.action === 'restart') expect(d.nextAttempt).toBe(3)
  })

  test('attempt 3 fail → restart at 4', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(3) })
    expect(d.action).toBe('restart')
    if (d.action === 'restart') expect(d.nextAttempt).toBe(4)
  })

  test('attempt 4 fail → intervention (cap reached)', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(4) })
    expect(d.action).toBe('intervention')
    if (d.action === 'intervention') {
      expect(d.attemptsExhausted).toBe(4)
      expect(d.reason).toContain('4-attempt cap')
    }
  })

  test('custom maxAttempts=2: attempt 2 fail → intervention', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(2), maxAttempts: 2 })
    expect(d.action).toBe('intervention')
    if (d.action === 'intervention') expect(d.attemptsExhausted).toBe(2)
  })

  test('decision is frozen', () => {
    const d = decideRestart({ verifiedFailedAttempt: vfa(1) })
    expect(Object.isFrozen(d)).toBe(true)
  })

  test('MAX_BUILD_ATTEMPTS = 4 (locked per VERIFY.md § Restart-on-fail step 4)', () => {
    expect(MAX_BUILD_ATTEMPTS).toBe(4)
  })
})
