// HYPOTHESES.md parser, serializer, allocator, and atomic writer.
//
// Contract pinned in docs/contracts/HYPOTHESES.md.
//
// Plain Markdown only. The artifact begins with `# HYPOTHESES` and contains
// zero or more `## H-NNN: <title>` blocks. Each block has the same five
// required bullets in canonical order:
//
//   - Phase: <phase>
//   - Status: <open | confirmed | rejected | obsolete>
//   - Falsifier: <a concrete observation>
//   - Evidence: <citations>
//   - Risk if false: <one-line consequence>

import { atomicWriteFile, type AtomicWriteOptions } from './atomic-write.ts'
import { HypothesesLoadError, type HypothesesLoadIssue } from './errors.ts'
import { PHASES, type Phase } from '../state/schemas.ts'

// --- types ---------------------------------------------------------

export const HYPOTHESES_TITLE = '# HYPOTHESES' as const

export const HYPOTHESIS_ID_PATTERN = /^H-\d{3,}$/

export const HYPOTHESIS_STATUSES = ['open', 'confirmed', 'rejected', 'obsolete'] as const
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number]

const HYPOTHESIS_BULLET_KEYS = ['Phase', 'Status', 'Falsifier', 'Evidence', 'Risk if false'] as const

export interface Hypothesis {
  readonly id: string                        // H-NNN
  readonly title: string                     // one-line title
  readonly phase: Phase
  readonly status: HypothesisStatus
  readonly falsifier: string
  readonly evidence: string
  readonly riskIfFalse: string
  readonly startLine?: number
}

export interface HypothesesArtifact {
  readonly title: string                     // 'HYPOTHESES'
  readonly hypotheses: readonly Hypothesis[]
}

// --- YAML-style tolerance (issue #5) -------------------------------

// LLMs occasionally emit HYPOTHESES.md as YAML-style block entries (`- id: H-NNN`
// with indented `claim:` / `falsifier:` / `phase_introduced:` continuation
// lines) instead of the canonical `## H-NNN:` H2-block schema. Tolerance scope:
// GitHub issue #5 — the Scientist persona has been observed defaulting to the
// YAML form in long contexts. We pre-rewrite YAML blocks into the canonical
// form before strict parsing so the artifact validates instead of failing the
// PLAN gate.
//
// Discipline boundary: the adapter fires ONLY on lines that match the
// `- id: H-NNN` shape. Canonical `## H-NNN:` blocks pass through untouched, so
// mixed-format input (some YAML, some canonical) works. Synthesized fields are
// tagged `(auto-synthesized — Scientist did not specify; investigate before
// depending on this hypothesis)` so the round-tripped artifact is honest about
// what was inferred. The strict parser still owns final validation; an
// unconvertible YAML block (e.g., missing `falsifier:`) fails just as a missing
// `- Falsifier:` bullet does.

const YAML_HYP_ID_PROBE = /^-\s+id:\s*H-\d+\s*$/m
const YAML_HYP_ID_LINE = /^-\s+id:\s*(H-\d+)\s*$/
const YAML_HYP_CONTINUATION = /^[ \t]+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/

const YAML_STATUS_MAP: Record<string, string> = Object.freeze({
  proposed: 'open',
  draft: 'open',
  pending: 'open',
})

function normalizeInlineList(value: string): string {
  const m = value.match(/^\[(.*)\]$/)
  if (m === null) return value
  return m[1]!
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0)
    .join(', ')
}

function firstNonEmptyLine(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? trimmed : trimmed.slice(0, nl).trim()
}

function renderHypothesisYamlBlock(id: string, fields: Map<string, string>): string[] {
  const claim = fields.get('claim') ?? fields.get('title') ?? ''
  const title = firstNonEmptyLine(claim) || '(claim not provided)'
  const phase = fields.get('phase_introduced') ?? fields.get('phase') ?? 'plan'
  const rawStatus = fields.get('status') ?? 'open'
  const status = YAML_STATUS_MAP[rawStatus] ?? rawStatus
  const falsifier =
    fields.get('falsifier') ??
    '(auto-synthesized — Scientist did not specify; investigate before depending on this hypothesis)'
  const evidenceRaw = fields.get('sources') ?? fields.get('evidence') ?? '(no sources provided)'
  const evidence = normalizeInlineList(evidenceRaw)
  const risk =
    fields.get('risk_if_false') ??
    fields.get('risk') ??
    '(auto-synthesized — Scientist did not specify; investigate before depending on this hypothesis)'
  return [
    `## ${id}: ${title}`,
    '',
    `- Phase: ${phase}`,
    `- Status: ${status}`,
    `- Falsifier: ${falsifier}`,
    `- Evidence: ${evidence}`,
    `- Risk if false: ${risk}`,
  ]
}

/**
 * Pre-parse adapter: rewrite YAML-style hypothesis blocks (`- id: H-NNN`
 * with indented `key:` continuations) into the canonical `## H-NNN:` H2-block
 * schema. Returns the input unchanged if no YAML markers are present.
 *
 * Issue #5 tolerance. Mixed-format input is supported — canonical H2 blocks
 * are passed through verbatim; only YAML blocks are rewritten.
 */
export function adaptYamlStyleHypotheses(raw: string): string {
  if (!YAML_HYP_ID_PROBE.test(raw)) return raw
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const idMatch = line.match(YAML_HYP_ID_LINE)
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
      const contMatch = cont.match(YAML_HYP_CONTINUATION)
      if (contMatch === null) break
      const key = contMatch[1]!.toLowerCase()
      const value = contMatch[2]!.trim()
      if (!fields.has(key)) fields.set(key, value)
      i++
    }
    out.push(...renderHypothesisYamlBlock(id, fields))
  }
  return out.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface HypothesisBuf {
  id: string
  title: string
  bulletLines: { key: string; value: string; line: number }[]
  startLine: number
}

export function parseHypotheses(raw: string, file = 'HYPOTHESES.md'): HypothesesArtifact {
  const issues: HypothesesLoadIssue[] = []
  const adapted = adaptYamlStyleHypotheses(raw)
  const text = adapted.startsWith(BOM) ? adapted.slice(BOM.length) : adapted

  if (text.trim().length === 0) {
    throw new HypothesesLoadError([
      { file, code: 'hypotheses_empty', rule: 'HYPOTHESES.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))

  let titleIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === HYPOTHESES_TITLE) {
      titleIdx = i
      break
    }
  }
  if (titleIdx === -1) {
    throw new HypothesesLoadError([
      {
        file,
        code: 'hypotheses_missing_title',
        rule: `HYPOTHESES.md must contain \`${HYPOTHESES_TITLE}\` as a top-level heading`,
        line: 1,
      },
    ])
  }

  const blocks: HypothesisBuf[] = []
  let current: HypothesisBuf | null = null

  for (let i = titleIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    const lineNo = i + 1

    if (line.startsWith('## ')) {
      const headingText = line.slice(3).trim()
      const colonIdx = headingText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'hypothesis_unexpected_content',
          rule: 'hypothesis heading must have form `## H-NNN: <title>`',
          detail: line,
          line: lineNo,
        })
        current = null
        continue
      }
      const id = headingText.slice(0, colonIdx).trim()
      const title = headingText.slice(colonIdx + 1).trim()
      if (!HYPOTHESIS_ID_PATTERN.test(id)) {
        issues.push({
          file,
          code: 'hypothesis_id_format',
          rule: `hypothesis id must match /^H-\\d{3,}$/`,
          detail: id,
          line: lineNo,
          hypothesisId: id,
        })
        current = null
        continue
      }
      if (title.length === 0) {
        issues.push({
          file,
          code: 'hypothesis_unexpected_content',
          rule: 'hypothesis heading must have a non-empty title after `H-NNN:`',
          detail: line,
          line: lineNo,
          hypothesisId: id,
        })
        current = null
        continue
      }
      current = { id, title, bulletLines: [], startLine: lineNo }
      blocks.push(current)
      continue
    }

    if (line.startsWith('# ')) {
      issues.push({
        file,
        code: 'hypothesis_unexpected_content',
        rule: 'HYPOTHESES.md must not contain a second H1 heading',
        detail: line,
        line: lineNo,
      })
      continue
    }

    if (line.startsWith('### ')) {
      issues.push({
        file,
        code: 'hypothesis_unexpected_content',
        rule: 'HYPOTHESES.md must not contain H3+ sub-headings',
        detail: line,
        line: lineNo,
      })
      continue
    }

    if (line.startsWith('```')) {
      issues.push({
        file,
        code: 'hypothesis_unexpected_content',
        rule: 'HYPOTHESES.md must not contain code fences',
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
          code: 'hypothesis_unexpected_content',
          rule: 'bullets must have non-empty content',
          line: lineNo,
        })
        continue
      }
      if (current === null) {
        issues.push({
          file,
          code: 'hypothesis_unexpected_content',
          rule: 'bullets must live under a `## H-NNN:` block',
          detail: line,
          line: lineNo,
        })
        continue
      }
      const colonIdx = bulletText.indexOf(':')
      if (colonIdx === -1) {
        issues.push({
          file,
          code: 'hypothesis_missing_section',
          rule: `hypothesis bullet must have form \`- <Key>: <value>\`; required keys: ${HYPOTHESIS_BULLET_KEYS.join(', ')}`,
          detail: bulletText,
          line: lineNo,
          hypothesisId: current.id,
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
      code: 'hypothesis_unexpected_content',
      rule: 'HYPOTHESES.md sections must contain only bullets and blank lines',
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
        code: 'hypothesis_id_collision',
        rule: `hypothesis id ${block.id} appears more than once`,
        line: block.startLine,
        hypothesisId: block.id,
      })
      continue
    }
    seenIds.add(block.id)

    const seen = new Set<string>()
    let prevIdx = -1
    for (const b of block.bulletLines) {
      const idx = (HYPOTHESIS_BULLET_KEYS as readonly string[]).indexOf(b.key)
      if (idx === -1) {
        issues.push({
          file,
          code: 'hypothesis_missing_section',
          rule: `hypothesis bullet key must be one of: ${HYPOTHESIS_BULLET_KEYS.join(', ')}`,
          detail: b.key,
          line: b.line,
          hypothesisId: block.id,
        })
        continue
      }
      if (seen.has(b.key)) {
        issues.push({
          file,
          code: 'hypothesis_unexpected_content',
          rule: `hypothesis bullet \`${b.key}:\` appears more than once`,
          line: b.line,
          hypothesisId: block.id,
        })
        continue
      }
      seen.add(b.key)
      if (idx < prevIdx) {
        issues.push({
          file,
          code: 'hypothesis_unexpected_content',
          rule: `hypothesis bullets must appear in canonical order: ${HYPOTHESIS_BULLET_KEYS.join(', ')}`,
          detail: b.key,
          line: b.line,
          hypothesisId: block.id,
        })
      }
      prevIdx = idx
      if (b.value.length === 0) {
        issues.push({
          file,
          code: b.key === 'Falsifier' ? 'hypothesis_no_falsifier' : 'hypothesis_missing_section',
          rule: `hypothesis bullet \`${b.key}:\` must have a value`,
          line: b.line,
          hypothesisId: block.id,
        })
      } else if (b.key === 'Status') {
        if (!(HYPOTHESIS_STATUSES as readonly string[]).includes(b.value)) {
          issues.push({
            file,
            code: 'hypothesis_invalid_status',
            rule: `hypothesis status must be one of: ${HYPOTHESIS_STATUSES.join(', ')}`,
            detail: b.value,
            line: b.line,
            hypothesisId: block.id,
          })
        }
      } else if (b.key === 'Phase') {
        if (!(PHASES as readonly string[]).includes(b.value)) {
          issues.push({
            file,
            code: 'hypothesis_invalid_phase',
            rule: `hypothesis phase must be one of: ${PHASES.join(', ')}`,
            detail: b.value,
            line: b.line,
            hypothesisId: block.id,
          })
        }
      }
    }
    for (const required of HYPOTHESIS_BULLET_KEYS) {
      if (!seen.has(required)) {
        issues.push({
          file,
          code: required === 'Falsifier' ? 'hypothesis_no_falsifier' : 'hypothesis_missing_section',
          rule: `hypothesis ${block.id} is missing required bullet \`- ${required}: ...\``,
          line: block.startLine,
          hypothesisId: block.id,
        })
      }
    }
  }

  if (issues.length > 0) throw new HypothesesLoadError(issues)

  const hypotheses: Hypothesis[] = blocks.map((block) => {
    const map = new Map<string, string>()
    for (const b of block.bulletLines) map.set(b.key, b.value)
    return Object.freeze({
      id: block.id,
      title: block.title,
      phase: map.get('Phase') as Phase,
      status: map.get('Status') as HypothesisStatus,
      falsifier: map.get('Falsifier')!,
      evidence: map.get('Evidence')!,
      riskIfFalse: map.get('Risk if false')!,
      startLine: block.startLine,
    }) satisfies Hypothesis
  })

  return Object.freeze({
    title: 'HYPOTHESES',
    hypotheses: Object.freeze(hypotheses),
  })
}

// --- serializer ----------------------------------------------------

export function serializeHypotheses(art: HypothesesArtifact): string {
  const out: string[] = [HYPOTHESES_TITLE]
  art.hypotheses.forEach((h, idx) => {
    out.push('')
    out.push(`## ${h.id}: ${h.title}`)
    out.push('')
    out.push(`- Phase: ${h.phase}`)
    out.push(`- Status: ${h.status}`)
    out.push(`- Falsifier: ${h.falsifier}`)
    out.push(`- Evidence: ${h.evidence}`)
    out.push(`- Risk if false: ${h.riskIfFalse}`)
    if (idx < art.hypotheses.length - 1) {
      // No trailing blank between blocks; the next block's leading blank handles spacing.
    }
  })
  return out.join('\n') + '\n'
}

// --- allocator + writer -------------------------------------------

/**
 * Allocate the next free `H-NNN` id given the existing hypotheses. Returns a
 * zero-padded 3-digit id (e.g. `H-001`, `H-042`, `H-100`). Run-scoped.
 */
export function allocateHypothesisId(existing: readonly Hypothesis[]): string {
  let max = 0
  for (const h of existing) {
    const m = h.id.match(/^H-(\d+)$/)
    if (m === null) continue
    const n = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  const next = max + 1
  return `H-${next.toString().padStart(3, '0')}`
}

/**
 * Atomically write the serialized HypothesesArtifact to `targetPath`. Mirrors
 * src/state/gates.ts discipline: temp + fsync + rename + dir fsync.
 */
export async function writeHypotheses(
  targetPath: string,
  art: HypothesesArtifact,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const text = serializeHypotheses(art)
  await atomicWriteFile(targetPath, text, options)
}
