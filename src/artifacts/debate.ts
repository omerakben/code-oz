// M10 commit 4: debate artifact parser + serializer + canonicalizer.
//
// Per docs/contracts/DEBATE.md:
//   BRIEFING.md  - 7 H2 sections (locked grammar)
//   RESPONSE.{codex,claude}.md  - 5 H2 sections + locked
//                                 `Overall verdict:` first-line grammar
//                                 (D10 lock, M10)
//   DECISION.md  - 5 H2 sections + YAML frontmatter dual-verdict
//                  (D5 lock: caller_verdict + opposing_verdict)
//
// All three artifacts are canonical Markdown (rule 7); events.jsonl is
// audit-only. The runtime writes via src/artifacts/atomic-write.ts.
//
// Authority discipline (rule 9): the calling persona authors DECISION.md;
// this parser validates shape and surfaces an exact-copy-rationale check
// (D5 lock) - exact rationale text from the opposing RESPONSE is rejected
// as `debate_decision_no_rationale` (no new warning event surface; reuses
// existing intervention plumbing per Codex risk #4).

import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'

// ---------- Locked enums and constants ----------

export const DEBATE_VERDICTS = [
  'accept',
  'accept-with-modifications',
  'reject',
  'feature-with-modifications',
] as const
export type DebateVerdict = (typeof DEBATE_VERDICTS)[number]

export const DEBATE_SIDES = ['codex', 'claude'] as const
export type DebateSide = (typeof DEBATE_SIDES)[number]

const DEBATE_TOPIC_REGEX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const DEBATE_TOPIC_MAX_LEN = 48
const DECISION_RATIONALE_MIN_CHARS = 50

// Required H2 sections per DEBATE.md - order is the parser's match order;
// missing sections produce one error each, all collected.
const BRIEFING_REQUIRED_SECTIONS = [
  'What you are reading',
  'Where we stand',
  'What is locked',
  'What is up for debate',
  'The recommended path',
  'Decision prompts',
  'What I want from you',
] as const

const RESPONSE_REQUIRED_SECTIONS = [
  'Verdict on the decisions',
  'Risks the proposing side missed',
  'Where I disagree',
  'What I would defer',
  'Recommended next step',
] as const

const DECISION_REQUIRED_SECTIONS = [
  'Verdict',
  'Rationale',
  'What changes (artifact deltas)',
  'What does not change',
  'Open follow-ups',
] as const

// ---------- Errors ----------

export interface DebateArtifactIssue {
  readonly code:
    | 'debate_briefing_missing_section'
    | 'debate_briefing_invalid_topic'
    | 'debate_briefing_invalid_frontmatter'
    | 'debate_briefing_missing_key'
    | 'debate_response_missing_section'
    | 'debate_response_verdict_invalid'
    | 'debate_response_invalid_frontmatter'
    | 'debate_decision_missing_section'
    | 'debate_decision_no_rationale'
    | 'debate_decision_invalid_frontmatter'
    | 'debate_artifact_invalid_format'
  readonly artifact: 'briefing' | 'response' | 'decision'
  readonly rule: string
  readonly detail?: string
}

export class DebateArtifactError extends Error {
  readonly issues: readonly DebateArtifactIssue[]
  readonly path: string | null
  constructor(issues: readonly DebateArtifactIssue[], path: string | null = null) {
    super(formatDebateArtifactError(issues, path))
    this.name = 'DebateArtifactError'
    this.issues = issues
    this.path = path
  }
}

function formatDebateArtifactError(
  issues: readonly DebateArtifactIssue[],
  path: string | null,
): string {
  const where = path ?? '<debate artifact>'
  const lines = issues.map((i) => `  ${where}: ${i.code} - ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
  return `debate artifact parse error (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`
}

// ---------- BRIEFING.md ----------

export interface BriefingFrontmatter {
  readonly topic: string
  readonly opposingProvider: string
  readonly date: string
  readonly status: 'thesis' | 'implementation' | 'review'
  readonly caller: string
  readonly target: string
  readonly cycle: string
  readonly question: string
  readonly files: readonly string[]
}

export interface BriefingDoc {
  readonly frontmatter: BriefingFrontmatter
  readonly body: string
  readonly sections: ReadonlyMap<string, string>
}

export function parseBriefing(content: string, path: string | null = null): BriefingDoc {
  const issues: DebateArtifactIssue[] = []
  const stripped = stripBom(content)
  const fm = parseFrontmatterBlock(stripped, 'briefing', issues)
  const sections = parseSections(fm.body)
  for (const required of BRIEFING_REQUIRED_SECTIONS) {
    if (!sections.has(required)) {
      issues.push({
        code: 'debate_briefing_missing_section',
        artifact: 'briefing',
        rule: `BRIEFING.md must contain '## ${required}' section`,
      })
    }
  }
  // Required keys
  const required = ['topic', 'opposing_provider', 'date', 'status', 'caller', 'target', 'cycle', 'question', 'files'] as const
  for (const key of required) {
    if (!(key in fm.data)) {
      issues.push({
        code: 'debate_briefing_missing_key',
        artifact: 'briefing',
        rule: `BRIEFING.md frontmatter is missing required key '${key}'`,
      })
    }
  }
  // Topic slug
  if (typeof fm.data.topic === 'string') {
    if (fm.data.topic.length === 0) {
      issues.push({
        code: 'debate_briefing_invalid_topic',
        artifact: 'briefing',
        rule: 'BRIEFING.md frontmatter `topic` must be non-empty',
      })
    } else if (fm.data.topic.length > DEBATE_TOPIC_MAX_LEN) {
      issues.push({
        code: 'debate_briefing_invalid_topic',
        artifact: 'briefing',
        rule: `BRIEFING.md frontmatter \`topic\` must be <= ${DEBATE_TOPIC_MAX_LEN} characters`,
        detail: `got ${fm.data.topic.length}`,
      })
    } else if (!DEBATE_TOPIC_REGEX.test(fm.data.topic)) {
      issues.push({
        code: 'debate_briefing_invalid_topic',
        artifact: 'briefing',
        rule: 'BRIEFING.md frontmatter `topic` must be lowercase-kebab-case',
        detail: JSON.stringify(fm.data.topic),
      })
    }
  }
  // Files: must be an array of objects with `path`, OR a flat array of
  // strings. M10 accepts both shapes; serializer emits the object form.
  const files: string[] = []
  if (Array.isArray(fm.data.files)) {
    for (const entry of fm.data.files) {
      if (typeof entry === 'string') files.push(entry)
      else if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).path === 'string') {
        files.push((entry as Record<string, unknown>).path as string)
      } else {
        issues.push({
          code: 'debate_briefing_invalid_frontmatter',
          artifact: 'briefing',
          rule: "BRIEFING.md frontmatter `files` entries must be a string or { path: string }",
        })
      }
    }
  } else if ('files' in fm.data) {
    issues.push({
      code: 'debate_briefing_invalid_frontmatter',
      artifact: 'briefing',
      rule: 'BRIEFING.md frontmatter `files` must be an array (use `files: []` for purely-design debates)',
    })
  }
  if (issues.length > 0) throw new DebateArtifactError(issues, path)
  const front: BriefingFrontmatter = Object.freeze({
    topic: fm.data.topic as string,
    opposingProvider: fm.data.opposing_provider as string,
    date: String(fm.data.date),
    status: fm.data.status as BriefingFrontmatter['status'],
    caller: fm.data.caller as string,
    target: fm.data.target as string,
    cycle: fm.data.cycle as string,
    question: fm.data.question as string,
    files: Object.freeze(files),
  })
  return Object.freeze({ frontmatter: front, body: fm.body, sections: freezeMap(sections) })
}

export interface SerializeBriefingInput {
  readonly topic: string
  readonly opposingProvider: string
  readonly date: string
  readonly status: BriefingFrontmatter['status']
  readonly caller: string
  readonly target: string
  readonly cycle: string
  readonly question: string
  readonly files: readonly string[]
  readonly sections: {
    readonly whatYouAreReading: string
    readonly whereWeStand: string
    readonly whatIsLocked: string
    readonly whatIsUpForDebate: string
    readonly recommendedPath: string
    readonly decisionPrompts: string
    readonly whatIWantFromYou: string
  }
}

export function serializeBriefing(input: SerializeBriefingInput): string {
  // YAML-safe quoting via JSON for any field that might contain special
  // characters (colons, commas, quotes, newlines). topic is constrained
  // to lowercase-kebab-case so it's safe bare; status is enum; everything
  // else gets JSON-quoted.
  const yamlBody =
    `topic: ${input.topic}\n` +
    `opposing_provider: ${JSON.stringify(input.opposingProvider)}\n` +
    `date: ${JSON.stringify(input.date)}\n` +
    `status: ${input.status}\n` +
    `caller: ${JSON.stringify(input.caller)}\n` +
    `target: ${JSON.stringify(input.target)}\n` +
    `cycle: ${JSON.stringify(input.cycle)}\n` +
    `question: ${JSON.stringify(input.question)}\n` +
    `files:\n` +
    (input.files.length === 0
      ? '  []\n'
      : input.files.map((p) => `  - path: ${JSON.stringify(p)}\n`).join(''))
  const body =
    `# ${input.topic}\n\n` +
    `## What you are reading\n\n${input.sections.whatYouAreReading}\n\n` +
    `## Where we stand\n\n${input.sections.whereWeStand}\n\n` +
    `## What is locked\n\n${input.sections.whatIsLocked}\n\n` +
    `## What is up for debate\n\n${input.sections.whatIsUpForDebate}\n\n` +
    `## The recommended path\n\n${input.sections.recommendedPath}\n\n` +
    `## Decision prompts\n\n${input.sections.decisionPrompts}\n\n` +
    `## What I want from you\n\n${input.sections.whatIWantFromYou}\n`
  return `---\n${yamlBody}---\n${body}`
}

// ---------- RESPONSE.{codex,claude}.md ----------

export interface ResponseFrontmatter {
  readonly thread: string
  readonly date: string
  readonly model: string
  readonly briefPath: string
}

export interface ResponseDoc {
  readonly side: DebateSide
  readonly frontmatter: ResponseFrontmatter
  readonly overallVerdict: DebateVerdict
  readonly body: string
  readonly sections: ReadonlyMap<string, string>
  /** Concatenation of `## Where I disagree` + `## Recommended next step`
   *  bodies; used as the "exact-copy" check substrate by the DECISION
   *  parser (D5 lock). Frozen. */
  readonly rationaleCorpus: string
}

export function parseResponse(
  content: string,
  expectedSide: DebateSide,
  path: string | null = null,
): ResponseDoc {
  const issues: DebateArtifactIssue[] = []
  const stripped = stripBom(content)
  const fm = parseFrontmatterBlock(stripped, 'response', issues)
  const sections = parseSections(fm.body)
  for (const required of RESPONSE_REQUIRED_SECTIONS) {
    if (!sections.has(required)) {
      issues.push({
        code: 'debate_response_missing_section',
        artifact: 'response',
        rule: `RESPONSE.${expectedSide}.md must contain '## ${required}' section`,
      })
    }
  }
  // Locked first-line `Overall verdict:` grammar (D10 lock).
  const verdictSection = sections.get('Verdict on the decisions') ?? ''
  let overallVerdict: DebateVerdict | null = null
  const firstLine = firstNonEmptyLine(verdictSection)
  if (firstLine === null) {
    issues.push({
      code: 'debate_response_verdict_invalid',
      artifact: 'response',
      rule: "RESPONSE.*.md `## Verdict on the decisions` section must contain content (D10: first non-empty line must be `Overall verdict: <enum>`)",
    })
  } else {
    const m = firstLine.match(/^Overall verdict:\s*(.+?)\s*$/)
    if (!m) {
      issues.push({
        code: 'debate_response_verdict_invalid',
        artifact: 'response',
        rule: "RESPONSE.*.md first non-empty line under `## Verdict on the decisions` must match `Overall verdict: <enum>` (D10 grammar)",
        detail: JSON.stringify(firstLine),
      })
    } else {
      const candidate = m[1] as string
      if (!(DEBATE_VERDICTS as readonly string[]).includes(candidate)) {
        issues.push({
          code: 'debate_response_verdict_invalid',
          artifact: 'response',
          rule: `RESPONSE.*.md \`Overall verdict\` must be one of: ${DEBATE_VERDICTS.join(' | ')}`,
          detail: `got ${JSON.stringify(candidate)}`,
        })
      } else {
        overallVerdict = candidate as DebateVerdict
      }
    }
  }
  // Frontmatter required keys
  for (const key of ['thread', 'date', 'model', 'brief'] as const) {
    if (!(key in fm.data)) {
      issues.push({
        code: 'debate_response_invalid_frontmatter',
        artifact: 'response',
        rule: `RESPONSE.*.md frontmatter is missing required key '${key}'`,
      })
    }
  }
  if (issues.length > 0 || overallVerdict === null) {
    if (issues.length === 0 && overallVerdict === null) {
      issues.push({
        code: 'debate_response_verdict_invalid',
        artifact: 'response',
        rule: 'RESPONSE.*.md missing parseable Overall verdict',
      })
    }
    throw new DebateArtifactError(issues, path)
  }
  const front: ResponseFrontmatter = Object.freeze({
    thread: fm.data.thread as string,
    date: String(fm.data.date),
    model: fm.data.model as string,
    briefPath: fm.data.brief as string,
  })
  const corpus = (sections.get('Where I disagree') ?? '') + '\n' + (sections.get('Recommended next step') ?? '')
  return Object.freeze({
    side: expectedSide,
    frontmatter: front,
    overallVerdict,
    body: fm.body,
    sections: freezeMap(sections),
    rationaleCorpus: corpus,
  })
}

// ---------- DECISION.md ----------

export interface DecisionFrontmatter {
  readonly date: string
  readonly resolvedBy: string
  readonly callerVerdict: DebateVerdict
  readonly opposingVerdict: DebateVerdict
}

export interface DecisionDoc {
  readonly frontmatter: DecisionFrontmatter
  readonly body: string
  readonly sections: ReadonlyMap<string, string>
  /** First non-empty line of `## Rationale`, capped at 200 chars (used as
   *  rationaleSummary in debate_resolved event). */
  readonly rationaleSummary: string
}

export function parseDecision(
  content: string,
  opposingResponse: ResponseDoc | null,
  path: string | null = null,
): DecisionDoc {
  const issues: DebateArtifactIssue[] = []
  const stripped = stripBom(content)
  const fm = parseFrontmatterBlock(stripped, 'decision', issues)
  const sections = parseSections(fm.body)
  for (const required of DECISION_REQUIRED_SECTIONS) {
    if (!sections.has(required)) {
      issues.push({
        code: 'debate_decision_missing_section',
        artifact: 'decision',
        rule: `DECISION.md must contain '## ${required}' section`,
      })
    }
  }
  // Frontmatter dual-verdict (D5 lock).
  for (const key of ['date', 'resolved_by', 'caller_verdict', 'opposing_verdict'] as const) {
    if (!(key in fm.data)) {
      issues.push({
        code: 'debate_decision_invalid_frontmatter',
        artifact: 'decision',
        rule: `DECISION.md frontmatter is missing required key '${key}'`,
      })
    }
  }
  // Verdict enum validation
  for (const key of ['caller_verdict', 'opposing_verdict'] as const) {
    const v = fm.data[key]
    if (typeof v === 'string' && !(DEBATE_VERDICTS as readonly string[]).includes(v)) {
      issues.push({
        code: 'debate_decision_invalid_frontmatter',
        artifact: 'decision',
        rule: `DECISION.md frontmatter \`${key}\` must be one of: ${DEBATE_VERDICTS.join(' | ')}`,
        detail: JSON.stringify(v),
      })
    }
  }
  // Cross-check decision's opposing_verdict against the parsed RESPONSE's
  // overallVerdict (Codex CODEX_REVIEW_M10.md fs#2 closure). The audit
  // artifact must not lie about what the opposing party actually said;
  // `debate_resolved.responseVerdict` already uses the parsed RESPONSE,
  // so a mismatch in DECISION.md would create artifact/event divergence.
  if (
    opposingResponse !== null &&
    typeof fm.data.opposing_verdict === 'string' &&
    (DEBATE_VERDICTS as readonly string[]).includes(fm.data.opposing_verdict) &&
    fm.data.opposing_verdict !== opposingResponse.overallVerdict
  ) {
    issues.push({
      code: 'debate_decision_invalid_frontmatter',
      artifact: 'decision',
      rule: `DECISION.md frontmatter \`opposing_verdict\` (${JSON.stringify(fm.data.opposing_verdict)}) must match the parsed RESPONSE's overall verdict (${JSON.stringify(opposingResponse.overallVerdict)})`,
    })
  }
  // Rationale non-empty (>= DECISION_RATIONALE_MIN_CHARS after trim).
  const rationaleRaw = sections.get('Rationale') ?? ''
  const rationaleStripped = stripMarkdownNoise(rationaleRaw)
  if (rationaleStripped.length < DECISION_RATIONALE_MIN_CHARS) {
    issues.push({
      code: 'debate_decision_no_rationale',
      artifact: 'decision',
      rule: `DECISION.md \`## Rationale\` must contain >= ${DECISION_RATIONALE_MIN_CHARS} characters of substantive content`,
      detail: `got ${rationaleStripped.length} chars after stripping headers/whitespace`,
    })
  }
  // Exact-copy rationale check (D5 lock; skip when no opposing context
  // available, e.g. unit-test paths). The check fires only when both
  // (a) the opposing response is provided and (b) the caller's rationale
  // is >= 200 chars. Shorter rationales are inherently brief; longer
  // rationales that exact-substring-match opposing rationale are
  // structurally rubber-stamping.
  if (
    opposingResponse !== null &&
    rationaleStripped.length >= 200 &&
    isExactCopyRationale(rationaleStripped, opposingResponse.rationaleCorpus)
  ) {
    issues.push({
      code: 'debate_decision_no_rationale',
      artifact: 'decision',
      rule: 'DECISION.md `## Rationale` exact-copies opposing RESPONSE rationale; calling persona must articulate independent reasoning (CLAUDE.md rule 9)',
    })
  }
  if (issues.length > 0) throw new DebateArtifactError(issues, path)
  const summary = computeRationaleSummary(rationaleRaw)
  const front: DecisionFrontmatter = Object.freeze({
    date: String(fm.data.date),
    resolvedBy: fm.data.resolved_by as string,
    callerVerdict: fm.data.caller_verdict as DebateVerdict,
    opposingVerdict: fm.data.opposing_verdict as DebateVerdict,
  })
  return Object.freeze({
    frontmatter: front,
    body: fm.body,
    sections: freezeMap(sections),
    rationaleSummary: summary,
  })
}

export interface SerializeDecisionInput {
  readonly date: string
  readonly resolvedBy: string
  readonly callerVerdict: DebateVerdict
  readonly opposingVerdict: DebateVerdict
  readonly topic: string
  readonly sections: {
    readonly verdict: string
    readonly rationale: string
    readonly whatChanges: string
    readonly whatDoesNotChange: string
    readonly openFollowUps: string
  }
}

export function serializeDecision(input: SerializeDecisionInput): string {
  const yamlBody =
    `date: ${input.date}\n` +
    `resolved_by: ${JSON.stringify(input.resolvedBy)}\n` +
    `caller_verdict: ${input.callerVerdict}\n` +
    `opposing_verdict: ${input.opposingVerdict}\n`
  const body =
    `# Decision - ${input.topic}\n\n` +
    `## Verdict\n\n${input.sections.verdict}\n\n` +
    `## Rationale\n\n${input.sections.rationale}\n\n` +
    `## What changes (artifact deltas)\n\n${input.sections.whatChanges}\n\n` +
    `## What does not change\n\n${input.sections.whatDoesNotChange}\n\n` +
    `## Open follow-ups\n\n${input.sections.openFollowUps}\n`
  return `---\n${yamlBody}---\n${body}`
}

// ---------- Helpers ----------

const BOM = '﻿'

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(BOM.length) : s
}

interface FrontmatterParseResult {
  data: Record<string, unknown>
  body: string
}

function parseFrontmatterBlock(
  content: string,
  artifact: 'briefing' | 'response' | 'decision',
  issues: DebateArtifactIssue[],
): FrontmatterParseResult {
  const m = content.match(/^---[ \t]*\r?\n([\s\S]+?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!m) {
    issues.push({
      code:
        artifact === 'briefing'
          ? 'debate_briefing_invalid_frontmatter'
          : artifact === 'response'
          ? 'debate_response_invalid_frontmatter'
          : 'debate_decision_invalid_frontmatter',
      artifact,
      rule: `${artifactLabel(artifact)} must begin with YAML frontmatter delimited by --- on its own line`,
    })
    return { data: {}, body: content }
  }
  const yamlText = m[1] as string
  const body = m[2] as string
  let data: unknown
  try {
    data = parseYaml(yamlText)
  } catch (err: unknown) {
    issues.push({
      code:
        artifact === 'briefing'
          ? 'debate_briefing_invalid_frontmatter'
          : artifact === 'response'
          ? 'debate_response_invalid_frontmatter'
          : 'debate_decision_invalid_frontmatter',
      artifact,
      rule: `${artifactLabel(artifact)} frontmatter must be valid YAML`,
      detail: err instanceof Error ? err.message : String(err),
    })
    return { data: {}, body }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    issues.push({
      code:
        artifact === 'briefing'
          ? 'debate_briefing_invalid_frontmatter'
          : artifact === 'response'
          ? 'debate_response_invalid_frontmatter'
          : 'debate_decision_invalid_frontmatter',
      artifact,
      rule: `${artifactLabel(artifact)} frontmatter must be a YAML object`,
    })
    return { data: {}, body }
  }
  return { data: data as Record<string, unknown>, body }
}

function artifactLabel(a: 'briefing' | 'response' | 'decision'): string {
  if (a === 'briefing') return 'BRIEFING.md'
  if (a === 'response') return 'RESPONSE.*.md'
  return 'DECISION.md'
}

/**
 * Walk the body and split on H2 headings. Returns a Map of section title
 * (text after `## `) to section body (everything between this heading and
 * the next H2 or end of document; first H1 is ignored).
 */
function parseSections(body: string): Map<string, string> {
  const lines = body.split(/\r?\n/)
  const sections = new Map<string, string>()
  let currentTitle: string | null = null
  let currentLines: string[] = []
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m && !line.startsWith('###')) {
      if (currentTitle !== null) {
        sections.set(currentTitle, currentLines.join('\n').trim())
      }
      currentTitle = m[1] as string
      currentLines = []
    } else if (currentTitle !== null) {
      currentLines.push(line)
    }
  }
  if (currentTitle !== null) {
    sections.set(currentTitle, currentLines.join('\n').trim())
  }
  return sections
}

function firstNonEmptyLine(section: string): string | null {
  for (const line of section.split(/\r?\n/)) {
    const t = line.trim()
    if (t.length > 0) return t
  }
  return null
}

function freezeMap<K, V>(m: Map<K, V>): ReadonlyMap<K, V> {
  return Object.freeze(new Map(m))
}

function stripMarkdownNoise(text: string): string {
  // Strip leading/trailing whitespace + trim H3/H4/H5/H6 headings to their
  // content (keeps the substance for length checks).
  return text
    .replace(/^#{3,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim()
}

function computeRationaleSummary(rationale: string): string {
  // First non-empty paragraph (until blank line); cap at 200 chars.
  const paragraphs = rationale.trim().split(/\r?\n\r?\n/)
  const first = paragraphs[0] ?? ''
  // Collapse internal newlines for the summary so it fits one event field.
  const collapsed = first.replace(/\s+/g, ' ').trim()
  return collapsed.length <= 200 ? collapsed : `${collapsed.slice(0, 197)}...`
}

/**
 * Exact-copy heuristic per D5 lock. Compares normalized text for
 * substring containment. Rationale longer than 200 chars that fully
 * appears (after whitespace normalization) inside the opposing party's
 * rationale corpus is flagged as no-rationale (rule 9).
 *
 * Normalization: collapse all whitespace runs to single space; case-
 * insensitive.
 */
export function isExactCopyRationale(
  callerRationale: string,
  opposingCorpus: string,
): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const caller = norm(callerRationale)
  const corpus = norm(opposingCorpus)
  if (caller.length === 0 || corpus.length === 0) return false
  if (caller.length < 200) return false
  return corpus.includes(caller)
}

// ---------- Canonicalizer ----------

/**
 * Compute the canonical sha256 of an artifact. Used by the runtime to
 * bind artifacts to events (briefingSha256, decisionSha256). The hash
 * is over the exact bytes the atomic-write helper persists; callers
 * pass the same bytes that were written.
 */
export function debateArtifactSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
