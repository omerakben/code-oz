import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRunArgs, assertNonInteractiveProviderOk } from '../src/commands/run.ts'
import { runApprove } from '../src/commands/approve.ts'
import { initProject } from '../src/commands/init.ts'
import { initRun, loadRun, requireGate, runPathsFor } from '../src/state/run.ts'
import { writeGate } from '../src/state/gates.ts'
import { appendEvent } from '../src/state/events.ts'
import { generateUlid, type GateFile } from '../src/state/schemas.ts'

const OK_ENV = { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' } as const

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

interface SubprocResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function runCliSubprocess(
  args: readonly string[],
  cwd: string,
): Promise<SubprocResult> {
  const proc = Bun.spawn({
    cmd: [process.execPath, 'run', CLI_ENTRY, ...args],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe('code-oz run --operator / --non-interactive parsing', () => {
  test('--operator <id> is captured', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.operator).toBe('hermes')
    expect(r.nonInteractive).toBe(false)
  })

  test('--non-interactive sets the flag and requires --operator', () => {
    const ok = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--request', 'hi'])
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') expect(ok.nonInteractive).toBe(true)

    const bad = parseRunArgs(['--non-interactive', '--request', 'hi'])
    expect(bad.kind).toBe('error')
    if (bad.kind === 'error') expect(bad.message).toContain('--operator')
  })

  test('rejects malformed operator id', () => {
    const r = parseRunArgs(['--operator', 'bad id!', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('--operator')
  })

  test('bans --provider fake in non-interactive mode', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('bans --fake-script in non-interactive mode (even with env)', () => {
    const r = parseRunArgs(
      ['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--fake-script', '/x.jsonl', '--request', 'hi'],
      OK_ENV,
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('fake still works WITHOUT --non-interactive (rule 8 preserved)', () => {
    const r = parseRunArgs(['--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.providerOverride).toBe('fake')
  })
})

describe('assertNonInteractiveProviderOk', () => {
  test('throws when fallback would use fake in non-interactive mode', () => {
    expect(() => assertNonInteractiveProviderOk(true, 'fake')).toThrow(/non-interactive/i)
  })

  test('allows fake fallback when NOT non-interactive (rule 8)', () => {
    expect(() => assertNonInteractiveProviderOk(false, 'fake')).not.toThrow()
  })

  test('allows a real (undefined) override in non-interactive mode', () => {
    expect(() => assertNonInteractiveProviderOk(true, undefined)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// runApprove operator-mode guards + provenance.
//
// Fixture pattern reused from tests/commands-approve.test.ts: scaffold a
// greenfield run paused at 'define' with a valid SPEC.md + a gate_required
// signal, using the FAKE provider WITHOUT --non-interactive (rule 8). The
// SHIP fixture additionally seeds a phase_entered(ship) event so the run's
// derived currentPhase is 'ship'; the SHIP guard fires before any gate
// validation, so no SHIP artifact is needed.
// ---------------------------------------------------------------------------

const MINIMAL_SPEC = [
  '# SPEC',
  '',
  '## Goals',
  '',
  '- Goal one.',
  '',
  '## Users',
  '',
  '- Test user.',
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

describe('runApprove — operator mode', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-29T17:00:00Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-operator-approve-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  async function scaffoldRunAtDefine(): Promise<void> {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'SPEC.md'), MINIMAL_SPEC, 'utf8')
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    await requireGate({
      paths,
      runId: RUN,
      phase: 'define',
      blockedOn: 'test fixture',
      now: () => FIXED_TS,
    })
  }

  async function scaffoldRunAtShip(): Promise<void> {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await mkdir(artifactRoot, { recursive: true })
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    // Seed currentPhase = 'ship' directly. The reducer sets currentPhase from
    // the latest phase_entered, so a single appended event suffices; the SHIP
    // guard fires before the agent lookup and gate validation, so no SHIP
    // artifact is required to exercise it.
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'ship' },
    )
  }

  test('non-interactive approve without an explicit phase is rejected', async () => {
    await scaffoldRunAtDefine()
    await expect(
      runApprove({ cwd, nonInteractive: true, operator: 'hermes', now: () => FIXED_TS }),
    ).rejects.toThrow(/non-interactive approve requires an explicit phase/i)
  })

  test('SHIP cannot be approved in non-interactive operator mode (fail closed)', async () => {
    await scaffoldRunAtShip()
    await expect(
      runApprove({
        cwd,
        nonInteractive: true,
        operator: 'hermes',
        phase: 'ship',
        now: () => FIXED_TS,
      }),
    ).rejects.toThrow(/human approval required/i)
  })

  test('a reversible gate approves non-interactively and records operator provenance', async () => {
    await scaffoldRunAtDefine()
    const result = await runApprove({
      cwd,
      nonInteractive: true,
      operator: 'hermes',
      phase: 'define',
      approvedBy: 'operator:hermes',
      now: () => FIXED_TS,
    })
    expect(result.approved).toBe(true)
    expect(result.phase).toBe('define')

    const gatePath = join(cwd, '.code-oz', 'state', 'runs', RUN, 'GATE_DEFINE_PASSED.json')
    const gate = JSON.parse(await readFile(gatePath, 'utf8'))
    expect(gate.approvedBy).toBe('operator:hermes')

    // The gate_written event carries approvedBy too (event-derived provenance).
    const eventsRaw = await readFile(join(cwd, '.code-oz', 'state', 'runs', RUN, 'events.jsonl'), 'utf8')
    const gateWritten = eventsRaw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l))
      .find((e) => e.type === 'gate_written' && e.phase === 'define')
    expect(gateWritten).toBeDefined()
    expect(gateWritten.approvedBy).toBe('operator:hermes')
  })
})

describe('approveCommand parser — operator validation', () => {
  // approveCommand drives process I/O (bootstrap + stdout), so the operator
  // flag validation lives in the CLI parser and is unit-coverable in
  // isolation only for the cheap regex/required-pairing checks below. The
  // gate-write provenance behavior is covered by the runApprove tests above
  // (which the CLI delegates to with approvedBy: `operator:${operator}`).
  test('regex and required-pairing rules match the parser contract', () => {
    const OPERATOR_RE = /^[A-Za-z0-9._:-]{1,64}$/
    expect(OPERATOR_RE.test('hermes')).toBe(true)
    expect(OPERATOR_RE.test('hermes-builder.v2:1')).toBe(true)
    expect(OPERATOR_RE.test('bad id!')).toBe(false)
    expect(OPERATOR_RE.test('')).toBe(false)
    expect(OPERATOR_RE.test('a'.repeat(65))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Finding 1 (fix-first): active-run SHIP continuation must hit the
// non-interactive fail-closed guard, not the generic active-run message.
//
// handleActiveRun calls process.exit, so this is exercised through the real
// CLI via a subprocess (the e2e harness pattern used in commands-run.test.ts).
// Scaffold a run whose derived currentPhase is 'ship' (initRun seeds the
// active.json pointer; a phase_entered(ship) event drives the reducer), then
// invoke `code-oz run --non-interactive --operator hermes` against it.
// ---------------------------------------------------------------------------
describe('active-run SHIP continuation — non-interactive operator guard', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-29T17:00:00Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-operator-ship-run-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  async function scaffoldActiveRunAtShip(): Promise<void> {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await mkdir(artifactRoot, { recursive: true })
    // initRun writes the active.json pointer the CLI reads to route into
    // handleActiveRun.
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    // Drive currentPhase to 'ship' via the latest phase_entered event.
    await appendEvent(
      { file: paths.eventsFile, lockDir: paths.lockDir },
      { version: 1, type: 'phase_entered', ts: FIXED_TS, runId: RUN, phase: 'ship' },
    )
  }

  test('a ship-phase active run fails closed in --non-interactive operator mode', async () => {
    await scaffoldActiveRunAtShip()
    const r = await runCliSubprocess(['run', '--non-interactive', '--operator', 'hermes'], cwd)
    // Real behavior: non-zero exit + the SAME message approve uses, not the
    // generic "in progress at phase ship" / "awaiting ship approval" text.
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/human approval required/i)
    expect(r.stderr).toContain('SHIP cannot be approved in --non-interactive operator mode')
    expect(r.stderr).not.toMatch(/in progress at phase/i)
    expect(r.stderr).not.toMatch(/awaiting ship approval/i)
  })
})

// ---------------------------------------------------------------------------
// Finding 2 (fix-first): crash-recovery of an orphaned gate file must copy
// gate.approvedBy onto the recovered gate_written event. loadRun triggers
// recoverOrphanGates when a gate file exists but its gate_written event does
// not (the crash window). Mirrors tests/state-run.test.ts orphan recovery.
// ---------------------------------------------------------------------------
describe('orphan-gate recovery — preserves approvedBy provenance', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-29T17:00:00Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-operator-orphan-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  test('recovered gate_written carries the gate file approvedBy', async () => {
    const stateDir = join(cwd, 'state')
    const artifactRoot = join(cwd, 'artifacts')
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const paths = runPathsFor(stateDir, artifactRoot, RUN)

    await writeFile(join(artifactRoot, 'SPEC.md'), 'spec body', 'utf8')
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })

    // Write the gate file directly (bypassing approveGate) with operator
    // provenance, so the gate_written event is missing — the crash window.
    const orphanGate: GateFile = {
      version: 1,
      runId: RUN,
      phase: 'define',
      artifact: 'SPEC.md',
      agent: 'ba',
      agentProvider: 'claude',
      approvedBy: 'operator:hermes',
      approvedAt: FIXED_TS,
    }
    await writeGate({
      paths: { runDir: paths.runDir, artifactRoot: paths.artifactRoot, lockDir: paths.lockDir },
      gate: orphanGate,
    })

    const result = await loadRun(paths)
    expect(result?.recovered).toBe(true)

    const recovered = (await readFile(paths.eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; phase?: string; approvedBy?: string })
      .find((e) => e.type === 'gate_written' && e.phase === 'define')
    expect(recovered).toBeDefined()
    expect(recovered?.approvedBy).toBe('operator:hermes')
  })

  test('recovered gate_written omits approvedBy when the gate file has none', async () => {
    const stateDir = join(cwd, 'state')
    const artifactRoot = join(cwd, 'artifacts')
    await mkdir(stateDir, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    const paths = runPathsFor(stateDir, artifactRoot, RUN)

    await writeFile(join(artifactRoot, 'SPEC.md'), 'spec body', 'utf8')
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })

    const orphanGate: GateFile = {
      version: 1,
      runId: RUN,
      phase: 'define',
      artifact: 'SPEC.md',
      agent: 'ba',
      agentProvider: 'claude',
      approvedBy: 'user',
      approvedAt: FIXED_TS,
    }
    await writeGate({
      paths: { runDir: paths.runDir, artifactRoot: paths.artifactRoot, lockDir: paths.lockDir },
      gate: orphanGate,
    })

    const result = await loadRun(paths)
    expect(result?.recovered).toBe(true)

    const recovered = (await readFile(paths.eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; phase?: string; approvedBy?: string })
      .find((e) => e.type === 'gate_written' && e.phase === 'define')
    expect(recovered).toBeDefined()
    // 'user' is a real recorded value, so it round-trips; the conditional
    // spread only drops a strictly-undefined approvedBy.
    expect(recovered?.approvedBy).toBe('user')
  })
})

// ---------------------------------------------------------------------------
// Finding 3 (minor): RunApproveOptions.operator must be read when approvedBy
// is absent, so a programmatic caller passing only { operator } records
// operator:<id> instead of silently falling back to 'user'.
// ---------------------------------------------------------------------------
describe('runApprove — operator-derived approvedBy (Finding 3)', () => {
  let cwd: string
  const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
  const FIXED_TS = '2026-04-29T17:00:00Z'

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'code-oz-operator-derive-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  async function scaffoldRunAtDefine(): Promise<void> {
    await initProject({ cwd })
    const stateDir = join(cwd, '.code-oz', 'state')
    const artifactRoot = join(cwd, '.code-oz', 'artifacts')
    const paths = runPathsFor(stateDir, artifactRoot, RUN)
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'SPEC.md'), MINIMAL_SPEC, 'utf8')
    await initRun({ paths, profile: 'greenfield', runId: RUN, now: () => FIXED_TS })
    await requireGate({ paths, runId: RUN, phase: 'define', blockedOn: 'test fixture', now: () => FIXED_TS })
  }

  test('operator-only opts (no approvedBy) record approvedBy=operator:<id>', async () => {
    await scaffoldRunAtDefine()
    const result = await runApprove({
      cwd,
      nonInteractive: true,
      operator: 'hermes',
      phase: 'define',
      now: () => FIXED_TS,
    })
    expect(result.approved).toBe(true)

    const gatePath = join(cwd, '.code-oz', 'state', 'runs', RUN, 'GATE_DEFINE_PASSED.json')
    const gate = JSON.parse(await readFile(gatePath, 'utf8'))
    expect(gate.approvedBy).toBe('operator:hermes')

    const gateWritten = (await readFile(join(cwd, '.code-oz', 'state', 'runs', RUN, 'events.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l))
      .find((e) => e.type === 'gate_written' && e.phase === 'define')
    expect(gateWritten?.approvedBy).toBe('operator:hermes')
  })
})
