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
import { dirname, join } from 'node:path'
import { runApprove } from '../src/commands/approve.ts'
import { initProject } from '../src/commands/init.ts'
import {
  initRun,
  loadRun,
  requireGate,
  runPathsFor,
  type RunPaths,
} from '../src/state/run.ts'
import { generateUlid, type Phase, CANONICAL_ARTIFACTS } from '../src/state/schemas.ts'
import { writeGate } from '../src/state/gates.ts'
import { appendEvent } from '../src/state/events.ts'
import { serializeReviewReport, type ReviewReportData } from '../src/artifacts/review-report.ts'
import { serializeBuildReport, type BuildReportData } from '../src/artifacts/build-report.ts'
import { buildPromptSnapshotPath } from '../src/worktree/paths.ts'
import { createHash } from 'node:crypto'

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

// M16 C9: review-approve now loads PLAN.md to compute the task cursor
// + decide whether the just-approved task is the last (allCompleted).
// The fixtures emit a single-task PLAN.md so the regression's REVIEW
// approval is the last-task case → currentPhase advances to ship.
const MINIMAL_VALID_PLAN = `# PLAN

## Goals

- One atomic slice for the regression fixture.

## Tasks

### T-001: stub task for state-regression

- Files: src/stub.ts
- Validation: bun test
- Risk: low
- Hypotheses: none
- Sources: SC-SPEC-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Anything beyond the one slice.

## Open questions

- None known at plan time.
`

// Minimal-valid VERIFY.md fixture — needed since M8 fix 4: preApproveVerifyHook
// validates VERIFY.md schema + verdict=pass before removing the worktree.
// Other phases still use stub bodies because their approve flow doesn't yet
// content-validate (will tighten in M9+ for REVIEW).
const MINIMAL_VALID_VERIFY = `# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: ${'e'.repeat(64)})
- Task: T-001
- Attempt: 1
- Base commit: ${'b'.repeat(40)}
- Patch sha256: ${'c'.repeat(64)}

## Validation command

- Command: bun test foo.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: 0
- Duration (ms): 100
- Stdout bytes: 0
- Stderr bytes: 0
- Stdout log: .code-oz/runs/<runId>/forensics/1/stdout.log
- Stderr log: .code-oz/runs/<runId>/forensics/1/stderr.log

## Verdict

- Verdict: pass
- Rationale: stub.

## Mutation

- Status: not-applicable
- Notes: stub.

## Failure constraint

- None (verdict pass).
`

// Minimal-valid BUILD_REPORT.md fixture (M16 C5: preApproveBuildHook now
// validates the report grammar + cross-checks build_completed sha + prompt
// snapshot before binding the gate). Built once via serializeBuildReport so
// the on-disk bytes round-trip cleanly through parseBuildReport.
function minimalBuildReportData(): BuildReportData {
  return Object.freeze({
    task: Object.freeze({
      taskId: 'T-001',
      title: 'stub',
      planSha: 'd'.repeat(64),
      attempt: 1,
    }),
    base: Object.freeze({
      worktreePath: '.code-oz/runs/abc/worktree/',
      baseCommitSha: 'b'.repeat(40),
      dirtyAtBase: false,
    }),
    patch: Object.freeze({
      patchPath: '.code-oz/runs/abc/patches/T-001-attempt-1.patch',
      patchSha256: 'c'.repeat(64),
      patchBytes: 100,
    }),
    changedFiles: Object.freeze([
      Object.freeze({ path: 'src/stub.ts', sha256: 'a'.repeat(64), change: 'added' as const }),
    ]),
    validationCommand: Object.freeze({
      command: 'bun test',
      workingDirectory: '.code-oz/runs/abc/worktree/',
      timeoutMs: 60000,
      expectedExitCode: 0,
    }),
    failureCarryForward: null,
    notes: Object.freeze(['stub fixture for state-regression.']),
  })
}
const MINIMAL_VALID_BUILD_REPORT = serializeBuildReport(minimalBuildReportData())

function minimalReadyReviewMd(): string {
  const data: ReviewReportData = Object.freeze({
    upstreamRefs: Object.freeze({
      buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
      buildReportSha256: 'a'.repeat(64),
      verifyReportPath: '.code-oz/artifacts/VERIFY.md',
      verifyReportSha256: 'b'.repeat(64),
      taskId: 'T-001',
      attempt: 1,
      baseCommitSha: '0'.repeat(40),
      patchSha256: 'c'.repeat(64),
    }),
    reviewer: Object.freeze({
      providerFamily: 'codex', providerId: 'codex', modelPolicy: 'any',
      crossFamilyCheck: 'passed' as const, buildFamily: 'claude',
    }),
    roundTimeline: Object.freeze([
      Object.freeze({
        round: 1, timestamp: FIXED_TS, findingsRaised: 0,
        score: 8, verdict: 'ready' as const,
      }),
    ]),
    findings: Object.freeze([]),
    score: Object.freeze({
      roundCount: 1, finalScore: 8,
      finalVerdict: 'ready' as const,
      exitReason: 'score>=6 + verdict=ready (round 1)',
    }),
    capStatus: Object.freeze({ cap: 4, roundsUsed: 1, capExhausted: false }),
  })
  return serializeReviewReport(data)
}

async function writeArtifactsFor(phases: readonly Phase[], runDir: string): Promise<void> {
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  await mkdir(artifactRoot, { recursive: true })
  for (const p of phases) {
    let body: string
    if (p === 'define') body = MINIMAL_VALID_SPEC
    else if (p === 'plan') body = MINIMAL_VALID_PLAN
    else if (p === 'build') body = MINIMAL_VALID_BUILD_REPORT
    else if (p === 'verify') body = MINIMAL_VALID_VERIFY
    else if (p === 'review') body = minimalReadyReviewMd()
    else body = `${p} body`
    await writeFile(join(artifactRoot, CANONICAL_ARTIFACTS[p]), body, 'utf8')
  }
  void runDir
}

/**
 * BUILD-approve prereqs (M16 C5): preApproveBuildHook requires a
 * build_completed event for (runId, taskId) whose buildReportSha256 matches
 * the on-disk BUILD_REPORT.md AND whose promptSnapshotSha256 matches a
 * file at buildPromptSnapshotPath(cwd, runId, attempt).
 */
async function stageBuildApprovalPrereqs(runId: string): Promise<void> {
  const stateDir = join(cwd, '.code-oz', 'state')
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  const paths = runPathsFor(stateDir, artifactRoot, runId)
  const buildReportText = await readFile(join(artifactRoot, 'BUILD_REPORT.md'), 'utf8')
  const buildReportSha = createHash('sha256').update(buildReportText, 'utf8').digest('hex')
  const promptText = 'stub composed prompt for state-regression\n'
  const promptPath = buildPromptSnapshotPath(cwd, runId, 1)
  await mkdir(dirname(promptPath), { recursive: true })
  await writeFile(promptPath, promptText, 'utf8')
  const promptSha = createHash('sha256').update(promptText, 'utf8').digest('hex')
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1,
      type: 'build_completed',
      ts: FIXED_TS,
      runId,
      phase: 'build',
      agent: 'builder',
      attempt: 1,
      taskId: 'T-001',
      changedFileCount: 1,
      buildReportSha256: buildReportSha,
      promptSnapshotSha256: promptSha,
    },
  )
}

/**
 * Review approval requires (a) build_provider_recorded for the
 * (taskId, attempt) pair AND (b) a review_resolved event whose
 * reviewReportSha256 matches REVIEW.md. Test fixtures call this
 * AFTER initRun (events.jsonl needs run_started present).
 */
async function stageReviewApprovalPrereqs(runId: string): Promise<void> {
  const stateDir = join(cwd, '.code-oz', 'state')
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  const paths = runPathsFor(stateDir, artifactRoot, runId)
  const reviewText = await readFile(join(artifactRoot, 'REVIEW.md'), 'utf8')
  const reviewSha = createHash('sha256').update(reviewText, 'utf8').digest('hex')
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1, type: 'build_provider_recorded',
      ts: FIXED_TS, runId, phase: 'build',
      attempt: 1, taskId: 'T-001',
      provider: 'claude', family: 'claude',
    },
  )
  await appendEvent(
    { file: paths.eventsFile, lockDir: paths.lockDir },
    {
      version: 1, type: 'review_resolved',
      ts: FIXED_TS, runId, phase: 'review',
      agent: 'reviewer', attempt: 1, taskId: 'T-001',
      finalRound: 1, finalScore: 8,
      reviewReportSha256: reviewSha,
    },
  )
}

// M5+: runApprove requires a gate_required event for the target phase
// (closes CODEX_REVIEW_M5 round 2 finding B). Test fixtures emit one for
// each phase being approved to mirror what a real run would produce.
async function emitGateRequired(phase: Phase, runId: string): Promise<void> {
  const stateDir = join(cwd, '.code-oz', 'state')
  const artifactRoot = join(cwd, '.code-oz', 'artifacts')
  const paths = runPathsFor(stateDir, artifactRoot, runId)
  await requireGate({
    paths,
    runId,
    phase,
    blockedOn: 'test fixture',
  })
}

async function eventTypes(eventsFile: string): Promise<string[]> {
  const content = await readFile(eventsFile, 'utf8')
  return content.trim().split('\n').map((l) => (JSON.parse(l) as { type: string }).type)
}

// M2 ships personas for the five v0.1 spine phases (define, plan, build,
// verify, review). M17 adds the auditor persona for the AUDIT phase. SHIP
// still has no bundled persona. The regression walks below stop at the last
// greenfield phase with a registered persona; the FSM itself transitions
// further (currentPhase becomes 'ship' after review approval), which is
// exactly what we assert.
const GREENFIELD_APPROVABLE: readonly Phase[] = ['define', 'plan', 'build', 'verify', 'review']

describe('end-to-end greenfield walk (M2-persona-supported phases)', () => {
  test('approves DEFINE -> ... -> REVIEW; FSM advances currentPhase to ship', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(GREENFIELD_APPROVABLE, paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })
    await stageBuildApprovalPrereqs(runId)
    await stageReviewApprovalPrereqs(runId)

    for (const phase of GREENFIELD_APPROVABLE) {
      await emitGateRequired(phase, runId)
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
    await stageBuildApprovalPrereqs(runId)
    await stageReviewApprovalPrereqs(runId)

    for (const phase of GREENFIELD_APPROVABLE) {
      await emitGateRequired(phase, runId)
      await runApprove({ cwd, phase, now: () => FIXED_TS })
    }
    await emitGateRequired('ship', runId)

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

    // M17 C4: auditor persona is now bundled. Approving audit with a stub AUDIT.md
    // no longer fails at "no agent registered" — the auditor resolves and
    // preApproveAuditHook validates the artifact structurally, rejecting the
    // invalid stub with an audit_missing_frontmatter issue.
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    await writeFile(join(artifactRoot, 'AUDIT.md'), 'audit body', 'utf8')
    await emitGateRequired('audit', runId)
    await expect(runApprove({ cwd, phase: 'audit', now: () => FIXED_TS })).rejects.toThrow(
      /cannot approve audit.*is not a valid AUDIT\.md/,
    )
  })
})

describe('resume after terminal death (rule 12)', () => {
  test('approving DEFINE then "dying" leaves the run resumable at PLAN', async () => {
    const { runId, paths } = await setupProject()
    await writeArtifactsFor(['define', 'plan'], paths.runDir)
    await initRun({ paths, profile: 'greenfield', runId, now: () => FIXED_TS })

    await emitGateRequired('define', runId)
    await runApprove({ cwd, phase: 'define', now: () => FIXED_TS })

    // Simulate terminal death by reloading the run from disk.
    const reloaded = await loadRun(paths)
    expect(reloaded?.state.currentPhase).toBe('plan')
    expect(reloaded?.state.phasesCompleted).toEqual(['define'])
    expect(reloaded?.recovered).toBe(false)

    // Approving PLAN must succeed without restarting DEFINE.
    await emitGateRequired('plan', runId)
    const planResult = await runApprove({ cwd, phase: 'plan', now: () => FIXED_TS })
    expect(planResult.approved).toBe(true)
    expect(planResult.phase).toBe('plan')

    const types = await eventTypes(paths.eventsFile)
    // Sequence: run_started, phase_entered(define), gate_required(define),
    // gate_written(define), phase_exited(define), phase_entered(plan),
    // gate_required(plan), gate_written(plan), phase_exited(plan),
    // phase_entered(build).
    expect(types).toEqual([
      'run_started',
      'phase_entered',
      'gate_required',
      'gate_written',
      'phase_exited',
      'phase_entered',
      'gate_required',
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
    await emitGateRequired('define', runId)
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
    await emitGateRequired('plan', runId)
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
    await emitGateRequired('define', runId)
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

    await emitGateRequired('define', runId)
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
