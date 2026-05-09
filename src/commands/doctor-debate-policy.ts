// M15 commit 6a — `code-oz doctor --debate-policy` inspector module.
//
// Read-only command: prints current debatePolicy config + tabulates the
// last N debate_scheduler_* events from events.jsonl. No new event emitted.
//
// Resolution order for events.jsonl:
//   1. Explicit --events <file> argument (CLI tests + advanced operators)
//   2. Active-run pointer at .code-oz/state/active.json (default for
//      operators inspecting the most recent run)
//   3. None — report has no events; config still prints
//
// Per kickoff §11.7 commit 6a: read-only, no event emitted, mirrors the
// panel-baseline shape but simpler (no fixture run).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_DEBATE_POLICY,
  type CodeOzConfig,
  type DebatePolicyConfig,
} from '../config/schema.ts'
import { readEvents, type EventLogPaths } from '../state/events.ts'
import {
  isKnownPhaseEvent,
  type LoggedEvent,
} from '../state/schemas.ts'

/** Default event limit per command invocation. */
export const DEBATE_POLICY_INSPECTOR_LIMIT = 20

export interface InspectDebatePolicyOptions {
  readonly config: CodeOzConfig
  /** Optional explicit events.jsonl path. When provided, supersedes the
   *  active-run pointer. */
  readonly eventsFile?: string
  /** Optional override for the limit (default: DEBATE_POLICY_INSPECTOR_LIMIT). */
  readonly limit?: number
}

export interface SchedulerEventCounts {
  readonly evaluated: number
  readonly fired: number
  readonly skipped: number
  readonly error: number
  readonly postreview: number
}

export interface SchedulerSkipReasonCount {
  readonly reason: string
  readonly count: number
}

export interface SchedulerFireReasonCount {
  readonly reason: string
  readonly count: number
}

export interface DebatePolicyInspectionReport {
  /** Effective debatePolicy: config.debatePolicy when present, else
   *  DEFAULT_DEBATE_POLICY (the same `?? DEFAULT` resolution as the
   *  scheduler hook). The `effectiveSource` discriminator names which. */
  readonly effectivePolicy: DebatePolicyConfig
  readonly effectiveSource: 'config' | 'default'
  /** Path that was actually read for events; null when no events.jsonl
   *  was resolved. */
  readonly eventsSource: string | null
  /** Counts of each debate_scheduler_* event type across the whole log. */
  readonly counts: SchedulerEventCounts
  /** Skip reason histogram (sorted desc by count). */
  readonly skipReasons: readonly SchedulerSkipReasonCount[]
  /** Fire reason histogram (sorted desc by count). */
  readonly fireReasons: readonly SchedulerFireReasonCount[]
  /** Most-recent N debate_scheduler_* events from the log (chronological,
   *  limited to opts.limit). Each entry is a stripped projection useful
   *  for tabular display — only the fields a CLI user typically needs. */
  readonly recentEvents: readonly RecentSchedulerEvent[]
}

export interface RecentSchedulerEvent {
  readonly ts: string
  readonly type: string
  readonly reviewRound?: number
  readonly decisionId?: string
  readonly reason?: string
  readonly opposingProvider?: string
  readonly debateTopic?: string
  readonly verdictPre?: string
  readonly verdictPost?: string
  readonly findingsAddedCount?: number
  readonly actionableFindingsAddedCount?: number
}

const SCHEDULER_EVENT_TYPES = [
  'debate_scheduler_evaluated',
  'debate_scheduler_fired',
  'debate_scheduler_skipped',
  'debate_scheduler_error',
  'debate_scheduler_postreview',
] as const

/**
 * Build the inspection report. Pure of disk I/O when `opts.eventsFile`
 * is undefined (returns a config-only report); otherwise reads the file
 * via the existing readEvents authority (rule 1 — events.jsonl is the
 * truth, no parallel state).
 */
export async function inspectDebatePolicy(
  opts: InspectDebatePolicyOptions,
): Promise<DebatePolicyInspectionReport> {
  const limit = opts.limit ?? DEBATE_POLICY_INSPECTOR_LIMIT
  const effective = opts.config.debatePolicy
  const effectivePolicy = effective ?? DEFAULT_DEBATE_POLICY
  const effectiveSource: 'config' | 'default' = effective ? 'config' : 'default'

  let events: readonly LoggedEvent[] = []
  let eventsSource: string | null = null
  if (opts.eventsFile !== undefined) {
    eventsSource = opts.eventsFile
    try {
      const paths: EventLogPaths = {
        file: opts.eventsFile,
        // readEvents only reads; lockDir is unused on the read path. Pass
        // a sibling-like value for consistency with EventLogPaths shape.
        lockDir: opts.eventsFile + '.lock',
      }
      events = await readEvents(paths)
    } catch {
      // events file absent or unreadable -> empty events; eventsSource
      // still records the attempted path for transparency.
      events = []
    }
  }

  const schedulerEvents = events.filter(
    (e) =>
      isKnownPhaseEvent(e) &&
      (SCHEDULER_EVENT_TYPES as readonly string[]).includes(e.type),
  )

  const counts: SchedulerEventCounts = {
    evaluated: schedulerEvents.filter((e) => e.type === 'debate_scheduler_evaluated').length,
    fired: schedulerEvents.filter((e) => e.type === 'debate_scheduler_fired').length,
    skipped: schedulerEvents.filter((e) => e.type === 'debate_scheduler_skipped').length,
    error: schedulerEvents.filter((e) => e.type === 'debate_scheduler_error').length,
    postreview: schedulerEvents.filter((e) => e.type === 'debate_scheduler_postreview').length,
  }

  const skipReasons = histogram(
    schedulerEvents
      .filter((e) => e.type === 'debate_scheduler_skipped')
      .map((e) => (e as { reason: string }).reason),
  )
  const fireReasons = histogram(
    schedulerEvents
      .filter((e) => e.type === 'debate_scheduler_fired')
      .map((e) => (e as { reason: string }).reason),
  )

  const recentEvents = schedulerEvents
    .slice(-limit)
    .map(projectRecentEvent)

  return {
    effectivePolicy,
    effectiveSource,
    eventsSource,
    counts,
    skipReasons,
    fireReasons,
    recentEvents,
  }
}

function histogram<T extends string>(items: readonly T[]): readonly { reason: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => (b.count - a.count) || a.reason.localeCompare(b.reason))
}

function projectRecentEvent(e: LoggedEvent): RecentSchedulerEvent {
  const r = e as Record<string, unknown>
  const out: Record<string, unknown> = {
    ts: r.ts as string,
    type: r.type as string,
  }
  for (const k of [
    'reviewRound',
    'decisionId',
    'reason',
    'opposingProvider',
    'debateTopic',
    'verdictPre',
    'verdictPost',
    'findingsAddedCount',
    'actionableFindingsAddedCount',
  ]) {
    if (r[k] !== undefined) out[k] = r[k]
  }
  return out as unknown as RecentSchedulerEvent
}

/**
 * Tabular text formatter for the inspector report. Mirrors the
 * panel-baseline summary shape: a header line, a config block, a counts
 * table, a per-reason histogram, and a recent-events tail.
 */
export function formatDebatePolicyTable(report: DebatePolicyInspectionReport): string {
  const lines: string[] = []
  lines.push('# code-oz doctor --debate-policy')
  lines.push('')
  lines.push('## Effective policy')
  lines.push(`  source: ${report.effectiveSource}`)
  lines.push(`  mode: ${report.effectivePolicy.mode}`)
  lines.push(`  maxPerRun: ${report.effectivePolicy.maxPerRun}`)
  lines.push(`  maxPerTask: ${report.effectivePolicy.maxPerTask}`)
  lines.push(
    `  triggers.reviewScoreGreyZone: [${report.effectivePolicy.triggers.reviewScoreGreyZone.min}, ${report.effectivePolicy.triggers.reviewScoreGreyZone.max}]`,
  )
  lines.push(
    `  triggers.panelVoterDisagreement: ${report.effectivePolicy.triggers.panelVoterDisagreement}`,
  )
  lines.push(
    `  triggers.needsRevisionWithHighScore: ${report.effectivePolicy.triggers.needsRevisionWithHighScore}`,
  )
  lines.push(
    `  cooldown.dedupByFingerprint: ${report.effectivePolicy.cooldown.dedupByFingerprint}`,
  )
  lines.push('')
  lines.push('## Event counts')
  lines.push(`  evaluated: ${report.counts.evaluated}`)
  lines.push(`  fired: ${report.counts.fired}`)
  lines.push(`  skipped: ${report.counts.skipped}`)
  lines.push(`  error: ${report.counts.error}`)
  lines.push(`  postreview: ${report.counts.postreview}`)
  lines.push('')
  if (report.skipReasons.length > 0) {
    lines.push('## Skip reasons')
    for (const { reason, count } of report.skipReasons) {
      lines.push(`  ${reason}: ${count}`)
    }
    lines.push('')
  }
  if (report.fireReasons.length > 0) {
    lines.push('## Fire reasons')
    for (const { reason, count } of report.fireReasons) {
      lines.push(`  ${reason}: ${count}`)
    }
    lines.push('')
  }
  lines.push(`## Recent events (last ${report.recentEvents.length})`)
  if (report.eventsSource === null) {
    lines.push('  (no events file resolved — pass --events <path> or run a session first)')
  } else if (report.recentEvents.length === 0) {
    lines.push(`  (events file ${report.eventsSource} contains no debate_scheduler_* events)`)
  } else {
    for (const e of report.recentEvents) {
      const frag = [`[${e.ts}]`, e.type]
      if (e.reviewRound !== undefined) frag.push(`round=${e.reviewRound}`)
      if (e.reason !== undefined) frag.push(`reason=${e.reason}`)
      if (e.opposingProvider !== undefined) frag.push(`opp=${e.opposingProvider}`)
      if (e.verdictPre !== undefined) frag.push(`pre=${e.verdictPre}`)
      if (e.verdictPost !== undefined) frag.push(`post=${e.verdictPost}`)
      lines.push(`  ${frag.join(' ')}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Resolve the events.jsonl path from an active-run pointer file. Returns
 * null when the pointer is absent / malformed; the inspector then falls
 * back to a config-only report.
 */
export async function resolveActiveRunEventsFile(opts: {
  readonly stateDir: string
  readonly activeFile: string
}): Promise<string | null> {
  try {
    const raw = await readFile(opts.activeFile, 'utf8')
    const parsed = JSON.parse(raw) as { runId?: unknown }
    if (typeof parsed.runId !== 'string' || parsed.runId.length === 0) return null
    return join(opts.stateDir, 'runs', parsed.runId, 'events.jsonl')
  } catch {
    return null
  }
}
