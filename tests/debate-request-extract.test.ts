// Pure unit tests for `<debate-request>` block extraction.
//
// Covers:
//   - happy path (single block; trailing prose captured)
//   - terminal-directive (D1): trailing prose is captured as discarded draft
//   - multiple blocks (D2): kind=multiple
//   - missing/invalid required keys: kind=parse-error
//   - sections required H2 keys all enforced
//   - status defaults to 'thesis'; cycle defaults to 'plan'
//   - files: [] is valid; missing files key is parse-error

import { describe, test, expect } from 'bun:test'
import { extractDebateRequest } from '../src/tools/debate-request-extract.ts'

const MINIMAL_BLOCK_BODY = `
topic: plan-source-priority
opposingProvider: codex
question: Should Anthropic docs always win?
files: []
sections:
  whatYouAreReading: Cross-family debate on docs precedence.
  whereWeStand: M10 in progress.
  whatIsLocked: Rules 7 and 9.
  whatIsUpForDebate: Strict-priority vs per-feature override.
  recommendedPath: Anthropic > OpenAI.
  decisionPrompts: 1. Verdict?
  whatIWantFromYou: Verdict + risks.
`

function wrap(inner: string, before = '', after = ''): string {
  return `${before}<debate-request>${inner}</debate-request>${after}`
}

describe('extractDebateRequest — happy path', () => {
  test('parses a minimal valid block', () => {
    const r = extractDebateRequest(wrap(MINIMAL_BLOCK_BODY))
    expect(r.kind).toBe('one')
    if (r.kind === 'one') {
      expect(r.block.topic).toBe('plan-source-priority')
      expect(r.block.opposingProvider).toBe('codex')
      expect(r.block.question).toBe('Should Anthropic docs always win?')
      expect(r.block.files).toEqual([])
      expect(r.block.status).toBe('thesis')
      expect(r.block.cycle).toBe('plan')
      expect(r.block.target).toBe('codex default')
      expect(r.block.briefingSections.whatYouAreReading).toContain('docs precedence')
      expect(r.block.briefingSections.whatIWantFromYou).toContain('Verdict + risks')
      expect(r.block.trailingDraft).toBe('')
    }
  })

  test('accepts files as strings', () => {
    const body = MINIMAL_BLOCK_BODY.replace(
      'files: []',
      `files:\n  - docs/contracts/PLAN.md\n  - docs/contracts/SOURCE_CHECK.md`,
    )
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('one')
    if (r.kind === 'one') {
      expect(r.block.files).toEqual([
        { path: 'docs/contracts/PLAN.md' },
        { path: 'docs/contracts/SOURCE_CHECK.md' },
      ])
    }
  })

  test('accepts files as { path } objects', () => {
    const body = MINIMAL_BLOCK_BODY.replace(
      'files: []',
      `files:\n  - { path: "src/x.ts" }`,
    )
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('one')
    if (r.kind === 'one') {
      expect(r.block.files).toEqual([{ path: 'src/x.ts' }])
    }
  })

  test('overrides status, cycle, and target when present', () => {
    const body = MINIMAL_BLOCK_BODY + 'status: implementation\ncycle: build\ntarget: gpt-5.5 high\n'
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('one')
    if (r.kind === 'one') {
      expect(r.block.status).toBe('implementation')
      expect(r.block.cycle).toBe('build')
      expect(r.block.target).toBe('gpt-5.5 high')
    }
  })
})

describe('extractDebateRequest — terminal directive (D1)', () => {
  test('captures trailing prose as trailingDraft', () => {
    const r = extractDebateRequest(
      wrap(MINIMAL_BLOCK_BODY, 'I think we need a debate here.\n\n', '\n\n# PLAN\n\nthis was authored before debate.\n'),
    )
    expect(r.kind).toBe('one')
    if (r.kind === 'one') {
      expect(r.block.trailingDraft).toContain('# PLAN')
      expect(r.block.trailingDraft).toContain('authored before debate')
    }
  })

  test('returns kind=none when no block is present', () => {
    const r = extractDebateRequest('# PLAN\n\nno debate request here.\n')
    expect(r.kind).toBe('none')
  })
})

describe('extractDebateRequest — multiple blocks (D2 fail-fast)', () => {
  test('returns kind=multiple when two blocks are present', () => {
    const r = extractDebateRequest(wrap(MINIMAL_BLOCK_BODY) + '\n' + wrap(MINIMAL_BLOCK_BODY))
    expect(r.kind).toBe('multiple')
    if (r.kind === 'multiple') expect(r.count).toBe(2)
  })
})

describe('extractDebateRequest — parse errors', () => {
  test('rejects unbalanced tags (open without close)', () => {
    const r = extractDebateRequest(`<debate-request>\ntopic: x\n`)
    expect(r.kind).toBe('parse-error')
  })

  test('rejects close tag before open tag', () => {
    const r = extractDebateRequest(`</debate-request>\n<debate-request>${MINIMAL_BLOCK_BODY}`)
    // open count = 1, close count = 1, but close < open
    expect(r.kind).toBe('parse-error')
  })

  test('rejects malformed YAML', () => {
    const r = extractDebateRequest(wrap('topic: : :\nfiles: ['))
    expect(r.kind).toBe('parse-error')
  })

  test('rejects scalar (non-mapping) body', () => {
    const r = extractDebateRequest(wrap('just a string'))
    expect(r.kind).toBe('parse-error')
  })

  test('rejects missing topic', () => {
    const body = MINIMAL_BLOCK_BODY.replace('topic: plan-source-priority\n', '')
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('topic')
  })

  test('rejects topic that is not lowercase-kebab', () => {
    const body = MINIMAL_BLOCK_BODY.replace(
      'topic: plan-source-priority',
      'topic: PlanSourcePriority',
    )
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('lowercase-kebab-case')
  })

  test('rejects topic > 48 chars', () => {
    const longTopic = 'a'.repeat(49)
    const body = MINIMAL_BLOCK_BODY.replace('topic: plan-source-priority', `topic: ${longTopic}`)
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('1..48 characters')
  })

  test('rejects missing opposingProvider', () => {
    const body = MINIMAL_BLOCK_BODY.replace('opposingProvider: codex\n', '')
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('opposingProvider')
  })

  test('rejects missing question', () => {
    const body = MINIMAL_BLOCK_BODY.replace('question: Should Anthropic docs always win?\n', '')
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('question')
  })

  test('rejects missing files key (D2: required)', () => {
    const body = MINIMAL_BLOCK_BODY.replace('files: []\n', '')
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('files')
  })

  test('rejects files entry that is neither string nor { path }', () => {
    const body = MINIMAL_BLOCK_BODY.replace('files: []', `files:\n  - 42`)
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('files[0]')
  })

  test('rejects missing sections', () => {
    const body = MINIMAL_BLOCK_BODY.split('sections:')[0]!
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('sections')
  })

  test.each([
    'whatYouAreReading',
    'whereWeStand',
    'whatIsLocked',
    'whatIsUpForDebate',
    'recommendedPath',
    'decisionPrompts',
    'whatIWantFromYou',
  ] as const)('rejects missing sections.%s', (key) => {
    const lineRe = new RegExp(`  ${key}:.*\\n`)
    const body = MINIMAL_BLOCK_BODY.replace(lineRe, '')
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain(`sections.${key}`)
  })

  test('rejects invalid status enum', () => {
    const body = MINIMAL_BLOCK_BODY + 'status: bogus\n'
    const r = extractDebateRequest(wrap(body))
    expect(r.kind).toBe('parse-error')
    if (r.kind === 'parse-error') expect(r.detail).toContain('status')
  })
})
