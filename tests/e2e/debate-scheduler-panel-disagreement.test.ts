// M15 commit 9 — e2e: debate-scheduler panel-voter-disagreement fixture.
//
// Panel-mode REVIEW carries no numeric Score.Final score (Codex Risk #1);
// the only panel-mode trigger is `panel_voter_disagreement`. The fixture
// demonstrates: eligible voters split -> scheduler fires -> debate runs ->
// post-debate panel REVIEW round writes a new canonical REVIEW.md with
// updated findings. The postreview event records verdictPre='panel' and
// verdictPost='panel' (the literal sentinel — panel mode has no
// oracle-comparable verdict in v0.1).

import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import {
  loadFixtureSet,
  runDebatePolicyBaseline,
} from '../../src/commands/doctor-debate-baseline.ts'
import type { LoggedEvent } from '../../src/state/schemas.ts'

const FIXTURE_SET = join(import.meta.dir, '..', 'fixtures', 'debate-scheduler-baseline')
const FIXTURE_NAME = 'panel-voter-disagreement'

function findEvent(events: readonly LoggedEvent[], type: string): LoggedEvent | undefined {
  return events.find((e) => (e as { type?: string }).type === type)
}

describe('e2e fixture: panel-voter-disagreement', () => {
  test('fired event reason is panel_voter_disagreement', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === FIXTURE_NAME)
    expect(fx).toBeDefined()
    if (!fx) return
    const fired = findEvent(fx.treatmentEvents, 'debate_scheduler_fired') as
      | (LoggedEvent & { reason: string; opposingProvider: string })
      | undefined
    expect(fired?.reason).toBe('panel_voter_disagreement')
    expect(fired?.opposingProvider).toBe('claude')
  })

  test('postreview verdictPre and verdictPost are both literal `panel`', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === FIXTURE_NAME)
    if (!fx) return
    const post = findEvent(fx.treatmentEvents, 'debate_scheduler_postreview') as
      | (LoggedEvent & { verdictPre: string; verdictPost: string })
      | undefined
    expect(post?.verdictPre).toBe('panel')
    expect(post?.verdictPost).toBe('panel')
  })

  test('postreview records actionable finding deltas (panel debates can still surface signal)', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === FIXTURE_NAME)
    if (!fx) return
    const post = findEvent(fx.treatmentEvents, 'debate_scheduler_postreview') as
      | (LoggedEvent & { findingsAddedCount: number; actionableFindingsAddedCount: number })
      | undefined
    expect(post?.findingsAddedCount).toBe(2)
    expect(post?.actionableFindingsAddedCount).toBe(1)
  })

  test('reviewMode on evaluated event is `panel`', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === FIXTURE_NAME)
    if (!fx) return
    const evaluated = findEvent(fx.treatmentEvents, 'debate_scheduler_evaluated') as
      | (LoggedEvent & { reviewMode: string })
      | undefined
    expect(evaluated?.reviewMode).toBe('panel')
  })

  test('decisionId correlates evaluated -> fired -> postreview', async () => {
    const fixtures = await loadFixtureSet(FIXTURE_SET)
    const fx = fixtures.find((f) => f.name === FIXTURE_NAME)
    if (!fx) return
    const evaluated = findEvent(fx.treatmentEvents, 'debate_scheduler_evaluated') as
      | (LoggedEvent & { decisionId: string })
      | undefined
    const fired = findEvent(fx.treatmentEvents, 'debate_scheduler_fired') as
      | (LoggedEvent & { decisionId: string })
      | undefined
    const post = findEvent(fx.treatmentEvents, 'debate_scheduler_postreview') as
      | (LoggedEvent & { decisionId: string })
      | undefined
    expect(evaluated?.decisionId).toBeDefined()
    expect(fired?.decisionId).toBe(evaluated?.decisionId)
    expect(post?.decisionId).toBe(evaluated?.decisionId)
  })
})

describe('panel-mode panel verdict treated as inconclusive in rule-21 metric', () => {
  test('panel fixture contributes actionable count but neutral corrective', async () => {
    const report = await runDebatePolicyBaseline(FIXTURE_SET)
    // The panel fixture's pre and post are both 'panel'; the verdictDistance
    // function returns null for panel verdicts so this fixture cannot be
    // classified as corrective or anti-corrective. It DOES contribute one
    // actionable finding to the new-actionable-finding-rate numerator.
    const byReason = Object.fromEntries(
      report.perTriggerBreakdown.map((r) => [r.reason, r]),
    )
    expect(byReason.panel_voter_disagreement?.fired).toBe(1)
    expect(byReason.panel_voter_disagreement?.correctiveCount).toBe(0)
    expect(byReason.panel_voter_disagreement?.newActionableCount).toBe(1)
  })
})
