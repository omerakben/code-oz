// SOURCE_CHECK.md parser + canonical serializer.
//
// Contract pinned in docs/contracts/SOURCE_CHECK.md.
//
// Plain Markdown only. The artifact begins with `# SOURCE_CHECK` and contains
// four required H2 sections in canonical order, plus an optional fifth:
//
//   ## Spec sources              (≥ 1 H3 block; only SC-SPEC-NNN)
//   ## Reference sources         (≥ 1 H3 block; SC-REF-NNN or SC-REF-NONE-NNN)
//   ## Docs sources              (≥ 1 H3 block; SC-DOC-NNN or SC-DOC-NONE-NNN)
//   ## Coverage                  (bullets `T-NNN -> SC-...,SC-...`)
//   ## Open questions            (optional; bullets-only)

import { SourceCheckLoadError, type SourceCheckLoadIssue } from './errors.ts'

// --- types ---------------------------------------------------------

export const SOURCE_CHECK_TITLE = '# SOURCE_CHECK' as const

export const SOURCE_CHECK_SECTION_KEYS = [
  'specSources',
  'referenceSources',
  'docsSources',
  'coverage',
  'openQuestions',
] as const

export type SourceCheckSectionKey = (typeof SOURCE_CHECK_SECTION_KEYS)[number]

export const SOURCE_CHECK_REQUIRED_SECTIONS: ReadonlyArray<SourceCheckSectionKey> = [
  'specSources',
  'referenceSources',
  'docsSources',
  'coverage',
] as const

export const SOURCE_CHECK_SECTION_HEADINGS: Readonly<Record<SourceCheckSectionKey, string>> =
  Object.freeze({
    specSources: 'Spec sources',
    referenceSources: 'Reference sources',
    docsSources: 'Docs sources',
    coverage: 'Coverage',
    openQuestions: 'Open questions',
  })

export const SOURCE_CHECK_HEADING_TO_KEY: Readonly<Record<string, SourceCheckSectionKey>> =
  Object.freeze(
    Object.fromEntries(
      SOURCE_CHECK_SECTION_KEYS.map((k) => [SOURCE_CHECK_SECTION_HEADINGS[k], k] as const),
    ) as Record<string, SourceCheckSectionKey>,
  )

export type SourceKind = 'SPEC' | 'REF' | 'REF-NONE' | 'DOC' | 'DOC-NONE'

export const SOURCE_ID_PATTERN = /^SC-(SPEC|REF|REF-NONE|DOC|DOC-NONE)-\d{3,}$/

export const TASK_ID_PATTERN = /^T-\d{3,}$/

interface BaseSource {
  readonly id: string
  readonly title: string
  readonly startLine?: number
}

export interface SpecSource extends BaseSource {
  readonly kind: 'SPEC'
  readonly spec: string
  readonly quote: string
}

export interface RefSource extends BaseSource {
  readonly kind: 'REF'
  readonly path: string
  readonly lines: string
  readonly why: string
}

export interface RefNoneSource extends BaseSource {
  readonly kind: 'REF-NONE'
  readonly searched: string
  readonly result: string
  readonly whyExplicit: string
}

export interface DocSource extends BaseSource {
  readonly kind: 'DOC'
  readonly library: string
  readonly url: string
  readonly section: string
  readonly why: string
}

export interface DocNoneSource extends BaseSource {
  readonly kind: 'DOC-NONE'
  readonly whyExplicit: string
}

export type Source = SpecSource | RefSource | RefNoneSource | DocSource | DocNoneSource

export interface CoverageEntry {
  readonly taskId: string
  readonly sourceIds: readonly string[]
}

export interface SourceCheckArtifact {
  readonly title: string                              // 'SOURCE_CHECK'
  readonly specSources: readonly SpecSource[]
  readonly referenceSources: ReadonlyArray<RefSource | RefNoneSource>
  readonly docsSources: ReadonlyArray<DocSource | DocNoneSource>
  readonly coverage: readonly CoverageEntry[]
  readonly openQuestions: readonly string[]
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface BlockBuf {
  id: string
  title: string
  bulletLines: { key: string; value: string; line: number }[]
  startLine: number
}

interface SectionBuf {
  key: SourceCheckSectionKey
  blocks: BlockBuf[]      // for the three source sections
  bullets: string[]       // for coverage and openQuestions
  startLine: number
}

const SECTION_TO_REQUIRED_PREFIX: Readonly<Record<string, readonly SourceKind[]>> = Object.freeze({
  specSources: ['SPEC'],
  referenceSources: ['REF', 'REF-NONE'],
  docsSources: ['DOC', 'DOC-NONE'],
  coverage: [],
  openQuestions: [],
} as const)

const REQUIRED_FIELDS_PER_KIND: Readonly<Record<SourceKind, readonly string[]>> = Object.freeze({
  SPEC: ['Spec', 'Quote'],
  REF: ['Path', 'Lines', 'Why'],
  'REF-NONE': ['Searched', 'Result', 'Why explicit'],
  DOC: ['Library', 'URL', 'Section', 'Why'],
  'DOC-NONE': ['Why explicit'],
})

export function parseSourceCheck(raw: string, file = 'SOURCE_CHECK.md'): SourceCheckArtifact {
  const issues: SourceCheckLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new SourceCheckLoadError([
      { file, code: 'source_check_empty', rule: 'SOURCE_CHECK.md must not be empty' },
    ])
  }

  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map((l) => l.replace(/[ \t]+$/, ''))

  let titleLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SOURCE_CHECK_TITLE) {
      titleLineIdx = i
      break
    }
  }
  if (titleLineIdx === -1) {
    let firstNonEmpty = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > 0) {
        firstNonEmpty = i
        break
      }
    }
    throw new SourceCheckLoadError([
      {
        file,
        code: 'source_check_missing_title',
        rule: `SOURCE_CHECK.md must contain \`${SOURCE_CHECK_TITLE}\` as a top-level heading`,
        detail:
          firstNonEmpty === -1
            ? 'no non-empty content'
            : `first non-empty line: ${JSON.stringify(lines[firstNonEmpty])}`,
        line: firstNonEmpty === -1 ? 1 : firstNonEmpty + 1,
      },
    ])
  }

  const sections: SectionBuf[] = []
  let current: SectionBuf | null = null
  let currentBlock: BlockBuf | null = null

  for (let i = titleLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    const lineNo = i + 1

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trimEnd()
      const key = SOURCE_CHECK_HEADING_TO_KEY[heading]
      if (key === undefined) {
        issues.push({
          file,
          code: 'source_check_section_unknown',
          rule: `unknown section heading; expected one of: ${Object.values(SOURCE_CHECK_SECTION_HEADINGS).join(', ')}`,
          detail: heading,
          line: lineNo,
        })
        current = null
        currentBlock = null
        continue
      }
      if (sections.some((s) => s.key === key)) {
        issues.push({
          file,
          code: 'source_check_section_duplicated',
          rule: `section \`## ${heading}\` appears more than once`,
          line: lineNo,
        })
        current = null
        currentBlock = null
        continue
      }
      current = { key, blocks: [], bullets: [], startLine: lineNo }
      sections.push(current)
      currentBlock = null
      continue
    }

    if (line.startsWith('### ')) {
      if (
        current === null ||
        (current.key !== 'specSources' &&
          current.key !== 'referenceSources' &&
          current.key !== 'docsSources')
      ) {
        issues.push({
          file,
          code: 'source_check_unexpected_content',
          rule: 'H3 source blocks only allowed inside `## Spec sources`, `## Reference sources`, `## Docs sources`',
          detail: line,
          line: lineNo,
        })
        currentBlock = null
        continue
      }
      const headingText = line.slice(4).trim()
      const colonIdx = headingText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'source_check_unexpected_content',
          rule: 'source block heading must have form `### SC-<KIND>-NNN: <title>`',
          detail: line,
          line: lineNo,
        })
        currentBlock = null
        continue
      }
      const id = headingText.slice(0, colonIdx).trim()
      const title = headingText.slice(colonIdx + 1).trim()
      if (!SOURCE_ID_PATTERN.test(id)) {
        issues.push({
          file,
          code: 'source_check_id_format',
          rule: `source id must match /${SOURCE_ID_PATTERN.source}/`,
          detail: id,
          line: lineNo,
          sourceId: id,
        })
        currentBlock = null
        continue
      }
      if (title.length === 0) {
        issues.push({
          file,
          code: 'source_check_unexpected_content',
          rule: 'source block heading must have a non-empty title after the id',
          detail: line,
          line: lineNo,
          sourceId: id,
        })
        currentBlock = null
        continue
      }
      currentBlock = { id, title, bulletLines: [], startLine: lineNo }
      current.blocks.push(currentBlock)
      continue
    }

    if (line.startsWith('# ')) {
      issues.push({
        file,
        code: 'source_check_unexpected_content',
        rule: 'SOURCE_CHECK.md must not contain a second H1 heading',
        detail: line,
        line: lineNo,
      })
      continue
    }

    if (line.startsWith('```')) {
      issues.push({
        file,
        code: 'source_check_unexpected_content',
        rule: 'sections must not contain code fences',
        detail: line,
        line: lineNo,
      })
      continue
    }

    if (line === '-' || line.startsWith('- ')) {
      const bulletText = line === '-' ? '' : line.slice(2).trim()
      if (bulletText.length === 0) {
        issues.push({
          file,
          code: 'source_check_unexpected_content',
          rule: 'bullets must have non-empty content',
          line: lineNo,
        })
        continue
      }
      if (current === null) continue
      if (
        current.key === 'specSources' ||
        current.key === 'referenceSources' ||
        current.key === 'docsSources'
      ) {
        if (currentBlock === null) {
          issues.push({
            file,
            code: 'source_check_unexpected_content',
            rule: 'bullets in source sections must live under a `### SC-<KIND>-NNN:` block',
            detail: line,
            line: lineNo,
          })
          continue
        }
        const colonIdx = bulletText.indexOf(':')
        if (colonIdx === -1) {
          issues.push({
            file,
            code: 'source_check_block_missing_field',
            rule: 'source block bullets must have form `- <Key>: <value>`',
            detail: bulletText,
            line: lineNo,
            sourceId: currentBlock.id,
          })
          continue
        }
        const k = bulletText.slice(0, colonIdx).trim()
        const v = bulletText.slice(colonIdx + 1).trim()
        currentBlock.bulletLines.push({ key: k, value: v, line: lineNo })
        continue
      }
      // coverage or openQuestions — bullets only
      current.bullets.push(bulletText)
      continue
    }

    if (line.length === 0) continue

    issues.push({
      file,
      code: 'source_check_unexpected_content',
      rule: 'unexpected non-bullet, non-heading content',
      detail: line,
      line: lineNo,
    })
  }

  // Required sections
  const seenKeys = sections.map((s) => s.key)
  for (const key of SOURCE_CHECK_REQUIRED_SECTIONS) {
    if (!seenKeys.includes(key)) {
      issues.push({
        file,
        code: 'source_check_missing_section',
        rule: `required section \`## ${SOURCE_CHECK_SECTION_HEADINGS[key]}\` is missing`,
      })
    }
  }
  // Order check (only for required sections; openQuestions is optional/last if present)
  if (
    seenKeys.length >= SOURCE_CHECK_REQUIRED_SECTIONS.length &&
    seenKeys.slice(0, SOURCE_CHECK_REQUIRED_SECTIONS.length).join('|') !==
      SOURCE_CHECK_REQUIRED_SECTIONS.join('|')
  ) {
    const requiredSeen = SOURCE_CHECK_REQUIRED_SECTIONS.every((k) => seenKeys.includes(k))
    if (requiredSeen) {
      issues.push({
        file,
        code: 'source_check_section_out_of_order',
        rule: `sections must appear in canonical order: ${SOURCE_CHECK_REQUIRED_SECTIONS.map((k) => `## ${SOURCE_CHECK_SECTION_HEADINGS[k]}`).join(' → ')}`,
        detail: `got: ${seenKeys.map((k) => `## ${SOURCE_CHECK_SECTION_HEADINGS[k]}`).join(' → ')}`,
        line: sections[0]?.startLine,
      })
    }
  }

  // Per-section content validation
  const allSourceIds = new Set<string>()
  const declaredSources: Array<Source> = []

  for (const s of sections) {
    if (s.key === 'specSources' || s.key === 'referenceSources' || s.key === 'docsSources') {
      if (s.blocks.length === 0) {
        issues.push({
          file,
          code: 'source_check_section_empty',
          rule: `section \`## ${SOURCE_CHECK_SECTION_HEADINGS[s.key]}\` must have ≥ 1 source block`,
          line: s.startLine,
        })
        continue
      }
      const allowedKinds = SECTION_TO_REQUIRED_PREFIX[s.key]!
      for (const block of s.blocks) {
        const kind = sourceIdKind(block.id)
        if (kind === null) continue // already reported as id_format
        if (!allowedKinds.includes(kind)) {
          issues.push({
            file,
            code: 'source_check_id_kind_mismatch',
            rule: `source id ${block.id} (${kind}) cannot live in \`## ${SOURCE_CHECK_SECTION_HEADINGS[s.key]}\`; allowed: ${allowedKinds.join(', ')}`,
            line: block.startLine,
            sourceId: block.id,
          })
          continue
        }
        if (allSourceIds.has(block.id)) {
          issues.push({
            file,
            code: 'source_check_id_collision',
            rule: `source id ${block.id} appears more than once`,
            line: block.startLine,
            sourceId: block.id,
          })
          continue
        }
        allSourceIds.add(block.id)
        const built = buildSource(block, kind, file, issues)
        if (built !== null) declaredSources.push(built)
      }
    }
    if (s.key === 'coverage' || s.key === 'openQuestions') {
      if (s.key === 'coverage' && s.bullets.length === 0) {
        issues.push({
          file,
          code: 'source_check_section_empty',
          rule: `section \`## Coverage\` must have ≥ 1 bullet`,
          line: s.startLine,
        })
      }
    }
  }

  // Coverage cross-check (against declared source ids)
  const coverageEntries: CoverageEntry[] = []
  const coverageSection = sections.find((s) => s.key === 'coverage')
  if (coverageSection !== undefined) {
    for (const bullet of coverageSection.bullets) {
      const arrow = bullet.indexOf('->')
      if (arrow === -1) {
        issues.push({
          file,
          code: 'source_check_coverage_invalid',
          rule: 'coverage bullets must have form `T-NNN -> SC-X-NNN, SC-Y-NNN`',
          detail: bullet,
        })
        continue
      }
      const taskId = bullet.slice(0, arrow).trim()
      const right = bullet.slice(arrow + 2).trim()
      if (!TASK_ID_PATTERN.test(taskId)) {
        issues.push({
          file,
          code: 'source_check_coverage_invalid',
          rule: 'coverage left side must be a valid `T-NNN` id',
          detail: taskId,
        })
        continue
      }
      const sourceIds = right
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (sourceIds.length === 0) {
        issues.push({
          file,
          code: 'source_check_coverage_invalid',
          rule: `coverage line for ${taskId} must list ≥ 1 source id`,
          detail: bullet,
        })
        continue
      }
      for (const sid of sourceIds) {
        if (!SOURCE_ID_PATTERN.test(sid)) {
          issues.push({
            file,
            code: 'source_check_coverage_invalid',
            rule: `coverage source id ${sid} is malformed`,
            detail: bullet,
          })
          continue
        }
        if (!allSourceIds.has(sid)) {
          issues.push({
            file,
            code: 'source_check_coverage_unknown_source',
            rule: `coverage cites source id ${sid} but no `+`### ${sid}: block was declared`,
            detail: bullet,
            sourceId: sid,
          })
        }
      }
      coverageEntries.push(
        Object.freeze({ taskId, sourceIds: Object.freeze([...sourceIds]) }),
      )
    }
  }

  if (issues.length > 0) throw new SourceCheckLoadError(issues)

  const specSources: SpecSource[] = []
  const referenceSources: Array<RefSource | RefNoneSource> = []
  const docsSources: Array<DocSource | DocNoneSource> = []
  for (const src of declaredSources) {
    switch (src.kind) {
      case 'SPEC':
        specSources.push(src)
        break
      case 'REF':
      case 'REF-NONE':
        referenceSources.push(src)
        break
      case 'DOC':
      case 'DOC-NONE':
        docsSources.push(src)
        break
    }
  }
  const openQuestionsSection = sections.find((s) => s.key === 'openQuestions')
  const openQuestions = openQuestionsSection
    ? Object.freeze([...openQuestionsSection.bullets])
    : Object.freeze<string[]>([])

  return Object.freeze({
    title: 'SOURCE_CHECK',
    specSources: Object.freeze(specSources),
    referenceSources: Object.freeze(referenceSources),
    docsSources: Object.freeze(docsSources),
    coverage: Object.freeze(coverageEntries),
    openQuestions,
  })
}

function sourceIdKind(id: string): SourceKind | null {
  const m = id.match(SOURCE_ID_PATTERN)
  if (m === null) return null
  return m[1] as SourceKind
}

// Patterns the parser treats as embedded empty-result indicators inside a
// REF-NONE block's `Searched:` bullet. Tolerance scope: GitHub issue #3 —
// LLMs (especially on greenfield projects) tend to merge the search action
// and its empty result into a single Searched bullet, e.g.:
//   - Searched: glob **/* (no files)
// rather than producing the contract-required separate Result bullet. When
// Result is missing AND Searched matches one of these patterns, we synthesize
// a Result bullet so the artifact validates instead of failing 3/3 retries.
//
// Discipline boundary: the tolerance fires ONLY when the missing Result is
// strongly implied by the Searched value. A REF-NONE block with no Searched
// pattern AND no Result still fails — we do not silently invent evidence.
// Extra fields (Path, Lines) on REF-NONE blocks are silently tolerated in
// the buildSource function below (unknown keys are dropped from the field
// map); this comment makes that intentional drop explicit.
//
// Design choice — restrictive patterns by construction. A few patterns
// (`\bno results?\b`, `\bno matching files?\b`) can in principle match
// query text the user is literally searching for (e.g. someone grepping
// for the phrase "no results" in their own codebase). The patterns here
// are deliberately narrow: parenthetical forms `(no files)`, `(empty)`,
// `(0 files)` are preferred because they unambiguously mark a result
// annotation rather than query text. Bare forms are kept only for the
// most common empty-search idioms LLMs emit on greenfield runs. The
// downstream defense is the `(auto-extracted from Searched)` marker —
// when the synthesized Result reaches AUDIT, the marker tells the
// reviewer the Result was inferred, not stated.
const REF_NONE_EMPTY_RESULT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\(\s*no files?\s*\)/i,
  /\(\s*only \. and \.\.\s*\)/i,
  /\(\s*empty\s*\)/i,
  /\(\s*0 files?\s*\)/i,
  /\breturned 0\b/i,
  /\bno relevant pattern found\b/i,
  /\bno matching files?\b/i,
  /\bno results?\b/i,
  /\bempty repository\b/i,
  /\b0 files?\b/i,
  /only \. and \.\./i,
  /\bno matching pattern\b/i,
])

/**
 * If the Searched bullet embeds an empty-result indicator, return a
 * synthesized Result string. Otherwise return null.
 *
 * The synthesized string is marked `(auto-extracted from Searched)` so the
 * round-tripped artifact is honest about the synthesis. Issue #3 tolerance.
 */
function synthesizeRefNoneResult(searched: string): string | null {
  for (const pattern of REF_NONE_EMPTY_RESULT_PATTERNS) {
    const m = searched.match(pattern)
    if (m !== null) {
      return `${m[0].replace(/^\(\s*|\s*\)$/g, '')} (auto-extracted from Searched)`
    }
  }
  return null
}

function buildSource(
  block: BlockBuf,
  kind: SourceKind,
  file: string,
  issues: SourceCheckLoadIssue[],
): Source | null {
  const map = new Map<string, string>()
  for (const b of block.bulletLines) {
    if (map.has(b.key)) {
      issues.push({
        file,
        code: 'source_check_block_missing_field',
        rule: `source ${block.id}: bullet \`${b.key}:\` appears more than once`,
        line: b.line,
        sourceId: block.id,
      })
      continue
    }
    map.set(b.key, b.value)
  }
  // Issue #3 tolerance: REF-NONE blocks where the LLM merged the search
  // action and its empty result into one Searched bullet (instead of
  // producing a separate Result bullet) get a synthesized Result IFF the
  // Searched value clearly embeds an empty-result pattern. This is the only
  // tolerance applied; missing fields without supporting evidence still fail.
  if (kind === 'REF-NONE') {
    const searched = map.get('Searched')
    const result = map.get('Result')
    if (searched !== undefined && searched.length > 0 && (result === undefined || result.length === 0)) {
      const synthesized = synthesizeRefNoneResult(searched)
      if (synthesized !== null) map.set('Result', synthesized)
    }
  }
  const required = REQUIRED_FIELDS_PER_KIND[kind]
  let missing = false
  for (const field of required) {
    const v = map.get(field)
    if (v === undefined || v.length === 0) {
      issues.push({
        file,
        code:
          field === 'Why explicit' &&
          (kind === 'REF-NONE' || kind === 'DOC-NONE')
            ? 'source_check_none_missing_rationale'
            : 'source_check_block_missing_field',
        rule: `source ${block.id}: missing required \`- ${field}: ...\` bullet`,
        line: block.startLine,
        sourceId: block.id,
      })
      missing = true
    }
  }
  if (missing) return null

  const base = { id: block.id, title: block.title, startLine: block.startLine }
  switch (kind) {
    case 'SPEC':
      return Object.freeze({
        ...base,
        kind: 'SPEC',
        spec: map.get('Spec')!,
        quote: map.get('Quote')!,
      })
    case 'REF':
      return Object.freeze({
        ...base,
        kind: 'REF',
        path: map.get('Path')!,
        lines: map.get('Lines')!,
        why: map.get('Why')!,
      })
    case 'REF-NONE':
      return Object.freeze({
        ...base,
        kind: 'REF-NONE',
        searched: map.get('Searched')!,
        result: map.get('Result')!,
        whyExplicit: map.get('Why explicit')!,
      })
    case 'DOC':
      return Object.freeze({
        ...base,
        kind: 'DOC',
        library: map.get('Library')!,
        url: map.get('URL')!,
        section: map.get('Section')!,
        why: map.get('Why')!,
      })
    case 'DOC-NONE':
      return Object.freeze({
        ...base,
        kind: 'DOC-NONE',
        whyExplicit: map.get('Why explicit')!,
      })
  }
}

// --- serializer ----------------------------------------------------

export function serializeSourceCheck(art: SourceCheckArtifact): string {
  const out: string[] = [SOURCE_CHECK_TITLE]

  out.push('')
  out.push('## Spec sources')
  art.specSources.forEach((src, idx) => {
    if (idx > 0) out.push('')
    out.push('')
    out.push(`### ${src.id}: ${src.title}`)
    out.push('')
    out.push(`- Spec: ${src.spec}`)
    out.push(`- Quote: ${src.quote}`)
  })

  out.push('')
  out.push('## Reference sources')
  art.referenceSources.forEach((src, idx) => {
    if (idx > 0) out.push('')
    out.push('')
    out.push(`### ${src.id}: ${src.title}`)
    out.push('')
    if (src.kind === 'REF') {
      out.push(`- Path: ${src.path}`)
      out.push(`- Lines: ${src.lines}`)
      out.push(`- Why: ${src.why}`)
    } else {
      out.push(`- Searched: ${src.searched}`)
      out.push(`- Result: ${src.result}`)
      out.push(`- Why explicit: ${src.whyExplicit}`)
    }
  })

  out.push('')
  out.push('## Docs sources')
  art.docsSources.forEach((src, idx) => {
    if (idx > 0) out.push('')
    out.push('')
    out.push(`### ${src.id}: ${src.title}`)
    out.push('')
    if (src.kind === 'DOC') {
      out.push(`- Library: ${src.library}`)
      out.push(`- URL: ${src.url}`)
      out.push(`- Section: ${src.section}`)
      out.push(`- Why: ${src.why}`)
    } else {
      out.push(`- Why explicit: ${src.whyExplicit}`)
    }
  })

  out.push('')
  out.push('## Coverage')
  out.push('')
  for (const entry of art.coverage) {
    out.push(`- ${entry.taskId} -> ${entry.sourceIds.join(', ')}`)
  }

  if (art.openQuestions.length > 0) {
    out.push('')
    out.push('## Open questions')
    out.push('')
    for (const q of art.openQuestions) out.push(`- ${q}`)
  }

  return out.join('\n') + '\n'
}

// --- helpers -------------------------------------------------------

/**
 * Cross-check that every `T-NNN` task in PLAN.md is covered in
 * SOURCE_CHECK.md with ≥ 1 SPEC source AND ≥ 1 REF or REF-NONE source AND
 * ≥ 1 DOC or DOC-NONE source. Per CLAUDE.md rule 3 + Codex M6 review
 * block-push #4.
 *
 * Returns an empty array on success; otherwise an array of human-readable
 * issue strings (caller decides how to surface).
 */
/**
 * Per-task input to `validatePlanSourceCoverage`. The full PlanTask carries
 * the `sources` list (each task's `- Sources:` bullet), so we can also
 * cross-check that PLAN's per-task citations match SOURCE_CHECK declarations
 * AND the task's Coverage row.
 */
export interface PlanTaskCoverageInput {
  readonly id: string
  readonly sources: readonly string[]
}

export function validatePlanSourceCoverage(opts: {
  readonly tasks: readonly PlanTaskCoverageInput[]
  readonly sourceCheck: SourceCheckArtifact
}): readonly string[] {
  const issues: string[] = []
  // Build a map: declared source id -> kind.
  const idToKind = new Map<string, SourceKind>()
  for (const s of opts.sourceCheck.specSources) idToKind.set(s.id, s.kind)
  for (const s of opts.sourceCheck.referenceSources) idToKind.set(s.id, s.kind)
  for (const s of opts.sourceCheck.docsSources) idToKind.set(s.id, s.kind)
  // Build a map: T-NNN -> set of source ids from Coverage.
  const taskCoverage = new Map<string, Set<string>>()
  for (const c of opts.sourceCheck.coverage) {
    if (!taskCoverage.has(c.taskId)) taskCoverage.set(c.taskId, new Set<string>())
    for (const sid of c.sourceIds) taskCoverage.get(c.taskId)!.add(sid)
  }
  const taskIdSet = new Set(opts.tasks.map((t) => t.id))
  for (const task of opts.tasks) {
    const cited = taskCoverage.get(task.id)
    if (cited === undefined || cited.size === 0) {
      issues.push(`task ${task.id} has no Coverage row in SOURCE_CHECK.md`)
      continue
    }
    // Per Codex M6 re-review: verify the PLAN task's `Sources:` set against
    // declared SOURCE_CHECK source ids AND against the task's Coverage row.
    const planSources = new Set(task.sources)
    for (const sid of planSources) {
      if (!idToKind.has(sid)) {
        issues.push(
          `task ${task.id}: PLAN.md cites Sources: ${sid} but no \`### ${sid}: ...\` block exists in SOURCE_CHECK.md`,
        )
      }
    }
    // Set equality between PLAN task's Sources and the Coverage row.
    for (const sid of planSources) {
      if (!cited.has(sid)) {
        issues.push(
          `task ${task.id}: PLAN.md cites Sources: ${sid} but the SOURCE_CHECK.md Coverage row for ${task.id} does not include it`,
        )
      }
    }
    for (const sid of cited) {
      if (!planSources.has(sid)) {
        issues.push(
          `task ${task.id}: SOURCE_CHECK.md Coverage cites ${sid} but PLAN.md task ${task.id}'s Sources: bullet does not`,
        )
      }
    }
    // The kind-coverage rule applies to the Coverage row.
    let hasSpec = false
    let hasRef = false
    let hasDoc = false
    for (const sid of cited) {
      const kind = idToKind.get(sid)
      if (kind === undefined) continue
      if (kind === 'SPEC') hasSpec = true
      else if (kind === 'REF' || kind === 'REF-NONE') hasRef = true
      else if (kind === 'DOC' || kind === 'DOC-NONE') hasDoc = true
    }
    if (!hasSpec) issues.push(`task ${task.id} Coverage missing a SPEC source`)
    if (!hasRef) issues.push(`task ${task.id} Coverage missing a REF or REF-NONE source`)
    if (!hasDoc) issues.push(`task ${task.id} Coverage missing a DOC or DOC-NONE source`)
  }
  // Reverse-check: every Coverage taskId must exist in PLAN tasks.
  for (const c of opts.sourceCheck.coverage) {
    if (!taskIdSet.has(c.taskId)) {
      issues.push(`SOURCE_CHECK.md Coverage cites unknown task ${c.taskId} (not in PLAN.md)`)
    }
  }
  return Object.freeze(issues)
}

/**
 * Allocate the next free source id for a given kind, given the existing
 * declared ids (across all kinds is fine — only same-kind ids matter for
 * collision but uniqueness within the artifact is required overall, so we
 * scan all).
 */
export function allocateSourceId(kind: SourceKind, existingIds: readonly string[]): string {
  let max = 0
  const pattern = new RegExp(`^SC-${kind.replace('-', '\\-')}-(\\d+)$`)
  for (const id of existingIds) {
    const m = id.match(pattern)
    if (m === null) continue
    const n = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  const next = max + 1
  return `SC-${kind}-${next.toString().padStart(3, '0')}`
}
