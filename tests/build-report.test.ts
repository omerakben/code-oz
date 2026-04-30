import { describe, test, expect } from 'bun:test'
import {
  parseBuildReport,
  serializeBuildReport,
  BuildReportLoadError,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'

const PLAN_SHA = 'a'.repeat(64)
const BASE_SHA = '7'.repeat(40)
const PATCH_SHA = 'b'.repeat(64)
const FILE_SHA_A = '1'.repeat(64)
const FILE_SHA_B = '2'.repeat(64)

const VALID_DATA: BuildReportData = Object.freeze({
  task: {
    taskId: 'T-001',
    title: 'Implement syllable scorer',
    planSha: PLAN_SHA,
    attempt: 1,
  },
  base: {
    worktreePath: '.code-oz/runs/abc/worktree/',
    baseCommitSha: BASE_SHA,
    dirtyAtBase: false,
  },
  patch: {
    patchPath: '.code-oz/runs/abc/patches/T-001-attempt-1.patch',
    patchSha256: PATCH_SHA,
    patchBytes: 4128,
  },
  changedFiles: [
    { path: 'src/scoring/syllable.ts', sha256: FILE_SHA_A, change: 'added' as const },
    { path: 'tests/scoring-syllable.test.ts', sha256: FILE_SHA_B, change: 'added' as const },
  ],
  validationCommand: {
    command: 'bun test tests/scoring-syllable.test.ts',
    workingDirectory: '.code-oz/runs/abc/worktree/',
    timeoutMs: 60000,
    expectedExitCode: 0,
  },
  failureCarryForward: null,
  notes: ['Prefer last-syllable stress for two-syllable surnames.'],
})

describe('serializeBuildReport — happy path', () => {
  test('emits canonical sections in order', () => {
    const out = serializeBuildReport(VALID_DATA)
    expect(out).toContain('# BUILD_REPORT')
    expect(out.indexOf('## Task')).toBeLessThan(out.indexOf('## Base'))
    expect(out.indexOf('## Base')).toBeLessThan(out.indexOf('## Patch'))
    expect(out.indexOf('## Patch')).toBeLessThan(out.indexOf('## Changed files'))
    expect(out.indexOf('## Changed files')).toBeLessThan(out.indexOf('## Validation command'))
    expect(out.indexOf('## Validation command')).toBeLessThan(out.indexOf('## Failure carry-forward'))
    expect(out.indexOf('## Failure carry-forward')).toBeLessThan(out.indexOf('## Notes'))
  })

  test('locks Changed-files grammar', () => {
    const out = serializeBuildReport(VALID_DATA)
    expect(out).toContain(`- src/scoring/syllable.ts | sha256: ${FILE_SHA_A} | change: added`)
  })

  test('writes `None (attempt 1).` when failureCarryForward is null', () => {
    const out = serializeBuildReport(VALID_DATA)
    expect(out).toContain('- None (attempt 1).')
  })

  test('round-trips: parse(serialize(data)) === data', () => {
    const out = serializeBuildReport(VALID_DATA)
    const round = parseBuildReport(out)
    expect(round).toEqual(VALID_DATA)
  })
})

describe('parseBuildReport — happy path', () => {
  test('parses canonical bytes back into structured data', () => {
    const out = serializeBuildReport(VALID_DATA)
    const data = parseBuildReport(out)
    expect(data.task.taskId).toBe('T-001')
    expect(data.base.baseCommitSha).toBe(BASE_SHA)
    expect(data.patch.patchSha256).toBe(PATCH_SHA)
    expect(data.changedFiles).toHaveLength(2)
    expect(data.validationCommand.timeoutMs).toBe(60000)
    expect(data.failureCarryForward).toBeNull()
    expect(data.notes).toHaveLength(1)
  })

  test('handles BOM at start', () => {
    const out = '﻿' + serializeBuildReport(VALID_DATA)
    const data = parseBuildReport(out)
    expect(data.task.taskId).toBe('T-001')
  })

  test('handles \\r\\n line endings', () => {
    const out = serializeBuildReport(VALID_DATA).replace(/\n/g, '\r\n')
    const data = parseBuildReport(out)
    expect(data.task.taskId).toBe('T-001')
  })
})

describe('parseBuildReport — validation rejections', () => {
  test('rejects empty', () => {
    expect(() => parseBuildReport('')).toThrow(BuildReportLoadError)
  })

  test('rejects missing title', () => {
    const text = serializeBuildReport(VALID_DATA).replace('# BUILD_REPORT', '# WRONG')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects missing required H2 section', () => {
    const text = serializeBuildReport(VALID_DATA).replace(/## Notes[\s\S]*$/, '')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects bad task id format', () => {
    const text = serializeBuildReport(VALID_DATA).replace('Task: T-001', 'Task: 001')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects non-40-hex base commit', () => {
    const text = serializeBuildReport(VALID_DATA).replace(`Base commit: ${BASE_SHA}`, 'Base commit: deadbeef')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects non-64-hex patch sha', () => {
    const text = serializeBuildReport(VALID_DATA).replace(`Patch sha256: ${PATCH_SHA}`, 'Patch sha256: short')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects empty Changed files section', () => {
    const text = serializeBuildReport({ ...VALID_DATA, changedFiles: [] })
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects malformed Changed-files bullet', () => {
    const text = serializeBuildReport(VALID_DATA).replace(
      `- src/scoring/syllable.ts | sha256: ${FILE_SHA_A} | change: added`,
      '- src/scoring/syllable.ts (added)',
    )
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects ..-traversing path in Changed files', () => {
    const text = serializeBuildReport(VALID_DATA).replace(
      'src/scoring/syllable.ts',
      '../escape.ts',
    )
    let err: Error | null = null
    try {
      parseBuildReport(text)
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(BuildReportLoadError)
    if (err instanceof BuildReportLoadError) {
      expect(err.issues.some((i) => i.code === 'build_manifest_path_unsafe')).toBe(true)
    }
  })

  test('rejects missing Validation command bullet', () => {
    const text = serializeBuildReport(VALID_DATA).replace(/- Timeout \(ms\): \d+\n/, '')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects non-integer timeout', () => {
    const text = serializeBuildReport(VALID_DATA).replace('Timeout (ms): 60000', 'Timeout (ms): forever')
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects empty Notes', () => {
    const text = serializeBuildReport({ ...VALID_DATA, notes: [] })
    // Serializer emits "- None." for empty notes; that's a valid bullet,
    // so this case actually parses. To trigger the error, strip the bullet
    // entirely from the rendered text.
    const stripped = text.replace(/- None\./, '')
    expect(() => parseBuildReport(stripped)).toThrow(BuildReportLoadError)
  })

  test('rejects Title > 120 chars', () => {
    const text = serializeBuildReport(VALID_DATA).replace(
      'Title: Implement syllable scorer',
      `Title: ${'X'.repeat(121)}`,
    )
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })

  test('rejects attempt > 1 with `None` carry-forward', () => {
    const data = { ...VALID_DATA, task: { ...VALID_DATA.task, attempt: 2 } }
    const text = serializeBuildReport(data) // serializer writes "None (attempt 2)."
    let err: Error | null = null
    try {
      parseBuildReport(text)
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(BuildReportLoadError)
    if (err instanceof BuildReportLoadError) {
      expect(err.issues.some((i) => i.code === 'build_carry_forward_attempt_mismatch')).toBe(true)
    }
  })
})

describe('parseBuildReport — Failure carry-forward populated', () => {
  test('parses populated carry-forward block', () => {
    const data: BuildReportData = {
      ...VALID_DATA,
      task: { ...VALID_DATA.task, attempt: 2 },
      failureCarryForward: {
        priorAttempt: 1,
        priorForensicsPath: '.code-oz/runs/abc/forensics/1/',
        priorValidationCommand: 'bun test x',
        priorVerdict: 'fail (exit code 1, duration 842 ms)',
        priorFailureSummary: 'expected stress on syllable 2; got 1',
        constraint: 'prefer last-syllable stress for two-syllable surnames',
      },
    }
    const text = serializeBuildReport(data)
    const round = parseBuildReport(text)
    expect(round.failureCarryForward).not.toBeNull()
    expect(round.failureCarryForward?.priorAttempt).toBe(1)
  })

  test('rejects carry-forward summary > 200 chars', () => {
    const data: BuildReportData = {
      ...VALID_DATA,
      task: { ...VALID_DATA.task, attempt: 2 },
      failureCarryForward: {
        priorAttempt: 1,
        priorForensicsPath: '.code-oz/runs/abc/forensics/1/',
        priorValidationCommand: 'bun test x',
        priorVerdict: 'fail',
        priorFailureSummary: 'X'.repeat(201),
        constraint: 'short',
      },
    }
    const text = serializeBuildReport(data)
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
  })
})
