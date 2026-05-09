// CLI dispatchReview tests (M16 C8).
//
// Same scope discipline as C6/C7: helper unit tests + dispatcher refusal
// cases. The happy-path REVIEW pass against a real BUILD/VERIFY output
// lives in the C12 e2e (tests/e2e/cli-multi-task-cycle.test.ts).
//
// Codex C8 pre-design review (5 block-push + 4 fix-soon + 1 nit) pinned
// these load-bearing concerns the helpers + dispatcher implement:
//
//   1. `nextReviewRound` is persisted via a new
//      `review_remediation_recorded` event and resolved at dispatch
//      via `resolveNextReviewRound`.
//   2. `runReview` self-locks `.review.lock`; the dispatcher does NOT
//      acquire it.
//   3. `resolveReviewArtifacts` re-validates BUILD_REPORT.md +
//      VERIFY.md shas before invoking runReview.
//   4. `needs_revision` exits with EXIT_INTERVENTION via
//      `exitCodeForPhaseResult`, NOT EXIT_OK.
//   5. `productionPanelistInvoker` is wired whenever panel.length >= 2.
//   6. `runReview` owns panel-vs-single via `shouldUseReviewPanel`.
//   7. Panel capability gating fails fast in `loadConfig`.
//   8. Scheduler one-liner reads from events.jsonl delta only.
//   9. `handleActiveRun` REVIEW branch rejects `--task` (BUILD-only).
//  10. `--provider fake` aliases preserve provider id family.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPathsFor, type RunPaths } from '../src/state/run.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { dispatchReview } from '../src/commands/run.ts'
import {
  detectSchedulerFireOneLine,
  findLatestBuildCompletedForReview,
  findLatestReviewRemediation,
  findLatestVerifyCompletedForReview,
  readPriorReviewMd,
  resolveNextReviewRound,
  resolveReviewArtifacts,
} from '../src/commands/dispatch-review-helpers.ts'
import type { LoggedEvent } from '../src/state/schemas.ts'

const FIXED_TS = '2026-05-09T12:00:00.000Z'
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

let tmp: string
let stateDir: string
let artifactRoot: string
let runPaths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-c8-'))
  stateDir = join(tmp, 'state')
  artifactRoot = join(tmp, 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  runPaths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(runPaths.runDir, { recursive: true })
  await mkdir(runPaths.lockDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// --- helpers ------------------------------------------------------

const PLAN_TXT = `# PLAN

## Goals

- Two atomic slices.
- Each independently testable.

## Tasks

### T-001: first slice

- Files: src/foo.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

### T-002: second slice

- Files: src/bar.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Anything beyond the two slices.

## Open questions

- None known at plan time.
`

async function writePlan(): Promise<void> {
  await writeFile(join(artifactRoot, 'PLAN.md'), PLAN_TXT, 'utf8')
}

function buildCompleted(opts: {
  taskId: string
  attempt: number
  buildReportSha: string
  promptSha: string
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'build_completed',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'build' as const,
    agent: 'builder',
    attempt: opts.attempt,
    taskId: opts.taskId,
    changedFileCount: 1,
    buildReportSha256: opts.buildReportSha,
    promptSnapshotSha256: opts.promptSha,
  } as unknown as LoggedEvent
}

function verifyCompleted(opts: {
  taskId: string
  attempt: number
  verifyReportSha: string
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'verify_completed',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'verify' as const,
    agent: 'verifier',
    attempt: opts.attempt,
    taskId: opts.taskId,
    verifyReportSha256: opts.verifyReportSha,
    mutationStatus: 'not-applicable' as const,
  } as unknown as LoggedEvent
}

function reviewRemediation(opts: {
  taskId: string
  attempt: number
  reviewRound: number
  nextReviewRound: number
  reviewMdSha?: string
  decisionId?: string
}): LoggedEvent {
  const sha = opts.reviewMdSha ?? 'b'.repeat(64)
  return {
    version: 1 as const,
    type: 'review_remediation_recorded',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'review' as const,
    agent: 'reviewer',
    attempt: opts.attempt,
    taskId: opts.taskId,
    reviewRound: opts.reviewRound,
    nextReviewRound: opts.nextReviewRound,
    decisionId: opts.decisionId ?? generateUlid({ now: 1_000_000_005_000, random: new Uint8Array(10) }),
    reviewMdSha256: sha,
    remediationIntent: 'continue' as const,
    refsTo: { type: 'review_round_completed' as const, reviewReportSha256: sha },
  } as unknown as LoggedEvent
}

function debateSchedulerFired(opts: {
  taskId: string
  attempt: number
  reviewRound: number
  decisionId: string
  opposingProvider: string
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'debate_scheduler_fired',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'review' as const,
    agent: 'reviewer',
    attempt: opts.attempt,
    taskId: opts.taskId,
    decisionId: opts.decisionId,
    reviewRound: opts.reviewRound,
    reason: 'score_in_grey_zone' as const,
    opposingProvider: opts.opposingProvider,
    debateTopic: 'review-grey-zone-debate',
    preReviewReportSha256: 'b'.repeat(64),
  } as unknown as LoggedEvent
}

function debateSchedulerPostreview(opts: {
  taskId: string
  attempt: number
  reviewRound: number
  decisionId: string
  actionableFindingsAddedCount: number
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'debate_scheduler_postreview',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'review' as const,
    agent: 'reviewer',
    attempt: opts.attempt,
    taskId: opts.taskId,
    decisionId: opts.decisionId,
    reviewRound: opts.reviewRound,
    preReviewReportSha256: 'b'.repeat(64),
    postReviewReportSha256: 'c'.repeat(64),
    verdictPre: 'needs-revision' as const,
    verdictPost: 'needs-revision' as const,
    findingsAddedCount: opts.actionableFindingsAddedCount + 1,
    actionableFindingsAddedCount: opts.actionableFindingsAddedCount,
  } as unknown as LoggedEvent
}

function debateResolved(opts: {
  callerVerdict: 'accept' | 'accept-with-modifications' | 'reject' | 'feature-with-modifications'
}): LoggedEvent {
  return {
    version: 1 as const,
    type: 'debate_resolved',
    ts: FIXED_TS,
    runId: RUN,
    phase: 'review' as const,
    agent: 'reviewer',
    topic: 'review-grey-zone-debate',
    debateDirPath: '/tmp/x',
    decisionSha256: 'd'.repeat(64),
    callerVerdict: opts.callerVerdict,
    responseVerdict: 'accept' as const,
    rationaleSummary: 'short summary',
  } as unknown as LoggedEvent
}

// --- findLatestBuildCompletedForReview / findLatestVerifyCompletedForReview ---

describe('findLatestBuildCompletedForReview', () => {
  test('returns null when no events match', () => {
    expect(findLatestBuildCompletedForReview([], RUN, 'T-001')).toBeNull()
  })

  test('returns latest matching event', () => {
    const result = findLatestBuildCompletedForReview(
      [
        buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
        buildCompleted({ taskId: 'T-001', attempt: 2, buildReportSha: 'c'.repeat(64), promptSha: 'd'.repeat(64) }),
      ],
      RUN,
      'T-001',
    )
    expect(result!.attempt).toBe(2)
    expect(result!.buildReportSha256).toBe('c'.repeat(64))
  })

  test('does not match different taskId', () => {
    const ev = buildCompleted({ taskId: 'T-002', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) })
    expect(findLatestBuildCompletedForReview([ev], RUN, 'T-001')).toBeNull()
  })
})

describe('findLatestVerifyCompletedForReview', () => {
  test('returns null when no events match', () => {
    expect(findLatestVerifyCompletedForReview([], RUN, 'T-001')).toBeNull()
  })

  test('carries verifyReportSha256', () => {
    const ev = verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: 'e'.repeat(64) })
    const result = findLatestVerifyCompletedForReview([ev], RUN, 'T-001')
    expect(result!.verifyReportSha256).toBe('e'.repeat(64))
  })
})

// --- findLatestReviewRemediation + resolveNextReviewRound ----------

describe('findLatestReviewRemediation', () => {
  test('returns null when no events match', () => {
    expect(findLatestReviewRemediation([], RUN, 'T-001', 1)).toBeNull()
  })

  test('matches on (runId, taskId, attempt) — different attempt is null', () => {
    const ev = reviewRemediation({ taskId: 'T-001', attempt: 1, reviewRound: 1, nextReviewRound: 2 })
    expect(findLatestReviewRemediation([ev], RUN, 'T-001', 2)).toBeNull()
    expect(findLatestReviewRemediation([ev], RUN, 'T-001', 1)?.nextReviewRound).toBe(2)
  })

  test('returns the most recent when multiple match', () => {
    const ev1 = reviewRemediation({ taskId: 'T-001', attempt: 1, reviewRound: 1, nextReviewRound: 2 })
    const ev2 = reviewRemediation({ taskId: 'T-001', attempt: 1, reviewRound: 2, nextReviewRound: 3 })
    const result = findLatestReviewRemediation([ev1, ev2], RUN, 'T-001', 1)
    expect(result!.nextReviewRound).toBe(3)
  })
})

describe('resolveNextReviewRound', () => {
  test('returns 1 when no prior remediation event', () => {
    expect(resolveNextReviewRound([], RUN, 'T-001', 1)).toBe(1)
  })

  test('returns nextReviewRound from latest remediation event', () => {
    const ev = reviewRemediation({ taskId: 'T-001', attempt: 1, reviewRound: 1, nextReviewRound: 2 })
    expect(resolveNextReviewRound([ev], RUN, 'T-001', 1)).toBe(2)
  })

  test('returns 1 for a different attempt even when remediation exists for another', () => {
    // attempt 1 has a remediation pointing at round 3; attempt 2 has none
    // → attempt 2 is round 1.
    const ev = reviewRemediation({ taskId: 'T-001', attempt: 1, reviewRound: 2, nextReviewRound: 3 })
    expect(resolveNextReviewRound([ev], RUN, 'T-001', 2)).toBe(1)
  })
})

// --- resolveReviewArtifacts ---------------------------------------

describe('resolveReviewArtifacts', () => {
  test("returns 'drift' when no build_completed event present", async () => {
    const result = await resolveReviewArtifacts({
      events: [],
      runId: RUN,
      taskId: 'T-001',
      artifactRoot,
    })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('build_completed')
  })

  test("returns 'drift' when no verify_completed event present", async () => {
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('verify_completed')
  })

  test("returns 'drift' when build/verify attempts disagree (restart loop mid-flight)", async () => {
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 2, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: 'c'.repeat(64) }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('mid-flight')
  })

  test("returns 'drift' when BUILD_REPORT.md is missing", async () => {
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: 'a'.repeat(64), promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: 'c'.repeat(64) }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('BUILD_REPORT.md not found')
  })

  test("returns 'drift' on BUILD_REPORT.md sha mismatch", async () => {
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), 'tampered build report', 'utf8')
    await writeFile(join(artifactRoot, 'VERIFY.md'), 'irrelevant', 'utf8')
    const wrongBuildSha = 'a'.repeat(64) // not the sha of "tampered build report"
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: wrongBuildSha, promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: 'c'.repeat(64) }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('BUILD_REPORT.md sha')
  })

  test("returns 'drift' when VERIFY.md is missing", async () => {
    const buildText = 'real build report\n'
    const buildSha = await sha256(buildText)
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), buildText, 'utf8')
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: buildSha, promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: 'c'.repeat(64) }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('VERIFY.md not found')
  })

  test("returns 'drift' on VERIFY.md sha mismatch", async () => {
    const buildText = 'real build report\n'
    const buildSha = await sha256(buildText)
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), buildText, 'utf8')
    await writeFile(join(artifactRoot, 'VERIFY.md'), 'tampered verify', 'utf8')
    const wrongVerifySha = 'c'.repeat(64) // not the sha of "tampered verify"
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: buildSha, promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: wrongVerifySha }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('drift')
    if (result.kind === 'drift') expect(result.reason).toContain('VERIFY.md sha')
  })

  test("returns 'ok' with both texts + matched shas + attempt", async () => {
    const buildText = 'real build report\n'
    const verifyText = 'real verify\n'
    const buildSha = await sha256(buildText)
    const verifySha = await sha256(verifyText)
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), buildText, 'utf8')
    await writeFile(join(artifactRoot, 'VERIFY.md'), verifyText, 'utf8')
    const events = [
      buildCompleted({ taskId: 'T-001', attempt: 1, buildReportSha: buildSha, promptSha: 'b'.repeat(64) }),
      verifyCompleted({ taskId: 'T-001', attempt: 1, verifyReportSha: verifySha }),
    ]
    const result = await resolveReviewArtifacts({ events, runId: RUN, taskId: 'T-001', artifactRoot })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.artifacts.buildReportText).toBe(buildText)
      expect(result.artifacts.verifyReportText).toBe(verifyText)
      expect(result.artifacts.buildReportSha256).toBe(buildSha)
      expect(result.artifacts.verifyReportSha256).toBe(verifySha)
      expect(result.artifacts.attempt).toBe(1)
    }
  })
})

// --- readPriorReviewMd --------------------------------------------

describe('readPriorReviewMd', () => {
  test('returns null when REVIEW.md absent', async () => {
    expect(await readPriorReviewMd(artifactRoot)).toBeNull()
  })

  test('returns content when REVIEW.md present', async () => {
    await writeFile(join(artifactRoot, 'REVIEW.md'), '# REVIEW round 1', 'utf8')
    expect(await readPriorReviewMd(artifactRoot)).toBe('# REVIEW round 1')
  })
})

// --- detectSchedulerFireOneLine -----------------------------------

describe('detectSchedulerFireOneLine', () => {
  test('returns null when no fire event in delta', () => {
    expect(
      detectSchedulerFireOneLine([], { runId: RUN, taskId: 'T-001', attempt: 1, reviewRound: 1 }),
    ).toBeNull()
  })

  test('joins fired + postreview by decisionId; uses opposingProvider + actionableFindingsAddedCount', () => {
    const decisionId = generateUlid({ now: 1_000_000_006_000, random: new Uint8Array(10) })
    const events: LoggedEvent[] = [
      debateSchedulerFired({
        taskId: 'T-001', attempt: 1, reviewRound: 1,
        decisionId,
        opposingProvider: 'codex',
      }),
      debateSchedulerPostreview({
        taskId: 'T-001', attempt: 1, reviewRound: 1,
        decisionId,
        actionableFindingsAddedCount: 2,
      }),
      debateResolved({ callerVerdict: 'accept-with-modifications' }),
    ]
    const result = detectSchedulerFireOneLine(events, {
      runId: RUN, taskId: 'T-001', attempt: 1, reviewRound: 1,
    })
    expect(result).not.toBeNull()
    expect(result!.opposingProvider).toBe('codex')
    expect(result!.actionableFindingsAddedCount).toBe(2)
    expect(result!.verdict).toBe('accept-with-modifications')
  })

  test('verdict falls back to "unknown" when debate_resolved is absent', () => {
    const decisionId = generateUlid({ now: 1_000_000_007_000, random: new Uint8Array(10) })
    const events: LoggedEvent[] = [
      debateSchedulerFired({
        taskId: 'T-001', attempt: 1, reviewRound: 1, decisionId, opposingProvider: 'codex',
      }),
    ]
    const result = detectSchedulerFireOneLine(events, {
      runId: RUN, taskId: 'T-001', attempt: 1, reviewRound: 1,
    })
    expect(result!.verdict).toBe('unknown')
    expect(result!.actionableFindingsAddedCount).toBe(0)
  })

  test('does not match a different reviewRound', () => {
    const decisionId = generateUlid({ now: 1_000_000_008_000, random: new Uint8Array(10) })
    const events: LoggedEvent[] = [
      debateSchedulerFired({
        taskId: 'T-001', attempt: 1, reviewRound: 1, decisionId, opposingProvider: 'codex',
      }),
    ]
    expect(
      detectSchedulerFireOneLine(events, { runId: RUN, taskId: 'T-001', attempt: 1, reviewRound: 2 }),
    ).toBeNull()
  })
})

// --- dispatchReview refusal paths ---------------------------------

describe('dispatchReview — refusal cases', () => {
  test('NEEDS_INTERVENTION present → EXIT_INTERVENTION (Mod #1+#3 chain stops at top)', async () => {
    await writePlan()
    await writeFile(
      join(runPaths.runDir, 'NEEDS_INTERVENTION.json'),
      JSON.stringify(
        {
          version: 1,
          runId: RUN,
          phase: 'review',
          agent: 'orchestrator',
          code: 'sample_review_code',
          rule: 'sample review rule',
          actionableSuggestions: ['inspect events.jsonl'],
          createdAt: FIXED_TS,
        },
        null,
        2,
      ),
      'utf8',
    )
    const result = await dispatchReview({
      stateDir, artifactRoot, runId: RUN, cwd: tmp, now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('sample_review_code')
  })

  test('PLAN.md missing → EXIT_INTERVENTION', async () => {
    const result = await dispatchReview({
      stateDir, artifactRoot, runId: RUN, cwd: tmp, now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('PLAN.md')
  })

  test('drift on missing build_completed → EXIT_INTERVENTION (Mod #3)', async () => {
    await writePlan()
    const result = await dispatchReview({
      stateDir, artifactRoot, runId: RUN, cwd: tmp, now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('REVIEW pre-flight failed')
  })

  test('round > 1 with missing prior REVIEW.md → EXIT_INTERVENTION', async () => {
    // Set up: BUILD/VERIFY artifacts present + sha-matched events + a
    // prior remediation pointing at round 2 — but no REVIEW.md on disk.
    await writePlan()
    const buildText = 'BR\n'
    const verifyText = 'V\n'
    const buildSha = await sha256(buildText)
    const verifySha = await sha256(verifyText)
    await writeFile(join(artifactRoot, 'BUILD_REPORT.md'), buildText, 'utf8')
    await writeFile(join(artifactRoot, 'VERIFY.md'), verifyText, 'utf8')
    await appendEventLine(runPaths.eventsFile, buildCompleted({
      taskId: 'T-001', attempt: 1, buildReportSha: buildSha, promptSha: 'b'.repeat(64),
    }))
    await appendEventLine(runPaths.eventsFile, verifyCompleted({
      taskId: 'T-001', attempt: 1, verifyReportSha: verifySha,
    }))
    await appendEventLine(runPaths.eventsFile, reviewRemediation({
      taskId: 'T-001', attempt: 1, reviewRound: 1, nextReviewRound: 2,
    }))
    const result = await dispatchReview({
      stateDir, artifactRoot, runId: RUN, cwd: tmp, now: () => FIXED_TS,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('round 2')
    expect(result.stderr).toContain('REVIEW.md')
  })
})

// --- helpers ------------------------------------------------------

async function sha256(s: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

async function appendEventLine(file: string, ev: LoggedEvent): Promise<void> {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, JSON.stringify(ev) + '\n', 'utf8')
}
