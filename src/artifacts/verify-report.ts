// VERIFY.md parser + serializer (per docs/contracts/VERIFY.md §
// "VERIFY.md schema" and § "Verdict").
//
// Authority split per CODEX_RESPONSE_M8.md decision 10
// (accept-with-modifications): the orchestrator authors all computed
// fields (BUILD ref, Validation command, Evidence, Mutation.Status,
// Verdict.Verdict); the persona authors only Verdict.Rationale,
// Mutation.Notes, and the Failure constraint body (Failure summary +
// Constraint). The data shape models both authorities uniformly; the
// orchestrator (M8 commit 10) is what enforces who can set what.
//
// Section order is canonical and locked. The parser strips BOM, splits
// on either CRLF or LF, walks H2 sections, validates per-section
// grammar, and applies the verdict/evidence/mutation cross-field rule
// before returning a frozen VerifyReportData. Errors are accumulated
// into a single VerifyReportLoadError for caller-side diagnostics.

// --- types ---------------------------------------------------------

export const VERIFY_REPORT_TITLE = '# VERIFY' as const

export const VERIFY_REPORT_SECTION_KEYS = [
  'buildRef',
  'validationCommand',
  'evidence',
  'verdict',
  'mutation',
  'failureConstraint',
] as const
export type VerifyReportSectionKey = (typeof VERIFY_REPORT_SECTION_KEYS)[number]

export const VERIFY_REPORT_SECTION_HEADINGS: Readonly<Record<VerifyReportSectionKey, string>> =
  Object.freeze({
    buildRef: 'BUILD ref',
    validationCommand: 'Validation command',
    evidence: 'Evidence',
    verdict: 'Verdict',
    mutation: 'Mutation',
    failureConstraint: 'Failure constraint',
  })

export interface VerifyReportBuildRef {
  readonly buildReportPath: string
  readonly buildReportSha256: string // 64-hex
  readonly taskId: string            // T-NNN
  readonly attempt: number           // ≥ 1
  readonly baseCommitSha: string     // 40-hex
  readonly patchSha256: string       // 64-hex
}

export interface VerifyReportValidationCommand {
  readonly command: string
  readonly workingDirectory: string
  readonly timeoutMs: number       // > 0
  readonly expectedExitCode: number
}

export interface VerifyReportEvidence {
  /** null on terminationReason='spawn-error' (process never exited). */
  readonly exitCode: number | null
  readonly durationMs: number
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly stdoutLog: string
  readonly stderrLog: string
}

export type VerifyVerdict = 'pass' | 'fail'

export interface VerifyReportVerdict {
  readonly verdict: VerifyVerdict
  /** Persona-authored, single line, ≤ 200 chars. */
  readonly rationale: string
}

export type MutationStatus = 'pass' | 'fail' | 'not-applicable'

export interface VerifyReportMutation {
  readonly status: MutationStatus
  /** Persona-authored, single line. ≤ 500 chars. */
  readonly notes: string
}

export interface VerifyReportFailureConstraint {
  readonly attempt: number              // ≥ 1
  readonly forensicsPath: string
  readonly validationCommand: string
  /** e.g., `fail (exit code 1, duration 842 ms)` — orchestrator-authored summary line. */
  readonly verdict: string
  readonly failureSummary: string       // ≤ 200 chars
  readonly constraint: string           // ≤ 200 chars
}

export interface VerifyReportData {
  readonly buildRef: VerifyReportBuildRef
  readonly validationCommand: VerifyReportValidationCommand
  readonly evidence: VerifyReportEvidence
  readonly verdict: VerifyReportVerdict
  readonly mutation: VerifyReportMutation
  /** null when verdict.verdict === 'pass'; populated when 'fail'. */
  readonly failureConstraint: VerifyReportFailureConstraint | null
}

export interface VerifyReportLoadIssue {
  readonly file: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class VerifyReportLoadError extends Error {
  readonly issues: readonly VerifyReportLoadIssue[]
  constructor(issues: readonly VerifyReportLoadIssue[]) {
    const summary = issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
    super(`VERIFY.md validation failed: ${summary}`)
    this.name = 'VerifyReportLoadError'
    this.issues = Object.freeze([...issues])
  }
}

// Caps lifted from VERIFY.md grammar.
export const VERIFY_RATIONALE_MAX_CHARS = 200
export const VERIFY_FAILURE_SUMMARY_MAX_CHARS = 200
export const VERIFY_CONSTRAINT_MAX_CHARS = 200
export const VERIFY_MUTATION_NOTES_MAX_CHARS = 500

// --- serializer ----------------------------------------------------

/**
 * Renders the canonical VERIFY.md from structured data. Output is
 * deterministic: same input, same bytes.
 */
export function serializeVerifyReport(data: VerifyReportData): string {
  const lines: string[] = []
  lines.push(VERIFY_REPORT_TITLE, '')

  // ## BUILD ref
  lines.push('## BUILD ref', '')
  lines.push(
    `- BUILD_REPORT.md: ${data.buildRef.buildReportPath} (sha256: ${data.buildRef.buildReportSha256})`,
  )
  lines.push(`- Task: ${data.buildRef.taskId}`)
  lines.push(`- Attempt: ${data.buildRef.attempt}`)
  lines.push(`- Base commit: ${data.buildRef.baseCommitSha}`)
  lines.push(`- Patch sha256: ${data.buildRef.patchSha256}`)
  lines.push('')

  // ## Validation command
  lines.push('## Validation command', '')
  lines.push(`- Command: ${data.validationCommand.command}`)
  lines.push(`- Working directory: ${data.validationCommand.workingDirectory}`)
  lines.push(`- Timeout (ms): ${data.validationCommand.timeoutMs}`)
  lines.push(`- Expected exit code: ${data.validationCommand.expectedExitCode}`)
  lines.push('')

  // ## Evidence
  lines.push('## Evidence', '')
  lines.push(`- Exit code: ${data.evidence.exitCode === null ? 'null' : data.evidence.exitCode}`)
  lines.push(`- Duration (ms): ${data.evidence.durationMs}`)
  lines.push(`- Stdout bytes: ${data.evidence.stdoutBytes}`)
  lines.push(`- Stderr bytes: ${data.evidence.stderrBytes}`)
  lines.push(`- Stdout log: ${data.evidence.stdoutLog}`)
  lines.push(`- Stderr log: ${data.evidence.stderrLog}`)
  lines.push('')

  // ## Verdict
  lines.push('## Verdict', '')
  lines.push(`- Verdict: ${data.verdict.verdict}`)
  lines.push(`- Rationale: ${data.verdict.rationale}`)
  lines.push('')

  // ## Mutation
  lines.push('## Mutation', '')
  lines.push(`- Status: ${data.mutation.status}`)
  lines.push(`- Notes: ${data.mutation.notes}`)
  lines.push('')

  // ## Failure constraint
  lines.push('## Failure constraint', '')
  if (data.failureConstraint === null) {
    lines.push('- None (verdict pass).')
  } else {
    const fc = data.failureConstraint
    lines.push(`- Attempt: ${fc.attempt}`)
    lines.push(`- Forensics: ${fc.forensicsPath}`)
    lines.push(`- Validation command: ${fc.validationCommand}`)
    lines.push(`- Verdict: ${fc.verdict}`)
    lines.push(`- Failure summary: ${fc.failureSummary}`)
    lines.push(`- Constraint: ${fc.constraint}`)
  }
  lines.push('')

  return lines.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

export function parseVerifyReport(raw: string, file = 'VERIFY.md'): VerifyReportData {
  const issues: VerifyReportLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new VerifyReportLoadError([
      { file, code: 'verify_report_empty', rule: 'VERIFY.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  const titleIdx = lines.findIndex((l) => l === VERIFY_REPORT_TITLE)
  if (titleIdx === -1) {
    throw new VerifyReportLoadError([
      {
        file,
        code: 'verify_report_title_missing',
        rule: `must contain '${VERIFY_REPORT_TITLE}' as a top-level heading`,
      },
    ])
  }

  const sections = walkSections(lines, titleIdx + 1, file, issues)
  const orderIssue = checkSectionOrder(sections, file)
  if (orderIssue) issues.push(orderIssue)

  for (const key of VERIFY_REPORT_SECTION_KEYS) {
    if (!sections.has(key)) {
      issues.push({
        file,
        code: 'verify_report_missing_section',
        rule: `required H2 section absent: '## ${VERIFY_REPORT_SECTION_HEADINGS[key]}'`,
      })
    }
  }
  if (issues.some((i) => i.code === 'verify_report_missing_section')) {
    throw new VerifyReportLoadError(issues)
  }

  const buildRef = parseBuildRef(sections.get('buildRef')!, file, issues)
  const validationCommand = parseValidationCommand(sections.get('validationCommand')!, file, issues)
  const evidence = parseEvidence(sections.get('evidence')!, file, issues)
  const verdict = parseVerdict(sections.get('verdict')!, file, issues)
  const mutation = parseMutation(sections.get('mutation')!, file, issues)
  const failureConstraint = parseFailureConstraint(
    sections.get('failureConstraint')!,
    file,
    issues,
    verdict?.verdict,
  )

  // Cross-field validation per VERIFY.md § Verdict.
  if (verdict && evidence && validationCommand && mutation) {
    if (verdict.verdict === 'pass') {
      const exitMatches =
        evidence.exitCode !== null && evidence.exitCode === validationCommand.expectedExitCode
      const mutationOk = mutation.status === 'pass' || mutation.status === 'not-applicable'
      if (!exitMatches || !mutationOk) {
        issues.push({
          file,
          code: 'verify_verdict_evidence_mismatch',
          rule:
            'Verdict.Verdict=pass requires Evidence.Exit code === Expected exit code AND Mutation.Status ∈ {pass, not-applicable}',
          detail: `exitCode=${evidence.exitCode} expected=${validationCommand.expectedExitCode} mutationStatus=${mutation.status}`,
        })
      }
    } else if (verdict.verdict === 'fail') {
      const exitDiffers =
        evidence.exitCode === null || evidence.exitCode !== validationCommand.expectedExitCode
      const mutationFail = mutation.status === 'fail'
      if (!exitDiffers && !mutationFail) {
        issues.push({
          file,
          code: 'verify_verdict_evidence_mismatch',
          rule:
            'Verdict.Verdict=fail requires Evidence.Exit code !== Expected exit code OR Mutation.Status=fail',
          detail: `exitCode=${evidence.exitCode} expected=${validationCommand.expectedExitCode} mutationStatus=${mutation.status}`,
        })
      }
    }
  }

  if (
    issues.length > 0 ||
    !buildRef ||
    !validationCommand ||
    !evidence ||
    !verdict ||
    !mutation
  ) {
    throw new VerifyReportLoadError(issues)
  }

  return Object.freeze({
    buildRef,
    validationCommand,
    evidence,
    verdict,
    mutation,
    failureConstraint,
  })
}

interface SectionBuf {
  readonly key: VerifyReportSectionKey
  readonly bullets: readonly string[]
  readonly headingLine: number
}

function walkSections(
  lines: readonly string[],
  startIdx: number,
  file: string,
  issues: VerifyReportLoadIssue[],
): Map<VerifyReportSectionKey, SectionBuf> {
  const headingToKey: Record<string, VerifyReportSectionKey> = {}
  for (const k of VERIFY_REPORT_SECTION_KEYS) {
    headingToKey[`## ${VERIFY_REPORT_SECTION_HEADINGS[k]}`] = k
  }
  const map = new Map<VerifyReportSectionKey, SectionBuf>()
  let cur: { key: VerifyReportSectionKey; bullets: string[]; headingLine: number } | null = null

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('## ')) {
      if (cur) map.set(cur.key, Object.freeze({ ...cur, bullets: Object.freeze(cur.bullets) }))
      const key = headingToKey[line]
      if (key === undefined) {
        issues.push({
          file,
          code: 'verify_report_unknown_section',
          rule: `unknown H2 section: '${line}'`,
          line: i + 1,
        })
        cur = null
        continue
      }
      cur = { key, bullets: [], headingLine: i + 1 }
      continue
    }
    if (cur && /^- /.test(line)) {
      cur.bullets.push(line.slice(2))
    }
  }
  if (cur) map.set(cur.key, Object.freeze({ ...cur, bullets: Object.freeze(cur.bullets) }))
  return map
}

function checkSectionOrder(
  sections: Map<VerifyReportSectionKey, SectionBuf>,
  file: string,
): VerifyReportLoadIssue | null {
  const present = [...sections.entries()].sort((a, b) => a[1].headingLine - b[1].headingLine)
  const orderActual = present.map(([k]) => k)
  let canonicalIdx = 0
  for (const k of orderActual) {
    while (
      canonicalIdx < VERIFY_REPORT_SECTION_KEYS.length &&
      VERIFY_REPORT_SECTION_KEYS[canonicalIdx] !== k
    ) {
      canonicalIdx++
    }
    if (canonicalIdx >= VERIFY_REPORT_SECTION_KEYS.length) {
      return {
        file,
        code: 'verify_report_section_out_of_order',
        rule: `section '${VERIFY_REPORT_SECTION_HEADINGS[k]}' appears out of canonical order`,
      }
    }
    canonicalIdx++
  }
  return null
}

// --- per-section parsers ------------------------------------------

function parseBuildRef(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
): VerifyReportBuildRef | null {
  const m = bulletMap(s.bullets)
  const buildReportRef = m.get('BUILD_REPORT.md')
  const taskId = m.get('Task')
  const attemptStr = m.get('Attempt')
  const baseCommitSha = m.get('Base commit')
  const patchSha256 = m.get('Patch sha256')
  if (!buildReportRef || !taskId || !attemptStr || !baseCommitSha || !patchSha256) {
    issues.push({
      file,
      code: 'verify_build_ref_missing_field',
      rule: '## BUILD ref requires bullets: BUILD_REPORT.md, Task, Attempt, Base commit, Patch sha256',
    })
    return null
  }
  // BUILD_REPORT.md bullet shape: `<path> (sha256: <64-hex>)`
  const match = buildReportRef.match(/^(.+?) \(sha256: ([0-9a-f]{64})\)$/)
  if (!match) {
    issues.push({
      file,
      code: 'verify_build_ref_grammar',
      rule: 'BUILD ref.BUILD_REPORT.md must match `<path> (sha256: <64-hex>)`',
      detail: buildReportRef,
    })
    return null
  }
  const buildReportPath = match[1]!
  const buildReportSha256 = match[2]!
  if (!/^T-\d{3,}$/.test(taskId)) {
    issues.push({
      file,
      code: 'verify_build_ref_grammar',
      rule: 'BUILD ref.Task must match /^T-\\d{3,}$/',
      detail: taskId,
    })
    return null
  }
  const attempt = Number.parseInt(attemptStr, 10)
  if (!Number.isInteger(attempt) || attempt < 1) {
    issues.push({
      file,
      code: 'verify_build_ref_grammar',
      rule: 'BUILD ref.Attempt must be a positive integer',
      detail: attemptStr,
    })
    return null
  }
  if (!/^[0-9a-f]{40}$/.test(baseCommitSha)) {
    issues.push({
      file,
      code: 'verify_build_ref_grammar',
      rule: 'BUILD ref.Base commit must be 40-char lower-case hex',
      detail: baseCommitSha,
    })
    return null
  }
  if (!/^[0-9a-f]{64}$/.test(patchSha256)) {
    issues.push({
      file,
      code: 'verify_build_ref_grammar',
      rule: 'BUILD ref.Patch sha256 must be 64-char lower-case hex',
      detail: patchSha256,
    })
    return null
  }
  return Object.freeze({
    buildReportPath,
    buildReportSha256,
    taskId,
    attempt,
    baseCommitSha,
    patchSha256,
  })
}

function parseValidationCommand(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
): VerifyReportValidationCommand | null {
  const m = bulletMap(s.bullets)
  const command = m.get('Command')
  const workingDirectory = m.get('Working directory')
  const timeoutStr = m.get('Timeout (ms)')
  const exitStr = m.get('Expected exit code')
  if (!command || !workingDirectory || timeoutStr === undefined || exitStr === undefined) {
    issues.push({
      file,
      code: 'verify_validation_command_missing',
      rule: '## Validation command requires bullets: Command, Working directory, Timeout (ms), Expected exit code',
    })
    return null
  }
  const timeoutMs = Number.parseInt(timeoutStr, 10)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    issues.push({
      file,
      code: 'verify_validation_command_grammar',
      rule: 'Validation command.Timeout (ms) must be a positive integer',
      detail: timeoutStr,
    })
    return null
  }
  const expectedExitCode = Number.parseInt(exitStr, 10)
  if (!Number.isInteger(expectedExitCode)) {
    issues.push({
      file,
      code: 'verify_validation_command_grammar',
      rule: 'Validation command.Expected exit code must be an integer',
      detail: exitStr,
    })
    return null
  }
  return Object.freeze({ command, workingDirectory, timeoutMs, expectedExitCode })
}

function parseEvidence(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
): VerifyReportEvidence | null {
  const m = bulletMap(s.bullets)
  const exitStr = m.get('Exit code')
  const durationStr = m.get('Duration (ms)')
  const stdoutBytesStr = m.get('Stdout bytes')
  const stderrBytesStr = m.get('Stderr bytes')
  const stdoutLog = m.get('Stdout log')
  const stderrLog = m.get('Stderr log')
  if (
    exitStr === undefined ||
    durationStr === undefined ||
    stdoutBytesStr === undefined ||
    stderrBytesStr === undefined ||
    !stdoutLog ||
    !stderrLog
  ) {
    issues.push({
      file,
      code: 'verify_evidence_missing',
      rule:
        '## Evidence requires bullets: Exit code, Duration (ms), Stdout bytes, Stderr bytes, Stdout log, Stderr log',
    })
    return null
  }
  let exitCode: number | null
  if (exitStr === 'null') {
    exitCode = null
  } else {
    const parsed = Number.parseInt(exitStr, 10)
    if (!Number.isInteger(parsed)) {
      issues.push({
        file,
        code: 'verify_evidence_grammar',
        rule: 'Evidence.Exit code must be an integer or `null`',
        detail: exitStr,
      })
      return null
    }
    exitCode = parsed
  }
  const durationMs = Number.parseInt(durationStr, 10)
  if (!Number.isInteger(durationMs) || durationMs < 0) {
    issues.push({
      file,
      code: 'verify_evidence_grammar',
      rule: 'Evidence.Duration (ms) must be a non-negative integer',
      detail: durationStr,
    })
    return null
  }
  const stdoutBytes = Number.parseInt(stdoutBytesStr, 10)
  const stderrBytes = Number.parseInt(stderrBytesStr, 10)
  if (
    !Number.isInteger(stdoutBytes) || stdoutBytes < 0 ||
    !Number.isInteger(stderrBytes) || stderrBytes < 0
  ) {
    issues.push({
      file,
      code: 'verify_evidence_grammar',
      rule: 'Evidence.Stdout bytes and Stderr bytes must be non-negative integers',
    })
    return null
  }
  return Object.freeze({
    exitCode,
    durationMs,
    stdoutBytes,
    stderrBytes,
    stdoutLog,
    stderrLog,
  })
}

function parseVerdict(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
): VerifyReportVerdict | null {
  const m = bulletMap(s.bullets)
  const verdictStr = m.get('Verdict')
  const rationale = m.get('Rationale')
  if (!verdictStr || rationale === undefined) {
    issues.push({
      file,
      code: 'verify_verdict_missing_field',
      rule: '## Verdict requires bullets: Verdict, Rationale',
    })
    return null
  }
  if (verdictStr !== 'pass' && verdictStr !== 'fail') {
    issues.push({
      file,
      code: 'verify_verdict_grammar',
      rule: 'Verdict.Verdict must be `pass` or `fail`',
      detail: verdictStr,
    })
    return null
  }
  if (rationale.length === 0) {
    issues.push({
      file,
      code: 'verify_verdict_grammar',
      rule: 'Verdict.Rationale must be a non-empty single line',
    })
    return null
  }
  if (rationale.length > VERIFY_RATIONALE_MAX_CHARS) {
    issues.push({
      file,
      code: 'verify_verdict_grammar',
      rule: `Verdict.Rationale must be ≤ ${VERIFY_RATIONALE_MAX_CHARS} characters`,
      detail: `got ${rationale.length}`,
    })
    return null
  }
  return Object.freeze({ verdict: verdictStr, rationale })
}

function parseMutation(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
): VerifyReportMutation | null {
  const m = bulletMap(s.bullets)
  const status = m.get('Status')
  const notes = m.get('Notes')
  if (!status || notes === undefined) {
    issues.push({
      file,
      code: 'verify_mutation_missing_field',
      rule: '## Mutation requires bullets: Status, Notes',
    })
    return null
  }
  if (status !== 'pass' && status !== 'fail' && status !== 'not-applicable') {
    issues.push({
      file,
      code: 'verify_mutation_status_invalid',
      rule: 'Mutation.Status must be one of: pass | fail | not-applicable',
      detail: status,
    })
    return null
  }
  if (notes.length > VERIFY_MUTATION_NOTES_MAX_CHARS) {
    issues.push({
      file,
      code: 'verify_mutation_grammar',
      rule: `Mutation.Notes must be ≤ ${VERIFY_MUTATION_NOTES_MAX_CHARS} characters`,
      detail: `got ${notes.length}`,
    })
    return null
  }
  return Object.freeze({ status, notes })
}

function parseFailureConstraint(
  s: SectionBuf,
  file: string,
  issues: VerifyReportLoadIssue[],
  verdictValue: VerifyVerdict | undefined,
): VerifyReportFailureConstraint | null {
  // Pass form: `- None (verdict pass).`
  if (s.bullets.length === 1 && s.bullets[0] === 'None (verdict pass).') {
    if (verdictValue === 'fail') {
      issues.push({
        file,
        code: 'verify_failure_constraint_grammar',
        rule: '## Failure constraint must be populated when Verdict.Verdict=fail (got `None`)',
      })
      return null
    }
    return null
  }
  if (verdictValue === 'pass') {
    issues.push({
      file,
      code: 'verify_failure_constraint_grammar',
      rule: '## Failure constraint must be `- None (verdict pass).` when Verdict.Verdict=pass',
    })
    return null
  }
  const m = bulletMap(s.bullets)
  const attemptStr = m.get('Attempt')
  const forensicsPath = m.get('Forensics')
  const validationCommand = m.get('Validation command')
  const verdict = m.get('Verdict')
  const failureSummary = m.get('Failure summary')
  const constraint = m.get('Constraint')
  if (
    attemptStr === undefined ||
    !forensicsPath ||
    !validationCommand ||
    !verdict ||
    failureSummary === undefined ||
    constraint === undefined
  ) {
    issues.push({
      file,
      code: 'verify_failure_constraint_grammar',
      rule: '## Failure constraint requires bullets: Attempt, Forensics, Validation command, Verdict, Failure summary, Constraint',
    })
    return null
  }
  const attempt = Number.parseInt(attemptStr, 10)
  if (!Number.isInteger(attempt) || attempt < 1) {
    issues.push({
      file,
      code: 'verify_failure_constraint_grammar',
      rule: 'Failure constraint.Attempt must be a positive integer',
      detail: attemptStr,
    })
    return null
  }
  if (failureSummary.length === 0 || constraint.length === 0) {
    issues.push({
      file,
      code: 'verify_failure_constraint_grammar',
      rule: 'Failure constraint.Failure summary and Constraint must be non-empty',
    })
    return null
  }
  if (failureSummary.length > VERIFY_FAILURE_SUMMARY_MAX_CHARS) {
    issues.push({
      file,
      code: 'verify_failure_constraint_overlong',
      rule: `Failure constraint.Failure summary must be ≤ ${VERIFY_FAILURE_SUMMARY_MAX_CHARS} characters`,
      detail: `got ${failureSummary.length}`,
    })
    return null
  }
  if (constraint.length > VERIFY_CONSTRAINT_MAX_CHARS) {
    issues.push({
      file,
      code: 'verify_failure_constraint_overlong',
      rule: `Failure constraint.Constraint must be ≤ ${VERIFY_CONSTRAINT_MAX_CHARS} characters`,
      detail: `got ${constraint.length}`,
    })
    return null
  }
  return Object.freeze({
    attempt,
    forensicsPath,
    validationCommand,
    verdict,
    failureSummary,
    constraint,
  })
}

// --- helpers -------------------------------------------------------

/** Maps `- Key: value` bullets to a Map<key, value>. */
function bulletMap(bullets: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of bullets) {
    const idx = b.indexOf(': ')
    if (idx === -1) continue
    const key = b.slice(0, idx)
    const value = b.slice(idx + 2)
    out.set(key, value)
  }
  return out
}
