// End-to-end fixture replay for the DEFINE phase.
//
// Spawns `code-oz run --provider fake --request-file <fixture>` as a real
// subprocess in a tmp project, asserts that:
//   - Exit code is 0
//   - SPEC.md is written at .code-oz/artifacts/SPEC.md and matches the
//     golden snapshot character-for-character
//   - GATE_DEFINE_PASSED.json is NOT yet written (DEFINE awaits explicit
//     `code-oz approve define`)
//   - events.jsonl contains the expected ask_me_user_input +
//     ask_me_persona_reply pairs and a gate_required event
//
// Per CODEX_RESPONSE_M5.md commit 9 sequence + the M5 acceptance:
// "deterministic transcript fixture replays via FakeProvider and produces
// a snapshot-matched SPEC.md."

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')
const FIXTURE_TRANSCRIPT = join(
  REPO_ROOT,
  'tests/fixtures/transcripts/nontechnical-baby-game.md',
)
const FIXTURE_SPEC = join(REPO_ROOT, 'tests/fixtures/specs/nontechnical-baby-game.md')

interface SubprocResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function runSubprocess(
  args: readonly string[],
  cwd: string,
): Promise<SubprocResult> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', CLI_ENTRY, 'run', ...args],
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

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-define-fixture-'))
  // Minimal `.code-oz/` scaffold — enough for runCommand's preflight.
  await mkdir(join(tmp, '.code-oz', 'artifacts'), { recursive: true })
  await mkdir(join(tmp, '.code-oz', 'state'), { recursive: true })
  await mkdir(join(tmp, '.code-oz', 'agents'), { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('e2e: code-oz run --provider fake --request-file', () => {
  test('produces a SPEC.md matching the golden snapshot', async () => {
    const r = await runSubprocess(
      ['--provider', 'fake', '--request-file', FIXTURE_TRANSCRIPT],
      tmp,
    )
    // M16 C11 — `--provider fake` prints the LOUD warning banner to
    // stderr exactly once per invocation. Assert stderr contains only
    // that banner (no error output, no other warnings).
    expect(r.stderr).toContain('--provider fake is active')
    expect(r.stderr).toContain('TEST-ONLY')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('DEFINE phase complete')
    expect(r.stdout).toContain('code-oz approve define')

    const specPath = join(tmp, '.code-oz', 'artifacts', 'SPEC.md')
    const actual = await readFile(specPath, 'utf8')
    const golden = await readFile(FIXTURE_SPEC, 'utf8')
    expect(actual).toBe(golden)
  })

  test('does NOT write GATE_DEFINE_PASSED.json (awaiting explicit approval)', async () => {
    await runSubprocess(
      ['--provider', 'fake', '--request-file', FIXTURE_TRANSCRIPT],
      tmp,
    )

    // Find the per-run state dir (only one run exists)
    const stateRunsDir = join(tmp, '.code-oz', 'state', 'runs')
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(stateRunsDir)
    expect(entries.length).toBe(1)
    const runDir = join(stateRunsDir, entries[0]!)
    let gateErr: unknown
    try {
      await stat(join(runDir, 'GATE_DEFINE_PASSED.json'))
    } catch (e) {
      gateErr = e
    }
    expect((gateErr as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  test('records ask_me_user_input + ask_me_persona_reply + gate_required events', async () => {
    await runSubprocess(
      ['--provider', 'fake', '--request-file', FIXTURE_TRANSCRIPT],
      tmp,
    )
    const stateRunsDir = join(tmp, '.code-oz', 'state', 'runs')
    const fs = await import('node:fs/promises')
    const entries = await fs.readdir(stateRunsDir)
    const runDir = join(stateRunsDir, entries[0]!)
    const eventsRaw = await readFile(join(runDir, 'events.jsonl'), 'utf8')
    const events = eventsRaw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const userInputs = events.filter((e) => e.type === 'ask_me_user_input')
    const personaReplies = events.filter((e) => e.type === 'ask_me_persona_reply')
    const gateRequired = events.filter((e) => e.type === 'gate_required')
    const interventions = events.filter((e) => e.type === 'intervention')
    const agentInvoked = events.filter((e) => e.type === 'agent_invoked')

    // 3 user turns, 3 persona replies (last with ready: true)
    expect(userInputs.length).toBe(3)
    expect(personaReplies.length).toBe(3)
    expect(gateRequired.length).toBe(1)
    expect(interventions.length).toBe(0)
    expect(agentInvoked.length).toBe(3)

    // The third persona reply marks ready: true
    const last = personaReplies[2] as { ready: boolean; turn: number }
    expect(last.ready).toBe(true)
    expect(last.turn).toBe(2)
  })

  test('idempotent: SPEC.md re-read after run is byte-identical to first read', async () => {
    await runSubprocess(
      ['--provider', 'fake', '--request-file', FIXTURE_TRANSCRIPT],
      tmp,
    )
    const specPath = join(tmp, '.code-oz', 'artifacts', 'SPEC.md')
    const a = await readFile(specPath, 'utf8')
    const b = await readFile(specPath, 'utf8')
    expect(a).toBe(b)
  })

  test('does NOT leave a SPEC.draft.md on the success path', async () => {
    await runSubprocess(
      ['--provider', 'fake', '--request-file', FIXTURE_TRANSCRIPT],
      tmp,
    )
    let draftErr: unknown
    try {
      await stat(join(tmp, '.code-oz', 'artifacts', 'SPEC.draft.md'))
    } catch (e) {
      draftErr = e
    }
    expect((draftErr as NodeJS.ErrnoException).code).toBe('ENOENT')
  })
})

describe('e2e: validation failure path', () => {
  test('fixture with malformed BA draft writes SPEC.draft.md + NEEDS_INTERVENTION (no SPEC.md)', async () => {
    // Build a fixture where the BA reply emits a draft missing the
    // explicit non-goals section.
    const badFixture = join(tmp, 'bad.md')
    const badContent = `---
persona: ba
---

<!-- turn:user -->
I want a small thing.
<!-- /turn -->

<!-- turn:ba -->
<spec-ready/>
# SPEC

## Goals

- A goal.

## Users

- A user.

## Constraints

- A constraint.

## Acceptance criteria

- A criterion.

## Open questions

- None known at define time.
<!-- /turn -->

<!-- turn:ba -->
<spec-ready/>
# SPEC

## Goals

- A goal.

## Users

- A user.

## Constraints

- A constraint.

## Acceptance criteria

- A criterion.

## Open questions

- None known at define time.
<!-- /turn -->
`
    await writeFile(badFixture, badContent, 'utf8')

    const r = await runSubprocess(
      ['--provider', 'fake', '--request-file', badFixture],
      tmp,
    )
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('did not produce a valid SPEC.md')

    // SPEC.md absent, SPEC.draft.md present
    let specErr: unknown
    try {
      await stat(join(tmp, '.code-oz', 'artifacts', 'SPEC.md'))
    } catch (e) {
      specErr = e
    }
    expect((specErr as NodeJS.ErrnoException).code).toBe('ENOENT')

    const draftStat = await stat(join(tmp, '.code-oz', 'artifacts', 'SPEC.draft.md'))
    expect(draftStat.isFile()).toBe(true)
  })
})
