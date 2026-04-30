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
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

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
