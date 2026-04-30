import { describe, test, expect } from 'bun:test'
import {
  loadUniversalRules,
  composeDefinePromptPure,
  composeDefinePrompt,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

const TEMPLATE = `# Persona

{{AGENT_BODY}}

## Common rationalizations

{{COMMON_RATIONALIZATIONS}}

## Conversation

{{CONVERSATION}}

End with: {{READY_SIGNAL}}.
`

const TEMPLATE_WITH_RULES_TOKEN = `# Persona

{{UNIVERSAL_RULES}}

{{AGENT_BODY}}

## Common rationalizations

{{COMMON_RATIONALIZATIONS}}

## Conversation

{{CONVERSATION}}

End with: {{READY_SIGNAL}}.
`

describe('loadUniversalRules', () => {
  test('returns the bundled rule sheet', async () => {
    _resetPromptAssetCache()
    const rules = await loadUniversalRules()
    expect(rules).toContain('code-oz universal rules')
    expect(rules).toContain('You will not')
    expect(rules).toContain('You will:')
    // 20-item discipline (10 prohibitions + 10 affirmations)
    expect(rules).toContain('1. Claim a fact')
    expect(rules).toContain('10. Mark a task complete')
    expect(rules).toContain('1. Restate the top three acceptance criteria')
    expect(rules).toContain('10. Say "unverified"')
  })
})

describe('composeDefinePromptPure — rules injection', () => {
  test('prepends universal rules to AGENT_BODY when template has no UNIVERSAL_RULES token (M5 transitional)', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: 'rats',
      agentBody: '## BA persona\nask',
      history: [],
      readySignal: '<spec-ready/>',
      universalRules: 'RULES_HERE',
    })
    expect(out).toContain('RULES_HERE')
    // The rules block appears before the persona body inside the agent-body slot.
    expect(out.indexOf('RULES_HERE')).toBeLessThan(out.indexOf('## BA persona'))
  })

  test('honors {{UNIVERSAL_RULES}} token when present in template', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE_WITH_RULES_TOKEN,
      commonRationalizations: 'rats',
      agentBody: '## BA persona\nask',
      history: [],
      readySignal: '<spec-ready/>',
      universalRules: 'RULES_HERE',
    })
    expect(out).toContain('RULES_HERE')
    // The rules appear in their own slot, NOT inside the agent body
    expect(out).not.toContain('Universal rules (apply to every persona)')
  })

  test('omits the rules section when universalRules is undefined or empty', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: 'rats',
      agentBody: '## BA persona\nask',
      history: [],
      readySignal: '<spec-ready/>',
    })
    expect(out).not.toContain('Universal rules (apply to every persona)')
  })
})

describe('composeDefinePrompt (integration with bundled assets)', () => {
  test('injects the bundled universal rules into the BA prompt automatically', async () => {
    _resetPromptAssetCache()
    const out = await composeDefinePrompt({
      agentBody: '## BA persona\nask',
      history: [],
      readySignal: '<spec-ready/>',
    })
    // The 20-item rule sheet is now part of every composed BA prompt.
    expect(out).toContain('code-oz universal rules')
    expect(out).toContain('You will not')
  })

  test('does not break the M5 BA SPEC.md output (the rule injection is read-only context)', async () => {
    // Smoke-check: the prompt is composable and contains the BA body and the
    // rules sheet. The actual SPEC.md fixture round-trip is covered by
    // tests/define-fixture.test.ts (still passing in the full suite).
    _resetPromptAssetCache()
    const out = await composeDefinePrompt({
      agentBody: '## BA persona\nask',
      history: [],
      readySignal: '<spec-ready/>',
    })
    expect(out.length).toBeGreaterThan(500)
    expect(out).toContain('## BA persona')
  })
})
