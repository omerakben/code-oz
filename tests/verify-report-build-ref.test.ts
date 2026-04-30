import { describe, test, expect } from 'bun:test'
import {
  parseVerifyReport,
  serializeVerifyReport,
  VerifyReportLoadError,
  type VerifyReportData,
} from '../src/artifacts/verify-report.ts'

const BASE_SHA = 'a'.repeat(40)
const PATCH_SHA = 'b'.repeat(64)
const REPORT_SHA = 'c'.repeat(64)

function pass(): VerifyReportData {
  return {
    buildRef: {
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: REPORT_SHA,
      taskId: 'T-001',
      attempt: 1,
      baseCommitSha: BASE_SHA,
      patchSha256: PATCH_SHA,
    },
    validationCommand: {
      command: 'bun test foo.test.ts',
      workingDirectory: '.code-oz/runs/<runId>/worktree/',
      timeoutMs: 60_000,
      expectedExitCode: 0,
    },
    evidence: {
      exitCode: 0,
      durationMs: 100,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutLog: '.code-oz/runs/<runId>/forensics/1/stdout.log',
      stderrLog: '.code-oz/runs/<runId>/forensics/1/stderr.log',
    },
    verdict: { verdict: 'pass', rationale: 'ok.' },
    mutation: { status: 'not-applicable', notes: 'na.' },
    failureConstraint: null,
  }
}

function expectIssue(text: string, code: string): void {
  let err: VerifyReportLoadError | null = null
  try {
    parseVerifyReport(text)
  } catch (e) {
    if (e instanceof VerifyReportLoadError) err = e
  }
  expect(err).not.toBeNull()
  expect((err?.issues ?? []).some((i) => i.code === code)).toBe(true)
}

describe('parseVerifyReport — BUILD ref grammar', () => {
  test('happy path round-trips', () => {
    const text = serializeVerifyReport(pass())
    expect(() => parseVerifyReport(text)).not.toThrow()
  })

  test('rejects malformed BUILD_REPORT.md bullet (missing parens)', () => {
    const text = serializeVerifyReport(pass()).replace(
      `- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${REPORT_SHA})`,
      '- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md sha256 ' + REPORT_SHA,
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects BUILD_REPORT.md sha256 of wrong length', () => {
    const text = serializeVerifyReport(pass()).replace(
      `(sha256: ${REPORT_SHA})`,
      `(sha256: ${'c'.repeat(20)})`,
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects taskId not matching T-NNN', () => {
    const text = serializeVerifyReport(pass()).replace('- Task: T-001', '- Task: task-1')
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects taskId with too few digits', () => {
    const text = serializeVerifyReport(pass()).replace('- Task: T-001', '- Task: T-1')
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects zero attempt', () => {
    const text = serializeVerifyReport(pass()).replace('- Attempt: 1', '- Attempt: 0')
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects non-integer attempt', () => {
    const text = serializeVerifyReport(pass()).replace('- Attempt: 1', '- Attempt: x')
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects baseCommitSha of wrong length (20 hex)', () => {
    const text = serializeVerifyReport(pass()).replace(
      `- Base commit: ${BASE_SHA}`,
      `- Base commit: ${'a'.repeat(20)}`,
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects baseCommitSha with uppercase hex', () => {
    const text = serializeVerifyReport(pass()).replace(
      `- Base commit: ${BASE_SHA}`,
      `- Base commit: ${'A'.repeat(40)}`,
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects patchSha256 of wrong length', () => {
    const text = serializeVerifyReport(pass()).replace(
      `- Patch sha256: ${PATCH_SHA}`,
      '- Patch sha256: short',
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects patchSha256 with non-hex characters', () => {
    const text = serializeVerifyReport(pass()).replace(
      `- Patch sha256: ${PATCH_SHA}`,
      `- Patch sha256: ${'g'.repeat(64)}`,
    )
    expectIssue(text, 'verify_build_ref_grammar')
  })

  test('rejects missing required bullet', () => {
    const text = serializeVerifyReport(pass()).replace(`- Patch sha256: ${PATCH_SHA}`, '')
    expectIssue(text, 'verify_build_ref_missing_field')
  })
})
