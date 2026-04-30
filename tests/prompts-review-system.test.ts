// M9 commit 5: review-system.md template + compose tests.
//
// Three concerns:
//   1. Compose: every token resolves; output is deterministic; missing
//      token in template throws.
//   2. Tokens: required tokens are present in the bundled template
//      (regression guard against accidental removal).
//   3. Topic-1 content snapshot: tests-first language, five axes,
//      exact false-coverage caveat. SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md
//      Topic 1 pinned these as prompt-only borrows that must survive
//      future edits without regressing.

import { describe, test, expect } from 'bun:test'
import {
  composeReviewPromptPure,
  loadReviewSystemTemplate,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

const VALID_TEMPLATE = `# Test review template

{{UNIVERSAL_RULES}}

{{AGENT_BODY}}

{{COMMON_RATIONALIZATIONS}}

{{AVAILABLE_TOOLS}}

{{REVIEW_CONTEXT}}

{{READY_SIGNAL}}
`

describe('composeReviewPromptPure — happy path', () => {
  test('substitutes every token', () => {
    const out = composeReviewPromptPure({
      templateBody: VALID_TEMPLATE,
      universalRules: 'RULES_HERE',
      commonRationalizations: 'RATIONALIZATIONS_HERE',
      agentBody: 'AGENT_BODY_HERE',
      readySignal: '<review-ready/>',
      availableTools: ['glob', 'grep', 'read'],
      reviewContext: 'CONTEXT_HERE',
    })
    expect(out).toContain('RULES_HERE')
    expect(out).toContain('AGENT_BODY_HERE')
    expect(out).toContain('RATIONALIZATIONS_HERE')
    expect(out).toContain('<review-ready/>')
    expect(out).toContain('CONTEXT_HERE')
    // No raw tokens remain after substitution.
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  test('renders availableTools list (glob/grep/read)', () => {
    const out = composeReviewPromptPure({
      templateBody: VALID_TEMPLATE,
      universalRules: '',
      commonRationalizations: '',
      agentBody: '',
      readySignal: '<review-ready/>',
      availableTools: ['glob', 'grep', 'read'],
      reviewContext: '',
    })
    expect(out).toContain('**glob**')
    expect(out).toContain('**grep**')
    expect(out).toContain('**read**')
  })

  test('handles empty availableTools (declares no scope)', () => {
    const out = composeReviewPromptPure({
      templateBody: VALID_TEMPLATE,
      universalRules: '',
      commonRationalizations: '',
      agentBody: '',
      readySignal: '<review-ready/>',
      availableTools: [],
      reviewContext: '',
    })
    expect(out).toContain('(no tool_use scope declared on this persona)')
  })

  test('output is deterministic (same input → same bytes)', () => {
    const args = {
      templateBody: VALID_TEMPLATE,
      universalRules: 'r',
      commonRationalizations: 'c',
      agentBody: 'a',
      readySignal: 's',
      availableTools: ['glob'],
      reviewContext: 'ctx',
    }
    expect(composeReviewPromptPure(args)).toBe(composeReviewPromptPure(args))
  })
})

describe('composeReviewPromptPure — missing tokens fail loudly', () => {
  test('rejects template missing {{REVIEW_CONTEXT}}', () => {
    const broken = VALID_TEMPLATE.replace('{{REVIEW_CONTEXT}}', '')
    expect(() =>
      composeReviewPromptPure({
        templateBody: broken,
        universalRules: '',
        commonRationalizations: '',
        agentBody: '',
        readySignal: '',
        availableTools: [],
        reviewContext: '',
      }),
    ).toThrow(/REVIEW_CONTEXT/)
  })

  test('rejects template missing {{UNIVERSAL_RULES}}', () => {
    const broken = VALID_TEMPLATE.replace('{{UNIVERSAL_RULES}}', '')
    expect(() =>
      composeReviewPromptPure({
        templateBody: broken,
        universalRules: '',
        commonRationalizations: '',
        agentBody: '',
        readySignal: '',
        availableTools: [],
        reviewContext: '',
      }),
    ).toThrow(/UNIVERSAL_RULES/)
  })

  test('rejects template missing {{AGENT_BODY}}', () => {
    const broken = VALID_TEMPLATE.replace('{{AGENT_BODY}}', '')
    expect(() =>
      composeReviewPromptPure({
        templateBody: broken,
        universalRules: '',
        commonRationalizations: '',
        agentBody: '',
        readySignal: '',
        availableTools: [],
        reviewContext: '',
      }),
    ).toThrow(/AGENT_BODY/)
  })

  test('rejects template missing {{READY_SIGNAL}}', () => {
    const broken = VALID_TEMPLATE.replace('{{READY_SIGNAL}}', '')
    expect(() =>
      composeReviewPromptPure({
        templateBody: broken,
        universalRules: '',
        commonRationalizations: '',
        agentBody: '',
        readySignal: '',
        availableTools: [],
        reviewContext: '',
      }),
    ).toThrow(/READY_SIGNAL/)
  })
})

describe('Bundled review-system.md — required tokens', () => {
  test('contains every required token', async () => {
    _resetPromptAssetCache()
    const text = await loadReviewSystemTemplate()
    expect(text).toContain('{{UNIVERSAL_RULES}}')
    expect(text).toContain('{{AGENT_BODY}}')
    expect(text).toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(text).toContain('{{AVAILABLE_TOOLS}}')
    expect(text).toContain('{{REVIEW_CONTEXT}}')
    expect(text).toContain('{{READY_SIGNAL}}')
  })
})

describe('Bundled review-system.md — Topic-1 content snapshot', () => {
  // SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md Topic 1 locked these
  // as prompt-only borrows from agent-skills (clean-room paraphrase).
  // Future edits to review-system.md must NOT regress these contents.

  test('contains "review tests first" ordering language', async () => {
    const text = await loadReviewSystemTemplate()
    expect(text.toLowerCase()).toContain('review tests first')
    // Specific instruction: read tests BEFORE implementation.
    expect(text.toLowerCase()).toMatch(/before judging the implementation, read the tests/)
  })

  test('contains all five axes by name (correctness, readability, architecture, security, performance)', async () => {
    const text = await loadReviewSystemTemplate()
    const lowered = text.toLowerCase()
    for (const axis of ['correctness', 'readability', 'architecture', 'security', 'performance']) {
      expect(lowered).toContain(axis)
    }
  })

  test('contains exact false-coverage caveat about the security axis', async () => {
    const text = await loadReviewSystemTemplate()
    // SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md "Where Codex pushed
    // harder than Claude" pinned this exact wording.
    expect(text).toContain(
      'security axis flags surface-level concerns',
    )
    expect(text).toContain('full security audit is W4 SHIP scope')
  })

  test('contains the M9-commit-1 strict fix-first lock language', async () => {
    const text = await loadReviewSystemTemplate()
    expect(text).toMatch(/fix-first.*must clear before.*ready.*exit/i)
  })

  test('names the canonical verdict rule (orchestrator-owned, not persona-owned)', async () => {
    const text = await loadReviewSystemTemplate()
    expect(text).toMatch(/orchestrator-computed.*canonical verdict rule/i)
    // The persona must NOT author Final verdict.
    expect(text).toMatch(/You do NOT author this value/)
  })

  test('lists the four severity values as a locked enum', async () => {
    const text = await loadReviewSystemTemplate()
    expect(text).toContain('block | fix-first | nit | fyi')
  })

  test('declares deleted-file findings rejected (M9 lock)', async () => {
    const text = await loadReviewSystemTemplate()
    expect(text.toLowerCase()).toContain('deleted-file findings are rejected')
  })

  test('contains at least one needs-revision example AND one ready example', async () => {
    const text = await loadReviewSystemTemplate()
    // The full example fences with `Final score: <num>` lines.
    expect(text).toMatch(/Final score:\s*5/)
    expect(text).toMatch(/Final score:\s*8/)
    // Ready example also shows `- None.`
    expect(text).toMatch(/## Findings\s*\n\s*\n\s*- None\./)
  })

  test('inline rebuttals include "Tests passed", "Five axes covered", "small diff" anti-patterns', async () => {
    const text = await loadReviewSystemTemplate()
    // SYNTHESIS Topic 1: 2-3 inline rebuttals.
    expect(text).toContain('Tests passed, so the patch is correct')
    expect(text).toContain('Five axes covered; therefore review is complete')
    expect(text).toContain('small and looks fine')
  })
})
