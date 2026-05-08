// M15 commit 4b — REVIEW phase scheduler fire path tests.
//
// Coverage focus: fire-path orchestration with mock executor.
//
// The executor seam (SchedulerFirePathExecutor) abstracts the actual debate
// invocation + post-debate REVIEW round so the hook stays narrow. Mock
// executors prove:
//   - debate_scheduler_fired emits before postreview / error / intervention
//   - debate_scheduler_postreview emits on success with verdict pre/post +
//     finding deltas
//   - debate_scheduler_error emits on degrade with the executor's
//     errorReason (artifact_invalid / transient_io / other / etc.)
//   - intervention path emits NO scheduler event past `fired` — caller
//     writes NEEDS_INTERVENTION.json
//   - decisionId correlates evaluated -> fired -> postreview/error
//   - executor's thrown exception is caught and degraded to scheduler_error
//     with reason='other'
//   - lock-collision: hook does NOT acquire .review.lock (the seam is
//     wholly inside the outer's lock envelope; commit 4b's contribution
//     is the seam architecture itself)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
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
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-scheduler-fire-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-08T05:00:00.000Z'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)

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
    description: 'test reviewer',
    body: '# reviewer body',
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

function makeMockExecutor(
  result: SchedulerFirePathResult,
): { fn: SchedulerFirePathExecutor; calls: number } {
  let calls = 0
  return {
    get calls() { return calls },
    fn: async (_input, hooks) => {
      calls++
      // Honor the C13a contract: emit fired before "starting" the debate.
      await hooks.emitFired({
        opposingProvider: result.opposingProvider,
        debateTopic: result.debateTopic,
      })
      return result
    },
  }
}

async function callHook(
  reviewState:
    | { mode: 'single'; score: number; verdict: 'ready' | 'needs-revision' | 'block' }
    | { mode: 'panel'; panelistVerdicts: readonly { id: string; verdict: 'ready' | 'needs-revision' | 'block'; authorityImpact: 'voter' | 'advisory' }[] },
  executor: SchedulerFirePathExecutor | undefined = undefined,
  policy: DebatePolicyConfig = autoPolicy(),
) {
  return runReviewSchedulerHook({
    runId: RUN,
    taskId: 'T-001',
    attempt: 1,
    reviewRound: 1,
    phase: 'review',
    agent: 'reviewer',
    reviewerAgent: reviewerAgent(),
    preReviewReportSha256: SHA64A,
    reviewState,
    debatePolicyFromConfig: policy,
    buildReportChangedFileCount: 4,
    events: [],
    eventPaths: paths,
    now: () => TS,
    ...(executor !== undefined ? { firePathExecutor: executor } : {}),
  })
}

async function readSchedulerEvents(): Promise<readonly LoggedEvent[]> {
  const events = await readEvents(paths)
  return events.filter(
    (e) =>
      isKnownPhaseEvent(e) &&
      (e.type === 'debate_scheduler_evaluated' ||
        e.type === 'debate_scheduler_skipped' ||
        e.type === 'debate_scheduler_fired' ||
        e.type === 'debate_scheduler_postreview' ||
        e.type === 'debate_scheduler_error'),
  )
}

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------
describe('fire path — success', () => {
  test('emits evaluated -> fired -> postreview in order', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-001',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 2,
      actionableFindingsAddedCount: 1,
    })
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    expect(result.fireOutcome.fired).toBe(true)
    expect(result.fireOutcome.result?.status).toBe('success')

    const evts = await readSchedulerEvents()
    expect(evts.map((e) => e.type)).toEqual([
      'debate_scheduler_evaluated',
      'debate_scheduler_fired',
      'debate_scheduler_postreview',
    ])
  })

  test('postreview event carries verdictPre, verdictPost, finding deltas', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-002',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 3,
      actionableFindingsAddedCount: 2,
    })
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    const post = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & {
          verdictPre: string
          verdictPost: string
          preReviewReportSha256: string
          postReviewReportSha256: string
          findingsAddedCount: number
          actionableFindingsAddedCount: number
        })
      | undefined
    expect(post?.verdictPre).toBe('needs-revision')
    expect(post?.verdictPost).toBe('ready')
    expect(post?.preReviewReportSha256).toBe(SHA64A)
    expect(post?.postReviewReportSha256).toBe(SHA64B)
    expect(post?.findingsAddedCount).toBe(3)
    expect(post?.actionableFindingsAddedCount).toBe(2)
  })

  test('panel mode postreview: verdictPre is the literal `panel`', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 'review-panel-disagreement-001',
      newReviewReportSha256: SHA64B,
      verdictPost: 'panel',
      findingsAddedCount: 0,
      actionableFindingsAddedCount: 0,
    })
    await callHook(
      {
        mode: 'panel',
        panelistVerdicts: [
          { id: 'r-A', verdict: 'ready', authorityImpact: 'voter' },
          { id: 'r-B', verdict: 'needs-revision', authorityImpact: 'voter' },
        ],
      },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    const post = evts.find((e) => e.type === 'debate_scheduler_postreview') as
      | (LoggedEvent & { verdictPre: string; verdictPost: string })
      | undefined
    expect(post?.verdictPre).toBe('panel')
    expect(post?.verdictPost).toBe('panel')
  })

  test('decisionId correlates evaluated -> fired -> postreview', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 't',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 1,
      actionableFindingsAddedCount: 0,
    })
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    for (const e of evts) {
      expect((e as { decisionId: string }).decisionId).toBe(result.decisionId)
    }
  })

  test('fired event carries opposingProvider + debateTopic + reason', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-foo',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 0,
      actionableFindingsAddedCount: 0,
    })
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    const fired = evts.find((e) => e.type === 'debate_scheduler_fired') as
      | (LoggedEvent & { opposingProvider: string; debateTopic: string; reason: string })
      | undefined
    expect(fired?.opposingProvider).toBe('gemini')
    expect(fired?.debateTopic).toBe('review-grey-zone-foo')
    expect(fired?.reason).toBe('score_in_grey_zone')
  })
})

// ---------------------------------------------------------------------------
// Error degrade path
// ---------------------------------------------------------------------------
describe('fire path — error_degrade', () => {
  test('emits evaluated -> fired -> scheduler_error', async () => {
    const exec = makeMockExecutor({
      status: 'error_degrade',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-003',
      errorReason: 'artifact_invalid',
      underlyingErrorCode: 'debate_response_invalid',
    })
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    expect(evts.map((e) => e.type)).toEqual([
      'debate_scheduler_evaluated',
      'debate_scheduler_fired',
      'debate_scheduler_error',
    ])
    const errEv = evts.find((e) => e.type === 'debate_scheduler_error') as
      | (LoggedEvent & { reason: string; underlyingErrorCode?: string })
      | undefined
    expect(errEv?.reason).toBe('artifact_invalid')
    expect(errEv?.underlyingErrorCode).toBe('debate_response_invalid')
  })

  test('returns fireOutcome.result with status=error_degrade', async () => {
    const exec = makeMockExecutor({
      status: 'error_degrade',
      opposingProvider: 'claude',
      debateTopic: 't',
      errorReason: 'transient_io',
    })
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    expect(result.fireOutcome.fired).toBe(true)
    expect(result.fireOutcome.result?.status).toBe('error_degrade')
  })

  test('every degraded errorReason round-trips into the event', async () => {
    for (const reason of ['artifact_invalid', 'transient_io', 'resume_after_fire_no_start', 'other'] as const) {
      // Reset events file for each iteration.
      await rm(tmp, { recursive: true, force: true })
      tmp = await mkdtemp(join(tmpdir(), 'code-oz-scheduler-fire-'))
      paths = { file: join(tmp, 'events.jsonl'), lockDir: join(tmp, '.lock') }

      const exec = makeMockExecutor({
        status: 'error_degrade',
        opposingProvider: 'gemini',
        debateTopic: 'topic',
        errorReason: reason,
      })
      await callHook(
        { mode: 'single', score: 6, verdict: 'needs-revision' },
        exec.fn,
      )
      const evts = await readSchedulerEvents()
      const errEv = evts.find((e) => e.type === 'debate_scheduler_error') as
        | (LoggedEvent & { reason: string })
        | undefined
      expect(errEv?.reason).toBe(reason)
    }
  })
})

// ---------------------------------------------------------------------------
// Intervention path
// ---------------------------------------------------------------------------
describe('fire path — intervention', () => {
  test('emits evaluated -> fired only; no postreview/error event', async () => {
    const exec = makeMockExecutor({
      status: 'intervention',
      opposingProvider: 'gemini',
      debateTopic: 'review-grey-zone-004',
      interventionCode: 'debate_scheduler_auth_missing',
      interventionRule: 'opposing provider authentication missing',
    })
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    const evts = await readSchedulerEvents()
    expect(evts.map((e) => e.type)).toEqual([
      'debate_scheduler_evaluated',
      'debate_scheduler_fired',
    ])
  })

  test('returns fireOutcome.result with status=intervention + caller-actionable fields', async () => {
    const exec = makeMockExecutor({
      status: 'intervention',
      opposingProvider: 'gemini',
      debateTopic: 't',
      interventionCode: 'debate_scheduler_concurrent_limit',
      interventionRule: 'concurrent debate cap exceeded',
      underlyingErrorCode: 'debate_concurrent_limit_exceeded',
    })
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )
    expect(result.fireOutcome.fired).toBe(true)
    if (result.fireOutcome.result?.status !== 'intervention') {
      throw new Error('expected intervention')
    }
    expect(result.fireOutcome.result.interventionCode).toBe(
      'debate_scheduler_concurrent_limit',
    )
    expect(result.fireOutcome.result.interventionRule).toBe(
      'concurrent debate cap exceeded',
    )
    expect(result.fireOutcome.result.underlyingErrorCode).toBe(
      'debate_concurrent_limit_exceeded',
    )
  })
})

// ---------------------------------------------------------------------------
// Executor exception safety
// ---------------------------------------------------------------------------
describe('fire path — executor throws', () => {
  test('pre-emit throw: scheduler_error + fireOutcome.fired === false', async () => {
    // Executor throws BEFORE calling hooks.emitFired. Per C13a, this is a
    // pre-fire failure: no `debate_scheduler_fired` lands in events.jsonl
    // and fireOutcome.fired is false (no debate started).
    const exec: SchedulerFirePathExecutor = async () => {
      throw new Error('whatever went wrong')
    }
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec,
    )
    expect(result.fireOutcome.fired).toBe(false)
    expect(result.fireOutcome.result).toBeNull()

    const evts = await readSchedulerEvents()
    const errEv = evts.find((e) => e.type === 'debate_scheduler_error') as
      | (LoggedEvent & { reason: string; underlyingErrorCode?: string })
      | undefined
    expect(errEv?.reason).toBe('other')
    expect(errEv?.underlyingErrorCode).toBe('whatever went wrong')

    const types = evts.map((e) => e.type)
    expect(types).not.toContain('debate_scheduler_fired')
  })

  test('post-emit throw: fired present + scheduler_error + fired===true', async () => {
    // Executor calls emitFired with a real selection, then throws (e.g.,
    // requestDebate raised). The trace records `fired` THEN
    // `debate_scheduler_error`, and fireOutcome.result carries the
    // recorded selection so the reducer can attribute the failure.
    const exec: SchedulerFirePathExecutor = async (_input, hooks) => {
      await hooks.emitFired({ opposingProvider: 'gemini', debateTopic: 't' })
      throw new Error('requestDebate exploded')
    }
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec,
    )
    expect(result.fireOutcome.fired).toBe(true)
    if (result.fireOutcome.result?.status !== 'error_degrade') {
      throw new Error('expected error_degrade')
    }
    expect(result.fireOutcome.result.errorReason).toBe('other')
    expect(result.fireOutcome.result.opposingProvider).toBe('gemini')
    expect(result.fireOutcome.result.debateTopic).toBe('t')
    expect(result.fireOutcome.result.underlyingErrorCode).toBe(
      'requestDebate exploded',
    )

    const evts = await readSchedulerEvents()
    const types = evts.map((e) => e.type)
    expect(types).toEqual([
      'debate_scheduler_evaluated',
      'debate_scheduler_fired',
      'debate_scheduler_error',
    ])
  })

  test('executor returns without emitFired: scheduler_error + fired===false', async () => {
    // Programming-error path: an executor that returns a result without
    // calling emitFired violates the C13a contract. The hook surfaces
    // this as scheduler_error reason=other so events.jsonl stays honest.
    const exec: SchedulerFirePathExecutor = async () => ({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 't',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 0,
      actionableFindingsAddedCount: 0,
    })
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec,
    )
    expect(result.fireOutcome.fired).toBe(false)
    expect(result.fireOutcome.result).toBeNull()

    const evts = await readSchedulerEvents()
    const errEv = evts.find((e) => e.type === 'debate_scheduler_error') as
      | (LoggedEvent & { underlyingErrorCode?: string })
      | undefined
    expect(errEv?.underlyingErrorCode).toBe('executor_did_not_emit_fired')
    const types = evts.map((e) => e.type)
    expect(types).not.toContain('debate_scheduler_fired')
  })

  test('emitFired called twice: throws contract violation', async () => {
    // C13a contract: emitFired is exactly-once. A second call must throw
    // so the executor can fail fast rather than silently appending two
    // `fired` events for one decision.
    const exec: SchedulerFirePathExecutor = async (_input, hooks) => {
      await hooks.emitFired({ opposingProvider: 'gemini', debateTopic: 't' })
      // Second call: contract violation. The executor would catch this
      // and surface error_degrade in production; here we let it bubble
      // to verify the hook's post-emit error path.
      await hooks.emitFired({ opposingProvider: 'gemini', debateTopic: 't' })
      return {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 0,
        actionableFindingsAddedCount: 0,
      }
    }
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec,
    )
    expect(result.fireOutcome.fired).toBe(true)
    if (result.fireOutcome.result?.status !== 'error_degrade') {
      throw new Error('expected error_degrade')
    }
    expect(result.fireOutcome.result.underlyingErrorCode).toContain(
      'emitFired exactly once',
    )
  })
})

// ---------------------------------------------------------------------------
// C13a event ordering: emitFired is the seam that locks `fired` BEFORE
// the executor calls requestDebate. Verified by an executor that reads
// events.jsonl after emitFired returns and confirms `fired` is present.
// (Codex R1 #6: without this seam, requestDebate's debate_started event
// would land before debate_scheduler_fired, breaking the resume contract.)
// ---------------------------------------------------------------------------
describe('fire path — C13a event ordering', () => {
  test('emitFired returns with debate_scheduler_fired already in events.jsonl', async () => {
    let typesAtEmitTime: readonly string[] = []
    const exec: SchedulerFirePathExecutor = async (_input, hooks) => {
      await hooks.emitFired({ opposingProvider: 'gemini', debateTopic: 't' })
      // After emitFired returns, the hook has already appended `fired`.
      // A real executor would now call requestDebate (which emits
      // debate_started). We snapshot events.jsonl here to lock the
      // ordering invariant without synthesizing real debate events.
      const evts = await readEvents(paths)
      typesAtEmitTime = evts.map((e) => e.type)
      return {
        status: 'success',
        opposingProvider: 'gemini',
        debateTopic: 't',
        newReviewReportSha256: SHA64B,
        verdictPost: 'ready',
        findingsAddedCount: 1,
        actionableFindingsAddedCount: 1,
      }
    }
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec,
    )

    expect(typesAtEmitTime).toContain('debate_scheduler_fired')
    expect(typesAtEmitTime).toContain('debate_scheduler_evaluated')
    // postreview lands AFTER the executor returns, so it must NOT be in
    // the snapshot taken inside the executor body.
    expect(typesAtEmitTime).not.toContain('debate_scheduler_postreview')
  })
})

// ---------------------------------------------------------------------------
// Lock-collision proof: hook never acquires .review.lock
// ---------------------------------------------------------------------------
describe('lock-collision proof', () => {
  test('hook + fire path produce no .review.lock directory', async () => {
    const exec = makeMockExecutor({
      status: 'success',
      opposingProvider: 'gemini',
      debateTopic: 't',
      newReviewReportSha256: SHA64B,
      verdictPost: 'ready',
      findingsAddedCount: 0,
      actionableFindingsAddedCount: 0,
    })
    await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      exec.fn,
    )

    // The hook + fire path executor are responsible for NOT acquiring
    // `.review.lock`. The outer runReview owns that lock; fire-path
    // re-acquisition would deadlock or refuse (Codex Risk #4 in
    // CODEX_RESPONSE_M15.md). Verify by absence: no .review.lock dir
    // exists in tmp (the hook only writes to events.jsonl + the locker
    // for that file lives at a different path).
    const entries = await readdir(tmp)
    expect(entries).not.toContain('.review.lock')
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility: fire decision without executor still degrades cleanly
// ---------------------------------------------------------------------------
describe('fire decision without executor (transitional)', () => {
  test('emits evaluated only; no fired/postreview/error', async () => {
    const result = await callHook(
      { mode: 'single', score: 6, verdict: 'needs-revision' },
      undefined,
    )
    expect(result.decision.fire).toBe(true)
    expect(result.fireOutcome.fired).toBe(false)
    expect(result.fireOutcome.result).toBeNull()
    const evts = await readSchedulerEvents()
    expect(evts.map((e) => e.type)).toEqual(['debate_scheduler_evaluated'])
  })
})
