// Concurrency-lock tests for runBuild and runVerify (M16 C4).
//
// Mirrors the existing review-phase concurrency-lock test
// (tests/review-phase.test.ts:1240-1281). The lock-busy short-circuit
// fires before any orchestration work, so these tests pre-create the
// lock dir and assert the in-memory result shape WITHOUT seeding
// PLAN.md / BUILD_REPORT.md. The non-busy path is exercised by asserting
// the function returns SOME other intervention (the natural artifact-
// missing intervention each phase produces) — never `*_already_in_flight`.
//
// The lock-busy intervention does NOT write NEEDS_INTERVENTION.json or
// append an event; mirrors review.ts:560-572. We only check the returned
// result and the post-call lock-dir presence.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, rmdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runBuild, type RunBuildOptions } from '../src/phases/build.ts'
import { runVerify } from '../src/phases/verify.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import type { RevertSeam, RunnerSeam } from '../src/phases/verify-mutation.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = () => '2026-05-08T12:00:00.000Z'

// --- agent fixtures (minimal — mirror tests/build-phase.test.ts and
//     tests/verify-phase.test.ts shapes) ----------------------------

const BUILDER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/builder.md',
  name: 'builder',
  type: 'agent',
  phase: 'build',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
    bash: 'deny' as const,
  }),
  description: 'builder stub for lock tests.',
  body: '# Builder\n\nstub.\n',
})

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
  description: 'scientist stub.',
  body: '## Scientist\n\nstub.',
})

const VERIFIER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/verifier.md',
  name: 'verifier',
  type: 'agent',
  phase: 'verify',
  provider: 'fake',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/artifacts/VERIFY.md']),
    bash: 'deny' as const,
  }),
  description: 'verifier stub.',
  body: '# Verifier\n\nstub.\n',
})

// --- shared per-test state ----------------------------------------

let tmp: string
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-phaselock-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: NOW })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
})

afterEach(async () => {
  // Defensive cleanup of any lock dirs the busy-path tests pre-created
  // (withLock cleans up successful runs; busy-pre-creates do not run
  // through that finally block). Mirrors review-phase.test.ts:1257-1259.
  await rmdir(join(paths.runDir, '.build.lock')).catch(() => undefined)
  await rmdir(join(paths.runDir, '.verify.lock')).catch(() => undefined)
  await rmdir(join(paths.runDir, '.review.lock')).catch(() => undefined)
  await rm(tmp, { recursive: true, force: true })
})

function invokeCtx(): InvokeContext {
  return {
    registry,
    runPaths: paths,
    projectRoot: tmp,
    config: DEFAULT_CONFIG,
    now: NOW,
  }
}

// --- runBuild options factory -------------------------------------

function buildOpts(): RunBuildOptions {
  return {
    runPaths: paths,
    runId: RUN,
    cwd: tmp,
    builderAgent: BUILDER_AGENT,
    scientistAgent: SCIENTIST_AGENT,
    taskId: 'T-001',
    worktree: {
      worktreePath: join(tmp, 'nonexistent-worktree'),
      baseCommitSha: '0'.repeat(40),
      dirtyAtBase: false,
    },
    invokeCtx: invokeCtx(),
    invokePersona: async () => '<build-ready/>\n',
    now: NOW,
  }
}

// --- runVerify options factory ------------------------------------

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

function verifyOpts(): Parameters<typeof runVerify>[0] {
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
    now: NOW,
  }
}

// --- helpers ------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// --- runBuild lock --------------------------------------------------

describe('runBuild — concurrency lock (M16 C4)', () => {
  test('pre-held .build.lock → build_already_in_flight intervention with runId + lock path in rule', async () => {
    const lockDir = join(paths.runDir, '.build.lock')
    await mkdir(lockDir, { recursive: false })

    const result = await runBuild(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('build_already_in_flight')
      expect(result.rule).toContain(RUN)
      expect(result.rule).toContain('.build.lock')
    }
  })

  test('lock NOT pre-held → falls through to a different intervention (not build_already_in_flight)', async () => {
    // No PLAN.md is seeded, so runBuildInner should hit
    // build_plan_missing — NOT the lock-busy code.
    const result = await runBuild(buildOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).not.toBe('build_already_in_flight')
    }
  })

  test('.build.lock is cleaned up after the call returns (success or non-busy intervention)', async () => {
    // No pre-creation; runBuild acquires the lock, runs runBuildInner
    // (which returns a non-lock intervention because no PLAN.md exists),
    // and withLock's finally clause rmdir's the lock.
    await runBuild(buildOpts())
    const lockDir = join(paths.runDir, '.build.lock')
    expect(await pathExists(lockDir)).toBe(false)
  })
})

// --- runVerify lock -------------------------------------------------

describe('runVerify — concurrency lock (M16 C4)', () => {
  test('pre-held .verify.lock → verify_already_in_flight intervention with runId + lock path in rule', async () => {
    const lockDir = join(paths.runDir, '.verify.lock')
    await mkdir(lockDir, { recursive: false })

    const result = await runVerify(verifyOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).toBe('verify_already_in_flight')
      expect(result.rule).toContain(RUN)
      expect(result.rule).toContain('.verify.lock')
    }
  })

  test('lock NOT pre-held → falls through to a different intervention (not verify_already_in_flight)', async () => {
    // No BUILD_REPORT.md is seeded, so runVerifyInner should hit
    // verify_build_report_missing — NOT the lock-busy code.
    const result = await runVerify(verifyOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).not.toBe('verify_already_in_flight')
    }
  })

  test('.verify.lock is cleaned up after the call returns (success or non-busy intervention)', async () => {
    await runVerify(verifyOpts())
    const lockDir = join(paths.runDir, '.verify.lock')
    expect(await pathExists(lockDir)).toBe(false)
  })
})

// --- cross-phase isolation ----------------------------------------

describe('phase locks are independent', () => {
  test('.build.lock pre-held does NOT trip runVerify (distinct lock dir)', async () => {
    await mkdir(join(paths.runDir, '.build.lock'), { recursive: false })

    const result = await runVerify(verifyOpts())
    expect(result.status).toBe('intervention')
    if (result.status === 'intervention') {
      expect(result.code).not.toBe('verify_already_in_flight')
    }
  })

  test('.review.lock pre-held does NOT trip runBuild or runVerify', async () => {
    await mkdir(join(paths.runDir, '.review.lock'), { recursive: false })

    const buildResult = await runBuild(buildOpts())
    expect(buildResult.status).toBe('intervention')
    if (buildResult.status === 'intervention') {
      expect(buildResult.code).not.toBe('build_already_in_flight')
      expect(buildResult.code).not.toBe('review_already_in_flight')
    }

    const verifyResult = await runVerify(verifyOpts())
    expect(verifyResult.status).toBe('intervention')
    if (verifyResult.status === 'intervention') {
      expect(verifyResult.code).not.toBe('verify_already_in_flight')
      expect(verifyResult.code).not.toBe('review_already_in_flight')
    }
  })
})
