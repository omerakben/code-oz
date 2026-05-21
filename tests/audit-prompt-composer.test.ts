import { describe, test, expect } from 'bun:test'
import {
  composeAuditPromptPure,
  composeAuditPrompt,
  loadAuditSystemTemplate,
  loadUniversalRules,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

// M17 C4 — AUDIT prompt composer machinery.
//
// The rule-16 invariant under test: the universal anti-slop rules are injected
// BEFORE the persona body at composition time. A persona body can add rules
// below the universal sheet but can never relax or precede it. We assert this
// structurally with FIXTURE strings (NOT the real, human-co-authored auditor
// prose, which does not exist yet — src/agents/defaults/auditor.md is deferred
// to the human co-authoring step per rule 16).

const READY_SIGNAL = '<audit-ready/>'
// A sentinel persona body. NOT real auditor methodology prose — a fixture.
const AGENT_BODY = '# Auditor (fixture)\n\nFIXTURE_PERSONA_BODY_SENTINEL.\n'
const UNIVERSAL_RULES_SENTINEL = 'UNIVERSAL_RULES_SENTINEL_TEXT'

describe('composeAuditPromptPure — token replacement', () => {
  test('replaces all required tokens', () => {
    const template = `# AUDIT\n\n## Rules\n{{UNIVERSAL_RULES}}\n\n## Identity\n{{AGENT_BODY}}\n\n## Rationalizations\n{{COMMON_RATIONALIZATIONS}}\n\n## Tools\n{{AVAILABLE_TOOLS}}\n\n## Output\n{{READY_SIGNAL}}\n`
    const out = composeAuditPromptPure({
      templateBody: template,
      universalRules: UNIVERSAL_RULES_SENTINEL,
      commonRationalizations: 'rationalization-text',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out).toContain(UNIVERSAL_RULES_SENTINEL)
    expect(out).toContain('rationalization-text')
    expect(out).toContain('FIXTURE_PERSONA_BODY_SENTINEL')
    expect(out).toContain('<audit-ready/>')
    expect(out).toContain('grep')
  })

  test('throws when a required token is missing from template', () => {
    expect(() =>
      composeAuditPromptPure({
        templateBody: '# AUDIT\n\nNo tokens here.\n',
        universalRules: UNIVERSAL_RULES_SENTINEL,
        commonRationalizations: '',
        agentBody: AGENT_BODY,
        readySignal: READY_SIGNAL,
        availableTools: [],
      }),
    ).toThrow(/audit-system\.md is missing required token/)
  })

  test('available tools placeholder when array empty', () => {
    const template = `{{UNIVERSAL_RULES}}\n{{AGENT_BODY}}\n{{COMMON_RATIONALIZATIONS}}\n{{AVAILABLE_TOOLS}}\n{{READY_SIGNAL}}`
    const out = composeAuditPromptPure({
      templateBody: template,
      universalRules: UNIVERSAL_RULES_SENTINEL,
      commonRationalizations: '',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: [],
    })
    expect(out).toContain('(no tool_use scope declared on this persona)')
  })
})

describe('composeAuditPromptPure — rule-16 invariant (universal rules first)', () => {
  test('universal rules appear BEFORE the persona body in the composed output', () => {
    // Template intentionally orders {{UNIVERSAL_RULES}} ahead of
    // {{AGENT_BODY}} — the bundled audit-system.md does the same. The composer
    // must preserve that ordering so the persona body can never precede or
    // relax the universal sheet (rule 16).
    const template = `## Universal rules\n{{UNIVERSAL_RULES}}\n\n## Identity\n{{AGENT_BODY}}\n\n{{COMMON_RATIONALIZATIONS}}\n{{AVAILABLE_TOOLS}}\n{{READY_SIGNAL}}`
    const out = composeAuditPromptPure({
      templateBody: template,
      universalRules: UNIVERSAL_RULES_SENTINEL,
      commonRationalizations: 'rats',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['read'],
    })
    const rulesIdx = out.indexOf(UNIVERSAL_RULES_SENTINEL)
    const bodyIdx = out.indexOf('FIXTURE_PERSONA_BODY_SENTINEL')
    expect(rulesIdx).toBeGreaterThanOrEqual(0)
    expect(bodyIdx).toBeGreaterThanOrEqual(0)
    expect(rulesIdx).toBeLessThan(bodyIdx)
  })
})

describe('composeAuditPrompt — full asset load (against the placeholder stub)', () => {
  test('loads bundled assets; universal rules precede the persona body', async () => {
    _resetPromptAssetCache()
    const rules = await loadUniversalRules()
    expect(rules.length).toBeGreaterThan(100)
    const out = await composeAuditPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out.length).toBeGreaterThan(200)
    expect(out).toContain('<audit-ready/>')
    // The real universal-rules content precedes the fixture persona body in
    // the composed prompt loaded from the bundled (placeholder) audit-system.md.
    const rulesIdx = out.indexOf(rules.trim().slice(0, 40))
    const bodyIdx = out.indexOf('FIXTURE_PERSONA_BODY_SENTINEL')
    expect(rulesIdx).toBeGreaterThanOrEqual(0)
    expect(bodyIdx).toBeGreaterThanOrEqual(0)
    expect(rulesIdx).toBeLessThan(bodyIdx)
  })

  test('the bundled audit-system template carries all required tokens', async () => {
    _resetPromptAssetCache()
    const template = await loadAuditSystemTemplate()
    expect(template).toContain('{{UNIVERSAL_RULES}}')
    expect(template).toContain('{{AGENT_BODY}}')
    expect(template).toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(template).toContain('{{AVAILABLE_TOOLS}}')
    expect(template).toContain('{{READY_SIGNAL}}')
    // The {{UNIVERSAL_RULES}} token must precede {{AGENT_BODY}} in the
    // template so the rule-16 ordering holds after substitution.
    expect(template.indexOf('{{UNIVERSAL_RULES}}')).toBeLessThan(
      template.indexOf('{{AGENT_BODY}}'),
    )
  })

  test('the bundled audit-system.md is the co-authored prose, not the stub (rule 16)', async () => {
    _resetPromptAssetCache()
    const template = await loadAuditSystemTemplate()
    // The co-authored prose has landed (hand-authored by Ozzy + Claude). The
    // placeholder markers must be gone so a stub can never silently ship in
    // place of the real AUDIT system instructions.
    expect(template).not.toContain('PENDING HUMAN CO-AUTHORSHIP')
    expect(template).not.toContain('DO NOT SHIP')
    expect(template).toContain('AUDIT phase — system instructions')
  })
})
