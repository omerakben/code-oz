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
  const issues = err?.issues ?? []
  expect(issues.some((i) => i.code === code)).toBe(true)
}

describe('parseVerifyReport — top-level structure', () => {
  test('rejects empty input', () => {
    expectIssue('', 'verify_report_empty')
    expectIssue('   \n  \n', 'verify_report_empty')
  })

  test('rejects missing # VERIFY title', () => {
    const text = serializeVerifyReport(pass()).replace('# VERIFY', '# OTHER')
    expectIssue(text, 'verify_report_title_missing')
  })

  test('rejects missing required H2 sections', () => {
    const headings: Array<[string, string]> = [
      ['## BUILD ref', 'verify_report_missing_section'],
      ['## Validation command', 'verify_report_missing_section'],
      ['## Evidence', 'verify_report_missing_section'],
      ['## Verdict', 'verify_report_missing_section'],
      ['## Mutation', 'verify_report_missing_section'],
      ['## Failure constraint', 'verify_report_missing_section'],
    ]
    for (const [heading, code] of headings) {
      const text = serializeVerifyReport(pass()).replace(heading, '## REMOVED')
      expectIssue(text, code)
    }
  })

  test('rejects unknown H2 sections', () => {
    const text = serializeVerifyReport(pass()).replace('## Mutation', '## RogueSection')
    // Triggers both unknown_section and missing_section.
    expectIssue(text, 'verify_report_unknown_section')
  })

  test('rejects sections out of canonical order', () => {
    // Swap Mutation and Verdict by stitching strings.
    const out = serializeVerifyReport(pass())
    // Build text with Mutation before Verdict.
    const mutationStart = out.indexOf('## Mutation')
    const verdictStart = out.indexOf('## Verdict')
    const failureStart = out.indexOf('## Failure constraint')
    const verdictBlock = out.slice(verdictStart, mutationStart)
    const mutationBlock = out.slice(mutationStart, failureStart)
    const swapped = out.slice(0, verdictStart) + mutationBlock + verdictBlock + out.slice(failureStart)
    expectIssue(swapped, 'verify_report_section_out_of_order')
  })
})

describe('parseVerifyReport — bullet-level grammar', () => {
  test('rejects Validation command missing bullets', () => {
    const text = serializeVerifyReport(pass()).replace('- Timeout (ms): 60000', '')
    expectIssue(text, 'verify_validation_command_missing')
  })

  test('rejects Evidence missing bullets', () => {
    const text = serializeVerifyReport(pass()).replace('- Stdout log: .code-oz/runs/<runId>/forensics/1/stdout.log', '')
    expectIssue(text, 'verify_evidence_missing')
  })

  test('rejects Verdict.Verdict not in {pass, fail}', () => {
    const text = serializeVerifyReport(pass()).replace('- Verdict: pass', '- Verdict: maybe')
    expectIssue(text, 'verify_verdict_grammar')
  })

  test('rejects empty Verdict.Rationale', () => {
    // Empty value after colon-space: after trailing-whitespace trim the line
    // becomes `- Rationale:` which the bulletMap treats as missing the
    // separator entirely → missing-field reject. Either grammar or
    // missing-field is acceptable; both close the same hole.
    const text = serializeVerifyReport(pass()).replace('- Rationale: ok.', '- Rationale: ')
    let err: VerifyReportLoadError | null = null
    try {
      parseVerifyReport(text)
    } catch (e) {
      if (e instanceof VerifyReportLoadError) err = e
    }
    expect(err).not.toBeNull()
    expect(
      (err?.issues ?? []).some(
        (i) => i.code === 'verify_verdict_grammar' || i.code === 'verify_verdict_missing_field',
      ),
    ).toBe(true)
  })

  test('rejects > 200-char Verdict.Rationale', () => {
    const long = 'x'.repeat(201)
    const text = serializeVerifyReport({
      ...pass(),
      verdict: { verdict: 'pass', rationale: long },
    })
    expectIssue(text, 'verify_verdict_grammar')
  })

  test('rejects Mutation.Status not in {pass, fail, not-applicable}', () => {
    const text = serializeVerifyReport(pass()).replace('- Status: not-applicable', '- Status: bogus')
    expectIssue(text, 'verify_mutation_status_invalid')
  })
})
