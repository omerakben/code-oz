import { describe, test, expect } from 'bun:test'
import { validateEvent } from '../src/state/events.ts'
import { EVENT_TYPES, type PhaseEvent } from '../src/state/schemas.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const PHASE = 'build'
const TS = '2026-04-30T10:00:00.000Z'
const FILE = 'events.jsonl'
const SHA40 = 'a'.repeat(40)
const SHA64 = '7f3a9b1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f50617283940a1b2c3d4'
const TASK = 'T-001'

const WORKTREE_CREATED: PhaseEvent = {
  version: 1,
  type: 'worktree_created',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  baseCommitSha: SHA40,
  worktreePath: '/abs/.code-oz/runs/abc/worktree',
  dirtyTreePolicy: 'clean-base',
}

const WORKTREE_FAILED: PhaseEvent = {
  version: 1,
  type: 'worktree_failed',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  step: 2,
  code: 'worktree_create_path_exists',
  reason: 'destination path already exists',
}

const WORKTREE_PATCH_APPLIED: PhaseEvent = {
  version: 1,
  type: 'worktree_patch_applied',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  patchSha256: SHA64,
  patchPath: '.code-oz/runs/abc/patches/T-001-attempt-1.patch',
  attempt: 1,
  taskId: TASK,
}

const WORKTREE_PATCH_FAILED: PhaseEvent = {
  version: 1,
  type: 'worktree_patch_failed',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  code: 'build_patch_apply_check_failed',
  attempt: 1,
  taskId: TASK,
  reason: 'hunk #2 fails to apply at line 41',
}

const WORKTREE_FORENSICS: PhaseEvent = {
  version: 1,
  type: 'worktree_forensics_preserved',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  attempt: 1,
  forensicsPath: '/abs/.code-oz/runs/abc/forensics/1',
  entries: ['diff.patch', 'stdout.log', 'stderr.log', 'BUILD_REPORT.md', 'manifest.txt', 'prompt-constraints.md'],
}

const WORKTREE_DESTROYED: PhaseEvent = {
  version: 1,
  type: 'worktree_destroyed',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  attempt: 1,
  worktreePath: '/abs/.code-oz/runs/abc/worktree',
}

const BUILD_STARTED: PhaseEvent = {
  version: 1,
  type: 'build_started',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  agent: 'builder',
  attempt: 1,
  baseCommitSha: SHA40,
  taskId: TASK,
}

const BUILD_PATCH_APPLIED: PhaseEvent = {
  version: 1,
  type: 'build_patch_applied',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  agent: 'builder',
  patchSha256: SHA64,
  attempt: 1,
  taskId: TASK,
}

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
  promptSnapshotSha256: SHA64,
}

const BUILD_FAILED: PhaseEvent = {
  version: 1,
  type: 'build_failed',
  ts: TS,
  runId: RUN_ID,
  phase: PHASE,
  agent: 'builder',
  attempt: 1,
  taskId: TASK,
  code: 'build_persona_protocol_violation',
  reason: 'response missing <build-ready/> marker after 2 attempts',
}

describe('EVENT_TYPES', () => {
  test('includes the M7 worktree event types', () => {
    expect(EVENT_TYPES).toContain('worktree_created')
    expect(EVENT_TYPES).toContain('worktree_failed')
    expect(EVENT_TYPES).toContain('worktree_patch_applied')
    expect(EVENT_TYPES).toContain('worktree_patch_failed')
    expect(EVENT_TYPES).toContain('worktree_forensics_preserved')
    expect(EVENT_TYPES).toContain('worktree_destroyed')
  })
  test('includes the M7 build event types', () => {
    expect(EVENT_TYPES).toContain('build_started')
    expect(EVENT_TYPES).toContain('build_patch_applied')
    expect(EVENT_TYPES).toContain('build_completed')
    expect(EVENT_TYPES).toContain('build_failed')
  })
})

describe('validateEvent — M7 happy paths', () => {
  test('accepts worktree_created', () => {
    expect(validateEvent(WORKTREE_CREATED, FILE)).toBeNull()
  })
  test('accepts worktree_created with stash-and-pin policy', () => {
    expect(validateEvent({ ...WORKTREE_CREATED, dirtyTreePolicy: 'stash-and-pin' }, FILE)).toBeNull()
  })
  test('accepts worktree_failed', () => {
    expect(validateEvent(WORKTREE_FAILED, FILE)).toBeNull()
  })
  test('accepts worktree_patch_applied', () => {
    expect(validateEvent(WORKTREE_PATCH_APPLIED, FILE)).toBeNull()
  })
  test('accepts worktree_patch_failed', () => {
    expect(validateEvent(WORKTREE_PATCH_FAILED, FILE)).toBeNull()
  })
  test('accepts worktree_forensics_preserved', () => {
    expect(validateEvent(WORKTREE_FORENSICS, FILE)).toBeNull()
  })
  test('accepts worktree_destroyed', () => {
    expect(validateEvent(WORKTREE_DESTROYED, FILE)).toBeNull()
  })
  test('accepts build_started', () => {
    expect(validateEvent(BUILD_STARTED, FILE)).toBeNull()
  })
  test('accepts build_patch_applied', () => {
    expect(validateEvent(BUILD_PATCH_APPLIED, FILE)).toBeNull()
  })
  test('accepts build_completed', () => {
    expect(validateEvent(BUILD_COMPLETED, FILE)).toBeNull()
  })
  test('accepts build_failed', () => {
    expect(validateEvent(BUILD_FAILED, FILE)).toBeNull()
  })
})

describe('validateEvent — M7 base SHA must be 40 hex', () => {
  test('rejects too-short baseCommitSha', () => {
    const issue = validateEvent({ ...WORKTREE_CREATED, baseCommitSha: 'abc' } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('baseCommitSha')
  })
  test('rejects non-hex baseCommitSha', () => {
    const issue = validateEvent({ ...WORKTREE_CREATED, baseCommitSha: 'Z'.repeat(40) } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('rejects upper-case hex baseCommitSha', () => {
    const issue = validateEvent({ ...WORKTREE_CREATED, baseCommitSha: 'A'.repeat(40) } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
})

describe('validateEvent — M7 patch SHA must be 64 hex', () => {
  test('rejects 40-hex patchSha256 (must be 64)', () => {
    const issue = validateEvent(
      { ...WORKTREE_PATCH_APPLIED, patchSha256: SHA40 } as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('patchSha256')
  })
})

describe('validateEvent — M7 taskId must match T-NNN', () => {
  test('rejects taskId without T- prefix', () => {
    const issue = validateEvent({ ...BUILD_STARTED, taskId: '001' } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('taskId')
  })
  test('rejects taskId with too few digits', () => {
    const issue = validateEvent({ ...BUILD_STARTED, taskId: 'T-1' } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('accepts taskId with 4+ digits', () => {
    expect(validateEvent({ ...BUILD_STARTED, taskId: 'T-9999' } as PhaseEvent, FILE)).toBeNull()
  })
})

describe('validateEvent — M7 attempt must be positive integer', () => {
  test('rejects attempt = 0', () => {
    const issue = validateEvent({ ...BUILD_STARTED, attempt: 0 } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('attempt')
  })
  test('rejects negative attempt', () => {
    const issue = validateEvent({ ...BUILD_STARTED, attempt: -1 } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('rejects non-integer attempt', () => {
    const issue = validateEvent({ ...BUILD_STARTED, attempt: 1.5 } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
})

describe('validateEvent — M7 worktree_failed.step enum', () => {
  test('rejects step 0', () => {
    const issue = validateEvent({ ...WORKTREE_FAILED, step: 0 } as unknown as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('rejects step 5', () => {
    const issue = validateEvent({ ...WORKTREE_FAILED, step: 5 } as unknown as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('accepts step 1, 2, 3, 4', () => {
    for (const step of [1, 2, 3, 4] as const) {
      expect(validateEvent({ ...WORKTREE_FAILED, step }, FILE)).toBeNull()
    }
  })
})

describe('validateEvent — M7 dirtyTreePolicy enum', () => {
  test('rejects unknown policy', () => {
    const issue = validateEvent(
      { ...WORKTREE_CREATED, dirtyTreePolicy: 'force' } as unknown as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('dirtyTreePolicy')
  })
})

describe('validateEvent — M7 forensics.entries non-empty', () => {
  test('rejects empty entries array', () => {
    const issue = validateEvent({ ...WORKTREE_FORENSICS, entries: [] } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
    expect(issue?.rule).toContain('entries')
  })
  test('rejects non-string entries', () => {
    const issue = validateEvent(
      { ...WORKTREE_FORENSICS, entries: ['ok', 42] } as unknown as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
  })
})

describe('validateEvent — M7 build_completed.changedFileCount', () => {
  test('rejects negative changedFileCount', () => {
    const issue = validateEvent({ ...BUILD_COMPLETED, changedFileCount: -1 } as PhaseEvent, FILE)
    expect(issue).not.toBeNull()
  })
  test('accepts zero changedFileCount (no-op patch is valid event-wise)', () => {
    expect(validateEvent({ ...BUILD_COMPLETED, changedFileCount: 0 }, FILE)).toBeNull()
  })
})

describe('validateEvent — M7 phase must be canonical', () => {
  test('rejects unknown phase on worktree_created', () => {
    const issue = validateEvent(
      { ...WORKTREE_CREATED, phase: 'phantom' } as unknown as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('event_invalid_phase')
  })
  test('rejects unknown phase on build_started', () => {
    const issue = validateEvent(
      { ...BUILD_STARTED, phase: 'phantom' } as unknown as PhaseEvent,
      FILE,
    )
    expect(issue).not.toBeNull()
    expect(issue?.code).toBe('event_invalid_phase')
  })
})
