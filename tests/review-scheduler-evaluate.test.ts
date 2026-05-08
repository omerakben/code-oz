// M15 commit 4a — REVIEW phase scheduler evaluate hook tests.
//
// Coverage focus: hook-only behavior. The full review.ts integration is
// covered indirectly by tests/review-phase.test.ts (which still passes
// because the hook is non-invasive — it adds events but does not change
// the verdict branch).
//
// Hook contract (kickoff §11.4 commit 4a):
//   - Always emit `debate_scheduler_evaluated`
//   - Emit `debate_scheduler_skipped` when decision is to skip
//   - DO NOT emit `debate_scheduler_fired` (commit 4b)
//   - Return decision so commit 4b can act on it

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReviewSchedulerHook } from '../src/phases/review-scheduler-hook.ts'
import {
  appendEvent,
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
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-scheduler-hook-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-08T04:00:00.000Z'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)

function reviewerAgent(opts: { withDebatePerm?: boolean } = {}): AgentDefinition {
  const withDebate = opts.withDebatePerm ?? true
  const tool_use: Record<string, unknown> = {
    repo_context: {
      tools: ['glob', 'grep', 'read'] as const,
      roots: ['.code-oz/runs/<runId>/worktree/'],
      maxResults: 50,
      maxBytesPerResult: 16384,
      maxFilesForNextManifest: 0,
      timeoutMs: 5000,
      network: 'none' as const,
    },
    review_request: {
      tools: ['request-review'] as const,
      providers: ['codex', 'gemini'] as const,
      maxRounds: 4,
      timeoutMsPerRound: 120_000,
      network: 'provider-only' as const,
    },
  }
  if (withDebate) {
    tool_use.debate = {
      opposingProviders: ['claude', 'gemini'] as const,
      maxConcurrent: 1,
      previewBeforeSend: true as const,
      maxFiles: 16,
      timeoutMs: 120_000,
    }
  }
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
      tool_use: Object.freeze(tool_use as never),
    }),
    description: 'test reviewer',
    body: '# reviewer body',
  }) as AgentDefinition
}

function autoPolicy(): DebatePolicyConfig {
  return {
    ...DEFAULT_DEBATE_POLICY,
    mode: 'auto',
    triggers: { ...DEFAULT_DEBATE_POLICY.triggers, reviewScoreGreyZone: { ...DEFAULT_DEBATE_POLICY.triggers.reviewScoreGreyZone } },
    cooldown: { ...DEFAULT_DEBATE_POLICY.cooldown },
  }
}

function callHook(opts: {
  reviewState:
    | { mode: 'single'; score: number; verdict: 'ready' | 'needs-revision' | 'block' }
    | { mode: 'panel'; panelistVerdicts: readonly { id: string; verdict: 'ready' | 'needs-revision' | 'block'; authorityImpact: 'voter' | 'advisory' }[] }
  policy?: DebatePolicyConfig
  withDebatePerm?: boolean
  events?: readonly LoggedEvent[]
  taskId?: string
  attempt?: number
  reviewRound?: number
  preReviewReportSha256?: string
  buildReportChangedFileCount?: number
}): ReturnType<typeof runReviewSchedulerHook> {
  return runReviewSchedulerHook({
    runId: RUN,
    taskId: opts.taskId ?? 'T-001',
    attempt: opts.attempt ?? 1,
    reviewRound: opts.reviewRound ?? 1,
    phase: 'review',
    agent: 'reviewer',
    reviewerAgent: reviewerAgent({ withDebatePerm: opts.withDebatePerm ?? true }),
    preReviewReportSha256: opts.preReviewReportSha256 ?? SHA64A,
    reviewState: opts.reviewState,
    debatePolicyFromConfig: opts.policy,
    buildReportChangedFileCount: opts.buildReportChangedFileCount ?? 4,
    events: opts.events ?? [],
    eventPaths: paths,
    now: () => TS,
  })
}

async function readSchedulerEvents(): Promise<readonly LoggedEvent[]> {
  const events = await readEvents(paths)
  return events.filter(
    (e) =>
      isKnownPhaseEvent(e) &&
      (e.type === 'debate_scheduler_evaluated' ||
        e.type === 'debate_scheduler_skipped' ||
        e.type === 'debate_scheduler_fired'),
  )
}

// ---------------------------------------------------------------------------
// Always-emit-evaluated invariant
// ---------------------------------------------------------------------------
describe('runReviewSchedulerHook — always emits evaluated', () => {
  test('emits debate_scheduler_evaluated under default (manual) policy', async () => {
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
    })
    const evts = await readSchedulerEvents()
    expect(evts.length).toBeGreaterThanOrEqual(1)
    expect(evts[0]?.type).toBe('debate_scheduler_evaluated')
  })

  test('evaluated event carries decisionId, reviewRound, preReviewReportSha256', async () => {
    const result = await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      reviewRound: 2,
      preReviewReportSha256: SHA64B,
    })
    const evts = await readSchedulerEvents()
    const ev = evts.find((e) => e.type === 'debate_scheduler_evaluated') as
      | (LoggedEvent & { decisionId: string; reviewRound: number; preReviewReportSha256: string })
      | undefined
    expect(ev).toBeDefined()
    expect(ev?.decisionId).toBe(result.decisionId)
    expect(ev?.reviewRound).toBe(2)
    expect(ev?.preReviewReportSha256).toBe(SHA64B)
  })
})

// ---------------------------------------------------------------------------
// Skip path emits debate_scheduler_skipped
// ---------------------------------------------------------------------------
describe('runReviewSchedulerHook — skip path', () => {
  test('mode=manual default emits skipped with reason=mode_manual', async () => {
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      // No policy override -> defaults to undefined -> hook resolves to DEFAULT (mode=manual)
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string; decisionId: string })
      | undefined
    expect(skipped).toBeDefined()
    expect(skipped?.reason).toBe('mode_manual')
  })

  test('mode=off emits skipped with reason=mode_off', async () => {
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: { ...autoPolicy(), mode: 'off' },
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('mode_off')
  })

  test('persona without tool_use.debate emits skipped with reason=persona_no_debate_permission', async () => {
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
      withDebatePerm: false,
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('persona_no_debate_permission')
  })

  test('clean ready verdict emits skipped with reason=no_trigger_matched', async () => {
    await callHook({
      reviewState: { mode: 'single', score: 9, verdict: 'ready' },
      policy: autoPolicy(),
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('no_trigger_matched')
  })

  test('skip event correlation: decisionId matches the evaluated event', async () => {
    const result = await callHook({
      reviewState: { mode: 'single', score: 9, verdict: 'ready' },
      policy: autoPolicy(),
    })
    const evts = await readSchedulerEvents()
    const evaluated = evts.find((e) => e.type === 'debate_scheduler_evaluated') as
      | (LoggedEvent & { decisionId: string })
      | undefined
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { decisionId: string })
      | undefined
    expect(evaluated?.decisionId).toBe(result.decisionId)
    expect(skipped?.decisionId).toBe(result.decisionId)
  })
})

// ---------------------------------------------------------------------------
// Fire path: commit 4a logs evaluated only, NO fire event
// ---------------------------------------------------------------------------
describe('runReviewSchedulerHook — fire path (commit 4a does NOT emit fired)', () => {
  test('grey-zone score returns fire decision but emits no fired event', async () => {
    const result = await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
    })
    expect(result.decision).toEqual({ fire: true, reason: 'score_in_grey_zone' })
    const evts = await readSchedulerEvents()
    const fired = evts.find((e) => e.type === 'debate_scheduler_fired')
    expect(fired).toBeUndefined()
    // Only `evaluated` was emitted on the fire path in commit 4a.
    expect(evts.length).toBe(1)
    expect(evts[0]?.type).toBe('debate_scheduler_evaluated')
  })

  test('panel voter disagreement returns fire decision but emits no fired event', async () => {
    const result = await callHook({
      reviewState: {
        mode: 'panel',
        panelistVerdicts: [
          { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
          { id: 'r-B', verdict: 'needs-revision', authorityImpact: 'voter' },
        ],
      },
      policy: autoPolicy(),
    })
    expect(result.decision).toEqual({ fire: true, reason: 'panel_voter_disagreement' })
    const evts = await readSchedulerEvents()
    const fired = evts.find((e) => e.type === 'debate_scheduler_fired')
    expect(fired).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// History accumulators read events.jsonl correctly
// ---------------------------------------------------------------------------
describe('runReviewSchedulerHook — history reduction', () => {
  test('priorFingerprintsThisTask dedup triggers skip on repeat', async () => {
    // Simulate a prior fired event for the same task with the same
    // preReviewReportSha256 + attempt.
    await appendEvent(paths, {
      version: 1,
      type: 'debate_scheduler_fired',
      ts: '2026-05-08T03:50:00.000Z',
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      decisionId: generateUlid(),
      reviewRound: 1,
      reason: 'score_in_grey_zone',
      opposingProvider: 'gemini',
      debateTopic: 'review-prior-001',
      preReviewReportSha256: SHA64A,
    })
    const events = await readEvents(paths)
    // maxPerTask defaults to 1; bump it so the per-task cap does not
    // short-circuit before dedup is evaluated (gate ordering: per-task cap
    // runs before fingerprint dedup).
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: { ...autoPolicy(), maxPerRun: 5, maxPerTask: 5 },
      events,
      preReviewReportSha256: SHA64A,
      attempt: 1,
      taskId: 'T-001',
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('dedup_fingerprint_already_debated')
  })

  test('debate_started without resolved triggers concurrent_limit skip', async () => {
    await appendEvent(paths, {
      version: 1,
      type: 'debate_started',
      ts: '2026-05-08T03:55:00.000Z',
      runId: RUN,
      phase: 'review',
      agent: 'lead',
      topic: 'review-existing-debate',
      debateDirPath: '/tmp/debates/x',
      briefingSha256: SHA64A,
      manifestPreviewSha256: SHA64B,
      callerFamily: 'codex',
      opposingProvider: 'claude',
      opposingFamily: 'claude',
    })
    const events = await readEvents(paths)
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
      events,
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.find((e) => e.type === 'debate_scheduler_skipped') as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('concurrent_limit')
  })

  test('maxPerRun cap counted from prior fired events', async () => {
    // Two prior fires this run -> maxPerRun=2 cap exhausted.
    for (let i = 0; i < 2; i++) {
      await appendEvent(paths, {
        version: 1,
        type: 'debate_scheduler_fired',
        ts: '2026-05-08T03:50:00.000Z',
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: `T-00${i + 2}`,
        decisionId: generateUlid(),
        reviewRound: 1,
        reason: 'score_in_grey_zone',
        opposingProvider: 'gemini',
        debateTopic: `review-prior-00${i + 2}`,
        preReviewReportSha256: SHA64B,
      })
    }
    const events = await readEvents(paths)
    await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
      events,
      taskId: 'T-001', // different task — only run cap applies
    })
    const evts = await readSchedulerEvents()
    const skipped = evts.filter((e) => e.type === 'debate_scheduler_skipped') as readonly (LoggedEvent & {
      reason: string
    })[]
    // The most recent skipped event from THIS hook call carries max_per_run_exhausted.
    const last = skipped[skipped.length - 1]
    expect(last?.reason).toBe('max_per_run_exhausted')
  })
})

// ---------------------------------------------------------------------------
// Decision result returned to caller
// ---------------------------------------------------------------------------
describe('runReviewSchedulerHook — return value', () => {
  test('returns decisionId, decision, inputDigest', async () => {
    const result = await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
    })
    expect(result.decisionId.length).toBe(26)
    expect(result.decision.fire).toBe(true)
    expect(result.inputDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('inputDigest is deterministic on identical input', async () => {
    const r1 = await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
    })
    const r2 = await callHook({
      reviewState: { mode: 'single', score: 6, verdict: 'needs-revision' },
      policy: autoPolicy(),
    })
    expect(r1.inputDigest).toBe(r2.inputDigest)
  })
})
