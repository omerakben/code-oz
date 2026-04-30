import { describe, test, expect } from 'bun:test'
import {
  parseVerifyReport,
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
      rationale: 'validation command exited 0 within timeout; mutation gate satisfied.',
    },
    mutation: {
      status: 'not-applicable',
      notes: 'mutation skipped: no new behavior in PLAN bullet.',
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
    verdict: { verdict: 'fail', rationale: 'expected exit 0, got 1.' },
    mutation: { status: 'not-applicable', notes: 'gate skipped on failing attempt.' },
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

describe('parseVerifyReport — round-trip', () => {
  test('passing data: parse(serialize(d)) deeply equals d', () => {
    const data = passingData()
    const round = parseVerifyReport(serializeVerifyReport(data))
    expect(round.buildRef).toEqual(data.buildRef)
    expect(round.validationCommand).toEqual(data.validationCommand)
    expect(round.evidence).toEqual(data.evidence)
    expect(round.verdict).toEqual(data.verdict)
    expect(round.mutation).toEqual(data.mutation)
    expect(round.failureConstraint).toBeNull()
  })

  test('failing data: parse(serialize(d)) deeply equals d', () => {
    const data = failingData()
    const round = parseVerifyReport(serializeVerifyReport(data))
    expect(round.buildRef).toEqual(data.buildRef)
    expect(round.evidence.exitCode).toBe(1)
    expect(round.verdict.verdict).toBe('fail')
    expect(round.failureConstraint).toEqual(data.failureConstraint!)
  })

  test('result and nested objects are frozen', () => {
    const round = parseVerifyReport(serializeVerifyReport(passingData()))
    expect(Object.isFrozen(round)).toBe(true)
    expect(Object.isFrozen(round.buildRef)).toBe(true)
    expect(Object.isFrozen(round.evidence)).toBe(true)
    expect(Object.isFrozen(round.verdict)).toBe(true)
    expect(Object.isFrozen(round.mutation)).toBe(true)
  })
})

describe('parseVerifyReport — input tolerance', () => {
  test('strips a leading UTF-8 BOM', () => {
    const out = '﻿' + serializeVerifyReport(passingData())
    expect(() => parseVerifyReport(out)).not.toThrow()
  })

  test('accepts CRLF line endings', () => {
    const out = serializeVerifyReport(passingData()).replace(/\n/g, '\r\n')
    expect(() => parseVerifyReport(out)).not.toThrow()
  })

  test('strips trailing whitespace from lines', () => {
    const out = serializeVerifyReport(passingData()).split('\n').map((l) => l + '   ').join('\n')
    expect(() => parseVerifyReport(out)).not.toThrow()
  })
})

describe('parseVerifyReport — null exitCode round-trip', () => {
  test('exitCode=null + verdict=fail (spawn-error scenario)', () => {
    const data: VerifyReportData = {
      ...failingData(),
      evidence: { ...failingData().evidence, exitCode: null },
      verdict: { verdict: 'fail', rationale: 'spawn-error: bun executable not found.' },
    }
    const round = parseVerifyReport(serializeVerifyReport(data))
    expect(round.evidence.exitCode).toBeNull()
  })
})
