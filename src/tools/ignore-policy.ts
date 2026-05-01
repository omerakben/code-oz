// M10 commit 3: ignore-policy module — gitignore-subset parser with
// fail-closed unsupported syntax.
//
// Per docs/contracts/DEBATE.md § Permission sub-scope + CLAUDE.md rule 13
// (privacy by default), debate manifest preview blocks files matching
// `.code-ozignore` patterns. M10 ships this module debate-only (consumed
// only by src/tools/debate-permissions.ts in commit 5); other phases
// (BUILD/VERIFY/REVIEW/PLAN-non-debate) will adopt it during W4
// containerization. The module boundary is established now so the W4
// expansion is mechanical.
//
// Per CODEX_RESPONSE_M10.md risk #5 (subset parsing leaks by omission):
// unsupported gitignore syntax FAILS CLOSED rather than silently treating
// the pattern as a literal. The user gets an actionable error pointing
// at the offending line, with a list of supported syntax in DEBATE.md.
//
// Supported syntax (M10):
//   - Comments: lines starting with `#` are skipped.
//   - Empty lines: skipped.
//   - Plain literal:    `foo/bar.txt`     → matches that exact rel path.
//   - Trailing-slash:   `foo/`            → matches anything under foo/.
//   - Single-segment *: `foo/*.ts`        → matches files in foo/ named *.ts.
//   - Recursive prefix: `**/secrets.json` → matches at any depth.
//
// Unsupported syntax (M10 — fail closed, not silently literal):
//   - Negation:           `!pattern`
//   - Rooted absolute:    `/pattern`         (gitignore: anchored to root)
//   - Bracket class:      `[abc]`
//   - Escaped sequences:  `pattern\ name` or any `\` not at end-of-line
//   - Trailing recursive: `pattern/**`        (vs supported `**/pattern`)
//
// W4 may expand support; doing so requires this module's tests + the
// DEBATE.md § Ignore-policy subset doc to grow in lockstep.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type IgnorePolicySource = 'absent' | 'present'

export type IgnorePatternKind =
  | 'literal'           // foo/bar.txt
  | 'directory-prefix'  // foo/
  | 'segment-glob'      // foo/*.ts
  | 'recursive-prefix'  // **/secrets.json

export interface IgnorePattern {
  /** Raw line text from .code-ozignore (untrimmed for forensics; trimmed for matching). */
  readonly raw: string
  /** 1-indexed line number for error reporting. */
  readonly line: number
  /** Compiled regex that tests against project-root-relative POSIX paths. */
  readonly compiled: RegExp
  readonly kind: IgnorePatternKind
}

export interface IgnorePolicy {
  readonly source: IgnorePolicySource
  readonly patterns: readonly IgnorePattern[]
  /** Absolute path the policy was loaded from (or attempted), for forensics. */
  readonly path: string | null
}

export interface IgnorePolicyIssue {
  readonly code: 'ignore_policy_unsupported_syntax' | 'ignore_policy_invalid_pattern'
  readonly line: number
  readonly raw: string
  readonly rule: string
  readonly detail?: string
}

export class IgnorePolicyError extends Error {
  readonly issues: readonly IgnorePolicyIssue[]
  readonly path: string | null
  constructor(issues: readonly IgnorePolicyIssue[], path: string | null) {
    super(formatIgnorePolicyError(issues, path))
    this.name = 'IgnorePolicyError'
    this.issues = issues
    this.path = path
  }
}

function formatIgnorePolicyError(
  issues: readonly IgnorePolicyIssue[],
  path: string | null,
): string {
  const where = path ?? '.code-ozignore'
  const lines = issues.map(
    (i) => `  ${where}:${i.line}: ${i.rule} — got ${JSON.stringify(i.raw)}`,
  )
  return `ignore-policy parse error (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`
}

/**
 * Load `.code-ozignore` from the given project root. Absent file → empty
 * policy (source: 'absent'). Present file → parse, validate, throw
 * IgnorePolicyError on any unsupported syntax.
 */
export async function loadIgnorePolicy(projectRoot: string): Promise<IgnorePolicy> {
  const filePath = join(projectRoot, '.code-ozignore')
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({
        source: 'absent' as const,
        patterns: Object.freeze([]),
        path: null,
      })
    }
    throw err
  }
  return parseIgnorePolicy(content, filePath)
}

/**
 * Pure parser for testing and direct content sources. Throws
 * IgnorePolicyError on any unsupported syntax (fail closed).
 */
export function parseIgnorePolicy(content: string, path: string | null = null): IgnorePolicy {
  const issues: IgnorePolicyIssue[] = []
  const patterns: IgnorePattern[] = []
  // Split on \n and \r\n; preserve line numbers.
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i] as string
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue
    const issue = checkUnsupportedSyntax(trimmed, raw, lineNum)
    if (issue) {
      issues.push(issue)
      continue
    }
    const compiled = compilePattern(trimmed, raw, lineNum, issues)
    if (compiled) patterns.push(compiled)
  }
  if (issues.length > 0) {
    throw new IgnorePolicyError(issues, path)
  }
  return Object.freeze({
    source: 'present' as const,
    patterns: Object.freeze(patterns),
    path,
  })
}

function checkUnsupportedSyntax(
  trimmed: string,
  raw: string,
  line: number,
): IgnorePolicyIssue | null {
  // Negation
  if (trimmed.startsWith('!')) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'leading `!` (negation) is not supported in M10; fail closed',
    }
  }
  // Rooted-absolute
  if (trimmed.startsWith('/')) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'leading `/` (rooted-absolute pattern) is not supported in M10; fail closed',
    }
  }
  // Bracket character classes
  if (trimmed.includes('[') || trimmed.includes(']')) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'bracket character classes (`[...]`) are not supported in M10; fail closed',
    }
  }
  // Escape sequences (any `\`)
  if (trimmed.includes('\\')) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'backslash escapes (`\\`) are not supported in M10; fail closed',
    }
  }
  // Trailing `**` (vs supported `**/`)
  if (trimmed.endsWith('/**') || trimmed === '**') {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'trailing `**` (e.g., `pattern/**`) is not supported in M10; use a directory-prefix pattern (`pattern/`) instead; fail closed',
    }
  }
  // `**` mid-pattern in any position other than leading `**/`
  // Allowed: pattern starts with `**/` exactly. Disallow other `**`.
  const doubleStarIdx = trimmed.indexOf('**')
  if (doubleStarIdx !== -1 && doubleStarIdx !== 0) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'mid-pattern `**` is not supported in M10; only leading `**/` is allowed; fail closed',
    }
  }
  if (doubleStarIdx === 0 && !trimmed.startsWith('**/')) {
    return {
      code: 'ignore_policy_unsupported_syntax',
      line,
      raw,
      rule: 'leading `**` must be followed by `/` (e.g., `**/secrets.json`); fail closed',
    }
  }
  return null
}

function compilePattern(
  trimmed: string,
  raw: string,
  line: number,
  issues: IgnorePolicyIssue[],
): IgnorePattern | null {
  // Directory-prefix: trailing slash. Compile to `^<escaped>/.*$`.
  if (trimmed.endsWith('/')) {
    const stem = trimmed.slice(0, -1)
    if (stem.length === 0) {
      issues.push({
        code: 'ignore_policy_invalid_pattern',
        line,
        raw,
        rule: 'directory-prefix pattern must have a non-empty stem',
      })
      return null
    }
    if (stem.includes('*')) {
      issues.push({
        code: 'ignore_policy_unsupported_syntax',
        line,
        raw,
        rule: 'wildcards inside directory-prefix patterns are not supported in M10; fail closed',
      })
      return null
    }
    return {
      raw,
      line,
      kind: 'directory-prefix',
      compiled: new RegExp(`^${escapeForRegex(stem)}/.*$`),
    }
  }
  // Recursive prefix: `**/<rest>`. Compile to `^(.*/)?<rest>$`.
  if (trimmed.startsWith('**/')) {
    const rest = trimmed.slice(3)
    if (rest.length === 0) {
      issues.push({
        code: 'ignore_policy_invalid_pattern',
        line,
        raw,
        rule: 'recursive prefix `**/` must be followed by a pattern',
      })
      return null
    }
    // The rest may contain a single-segment `*` glob; we permit `*` but
    // not `**` (already filtered by checkUnsupportedSyntax above for
    // mid-pattern `**`).
    const restPattern = compileSegmentGlob(rest)
    return {
      raw,
      line,
      kind: 'recursive-prefix',
      compiled: new RegExp(`^(?:.*/)?${restPattern}$`),
    }
  }
  // Segment glob: pattern contains a `*` (single-segment wildcard).
  if (trimmed.includes('*')) {
    return {
      raw,
      line,
      kind: 'segment-glob',
      compiled: new RegExp(`^${compileSegmentGlob(trimmed)}$`),
    }
  }
  // Literal: no wildcards, no trailing slash.
  return {
    raw,
    line,
    kind: 'literal',
    compiled: new RegExp(`^${escapeForRegex(trimmed)}$`),
  }
}

/**
 * Compile a pattern that may contain `*` (single-segment wildcard) into
 * a regex source string. `*` matches any non-`/` characters; literal
 * regex metacharacters are escaped.
 */
function compileSegmentGlob(pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string
    if (ch === '*') {
      out += '[^/]*'
    } else {
      out += escapeForRegex(ch)
    }
  }
  return out
}

function escapeForRegex(s: string): string {
  return s.replace(/[.+^${}()|\[\]\\]/g, '\\$&')
}

/**
 * Test a project-root-relative POSIX path against the policy. Returns
 * the first matching pattern (for forensics) or null.
 *
 * Path normalization: absolute paths and `..` segments are NOT supported
 * here — callers must normalize before calling. Backslash separators
 * are rejected (forward-slash POSIX-style only). The debate-permissions
 * module (commit 5) handles normalization upstream.
 */
export function matchIgnore(
  policy: IgnorePolicy,
  relPath: string,
): IgnorePattern | null {
  if (policy.source === 'absent') return null
  if (relPath.length === 0) return null
  if (relPath.includes('\\')) return null
  if (relPath.startsWith('/')) return null
  for (const p of policy.patterns) {
    if (p.compiled.test(relPath)) return p
  }
  return null
}

/**
 * Convenience boolean form of matchIgnore.
 */
export function isIgnored(policy: IgnorePolicy, relPath: string): boolean {
  return matchIgnore(policy, relPath) !== null
}
