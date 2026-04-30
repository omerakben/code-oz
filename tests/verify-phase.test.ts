// Smoke tests for runVerify orchestration (M8 commit 10).
//
// Full integration tests with real git worktree + FakeProvider Scientist
// invocation land in a Pre-M9 commit (tracked in ROADMAP). These tests
// exercise the orchestration's entry validation and a deliberately
// minimal happy-path skeleton via dependency-injected seams.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runVerify,
  VERIFY_READY_SIGNAL,
} from '../src/phases/verify.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { RevertSeam, RunnerSeam } from '../src/phases/verify-mutation.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

const VERIFIER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/verifier.md',
  name: 'verifier',
  type: 'agent',
  phase: 'verify',
  provider: 'claude',
  modelPolicy: 'opus-default',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/artifacts/VERIFY.md']),
    bash: 'deny' as const,
    tool_use: Object.freeze({
      execute: Object.freeze({
        tools: Object.freeze(['test-runner'] as const),
        roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
        timeoutMs: 60_000,
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 1_048_576,
        network: 'none' as const,
      }),
    }),
  }),
  description: 'verifier stub for orchestration smoke tests.',
  body: '# Verifier\n\nTest verifier persona body.\n',
})

const SCIENTIST_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/scientist.md',
  name: 'scientist',
  type: 'agent',
  phase: 'verify',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['HYPOTHESES.md', 'OPEN_QUESTIONS.md']),
    bash: 'deny' as const,
  }),
  description: 'scientist stub.',
  body: '## Scientist\n\nstub.',
})

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-verify-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => '2026-04-30T19:00:00.000Z' })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: DEFAULT_CONFIG,
    now: () => '2026-04-30T19:00:00.000Z',
  }
}

const noopRunner: RunnerSeam = async () => ({
  terminationReason: 'exit',
  exitCode: 0,
  durationMs: 1,
  truncated: { stdout: false, stderr: false },
})

const noopRevertSeam: RevertSeam = {
  async snapshot() { return null },
  async revert() { /* no-op */ },
  async restore() { /* no-op */ },
}

function buildOpts(overrides: Partial<Parameters<typeof runVerify>[0]> = {}): Parameters<typeof runVerify>[0] {
  return {
    runPaths: paths,
    runId: RUN,
    cwd: tmp,
    verifierAgent: VERIFIER_AGENT,
    scientistAgent: SCIENTIST_AGENT,
    taskId: 'T-001',
    attempt: 1,
    attemptPatchContent: 'fake patch content\n',
    buildPromptSnapshot: 'fake build prompt snapshot\n',
    invokeCtx: invokeCtx(),
    invokePersona: async () => '<verify-ready/>\n',
    runner: noopRunner,
    revertSeam: noopRevertSeam,
    now: () => '2026-04-30T19:00:00.000Z',
    ...overrides,
  }
}

describe('runVerify — entry validation', () => {
  test('missing BUILD_REPORT.md → intervention verify_build_report_missing', async () => {
    // No BUILD_REPORT.md written; runVerify reads the artifact root.
    const result = await runVerify(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_build_report_missing')
    }
  })

  test('malformed BUILD_REPORT.md → intervention verify_build_report_invalid', async () => {
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), 'this is not a valid build report\n')
    const result = await runVerify(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_build_report_invalid')
    }
  })

  test('BUILD_REPORT.md taskId mismatch → verify_build_ref_mismatch', async () => {
    const reportText = makeMinimalBuildReport({ taskId: 'T-999', attempt: 1 })
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), reportText)
    const result = await runVerify(buildOpts({ taskId: 'T-001' }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_build_ref_mismatch')
      expect(result.rule).toContain('T-999')
    }
  })

  test('BUILD_REPORT.md attempt mismatch → verify_build_ref_mismatch', async () => {
    const reportText = makeMinimalBuildReport({ taskId: 'T-001', attempt: 3 })
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), reportText)
    const result = await runVerify(buildOpts({ taskId: 'T-001', attempt: 1 }))
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_build_ref_mismatch')
      expect(result.rule).toContain('attempt')
    }
  })

  test('persona response missing ready signal twice → verify_validation_failed (after repair turn)', async () => {
    await writeFile(
      join(paths.artifactRoot, 'BUILD_REPORT.md'),
      makeMinimalBuildReport({ taskId: 'T-001', attempt: 1 }),
    )
    const result = await runVerify(
      buildOpts({
        invokePersona: async () => 'no ready marker here',
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      // Initial draft missing → repair turn → still missing → terminal.
      expect(result.code).toBe('verify_validation_failed')
    }
  })

  test('persona invoke throws → verify_persona_invoke_failed', async () => {
    await writeFile(
      join(paths.artifactRoot, 'BUILD_REPORT.md'),
      makeMinimalBuildReport({ taskId: 'T-001', attempt: 1 }),
    )
    const result = await runVerify(
      buildOpts({
        invokePersona: async () => { throw new Error('persona crashed') },
      }),
    )
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_persona_invoke_failed')
    }
  })
})

describe('runVerify — exposed VERIFY_READY_SIGNAL constant', () => {
  test('matches the persona prompt template token', () => {
    expect(VERIFY_READY_SIGNAL).toBe('<verify-ready/>')
  })
})

describe('runVerify — durable interventions (Codex bp#2)', () => {
  test('intervention writes NEEDS_INTERVENTION.json + appends intervention event', async () => {
    const { readFile, access } = await import('node:fs/promises')
    const { readEvents } = await import('../src/state/events.ts')
    const { join: pjoin } = await import('node:path')

    // No BUILD_REPORT.md → verify_build_report_missing intervention.
    const result = await runVerify(buildOpts())
    expect(result.status).toBe('intervention')

    // NEEDS_INTERVENTION.json must exist at the run dir.
    const gatePath = pjoin(paths.runDir, 'NEEDS_INTERVENTION.json')
    await access(gatePath) // throws if missing
    const gateContent = JSON.parse(await readFile(gatePath, 'utf8')) as Record<string, unknown>
    expect(gateContent.code).toBe('verify_build_report_missing')
    expect(gateContent.phase).toBe('verify')
    expect(Array.isArray(gateContent.actionableSuggestions)).toBe(true)
    expect((gateContent.actionableSuggestions as string[]).length).toBeGreaterThan(0)

    // events.jsonl must contain an intervention event.
    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const ie = events.find((e) => e.type === 'intervention')
    expect(ie).toBeDefined()
    expect((ie as { code: string }).code).toBe('verify_build_report_missing')
  })
})

// --- helpers --------------------------------------------------------

function makeMinimalBuildReport(opts: {
  readonly taskId: string
  readonly attempt: number
}): string {
  const planSha = 'a'.repeat(64)
  const baseSha = 'b'.repeat(40)
  const patchSha = 'c'.repeat(64)
  const fileSha = 'd'.repeat(64)
  const cf = opts.attempt === 1
    ? `- None (attempt 1).`
    : [
        `- Prior attempt: ${opts.attempt - 1}`,
        '- Prior forensics: .code-oz/runs/01HX/forensics/1/',
        '- Prior validation command: bun test foo.test.ts',
        '- Prior verdict: fail (exit code 1, duration 100 ms)',
        '- Prior failure summary: x',
        '- Constraint: y',
      ].join('\n')
  return `# BUILD_REPORT

## Task

- Task: ${opts.taskId}
- Title: stub title
- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${planSha})
- Attempt: ${opts.attempt}

## Base

- Worktree: .code-oz/runs/<runId>/worktree/
- Base commit: ${baseSha}
- Dirty tree at base: false

## Patch

- Patch path: .code-oz/runs/<runId>/patches/attempt-1.patch
- Patch sha256: ${patchSha}
- Patch byte count: 100

## Changed files

- src/foo.ts | sha256: ${fileSha} | change: modified

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Failure carry-forward

${cf}

## Notes

- stub note.
`
}
