// `code-oz doctor run` — read-only run inspector (M16 C10).
//
// Operator-friendly snapshot of the active run's phase, task cursor,
// recent events, intervention state, worktree presence, and the most
// recent debate-scheduler events for the current REVIEW round.
//
// Hard rules (C10 acceptance):
//   - No state mutation. No file writes. No network. Pure reads.
//   - Always exits EXIT_OK (0). Failures degrade to "no active run" or a
//     section-level placeholder; the inspector NEVER refuses to print.
//   - Idempotent: running twice on the same project produces identical
//     output (modulo wall-clock, which the inspector does not include).
//
// Output structure (in order, per kickoff line 128):
//   1. Active runId.
//   2. currentPhase + cursor summary.
//   3. Task cursor (per-task statuses).
//   4. Recent events (last 10, most recent first).
//   5. Intervention state (NEEDS_INTERVENTION.json presence + first 200 chars).
//   6. Worktree existence (path + base.txt sha when readable).
//   7. Scheduler events for the current REVIEW round (only when phase=review).
//
// Section format follows the existing doctor surface: a "## Title" heading
// + indented two-space lines. Mirrors `formatDebatePolicyTable` in
// `src/commands/doctor-debate-policy.ts` for visual consistency.

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { paths as codeOzPaths } from '../paths.ts'
import {
  readActiveRun,
  reduceEvents,
  runPathsFor,
  type RunPaths,
} from '../state/run.ts'
import { readEvents } from '../state/events.ts'
import {
  isKnownPhaseEvent,
  type LoggedEvent,
  type Phase,
} from '../state/schemas.ts'
import { parsePlan, type PlanArtifact } from '../artifacts/plan.ts'
import { projectTaskCursor, type TaskCursor } from '../state/task-cursor.ts'
import { runPaths as worktreeRunPaths } from '../worktree/paths.ts'

/** Last-N event tail printed in the recent-events section. */
export const DOCTOR_RUN_RECENT_EVENT_LIMIT = 10
/** Max chars of NEEDS_INTERVENTION.json content displayed in the report. */
export const DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS = 200

export interface DoctorRunReport {
  readonly cwd: string
  /** Active runId or null when no `state/active.json` pointer exists. */
  readonly runId: string | null
  /** Phase derived from events.jsonl, or null when no run / no events. */
  readonly currentPhase: Phase | null
  /** Cursor projection over PLAN.md + events. null when PLAN.md is absent
   *  or unparseable; `cursorError` then carries the reason. */
  readonly cursor: TaskCursor | null
  readonly cursorError?: string
  /** Last N events (most recent first; chronological flip). */
  readonly recentEvents: readonly DoctorRunEventLine[]
  /** Total count of events on disk. */
  readonly totalEvents: number
  /** Intervention preview (file present?) and first-N-chars. */
  readonly intervention: DoctorRunInterventionInfo
  /** Worktree directory + base.txt sha if available. */
  readonly worktree: DoctorRunWorktreeInfo
  /** Scheduler events for the current REVIEW round, filtered to
   *  (runId, taskId, attempt, reviewRound). Only populated when
   *  currentPhase === 'review' and a pending task exists; otherwise empty. */
  readonly schedulerEvents: readonly DoctorRunSchedulerEvent[]
}

export interface DoctorRunEventLine {
  readonly ts: string
  readonly type: string
  /** Compact key=value summary of fields the operator typically wants. */
  readonly summary: string
}

export interface DoctorRunInterventionInfo {
  readonly present: boolean
  readonly path: string
  /** First N chars of the file (truncated marker added when longer). */
  readonly preview?: string
  /** When the read failed; null on absent. */
  readonly readError?: string
}

export interface DoctorRunWorktreeInfo {
  readonly present: boolean
  readonly runDirPath: string
  readonly worktreeDirPath: string
  /** Contents of base.txt (trimmed) if readable. */
  readonly baseSha?: string
}

export interface DoctorRunSchedulerEvent {
  readonly ts: string
  readonly type: string
  readonly reviewRound?: number
  readonly reason?: string
  readonly opposingProvider?: string
  readonly verdictPre?: string
  readonly verdictPost?: string
}

export interface InspectRunOptions {
  readonly cwd?: string
}

/**
 * Build the inspection report. All disk reads are graceful — missing /
 * unreadable inputs degrade to optional fields. No locks acquired (the
 * inspector must be safe to run during a live phase).
 */
export async function inspectRun(opts: InspectRunOptions = {}): Promise<DoctorRunReport> {
  const cwd = opts.cwd ?? process.cwd()
  const cz = codeOzPaths(cwd)
  const runId = await readActiveRun(cz.activeRun).catch(() => null)

  if (runId === null) {
    return Object.freeze({
      cwd,
      runId: null,
      currentPhase: null,
      cursor: null,
      recentEvents: Object.freeze([] as DoctorRunEventLine[]),
      totalEvents: 0,
      intervention: Object.freeze({
        present: false,
        path: '',
      }),
      worktree: Object.freeze({
        present: false,
        runDirPath: '',
        worktreeDirPath: '',
      }),
      schedulerEvents: Object.freeze([] as DoctorRunSchedulerEvent[]),
    })
  }

  const runPaths = runPathsFor(cz.state, cz.artifacts, runId)

  // Read events without acquiring the per-run lock — readEvents is
  // append-safe (file order is the ordering authority, rule 8) and the
  // inspector tolerates the appended-while-reading race by treating the
  // tail as "what was on disk at read time."
  let events: readonly LoggedEvent[] = []
  try {
    events = await readEvents({
      file: runPaths.eventsFile,
      lockDir: runPaths.lockDir,
    })
  } catch {
    events = []
  }

  const state = events.length > 0 ? reduceEvents(events) : null
  const currentPhase = state?.currentPhase ?? null

  const { cursor, cursorError } = await projectCursor(cz.artifacts, events)

  const recentEvents = projectRecentEvents(events)

  const intervention = await readInterventionPreview(runPaths)

  const worktree = await readWorktreeInfo(cwd, runId)

  const schedulerEvents = projectSchedulerEvents(events, currentPhase, cursor, runId)

  return Object.freeze({
    cwd,
    runId,
    currentPhase,
    cursor,
    ...(cursorError !== undefined ? { cursorError } : {}),
    recentEvents,
    totalEvents: events.length,
    intervention,
    worktree,
    schedulerEvents,
  })
}

async function projectCursor(
  artifactRoot: string,
  events: readonly LoggedEvent[],
): Promise<{ cursor: TaskCursor | null; cursorError?: string }> {
  let plan: PlanArtifact
  try {
    const planPath = join(artifactRoot, 'PLAN.md')
    const raw = await readFile(planPath, 'utf8')
    plan = parsePlan(raw, planPath)
  } catch (err) {
    return { cursor: null, cursorError: (err as Error).message }
  }
  const result = projectTaskCursor(plan, events)
  return { cursor: result.cursor }
}

function projectRecentEvents(
  events: readonly LoggedEvent[],
): readonly DoctorRunEventLine[] {
  if (events.length === 0) return Object.freeze([])
  // Slice the chronological tail, then flip to most-recent-first for display.
  const tail = events.slice(-DOCTOR_RUN_RECENT_EVENT_LIMIT).reverse()
  const lines: DoctorRunEventLine[] = []
  for (const e of tail) {
    lines.push(
      Object.freeze({
        ts: e.ts,
        type: e.type,
        summary: summarizeEvent(e),
      }),
    )
  }
  return Object.freeze(lines)
}

/**
 * Compact one-line summary of the event's distinctive fields. Skips the
 * envelope (version/type/ts/runId) since the caller already prints those.
 */
function summarizeEvent(e: LoggedEvent): string {
  const r = e as Record<string, unknown>
  const interesting = [
    'phase',
    'agent',
    'taskId',
    'taskIndex',
    'attempt',
    'reviewRound',
    'outcome',
    'verdict',
    'finalRound',
    'finalScore',
    'reason',
    'opposingProvider',
    'verdictPre',
    'verdictPost',
    'code',
    'profile',
    'mode',
    'providerAlias',
    'providerFamily',
    'fakeScriptPath',
  ]
  const parts: string[] = []
  for (const k of interesting) {
    const v = r[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}=${String(v)}`)
    }
  }
  return parts.join(' ')
}

async function readInterventionPreview(
  runPaths: RunPaths,
): Promise<DoctorRunInterventionInfo> {
  const path = join(runPaths.runDir, 'NEEDS_INTERVENTION.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ present: false, path })
    }
    return Object.freeze({
      present: true,
      path,
      readError: (err as Error).message,
    })
  }
  const truncated = raw.length > DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS
  const preview = truncated
    ? raw.slice(0, DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS)
    : raw
  return Object.freeze({
    present: true,
    path,
    preview,
  })
}

async function readWorktreeInfo(
  cwd: string,
  runId: string,
): Promise<DoctorRunWorktreeInfo> {
  let wt
  try {
    wt = worktreeRunPaths(cwd, runId)
  } catch {
    return Object.freeze({
      present: false,
      runDirPath: '',
      worktreeDirPath: '',
    })
  }
  let runDirExists = false
  try {
    await access(wt.run)
    runDirExists = true
  } catch {
    runDirExists = false
  }
  if (!runDirExists) {
    return Object.freeze({
      present: false,
      runDirPath: wt.run,
      worktreeDirPath: wt.worktree,
    })
  }
  let baseSha: string | undefined
  try {
    const raw = await readFile(wt.baseFile, 'utf8')
    baseSha = raw.trim()
  } catch {
    baseSha = undefined
  }
  return Object.freeze({
    present: true,
    runDirPath: wt.run,
    worktreeDirPath: wt.worktree,
    ...(baseSha !== undefined ? { baseSha } : {}),
  })
}

function projectSchedulerEvents(
  events: readonly LoggedEvent[],
  currentPhase: Phase | null,
  cursor: TaskCursor | null,
  runId: string,
): readonly DoctorRunSchedulerEvent[] {
  if (currentPhase !== 'review') return Object.freeze([])
  if (cursor === null || cursor.pending === null) return Object.freeze([])
  const taskId = cursor.pending.taskId

  const SCHEDULER_TYPES = new Set([
    'debate_scheduler_evaluated',
    'debate_scheduler_fired',
    'debate_scheduler_skipped',
    'debate_scheduler_error',
    'debate_scheduler_postreview',
  ])

  // Determine the current REVIEW round and attempt for the pending task
  // by scanning scheduler events themselves: the most-recent scheduler
  // event for (runId, taskId) names the live round/attempt. The five
  // scheduler event variants all carry reviewRound + attempt fields.
  let attempt: number | null = null
  let reviewRound: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (!SCHEDULER_TYPES.has(e.type)) continue
    const r = e as Record<string, unknown>
    if (r.runId !== runId) continue
    if (r.taskId !== taskId) continue
    if (typeof r.attempt === 'number') attempt = r.attempt
    if (typeof r.reviewRound === 'number') reviewRound = r.reviewRound
    break
  }

  const matched: DoctorRunSchedulerEvent[] = []
  for (const e of events) {
    if (!isKnownPhaseEvent(e)) continue
    if (!SCHEDULER_TYPES.has(e.type)) continue
    const r = e as Record<string, unknown>
    if (r.runId !== runId) continue
    if (r.taskId !== taskId) continue
    if (attempt !== null && typeof r.attempt === 'number' && r.attempt !== attempt) {
      continue
    }
    if (
      reviewRound !== null &&
      typeof r.reviewRound === 'number' &&
      r.reviewRound !== reviewRound
    ) {
      continue
    }
    const out: Record<string, unknown> = {
      ts: r.ts as string,
      type: r.type as string,
    }
    for (const k of [
      'reviewRound',
      'reason',
      'opposingProvider',
      'verdictPre',
      'verdictPost',
    ]) {
      if (r[k] !== undefined) out[k] = r[k]
    }
    matched.push(out as unknown as DoctorRunSchedulerEvent)
  }
  return Object.freeze(matched)
}

/**
 * Format the inspection report as operator-friendly text. Mirrors the
 * shape of `formatDebatePolicyTable` (M15 commit 6a) — section headings
 * with two-space indent for fields.
 */
export function formatDoctorRunReport(report: DoctorRunReport): string {
  const lines: string[] = []
  lines.push('# code-oz doctor run')
  lines.push('')

  // 1. Active runId
  if (report.runId === null) {
    lines.push('## Active run')
    lines.push('  no active run')
    lines.push('')
    return lines.join('\n') + '\n'
  }
  lines.push('## Active run')
  lines.push(`  runId: ${report.runId}`)
  lines.push(`  cwd: ${report.cwd}`)
  lines.push('')

  // 2. Phase + cursor summary
  lines.push('## Phase')
  lines.push(`  currentPhase: ${report.currentPhase ?? '(unknown)'}`)
  if (report.cursor !== null) {
    const c = report.cursor
    const pendingId = c.pending?.taskId ?? '(none — all completed)'
    const pendingIdx = c.pending?.taskIndex
    lines.push(
      `  cursor: pendingTaskId=${pendingId}` +
        (pendingIdx !== undefined ? ` pendingTaskIndex=${pendingIdx}` : ''),
    )
    lines.push(`  plan.tasks.length: ${c.entries.length}`)
    lines.push(`  allCompleted: ${c.allCompleted}`)
  } else {
    lines.push('  cursor: unavailable')
    if (report.cursorError !== undefined) {
      lines.push(`  cursorError: ${report.cursorError}`)
    }
  }
  lines.push('')

  // 3. Task cursor (per-task statuses)
  lines.push('## Tasks')
  if (report.cursor === null) {
    lines.push('  (cursor unavailable — see Phase section above)')
  } else if (report.cursor.entries.length === 0) {
    lines.push('  (no tasks in PLAN.md)')
  } else {
    for (const entry of report.cursor.entries) {
      lines.push(
        `  [${entry.taskIndex}] ${entry.taskId} status=${entry.status}` +
          (entry.reviewPassed ? ' reviewPassed=true' : ''),
      )
    }
  }
  lines.push('')

  // 4. Recent events
  lines.push(`## Recent events (last ${report.recentEvents.length} of ${report.totalEvents}, most recent first)`)
  if (report.recentEvents.length === 0) {
    lines.push('  (no events recorded)')
  } else {
    for (const e of report.recentEvents) {
      const tail = e.summary.length > 0 ? ` ${e.summary}` : ''
      lines.push(`  ${e.ts} ${e.type}${tail}`)
    }
  }
  lines.push('')

  // 5. Intervention state
  lines.push('## Intervention')
  if (report.intervention.readError !== undefined) {
    lines.push(`  present: true (read error)`)
    lines.push(`  path: ${report.intervention.path}`)
    lines.push(`  error: ${report.intervention.readError}`)
  } else if (report.intervention.present) {
    lines.push(`  present: true`)
    lines.push(`  path: ${report.intervention.path}`)
    if (report.intervention.preview !== undefined) {
      const truncated =
        report.intervention.preview.length === DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS
      lines.push(`  preview (first ${DOCTOR_RUN_INTERVENTION_PREVIEW_CHARS} chars${truncated ? ', truncated' : ''}):`)
      // Indent the content for readability.
      for (const ln of report.intervention.preview.split('\n')) {
        lines.push(`    ${ln}`)
      }
    }
  } else {
    lines.push('  present: false')
  }
  lines.push('')

  // 6. Worktree
  lines.push('## Worktree')
  if (report.worktree.present) {
    lines.push('  present: true')
    lines.push(`  runDir: ${report.worktree.runDirPath}`)
    lines.push(`  worktreeDir: ${report.worktree.worktreeDirPath}`)
    if (report.worktree.baseSha !== undefined) {
      lines.push(`  base.txt: ${report.worktree.baseSha}`)
    } else {
      lines.push('  base.txt: (unreadable or absent)')
    }
  } else {
    lines.push('  present: false')
    if (report.worktree.runDirPath.length > 0) {
      lines.push(`  expected runDir: ${report.worktree.runDirPath}`)
    }
  }
  lines.push('')

  // 7. Scheduler events for the current REVIEW round
  lines.push('## Scheduler events (current REVIEW round)')
  if (report.currentPhase !== 'review') {
    lines.push(`  (skipped — currentPhase is ${report.currentPhase ?? '(unknown)'}, not review)`)
  } else if (report.schedulerEvents.length === 0) {
    lines.push('  (none recorded for the current round)')
  } else {
    for (const e of report.schedulerEvents) {
      const frag: string[] = [`${e.ts}`, e.type]
      if (e.reviewRound !== undefined) frag.push(`round=${e.reviewRound}`)
      if (e.reason !== undefined) frag.push(`reason=${e.reason}`)
      if (e.opposingProvider !== undefined) frag.push(`opp=${e.opposingProvider}`)
      if (e.verdictPre !== undefined) frag.push(`pre=${e.verdictPre}`)
      if (e.verdictPost !== undefined) frag.push(`post=${e.verdictPost}`)
      lines.push(`  ${frag.join(' ')}`)
    }
  }
  lines.push('')

  return lines.join('\n') + '\n'
}

/**
 * CLI shim: run the inspector and print the operator-friendly report.
 * Always exits with EXIT_OK (0). Read-only contract.
 */
export async function runDoctorRunCommand(args: string[]): Promise<void> {
  const json = args.includes('--json')
  const report = await inspectRun()
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(formatDoctorRunReport(report))
  }
  process.exit(0)
}
