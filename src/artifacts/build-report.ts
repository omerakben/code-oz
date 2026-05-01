// BUILD_REPORT.md parser + serializer (per docs/contracts/BUILD.md §
// "BUILD_REPORT.md schema" and § "Authoring authority").
//
// The orchestrator authors all computed fields; the persona authors only
// Title (free-form, ≤120 chars) and Notes (free-form, ≤200 chars per
// bullet). The parser is the orchestrator's verification step before
// committing to canonical write — it cross-checks every field's
// well-formedness.
//
// Section order is canonical and locked. Any violation produces a
// structured BuildReportLoadError with frozen issues.

import type { ManifestEntry } from '../worktree/manifest.ts'

// --- types ---------------------------------------------------------

export const BUILD_REPORT_TITLE = '# BUILD_REPORT' as const

export const BUILD_REPORT_SECTION_KEYS = [
  'task',
  'base',
  'patch',
  'changedFiles',
  'validationCommand',
  'failureCarryForward',
  'notes',
] as const
export type BuildReportSectionKey = (typeof BUILD_REPORT_SECTION_KEYS)[number]

export const BUILD_REPORT_SECTION_HEADINGS: Readonly<Record<BuildReportSectionKey, string>> =
  Object.freeze({
    task: 'Task',
    base: 'Base',
    patch: 'Patch',
    changedFiles: 'Changed files',
    validationCommand: 'Validation command',
    failureCarryForward: 'Failure carry-forward',
    notes: 'Notes',
  })

export interface BuildReportTask {
  readonly taskId: string // T-NNN
  readonly title: string  // ≤ 120 chars, single line
  readonly planSha: string // 64-hex sha of PLAN.md
  readonly attempt: number // ≥ 1
}

export interface BuildReportBase {
  readonly worktreePath: string
  readonly baseCommitSha: string // 40-hex
  readonly dirtyAtBase: boolean
}

export interface BuildReportPatch {
  readonly patchPath: string
  readonly patchSha256: string // 64-hex
  readonly patchBytes: number  // ≥ 0
}

export interface BuildReportValidationCommand {
  readonly command: string
  readonly workingDirectory: string
  readonly timeoutMs: number       // > 0
  readonly expectedExitCode: number
}

/**
 * Source of a BUILD attempt N+1's failure carry-forward block. Locked
 * enum (M9 commit 9 substrate per kickoff Decision 8): the carry-forward
 * grammar must distinguish where the prior attempt's failure came from
 * because the two paths produce structurally different evidence:
 *
 *   - 'verify-fail' (M8): a VERIFY.md verdict=fail produced a typed
 *     VerifiedFailedAttempt; restart-policy.prepareCarryForward maps
 *     it to this shape. Prior verdict + failure summary describe a
 *     validation-command failure.
 *   - 'review-needs-revision' (M9 c10+): a REVIEW round N exited with
 *     verdict=needs-revision; review-remediation maps the unresolved
 *     fix-first findings into the same shape. Prior verdict + failure
 *     summary describe the reviewer's recommendation.
 *
 * Codex's M9 substrate catch (CODEX_RESPONSE_M9.md decision 8): reusing
 * M8's grammar would create fake forensics — the BUILD prompt would see
 * "Prior verdict: fail (exit code 1, ...)" for a finding that never ran
 * a validation command. Adding the typed Source field forces both paths
 * to use grammar that's honest about origin.
 */
export const BUILD_REPORT_CARRY_FORWARD_SOURCES = [
  'verify-fail',
  'review-needs-revision',
] as const
export type BuildReportCarryForwardSource =
  (typeof BUILD_REPORT_CARRY_FORWARD_SOURCES)[number]

export interface BuildReportCarryForward {
  readonly source: BuildReportCarryForwardSource
  readonly priorAttempt: number
  readonly priorForensicsPath: string
  readonly priorValidationCommand: string
  readonly priorVerdict: string
  readonly priorFailureSummary: string // ≤ 200 chars
  readonly constraint: string          // ≤ 200 chars
}

export interface BuildReportData {
  readonly task: BuildReportTask
  readonly base: BuildReportBase
  readonly patch: BuildReportPatch
  readonly changedFiles: readonly ManifestEntry[]
  readonly validationCommand: BuildReportValidationCommand
  /** `null` when attempt is 1 (first try); object otherwise. */
  readonly failureCarryForward: BuildReportCarryForward | null
  readonly notes: readonly string[] // ≥ 1
}

export interface BuildReportLoadIssue {
  readonly file: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class BuildReportLoadError extends Error {
  readonly issues: readonly BuildReportLoadIssue[]
  constructor(issues: readonly BuildReportLoadIssue[]) {
    const summary = issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
    super(`BUILD_REPORT.md validation failed: ${summary}`)
    this.name = 'BuildReportLoadError'
    this.issues = Object.freeze([...issues])
  }
}

// --- serializer ----------------------------------------------------

/**
 * Renders the canonical BUILD_REPORT.md from structured data. Output is
 * deterministic: same input, same bytes.
 */
export function serializeBuildReport(data: BuildReportData): string {
  const lines: string[] = []
  lines.push(BUILD_REPORT_TITLE, '')

  // ## Task
  lines.push('## Task', '')
  lines.push(`- Task: ${data.task.taskId}`)
  lines.push(`- Title: ${data.task.title}`)
  lines.push(`- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${data.task.planSha})`)
  lines.push(`- Attempt: ${data.task.attempt}`)
  lines.push('')

  // ## Base
  lines.push('## Base', '')
  lines.push(`- Worktree: ${data.base.worktreePath}`)
  lines.push(`- Base commit: ${data.base.baseCommitSha}`)
  lines.push(`- Dirty tree at base: ${data.base.dirtyAtBase ? 'true' : 'false'}`)
  lines.push('')

  // ## Patch
  lines.push('## Patch', '')
  lines.push(`- Patch path: ${data.patch.patchPath}`)
  lines.push(`- Patch sha256: ${data.patch.patchSha256}`)
  lines.push(`- Patch byte count: ${data.patch.patchBytes}`)
  lines.push('')

  // ## Changed files
  lines.push('## Changed files', '')
  if (data.changedFiles.length === 0) {
    lines.push('- (no changes)') // never valid; parser rejects, but serializer is honest
  } else {
    for (const e of data.changedFiles) {
      lines.push(`- ${e.path} | sha256: ${e.sha256} | change: ${e.change}`)
    }
  }
  lines.push('')

  // ## Validation command
  lines.push('## Validation command', '')
  lines.push(`- Command: ${data.validationCommand.command}`)
  lines.push(`- Working directory: ${data.validationCommand.workingDirectory}`)
  lines.push(`- Timeout (ms): ${data.validationCommand.timeoutMs}`)
  lines.push(`- Expected exit code: ${data.validationCommand.expectedExitCode}`)
  lines.push('')

  // ## Failure carry-forward
  lines.push('## Failure carry-forward', '')
  if (data.failureCarryForward === null) {
    lines.push(`- None (attempt ${data.task.attempt}).`)
  } else {
    const cf = data.failureCarryForward
    lines.push(`- Source: ${cf.source}`)
    lines.push(`- Prior attempt: ${cf.priorAttempt}`)
    lines.push(`- Prior forensics: ${cf.priorForensicsPath}`)
    lines.push(`- Prior validation command: ${cf.priorValidationCommand}`)
    lines.push(`- Prior verdict: ${cf.priorVerdict}`)
    lines.push(`- Prior failure summary: ${cf.priorFailureSummary}`)
    lines.push(`- Constraint: ${cf.constraint}`)
  }
  lines.push('')

  // ## Notes
  lines.push('## Notes', '')
  if (data.notes.length === 0) {
    lines.push('- None.')
  } else {
    for (const n of data.notes) {
      lines.push(`- ${n}`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

/**
 * Parses a BUILD_REPORT.md document. Throws BuildReportLoadError on any
 * structural or grammar violation. On success returns a frozen
 * BuildReportData.
 */
export function parseBuildReport(raw: string, file = 'BUILD_REPORT.md'): BuildReportData {
  const issues: BuildReportLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new BuildReportLoadError([
      { file, code: 'build_report_empty', rule: 'BUILD_REPORT.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  // Title check
  const titleIdx = lines.findIndex((l) => l === BUILD_REPORT_TITLE)
  if (titleIdx === -1) {
    throw new BuildReportLoadError([
      {
        file,
        code: 'build_report_title_missing',
        rule: `must contain '${BUILD_REPORT_TITLE}' as a top-level heading`,
      },
    ])
  }

  // Section walk
  const sections = walkSections(lines, titleIdx + 1, file, issues)
  // Order check
  const orderIssue = checkSectionOrder(sections, file)
  if (orderIssue) issues.push(orderIssue)

  // Field extraction (must always run so the caller sees per-field issues
  // even when section order is wrong; halt only on totally missing sections).
  const required: BuildReportSectionKey[] = [...BUILD_REPORT_SECTION_KEYS]
  for (const key of required) {
    if (!sections.has(key)) {
      issues.push({
        file,
        code: 'build_report_missing_section',
        rule: `required H2 section absent: '## ${BUILD_REPORT_SECTION_HEADINGS[key]}'`,
      })
    }
  }
  if (issues.some((i) => i.code === 'build_report_missing_section')) {
    throw new BuildReportLoadError(issues)
  }

  const task = parseTask(sections.get('task')!, file, issues)
  const base = parseBase(sections.get('base')!, file, issues)
  const patch = parsePatch(sections.get('patch')!, file, issues)
  const changedFiles = parseChangedFiles(sections.get('changedFiles')!, file, issues)
  const validationCommand = parseValidationCommand(sections.get('validationCommand')!, file, issues)
  const failureCarryForward = parseFailureCarryForward(
    sections.get('failureCarryForward')!,
    file,
    issues,
    task?.attempt,
  )
  const notes = parseNotes(sections.get('notes')!, file, issues)

  if (issues.length > 0 || !task || !base || !patch || !validationCommand || !notes) {
    throw new BuildReportLoadError(issues)
  }

  return Object.freeze({
    task,
    base,
    patch,
    changedFiles: Object.freeze(changedFiles),
    validationCommand,
    failureCarryForward,
    notes: Object.freeze(notes),
  })
}

interface SectionBuf {
  readonly key: BuildReportSectionKey
  readonly bullets: readonly string[]
  readonly headingLine: number // 1-indexed
}

function walkSections(
  lines: readonly string[],
  startIdx: number,
  file: string,
  issues: BuildReportLoadIssue[],
): Map<BuildReportSectionKey, SectionBuf> {
  const headingToKey: Record<string, BuildReportSectionKey> = {}
  for (const k of BUILD_REPORT_SECTION_KEYS) {
    headingToKey[`## ${BUILD_REPORT_SECTION_HEADINGS[k]}`] = k
  }
  const map = new Map<BuildReportSectionKey, SectionBuf>()
  let cur: { key: BuildReportSectionKey; bullets: string[]; headingLine: number } | null = null

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('## ')) {
      // Flush prior
      if (cur) map.set(cur.key, Object.freeze({ ...cur, bullets: Object.freeze(cur.bullets) }))
      const key = headingToKey[line]
      if (key === undefined) {
        issues.push({
          file,
          code: 'build_report_unknown_section',
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
    // Non-bullet, non-heading lines (blank, prose, etc.) are tolerated but
    // ignored. Bullets must start with `- ` exactly (one space after the
    // dash); other markdown bullet styles fail downstream parsers.
  }
  if (cur) map.set(cur.key, Object.freeze({ ...cur, bullets: Object.freeze(cur.bullets) }))
  return map
}

function checkSectionOrder(
  sections: Map<BuildReportSectionKey, SectionBuf>,
  file: string,
): BuildReportLoadIssue | null {
  const present = [...sections.entries()].sort((a, b) => a[1].headingLine - b[1].headingLine)
  const orderActual = present.map(([k]) => k)
  let canonicalIdx = 0
  for (const k of orderActual) {
    while (
      canonicalIdx < BUILD_REPORT_SECTION_KEYS.length &&
      BUILD_REPORT_SECTION_KEYS[canonicalIdx] !== k
    ) {
      canonicalIdx++
    }
    if (canonicalIdx >= BUILD_REPORT_SECTION_KEYS.length) {
      return {
        file,
        code: 'build_report_section_out_of_order',
        rule: `section '${BUILD_REPORT_SECTION_HEADINGS[k]}' appears out of canonical order`,
      }
    }
    canonicalIdx++
  }
  return null
}

// --- per-section parsers ------------------------------------------

function parseTask(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): BuildReportTask | null {
  const m = bulletMap(s.bullets)
  const taskId = m.get('Task')
  const title = m.get('Title')
  const planRef = m.get('PLAN.md ref')
  const attemptStr = m.get('Attempt')
  if (!taskId || !title || !planRef || !attemptStr) {
    issues.push({
      file,
      code: 'build_report_task_missing_field',
      rule: '## Task requires bullets: Task, Title, PLAN.md ref, Attempt',
    })
    return null
  }
  if (!/^T-\d{3,}$/.test(taskId)) {
    issues.push({
      file,
      code: 'build_task_id_unknown',
      rule: 'Task.Task must match /^T-\\d{3,}$/',
      detail: taskId,
    })
    return null
  }
  if (title.length === 0 || title.length > 120) {
    issues.push({
      file,
      code: 'build_report_title_invalid',
      rule: 'Task.Title must be a non-empty single line ≤ 120 chars',
    })
    return null
  }
  const planMatch = planRef.match(/sha256: ([0-9a-f]{64})\)/)
  if (!planMatch) {
    issues.push({
      file,
      code: 'build_report_plan_ref_invalid',
      rule: 'Task.PLAN.md ref must include `(sha256: <64-hex>)`',
    })
    return null
  }
  const attempt = Number.parseInt(attemptStr, 10)
  if (!Number.isInteger(attempt) || attempt < 1) {
    issues.push({
      file,
      code: 'build_report_attempt_invalid',
      rule: 'Task.Attempt must be a positive integer',
    })
    return null
  }
  return Object.freeze({ taskId, title, planSha: planMatch[1]!, attempt })
}

function parseBase(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): BuildReportBase | null {
  const m = bulletMap(s.bullets)
  const worktreePath = m.get('Worktree')
  const baseCommitSha = m.get('Base commit')
  const dirtyStr = m.get('Dirty tree at base')
  if (!worktreePath || !baseCommitSha || dirtyStr === undefined) {
    issues.push({
      file,
      code: 'build_report_base_missing_field',
      rule: '## Base requires bullets: Worktree, Base commit, Dirty tree at base',
    })
    return null
  }
  if (!/^[0-9a-f]{40}$/.test(baseCommitSha)) {
    issues.push({
      file,
      code: 'build_base_commit_invalid',
      rule: 'Base.Base commit must be 40-char lower-case hex',
    })
    return null
  }
  if (dirtyStr !== 'true' && dirtyStr !== 'false') {
    issues.push({
      file,
      code: 'build_report_dirty_invalid',
      rule: 'Base.Dirty tree at base must be `true` or `false`',
    })
    return null
  }
  return Object.freeze({ worktreePath, baseCommitSha, dirtyAtBase: dirtyStr === 'true' })
}

function parsePatch(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): BuildReportPatch | null {
  const m = bulletMap(s.bullets)
  const patchPath = m.get('Patch path')
  const patchSha256 = m.get('Patch sha256')
  const patchBytesStr = m.get('Patch byte count')
  if (!patchPath || !patchSha256 || patchBytesStr === undefined) {
    issues.push({
      file,
      code: 'build_report_patch_missing_field',
      rule: '## Patch requires bullets: Patch path, Patch sha256, Patch byte count',
    })
    return null
  }
  if (!/^[0-9a-f]{64}$/.test(patchSha256)) {
    issues.push({
      file,
      code: 'build_patch_sha_invalid',
      rule: 'Patch.Patch sha256 must be 64-char lower-case hex',
    })
    return null
  }
  const patchBytes = Number.parseInt(patchBytesStr, 10)
  if (!Number.isInteger(patchBytes) || patchBytes < 0) {
    issues.push({
      file,
      code: 'build_report_patch_bytes_invalid',
      rule: 'Patch.Patch byte count must be a non-negative integer',
    })
    return null
  }
  return Object.freeze({ patchPath, patchSha256, patchBytes })
}

function parseChangedFiles(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): readonly ManifestEntry[] {
  if (s.bullets.length === 0) {
    issues.push({
      file,
      code: 'build_report_changed_files_empty',
      rule: '## Changed files must contain ≥ 1 bullet',
    })
    return []
  }
  const entries: ManifestEntry[] = []
  for (const bullet of s.bullets) {
    const match = bullet.match(/^(.+?) \| sha256: ([0-9a-f]{64}) \| change: (added|modified|deleted)$/)
    if (!match) {
      issues.push({
        file,
        code: 'build_manifest_bullet_invalid',
        rule: 'Changed-files bullet must match `<path> | sha256: <hex64> | change: <added|modified|deleted>`',
        detail: bullet,
      })
      continue
    }
    const path = match[1]!
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) {
      issues.push({
        file,
        code: 'build_manifest_path_unsafe',
        rule: 'Changed-files path must be relative, no `..` segments, no backslashes',
        detail: path,
      })
      continue
    }
    entries.push({
      path,
      sha256: match[2]!,
      change: match[3] as 'added' | 'modified' | 'deleted',
    })
  }
  return entries
}

/** Hard cap on validation-command timeout per Codex M7 review #4
 *  (block-next-milestone). 10 minutes is the v0.1 ceiling; M8 may revise
 *  if profiling data justifies. */
export const VALIDATION_TIMEOUT_MAX_MS = 600_000

function parseValidationCommand(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): BuildReportValidationCommand | null {
  const m = bulletMap(s.bullets)
  const command = m.get('Command')
  const workingDirectory = m.get('Working directory')
  const timeoutStr = m.get('Timeout (ms)')
  const exitStr = m.get('Expected exit code')
  if (!command || !workingDirectory || timeoutStr === undefined || exitStr === undefined) {
    issues.push({
      file,
      code: 'build_validation_command_missing',
      rule: '## Validation command requires bullets: Command, Working directory, Timeout (ms), Expected exit code',
    })
    return null
  }
  // Working directory must be under the run worktree. We accept either the
  // templated `.code-oz/runs/<runId>/worktree/` form OR a concrete absolute
  // path that ends in `/.code-oz/runs/<some-id>/worktree[/]`. Anything else
  // (host root, sibling path, /etc/...) is rejected so VERIFY can't be
  // tricked into running outside the worktree boundary.
  if (
    !/^\.code-oz\/runs\/<runId>\/worktree\/?$/.test(workingDirectory) &&
    !/\.code-oz\/runs\/[^/]+\/worktree\/?$/.test(workingDirectory)
  ) {
    issues.push({
      file,
      code: 'build_validation_workdir_invalid',
      rule: 'Validation command.Working directory must be the run worktree path',
      detail: workingDirectory,
    })
    return null
  }
  const timeoutMs = Number.parseInt(timeoutStr, 10)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    issues.push({
      file,
      code: 'build_validation_timeout_invalid',
      rule: 'Validation command.Timeout (ms) must be a positive integer',
    })
    return null
  }
  if (timeoutMs > VALIDATION_TIMEOUT_MAX_MS) {
    issues.push({
      file,
      code: 'build_validation_timeout_exceeds_cap',
      rule: `Validation command.Timeout (ms) must be <= ${VALIDATION_TIMEOUT_MAX_MS} (10 min v0.1 hard cap)`,
      detail: String(timeoutMs),
    })
    return null
  }
  const expectedExitCode = Number.parseInt(exitStr, 10)
  if (!Number.isInteger(expectedExitCode)) {
    issues.push({
      file,
      code: 'build_validation_exit_invalid',
      rule: 'Validation command.Expected exit code must be an integer',
    })
    return null
  }
  return Object.freeze({ command, workingDirectory, timeoutMs, expectedExitCode })
}

function parseFailureCarryForward(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
  attempt: number | undefined,
): BuildReportCarryForward | null {
  // First-bullet "None (attempt N)." check
  if (s.bullets.length === 1 && /^None \(attempt \d+\)\.$/.test(s.bullets[0]!)) {
    if (attempt !== undefined && attempt > 1) {
      issues.push({
        file,
        code: 'build_carry_forward_attempt_mismatch',
        rule: '## Failure carry-forward must NOT be `None` when Attempt > 1',
      })
    }
    return null
  }

  if (attempt !== undefined && attempt === 1) {
    issues.push({
      file,
      code: 'build_carry_forward_attempt_mismatch',
      rule: '## Failure carry-forward must be `- None (attempt 1).` when Attempt = 1',
    })
    return null
  }

  const m = bulletMap(s.bullets)
  const sourceStr = m.get('Source')
  const priorAttempt = m.get('Prior attempt')
  const priorForensicsPath = m.get('Prior forensics')
  const priorValidationCommand = m.get('Prior validation command')
  const priorVerdict = m.get('Prior verdict')
  const priorFailureSummary = m.get('Prior failure summary')
  const constraint = m.get('Constraint')
  if (
    sourceStr === undefined ||
    priorAttempt === undefined ||
    !priorForensicsPath ||
    !priorValidationCommand ||
    !priorVerdict ||
    priorFailureSummary === undefined ||
    constraint === undefined
  ) {
    issues.push({
      file,
      code: 'build_carry_forward_grammar',
      rule:
        '## Failure carry-forward bullets missing required fields ' +
        '(Source, Prior attempt, Prior forensics, Prior validation command, ' +
        'Prior verdict, Prior failure summary, Constraint)',
    })
    return null
  }
  if (
    !(BUILD_REPORT_CARRY_FORWARD_SOURCES as readonly string[]).includes(sourceStr)
  ) {
    issues.push({
      file,
      code: 'build_carry_forward_grammar',
      rule: `Source must be one of: ${BUILD_REPORT_CARRY_FORWARD_SOURCES.join(', ')}`,
      detail: `got ${JSON.stringify(sourceStr)}`,
    })
    return null
  }
  if (priorFailureSummary.length > 200 || constraint.length > 200) {
    issues.push({
      file,
      code: 'build_carry_forward_grammar',
      rule: 'Prior failure summary and Constraint each capped at 200 characters',
    })
    return null
  }
  const priorAttemptN = Number.parseInt(priorAttempt, 10)
  if (!Number.isInteger(priorAttemptN) || priorAttemptN < 1) {
    issues.push({
      file,
      code: 'build_carry_forward_grammar',
      rule: 'Prior attempt must be a positive integer',
    })
    return null
  }
  return Object.freeze({
    source: sourceStr as BuildReportCarryForwardSource,
    priorAttempt: priorAttemptN,
    priorForensicsPath,
    priorValidationCommand,
    priorVerdict,
    priorFailureSummary,
    constraint,
  })
}

function parseNotes(
  s: SectionBuf,
  file: string,
  issues: BuildReportLoadIssue[],
): readonly string[] | null {
  if (s.bullets.length === 0) {
    issues.push({
      file,
      code: 'build_report_notes_empty',
      rule: '## Notes must contain ≥ 1 bullet (use `- None.` if absent)',
    })
    return null
  }
  for (const n of s.bullets) {
    if (n.length > 200) {
      issues.push({
        file,
        code: 'build_report_notes_too_long',
        rule: 'Notes bullets capped at 200 characters',
      })
      return null
    }
  }
  return [...s.bullets]
}

// --- helpers -------------------------------------------------------

/**
 * Maps `- Key: value` bullets to a `Map<key, value>`. Bullets not matching
 * `Key: rest` are silently ignored. Trailing whitespace already stripped.
 */
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
