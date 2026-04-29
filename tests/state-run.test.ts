import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runPathsFor,
  reduceEvents,
  initRun,
  loadRun,
  approveGate,
  readActiveRun,
  writeActiveRun,
  type RunPaths,
} from '../src/state/run.ts'
import { GateLoadError, EventLogError } from '../src/state/errors.ts'
import { generateUlid, type GateFile, type PhaseEvent } from '../src/state/schemas.ts'
import { writeGate, gateFilename } from '../src/state/gates.ts'
import { appendEvent } from '../src/state/events.ts'

let tmp: string
let paths: RunPaths
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-run-'))
  const stateDir = join(tmp, 'state')
  const artifactRoot = join(tmp, 'artifacts')
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = runPathsFor(stateDir, artifactRoot, RUN)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function writeArtifact(name: string, content: string): Promise<void> {
  await writeFile(join(paths.artifactRoot, name), content, 'utf8')
}

function gate(overrides: Partial<GateFile> = {}): GateFile {
  return {
    version: 1,
    runId: RUN,
    phase: 'define',
    artifact: 'SPEC.md',
    agent: 'ba',
    agentProvider: 'claude',
    approvedBy: 'user',
    approvedAt: '2026-04-29T17:00:00Z',
    ...overrides,
  }
}

describe('runPathsFor', () => {
  test('builds canonical paths from stateDir + runId', () => {
    const p = runPathsFor('/state', '/artifacts', RUN)
    expect(p.runDir).toBe(`/state/runs/${RUN}`)
    expect(p.eventsFile).toBe(`/state/runs/${RUN}/events.jsonl`)
    expect(p.currentFile).toBe(`/state/runs/${RUN}/current.json`)
    expect(p.lockDir).toBe(`/state/runs/${RUN}/.lock`)
    expect(p.activeFile).toBe('/state/active.json')
    expect(Object.isFrozen(p)).toBe(true)
  })
})

describe('reduceEvents (pure)', () => {
  test('empty events return null', () => {
    expect(reduceEvents([])).toBeNull()
  })

  test('events without run_started return null', () => {
    expect(
      reduceEvents([
        { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:00Z', runId: RUN, phase: 'plan' },
      ]),
    ).toBeNull()
  })

  test('derives state from run_started + phase_entered', () => {
    const events: PhaseEvent[] = [
      { version: 1, type: 'run_started', ts: '2026-04-29T17:00:00Z', runId: RUN, profile: 'greenfield' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:01Z', runId: RUN, phase: 'define' },
    ]
    const state = reduceEvents(events)
    expect(state?.runId).toBe(RUN)
    expect(state?.profile).toBe('greenfield')
    expect(state?.currentPhase).toBe('define')
    expect(state?.phasesCompleted).toEqual([])
    expect(state?.lastEventAt).toBe('2026-04-29T17:00:01Z')
  })

  test('phase_exited(passed) increments phasesCompleted', () => {
    const events: PhaseEvent[] = [
      { version: 1, type: 'run_started', ts: '2026-04-29T17:00:00Z', runId: RUN, profile: 'greenfield' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:01Z', runId: RUN, phase: 'define' },
      { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:02Z', runId: RUN, phase: 'define', outcome: 'passed' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:03Z', runId: RUN, phase: 'plan' },
    ]
    const state = reduceEvents(events)!
    expect(state.currentPhase).toBe('plan')
    expect(state.phasesCompleted).toEqual(['define'])
  })

  test('phase_exited(failed) does NOT add to phasesCompleted', () => {
    const events: PhaseEvent[] = [
      { version: 1, type: 'run_started', ts: '2026-04-29T17:00:00Z', runId: RUN, profile: 'greenfield' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:01Z', runId: RUN, phase: 'define' },
      { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:02Z', runId: RUN, phase: 'define', outcome: 'failed' },
    ]
    const state = reduceEvents(events)!
    expect(state.phasesCompleted).toEqual([])
  })

  test('phasesCompleted is deduplicated', () => {
    const events: PhaseEvent[] = [
      { version: 1, type: 'run_started', ts: '2026-04-29T17:00:00Z', runId: RUN, profile: 'greenfield' },
      { version: 1, type: 'phase_entered', ts: '2026-04-29T17:00:01Z', runId: RUN, phase: 'define' },
      { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:02Z', runId: RUN, phase: 'define', outcome: 'passed' },
      // Re-pass a phase via cross-file recovery shouldn't double-count.
      { version: 1, type: 'phase_exited', ts: '2026-04-29T17:00:03Z', runId: RUN, phase: 'define', outcome: 'passed' },
    ]
    const state = reduceEvents(events)!
    expect(state.phasesCompleted).toEqual(['define'])
  })
})

describe('initRun', () => {
  test('creates run dir, writes events, current.json, active.json', async () => {
    const state = await initRun({ paths, profile: 'greenfield', runId: RUN })
    expect(state.runId).toBe(RUN)
    expect(state.profile).toBe('greenfield')
    expect(state.currentPhase).toBe('define')

    const events = JSON.parse(await readFile(paths.eventsFile, 'utf8').then((s) => `[${s.trim().split('\n').join(',')}]`))
    expect(events.length).toBe(2)
    expect(events[0].type).toBe('run_started')
    expect(events[1].type).toBe('phase_entered')

    const current = JSON.parse(await readFile(paths.currentFile, 'utf8'))
    expect(current.runId).toBe(RUN)
    expect(current.currentPhase).toBe('define')

    const active = JSON.parse(await readFile(paths.activeFile, 'utf8'))
    expect(active.runId).toBe(RUN)
    expect(active.version).toBe(1)
  })

  test('brownfield profile starts at audit', async () => {
    const state = await initRun({ paths, profile: 'brownfield', runId: RUN })
    expect(state.currentPhase).toBe('audit')
  })

  test('rejects non-ULID runId', async () => {
    await expect(
      initRun({ paths, profile: 'greenfield', runId: 'not-a-ulid' }),
    ).rejects.toBeInstanceOf(EventLogError)
  })

  test('rejects unknown profile', async () => {
    await expect(
      initRun({ paths, profile: 'hybrid' as never, runId: RUN }),
    ).rejects.toBeInstanceOf(EventLogError)
  })
})

describe('loadRun', () => {
  test('returns null for an empty run', async () => {
    const result = await loadRun(paths)
    expect(result).toBeNull()
  })

  test('replays events and rebuilds current.json', async () => {
    await initRun({ paths, profile: 'greenfield', runId: RUN })
    // Delete current.json to confirm loadRun rebuilds it.
    await rm(paths.currentFile)
    const result = await loadRun(paths)
    expect(result?.state.currentPhase).toBe('define')
    expect(result?.recovered).toBe(false)

    const current = JSON.parse(await readFile(paths.currentFile, 'utf8'))
    expect(current.currentPhase).toBe('define')
  })
})

describe('approveGate — full happy path', () => {
  test('writes gate, emits 3 events, rebuilds current', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await initRun({ paths, profile: 'greenfield', runId: RUN })

    const result = await approveGate({ paths, gate: gate(), profile: 'greenfield' })
    expect(result.gateExisted).toBe(false)
    expect(result.nextPhase).toBe('plan')
    expect(result.state.currentPhase).toBe('plan')
    expect(result.state.phasesCompleted).toEqual(['define'])

    const eventsRaw = (await readFile(paths.eventsFile, 'utf8')).trim().split('\n')
    const events = eventsRaw.map((l) => JSON.parse(l))
    // run_started + phase_entered(define) + gate_written(define) + phase_exited(define) + phase_entered(plan)
    expect(events.length).toBe(5)
    expect(events[2].type).toBe('gate_written')
    expect(events[3].type).toBe('phase_exited')
    expect(events[3].outcome).toBe('passed')
    expect(events[4].type).toBe('phase_entered')
    expect(events[4].phase).toBe('plan')

    const current = JSON.parse(await readFile(paths.currentFile, 'utf8'))
    expect(current.currentPhase).toBe('plan')
    expect(current.phasesCompleted).toEqual(['define'])
  })

  test('terminal phase emits run_ended instead of phase_entered', async () => {
    // Build a run already at the terminal phase by approving every prior gate.
    const phasesToWalk = ['define', 'plan', 'build', 'verify', 'review', 'ship'] as const
    const ARTIFACT_FOR: Record<string, string> = {
      define: 'SPEC.md',
      plan: 'PLAN.md',
      build: 'BUILD_REPORT.md',
      verify: 'VERIFY.md',
      review: 'REVIEW.md',
      ship: 'SHIP.md',
    }
    for (const p of phasesToWalk) await writeArtifact(ARTIFACT_FOR[p]!, `${p} body`)

    await initRun({ paths, profile: 'greenfield', runId: RUN })

    for (const p of phasesToWalk) {
      const g = gate({ phase: p, artifact: ARTIFACT_FOR[p]! })
      const r = await approveGate({ paths, gate: g, profile: 'greenfield' })
      if (p === 'ship') {
        expect(r.nextPhase).toBeNull()
      }
    }

    const events = (await readFile(paths.eventsFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(events[events.length - 1].type).toBe('run_ended')
    expect(events[events.length - 1].outcome).toBe('shipped')
  })
})

describe('approveGate — idempotency', () => {
  test('second call with identical gate is a no-op (existed=true)', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await initRun({ paths, profile: 'greenfield', runId: RUN })

    const first = await approveGate({ paths, gate: gate(), profile: 'greenfield' })
    expect(first.gateExisted).toBe(false)

    const second = await approveGate({ paths, gate: gate(), profile: 'greenfield' })
    expect(second.gateExisted).toBe(true)

    // Event count should not have grown beyond the first call.
    const events = (await readFile(paths.eventsFile, 'utf8')).trim().split('\n')
    expect(events.length).toBe(5)
  })
})

describe('cross-file recovery (rule 9)', () => {
  test('orphaned gate file with no gate_written event is recovered on loadRun', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await initRun({ paths, profile: 'greenfield', runId: RUN })

    // Manually write a gate file directly (bypassing approveGate) so the
    // gate_written event is missing — this is the crash window we're recovering.
    await writeGate({
      paths: { runDir: paths.runDir, artifactRoot: paths.artifactRoot, lockDir: paths.lockDir },
      gate: gate(),
    })

    // Sanity: events.jsonl currently has run_started + phase_entered only.
    let events = (await readFile(paths.eventsFile, 'utf8')).trim().split('\n')
    expect(events.length).toBe(2)

    const result = await loadRun(paths)
    expect(result?.recovered).toBe(true)

    const reloaded = (await readFile(paths.eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; phase?: string })
    expect(reloaded.some((e) => e.type === 'gate_written' && e.phase === 'define')).toBe(true)
  })

  test('gate_written event with no gate file produces gate_written_event_missing_file', async () => {
    await initRun({ paths, profile: 'greenfield', runId: RUN })

    // Append a gate_written event WITHOUT writing the gate file.
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      {
        version: 1,
        type: 'gate_written',
        ts: '2026-04-29T17:00:05Z',
        runId: RUN,
        phase: 'define',
        file: gateFilename('define'),
      },
    )

    try {
      await loadRun(paths)
      throw new Error('expected GateLoadError')
    } catch (err) {
      const e = err as GateLoadError
      expect(e.issues[0]?.code).toBe('gate_written_event_missing_file')
    }
  })
})

describe('active-run pointer', () => {
  test('writeActiveRun + readActiveRun round-trip', async () => {
    await writeActiveRun(paths.activeFile, RUN)
    expect(await readActiveRun(paths.activeFile)).toBe(RUN)
  })

  test('readActiveRun returns null when missing', async () => {
    expect(await readActiveRun(paths.activeFile)).toBeNull()
  })

  test('readActiveRun returns null on malformed pointer', async () => {
    await mkdir(join(tmp, 'state'), { recursive: true })
    await writeFile(paths.activeFile, '{ "version": 2, "runId": "X" }', 'utf8')
    expect(await readActiveRun(paths.activeFile)).toBeNull()
  })

  test('writeActiveRun rejects non-ULID', async () => {
    await expect(writeActiveRun(paths.activeFile, 'not-a-ulid')).rejects.toBeInstanceOf(EventLogError)
  })

  test('writeActiveRun is atomic — no leftover .tmp on success', async () => {
    await writeActiveRun(paths.activeFile, RUN)
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(tmp, 'state'))
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false)
  })
})
