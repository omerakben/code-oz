// M15 commit 9 — e2e: debate-scheduler grey-zone fixtures + rule-21 ship gate.
//
// Drives the canonical fixture set under tests/fixtures/debate-scheduler-baseline/
// through the rule-21 baseline command and asserts:
//   1. Each grey-zone single-mode fixture's debate_scheduler_postreview event
//      payload matches expected verdictPre / verdictPost / findings deltas
//      (kickoff §11.9 fixture spec)
//   2. The aggregated rule-21 metrics PASS on the canonical set
//      (correctiveDeltaRate >= 0.10 AND newActionableFindingRate >= 0.30)
//   3. Per-trigger breakdown splits fires by SchedulerFireReason correctly

import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import {
  loadFixtureSet,
  runDebatePolicyBaseline,
  RULE_21_CORRECTIVE_DELTA_FLOOR,
  RULE_21_NEW_ACTIONABLE_FINDING_FLOOR,
} from '../../src/commands/doctor-debate-baseline.ts'
import type { LoggedEvent } from '../../src/state/schemas.ts'

const FIXTURE_SET = join(import.meta.dir, '..', 'fixtures', 'debate-scheduler-baseline')

function findPostreview(events: readonly LoggedEvent[]): LoggedEvent | undefined {
  return events.find((e) => (e as { type?: string }).type === 'debate_scheduler_postreview')
}

function findFired(events: readonly LoggedEvent[]): LoggedEvent | undefined {
  return events.find((e) => (e as { type?: string }).type === 'debate_scheduler_fired')
}

function findSkipped(events: readonly LoggedEvent[]): LoggedEvent | undefined {
  return events.find((e) => (e as { type?: string }).type === 'debate_scheduler_skipped')
}

// ---------------------------------------------------------------------------
// Per-fixture postreview payload assertions
// ---------------------------------------------------------------------------
describe('e2e fixture: single-grey-zone-corrective', () => {
  test('postreview matches expected: needs-revision -> ready, oracle=ready (corrective)', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === 'single-grey-zone-corrective')
    expect(fx).toBeDefined()
    if (!fx) return
    expect(fx.oracle.verdict).toBe('ready')
    const post = findPostreview(fx.treatmentEvents) as
      | (LoggedEvent & {
          verdictPre: string
          verdictPost: string
          findingsAddedCount: number
          actionableFindingsAddedCount: number
        })
      | undefined
    expect(post).toBeDefined()
    expect(post?.verdictPre).toBe('needs-revision')
    expect(post?.verdictPost).toBe('ready')
    expect(post?.findingsAddedCount).toBe(2)
    expect(post?.actionableFindingsAddedCount).toBe(1)
    const fired = findFired(fx.treatmentEvents) as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(fired?.reason).toBe('score_in_grey_zone')
  })
})

describe('e2e fixture: single-grey-zone-anti-corrective', () => {
  test('postreview matches expected: needs-revision -> ready, oracle=needs-revision (anti)', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === 'single-grey-zone-anti-corrective')
    expect(fx).toBeDefined()
    if (!fx) return
    expect(fx.oracle.verdict).toBe('needs-revision')
    const post = findPostreview(fx.treatmentEvents) as
      | (LoggedEvent & { verdictPre: string; verdictPost: string })
      | undefined
    expect(post?.verdictPre).toBe('needs-revision')
    expect(post?.verdictPost).toBe('ready')
    // Pre matches oracle (distance 0); post moves away (distance 1) — anti-corrective.
  })
})

describe('e2e fixture: single-needs-revision-high-score', () => {
  test('postreview matches expected: needs-revision -> ready via high-score trigger', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === 'single-needs-revision-high-score')
    expect(fx).toBeDefined()
    if (!fx) return
    expect(fx.oracle.verdict).toBe('ready')
    const fired = findFired(fx.treatmentEvents) as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(fired?.reason).toBe('needs_revision_with_high_score')
    const post = findPostreview(fx.treatmentEvents) as
      | (LoggedEvent & {
          verdictPre: string
          verdictPost: string
          findingsAddedCount: number
          actionableFindingsAddedCount: number
        })
      | undefined
    expect(post?.verdictPre).toBe('needs-revision')
    expect(post?.verdictPost).toBe('ready')
    expect(post?.findingsAddedCount).toBe(3)
    expect(post?.actionableFindingsAddedCount).toBe(2)
  })
})

describe('e2e fixture: single-no-signal-fire', () => {
  test('postreview matches expected: same verdict + zero deltas (no-signal)', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === 'single-no-signal-fire')
    expect(fx).toBeDefined()
    if (!fx) return
    const post = findPostreview(fx.treatmentEvents) as
      | (LoggedEvent & {
          verdictPre: string
          verdictPost: string
          findingsAddedCount: number
          actionableFindingsAddedCount: number
          preReviewReportSha256: string
          postReviewReportSha256: string
        })
      | undefined
    expect(post?.verdictPre).toBe('needs-revision')
    expect(post?.verdictPost).toBe('needs-revision')
    expect(post?.findingsAddedCount).toBe(0)
    expect(post?.actionableFindingsAddedCount).toBe(0)
    // Same sha pre and post (the canonical REVIEW.md content was unchanged).
    expect(post?.preReviewReportSha256).toBe(post?.postReviewReportSha256)
  })
})

describe('e2e fixture: manifest-size-exceeds', () => {
  test('skipped event with reason=manifest_size_exceeds_maxFiles', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === 'manifest-size-exceeds')
    expect(fx).toBeDefined()
    if (!fx) return
    const skipped = findSkipped(fx.treatmentEvents) as
      | (LoggedEvent & { reason: string })
      | undefined
    expect(skipped?.reason).toBe('manifest_size_exceeds_maxFiles')
    // No fire event (the gate skipped before fire path).
    const fired = findFired(fx.treatmentEvents)
    expect(fired).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Aggregated rule-21 ship gate
// ---------------------------------------------------------------------------
describe('e2e canonical fixture set: rule-21 ship gate PASSES', () => {
  test('runDebatePolicyBaseline reports shipGatePasses=true', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    expect(report.shipGatePasses).toBe(true)
    expect(report.passedRuleTwentyOne).toBe(true)
  })

  test('correctiveDeltaRate exceeds floor', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    expect(report.correctiveDeltaRate).toBeGreaterThanOrEqual(RULE_21_CORRECTIVE_DELTA_FLOOR)
  })

  test('newActionableFindingRate exceeds floor', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    expect(report.newActionableFindingRate).toBeGreaterThanOrEqual(
      RULE_21_NEW_ACTIONABLE_FINDING_FLOOR,
    )
  })

  test('per-trigger breakdown splits fires by SchedulerFireReason', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    const byReason = Object.fromEntries(
      report.perTriggerBreakdown.map((r) => [r.reason, r]),
    )
    expect(byReason.score_in_grey_zone?.fired).toBe(3) // fixtures 1, 2, 5
    expect(byReason.needs_revision_with_high_score?.fired).toBe(1) // fixture 3
    expect(byReason.panel_voter_disagreement?.fired).toBe(1) // fixture 4
  })

  test('antiCorrectiveCount records the regression-signal fixture', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    expect(report.antiCorrectiveCount).toBeGreaterThanOrEqual(1)
  })

  test('noSignalFireRate captures the no-signal fixture', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    // 1 of 5 fires is no-signal (fixture 5) -> 0.20.
    expect(report.noSignalFireRate).toBeCloseTo(0.2, 5)
  })

  test('summary text names PASS', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    expect(report.summary).toContain('Rule-21 ship gate: PASS')
  })
})
