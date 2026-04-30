// M9 commit 9 substrate: BuildReportCarryForward.source field tests.
//
// The carry-forward grammar now distinguishes `Source: verify-fail` (M8
// origin) from `Source: review-needs-revision` (M9 commit 10 origin).
// These tests pin the parser + serializer round-trip for both values and
// the parser's strict rejection of missing or unknown Source.

import { describe, test, expect } from 'bun:test'
import {
  parseBuildReport,
  serializeBuildReport,
  BuildReportLoadError,
  BUILD_REPORT_CARRY_FORWARD_SOURCES,
  type BuildReportCarryForward,
  type BuildReportCarryForwardSource,
  type BuildReportData,
} from '../src/artifacts/build-report.ts'

const PLAN_SHA = 'a'.repeat(64)
const BASE_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const ENTRY_SHA = 'd'.repeat(64)

function dataWithCarryForward(cf: BuildReportCarryForward): BuildReportData {
  return {
    task: {
      taskId: 'T-001',
      title: 'Apply carry-forward across attempts',
      planSha: PLAN_SHA,
      attempt: cf.priorAttempt + 1,
    },
    base: {
      worktreePath: '.code-oz/runs/01HX/worktree/',
      baseCommitSha: BASE_SHA,
      dirtyAtBase: false,
    },
    patch: {
      patchPath: `.code-oz/runs/01HX/patches/attempt-${cf.priorAttempt + 1}.patch`,
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

describe('BuildReportCarryForward — typed Source field (M9 commit 9)', () => {
  test('Source enum union has exactly the two locked values', () => {
    expect([...BUILD_REPORT_CARRY_FORWARD_SOURCES].sort()).toEqual([
      'review-needs-revision',
      'verify-fail',
    ])
  })

  test('round-trip preserves Source: verify-fail', () => {
    const cf: BuildReportCarryForward = {
      source: 'verify-fail',
      priorAttempt: 1,
      priorForensicsPath: '.code-oz/runs/01HX/forensics/1/',
      priorValidationCommand: 'bun test tests/foo.test.ts',
      priorVerdict: 'fail (exit code 1, duration 100 ms)',
      priorFailureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
      constraint: 'prefer last-syllable stress for two-syllable surnames.',
    }
    const text = serializeBuildReport(dataWithCarryForward(cf))
    expect(text).toContain('- Source: verify-fail')
    const round = parseBuildReport(text)
    expect(round.failureCarryForward).not.toBeNull()
    expect(round.failureCarryForward?.source).toBe('verify-fail')
    expect(round.failureCarryForward).toEqual(cf)
  })

  test('round-trip preserves Source: review-needs-revision', () => {
    const cf: BuildReportCarryForward = {
      source: 'review-needs-revision',
      priorAttempt: 1,
      priorForensicsPath: '.code-oz/artifacts/REVIEW.md',
      priorValidationCommand: 'bun test tests/foo.test.ts',
      priorVerdict: 'needs-revision (round 1, sha ' + 'f'.repeat(64) + ')',
      priorFailureSummary: 'reviewer flagged unexplained side-effect in topN.',
      constraint: 'document the side-effect or remove it before re-review.',
    }
    const text = serializeBuildReport(dataWithCarryForward(cf))
    expect(text).toContain('- Source: review-needs-revision')
    const round = parseBuildReport(text)
    expect(round.failureCarryForward).not.toBeNull()
    expect(round.failureCarryForward?.source).toBe('review-needs-revision')
    expect(round.failureCarryForward).toEqual(cf)
  })

  test('Source line precedes Prior attempt line in canonical serialization', () => {
    const cf: BuildReportCarryForward = {
      source: 'verify-fail',
      priorAttempt: 2,
      priorForensicsPath: '/forensics/2/',
      priorValidationCommand: 'bun t',
      priorVerdict: 'fail',
      priorFailureSummary: 's',
      constraint: 'c',
    }
    const text = serializeBuildReport(dataWithCarryForward(cf))
    const sourceIdx = text.indexOf('- Source: verify-fail')
    const priorIdx = text.indexOf('- Prior attempt:')
    expect(sourceIdx).toBeGreaterThan(0)
    expect(priorIdx).toBeGreaterThan(sourceIdx)
  })

  test('parser rejects carry-forward block without Source bullet', () => {
    // Hand-construct a BUILD_REPORT.md text without Source — backwards
    // compat with M8 carry-forward grammar must NOT silently succeed.
    const text =
      `# BUILD_REPORT\n\n` +
      `## Task\n\n` +
      `- Task: T-001\n` +
      `- Title: legacy\n` +
      `- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${PLAN_SHA})\n` +
      `- Attempt: 2\n\n` +
      `## Base\n\n` +
      `- Worktree: .code-oz/runs/01HX/worktree/\n` +
      `- Base commit: ${BASE_SHA}\n` +
      `- Dirty tree at base: false\n\n` +
      `## Patch\n\n` +
      `- Patch path: .code-oz/runs/01HX/patches/attempt-2.patch\n` +
      `- Patch sha256: ${PATCH_SHA}\n` +
      `- Patch byte count: 100\n\n` +
      `## Changed files\n\n` +
      `- src/foo.ts | sha256: ${ENTRY_SHA} | change: modified\n\n` +
      `## Validation command\n\n` +
      `- Command: bun test\n` +
      `- Working directory: .code-oz/runs/<runId>/worktree/\n` +
      `- Timeout (ms): 60000\n` +
      `- Expected exit code: 0\n\n` +
      `## Failure carry-forward\n\n` +
      // No Source line — the M8 shape that M9 commit 9 forbids.
      `- Prior attempt: 1\n` +
      `- Prior forensics: .code-oz/runs/01HX/forensics/1/\n` +
      `- Prior validation command: bun t\n` +
      `- Prior verdict: fail\n` +
      `- Prior failure summary: s\n` +
      `- Constraint: c\n\n` +
      `## Notes\n\n` +
      `- stub.\n`
    expect(() => parseBuildReport(text)).toThrow(BuildReportLoadError)
    try {
      parseBuildReport(text)
    } catch (err) {
      expect(err).toBeInstanceOf(BuildReportLoadError)
      if (err instanceof BuildReportLoadError) {
        expect(err.issues.some((i) => i.code === 'build_carry_forward_grammar')).toBe(true)
      }
    }
  })

  test('parser rejects unknown Source value', () => {
    const text =
      `# BUILD_REPORT\n\n` +
      `## Task\n\n` +
      `- Task: T-001\n` +
      `- Title: legacy\n` +
      `- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${PLAN_SHA})\n` +
      `- Attempt: 2\n\n` +
      `## Base\n\n` +
      `- Worktree: .code-oz/runs/01HX/worktree/\n` +
      `- Base commit: ${BASE_SHA}\n` +
      `- Dirty tree at base: false\n\n` +
      `## Patch\n\n` +
      `- Patch path: .code-oz/runs/01HX/patches/attempt-2.patch\n` +
      `- Patch sha256: ${PATCH_SHA}\n` +
      `- Patch byte count: 100\n\n` +
      `## Changed files\n\n` +
      `- src/foo.ts | sha256: ${ENTRY_SHA} | change: modified\n\n` +
      `## Validation command\n\n` +
      `- Command: bun test\n` +
      `- Working directory: .code-oz/runs/<runId>/worktree/\n` +
      `- Timeout (ms): 60000\n` +
      `- Expected exit code: 0\n\n` +
      `## Failure carry-forward\n\n` +
      `- Source: lint-fail\n` + // not in the locked enum
      `- Prior attempt: 1\n` +
      `- Prior forensics: .code-oz/runs/01HX/forensics/1/\n` +
      `- Prior validation command: bun t\n` +
      `- Prior verdict: fail\n` +
      `- Prior failure summary: s\n` +
      `- Constraint: c\n\n` +
      `## Notes\n\n` +
      `- stub.\n`
    try {
      parseBuildReport(text)
      expect.unreachable('parser should reject unknown Source value')
    } catch (err) {
      expect(err).toBeInstanceOf(BuildReportLoadError)
      if (err instanceof BuildReportLoadError) {
        const issue = err.issues.find((i) => i.code === 'build_carry_forward_grammar')
        expect(issue).toBeDefined()
        expect(issue?.rule).toContain('Source must be one of')
      }
    }
  })

  test('every locked source survives a round-trip without mutation', () => {
    for (const src of BUILD_REPORT_CARRY_FORWARD_SOURCES) {
      const cf: BuildReportCarryForward = {
        source: src as BuildReportCarryForwardSource,
        priorAttempt: 1,
        priorForensicsPath: '/x/',
        priorValidationCommand: 'bun t',
        priorVerdict: 'fail',
        priorFailureSummary: 's',
        constraint: 'c',
      }
      const round = parseBuildReport(serializeBuildReport(dataWithCarryForward(cf)))
      expect(round.failureCarryForward?.source).toBe(src)
    }
  })
})
