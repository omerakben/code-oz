// M9 commit 10 — runReview integration: round 4 needs-revision exits as
// blocked + emits review_blocked(reason='cap_exhausted') + writes
// NEEDS_INTERVENTION.json with code 'review_cap_exhausted_terminal'.
//
// Mirrors tests/review-phase.test.ts setup but seeds 3 prior REVIEW
// rounds + 4 prior BUILD attempts so the coordinator's decision flips
// to review_cap_exhausted on the 4th round's needs-revision exit.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runReview } from '../src/phases/review.ts'
import {
  serializeReviewReport,
  type ReviewReportData,
} from '../src/artifacts/review-report.ts'
import { runPathsFor, initRun, type RunPaths } from '../src/state/run.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { FakeProvider } from '../src/providers/fake.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type { InvokeContext } from '../src/providers/invoke.ts'
import { appendEvent, readEvents } from '../src/state/events.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const NOW = '2026-04-30T19:00:00.000Z'

const REVIEWER_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/reviewer.md',
  name: 'reviewer',
  type: 'agent',
  phase: 'review',
  provider: 'codex',
  modelPolicy: 'any',
  permissions: Object.freeze({
    read: '*' as const,
    write: Object.freeze(['.code-oz/artifacts/REVIEW.md']),
    bash: 'deny' as const,
  }),
  description: 'reviewer stub.',
  body: '# Reviewer\n\nstub.',
})

const SCIENTIST_AGENT: AgentDefinition = Object.freeze({
  file: '/tmp/scientist.md',
  name: 'scientist',
  type: 'agent',
  phase: 'review',
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
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-review-cap-'))
  const stateDir = join(tmp, '.code-oz/state')
  const artifactRoot = join(tmp, '.code-oz/artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(paths.runDir, { recursive: true })
  await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => NOW })
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
    now: () => NOW,
  }
}

const PLAN_SHA = 'a'.repeat(64)
const BASE_COMMIT_SHA = 'b'.repeat(40)
const PATCH_SHA = 'c'.repeat(64)
const FILE_SHA = 'd'.repeat(64)
const BUILD_REPORT_SHA = 'e'.repeat(64)

function makeBuildReport(attempt: number): string {
  const cf =
    attempt === 1
      ? `- None (attempt 1).`
      : [
          '- Source: review-needs-revision',
          `- Prior attempt: ${attempt - 1}`,
          '- Prior forensics: .code-oz/artifacts/REVIEW.md',
          '- Prior validation command: bun test tests/foo.test.ts',
          `- Prior verdict: needs-revision (round ${attempt - 1}, sha ${'f'.repeat(64)})`,
          '- Prior failure summary: prior round had findings',
          '- Constraint: address those findings',
        ].join('\n')
  return `# BUILD_REPORT

## Task

- Task: T-001
- Title: stub
- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: ${PLAN_SHA})
- Attempt: ${attempt}

## Base

- Worktree: .code-oz/runs/<runId>/worktree/
- Base commit: ${BASE_COMMIT_SHA}
- Dirty tree at base: false

## Patch

- Patch path: .code-oz/runs/<runId>/patches/attempt-${attempt}.patch
- Patch sha256: ${PATCH_SHA}
- Patch byte count: 100

## Changed files

- src/foo.ts | sha256: ${FILE_SHA} | change: modified

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Failure carry-forward

${cf}

## Notes

- stub.
`
}

function makeVerifyReport(attempt: number): string {
  return `# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${BUILD_REPORT_SHA})
- Task: T-001
- Attempt: ${attempt}
- Base commit: ${BASE_COMMIT_SHA}
- Patch sha256: ${PATCH_SHA}

## Validation command

- Command: bun test tests/foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: 0
- Duration (ms): 100
- Stdout bytes: 0
- Stderr bytes: 0
- Stdout log: .code-oz/runs/${RUN}/forensics/${attempt}/stdout.log
- Stderr log: .code-oz/runs/${RUN}/forensics/${attempt}/stderr.log

## Verdict

- Verdict: pass
- Rationale: tests passed

## Mutation

- Status: not-applicable
- Notes: only modifications

## Failure constraint

- None (verdict pass).
`
}

function makeNeedsRevisionPersonaResponse(score: number): string {
  return `<review-ready/>

## Findings

### F-NEW: persistent issue
- File: src/foo.ts
- Line: 1
- Severity: fix-first
- Recommendation: still needs work
- Round raised: 1
- Round resolved: unresolved


## Score

- Final score: ${score}
`
}

async function seedRound(round: number, attempt: number): Promise<void> {
  // build_provider_recorded for attempt N (different family to satisfy
  // cross-family check at round N+1).
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_provider_recorded',
      ts: NOW,
      runId: RUN,
      phase: 'build',
      attempt,
      taskId: 'T-001',
      provider: 'claude',
      family: 'claude',
    },
  )
  // build_completed for attempt N
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_completed',
      ts: NOW,
      runId: RUN,
      phase: 'build',
      agent: 'builder',
      attempt,
      taskId: 'T-001',
      changedFileCount: 1,
      buildReportSha256: BUILD_REPORT_SHA,
      promptSnapshotSha256: BUILD_REPORT_SHA,
    },
  )
  // review_round_completed for round N
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'review_round_completed',
      ts: NOW,
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt,
      taskId: 'T-001',
      round,
      score: 4,
      verdict: 'needs-revision',
      findingsRaised: 1,
      findingsResolved: 0,
      reviewReportSha256: 'a'.repeat(64),
    },
  )
}

describe('runReview integration — REVIEW cap exhausted on round 4', () => {
  test('round 4 needs-revision after 3 prior rounds → blocked + review_blocked(reason=cap_exhausted)', async () => {
    // Seed rounds 1-3 (needs-revision exits) and matching BUILD attempts 1-3.
    await seedRound(1, 1)
    await seedRound(2, 2)
    await seedRound(3, 3)

    // Seed BUILD/VERIFY artifacts for attempt 4 + build_provider_recorded for it.
    await writeFile(join(paths.artifactRoot, 'BUILD_REPORT.md'), makeBuildReport(4))
    await writeFile(join(paths.artifactRoot, 'VERIFY.md'), makeVerifyReport(4))
    // Stage the worktree file the persona's finding will cite
    // (src/foo.ts) so the line-range existence check passes.
    const worktreeFile = join(tmp, '.code-oz/runs', RUN, 'worktree', 'src/foo.ts')
    await mkdir(dirname(worktreeFile), { recursive: true })
    await writeFile(
      worktreeFile,
      Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n',
    )
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      {
        version: 1,
        type: 'build_provider_recorded',
        ts: NOW,
        runId: RUN,
        phase: 'build',
        attempt: 4,
        taskId: 'T-001',
        provider: 'claude',
        family: 'claude',
      },
    )

    // Synthesize a valid prior REVIEW.md carrying rounds 1-3 in its
    // timeline. The orchestrator merges this with round 4's bullet so
    // the parser's contiguous-from-1 invariant is satisfied.
    const priorReviewData: ReviewReportData = Object.freeze({
      upstreamRefs: Object.freeze({
        buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
        buildReportSha256: BUILD_REPORT_SHA,
        verifyReportPath: '.code-oz/artifacts/VERIFY.md',
        verifyReportSha256: 'a'.repeat(64),
        taskId: 'T-001',
        attempt: 4,
        baseCommitSha: BASE_COMMIT_SHA,
        patchSha256: PATCH_SHA,
      }),
      reviewer: Object.freeze({
        providerFamily: 'codex',
        providerId: 'codex',
        modelPolicy: 'any',
        crossFamilyCheck: 'passed' as const,
        buildFamily: 'claude',
      }),
      roundTimeline: Object.freeze([
        Object.freeze({
          round: 1, timestamp: NOW, findingsRaised: 1,
          score: 4, verdict: 'needs-revision' as const,
        }),
        Object.freeze({
          round: 2, timestamp: NOW, findingsRaised: 0,
          score: 4, verdict: 'needs-revision' as const,
        }),
        Object.freeze({
          round: 3, timestamp: NOW, findingsRaised: 0,
          score: 4, verdict: 'needs-revision' as const,
        }),
      ]),
      findings: Object.freeze([
        Object.freeze({
          id: 'F-001',
          title: 'persistent issue',
          file: 'src/foo.ts',
          line: '1',
          severity: 'fix-first' as const,
          recommendation: 'still needs work',
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }),
      ]),
      score: Object.freeze({
        roundCount: 3, finalScore: 4,
        finalVerdict: 'needs-revision' as const,
        exitReason: 'needs-revision (round 3)',
      }),
      capStatus: Object.freeze({
        cap: 4, roundsUsed: 3, capExhausted: false,
      }),
    })
    const priorReviewMd = serializeReviewReport(priorReviewData)

    // Run REVIEW round 4 with a needs-revision persona response.
    const result = await runReview({
      runPaths: paths,
      runId: RUN,
      cwd: tmp,
      reviewerAgent: REVIEWER_AGENT,
      scientistAgent: SCIENTIST_AGENT,
      taskId: 'T-001',
      invokeCtx: invokeCtx(),
      invokePersona: async () => makeNeedsRevisionPersonaResponse(4),
      now: () => NOW,
      round: 4,
      priorReviewMd,
    })

    // Cap-exhausted exits as blocked, NOT needs_revision.
    if (result.status === 'intervention') {
      // Surface the code so a regression in earlier guards is visible.
      throw new Error(`expected blocked, got intervention: code=${result.code} rule=${result.rule}`)
    }
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    // The runReview blocked variant exposes verdict='block' (the
    // canonical-verdict value the cap-exhaust branch uses to signal
    // terminal state to the caller).
    expect(result.verdict).toBe('block')
    expect(result.round).toBe(4)

    // review_blocked event with reason='cap_exhausted' present.
    const events = (await readEvents({ file: paths.eventsFile, lockDir: paths.lockDir })).filter(
      isKnownPhaseEvent,
    )
    const blocked = events.find((e) => e.type === 'review_blocked')
    expect(blocked).toBeDefined()
    if (blocked && blocked.type === 'review_blocked') {
      expect(blocked.reason).toBe('cap_exhausted')
      expect(blocked.finalRound).toBe(4)
    }

    // NEEDS_INTERVENTION.json with code=review_cap_exhausted_terminal.
    const needsTxt = await readFile(join(paths.runDir, 'NEEDS_INTERVENTION.json'), 'utf8')
    expect(needsTxt).toContain('review_cap_exhausted_terminal')

    // intervention event also emitted
    expect(
      events.some(
        (e) => e.type === 'intervention' && e.code === 'review_cap_exhausted_terminal',
      ),
    ).toBe(true)
  })
})
