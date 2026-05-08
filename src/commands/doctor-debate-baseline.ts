// M15 commit 6b — `code-oz doctor --debate-policy-baseline` rule-21 ship gate.
//
// Fixture format (commit 9 will populate; this commit ships the consumer):
//   <fixture-set>/
//     <fixture-name>/
//       oracle.json          { verdict: 'ready' | 'needs-revision' | 'block' }
//       control.jsonl        events.jsonl from a `mode: off` run
//       treatment.jsonl      events.jsonl from a `mode: auto` run
//
// The control file is consumed for diagnostic-only signal (today: empty
// scheduler signal, since mode=off skips on every gate). The treatment
// file is the rule-21 input — every `debate_scheduler_fired` event in
// treatment must have a matching `debate_scheduler_postreview` joined
// by decisionId; the postreview's verdictPre/verdictPost compare to the
// fixture oracle to classify corrective / anti-corrective / no-signal.
//
// Rule-21 ship gate (kickoff §2.8): pass requires
//   correctiveDeltaRate >= 0.10 AND newActionableFindingRate >= 0.30
// on the canonical fixture set. Per-trigger breakdown + no-signal-fire
// rate + cost/latency overhead are telemetry — non-gating.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendEvent,
  type EventLogPaths,
} from '../state/events.ts'
import {
  generateUlid,
  isKnownPhaseEvent,
  type LoggedEvent,
  type SchedulerFireReason,
} from '../state/schemas.ts'
import { SCHEDULER_FIRE_REASONS } from '../state/schemas.ts'

// ---------------------------------------------------------------------------
// Rule-21 floors
// ---------------------------------------------------------------------------

/** Rule-21 ship-gate minimum corrective verdict delta rate. Fires whose
 *  post-debate verdict moves CLOSER to the oracle than the pre-debate
 *  verdict count toward the numerator. */
export const RULE_21_CORRECTIVE_DELTA_FLOOR = 0.1

/** Rule-21 ship-gate minimum new-actionable-finding rate. Fires whose
 *  post-debate REVIEW added at least one actionable (block | fix-first)
 *  finding count toward the numerator. */
export const RULE_21_NEW_ACTIONABLE_FINDING_FLOOR = 0.3

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OracleVerdict = 'ready' | 'needs-revision' | 'block'
export type ObservedVerdict = 'ready' | 'needs-revision' | 'block' | 'panel'

export interface FixtureOracle {
  readonly verdict: OracleVerdict
}

export interface FixtureRecord {
  readonly name: string
  readonly oracle: FixtureOracle
  readonly controlEvents: readonly LoggedEvent[]
  readonly treatmentEvents: readonly LoggedEvent[]
}

export interface PerTriggerRow {
  readonly reason: SchedulerFireReason
  readonly fired: number
  readonly correctiveCount: number
  readonly newActionableCount: number
}

export interface BaselineComputation {
  readonly fixtureCount: number
  readonly firedCount: number
  /** Numerator of correctiveDeltaRate. */
  readonly correctiveCount: number
  /** Numerator of antiCorrective surface metric (fires moving AWAY from oracle). */
  readonly antiCorrectiveCount: number
  /** Numerator of noSignalFireRate. */
  readonly noSignalCount: number
  /** Numerator of newActionableFindingRate. */
  readonly newActionableCount: number
  readonly correctiveDeltaRate: number
  readonly newActionableFindingRate: number
  readonly noSignalFireRate: number
  readonly perTriggerBreakdown: readonly PerTriggerRow[]
  readonly costOverheadAvgTokens: number
  readonly latencyOverheadAvgMs: number
  readonly passedRuleTwentyOne: boolean
}

export interface BaselineReport extends BaselineComputation {
  /** Path to the canonical fixture set inspected. */
  readonly fixtureSet: string
  /** Fixture-by-fixture detail rows (useful for json output). */
  readonly fixtures: readonly {
    readonly name: string
    readonly oracle: OracleVerdict
    readonly fired: number
    readonly corrective: number
    readonly antiCorrective: number
    readonly noSignal: number
    readonly newActionable: number
  }[]
  /** Pre-rendered text summary (mirrors panel-baseline shape). */
  readonly summary: string
  /** Convenience: the rule-21 ship gate. */
  readonly shipGatePasses: boolean
}

// ---------------------------------------------------------------------------
// Pure computation: fixture records -> baseline
// ---------------------------------------------------------------------------

/**
 * Compute the baseline metrics from the loaded fixture set. Pure: no I/O,
 * no events emitted; deterministic on the input. Caller is responsible
 * for running the fixtures and supplying the events.jsonl pair per fixture.
 */
export function computeDebatePolicyBaseline(
  fixtures: readonly FixtureRecord[],
): BaselineComputation {
  let firedCount = 0
  let correctiveCount = 0
  let antiCorrectiveCount = 0
  let noSignalCount = 0
  let newActionableCount = 0
  let totalTokens = 0
  let totalLatencyMs = 0
  let timestampedFires = 0

  const triggerMap = new Map<SchedulerFireReason, { fired: number; corrective: number; newActionable: number }>()
  for (const reason of SCHEDULER_FIRE_REASONS) {
    triggerMap.set(reason, { fired: 0, corrective: 0, newActionable: 0 })
  }

  for (const fixture of fixtures) {
    const fires = collectFires(fixture.treatmentEvents)
    for (const fire of fires) {
      firedCount++
      const trigRow = triggerMap.get(fire.fired.reason as SchedulerFireReason)
      if (trigRow !== undefined) trigRow.fired++

      // Verdict-direction classification against fixture oracle.
      const oracle = fixture.oracle.verdict
      const direction = classifyVerdictDelta(fire.postreview.verdictPre, fire.postreview.verdictPost, oracle)
      if (direction === 'corrective') {
        correctiveCount++
        if (trigRow !== undefined) trigRow.corrective++
      } else if (direction === 'anti-corrective') {
        antiCorrectiveCount++
      }

      // No-signal: zero finding deltas + same verdict.
      if (
        fire.postreview.findingsAddedCount === 0 &&
        fire.postreview.verdictPre === fire.postreview.verdictPost
      ) {
        noSignalCount++
      }

      // New-actionable: post-debate added >=1 (block | fix-first) finding.
      if (fire.postreview.actionableFindingsAddedCount > 0) {
        newActionableCount++
        if (trigRow !== undefined) trigRow.newActionable++
      }

      // Cost / latency overhead are telemetry. Both are derived from the
      // fixture's recorded events; if the fixture didn't capture them,
      // we fall back to zero (baseline still computes valid metrics).
      const tokens = estimateFireTokens(fixture.treatmentEvents, fire.fired.decisionId)
      if (tokens !== null) {
        totalTokens += tokens
      }
      const latencyMs = estimateFireLatencyMs(fire.fired.ts, fire.postreview.ts)
      if (latencyMs !== null) {
        totalLatencyMs += latencyMs
        timestampedFires++
      }
    }
  }

  const correctiveDeltaRate = firedCount > 0 ? correctiveCount / firedCount : 0
  const newActionableFindingRate = firedCount > 0 ? newActionableCount / firedCount : 0
  const noSignalFireRate = firedCount > 0 ? noSignalCount / firedCount : 0
  const costOverheadAvgTokens = firedCount > 0 ? totalTokens / firedCount : 0
  const latencyOverheadAvgMs = timestampedFires > 0 ? totalLatencyMs / timestampedFires : 0
  const passedRuleTwentyOne =
    firedCount > 0 &&
    correctiveDeltaRate >= RULE_21_CORRECTIVE_DELTA_FLOOR &&
    newActionableFindingRate >= RULE_21_NEW_ACTIONABLE_FINDING_FLOOR

  const perTriggerBreakdown: readonly PerTriggerRow[] = SCHEDULER_FIRE_REASONS.map(
    (reason) => {
      const row = triggerMap.get(reason)!
      return {
        reason,
        fired: row.fired,
        correctiveCount: row.corrective,
        newActionableCount: row.newActionable,
      }
    },
  )

  return {
    fixtureCount: fixtures.length,
    firedCount,
    correctiveCount,
    antiCorrectiveCount,
    noSignalCount,
    newActionableCount,
    correctiveDeltaRate,
    newActionableFindingRate,
    noSignalFireRate,
    perTriggerBreakdown,
    costOverheadAvgTokens,
    latencyOverheadAvgMs,
    passedRuleTwentyOne,
  }
}

// ---------------------------------------------------------------------------
// Internal: events.jsonl reduction helpers
// ---------------------------------------------------------------------------

interface JoinedFire {
  readonly fired: {
    readonly decisionId: string
    readonly reason: string
    readonly ts: string
  }
  readonly postreview: {
    readonly ts: string
    readonly verdictPre: ObservedVerdict
    readonly verdictPost: ObservedVerdict
    readonly findingsAddedCount: number
    readonly actionableFindingsAddedCount: number
  }
}

/** Join debate_scheduler_fired with debate_scheduler_postreview by
 *  decisionId. Fires without a matching postreview are silently dropped —
 *  the rule-21 metric is about completed scheduler decisions only;
 *  in-flight or errored fires are surfaced in counts.error elsewhere. */
function collectFires(events: readonly LoggedEvent[]): readonly JoinedFire[] {
  const fires = new Map<string, { decisionId: string; reason: string; ts: string }>()
  const postreviews = new Map<string, JoinedFire['postreview']>()
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'debate_scheduler_fired') {
      fires.set(e.decisionId, { decisionId: e.decisionId, reason: e.reason, ts: e.ts })
    } else if (e.type === 'debate_scheduler_postreview') {
      postreviews.set(e.decisionId, {
        ts: e.ts,
        verdictPre: e.verdictPre as ObservedVerdict,
        verdictPost: e.verdictPost as ObservedVerdict,
        findingsAddedCount: e.findingsAddedCount,
        actionableFindingsAddedCount: e.actionableFindingsAddedCount,
      })
    }
  }
  const joined: JoinedFire[] = []
  for (const [decisionId, fired] of fires) {
    const postreview = postreviews.get(decisionId)
    if (postreview !== undefined) joined.push({ fired, postreview })
  }
  return joined
}

/** Classify the verdict delta direction against the fixture oracle.
 *  Distance to oracle is 0 for match, 1 for mismatch, +1 for the special
 *  'panel' literal (panel-mode REVIEW carries no numeric oracle today;
 *  treated as inconclusive — neither corrective nor anti-corrective).
 */
function classifyVerdictDelta(
  pre: ObservedVerdict,
  post: ObservedVerdict,
  oracle: OracleVerdict,
): 'corrective' | 'anti-corrective' | 'neutral' {
  const distPre = verdictDistance(pre, oracle)
  const distPost = verdictDistance(post, oracle)
  if (distPre === null || distPost === null) return 'neutral'
  if (distPost < distPre) return 'corrective'
  if (distPost > distPre) return 'anti-corrective'
  return 'neutral'
}

function verdictDistance(verdict: ObservedVerdict, oracle: OracleVerdict): number | null {
  if (verdict === 'panel') return null  // panel mode: no oracle comparison in v0.1
  return verdict === oracle ? 0 : 1
}

function estimateFireTokens(
  events: readonly LoggedEvent[],
  decisionId: string,
): number | null {
  // The treatment events.jsonl carries `agent_invoked.tokensEstimate` for
  // each provider call; correlation through `debateTopic` (set by the
  // fire path on debate_scheduler_fired) lets us sum the relevant calls.
  // For commit 6b we compute a coarse estimate: sum tokensEstimate across
  // every agent_invoked between the fired and postreview events for the
  // same decisionId. Returns null if the fixture doesn't carry the data.
  let tokens = 0
  let inSpan = false
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (e.type === 'debate_scheduler_fired' && e.decisionId === decisionId) {
      inSpan = true
      continue
    }
    if (e.type === 'debate_scheduler_postreview' && e.decisionId === decisionId) {
      inSpan = false
      break
    }
    if (inSpan && e.type === 'agent_invoked') {
      tokens += e.tokensEstimate
    }
  }
  return tokens > 0 ? tokens : null
}

function estimateFireLatencyMs(firedTs: string, postreviewTs: string): number | null {
  const a = Date.parse(firedTs)
  const b = Date.parse(postreviewTs)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, b - a)
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

/**
 * Load the fixture set from disk. Each subdirectory of `fixtureSet` is one
 * fixture; required files: oracle.json, control.jsonl, treatment.jsonl.
 * Subdirectories missing any required file are skipped with a warning
 * (commit 9 will populate the canonical set; commit 6b's tests exercise
 * the loader against synthetic fixtures).
 */
export async function loadFixtureSet(fixtureSet: string): Promise<readonly FixtureRecord[]> {
  const entries = await readdir(fixtureSet, { withFileTypes: true })
  const fixtures: FixtureRecord[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(fixtureSet, entry.name)
    const oraclePath = join(dir, 'oracle.json')
    const controlPath = join(dir, 'control.jsonl')
    const treatmentPath = join(dir, 'treatment.jsonl')
    try {
      await stat(oraclePath)
      await stat(treatmentPath)
    } catch {
      continue
    }
    const oracleRaw = await readFile(oraclePath, 'utf8')
    const oracle = JSON.parse(oracleRaw) as FixtureOracle
    if (oracle.verdict !== 'ready' && oracle.verdict !== 'needs-revision' && oracle.verdict !== 'block') {
      throw new Error(`fixture ${entry.name}: oracle.verdict must be ready | needs-revision | block`)
    }
    const controlEvents = await readEventsFile(controlPath).catch(() => [] as LoggedEvent[])
    const treatmentEvents = await readEventsFile(treatmentPath)
    fixtures.push({
      name: entry.name,
      oracle,
      controlEvents,
      treatmentEvents,
    })
  }
  return fixtures
}

async function readEventsFile(path: string): Promise<readonly LoggedEvent[]> {
  const raw = await readFile(path, 'utf8')
  const events: LoggedEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    events.push(JSON.parse(trimmed) as LoggedEvent)
  }
  return events
}

// ---------------------------------------------------------------------------
// Driver: load + compute + emit baseline event + render summary
// ---------------------------------------------------------------------------

export interface RunDebatePolicyBaselineOptions {
  /** Where to emit the `debate_policy_baseline_completed` event. When
   *  omitted, the driver still returns the report but does not touch
   *  events.jsonl — useful for offline `--json` inspection. */
  readonly eventPaths?: EventLogPaths
  /** Override clock for deterministic ts values in tests. */
  readonly now?: () => string
  /** Override runId in the event (default: a fresh ULID). */
  readonly runId?: string
}

export async function runDebatePolicyBaseline(
  fixtureSet: string,
  opts: RunDebatePolicyBaselineOptions = {},
): Promise<BaselineReport> {
  const fixtures = await loadFixtureSet(fixtureSet)
  const computed = computeDebatePolicyBaseline(fixtures)

  const now = opts.now ?? (() => new Date().toISOString())
  const runId = opts.runId ?? generateUlid()

  // Emit baseline event when caller wired event paths.
  if (opts.eventPaths !== undefined) {
    await appendEvent(opts.eventPaths, {
      version: 1,
      type: 'debate_policy_baseline_completed',
      ts: now(),
      runId,
      fixtureSet,
      correctiveDeltaRate: computed.correctiveDeltaRate,
      antiCorrectiveCount: computed.antiCorrectiveCount,
      newActionableFindingRate: computed.newActionableFindingRate,
      noSignalFireRate: computed.noSignalFireRate,
      perTriggerBreakdown: computed.perTriggerBreakdown,
      costOverheadAvgTokens: computed.costOverheadAvgTokens,
      latencyOverheadAvgMs: computed.latencyOverheadAvgMs,
      passedRuleTwentyOne: computed.passedRuleTwentyOne,
    })
  }

  const fixturesDetail = fixtures.map((f) => {
    const fires = collectFires(f.treatmentEvents)
    let corrective = 0
    let antiCorrective = 0
    let noSignal = 0
    let newActionable = 0
    for (const fire of fires) {
      const direction = classifyVerdictDelta(
        fire.postreview.verdictPre,
        fire.postreview.verdictPost,
        f.oracle.verdict,
      )
      if (direction === 'corrective') corrective++
      else if (direction === 'anti-corrective') antiCorrective++
      if (
        fire.postreview.findingsAddedCount === 0 &&
        fire.postreview.verdictPre === fire.postreview.verdictPost
      ) {
        noSignal++
      }
      if (fire.postreview.actionableFindingsAddedCount > 0) newActionable++
    }
    return {
      name: f.name,
      oracle: f.oracle.verdict,
      fired: fires.length,
      corrective,
      antiCorrective,
      noSignal,
      newActionable,
    }
  })

  const summary = renderBaselineSummary(fixtureSet, computed)

  return {
    ...computed,
    fixtureSet,
    fixtures: fixturesDetail,
    summary,
    shipGatePasses: computed.passedRuleTwentyOne,
  }
}

function renderBaselineSummary(fixtureSet: string, computed: BaselineComputation): string {
  const lines: string[] = []
  lines.push('# code-oz doctor --debate-policy-baseline')
  lines.push('')
  lines.push(`Fixture set: ${fixtureSet}`)
  lines.push(`Fixtures: ${computed.fixtureCount}`)
  lines.push(`Fires: ${computed.firedCount}`)
  lines.push('')
  lines.push('## Rule-21 metrics')
  lines.push(
    `  correctiveDeltaRate: ${computed.correctiveDeltaRate.toFixed(3)} ` +
      `(floor ${RULE_21_CORRECTIVE_DELTA_FLOOR})`,
  )
  lines.push(
    `  newActionableFindingRate: ${computed.newActionableFindingRate.toFixed(3)} ` +
      `(floor ${RULE_21_NEW_ACTIONABLE_FINDING_FLOOR})`,
  )
  lines.push(`  antiCorrectiveCount: ${computed.antiCorrectiveCount} (regression signal)`)
  lines.push(`  noSignalFireRate: ${computed.noSignalFireRate.toFixed(3)} (telemetry)`)
  lines.push('')
  lines.push('## Telemetry')
  lines.push(`  costOverheadAvgTokens: ${computed.costOverheadAvgTokens.toFixed(0)}`)
  lines.push(`  latencyOverheadAvgMs: ${computed.latencyOverheadAvgMs.toFixed(0)}`)
  lines.push('')
  lines.push('## Per-trigger breakdown')
  for (const row of computed.perTriggerBreakdown) {
    lines.push(
      `  ${row.reason}: fired=${row.fired} corrective=${row.correctiveCount} ` +
        `newActionable=${row.newActionableCount}`,
    )
  }
  lines.push('')
  lines.push(
    `Rule-21 ship gate: ${computed.passedRuleTwentyOne ? 'PASS' : 'FAIL'}`,
  )
  return lines.join('\n')
}
