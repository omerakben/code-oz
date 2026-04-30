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

// Minimal valid SPEC.md content for tests that exercise `runApprove` on the
// define phase (M5+ validates against parseSpec before binding the gate).
const MINIMAL_VALID_SPEC = [
  '# SPEC',
  '',
  '## Goals',
  '',
  '- A goal.',
  '',
  '## Users',
  '',
  '- A user.',
  '',
  '## Constraints',
  '',
  '- A constraint.',
  '',
  '## Acceptance criteria',
  '',
  '- A criterion.',
  '',
  '## Open questions',
  '',
  '- None known at define time.',
  '',
  '## Explicit non-goals',
  '',
  '- A non-goal.',
  '',
].join('\n')

async function writeArtifactsFor(phases: readonly Phase[], runDir: string): Promise<void> {
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  await mkdir(artifactRoot, { recursive: true })
  for (const p of phases) {
    const body = p === 'define' ? MINIMAL_VALID_SPEC : `${p} body`
    await writeFile(join(artifactRoot, CANONICAL_ARTIFACTS[p]), body, 'utf8')
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

describe('orphan recovery completes the transition deterministically', () => {
  test('crash between gate rename and event append leaves the run resumable at the next phase', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define', 'plan'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    // Crash window: gate file written, but no gate_written, phase_exited, or
    // phase_entered events appended (i.e., the worst-case crash right after
    // the gate rename succeeded).
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

    const reloaded = await loadRun(paths)
    expect(reloaded?.recovered).toBe(true)
    // Recovery must advance currentPhase to plan — the run is no longer stuck
    // on define just because the original transition crashed.
    expect(reloaded?.state.currentPhase).toBe('plan')
    expect(reloaded?.state.phasesCompleted).toEqual(['define'])

    const types = await eventTypes(paths.eventsFile)
    // After recovery the log contains exactly: run_started, phase_entered(define),
    // gate_written(define), phase_exited(define), phase_entered(plan).
    expect(types).toEqual([
      'run_started',
      'phase_entered',
      'gate_written',
      'phase_exited',
      'phase_entered',
    ])

    // Subsequent approval of the new currentPhase succeeds without
    // duplicating events.
    const next = await runApprove({ cwd, phase: 'plan', now: () => FIXED_TS })
    expect(next.approved).toBe(true)
    expect(next.phase).toBe('plan')

    const finalTypes = await eventTypes(paths.eventsFile)
    expect(finalTypes.filter((t) => t === 'gate_written').length).toBe(2)
  })

  test('idempotent re-approve tolerates approvedAt drift (different now() values)', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    // First approval at one timestamp.
    const first = await runApprove({
      cwd,
      phase: 'define',
      now: () => '2026-04-29T17:00:00Z',
    })
    expect(first.approved).toBe(true)

    // The run is now at currentPhase=plan, so re-running approve --phase
    // define would fail the FSM check. Use approveGate directly to simulate
    // a crash-recovery retry on the SAME phase but with a different
    // timestamp — this is the exact scenario that broke before the fix:
    // approvedAt drift trips gate_idempotency_violation.
    const { approveGate } = await import('../src/state/run.ts')
    const result = await approveGate({
      paths,
      gate: {
        version: 1,
        runId,
        phase: 'define',
        artifact: 'SPEC.md',
        agent: 'ba',
        agentProvider: 'claude',
        approvedBy: 'user',
        approvedAt: '2026-04-29T17:05:00Z', // different from first
      },
      profile: 'greenfield',
      now: () => '2026-04-29T17:05:00Z',
    })
    // gate file should have existed (recovery short-circuit), not throw.
    expect(result.gateExisted).toBe(true)

    // No duplicate gate_written event.
    const types = await eventTypes(paths.eventsFile)
    expect(types.filter((t) => t === 'gate_written').length).toBe(1)
  })
})

describe('cross-run contamination is blocked', () => {
  test('orphan gate from a different runId is refused; this run does not advance', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    // Manually craft a gate file whose runId belongs to a DIFFERENT run.
    // Without the cross-run safety check, recoverOrphanGates would happily
    // append a gate_written event for this phase and silently advance this
    // run on someone else's decision.
    const otherRunId = generateUlid({ now: 2_000_000_000_000, random: new Uint8Array(10) })
    const gatePath = join(paths.runDir, 'GATE_DEFINE_PASSED.json')
    const { writeFile: wf } = await import('node:fs/promises')
    // Compute a real sha256 for the existing SPEC.md so readGate doesn't trip
    // on the integrity binding before the runId check fires.
    const { createHash } = await import('node:crypto')
    const specBuf = await readFile(join(paths.artifactRoot, 'SPEC.md'))
    const sha = createHash('sha256').update(specBuf).digest('hex')
    await wf(
      gatePath,
      JSON.stringify(
        {
          version: 1,
          runId: otherRunId,
          phase: 'define',
          artifact: 'SPEC.md',
          artifactSha256: sha,
          agent: 'ba',
          agentProvider: 'claude',
          approvedBy: 'user',
          approvedAt: FIXED_TS,
        },
        null,
        2,
      ),
      'utf8',
    )

    try {
      await loadRun(paths)
      throw new Error('expected GateLoadError on cross-run gate')
    } catch (err) {
      const e = err as { issues?: { code: string; rule: string }[] }
      expect(e.issues?.[0]?.code).toBe('gate_invalid_runid')
      expect(e.issues?.[0]?.rule).toContain('different runId')
    }
  })
})

describe('artifact mutation after gate write fails resume (rule 9 sha256 binding)', () => {
  test('mutating an approved artifact causes loadRun to reject with gate_artifact_sha256_mismatch', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })

    // Mutate SPEC.md after the gate was written.
    await writeFile(join(paths.artifactRoot, 'SPEC.md'), 'modified after approval', 'utf8')

    try {
      await loadRun(paths)
      throw new Error('expected GateLoadError on artifact mutation')
    } catch (err) {
      // The full validation path through readGate enforces sha256 binding.
      const e = err as { issues?: { code: string }[] }
      expect(e.issues?.[0]?.code).toBe('gate_artifact_sha256_mismatch')
    }
  })
})
