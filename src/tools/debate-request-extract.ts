// Pure extractor for `<debate-request>` blocks emitted by phase personas.
//
// Parses the YAML body, validates the required keys, and returns the
// structured block plus any trailing prose (post-decision draft) the
// persona wrote after `</debate-request>`. Per CODEX_RESPONSE_M10.md
// D1 lock the orchestrator treats the block as a TERMINAL DIRECTIVE:
// the trailing prose is forensic-only, never load-bearing for PLAN.
//
// Per CODEX_RESPONSE_M10.md D2 lock: multiple `<debate-request>` blocks
// in one response fail fast — they hide model intent. `files` is
// required (use `files: []` for purely-design debates); a missing
// `files` key is a parse failure.
//
// This module has no I/O. The PLAN orchestrator (src/phases/plan.ts)
// is the consumer.

import { parse as parseYaml } from 'yaml'

import type { ProviderId } from '../providers/types.ts'

const OPEN_TAG = '<debate-request>'
const CLOSE_TAG = '</debate-request>'

const TOPIC_MAX_LEN = 48
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

const REQUIRED_SECTION_KEYS = [
  'whatYouAreReading',
  'whereWeStand',
  'whatIsLocked',
  'whatIsUpForDebate',
  'recommendedPath',
  'decisionPrompts',
  'whatIWantFromYou',
] as const

type SectionKey = (typeof REQUIRED_SECTION_KEYS)[number]

const STATUS_VALUES = ['thesis', 'implementation', 'review'] as const
type DebateStatus = (typeof STATUS_VALUES)[number]

export interface DebateRequestBlock {
  readonly topic: string
  readonly opposingProvider: ProviderId
  readonly question: string
  readonly files: readonly { readonly path: string }[]
  readonly status: DebateStatus
  readonly cycle: string
  readonly target: string
  readonly briefingSections: BriefingSections
  /** Prose the persona wrote after `</debate-request>` (D1: discarded). */
  readonly trailingDraft: string
}

export type BriefingSections = {
  readonly [K in SectionKey]: string
}

export type ExtractResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly block: DebateRequestBlock }
  | { readonly kind: 'multiple'; readonly count: number }
  | { readonly kind: 'parse-error'; readonly detail: string }

export function extractDebateRequest(text: string): ExtractResult {
  const openCount = countOccurrences(text, OPEN_TAG)
  if (openCount === 0) return { kind: 'none' }
  if (openCount > 1) return { kind: 'multiple', count: openCount }

  const closeCount = countOccurrences(text, CLOSE_TAG)
  if (closeCount !== 1) {
    return {
      kind: 'parse-error',
      detail: `expected exactly one ${CLOSE_TAG} (found ${closeCount})`,
    }
  }

  const openIdx = text.indexOf(OPEN_TAG)
  const closeIdx = text.indexOf(CLOSE_TAG)
  if (closeIdx < openIdx) {
    return {
      kind: 'parse-error',
      detail: `${CLOSE_TAG} appears before ${OPEN_TAG}`,
    }
  }

  const inner = text.slice(openIdx + OPEN_TAG.length, closeIdx).trim()
  const trailing = text.slice(closeIdx + CLOSE_TAG.length).trim()

  let raw: unknown
  try {
    raw = parseYaml(inner)
  } catch (err) {
    return {
      kind: 'parse-error',
      detail: `YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'parse-error', detail: '<debate-request> body must be a YAML mapping' }
  }
  const data = raw as Record<string, unknown>

  const topic = data.topic
  if (typeof topic !== 'string') return parseError('topic', 'a non-empty string')
  if (topic.length === 0 || topic.length > TOPIC_MAX_LEN) {
    return parseError('topic', `1..${TOPIC_MAX_LEN} characters`)
  }
  if (!TOPIC_PATTERN.test(topic)) {
    return parseError('topic', 'lowercase-kebab-case (matches /^[a-z0-9][a-z0-9-]*[a-z0-9]$/)')
  }

  const opposingProvider = data.opposingProvider
  if (typeof opposingProvider !== 'string' || opposingProvider.length === 0) {
    return parseError('opposingProvider', 'a non-empty string (a registered provider id)')
  }

  const question = data.question
  if (typeof question !== 'string' || question.trim().length === 0) {
    return parseError('question', 'a non-empty string')
  }

  if (!('files' in data)) {
    return parseError('files', 'an array (use `files: []` for purely-design debates)')
  }
  const filesRaw = data.files
  if (!Array.isArray(filesRaw)) {
    return parseError('files', 'an array (use `files: []` for purely-design debates)')
  }
  const files: { path: string }[] = []
  for (let i = 0; i < filesRaw.length; i++) {
    const entry = filesRaw[i]
    if (typeof entry === 'string') {
      if (entry.length === 0) return parseError(`files[${i}]`, 'a non-empty string')
      files.push({ path: entry })
    } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const path = (entry as Record<string, unknown>).path
      if (typeof path !== 'string' || path.length === 0) {
        return parseError(`files[${i}]`, 'either a string or { path: string }')
      }
      files.push({ path })
    } else {
      return parseError(`files[${i}]`, 'either a string or { path: string }')
    }
  }

  let status: DebateStatus = 'thesis'
  if ('status' in data) {
    const raw = data.status
    if (typeof raw !== 'string' || !STATUS_VALUES.includes(raw as DebateStatus)) {
      return parseError('status', `one of: ${STATUS_VALUES.join(' | ')}`)
    }
    status = raw as DebateStatus
  }

  const cycle = 'cycle' in data ? data.cycle : 'plan'
  if (typeof cycle !== 'string' || cycle.length === 0) {
    return parseError('cycle', 'a non-empty string (defaults to "plan")')
  }

  const target =
    'target' in data
      ? data.target
      : `${opposingProvider} default`
  if (typeof target !== 'string' || target.length === 0) {
    return parseError('target', 'a non-empty string')
  }

  const sectionsRaw = data.sections
  if (sectionsRaw === undefined || sectionsRaw === null) {
    return parseError('sections', 'a YAML mapping with all seven required keys')
  }
  if (typeof sectionsRaw !== 'object' || Array.isArray(sectionsRaw)) {
    return parseError('sections', 'a YAML mapping')
  }
  const sectionsObj = sectionsRaw as Record<string, unknown>
  const briefingSections: Partial<Record<SectionKey, string>> = {}
  for (const key of REQUIRED_SECTION_KEYS) {
    const v = sectionsObj[key]
    if (typeof v !== 'string' || v.trim().length === 0) {
      return parseError(`sections.${key}`, 'a non-empty string')
    }
    briefingSections[key] = v
  }

  return {
    kind: 'one',
    block: Object.freeze({
      topic,
      opposingProvider: opposingProvider as ProviderId,
      question,
      files: Object.freeze(files),
      status,
      cycle,
      target,
      briefingSections: Object.freeze(briefingSections as Record<SectionKey, string>),
      trailingDraft: trailing,
    }),
  }
}

function parseError(field: string, expected: string): ExtractResult {
  return { kind: 'parse-error', detail: `field '${field}' must be ${expected}` }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}
