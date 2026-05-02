// OPEN_QUESTIONS.md parser, serializer, allocator, and atomic writer.
//
// Contract pinned in docs/contracts/OPEN_QUESTIONS.md.
//
// Plain Markdown only. The artifact begins with `# OPEN QUESTIONS` and
// contains zero or more `## Q-NNN: <question>` blocks. Each block has six
// required bullets in canonical order, plus an optional `Resolved:` bullet
// when status is `resolved`:
//
//   - Phase: <phase>
//   - Status: <open | resolved | deferred>
//   - Importance: <low | medium | high | blocking>
//   - DueBy: <YYYY-MM-DD or `-`>
//   - Context: <one-line>
//   - Resolution attempts: <one line; `none yet.` sentinel allowed>
//   - Resolved: <YYYY-MM-DD> — <resolution>     (required iff Status: resolved)

import { atomicWriteFile, type AtomicWriteOptions } from './atomic-write.ts'
import { OpenQuestionsLoadError, type OpenQuestionsLoadIssue } from './errors.ts'
import { PHASES, type Phase } from '../state/schemas.ts'

// --- types ---------------------------------------------------------

export const OPEN_QUESTIONS_TITLE = '# OPEN QUESTIONS' as const

export const QUESTION_ID_PATTERN = /^Q-\d{3,}$/

export const QUESTION_STATUSES = ['open', 'resolved', 'deferred'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const QUESTION_IMPORTANCES = ['low', 'medium', 'high', 'blocking'] as const
export type QuestionImportance = (typeof QUESTION_IMPORTANCES)[number]

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const QUESTION_BULLET_KEYS = [
  'Phase',
  'Status',
  'Importance',
  'DueBy',
  'Context',
  'Resolution attempts',
] as const

export interface OpenQuestion {
  readonly id: string                          // Q-NNN
  readonly question: string                    // the heading text after `Q-NNN:`
  readonly phase: Phase
  readonly status: QuestionStatus
  readonly importance: QuestionImportance
  readonly dueBy: string | null                // ISO YYYY-MM-DD; null when `-`
  readonly context: string
  readonly resolutionAttempts: string          // verbatim line; "none yet." sentinel allowed
  readonly resolved: { readonly date: string; readonly note: string } | null
  readonly startLine?: number
}

export interface OpenQuestionsArtifact {
  readonly title: string                       // 'OPEN QUESTIONS'
  readonly questions: readonly OpenQuestion[]
}

// --- YAML-style tolerance (issue #5) -------------------------------

// Mirror of the HYPOTHESES.md adapter. The Scientist persona has been observed
// emitting OPEN_QUESTIONS.md as YAML-style block entries (`- id: Q-NNN` with
// indented `question:` / `phase_introduced:` / `due_by:` continuation lines)
// instead of the canonical `## Q-NNN:` H2-block schema. We pre-rewrite YAML
// blocks before strict parsing so the artifact validates instead of failing
// the PLAN gate.
//
// Discipline boundary: the adapter fires ONLY on `- id: Q-NNN` lines.
// Canonical `## Q-NNN:` blocks pass through untouched (mixed-format input
// works). Synthesized fields (DueBy default `-`, Resolution attempts default
// `none yet.`, missing context) are conservative defaults that the contract
// already permits — they do not invent semantics. The strict parser still owns
// final validation.
//
// Issue #5 closes here in concert with the HYPOTHESES.md tolerance.

const YAML_Q_ID_PROBE = /^-\s+id:\s*Q-\d+\s*$/m
const YAML_Q_ID_LINE = /^-\s+id:\s*(Q-\d+)\s*$/
const YAML_Q_CONTINUATION = /^[ \t]+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/

const YAML_Q_STATUS_MAP: Record<string, string> = Object.freeze({
  proposed: 'open',
  draft: 'open',
  pending: 'open',
})

function firstNonEmptyLineQ(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? trimmed : trimmed.slice(0, nl).trim()
}

function renderQuestionYamlBlock(id: string, fields: Map<string, string>): string[] {
  const questionRaw = fields.get('question') ?? fields.get('text') ?? fields.get('title') ?? ''
  const question = firstNonEmptyLineQ(questionRaw) || '(question not provided)'
  const phase = fields.get('phase_introduced') ?? fields.get('phase') ?? 'plan'
  const rawStatus = fields.get('status') ?? 'open'
  const status = YAML_Q_STATUS_MAP[rawStatus] ?? rawStatus
  const importance = fields.get('importance') ?? 'medium'
  const dueByRaw = fields.get('due_by') ?? fields.get('dueby') ?? '-'
  const dueBy = dueByRaw.length === 0 ? '-' : dueByRaw
  const context = fields.get('context') ?? '(context not provided by Scientist)'
  const resolutionAttempts =
    fields.get('resolution_attempts') ?? fields.get('attempts') ?? 'none yet.'
  const out = [
    `## ${id}: ${question}`,
    '',
    `- Phase: ${phase}`,
    `- Status: ${status}`,
    `- Importance: ${importance}`,
    `- DueBy: ${dueBy}`,
    `- Context: ${context}`,
    `- Resolution attempts: ${resolutionAttempts}`,
  ]
  if (status === 'resolved') {
    const resolved = fields.get('resolved') ?? ''
    if (resolved.length > 0) {
      out.push(`- Resolved: ${resolved}`)
    } else {
      const today = new Date().toISOString().slice(0, 10)
      out.push(
        `- Resolved: ${today} — (auto-synthesized — Scientist did not specify resolution; investigate)`,
      )
    }
  }
  return out
}

/**
 * Pre-parse adapter: rewrite YAML-style question blocks (`- id: Q-NNN` with
 * indented `key:` continuations) into the canonical `## Q-NNN:` H2-block
 * schema. Returns the input unchanged if no YAML markers are present.
 *
 * Issue #5 tolerance. Mixed-format input is supported — canonical H2 blocks
 * are passed through verbatim; only YAML blocks are rewritten.
 */
export function adaptYamlStyleOpenQuestions(raw: string): string {
  if (!YAML_Q_ID_PROBE.test(raw)) return raw
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const idMatch = line.match(YAML_Q_ID_LINE)
    if (idMatch === null) {
      out.push(line)
      i++
      continue
    }
    const id = idMatch[1]!
    const fields = new Map<string, string>()
    i++
    while (i < lines.length) {
      const cont = lines[i]!
      const contMatch = cont.match(YAML_Q_CONTINUATION)
      if (contMatch === null) break
      const key = contMatch[1]!.toLowerCase()
      const value = contMatch[2]!.trim()
      if (!fields.has(key)) fields.set(key, value)
      i++
    }
    out.push(...renderQuestionYamlBlock(id, fields))
  }
  return out.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface QuestionBuf {
  id: string
  question: string
  bulletLines: { key: string; value: string; line: number }[]
  startLine: number
}

export function parseOpenQuestions(
  raw: string,
  file = 'OPEN_QUESTIONS.md',
): OpenQuestionsArtifact {
  const issues: OpenQuestionsLoadIssue[] = []
  const adapted = adaptYamlStyleOpenQuestions(raw)
  const text = adapted.startsWith(BOM) ? adapted.slice(BOM.length) : adapted

  if (text.trim().length === 0) {
    throw new OpenQuestionsLoadError([
      { file, code: 'open_questions_empty', rule: 'OPEN_QUESTIONS.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  let titleIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === OPEN_QUESTIONS_TITLE) {
      titleIdx = i
      break
    }
  }
  if (titleIdx === -1) {
    throw new OpenQuestionsLoadError([
      {
        file,
        code: 'open_questions_missing_title',
        rule: `OPEN_QUESTIONS.md must contain \`${OPEN_QUESTIONS_TITLE}\` as a top-level heading`,
        line: 1,
      },
    ])
  }

  const blocks: QuestionBuf[] = []
  let current: QuestionBuf | null = null

  for (let i = titleIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    const lineNo = i + 1

    if (line.startsWith('## ')) {
      const headingText = line.slice(3).trim()
      const colonIdx = headingText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'question_unexpected_content',
          rule: 'question heading must have form `## Q-NNN: <question>`',
          detail: line,
          line: lineNo,
        })
        current = null
        continue
      }
      const id = headingText.slice(0, colonIdx).trim()
      const question = headingText.slice(colonIdx + 1).trim()
      if (!QUESTION_ID_PATTERN.test(id)) {
        issues.push({
          file,
          code: 'question_id_format',
          rule: `question id must match /^Q-\\d{3,}$/`,
          detail: id,
          line: lineNo,
          questionId: id,
        })
        current = null
        continue
      }
      if (question.length === 0) {
        issues.push({
          file,
          code: 'question_unexpected_content',
          rule: 'question heading must have non-empty text after `Q-NNN:`',
          detail: line,
          line: lineNo,
          questionId: id,
        })
        current = null
        continue
      }
      current = { id, question, bulletLines: [], startLine: lineNo }
      blocks.push(current)
      continue
    }

    if (line.startsWith('# ') || line.startsWith('### ') || line.startsWith('```')) {
      issues.push({
        file,
        code: 'question_unexpected_content',
        rule: 'OPEN_QUESTIONS.md must not contain second H1, H3+, or code fences',
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
          code: 'question_unexpected_content',
          rule: 'bullets must have non-empty content',
          line: lineNo,
        })
        continue
      }
      if (current === null) {
        issues.push({
          file,
          code: 'question_unexpected_content',
          rule: 'bullets must live under a `## Q-NNN:` block',
          detail: line,
          line: lineNo,
        })
        continue
      }
      const colonIdx = bulletText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'question_missing_section',
          rule: `question bullet must have form \`- <Key>: <value>\``,
          detail: bulletText,
          line: lineNo,
          questionId: current.id,
        })
        continue
      }
      const k = bulletText.slice(0, colonIdx).trim()
      const v = bulletText.slice(colonIdx + 1).trim()
      current.bulletLines.push({ key: k, value: v, line: lineNo })
      continue
    }

    if (line.length === 0) continue

    issues.push({
      file,
      code: 'question_unexpected_content',
      rule: 'OPEN_QUESTIONS.md sections must contain only bullets and blank lines',
      detail: line,
      line: lineNo,
    })
  }

  // Validate per-block
  const seenIds = new Set<string>()
  for (const block of blocks) {
    if (seenIds.has(block.id)) {
      issues.push({
        file,
        code: 'question_id_collision',
        rule: `question id ${block.id} appears more than once`,
        line: block.startLine,
        questionId: block.id,
      })
      continue
    }
    seenIds.add(block.id)

    const seen = new Set<string>()
    for (const b of block.bulletLines) {
      const isStandard = (QUESTION_BULLET_KEYS as readonly string[]).includes(b.key)
      const isResolved = b.key === 'Resolved'
      if (!isStandard && !isResolved) {
        issues.push({
          file,
          code: 'question_missing_section',
          rule: `question bullet key must be one of: ${[...QUESTION_BULLET_KEYS, 'Resolved'].join(', ')}`,
          detail: b.key,
          line: b.line,
          questionId: block.id,
        })
        continue
      }
      if (seen.has(b.key)) {
        issues.push({
          file,
          code: 'question_unexpected_content',
          rule: `question bullet \`${b.key}:\` appears more than once`,
          line: b.line,
          questionId: block.id,
        })
        continue
      }
      seen.add(b.key)
      if (b.value.length === 0) {
        issues.push({
          file,
          code: 'question_missing_section',
          rule: `question bullet \`${b.key}:\` must have a value`,
          line: b.line,
          questionId: block.id,
        })
        continue
      }
      switch (b.key) {
        case 'Phase':
          if (!(PHASES as readonly string[]).includes(b.value)) {
            issues.push({
              file,
              code: 'question_invalid_phase',
              rule: `question phase must be one of: ${PHASES.join(', ')}`,
              detail: b.value,
              line: b.line,
              questionId: block.id,
            })
          }
          break
        case 'Status':
          if (!(QUESTION_STATUSES as readonly string[]).includes(b.value)) {
            issues.push({
              file,
              code: 'question_invalid_status',
              rule: `question status must be one of: ${QUESTION_STATUSES.join(', ')}`,
              detail: b.value,
              line: b.line,
              questionId: block.id,
            })
          }
          break
        case 'Importance':
          if (!(QUESTION_IMPORTANCES as readonly string[]).includes(b.value)) {
            issues.push({
              file,
              code: 'question_invalid_importance',
              rule: `question importance must be one of: ${QUESTION_IMPORTANCES.join(', ')}`,
              detail: b.value,
              line: b.line,
              questionId: block.id,
            })
          }
          break
        case 'DueBy':
          if (b.value !== '-' && !ISO_DATE_PATTERN.test(b.value)) {
            issues.push({
              file,
              code: 'question_invalid_dueby',
              rule: 'DueBy must be ISO `YYYY-MM-DD` or `-`',
              detail: b.value,
              line: b.line,
              questionId: block.id,
            })
          }
          break
      }
    }
    for (const required of QUESTION_BULLET_KEYS) {
      if (!seen.has(required)) {
        issues.push({
          file,
          code: 'question_missing_section',
          rule: `question ${block.id} is missing required bullet \`- ${required}: ...\``,
          line: block.startLine,
          questionId: block.id,
        })
      }
    }
    // If status is resolved, the Resolved: bullet must be present.
    const map = new Map<string, string>()
    for (const b of block.bulletLines) {
      if (!map.has(b.key)) map.set(b.key, b.value)
    }
    if (map.get('Status') === 'resolved' && !seen.has('Resolved')) {
      issues.push({
        file,
        code: 'question_resolved_missing_resolution',
        rule: `question ${block.id} has Status: resolved but no \`- Resolved: <date> — <note>\` bullet`,
        line: block.startLine,
        questionId: block.id,
      })
    }
  }

  if (issues.length > 0) throw new OpenQuestionsLoadError(issues)

  const questions: OpenQuestion[] = blocks.map((block) => {
    const map = new Map<string, string>()
    for (const b of block.bulletLines) map.set(b.key, b.value)
    const dueByVal = map.get('DueBy')!
    const resolvedVal = map.get('Resolved')
    let resolved: { date: string; note: string } | null = null
    if (resolvedVal !== undefined) {
      const dashIdx = resolvedVal.indexOf('—')
      const sepIdx = dashIdx >= 0 ? dashIdx : resolvedVal.indexOf('-')
      if (sepIdx >= 0) {
        resolved = {
          date: resolvedVal.slice(0, sepIdx).trim(),
          note: resolvedVal.slice(sepIdx + 1).trim(),
        }
      } else {
        resolved = { date: resolvedVal.trim(), note: '' }
      }
    }
    return Object.freeze({
      id: block.id,
      question: block.question,
      phase: map.get('Phase') as Phase,
      status: map.get('Status') as QuestionStatus,
      importance: map.get('Importance') as QuestionImportance,
      dueBy: dueByVal === '-' ? null : dueByVal,
      context: map.get('Context')!,
      resolutionAttempts: map.get('Resolution attempts')!,
      resolved: resolved !== null ? Object.freeze(resolved) : null,
      startLine: block.startLine,
    }) satisfies OpenQuestion
  })

  return Object.freeze({
    title: 'OPEN QUESTIONS',
    questions: Object.freeze(questions),
  })
}

// --- serializer ----------------------------------------------------

export function serializeOpenQuestions(art: OpenQuestionsArtifact): string {
  const out: string[] = [OPEN_QUESTIONS_TITLE]
  for (const q of art.questions) {
    out.push('')
    out.push(`## ${q.id}: ${q.question}`)
    out.push('')
    out.push(`- Phase: ${q.phase}`)
    out.push(`- Status: ${q.status}`)
    out.push(`- Importance: ${q.importance}`)
    out.push(`- DueBy: ${q.dueBy === null ? '-' : q.dueBy}`)
    out.push(`- Context: ${q.context}`)
    out.push(`- Resolution attempts: ${q.resolutionAttempts}`)
    if (q.resolved !== null) {
      out.push(`- Resolved: ${q.resolved.date} — ${q.resolved.note}`)
    }
  }
  return out.join('\n') + '\n'
}

// --- allocator + writer -------------------------------------------

export function allocateQuestionId(existing: readonly OpenQuestion[]): string {
  let max = 0
  for (const q of existing) {
    const m = q.id.match(/^Q-(\d+)$/)
    if (m === null) continue
    const n = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  const next = max + 1
  return `Q-${next.toString().padStart(3, '0')}`
}

/**
 * Returns the subset of questions that block a gate-preflight: open + blocking
 * importance, or open + dueBy strictly less than `today` (today is an ISO date
 * string in `YYYY-MM-DD` form).
 */
export function findGateBlockingQuestions(
  art: OpenQuestionsArtifact,
  today: string,
): readonly OpenQuestion[] {
  if (!ISO_DATE_PATTERN.test(today)) {
    throw new Error(`findGateBlockingQuestions: today must be ISO YYYY-MM-DD; got ${today}`)
  }
  return art.questions.filter((q) => {
    if (q.status !== 'open') return false
    if (q.importance === 'blocking') return true
    if (q.dueBy !== null && q.dueBy < today) return true
    return false
  })
}

export async function writeOpenQuestions(
  targetPath: string,
  art: OpenQuestionsArtifact,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const text = serializeOpenQuestions(art)
  await atomicWriteFile(targetPath, text, options)
}
