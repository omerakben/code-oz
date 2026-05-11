import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACTOR_ATTRIBUTION_RECOMMENDED_EVENT_TYPES,
  appendEvent,
  findEventsMissingRecommendedActorBinding,
  readEvents,
  validateEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { generateUlid, type PhaseEvent } from '../src/state/schemas.ts'

let tmp: string
let paths: EventLogPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-actor-events-'))
  paths = {
    file: join(tmp, 'events.jsonl'),
    lockDir: join(tmp, '.lock'),
  }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-10T10:00:00.000Z'
const SHA40 = '0123456789abcdef0123456789abcdef01234567'
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)

const ACTOR_FIXTURES = [
  {
    version: 1,
    type: 'run_started',
    ts: TS,
    runId: RUN,
    profile: 'greenfield',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'phase_entered',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'phase_exited',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    outcome: 'passed',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'gate_written',
    ts: TS,
    runId: RUN,
    phase: 'build',
    file: 'GATE_BUILD_PASSED.json',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'gate_required',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    blockedOn: 'operator approval',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'intervention',
    ts: TS,
    runId: RUN,
    phase: 'build',
    code: 'provider_auth_missing',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'run_ended',
    ts: TS,
    runId: RUN,
    outcome: 'stopped',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'ask_me_user_input',
    ts: TS,
    runId: RUN,
    phase: 'define',
    turn: 1,
    input: 'Ship a baby-name helper.',
    actor: 'user',
  },
  {
    version: 1,
    type: 'science_emitted',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    hypothesesCount: 1,
    openQuestionsCount: 1,
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'hypothesis_added',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    id: 'H-001',
    status: 'open',
    falsifier: 'A replay test observes a partial write.',
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'hypothesis_updated',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    id: 'H-001',
    prevStatus: 'open',
    nextStatus: 'confirmed',
    changedFields: ['status'],
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'question_added',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    id: 'Q-001',
    status: 'open',
    importance: 'high',
    dueBy: null,
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'question_resolved',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    id: 'Q-001',
    resolvedAt: '2026-05-10',
    resolution: 'The operator picked the simple policy.',
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'question_deferred',
    ts: TS,
    runId: RUN,
    phase: 'plan',
    id: 'Q-002',
    deferredAt: '2026-05-10',
    actor: 'scientist',
  },
  {
    version: 1,
    type: 'budget_warning',
    ts: TS,
    runId: RUN,
    metric: 'maxTokensEstimate',
    ratio: 0.75,
    current: 75,
    limit: 100,
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_created',
    ts: TS,
    runId: RUN,
    phase: 'build',
    baseCommitSha: SHA40,
    worktreePath: '/tmp/code-oz-worktree',
    dirtyTreePolicy: 'clean-base',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_failed',
    ts: TS,
    runId: RUN,
    phase: 'build',
    step: 2,
    code: 'worktree_add_failed',
    reason: 'git worktree add failed',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_patch_applied',
    ts: TS,
    runId: RUN,
    phase: 'build',
    patchSha256: SHA64A,
    patchPath: 'patches/T-001.patch',
    attempt: 1,
    taskId: 'T-001',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_patch_failed',
    ts: TS,
    runId: RUN,
    phase: 'build',
    code: 'patch_apply_failed',
    attempt: 1,
    taskId: 'T-001',
    reason: 'patch did not apply',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_forensics_preserved',
    ts: TS,
    runId: RUN,
    phase: 'build',
    attempt: 1,
    forensicsPath: '/tmp/code-oz/forensics/1',
    entries: ['diff.patch'],
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'worktree_destroyed',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    attempt: 1,
    worktreePath: '/tmp/code-oz-worktree',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'build_provider_recorded',
    ts: TS,
    runId: RUN,
    phase: 'build',
    attempt: 1,
    taskId: 'T-001',
    provider: 'claude',
    family: 'claude',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'verify_restart_initiated',
    ts: TS,
    runId: RUN,
    phase: 'verify',
    taskId: 'T-001',
    attempt: 1,
    nextAction: 'restart',
    nextAttempt: 2,
    forensicsPath: '/tmp/code-oz/forensics/1',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'panel_quorum_rejected_same_family_vote',
    ts: TS,
    runId: RUN,
    phase: 'review',
    panelistId: 'reviewer-a',
    providerId: 'claude',
    providerFamily: 'claude',
    buildFamily: 'claude',
    layer: 'quorum-time',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'review_panel_baseline_completed',
    ts: TS,
    runId: RUN,
    fixtureId: 'fixture-a',
    singleRunId: 'single-run',
    panelRunId: 'panel-run',
    singleFindingCount: 1,
    panelFindingCount: 2,
    panelOnlyFindingCount: 1,
    panelOnlyActionableFindingCount: 1,
    disagreementCount: 1,
    sameFamilyVoteRejectionCount: 1,
    manifestEqualityHeld: true,
    singleReviewArtifactHash: SHA64A,
    panelReviewArtifactHash: SHA64B,
    costOverheadRatio: 1.25,
    wallClockOverheadMs: 100,
    actor: 'doctor',
  },
  {
    version: 1,
    type: 'debate_policy_baseline_completed',
    ts: TS,
    runId: RUN,
    fixtureSet: 'canonical',
    correctiveDeltaRate: 0.2,
    antiCorrectiveCount: 0,
    newActionableFindingRate: 0.4,
    noSignalFireRate: 0.1,
    perTriggerBreakdown: [
      {
        reason: 'score_in_grey_zone',
        fired: 1,
        correctiveCount: 1,
        newActionableCount: 1,
      },
    ],
    costOverheadAvgTokens: 100,
    latencyOverheadAvgMs: 20,
    passedRuleTwentyOne: true,
    actor: 'doctor',
  },
  {
    version: 1,
    type: 'task_started',
    ts: TS,
    runId: RUN,
    taskId: 'T-001',
    taskIndex: 0,
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'task_review_passed',
    ts: TS,
    runId: RUN,
    taskId: 'T-001',
    taskIndex: 0,
    finalRound: 1,
    reviewReportSha256: SHA64A,
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'task_completed',
    ts: TS,
    runId: RUN,
    taskId: 'T-001',
    taskIndex: 0,
    reviewGatePath: '/tmp/GATE_REVIEW_PASSED.json',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'fake_provider_warning_emitted',
    ts: TS,
    runId: RUN,
    providerAlias: 'fake',
    providerFamily: 'fake',
    actor: 'orchestrator',
  },
  {
    version: 1,
    type: 'gate_file_cleared',
    ts: TS,
    runId: RUN,
    phase: 'build',
    priorTaskId: 'T-001',
    currentTaskId: 'T-002',
    gateFile: 'GATE_BUILD_PASSED.json',
    priorArtifactSha256: SHA64A,
    actor: 'orchestrator',
  },
] as const satisfies readonly PhaseEvent[]

function withoutActor(event: PhaseEvent): PhaseEvent {
  const copy = { ...event } as Record<string, unknown>
  delete copy.actor
  return copy as PhaseEvent
}

describe('Chorus 3.5 actor attribution', () => {
  test('valid actor values pass for every event type that needs the optional actor field', () => {
    expect(ACTOR_FIXTURES.map((event) => event.type)).toEqual(
      [...ACTOR_ATTRIBUTION_RECOMMENDED_EVENT_TYPES],
    )

    for (const event of ACTOR_FIXTURES) {
      expect(validateEvent(event, 'events.jsonl')).toBeNull()
    }
  })

  test('missing actor remains allowed for v0.1 compatibility', () => {
    for (const event of ACTOR_FIXTURES) {
      expect(validateEvent(withoutActor(event), 'events.jsonl')).toBeNull()
    }
  })

  test('actor is optional but must be non-blank when present', () => {
    const base = ACTOR_FIXTURES[0]!

    for (const actor of ['', '   ', 42]) {
      const issue = validateEvent({ ...base, actor }, 'events.jsonl')
      expect(issue?.code).toBe('event_invalid_value')
      expect(issue?.rule).toContain('event.actor')
      expect(issue?.rule).toContain('non-blank')
    }
  })

  test('appendEvent and readEvents preserve present actor values', async () => {
    await appendEvent(paths, ACTOR_FIXTURES[0]!)

    const events = await readEvents(paths)
    expect(events).toHaveLength(1)
    expect((events[0] as { actor?: string }).actor).toBe('orchestrator')
  })

  test('audit helper lists only events missing recommended actor binding', async () => {
    const missingRunStarted = withoutActor(ACTOR_FIXTURES[0]!)
    const presentPhaseEntered = ACTOR_FIXTURES[1]!
    const agentCompleted: PhaseEvent = {
      version: 1,
      type: 'agent_completed',
      ts: TS,
      runId: RUN,
      phase: 'plan',
      agent: 'lead',
    }
    const missingScienceEmitted = withoutActor(
      ACTOR_FIXTURES.find((event) => event.type === 'science_emitted')!,
    )

    await appendEvent(paths, missingRunStarted)
    await appendEvent(paths, presentPhaseEntered)
    await appendEvent(paths, agentCompleted)
    await appendEvent(paths, missingScienceEmitted)

    const warnings = await findEventsMissingRecommendedActorBinding(paths.file)

    expect(warnings).toHaveLength(2)
    expect(warnings.map((warning) => warning.code)).toEqual([
      'actor_attribution_missing',
      'actor_attribution_missing',
    ])
    expect(warnings.map((warning) => warning.line)).toEqual([1, 4])
    expect(warnings.map((warning) => warning.detail)).toEqual([
      'recommendedActor=orchestrator',
      'recommendedActor=scientist',
    ])
  })
})
