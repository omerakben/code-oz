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
// gate_written event is absent, loadRun() appends the missing event before
// returning. The reverse condition (event present, file absent) surfaces as
// gate_written_event_missing_file from validateRunIntegrity().

import { open, rename, rm, readFile, mkdir, stat } from 'node:fs/promises'
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
 * active-run pointer. Used by future `code-oz run`.
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
    await writeCurrent(opts.paths, derived)
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
 * derive the current state, and rebuild current.json if needed.
 *
 * Returns null when the run has no events (run never started).
 */
export async function loadRun(paths: RunPaths): Promise<{
  readonly state: RunState
  readonly recovered: boolean
} | null> {
  const eventPaths = eventPathsFor(paths)
  let events = await readEvents(eventPaths)
  if (events.length === 0) return null

  const recovered = await recoverMissingGateWrittenEvents(paths, events)
  if (recovered) {
    events = await readEvents(eventPaths)
  }

  // Validate: any gate_written event must have a corresponding gate file.
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

  // current.json may be stale or missing; rebuild on every load.
  await writeCurrent(paths, state)

  return Object.freeze({ state, recovered })
}

/**
 * Atomic, layered write of a success gate plus its three transition events
 * under a single per-run lock acquisition. Sequence matches the layering
 * rule pinned in docs/references/file-based-gates.md anti-patterns.
 *
 * Idempotent: if the gate file already exists with matching content, the
 * write is a no-op for the gate, but missing events are appended (recovery).
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

    const eventsBefore = await readEvents(eventPaths)
    const hasGateWritten = eventsBefore.some(
      (e) => e.type === 'gate_written' && e.phase === opts.gate.phase,
    )

    if (!writeResult.existed || !hasGateWritten) {
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'gate_written',
          ts: now(),
          runId: opts.gate.runId,
          phase: opts.gate.phase,
          file: writeResult.filename,
        },
        { skipLock: true },
      )
    }

    if (!writeResult.existed) {
      // Fresh approval: emit the standard transition events.
      await appendEvent(
        eventPaths,
        {
          version: 1,
          type: 'phase_exited',
          ts: now(),
          runId: opts.gate.runId,
          phase: opts.gate.phase,
          outcome: 'passed',
        },
        { skipLock: true },
      )
      const next = nextPhase(opts.gate.phase, opts.profile)
      if (next !== null) {
        await appendEvent(
          eventPaths,
          {
            version: 1,
            type: 'phase_entered',
            ts: now(),
            runId: opts.gate.runId,
            phase: next,
          },
          { skipLock: true },
        )
      } else {
        await appendEvent(
          eventPaths,
          {
            version: 1,
            type: 'run_ended',
            ts: now(),
            runId: opts.gate.runId,
            outcome: 'shipped',
          },
          { skipLock: true },
        )
      }
    }

    const events = await readEvents(eventPaths)
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
    await writeCurrent(opts.paths, state)

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
  const pointer: ActiveRunPointer = { version: 1, runId }
  const json = JSON.stringify(pointer, null, 2) + '\n'
  const buf = Buffer.from(json, 'utf8')
  await mkdir(dirname(activeFile), { recursive: true })
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

async function writeCurrent(paths: RunPaths, state: RunState): Promise<void> {
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
 * any recovery was performed. Holds the per-run lock for the duration.
 */
async function recoverMissingGateWrittenEvents(
  paths: RunPaths,
  events: readonly PhaseEvent[],
): Promise<boolean> {
  const gateWrittenPhases = new Set<Phase>()
  for (const e of events) {
    if (e.type === 'gate_written') gateWrittenPhases.add(e.phase)
  }

  const orphans: { phase: Phase; gate: GateFile }[] = []
  for (const phase of PHASES) {
    if (gateWrittenPhases.has(phase)) continue
    const filePath = join(paths.runDir, gateFilename(phase))
    try {
      await stat(filePath)
    } catch {
      continue
    }
    let gate: GateFile
    try {
      gate = await readGate(filePath, paths.artifactRoot)
    } catch {
      // Gate file exists but doesn't validate. Don't auto-recover an invalid
      // gate; let the next loader call surface the schema error.
      continue
    }
    orphans.push({ phase, gate })
  }

  if (orphans.length === 0) return false

  const eventPaths = eventPathsFor(paths)
  const now = () => new Date().toISOString()

  await withLock(paths.lockDir, async () => {
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
  }).catch((err: unknown) => {
    if (err instanceof LockBusyError) {
      throw new EventLogError([
        {
          file: paths.eventsFile,
          code: 'event_lock_busy',
          rule: 'per-run lock is busy during cross-file recovery',
          detail: err.lockDir,
        },
      ])
    }
    throw err
  })

  return true
}

/**
 * Detect the reverse condition: a gate_written event exists in the log but
 * the gate file is missing on disk. This is unrecoverable in v0.1 (we do not
 * synthesize gate files from events) and produces gate_written_event_missing_file.
 */
async function validateRunIntegrity(
  paths: RunPaths,
  events: readonly PhaseEvent[],
): Promise<void> {
  for (const e of events) {
    if (e.type !== 'gate_written') continue
    const filePath = join(paths.runDir, e.file)
    try {
      await stat(filePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
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
  }
}
