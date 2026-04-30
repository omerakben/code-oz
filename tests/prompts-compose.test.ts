import { describe, test, expect } from 'bun:test'
import {
  composeDefinePromptPure,
  composeDefinePrompt,
  loadDefineSystemTemplate,
  loadCommonRationalizations,
  renderConversation,
  _resetPromptAssetCache,
  type AskMeTurn,
} from '../src/prompts/index.ts'

const READY = '<spec-ready/>'

const TEMPLATE = `# DEFINE protocol

## Persona
{{AGENT_BODY}}

## Rules
{{COMMON_RATIONALIZATIONS}}

## Ready signal
Emit \`{{READY_SIGNAL}}\` alone on a line.

## Conversation
{{CONVERSATION}}

End.
`

describe('renderConversation', () => {
  test('renders empty history as a placeholder', () => {
    expect(renderConversation([])).toBe('(no conversation yet)')
  })

  test('numbers user turns and ba turns independently', () => {
    const history: AskMeTurn[] = [
      { role: 'user', text: 'I want a thing.' },
      { role: 'ba', text: 'What kind of thing?' },
      { role: 'user', text: 'A small one.' },
      { role: 'ba', text: 'How small?' },
    ]
    const out = renderConversation(history)
    expect(out).toContain('### user (turn 0)')
    expect(out).toContain('### ba (turn 0)')
    expect(out).toContain('### user (turn 1)')
    expect(out).toContain('### ba (turn 1)')
    expect(out).toContain('I want a thing.')
    expect(out).toContain('What kind of thing?')
  })

  test('uses H3 (not H2) so the turn delimiters are line-anchored H3', () => {
    const history: AskMeTurn[] = [
      { role: 'user', text: 'help' },
      { role: 'ba', text: '## Goals' }, // BA echoing a SPEC heading
    ]
    const out = renderConversation(history)
    expect(out).toContain('### ba (turn 0)')
    // The user's H2 echo survives unchanged — the renderer doesn't sanitize
    // turn content.
    expect(out).toContain('## Goals')
    // The turn delimiter lines themselves never start with H2:
    const lines = out.split('\n')
    const h2TurnLines = lines.filter(
      (l) => l.startsWith('## user (') || l.startsWith('## ba ('),
    )
    expect(h2TurnLines.length).toBe(0)
  })

  test('trims surrounding whitespace per turn', () => {
    const history: AskMeTurn[] = [
      { role: 'user', text: '   hello\n\n  ' },
    ]
    const out = renderConversation(history)
    // The trimmed text appears as a line of its own, with no leading spaces
    // and no trailing blank lines from the original input.
    expect(out.split('\n').includes('hello')).toBe(true)
    expect(out.split('\n').includes('   hello')).toBe(false)
    expect(out.split('\n').includes('  ')).toBe(false)
  })

  test('does not end with trailing blank line bloat', () => {
    const history: AskMeTurn[] = [
      { role: 'user', text: 'one' },
      { role: 'ba', text: 'two' },
    ]
    const out = renderConversation(history)
    expect(out.endsWith('\n\n')).toBe(false)
    expect(out.endsWith('two')).toBe(true)
  })
})

describe('composeDefinePromptPure', () => {
  test('substitutes all four tokens', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: '## Rationalizations table',
      agentBody: '## BA identity\n\nyou are.',
      history: [{ role: 'user', text: 'go' }],
      readySignal: READY,
    })
    expect(out).toContain('## BA identity')
    expect(out).toContain('## Rationalizations table')
    expect(out).toContain('<spec-ready/>')
    expect(out).toContain('### user (turn 0)')
    // Verify no token literal survives substitution.
    expect(out).not.toContain('{{AGENT_BODY}}')
    expect(out).not.toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(out).not.toContain('{{READY_SIGNAL}}')
    expect(out).not.toContain('{{CONVERSATION}}')
  })

  test('trims leading/trailing whitespace on agent body and rationalizations', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: '\n\n  table  \n\n',
      agentBody: '\n\nidentity\n\n',
      history: [],
      readySignal: READY,
    })
    expect(out).toContain('## Persona\nidentity')
    expect(out).not.toContain('## Persona\n\n\nidentity')
  })

  test('substitutes the readySignal literally (preserves angle brackets)', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: 't',
      agentBody: 'b',
      history: [],
      readySignal: '[CUSTOM_TOKEN]',
    })
    expect(out).toContain('Emit `[CUSTOM_TOKEN]`')
    expect(out).not.toContain('<spec-ready/>')
  })

  test('throws if a required token is missing from the template', () => {
    const broken = TEMPLATE.replace('{{AGENT_BODY}}', '')
    expect(() =>
      composeDefinePromptPure({
        templateBody: broken,
        commonRationalizations: 't',
        agentBody: 'b',
        history: [],
        readySignal: READY,
      }),
    ).toThrow(/AGENT_BODY/)
  })

  test('handles empty history with the placeholder string', () => {
    const out = composeDefinePromptPure({
      templateBody: TEMPLATE,
      commonRationalizations: 't',
      agentBody: 'b',
      history: [],
      readySignal: READY,
    })
    expect(out).toContain('(no conversation yet)')
  })

  test('substitutes multi-occurrence tokens (READY_SIGNAL appears twice in the real template)', () => {
    const tmpl = TEMPLATE + '\n\nReminder: emit {{READY_SIGNAL}} again.'
    const out = composeDefinePromptPure({
      templateBody: tmpl,
      commonRationalizations: 't',
      agentBody: 'b',
      history: [],
      readySignal: '<R>',
    })
    expect(out.match(/<R>/g)?.length).toBe(2)
    expect(out).not.toContain('{{READY_SIGNAL}}')
  })
})

describe('bundled prompt asset loaders', () => {
  test('loadDefineSystemTemplate returns the bundled protocol template', async () => {
    _resetPromptAssetCache()
    const text = await loadDefineSystemTemplate()
    expect(text).toContain('# DEFINE phase')
    expect(text).toContain('{{AGENT_BODY}}')
    expect(text).toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(text).toContain('{{READY_SIGNAL}}')
    expect(text).toContain('{{CONVERSATION}}')
  })

  test('loadCommonRationalizations returns the bundled table', async () => {
    _resetPromptAssetCache()
    const text = await loadCommonRationalizations()
    expect(text).toContain('# Common Rationalizations')
    expect(text).toContain('| Rationalization | Reality |')
  })

  test('asset loader caches across calls', async () => {
    _resetPromptAssetCache()
    const a = await loadDefineSystemTemplate()
    const b = await loadDefineSystemTemplate()
    expect(a).toBe(b)
  })
})

describe('composeDefinePrompt (integration)', () => {
  test('composes a real prompt from bundled assets', async () => {
    _resetPromptAssetCache()
    const prompt = await composeDefinePrompt({
      agentBody: '## Persona body\n\nI am the BA.',
      history: [{ role: 'user', text: 'I want a baby naming game' }],
      readySignal: '<spec-ready/>',
    })
    // Real template's outer headings present
    expect(prompt).toContain('# DEFINE phase')
    // Persona injected
    expect(prompt).toContain('I am the BA.')
    // Rationalizations table injected (real bundled content)
    expect(prompt).toContain('| Rationalization | Reality |')
    // Ready signal substituted
    expect(prompt).toContain('<spec-ready/>')
    // Conversation rendered
    expect(prompt).toContain('### user (turn 0)')
    expect(prompt).toContain('I want a baby naming game')
    // No template tokens leaked
    expect(prompt).not.toContain('{{AGENT_BODY}}')
    expect(prompt).not.toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(prompt).not.toContain('{{READY_SIGNAL}}')
    expect(prompt).not.toContain('{{CONVERSATION}}')
  })
})
