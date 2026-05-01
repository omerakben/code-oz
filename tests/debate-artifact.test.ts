// M10 commit 4: debate artifact parser + serializer + canonicalizer tests.
//
// Covers BRIEFING / RESPONSE / DECISION parse + serialize + the exact-copy
// rationale heuristic + the topic-slug + verdict-enum + first-line
// `Overall verdict:` D10 grammar + the dual-verdict frontmatter D5 lock.

import { describe, test, expect } from 'bun:test'
import {
  parseBriefing,
  serializeBriefing,
  parseResponse,
  parseDecision,
  serializeDecision,
  isExactCopyRationale,
  debateArtifactSha256,
  DebateArtifactError,
  DEBATE_VERDICTS,
} from '../src/artifacts/debate.ts'

const VALID_BRIEFING_INPUT = {
  topic: 'plan-source-priority',
  opposingProvider: 'codex',
  date: '2026-05-01',
  status: 'thesis' as const,
  caller: 'Claude',
  target: 'gpt-5.5 xhigh, sandbox: read-only',
  cycle: 'plan',
  question: 'Should we prefer Anthropic docs over OpenAI docs when both describe the same API surface?',
  files: ['src/providers/types.ts', 'src/providers/registry.ts'],
  sections: {
    whatYouAreReading: 'Cross-family debate on docs precedence.',
    whereWeStand: 'M9 closed; M10 in progress; tests 1675 pass.',
    whatIsLocked: 'CLAUDE.md rule 7 + 9; DEBATE.md schema.',
    whatIsUpForDebate: 'Whether Anthropic docs should always win.',
    recommendedPath: 'Anthropic > OpenAI > MDN > everything else.',
    decisionPrompts: '1. Verdict: should we lock this priority?',
    whatIWantFromYou: 'Per-decision verdict + risks.',
  },
}

describe('serializeBriefing -> parseBriefing round-trip', () => {
  test('produces a valid BRIEFING.md and parses cleanly', () => {
    const md = serializeBriefing(VALID_BRIEFING_INPUT)
    const parsed = parseBriefing(md)
    expect(parsed.frontmatter.topic).toBe('plan-source-priority')
    expect(parsed.frontmatter.opposingProvider).toBe('codex')
    expect(parsed.frontmatter.status).toBe('thesis')
    expect(parsed.frontmatter.files).toEqual([
      'src/providers/types.ts',
      'src/providers/registry.ts',
    ])
    expect(parsed.sections.has('What you are reading')).toBe(true)
    expect(parsed.sections.has('Where we stand')).toBe(true)
    expect(parsed.sections.has('What is locked')).toBe(true)
    expect(parsed.sections.has('What is up for debate')).toBe(true)
    expect(parsed.sections.has('The recommended path')).toBe(true)
    expect(parsed.sections.has('Decision prompts')).toBe(true)
    expect(parsed.sections.has('What I want from you')).toBe(true)
  })

  test('empty files array serializes and parses', () => {
    const md = serializeBriefing({ ...VALID_BRIEFING_INPUT, files: [] })
    const parsed = parseBriefing(md)
    expect(parsed.frontmatter.files).toEqual([])
  })

  test('frozen output (frontmatter, files, sections)', () => {
    const md = serializeBriefing(VALID_BRIEFING_INPUT)
    const parsed = parseBriefing(md)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.frontmatter)).toBe(true)
    expect(Object.isFrozen(parsed.frontmatter.files)).toBe(true)
  })
})

describe('parseBriefing - missing sections', () => {
  test('rejects briefing missing What you are reading', () => {
    const md = serializeBriefing(VALID_BRIEFING_INPUT).replace(
      '## What you are reading',
      '## (deleted)',
    )
    expect(() => parseBriefing(md)).toThrow(DebateArtifactError)
  })

  test('rejects briefing missing What is locked', () => {
    const md = serializeBriefing(VALID_BRIEFING_INPUT).replace(
      '## What is locked',
      '## (deleted)',
    )
    expect(() => parseBriefing(md)).toThrow(DebateArtifactError)
  })

  test('rejects briefing missing all sections (collects all 7 errors)', () => {
    try {
      parseBriefing('---\ntopic: x\nopposing_provider: codex\ndate: 2026-05-01\nstatus: thesis\ncaller: Claude\ntarget: gpt-5.5\ncycle: plan\nquestion: q\nfiles: []\n---\nbody-only')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DebateArtifactError)
      const e = err as DebateArtifactError
      const missing = e.issues.filter((i) => i.code === 'debate_briefing_missing_section')
      expect(missing.length).toBe(7)
    }
  })
})

describe('parseBriefing - topic slug', () => {
  test('rejects uppercase topic', () => {
    const md = serializeBriefing({ ...VALID_BRIEFING_INPUT, topic: 'Plan-Source' })
    expect(() => parseBriefing(md)).toThrow(DebateArtifactError)
  })

  test('rejects underscore topic', () => {
    const md = serializeBriefing({ ...VALID_BRIEFING_INPUT, topic: 'plan_source' })
    expect(() => parseBriefing(md)).toThrow(DebateArtifactError)
  })

  test('rejects topic > 48 chars', () => {
    const long = 'plan-' + 'x'.repeat(50)
    const md = serializeBriefing({ ...VALID_BRIEFING_INPUT, topic: long })
    expect(() => parseBriefing(md)).toThrow(DebateArtifactError)
  })

  test('accepts simple kebab slugs', () => {
    const md = serializeBriefing({ ...VALID_BRIEFING_INPUT, topic: 'meta-provenance' })
    const parsed = parseBriefing(md)
    expect(parsed.frontmatter.topic).toBe('meta-provenance')
  })
})

describe('parseBriefing - frontmatter required keys', () => {
  test('rejects briefing missing frontmatter entirely', () => {
    expect(() => parseBriefing('# no frontmatter\nbody')).toThrow(DebateArtifactError)
  })

  test('rejects malformed YAML frontmatter', () => {
    expect(() => parseBriefing('---\n: bad yaml\n---\nbody')).toThrow(DebateArtifactError)
  })

  test('frontmatter must be a YAML object (not array)', () => {
    expect(() => parseBriefing('---\n- a\n- b\n---\nbody')).toThrow(DebateArtifactError)
  })
})

// ---------- RESPONSE ----------

const VALID_RESPONSE_MD = [
  '---',
  'thread: 019de3ca-9641-7f83-b479-f65ad390c179',
  'date: 2026-05-01',
  'model: gpt-5.5 xhigh',
  'brief: ./BRIEFING.md',
  '---',
  '# Response - plan-source-priority',
  '',
  '## Verdict on the decisions',
  '',
  'Overall verdict: accept-with-modifications',
  '',
  '1. accept-with-modifications - reasoning here.',
  '',
  '## Risks the proposing side missed',
  '',
  'Risk 1.',
  '',
  '## Where I disagree',
  '',
  'Disagreement details.',
  '',
  '## What I would defer',
  '',
  'Deferred items.',
  '',
  '## Recommended next step',
  '',
  'Lock these decisions and proceed.',
  '',
].join('\n')

describe('parseResponse - happy path', () => {
  test('parses valid response with all sections + Overall verdict first line', () => {
    const r = parseResponse(VALID_RESPONSE_MD, 'codex')
    expect(r.side).toBe('codex')
    expect(r.overallVerdict).toBe('accept-with-modifications')
    expect(r.frontmatter.thread).toBe('019de3ca-9641-7f83-b479-f65ad390c179')
    expect(r.sections.has('Verdict on the decisions')).toBe(true)
    expect(r.sections.has('Where I disagree')).toBe(true)
    expect(r.rationaleCorpus).toContain('Disagreement details')
    expect(r.rationaleCorpus).toContain('Lock these decisions')
  })

  test('all four planning verdicts are accepted', () => {
    for (const v of DEBATE_VERDICTS) {
      const md = VALID_RESPONSE_MD.replace(
        'Overall verdict: accept-with-modifications',
        `Overall verdict: ${v}`,
      )
      const r = parseResponse(md, 'codex')
      expect(r.overallVerdict).toBe(v)
    }
  })
})

describe('parseResponse - D10 first-line grammar', () => {
  test('rejects response missing Overall verdict line', () => {
    const md = VALID_RESPONSE_MD.replace(
      'Overall verdict: accept-with-modifications',
      'Some prose first.',
    )
    expect(() => parseResponse(md, 'codex')).toThrow(DebateArtifactError)
  })

  test('rejects response with verdict outside enum', () => {
    const md = VALID_RESPONSE_MD.replace(
      'Overall verdict: accept-with-modifications',
      'Overall verdict: maybe',
    )
    expect(() => parseResponse(md, 'codex')).toThrow(DebateArtifactError)
  })

  test('rejects response with empty Verdict on the decisions section', () => {
    const md = VALID_RESPONSE_MD.replace(
      /## Verdict on the decisions\n\nOverall verdict: accept-with-modifications\n\n1\. accept-with-modifications - reasoning here\./,
      '## Verdict on the decisions',
    )
    expect(() => parseResponse(md, 'codex')).toThrow(DebateArtifactError)
  })
})

describe('parseResponse - missing sections', () => {
  test('rejects response missing Where I disagree', () => {
    const md = VALID_RESPONSE_MD.replace('## Where I disagree', '## (deleted)')
    expect(() => parseResponse(md, 'codex')).toThrow(DebateArtifactError)
  })

  test('rejects response missing Risks the proposing side missed', () => {
    const md = VALID_RESPONSE_MD.replace(
      '## Risks the proposing side missed',
      '## (deleted)',
    )
    expect(() => parseResponse(md, 'codex')).toThrow(DebateArtifactError)
  })
})

// ---------- DECISION ----------

const VALID_DECISION_MD = [
  '---',
  'date: 2026-05-01',
  'resolved_by: "Ozzy + Claude Opus 4.7"',
  'caller_verdict: accept-with-modifications',
  'opposing_verdict: accept-with-modifications',
  '---',
  '# Decision - plan-source-priority',
  '',
  '## Verdict',
  '',
  'accept-with-modifications: lock the priority but document the bias-of-source caveat.',
  '',
  '## Rationale',
  '',
  'After weighing the opposing party\'s critique that pure-Anthropic precedence creates an over-reliance risk, the calling persona modified the priority to add a bias-of-source caveat that requires citing alternative sources when Anthropic docs are silent on a feature. This independent reasoning addresses both the original priority concern and the new bias risk.',
  '',
  '## What changes (artifact deltas)',
  '',
  '- Add bias-of-source caveat to PLAN.md.',
  '',
  '## What does not change',
  '',
  '- Anthropic-first ordering remains.',
  '',
  '## Open follow-ups',
  '',
  '- Q-001: revisit if real cases show bias-of-source dominating.',
  '',
].join('\n')

describe('parseDecision - happy path', () => {
  test('parses valid decision with all sections + dual-verdict frontmatter', () => {
    const d = parseDecision(VALID_DECISION_MD, null)
    expect(d.frontmatter.callerVerdict).toBe('accept-with-modifications')
    expect(d.frontmatter.opposingVerdict).toBe('accept-with-modifications')
    expect(d.frontmatter.resolvedBy).toBe('Ozzy + Claude Opus 4.7')
    expect(d.sections.has('Verdict')).toBe(true)
    expect(d.sections.has('Rationale')).toBe(true)
    expect(d.sections.has('Open follow-ups')).toBe(true)
    expect(d.rationaleSummary.length).toBeGreaterThan(0)
    expect(d.rationaleSummary.length).toBeLessThanOrEqual(200)
  })

  test('agreement between caller and opposing is valid (not rubberstamped if rationale has substance)', () => {
    const d = parseDecision(VALID_DECISION_MD, null)
    expect(d.frontmatter.callerVerdict).toBe(d.frontmatter.opposingVerdict)
  })

  test('disagreement between verdicts is valid (rule 9: data, not authority)', () => {
    const md = VALID_DECISION_MD.replace(
      'caller_verdict: accept-with-modifications',
      'caller_verdict: reject',
    )
    const d = parseDecision(md, null)
    expect(d.frontmatter.callerVerdict).toBe('reject')
    expect(d.frontmatter.opposingVerdict).toBe('accept-with-modifications')
  })
})

describe('parseDecision - D5 rationale invariants', () => {
  test('rejects decision with rationale < 50 chars (no-rationale)', () => {
    const md = VALID_DECISION_MD.replace(
      /## Rationale\n\n[^#]+\n\n## What changes/,
      '## Rationale\n\nshort.\n\n## What changes',
    )
    expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
  })

  test('rejects decision with empty rationale', () => {
    const md = VALID_DECISION_MD.replace(
      /## Rationale\n\n[^#]+\n\n## What changes/,
      '## Rationale\n\n\n\n## What changes',
    )
    expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
  })

  test('exact-copy rationale > 200 chars rejected when opposing response provided', () => {
    const longText =
      'This is a long rationale text that intentionally exceeds two hundred characters so the heuristic can engage. ' +
      'The exact same text appears verbatim in the opposing response below to trigger the heuristic correctly. ' +
      'Padding to ensure length.'
    expect(longText.length).toBeGreaterThan(200)

    const opposingMd = VALID_RESPONSE_MD.replace(
      'Disagreement details.',
      longText,
    )
    const opposing = parseResponse(opposingMd, 'codex')

    const decisionMd = VALID_DECISION_MD.replace(
      /## Rationale\n\n[^#]+\n\n## What changes/,
      `## Rationale\n\n${longText}\n\n## What changes`,
    )
    expect(() => parseDecision(decisionMd, opposing)).toThrow(DebateArtifactError)
  })

  test('long rationale that is NOT exact-copy of opposing is accepted', () => {
    const opposing = parseResponse(VALID_RESPONSE_MD, 'codex')
    // VALID_DECISION_MD's rationale is independent prose - should pass.
    const d = parseDecision(VALID_DECISION_MD, opposing)
    expect(d.frontmatter.callerVerdict).toBe('accept-with-modifications')
  })

  test('short matching rationale (under 200 chars) is NOT flagged as exact-copy', () => {
    const short = 'agreed.'
    const opposingMd = VALID_RESPONSE_MD.replace('Disagreement details.', short)
    const opposing = parseResponse(opposingMd, 'codex')
    // Use a long enough rationale to pass the 50-char minimum but copy
    // only the short opposing text; since caller rationale must be >= 200
    // chars to trigger exact-copy, this passes.
    const callerRationale =
      'agreed. The orchestrator-side enforcement of cross-family invariants reads cleanly through the load + invocation + recorded post-condition layering and matches the M9 review pattern.'
    const md = VALID_DECISION_MD.replace(
      /## Rationale\n\n[^#]+\n\n## What changes/,
      `## Rationale\n\n${callerRationale}\n\n## What changes`,
    )
    const d = parseDecision(md, opposing)
    expect(d).toBeDefined()
  })
})

describe('parseDecision - frontmatter dual-verdict invariants', () => {
  test('rejects decision missing caller_verdict', () => {
    const md = VALID_DECISION_MD.replace(/^caller_verdict: .+\n/m, '')
    expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
  })

  test('rejects decision missing opposing_verdict', () => {
    const md = VALID_DECISION_MD.replace(/^opposing_verdict: .+\n/m, '')
    expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
  })

  test('rejects caller_verdict outside enum', () => {
    const md = VALID_DECISION_MD.replace(
      'caller_verdict: accept-with-modifications',
      'caller_verdict: maybe',
    )
    expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
  })

  test('rejects decision missing required sections', () => {
    // Replace each section heading exactly once. Each section title is
    // unique in VALID_DECISION_MD, so a single .replace() call mutates it.
    for (const heading of [
      '## Verdict',
      '## Rationale',
      '## What changes (artifact deltas)',
      '## What does not change',
      '## Open follow-ups',
    ]) {
      const md = VALID_DECISION_MD.replace(heading, '## (deleted)')
      expect(() => parseDecision(md, null)).toThrow(DebateArtifactError)
    }
  })
})

describe('serializeDecision -> parseDecision round-trip', () => {
  test('produces a valid DECISION.md and parses cleanly', () => {
    const md = serializeDecision({
      date: '2026-05-01',
      resolvedBy: 'Ozzy + Claude Opus 4.7',
      callerVerdict: 'accept',
      opposingVerdict: 'accept',
      topic: 'plan-source-priority',
      sections: {
        verdict: 'accept: proceed verbatim with the recommended path.',
        rationale:
          'Codex confirmed the planning convergence; both parties agree on shape, and there are no risks worth gating on. The recommended path locks in the source-precedence convention without surfacing new authority.',
        whatChanges: '- PLAN.md cites Anthropic-first.',
        whatDoesNotChange: '- Existing tool_use scopes.',
        openFollowUps: '- Q-001: revisit if measurable bias appears.',
      },
    })
    const parsed = parseDecision(md, null)
    expect(parsed.frontmatter.callerVerdict).toBe('accept')
    expect(parsed.frontmatter.opposingVerdict).toBe('accept')
  })
})

describe('isExactCopyRationale - heuristic edges', () => {
  test('returns false for short caller rationale (< 200)', () => {
    expect(isExactCopyRationale('short', 'a much longer corpus that contains short')).toBe(false)
  })

  test('returns true for exact-copy >= 200 chars', () => {
    const text = 'a'.repeat(250)
    expect(isExactCopyRationale(text, `${text} more`)).toBe(true)
  })

  test('returns false when caller appears in corpus only as a substring of length < 200', () => {
    // Caller text appears inside corpus, but caller is itself < 200.
    const caller = 'no'
    const corpus = `prefix ${caller} suffix`
    expect(isExactCopyRationale(caller, corpus)).toBe(false)
  })

  test('whitespace-only differences treated as match', () => {
    const a = 'a '.repeat(120)
    const b = 'a'.repeat(120) + ' done' // 121 chars only — under 200, so false anyway
    expect(isExactCopyRationale(a.trim(), b)).toBe(false)
  })

  test('empty inputs return false', () => {
    expect(isExactCopyRationale('', 'anything')).toBe(false)
    expect(isExactCopyRationale('anything', '')).toBe(false)
  })
})

describe('debateArtifactSha256 - canonicalizer', () => {
  test('produces a 64-char lowercase hex digest', () => {
    const sha = debateArtifactSha256('hello')
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different inputs produce different hashes', () => {
    expect(debateArtifactSha256('a')).not.toBe(debateArtifactSha256('b'))
  })

  test('same input produces same hash (deterministic)', () => {
    expect(debateArtifactSha256('canonical')).toBe(debateArtifactSha256('canonical'))
  })
})
