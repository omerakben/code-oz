import { describe, test, expect } from 'bun:test'
import {
  composePlanPromptPure,
  composePlanPrompt,
  loadPlanSystemTemplate,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

const TEMPLATE = `# PLAN

{{UNIVERSAL_RULES}}

{{AGENT_BODY}}

{{COMMON_RATIONALIZATIONS}}

{{AVAILABLE_TOOLS}}

Ready: {{READY_SIGNAL}}

Conv: {{CONVERSATION}}
`

describe('composePlanPromptPure — token validation', () => {
  test('throws when a required token is missing', () => {
    expect(() =>
      composePlanPromptPure({
        templateBody: '# only AGENT_BODY: {{AGENT_BODY}}',
        universalRules: 'r',
        commonRationalizations: 'c',
        agentBody: 'a',
        history: [],
        readySignal: '<plan-ready/>',
        availableTools: [],
      }),
    ).toThrow(/missing required token/)
  })

  test('substitutes all required tokens', () => {
    const out = composePlanPromptPure({
      templateBody: TEMPLATE,
      universalRules: 'RULES',
      commonRationalizations: 'RATS',
      agentBody: 'BODY',
      history: [],
      readySignal: '<plan-ready/>',
      availableTools: [],
    })
    expect(out).toContain('RULES')
    expect(out).toContain('BODY')
    expect(out).toContain('RATS')
    expect(out).toContain('<plan-ready/>')
    expect(out).toContain('(no tool_use scope declared on this persona)')
  })
})

describe('composePlanPromptPure — AVAILABLE_TOOLS rendering', () => {
  test('renders glob, grep, read with descriptions', () => {
    const out = composePlanPromptPure({
      templateBody: TEMPLATE,
      universalRules: 'r',
      commonRationalizations: 'c',
      agentBody: 'a',
      history: [],
      readySignal: '<plan-ready/>',
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out).toContain('**glob**')
    expect(out).toContain('**grep**')
    expect(out).toContain('**read**')
  })

  test('only renders tools the agent actually has permission to call (M6 Codex point 5)', () => {
    // Symbol is reserved but not yet permitted; it is rendered when listed.
    // The discipline: composer renders ONLY what the caller passes in.
    // The caller passes from agent.permissions.tool_use.repo_context.tools.
    const out = composePlanPromptPure({
      templateBody: TEMPLATE,
      universalRules: 'r',
      commonRationalizations: 'c',
      agentBody: 'a',
      history: [],
      readySignal: '<plan-ready/>',
      availableTools: ['glob'],
    })
    expect(out).toContain('**glob**')
    expect(out).not.toContain('**grep**')
    expect(out).not.toContain('**read**')
  })

  test('describes a tool name with no registered description as `(no description registered)`', () => {
    const out = composePlanPromptPure({
      templateBody: TEMPLATE,
      universalRules: 'r',
      commonRationalizations: 'c',
      agentBody: 'a',
      history: [],
      readySignal: '<plan-ready/>',
      availableTools: ['mystery'],
    })
    expect(out).toContain('**mystery**')
    expect(out).toContain('(no description registered)')
  })
})

describe('composePlanPrompt (integration)', () => {
  test('loads the bundled plan-system.md asset', async () => {
    _resetPromptAssetCache()
    const tpl = await loadPlanSystemTemplate()
    expect(tpl).toContain('# PLAN phase')
    expect(tpl).toContain('{{UNIVERSAL_RULES}}')
    expect(tpl).toContain('{{AVAILABLE_TOOLS}}')
  })

  test('composes a full PLAN prompt with bundled rules + rationalizations', async () => {
    _resetPromptAssetCache()
    const out = await composePlanPrompt({
      agentBody: '# Tech Lead\n\nbody',
      history: [],
      readySignal: '<plan-ready/>',
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out).toContain('PLAN phase')
    expect(out).toContain('code-oz universal rules')
    expect(out).toContain('# Tech Lead')
    expect(out).toContain('**glob**')
  })
})
