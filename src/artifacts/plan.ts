// PLAN.md parser + canonical serializer.
//
// Contract pinned in docs/contracts/PLAN.md.
//
// Plain Markdown only — no YAML frontmatter. The artifact begins with `# PLAN`
// and contains exactly five H2 sections in canonical order:
//
//   ## Goals
//   ## Tasks
//   ## Sources
//   ## Out of scope
//   ## Open questions
//
// The `## Tasks` section is the only section whose body contains H3 blocks.
// Every task block has the locked grammar:
//
//   ### T-NNN: <one-line title>
//
//   - Files: <comma-separated entries; each `<path>` or `<path> (modified|added|deleted)`>
//   - Validation: <one shell command>
//   - Risk: <one-line risk note>
//   - Hypotheses: <comma-separated H-NNN ids, or "none">
//   - Sources: <comma-separated source ids from SOURCE_CHECK.md>
//
// Files entries: M8 added an optional `(modified|added|deleted)` change-kind
// annotation per entry. Unannotated entries default to `modified` for backward
// compatibility; serialization always emits explicit annotations.
//
// All other H2 sections are bullets-only (mirroring SPEC.md).

import { PlanLoadError, type PlanLoadIssue } from './errors.ts'

// --- types ---------------------------------------------------------

export const PLAN_TITLE = '# PLAN' as const

export const PLAN_SECTION_KEYS = [
  'goals',
  'tasks',
  'sources',
  'outOfScope',
  'openQuestions',
] as const

export type PlanSectionKey = (typeof PLAN_SECTION_KEYS)[number]

export const PLAN_SECTION_HEADINGS: Readonly<Record<PlanSectionKey, string>> = Object.freeze({
  goals: 'Goals',
  tasks: 'Tasks',
  sources: 'Sources',
  outOfScope: 'Out of scope',
  openQuestions: 'Open questions',
})

export const PLAN_HEADING_TO_KEY: Readonly<Record<string, PlanSectionKey>> = Object.freeze(
  Object.fromEntries(
    PLAN_SECTION_KEYS.map((k) => [PLAN_SECTION_HEADINGS[k], k] as const),
  ) as Record<string, PlanSectionKey>,
)

export const PLAN_OPEN_QUESTIONS_NONE = '- None known at plan time.' as const

export const TASK_ID_PATTERN = /^T-\d{3,}$/
export const HYPOTHESIS_ID_PATTERN = /^H-\d{3,}$/
export const SOURCE_ID_PATTERN = /^SC-(SPEC|REF|REF-NONE|DOC|DOC-NONE)-\d{3,}$/

export const TASK_BULLET_KEYS = ['Files', 'Validation', 'Risk', 'Hypotheses', 'Sources'] as const

export const FILE_CHANGE_KINDS = ['modified', 'added', 'deleted'] as const
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number]

export const DEFAULT_FILE_CHANGE_KIND: FileChangeKind = 'modified'

export interface PlanTaskFile {
  readonly path: string
  readonly change: FileChangeKind
}

export interface PlanTask {
  readonly id: string                          // 'T-001'
  readonly title: string                       // one-line title
  readonly files: readonly string[]            // back-compat: paths only
  readonly fileChanges: readonly PlanTaskFile[] // M8: authoritative path + change kind
  readonly validation: string                  // single shell command
  readonly risk: string                        // one-line; literal 'none' allowed
  readonly hypotheses: readonly string[]       // [] when persona wrote "none"
  readonly sources: readonly string[]          // ≥ 1 source id
  readonly startLine?: number                  // 1-indexed, the line of `### T-NNN:`
}

export interface PlanArtifact {
  readonly title: string                    // always 'PLAN'
  readonly goals: readonly string[]
  readonly tasks: readonly PlanTask[]
  readonly sources: readonly string[]
  readonly outOfScope: readonly string[]
  readonly openQuestions: readonly string[]
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface BulletSection {
  readonly key: PlanSectionKey
  bullets: string[]
  startLine: number
}

interface TaskSection {
  readonly key: 'tasks'
  blocks: TaskBlockBuf[]
  startLine: number
}

interface TaskBlockBuf {
  id: string
  title: string
  bulletLines: { key: string; value: string; line: number }[]
  startLine: number
}

type SectionBuf = BulletSection | TaskSection

/**
 * Parse a PLAN.md document. Returns a frozen PlanArtifact on success, throws
 * PlanLoadError on any structural violation. First-violation-wins for early
 * exits; multi-issue errors are returned only when independent issues are
 * caught at the same validation step.
 */
export function parsePlan(raw: string, file = 'PLAN.md'): PlanArtifact {
  const issues: PlanLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new PlanLoadError([
      { file, code: 'plan_empty', rule: 'PLAN.md must not be empty' },
    ])
  }

  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map((l) => l.replace(/[ \t]+$/, ''))

  // Title check
  let titleLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === PLAN_TITLE) {
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
    throw new PlanLoadError([
      {
        file,
        code: 'plan_missing_title',
        rule: `PLAN.md must contain \`${PLAN_TITLE}\` as a top-level heading`,
        detail:
          firstNonEmpty === -1
            ? 'no non-empty content in PLAN.md'
            : `first non-empty line: ${JSON.stringify(lines[firstNonEmpty])}`,
        line: firstNonEmpty === -1 ? 1 : firstNonEmpty + 1,
      },
    ])
  }

  const sections: SectionBuf[] = []
  let current: SectionBuf | null = null
  let currentTaskBlock: TaskBlockBuf | null = null
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

    // H2 — section heading
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trimEnd()
      const key = PLAN_HEADING_TO_KEY[heading]
      if (key === undefined) {
        issues.push({
          file,
          code: 'plan_section_unknown',
          rule: `unknown section heading; expected one of: ${Object.values(PLAN_SECTION_HEADINGS).join(', ')}`,
          detail: heading,
          line: lineNo,
        })
        current = null
        currentTaskBlock = null
        continue
      }
      if (sections.some((s) => s.key === key)) {
        issues.push({
          file,
          code: 'plan_section_duplicated',
          rule: `section \`## ${heading}\` appears more than once`,
          detail: `key=${key}`,
          line: lineNo,
        })
        current = null
        currentTaskBlock = null
        continue
      }
      currentTaskBlock = null
      if (key === 'tasks') {
        current = { key: 'tasks', blocks: [], startLine: lineNo }
      } else {
        current = { key, bullets: [], startLine: lineNo }
      }
      sections.push(current)
      continue
    }

    // H3 — only allowed inside `## Tasks`
    if (line.startsWith('### ')) {
      if (current === null || current.key !== 'tasks') {
        issues.push({
          file,
          code: 'plan_unexpected_content',
          rule: 'H3 sub-headings only allowed inside `## Tasks`',
          detail: line,
          line: lineNo,
        })
        currentTaskBlock = null
        continue
      }
      const headingText = line.slice(4).trim()
      const colonIdx = headingText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'plan_task_malformed',
          rule: 'task heading must have form `### T-NNN: <title>`',
          detail: line,
          line: lineNo,
        })
        currentTaskBlock = null
        continue
      }
      const id = headingText.slice(0, colonIdx).trim()
      const title = headingText.slice(colonIdx + 1).trim()
      if (!TASK_ID_PATTERN.test(id)) {
        issues.push({
          file,
          code: 'plan_task_id_format',
          rule: `task id must match /^T-\\d{3,}$/`,
          detail: id,
          line: lineNo,
          taskId: id,
        })
        currentTaskBlock = null
        continue
      }
      if (title.length === 0) {
        issues.push({
          file,
          code: 'plan_task_malformed',
          rule: 'task heading must have a non-empty title after `T-NNN:`',
          detail: line,
          line: lineNo,
          taskId: id,
        })
        currentTaskBlock = null
        continue
      }
      currentTaskBlock = { id, title, bulletLines: [], startLine: lineNo }
      ;(current as TaskSection).blocks.push(currentTaskBlock)
      continue
    }

    // H1 inside body
    if (line.startsWith('# ')) {
      issues.push({
        file,
        code: 'plan_unexpected_content',
        rule: 'PLAN.md must not contain a second H1 heading',
        detail: line,
        line: lineNo,
      })
      continue
    }

    // Code fences
    if (line.startsWith('```')) {
      issues.push({
        file,
        code: 'plan_unexpected_content',
        rule: 'sections must not contain code fences',
        detail: line,
        line: lineNo,
      })
      continue
    }

    // Bullets
    if (line === '-' || line.startsWith('- ')) {
      const bulletText = line === '-' ? '' : line.slice(2).trim()
      if (bulletText.length === 0) {
        issues.push({
          file,
          code: 'plan_invalid_bullet',
          rule: 'bullets must have non-empty content',
          line: lineNo,
        })
        continue
      }
      if (current === null) {
        if (sections.length === 0) postTitlePreSectionHasContent = true
        continue
      }
      if (current.key === 'tasks') {
        if (currentTaskBlock === null) {
          issues.push({
            file,
            code: 'plan_unexpected_content',
            rule: 'bullets inside `## Tasks` must live under a `### T-NNN:` block',
            detail: line,
            line: lineNo,
          })
          continue
        }
        // Must be `<Key>: <value>`
        const colonIdx = bulletText.indexOf(':')
        if (colonIdx === -1) {
          issues.push({
            file,
            code: 'plan_task_malformed',
            rule: `task bullet must have form \`- <Key>: <value>\` where Key is one of: ${TASK_BULLET_KEYS.join(', ')}`,
            detail: bulletText,
            line: lineNo,
            taskId: currentTaskBlock.id,
          })
          continue
        }
        const k = bulletText.slice(0, colonIdx).trim()
        const v = bulletText.slice(colonIdx + 1).trim()
        currentTaskBlock.bulletLines.push({ key: k, value: v, line: lineNo })
        continue
      }
      ;(current as BulletSection).bullets.push(bulletText)
      continue
    }

    if (line.length === 0) continue

    // Anything else — paragraph etc.
    if (current === null) {
      if (sections.length === 0) postTitlePreSectionHasContent = true
      continue
    }
    issues.push({
      file,
      code: 'plan_unexpected_content',
      rule: 'section bodies must contain only bullets, blank lines, and (in Tasks) H3 task blocks',
      detail: line,
      line: lineNo,
    })
  }

  if (preTitleHasContent) {
    issues.unshift({
      file,
      code: 'plan_unexpected_content',
      rule: 'no content allowed before the `# PLAN` title',
      line: 1,
    })
  }
  if (postTitlePreSectionHasContent) {
    issues.push({
      file,
      code: 'plan_unexpected_content',
      rule: 'content between the `# PLAN` title and the first `## ` section is not allowed',
    })
  }

  // Required sections + canonical order
  const seenKeys = sections.map((s) => s.key)
  for (const key of PLAN_SECTION_KEYS) {
    if (!seenKeys.includes(key)) {
      issues.push({
        file,
        code: 'plan_missing_section',
        rule: `required section \`## ${PLAN_SECTION_HEADINGS[key]}\` is missing`,
      })
    }
  }
  if (seenKeys.length === PLAN_SECTION_KEYS.length) {
    for (let i = 0; i < PLAN_SECTION_KEYS.length; i++) {
      if (seenKeys[i] !== PLAN_SECTION_KEYS[i]) {
        issues.push({
          file,
          code: 'plan_section_out_of_order',
          rule: `sections must appear in canonical order: ${PLAN_SECTION_KEYS.map((k) => `## ${PLAN_SECTION_HEADINGS[k]}`).join(' → ')}`,
          detail: `got: ${seenKeys.map((k) => `## ${PLAN_SECTION_HEADINGS[k]}`).join(' → ')}`,
          line: sections[0]?.startLine,
        })
        break
      }
    }
  }

  // Empty-section + Tasks block validation
  for (const s of sections) {
    if (s.key === 'tasks') {
      const ts = s as TaskSection
      if (ts.blocks.length === 0) {
        issues.push({
          file,
          code: 'plan_section_empty',
          rule: 'section `## Tasks` must have ≥ 1 task block',
          line: ts.startLine,
        })
        continue
      }
      // Per-task validation: required bullets in canonical order +
      // id-format checks on the entries inside Hypotheses / Sources.
      const seenIds = new Set<string>()
      for (const block of ts.blocks) {
        if (seenIds.has(block.id)) {
          issues.push({
            file,
            code: 'plan_task_id_collision',
            rule: `task id ${block.id} appears more than once`,
            line: block.startLine,
            taskId: block.id,
          })
          continue
        }
        seenIds.add(block.id)
        const seenKeys = new Set<string>()
        let prevIdx = -1
        for (const bullet of block.bulletLines) {
          const idx = (TASK_BULLET_KEYS as readonly string[]).indexOf(bullet.key)
          if (idx === -1) {
            issues.push({
              file,
              code: 'plan_task_malformed',
              rule: `task bullet key must be one of: ${TASK_BULLET_KEYS.join(', ')}`,
              detail: bullet.key,
              line: bullet.line,
              taskId: block.id,
            })
            continue
          }
          if (seenKeys.has(bullet.key)) {
            issues.push({
              file,
              code: 'plan_task_malformed',
              rule: `task bullet \`${bullet.key}:\` appears more than once`,
              line: bullet.line,
              taskId: block.id,
            })
            continue
          }
          seenKeys.add(bullet.key)
          if (idx < prevIdx) {
            issues.push({
              file,
              code: 'plan_task_malformed',
              rule: `task bullets must appear in canonical order: ${TASK_BULLET_KEYS.join(', ')}`,
              detail: bullet.key,
              line: bullet.line,
              taskId: block.id,
            })
          }
          prevIdx = idx
          if (bullet.value.length === 0) {
            issues.push({
              file,
              code: 'plan_task_malformed',
              rule: `task bullet \`${bullet.key}:\` must have a value`,
              line: bullet.line,
              taskId: block.id,
            })
          } else if (bullet.key === 'Files') {
            // M8: optional `(modified|added|deleted)` change-kind annotation per entry.
            // Unannotated entries default to `modified` for backward compatibility.
            // Reject parentheticals that name a kind outside the locked enum.
            for (const entry of bullet.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)) {
              const parenMatch = entry.match(/^(.+?)\s*\(([^)]*)\)\s*$/)
              if (parenMatch !== null) {
                const kind = parenMatch[2]!.trim()
                if (!(FILE_CHANGE_KINDS as readonly string[]).includes(kind)) {
                  issues.push({
                    file,
                    code: 'plan_task_malformed',
                    rule: `task ${block.id}: Files entry change kind must be one of: ${FILE_CHANGE_KINDS.join(', ')} (got ${JSON.stringify(kind)})`,
                    line: bullet.line,
                    taskId: block.id,
                  })
                }
              }
            }
          } else if (bullet.key === 'Hypotheses') {
            // Allow the literal "none" sentinel; otherwise every entry must
            // match H-NNN format. Per Codex M6 review block-push #4.
            const trimmed = bullet.value.trim()
            if (trimmed.toLowerCase() !== 'none') {
              for (const entry of trimmed
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)) {
                if (!HYPOTHESIS_ID_PATTERN.test(entry)) {
                  issues.push({
                    file,
                    code: 'plan_task_malformed',
                    rule: `task ${block.id}: Hypotheses entry must match /^H-\\d{3,}$/ (got ${JSON.stringify(entry)})`,
                    line: bullet.line,
                    taskId: block.id,
                  })
                }
              }
            }
          } else if (bullet.key === 'Sources') {
            for (const entry of bullet.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)) {
              if (!SOURCE_ID_PATTERN.test(entry)) {
                issues.push({
                  file,
                  code: 'plan_task_malformed',
                  rule: `task ${block.id}: Sources entry must match /^SC-(SPEC|REF|REF-NONE|DOC|DOC-NONE)-\\d{3,}$/ (got ${JSON.stringify(entry)})`,
                  line: bullet.line,
                  taskId: block.id,
                })
              }
            }
          }
        }
        for (const required of TASK_BULLET_KEYS) {
          if (!seenKeys.has(required)) {
            issues.push({
              file,
              code: 'plan_task_missing_block',
              rule: `task ${block.id} is missing required bullet \`- ${required}: ...\``,
              line: block.startLine,
              taskId: block.id,
            })
          }
        }
      }
    } else {
      const bs = s as BulletSection
      if (bs.bullets.length === 0) {
        issues.push({
          file,
          code: 'plan_section_empty',
          rule: `section \`## ${PLAN_SECTION_HEADINGS[bs.key]}\` must have ≥ 1 bullet`,
          line: bs.startLine,
        })
      }
    }
  }

  if (issues.length > 0) throw new PlanLoadError(issues)

  // Now build the typed artifact.
  const tasksSection = sections.find((s) => s.key === 'tasks') as TaskSection
  const tasks: PlanTask[] = tasksSection.blocks.map((block) => {
    const map = new Map<string, string>()
    for (const b of block.bulletLines) map.set(b.key, b.value)
    const fileChanges = parseFileEntries(map.get('Files') ?? '')
    return Object.freeze({
      id: block.id,
      title: block.title,
      files: Object.freeze(fileChanges.map((f) => f.path)),
      fileChanges: Object.freeze(fileChanges.map((f) => Object.freeze(f) as PlanTaskFile)),
      validation: map.get('Validation') ?? '',
      risk: map.get('Risk') ?? '',
      hypotheses: Object.freeze(parseIdList(map.get('Hypotheses') ?? '')),
      sources: Object.freeze(splitCsv(map.get('Sources') ?? '')),
      startLine: block.startLine,
    }) satisfies PlanTask
  })

  const lookup = (key: PlanSectionKey): readonly string[] => {
    const found = sections.find((s) => s.key === key)
    if (found === undefined || found.key === 'tasks') return Object.freeze<string[]>([])
    return Object.freeze([...found.bullets])
  }

  return Object.freeze({
    title: 'PLAN',
    goals: lookup('goals'),
    tasks: Object.freeze(tasks),
    sources: lookup('sources'),
    outOfScope: lookup('outOfScope'),
    openQuestions: lookup('openQuestions'),
  })
}

// --- serializer ----------------------------------------------------

/**
 * Serialize a PlanArtifact to canonical Markdown.
 *
 * Canonical form:
 *   - LF line endings only
 *   - Single blank line between H1 and the first H2
 *   - Single blank line between section heading and its first child
 *   - Single blank line between consecutive sections
 *   - Single blank line between consecutive task blocks
 *   - Single trailing newline
 *   - Bullets use `- ` (single space)
 *   - Task bullets always emit in canonical order: Files, Validation, Risk, Hypotheses, Sources
 */
export function serializePlan(plan: PlanArtifact): string {
  const out: string[] = [PLAN_TITLE]

  for (const key of PLAN_SECTION_KEYS) {
    const heading = PLAN_SECTION_HEADINGS[key]
    out.push('')
    out.push(`## ${heading}`)
    out.push('')

    if (key === 'tasks') {
      plan.tasks.forEach((task, idx) => {
        if (idx > 0) out.push('')
        out.push(`### ${task.id}: ${task.title}`)
        out.push('')
        out.push(`- Files: ${task.fileChanges.map((f) => `${f.path} (${f.change})`).join(', ')}`)
        out.push(`- Validation: ${task.validation}`)
        out.push(`- Risk: ${task.risk}`)
        out.push(`- Hypotheses: ${task.hypotheses.length === 0 ? 'none' : task.hypotheses.join(', ')}`)
        out.push(`- Sources: ${task.sources.join(', ')}`)
      })
      continue
    }

    const bullets = readBullets(plan, key)
    for (const b of bullets) out.push(`- ${b}`)
  }

  return out.join('\n') + '\n'
}

function readBullets(plan: PlanArtifact, key: PlanSectionKey): readonly string[] {
  switch (key) {
    case 'goals':
      return plan.goals
    case 'sources':
      return plan.sources
    case 'outOfScope':
      return plan.outOfScope
    case 'openQuestions':
      return plan.openQuestions
    case 'tasks':
      return []
  }
}

// --- helpers -------------------------------------------------------

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function parseIdList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return []
  return splitCsv(trimmed)
}

/**
 * Parse a comma-separated list of Files entries. Each entry is either a bare
 * path or `<path> (modified|added|deleted)`. Bare entries default to
 * `change: 'modified'` for backward compatibility (M8 grammar extension).
 *
 * Pre-condition: the parser's bullet-validation pass has already rejected
 * entries with an invalid parenthetical kind, so any `(...)` reaching this
 * function matches the locked enum. Entries without a recognized parenthetical
 * shape are treated as bare paths (which preserves paths that legitimately
 * contain parentheses, even though that is unusual).
 */
function parseFileEntries(value: string): PlanTaskFile[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const m = entry.match(/^(.+?)\s*\(\s*(modified|added|deleted)\s*\)\s*$/)
      if (m !== null) {
        return { path: m[1]!.trim(), change: m[2] as FileChangeKind }
      }
      return { path: entry, change: DEFAULT_FILE_CHANGE_KIND }
    })
}

/**
 * Allocate the next free `T-NNN` id given the existing tasks. Returns a
 * zero-padded 3-digit id (e.g. `T-001`, `T-042`, `T-100`). Run-scoped: caller
 * is responsible for passing the canonical task list.
 */
export function allocateTaskId(existingTasks: readonly PlanTask[]): string {
  let max = 0
  for (const task of existingTasks) {
    const match = task.id.match(/^T-(\d+)$/)
    if (match === null) continue
    const n = Number.parseInt(match[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  const next = max + 1
  return `T-${next.toString().padStart(3, '0')}`
}

/**
 * True when the plan has at least one task and every required section is
 * non-empty.
 */
export function hasMinimumContent(plan: PlanArtifact): boolean {
  return (
    plan.goals.length >= 1 &&
    plan.tasks.length >= 1 &&
    plan.sources.length >= 1 &&
    plan.outOfScope.length >= 1 &&
    plan.openQuestions.length >= 1
  )
}
