// M9 commit 1 substrate: build_provider_recorded event.
//
// Codex M9 substrate catch (CODEX_RESPONSE_M9.md decision 5, thread
// 019de05a): the briefing's invocation-time REVIEW check assumed a
// recorded BUILD provider that did not exist. M9 commit 1 adds a
// dedicated event lighter than a BUILD_REPORT.md schema extension.
//
// Tests cover:
//   1. Validator shape (required fields, optional model)
//   2. Emission immediately after build_completed in runBuild()
//   3. Family field equals familyOf(provider) for the v0.1 mapping

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runBuild } from '../src/phases/build.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents, validateEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { familyOf } from '../src/providers/families.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: Stub hypothesis

- Phase: build
- Status: open
- Falsifier: VERIFY mutation test passes when stress logic reverts.
- Evidence: BUILD_REPORT.md changed-file manifest.
- Risk if false: BUILD output incorrect; VERIFY rejects.

# OPEN QUESTIONS

## Q-001: Stub question

- Phase: build
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: stub.
- Resolution attempts: none yet.
`

const VALID_PERSONA_RESPONSE = `<build-ready/>

\`\`\`diff
diff --git a/src/scoring/syllable.ts b/src/scoring/syllable.ts
--- a/src/scoring/syllable.ts
+++ b/src/scoring/syllable.ts
@@ -1,1 +1,1 @@
-export const stress = 'first'
+export const stress = 'last'
\`\`\`

## Title
Apply last-syllable stress to two-syllable surnames

## Notes
- Risk: edge case.
`

const VALID_PLAN_TEXT = `# PLAN

## Goals

- Test plan for build_provider_recorded fixture.

## Tasks

### T-001: Test syllable rule

- Files: src/scoring/syllable.ts
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: edge case.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Beyond M7.

## Open questions

- None known at plan time.
`

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('build_provider_recorded tests require git >= 2.40')
  }
})

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const SCIENTIST_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/scientist.md',
  name: 'scientist',
  type: 'agent',
  phase: 'build',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['HYPOTHESES.md', 'OPEN_QUESTIONS.md']),
    bash: 'deny' as const,
  }),
  description: 'scientist stub',
  body: '## Scientist\n\nemit sidecars.',
})

function makeBuilderAgent(provider: 'claude' | 'codex' | 'fake', model?: string): AgentDefinition {
  return Object.freeze({
    file: 'src/agents/defaults/builder.md',
    name: 'builder',
    type: 'agent',
    phase: 'build',
    provider,
    ...(model !== undefined ? { model } : {}),
    modelPolicy: 'opus-default',
    permissions: Object.freeze({
      read: '*' as const,
      write: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
      bash: 'deny' as const,
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxResults: 50,
          maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20,
          timeoutMs: 5000,
          network: 'none' as const,
        }),
        write: Object.freeze({
          tools: Object.freeze(['apply-patch'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxBytesPerPatch: 65536,
          timeoutMs: 5000,
        }),
      }),
    }),
    description: 'Test builder persona.',
    body: '# Builder\n\nTest builder persona body.\n',
  })
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-build-prov-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })

  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })

  await runGit(tmp, ['init', '-q', '-b', 'main'])
  await runGit(tmp, ['config', 'user.email', 'test@example.com'])
  await runGit(tmp, ['config', 'user.name', 'Test'])
  await runGit(tmp, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(tmp, 'src/scoring'), { recursive: true })
  await writeFile(join(tmp, 'src/scoring/syllable.ts'), `export const stress = 'first'\n`)
  await runGit(tmp, ['add', '.'])
  await runGit(tmp, ['commit', '-q', '-m', 'init'])

  await initRun({
    paths,
    profile: 'greenfield',
    runId: RUN,
    now: () => '2026-04-30T11:00:00.000Z',
  })
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
    now: () => '2026-04-30T11:01:00.000Z',
  }
}

async function setupWorktree(): Promise<{ worktreePath: string; baseCommitSha: string }> {
  const created = await createRunWorktree({ cwd: tmp, runId: RUN })
  if (!created.ok) throw new Error(`worktree create failed: ${created.code}`)
  await writeFile(join(paths.artifactRoot, 'PLAN.md'), VALID_PLAN_TEXT)
  return { worktreePath: created.worktreePath, baseCommitSha: created.baseCommitSha }
}

describe('build_provider_recorded — validator (M9 commit 1)', () => {
  test('valid event passes validation with required fields', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
      },
      'events.jsonl',
    )
    expect(issue).toBeNull()
  })

  test('valid event with optional model field passes', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
        model: 'claude-opus-4-7',
      },
      'events.jsonl',
    )
    expect(issue).toBeNull()
  })

  test('rejects empty model when present', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
        model: '',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.model')
    expect(issue?.rule).toContain('non-blank')
  })

  test('rejects whitespace-only model when present (M12 blank-model widening)', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
        model: '   ',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.model')
    expect(issue?.rule).toContain('non-blank')
  })

  test('rejects missing provider field', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        family: 'claude',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.provider')
  })

  test('rejects missing family field', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'T-001',
        provider: 'claude',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.family')
  })

  test('rejects malformed taskId', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 1,
        taskId: 'wrong',
        provider: 'claude',
        family: 'claude',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.taskId')
  })

  test('rejects non-positive attempt', () => {
    const issue = validateEvent(
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: '2026-04-30T11:01:00.000Z',
        runId: RUN,
        phase: 'build',
        attempt: 0,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
      },
      'events.jsonl',
    )
    expect(issue?.rule).toContain('build_provider_recorded.attempt')
  })
})

describe('build_provider_recorded — emission in runBuild (M9 commit 1)', () => {
  test('emitted immediately after build_completed when BUILD succeeds', async () => {
    const wt = await setupWorktree()
    fake
      .expect({ phase: 'build', agent: 'scientist' })
      .respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: makeBuilderAgent('claude'),
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      now: () => '2026-04-30T11:01:00.000Z',
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })
    expect(result.status).toBe('complete')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    const completedIdx = types.indexOf('build_completed')
    const recordedIdx = types.indexOf('build_provider_recorded')
    expect(completedIdx).toBeGreaterThanOrEqual(0)
    expect(recordedIdx).toBeGreaterThan(completedIdx)
  })

  test('records the BUILD agent\'s provider + resolved family', async () => {
    const wt = await setupWorktree()
    fake
      .expect({ phase: 'build', agent: 'scientist' })
      .respondWith({ content: SCIENTIST_RESPONSE })

    await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: makeBuilderAgent('claude'),
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      now: () => '2026-04-30T11:01:00.000Z',
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const recorded = events.find((e) => e.type === 'build_provider_recorded') as
      | { provider: string; family: string; attempt: number; taskId: string; model?: string }
      | undefined
    expect(recorded).toBeDefined()
    expect(recorded?.provider).toBe('claude')
    expect(recorded?.family).toBe(familyOf('claude'))
    expect(recorded?.attempt).toBe(1)
    expect(recorded?.taskId).toBe('T-001')
    // No model on the test agent — field omitted.
    expect(recorded?.model).toBeUndefined()
  })

  test('omits model when builder agent has no model field', async () => {
    const wt = await setupWorktree()
    fake
      .expect({ phase: 'build', agent: 'scientist' })
      .respondWith({ content: SCIENTIST_RESPONSE })

    await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: makeBuilderAgent('claude'),
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      now: () => '2026-04-30T11:01:00.000Z',
      invokePersona: async () => VALID_PERSONA_RESPONSE,
    })

    const eventsRaw = await readFile(paths.eventsFile, 'utf8')
    const recordedLine = eventsRaw
      .split('\n')
      .find((l) => l.includes('"build_provider_recorded"'))
    expect(recordedLine).toBeDefined()
    expect(recordedLine).not.toContain('"model"')
  })

  test('not emitted when BUILD fails (no build_completed precedes)', async () => {
    const wt = await setupWorktree()
    fake
      .expect({ phase: 'build', agent: 'scientist' })
      .respondWith({ content: SCIENTIST_RESPONSE })

    const result = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: makeBuilderAgent('claude'),
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      now: () => '2026-04-30T11:01:00.000Z',
      invokePersona: async () => 'I refuse to follow the protocol\n',
    })
    expect(result.status).toBe('intervention')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).not.toContain('build_provider_recorded')
  })
})
