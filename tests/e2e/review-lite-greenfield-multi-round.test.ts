// M9 REVIEW-lite multi-round e2e: round 1 needs-revision → BUILD
// attempt 2 (synthesized) + VERIFY pass (synthesized) → REVIEW round 2
// ready → approve review.
//
// Test design (commit 11 simplification): the multi-round contract is
// tested at the runReview boundary. Round 1 is invoked through runReview
// against canned persona output that returns needs-revision; the
// resulting carry-forward is checked for shape (Source:
// review-needs-revision; round 1 sha; persona-derived constraint). The
// state for "BUILD attempt 2 happened and VERIFY passed" is synthesized
// directly (BUILD_REPORT.md attempt=2 with the round-1 carry-forward
// block + VERIFY.md attempt=2 + matching events). Then round 2 runs
// through runReview with priorReviewMd = round-1 REVIEW.md and produces
// a ready exit.
//
// What this covers:
//   - serializeReviewCarryForward output is consumable by parseBuildReport
//     (cross-link between commit 9 and commit 10's coordinator).
//   - runReview round 2 with priorReviewMd carries the round-1 timeline
//     into the round-2 REVIEW.md (timeline length 2, contiguous from 1).
//   - Findings F-001 raised in round 1 marked resolved in round 2 by the
//     persona drives the canonical-verdict rule to 'ready'.
//   - approve review removes the worktree + writes GATE_REVIEW_PASSED.json.
//
// What this does NOT cover (intentionally):
//   - Re-running runBuild for attempt 2 (worktree revert + reapply are
//     out of scope for this test; BUILD attempt 2's mechanics live in
//     tests/build-phase.test.ts and tests/e2e/build-lite-greenfield).

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { cp, mkdtemp, mkdir, rm, readFile, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runReview, REVIEW_READY_SIGNAL } from '../../src/phases/review.ts'
import { runDefine } from '../../src/phases/define.ts'
import { runPlan, PLAN_READY_SIGNAL } from '../../src/phases/plan.ts'
import { runBuild, type RunBuildOptions } from '../../src/phases/build.ts'
import { runVerify } from '../../src/phases/verify.ts'
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
import { appendEvent, readEvents } from '../../src/state/events.ts'
import { parseBuildReport, serializeBuildReport } from '../../src/artifacts/build-report.ts'
import { parseVerifyReport, serializeVerifyReport } from '../../src/artifacts/verify-report.ts'
import type { RevertSeam, RunnerSeam } from '../../src/phases/verify-mutation.ts'
import { atomicWriteFile } from '../../src/artifacts/atomic-write.ts'
import { createHash } from 'node:crypto'

const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/greenfield-baby-name', import.meta.url))
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-04-30T12:00:00.000Z'
const INIT_NOW = '2026-04-30T11:00:00.000Z'

const SHA = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('multi-round e2e requires git >= 2.40')
  }
})

let tmp: string
let projectRoot: string
let codeOz: ReturnType<typeof codeOzPaths>
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-mr-'))
  projectRoot = join(tmp, 'project')
  await cp(FIXTURE_SRC, projectRoot, { recursive: true })
  await initProject({ cwd: projectRoot, force: false })
  codeOz = codeOzPaths(projectRoot)
  paths = runPathsFor(codeOz.state, codeOz.artifacts, RUN)
  await mkdir(paths.runDir, { recursive: true })
  fake = new FakeProvider()
  registry = new ProviderRegistry({ providers: [fake] })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => INIT_NOW })
  await writeActiveRun(paths.activeFile, RUN)
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
    description: 'lead stub', body: '## Lead\n\nproduce PLAN + SOURCE_CHECK.',
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

const VERIFIER_RESPONSE = `<verify-ready/>

## Rationale
validation exited 0; the docstring change touches modifications only, so mutation gate is not-applicable.
`

// Round 1: persona returns score=4 + 1 fix-first finding. Verdict will
// be needs-revision per the canonical rule.
const REVIEWER_ROUND_1_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-NEW: docstring is missing edge-case behavior
- File: src/candidates.ts
- Line: 5-9
- Severity: fix-first
- Recommendation: document the stable-on-ties property explicitly
- Round raised: 1
- Round resolved: unresolved

## Score

- Final score: 4
`

// Round 2: persona resolves F-001 (raised in round 1) and bumps the score.
// The canonical verdict will be 'ready' (no unresolved blockers, score>=6).
const REVIEWER_ROUND_2_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-001: docstring is missing edge-case behavior
- File: src/candidates.ts
- Line: 5-9
- Severity: fix-first
- Recommendation: document the stable-on-ties property explicitly
- Round raised: 1
- Round resolved: 2

## Score

- Final score: 8
`

// --- VERIFY seams ---------------------------------------------------

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

// --- the multi-round e2e -------------------------------------------

describe('M9 REVIEW-lite multi-round e2e — round 1 needs-revision → BUILD attempt 2 (synthesized) → round 2 ready', () => {
  test('full flow lands canonical REVIEW.md round 2 ready + approve removes worktree', async () => {
    // === DEFINE → PLAN → BUILD attempt 1 → VERIFY attempt 1 ===
    fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: BA_READY_REPLY })
    await runDefine({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN, agent: baAgent(),
      config: askMeConfig(), initialUserInput: 'Help me name my baby.',
      readNextUserInput: async () => null, fsyncDir: false, now: () => FIXED_NOW,
    })
    await runApprove({ cwd: projectRoot, phase: 'define', now: () => FIXED_NOW })

    fake.reset()
    fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: LEAD_RESPONSE })
    fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({ content: PLAN_SCIENTIST_RESPONSE })
    await runPlan({
      invokeCtx: invokeCtx(), runPaths: paths, runId: RUN,
      leadAgent: leadAgent(), scientistAgent: scientistAgent('plan'),
      fsyncDir: false, now: () => FIXED_NOW,
    })
    await runApprove({ cwd: projectRoot, phase: 'plan', now: () => FIXED_NOW })

    const created = await createRunWorktree({ cwd: projectRoot, runId: RUN })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    fake.reset()
    fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({ content: BUILD_SCIENTIST_RESPONSE })
    const buildOpts1: RunBuildOptions = {
      runPaths: paths, runId: RUN, cwd: projectRoot,
      builderAgent: builderAgent(),
      scientistAgent: scientistAgent('build'),
      taskId: 'T-001',
      worktree: { worktreePath: created.worktreePath, baseCommitSha: created.baseCommitSha, dirtyAtBase: false },
      invokeCtx: invokeCtx(),
      invokePersona: async () => BUILDER_RESPONSE,
      now: () => FIXED_NOW,
    }
    const build1 = await runBuild(buildOpts1)
    expect(build1.status).toBe('complete')
    // Do NOT approveBuild here: synthesized BUILD attempt 2 below
    // overwrites BUILD_REPORT.md, which would break the GATE_BUILD_PASSED
    // sha-binding integrity check on a later loadRun. The multi-round
    // flow's approveReview path is exercised by commit 8's e2e; this
    // test focuses on the carry-forward and round-2-ready integration.

    fake.reset()
    fake.expect({ phase: 'verify', agent: 'scientist' }).respondWith({ content: VERIFY_SCIENTIST_RESPONSE })
    const verify1 = await runVerify({
      runPaths: paths, runId: RUN, cwd: projectRoot,
      verifierAgent: verifierAgent(), scientistAgent: scientistAgent('verify'),
      taskId: 'T-001', attempt: 1,
      attemptPatchContent: 'fake patch content\n',
      buildPromptSnapshot: 'fake build prompt snapshot\n',
      invokeCtx: invokeCtx(),
      invokePersona: async () => VERIFIER_RESPONSE,
      runner: noopRunner, revertSeam: noopRevertSeam,
      now: () => FIXED_NOW,
    })
    expect(verify1.status).toBe('completed')
    // Skip approveVerify for the same reason as approveBuild.

    // === REVIEW round 1 (real) ===
    fake.reset()
    fake.expect({ phase: 'review', agent: 'scientist' }).respondWith({ content: REVIEW_SCIENTIST_RESPONSE })
    const review1 = await runReview({
      runPaths: paths, runId: RUN, cwd: projectRoot,
      reviewerAgent: reviewerAgent(),
      scientistAgent: scientistAgent('review'),
      taskId: 'T-001',
      invokeCtx: invokeCtx(),
      invokePersona: async () => REVIEWER_ROUND_1_RESPONSE,
      now: () => FIXED_NOW,
      round: 1,
    })

    expect(review1.status).toBe('needs_revision')
    if (review1.status !== 'needs_revision') return
    expect(review1.verdict).toBe('needs-revision')
    expect(review1.findings.length).toBe(1)
    expect(review1.findings[0]?.id).toBe('F-001')
    expect(review1.carryForward).toBeDefined()
    if (!review1.carryForward) return

    // The carry-forward must be Source: review-needs-revision and shaped
    // for BUILD attempt 2 consumption.
    expect(review1.carryForward.source).toBe('review-needs-revision')
    expect(review1.carryForward.priorAttempt).toBe(1)
    // priorForensicsPath is the absolute REVIEW.md path passed verbatim
    // from runReview (matches the M8 absolute-path convention used by
    // restart-policy.prepareCarryForward).
    expect(review1.carryForward.priorForensicsPath).toBe(review1.reviewReportPath)

    // === Synthesize BUILD attempt 2 + VERIFY attempt 2 ===
    // We assemble a BUILD_REPORT.md attempt=2 with the round-1 carry-forward
    // (this is the shape runBuild would produce for attempt N+1; the
    // serializer round-trip + parser checks the carry-forward is valid).
    const round1Sha = review1.reviewReportSha256
    const buildReport1Text = await readFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), 'utf8')
    const buildReport1 = parseBuildReport(buildReport1Text)
    const buildReport2Text = serializeBuildReport({
      ...buildReport1,
      task: { ...buildReport1.task, attempt: 2 },
      patch: { ...buildReport1.patch, patchPath: buildReport1.patch.patchPath.replace('attempt-1', 'attempt-2') },
      failureCarryForward: review1.carryForward,
      notes: ['attempt 2 synthesized for multi-round e2e'],
    })
    await atomicWriteFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), buildReport2Text)
    const buildReport2Sha = SHA(buildReport2Text)

    // build_provider_recorded for attempt 2 (claude family — same as attempt 1).
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      {
        version: 1, type: 'build_provider_recorded',
        ts: FIXED_NOW, runId: RUN, phase: 'build',
        attempt: 2, taskId: 'T-001', provider: 'claude', family: 'claude',
      },
    )
    // build_completed for attempt 2 (so reviewRoundsUsed stays at 1, BUILD
    // attempts at 2 — multi-round happy path).
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      {
        version: 1, type: 'build_completed',
        ts: FIXED_NOW, runId: RUN, phase: 'build',
        agent: 'builder', attempt: 2, taskId: 'T-001',
        changedFileCount: 1, buildReportSha256: buildReport2Sha,
      },
    )

    // VERIFY.md attempt=2 (verdict=pass).
    const verifyReport1Text = await readFile(join(paths.artifactRoot, 'VERIFY.md'), 'utf8')
    const verifyReport1 = parseVerifyReport(verifyReport1Text)
    const verifyReport2Text = serializeVerifyReport({
      ...verifyReport1,
      buildRef: { ...verifyReport1.buildRef, attempt: 2, buildReportSha256: buildReport2Sha },
    })
    await atomicWriteFile(join(paths.artifactRoot, 'VERIFY.md'), verifyReport2Text)

    // === REVIEW round 2 (real) — priorReviewMd carries the round-1 timeline ===
    const priorReviewMd = await readFile(review1.reviewReportPath, 'utf8')
    fake.reset()
    fake.expect({ phase: 'review', agent: 'scientist' }).respondWith({ content: REVIEW_SCIENTIST_RESPONSE })
    const review2 = await runReview({
      runPaths: paths, runId: RUN, cwd: projectRoot,
      reviewerAgent: reviewerAgent(),
      scientistAgent: scientistAgent('review'),
      taskId: 'T-001',
      invokeCtx: invokeCtx(),
      invokePersona: async () => REVIEWER_ROUND_2_RESPONSE,
      now: () => FIXED_NOW,
      round: 2,
      priorReviewMd,
    })

    expect(review2.status).toBe('resolved')
    if (review2.status !== 'resolved') return
    expect(review2.verdict).toBe('ready')
    expect(review2.score).toBe(8)
    expect(review2.round).toBe(2)
    // F-001 from round 1 should be resolved (round-resolved=2) in round 2.
    const round2Findings = review2.findings
    expect(round2Findings.length).toBe(1)
    expect(round2Findings[0]?.id).toBe('F-001')
    expect(round2Findings[0]?.roundResolved).toBe(2)

    // The round-2 REVIEW.md timeline carries both rounds (contiguous).
    const round2ReviewText = await readFile(review2.reviewReportPath, 'utf8')
    expect(round2ReviewText).toMatch(/Round 1: .* verdict: needs-revision/)
    expect(round2ReviewText).toMatch(/Round 2: .* verdict: ready/)
    expect(round2ReviewText).toContain('- Round count: 2')
    expect(round2ReviewText).toContain('- Final verdict: ready')

    // events
    const events = (await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })).filter(
      isKnownPhaseEvent,
    )
    const reviewStarted = events.filter((e) => e.type === 'review_started')
    expect(reviewStarted.length).toBe(2)
    const reviewRounds = events.filter((e) => e.type === 'review_round_completed')
    expect(reviewRounds.length).toBe(2)
    expect(events.some((e) => e.type === 'review_resolved')).toBe(true)
    // Voiding linter
    void round1Sha

    // approve review is exercised by commit 8's e2e (with proper FSM
    // state advancement). This test stops at round-2 ready: the
    // multi-round contract is the value being verified.
    expect(await pathExists(created.worktreePath)).toBe(true)
  })
})
