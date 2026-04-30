import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEvent,
  readEvents,
  validateEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { generateUlid, type PhaseEvent } from '../src/state/schemas.ts'

let tmp: string
let paths: EventLogPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-verify-events-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-04-30T19:00:00Z'

const TASK = 'T-001'
const BASE_SHA = 'a'.repeat(40)
const PATCH_SHA = 'b'.repeat(64)
const REPORT_SHA = 'c'.repeat(64)
const VERIFY_SHA = 'd'.repeat(64)

function makeStarted(over: Partial<Record<string, unknown>> = {}): PhaseEvent {
  return {
    version: 1,
    type: 'verify_started',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    agent: 'verifier',
    attempt: 1,
    taskId: TASK,
    baseCommitSha: BASE_SHA,
    patchSha256: PATCH_SHA,
    buildReportSha256: REPORT_SHA,
    ...over,
  } as PhaseEvent
}

function makeCompleted(over: Partial<Record<string, unknown>> = {}): PhaseEvent {
  return {
    version: 1,
    type: 'verify_completed',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    agent: 'verifier',
    attempt: 1,
    taskId: TASK,
    verifyReportSha256: VERIFY_SHA,
    mutationStatus: 'pass',
    ...over,
  } as PhaseEvent
}

function makeFailed(over: Partial<Record<string, unknown>> = {}): PhaseEvent {
  return {
    version: 1,
    type: 'verify_failed',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    agent: 'verifier',
    attempt: 1,
    taskId: TASK,
    verifyReportSha256: VERIFY_SHA,
    terminationReason: 'exit',
    exitCode: 1,
    failureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
    ...over,
  } as PhaseEvent
}

function makeRestart(over: Partial<Record<string, unknown>> = {}): PhaseEvent {
  return {
    version: 1,
    type: 'verify_restart_initiated',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    taskId: TASK,
    attempt: 1,
    nextAction: 'restart',
    nextAttempt: 2,
    forensicsPath: '.code-oz/runs/01ABC/forensics/1/',
    ...over,
  } as PhaseEvent
}

describe('verify_started — happy and rejection paths', () => {
  test('happy path validates', () => {
    expect(validateEvent(makeStarted(), 'events.jsonl')).toBeNull()
  })

  test('rejects bad baseCommitSha (wrong length)', () => {
    const issue = validateEvent(makeStarted({ baseCommitSha: 'a'.repeat(20) }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('baseCommitSha')
  })

  test('rejects uppercase patchSha256', () => {
    const issue = validateEvent(makeStarted({ patchSha256: 'A'.repeat(64) }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('patchSha256')
  })

  test('rejects bad buildReportSha256 (non-hex)', () => {
    const issue = validateEvent(makeStarted({ buildReportSha256: 'g'.repeat(64) }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('buildReportSha256')
  })

  test('rejects zero attempt', () => {
    const issue = validateEvent(makeStarted({ attempt: 0 }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('attempt')
  })

  test('rejects empty agent', () => {
    const issue = validateEvent(makeStarted({ agent: '' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('agent')
  })

  test('rejects bad taskId format', () => {
    const issue = validateEvent(makeStarted({ taskId: 'task-1' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('taskId')
  })
})

describe('verify_completed — happy and rejection paths', () => {
  test('happy path with mutationStatus=pass', () => {
    expect(validateEvent(makeCompleted({ mutationStatus: 'pass' }), 'events.jsonl')).toBeNull()
  })

  test('happy path with mutationStatus=not-applicable', () => {
    expect(validateEvent(makeCompleted({ mutationStatus: 'not-applicable' }), 'events.jsonl')).toBeNull()
  })

  test('rejects mutationStatus=fail (a fail-mutation means verdict=fail; verify_failed event)', () => {
    const issue = validateEvent(makeCompleted({ mutationStatus: 'fail' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('mutationStatus')
  })

  test('rejects unknown mutationStatus', () => {
    const issue = validateEvent(makeCompleted({ mutationStatus: 'unknown' }), 'events.jsonl')
    expect(issue).not.toBeNull()
  })

  test('rejects bad verifyReportSha256', () => {
    const issue = validateEvent(makeCompleted({ verifyReportSha256: 'short' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('verifyReportSha256')
  })
})

describe('verify_failed — happy and rejection paths', () => {
  test('happy path with terminationReason=exit + exitCode=1', () => {
    expect(validateEvent(makeFailed(), 'events.jsonl')).toBeNull()
  })

  test('happy path with terminationReason=timeout + exitCode=null', () => {
    expect(
      validateEvent(makeFailed({ terminationReason: 'timeout', exitCode: null }), 'events.jsonl'),
    ).toBeNull()
  })

  test('happy path with terminationReason=spawn-error + exitCode=null', () => {
    expect(
      validateEvent(makeFailed({ terminationReason: 'spawn-error', exitCode: null }), 'events.jsonl'),
    ).toBeNull()
  })

  test('happy path with all four cap/error reasons', () => {
    const reasons: ReadonlyArray<'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'> = [
      'exit', 'timeout', 'stdout-cap', 'stderr-cap', 'spawn-error',
    ]
    for (const reason of reasons) {
      const exitCode = reason === 'exit' ? 1 : null
      expect(
        validateEvent(makeFailed({ terminationReason: reason, exitCode }), 'events.jsonl'),
      ).toBeNull()
    }
  })

  test('rejects unknown terminationReason', () => {
    const issue = validateEvent(makeFailed({ terminationReason: 'killed' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('terminationReason')
  })

  test('rejects float exitCode', () => {
    const issue = validateEvent(makeFailed({ exitCode: 1.5 }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('exitCode')
  })

  test('rejects exitCode that is a string', () => {
    const issue = validateEvent(makeFailed({ exitCode: '1' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('exitCode')
  })

  test('rejects empty failureSummary', () => {
    const issue = validateEvent(makeFailed({ failureSummary: '' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('failureSummary')
  })

  test('rejects failureSummary > 200 characters', () => {
    const issue = validateEvent(makeFailed({ failureSummary: 'x'.repeat(201) }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('200 characters')
  })

  test('accepts failureSummary at exactly 200 characters', () => {
    expect(
      validateEvent(makeFailed({ failureSummary: 'x'.repeat(200) }), 'events.jsonl'),
    ).toBeNull()
  })
})

describe('verify_restart_initiated — happy and rejection paths', () => {
  test('happy path with nextAction=restart and nextAttempt=attempt+1', () => {
    expect(validateEvent(makeRestart(), 'events.jsonl')).toBeNull()
  })

  test('happy path with nextAction=intervention (no nextAttempt)', () => {
    expect(
      validateEvent(
        makeRestart({ attempt: 4, nextAction: 'intervention', nextAttempt: undefined }),
        'events.jsonl',
      ),
    ).toBeNull()
  })

  test('rejects nextAction=intervention with nextAttempt set', () => {
    const issue = validateEvent(
      makeRestart({ attempt: 4, nextAction: 'intervention', nextAttempt: 5 }),
      'events.jsonl',
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('omitted')
  })

  test('rejects nextAction=restart without nextAttempt', () => {
    const issue = validateEvent(makeRestart({ nextAttempt: undefined }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('nextAttempt')
  })

  test('rejects nextAttempt mismatch (not equal attempt + 1)', () => {
    const issue = validateEvent(makeRestart({ attempt: 1, nextAttempt: 5 }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('attempt + 1')
  })

  test('rejects unknown nextAction', () => {
    const issue = validateEvent(makeRestart({ nextAction: 'pause' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('nextAction')
  })

  test('rejects empty forensicsPath', () => {
    const issue = validateEvent(makeRestart({ forensicsPath: '' }), 'events.jsonl')
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('forensicsPath')
  })
})

describe('appendEvent + readEvents — round-trip', () => {
  test('all four verify_* events survive write+read intact', async () => {
    await appendEvent(paths, makeStarted())
    await appendEvent(paths, makeFailed())
    await appendEvent(paths, makeRestart())
    await appendEvent(
      paths,
      makeRestart({ attempt: 4, nextAction: 'intervention', nextAttempt: undefined }),
    )

    const events = await readEvents(paths)
    expect(events).toHaveLength(4)
    expect(events[0]?.type).toBe('verify_started')
    expect(events[1]?.type).toBe('verify_failed')
    expect(events[2]?.type).toBe('verify_restart_initiated')
    expect(events[3]?.type).toBe('verify_restart_initiated')

    const restart = events[2] as PhaseEvent & { nextAction: string; nextAttempt: number }
    expect(restart.nextAction).toBe('restart')
    expect(restart.nextAttempt).toBe(2)

    const intervention = events[3] as PhaseEvent & { nextAction: string }
    expect(intervention.nextAction).toBe('intervention')
  })

  test('verify_completed round-trips with mutationStatus', async () => {
    await appendEvent(paths, makeCompleted({ mutationStatus: 'not-applicable' }))
    const events = await readEvents(paths)
    expect(events).toHaveLength(1)
    const completed = events[0] as PhaseEvent & { mutationStatus: string }
    expect(completed.type).toBe('verify_completed')
    expect(completed.mutationStatus).toBe('not-applicable')
  })
})
