// M15 commit 6b — debate-policy-baseline (rule-21 ship gate) tests.
//
// Tests cover the pure computation + the disk-loading driver. End-to-end
// invocation through FakeProvider lands in commit 9.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeDebatePolicyBaseline,
  loadFixtureSet,
  runDebatePolicyBaseline,
  RULE_21_CORRECTIVE_DELTA_FLOOR,
  RULE_21_NEW_ACTIONABLE_FINDING_FLOOR,
  type FixtureRecord,
} from '../src/commands/doctor-debate-baseline.ts'
import {
  generateUlid,
  type LoggedEvent,
} from '../src/state/schemas.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-baseline-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const SHA64A = 'a'.repeat(64)
const SHA64B = 'b'.repeat(64)

let nextDecision = 1
function decisionId(): string {
  // Generate distinct ULIDs for each call.
  const random = new Uint8Array(10)
  random[0] = nextDecision++
  return generateUlid({ now: 1_000_000_000_000 + nextDecision, random })
}

function firedEvent(opts: {
  decisionId: string
  reason: 'score_in_grey_zone' | 'panel_voter_disagreement' | 'needs_revision_with_high_score'
  ts?: string
}): LoggedEvent {
  return {
    version: 1,
    type: 'debate_scheduler_fired',
    ts: opts.ts ?? '2026-05-08T08:00:00.000Z',
    runId: RUN,
    phase: 'review',
    agent: 'reviewer',
    attempt: 1,
    taskId: 'T-001',
    decisionId: opts.decisionId,
    reviewRound: 1,
    reason: opts.reason,
    opposingProvider: 'gemini',
    debateTopic: 'review-topic',
    preReviewReportSha256: SHA64A,
  }
}

function postreviewEvent(opts: {
  decisionId: string
  verdictPre: 'ready' | 'needs-revision' | 'block'
  verdictPost: 'ready' | 'needs-revision' | 'block'
  findingsAdded?: number
  actionableAdded?: number
  ts?: string
}): LoggedEvent {
  return {
    version: 1,
    type: 'debate_scheduler_postreview',
    ts: opts.ts ?? '2026-05-08T08:00:05.000Z',
    runId: RUN,
    phase: 'review',
    agent: 'reviewer',
    attempt: 1,
    taskId: 'T-001',
    decisionId: opts.decisionId,
    reviewRound: 1,
    preReviewReportSha256: SHA64A,
    postReviewReportSha256: SHA64B,
    verdictPre: opts.verdictPre,
    verdictPost: opts.verdictPost,
    findingsAddedCount: opts.findingsAdded ?? 0,
    actionableFindingsAddedCount: opts.actionableAdded ?? 0,
  }
}

function makeFixture(opts: {
  name: string
  oracle: 'ready' | 'needs-revision' | 'block'
  treatmentEvents: readonly LoggedEvent[]
  controlEvents?: readonly LoggedEvent[]
}): FixtureRecord {
  return {
    name: opts.name,
    oracle: { verdict: opts.oracle },
    controlEvents: opts.controlEvents ?? [],
    treatmentEvents: opts.treatmentEvents,
  }
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------
describe('computeDebatePolicyBaseline — corrective rate', () => {
  test('zero fires -> rates are 0 + ship gate FAILS', () => {
    const result = computeDebatePolicyBaseline([])
    expect(result.firedCount).toBe(0)
    expect(result.correctiveDeltaRate).toBe(0)
    expect(result.passedRuleTwentyOne).toBe(false)
  })

  test('all corrective fires + actionable findings -> ship gate PASSES', () => {
    const fixtures: readonly FixtureRecord[] = []
    const ev: LoggedEvent[] = []
    for (let i = 0; i < 10; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: 'needs-revision',
          verdictPost: 'ready', // matches oracle
          actionableAdded: 1,
        }),
      )
    }
    const fixture = makeFixture({
      name: 'fx-corrective',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([...fixtures, fixture])
    expect(result.firedCount).toBe(10)
    expect(result.correctiveCount).toBe(10)
    expect(result.correctiveDeltaRate).toBe(1)
    expect(result.newActionableFindingRate).toBe(1)
    expect(result.passedRuleTwentyOne).toBe(true)
  })

  test('all anti-corrective fires -> ship gate FAILS', () => {
    const ev: LoggedEvent[] = []
    for (let i = 0; i < 10; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: 'ready', // oracle = ready -> distance 0 pre
          verdictPost: 'needs-revision', // distance 1 post -> anti-corrective
          actionableAdded: 1,
        }),
      )
    }
    const fixture = makeFixture({
      name: 'fx-anti',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.correctiveCount).toBe(0)
    expect(result.antiCorrectiveCount).toBe(10)
    expect(result.passedRuleTwentyOne).toBe(false)
  })

  test('mixed: 1 corrective out of 10 = 10% (PASS at floor exactly)', () => {
    const ev: LoggedEvent[] = []
    // 1 corrective + 9 neutral; all add actionable findings.
    for (let i = 0; i < 10; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: i === 0 ? 'needs-revision' : 'ready',
          verdictPost: 'ready',
          actionableAdded: 1,
        }),
      )
    }
    const fixture = makeFixture({
      name: 'fx-edge',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.correctiveDeltaRate).toBeCloseTo(0.1, 5)
    expect(result.passedRuleTwentyOne).toBe(true)
    expect(result.correctiveDeltaRate).toBe(RULE_21_CORRECTIVE_DELTA_FLOOR)
  })
})

describe('computeDebatePolicyBaseline — actionable finding rate', () => {
  test('30% actionable rate just passes', () => {
    const ev: LoggedEvent[] = []
    for (let i = 0; i < 10; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: 'needs-revision',
          verdictPost: 'ready',
          actionableAdded: i < 3 ? 1 : 0, // 3 of 10
        }),
      )
    }
    const fixture = makeFixture({
      name: 'fx-actionable-floor',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.newActionableFindingRate).toBe(RULE_21_NEW_ACTIONABLE_FINDING_FLOOR)
    expect(result.passedRuleTwentyOne).toBe(true)
  })

  test('29% actionable rate fails', () => {
    const ev: LoggedEvent[] = []
    for (let i = 0; i < 100; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: 'needs-revision',
          verdictPost: 'ready',
          actionableAdded: i < 29 ? 1 : 0, // 29% actionable
        }),
      )
    }
    const fixture = makeFixture({
      name: 'fx-just-below',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.newActionableFindingRate).toBeLessThan(RULE_21_NEW_ACTIONABLE_FINDING_FLOOR)
    expect(result.passedRuleTwentyOne).toBe(false)
  })
})

describe('computeDebatePolicyBaseline — no-signal fire rate', () => {
  test('zero deltas + same verdict counts as no-signal', () => {
    const ev: LoggedEvent[] = []
    const dId1 = decisionId()
    ev.push(firedEvent({ decisionId: dId1, reason: 'score_in_grey_zone' }))
    ev.push(
      postreviewEvent({
        decisionId: dId1,
        verdictPre: 'needs-revision',
        verdictPost: 'needs-revision',
        findingsAdded: 0,
        actionableAdded: 0,
      }),
    )
    const dId2 = decisionId()
    ev.push(firedEvent({ decisionId: dId2, reason: 'score_in_grey_zone' }))
    ev.push(
      postreviewEvent({
        decisionId: dId2,
        verdictPre: 'needs-revision',
        verdictPost: 'ready',
        findingsAdded: 1,
        actionableAdded: 1,
      }),
    )
    const fixture = makeFixture({
      name: 'fx-nosig',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.noSignalCount).toBe(1)
    expect(result.noSignalFireRate).toBe(0.5)
  })
})

describe('computeDebatePolicyBaseline — per-trigger breakdown', () => {
  test('groups fires by reason', () => {
    const ev: LoggedEvent[] = []
    // 2 grey-zone, 1 needs-revision-with-high-score
    for (let i = 0; i < 2; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push(
        postreviewEvent({
          decisionId: dId,
          verdictPre: 'needs-revision',
          verdictPost: 'ready',
          actionableAdded: 1,
        }),
      )
    }
    const dId = decisionId()
    ev.push(firedEvent({ decisionId: dId, reason: 'needs_revision_with_high_score' }))
    ev.push(
      postreviewEvent({
        decisionId: dId,
        verdictPre: 'needs-revision',
        verdictPost: 'ready',
        actionableAdded: 1,
      }),
    )
    const fixture = makeFixture({
      name: 'fx-trigger-mix',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    const byReason = Object.fromEntries(result.perTriggerBreakdown.map((r) => [r.reason, r]))
    expect(byReason.score_in_grey_zone?.fired).toBe(2)
    expect(byReason.score_in_grey_zone?.correctiveCount).toBe(2)
    expect(byReason.needs_revision_with_high_score?.fired).toBe(1)
    expect(byReason.panel_voter_disagreement?.fired).toBe(0)
  })
})

describe('computeDebatePolicyBaseline — every fire counts in the denominator (M15 C16)', () => {
  test('orphan fires count toward firedCount but not toward numerators', () => {
    // Closes Codex R1 #4: M15 Phase 1 silently dropped orphaned fires
    // from the denominator, inflating correctiveDeltaRate +
    // newActionableFindingRate. C16: every `debate_scheduler_fired`
    // counts; missing-terminal fires surface in `missingTerminalCount`.
    const ev: LoggedEvent[] = []
    const dId1 = decisionId()
    ev.push(firedEvent({ decisionId: dId1, reason: 'score_in_grey_zone' }))
    // no matching postreview for dId1 — missing-terminal
    const dId2 = decisionId()
    ev.push(firedEvent({ decisionId: dId2, reason: 'score_in_grey_zone' }))
    ev.push(
      postreviewEvent({
        decisionId: dId2,
        verdictPre: 'needs-revision',
        verdictPost: 'ready',
        actionableAdded: 1,
      }),
    )
    const fixture = makeFixture({
      name: 'fx-orphan',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.firedCount).toBe(2) // C16: both fires count
    expect(result.missingTerminalCount).toBe(1)
    expect(result.errorCount).toBe(0)
    expect(result.correctiveCount).toBe(1) // only the joined fire
    // 1 / 2 = 0.5 (the orphan fire dilutes the rate, as the contract requires)
    expect(result.correctiveDeltaRate).toBeCloseTo(0.5, 5)
    expect(result.newActionableCount).toBe(1)
    expect(result.newActionableFindingRate).toBeCloseTo(0.5, 5)
  })

  test('errored fires count toward firedCount + errorCount but not numerators', () => {
    const ev: LoggedEvent[] = []
    const dId1 = decisionId()
    ev.push(firedEvent({ decisionId: dId1, reason: 'score_in_grey_zone' }))
    ev.push({
      version: 1,
      type: 'debate_scheduler_error',
      ts: '2026-05-08T08:00:05.000Z',
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      decisionId: dId1,
      reviewRound: 1,
      reason: 'transient_io',
      underlyingErrorCode: 'provider_io_error',
    } as LoggedEvent)
    const fixture = makeFixture({
      name: 'fx-error',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.firedCount).toBe(1)
    expect(result.errorCount).toBe(1)
    expect(result.missingTerminalCount).toBe(0)
    expect(result.correctiveCount).toBe(0)
    expect(result.newActionableCount).toBe(0)
    expect(result.correctiveDeltaRate).toBe(0)
    expect(result.newActionableFindingRate).toBe(0)
  })

  test('a treatment of 99 errored + 1 corrective fire reports 1% corrective rate, not 100%', () => {
    // Codex R1 #4 worked example: "A treatment with 100 fires, 99 failed
    // postreviews, and 1 corrective postreview reports a 100 percent
    // corrective rate instead of 1 percent." C16 closes this gaming.
    const ev: LoggedEvent[] = []
    for (let i = 0; i < 99; i++) {
      const dId = decisionId()
      ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
      ev.push({
        version: 1,
        type: 'debate_scheduler_error',
        ts: '2026-05-08T08:00:05.000Z',
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        decisionId: dId,
        reviewRound: 1,
        reason: 'other',
      } as LoggedEvent)
    }
    const correctiveDId = decisionId()
    ev.push(firedEvent({ decisionId: correctiveDId, reason: 'score_in_grey_zone' }))
    ev.push(
      postreviewEvent({
        decisionId: correctiveDId,
        verdictPre: 'needs-revision',
        verdictPost: 'ready',
        actionableAdded: 1,
      }),
    )
    const fixture = makeFixture({
      name: 'fx-99-errored',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.firedCount).toBe(100)
    expect(result.errorCount).toBe(99)
    expect(result.correctiveCount).toBe(1)
    expect(result.correctiveDeltaRate).toBeCloseTo(0.01, 5) // 1%, not 100%
    expect(result.newActionableFindingRate).toBeCloseTo(0.01, 5)
  })

  test('per-fixture detail rows surface errored + missingTerminal counts', () => {
    const ev: LoggedEvent[] = []
    const dId = decisionId()
    ev.push(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' }))
    // Missing terminal
    const fixture = makeFixture({
      name: 'fx-missing',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.missingTerminalCount).toBe(1)
  })
})

describe('computeDebatePolicyBaseline — panel-mode verdict treated as inconclusive', () => {
  test('panel verdictPre + panel verdictPost classifies as neutral (no oracle compare)', () => {
    const ev: LoggedEvent[] = []
    const dId = decisionId()
    ev.push(firedEvent({ decisionId: dId, reason: 'panel_voter_disagreement' }))
    ev.push({
      version: 1,
      type: 'debate_scheduler_postreview',
      ts: '2026-05-08T08:00:05.000Z',
      runId: RUN,
      phase: 'review',
      agent: 'reviewer',
      attempt: 1,
      taskId: 'T-001',
      decisionId: dId,
      reviewRound: 1,
      preReviewReportSha256: SHA64A,
      postReviewReportSha256: SHA64B,
      verdictPre: 'panel',
      verdictPost: 'panel',
      findingsAddedCount: 1,
      actionableFindingsAddedCount: 1,
    } as LoggedEvent)
    const fixture = makeFixture({
      name: 'fx-panel',
      oracle: 'ready',
      treatmentEvents: ev,
    })
    const result = computeDebatePolicyBaseline([fixture])
    expect(result.firedCount).toBe(1)
    expect(result.correctiveCount).toBe(0) // panel is neutral
    expect(result.antiCorrectiveCount).toBe(0)
    expect(result.newActionableCount).toBe(1) // actionable still counts
  })
})

// ---------------------------------------------------------------------------
// loadFixtureSet
// ---------------------------------------------------------------------------
describe('loadFixtureSet', () => {
  test('reads fixtures from disk + parses oracle.json', async () => {
    const fxDir = join(tmp, 'fixture-set')
    const f1 = join(fxDir, 'fx-1')
    await mkdir(f1, { recursive: true })
    await writeFile(join(f1, 'oracle.json'), JSON.stringify({ verdict: 'ready' }), 'utf8')
    await writeFile(join(f1, 'control.jsonl'), '', 'utf8')
    const dId = decisionId()
    const treatment = JSON.stringify(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' })) + '\n' +
      JSON.stringify(postreviewEvent({ decisionId: dId, verdictPre: 'needs-revision', verdictPost: 'ready', actionableAdded: 1 })) + '\n'
    await writeFile(join(f1, 'treatment.jsonl'), treatment, 'utf8')

    const fixtures = await loadFixtureSet(fxDir)
    expect(fixtures.length).toBe(1)
    expect(fixtures[0]?.name).toBe('fx-1')
    expect(fixtures[0]?.oracle.verdict).toBe('ready')
    expect(fixtures[0]?.treatmentEvents.length).toBe(2)
  })

  test('skips subdirs missing required files', async () => {
    const fxDir = join(tmp, 'fixture-set')
    const incomplete = join(fxDir, 'fx-incomplete')
    await mkdir(incomplete, { recursive: true })
    // missing oracle.json + treatment.jsonl
    const fixtures = await loadFixtureSet(fxDir)
    expect(fixtures.length).toBe(0)
  })

  test('rejects invalid oracle.verdict', async () => {
    const fxDir = join(tmp, 'fixture-set')
    const f1 = join(fxDir, 'fx-bad')
    await mkdir(f1, { recursive: true })
    await writeFile(join(f1, 'oracle.json'), JSON.stringify({ verdict: 'maybe' }), 'utf8')
    await writeFile(join(f1, 'treatment.jsonl'), '', 'utf8')
    await expect(loadFixtureSet(fxDir)).rejects.toThrow(/oracle.verdict must be/)
  })
})

// ---------------------------------------------------------------------------
// runDebatePolicyBaseline driver
// ---------------------------------------------------------------------------
describe('runDebatePolicyBaseline', () => {
  test('emits debate_policy_baseline_completed with passedRuleTwentyOne', async () => {
    const fxDir = join(tmp, 'fixture-set')
    const f1 = join(fxDir, 'fx-pass')
    await mkdir(f1, { recursive: true })
    await writeFile(join(f1, 'oracle.json'), JSON.stringify({ verdict: 'ready' }), 'utf8')
    await writeFile(join(f1, 'control.jsonl'), '', 'utf8')
    let treatment = ''
    for (let i = 0; i < 5; i++) {
      const dId = decisionId()
      treatment += JSON.stringify(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' })) + '\n'
      treatment += JSON.stringify(postreviewEvent({
        decisionId: dId,
        verdictPre: 'needs-revision',
        verdictPost: 'ready',
        actionableAdded: 1,
      })) + '\n'
    }
    await writeFile(join(f1, 'treatment.jsonl'), treatment, 'utf8')

    const eventsFile = join(tmp, 'baseline-events.jsonl')
    const report = await runDebatePolicyBaseline(fxDir, {
      eventPaths: { file: eventsFile, lockDir: eventsFile + '.lock' },
      now: () => '2026-05-08T08:30:00.000Z',
      runId: RUN,
    })
    expect(report.shipGatePasses).toBe(true)
    expect(report.passedRuleTwentyOne).toBe(true)
    expect(report.summary).toContain('Rule-21 ship gate: PASS')
    expect(report.fixtures.length).toBe(1)
    expect(report.fixtures[0]?.name).toBe('fx-pass')
  })

  test('summary names FAIL when the floor is unmet', async () => {
    const fxDir = join(tmp, 'fixture-set')
    const f1 = join(fxDir, 'fx-fail')
    await mkdir(f1, { recursive: true })
    await writeFile(join(f1, 'oracle.json'), JSON.stringify({ verdict: 'ready' }), 'utf8')
    await writeFile(join(f1, 'control.jsonl'), '', 'utf8')
    // single fire that doesn't move toward oracle: pre=ready post=ready (neutral)
    let treatment = ''
    for (let i = 0; i < 3; i++) {
      const dId = decisionId()
      treatment += JSON.stringify(firedEvent({ decisionId: dId, reason: 'score_in_grey_zone' })) + '\n'
      treatment += JSON.stringify(postreviewEvent({
        decisionId: dId,
        verdictPre: 'ready',
        verdictPost: 'ready',
        actionableAdded: 0,
      })) + '\n'
    }
    await writeFile(join(f1, 'treatment.jsonl'), treatment, 'utf8')

    const report = await runDebatePolicyBaseline(fxDir)
    expect(report.shipGatePasses).toBe(false)
    expect(report.summary).toContain('Rule-21 ship gate: FAIL')
  })
})
