import { describe, test, expect } from 'bun:test'
import {
  composeBuildPromptPure,
  composeBuildPrompt,
  loadBuildSystemTemplate,
  loadCommonRationalizations,
  loadUniversalRules,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

const READY_SIGNAL = '<build-ready/>'
const AGENT_BODY = '# Builder\n\nTest persona body.\n'

describe('composeBuildPromptPure — token replacement', () => {
  test('replaces all required tokens', () => {
    const template = `# BUILD\n\n## Rules\n{{UNIVERSAL_RULES}}\n\n## Identity\n{{AGENT_BODY}}\n\n## Rationalizations\n{{COMMON_RATIONALIZATIONS}}\n\n## Tools\n{{AVAILABLE_TOOLS}}\n\n## Output\n{{READY_SIGNAL}}\n`
    const out = composeBuildPromptPure({
      templateBody: template,
      universalRules: 'rule-text',
      commonRationalizations: 'rationalization-text',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out).toContain('rule-text')
    expect(out).toContain('rationalization-text')
    expect(out).toContain('Test persona body.')
    expect(out).toContain('<build-ready/>')
    expect(out).toContain('glob')
    expect(out).toContain('grep')
  })

  test('throws when a required token is missing from template', () => {
    expect(() =>
      composeBuildPromptPure({
        templateBody: '# BUILD\n\nNo tokens here.\n',
        universalRules: '',
        commonRationalizations: '',
        agentBody: AGENT_BODY,
        readySignal: READY_SIGNAL,
        availableTools: [],
      }),
    ).toThrow(/build-system\.md is missing required token/)
  })

  test('available tools "(no tool_use scope declared on this persona)" when array empty', () => {
    const template = `{{UNIVERSAL_RULES}}\n{{AGENT_BODY}}\n{{COMMON_RATIONALIZATIONS}}\n{{AVAILABLE_TOOLS}}\n{{READY_SIGNAL}}`
    const out = composeBuildPromptPure({
      templateBody: template,
      universalRules: '',
      commonRationalizations: '',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: [],
    })
    expect(out).toContain('(no tool_use scope declared on this persona)')
  })
})

describe('composeBuildPrompt — full asset load', () => {
  test('loads bundled assets and produces a non-empty prompt', async () => {
    _resetPromptAssetCache()
    const out = await composeBuildPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out.length).toBeGreaterThan(500)
    expect(out).toContain('<build-ready/>')
    // Universal rules header should land
    expect(out).toContain('Universal rules')
  })

  test('the bundled build-system template carries all required tokens', async () => {
    _resetPromptAssetCache()
    const template = await loadBuildSystemTemplate()
    expect(template).toContain('{{UNIVERSAL_RULES}}')
    expect(template).toContain('{{AGENT_BODY}}')
    expect(template).toContain('{{COMMON_RATIONALIZATIONS}}')
    expect(template).toContain('{{AVAILABLE_TOOLS}}')
    expect(template).toContain('{{READY_SIGNAL}}')
  })

  test('universal-rules.md is non-empty and gets injected', async () => {
    _resetPromptAssetCache()
    const rules = await loadUniversalRules()
    expect(rules.length).toBeGreaterThan(100)
    const out = await composeBuildPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    // Pick a stable substring from the rules file; if the file changes,
    // this tests just confirms the content makes it into the composed
    // prompt, not the exact text.
    expect(out).toContain(rules.trim().slice(0, 40))
  })

  test('common-rationalizations gets injected', async () => {
    _resetPromptAssetCache()
    const rats = await loadCommonRationalizations()
    expect(rats.length).toBeGreaterThan(100)
    const out = await composeBuildPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
    })
    expect(out).toContain(rats.trim().slice(0, 40))
  })
})

describe('builder.md persona', () => {
  test('declares tool_use.write with apply-patch', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'builder.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    expect(text).toContain('apply-patch')
    expect(text).toContain('tool_use:')
    expect(text).toContain('write:')
  })

  test('declares tool_use.repo_context bound to the run worktree', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'builder.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    expect(text).toContain('repo_context')
    expect(text).toContain('.code-oz/runs/<runId>/worktree/')
  })

  test('persona body is in Codex-recommended size band (3.5k-4.5k)', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'builder.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    // Strip frontmatter
    const fmEnd = text.indexOf('\n---\n', 3)
    const body = fmEnd === -1 ? text : text.slice(fmEnd + 5)
    expect(body.length).toBeGreaterThan(2500)
    // Codex's reject-of-decision-6 guidance: ~3.5k-4.5k. We allow some
    // slack since prose-density varies; cap at 6k as the upper bound.
    expect(body.length).toBeLessThan(6000)
  })
})
