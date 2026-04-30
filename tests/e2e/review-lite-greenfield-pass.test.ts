// M9 REVIEW-lite e2e: DEFINE → approve → PLAN → approve → BUILD → VERIFY
// → REVIEW (round 1 ready) → approve review (removes worktree).
//
// Mirrors tests/e2e/build-lite-greenfield.test.ts setup and extends through
// VERIFY (M8) and REVIEW (M9 commit 7). The BUILD/VERIFY/REVIEW personas
// are invoked through the dependency-injected `invokePersona` shim;
// FakeProvider stubs the Scientist response for each phase tail.
//
// VERIFY uses the same noopRunner/noopRevertSeam shape used in
// tests/verify-phase.test.ts (a single modified source file with the
// runner reporting exit 0 yields mutation status 'not-applicable').

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { cp, mkdtemp, mkdir, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDefine } from '../../src/phases/define.ts'
import { runPlan, PLAN_READY_SIGNAL } from '../../src/phases/plan.ts'
import { runBuild, type RunBuildOptions } from '../../src/phases/build.ts'
import { runVerify, VERIFY_READY_SIGNAL } from '../../src/phases/verify.ts'
import { runReview, REVIEW_READY_SIGNAL } from '../../src/phases/review.ts'
import { runApprove } from '../../src/commands/approve.ts'
import { FakeProvider } from '../../src/providers/fake.ts'
import { ProviderRegistry } from '../../src/providers/registry.ts'
import type { InvokeContext } from '../../src/providers/invoke.ts'
import type { AgentDefinition } from '../../src/agents/schema.ts'
import {
  initRun,
  loadRun,
  runPathsFor,
  type RunPaths,
  writeActiveRun,
} from '../../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../../src/state/schemas.ts'
import { DEFAULT_CONFIG, type AskMeConfig } from '../../src/config/schema.ts'
import { paths as codeOzPaths } from '../../src/paths.ts'
import { initProject } from '../../src/commands/init.ts'
import { createRunWorktree, runGit } from '../../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'
import { readEvents, appendEvent } from '../../src/state/events.ts'
import type { RevertSeam, RunnerSeam } from '../../src/phases/verify-mutation.ts'

const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/greenfield-baby-name', import.meta.url))
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-04-30T12:00:00.000Z'
const INIT_NOW = '2026-04-30T11:00:00.000Z'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('review-lite e2e requires git >= 2.40')
  }
})

let tmp: string
let projectRoot: string
let codeOz: ReturnType<typeof codeOzPaths>
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-rl-'))
  projectRoot = join(tmp, 'project')
  await cp(FIXTURE_SRC, projectRoot, { recursive: true })
  await initProject({ cwd: projectRoot, force: false })
  codeOz = codeOzPaths(projectRoot)
  paths = runPathsFor(codeOz.state, codeOz.artifacts, RUN)
  await mkdir(paths.runDir, { recursive: true })
  // Fresh FakeProvider per test (kickoff Decision 13: avoid hidden state).
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => INIT_NOW })
  await writeActiveRun(paths.activeFile, RUN)

  // Initialize git in projectRoot so worktree creation has a base commit.
  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'test@example.com'])
  await runGit(projectRoot, ['config', 'user.name', 'Test'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await runGit(projectRoot, ['add', '-A'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init fixture'])
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// --- agents ---------------------------------------------------------

function baAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/ba.md', name: 'ba', type: 'agent', phase: 'define',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({ read: '*', write: ['SPEC.md'], bash: 'deny' }),
    description: 'ba stub', body: '## BA persona\n\nelicit SPEC.',
  })
}

function leadAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/lead.md', name: 'lead', type: 'agent', phase: 'plan',
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['PLAN.md', 'SOURCE_CHECK.md'], bash: 'deny',
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.']),
          maxResults: 50, maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20, timeoutMs: 5000, network: 'none',
        }),
      }),
    }),
    description: 'lead stub', body: '## Lead persona\n\nproduce PLAN + SOURCE_CHECK.',
  })
}

function scientistAgent(phase: 'plan' | 'build' | 'verify' | 'review'): AgentDefinition {
  return Object.freeze({
    file: '/tmp/scientist.md', name: 'scientist', type: 'agent', phase,
    provider: 'fake', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['HYPOTHESES.md', 'OPEN_QUESTIONS.md'], bash: 'deny',
    }),
    description: 'scientist stub', body: '## Scientist\n\nemit sidecars.',
  })
}

function builderAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/builder.md', name: 'builder', type: 'agent', phase: 'build',
    provider: 'claude', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['.code-oz/runs/<runId>/worktree/'], bash: 'deny',
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxResults: 50, maxBytesPerResult: 16384,
          maxFilesForNextManifest: 20, timeoutMs: 5000, network: 'none',
        }),
        write: Object.freeze({
          tools: Object.freeze(['apply-patch'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxBytesPerPatch: 65536, timeoutMs: 5000,
        }),
      }),
    }),
    description: 'builder stub', body: '## Builder\n\napply patches.',
  })
}

function verifierAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/verifier.md', name: 'verifier', type: 'agent', phase: 'verify',
    provider: 'claude', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['.code-oz/artifacts/VERIFY.md'], bash: 'deny',
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
    description: 'verifier stub', body: '## Verifier\n\nrun the test.',
  })
}

// REVIEWER agent runs in family 'codex' (BUILD ran in family 'claude'),
// so the cross-family invariant is satisfied.
function reviewerAgent(): AgentDefinition {
  return Object.freeze({
    file: '/tmp/reviewer.md', name: 'reviewer', type: 'agent', phase: 'review',
    provider: 'codex', modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*', write: ['.code-oz/artifacts/REVIEW.md'], bash: 'deny',
      tool_use: Object.freeze({
        repo_context: Object.freeze({
          tools: Object.freeze(['glob', 'grep', 'read'] as const),
          roots: Object.freeze(['.code-oz/runs/<runId>/worktree/']),
          maxResults: 50, maxBytesPerResult: 16384,
          maxFilesForNextManifest: 0, timeoutMs: 5000, network: 'none',
        }),
        review_request: Object.freeze({
          tools: Object.freeze(['request-review'] as const),
          providers: Object.freeze(['codex' as const, 'gemini' as const]),
          maxRounds: 4,
          timeoutMsPerRound: 120_000,
          network: 'provider-only' as const,
        }),
      }),
    }),
    description: 'reviewer stub', body: '## Reviewer\n\nemit Findings + Score.',
  })
}

function invokeCtx(): InvokeContext {
  return {
    registry, runPaths: paths, projectRoot, config: DEFAULT_CONFIG,
    now: () => FIXED_NOW,
  }
}

function askMeConfig(): AskMeConfig {
  return DEFAULT_CONFIG.phases.define.askMe
}

// --- canned FakeProvider responses ---------------------------------

const BA_READY_REPLY = `<spec-ready/>
# SPEC

## Goals

- Help a parent name their newborn.

## Users

- New parents.

## Constraints

- Runs locally.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.

## Open questions

- None known at define time.

## Explicit non-goals

- Not building a name registry.
`

const LEAD_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Decompose SPEC into atomic tasks.

## Tasks

### T-001: Add docstring to topN helper

- Files: src/candidates.ts
- Validation: bun test tests/candidate-select.test.ts
- Risk: docstring drift if topN signature changes later.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001

## Sources

- SPEC.md AC-1.

## Out of scope

- Surname generation.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: Acceptance criterion 1

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: Given a surname, the app produces 5 candidate given names.

## Reference sources

### SC-REF-001: Existing top-N selector pattern in fixture

- Path: src/candidates.ts
- Lines: 4-8
- Why: tested topN pattern reusable for selector.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: scorer is hand-written, no API surface.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-NONE-001
`

const PLAN_SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: topN docstring describes the contract

- Phase: plan
- Status: open
- Falsifier: docstring contradicts the topN signature.
- Evidence: SPEC.md AC-1.
- Risk if false: PLAN T-001 needs rework.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: plan
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`

const BUILD_SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: topN docstring describes the contract

- Phase: build
- Status: open
- Falsifier: docstring contradicts the topN signature.
- Evidence: BUILD_REPORT.md changed-file manifest.
- Risk if false: docstring drift in M9 review.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: build
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`

const VERIFY_SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: topN docstring describes the contract

- Phase: verify
- Status: open
- Falsifier: validation command exits non-zero.
- Evidence: VERIFY.md Evidence section.
- Risk if false: docstring claim untested.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: verify
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`

const REVIEW_SCIENTIST_RESPONSE = `<scientist-ready/>
# HYPOTHESES

## H-001: topN docstring describes the contract

- Phase: review
- Status: open
- Falsifier: REVIEW finds the docstring claim contradicts code.
- Evidence: REVIEW.md Findings section.
- Risk if false: misleading docstring on a hot path.

# OPEN QUESTIONS

## Q-001: gender-neutral filter?

- Phase: review
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC open question carries forward.
- Resolution attempts: none yet.
`

const BUILDER_RESPONSE = `<build-ready/>

\`\`\`diff
diff --git a/src/candidates.ts b/src/candidates.ts
--- a/src/candidates.ts
+++ b/src/candidates.ts
@@ -5,6 +5,7 @@ export interface Candidate {
   readonly score: number
 }

+/** Returns the top N candidates by score, descending. Stable for ties. */
 export function topN(candidates: readonly Candidate[], n: number): readonly Candidate[] {
   return [...candidates].sort((a, b) => b.score - a.score).slice(0, n)
 }
\`\`\`

## Title
Add docstring describing topN contract

## Notes
- Risk: docstring drift if topN signature changes later.
`

const VERIFIER_RESPONSE = `${VERIFY_READY_SIGNAL}

## Rationale
validation exited 0; the docstring change touches modifications only, so mutation gate is not-applicable.
`

const REVIEWER_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

- None.

## Score

- Final score: 8
`

// --- VERIFY seams (mirror tests/verify-phase.test.ts) -------------

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

// --- the e2e test --------------------------------------------------

describe('M9 REVIEW-lite e2e — DEFINE → PLAN → BUILD → VERIFY → REVIEW (round 1 ready)', () => {
  test('full greenfield flow lands REVIEW.md, gate_required(review) fires, approve removes worktree + writes GATE_REVIEW_PASSED.json', async () => {
    // 1. DEFINE
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: BA_READY_REPLY })
    const defineResult = await runDefine({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN, agent: baAgent(),
      config: askMeConfig(), initialUserInput: 'Help me name my baby.',
      readNextUserInput: async () => null, fsyncDir: false, now: () => FIXED_NOW,
    })
    expect(defineResult.status).toBe('complete')

    const approveDefine = await runApprove({ cwd: projectRoot, phase: 'define', now: () => FIXED_NOW })
    expect(approveDefine.approved).toBe(true)

    // 2. PLAN
    fake.reset()
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: PLAN_SCIENTIST_RESPONSE })
    const planResult = await runPlan({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN,
      leadAgent: leadAgent(), scientistAgent: scientistAgent('plan'),
      fsyncDir: false, now: () => FIXED_NOW,
    })
    expect(planResult.status).toBe('complete')

    const approvePlan = await runApprove({ cwd: projectRoot, phase: 'plan', now: () => FIXED_NOW })
    expect(approvePlan.approved).toBe(true)

    // 3. Worktree
    const created = await createRunWorktree({ cwd: projectRoot, runId: RUN })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // 4. BUILD
    fake.reset()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: BUILD_SCIENTIST_RESPONSE })

    const buildOpts: RunBuildOptions = {
      runPaths: paths, runId: RUN, cwd: projectRoot,
      builderAgent: builderAgent(),
      scientistAgent: scientistAgent('build'),
      taskId: 'T-001',
      worktree: {
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
        dirtyAtBase: false,
      },
      invokeCtx: invokeCtx(),
      invokePersona: async () => BUILDER_RESPONSE,
      now: () => FIXED_NOW,
    }
    const buildResult = await runBuild(buildOpts)
    expect(buildResult.status).toBe('complete')
    if (buildResult.status !== 'complete') return

    // BUILD must be approved before VERIFY can run (gate phase advance).
    const approveBuild = await runApprove({ cwd: projectRoot, phase: 'build', now: () => FIXED_NOW })
    expect(approveBuild.approved).toBe(true)

    // 5. VERIFY (M9 commit 1 substrate is in place: build_provider_recorded
    //    was emitted by runBuild, so REVIEW's invocation-time check has the
    //    family it needs. We can confirm that here.)
    const eventsAfterBuild = (
      await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    ).filter(isKnownPhaseEvent)
    expect(eventsAfterBuild.some((e) => e.type === 'build_provider_recorded')).toBe(true)

    fake.reset()
    fake.expect({ phase: 'verify', agent: 'scientist' }).respondWith({ content: VERIFY_SCIENTIST_RESPONSE })
    const verifyResult = await runVerify({
      runPaths: paths, runId: RUN, cwd: projectRoot,
      verifierAgent: verifierAgent(),
      scientistAgent: scientistAgent('verify'),
      taskId: 'T-001',
      attempt: 1,
      attemptPatchContent: 'fake patch content\n',
      buildPromptSnapshot: 'fake build prompt snapshot\n',
      invokeCtx: invokeCtx(),
      invokePersona: async () => VERIFIER_RESPONSE,
      runner: noopRunner,
      revertSeam: noopRevertSeam,
      now: () => FIXED_NOW,
    })
    expect(verifyResult.status).toBe('completed')
    if (verifyResult.status !== 'completed') return

    // VERIFY-pass does NOT auto-approve; the operator approves to let the
    // run advance to REVIEW. Mirrors the M8 + M9 commit 1 substrate where
    // preApproveVerifyHook narrows to verdict-pass guard (worktree removal
    // moved to preApproveReviewHook).
    const approveVerify = await runApprove({ cwd: projectRoot, phase: 'verify', now: () => FIXED_NOW })
    expect(approveVerify.approved).toBe(true)

    // Worktree must STILL exist after VERIFY-approve (M9 commit 1 substrate).
    expect(await pathExists(created.worktreePath)).toBe(true)

    // 6. REVIEW (round 1 ready)
    fake.reset()
    fake.expect({ phase: 'review', agent: 'scientist' }).respondWith({ content: REVIEW_SCIENTIST_RESPONSE })
    const reviewResult = await runReview({
      runPaths: paths, runId: RUN, cwd: projectRoot,
      reviewerAgent: reviewerAgent(),
      scientistAgent: scientistAgent('review'),
      taskId: 'T-001',
      invokeCtx: invokeCtx(),
      invokePersona: async () => REVIEWER_RESPONSE,
      now: () => FIXED_NOW,
      round: 1,
    })
    expect(reviewResult.status).toBe('resolved')
    if (reviewResult.status !== 'resolved') return
    expect(reviewResult.verdict).toBe('ready')
    expect(reviewResult.score).toBe(8)
    expect(reviewResult.round).toBe(1)

    // REVIEW.md is the canonical artifact for the gate.
    expect(reviewResult.reviewReportPath).toBe(join(paths.artifactRoot, 'REVIEW.md'))
    const reviewText = await readFile(reviewResult.reviewReportPath, 'utf8')
    expect(reviewText).toContain('# REVIEW')
    expect(reviewText).toContain('- Provider family: codex')
    // Cross-family pair recorded with the actual build family from
    // build_provider_recorded — expect 'claude' (builder agent's provider).
    expect(reviewText).toContain('BUILD family: claude; reviewer family: codex')
    expect(reviewText).toContain('- Final verdict: ready')

    // gate_required(review) fired
    const eventsAfterReview = (
      await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    ).filter(isKnownPhaseEvent)
    expect(
      eventsAfterReview.some(
        (e) => e.type === 'gate_required' && e.phase === 'review',
      ),
    ).toBe(true)
    expect(eventsAfterReview.some((e) => e.type === 'review_started')).toBe(true)
    expect(eventsAfterReview.some((e) => e.type === 'review_resolved')).toBe(true)

    // 7. APPROVE REVIEW → preApproveReviewHook removes worktree + writes
    //    worktree_destroyed event + GATE_REVIEW_PASSED.json is written.
    const approveReview = await runApprove({ cwd: projectRoot, phase: 'review', now: () => FIXED_NOW })
    expect(approveReview.approved).toBe(true)

    // Worktree gone
    expect(await pathExists(created.worktreePath)).toBe(false)

    // GATE_REVIEW_PASSED.json present
    expect(await pathExists(join(paths.runDir, 'GATE_REVIEW_PASSED.json'))).toBe(true)

    // worktree_destroyed event with phase=review present
    const eventsAfterApprove = (
      await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
    ).filter(isKnownPhaseEvent)
    expect(
      eventsAfterApprove.some(
        (e) => e.type === 'worktree_destroyed' && e.phase === 'review',
      ),
    ).toBe(true)

    // Final run state: review approved, advancing to ship.
    const loaded = await loadRun(paths)
    expect(loaded).not.toBeNull()
    expect([...loaded!.state.phasesCompleted].sort()).toEqual(['build', 'define', 'plan', 'review', 'verify'])
    expect(loaded!.state.currentPhase).toBe('ship')
  })
})

// Suppress unused-import lint for appendEvent (used only for clarity in
// future commits' multi-round version of this e2e).
void appendEvent
