import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, access, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { runBuild, type RunBuildOptions } from '../src/phases/build.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, isKnownPhaseEvent, type LoggedEvent } from '../src/state/schemas.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import { buildPromptSnapshotPath } from '../src/worktree/paths.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`build-prompt-snapshot tests require git >= 2.40`)
  }
})

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

const BUILDER_BODY = '# Builder\n\nTest builder persona body.\n'

const SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: Patch correctly handles two-syllable surnames

- Phase: build
- Status: open
- Falsifier: VERIFY mutation test passes when stress logic reverts.
- Evidence: BUILD_REPORT.md changed-file manifest.
- Risk if false: BUILD output incorrect; VERIFY rejects.

# OPEN QUESTIONS

## Q-001: Edge case for zero-syllable input

- Phase: build
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: Out of scope for T-001.
- Resolution attempts: none yet.
`

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

const BUILDER_AGENT: AgentDefinition = Object.freeze({
  file: 'src/agents/defaults/builder.md',
  name: 'builder',
  type: 'agent',
  phase: 'build',
  provider: 'claude',
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
  body: BUILDER_BODY,
})

const TASK_ID = 'T-001'

const VALID_PERSONA_RESPONSE_1 = `<build-ready/>

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
- Risk: edge case for 3+ syllable names not addressed.
`

// Attempt-2 patch is independent of attempt 1 (relative to baseSha state
// `'first'`, not post-attempt-1 `'last'`). v0.20.3 #1 worktree-reset on
// verify-fail restart returns the worktree to baseSha before attempt 2's
// patch applies, so attempt 2's pre-image must match baseSha state.
const VALID_PERSONA_RESPONSE_2 = `<build-ready/>

\`\`\`diff
diff --git a/src/scoring/syllable.ts b/src/scoring/syllable.ts
--- a/src/scoring/syllable.ts
+++ b/src/scoring/syllable.ts
@@ -1,1 +1,1 @@
-export const stress = 'first'
+export const stress = 'second-to-last'
\`\`\`

## Title
Refine to second-to-last syllable for clarity

## Notes
- Carry-forward: prior attempt picked the wrong stress per VERIFY feedback.
`

const VALID_PLAN_TEXT = `# PLAN

## Goals

- Test plan for BUILD-phase fixture.

## Tasks

### T-001: Test syllable rule

- Files: src/scoring/syllable.ts
- Validation: bun test tests/scoring-syllable.test.ts
- Risk: Risk: edge case for 3+ syllable names not addressed.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Beyond M7.

## Open questions

- None known at plan time.
`

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-build-prompt-'))
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

function buildOptsBase(wt: {
  worktreePath: string
  baseCommitSha: string
}): Omit<RunBuildOptions, 'invokePersona'> {
  fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })
  return {
    runPaths: paths,
    runId: RUN,
    cwd: tmp,
    builderAgent: BUILDER_AGENT,
    scientistAgent: SCIENTIST_AGENT,
    taskId: TASK_ID,
    worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
    invokeCtx: invokeCtx(),
    now: () => '2026-04-30T11:01:00.000Z',
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function setupWorktree(): Promise<{ worktreePath: string; baseCommitSha: string }> {
  const created = await createRunWorktree({ cwd: tmp, runId: RUN })
  if (!created.ok) throw new Error(`worktree create failed: step ${created.step} ${created.code}`)
  await writeFile(join(paths.artifactRoot, 'PLAN.md'), VALID_PLAN_TEXT)
  return {
    worktreePath: created.worktreePath,
    baseCommitSha: created.baseCommitSha,
  }
}

function lastBuildCompleted(events: readonly LoggedEvent[]): Extract<
  LoggedEvent,
  { type: 'build_completed' }
> {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e !== undefined && isKnownPhaseEvent(e) && e.type === 'build_completed') return e
  }
  throw new Error('no build_completed event found')
}

function allBuildCompleted(events: readonly LoggedEvent[]): readonly Extract<
  LoggedEvent,
  { type: 'build_completed' }
>[] {
  return events.filter(
    (e): e is Extract<LoggedEvent, { type: 'build_completed' }> =>
      isKnownPhaseEvent(e) && e.type === 'build_completed',
  )
}

describe('runBuild — BUILD prompt snapshot persistence (M16 C5)', () => {
  test('happy path attempt 1: snapshot file exists, sha matches event, non-empty, regex valid', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => VALID_PERSONA_RESPONSE_1,
    })
    expect(result.status).toBe('complete')

    const snapshotPath = buildPromptSnapshotPath(tmp, RUN, 1)
    expect(await pathExists(snapshotPath)).toBe(true)

    const promptText = await readFile(snapshotPath, 'utf8')
    const fileSha = createHash('sha256').update(promptText, 'utf8').digest('hex')

    const fileStat = await stat(snapshotPath)
    expect(fileStat.size).toBeGreaterThan(0)
    expect(promptText.length).toBeGreaterThan(0)

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = lastBuildCompleted(events)
    expect(completed.attempt).toBe(1)
    expect(completed.promptSnapshotSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(completed.promptSnapshotSha256).toBe(fileSha)
  })

  test('multi-attempt: each attempt persists its own snapshot; event sha matches corresponding file sha', async () => {
    const wt = await setupWorktree()

    // Attempt 1.
    const r1 = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => VALID_PERSONA_RESPONSE_1,
    })
    expect(r1.status).toBe('complete')

    // Re-prime scientist for attempt 2 (FakeProvider expectations are one-shot).
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: SCIENTIST_RESPONSE })

    // Attempt 2 with carryForward.priorAttempt=1 to satisfy restart-state-drift rule.
    const r2 = await runBuild({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      builderAgent: BUILDER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: TASK_ID,
      worktree: { worktreePath: wt.worktreePath, baseCommitSha: wt.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => VALID_PERSONA_RESPONSE_2,
      attempt: 2,
      carryForward: {
        source: 'verify-fail',
        priorAttempt: 1,
        priorForensicsPath: '.code-oz/runs/01HX/forensics/1/',
        priorValidationCommand: 'bun test tests/scoring-syllable.test.ts',
        priorVerdict: 'fail (exit code 1, duration 100 ms)',
        priorFailureSummary: 'expected stress on syllable 2; got stress on syllable 1.',
        constraint: 'prefer last-syllable stress for two-syllable surnames.',
      },
      now: () => '2026-04-30T11:02:00.000Z',
    })
    expect(r2.status).toBe('complete')

    const path1 = buildPromptSnapshotPath(tmp, RUN, 1)
    const path2 = buildPromptSnapshotPath(tmp, RUN, 2)
    expect(await pathExists(path1)).toBe(true)
    expect(await pathExists(path2)).toBe(true)
    expect(path1).not.toBe(path2)

    const text1 = await readFile(path1, 'utf8')
    const text2 = await readFile(path2, 'utf8')
    const sha1 = createHash('sha256').update(text1, 'utf8').digest('hex')
    const sha2 = createHash('sha256').update(text2, 'utf8').digest('hex')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = allBuildCompleted(events)
    expect(completed.length).toBe(2)
    const c1 = completed.find((e) => e.attempt === 1)
    const c2 = completed.find((e) => e.attempt === 2)
    expect(c1).toBeDefined()
    expect(c2).toBeDefined()
    if (c1 === undefined || c2 === undefined) return

    expect(c1.promptSnapshotSha256).toBe(sha1)
    expect(c2.promptSnapshotSha256).toBe(sha2)
    expect(c1.promptSnapshotSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(c2.promptSnapshotSha256).toMatch(/^[0-9a-f]{64}$/)

    // composeBuildPrompt is deterministic over (agentBody, readySignal,
    // availableTools); attempts 1 and 2 share those inputs in this fixture, so
    // sha1 === sha2 is the documented expected case (per test prompt).
    // Skipping distinct-sha assertion intentionally; the per-attempt event-vs-file
    // equality above is the load-bearing invariant.
  })

  test('atomic-write failure path: pre-existing directory blocks rename → intervention, persona NOT invoked', async () => {
    const wt = await setupWorktree()

    // Pre-create a directory at the snapshot target. atomicWriteFile writes a
    // tmp file alongside, then renames over the target — rename of a regular
    // file onto an existing non-empty directory fails with EISDIR/ENOTDIR/EPERM.
    const snapshotPath = buildPromptSnapshotPath(tmp, RUN, 1)
    await mkdir(dirname(snapshotPath), { recursive: true })
    await mkdir(snapshotPath, { recursive: true })
    // Ensure the directory is non-empty so rename cannot succeed via empty-dir
    // overwrite on platforms that allow it.
    await writeFile(join(snapshotPath, '.blocker'), 'block\n')

    let invocations = 0
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => {
        invocations++
        return VALID_PERSONA_RESPONSE_1
      },
    })

    expect(result.status).toBe('intervention')
    if (result.status !== 'intervention') return
    expect(result.code).toBe('build_prompt_snapshot_write_failed')

    // Persona must NOT have been invoked on the pre-invoke failure path.
    expect(invocations).toBe(0)

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const types = events.map((e) => e.type)
    expect(types).toContain('build_started')
    expect(types).toContain('build_failed')
    expect(types).not.toContain('build_completed')

    const failed = events.find(
      (e): e is Extract<LoggedEvent, { type: 'build_failed' }> =>
        isKnownPhaseEvent(e) &&
        e.type === 'build_failed' &&
        e.code === 'build_prompt_snapshot_write_failed',
    )
    expect(failed).toBeDefined()

    const niPath = join(paths.runDir, 'NEEDS_INTERVENTION.json')
    expect(await pathExists(niPath)).toBe(true)
    const niText = await readFile(niPath, 'utf8')
    const ni = JSON.parse(niText) as { code: string; phase: string }
    expect(ni.code).toBe('build_prompt_snapshot_write_failed')
    expect(ni.phase).toBe('build')
  })

  test('sha stability: re-reading the on-disk snapshot yields the same sha as build_completed.promptSnapshotSha256', async () => {
    const wt = await setupWorktree()
    const result = await runBuild({
      ...buildOptsBase(wt),
      invokePersona: async () => VALID_PERSONA_RESPONSE_1,
    })
    expect(result.status).toBe('complete')

    const snapshotPath = buildPromptSnapshotPath(tmp, RUN, 1)
    const onDiskBytes = await readFile(snapshotPath)
    const onDiskSha = createHash('sha256').update(onDiskBytes).digest('hex')

    const events = await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    const completed = lastBuildCompleted(events)

    // The invariant preApproveBuildHook (and any future consumer) relies on:
    // bytes on disk hash to the sha recorded in the event. If atomicWriteFile
    // ever wrote different bytes than the sha was computed from, this catches it.
    expect(onDiskSha).toBe(completed.promptSnapshotSha256)
    expect(onDiskSha).toMatch(/^[0-9a-f]{64}$/)
  })
})
