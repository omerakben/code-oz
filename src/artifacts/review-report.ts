// REVIEW.md parser + serializer + canonicalizer (per docs/contracts/REVIEW.md
// § "REVIEW.md schema").
//
// Authority split per CODEX_RESPONSE_M9.md decision 3 (orchestrator-owned
// verdict authority):
//   - Persona authors: ## Findings (each F-NNN block's severity,
//     recommendation, file path, line range, title); ## Score.Final score
//     (the integer 0-10).
//   - Orchestrator authors: ## Upstream refs (immutable run-bound),
//     ## Reviewer (frozen at config time + recorded family pair),
//     ## Round timeline (append-only across rounds),
//     ## Score.Final verdict + Exit reason (canonical verdict rule),
//     ## Cap status (round count + cap-exhausted flag), F-NNN id
//     assignment (fingerprint-based; ping-pong reopen).
//
// Canonical verdict rule (locked, decision 3 + strict fix-first rule):
//   1. Any current finding with severity=block → verdict='block'.
//   2. Otherwise, any current finding with severity in {block, fix-first}
//      whose roundResolved === 'unresolved', OR the persona's score < 6
//      → verdict='needs-revision'.
//   3. Otherwise → verdict='ready'.
//
// Cap composition per CODEX_RESPONSE_M9.md decision 4: max 4 REVIEW
// rounds + max 4 BUILD attempts as TWO MONOTONIC GLOBAL COUNTERS scoped
// to (runId, taskId). This module records cap-exhaustion at the REVIEW
// level (round 4 reached without ready exit). VERIFY-cap-during-review
// is the orchestrator's concern.
//
// Deleted-file findings rejected in M9 (no locked path-relativity
// convention yet); reviewer must cite added/modified files only.
//
// Open-type-union of severity / verdict via the locked enum unions; new
// values require a contract change.

// --- types ---------------------------------------------------------

export const REVIEW_REPORT_TITLE = '# REVIEW' as const

export const REVIEW_REPORT_SECTION_KEYS = [
  'upstreamRefs',
  'reviewer',
  'roundTimeline',
  'findings',
  'score',
  'capStatus',
] as const
export type ReviewReportSectionKey = (typeof REVIEW_REPORT_SECTION_KEYS)[number]

export const REVIEW_REPORT_SECTION_HEADINGS: Readonly<
  Record<ReviewReportSectionKey, string>
> = Object.freeze({
  upstreamRefs: 'Upstream refs',
  reviewer: 'Reviewer',
  roundTimeline: 'Round timeline',
  findings: 'Findings',
  score: 'Score',
  capStatus: 'Cap status',
})

export const REVIEW_SEVERITIES = ['block', 'fix-first', 'nit', 'fyi'] as const
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]

export const REVIEW_VERDICTS = ['ready', 'needs-revision', 'block'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

/** CLAUDE.md non-negotiable rule 6: max 4 rounds, exit on score≥6 + verdict=ready. */
export const REVIEW_ROUND_CAP = 4
export const REVIEW_SCORE_MIN = 6
export const REVIEW_SCORE_MAX = 10
export const REVIEW_TITLE_MAX_CHARS = 120
export const REVIEW_RECOMMENDATION_MAX_CHARS = 500
export const REVIEW_REPAIR_OFFENDING_LINES_MAX = 5
export const REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS = 200

export function isReviewSeverity(value: string): value is ReviewSeverity {
  return (REVIEW_SEVERITIES as readonly string[]).includes(value)
}

export function isReviewVerdict(value: string): value is ReviewVerdict {
  return (REVIEW_VERDICTS as readonly string[]).includes(value)
}

export interface ReviewUpstreamRefs {
  readonly buildReportPath: string
  readonly buildReportSha256: string  // 64-hex
  readonly verifyReportPath: string
  readonly verifyReportSha256: string // 64-hex
  readonly taskId: string             // T-NNN
  readonly attempt: number            // ≥ 1
  readonly baseCommitSha: string      // 40-hex
  readonly patchSha256: string        // 64-hex
}

export interface ReviewReviewer {
  readonly providerFamily: string
  readonly providerId: string
  readonly modelPolicy: string
  /** Locked to 'passed' — the orchestrator never serializes a 'failed' value. */
  readonly crossFamilyCheck: 'passed'
  /** The recorded BUILD family at the time of REVIEW (must differ from providerFamily). */
  readonly buildFamily: string
}

export interface ReviewTimelineEntry {
  readonly round: number     // 1..4, contiguous from 1
  readonly timestamp: string // ISO 8601
  readonly findingsRaised: number
  readonly score: number     // 0..10
  readonly verdict: ReviewVerdict
}

export interface ReviewFinding {
  readonly id: string                    // F-NNN
  readonly title: string
  readonly file: string
  /** Single line "42" or range "42-58". */
  readonly line: string
  readonly severity: ReviewSeverity
  readonly recommendation: string
  readonly roundRaised: number           // 1..4
  /** Round number when resolved, or 'unresolved'. */
  readonly roundResolved: number | 'unresolved'
}

export interface ReviewScore {
  readonly roundCount: number
  readonly finalScore: number  // 0..10
  readonly finalVerdict: ReviewVerdict
  /** Orchestrator-authored summary line. */
  readonly exitReason: string
}

export interface ReviewCapStatus {
  readonly cap: number          // always 4 in v0.1
  readonly roundsUsed: number   // 1..4
  readonly capExhausted: boolean
}

export interface ReviewReportData {
  readonly upstreamRefs: ReviewUpstreamRefs
  readonly reviewer: ReviewReviewer
  readonly roundTimeline: readonly ReviewTimelineEntry[]
  readonly findings: readonly ReviewFinding[]
  readonly score: ReviewScore
  readonly capStatus: ReviewCapStatus
}

export interface ReviewReportLoadIssue {
  readonly file: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class ReviewReportLoadError extends Error {
  readonly issues: readonly ReviewReportLoadIssue[]
  constructor(issues: readonly ReviewReportLoadIssue[]) {
    const summary = issues.map((i) => `${i.code}: ${i.rule}`).join('; ')
    super(`REVIEW.md validation failed: ${summary}`)
    this.name = 'ReviewReportLoadError'
    this.issues = Object.freeze([...issues])
  }
}

// --- serializer ----------------------------------------------------

/**
 * Renders the canonical REVIEW.md from structured data. Output is
 * deterministic: same input, same bytes.
 */
export function serializeReviewReport(data: ReviewReportData): string {
  const lines: string[] = []
  lines.push(REVIEW_REPORT_TITLE, '')

  // ## Upstream refs
  lines.push('## Upstream refs', '')
  lines.push(
    `- BUILD_REPORT.md: ${data.upstreamRefs.buildReportPath} (sha256: ${data.upstreamRefs.buildReportSha256})`,
  )
  lines.push(
    `- VERIFY.md: ${data.upstreamRefs.verifyReportPath} (sha256: ${data.upstreamRefs.verifyReportSha256})`,
  )
  lines.push(`- Task: ${data.upstreamRefs.taskId}`)
  lines.push(`- Attempt: ${data.upstreamRefs.attempt}`)
  lines.push(`- Base commit: ${data.upstreamRefs.baseCommitSha}`)
  lines.push(`- Patch sha256: ${data.upstreamRefs.patchSha256}`)
  lines.push('')

  // ## Reviewer
  lines.push('## Reviewer', '')
  lines.push(`- Provider family: ${data.reviewer.providerFamily}`)
  lines.push(`- Provider id: ${data.reviewer.providerId}`)
  lines.push(`- Model policy: ${data.reviewer.modelPolicy}`)
  lines.push(
    `- Cross-family check: ${data.reviewer.crossFamilyCheck} (BUILD family: ${data.reviewer.buildFamily}; reviewer family: ${data.reviewer.providerFamily})`,
  )
  lines.push('')

  // ## Round timeline
  lines.push('## Round timeline', '')
  for (const t of data.roundTimeline) {
    lines.push(
      `- Round ${t.round}: ${t.timestamp} | findings raised: ${t.findingsRaised} | score: ${t.score} | verdict: ${t.verdict}`,
    )
  }
  lines.push('')

  // ## Findings
  lines.push('## Findings', '')
  if (data.findings.length === 0) {
    lines.push('- None.')
    lines.push('')
  } else {
    for (let i = 0; i < data.findings.length; i++) {
      const f = data.findings[i]!
      lines.push(`### ${f.id}: ${f.title}`, '')
      lines.push(`- File: ${f.file}`)
      lines.push(`- Line: ${f.line}`)
      lines.push(`- Severity: ${f.severity}`)
      lines.push(`- Recommendation: ${f.recommendation}`)
      lines.push(`- Round raised: ${f.roundRaised}`)
      lines.push(`- Round resolved: ${f.roundResolved}`)
      if (i < data.findings.length - 1) lines.push('')
    }
    lines.push('')
  }

  // ## Score
  lines.push('## Score', '')
  lines.push(`- Round count: ${data.score.roundCount}`)
  lines.push(`- Final score: ${data.score.finalScore}`)
  lines.push(`- Final verdict: ${data.score.finalVerdict}`)
  lines.push(`- Exit reason: ${data.score.exitReason}`)
  lines.push('')

  // ## Cap status
  lines.push('## Cap status', '')
  lines.push(`- Cap: ${data.capStatus.cap} rounds`)
  lines.push(`- Rounds used: ${data.capStatus.roundsUsed}`)
  lines.push(`- Cap exhausted: ${data.capStatus.capExhausted}`)
  lines.push('')

  return lines.join('\n')
}

// --- parser --------------------------------------------------------

const BOM = '﻿'

interface SectionBuf {
  readonly key: ReviewReportSectionKey
  readonly bullets: readonly string[]
  /** H3 sub-blocks; populated only for the findings section. */
  readonly h3Blocks: readonly H3Block[]
  readonly headingLine: number
}

interface H3Block {
  readonly headingLine: number
  readonly heading: string  // e.g., "F-001: Title"
  readonly bullets: readonly string[]
}

export interface ParseReviewReportOptions {
  /** When provided, validates Findings.File entries against this manifest. */
  readonly changedFilePaths?: readonly string[]
}

/**
 * Parse a REVIEW.md document. Validates section presence + canonical order +
 * per-section grammar. Returns frozen ReviewReportData on success; throws
 * ReviewReportLoadError with accumulated issues on failure.
 */
export function parseReviewReport(
  raw: string,
  file = 'REVIEW.md',
  opts: ParseReviewReportOptions = {},
): ReviewReportData {
  const issues: ReviewReportLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new ReviewReportLoadError([
      { file, code: 'review_report_empty', rule: 'REVIEW.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))
  const titleIdx = lines.findIndex((l) => l === REVIEW_REPORT_TITLE)
  if (titleIdx === -1) {
    throw new ReviewReportLoadError([
      {
        file,
        code: 'review_report_title_missing',
        rule: `must contain '${REVIEW_REPORT_TITLE}' as a top-level heading`,
      },
    ])
  }

  const sections = walkSections(lines, titleIdx + 1, file, issues)
  const orderIssue = checkSectionOrder(sections, file)
  if (orderIssue) issues.push(orderIssue)

  for (const key of REVIEW_REPORT_SECTION_KEYS) {
    if (!sections.has(key)) {
      issues.push({
        file,
        code: 'review_report_missing_section',
        rule: `required H2 section absent: '## ${REVIEW_REPORT_SECTION_HEADINGS[key]}'`,
      })
    }
  }
  if (issues.some((i) => i.code === 'review_report_missing_section')) {
    throw new ReviewReportLoadError(issues)
  }

  const upstreamRefs = parseUpstreamRefs(sections.get('upstreamRefs')!, file, issues)
  const reviewer = parseReviewer(sections.get('reviewer')!, file, issues)
  const roundTimeline = parseRoundTimeline(sections.get('roundTimeline')!, file, issues)
  const findings = parseFindings(sections.get('findings')!, file, issues, opts.changedFilePaths)
  const score = parseScore(sections.get('score')!, file, issues)
  const capStatus = parseCapStatus(sections.get('capStatus')!, file, issues)

  // Cross-section invariants.
  if (roundTimeline && score) {
    const last = roundTimeline[roundTimeline.length - 1]
    if (last !== undefined) {
      if (score.roundCount !== last.round) {
        issues.push({
          file,
          code: 'review_score_round_count_mismatch',
          rule: 'Score.Round count must equal the last Round timeline entry round',
          detail: `score.roundCount=${score.roundCount} timeline.last.round=${last.round}`,
        })
      }
      if (score.finalScore !== last.score) {
        issues.push({
          file,
          code: 'review_score_final_score_mismatch',
          rule: 'Score.Final score must equal the last Round timeline entry score',
          detail: `score.finalScore=${score.finalScore} timeline.last.score=${last.score}`,
        })
      }
      if (score.finalVerdict !== last.verdict) {
        issues.push({
          file,
          code: 'review_score_final_verdict_mismatch',
          rule: 'Score.Final verdict must equal the last Round timeline entry verdict',
          detail: `score.finalVerdict=${score.finalVerdict} timeline.last.verdict=${last.verdict}`,
        })
      }
    }
  }

  // fix-first / block lock: if Final verdict=ready, no finding may carry
  // severity in {block, fix-first} with roundResolved=unresolved
  // (strict rule locked in REVIEW.md).
  if (findings && score && score.finalVerdict === 'ready') {
    for (const f of findings) {
      if (
        (f.severity === 'block' || f.severity === 'fix-first') &&
        f.roundResolved === 'unresolved'
      ) {
        issues.push({
          file,
          code: 'review_unresolved_blocker',
          rule: 'Final verdict: ready forbids unresolved block / fix-first findings',
          detail: `${f.id} severity=${f.severity} roundResolved=unresolved`,
        })
      }
    }
  }

  // Cap status / round count consistency.
  if (capStatus && score) {
    if (capStatus.roundsUsed !== score.roundCount) {
      issues.push({
        file,
        code: 'review_cap_status_mismatch',
        rule: 'Cap status.Rounds used must equal Score.Round count',
        detail: `capStatus.roundsUsed=${capStatus.roundsUsed} score.roundCount=${score.roundCount}`,
      })
    }
    if (capStatus.cap !== REVIEW_ROUND_CAP) {
      issues.push({
        file,
        code: 'review_cap_status_grammar',
        rule: `Cap status.Cap must be ${REVIEW_ROUND_CAP} (CLAUDE.md non-negotiable rule 6)`,
        detail: `got ${capStatus.cap}`,
      })
    }
  }

  if (
    issues.length > 0 ||
    !upstreamRefs ||
    !reviewer ||
    !roundTimeline ||
    !findings ||
    !score ||
    !capStatus
  ) {
    throw new ReviewReportLoadError(issues)
  }

  return Object.freeze({
    upstreamRefs,
    reviewer,
    roundTimeline,
    findings,
    score,
    capStatus,
  })
}

function walkSections(
  lines: readonly string[],
  startIdx: number,
  file: string,
  issues: ReviewReportLoadIssue[],
): Map<ReviewReportSectionKey, SectionBuf> {
  const headingToKey: Record<string, ReviewReportSectionKey> = {}
  for (const k of REVIEW_REPORT_SECTION_KEYS) {
    headingToKey[`## ${REVIEW_REPORT_SECTION_HEADINGS[k]}`] = k
  }
  const map = new Map<ReviewReportSectionKey, SectionBuf>()
  let cur: {
    key: ReviewReportSectionKey
    bullets: string[]
    h3Blocks: H3Block[]
    headingLine: number
    curH3: { heading: string; bullets: string[]; headingLine: number } | null
  } | null = null

  const flushH3 = (): void => {
    if (cur && cur.curH3) {
      cur.h3Blocks.push(
        Object.freeze({
          heading: cur.curH3.heading,
          bullets: Object.freeze([...cur.curH3.bullets]),
          headingLine: cur.curH3.headingLine,
        }),
      )
      cur.curH3 = null
    }
  }

  const flushSection = (): void => {
    if (cur) {
      flushH3()
      map.set(
        cur.key,
        Object.freeze({
          key: cur.key,
          bullets: Object.freeze([...cur.bullets]),
          h3Blocks: Object.freeze([...cur.h3Blocks]),
          headingLine: cur.headingLine,
        }),
      )
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('## ')) {
      flushSection()
      const key = headingToKey[line]
      if (key === undefined) {
        issues.push({
          file,
          code: 'review_report_unknown_section',
          rule: `unknown H2 section: '${line}'`,
          line: i + 1,
        })
        cur = null
        continue
      }
      cur = { key, bullets: [], h3Blocks: [], headingLine: i + 1, curH3: null }
      continue
    }
    if (!cur) continue
    if (line.startsWith('### ')) {
      // H3 sub-block. Only meaningful inside Findings — other sections
      // ignore H3s; the section-grammar parser will flag empty
      // findings/H3 mismatches.
      flushH3()
      cur.curH3 = {
        heading: line.slice(4),
        bullets: [],
        headingLine: i + 1,
      }
      continue
    }
    if (/^- /.test(line)) {
      const body = line.slice(2)
      if (cur.curH3) {
        cur.curH3.bullets.push(body)
      } else {
        cur.bullets.push(body)
      }
    }
  }
  flushSection()
  return map
}

function checkSectionOrder(
  sections: Map<ReviewReportSectionKey, SectionBuf>,
  file: string,
): ReviewReportLoadIssue | null {
  const present = [...sections.entries()].sort(
    (a, b) => a[1].headingLine - b[1].headingLine,
  )
  const orderActual = present.map(([k]) => k)
  let canonicalIdx = 0
  for (const k of orderActual) {
    while (
      canonicalIdx < REVIEW_REPORT_SECTION_KEYS.length &&
      REVIEW_REPORT_SECTION_KEYS[canonicalIdx] !== k
    ) {
      canonicalIdx++
    }
    if (canonicalIdx >= REVIEW_REPORT_SECTION_KEYS.length) {
      return {
        file,
        code: 'review_report_section_out_of_order',
        rule: `section '${REVIEW_REPORT_SECTION_HEADINGS[k]}' appears out of canonical order`,
      }
    }
    canonicalIdx++
  }
  return null
}

// --- per-section parsers ------------------------------------------

function parseUpstreamRefs(
  s: { readonly bullets: readonly string[] },
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewUpstreamRefs | null {
  const m = bulletMap(s.bullets)
  const buildRef = m.get('BUILD_REPORT.md')
  const verifyRef = m.get('VERIFY.md')
  const taskId = m.get('Task')
  const attemptStr = m.get('Attempt')
  const baseCommitSha = m.get('Base commit')
  const patchSha256 = m.get('Patch sha256')
  if (
    !buildRef ||
    !verifyRef ||
    !taskId ||
    !attemptStr ||
    !baseCommitSha ||
    !patchSha256
  ) {
    issues.push({
      file,
      code: 'review_upstream_refs_missing',
      rule:
        '## Upstream refs requires bullets: BUILD_REPORT.md, VERIFY.md, Task, Attempt, Base commit, Patch sha256',
    })
    return null
  }
  const buildMatch = buildRef.match(/^(.+?) \(sha256: ([0-9a-f]{64})\)$/)
  if (!buildMatch) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.BUILD_REPORT.md must match `<path> (sha256: <64-hex>)`',
      detail: buildRef,
    })
    return null
  }
  const verifyMatch = verifyRef.match(/^(.+?) \(sha256: ([0-9a-f]{64})\)$/)
  if (!verifyMatch) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.VERIFY.md must match `<path> (sha256: <64-hex>)`',
      detail: verifyRef,
    })
    return null
  }
  if (!/^T-\d{3,}$/.test(taskId)) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.Task must match /^T-\\d{3,}$/',
      detail: taskId,
    })
    return null
  }
  const attempt = Number.parseInt(attemptStr, 10)
  if (!Number.isInteger(attempt) || attempt < 1) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.Attempt must be a positive integer',
      detail: attemptStr,
    })
    return null
  }
  if (!/^[0-9a-f]{40}$/.test(baseCommitSha)) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.Base commit must be 40-char lower-case hex',
      detail: baseCommitSha,
    })
    return null
  }
  if (!/^[0-9a-f]{64}$/.test(patchSha256)) {
    issues.push({
      file,
      code: 'review_upstream_refs_grammar',
      rule: 'Upstream refs.Patch sha256 must be 64-char lower-case hex',
      detail: patchSha256,
    })
    return null
  }
  return Object.freeze({
    buildReportPath: buildMatch[1]!,
    buildReportSha256: buildMatch[2]!,
    verifyReportPath: verifyMatch[1]!,
    verifyReportSha256: verifyMatch[2]!,
    taskId,
    attempt,
    baseCommitSha,
    patchSha256,
  })
}

function parseReviewer(
  s: SectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewReviewer | null {
  const m = bulletMap(s.bullets)
  const providerFamily = m.get('Provider family')
  const providerId = m.get('Provider id')
  const modelPolicy = m.get('Model policy')
  const crossFamily = m.get('Cross-family check')
  if (!providerFamily || !providerId || !modelPolicy || !crossFamily) {
    issues.push({
      file,
      code: 'review_reviewer_missing',
      rule:
        '## Reviewer requires bullets: Provider family, Provider id, Model policy, Cross-family check',
    })
    return null
  }
  // Cross-family check shape: `passed (BUILD family: <fam>; reviewer family: <fam>)`
  const crossMatch = crossFamily.match(
    /^passed \(BUILD family: ([^;]+); reviewer family: (.+)\)$/,
  )
  if (!crossMatch) {
    issues.push({
      file,
      code: 'review_reviewer_grammar',
      rule:
        'Reviewer.Cross-family check must match `passed (BUILD family: <fam>; reviewer family: <fam>)`',
      detail: crossFamily,
    })
    return null
  }
  const buildFamily = crossMatch[1]!.trim()
  const reviewerFamilyFromCheck = crossMatch[2]!.trim()
  if (reviewerFamilyFromCheck !== providerFamily) {
    issues.push({
      file,
      code: 'review_reviewer_grammar',
      rule:
        'Reviewer.Cross-family check reviewer family must equal Reviewer.Provider family',
      detail: `provider=${providerFamily} cross-check=${reviewerFamilyFromCheck}`,
    })
    return null
  }
  if (buildFamily === providerFamily) {
    issues.push({
      file,
      code: 'review_cross_family_violation',
      rule:
        'Reviewer.Cross-family check declares reviewer family equal to BUILD family (cross-family invariant)',
      detail: `both = ${buildFamily}`,
    })
    return null
  }
  return Object.freeze({
    providerFamily,
    providerId,
    modelPolicy,
    crossFamilyCheck: 'passed' as const,
    buildFamily,
  })
}

const ROUND_TIMELINE_REGEX =
  /^Round (\d+): (.+?) \| findings raised: (\d+) \| score: (\d+) \| verdict: (ready|needs-revision|block)$/

function parseRoundTimeline(
  s: SectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): readonly ReviewTimelineEntry[] | null {
  if (s.bullets.length === 0) {
    issues.push({
      file,
      code: 'review_round_timeline_empty',
      rule: '## Round timeline must contain at least one Round bullet',
    })
    return null
  }
  const out: ReviewTimelineEntry[] = []
  for (let i = 0; i < s.bullets.length; i++) {
    const b = s.bullets[i]!
    const match = b.match(ROUND_TIMELINE_REGEX)
    if (!match) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule:
          'Round timeline bullet must match `Round <N>: <ts> | findings raised: <count> | score: <0-10> | verdict: <ready|needs-revision|block>`',
        detail: b,
      })
      return null
    }
    const round = Number.parseInt(match[1]!, 10)
    const timestamp = match[2]!
    const findingsRaised = Number.parseInt(match[3]!, 10)
    const score = Number.parseInt(match[4]!, 10)
    const verdict = match[5]!
    if (!isReviewVerdict(verdict)) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule:
          'Round timeline verdict must be one of: ready, needs-revision, block',
        detail: `got ${verdict}`,
      })
      return null
    }
    if (round !== i + 1) {
      issues.push({
        file,
        code: 'review_round_gap',
        rule:
          'Round timeline must start at 1 and increment by 1 (no gaps; no zero or negative rounds)',
        detail: `expected ${i + 1}, got ${round}`,
      })
      return null
    }
    if (round > REVIEW_ROUND_CAP) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule: `Round timeline.Round must be ≤ ${REVIEW_ROUND_CAP} (CLAUDE.md non-negotiable rule 6)`,
        detail: `got ${round}`,
      })
      return null
    }
    if (score < 0 || score > REVIEW_SCORE_MAX) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule: `Round timeline.score must be an integer in [0, ${REVIEW_SCORE_MAX}]`,
        detail: `got ${score}`,
      })
      return null
    }
    out.push(
      Object.freeze({
        round,
        timestamp,
        findingsRaised,
        score,
        verdict,
      }),
    )
  }
  return Object.freeze(out)
}

function parseFindings(
  s: SectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
  changedFilePaths?: readonly string[],
): readonly ReviewFinding[] | null {
  // Empty form: `- None.` (no findings raised across the run).
  if (s.h3Blocks.length === 0) {
    if (s.bullets.length === 1 && s.bullets[0] === 'None.') {
      return Object.freeze([])
    }
    issues.push({
      file,
      code: 'review_findings_grammar',
      rule:
        '## Findings must contain `- None.` when no findings exist, or one or more `### F-NNN: <title>` H3 blocks',
    })
    return null
  }
  const out: ReviewFinding[] = []
  const seenIds = new Set<string>()
  for (const block of s.h3Blocks) {
    const headingMatch = block.heading.match(/^(F-\d{3,}): (.+)$/)
    if (!headingMatch) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule:
          'Findings H3 heading must match `### F-NNN: <one-line title>` (NNN = 3+ digits)',
        detail: block.heading,
        line: block.headingLine,
      })
      return null
    }
    const id = headingMatch[1]!
    const title = headingMatch[2]!
    if (seenIds.has(id)) {
      issues.push({
        file,
        code: 'review_finding_id_collision',
        rule: `two findings share id ${id}`,
        line: block.headingLine,
      })
      return null
    }
    seenIds.add(id)
    if (title.length > REVIEW_TITLE_MAX_CHARS) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Findings title must be ≤ ${REVIEW_TITLE_MAX_CHARS} characters`,
        detail: `${id} title.length=${title.length}`,
        line: block.headingLine,
      })
      return null
    }
    const m = bulletMap(block.bullets)
    const filePath = m.get('File')
    const line = m.get('Line')
    const severity = m.get('Severity')
    const recommendation = m.get('Recommendation')
    const roundRaisedStr = m.get('Round raised')
    const roundResolvedStr = m.get('Round resolved')
    if (
      !filePath ||
      !line ||
      !severity ||
      recommendation === undefined ||
      !roundRaisedStr ||
      !roundResolvedStr
    ) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule:
          `Finding ${id} requires bullets: File, Line, Severity, Recommendation, Round raised, Round resolved`,
        line: block.headingLine,
      })
      return null
    }
    if (!isReviewSeverity(severity)) {
      issues.push({
        file,
        code: 'review_severity_invalid',
        rule: `Severity must be one of: ${REVIEW_SEVERITIES.join(', ')}`,
        detail: `${id} severity=${severity}`,
        line: block.headingLine,
      })
      return null
    }
    if (!/^\d+(?:-\d+)?$/.test(line)) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: 'Finding Line must be a single line "42" or range "42-58"',
        detail: `${id} Line=${line}`,
        line: block.headingLine,
      })
      return null
    }
    if (line.includes('-')) {
      const [start, end] = line.split('-').map((n) => Number.parseInt(n, 10))
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start! < 1 ||
        end! < start!
      ) {
        issues.push({
          file,
          code: 'review_finding_grammar',
          rule: 'Finding Line range must satisfy start ≥ 1 and end ≥ start',
          detail: `${id} Line=${line}`,
          line: block.headingLine,
        })
        return null
      }
    }
    if (recommendation.length > REVIEW_RECOMMENDATION_MAX_CHARS) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Recommendation must be ≤ ${REVIEW_RECOMMENDATION_MAX_CHARS} characters`,
        detail: `${id} length=${recommendation.length}`,
        line: block.headingLine,
      })
      return null
    }
    const roundRaised = Number.parseInt(roundRaisedStr, 10)
    if (
      !Number.isInteger(roundRaised) ||
      roundRaised < 1 ||
      roundRaised > REVIEW_ROUND_CAP
    ) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Round raised must be an integer in [1, ${REVIEW_ROUND_CAP}]`,
        detail: `${id} got ${roundRaisedStr}`,
        line: block.headingLine,
      })
      return null
    }
    let roundResolved: number | 'unresolved'
    if (roundResolvedStr === 'unresolved') {
      roundResolved = 'unresolved'
    } else {
      const r = Number.parseInt(roundResolvedStr, 10)
      if (!Number.isInteger(r) || r < 1 || r > REVIEW_ROUND_CAP || r < roundRaised) {
        issues.push({
          file,
          code: 'review_finding_grammar',
          rule: `Round resolved must be 'unresolved' or an integer in [Round raised, ${REVIEW_ROUND_CAP}]`,
          detail: `${id} got ${roundResolvedStr} (raised=${roundRaised})`,
          line: block.headingLine,
        })
        return null
      }
      roundResolved = r
    }
    // unresolved + severity in {block, fix-first} is the strict rule.
    // The cross-section invariant in parseReviewReport catches this at
    // exit; we record the finding shape here and let the caller's exit
    // check raise review_unresolved_blocker.
    if (changedFilePaths !== undefined && !changedFilePaths.includes(filePath)) {
      issues.push({
        file,
        code: 'review_finding_path_unknown',
        rule:
          'Finding File must be a path present in BUILD_REPORT.md Changed files manifest',
        detail: `${id} File=${filePath}`,
        line: block.headingLine,
      })
      return null
    }
    out.push(
      Object.freeze({
        id,
        title,
        file: filePath,
        line,
        severity,
        recommendation,
        roundRaised,
        roundResolved,
      }),
    )
  }
  return Object.freeze(out)
}

function parseScore(
  s: SectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewScore | null {
  const m = bulletMap(s.bullets)
  const roundCountStr = m.get('Round count')
  const finalScoreStr = m.get('Final score')
  const finalVerdictStr = m.get('Final verdict')
  const exitReason = m.get('Exit reason')
  if (!roundCountStr || !finalScoreStr || !finalVerdictStr || !exitReason) {
    issues.push({
      file,
      code: 'review_score_missing',
      rule: '## Score requires bullets: Round count, Final score, Final verdict, Exit reason',
    })
    return null
  }
  const roundCount = Number.parseInt(roundCountStr, 10)
  if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > REVIEW_ROUND_CAP) {
    issues.push({
      file,
      code: 'review_score_grammar',
      rule: `Score.Round count must be an integer in [1, ${REVIEW_ROUND_CAP}]`,
      detail: roundCountStr,
    })
    return null
  }
  const finalScore = Number.parseInt(finalScoreStr, 10)
  if (!Number.isInteger(finalScore) || finalScore < 0 || finalScore > REVIEW_SCORE_MAX) {
    issues.push({
      file,
      code: 'review_score_grammar',
      rule: `Score.Final score must be an integer in [0, ${REVIEW_SCORE_MAX}]`,
      detail: finalScoreStr,
    })
    return null
  }
  if (!isReviewVerdict(finalVerdictStr)) {
    issues.push({
      file,
      code: 'review_verdict_invalid',
      rule: `Score.Final verdict must be one of: ${REVIEW_VERDICTS.join(', ')}`,
      detail: finalVerdictStr,
    })
    return null
  }
  return Object.freeze({
    roundCount,
    finalScore,
    finalVerdict: finalVerdictStr,
    exitReason,
  })
}

function parseCapStatus(
  s: { readonly bullets: readonly string[] },
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewCapStatus | null {
  const m = bulletMap(s.bullets)
  const capStr = m.get('Cap')
  const roundsUsedStr = m.get('Rounds used')
  const capExhaustedStr = m.get('Cap exhausted')
  if (!capStr || !roundsUsedStr || capExhaustedStr === undefined) {
    issues.push({
      file,
      code: 'review_cap_status_missing',
      rule: '## Cap status requires bullets: Cap, Rounds used, Cap exhausted',
    })
    return null
  }
  const capMatch = capStr.match(/^(\d+) rounds$/)
  if (!capMatch) {
    issues.push({
      file,
      code: 'review_cap_status_grammar',
      rule: 'Cap status.Cap must match `<N> rounds`',
      detail: capStr,
    })
    return null
  }
  const cap = Number.parseInt(capMatch[1]!, 10)
  const roundsUsed = Number.parseInt(roundsUsedStr, 10)
  if (!Number.isInteger(roundsUsed) || roundsUsed < 1 || roundsUsed > REVIEW_ROUND_CAP) {
    issues.push({
      file,
      code: 'review_cap_status_grammar',
      rule: `Cap status.Rounds used must be an integer in [1, ${REVIEW_ROUND_CAP}]`,
      detail: roundsUsedStr,
    })
    return null
  }
  if (capExhaustedStr !== 'true' && capExhaustedStr !== 'false') {
    issues.push({
      file,
      code: 'review_cap_status_grammar',
      rule: 'Cap status.Cap exhausted must be `true` or `false`',
      detail: capExhaustedStr,
    })
    return null
  }
  return Object.freeze({
    cap,
    roundsUsed,
    capExhausted: capExhaustedStr === 'true',
  })
}

// --- canonicalizer + fingerprint reuse ----------------------------

/** Persona drafts may use literal `F-NEW` placeholders; the canonicalizer
 *  assigns real F-NNN ids. The placeholder is also accepted in finding
 *  bullet headings (`### F-NEW: <title>`). */
export const F_NEW_PLACEHOLDER = 'F-NEW'

/** Normalizes a finding title for fingerprint matching (lowercase + collapse
 *  whitespace + drop trailing punctuation). The fingerprint is `<file>|<title>`
 *  per CODEX_RESPONSE_M9.md decision 2. */
export function fingerprintFinding(file: string, title: string): string {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
  return `${file}|${normalizedTitle}`
}

export interface CanonicalizeFindingsInput {
  /** Persona-drafted findings for this round. Each entry's id may be `F-NEW`
   *  (the canonicalizer assigns); previously-known ids are preserved as-is
   *  unless they fingerprint-match a prior-resolved finding (ping-pong). */
  readonly draftFindings: readonly ReviewFinding[]
  /** Findings carried from prior rounds. Pass [] for round 1. */
  readonly priorFindings: readonly ReviewFinding[]
  /** Current round being canonicalized (1..4). */
  readonly round: number
}

export interface CanonicalizeFindingsResult {
  /** Findings list ready for serialization, with stable F-NNN ids. */
  readonly findings: readonly ReviewFinding[]
  /** Findings that were re-opened by ping-pong fingerprint match. */
  readonly reopenedIds: readonly string[]
  /** Findings that were freshly minted with new F-NNN ids. */
  readonly newIds: readonly string[]
}

/**
 * Assigns canonical F-NNN ids to draft findings, preserving carried ids,
 * and reopens prior-resolved findings whose fingerprint matches a new
 * finding (ping-pong detection per CODEX_RESPONSE_M9.md decision 2).
 *
 * Rules:
 *   - A draft finding whose id is in priorFindings keeps its id; its
 *     `roundResolved` may be updated by the persona (e.g., "this F-001
 *     was resolved this round" → roundResolved = round).
 *   - A draft finding using `F-NEW` triggers a fingerprint lookup
 *     against priorFindings. If the fingerprint matches a prior finding
 *     whose roundResolved is a number (i.e., resolved before), reopen
 *     it: keep the original id; set roundResolved='unresolved'; record
 *     in reopenedIds.
 *   - Otherwise mint a fresh F-NNN id (highest existing + 1, padded to
 *     3 digits).
 *   - Carried-over prior findings whose id is NOT mentioned in the
 *     draft are preserved as-is (they kept their prior status).
 */
export function canonicalizeFindings(
  input: CanonicalizeFindingsInput,
): CanonicalizeFindingsResult {
  const reopenedIds: string[] = []
  const newIds: string[] = []
  const priorById = new Map(input.priorFindings.map((f) => [f.id, f]))
  const priorByFingerprint = new Map<string, ReviewFinding>()
  for (const f of input.priorFindings) {
    priorByFingerprint.set(fingerprintFinding(f.file, f.title), f)
  }

  const usedIds = new Set(input.priorFindings.map((f) => f.id))
  const out: ReviewFinding[] = []
  const draftIds = new Set<string>()
  const draftFingerprints = new Set<string>()

  let nextNumber = 1
  for (const id of usedIds) {
    const m = id.match(/^F-(\d+)$/)
    if (m) {
      const n = Number.parseInt(m[1]!, 10)
      if (n >= nextNumber) nextNumber = n + 1
    }
  }

  for (const draft of input.draftFindings) {
    // Reject duplicate fingerprints in the same draft. Two findings with
    // `(file, normalized title)` matching but different severities would
    // both mint distinct ids, leaving the operator with confusing
    // duplicates that ping-pong on the next round.
    const fingerprint = fingerprintFinding(draft.file, draft.title)
    if (draftFingerprints.has(fingerprint)) {
      throw new Error(
        `canonicalizeFindings: draft contains two findings with the same fingerprint (file=${draft.file}, title=${draft.title})`,
      )
    }
    draftFingerprints.add(fingerprint)

    let id = draft.id
    let roundRaised = draft.roundRaised
    let roundResolved = draft.roundResolved
    if (id !== F_NEW_PLACEHOLDER && priorById.has(id)) {
      // Existing id; persona may be updating roundResolved.
      const prior = priorById.get(id)!
      roundRaised = prior.roundRaised
      // Track explicit-id reopens. If the persona keeps the prior id
      // but flips roundResolved from a numeric value (resolved) back to
      // 'unresolved', that's a ping-pong reopen and should surface in
      // reopenedIds the same way fingerprint-driven reopens do.
      if (
        typeof prior.roundResolved === 'number' &&
        roundResolved === 'unresolved'
      ) {
        reopenedIds.push(id)
      }
    } else {
      const priorMatch = priorByFingerprint.get(fingerprint)
      if (priorMatch && typeof priorMatch.roundResolved === 'number') {
        // Ping-pong: re-opening a previously-resolved finding under the
        // same fingerprint. Reuse the original id; reset to unresolved
        // (the fix did not stick).
        id = priorMatch.id
        roundRaised = priorMatch.roundRaised
        roundResolved = 'unresolved'
        reopenedIds.push(id)
      } else if (priorMatch) {
        // Same fingerprint as an unresolved prior finding; reuse the id.
        // (No "ping-pong" — it's just a re-statement.)
        id = priorMatch.id
        roundRaised = priorMatch.roundRaised
      } else {
        // Mint a new id.
        id = `F-${String(nextNumber).padStart(3, '0')}`
        nextNumber++
        roundRaised = input.round
        newIds.push(id)
      }
    }
    if (draftIds.has(id)) {
      throw new Error(
        `canonicalizeFindings: draft contains duplicate id ${id} (after fingerprint canonicalization)`,
      )
    }
    draftIds.add(id)
    out.push(
      Object.freeze({
        id,
        title: draft.title,
        file: draft.file,
        line: draft.line,
        severity: draft.severity,
        recommendation: draft.recommendation,
        roundRaised,
        roundResolved,
      }),
    )
  }

  // Preserve carried-over prior findings the persona did not mention this
  // round (they keep their status).
  for (const prior of input.priorFindings) {
    if (!draftIds.has(prior.id)) {
      out.push(prior)
    }
  }

  // Sort by numeric id for deterministic output.
  out.sort((a, b) => {
    const ai = Number.parseInt(a.id.slice(2), 10)
    const bi = Number.parseInt(b.id.slice(2), 10)
    return ai - bi
  })
  return Object.freeze({
    findings: Object.freeze(out),
    reopenedIds: Object.freeze(reopenedIds),
    newIds: Object.freeze(newIds),
  })
}

// --- canonical verdict rule --------------------------------------

/**
 * Computes the orchestrator-owned verdict per CODEX_RESPONSE_M9.md
 * decision 3 + the strict fix-first rule.
 *
 * Priority order:
 *   1. Any current finding with severity=block AND roundResolved=unresolved
 *      → 'block'.
 *   2. Otherwise: any current finding with severity in {block, fix-first}
 *      AND roundResolved=unresolved, OR personaScore < 6 → 'needs-revision'.
 *   3. Otherwise → 'ready'.
 *
 * Note: a `block`-severity finding that's been resolved this round drops
 * out of category (1) and (2). Only unresolved blockers gate `ready`.
 */
export function computeCanonicalVerdict(
  findings: readonly ReviewFinding[],
  personaScore: number,
): ReviewVerdict {
  const unresolvedBlock = findings.some(
    (f) => f.severity === 'block' && f.roundResolved === 'unresolved',
  )
  if (unresolvedBlock) return 'block'
  const unresolvedFixFirst = findings.some(
    (f) => f.severity === 'fix-first' && f.roundResolved === 'unresolved',
  )
  if (unresolvedFixFirst || personaScore < REVIEW_SCORE_MIN) {
    return 'needs-revision'
  }
  return 'ready'
}

// --- typed carry-forward for REVIEW round-N → BUILD attempt N+1 ---

import type { BuildReportCarryForward } from './build-report.ts'

export interface BuildReviewCarryForwardInput {
  /** Path to the canonical REVIEW.md that produced the needs-revision exit
   *  (e.g., `.code-oz/artifacts/REVIEW.md`). Recorded as
   *  `Prior forensics` so a BUILD attempt N+1 can read REVIEW.md
   *  directly. */
  readonly reviewReportPath: string
  /** 64-hex sha256 of the canonical REVIEW.md at the moment of the
   *  needs-revision exit. Recorded in `Prior verdict` for traceability. */
  readonly reviewReportSha256: string
  /** REVIEW round N that exited with needs-revision (1..3 — round 4
   *  exits as cap_exhausted, not as a remediation seed). */
  readonly priorRound: number
  /** Persona-authored summary of why the round needs revision; ≤ 200
   *  chars per BUILD_REPORT.md grammar. Recorded as
   *  `Prior failure summary`. */
  readonly summary: string
  /** Persona-authored directive for BUILD attempt N+1; ≤ 200 chars.
   *  Recorded as `Constraint`. */
  readonly constraint: string
  /** The just-failed BUILD attempt number that REVIEW reviewed (must
   *  match REVIEW.md.upstreamRefs.attempt). BUILD attempt N+1 will
   *  validate `priorAttempt + 1 === task.attempt`. */
  readonly priorAttempt: number
  /** Persona-authored validation command snapshot for BUILD attempt
   *  N+1's recall. Typically copied verbatim from the prior attempt's
   *  BUILD_REPORT.md so BUILD's `priorValidationCommand` field stays
   *  truthful. */
  readonly priorValidationCommand: string
}

/**
 * Build a typed `Source: review-needs-revision` carry-forward block
 * suitable for feeding into BUILD attempt N+1. Mirror of
 * restart-policy.prepareCarryForward
 * for REVIEW exits — produces the same BuildReportCarryForward shape so
 * BUILD's existing `attempt > 1` validation accepts either source.
 *
 * The mapping into BUILD's grammar:
 *   - source                    = 'review-needs-revision'
 *   - priorAttempt              = the just-reviewed BUILD attempt's number
 *   - priorForensicsPath        = the canonical REVIEW.md path
 *   - priorValidationCommand    = passed through verbatim
 *   - priorVerdict              = `needs-revision (round <N>, sha <sha>)`
 *                                 — the orchestrator-authored shape that
 *                                 carries enough context for the BUILD
 *                                 persona without inventing exit codes
 *   - priorFailureSummary       = the persona's summary, ≤ 200 chars
 *   - constraint                = the persona's directive, ≤ 200 chars
 *
 * Codex's M9 substrate catch (decision 8): rebranding a REVIEW
 * needs-revision exit as `Prior verdict: fail (exit code N, ...)` would
 * fabricate runtime evidence. The orchestrator-shaped Prior verdict is
 * honest about origin and the typed Source field lets downstream
 * tooling differentiate.
 */
export function serializeReviewCarryForward(
  input: BuildReviewCarryForwardInput,
): BuildReportCarryForward {
  if (input.priorRound < 1 || input.priorRound > REVIEW_ROUND_CAP) {
    throw new Error(
      `serializeReviewCarryForward: priorRound must be in [1, ${REVIEW_ROUND_CAP}]; got ${input.priorRound}`,
    )
  }
  if (input.priorAttempt < 1) {
    throw new Error(
      `serializeReviewCarryForward: priorAttempt must be ≥ 1; got ${input.priorAttempt}`,
    )
  }
  if (input.summary.length > REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS) {
    throw new Error(
      `serializeReviewCarryForward: summary exceeds ${REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS} characters (got ${input.summary.length})`,
    )
  }
  if (input.constraint.length > REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS) {
    throw new Error(
      `serializeReviewCarryForward: constraint exceeds ${REVIEW_CARRY_FORWARD_TEXT_MAX_CHARS} characters (got ${input.constraint.length})`,
    )
  }
  if (!/^[0-9a-f]{64}$/.test(input.reviewReportSha256)) {
    throw new Error(
      `serializeReviewCarryForward: reviewReportSha256 must be 64-char lower-case hex`,
    )
  }
  return Object.freeze({
    source: 'review-needs-revision' as const,
    priorAttempt: input.priorAttempt,
    priorForensicsPath: input.reviewReportPath,
    priorValidationCommand: input.priorValidationCommand,
    priorVerdict: `needs-revision (round ${input.priorRound}, sha ${input.reviewReportSha256})`,
    priorFailureSummary: input.summary,
    constraint: input.constraint,
  })
}

// --- bounded repair prompt grammar -------------------------------

export interface RepairPromptInput {
  /** Error code from a review-report load issue. */
  readonly errorCode: string
  /** The exact violated rule string from the issue. */
  readonly violatedRule: string
  /** Offending lines from the rejected draft, clipped to ≤
   *  REVIEW_REPAIR_OFFENDING_LINES_MAX entries. */
  readonly offendingLines: readonly string[]
}

/**
 * Renders a bounded repair prompt suitable for re-asking the persona to
 * correct a single grammatical violation. CODEX_RESPONSE_M9.md decision 9
 * pinned the format: error code + exact violated rule + ≤ 5 clipped
 * offending lines. Full failed drafts are NEVER appended.
 */
export function renderRepairPrompt(input: RepairPromptInput): string {
  const lines = input.offendingLines.slice(0, REVIEW_REPAIR_OFFENDING_LINES_MAX)
  const clip = input.offendingLines.length > REVIEW_REPAIR_OFFENDING_LINES_MAX
    ? `\n... (${input.offendingLines.length - REVIEW_REPAIR_OFFENDING_LINES_MAX} more lines omitted)`
    : ''
  return [
    `error_code: ${input.errorCode}`,
    `violated_rule: ${input.violatedRule}`,
    `offending_lines:`,
    ...lines.map((l) => `  ${l}`),
    ...(clip ? [clip] : []),
    '',
    'Re-emit the canonical REVIEW.md draft addressing only this violation.',
    'Do not include the prior draft in your response.',
  ].join('\n')
}

// --- helpers -------------------------------------------------------

function bulletMap(bullets: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of bullets) {
    const idx = b.indexOf(': ')
    if (idx === -1) continue
    out.set(b.slice(0, idx), b.slice(idx + 2))
  }
  return out
}

// =====================================================================
// M14 — Reviewer panel v1: multi-reviewer schema + Synthesis block +
// parse-time quorum recomputation. Single-reviewer M9 schema above is
// unchanged; panel mode is a separate type + separate parser/serializer
// so existing callers see no breaking change.
//
// Dispatch helper `detectReviewReportMode` lets callers pick the right
// parser based on the artifact's canonical section presence
// (`## Reviewer` singular vs `## Reviewers` plural).
//
// Parse-time quorum recomputation (layer 3 of the 5-layer defense per
// docs/contracts/REVIEW_PANEL.md § "Five-layer defense-in-depth"):
// `parseReviewPanelReport` rebuilds the panel verdict from the recorded
// reviewers + findings and rejects when the declared
// `Synthesis.Panel verdict` differs from the recomputed value (error
// code `review_artifact_quorum_inconsistent`). The verdict algorithm
// here is a private mirror of M14 commit 5's
// `computeCanonicalPanelVerdict`; both must agree.
// =====================================================================

export const PANELIST_ROLE_VALUES = ['voter', 'advisory'] as const
export type PanelistRole = (typeof PANELIST_ROLE_VALUES)[number]

export const PANEL_VERDICT_VALUES = ['ready', 'needs-revision', 'block'] as const
export type PanelVerdict = (typeof PANEL_VERDICT_VALUES)[number]

export const PANELIST_VERDICT_VALUES = ['ready', 'needs-revision', 'block'] as const
export type PanelistVerdict = (typeof PANELIST_VERDICT_VALUES)[number]

export const AUTHORITY_IMPACT_VALUES = ['voter', 'advisory'] as const
export type AuthorityImpact = (typeof AUTHORITY_IMPACT_VALUES)[number]

export const PANEL_REVIEW_REPORT_TITLE = '# REVIEW' as const

export const PANEL_REVIEW_REPORT_SECTION_KEYS = [
  'upstreamRefs',
  'reviewers',
  'synthesis',
  'roundTimeline',
  'findings',
  'score',
  'capStatus',
] as const
export type PanelReviewReportSectionKey = (typeof PANEL_REVIEW_REPORT_SECTION_KEYS)[number]

export const PANEL_REVIEW_REPORT_SECTION_HEADINGS: Readonly<
  Record<PanelReviewReportSectionKey, string>
> = Object.freeze({
  upstreamRefs: 'Upstream refs',
  reviewers: 'Reviewers',
  synthesis: 'Synthesis',
  roundTimeline: 'Round timeline',
  findings: 'Findings',
  score: 'Score',
  capStatus: 'Cap status',
})

export const CROSS_FAMILY_CHECK_VOTER = 'passed' as const
export const CROSS_FAMILY_CHECK_ADVISORY = 'same-family (advisory only)' as const

export interface ReviewPanelist {
  /** Stable per-panelist id (e.g., reviewer-A). Used for finding source attribution. */
  readonly id: string
  readonly providerId: string
  readonly providerFamily: string
  readonly modelPolicy: string
  readonly role: PanelistRole
  readonly score: number  // 0..10
  readonly verdict: PanelistVerdict
  readonly crossFamilyCheck: typeof CROSS_FAMILY_CHECK_VOTER | typeof CROSS_FAMILY_CHECK_ADVISORY
  /** The recorded BUILD family at the time of REVIEW. Same value across all panelists in a round. */
  readonly buildFamily: string
  /** sha256 of the canonical PreparedProviderRequest.files manifest this panelist saw.
   *  Manifest equality invariant: must match across all panelists in the same round. */
  readonly manifestHash: string
}

export interface ReviewSynthesizedFinding extends ReviewFinding {
  /** 'voter' if at least one eligible cross-family voter raised this fingerprint;
   *  'advisory' if only advisory or same-family panelists raised it. */
  readonly authorityImpact: AuthorityImpact
  /** Panelist ids that raised this fingerprint (≥ 1). */
  readonly sources: readonly string[]
}

export interface ReviewPanelExcludedReason {
  readonly id: string
  readonly reason: string
}

export interface ReviewPanelSynthesis {
  readonly panelVerdict: PanelVerdict
  readonly quorumReason: string
  readonly eligibleVoterFamilies: readonly string[]
  readonly excludedReviewerIds: readonly string[]
  readonly excludedReasons: readonly ReviewPanelExcludedReason[]
  readonly uniqueFindingsByReviewer: Readonly<Record<string, number>>
  readonly sharedFindings: number
}

export interface ReviewPanelTimelineEntry {
  readonly round: number      // 1..4, contiguous from 1
  readonly timestamp: string
  readonly findingsRaised: number
  readonly panelVerdict: PanelVerdict
}

export interface ReviewPanelScore {
  readonly roundCount: number
  /** Literal 'panel' — panel mode does not have a single integer score (per-panelist
   *  scores live on each ReviewPanelist). */
  readonly finalScore: 'panel'
  readonly finalVerdict: PanelVerdict
  readonly exitReason: string
}

export interface ReviewReportPanelData {
  readonly mode: 'panel'
  readonly upstreamRefs: ReviewUpstreamRefs
  readonly reviewers: readonly ReviewPanelist[]
  readonly synthesis: ReviewPanelSynthesis
  readonly roundTimeline: readonly ReviewPanelTimelineEntry[]
  readonly findings: readonly ReviewSynthesizedFinding[]
  readonly score: ReviewPanelScore
  readonly capStatus: ReviewCapStatus
}

export function isPanelistRole(value: string): value is PanelistRole {
  return (PANELIST_ROLE_VALUES as readonly string[]).includes(value)
}

export function isPanelVerdict(value: string): value is PanelVerdict {
  return (PANEL_VERDICT_VALUES as readonly string[]).includes(value)
}

export function isAuthorityImpact(value: string): value is AuthorityImpact {
  return (AUTHORITY_IMPACT_VALUES as readonly string[]).includes(value)
}

/**
 * Inspect a REVIEW.md raw string and return its mode.
 *   - 'single' if `## Reviewer` (singular) appears as an H2 heading
 *   - 'panel' if `## Reviewers` (plural) appears as an H2 heading
 *   - 'unknown' if neither is present (or both — caller treats as malformed)
 *
 * Cheap discriminator for callers that don't yet know which parser to use.
 * Strict header match — looks for an exact line `## Reviewers` or `## Reviewer`,
 * not any substring. Order doesn't matter.
 */
export function detectReviewReportMode(raw: string): 'single' | 'panel' | 'unknown' {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))
  const hasSingle = lines.includes('## Reviewer')
  const hasPanel = lines.includes('## Reviewers')
  if (hasPanel && !hasSingle) return 'panel'
  if (hasSingle && !hasPanel) return 'single'
  return 'unknown'
}

// --- panel serializer ----------------------------------------------

/**
 * Renders the canonical panel-mode REVIEW.md from structured data.
 * Output is deterministic. Per-panelist H3 blocks (mirrors the Findings
 * `### F-NNN:` pattern) carry each reviewer's identity + score + verdict
 * + cross-family check + manifest hash. Findings include `Authority
 * impact` and `Sources` to preserve attribution.
 */
export function serializeReviewPanelReport(data: ReviewReportPanelData): string {
  const lines: string[] = []
  lines.push(PANEL_REVIEW_REPORT_TITLE, '')

  // ## Upstream refs (same shape as single mode)
  lines.push('## Upstream refs', '')
  lines.push(
    `- BUILD_REPORT.md: ${data.upstreamRefs.buildReportPath} (sha256: ${data.upstreamRefs.buildReportSha256})`,
  )
  lines.push(
    `- VERIFY.md: ${data.upstreamRefs.verifyReportPath} (sha256: ${data.upstreamRefs.verifyReportSha256})`,
  )
  lines.push(`- Task: ${data.upstreamRefs.taskId}`)
  lines.push(`- Attempt: ${data.upstreamRefs.attempt}`)
  lines.push(`- Base commit: ${data.upstreamRefs.baseCommitSha}`)
  lines.push(`- Patch sha256: ${data.upstreamRefs.patchSha256}`)
  lines.push('')

  // ## Reviewers (H3 per panelist)
  lines.push('## Reviewers', '')
  for (let i = 0; i < data.reviewers.length; i++) {
    const r = data.reviewers[i]!
    lines.push(`### ${r.id}`, '')
    lines.push(`- Provider id: ${r.providerId}`)
    lines.push(`- Provider family: ${r.providerFamily}`)
    lines.push(`- Model policy: ${r.modelPolicy}`)
    lines.push(`- Role: ${r.role}`)
    lines.push(`- Score: ${r.score}`)
    lines.push(`- Verdict: ${r.verdict}`)
    lines.push(`- Cross-family check: ${r.crossFamilyCheck}`)
    lines.push(`- Build family: ${r.buildFamily}`)
    lines.push(`- Manifest hash: ${r.manifestHash}`)
    if (i < data.reviewers.length - 1) lines.push('')
  }
  lines.push('')

  // ## Synthesis (orchestrator-owned canonical verdict)
  lines.push('## Synthesis', '')
  lines.push(`- Panel verdict: ${data.synthesis.panelVerdict}`)
  lines.push(`- Quorum reason: ${data.synthesis.quorumReason}`)
  lines.push(`- Eligible voter families: ${data.synthesis.eligibleVoterFamilies.join(', ')}`)
  lines.push(
    `- Excluded reviewer ids: ${
      data.synthesis.excludedReviewerIds.length === 0
        ? '(none)'
        : data.synthesis.excludedReviewerIds.join(', ')
    }`,
  )
  lines.push(
    `- Excluded reasons: ${
      data.synthesis.excludedReasons.length === 0
        ? '(none)'
        : data.synthesis.excludedReasons.map((e) => `${e.id}: ${e.reason}`).join(', ')
    }`,
  )
  lines.push(
    `- Unique findings by reviewer: ${
      Object.keys(data.synthesis.uniqueFindingsByReviewer).length === 0
        ? '(none)'
        : Object.entries(data.synthesis.uniqueFindingsByReviewer)
            .map(([id, count]) => `${id}: ${count}`)
            .join(', ')
    }`,
  )
  lines.push(`- Shared findings: ${data.synthesis.sharedFindings}`)
  lines.push('')

  // ## Round timeline (panel grammar: `panel verdict` instead of score+verdict)
  lines.push('## Round timeline', '')
  for (const t of data.roundTimeline) {
    lines.push(
      `- Round ${t.round}: ${t.timestamp} | findings raised: ${t.findingsRaised} | panel verdict: ${t.panelVerdict}`,
    )
  }
  lines.push('')

  // ## Findings (extended with Authority impact + Sources)
  lines.push('## Findings', '')
  if (data.findings.length === 0) {
    lines.push('- None.')
    lines.push('')
  } else {
    for (let i = 0; i < data.findings.length; i++) {
      const f = data.findings[i]!
      lines.push(`### ${f.id}: ${f.title}`, '')
      lines.push(`- File: ${f.file}`)
      lines.push(`- Line: ${f.line}`)
      lines.push(`- Severity: ${f.severity}`)
      lines.push(`- Authority impact: ${f.authorityImpact}`)
      lines.push(`- Sources: ${f.sources.join(', ')}`)
      lines.push(`- Recommendation: ${f.recommendation}`)
      lines.push(`- Round raised: ${f.roundRaised}`)
      lines.push(`- Round resolved: ${f.roundResolved}`)
      if (i < data.findings.length - 1) lines.push('')
    }
    lines.push('')
  }

  // ## Score (Final score is literal 'panel')
  lines.push('## Score', '')
  lines.push(`- Round count: ${data.score.roundCount}`)
  lines.push(`- Final score: ${data.score.finalScore}`)
  lines.push(`- Final verdict: ${data.score.finalVerdict}`)
  lines.push(`- Exit reason: ${data.score.exitReason}`)
  lines.push('')

  // ## Cap status (same shape as single mode)
  lines.push('## Cap status', '')
  lines.push(`- Cap: ${data.capStatus.cap} rounds`)
  lines.push(`- Rounds used: ${data.capStatus.roundsUsed}`)
  lines.push(`- Cap exhausted: ${data.capStatus.capExhausted}`)
  lines.push('')

  return lines.join('\n')
}

// --- panel parser --------------------------------------------------

interface PanelSectionBuf {
  readonly key: PanelReviewReportSectionKey
  readonly bullets: readonly string[]
  readonly h3Blocks: readonly H3Block[]
  readonly headingLine: number
}

const PANEL_ROUND_TIMELINE_REGEX =
  /^Round (\d+): (.+?) \| findings raised: (\d+) \| panel verdict: (ready|needs-revision|block)$/

/**
 * Parse a panel-mode REVIEW.md document. Validates section presence +
 * canonical order + per-section grammar, then runs parse-time quorum
 * recomputation (layer 3 of the 5-layer defense). Returns frozen
 * ReviewReportPanelData on success; throws ReviewReportLoadError with
 * accumulated issues on failure.
 *
 * Cross-section invariants enforced:
 *  - Round timeline last entry's panelVerdict matches Score.finalVerdict
 *  - Score.roundCount equals last timeline entry's round
 *  - Cap status.roundsUsed equals Score.roundCount
 *  - Cap status.cap === REVIEW_ROUND_CAP
 *  - All reviewers share the same buildFamily and manifestHash (manifest
 *    equality invariant per REVIEW_PANEL.md § "Manifest equality invariant")
 *  - Synthesis.panelVerdict equals recomputed verdict from reviewers +
 *    findings (parse-time quorum recomputation)
 *  - Each finding's Authority impact + Sources are consistent: 'voter'
 *    requires at least one source whose role is voter AND family !==
 *    buildFamily; 'advisory' requires no eligible voter raised it
 *  - Final verdict: ready forbids unresolved voter-impact block/fix-first
 */
export function parseReviewPanelReport(
  raw: string,
  file = 'REVIEW.md',
  opts: ParseReviewReportOptions = {},
): ReviewReportPanelData {
  const issues: ReviewReportLoadIssue[] = []
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  if (text.trim().length === 0) {
    throw new ReviewReportLoadError([
      { file, code: 'review_report_empty', rule: 'REVIEW.md must not be empty' },
    ])
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''))
  const titleIdx = lines.findIndex((l) => l === PANEL_REVIEW_REPORT_TITLE)
  if (titleIdx === -1) {
    throw new ReviewReportLoadError([
      {
        file,
        code: 'review_report_title_missing',
        rule: `must contain '${PANEL_REVIEW_REPORT_TITLE}' as a top-level heading`,
      },
    ])
  }

  const sections = walkPanelSections(lines, titleIdx + 1, file, issues)
  const orderIssue = checkPanelSectionOrder(sections, file)
  if (orderIssue) issues.push(orderIssue)

  for (const key of PANEL_REVIEW_REPORT_SECTION_KEYS) {
    if (!sections.has(key)) {
      issues.push({
        file,
        code: 'review_report_missing_section',
        rule: `required H2 section absent: '## ${PANEL_REVIEW_REPORT_SECTION_HEADINGS[key]}'`,
      })
    }
  }
  if (issues.some((i) => i.code === 'review_report_missing_section')) {
    throw new ReviewReportLoadError(issues)
  }

  const upstreamRefs = parseUpstreamRefs(sections.get('upstreamRefs')!, file, issues)
  const reviewers = parsePanelReviewers(sections.get('reviewers')!, file, issues)
  const synthesis = parsePanelSynthesis(sections.get('synthesis')!, file, issues)
  const roundTimeline = parsePanelRoundTimeline(sections.get('roundTimeline')!, file, issues)
  const findings = parsePanelFindings(
    sections.get('findings')!,
    file,
    issues,
    opts.changedFilePaths,
  )
  const score = parsePanelScore(sections.get('score')!, file, issues)
  const capStatus = parseCapStatus(sections.get('capStatus')!, file, issues)

  // Cross-section invariants.
  if (roundTimeline && score) {
    const last = roundTimeline[roundTimeline.length - 1]
    if (last !== undefined) {
      if (score.roundCount !== last.round) {
        issues.push({
          file,
          code: 'review_score_round_count_mismatch',
          rule: 'Score.Round count must equal the last Round timeline entry round',
          detail: `score.roundCount=${score.roundCount} timeline.last.round=${last.round}`,
        })
      }
      if (score.finalVerdict !== last.panelVerdict) {
        issues.push({
          file,
          code: 'review_score_final_verdict_mismatch',
          rule: 'Score.Final verdict must equal the last Round timeline entry panel verdict',
          detail: `score.finalVerdict=${score.finalVerdict} timeline.last.panelVerdict=${last.panelVerdict}`,
        })
      }
    }
  }

  if (capStatus && score) {
    if (capStatus.roundsUsed !== score.roundCount) {
      issues.push({
        file,
        code: 'review_cap_status_mismatch',
        rule: 'Cap status.Rounds used must equal Score.Round count',
        detail: `capStatus.roundsUsed=${capStatus.roundsUsed} score.roundCount=${score.roundCount}`,
      })
    }
    if (capStatus.cap !== REVIEW_ROUND_CAP) {
      issues.push({
        file,
        code: 'review_cap_status_grammar',
        rule: `Cap status.Cap must be ${REVIEW_ROUND_CAP} (CLAUDE.md non-negotiable rule 6)`,
        detail: `got ${capStatus.cap}`,
      })
    }
  }

  // Manifest equality invariant: every panelist in the same round must
  // have received the same file manifest. Layer in REVIEW_PANEL.md
  // § "Manifest equality invariant".
  if (reviewers && reviewers.length > 1) {
    const firstHash = reviewers[0]!.manifestHash
    const firstBuildFamily = reviewers[0]!.buildFamily
    for (let i = 1; i < reviewers.length; i++) {
      const r = reviewers[i]!
      if (r.manifestHash !== firstHash) {
        issues.push({
          file,
          code: 'review_panelist_manifest_mismatch',
          rule:
            'All panelists in the same round must share the same Manifest hash ' +
            '(M14 manifest equality invariant; REVIEW_PANEL.md § "Manifest equality invariant")',
          detail: `'${r.id}' manifest hash=${r.manifestHash} differs from '${reviewers[0]!.id}' hash=${firstHash}`,
        })
      }
      if (r.buildFamily !== firstBuildFamily) {
        issues.push({
          file,
          code: 'review_panelist_build_family_mismatch',
          rule: 'All panelists in the same round must record the same Build family',
          detail: `'${r.id}' buildFamily=${r.buildFamily} differs from '${reviewers[0]!.id}' buildFamily=${firstBuildFamily}`,
        })
      }
    }
  }

  // F4 (Codex M14 R1 finding #4): authority-impact source consistency.
  // Every finding's `sources` must (a) reference real reviewer ids and
  // (b) agree with eligibility-derived authorityImpact. If ANY source
  // is an eligible voter (role='voter' AND providerFamily !==
  // buildFamily), the finding's `authorityImpact` MUST be 'voter';
  // otherwise it MUST be 'advisory'. Without this, a hand-crafted
  // panel artifact with a voter-sourced block finding marked as
  // 'authorityImpact: advisory' bypasses the gate-authority rule.
  if (reviewers && findings) {
    const reviewerById = new Map(reviewers.map((r) => [r.id, r]))
    const buildFamilyForElig = reviewers.length > 0 ? reviewers[0]!.buildFamily : ''
    const eligibleVoterIds = new Set(
      reviewers
        .filter((r) => r.role === 'voter' && r.providerFamily !== buildFamilyForElig)
        .map((r) => r.id),
    )
    for (const f of findings) {
      let hasEligibleVoter = false
      let allSourcesKnown = true
      for (const src of f.sources) {
        const reviewer = reviewerById.get(src)
        if (reviewer === undefined) {
          allSourcesKnown = false
          issues.push({
            file,
            code: 'review_artifact_unknown_source_id',
            rule:
              `Finding ${f.id} cites source '${src}' which is not declared in the Reviewers section ` +
              '(M14 layer-3 invariant)',
            detail: `Sources: ${f.sources.join(', ')}; Reviewers: ${[...reviewerById.keys()].join(', ')}`,
          })
          continue
        }
        if (eligibleVoterIds.has(src)) hasEligibleVoter = true
      }
      if (!allSourcesKnown) continue
      const expected = hasEligibleVoter ? 'voter' : 'advisory'
      if (f.authorityImpact !== expected) {
        issues.push({
          file,
          code: 'review_artifact_authority_impact_inconsistent',
          rule:
            `Finding ${f.id}: Authority impact must be '${expected}' given its Sources ` +
            '(M14 layer-3 invariant; REVIEW_PANEL.md § "Five-layer defense-in-depth")',
          detail: `declared='${f.authorityImpact}' expected='${expected}' sources=${f.sources.join(', ')}`,
        })
      }
    }
  }

  // Parse-time quorum recomputation (layer 3 of the 5-layer defense).
  // Recompute panelVerdict from reviewers + findings; reject if claimed
  // value differs.
  if (reviewers && synthesis && findings) {
    const recomputed = recomputePanelVerdictFromArtifact(reviewers, findings)
    if (recomputed.panelVerdict !== synthesis.panelVerdict) {
      issues.push({
        file,
        code: 'review_artifact_quorum_inconsistent',
        rule:
          'Synthesis.Panel verdict must equal the verdict recomputed from Reviewers + Findings ' +
          '(M14 parse-time quorum recomputation; REVIEW_PANEL.md § "Five-layer defense-in-depth" layer 3)',
        detail:
          `declared='${synthesis.panelVerdict}' recomputed='${recomputed.panelVerdict}' ` +
          `(${recomputed.reason})`,
      })
    }
  }

  // ready-verdict forbids unresolved voter-impact actionable findings.
  if (findings && score && score.finalVerdict === 'ready') {
    for (const f of findings) {
      if (
        f.authorityImpact === 'voter' &&
        (f.severity === 'block' || f.severity === 'fix-first') &&
        f.roundResolved === 'unresolved'
      ) {
        issues.push({
          file,
          code: 'review_unresolved_blocker',
          rule:
            'Final verdict: ready forbids unresolved Authority impact: voter findings of severity block or fix-first',
          detail: `${f.id} severity=${f.severity} authorityImpact=voter roundResolved=unresolved`,
        })
      }
    }
  }

  if (
    issues.length > 0 ||
    !upstreamRefs ||
    !reviewers ||
    !synthesis ||
    !roundTimeline ||
    !findings ||
    !score ||
    !capStatus
  ) {
    throw new ReviewReportLoadError(issues)
  }

  return Object.freeze({
    mode: 'panel' as const,
    upstreamRefs,
    reviewers,
    synthesis,
    roundTimeline,
    findings,
    score,
    capStatus,
  })
}

function walkPanelSections(
  lines: readonly string[],
  startIdx: number,
  file: string,
  issues: ReviewReportLoadIssue[],
): Map<PanelReviewReportSectionKey, PanelSectionBuf> {
  const headingToKey: Record<string, PanelReviewReportSectionKey> = {}
  for (const k of PANEL_REVIEW_REPORT_SECTION_KEYS) {
    headingToKey[`## ${PANEL_REVIEW_REPORT_SECTION_HEADINGS[k]}`] = k
  }
  const map = new Map<PanelReviewReportSectionKey, PanelSectionBuf>()
  let cur: {
    key: PanelReviewReportSectionKey
    bullets: string[]
    h3Blocks: H3Block[]
    headingLine: number
    curH3: { heading: string; bullets: string[]; headingLine: number } | null
  } | null = null

  const flushH3 = (): void => {
    if (cur && cur.curH3) {
      cur.h3Blocks.push(
        Object.freeze({
          heading: cur.curH3.heading,
          bullets: Object.freeze([...cur.curH3.bullets]),
          headingLine: cur.curH3.headingLine,
        }),
      )
      cur.curH3 = null
    }
  }

  const flushSection = (): void => {
    if (cur) {
      flushH3()
      map.set(
        cur.key,
        Object.freeze({
          key: cur.key,
          bullets: Object.freeze([...cur.bullets]),
          h3Blocks: Object.freeze([...cur.h3Blocks]),
          headingLine: cur.headingLine,
        }),
      )
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('## ')) {
      flushSection()
      const key = headingToKey[line]
      if (key === undefined) {
        issues.push({
          file,
          code: 'review_report_unknown_section',
          rule: `unknown H2 section: '${line}'`,
          line: i + 1,
        })
        cur = null
        continue
      }
      cur = { key, bullets: [], h3Blocks: [], headingLine: i + 1, curH3: null }
      continue
    }
    if (!cur) continue
    if (line.startsWith('### ')) {
      flushH3()
      cur.curH3 = {
        heading: line.slice(4),
        bullets: [],
        headingLine: i + 1,
      }
      continue
    }
    if (/^- /.test(line)) {
      const body = line.slice(2)
      if (cur.curH3) {
        cur.curH3.bullets.push(body)
      } else {
        cur.bullets.push(body)
      }
    }
  }
  flushSection()
  return map
}

function checkPanelSectionOrder(
  sections: Map<PanelReviewReportSectionKey, PanelSectionBuf>,
  file: string,
): ReviewReportLoadIssue | null {
  const present = [...sections.entries()].sort(
    (a, b) => a[1].headingLine - b[1].headingLine,
  )
  const orderActual = present.map(([k]) => k)
  let canonicalIdx = 0
  for (const k of orderActual) {
    while (
      canonicalIdx < PANEL_REVIEW_REPORT_SECTION_KEYS.length &&
      PANEL_REVIEW_REPORT_SECTION_KEYS[canonicalIdx] !== k
    ) {
      canonicalIdx++
    }
    if (canonicalIdx >= PANEL_REVIEW_REPORT_SECTION_KEYS.length) {
      return {
        file,
        code: 'review_report_section_out_of_order',
        rule: `section '${PANEL_REVIEW_REPORT_SECTION_HEADINGS[k]}' appears out of canonical order`,
      }
    }
    canonicalIdx++
  }
  return null
}

function parsePanelReviewers(
  s: PanelSectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): readonly ReviewPanelist[] | null {
  if (s.h3Blocks.length === 0) {
    issues.push({
      file,
      code: 'review_panel_reviewers_empty',
      rule: '## Reviewers must contain at least two `### <reviewer-id>` H3 blocks',
    })
    return null
  }
  if (s.h3Blocks.length < 2) {
    issues.push({
      file,
      code: 'review_panel_reviewers_too_few',
      rule:
        '## Reviewers must contain at least 2 panelists ' +
        '(M14 fixed-quorum: exactly 2 voters; advisory entries optional)',
      detail: `got ${s.h3Blocks.length} panelist block${s.h3Blocks.length === 1 ? '' : 's'}`,
    })
    return null
  }
  const out: ReviewPanelist[] = []
  const seenIds = new Set<string>()
  for (const block of s.h3Blocks) {
    const id = block.heading.trim()
    if (id.length === 0) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule: 'Reviewers H3 heading must be a non-empty panelist id (e.g., `### reviewer-A`)',
        line: block.headingLine,
      })
      return null
    }
    if (seenIds.has(id)) {
      issues.push({
        file,
        code: 'review_panel_reviewer_id_collision',
        rule: 'Reviewers panelist ids must be unique within REVIEW.md',
        detail: id,
        line: block.headingLine,
      })
      return null
    }
    seenIds.add(id)
    const m = bulletMap(block.bullets)
    const providerId = m.get('Provider id')
    const providerFamily = m.get('Provider family')
    const modelPolicy = m.get('Model policy')
    const roleStr = m.get('Role')
    const scoreStr = m.get('Score')
    const verdictStr = m.get('Verdict')
    const crossFamily = m.get('Cross-family check')
    const buildFamily = m.get('Build family')
    const manifestHash = m.get('Manifest hash')
    if (
      !providerId ||
      !providerFamily ||
      !modelPolicy ||
      !roleStr ||
      !scoreStr ||
      !verdictStr ||
      !crossFamily ||
      !buildFamily ||
      !manifestHash
    ) {
      issues.push({
        file,
        code: 'review_panel_reviewer_missing',
        rule:
          'Each Reviewers H3 block requires bullets: Provider id, Provider family, Model policy, ' +
          'Role, Score, Verdict, Cross-family check, Build family, Manifest hash',
        detail: id,
        line: block.headingLine,
      })
      return null
    }
    if (!isPanelistRole(roleStr)) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule: `Reviewers.Role must be one of: ${PANELIST_ROLE_VALUES.join(', ')}`,
        detail: `'${id}' role=${roleStr}`,
        line: block.headingLine,
      })
      return null
    }
    if (!isPanelVerdict(verdictStr)) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule: `Reviewers.Verdict must be one of: ${PANEL_VERDICT_VALUES.join(', ')}`,
        detail: `'${id}' verdict=${verdictStr}`,
        line: block.headingLine,
      })
      return null
    }
    const score = Number.parseInt(scoreStr, 10)
    if (!Number.isInteger(score) || score < 0 || score > REVIEW_SCORE_MAX) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule: `Reviewers.Score must be an integer in [0, ${REVIEW_SCORE_MAX}]`,
        detail: `'${id}' score=${scoreStr}`,
        line: block.headingLine,
      })
      return null
    }
    if (
      crossFamily !== CROSS_FAMILY_CHECK_VOTER &&
      crossFamily !== CROSS_FAMILY_CHECK_ADVISORY
    ) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule:
          `Reviewers.Cross-family check must be one of: '${CROSS_FAMILY_CHECK_VOTER}' or ` +
          `'${CROSS_FAMILY_CHECK_ADVISORY}'`,
        detail: `'${id}' cross-family check=${crossFamily}`,
        line: block.headingLine,
      })
      return null
    }
    // Voter must declare 'passed' (cross-family); advisory may declare either.
    if (roleStr === 'voter') {
      if (crossFamily !== CROSS_FAMILY_CHECK_VOTER) {
        issues.push({
          file,
          code: 'review_panel_reviewer_grammar',
          rule:
            "Reviewers Role: voter must declare Cross-family check: 'passed' " +
            "('same-family (advisory only)' is reserved for Role: advisory)",
          detail: `'${id}' role=voter cross-family check=${crossFamily}`,
          line: block.headingLine,
        })
        return null
      }
      if (providerFamily === buildFamily) {
        issues.push({
          file,
          code: 'review_cross_family_violation',
          rule:
            'Reviewers Role: voter Provider family must differ from Build family ' +
            '(CLAUDE.md non-negotiable rule 2 + M14 panel quorum)',
          detail: `'${id}' provider family=${providerFamily} build family=${buildFamily}`,
          line: block.headingLine,
        })
        return null
      }
    }
    if (!/^[0-9a-f]{64}$/.test(manifestHash)) {
      issues.push({
        file,
        code: 'review_panel_reviewer_grammar',
        rule: 'Reviewers.Manifest hash must be 64-char lower-case hex',
        detail: `'${id}' manifest hash=${manifestHash}`,
        line: block.headingLine,
      })
      return null
    }
    out.push(
      Object.freeze({
        id,
        providerId,
        providerFamily,
        modelPolicy,
        role: roleStr,
        score,
        verdict: verdictStr,
        crossFamilyCheck: crossFamily,
        buildFamily,
        manifestHash,
      }),
    )
  }
  return Object.freeze(out)
}

function parsePanelSynthesis(
  s: PanelSectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewPanelSynthesis | null {
  const m = bulletMap(s.bullets)
  const panelVerdictStr = m.get('Panel verdict')
  const quorumReason = m.get('Quorum reason')
  const eligibleVoterFamiliesStr = m.get('Eligible voter families')
  const excludedReviewerIdsStr = m.get('Excluded reviewer ids')
  const excludedReasonsStr = m.get('Excluded reasons')
  const uniqueFindingsStr = m.get('Unique findings by reviewer')
  const sharedFindingsStr = m.get('Shared findings')
  if (
    panelVerdictStr === undefined ||
    quorumReason === undefined ||
    eligibleVoterFamiliesStr === undefined ||
    excludedReviewerIdsStr === undefined ||
    excludedReasonsStr === undefined ||
    uniqueFindingsStr === undefined ||
    sharedFindingsStr === undefined
  ) {
    issues.push({
      file,
      code: 'review_panel_synthesis_missing',
      rule:
        '## Synthesis requires bullets: Panel verdict, Quorum reason, Eligible voter families, ' +
        'Excluded reviewer ids, Excluded reasons, Unique findings by reviewer, Shared findings',
    })
    return null
  }
  if (!isPanelVerdict(panelVerdictStr)) {
    issues.push({
      file,
      code: 'review_panel_synthesis_grammar',
      rule: `Synthesis.Panel verdict must be one of: ${PANEL_VERDICT_VALUES.join(', ')}`,
      detail: panelVerdictStr,
    })
    return null
  }
  const eligibleVoterFamilies =
    eligibleVoterFamiliesStr === '(none)' || eligibleVoterFamiliesStr.trim() === ''
      ? []
      : eligibleVoterFamiliesStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const excludedReviewerIds =
    excludedReviewerIdsStr === '(none)' || excludedReviewerIdsStr.trim() === ''
      ? []
      : excludedReviewerIdsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const excludedReasons =
    excludedReasonsStr === '(none)' || excludedReasonsStr.trim() === ''
      ? []
      : excludedReasonsStr
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((entry) => {
            const idx = entry.indexOf(': ')
            if (idx === -1) return null
            return Object.freeze({ id: entry.slice(0, idx).trim(), reason: entry.slice(idx + 2).trim() })
          })
          .filter((e): e is { id: string; reason: string } => e !== null)
  const uniqueFindingsByReviewer: Record<string, number> = {}
  if (uniqueFindingsStr !== '(none)' && uniqueFindingsStr.trim() !== '') {
    for (const entry of uniqueFindingsStr.split(',')) {
      const trimmed = entry.trim()
      const idx = trimmed.indexOf(': ')
      if (idx === -1) continue
      const id = trimmed.slice(0, idx).trim()
      const countStr = trimmed.slice(idx + 2).trim()
      const count = Number.parseInt(countStr, 10)
      if (!Number.isInteger(count) || count < 0) {
        issues.push({
          file,
          code: 'review_panel_synthesis_grammar',
          rule:
            'Synthesis.Unique findings by reviewer counts must be non-negative integers',
          detail: `'${id}' count=${countStr}`,
        })
        return null
      }
      uniqueFindingsByReviewer[id] = count
    }
  }
  const sharedFindings = Number.parseInt(sharedFindingsStr, 10)
  if (!Number.isInteger(sharedFindings) || sharedFindings < 0) {
    issues.push({
      file,
      code: 'review_panel_synthesis_grammar',
      rule: 'Synthesis.Shared findings must be a non-negative integer',
      detail: sharedFindingsStr,
    })
    return null
  }
  return Object.freeze({
    panelVerdict: panelVerdictStr,
    quorumReason,
    eligibleVoterFamilies: Object.freeze(eligibleVoterFamilies),
    excludedReviewerIds: Object.freeze(excludedReviewerIds),
    excludedReasons: Object.freeze(excludedReasons),
    uniqueFindingsByReviewer: Object.freeze(uniqueFindingsByReviewer),
    sharedFindings,
  })
}

function parsePanelRoundTimeline(
  s: PanelSectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): readonly ReviewPanelTimelineEntry[] | null {
  if (s.bullets.length === 0) {
    issues.push({
      file,
      code: 'review_round_timeline_empty',
      rule: '## Round timeline must contain at least one Round bullet',
    })
    return null
  }
  const out: ReviewPanelTimelineEntry[] = []
  for (let i = 0; i < s.bullets.length; i++) {
    const b = s.bullets[i]!
    const match = b.match(PANEL_ROUND_TIMELINE_REGEX)
    if (!match) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule:
          'Panel round timeline bullet must match `Round <N>: <ts> | findings raised: <count> | panel verdict: <ready|needs-revision|block>`',
        detail: b,
      })
      return null
    }
    const round = Number.parseInt(match[1]!, 10)
    const timestamp = match[2]!
    const findingsRaised = Number.parseInt(match[3]!, 10)
    const panelVerdict = match[4]!
    if (!isPanelVerdict(panelVerdict)) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule:
          'Panel round timeline panel verdict must be one of: ready, needs-revision, block',
        detail: `got ${panelVerdict}`,
      })
      return null
    }
    if (round !== i + 1) {
      issues.push({
        file,
        code: 'review_round_gap',
        rule:
          'Round timeline must start at 1 and increment by 1 (no gaps; no zero or negative rounds)',
        detail: `expected ${i + 1}, got ${round}`,
      })
      return null
    }
    if (round > REVIEW_ROUND_CAP) {
      issues.push({
        file,
        code: 'review_round_grammar',
        rule: `Round timeline.Round must be ≤ ${REVIEW_ROUND_CAP} (CLAUDE.md non-negotiable rule 6)`,
        detail: `got ${round}`,
      })
      return null
    }
    out.push(Object.freeze({ round, timestamp, findingsRaised, panelVerdict }))
  }
  return Object.freeze(out)
}

function parsePanelFindings(
  s: PanelSectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
  changedFilePaths?: readonly string[],
): readonly ReviewSynthesizedFinding[] | null {
  if (s.h3Blocks.length === 0) {
    if (s.bullets.length === 1 && s.bullets[0] === 'None.') {
      return Object.freeze([])
    }
    issues.push({
      file,
      code: 'review_findings_grammar',
      rule:
        '## Findings must contain `- None.` when no findings exist, or one or more `### F-NNN: <title>` H3 blocks',
    })
    return null
  }
  const out: ReviewSynthesizedFinding[] = []
  const seenIds = new Set<string>()
  for (const block of s.h3Blocks) {
    const headingMatch = block.heading.match(/^(F-\d{3,}): (.+)$/)
    if (!headingMatch) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule:
          'Findings H3 heading must match `### F-NNN: <one-line title>` (NNN = 3+ digits)',
        detail: block.heading,
        line: block.headingLine,
      })
      return null
    }
    const id = headingMatch[1]!
    const title = headingMatch[2]!
    if (seenIds.has(id)) {
      issues.push({
        file,
        code: 'review_finding_id_collision',
        rule: 'Findings H3 ids must be unique within REVIEW.md',
        detail: id,
        line: block.headingLine,
      })
      return null
    }
    seenIds.add(id)
    if (title.length > REVIEW_TITLE_MAX_CHARS) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Findings title length must be ≤ ${REVIEW_TITLE_MAX_CHARS} characters`,
        detail: `${id}: title length=${title.length}`,
        line: block.headingLine,
      })
      return null
    }
    const m = bulletMap(block.bullets)
    const fileV = m.get('File')
    const line = m.get('Line')
    const severity = m.get('Severity')
    const authorityImpactStr = m.get('Authority impact')
    const sourcesStr = m.get('Sources')
    const recommendation = m.get('Recommendation')
    const roundRaisedStr = m.get('Round raised')
    const roundResolvedStr = m.get('Round resolved')
    if (
      !fileV ||
      !line ||
      !severity ||
      !authorityImpactStr ||
      !sourcesStr ||
      !recommendation ||
      !roundRaisedStr ||
      !roundResolvedStr
    ) {
      issues.push({
        file,
        code: 'review_finding_missing',
        rule:
          'Each Findings H3 block requires bullets: File, Line, Severity, Authority impact, ' +
          'Sources, Recommendation, Round raised, Round resolved',
        detail: id,
        line: block.headingLine,
      })
      return null
    }
    if (!isReviewSeverity(severity)) {
      issues.push({
        file,
        code: 'review_severity_invalid',
        rule: `Findings.Severity must be one of: ${REVIEW_SEVERITIES.join(', ')}`,
        detail: `${id}: severity=${severity}`,
        line: block.headingLine,
      })
      return null
    }
    if (!isAuthorityImpact(authorityImpactStr)) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Findings.Authority impact must be one of: ${AUTHORITY_IMPACT_VALUES.join(', ')}`,
        detail: `${id}: authority impact=${authorityImpactStr}`,
        line: block.headingLine,
      })
      return null
    }
    const sources = sourcesStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    if (sources.length === 0) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: 'Findings.Sources must list at least one panelist id',
        detail: `${id}: sources=${sourcesStr}`,
        line: block.headingLine,
      })
      return null
    }
    if (recommendation.length > REVIEW_RECOMMENDATION_MAX_CHARS) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Findings.Recommendation length must be ≤ ${REVIEW_RECOMMENDATION_MAX_CHARS} characters`,
        detail: `${id}: recommendation length=${recommendation.length}`,
        line: block.headingLine,
      })
      return null
    }
    const roundRaised = Number.parseInt(roundRaisedStr, 10)
    if (!Number.isInteger(roundRaised) || roundRaised < 1 || roundRaised > REVIEW_ROUND_CAP) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: `Findings.Round raised must be an integer in [1, ${REVIEW_ROUND_CAP}]`,
        detail: `${id}: round raised=${roundRaisedStr}`,
        line: block.headingLine,
      })
      return null
    }
    let roundResolved: number | 'unresolved'
    if (roundResolvedStr === 'unresolved') {
      roundResolved = 'unresolved'
    } else {
      const n = Number.parseInt(roundResolvedStr, 10)
      if (!Number.isInteger(n) || n < 1 || n > REVIEW_ROUND_CAP) {
        issues.push({
          file,
          code: 'review_finding_grammar',
          rule: `Findings.Round resolved must be 'unresolved' or an integer in [1, ${REVIEW_ROUND_CAP}]`,
          detail: `${id}: round resolved=${roundResolvedStr}`,
          line: block.headingLine,
        })
        return null
      }
      roundResolved = n
    }
    if (typeof roundResolved === 'number' && roundResolved < roundRaised) {
      issues.push({
        file,
        code: 'review_finding_grammar',
        rule: 'Findings.Round resolved must be ≥ Round raised when not unresolved',
        detail: `${id}: roundRaised=${roundRaised} roundResolved=${roundResolved}`,
        line: block.headingLine,
      })
      return null
    }
    if (changedFilePaths !== undefined && !changedFilePaths.includes(fileV)) {
      issues.push({
        file,
        code: 'review_finding_path_unknown',
        rule:
          'Findings.File must appear in BUILD_REPORT.md Changed files manifest',
        detail: `${id}: file=${fileV}`,
        line: block.headingLine,
      })
      return null
    }
    out.push(
      Object.freeze({
        id,
        title,
        file: fileV,
        line,
        severity,
        recommendation,
        roundRaised,
        roundResolved,
        authorityImpact: authorityImpactStr,
        sources: Object.freeze(sources),
      }),
    )
  }
  return Object.freeze(out)
}

function parsePanelScore(
  s: PanelSectionBuf,
  file: string,
  issues: ReviewReportLoadIssue[],
): ReviewPanelScore | null {
  const m = bulletMap(s.bullets)
  const roundCountStr = m.get('Round count')
  const finalScoreStr = m.get('Final score')
  const finalVerdictStr = m.get('Final verdict')
  const exitReason = m.get('Exit reason')
  if (!roundCountStr || !finalScoreStr || !finalVerdictStr || !exitReason) {
    issues.push({
      file,
      code: 'review_score_missing',
      rule: '## Score requires bullets: Round count, Final score, Final verdict, Exit reason',
    })
    return null
  }
  const roundCount = Number.parseInt(roundCountStr, 10)
  if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > REVIEW_ROUND_CAP) {
    issues.push({
      file,
      code: 'review_score_grammar',
      rule: `Score.Round count must be an integer in [1, ${REVIEW_ROUND_CAP}]`,
      detail: roundCountStr,
    })
    return null
  }
  if (finalScoreStr !== 'panel') {
    issues.push({
      file,
      code: 'review_score_grammar',
      rule: "Score.Final score must be the literal 'panel' in panel mode (per-panelist scores live in Reviewers blocks)",
      detail: finalScoreStr,
    })
    return null
  }
  if (!isPanelVerdict(finalVerdictStr)) {
    issues.push({
      file,
      code: 'review_score_grammar',
      rule: `Score.Final verdict must be one of: ${PANEL_VERDICT_VALUES.join(', ')}`,
      detail: finalVerdictStr,
    })
    return null
  }
  return Object.freeze({
    roundCount,
    finalScore: 'panel' as const,
    finalVerdict: finalVerdictStr,
    exitReason,
  })
}

// `parseCapStatus` (single-mode) is reused by panel mode — see definition
// above (~line 1031). Both modes use identical Cap status grammar.

/**
 * Parse-time quorum recomputation. Walks reviewers + findings and rebuilds
 * the panel verdict from first principles. The parser compares this with
 * the declared `Synthesis.Panel verdict` and rejects on disagreement
 * (`review_artifact_quorum_inconsistent`). This is layer 3 of the 5-layer
 * defense (per docs/contracts/REVIEW_PANEL.md § "Five-layer defense-in-depth").
 *
 * Algorithm mirrors M14 commit 5's `computeCanonicalPanelVerdict`:
 *   1. Eligible voter = role 'voter' AND providerFamily !== buildFamily
 *      (advisory or same-family voters excluded)
 *   2. Any voter-impact finding with severity 'block' AND unresolved →
 *      panel verdict 'block'
 *   3. Any voter-impact finding with severity 'fix-first' AND unresolved →
 *      panel verdict 'needs-revision'
 *   4. Eligible voters !== 2 → panel verdict 'needs-revision'
 *      (with reason explaining the count)
 *   5. Any eligible voter has score < 6 OR verdict !== 'ready' →
 *      panel verdict 'needs-revision'
 *   6. Otherwise panel verdict 'ready'
 */
function recomputePanelVerdictFromArtifact(
  reviewers: readonly ReviewPanelist[],
  findings: readonly ReviewSynthesizedFinding[],
): { panelVerdict: PanelVerdict; reason: string } {
  // Step 1: eligibility
  const buildFamily = reviewers.length > 0 ? reviewers[0]!.buildFamily : ''
  const eligibleVoters = reviewers.filter(
    (r) => r.role === 'voter' && r.providerFamily !== buildFamily,
  )
  // Step 2: voter-impact block
  if (
    findings.some(
      (f) =>
        f.authorityImpact === 'voter' &&
        f.severity === 'block' &&
        f.roundResolved === 'unresolved',
    )
  ) {
    return { panelVerdict: 'block', reason: 'voter-impact unresolved block finding' }
  }
  // Step 3: voter-impact fix-first
  if (
    findings.some(
      (f) =>
        f.authorityImpact === 'voter' &&
        f.severity === 'fix-first' &&
        f.roundResolved === 'unresolved',
    )
  ) {
    return {
      panelVerdict: 'needs-revision',
      reason: 'voter-impact unresolved fix-first finding',
    }
  }
  // Step 4: quorum count
  if (eligibleVoters.length !== 2) {
    return {
      panelVerdict: 'needs-revision',
      reason: `cross-family quorum NOT met: required exactly 2 eligible voters, got ${eligibleVoters.length}`,
    }
  }
  // Step 5: voter score + verdict
  const failedVoter = eligibleVoters.find((v) => v.score < REVIEW_SCORE_MIN || v.verdict !== 'ready')
  if (failedVoter !== undefined) {
    return {
      panelVerdict: 'needs-revision',
      reason: `eligible voter '${failedVoter.id}' not ready (score=${failedVoter.score} verdict=${failedVoter.verdict})`,
    }
  }
  // Step 6: ready
  return {
    panelVerdict: 'ready',
    reason: `cross-family quorum reached: 2 of 2 voters from {${eligibleVoters.map((v) => v.providerFamily).join(', ')}}`,
  }
}
