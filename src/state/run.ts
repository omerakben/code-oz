// Run orchestration: ties together event log, gate writers, and the derived
// current.json. Owns the layered write sequence specified in
// docs/references/file-based-gates.md anti-patterns:
//
//   write gate -> append gate_written -> append phase_exited/phase_entered
//   -> rebuild current
//
// gates.ts and events.ts are pure I/O modules that don't know about each
// other; run.ts is the only place those operations are sequenced. The full
// transaction runs under a single per-run lock acquisition (not one lock
// per inner call) to prevent interleaving from concurrent processes.
//
// Cross-file recovery (validation rule 9 in the pinned spec): if a
// GATE_<PHASE>_PASSED.json file exists on disk but the corresponding
// gate_written event is absent, loadRun() appends the missing event AND
// any missing transition events (phase_exited, phase_entered/run_ended)
// before returning. This handles every crash window between gate rename
// and the final transition append.
//
// Cross-file integrity check (also rule 9): if a gate_written event exists
// but the gate file is absent OR fails to validate, validateRunIntegrity
// surfaces gate_written_event_missing_file (or the underlying gate error)
// from readGate.

import { open, rename, rm, readFile, mkdir } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  PHASES,
  type Phase,
  type Profile,
  type GateFile,
  type LoggedEvent,
  type PhaseEvent,
  type RunState,
  type ActiveRunPointer,
  isKnownPhaseEvent,
  isPhase,
  isProfile,
  isUlid,
} from './schemas.ts'
import { GateLoadError, EventLogError } from './errors.ts'
import { initialPhase, nextPhase } from './machine.ts'
import {
  appendEvent,
  readEvents,
  type EventLogPaths,
} from './events.ts'
import { gateFilename, readGate, writeGate, type GatePaths } from './gates.ts'
import { LockBusyError, withLock } from './lock.ts'
import {
  findLatestReviewResolved,
  projectTaskCursor,
} from './task-cursor.ts'
import { parsePlan, type PlanArtifact } from '../artifacts/plan.ts'
import {
  EFFORT_MULTIPLIERS,
  type EffortLevel,
} from '../config/effort.ts'
import type { Budgets } from '../config/schema.ts'

// --- paths ---------------------------------------------------------

export interface RunPaths {
  readonly stateDir: string
  readonly artifactRoot: string
  readonly runDir: string
  readonly eventsFile: string
  readonly currentFile: string
  readonly lockDir: string
  readonly activeFile: string
}

/**
 * Construct the canonical RunPaths for a given run. State lives at
 * `<stateDir>/runs/<runId>/`; the active-run pointer at `<stateDir>/active.json`.
 */
export function runPathsFor(stateDir: string, artifactRoot: string, runId: string): RunPaths {
  const runDir = join(stateDir, 'runs', runId)
  return Object.freeze({
    stateDir,
    artifactRoot,
    runDir,
    eventsFile: join(runDir, 'events.jsonl'),
    currentFile: join(runDir, 'current.json'),
    lockDir: join(runDir, '.lock'),
    activeFile: join(stateDir, 'active.json'),
  })
}

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function gatePathsFor(paths: RunPaths): GatePaths {
  return { runDir: paths.runDir, artifactRoot: paths.artifactRoot, lockDir: paths.lockDir }
}

function activeLockDirFor(activeFile: string): string {
  return join(dirname(activeFile), '.active.lock')
}

// M16 C9 follow-on (3) — class-fix helper for task-boundary supersedence.
//
// `gate_file_cleared(phase)` events mark task boundaries: the prior task's
// gate file has been deleted by the dispatcher and the next task's gate
// file may or may not be on disk yet. Helpers that walk the event log
// looking for "is there already a gate_written / phase_exited /
// phase_entered / gate_required for this phase" must distinguish "active"
// records (after the latest gate_file_cleared(phase)) from "historical"
// records (before it). A bare `events.some(e => e.phase === phase)` check
// is task-blind and silently bricks the multi-task lifecycle when the
// next task's events are wrongly deduped against the prior task's.
//
// Returns the index of the last element where `pred` is true, or -1 if
// none. Stable, callsite-friendly: the supersedence check pattern is
// `latestActiveIdx > latestClearedIdx` (active record is "after" the
// clear, so it is fresh; otherwise the prior task's record is stale).
function lastIndexOf<T>(arr: readonly T[], pred: (e: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i
  }
  return -1
}

// B1a Commit 2 — narrow `Budgets` to the JSON-shape the
// `effort_envelope_applied` validator expects. The runtime-validator on
// the event log only checks the top-level shape; the loader is the
// schema-of-record for the full `CodeOzConfig['budgets']`. JSON
// round-trip drops `undefined` keys and is type-stable across the
// schema's `Readonly` modifiers.
function budgetsToSnapshot(b: Budgets): {
  readonly global: Record<string, unknown>
  readonly perPhase: Record<string, unknown>
} {
  return JSON.parse(JSON.stringify(b)) as {
    readonly global: Record<string, unknown>
    readonly perPhase: Record<string, unknown>
  }
}

// --- pure reducer --------------------------------------------------

/**
 * Reduce a sequence of validated events into the derived RunState. File order
 * is the ordering authority (validation rule 8). Returns null if the events
 * don't include a `run_started` event.
 *
 * Tolerates unknown event types (validation rule 12, M4): future milestones
 * may add event types without bumping `version: 1`. Unknown variants flow to
 * the default no-op case and never alter derived phase state.
 */
export function reduceEvents(events: readonly LoggedEvent[]): RunState | null {
  let runId: string | null = null
  let profile: Profile | null = null
  let currentPhase: Phase | null = null
  const phasesCompleted: Phase[] = []
  let lastEventAt: string | null = null

  for (const e of events) {
    lastEventAt = e.ts
    // Narrow at the top of each iteration so the switch discriminates
    // PhaseEvent variants. Unknown / future event types fall through and
    // never alter derived phase state.
    if (!isKnownPhaseEvent(e)) continue
    switch (e.type) {
      case 'run_started':
        runId = e.runId
        profile = e.profile
        currentPhase = initialPhase(e.profile)
        break
      case 'phase_entered':
        currentPhase = e.phase
        break
      case 'phase_exited':
        if (e.outcome === 'passed') {
          if (!phasesCompleted.includes(e.phase)) phasesCompleted.push(e.phase)
        }
        break
      // gate_written, gate_required, agent_invoked, agent_completed,
      // intervention, run_ended: do not change derived phase state.
      default:
        break
    }
  }

  if (runId === null || profile === null || currentPhase === null || lastEventAt === null) {
    return null
  }

  return Object.freeze({
    version: 1 as const,
    runId,
    profile,
    currentPhase,
    phasesCompleted: Object.freeze([...phasesCompleted]),
    lastEventAt,
  })
}

// --- run lifecycle -------------------------------------------------

/**
 * Initialize a fresh run: create the run subdirectory, write run_started +
 * effort_envelope_applied + phase_entered(initial) events, build
 * current.json, and update the active-run pointer. The per-run lock and
 * the active-pointer lock are held sequentially (never concurrently) to
 * avoid deadlocks.
 *
 * B1a Commit 2 — `effort_envelope_applied` is the second event in the
 * fresh-run sequence (immediately after `run_started`, before
 * `phase_entered`) and lands inside the same `withLock` block. Order is
 * locked per rule 23 + `docs/design/B1A_EFFORT_FLAG.md` § "Event order
 * lock": the envelope describes the run, not the first phase, so it is
 * captured at run start ahead of any phase work. The caller passes
 * `effort` (default `'balanced'`) plus the pre-/post-`applyEffort`
 * `Budgets` snapshots. **Emission is conditional on at least one of
 * `originalBudgets` / `effectiveBudgets` being supplied** (Codex R0 F4,
 * thread 019e17f8): the CLI path always supplies both, so production
 * fresh runs always record the envelope; low-level `initRun` callers
 * (state-machine unit tests, fixture helpers) that omit budgets emit no
 * envelope event — those callers test the state shape, not the
 * envelope contract. Active-run reload sites read this event via
 * `applyRecordedEffort` in `src/commands/run.ts` to reconstruct the
 * recorded `effectiveBudgets` after every `loadConfig({ cwd })`.
 */
export async function initRun(opts: {
  readonly paths: RunPaths
  readonly profile: Profile
  readonly runId: string
  readonly now?: () => string
  /** B1a — `--effort` value applied to this run. Default `'balanced'`. */
  readonly effort?: EffortLevel
  /** B1a — pre-`applyEffort` `CodeOzConfig['budgets']`. Required for the
   *  envelope event to fire. When both `originalBudgets` and
   *  `effectiveBudgets` are omitted, no event is appended (Codex R1
   *  thread 019e1807, F4 doc honesty). CLI fresh runs always supply
   *  both; low-level state-machine unit tests / fixture helpers may
   *  omit them. When only one is supplied, the other defaults to it
   *  (no-op pair) and the event still fires. */
  readonly originalBudgets?: Budgets
  /** B1a — post-`applyEffort` `CodeOzConfig['budgets']`. Same supply
   *  semantics as `originalBudgets` (see above). */
  readonly effectiveBudgets?: Budgets
  /** M17 — operator's brownfield problem statement (`code-oz run
   *  --request`). Persisted on the `run_started` event ONLY when provided,
   *  so greenfield run_started shape stays byte-for-byte unchanged. Readers
   *  (dispatchAudit -> runAudit) recover it from the event log on resume
   *  (rule 1: event-derived state). */
  readonly problemStatement?: string
  /** external-operator provenance — the agent id that drove this run.
   *  Persisted on the `run_started` event ONLY when provided, so the
   *  interactive-run shape stays unchanged. */
  readonly operator?: string
}): Promise<RunState> {
  if (!isUlid(opts.runId)) {
    throw new EventLogError([
      {
        file: opts.paths.eventsFile,
        code: 'event_invalid_runid',
        rule: 'initRun.runId must be a 26-char ULID',
        detail: `got ${JSON.stringify(opts.runId)}`,
      },
    ])
  }
  if (!isProfile(opts.profile)) {
    throw new EventLogError([
      {
        file: opts.paths.eventsFile,
        code: 'event_invalid_value',
        rule: "initRun.profile must be 'greenfield' or 'brownfield'",
        detail: `got ${JSON.stringify(opts.profile)}`,
      },
    ])
  }

  await mkdir(opts.paths.runDir, { recursive: true })

  const now = opts.now ?? (() => new Date().toISOString())
  const eventPaths = eventPathsFor(opts.paths)

  // B1a Commit 2 — record the effort envelope when budgets are supplied.
  // When the caller passes only `effort` (default `'balanced'`) without
  // budgets, the `if` below skips the append. CLI fresh runs (the only
  // production path through `initRun`) ALWAYS pass both `originalBudgets`
  // and `effectiveBudgets`, so the envelope event always lands in
  // production. Low-level state-machine tests and fixture helpers that
  // omit budgets get no envelope event — that surface tests state shape
  // rather than the envelope contract (Codex R0 F4, thread 019e17f8).
  // The caller is the single authority that ran `applyEffort`; we pass
  // the snapshots through verbatim.
  const effort: EffortLevel = opts.effort ?? 'balanced'
  const multiplier = EFFORT_MULTIPLIERS[effort]
  const effectiveBudgets = opts.effectiveBudgets ?? opts.originalBudgets
  const originalBudgets = opts.originalBudgets ?? effectiveBudgets

  const state = await withLock(opts.paths.lockDir, async () => {
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'run_started',
        ts: now(),
        runId: opts.runId,
        profile: opts.profile,
        // M17 — write the key only when provided so greenfield run_started
        // shape is unchanged (and older logs stay compatible).
        ...(opts.problemStatement !== undefined
          ? { problemStatement: opts.problemStatement }
          : {}),
        ...(opts.operator !== undefined ? { operator: opts.operator } : {}),
      },
      { skipLock: true },
    )
    // B1a Commit 2 (rule 23) — emit the effort envelope between
    // `run_started` and `phase_entered`. Order is locked per design doc
    // § "Event order lock"; the envelope is a run-shape property
    // captured before any phase work begins. Tests and active-run reload
    // sites assume position 2.
    if (originalBudgets !== undefined && effectiveBudgets !== undefined) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'effort_envelope_applied',
          ts: now(),
          runId: opts.runId,
          effort,
          multiplier,
          originalBudgets: budgetsToSnapshot(originalBudgets),
          effectiveBudgets: budgetsToSnapshot(effectiveBudgets),
        },
        { skipLock: true },
      )
    }
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'phase_entered',
        ts: now(),
        runId: opts.runId,
        phase: initialPhase(opts.profile),
      },
      { skipLock: true },
    )
    const events = await readEvents(eventPaths)
    const derived = reduceEvents(events)
    if (derived === null) {
      throw new EventLogError([
        {
          file: opts.paths.eventsFile,
          code: 'event_invalid_value',
          rule: 'initRun produced no derivable state',
        },
      ])
    }
    await writeCurrentUnlocked(opts.paths, derived)
    return derived
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: opts.paths.eventsFile,
          code: 'event_lock_busy',
          rule: 'per-run lock is busy during initRun',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })

  await writeActiveRun(opts.paths.activeFile, opts.runId)
  return state
}

/**
 * Load a run from disk: read events, perform cross-file recovery (rule 9),
 * derive the current state, and rebuild current.json. The whole transaction
 * runs under one per-run lock so concurrent processes can't observe an
 * inconsistent intermediate state.
 *
 * Returns null when the run has no events (run never started).
 */
export async function loadRun(paths: RunPaths): Promise<{
  readonly state: RunState
  readonly recovered: boolean
} | null> {
  const eventPaths = eventPathsFor(paths)

  // Quick existence probe outside the lock — if no events file at all, there
  // is nothing to recover or rebuild.
  const initialEvents = await readEvents(eventPaths)
  if (initialEvents.length === 0) return null

  return await withLock(paths.lockDir, async () => {
    let events = await readEvents(eventPaths)
    if (events.length === 0) return null

    // Recover orphan gate files (rule 9 forward direction): gate file
    // exists, gate_written event missing.
    const recoveredGateWritten = await recoverOrphanGates(paths, events)
    if (recoveredGateWritten) events = await readEvents(eventPaths)

    // Complete any incomplete transitions: gate_written present but
    // phase_exited / phase_entered (or run_ended) missing. Idempotent.
    const profileGuess = events.find((e) => e.type === 'run_started')
    const profile =
      profileGuess !== undefined && isKnownPhaseEvent(profileGuess) && profileGuess.type === 'run_started'
        ? profileGuess.profile
        : null
    const recoveredTransitions =
      profile === null
        ? false
        : await completeIncompleteTransitions(paths, events, profile)
    if (recoveredTransitions) events = await readEvents(eventPaths)

    // Validate (rule 9 reverse direction): every gate_written event must
    // have a matching, schema-valid gate file with sha256 matching the
    // referenced artifact.
    await validateRunIntegrity(paths, events)

    const state = reduceEvents(events)
    if (state === null) {
      throw new EventLogError([
        {
          file: paths.eventsFile,
          code: 'event_invalid_value',
          rule: 'event log has events but no run_started — cannot derive state',
        },
      ])
    }

    await writeCurrentUnlocked(paths, state)

    return Object.freeze({
      state,
      recovered: recoveredGateWritten || recoveredTransitions,
    })
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: paths.eventsFile,
          code: 'event_lock_busy',
          rule: 'per-run lock is busy during loadRun',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })
}

/**
 * Atomic, layered write of a success gate plus its three transition events
 * under a single per-run lock acquisition. Sequence matches the layering
 * rule pinned in docs/references/file-based-gates.md anti-patterns.
 *
 * Idempotent: if the gate file already exists with matching content
 * (approvedAt drift is tolerated, see gates.ts:gatesEqual), the gate write
 * is a no-op. Any missing events for that phase (gate_written, phase_exited,
 * phase_entered/run_ended) are then appended deterministically — so a
 * mid-transition crash + retry leaves the run in the same final state as
 * a clean approval.
 */
export interface ApproveGateOptions {
  readonly paths: RunPaths
  readonly gate: GateFile
  readonly profile: Profile
  readonly now?: () => string
}

export interface ApproveGateResult {
  readonly gateExisted: boolean
  readonly nextPhase: Phase | null
  readonly state: RunState
}

export async function approveGate(opts: ApproveGateOptions): Promise<ApproveGateResult> {
  if (!isPhase(opts.gate.phase)) {
    throw new GateLoadError([
      {
        file: opts.paths.runDir,
        code: 'gate_invalid_phase',
        rule: 'approveGate.gate.phase must be canonical',
        detail: String(opts.gate.phase),
      },
    ])
  }

  const eventPaths = eventPathsFor(opts.paths)
  const gatePaths = gatePathsFor(opts.paths)
  const now = opts.now ?? (() => new Date().toISOString())

  return await withLock(opts.paths.lockDir, async () => {
    const writeResult = await writeGate({
      paths: gatePaths,
      gate: opts.gate,
      skipLock: true,
    })

    // Read the (possibly post-recovery) event log once; the helpers below
    // only append events that are missing.
    let events = await readEvents(eventPaths)
    const appendedAny = await completeTransitionForPhase({
      paths: opts.paths,
      events,
      phase: opts.gate.phase,
      runId: opts.gate.runId,
      profile: opts.profile,
      gateFilename: writeResult.filename,
      approvedBy: opts.gate.approvedBy,
      now,
    })
    if (appendedAny) events = await readEvents(eventPaths)

    const state = reduceEvents(events)
    if (state === null) {
      throw new GateLoadError([
        {
          file: opts.paths.eventsFile,
          code: 'gate_io_error',
          rule: 'no run_started in event log; cannot derive run state',
        },
      ])
    }
    await writeCurrentUnlocked(opts.paths, state)

    return Object.freeze({
      gateExisted: writeResult.existed,
      nextPhase: nextPhase(opts.gate.phase, opts.profile),
      state,
    })
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new GateLoadError([
        {
          file: opts.paths.runDir,
          code: 'gate_lock_busy',
          rule: 'per-run lock is busy during approveGate',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })
}

// --- review approve + task-loop dispatch (M16 C9) ------------------

/**
 * REVIEW-specific approve primitive that integrates the task-loop
 * dispatch atomically (M16 C9). Replaces `approveGate` for the REVIEW
 * branch in `runApprove` so the entire transaction — write
 * GATE_REVIEW_PASSED.json, append `gate_written` + `phase_exited(review)`,
 * append `task_completed` for the just-approved task, and conditionally
 * append `phase_entered(ship)` only when every PLAN task is complete —
 * runs under a single per-run lock acquisition.
 *
 * Codex C9 pre-design review pinned the load-bearing invariants
 * implemented inline (7 block-push + 2 fix-soon + 1 nit, all closed):
 *
 *   1. `task_completed` is sourced from the canonical `review_resolved`
 *      ready signal, NOT `review_round_completed` (which fires for
 *      every round outcome including needs-revision). The lookup uses
 *      `findLatestReviewResolved(events, runId, taskId, attempt)`
 *      and asserts the matching `reviewReportSha256`. (Mod #1)
 *   2. The reducer never emits `phase_entered(ship)` unconditionally on
 *      review approve — the cursor decides. After appending
 *      `task_completed`, the cursor is recomputed; when
 *      `cursor.allCompleted === true` we transition to ship; when a
 *      pending task remains we transition to build for the next task's
 *      BUILD attempt 1 (M16 C9 follow-on (2) Bug 3 fix; symmetric
 *      counterpart to the terminal-half ship transition). The next
 *      `code-oz run` invocation routes to BUILD for the pending task,
 *      and `code-oz approve build` for that task is unblocked because
 *      `currentPhase` is now `build`. (Mod #2)
 *   3. `task_completed` emission is idempotent under the lock. If a
 *      `task_completed` event for `(runId, taskId)` already exists in
 *      events.jsonl, the append is skipped and the call is a no-op
 *      with respect to that event. The full transaction is still safe
 *      to call multiple times. (Mod #3)
 *   4. The task-event emission lives INSIDE the locked primitive, not
 *      in a separate post-approveGate function call. Concurrent
 *      `code-oz run` invocations cannot observe the gate file before
 *      the task event lands; the audit trail is atomic per phase
 *      transition. (Mod #4)
 *   5. We never emit `task_started` for task N+1 here. `dispatchBuild`
 *      is the sole `task_started` emitter; the next `code-oz run`
 *      invocation routes through `handleActiveRun` and appends
 *      `task_started` for the new task as part of its first BUILD
 *      attempt. (Mod #5)
 *   8. PLAN.md drift is rejected before any state change. If the
 *      cursor projection surfaces issues whose codes include
 *      `task_cursor_unknown_id` for the just-approved taskId, the
 *      primitive throws an actionable intervention before writing the
 *      gate. (Mod #8)
 *   9. Defense-in-depth: the matching `review_resolved` event MUST
 *      exist for `(runId, taskId, attempt)`. `preApproveReviewHook`
 *      already enforces this upstream; the assertion here catches
 *      developer error if a future caller path bypasses the hook. (Mod #9)
 *  10. The cursor stays a pure projection. `findLatestReviewResolved`
 *      is the only new helper exposed — read-only, no mutation. (Mod #10)
 *
 * Mod #6 (worktree task-boundary recreation) and Mod #7
 * (handleActiveRun review-remediation pre-route) live in their owning
 * modules; this primitive is the state-machine + event-log glue.
 */

export interface ApproveReviewTaskGateOptions {
  readonly paths: RunPaths
  readonly gate: GateFile
  readonly profile: Profile
  /** PLAN.md parsed at the call site; the primitive uses it to compute
   *  the cursor + decide whether the just-approved task is the last. */
  readonly plan: PlanArtifact
  /** Just-validated REVIEW.md upstream attempt (from
   *  `preApproveReviewHook` via the artifact's upstreamRefs). The
   *  primitive uses this to assert the matching `review_resolved`
   *  event. */
  readonly upstreamAttempt: number
  /** REVIEW.md upstream taskId. Must match the cursor's pending task. */
  readonly upstreamTaskId: string
  readonly now?: () => string
}

export interface ApproveReviewTaskGateResult {
  readonly gateExisted: boolean
  /** The phase emitted via `phase_entered` after the just-approved task:
   *  `'ship'` when all PLAN tasks have completed (terminal half), or
   *  `'build'` when a pending task remains (iterate half — task-loop
   *  advancement; M16 C9 follow-on (2) Bug 3 fix). `null` only when there
   *  is no `nextPhase('review', profile)` configured (defensive — the
   *  greenfield/brownfield sequences both have ship after review). */
  readonly nextPhase: Phase | null
  readonly state: RunState
  readonly taskCompletedExisted: boolean
}

export class ApproveReviewTaskGateError extends Error {
  readonly code: string
  readonly detail: string | undefined
  constructor(code: string, message: string, detail?: string) {
    super(detail !== undefined ? `${message} (${detail})` : message)
    this.name = 'ApproveReviewTaskGateError'
    this.code = code
    this.detail = detail
  }
}

export async function approveReviewTaskGate(
  opts: ApproveReviewTaskGateOptions,
): Promise<ApproveReviewTaskGateResult> {
  if (opts.gate.phase !== 'review') {
    throw new GateLoadError([
      {
        file: opts.paths.runDir,
        code: 'gate_invalid_phase',
        rule: 'approveReviewTaskGate.gate.phase must be "review"',
        detail: String(opts.gate.phase),
      },
    ])
  }

  const eventPaths = eventPathsFor(opts.paths)
  const gatePaths = gatePathsFor(opts.paths)
  const now = opts.now ?? (() => new Date().toISOString())

  return await withLock(opts.paths.lockDir, async () => {
    // 1. Defense-in-depth (Mod #9): preApproveReviewHook already validated
    //    the matching review_resolved event at the artifact level (or the
    //    panel-mode review_panel_completed fallback). Re-assert here
    //    inside the lock so a developer-error path that bypasses the
    //    hook surfaces cleanly. The runtime contract is the hook is
    //    always called first; this assertion is unreachable in practice.
    const preEvents = await readEvents(eventPaths)
    const resolved = findLatestReviewResolved(
      preEvents,
      opts.gate.runId,
      opts.upstreamTaskId,
      opts.upstreamAttempt,
    )
    const panelFallback = resolved === null
      ? findReviewPanelReady(
          preEvents,
          opts.gate.runId,
          opts.upstreamTaskId,
          opts.upstreamAttempt,
        )
      : null
    if (resolved === null && panelFallback === null) {
      throw new ApproveReviewTaskGateError(
        'review_resolved_event_missing',
        `approveReviewTaskGate: no review_resolved or panel-ready event for taskId=${opts.upstreamTaskId} attempt=${opts.upstreamAttempt}`,
        'preApproveReviewHook should have refused before reaching this primitive',
      )
    }

    // 2. PLAN.md drift refusal (Mod #8). Compute the cursor against the
    //    pre-write event set; reject if the just-approved taskId is
    //    unknown to current PLAN.md (operator re-ordered or removed the
    //    task between BUILD and approve review).
    const preCursor = projectTaskCursor(opts.plan, preEvents)
    const planTaskIds = new Set(preCursor.cursor.entries.map((e) => e.taskId))
    if (!planTaskIds.has(opts.upstreamTaskId)) {
      throw new ApproveReviewTaskGateError(
        'task_cursor_unknown_id',
        `approveReviewTaskGate: REVIEW.md upstream taskId=${opts.upstreamTaskId} is not in current PLAN.md`,
        `current PLAN tasks: ${[...planTaskIds].join(', ') || '(none)'} — operator likely edited PLAN.md between BUILD and approve review`,
      )
    }
    const unknownIssue = preCursor.issues.find(
      (i) => i.code === 'task_cursor_unknown_id',
    )
    if (unknownIssue !== undefined) {
      throw new ApproveReviewTaskGateError(
        'task_cursor_unknown_id',
        `approveReviewTaskGate: events.jsonl references taskIds not in current PLAN.md`,
        unknownIssue.detail ?? unknownIssue.rule,
      )
    }

    // 3. Write GATE_REVIEW_PASSED.json (idempotent on identical content).
    const writeResult = await writeGate({
      paths: gatePaths,
      gate: opts.gate,
      skipLock: true,
    })

    // 4. Append the standard transition events (gate_written +
    //    phase_exited(review)). Idempotent. Mirrors approveGate's
    //    completeTransitionForPhase but stops short of phase_entered —
    //    the cursor decides whether to enter ship.
    //
    //    M16 C9 follow-on (3) — Bug 4 class fix. Dedup is supersedence-
    //    aware: a `gate_file_cleared(review)` event later than the
    //    latest matching record marks the prior task's record as
    //    historical, so the next task gets a fresh emission. Without
    //    this, T-002 REVIEW approve would see T-001's `gate_written
    //    (review)` + `phase_exited(review)` still in the log, skip
    //    both emissions, and the new task's gate file would have no
    //    event referencing it (followed by integrity failure at the
    //    next loadRun). Mirrors the supersedence pattern in
    //    completeTransitionForPhase.
    let events = await readEvents(eventPaths)
    let working: PhaseEvent[] = [...events.filter(isKnownPhaseEvent)]

    const reviewClearAnchor = lastIndexOf(
      working,
      (e) => e.type === 'gate_file_cleared' && e.phase === 'review',
    )

    const latestReviewGateWrittenIdx = lastIndexOf(
      working,
      (e) => e.type === 'gate_written' && e.phase === 'review',
    )
    const hasGateWritten = latestReviewGateWrittenIdx > reviewClearAnchor
    if (!hasGateWritten) {
      const ev: PhaseEvent = {
        version: 1,
        type: 'gate_written',
        ts: now(),
        runId: opts.gate.runId,
        phase: 'review',
        file: writeResult.filename,
        ...(opts.gate.approvedBy !== undefined ? { approvedBy: opts.gate.approvedBy } : {}),
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
    }

    const latestReviewPhaseExitedIdx = lastIndexOf(
      working,
      (e) =>
        e.type === 'phase_exited' &&
        e.phase === 'review' &&
        e.outcome === 'passed',
    )
    const hasPhaseExited = latestReviewPhaseExitedIdx > reviewClearAnchor
    if (!hasPhaseExited) {
      const ev: PhaseEvent = {
        version: 1,
        type: 'phase_exited',
        ts: now(),
        runId: opts.gate.runId,
        phase: 'review',
        outcome: 'passed',
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
    }

    // 5. Append `task_completed` for the just-approved task — Mod #1
    //    (sourced from review_resolved, not review_round_completed).
    //    Mod #3: idempotent under the lock.
    let taskCompletedExisted = false
    const existingTaskCompleted = working.find(
      (e) =>
        e.type === 'task_completed' &&
        e.runId === opts.gate.runId &&
        e.taskId === opts.upstreamTaskId,
    )
    if (existingTaskCompleted !== undefined) {
      taskCompletedExisted = true
    } else {
      const taskEntry = preCursor.cursor.entries.find(
        (e) => e.taskId === opts.upstreamTaskId,
      )
      if (taskEntry === undefined) {
        // Already filtered above via planTaskIds; re-throw as a guard.
        throw new ApproveReviewTaskGateError(
          'task_cursor_unknown_id',
          `approveReviewTaskGate: cursor entry for ${opts.upstreamTaskId} disappeared between drift check and emission`,
        )
      }
      const reviewGatePath = join(opts.paths.runDir, writeResult.filename)
      const ev: PhaseEvent = {
        version: 1,
        type: 'task_completed',
        ts: now(),
        runId: opts.gate.runId,
        taskId: opts.upstreamTaskId,
        taskIndex: taskEntry.taskIndex,
        reviewGatePath,
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
    }

    // 6. Recompute the cursor with the just-appended task_completed.
    //    Mod #2 — only emit phase_entered(ship) when allCompleted.
    //    M16 C9 follow-on (2) — Bug 3: when not allCompleted but a pending
    //    task remains, emit phase_entered(build) so currentPhase advances
    //    to `build` for the next task. Without this, `code-oz approve build`
    //    for the next task fails at src/commands/approve.ts:117 with
    //    `current phase is 'review', not 'build'`. This is the symmetric
    //    counterpart to Bug 1's terminal-half (review→ship); together they
    //    close the cursor-aware phase-boundary semantics on task transition.
    //
    //    Idempotency: when `taskCompletedExisted=true`, the transition was
    //    already emitted by the prior call. Skip the entire block so a
    //    second call after the next task's lifecycle has progressed does
    //    NOT bump currentPhase backwards (e.g., from `verify` back to
    //    `build`). The result still reports the canonical next phase for
    //    the original transition (build for iterate, ship for terminal),
    //    which is what the caller cares about.
    const postEvents = await readEvents(eventPaths)
    const postCursor = projectTaskCursor(opts.plan, postEvents)
    let nextPhaseEntered: Phase | null = null
    let targetNext: Phase | null = null
    if (postCursor.cursor.allCompleted) {
      // Terminal half: review → ship.
      targetNext = nextPhase('review', opts.profile)
    } else if (postCursor.cursor.pending !== null) {
      // Iterate half: review → build for the next task's BUILD attempt 1.
      // dispatchBuild assumes currentPhase==='build' and never emits
      // phase_entered itself; the transition must land here.
      targetNext = 'build'
    } else {
      // Defensive: not allCompleted AND no pending — should be impossible
      // because the cursor is allCompleted iff there's no pending entry.
      // Surface an internal-error intervention rather than silently doing
      // nothing.
      throw new ApproveReviewTaskGateError(
        'task_cursor_internal_inconsistency',
        'approveReviewTaskGate: cursor is not allCompleted and has no pending task',
        `entries=${postCursor.cursor.entries.length} — internal projection bug`,
      )
    }

    if (targetNext !== null) {
      if (taskCompletedExisted) {
        // Idempotent re-call: transition was emitted by the original
        // call. Do NOT re-emit — the next task may have progressed past
        // build, and re-emitting would bump currentPhase backwards.
        nextPhaseEntered = targetNext
      } else {
        const ev: PhaseEvent = {
          version: 1,
          type: 'phase_entered',
          ts: now(),
          runId: opts.gate.runId,
          phase: targetNext,
        }
        await appendEvent(eventPaths, ev, { skipLock: true })
        nextPhaseEntered = targetNext
      }
    }

    const finalEvents = await readEvents(eventPaths)
    const state = reduceEvents(finalEvents)
    if (state === null) {
      throw new GateLoadError([
        {
          file: opts.paths.eventsFile,
          code: 'gate_io_error',
          rule: 'no run_started in event log; cannot derive run state',
        },
      ])
    }
    await writeCurrentUnlocked(opts.paths, state)

    return Object.freeze({
      gateExisted: writeResult.existed,
      nextPhase: nextPhaseEntered,
      state,
      taskCompletedExisted,
    })
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new GateLoadError([
        {
          file: opts.paths.runDir,
          code: 'gate_lock_busy',
          rule: 'per-run lock is busy during approveReviewTaskGate',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })
}

/**
 * Internal helper: panel-mode fallback for the review_resolved
 * existence check. Mirrors the panel-mode fallback in
 * preApproveReviewHook (src/commands/approve.ts:644-680). Returns the
 * latest matching `review_panel_completed` with `panelVerdict='ready'`
 * for `(runId, taskId, attempt)`, or `null`.
 */
function findReviewPanelReady(
  events: readonly LoggedEvent[],
  runId: string,
  taskId: string,
  attempt: number,
): { readonly reviewReportSha256: string; readonly ts: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.type !== 'review_panel_completed') continue
    if (e.runId !== runId) continue
    if (e.taskId !== taskId) continue
    if (e.attempt !== attempt) continue
    if (e.panelVerdict !== 'ready') continue
    return Object.freeze({
      reviewReportSha256: e.reviewReportSha256,
      ts: e.ts,
    })
  }
  return null
}

// --- gate-required helper ------------------------------------------

export interface RequireGateOptions {
  readonly paths: RunPaths
  readonly runId: string
  readonly phase: Phase
  /** Human-readable description of what unblocks the gate. */
  readonly blockedOn: string
  readonly now?: () => string
}

export interface RequireGateResult {
  readonly state: RunState
  /** True when this call appended a new gate_required event; false on idempotent no-op. */
  readonly appended: boolean
}

/**
 * Append a gate_required event for the given phase and rebuild current.json
 * under one short per-run lock. Idempotent: if a gate_required event for the
 * same phase already exists in the log, the call is a no-op (no append, but
 * current.json is still rebuilt to recover from any prior interruption).
 *
 * Used by phase logic (M5: src/phases/define.ts) immediately after writing
 * a phase artifact (e.g., SPEC.md) to signal the run is awaiting user
 * approval via `code-oz approve <phase>`.
 */
export async function requireGate(opts: RequireGateOptions): Promise<RequireGateResult> {
  if (!isPhase(opts.phase)) {
    throw new EventLogError([
      {
        file: opts.paths.runDir,
        code: 'event_invalid_phase',
        rule: 'requireGate.phase must be canonical',
        detail: String(opts.phase),
      },
    ])
  }
  if (!isUlid(opts.runId)) {
    throw new EventLogError([
      {
        file: opts.paths.eventsFile,
        code: 'event_invalid_runid',
        rule: 'requireGate.runId must be a 26-char ULID',
        detail: opts.runId,
      },
    ])
  }
  if (typeof opts.blockedOn !== 'string' || opts.blockedOn.length === 0) {
    throw new EventLogError([
      {
        file: opts.paths.eventsFile,
        code: 'event_invalid_value',
        rule: 'requireGate.blockedOn must be a non-empty string',
      },
    ])
  }

  const eventPaths = eventPathsFor(opts.paths)
  const now = opts.now ?? (() => new Date().toISOString())

  return await withLock(opts.paths.lockDir, async () => {
    const events = await readEvents(eventPaths)
    const known = events.filter(isKnownPhaseEvent)
    // M16 C9 follow-on (3) — supersedence-aware idempotency. The prior
    // task's `gate_required(phase)` event lives forever in the log, so
    // a bare `known.some(e => e.phase === phase)` check would silently
    // drop the new task's gate_required emission. After the dispatcher
    // has emitted `gate_file_cleared(phase)` for the boundary, the
    // next task needs a fresh gate_required signal so the operator's
    // approve sees a live "awaiting approval" record. Mirrors the
    // class-fix pattern in completeTransitionForPhase: clearAnchor =
    // index of latest gate_file_cleared(phase); existing record is
    // historical when its index < clearAnchor.
    const clearAnchor = lastIndexOf(
      known,
      (e) => e.type === 'gate_file_cleared' && e.phase === opts.phase,
    )
    const latestGateRequiredIdx = lastIndexOf(
      known,
      (e) => e.type === 'gate_required' && e.phase === opts.phase,
    )
    const existing = latestGateRequiredIdx > clearAnchor
    let appended = false
    if (!existing) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'gate_required',
          ts: now(),
          runId: opts.runId,
          phase: opts.phase,
          blockedOn: opts.blockedOn,
        },
        { skipLock: true },
      )
      appended = true
    }
    const updated = appended ? await readEvents(eventPaths) : events
    const state = reduceEvents(updated)
    if (state === null) {
      throw new EventLogError([
        {
          file: opts.paths.eventsFile,
          code: 'event_invalid_value',
          rule: 'requireGate produced no derivable state (no run_started?)',
        },
      ])
    }
    await writeCurrentUnlocked(opts.paths, state)
    return Object.freeze({ state, appended })
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: opts.paths.eventsFile,
          code: 'event_lock_busy',
          rule: 'per-run lock is busy during requireGate',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })
}

// --- active-run pointer --------------------------------------------

export async function readActiveRun(activeFile: string): Promise<string | null> {
  let raw: unknown
  try {
    const content = await readFile(activeFile, 'utf8')
    raw = JSON.parse(content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  if (data.version !== 1) return null
  if (!isUlid(data.runId)) return null
  return data.runId
}

/**
 * Atomically update `<stateDir>/active.json`, serialized via a dedicated
 * `<stateDir>/.active.lock/` mkdir-lock so two `code-oz init`+`run` racers
 * cannot clobber each other's pointer mid-write.
 */
export async function writeActiveRun(activeFile: string, runId: string): Promise<void> {
  if (!isUlid(runId)) {
    throw new EventLogError([
      {
        file: activeFile,
        code: 'event_invalid_runid',
        rule: 'active-run pointer runId must be a 26-char ULID',
      },
    ])
  }

  await mkdir(dirname(activeFile), { recursive: true })
  const lockDir = activeLockDirFor(activeFile)

  await withLock(lockDir, async () => {
    await writeActiveRunUnlocked(activeFile, runId)
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: activeFile,
          code: 'event_lock_busy',
          rule: 'active-run lock is busy; another writer holds it',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })
}

async function writeActiveRunUnlocked(activeFile: string, runId: string): Promise<void> {
  const pointer: ActiveRunPointer = { version: 1, runId }
  const json = JSON.stringify(pointer, null, 2) + '\n'
  const buf = Buffer.from(json, 'utf8')
  const tmpPath = `${activeFile}.tmp-${randomBytes(6).toString('hex')}`
  const fh = await open(tmpPath, 'w')
  try {
    await fh.write(buf, 0, buf.length)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmpPath, activeFile)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw err
  }
}

// --- helpers -------------------------------------------------------

/**
 * Write current.json atomically. The CALLER must already hold the per-run
 * lock — this function does not acquire it. All call sites in this module
 * are inside withLock blocks.
 */
async function writeCurrentUnlocked(paths: RunPaths, state: RunState): Promise<void> {
  await mkdir(paths.runDir, { recursive: true })
  const json = JSON.stringify(state, null, 2) + '\n'
  const buf = Buffer.from(json, 'utf8')
  const tmpPath = `${paths.currentFile}.tmp-${randomBytes(6).toString('hex')}`
  const fh = await open(tmpPath, 'w')
  try {
    await fh.write(buf, 0, buf.length)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmpPath, paths.currentFile)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw err
  }
}

/**
 * For each phase that has a GATE_<PHASE>_PASSED.json on disk but no
 * gate_written event in the log, append the missing event. Returns true if
 * any recovery was performed. CALLER must hold the per-run lock.
 *
 * Cross-run safety: each orphan gate's runId AND phase are verified against
 * the active run before any event is appended. A gate whose runId belongs to
 * a different run (e.g., copied from `state/runs/<other>/`) or whose
 * frontmatter phase doesn't match its filename is treated as cross-run
 * contamination and surfaced as a typed gate error rather than silently
 * advancing this run on someone else's decision.
 */
async function recoverOrphanGates(
  paths: RunPaths,
  events: readonly LoggedEvent[],
): Promise<boolean> {
  // Narrow once at the top so subsequent type literal checks discriminate
  // against PhaseEvent variants. Unknown event types are inert for recovery.
  const known = events.filter(isKnownPhaseEvent)
  const expectedRunId = known.find((e) => e.type === 'run_started')?.runId
  if (expectedRunId === undefined) {
    // No run_started — let downstream reducer surface the contract error.
    return false
  }

  // M16 C9 follow-on (3) — supersedence-aware orphan recovery. A
  // `gate_written(phase)` event covers `phase` only until a later
  // `gate_file_cleared(phase)` supersedes it. Without this, the prior
  // task's gate_written would mask the next task's orphaned gate file:
  // T-002 BUILD writes GATE_BUILD_PASSED.json, the dispatcher emits
  // gate_file_cleared(build), and if a crash leaves the file on disk
  // without a fresh gate_written event, this recovery step would skip
  // the orphan because T-001's gate_written(build) is still in the log.
  // The fix: a phase is "covered" only when its latest gate_written is
  // more recent than its latest gate_file_cleared.
  const phaseCovered = new Set<Phase>()
  for (const phase of PHASES) {
    const latestGateWrittenIdx = lastIndexOf(
      known,
      (e) => e.type === 'gate_written' && e.phase === phase,
    )
    if (latestGateWrittenIdx < 0) continue
    const latestGateClearedIdx = lastIndexOf(
      known,
      (e) => e.type === 'gate_file_cleared' && e.phase === phase,
    )
    if (latestGateWrittenIdx > latestGateClearedIdx) phaseCovered.add(phase)
  }

  const orphans: { phase: Phase; gate: GateFile }[] = []
  for (const phase of PHASES) {
    if (phaseCovered.has(phase)) continue
    const filePath = join(paths.runDir, gateFilename(phase))
    let gate: GateFile
    try {
      // readGate enforces full schema + sha256 binding. If the orphan gate
      // is corrupt, this throws and the recovery aborts — the corruption
      // surface is more important than auto-recovery.
      gate = await readGate(filePath, paths.artifactRoot)
    } catch (err: unknown) {
      if (err instanceof GateLoadError) {
        const issue = err.issues[0]
        if (issue?.code === 'gate_io_error' && issue.rule.includes('not found')) {
          // Truly missing — no orphan, skip.
          continue
        }
        // Existing-but-invalid gate is a corruption signal; surface it.
        throw err
      }
      throw err
    }

    // Cross-run safety: refuse to recover a gate that belongs to a
    // different run. Without this check, a stale gate file copied into
    // this run's directory would advance the wrong run.
    if (gate.runId !== expectedRunId) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_runid',
          rule: 'orphan gate file belongs to a different runId; refusing to recover cross-run contamination',
          detail: `gate.runId=${gate.runId}, run_started.runId=${expectedRunId}`,
        },
      ])
    }
    if (gate.phase !== phase) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_phase',
          rule: 'orphan gate file phase does not match its filename; refusing to recover',
          detail: `gate.phase=${gate.phase}, expected ${phase} (from filename ${gateFilename(phase)})`,
        },
      ])
    }

    orphans.push({ phase, gate })
  }

  if (orphans.length === 0) return false

  const eventPaths = eventPathsFor(paths)
  const now = () => new Date().toISOString()
  for (const { phase, gate } of orphans) {
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'gate_written',
        ts: now(),
        runId: gate.runId,
        phase,
        file: gateFilename(phase),
      },
      { skipLock: true },
    )
  }
  return true
}

/**
 * For every phase with a gate_written event, ensure the phase_exited and
 * either the next phase_entered or run_ended events also exist. Idempotent.
 * CALLER must hold the per-run lock.
 *
 * This handles every crash window between gate rename and the final
 * transition append. Combined with recoverOrphanGates above, the recovery
 * step deterministically advances to the same end state as a clean approval.
 *
 * M16 C9 follow-on (Bug 1 + Bug 3): the review→{ship,build} transition
 * is cursor-aware. `approveReviewTaskGate` emits `phase_entered(ship)`
 * when `cursor.allCompleted=true` (Bug 1) and `phase_entered(build)`
 * when a pending task remains (Bug 3). Without the same gate here, every
 * `loadRun` after T-001 approve-review would walk the `gate_written(review)`
 * event and unconditionally append `phase_entered(ship)`, defeating the
 * task-loop and advancing currentPhase to `ship` while T-002+ are still
 * pending; OR (post Bug 1 fix) skip emission entirely, leaving
 * `currentPhase=review` so `code-oz approve build` for T-002 fails the
 * approve.ts:117 assertion. The fix: when the next phase computed for a
 * `gate_written(review)` is `ship`, project the cursor against PLAN.md
 * and emit `phase_entered(ship)` only when `cursor.allCompleted=true`,
 * `phase_entered(build)` when a pending task remains, otherwise (PLAN.md
 * missing / unparseable) defer authority to `approveReviewTaskGate` and
 * skip the transition. All other transitions (define→plan, plan→build,
 * build→verify, verify→review) stay unchanged.
 */
async function completeIncompleteTransitions(
  paths: RunPaths,
  events: readonly LoggedEvent[],
  profile: Profile,
): Promise<boolean> {
  const eventPaths = eventPathsFor(paths)
  const now = () => new Date().toISOString()

  // Narrow up-front so type-literal checks below discriminate properly.
  const known = events.filter(isKnownPhaseEvent)

  // Walk gate_written events in their on-disk order so the appended
  // transition events land in the same order they would have during a
  // clean approval.
  const gateWrittenList = known
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.type === 'gate_written')
    .sort((a, b) => a.i - b.i)

  // Working copy that grows as we append.
  let working: PhaseEvent[] = [...known]
  let appendedAny = false

  // Lazy PLAN load — only attempted when a review→ship cursor check is
  // needed. A null result (missing or unparseable) makes the function
  // conservatively skip the ship transition and defer to the
  // approveReviewTaskGate primitive.
  let planLoaded = false
  let plan: PlanArtifact | null = null
  const tryLoadPlan = async (): Promise<PlanArtifact | null> => {
    if (planLoaded) return plan
    planLoaded = true
    try {
      const raw = await readFile(join(paths.artifactRoot, 'PLAN.md'), 'utf8')
      plan = parsePlan(raw, join(paths.artifactRoot, 'PLAN.md'))
    } catch {
      plan = null
    }
    return plan
  }

  for (const { e, i: gateIndex } of gateWrittenList) {
    if (e.type !== 'gate_written') continue
    const runId = e.runId
    const phase = e.phase
    const next = nextPhase(phase, profile)

    // M16 C9 follow-on (3) — Bug 4 class fix. Index-based dedup for
    // multi-task BUILD/VERIFY/REVIEW. With the prior task's
    // gate_written(phase) followed by gate_file_cleared(phase) followed
    // by the next task's gate_written(phase), this loop walks BOTH
    // gate_written records. The phase_exited(phase) and phase_entered
    // (next) records that "belong" to this gate_written are the ones
    // that come AFTER it in the log; a global `working.some(...)`
    // check would find the prior task's records and skip emission for
    // the new task. Mirrors the iterate-half index-based dedup pattern
    // already used below for review→build (5d21d9be) and the
    // supersedence pattern in completeTransitionForPhase /
    // approveReviewTaskGate / requireGate.
    const hasPhaseExited = working.some(
      (x, idx) =>
        idx > gateIndex &&
        x.type === 'phase_exited' &&
        x.phase === phase &&
        x.outcome === 'passed',
    )
    if (!hasPhaseExited) {
      const ev: PhaseEvent = {
        version: 1,
        type: 'phase_exited',
        ts: now(),
        runId,
        phase,
        outcome: 'passed',
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
      appendedAny = true
    }

    if (next !== null) {
      // M16 C9 follow-on — cursor-aware review→{ship,build} transition.
      // Only `approveReviewTaskGate` is authoritative for advancing past
      // the just-approved task; this completion step must mirror the
      // same gate or it will silently undo the cursor decision on the
      // next loadRun. Bug 1 covers the terminal half (ship); Bug 3
      // covers the iterate half (build, for the next pending task).
      let emittedPhase: Phase = next
      if (phase === 'review' && next === 'ship') {
        const planForCursor = await tryLoadPlan()
        if (planForCursor === null) {
          // PLAN missing / unparseable — defer authority. Skip the
          // transition; approveReviewTaskGate owns the decision.
          continue
        }
        const { cursor } = projectTaskCursor(planForCursor, working)
        if (cursor.allCompleted) {
          // Last-task approve-review — terminal-half: emit ship.
          emittedPhase = 'ship'
        } else if (cursor.pending !== null) {
          // Mid-PLAN approve-review — iterate-half (Bug 3): emit build
          // so currentPhase advances for the next task. Without this,
          // `code-oz approve build` for the next task fails at
          // approve.ts:117 because currentPhase stays at 'review'.
          emittedPhase = 'build'
        } else {
          // Defensive: cursor is not allCompleted AND has no pending —
          // structurally impossible. Skip emission rather than corrupt
          // the event log; approveReviewTaskGate will surface a typed
          // intervention if the operator hits this path live.
          continue
        }
      }

      // Index-based dedup (Bug 4 class fix): the phase_entered record
      // that "belongs" to this gate_written must come AFTER it. Same
      // pattern across both the review iterate-half (review→build for
      // the next task — original gate_written(build) lives upstream,
      // need to scope dedup) and the linear-FSM transitions (T-002
      // gate_written(build) at idx=N — need to scope dedup against
      // T-001's phase_entered(verify) earlier in the log).
      const hasPhaseEntered = working.some(
        (x, idx) =>
          idx > gateIndex &&
          x.type === 'phase_entered' &&
          x.phase === emittedPhase,
      )
      if (!hasPhaseEntered) {
        const ev: PhaseEvent = {
          version: 1,
          type: 'phase_entered',
          ts: now(),
          runId,
          phase: emittedPhase,
        }
        await appendEvent(eventPaths, ev, { skipLock: true })
        working.push(ev)
        appendedAny = true
      }
    } else {
      const hasRunEnded = working.some((x) => x.type === 'run_ended')
      if (!hasRunEnded) {
        const ev: PhaseEvent = {
          version: 1,
          type: 'run_ended',
          ts: now(),
          runId,
          outcome: 'shipped',
        }
        await appendEvent(eventPaths, ev, { skipLock: true })
        working.push(ev)
        appendedAny = true
      }
    }
  }

  return appendedAny
}

/**
 * Approve-time helper called after writeGate. Appends gate_written +
 * phase_exited + phase_entered/run_ended events that are missing for
 * the given phase. Idempotent; safe to call multiple times. CALLER must
 * hold the per-run lock.
 *
 * M16 C9 follow-on (3) — Bug 4 class fix. Dedup is supersedence-aware:
 * a `gate_file_cleared(phase)` event later than the latest matching
 * record marks the prior task's record as historical, so the next task
 * gets a fresh emission instead of being silently deduped against the
 * prior task. Without this, the multi-task BUILD/VERIFY lifecycle
 * bricks: T-002 `approve build` would see T-001's `gate_written(build)`
 * + `phase_exited(build)` + `phase_entered(verify)` still in the log,
 * skip all emissions, and the FSM never advances. Mirrors the
 * supersedence pattern in `validateRunIntegrity` (c262efd) and the
 * index-based dedup pattern in `completeIncompleteTransitions`
 * (5d21d9be) — both shipped as half-fixes that this commit completes
 * across the rest of the phase-transition surface.
 */
async function completeTransitionForPhase(opts: {
  paths: RunPaths
  events: readonly LoggedEvent[]
  phase: Phase
  runId: string
  profile: Profile
  gateFilename: string
  approvedBy?: string
  now: () => string
}): Promise<boolean> {
  const eventPaths = eventPathsFor(opts.paths)
  // Narrow up-front so working[].type discriminates properly.
  let working: PhaseEvent[] = [...opts.events.filter(isKnownPhaseEvent)]
  let appendedAny = false

  // Supersedence anchor: if a `gate_file_cleared(phase)` is more recent
  // than the latest gate_written(phase), the prior task's gate is
  // historical and we must emit fresh records for the new task. The
  // anchor is the index of the latest gate_file_cleared(phase); active
  // records have idx > anchor, historical records have idx < anchor.
  // -1 (no clear) means every record so far is "active" (single-task
  // lifecycle or first task of a multi-task run).
  const clearAnchor = lastIndexOf(
    working,
    (e) => e.type === 'gate_file_cleared' && e.phase === opts.phase,
  )

  const latestGateWrittenIdx = lastIndexOf(
    working,
    (e) => e.type === 'gate_written' && e.phase === opts.phase,
  )
  const hasGateWritten = latestGateWrittenIdx > clearAnchor
  if (!hasGateWritten) {
    const ev: PhaseEvent = {
      version: 1,
      type: 'gate_written',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      file: opts.gateFilename,
      ...(opts.approvedBy !== undefined ? { approvedBy: opts.approvedBy } : {}),
    }
    await appendEvent(eventPaths, ev, { skipLock: true })
    working.push(ev)
    appendedAny = true
  }

  const latestPhaseExitedIdx = lastIndexOf(
    working,
    (e) =>
      e.type === 'phase_exited' && e.phase === opts.phase && e.outcome === 'passed',
  )
  const hasPhaseExited = latestPhaseExitedIdx > clearAnchor
  if (!hasPhaseExited) {
    const ev: PhaseEvent = {
      version: 1,
      type: 'phase_exited',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      outcome: 'passed',
    }
    await appendEvent(eventPaths, ev, { skipLock: true })
    working.push(ev)
    appendedAny = true
  }

  const next = nextPhase(opts.phase, opts.profile)
  if (next !== null) {
    // The "next phase" record is anchored to the SAME gate_file_cleared
    // (the clear marks the prior task's full transition as historical;
    // the new task's full transition — including its `phase_entered(next)`
    // — must come after). Without this, T-002 approve build would see
    // T-001's `phase_entered(verify)` and skip emission, leaving
    // currentPhase stuck at 'build' instead of advancing to 'verify'.
    const latestPhaseEnteredIdx = lastIndexOf(
      working,
      (e) => e.type === 'phase_entered' && e.phase === next,
    )
    const hasPhaseEntered = latestPhaseEnteredIdx > clearAnchor
    if (!hasPhaseEntered) {
      const ev: PhaseEvent = {
        version: 1,
        type: 'phase_entered',
        ts: opts.now(),
        runId: opts.runId,
        phase: next,
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
      appendedAny = true
    }
  } else {
    // Terminal phase (ship). `run_ended` is global, not per-phase, so
    // no supersedence applies — gate_file_cleared events never target
    // the terminal phase (no gate file to clear). Plain dedup.
    const hasRunEnded = working.some((e) => e.type === 'run_ended')
    if (!hasRunEnded) {
      const ev: PhaseEvent = {
        version: 1,
        type: 'run_ended',
        ts: opts.now(),
        runId: opts.runId,
        outcome: 'shipped',
      }
      await appendEvent(eventPaths, ev, { skipLock: true })
      working.push(ev)
      appendedAny = true
    }
  }

  return appendedAny
}

/**
 * Multi-axis integrity check. For every gate_written event verify:
 *   - the referenced gate file exists, is schema-valid, and (when
 *     artifactSha256 is set) hashes the referenced artifact correctly.
 *   - gate.runId === event.runId (cross-checks the file vs. the trace).
 *   - gate.phase === event.phase.
 *   - event.file is the canonical filename for the event's phase.
 *
 * Also enforces a global integrity invariant: every event in the log must
 * carry the same runId as run_started. This blocks the cross-run
 * contamination scenario where a stale gate file from another run, plus a
 * matching gate_written event, would otherwise pass the per-event checks
 * because gate.runId === event.runId is self-consistent on its own.
 *
 * CALLER must hold the per-run lock.
 */
async function validateRunIntegrity(
  paths: RunPaths,
  events: readonly LoggedEvent[],
): Promise<void> {
  // The global runId invariant applies to ALL events (known or unknown):
  // every line in the log must carry the same runId as run_started.
  const runStarted = events.find((e) => e.type === 'run_started')
  if (runStarted !== undefined) {
    for (const e of events) {
      if (e.runId !== runStarted.runId) {
        throw new GateLoadError([
          {
            file: paths.eventsFile,
            code: 'gate_invalid_runid',
            rule: 'event runId does not match run_started runId; the log mixes events from multiple runs',
            detail: `event.type=${e.type}, event.runId=${e.runId}, run_started.runId=${runStarted.runId}`,
          },
        ])
      }
    }
  }

  // Gate-written validation only applies to known PhaseEvent variants.
  const known = events.filter(isKnownPhaseEvent)

  // M16 C9 follow-on (Bug 2 + Bug 6): identify gate_written events that
  // are historical relative to the file currently on disk. All
  // gate_written(phase) events reference the SAME canonical filename
  // (`GATE_<PHASE>_PASSED.json`); only the latest non-superseded one
  // describes the file's actual on-disk state. Validating earlier
  // gate_written events would either:
  //
  //   - falsely throw `gate_artifact_sha256_mismatch` when the file's
  //     current contents reflect a later approve's artifact (Bug 2,
  //     cross-task), or
  //   - falsely throw `gate_written_event_missing_file` when the file
  //     was cleared at an attempt boundary and no later approve has
  //     re-written it yet (Bug 6, within-task cross-attempt).
  //
  // Skip rule per phase: when the LATEST gate-related event for the
  // phase is `gate_file_cleared`, ALL gate_written(phase) events are
  // historical — the file is absent on disk. When the latest is
  // `gate_written`, only THAT event needs validation; every earlier
  // gate_written(phase) is historical (the file's content reflects
  // the latest approve, not theirs).
  const skipGateWrittenIndex = new Set<number>()
  for (const phase of PHASES) {
    let latestGateWrittenIdx = -1
    let latestGateClearedIdx = -1
    for (let i = 0; i < known.length; i++) {
      const e = known[i]!
      if (e.type === 'gate_written' && e.phase === phase) {
        latestGateWrittenIdx = i
      } else if (e.type === 'gate_file_cleared' && e.phase === phase) {
        latestGateClearedIdx = i
      }
    }
    // Mark every gate_written(phase) earlier than the latest one as
    // historical — they reference the same filename and the on-disk
    // contents reflect only the latest approve.
    for (let i = 0; i < known.length; i++) {
      const e = known[i]!
      if (e.type !== 'gate_written') continue
      if (e.phase !== phase) continue
      if (i !== latestGateWrittenIdx) skipGateWrittenIndex.add(i)
    }
    // If a `gate_file_cleared(phase)` is later than every gate_written,
    // the file has been deleted with no follow-up approve; skip the
    // latest gate_written too (the file is genuinely absent).
    if (latestGateClearedIdx > latestGateWrittenIdx && latestGateWrittenIdx >= 0) {
      skipGateWrittenIndex.add(latestGateWrittenIdx)
    }
  }

  for (let i = 0; i < known.length; i++) {
    const e = known[i]!
    if (e.type !== 'gate_written') continue
    if (skipGateWrittenIndex.has(i)) continue
    const filePath = join(paths.runDir, e.file)
    let gate: GateFile
    try {
      gate = await readGate(filePath, paths.artifactRoot)
    } catch (err: unknown) {
      if (err instanceof GateLoadError) {
        const issue = err.issues[0]
        if (issue?.code === 'gate_io_error' && issue.rule.includes('not found')) {
          throw new GateLoadError([
            {
              file: filePath,
              code: 'gate_written_event_missing_file',
              rule: 'gate_written event exists but the referenced gate file is missing on disk',
              detail: `phase=${e.phase}, file=${e.file}`,
            },
          ])
        }
        throw err
      }
      throw err
    }

    if (gate.runId !== e.runId) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_runid',
          rule: 'gate file runId does not match gate_written event runId',
          detail: `gate=${gate.runId}, event=${e.runId}`,
        },
      ])
    }
    if (gate.phase !== e.phase) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_phase',
          rule: 'gate file phase does not match gate_written event phase',
          detail: `gate=${gate.phase}, event=${e.phase}`,
        },
      ])
    }
    const expectedFilename = gateFilename(e.phase)
    if (e.file !== expectedFilename) {
      throw new GateLoadError([
        {
          file: filePath,
          code: 'gate_invalid_value',
          rule: 'gate_written.file is not the canonical filename for its phase',
          detail: `expected ${expectedFilename}, got ${e.file}`,
        },
      ])
    }
    // sha256 binding is enforced by readGate when artifactSha256 is present.
  }
}
