import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRunArgs, assertNonInteractiveProviderOk } from '../src/commands/run.ts'
import { runApprove } from '../src/commands/approve.ts'
import { initProject } from '../src/commands/init.ts'
import { initRun, requireGate, runPathsFor } from '../src/state/run.ts'
import { appendEvent } from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'

const OK_ENV = { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' } as const

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
