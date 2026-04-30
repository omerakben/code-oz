import { describe, test, expect } from 'bun:test'
import {
  composeVerifyPromptPure,
  composeVerifyPrompt,
  loadVerifySystemTemplate,
  loadCommonRationalizations,
  loadUniversalRules,
  _resetPromptAssetCache,
} from '../src/prompts/index.ts'

const READY_SIGNAL = '<verify-ready/>'
const AGENT_BODY = '# Verifier\n\nTest persona body.\n'

describe('composeVerifyPromptPure — token replacement', () => {
  test('replaces all required tokens', () => {
    const template = `# VERIFY\n\n## Rules\n{{UNIVERSAL_RULES}}\n\n## Identity\n{{AGENT_BODY}}\n\n## Rationalizations\n{{COMMON_RATIONALIZATIONS}}\n\n## Tools\n{{AVAILABLE_TOOLS}}\n\n## Output\n{{READY_SIGNAL}}\n`
    const out = composeVerifyPromptPure({
      templateBody: template,
      universalRules: 'rule-text',
      commonRationalizations: 'rationalization-text',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read', 'test-runner'],
    })
    expect(out).toContain('rule-text')
    expect(out).toContain('rationalization-text')
    expect(out).toContain('Test persona body.')
    expect(out).toContain('<verify-ready/>')
    expect(out).toContain('test-runner')
  })

  test('throws when a required token is missing from template', () => {
    expect(() =>
      composeVerifyPromptPure({
        templateBody: '# VERIFY\n\nNo tokens here.\n',
        universalRules: '',
        commonRationalizations: '',
        agentBody: AGENT_BODY,
        readySignal: READY_SIGNAL,
        availableTools: [],
      }),
    ).toThrow(/verify-system\.md is missing required token/)
  })

  test('available tools "(no tool_use scope declared on this persona)" when array empty', () => {
    const template = `{{UNIVERSAL_RULES}}\n{{AGENT_BODY}}\n{{COMMON_RATIONALIZATIONS}}\n{{AVAILABLE_TOOLS}}\n{{READY_SIGNAL}}`
    const out = composeVerifyPromptPure({
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

describe('composeVerifyPrompt — full asset load', () => {
  test('loads bundled assets and produces a non-empty prompt', async () => {
    _resetPromptAssetCache()
    const out = await composeVerifyPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read', 'test-runner'],
    })
    expect(out.length).toBeGreaterThan(500)
    expect(out).toContain('<verify-ready/>')
    expect(out).toContain('Universal rules')
  })

  test('the bundled verify-system template carries all required tokens', async () => {
    _resetPromptAssetCache()
    const template = await loadVerifySystemTemplate()
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
    const out = await composeVerifyPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['test-runner'],
    })
    expect(out).toContain(rules.trim().slice(0, 40))
  })

  test('common-rationalizations gets injected', async () => {
    _resetPromptAssetCache()
    const rats = await loadCommonRationalizations()
    expect(rats.length).toBeGreaterThan(100)
    const out = await composeVerifyPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['test-runner'],
    })
    expect(out).toContain(rats.trim().slice(0, 40))
  })

  test('renders authority-split section so persona never authors Verdict', async () => {
    _resetPromptAssetCache()
    const out = await composeVerifyPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['test-runner'],
    })
    // The contract Codex M8 decision 10 lock — the orchestrator owns
    // Verdict.Verdict — must be visible in the composed prompt.
    expect(out).toContain('orchestrator')
    expect(out).toContain('Verdict.Verdict')
  })
})

describe('verifier.md persona', () => {
  test('declares tool_use.execute with test-runner', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'verifier.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    expect(text).toContain('test-runner')
    expect(text).toContain('execute:')
  })

  test('declares tool_use.repo_context bound to the run worktree (no path promotion)', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'verifier.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    expect(text).toContain('repo_context')
    expect(text).toContain('.code-oz/runs/<runId>/worktree/')
    // VERIFY does not promote paths to a next manifest (contract example);
    // the schema relax in commit 9 allows this.
    expect(text).toContain('maxFilesForNextManifest: 0')
  })

  test('declares VERIFY.md + forensics as write targets', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'verifier.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    expect(text).toContain('.code-oz/artifacts/VERIFY.md')
    expect(text).toContain('.code-oz/runs/<runId>/forensics/')
  })

  test('persona body documents persona vs orchestrator authority', async () => {
    const path = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const filePath = path.join(import.meta.dir, '..', 'src', 'agents', 'defaults', 'verifier.md')
    const text = await readFile(filePath, { encoding: 'utf8' })
    // The Codex M8 decision 10 modification: persona authors Rationale,
    // Mutation.Notes, Failure summary, Constraint; orchestrator owns
    // Verdict.Verdict, Evidence, Mutation.Status.
    expect(text).toContain('Rationale')
    expect(text).toContain('Mutation.Notes')
    expect(text).toContain('Failure summary')
    expect(text).toContain('Constraint')
    expect(text).toContain('orchestrator')
  })
})
