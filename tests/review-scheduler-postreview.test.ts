// M15 commit 4b — REVIEW phase scheduler post-debate round semantics tests.
//
// Coverage focus: properties of the post-debate REVIEW round as observed
// through the scheduler event taxonomy:
//   1. Round counter does NOT increment (4-round cap from M9 unchanged)
//   2. preReviewReportSha256 + postReviewReportSha256 round-trip through
//      the postreview event
//   3. verdictPre / verdictPost combinations (every meaningful pair)
//   4. findingsAddedCount + actionableFindingsAddedCount captured in event
//   5. Anti-corrective flip (verdict moves AWAY from oracle) is recorded
//      faithfully — operators see the regression in events.jsonl
//   6. No-signal fire (zero finding deltas + same verdict) emits cleanly

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runReviewSchedulerHook,
  type SchedulerFirePathExecutor,
  type SchedulerFirePathResult,
} from '../src/phases/review-scheduler-hook.ts'
import {
  readEvents,
  type EventLogPaths,
} from '../src/state/events.ts'
import {
  generateUlid,
  isKnownPhaseEvent,
  type LoggedEvent,
} from '../src/state/schemas.ts'
import {
  DEFAULT_DEBATE_POLICY,
  type DebatePolicyConfig,
} from '../src/config/schema.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'

let tmp: string
let paths: EventLogPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-postreview-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-08T06:00:00.000Z'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)
const SHA64C = 'c'.repeat(64)

function reviewerAgent(): AgentDefinition {
  return Object.freeze({
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
      tool_use: Object.freeze({
        debate: Object.freeze({
          opposingProviders: ['claude', 'gemini'] as const,
          maxConcurrent: 1,
          previewBeforeSend: true as const,
          maxFiles: 16,
          timeoutMs: 120_000,
        }),
      } as never),
    }),
    description: 'reviewer',
    body: '# r',
  }) as AgentDefinition
}

function autoPolicy(): DebatePolicyConfig {
  return {
    ...DEFAULT_DEBATE_POLICY,
    mode: 'auto',
    triggers: {
      ...DEFAULT_DEBATE_POLICY.triggers,
      reviewScoreGreyZone: { ...DEFAULT_DEBATE_POLICY.triggers.reviewScoreGreyZone },
    },
    cooldown: { ...DEFAULT_DEBATE_POLICY.cooldown },
  }
}

function mockExec(result: SchedulerFirePathResult): SchedulerFirePathExecutor {
  return async () => result
}

async function fireFromRound(opts: {
  round: number
  reviewState:
    | { mode: 'single'; score: number; verdict: 'ready' | 'needs-revision' | 'block' }
    | { mode: 'panel'; panelistVerdicts: readonly { id: string; verdict: 'ready' | 'needs-revision' | 'block'; authorityImpact: 'voter' | 'advisory' }[] }
  result: SchedulerFirePathResult
  preSha?: string
}) {
  return runReviewSchedulerHook({
    runId: RUN,
    taskId: 'T-001',
    attempt: 1,
    reviewRound: opts.round,
    phase: 'review',
    agent: 'reviewer',
    reviewerAgent: reviewerAgent(),
    preReviewReportSha256: opts.preSha ?? SHA64A,
    reviewState: opts.reviewState,
    debatePolicyFromConfig: autoPolicy(),
    buildReportChangedFileCount: 4,
    events: [],
    eventPaths: paths,
    now: () => TS,
    firePathExecutor: mockExec(opts.result),
  })
}

async function readScheduler(): Promise<readonly LoggedEvent[]> {
  const events = await readEvents(paths)
  return events.filter(
    (e) =>
      isKnownPhaseEvent(e) &&
      (e.type === 'debate_scheduler_evaluated' ||
        e.type === 'debate_scheduler_fired' ||
        e.type === 'debate_scheduler_postreview' ||
        e.type === 'debate_scheduler_error'),
  )
}

// ---------------------------------------------------------------------------
// Round counter does NOT increment (4-round cap from M9 unchanged)
// ---------------------------------------------------------------------------
describe('post-debate round consumes same reviewRound', () => {
  test('postreview event carries same reviewRound as evaluated + fired', async () => {
    await fireFromRound({
      round: 3,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 1,
        actionableFindingsAddedCount: 1,
      },
    })
    const evts = await readScheduler()
    for (const e of evts) {
      const round = (e as { reviewRound: number }).reviewRound
      expect(round).toBe(3)
    }
  })

  test('round 4 (last allowed under M9 cap) still emits postreview at round 4', async () => {
    await fireFromRound({
      round: 4,
      reviewState: { mode: 'single', score: 7, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 0,
        actionableFindingsAddedCount: 0,
      },
    })
    const evts = await readScheduler()
    const post = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { reviewRound: number })
      | undefined
    expect(post?.reviewRound).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// preReviewReportSha256 / postReviewReportSha256 round-trip
// ---------------------------------------------------------------------------
describe('REVIEW.md sha round-trip', () => {
  test('postreview event records distinct pre and post shas', async () => {
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64C,
        verdictPost: 'ready',
        findingsAddedCount: 0,
        actionableFindingsAddedCount: 0,
      },
      preSha: SHA64B,
    })
    const evts = await readScheduler()
    const post = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { preReviewReportSha256: string; postReviewReportSha256: string })
      | undefined
    expect(post?.preReviewReportSha256).toBe(SHA64B)
    expect(post?.postReviewReportSha256).toBe(SHA64C)
    expect(post?.preReviewReportSha256).not.toBe(post?.postReviewReportSha256)
  })

  test('fired event preReviewReportSha256 matches the pre-debate REVIEW.md', async () => {
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64C,
        verdictPost: 'ready',
        findingsAddedCount: 1,
        actionableFindingsAddedCount: 1,
      },
      preSha: SHA64B,
    })
    const evts = await readScheduler()
    const fired = evts.find((e) => e.type === 'debate_scheduler_fired') as
      | (LoggedEvent & { preReviewReportSha256: string })
      | undefined
    expect(fired?.preReviewReportSha256).toBe(SHA64B)
  })
})

// ---------------------------------------------------------------------------
// Verdict pair coverage (single mode)
// ---------------------------------------------------------------------------
describe('verdict pair coverage — single mode', () => {
  const pairs: ReadonlyArray<[
    'ready' | 'needs-revision' | 'block',
    'ready' | 'needs-revision' | 'block' | 'panel',
  ]> = [
    ['needs-revision', 'ready'],
    ['needs-revision', 'block'],
    ['ready', 'needs-revision'],
    ['block', 'needs-revision'],
    ['block', 'ready'],
  ]

  for (const [pre, post] of pairs) {
    test(`${pre} -> ${post} round-trips through postreview event`, async () => {
      await rm(tmp, { recursive: true, force: true })
      tmp = await mkdtemp(join(tmpdir(), 'code-oz-postreview-'))
      paths = { file: join(tmp, 'events.jsonl'), lockDir: join(tmp, '.lock') }

      await fireFromRound({
        round: 1,
        reviewState: { mode: 'single', score: 6, verdict: pre },
        result: {
          status: 'success',
          opposingProvider: 'gemini',
          debateTopic: 't',
          newReviewReportSha256: SHA64B,
          verdictPost: post,
          findingsAddedCount: 1,
          actionableFindingsAddedCount: 0,
        },
      })
      const evts = await readScheduler()
      const ev = evts.find((e) => e.type === 'debate_scheduler_postreview') as
        | (LoggedEvent & { verdictPre: string; verdictPost: string })
        | undefined
      expect(ev?.verdictPre).toBe(pre)
      expect(ev?.verdictPost).toBe(post)
    })
  }
})

// ---------------------------------------------------------------------------
// Anti-corrective flip is recorded faithfully
// ---------------------------------------------------------------------------
describe('anti-corrective flip', () => {
  test('verdict moving from needs-revision to ready records both faithfully', async () => {
    // Whether this flip is corrective vs anti-corrective depends on the
    // fixture oracle (computed by the rule-21 baseline command in commit
    // 6b). The postreview event itself records both verdicts unmodified
    // so the baseline can compute the direction.
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 0,
        actionableFindingsAddedCount: 0,
      },
    })
    const evts = await readScheduler()
    const ev = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { verdictPre: string; verdictPost: string })
      | undefined
    expect(ev?.verdictPre).toBe('needs-revision')
    expect(ev?.verdictPost).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// No-signal fire (zero deltas, same verdict)
// ---------------------------------------------------------------------------
describe('no-signal fire', () => {
  test('same verdict + zero finding deltas emits postreview cleanly', async () => {
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64A, // same as preSha (REVIEW.md unchanged)
        verdictPost: 'needs-revision',
        findingsAddedCount: 0,
        actionableFindingsAddedCount: 0,
      },
    })
    const evts = await readScheduler()
    const ev = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & {
          verdictPre: string
          verdictPost: string
          preReviewReportSha256: string
          postReviewReportSha256: string
          findingsAddedCount: number
          actionableFindingsAddedCount: number
        })
      | undefined
    expect(ev?.verdictPre).toBe('needs-revision')
    expect(ev?.verdictPost).toBe('needs-revision')
    expect(ev?.findingsAddedCount).toBe(0)
    expect(ev?.actionableFindingsAddedCount).toBe(0)
    expect(ev?.preReviewReportSha256).toBe(ev?.postReviewReportSha256)
  })
})

// ---------------------------------------------------------------------------
// Findings count integrity
// ---------------------------------------------------------------------------
describe('findings count integrity', () => {
  test('actionableFindingsAddedCount may equal findingsAddedCount', async () => {
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 3,
        actionableFindingsAddedCount: 3,
      },
    })
    const evts = await readScheduler()
    const ev = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { findingsAddedCount: number; actionableFindingsAddedCount: number })
      | undefined
    expect(ev?.findingsAddedCount).toBe(3)
    expect(ev?.actionableFindingsAddedCount).toBe(3)
  })

  test('high finding count (5+) round-trips intact', async () => {
    await fireFromRound({
      round: 1,
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      result: {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'block',
        findingsAddedCount: 7,
        actionableFindingsAddedCount: 4,
      },
    })
    const evts = await readScheduler()
    const ev = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { findingsAddedCount: number; actionableFindingsAddedCount: number })
      | undefined
    expect(ev?.findingsAddedCount).toBe(7)
    expect(ev?.actionableFindingsAddedCount).toBe(4)
  })
})
