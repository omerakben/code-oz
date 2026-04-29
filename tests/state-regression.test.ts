// Cross-module regression coverage for the M3 state surface. Per-module unit
// coverage lives in state-{schemas,machine,events,gates,run}.test.ts and
// commands-approve.test.ts; this file ties them together against full-run
// scenarios that exercise the locked acceptance criteria from the kickoff:
//
//   - No phase advances by parsing LLM text.
//   - approve writes a schema-valid GATE_<PHASE>_PASSED.json + emits gate_written.
//   - The event log records all transitions.
//   - Resume works (terminal death after PLAN must not restart DEFINE).
//   - bun test passes offline; M1 + M2 regression suites unchanged.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runApprove } from '../src/commands/approve.ts'
import { initProject } from '../src/commands/init.ts'
import {
  initRun,
  loadRun,
  runPathsFor,
  type RunPaths,
} from '../src/state/run.ts'
import { generateUlid, type Phase, CANONICAL_ARTIFACTS } from '../src/state/schemas.ts'
import { writeGate } from '../src/state/gates.ts'

let cwd: string
const FIXED_TS = '2026-04-29T17:00:00Z'

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'code-oz-regression-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

async function setupProject(): Promise<{ runId: string; paths: RunPaths }> {
  await initProject({ cwd })
  const runId = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const paths = runPathsFor(
    join(cwd, '.code-oz', 'state'),
    join(cwd, '.code-oz', 'artifacts'),
    runId,
  )
  return { runId, paths }
}

async function writeArtifactsFor(phases: readonly Phase[], runDir: string): Promise<void> {
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  await mkdir(artifactRoot, { recursive: true })
  for (const p of phases) {
    await writeFile(join(artifactRoot, CANONICAL_ARTIFACTS[p]), `${p} body`, 'utf8')
  }
  void runDir // unused but kept for parity if signatures change
}

async function eventTypes(eventsFile: string): Promise<string[]> {
  const content = await readFile(eventsFile, 'utf8')
  return content.trim().split('\n').map((l) => (JSON.parse(l) as { type: string }).type)
}

// M2 ships personas for the five v0.1 spine phases (define, plan, build,
// verify, review). SHIP and AUDIT have no bundled personas yet — those come
// with M5+ phase machinery and the brownfield audit work in W4. The
// regression walks below stop at the last phase with a registered persona;
// the FSM itself transitions further (currentPhase becomes 'ship' after
// review approval), which is exactly what we assert.
const GREENFIELD_APPROVABLE: readonly Phase[] = ['define', 'plan', 'build', 'verify', 'review']

describe('end-to-end greenfield walk (M2-persona-supported phases)', () => {
  test('approves DEFINE -> ... -> REVIEW; FSM advances currentPhase to ship', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(GREENFIELD_APPROVABLE, paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    for (const phase of GREENFIELD_APPROVABLE) {
      const result = await runApprove({ cwd, phase, now: () => FIXED_TS })
      expect(result.approved).toBe(true)
      expect(result.phase).toBe(phase)
    }

    // After review approval, currentPhase advanced to ship (terminal not yet
    // reached because review's nextPhase is ship, not null).
    const reloaded = await loadRun(paths)
    expect(reloaded?.state.currentPhase).toBe('ship')
    expect(reloaded?.state.phasesCompleted).toEqual([
      'define',
      'plan',
      'build',
      'verify',
      'review',
    ])

    for (const phase of GREENFIELD_APPROVABLE) {
      const gateFile = join(paths.runDir, `GATE_${phase.toUpperCase()}_PASSED.json`)
      const gate = JSON.parse(await readFile(gateFile, 'utf8'))
      expect(gate.runId).toBe(runId)
      expect(gate.phase).toBe(phase)
      expect(gate.artifactSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('approving an unsupported phase fails with a clear missing-persona error', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor([...GREENFIELD_APPROVABLE, 'ship'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    for (const phase of GREENFIELD_APPROVABLE) {
      await runApprove({ cwd, phase, now: () => FIXED_TS })
    }

    // currentPhase is now 'ship' but no bundled persona exists for it yet.
    await expect(runApprove({ cwd, phase: 'ship', now: () => FIXED_TS })).rejects.toThrow(
      /no agent registered for phase 'ship'/,
    )
  })
})

describe('end-to-end brownfield init', () => {
  test('initRun(profile=brownfield) lands at currentPhase=audit', async () => {
    const { runId, paths } = await setupProject()
    await initRun({ paths, profile: 'brownfield', runId, now: () => FIXED_TS })
    const reloaded = await loadRun(paths)
    expect(reloaded?.state.profile).toBe('brownfield')
    expect(reloaded?.state.currentPhase).toBe('audit')

    // No bundled audit persona in M2; approving audit must surface that gap.
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    await writeFile(join(artifactRoot, 'AUDIT.md'), 'audit body', 'utf8')
    await expect(runApprove({ cwd, phase: 'audit', now: () => FIXED_TS })).rejects.toThrow(
      /no agent registered for phase 'audit'/,
    )
  })
})

describe('resume after terminal death (rule 12)', () => {
  test('approving DEFINE then "dying" leaves the run resumable at PLAN', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define', 'plan'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })

    // Simulate terminal death by reloading the run from disk.
    const reloaded = await loadRun(paths)
    expect(reloaded?.state.currentPhase).toBe('plan')
    expect(reloaded?.state.phasesCompleted).toEqual(['define'])
    expect(reloaded?.recovered).toBe(false)

    // Approving PLAN must succeed without restarting DEFINE.
    const planResult = await runApprove({ cwd, phase: 'plan', now: () => FIXED_TS })
    expect(planResult.approved).toBe(true)
    expect(planResult.phase).toBe('plan')

    const types = await eventTypes(paths.eventsFile)
    // Sequence: run_started, phase_entered(define), gate_written(define),
    // phase_exited(define), phase_entered(plan), gate_written(plan),
    // phase_exited(plan), phase_entered(build).
    expect(types).toEqual([
      'run_started',
      'phase_entered',
      'gate_written',
      'phase_exited',
      'phase_entered',
      'gate_written',
      'phase_exited',
      'phase_entered',
    ])
  })
})

describe('cross-file recovery (rule 9)', () => {
  test('orphaned gate file is recovered on the next loadRun', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    // Crash window: gates.ts succeeded, run.ts never appended gate_written.
    await writeGate({
      paths: {
        runDir: paths.runDir,
        artifactRoot: paths.artifactRoot,
        lockDir: paths.lockDir,
      },
      gate: {
        version: 1,
        runId,
        phase: 'define',
        artifact: 'SPEC.md',
        agent: 'ba',
        agentProvider: 'claude',
        approvedBy: 'user',
        approvedAt: FIXED_TS,
      },
    })

    const types = await eventTypes(paths.eventsFile)
    // Before recovery: run_started + phase_entered(define) only.
    expect(types).toEqual(['run_started', 'phase_entered'])

    const reloaded = await loadRun(paths)
    expect(reloaded?.recovered).toBe(true)

    const recoveredTypes = await eventTypes(paths.eventsFile)
    expect(recoveredTypes).toContain('gate_written')
    // gate_written event should reference the canonical filename.
    const lines = (await readFile(paths.eventsFile, 'utf8')).trim().split('\n')
    const gateEvent = lines
      .map((l) => JSON.parse(l) as { type: string; file?: string })
      .find((e) => e.type === 'gate_written')
    expect(gateEvent?.file).toBe('GATE_DEFINE_PASSED.json')
  })
})

describe('M1 + M2 regression invariants', () => {
  test('init still scaffolds .code-oz/ with the agreed layout', async () => {
    const { paths } = await initProject({ cwd })
    const { stat } = await import('node:fs/promises')
    expect((await stat(paths.root)).isDirectory()).toBe(true)
    expect((await stat(paths.agents)).isDirectory()).toBe(true)
    expect((await stat(paths.artifacts)).isDirectory()).toBe(true)
    expect((await stat(paths.state)).isDirectory()).toBe(true)
    expect((await stat(paths.runs)).isDirectory()).toBe(true)
    expect((await stat(paths.config)).isFile()).toBe(true)
  })

  test('M2 bundled defaults are still loaded by the CLI bootstrap', async () => {
    // Covered exhaustively in tests/cli-bootstrap.test.ts; this is the
    // M2-stays-green smoke check from the M3 acceptance criteria.
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })
    const result = await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    expect(result.approved).toBe(true)

    const gate = JSON.parse(
      await readFile(join(paths.runDir, 'GATE_DEFINE_PASSED.json'), 'utf8'),
    )
    // The bundled BA persona populates the gate's agent metadata.
    expect(gate.agent).toBe('ba')
    expect(gate.agentProvider).toBe('claude')
  })
})

describe('idempotent recovery interplay with cross-file recovery', () => {
  test('recovered orphan + subsequent approve does not duplicate events', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define', 'plan'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    // Orphan: gate file written, gate_written event missing.
    await writeGate({
      paths: {
        runDir: paths.runDir,
        artifactRoot: paths.artifactRoot,
        lockDir: paths.lockDir,
      },
      gate: {
        version: 1,
        runId,
        phase: 'define',
        artifact: 'SPEC.md',
        agent: 'ba',
        agentProvider: 'claude',
        approvedBy: 'user',
        approvedAt: FIXED_TS,
      },
    })

    // loadRun recovers the missing event.
    await loadRun(paths)

    // approveGate via runApprove should detect the existing gate (idempotent)
    // but currentPhase is still 'define' because phase_exited never fired.
    // The recovery left gate_written but not phase_exited/phase_entered, so
    // the run is in a partial state — approve completes the transition.
    const result = await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })
    expect(result.gateExisted).toBe(true)

    const types = await eventTypes(paths.eventsFile)
    // gate_written should appear exactly once even though both recovery and
    // approveGate could have written it.
    expect(types.filter((t) => t === 'gate_written').length).toBe(1)
  })
})
