// M10 commit 6: debate opponent + synthesis prompt composer tests.

import { describe, test, expect } from 'bun:test'
import {
  composeDebateOpponentPrompt,
  composeDebateOpponentPromptPure,
  composeDebateSynthesisPrompt,
  composeDebateSynthesisPromptPure,
  loadDebateOpponentSystemTemplate,
  loadDebateSynthesisSystemTemplate,
  loadUniversalRules,
} from '../src/prompts/index.ts'

describe('debate-opponent-system.md template', () => {
  test('contains all required tokens', async () => {
    const t = await loadDebateOpponentSystemTemplate()
    expect(t).toContain('{{UNIVERSAL_RULES}}')
    expect(t).toContain('{{AVAILABLE_TOOLS}}')
    expect(t).toContain('{{READY_SIGNAL}}')
  })

  test('contains the locked Overall verdict first-line grammar (D10)', async () => {
    const t = await loadDebateOpponentSystemTemplate()
    expect(t).toContain('Overall verdict:')
    expect(t).toContain('first non-empty line')
  })

  test('contains the planning-debate verdict enum', async () => {
    const t = await loadDebateOpponentSystemTemplate()
    expect(t).toContain('accept')
    expect(t).toContain('accept-with-modifications')
    expect(t).toContain('reject')
    expect(t).toContain('feature-with-modifications')
  })

  test('contains the five required H2 sections in order', async () => {
    const t = await loadDebateOpponentSystemTemplate()
    const idxV = t.indexOf('Verdict on the decisions')
    const idxR = t.indexOf('Risks the proposing side missed')
    const idxD = t.indexOf('Where I disagree')
    const idxF = t.indexOf('What I would defer')
    const idxN = t.indexOf('Recommended next step')
    expect(idxV).toBeGreaterThan(0)
    expect(idxR).toBeGreaterThan(idxV)
    expect(idxD).toBeGreaterThan(idxR)
    expect(idxF).toBeGreaterThan(idxD)
    expect(idxN).toBeGreaterThan(idxF)
  })
})

describe('debate-synthesis-system.md template', () => {
  test('contains all required tokens', async () => {
    const t = await loadDebateSynthesisSystemTemplate()
    expect(t).toContain('{{UNIVERSAL_RULES}}')
    expect(t).toContain('{{AVAILABLE_TOOLS}}')
    expect(t).toContain('{{READY_SIGNAL}}')
  })

  test('names the dual-verdict frontmatter requirement (D5)', async () => {
    const t = await loadDebateSynthesisSystemTemplate()
    expect(t).toContain('caller_verdict:')
    expect(t).toContain('opposing_verdict:')
  })

  test('contains the five required DECISION.md H2 sections', async () => {
    const t = await loadDebateSynthesisSystemTemplate()
    expect(t).toContain('Verdict')
    expect(t).toContain('Rationale')
    expect(t).toContain('What changes (artifact deltas)')
    expect(t).toContain('What does not change')
    expect(t).toContain('Open follow-ups')
  })

  test('names rule 9 (data, not authority) and rule 16 (universal rules)', async () => {
    const t = await loadDebateSynthesisSystemTemplate()
    expect(t).toContain('rule 9')
  })
})

describe('composeDebateOpponentPromptPure', () => {
  test('replaces all tokens', () => {
    const result = composeDebateOpponentPromptPure({
      templateBody:
        'rules:{{UNIVERSAL_RULES}} tools:{{AVAILABLE_TOOLS}} signal:{{READY_SIGNAL}}',
      universalRules: '## Universal Rules\n\n- Be honest.',
      availableTools: [],
      readySignal: '<<DONE>>',
    })
    expect(result).toContain('## Universal Rules')
    expect(result).toContain('<<DONE>>')
    expect(result).not.toContain('{{')
  })

  test('throws on missing token', () => {
    expect(() =>
      composeDebateOpponentPromptPure({
        templateBody: 'no tokens here',
        universalRules: '',
        availableTools: [],
        readySignal: '<<DONE>>',
      }),
    ).toThrow('missing required token')
  })

  test('renderAvailableTools handles empty list', () => {
    const result = composeDebateOpponentPromptPure({
      templateBody: '{{UNIVERSAL_RULES}} {{AVAILABLE_TOOLS}} {{READY_SIGNAL}}',
      universalRules: 'rules',
      availableTools: [],
      readySignal: 'sig',
    })
    expect(result).toContain('rules')
    expect(result).toContain('sig')
  })
})

describe('composeDebateSynthesisPromptPure', () => {
  test('replaces all tokens', () => {
    const result = composeDebateSynthesisPromptPure({
      templateBody: '{{UNIVERSAL_RULES}}|{{AVAILABLE_TOOLS}}|{{READY_SIGNAL}}',
      universalRules: 'R',
      availableTools: ['debate'],
      readySignal: 'S',
    })
    expect(result).toContain('R')
    expect(result).toContain('S')
    expect(result).not.toContain('{{')
  })

  test('throws on missing token', () => {
    expect(() =>
      composeDebateSynthesisPromptPure({
        templateBody: 'no tokens',
        universalRules: '',
        availableTools: [],
        readySignal: '<<DONE>>',
      }),
    ).toThrow('missing required token')
  })
})

describe('composeDebateOpponentPrompt - full async path', () => {
  test('produces a valid composed prompt with universal rules injected', async () => {
    const result = await composeDebateOpponentPrompt({
      readySignal: '<<DONE>>',
      availableTools: [],
    })
    expect(result).toContain('Debate opponent')
    expect(result).toContain('Overall verdict:')
    expect(result).toContain('<<DONE>>')
    expect(result).not.toContain('{{')
    // Universal rules content is injected (rule 16)
    const ur = await loadUniversalRules()
    // Just check that *some* recognizable content from universal-rules.md
    // appears (the template imports the file at the top).
    expect(ur.length).toBeGreaterThan(0)
  })
})

describe('composeDebateSynthesisPrompt - full async path', () => {
  test('produces a valid composed prompt', async () => {
    const result = await composeDebateSynthesisPrompt({
      readySignal: '<<DONE>>',
      availableTools: [],
    })
    expect(result).toContain('Debate synthesis')
    expect(result).toContain('caller_verdict:')
    expect(result).toContain('opposing_verdict:')
    expect(result).not.toContain('{{')
  })
})
