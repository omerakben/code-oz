import { describe, test, expect } from 'bun:test'
import {
  serializeVerifyReport,
  type VerifyReportData,
} from '../src/artifacts/verify-report.ts'

const BASE_SHA = 'a'.repeat(40)
const PATCH_SHA = 'b'.repeat(64)
const REPORT_SHA = 'c'.repeat(64)

function passingData(): VerifyReportData {
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
      command: 'bun test tests/scoring-syllable.test.ts',
      workingDirectory: '.code-oz/runs/<runId>/worktree/',
      timeoutMs: 60_000,
      expectedExitCode: 0,
    },
    evidence: {
      exitCode: 0,
      durationMs: 842,
      stdoutBytes: 1184,
      stderrBytes: 0,
      stdoutLog: '.code-oz/runs/<runId>/forensics/1/stdout.log',
      stderrLog: '.code-oz/runs/<runId>/forensics/1/stderr.log',
    },
    verdict: {
      verdict: 'pass',
      rationale: 'validation command exited 0 within timeout; no stderr; mutation gate satisfied.',
    },
    mutation: {
      status: 'not-applicable',
      notes: "BUILD task's PLAN bullet does not assert new behavior; mutation gate skipped.",
    },
    failureConstraint: null,
  }
}

function failingData(): VerifyReportData {
  return {
    ...passingData(),
    evidence: {
      exitCode: 1,
      durationMs: 842,
      stdoutBytes: 1184,
      stderrBytes: 64,
      stdoutLog: '.code-oz/runs/<runId>/forensics/1/stdout.log',
      stderrLog: '.code-oz/runs/<runId>/forensics/1/stderr.log',
    },
    verdict: {
      verdict: 'fail',
      rationale: 'expected exit 0; got exit 1.',
    },
    mutation: {
      status: 'not-applicable',
      notes: 'mutation gate skipped on a failing test attempt.',
    },
    failureConstraint: {
      attempt: 1,
      forensicsPath: '.code-oz/runs/<runId>/forensics/1/',
      validationCommand: 'bun test tests/scoring-syllable.test.ts',
      verdict: 'fail (exit code 1, duration 842 ms)',
      failureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
      constraint: 'prefer last-syllable stress for two-syllable surnames.',
    },
  }
}

describe('serializeVerifyReport — passing case', () => {
  test('produces a deterministic single string', () => {
    const data = passingData()
    expect(serializeVerifyReport(data)).toBe(serializeVerifyReport(data))
  })

  test('contains every locked H2 heading in canonical order', () => {
    const out = serializeVerifyReport(passingData())
    const indices = [
      out.indexOf('## BUILD ref'),
      out.indexOf('## Validation command'),
      out.indexOf('## Evidence'),
      out.indexOf('## Verdict'),
      out.indexOf('## Mutation'),
      out.indexOf('## Failure constraint'),
    ]
    for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!)
    }
  })

  test('renders BUILD ref bullets exactly per VERIFY.md grammar', () => {
    const out = serializeVerifyReport(passingData())
    expect(out).toContain(
      `- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${REPORT_SHA})`,
    )
    expect(out).toContain('- Task: T-001')
    expect(out).toContain('- Attempt: 1')
    expect(out).toContain(`- Base commit: ${BASE_SHA}`)
    expect(out).toContain(`- Patch sha256: ${PATCH_SHA}`)
  })

  test('renders failure constraint as `- None (verdict pass).` on pass', () => {
    const out = serializeVerifyReport(passingData())
    expect(out).toContain('- None (verdict pass).')
  })

  test('renders evidence.exitCode=null as the literal `null`', () => {
    const data: VerifyReportData = {
      ...passingData(),
      evidence: { ...passingData().evidence, exitCode: null },
      // verdict has to be 'fail' since exitCode mismatch on pass would reject
      verdict: { verdict: 'fail', rationale: 'spawn-error: bun not found.' },
      failureConstraint: failingData().failureConstraint,
    }
    const out = serializeVerifyReport(data)
    expect(out).toContain('- Exit code: null')
  })
})

describe('serializeVerifyReport — failing case', () => {
  test('renders 6-bullet failure constraint shape', () => {
    const out = serializeVerifyReport(failingData())
    expect(out).toContain('- Attempt: 1')
    expect(out).toContain('- Forensics: .code-oz/runs/<runId>/forensics/1/')
    expect(out).toContain('- Validation command: bun test tests/scoring-syllable.test.ts')
    expect(out).toContain('- Verdict: fail (exit code 1, duration 842 ms)')
    expect(out).toContain('- Failure summary: expected stress on syllable 2;')
    expect(out).toContain('- Constraint: prefer last-syllable stress')
    expect(out).not.toContain('- None (verdict pass).')
  })

  test('byte-for-byte deterministic output for fixed input', () => {
    const out1 = serializeVerifyReport(failingData())
    const out2 = serializeVerifyReport(failingData())
    expect(out1).toBe(out2)
  })
})
