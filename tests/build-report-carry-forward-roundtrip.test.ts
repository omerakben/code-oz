import { describe, test, expect } from 'bun:test'
import {
  parseBuildReport,
  serializeBuildReport,
  type BuildReportCarryForward,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'

const PLAN_SHA = 'a'.repeat(64)
const BASE_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const ENTRY_SHA = 'd'.repeat(64)

function dataWithCarryForward(cf: BuildReportCarryForward | null): BuildReportData {
  return {
    task: {
      taskId: 'T-001',
      title: 'Apply last-syllable stress',
      planSha: PLAN_SHA,
      attempt: cf === null ? 1 : cf.priorAttempt + 1,
    },
    base: {
      worktreePath: '.code-oz/runs/01HX/worktree/',
      baseCommitSha: BASE_SHA,
      dirtyAtBase: false,
    },
    patch: {
      patchPath: '.code-oz/runs/01HX/patches/attempt-1.patch',
      patchSha256: PATCH_SHA,
      patchBytes: 256,
    },
    changedFiles: [{ path: 'src/foo.ts', sha256: ENTRY_SHA, change: 'modified' }],
    validationCommand: {
      command: 'bun test tests/foo.test.ts',
      workingDirectory: '.code-oz/runs/<runId>/worktree/',
      timeoutMs: 60_000,
      expectedExitCode: 0,
    },
    failureCarryForward: cf,
    notes: ['Risk: noted in plan.'],
  }
}

describe('BUILD_REPORT.md carry-forward round-trip', () => {
  test('attempt 2 with populated carry-forward survives serialize/parse', () => {
    const cf: BuildReportCarryForward = {
      priorAttempt: 1,
      priorForensicsPath: '.code-oz/runs/01HX/forensics/1/',
      priorValidationCommand: 'bun test tests/foo.test.ts',
      priorVerdict: 'fail (exit code 1, duration 100 ms)',
      priorFailureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
      constraint: 'prefer last-syllable stress for two-syllable surnames.',
    }
    const data = dataWithCarryForward(cf)
    const round = parseBuildReport(serializeBuildReport(data))
    expect(round.failureCarryForward).toEqual(cf)
    expect(round.task.attempt).toBe(2)
  })

  test('attempt 4 with priorAttempt 3 (last legal restart before cap)', () => {
    const cf: BuildReportCarryForward = {
      priorAttempt: 3,
      priorForensicsPath: '.code-oz/runs/01HX/forensics/3/',
      priorValidationCommand: 'bun test tests/foo.test.ts',
      priorVerdict: 'fail (exit code 1, duration 100 ms)',
      priorFailureSummary: 'attempt 3 still failing.',
      constraint: 'try the alternative stress assignment.',
    }
    const data = dataWithCarryForward(cf)
    const round = parseBuildReport(serializeBuildReport(data))
    expect(round.failureCarryForward?.priorAttempt).toBe(3)
    expect(round.task.attempt).toBe(4)
  })

  test('attempt 1 with no carry-forward (the canonical first try)', () => {
    const data = dataWithCarryForward(null)
    const round = parseBuildReport(serializeBuildReport(data))
    expect(round.failureCarryForward).toBeNull()
    expect(round.task.attempt).toBe(1)
  })

  test('Constraint stays unprefixed (the active directive)', () => {
    const cf: BuildReportCarryForward = {
      priorAttempt: 2,
      priorForensicsPath: '.code-oz/runs/01HX/forensics/2/',
      priorValidationCommand: 'bun test foo.test.ts',
      priorVerdict: 'fail (exit code 1, duration 100 ms)',
      priorFailureSummary: 's',
      constraint: 'directive for next attempt',
    }
    const data = dataWithCarryForward(cf)
    const text = serializeBuildReport(data)
    // Locked rendering: 5 prior-prefixed bullets + 1 unprefixed Constraint.
    expect(text).toContain('- Prior attempt: 2')
    expect(text).toContain('- Constraint: directive for next attempt')
    // The Constraint line must NOT have a `Prior` prefix.
    expect(text).not.toContain('- Prior constraint:')
  })

  test('200-char caps on Failure summary and Constraint enforced through the round-trip', () => {
    const cf: BuildReportCarryForward = {
      priorAttempt: 1,
      priorForensicsPath: '/forensics/1/',
      priorValidationCommand: 'bun t',
      priorVerdict: 'fail',
      priorFailureSummary: 'x'.repeat(200),
      constraint: 'y'.repeat(200),
    }
    const round = parseBuildReport(serializeBuildReport(dataWithCarryForward(cf)))
    expect(round.failureCarryForward?.priorFailureSummary.length).toBe(200)
    expect(round.failureCarryForward?.constraint.length).toBe(200)
  })
})
