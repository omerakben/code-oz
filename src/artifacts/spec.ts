// SPEC.md parser + canonical serializer.
//
// Contract pinned in docs/references/spec-contract.md.
//
// Plain Markdown only — no YAML frontmatter. The artifact begins with `# SPEC`
// and contains exactly six H2 sections in canonical order:
//
//   ## Goals
//   ## Users
//   ## Constraints
//   ## Acceptance criteria
//   ## Open questions
//   ## Explicit non-goals
//
// Each section body contains only bullets (`- ...`) and blank lines. ≥1 bullet
// per section. Open-questions accepts the canonical empty bullet
// `- None known at define time.` when there are none.
//
// The parser returns a typed SpecArtifact OR throws SpecLoadError with a
// frozen issues array. The serializer takes a SpecArtifact and emits canonical
// Markdown with normalized whitespace.

import { SpecLoadError, type SpecLoadIssue } from './errors.ts'

// --- types ---------------------------------------------------------

export const SPEC_TITLE = '# SPEC' as const

export const SPEC_SECTION_KEYS = [
  'goals',
  'users',
  'constraints',
  'acceptance',
  'openQuestions',
  'nonGoals',
] as const

export type SpecSectionKey = (typeof SPEC_SECTION_KEYS)[number]

export const SPEC_SECTION_HEADINGS: Readonly<Record<SpecSectionKey, string>> = Object.freeze({
  goals: 'Goals',
  users: 'Users',
  constraints: 'Constraints',
  acceptance: 'Acceptance criteria',
  openQuestions: 'Open questions',
  nonGoals: 'Explicit non-goals',
})

export const SPEC_HEADING_TO_KEY: Readonly<Record<string, SpecSectionKey>> = Object.freeze(
  Object.fromEntries(
    SPEC_SECTION_KEYS.map((k) => [SPEC_SECTION_HEADINGS[k], k] as const),
  ) as Record<string, SpecSectionKey>,
)

export const SPEC_OPEN_QUESTIONS_NONE = '- None known at define time.' as const

export interface SpecArtifact {
  readonly title: string                              // always 'SPEC'
  readonly goals: readonly string[]
  readonly users: readonly string[]
  readonly constraints: readonly string[]
  readonly acceptance: readonly string[]
  readonly openQuestions: readonly string[]
  readonly nonGoals: readonly string[]
}

// --- YAML-style tolerance (issue #7) -------------------------------

// LLMs occasionally emit SPEC.md as YAML — a top-level key per section
// (`goals:` / `users:` / `acceptance_criteria:`) with indented `- bullet`
// list values — instead of the canonical `## Heading\n\n- bullet` H2-block
// schema. Tolerance scope: GitHub issue #7 — same drift class as #5
// (HYPOTHESES) and #3 (SOURCE_CHECK REF-NONE) but on the DEFINE-phase
// artifact, where any failure crashes the very first phase. We pre-rewrite
// YAML key/list pairs into canonical Markdown sections before strict parsing
// so the artifact validates instead of failing the DEFINE preview.
//
// Discipline boundary: the adapter fires ONLY on lines that start at column 0
// and match a recognised SPEC section key (case-insensitive) followed by a
// colon and end-of-line, and only when followed by indented `- bullet` lines
// or YAML-style flow lists. Canonical `## Heading` blocks pass through
// untouched, so mixed-format input (some YAML, some canonical) works. The
// strict parser still owns final validation; an unrecognised top-level key
// falls through to the strict parser's `spec_unexpected_content` error.

// Key normalisation map: every recognised input key (case folded) maps to its
// canonical section heading. Aliases (snake_case / camelCase / kebab-case /
// abbreviated forms) all collapse to the same SpecSectionKey-equivalent
// heading the strict parser understands.
const YAML_SPEC_KEY_MAP: Readonly<Record<string, string>> = Object.freeze({
  goals: 'Goals',
  users: 'Users',
  constraints: 'Constraints',
  'acceptance criteria': 'Acceptance criteria',
  acceptance_criteria: 'Acceptance criteria',
  acceptancecriteria: 'Acceptance criteria',
  'acceptance-criteria': 'Acceptance criteria',
  acceptance: 'Acceptance criteria',
  'open questions': 'Open questions',
  open_questions: 'Open questions',
  openquestions: 'Open questions',
  'open-questions': 'Open questions',
  'explicit non-goals': 'Explicit non-goals',
  'explicit non goals': 'Explicit non-goals',
  explicit_non_goals: 'Explicit non-goals',
  explicitnongoals: 'Explicit non-goals',
  'explicit-non-goals': 'Explicit non-goals',
  nongoals: 'Explicit non-goals',
  non_goals: 'Explicit non-goals',
  'non-goals': 'Explicit non-goals',
})

// Probe: column-0 line starting with a recognised SPEC section key followed
// by a colon, with no leading `## ` Markdown heading marker. Matches every
// alias spelling in YAML_SPEC_KEY_MAP via a single regex so we can short
// circuit when the input is already canonical Markdown.
const YAML_SPEC_KEY_PROBE = /^(?:goals|users|constraints|acceptance(?:[ _-]?criteria)?|open[ _-]?questions|(?:explicit[ _-])?non[ _-]?goals):\s*(?:\[.*\])?\s*$/im

const YAML_SPEC_KEY_LINE = /^([A-Za-z][A-Za-z _-]*?):\s*(.*)$/

function normalizeSpecKey(raw: string): string | null {
  const folded = raw.trim().toLowerCase()
  return YAML_SPEC_KEY_MAP[folded] ?? null
}

function parseInlineList(value: string): string[] {
  // Accepts `[a, b, c]` flow-style YAML or comma-separated bare values.
  const trimmed = value.trim()
  if (trimmed.length === 0) return []
  const flow = trimmed.match(/^\[(.*)\]$/)
  const inner = flow !== null ? flow[1]! : trimmed
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0)
}

/**
 * Pre-parse adapter: rewrite YAML-style SPEC blocks (top-level
 * `goals:` / `users:` / etc. keys with indented `- bullet` list values or
 * inline flow lists) into canonical `## Heading\n\n- bullet` Markdown
 * sections. Returns the input unchanged if no YAML markers are present.
 *
 * Issue #7 tolerance. Mixed-format input is supported — canonical `## `
 * sections pass through verbatim; only YAML key/list pairs are rewritten.
 *
 * The adapter is intentionally narrow: it does not rewrite arbitrary YAML
 * structure (only the recognised SPEC section keys), it does not invent
 * sentinel content for empty sections (the strict parser surfaces that), and
 * it preserves the canonical `# SPEC` H1 untouched.
 */
export function adaptYamlStyleSpec(raw: string): string {
  if (!YAML_SPEC_KEY_PROBE.test(raw)) return raw
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    // Only rewrite lines at column 0 that match a recognised key. Anything
    // else (canonical headings, bullets, blank lines, the H1) passes through.
    if (/^[ \t]/.test(line) || line.length === 0 || line.startsWith('#')) {
      out.push(line)
      i++
      continue
    }
    const keyMatch = line.match(YAML_SPEC_KEY_LINE)
    if (keyMatch === null) {
      out.push(line)
      i++
      continue
    }
    const heading = normalizeSpecKey(keyMatch[1]!)
    if (heading === null) {
      out.push(line)
      i++
      continue
    }
    const inlineValue = keyMatch[2]!.trim()
    const bullets: string[] = []
    if (inlineValue.length > 0) {
      // Inline flow list (`goals: [a, b]`) or single bare value (`goals: only goal`).
      bullets.push(...parseInlineList(inlineValue))
    }
    i++
    // Collect indented `- bullet` continuations until a column-0 line.
    // Blank lines inside the list are tolerated when the following non-blank
    // line is still indented; otherwise the section ends.
    while (i < lines.length) {
      const cont = lines[i]!
      if (cont.length === 0) {
        let j = i + 1
        while (j < lines.length && lines[j]!.length === 0) j++
        if (j >= lines.length) break
        if (!/^[ \t]+/.test(lines[j]!)) break
        i++
        continue
      }
      if (!/^[ \t]/.test(cont)) break
      const indented = cont.match(/^[ \t]+-\s*(.*)$/)
      if (indented === null) {
        // Indented continuation that isn't a bullet — drop it; the strict
        // parser would have rejected the same content anyway.
        i++
        continue
      }
      const bullet = indented[1]!.trim()
      if (bullet.length > 0) bullets.push(bullet)
      i++
    }
    out.push(`## ${heading}`)
    out.push('')
    for (const b of bullets) out.push(`- ${b}`)
    out.push('')
  }
  return out.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface SectionBuf {
  key: SpecSectionKey
  bullets: string[]
  startLine: number  // 1-indexed, the line of the `## Heading`
}

/**
 * Parse a SPEC.md document. Returns a frozen SpecArtifact on success, throws
 * SpecLoadError on any structural violation. First-violation-wins for early
 * exits; multi-issue errors are returned only when independent issues are
 * caught at the same validation step (e.g., section ordering vs. content).
 */
export function parseSpec(raw: string, file = 'SPEC.md'): SpecArtifact {
  const issues: SpecLoadIssue[] = []
  const adapted = adaptYamlStyleSpec(raw)
  const text = adapted.startsWith(BOM) ? adapted.slice(BOM.length) : adapted

  if (text.trim().length === 0) {
    throw new SpecLoadError([
      {
        file,
        code: 'spec_empty',
        rule: 'SPEC.md must not be empty',
      },
    ])
  }

  // Split on \r\n or \n; strip trailing whitespace per-line so windows-edited
  // files round-trip correctly.
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map((l) => l.replace(/[ \t]+$/, ''))

  // Title check — `# SPEC` must appear somewhere as a top-level heading.
  // Anything non-empty before that line is reported separately as
  // spec_unexpected_content.
  let titleLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SPEC_TITLE) {
      titleLineIdx = i
      break
    }
  }
  if (titleLineIdx === -1) {
    // Find the first non-empty line for diagnostic purposes.
    let firstNonEmpty = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > 0) {
        firstNonEmpty = i
        break
      }
    }
    throw new SpecLoadError([
      {
        file,
        code: 'spec_missing_title',
        rule: `SPEC.md must contain \`${SPEC_TITLE}\` as a top-level heading`,
        detail:
          firstNonEmpty === -1
            ? 'no non-empty content in SPEC.md'
            : `first non-empty line: ${JSON.stringify(lines[firstNonEmpty])}`,
        line: firstNonEmpty === -1 ? 1 : firstNonEmpty + 1,
      },
    ])
  }

  // Walk the body, splitting on `## ` headings.
  const sections: SectionBuf[] = []
  let current: SectionBuf | null = null
  let preTitleHasContent = false
  let postTitlePreSectionHasContent = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNo = i + 1

    if (i < titleLineIdx) {
      if (line.length > 0) preTitleHasContent = true
      continue
    }
    if (i === titleLineIdx) continue

    // Heading detection
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trimEnd()
      const key = SPEC_HEADING_TO_KEY[heading]
      if (key === undefined) {
        issues.push({
          file,
          code: 'spec_section_unknown',
          rule: `unknown section heading; expected one of: ${Object.values(SPEC_SECTION_HEADINGS).join(', ')}`,
          detail: heading,
          line: lineNo,
        })
        // Continue walking so we report all issues; the section is dropped.
        current = null
        continue
      }
      // Detect duplicates here (independent of order).
      if (sections.some((s) => s.key === key)) {
        issues.push({
          file,
          code: 'spec_section_duplicated',
          rule: `section \`## ${heading}\` appears more than once`,
          detail: `key=${key}`,
          line: lineNo,
        })
        current = null
        continue
      }
      current = { key, bullets: [], startLine: lineNo }
      sections.push(current)
      continue
    }

    // H1 inside body — reject (only one `# SPEC` allowed).
    if (line.startsWith('# ')) {
      issues.push({
        file,
        code: 'spec_unexpected_content',
        rule: 'SPEC.md must not contain a second H1 heading',
        detail: line,
        line: lineNo,
      })
      continue
    }

    // H3+ inside body — reject (sections contain only bullets).
    if (line.startsWith('### ')) {
      issues.push({
        file,
        code: 'spec_unexpected_content',
        rule: 'sections must not contain sub-headings',
        detail: line,
        line: lineNo,
      })
      continue
    }

    // Code fences — reject.
    if (line.startsWith('```')) {
      issues.push({
        file,
        code: 'spec_unexpected_content',
        rule: 'sections must not contain code fences',
        detail: line,
        line: lineNo,
      })
      continue
    }

    // Bullets — `- text` (with content) or `-` / `- ` (empty after strip).
    if (line === '-' || line.startsWith('- ')) {
      const text = line === '-' ? '' : line.slice(2).trim()
      if (text.length === 0) {
        issues.push({
          file,
          code: 'spec_invalid_bullet',
          rule: 'bullets must have non-empty content',
          line: lineNo,
        })
        continue
      }
      if (current === null) {
        if (sections.length === 0) {
          postTitlePreSectionHasContent = true
        }
        // Bullet outside any known section — already covered by either
        // unknown-heading drop or by the missing-section error below.
        continue
      }
      current.bullets.push(text)
      continue
    }

    // Empty line — separator, ignore.
    if (line.length === 0) {
      continue
    }

    // Anything else (paragraph, indented bullet, etc.) — reject.
    if (current === null) {
      if (sections.length === 0) {
        postTitlePreSectionHasContent = true
        // Don't double-report; the missing-sections error will surface.
      }
      continue
    }
    issues.push({
      file,
      code: 'spec_unexpected_content',
      rule: 'section bodies must contain only bullets and blank lines',
      detail: line,
      line: lineNo,
    })
  }

  if (preTitleHasContent) {
    issues.unshift({
      file,
      code: 'spec_unexpected_content',
      rule: 'no content allowed before the `# SPEC` title',
      line: 1,
    })
  }
  if (postTitlePreSectionHasContent) {
    issues.push({
      file,
      code: 'spec_unexpected_content',
      rule: 'content between the `# SPEC` title and the first `## ` section is not allowed',
    })
  }

  // Required sections + canonical order
  const seenKeys = sections.map((s) => s.key)
  for (const key of SPEC_SECTION_KEYS) {
    if (!seenKeys.includes(key)) {
      issues.push({
        file,
        code: 'spec_missing_section',
        rule: `required section \`## ${SPEC_SECTION_HEADINGS[key]}\` is missing`,
      })
    }
  }
  // Order check — only meaningful if all six are present.
  if (seenKeys.length === SPEC_SECTION_KEYS.length) {
    for (let i = 0; i < SPEC_SECTION_KEYS.length; i++) {
      if (seenKeys[i] !== SPEC_SECTION_KEYS[i]) {
        issues.push({
          file,
          code: 'spec_section_out_of_order',
          rule: `sections must appear in canonical order: ${SPEC_SECTION_KEYS.map((k) => `## ${SPEC_SECTION_HEADINGS[k]}`).join(' → ')}`,
          detail: `got: ${seenKeys.map((k) => `## ${SPEC_SECTION_HEADINGS[k]}`).join(' → ')}`,
          line: sections[0]?.startLine,
        })
        break
      }
    }
  }
  // Empty section check
  for (const s of sections) {
    if (s.bullets.length === 0) {
      issues.push({
        file,
        code: 'spec_section_empty',
        rule: `section \`## ${SPEC_SECTION_HEADINGS[s.key]}\` must have ≥ 1 bullet`,
        line: s.startLine,
      })
    }
  }

  if (issues.length > 0) {
    throw new SpecLoadError(issues)
  }

  // Lookup sections in canonical order (we know they're all present + ordered).
  const get = (key: SpecSectionKey): readonly string[] => {
    const found = sections.find((s) => s.key === key)
    return Object.freeze([...(found?.bullets ?? [])])
  }

  return Object.freeze({
    title: 'SPEC',
    goals: get('goals'),
    users: get('users'),
    constraints: get('constraints'),
    acceptance: get('acceptance'),
    openQuestions: get('openQuestions'),
    nonGoals: get('nonGoals'),
  })
}

// --- serializer ----------------------------------------------------

/**
 * Serialize a SpecArtifact to canonical Markdown.
 *
 * Canonical form:
 *   - LF line endings only
 *   - Single blank line between H1 and the first H2
 *   - Single blank line between section heading and its first bullet
 *   - Single blank line between consecutive sections
 *   - Single trailing newline
 *   - Bullets use `- ` (single space)
 */
export function serializeSpec(spec: SpecArtifact): string {
  const out: string[] = []
  out.push(SPEC_TITLE)

  for (const key of SPEC_SECTION_KEYS) {
    const heading = SPEC_SECTION_HEADINGS[key]
    const bullets = readBullets(spec, key)
    out.push('')
    out.push(`## ${heading}`)
    out.push('')
    for (const b of bullets) {
      out.push(`- ${b}`)
    }
  }

  return out.join('\n') + '\n'
}

function readBullets(spec: SpecArtifact, key: SpecSectionKey): readonly string[] {
  switch (key) {
    case 'goals':
      return spec.goals
    case 'users':
      return spec.users
    case 'constraints':
      return spec.constraints
    case 'acceptance':
      return spec.acceptance
    case 'openQuestions':
      return spec.openQuestions
    case 'nonGoals':
      return spec.nonGoals
  }
}

// --- helpers -------------------------------------------------------

/**
 * True when the section satisfies its "≥ 1 bullet" requirement. Open-questions
 * accepts both regular bullets and the canonical empty-bullet sentinel
 * (`- None known at define time.`).
 */
export function hasMinimumContent(spec: SpecArtifact): boolean {
  return (
    spec.goals.length >= 1 &&
    spec.users.length >= 1 &&
    spec.constraints.length >= 1 &&
    spec.acceptance.length >= 1 &&
    spec.openQuestions.length >= 1 &&
    spec.nonGoals.length >= 1
  )
}
