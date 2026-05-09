import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { type PhaseEvent } from '../src/state/schemas.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const PHASE = 'build'
const TS = '2026-04-30T10:00:00.000Z'
const FILE = 'events.jsonl'
const SHA64 = '7f3a9b1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f50617283940a1b2c3d4'
const PROMPT_SHA64 = 'a0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9'
const TASK = 'T-001'

const BUILD_COMPLETED: PhaseEvent = {
  version: 1,
  type: 'build_completed',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  agent: 'builder',
  attempt: 1,
  taskId: TASK,
  changedFileCount: 3,
  buildReportSha256: SHA64,
  promptSnapshotSha256: PROMPT_SHA64,
}

describe('validateEvent — build_completed.promptSnapshotSha256 happy path', () => {
  test('accepts canonical build_completed with valid 64-hex promptSnapshotSha256', () => {
    expect(validateEvent(BUILD_COMPLETED, FILE)).toBeNull()
  })
})

describe('validateEvent — build_completed.promptSnapshotSha256 rejection paths', () => {
  test('rejects missing promptSnapshotSha256', () => {
    const evt: any = { ...BUILD_COMPLETED }
    delete evt.promptSnapshotSha256
    const issue = validateEvent(evt, FILE)
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('build_completed.promptSnapshotSha256')
  })

  test('rejects non-hex promptSnapshotSha256 (g-chars)', () => {
    const issue = validateEvent(
      { ...BUILD_COMPLETED, promptSnapshotSha256: 'g'.repeat(64) } as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('build_completed.promptSnapshotSha256')
  })

  test('rejects wrong-length promptSnapshotSha256 (63 chars)', () => {
    const issue = validateEvent(
      { ...BUILD_COMPLETED, promptSnapshotSha256: 'a'.repeat(63) } as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('build_completed.promptSnapshotSha256')
  })

  test('rejects upper-case promptSnapshotSha256 (regex is lower-case only)', () => {
    const issue = validateEvent(
      { ...BUILD_COMPLETED, promptSnapshotSha256: 'A'.repeat(64) } as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('build_completed.promptSnapshotSha256')
  })

  test('rejects empty-string promptSnapshotSha256', () => {
    const issue = validateEvent(
      { ...BUILD_COMPLETED, promptSnapshotSha256: '' } as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('build_completed.promptSnapshotSha256')
  })
})
