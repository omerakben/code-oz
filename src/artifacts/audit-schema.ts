// AUDIT.md schema + structural validator (brownfield entry-phase artifact).
//
// Authoritative contract: docs/contracts/AUDIT.md. AUDIT.md is the brownfield
// analog of SPEC.md — but unlike SPEC.md it carries a YAML frontmatter block
// before the `# AUDIT` H1, and its sections use prefixed bullets
// (Proposed:/Observed:/Unresolved: in Reproduction) plus a strict file:line
// citation format in Localization.
//
// This module owns the typed AuditArtifact shape and the parse-time validator
// `validateAuditMarkdown`, which returns a structured result (ok + issues)
// rather than throwing — mirroring how the approve hook routes a failing code
// into NEEDS_INTERVENTION (rule 11). The parser in `audit-parser.ts` wraps
// this validator and throws AuditLoadError on failure.
//
// Two contract rejection codes are deliberately OUT of scope here:
//   - `audit_reproduction_unresolved_not_routed` (rule 15) — cross-file check
//     against OPEN_QUESTIONS.md, owned by gate-preflight
//     (validateScientistSidecars), because the sidecar is written by the
//     Scientist phase-tail AFTER AUDIT.md.
//   - `audit_validation_failed` — an orchestrator outcome, not a parse rule.

import { parse as parseYaml } from 'yaml'

import type { AuditLoadErrorCode, AuditLoadIssue } from './errors.ts'

// --- typed artifact shape ------------------------------------------

export const AUDIT_TITLE = '# AUDIT' as const

export interface AuditFrontmatter {
  readonly artifact: 'AUDIT.md'
  readonly version: string
  readonly runId: string
  readonly phase: 'audit'
  readonly profile: 'brownfield'
  readonly generatedAt: string
  readonly operatorStatement: string
}

/** One `## Localization` entry: a `file:line(-line)` citation + rationale. */
export interface AuditLocalizationEntry {
  /** Repo-relative path (no leading `/` or `./`). */
  readonly path: string
  /** First cited line (positive integer). */
  readonly startLine: number
  /** Last cited line; equal to startLine for a single-line citation. */
  readonly endLine: number
  /** The one-line rationale after the ` — ` separator. */
  readonly rationale: string
  /** The verbatim bullet text (without the leading `- `). */
  readonly raw: string
}

/** `## Reproduction` split by the locked observed-vs-operator-proposed rule. */
export interface AuditReproduction {
  /** `Proposed:` bullets — the operator's stated problem, recorded faithfully. */
  readonly proposed: readonly string[]
  /** `Observed:` bullets — facts the Auditor confirmed by static read. */
  readonly observed: readonly string[]
  /** `Unresolved:` bullets — claims needing runtime; routed to OPEN_QUESTIONS.md. */
  readonly unresolved: readonly string[]
}

export interface AuditArtifact {
  readonly title: 'AUDIT'
  readonly frontmatter: AuditFrontmatter
  readonly localization: readonly AuditLocalizationEntry[]
  /** De-duplicated set of localization paths, in first-seen order. */
  readonly likelyFiles: readonly string[]
  readonly reproduction: AuditReproduction
  readonly constraints: readonly string[]
  /** `## Audit sources` flat bullets (file:line OR grep-form). */
  readonly auditSources: readonly string[]
}

// --- section model -------------------------------------------------

export const AUDIT_SECTION_KEYS = [
  'localization',
  'reproduction',
  'constraints',
  'auditSources',
] as const

export type AuditSectionKey = (typeof AUDIT_SECTION_KEYS)[number]

export const AUDIT_SECTION_HEADINGS: Readonly<Record<AuditSectionKey, string>> = Object.freeze({
  localization: 'Localization',
  reproduction: 'Reproduction',
  constraints: 'Constraints',
  auditSources: 'Audit sources',
})

const AUDIT_HEADING_TO_KEY: Readonly<Record<string, AuditSectionKey>> = Object.freeze(
  Object.fromEntries(
    AUDIT_SECTION_KEYS.map((k) => [AUDIT_SECTION_HEADINGS[k], k] as const),
  ) as Record<string, AuditSectionKey>,
)

const REQUIRED_FRONTMATTER_FIELDS = [
  'artifact',
  'version',
  'runId',
  'phase',
  'profile',
  'generatedAt',
  'operatorStatement',
] as const

// --- citation grammar ----------------------------------------------

// `[^:\s]+:\d+(-\d+)?` — a non-colon/non-space path token, a colon, a line
// number, and an optional `-line` range. Anchored so the path cannot be empty.
export const AUDIT_CITATION_PATTERN = /([^:\s]+):(\d+)(?:-(\d+))?/

// The em-dash separator the contract requires between citation and rationale.
const EM_DASH_SEP = ' — '

// --- enumerated parse-time codes -----------------------------------

/**
 * The full set of parse-time codes `validateAuditMarkdown` can emit. C6's
 * approve hook surfaces these on NEEDS_INTERVENTION. Excludes the gate-preflight
 * cross-file code and the orchestrator-outcome code (see module header).
 */
export const AUDIT_ERROR_CODES = [
  'audit_missing_frontmatter',
  'audit_frontmatter_malformed',
  'audit_frontmatter_wrong_artifact',
  'audit_frontmatter_wrong_phase',
  'audit_frontmatter_wrong_profile',
  'audit_frontmatter_runid_mismatch',
  'audit_missing_section',
  'audit_section_out_of_order',
  'audit_section_empty',
  'audit_localization_missing_citation',
  'audit_localization_citation_format',
  'audit_localization_missing_separator',
  'audit_reproduction_no_proposed',
  'audit_reproduction_observed_unverified',
  'audit_unexpected_content',
  'audit_title_missing',
] as const

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number]

export type AuditValidationIssue = AuditLoadIssue

export interface AuditValidationResult {
  readonly ok: boolean
  readonly issues: readonly AuditValidationIssue[]
  /**
   * The parsed frontmatter when it was structurally well-formed enough to read,
   * even if other (body) issues exist. Undefined when frontmatter itself failed.
   */
  readonly frontmatter?: AuditFrontmatter
}

export interface ValidateAuditOptions {
  readonly file?: string
  /** When supplied, `runId` in the frontmatter must equal this exactly. */
  readonly expectedRunId?: string
}

// --- uncertainty language (rule 14: audit_reproduction_observed_unverified) -

// An `Observed:` bullet that includes any of these phrases is rejected: an
// observed claim must be verified, and uncertainty belongs in `Unresolved:`.
const UNCERTAINTY_PHRASES = [
  'cannot confirm',
  'not verified',
  'unclear if',
  'may be',
  'possibly',
] as const

// --- internal section buffer ---------------------------------------

interface SectionBuf {
  key: AuditSectionKey
  bullets: { text: string; line: number }[]
  startLine: number
  hasUnexpected: boolean
}

const BOM = '﻿'

const FRONTMATTER_FULL = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

// --- validator -----------------------------------------------------

/**
 * Validate an AUDIT.md document structurally. Returns a result with `ok` and a
 * frozen `issues` array (mirrors spec.ts issue-code style; never throws on a
 * malformed artifact — the parser is the throwing surface). When the
 * frontmatter parses cleanly it is returned regardless of body issues so the
 * approve hook can sha-bind and report.
 */
export function validateAuditMarkdown(
  raw: string,
  opts: ValidateAuditOptions = {},
): AuditValidationResult {
  const file = opts.file ?? 'AUDIT.md'
  const issues: AuditValidationIssue[] = []
  const push = (code: AuditLoadErrorCode, rule: string, detail?: string, line?: number): void => {
    issues.push({ file, code, rule, ...(detail !== undefined ? { detail } : {}), ...(line !== undefined ? { line } : {}) })
  }

  const stripped = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  // --- frontmatter (must start on line 1) --------------------------
  if (!stripped.startsWith('---')) {
    push('audit_missing_frontmatter', 'AUDIT.md must begin with a YAML frontmatter block on line 1')
    return Object.freeze({ ok: false, issues: Object.freeze(issues) })
  }
  const fmMatch = stripped.match(FRONTMATTER_FULL)
  if (fmMatch === null) {
    push('audit_missing_frontmatter', 'frontmatter has no closing --- delimiter')
    return Object.freeze({ ok: false, issues: Object.freeze(issues) })
  }
  const yamlText = fmMatch[1] ?? ''
  const body = fmMatch[2] ?? ''

  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch (err: unknown) {
    push('audit_frontmatter_malformed', 'frontmatter must be valid YAML', err instanceof Error ? err.message : String(err))
    return Object.freeze({ ok: false, issues: Object.freeze(issues) })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    push('audit_frontmatter_malformed', 'frontmatter must be a YAML object (key/value pairs)')
    return Object.freeze({ ok: false, issues: Object.freeze(issues) })
  }
  const data = parsed as Record<string, unknown>

  // Required fields present + non-blank.
  let fieldsOk = true
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    const v = data[field]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0)) {
      push('audit_frontmatter_malformed', `frontmatter field \`${field}\` is required and must be non-blank`, field)
      fieldsOk = false
    }
  }

  // Exact-value checks (only when the field is present).
  if (data['artifact'] !== undefined && String(data['artifact']) !== 'AUDIT.md') {
    push('audit_frontmatter_wrong_artifact', '`artifact` must be exactly `AUDIT.md`', String(data['artifact']))
  }
  if (data['phase'] !== undefined && String(data['phase']) !== 'audit') {
    push('audit_frontmatter_wrong_phase', '`phase` must be exactly `audit`', String(data['phase']))
  }
  if (data['profile'] !== undefined && String(data['profile']) !== 'brownfield') {
    push('audit_frontmatter_wrong_profile', '`profile` must be exactly `brownfield`', String(data['profile']))
  }
  if (
    opts.expectedRunId !== undefined &&
    data['runId'] !== undefined &&
    String(data['runId']) !== opts.expectedRunId
  ) {
    push(
      'audit_frontmatter_runid_mismatch',
      '`runId` does not match the active run',
      `got=${String(data['runId'])} expected=${opts.expectedRunId}`,
    )
  }

  const frontmatter: AuditFrontmatter | undefined =
    fieldsOk
      ? Object.freeze({
          artifact: 'AUDIT.md',
          version: String(data['version']),
          runId: String(data['runId']),
          phase: 'audit',
          profile: 'brownfield',
          generatedAt: String(data['generatedAt']),
          operatorStatement: String(data['operatorStatement']),
        })
      : undefined

  // --- body: title + sections --------------------------------------
  // Frontmatter occupies the lines before `body`; compute its line count so the
  // body's reported line numbers are absolute (1-indexed against the whole file).
  const fmLineCount = stripped.slice(0, stripped.length - body.length).split('\n').length - 1
  const lines = body.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  // The H1 must be the first non-empty body line.
  let titleIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.length === 0) continue
    if (lines[i] === AUDIT_TITLE) titleIdx = i
    break
  }
  if (titleIdx === -1) {
    push('audit_title_missing', 'the `# AUDIT` H1 title must be the first non-frontmatter line')
  }

  const sections: SectionBuf[] = []
  const seen = new Set<AuditSectionKey>()
  let current: SectionBuf | null = null

  for (let i = 0; i < lines.length; i++) {
    if (i <= titleIdx) continue // skip everything up to and including the title
    const line = lines[i]!
    const lineNo = fmLineCount + i + 1

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim()
      const key = AUDIT_HEADING_TO_KEY[heading]
      if (key === undefined) {
        push('audit_unexpected_content', `unknown section heading; expected one of: ${Object.values(AUDIT_SECTION_HEADINGS).join(', ')}`, heading, lineNo)
        current = null
        continue
      }
      if (seen.has(key)) {
        push('audit_unexpected_content', `section \`## ${heading}\` appears more than once`, heading, lineNo)
        current = null
        continue
      }
      seen.add(key)
      current = { key, bullets: [], startLine: lineNo, hasUnexpected: false }
      sections.push(current)
      continue
    }

    if (line.length === 0) continue

    // Second H1.
    if (line.startsWith('# ')) {
      push('audit_unexpected_content', 'AUDIT.md must not contain a second H1 heading', line, lineNo)
      continue
    }
    // Sub-heading.
    if (line.startsWith('### ')) {
      if (current !== null) current.hasUnexpected = true
      push('audit_unexpected_content', 'sections must not contain sub-headings', line, lineNo)
      continue
    }
    // Code fence.
    if (line.startsWith('```')) {
      if (current !== null) current.hasUnexpected = true
      push('audit_unexpected_content', 'sections must not contain code fences', line, lineNo)
      continue
    }
    // Bullet.
    if (line === '-' || line.startsWith('- ')) {
      const text = line === '-' ? '' : line.slice(2).trim()
      if (current !== null && text.length > 0) {
        current.bullets.push({ text, line: lineNo })
      }
      continue
    }
    // Anything else inside a section body is a disallowed paragraph.
    if (current !== null) {
      current.hasUnexpected = true
      push('audit_unexpected_content', 'section bodies must contain only bullets and blank lines', line, lineNo)
    }
  }

  // Missing required sections.
  for (const key of AUDIT_SECTION_KEYS) {
    if (!seen.has(key)) {
      push('audit_missing_section', `required section \`## ${AUDIT_SECTION_HEADINGS[key]}\` is missing`)
    }
  }
  // Canonical order — only meaningful when all four are present once each.
  const orderedKeys = sections.map((s) => s.key)
  if (orderedKeys.length === AUDIT_SECTION_KEYS.length) {
    for (let i = 0; i < AUDIT_SECTION_KEYS.length; i++) {
      if (orderedKeys[i] !== AUDIT_SECTION_KEYS[i]) {
        push(
          'audit_section_out_of_order',
          `sections must appear in canonical order: ${AUDIT_SECTION_KEYS.map((k) => `## ${AUDIT_SECTION_HEADINGS[k]}`).join(' → ')}`,
          `got: ${orderedKeys.map((k) => `## ${AUDIT_SECTION_HEADINGS[k]}`).join(' → ')}`,
          sections[0]?.startLine,
        )
        break
      }
    }
  }
  // Empty sections.
  for (const s of sections) {
    if (s.bullets.length === 0) {
      push('audit_section_empty', `section \`## ${AUDIT_SECTION_HEADINGS[s.key]}\` must have ≥ 1 bullet`, undefined, s.startLine)
    }
  }

  // --- Localization citation rules ---------------------------------
  const loc = sections.find((s) => s.key === 'localization')
  if (loc !== undefined) {
    for (const b of loc.bullets) {
      validateLocalizationBullet(b.text, b.line, push)
    }
  }

  // --- Reproduction rules ------------------------------------------
  const repro = sections.find((s) => s.key === 'reproduction')
  if (repro !== undefined && repro.bullets.length > 0) {
    const hasProposed = repro.bullets.some((b) => /^Proposed:/i.test(b.text))
    if (!hasProposed) {
      push('audit_reproduction_no_proposed', '`## Reproduction` must include at least one `Proposed:` bullet (the operator statement)', undefined, repro.startLine)
    }
    for (const b of repro.bullets) {
      if (/^Observed:/i.test(b.text)) {
        const lower = b.text.toLowerCase()
        const phrase = UNCERTAINTY_PHRASES.find((p) => lower.includes(p))
        if (phrase !== undefined) {
          push(
            'audit_reproduction_observed_unverified',
            'an `Observed:` bullet must be verified; move uncertain claims to `Unresolved:`',
            `uncertainty phrase: "${phrase}"`,
            b.line,
          )
        }
      }
    }
  }

  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues.map((i) => Object.freeze({ ...i }))),
    ...(frontmatter !== undefined ? { frontmatter } : {}),
  })
}

// --- localization bullet validation --------------------------------

type Push = (code: AuditLoadErrorCode, rule: string, detail?: string, line?: number) => void

/**
 * Validate a single `## Localization` bullet against the strict citation
 * grammar. Surfaces missing-citation, format, and missing-separator codes.
 * Exported so the parser can reuse the citation extraction.
 */
function validateLocalizationBullet(text: string, line: number, push: Push): void {
  const m = text.match(AUDIT_CITATION_PATTERN)
  if (m === null) {
    push('audit_localization_missing_citation', 'a `## Localization` bullet must contain a `file:line` citation', text, line)
    return
  }
  const path = m[1]!
  const start = Number.parseInt(m[2]!, 10)
  const end = m[3] !== undefined ? Number.parseInt(m[3], 10) : start

  // Format checks: line 0, inverted range, leading slash / dot-slash.
  if (start < 1 || end < 1) {
    push('audit_localization_citation_format', 'a citation line number must be a positive integer (use `:1` for whole-file)', text, line)
  } else if (end < start) {
    push('audit_localization_citation_format', 'a citation range must have its second number ≥ the first', text, line)
  }
  if (path.startsWith('/') || path.startsWith('./')) {
    push('audit_localization_citation_format', 'a citation path must be repo-relative (no leading `/` or `./`)', path, line)
  }

  // Separator: ` — ` (em dash with surrounding spaces) before the rationale.
  if (!text.includes(EM_DASH_SEP)) {
    push('audit_localization_missing_separator', 'a `## Localization` bullet must use ` — ` (em dash) between citation and rationale', text, line)
  }
}

/**
 * Extract the citation + rationale from a Localization bullet. Returns null when
 * the bullet has no citation or no separator. Used by the parser; the validator
 * is the authority on whether the bullet is well-formed.
 */
export function parseLocalizationCitation(
  text: string,
): { path: string; startLine: number; endLine: number; rationale: string } | null {
  const m = text.match(AUDIT_CITATION_PATTERN)
  if (m === null) return null
  const sepIdx = text.indexOf(EM_DASH_SEP)
  if (sepIdx === -1) return null
  const path = m[1]!
  const startLine = Number.parseInt(m[2]!, 10)
  const endLine = m[3] !== undefined ? Number.parseInt(m[3], 10) : startLine
  const rationale = text.slice(sepIdx + EM_DASH_SEP.length).trim()
  return { path, startLine, endLine, rationale }
}

// --- internal section access for the parser ------------------------

/**
 * Re-walk the body and return per-section bullet text. The parser uses this
 * after validation has already confirmed structure, so it does not re-report
 * issues. Returns bullets keyed by canonical section.
 */
export function extractSectionBullets(
  raw: string,
): Record<AuditSectionKey, readonly string[]> {
  const stripped = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw
  const fmMatch = stripped.match(FRONTMATTER_FULL)
  const body = fmMatch !== null ? (fmMatch[2] ?? '') : stripped
  const lines = body.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  const out: Record<AuditSectionKey, string[]> = {
    localization: [],
    reproduction: [],
    constraints: [],
    auditSources: [],
  }
  let current: AuditSectionKey | null = null
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = AUDIT_HEADING_TO_KEY[line.slice(3).trim()] ?? null
      continue
    }
    if (current === null) continue
    if (line === '-' || line.startsWith('- ')) {
      const text = line === '-' ? '' : line.slice(2).trim()
      if (text.length > 0) out[current].push(text)
    }
  }
  return out
}

export function parseAuditFrontmatter(raw: string): AuditFrontmatter | undefined {
  return validateAuditMarkdown(raw).frontmatter
}
