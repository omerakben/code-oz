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

function passData(): VerifyReportData {
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

function failData(): VerifyReportData {
  return {
    ...passData(),
    evidence: { ...passData().evidence, exitCode: 1 },
    verdict: { verdict: 'fail', rationale: 'expected 0 got 1.' },
    failureConstraint: {
      attempt: 1,
      forensicsPath: '.code-oz/runs/<runId>/forensics/1/',
      validationCommand: 'bun test foo.test.ts',
      verdict: 'fail (exit code 1, duration 100 ms)',
      failureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
      constraint: 'prefer last-syllable stress for two-syllable surnames.',
    },
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

describe('Failure constraint — pass-form discipline', () => {
  test('round-trips with `- None (verdict pass).` on Verdict=pass', () => {
    const round = parseVerifyReport(serializeVerifyReport(passData()))
    expect(round.failureConstraint).toBeNull()
  })

  test('rejects pass with populated failure constraint', () => {
    const text = serializeVerifyReport(passData()).replace(
      '- None (verdict pass).',
      [
        '- Attempt: 1',
        '- Forensics: .code-oz/runs/<runId>/forensics/1/',
        '- Validation command: bun test foo.test.ts',
        '- Verdict: fail (exit code 1, duration 100 ms)',
        '- Failure summary: bogus',
        '- Constraint: bogus',
      ].join('\n'),
    )
    expectIssue(text, 'verify_failure_constraint_grammar')
  })

  test('rejects fail with `- None (verdict pass).`', () => {
    // Construct a fail document but with the None form (manually).
    const failDoc = serializeVerifyReport(failData())
      .replace(
        [
          '- Attempt: 1',
          '- Forensics: .code-oz/runs/<runId>/forensics/1/',
          '- Validation command: bun test foo.test.ts',
          '- Verdict: fail (exit code 1, duration 100 ms)',
          '- Failure summary: expected stress on syllable 2; got stress on syllable 1.',
          '- Constraint: prefer last-syllable stress for two-syllable surnames.',
        ].join('\n'),
        '- None (verdict pass).',
      )
    expectIssue(failDoc, 'verify_failure_constraint_grammar')
  })
})

describe('Failure constraint — populated 6-bullet shape', () => {
  test('round-trips on Verdict=fail', () => {
    const round = parseVerifyReport(serializeVerifyReport(failData()))
    expect(round.failureConstraint).not.toBeNull()
    expect(round.failureConstraint?.attempt).toBe(1)
    expect(round.failureConstraint?.failureSummary).toContain('stress on syllable 2')
  })

  test('rejects when Failure summary is missing', () => {
    const text = serializeVerifyReport(failData()).replace(
      '- Failure summary: expected stress on syllable 2; got stress on syllable 1.',
      '',
    )
    expectIssue(text, 'verify_failure_constraint_grammar')
  })

  test('rejects when Constraint is missing', () => {
    const text = serializeVerifyReport(failData()).replace(
      '- Constraint: prefer last-syllable stress for two-syllable surnames.',
      '',
    )
    expectIssue(text, 'verify_failure_constraint_grammar')
  })

  test('rejects when Attempt is non-integer', () => {
    // Both BUILD ref and Failure constraint have an Attempt bullet; target
    // the Failure constraint one specifically so we don't trip BUILD ref.
    const text = serializeVerifyReport(failData()).replace(
      '## Failure constraint\n\n- Attempt: 1',
      '## Failure constraint\n\n- Attempt: x',
    )
    expectIssue(text, 'verify_failure_constraint_grammar')
  })

  test('rejects when Failure summary > 200 chars', () => {
    const data: VerifyReportData = {
      ...failData(),
      failureConstraint: { ...failData().failureConstraint!, failureSummary: 'x'.repeat(201) },
    }
    expectIssue(serializeVerifyReport(data), 'verify_failure_constraint_overlong')
  })

  test('rejects when Constraint > 200 chars', () => {
    const data: VerifyReportData = {
      ...failData(),
      failureConstraint: { ...failData().failureConstraint!, constraint: 'y'.repeat(201) },
    }
    expectIssue(serializeVerifyReport(data), 'verify_failure_constraint_overlong')
  })

  test('accepts exactly 200 chars (boundary)', () => {
    const data: VerifyReportData = {
      ...failData(),
      failureConstraint: {
        ...failData().failureConstraint!,
        failureSummary: 'x'.repeat(200),
        constraint: 'y'.repeat(200),
      },
    }
    expect(() => parseVerifyReport(serializeVerifyReport(data))).not.toThrow()
  })

  test('rejects empty Failure summary', () => {
    const data: VerifyReportData = {
      ...failData(),
      failureConstraint: { ...failData().failureConstraint!, failureSummary: '' },
    }
    // Empty string serializes as `- Failure summary: ` which the parser treats
    // as missing field (no value after colon-space). Either grammar or
    // missing-field reject is acceptable; we assert one of them fires.
    let err: VerifyReportLoadError | null = null
    try { parseVerifyReport(serializeVerifyReport(data)) } catch (e) {
      if (e instanceof VerifyReportLoadError) err = e
    }
    expect(err).not.toBeNull()
  })
})

describe('Cross-field: verdict ↔ evidence ↔ mutation', () => {
  test('rejects Verdict=pass when exitCode mismatches expectedExitCode', () => {
    const data: VerifyReportData = {
      ...passData(),
      evidence: { ...passData().evidence, exitCode: 1 },
      // We have to populate failureConstraint to keep verdict=pass + exit=1
      // representable, but the cross-check should still fail.
    }
    expectIssue(serializeVerifyReport(data), 'verify_verdict_evidence_mismatch')
  })

  test('rejects Verdict=pass when Mutation.Status=fail', () => {
    const data: VerifyReportData = {
      ...passData(),
      mutation: { status: 'fail', notes: 'mutation gate failed.' },
    }
    expectIssue(serializeVerifyReport(data), 'verify_verdict_evidence_mismatch')
  })

  test('rejects Verdict=fail when exit matches expected AND mutation is not fail', () => {
    const data: VerifyReportData = {
      ...failData(),
      evidence: { ...failData().evidence, exitCode: 0 },
      mutation: { status: 'pass', notes: 'mutation OK.' },
    }
    expectIssue(serializeVerifyReport(data), 'verify_verdict_evidence_mismatch')
  })

  test('Verdict=fail accepts when exitCode mismatches expected', () => {
    expect(() => parseVerifyReport(serializeVerifyReport(failData()))).not.toThrow()
  })

  test('Verdict=fail accepts when Mutation.Status=fail (regardless of exit)', () => {
    const data: VerifyReportData = {
      ...failData(),
      evidence: { ...failData().evidence, exitCode: 0 },
      mutation: { status: 'fail', notes: 'tautological test caught by mutation.' },
    }
    expect(() => parseVerifyReport(serializeVerifyReport(data))).not.toThrow()
  })
})
