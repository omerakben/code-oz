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
  type PhaseEvent,
  type RunState,
  type ActiveRunPointer,
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

// --- pure reducer --------------------------------------------------

/**
 * Reduce a sequence of validated events into the derived RunState. File order
 * is the ordering authority (validation rule 8). Returns null if the events
 * don't include a `run_started` event.
 */
export function reduceEvents(events: readonly PhaseEvent[]): RunState | null {
  let runId: string | null = null
  let profile: Profile | null = null
  let currentPhase: Phase | null = null
  const phasesCompleted: Phase[] = []
  let lastEventAt: string | null = null

  for (const e of events) {
    lastEventAt = e.ts
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
 * phase_entered(initial) events, build current.json, and update the
 * active-run pointer. The per-run lock and the active-pointer lock are held
 * sequentially (never concurrently) to avoid deadlocks.
 */
export async function initRun(opts: {
  readonly paths: RunPaths
  readonly profile: Profile
  readonly runId: string
  readonly now?: () => string
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

  const state = await withLock(opts.paths.lockDir, async () => {
    await appendEvent(
      eventPaths,
      {
        version: 1,
        type: 'run_started',
        ts: now(),
        runId: opts.runId,
        profile: opts.profile,
      },
      { skipLock: true },
    )
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
    const profile = profileGuess?.type === 'run_started' ? profileGuess.profile : null
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
  events: readonly PhaseEvent[],
): Promise<boolean> {
  const expectedRunId = events.find((e) => e.type === 'run_started')?.runId
  if (expectedRunId === undefined) {
    // No run_started — let downstream reducer surface the contract error.
    return false
  }

  const gateWrittenPhases = new Set<Phase>()
  for (const e of events) {
    if (e.type === 'gate_written') gateWrittenPhases.add(e.phase)
  }

  const orphans: { phase: Phase; gate: GateFile }[] = []
  for (const phase of PHASES) {
    if (gateWrittenPhases.has(phase)) continue
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
 */
async function completeIncompleteTransitions(
  paths: RunPaths,
  events: readonly PhaseEvent[],
  profile: Profile,
): Promise<boolean> {
  const eventPaths = eventPathsFor(paths)
  const now = () => new Date().toISOString()

  // Walk gate_written events in their on-disk order so the appended
  // transition events land in the same order they would have during a
  // clean approval.
  const gateWrittenList = events
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.type === 'gate_written')
    .sort((a, b) => a.i - b.i)

  // Working copy that grows as we append.
  let working: PhaseEvent[] = [...events]
  let appendedAny = false

  for (const { e } of gateWrittenList) {
    if (e.type !== 'gate_written') continue
    const runId = e.runId
    const phase = e.phase
    const next = nextPhase(phase, profile)

    const hasPhaseExited = working.some(
      (x) => x.type === 'phase_exited' && x.phase === phase && x.outcome === 'passed',
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
      const hasPhaseEntered = working.some(
        (x) => x.type === 'phase_entered' && x.phase === next,
      )
      if (!hasPhaseEntered) {
        const ev: PhaseEvent = {
          version: 1,
          type: 'phase_entered',
          ts: now(),
          runId,
          phase: next,
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
 */
async function completeTransitionForPhase(opts: {
  paths: RunPaths
  events: readonly PhaseEvent[]
  phase: Phase
  runId: string
  profile: Profile
  gateFilename: string
  now: () => string
}): Promise<boolean> {
  const eventPaths = eventPathsFor(opts.paths)
  let working: PhaseEvent[] = [...opts.events]
  let appendedAny = false

  const hasGateWritten = working.some(
    (e) => e.type === 'gate_written' && e.phase === opts.phase,
  )
  if (!hasGateWritten) {
    const ev: PhaseEvent = {
      version: 1,
      type: 'gate_written',
      ts: opts.now(),
      runId: opts.runId,
      phase: opts.phase,
      file: opts.gateFilename,
    }
    await appendEvent(eventPaths, ev, { skipLock: true })
    working.push(ev)
    appendedAny = true
  }

  const hasPhaseExited = working.some(
    (e) =>
      e.type === 'phase_exited' && e.phase === opts.phase && e.outcome === 'passed',
  )
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
    const hasPhaseEntered = working.some(
      (e) => e.type === 'phase_entered' && e.phase === next,
    )
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
  events: readonly PhaseEvent[],
): Promise<void> {
  // Global runId invariant: every event must match run_started.runId.
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

  for (const e of events) {
    if (e.type !== 'gate_written') continue
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
