// RED tests for v0.20.2 showstopper #0a: BUILD prompt TASK_BLOCK injection.
//
// Locked design decisions from Codex thread 019e281e (debate captured in
// docs/design/V0_20_2_SHOWSTOPPER_0A_CODEX_RESPONSE.md):
//
//   - {{TASK_BLOCK}} is a required token in build-system.md.
//   - ## Task sits between ## Your identity and ## Common rationalizations.
//   - Renders as `### T-NNN: title` plus bullet rows for Files, Validation,
//     Risk, and optional Bugfix.
//   - task: PlanTask is REQUIRED in ComposeBuildPromptPureInput and
//     ComposeBuildPromptInput. A future caller forgetting it should fail
//     at typecheck, not silently regress the bug.
//   - hypotheses, sources, startLine are NOT rendered in BUILD (they are
//     PLAN/Scientist/REVIEW evidence, not builder consumer needs).

import { describe, test, expect } from 'bun:test'
import {
  composeBuildPromptPure,
  composeBuildPrompt,
  loadBuildSystemTemplate,
  _resetPromptAssetCache,
  renderTaskBlock,
} from '../src/prompts/index.ts'
import type { PlanTask } from '../src/artifacts/plan.ts'

const READY_SIGNAL = '<build-ready/>'
const AGENT_BODY = '# Builder\n\nTest persona body.\n'

const TEMPLATE_WITH_TASK = [
  '# BUILD',
  '',
  '## Rules',
  '{{UNIVERSAL_RULES}}',
  '',
  '## Identity',
  '{{AGENT_BODY}}',
  '',
  '## Task',
  '{{TASK_BLOCK}}',
  '',
  '## Rationalizations',
  '{{COMMON_RATIONALIZATIONS}}',
  '',
  '## Tools',
  '{{AVAILABLE_TOOLS}}',
  '',
  '## Output',
  '{{READY_SIGNAL}}',
  '',
].join('\n')

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'T-001',
    title: 'Scaffold src/version.ts',
    files: ['src/version.ts'],
    fileChanges: [{ path: 'src/version.ts', change: 'added' }],
    validation: 'bun test src/version.test.ts',
    risk: 'No existing tests in path; first scaffold commit',
    hypotheses: ['H1: a typed VERSION export satisfies callers'],
    sources: ['S-001', 'S-002'],
    ...overrides,
  }
}

describe('renderTaskBlock — content', () => {
  test('renders id, title, single file with change kind, validation, risk', () => {
    const block = renderTaskBlock(makeTask())
    expect(block).toContain('### T-001: Scaffold src/version.ts')
    expect(block).toContain('src/version.ts')
    expect(block).toContain('added')
    expect(block).toContain('bun test src/version.test.ts')
    expect(block).toContain('No existing tests in path; first scaffold commit')
  })

  test('renders every entry in fileChanges with its change kind verbatim', () => {
    const task = makeTask({
      title: 'Update API surface',
      files: ['src/index.ts', 'tests/index.test.ts'],
      fileChanges: [
        { path: 'src/index.ts', change: 'modified' },
        { path: 'tests/index.test.ts', change: 'modified' },
        { path: 'src/legacy/deprecated.ts', change: 'deleted' },
      ],
    })
    const block = renderTaskBlock(task)
    expect(block).toContain('src/index.ts')
    expect(block).toContain('modified')
    expect(block).toContain('tests/index.test.ts')
    expect(block).toContain('src/legacy/deprecated.ts')
    expect(block).toContain('deleted')
  })

  test('renders verbatim validation command even when it contains shell metachars', () => {
    const task = makeTask({
      validation: 'bun test --filter "version|api" && bun run typecheck',
    })
    const block = renderTaskBlock(task)
    expect(block).toContain('bun test --filter "version|api" && bun run typecheck')
  })

  test('renders verbatim risk text', () => {
    const task = makeTask({
      risk: 'one-line risk; literal `none` allowed; chars: " < > & |',
    })
    const block = renderTaskBlock(task)
    expect(block).toContain('one-line risk; literal `none` allowed; chars: " < > & |')
  })

  test('renders optional Bugfix line when bugfix is present', () => {
    const task = makeTask({
      bugfix: { existingTest: 'tests/regression/issue-42.test.ts' },
    })
    const block = renderTaskBlock(task)
    expect(block).toContain('Bugfix')
    expect(block).toContain('tests/regression/issue-42.test.ts')
  })

  test('omits Bugfix line when bugfix is undefined', () => {
    const block = renderTaskBlock(makeTask())
    expect(block).not.toContain('Bugfix')
  })

  test('does NOT render hypotheses', () => {
    const task = makeTask({
      hypotheses: ['H1: never appear in BUILD prompt', 'H2: never either'],
    })
    const block = renderTaskBlock(task)
    expect(block).not.toContain('H1: never appear in BUILD prompt')
    expect(block).not.toContain('H2: never either')
    expect(block).not.toMatch(/Hypotheses/i)
  })

  test('does NOT render sources', () => {
    const task = makeTask({ sources: ['S-001', 'S-002', 'S-rfc-7159'] })
    const block = renderTaskBlock(task)
    expect(block).not.toContain('S-rfc-7159')
    expect(block).not.toMatch(/Sources/i)
  })

  test('does NOT render startLine', () => {
    const task = makeTask({ startLine: 142 })
    const block = renderTaskBlock(task)
    expect(block).not.toContain('142')
    expect(block).not.toContain('startLine')
  })
})

describe('composeBuildPromptPure — TASK_BLOCK injection', () => {
  test('substitutes {{TASK_BLOCK}} with the rendered task content', () => {
    const out = composeBuildPromptPure({
      templateBody: TEMPLATE_WITH_TASK,
      universalRules: 'rules',
      commonRationalizations: 'rats',
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
      task: makeTask(),
    })
    expect(out).toContain('### T-001: Scaffold src/version.ts')
    expect(out).toContain('src/version.ts')
    expect(out).toContain('bun test src/version.test.ts')
    expect(out).not.toContain('{{TASK_BLOCK}}')
  })

  test('throws when {{TASK_BLOCK}} is missing from the template', () => {
    const templateWithout = TEMPLATE_WITH_TASK.replace('{{TASK_BLOCK}}', '')
    expect(() =>
      composeBuildPromptPure({
        templateBody: templateWithout,
        universalRules: 'rules',
        commonRationalizations: 'rats',
        agentBody: AGENT_BODY,
        readySignal: READY_SIGNAL,
        availableTools: ['glob', 'grep', 'read'],
        task: makeTask(),
      }),
    ).toThrow(/TASK_BLOCK/)
  })
})

describe('composeBuildPrompt — full asset load with TASK_BLOCK', () => {
  test('the bundled build-system template now carries the TASK_BLOCK token', async () => {
    _resetPromptAssetCache()
    const template = await loadBuildSystemTemplate()
    expect(template).toContain('{{TASK_BLOCK}}')
  })

  test('the {{TASK_BLOCK}} slot is placed between Your identity and Common rationalizations', async () => {
    _resetPromptAssetCache()
    const template = await loadBuildSystemTemplate()
    const identityIdx = template.indexOf('## Your identity')
    const taskIdx = template.indexOf('{{TASK_BLOCK}}')
    const rationalizationsIdx = template.indexOf('## Common rationalizations')
    expect(identityIdx).toBeGreaterThan(-1)
    expect(taskIdx).toBeGreaterThan(-1)
    expect(rationalizationsIdx).toBeGreaterThan(-1)
    expect(taskIdx).toBeGreaterThan(identityIdx)
    expect(taskIdx).toBeLessThan(rationalizationsIdx)
  })

  test('renders the rendered task block into the bundled prompt end-to-end', async () => {
    _resetPromptAssetCache()
    const out = await composeBuildPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
      task: makeTask({ id: 'T-042', title: 'Wire the task block' }),
    })
    expect(out).toContain('### T-042: Wire the task block')
    expect(out).toContain('src/version.ts')
    expect(out).not.toContain('{{TASK_BLOCK}}')
  })

  test('selected task content appears; sibling task content does not', async () => {
    _resetPromptAssetCache()
    const out = await composeBuildPrompt({
      agentBody: AGENT_BODY,
      readySignal: READY_SIGNAL,
      availableTools: ['glob', 'grep', 'read'],
      task: makeTask({ id: 'T-001', title: 'First task' }),
    })
    expect(out).toContain('T-001')
    expect(out).toContain('First task')
    expect(out).not.toContain('T-002')
    expect(out).not.toContain('Second task')
  })
})
