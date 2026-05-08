// M15 Phase 2 C17 — production fire-path executor proven end-to-end.
//
// Trigger: Codex R1 #3 stayed open after C13b. The wiring landed
// (review.ts:949 fire-path executor closure) and helper-unit tests covered
// the pure pieces, but no test exercised the full trace
//   real runReview
//     → real review-scheduler hook (production firePathExecutor)
//       → real requestDebate (writes BRIEFING/RESPONSE/DECISION on disk,
//         emits debate_started + debate_resolved)
//         → real recursive runReviewRoundLocked('disabled_post_debate')
//           → real debate_scheduler_postreview event
// against the canonical baseline reducer (computeDebatePolicyBaseline).
//
// Failure ground: this test FAILS on `38f2c10` (the M15 Phase 1 closing
// SHA, where `decision.fire === true` silently returned `fired: false` —
// the executor was a no-op). It PASSES on `7e2eb44` and after.
//
// The proof is two-stage:
//   1. Drive a full DEFINE → PLAN → BUILD → VERIFY → REVIEW(round 1)
//      pipeline using `buildProviderRegistry({ providerOverride: 'fake' })`
//      so every ProviderId aliases to one shared FakeProvider while
//      registry.familyOf() preserves per-id families. The reviewer's
//      pre-debate persona response lands in the grey zone (score=5,
//      verdict='needs-revision' on one unresolved fix-first finding) so
//      the auto-mode debate scheduler fires under `score_in_grey_zone`.
//      The post-debate persona response (dispatched off the locked
//      composed-prompt discriminator '### Cross-family debate evidence
//      (DECISION.md)' from src/phases/review.ts:2376) lands score=8 +
//      verdict='ready' with a NEW fix-first finding marked resolved this
//      round (so it counts in `actionableFindingsAddedCount` via
//      diffFindingsForPostDebate but does not gate computeCanonicalVerdict
//      — same algebra the canonical fixture
//      `single-grey-zone-corrective` exercises).
//   2. Read events.jsonl from disk, build a synthetic FixtureRecord with
//      oracle={verdict: 'ready'}, feed it directly to
//      `computeDebatePolicyBaseline`. Assert firedCount=1, correctiveCount=1,
//      newActionableCount=1, both rule-21 floors satisfied,
//      `passedRuleTwentyOne === true`. The single-fixture set is the
//      smallest passing baseline; the panel/anti-corrective/no-signal
//      surfaces stay in tests/e2e/debate-scheduler-grey-zone.test.ts.

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { cp, mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDefine } from '../../src/phases/define.ts'
import { runPlan, PLAN_READY_SIGNAL } from '../../src/phases/plan.ts'
import { runBuild, type RunBuildOptions } from '../../src/phases/build.ts'
import { runVerify, VERIFY_READY_SIGNAL } from '../../src/phases/verify.ts'
import { runReview, REVIEW_READY_SIGNAL } from '../../src/phases/review.ts'
import { runApprove } from '../../src/commands/approve.ts'
import { buildProviderRegistry } from '../../src/cli/bootstrap.ts'
import { FakeProvider } from '../../src/providers/fake.ts'
import { ProviderRegistry } from '../../src/providers/registry.ts'
import type { InvokeContext } from '../../src/providers/invoke.ts'
import type { AgentDefinition } from '../../src/agents/schema.ts'
import {
  initRun,
  runPathsFor,
  type RunPaths,
  writeActiveRun,
} from '../../src/state/run.ts'
import {
  generateUlid,
  isKnownPhaseEvent,
  type LoggedEvent,
} from '../../src/state/schemas.ts'
import {
  DEFAULT_CONFIG,
  type AskMeConfig,
  type CodeOzConfig,
} from '../../src/config/schema.ts'
import { paths as codeOzPaths } from '../../src/paths.ts'
import { initProject } from '../../src/commands/init.ts'
import { createRunWorktree, runGit } from '../../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'
import { readEvents } from '../../src/state/events.ts'
import type { RevertSeam, RunnerSeam } from '../../src/phases/verify-mutation.ts'
import {
  computeDebatePolicyBaseline,
  type FixtureRecord,
} from '../../src/commands/doctor-debate-baseline.ts'

const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/greenfield-baby-name', import.meta.url))
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-04-30T12:00:00.000Z'
const INIT_NOW = '2026-04-30T11:00:00.000Z'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('debate-scheduler production-baseline e2e requires git >= 2.40')
  }
})

let tmp: string
let projectRoot: string
let codeOz: ReturnType<typeof codeOzPaths>
let paths: RunPaths
let registry: ProviderRegistry
let fake: FakeProvider

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c17-'))
  projectRoot = join(tmp, 'project')
  await cp(FIXTURE_SRC, projectRoot, { recursive: true })
  await initProject({ cwd: projectRoot, force: false })
  codeOz = codeOzPaths(projectRoot)
  paths = runPathsFor(codeOz.state, codeOz.artifacts, RUN)
  await mkdir(paths.runDir, { recursive: true })
  // C17: the production registry constructor with the providerOverride
  // knob flipped. Each ProviderId aliases to one shared FakeProvider while
  // registry.familyOf() answers per-id (so reviewer 'codex' family stays
  // distinct from opposing 'claude' family for the cross-family invariant
  // requestDebate enforces at line 178 of src/tools/debate-request.ts).
  const built = buildProviderRegistry({ providerOverride: 'fake' })
  registry = built.registry
  // built.fakeProvider is always defined when providerOverride is 'fake';
  // the non-null assertion documents the invariant for readers and lets
  // the variable type stay FakeProvider rather than FakeProvider | undefined.
  fake = built.fakeProvider!
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
// so the M9 cross-family invariant is satisfied. tool_use.debate declares
// 'claude' as the opposing family — A1 lock allows BUILD-family opponents
// (the cross-family invariant the runtime enforces is REVIEW-family !=
// opposing-family; rule 2 already enforced BUILD-family != REVIEW-family
// before the scheduler hook ran).
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
        debate: Object.freeze({
          tools: Object.freeze(['request-debate'] as const),
          opposingProviders: Object.freeze(['claude'] as const),
          maxRounds: 1,
          maxConcurrent: 1,
          maxFiles: 16,
          maxBytesPerFile: 65_536,
          timeoutMs: 600_000,
          previewBeforeSend: true,
          network: 'provider-only' as const,
        }),
      }),
    }),
    description: 'reviewer stub', body: '## Reviewer\n\nemit Findings + Score.',
  })
}

// --- per-test seam wiring -----------------------------------------

// Auto-mode debate-policy with the locked grey-zone band [5, 7]. Every
// other field tracks DEFAULT_DEBATE_POLICY so the scheduler's pure decision
// function only differs from M10 on `mode`.
function configWithAutoDebatePolicy(): CodeOzConfig {
  return {
    ...DEFAULT_CONFIG,
    debatePolicy: {
      mode: 'auto',
      maxPerRun: 2,
      maxPerTask: 1,
      triggers: {
        reviewScoreGreyZone: { min: 5, max: 7 },
        panelVoterDisagreement: true,
        needsRevisionWithHighScore: true,
      },
      cooldown: { dedupByFingerprint: true },
    },
  }
}

function invokeCtx(): InvokeContext {
  return {
    registry, runPaths: paths, projectRoot,
    config: configWithAutoDebatePolicy(),
    now: () => FIXED_NOW,
  }
}

function askMeConfig(): AskMeConfig {
  return DEFAULT_CONFIG.phases.define.askMe
}

// --- canned phase responses (mirror M9 review-lite-greenfield-pass) -

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

// --- pre/post debate persona responses -----------------------------

// PRE-debate reviewer draft. Lands score=5 + verdict='needs-revision'
// (one unresolved fix-first finding). Score in the locked grey-zone
// band [5, 7] triggers `score_in_grey_zone`. The persona shim returns
// this any time the composed prompt does NOT contain the post-debate
// discriminator (the locked phrase emitted only when REVIEW_CONTEXT
// renders postDebateEvidence — see src/phases/review.ts:2376).
const PRE_DEBATE_REVIEWER_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-NEW: topN docstring is missing edge-case note

- File: src/candidates.ts
- Line: 5
- Severity: fix-first
- Recommendation: add a note about empty input + how ties resolve.
- Round raised: 1
- Round resolved: unresolved

## Score

- Final score: 5
`

// POST-debate reviewer draft. Score=8 + verdict='ready' on a NEW
// fingerprint at fix-first severity, marked resolved this round so the
// canonical-verdict rule does not gate. The diff vs pre-debate findings
// reports findingsAddedCount=1 + actionableFindingsAddedCount=1
// (different `(file, normalized title)` fingerprint than the pre-debate
// finding; severity in the actionable set; the diff helper does not
// require the post finding be unresolved — only the canonical verdict
// does).
const POST_DEBATE_REVIEWER_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

### F-NEW: topN docstring should call out stable-sort guarantee

- File: src/candidates.ts
- Line: 5
- Severity: fix-first
- Recommendation: clarify that the sort is stable for tied scores.
- Round raised: 1
- Round resolved: 1

## Score

- Final score: 8
`

// --- canned debate artifact grammars ------------------------------

// Opposing RESPONSE.codex.md the FakeProvider-aliased 'claude' provider
// returns when the C13b executor invokes requestDebate. Frontmatter +
// the five required H2 sections per src/artifacts/debate.ts; the first
// non-empty line under `## Verdict on the decisions` matches the locked
// `Overall verdict: <enum>` grammar (D10 lock).
const OPPOSING_RESPONSE = `---
thread: c17-fake-opposing-thread
date: 2026-04-30
model: fake-default
brief: ../../artifacts/debates/${'review-r1-a1-t-001'}/BRIEFING.md
---

# RESPONSE.codex.md

## Verdict on the decisions

Overall verdict: accept-with-modifications

## Risks the proposing side missed

The reviewer's pre-debate verdict undervalued the fact that the docstring
addition is a modification-only change with no test surface delta. A
score of 5 reads conservative.

## Where I disagree

The fix-first severity is too strong for a docstring nit. A reader of the
worktree manifest sees one inserted comment line on src/candidates.ts; the
addition does not change topN's contract, only describes it.

## What I would defer

- Whether the docstring should mention the stable-sort guarantee.
- Whether topN should also document N=0 behavior.

## Recommended next step

Re-run REVIEW with the post-debate evidence; the verdict can move to
'ready' once the persona reconsiders severity.
`

// DECISION.md the FakeProvider returns from the synthesis turn. The
// caller is the reviewer agent, so the synthesis turn invokes
// {phase:'review', agent:'reviewer'} via the shared FakeProvider; the
// pre/post-debate persona invocations bypass the registry entirely (they
// flow through the runReview `invokePersona` shim), so this is the only
// `agent: 'reviewer'` expectation the registry sees.
//
// Frontmatter: the dual-verdict check (D5 lock) requires
// `opposing_verdict` to match the parsed RESPONSE.overallVerdict; we keep
// both at 'accept-with-modifications'. Rationale stays well below the
// 200-char exact-copy floor and uses prose distinct from the opposing
// rationale (the validator only fires the exact-copy check on rationales
// >= 200 chars).
const SYNTHESIS_DECISION = `---
date: 2026-04-30
resolved_by: "reviewer (REVIEW debate scheduler, round 1)"
caller_verdict: accept-with-modifications
opposing_verdict: accept-with-modifications
---

# Decision - review-r1-a1-t-001

## Verdict

Overall verdict: accept-with-modifications

## Rationale

The opposing party's severity argument lands. The post-debate REVIEW round
will keep the docstring concern but lower it from fix-first-unresolved to
fix-first-resolved-this-round, and the score moves to 8.

## What changes (artifact deltas)

- REVIEW.md: post-debate round replaces the canonical artifact for round 1.
- Score: 5 -> 8.

## What does not change

- BUILD_REPORT.md is canonical.
- VERIFY.md verdict stays pass.

## Open follow-ups

- None.
`

// --- VERIFY seams (mirror M9 review-lite-greenfield-pass) --------

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

// --- helpers -----------------------------------------------------

const POST_DEBATE_DISCRIMINATOR = '### Cross-family debate evidence (DECISION.md)'

function reviewerPersonaShim(): (composedPrompt: string) => Promise<string> {
  return async (composedPrompt: string) => {
    return composedPrompt.includes(POST_DEBATE_DISCRIMINATOR)
      ? POST_DEBATE_REVIEWER_RESPONSE
      : PRE_DEBATE_REVIEWER_RESPONSE
  }
}

function findEvent<T extends string>(
  events: readonly LoggedEvent[],
  type: T,
): (LoggedEvent & { type: T }) | undefined {
  return events.find((e) => e.type === type) as
    | (LoggedEvent & { type: T })
    | undefined
}

function countEvents(events: readonly LoggedEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

// --- the e2e test --------------------------------------------------

describe('M15 Phase 2 C17 — production fire-path executor proven end-to-end', () => {
  test(
    'auto-mode grey-zone fire emits debate_scheduler_postreview from real production trace; computeDebatePolicyBaseline reports rule-21 PASS on the production-emitted events',
    async () => {
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
      const approveBuild = await runApprove({ cwd: projectRoot, phase: 'build', now: () => FIXED_NOW })
      expect(approveBuild.approved).toBe(true)

      // 5. VERIFY
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
      const approveVerify = await runApprove({ cwd: projectRoot, phase: 'verify', now: () => FIXED_NOW })
      expect(approveVerify.approved).toBe(true)

      // 6. REVIEW (round 1) — auto-mode debate scheduler fires.
      //
      // FakeProvider expectations for the review phase:
      //   - {agent:'scientist'}: TWO calls (pre-debate + post-debate
      //     scientist tail). The same canned response works for both.
      //   - {agent:'debate-opponent'}: opposing turn the C13b executor
      //     drives via requestDebate's invokeAgent on the synthetic
      //     debate-opponent agent (src/tools/debate-request.ts:704).
      //   - {agent:'reviewer'}: synthesis turn (DECISION.md). The
      //     pre/post-debate reviewer-persona invocations flow through
      //     the runReview invokePersona shim and bypass the registry.
      fake.reset()
      fake.expect({ phase: 'review', agent: 'scientist' })
        .respondWith({ content: REVIEW_SCIENTIST_RESPONSE })
        .respondWith({ content: REVIEW_SCIENTIST_RESPONSE })
      fake.expect({ phase: 'review', agent: 'debate-opponent' }).respondWith({ content: OPPOSING_RESPONSE })
      fake.expect({ phase: 'review', agent: 'reviewer' }).respondWith({ content: SYNTHESIS_DECISION })

      const reviewResult = await runReview({
        runPaths: paths, runId: RUN, cwd: projectRoot,
        reviewerAgent: reviewerAgent(),
        scientistAgent: scientistAgent('review'),
        taskId: 'T-001',
        invokeCtx: invokeCtx(),
        invokePersona: reviewerPersonaShim(),
        now: () => FIXED_NOW,
        round: 1,
      })

      expect(reviewResult.status).toBe('resolved')
      if (reviewResult.status !== 'resolved') return
      // Post-debate verdict + score replace the pre-debate ones (the
      // executor closure swaps `outcome` to the post-debate
      // RoundCompleteOutcome before finalizeReviewRound consumes it).
      expect(reviewResult.verdict).toBe('ready')
      expect(reviewResult.score).toBe(8)
      expect(reviewResult.round).toBe(1)

      // ---------------------------------------------------------------
      // Stage 1 — production-emitted scheduler trace.
      // ---------------------------------------------------------------
      const events = (
        await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })
      ).filter(isKnownPhaseEvent)

      // Two `review_round_completed` events for round 1 (pre-debate +
      // post-debate); the post-debate body emits its own
      // review_round_completed with the same round number per the
      // m15_phase2_replan locked semantic decision.
      const reviewRoundCompleted = events.filter(
        (e) => e.type === 'review_round_completed',
      ) as readonly (LoggedEvent & { type: 'review_round_completed' })[]
      expect(reviewRoundCompleted.length).toBe(2)
      expect(reviewRoundCompleted.every((e) => (e as { round: number }).round === 1)).toBe(true)

      // Scheduler lifecycle: one evaluated → one fired → one postreview.
      // The pre-debate round emitted evaluated; the post-debate recursive
      // round runs with `schedulerEnabled: 'disabled_post_debate'` so it
      // does NOT recurse on the scheduler hook (Codex replan Risk #5).
      expect(countEvents(events, 'debate_scheduler_evaluated')).toBe(1)
      expect(countEvents(events, 'debate_scheduler_fired')).toBe(1)
      expect(countEvents(events, 'debate_scheduler_postreview')).toBe(1)
      expect(countEvents(events, 'debate_scheduler_skipped')).toBe(0)
      expect(countEvents(events, 'debate_scheduler_error')).toBe(0)

      // C13a contract — `fired` precedes `debate_started`. Without C13a,
      // requestDebate's synchronous appendEvent inside its body would
      // emit debate_started before the scheduler hook recorded `fired`.
      const firedIdx = events.findIndex((e) => e.type === 'debate_scheduler_fired')
      const startedIdx = events.findIndex((e) => e.type === 'debate_started')
      expect(firedIdx).toBeGreaterThan(-1)
      expect(startedIdx).toBeGreaterThan(-1)
      expect(firedIdx).toBeLessThan(startedIdx)

      // Fire reason is grey-zone; opposing family is 'claude' (per the
      // reviewer's tool_use.debate.opposingProviders list, intersected
      // with M11 eligibility + cross-family vs reviewer family 'codex').
      const fired = findEvent(events, 'debate_scheduler_fired') as
        | (LoggedEvent & {
            reason: string
            opposingProvider: string
            decisionId: string
          })
        | undefined
      expect(fired?.reason).toBe('score_in_grey_zone')
      expect(fired?.opposingProvider).toBe('claude')

      // M10 lifecycle paired (debate_started + debate_resolved) on the
      // same topic.
      const started = findEvent(events, 'debate_started') as
        | (LoggedEvent & { topic: string; opposingProvider: string; opposingFamily: string })
        | undefined
      const resolved = findEvent(events, 'debate_resolved') as
        | (LoggedEvent & { topic: string })
        | undefined
      expect(started).toBeDefined()
      expect(resolved).toBeDefined()
      expect(started?.topic).toBe(resolved?.topic)
      expect(started?.opposingProvider).toBe('claude')
      // Cross-family: reviewer family is 'codex', opposing family is
      // 'claude'. requestDebate's runtime check at line 178 of
      // src/tools/debate-request.ts asserts caller-family !=
      // opposing-family; if the providerOverride seam ever stopped
      // preserving per-id families, this would fail.
      expect(started?.opposingFamily).toBe('claude')

      // Postreview scalars — verdictPre/post + diff counts from the real
      // production trace. The pre-debate canonical findings carried one
      // unresolved fix-first finding; the post-debate canonical findings
      // carry one fix-first finding at a different fingerprint. Diff:
      // findingsAddedCount=1, actionableFindingsAddedCount=1.
      const post = findEvent(events, 'debate_scheduler_postreview') as
        | (LoggedEvent & {
            verdictPre: string
            verdictPost: string
            findingsAddedCount: number
            actionableFindingsAddedCount: number
            decisionId: string
            preReviewReportSha256: string
            postReviewReportSha256: string
          })
        | undefined
      expect(post?.verdictPre).toBe('needs-revision')
      expect(post?.verdictPost).toBe('ready')
      expect(post?.findingsAddedCount).toBe(1)
      expect(post?.actionableFindingsAddedCount).toBe(1)
      expect(post?.decisionId).toBe(fired?.decisionId)
      // Pre vs post sha differ — the canonical REVIEW.md was rewritten
      // by the recursive post-debate round.
      expect(post?.preReviewReportSha256).not.toBe(post?.postReviewReportSha256)

      // The canonical REVIEW.md on disk holds the post-debate verdict.
      const reviewMd = await readFile(reviewResult.reviewReportPath, 'utf8')
      expect(reviewMd).toContain('- Final verdict: ready')

      // ---------------------------------------------------------------
      // Stage 2 — production events feed the rule-21 baseline reducer.
      // ---------------------------------------------------------------
      // Build a synthetic FixtureRecord around the real events.jsonl
      // contents. Oracle = 'ready' (the post-debate verdict matches; the
      // pre-debate verdict 'needs-revision' was at distance 1 from the
      // oracle, the post-debate verdict 'ready' is at distance 0 -> the
      // delta classifier reports 'corrective').
      const fixture: FixtureRecord = {
        name: 'c17-production-greenfield-corrective',
        oracle: { verdict: 'ready' },
        controlEvents: [],
        treatmentEvents: events,
      }
      const baseline = computeDebatePolicyBaseline([fixture])

      expect(baseline.firedCount).toBe(1)
      expect(baseline.errorCount).toBe(0)
      expect(baseline.missingTerminalCount).toBe(0)
      expect(baseline.correctiveCount).toBe(1)
      expect(baseline.antiCorrectiveCount).toBe(0)
      expect(baseline.noSignalCount).toBe(0)
      expect(baseline.newActionableCount).toBe(1)
      expect(baseline.correctiveDeltaRate).toBe(1)
      expect(baseline.newActionableFindingRate).toBe(1)
      expect(baseline.passedRuleTwentyOne).toBe(true)

      // Per-trigger breakdown: one fire under score_in_grey_zone, all
      // other triggers untouched.
      const greyRow = baseline.perTriggerBreakdown.find(
        (r) => r.reason === 'score_in_grey_zone',
      )
      expect(greyRow?.fired).toBe(1)
      expect(greyRow?.correctiveCount).toBe(1)
      expect(greyRow?.newActionableCount).toBe(1)
      const otherRows = baseline.perTriggerBreakdown.filter(
        (r) => r.reason !== 'score_in_grey_zone',
      )
      for (const row of otherRows) {
        expect(row.fired).toBe(0)
        expect(row.correctiveCount).toBe(0)
        expect(row.newActionableCount).toBe(0)
      }
    },
  )
})
