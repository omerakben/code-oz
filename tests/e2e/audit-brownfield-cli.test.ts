// M17 C1 — RED brownfield CLI e2e (two failure anchors).
//
// This is the FIRST commit of M17 (AUDIT runtime). It encodes the two
// behaviors the AUDIT phase must satisfy, written as a binary-spawn e2e
// that FAILS today and is driven green commit-by-commit through C8. No
// implementation lands in this commit — this file is pure RED scaffolding.
//
// The two checks are independent `test(...)` cases so each is load-bearing
// on its own:
//
//   (a) fresh-run brownfield routing — `code-oz run` against a
//       brownfield-configured git project must route into an AUDIT phase,
//       actually invoke the AUDIT persona (`auditor`), and must NOT invoke
//       the DEFINE persona (`ba`, the Business Analyst). Today the
//       fresh-run path falls through to `runDefine`
//       (src/commands/run.ts:377), which invokes `ba`, so the
//       no-`ba`-invocation assertion fails. (The brownfield `initRun`
//       already emits `phase_entered(audit)` because
//       `initialPhase('brownfield') === 'audit'`.) The POSITIVE
//       load-bearing anchor is the `agent_invoked(auditor)` assertion: it
//       proves AUDIT actually ran, and only flips green once C3/C4 make the
//       fresh brownfield run invoke the auditor persona. The absence
//       checks (no `ba`, plus the `phase_entered(audit)` sanity) are
//       secondary signals.
//
//   (b) active-run continuation — a run whose state is legitimately at
//       `currentPhase: 'audit'` must dispatch the AUDIT phase — actually
//       invoking the `auditor` persona — not hit the generic "in progress
//       at phase <X>" no-dispatch fallback at the end of `handleActiveRun`
//       (src/commands/run.ts:~1269; the kickoff doc calls this "the
//       run.ts:1134 fallback" — line numbers have drifted, locate by
//       content). Today the active-run dispatcher has no `audit` branch, so
//       a run at `currentPhase: 'audit'` falls through every phase branch
//       (define/plan/build/verify/review) to the terminal fallback and
//       exits non-zero with that message. The POSITIVE load-bearing anchor
//       is an `agent_invoked(auditor)` in the post-spawn `dispatchedEvents`
//       slice: it proves the continuation genuinely dispatched AUDIT, not
//       merely "didn't hit the old fallback." The no-fallback and
//       no-BUILD-route guards remain as secondary belt-and-suspenders
//       signals.
//
// ----------------------------------------------------------------------
// ANTI-STUB CONTRACT (LOAD-BEARING — a Codex anti-stub reviewer audits this)
//
// POSITIVE AUDIT-OWNED ANCHORS (C1 fix-first hardening). A cross-family
// Codex anti-stub review returned `fix-first`: both checks originally leaned
// on ABSENCE assertions (no `ba`, no fallback, no BUILD route), which could
// prematurely flip GREEN at C2 if `dispatchAudit` stubs or crashes WITHOUT
// AUDIT actually running. Each check now carries a POSITIVE anchor that the
// AUDIT runtime alone can satisfy: an `agent_invoked` event with
// `agent: 'auditor'`. This is the existing event vocabulary — the codebase
// has no `persona_invocation_started` event; the real kickoff event is
// `agent_invoked` (see src/state/schemas.ts, src/state/events.ts), and the
// auditor emits it the same way `ba` and the other personas already do
// (LOCKED for C3). These positive anchors are RED today (no auditor fires
// anywhere) and only flip GREEN once C3/C4 make the auditor persona actually
// run. They cannot false-pass on a stubbed/crashing dispatch, because a stub
// produces no `agent_invoked(auditor)` event.
//
// This test MUST NOT:
//   - import and call phase functions to PRODUCE the behavior under test.
//     The behavior under test is driven exclusively by spawning the real
//     CLI binary (`bun run src/cli.ts run ...`) as a subprocess and
//     asserting on the resulting events.jsonl. There is NO import of
//     `runDefine`, `runAudit`, `runBuild`, `runPlan`, `dispatchAudit`,
//     `dispatchBuild`, or any other phase/dispatch function.
//   - write an `AUDIT.md` artifact itself (or any phase artifact). The
//     AUDIT.md must only ever be produced by the (not-yet-existing) AUDIT
//     runtime once C2/C3 land. This file performs zero artifact writes.
//   - hand-write synthetic event-log lines. The ONLY synthetic state this
//     file constructs is the minimal fixture for check (b): a run that is
//     legitimately at `currentPhase: 'audit'`. That precondition is reached
//     ONLY through the real state/event primitives `initRun` +
//     `writeActiveRun` from src/state/run.ts — `initRun` emits the real
//     `run_started` + `phase_entered(audit)` events through the orchestrator
//     event-emission primitive (rule 1). No JSON line is appended to
//     events.jsonl by hand, and no downstream state (gate files, artifacts,
//     later phase events) is faked.
//
// Allowed imports are limited to: bun:test, node fs/os/path/url, the yaml
// codec (config edit), `initProject` (project scaffold), git helpers
// (`runGit`, `runDoctorGit`), and the state primitives needed for check
// (b)'s minimal fixture (`initRun`, `runPathsFor`, `writeActiveRun`,
// `generateUlid`, `paths`). None of these PRODUCE the behavior under test;
// they only set up the project + the minimal `currentPhase: 'audit'`
// precondition.
// ----------------------------------------------------------------------

import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { initProject } from '../../src/commands/init.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'
import { runGit } from '../../src/worktree/create-run-worktree.ts'
// State primitives — used ONLY for check (b)'s minimal fixture (reaching a
// legitimate `currentPhase: 'audit'`). NOT used to produce behavior.
import { initRun, runPathsFor, writeActiveRun } from '../../src/state/run.ts'
import { generateUlid } from '../../src/state/schemas.ts'
import { paths as codeOzPaths } from '../../src/paths.ts'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('M17 C1 brownfield e2e requires git >= 2.40 on PATH')
  }
})

interface FixtureLayout {
  readonly projectRoot: string
  readonly stateDir: string
  readonly artifactRoot: string
}

/**
 * Scaffold a git-initialized, brownfield-configured project. Mirrors the
 * setup in tests/e2e/cli-fresh-profile-propagation.test.ts: real git init,
 * `initProject`, then flip `.code-oz/config.yaml`'s profile to brownfield.
 */
async function setupBrownfieldProject(): Promise<FixtureLayout> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-m17c1-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })

  // A pre-existing source file makes the project genuinely brownfield and
  // gives the worktree a clean base commit.
  await writeFile(join(projectRoot, 'README.md'), '# fixture\n', 'utf8')
  await writeFile(
    join(projectRoot, 'index.ts'),
    'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    'utf8',
  )
  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'm17c1@test'])
  await runGit(projectRoot, ['config', 'user.name', 'M17C1'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await runGit(projectRoot, ['add', '-A'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init fixture'])

  await initProject({ cwd: projectRoot, force: false })

  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const cfg = parseYaml(await readFile(configPath, 'utf8')) as Record<string, unknown>
  cfg.profile = 'brownfield'
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  const cz = codeOzPaths(projectRoot)
  return Object.freeze({
    projectRoot,
    stateDir: cz.state,
    artifactRoot: cz.artifacts,
  })
}

async function findRunEventsFile(stateDir: string): Promise<string | null> {
  const runsDir = join(stateDir, 'runs')
  try {
    const runIds = await readdir(runsDir)
    if (runIds.length === 0) return null
    return join(runsDir, runIds[0]!, 'events.jsonl')
  } catch {
    return null
  }
}

interface ParsedEvent {
  readonly type?: string
  readonly phase?: string
  readonly agent?: string
}

async function readEventsFromFile(eventsFile: string): Promise<readonly ParsedEvent[]> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  const out: ParsedEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line) as ParsedEvent)
    } catch {
      // ignore malformed lines
    }
  }
  return out
}

interface SpawnResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Spawn the real CLI binary. `request` is omitted for active-run
 * continuation (check b), where `code-oz run` routes to `handleActiveRun`
 * without needing initial input.
 */
async function spawnCodeOzRun(cwd: string, request?: string): Promise<SpawnResult> {
  const cmd = [
    'bun',
    'run',
    CLI_ENTRY,
    'run',
    '--provider',
    'fake',
    ...(request !== undefined ? ['--request', request] : []),
  ]
  const proc = Bun.spawn({
    cmd,
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

describe('M17 C1 — brownfield AUDIT CLI e2e (RED)', () => {
  let fixture: FixtureLayout | null = null

  afterEach(async () => {
    if (fixture !== null) {
      const tmpRoot = dirname(fixture.projectRoot)
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
      fixture = null
    }
  })

  // --- check (a): fresh-run brownfield routing ----------------------
  test('fresh run on a brownfield project enters AUDIT and never invokes the BA persona', async () => {
    fixture = await setupBrownfieldProject()
    await spawnCodeOzRun(fixture.projectRoot, 'tidy up the add helper')

    const eventsFile = await findRunEventsFile(fixture.stateDir)
    expect(eventsFile).not.toBeNull()
    const events = await readEventsFromFile(eventsFile!)
    // Sanity: the run actually started and wrote events (guards against a
    // wrong-reason failure where no events file is produced at all).
    expect(events.some((e) => e.type === 'run_started')).toBe(true)

    const enteredAudit = events.some(
      (e) => e.type === 'phase_entered' && e.phase === 'audit',
    )
    expect(enteredAudit).toBe(true)

    // POSITIVE load-bearing anchor (C1 fix-first): the AUDIT persona
    // (`auditor`) must actually be invoked. This proves AUDIT genuinely ran
    // rather than being inferred from the absence of `ba`. It is RED today
    // (no auditor fires anywhere) and only flips GREEN once C3/C4 make the
    // fresh brownfield run invoke the auditor persona via `agent_invoked`.
    // A stubbed/crashing `dispatchAudit` at C2 cannot satisfy this.
    const auditorInvoked = events.some(
      (e) => e.type === 'agent_invoked' && e.agent === 'auditor',
    )
    expect(auditorInvoked).toBe(true)

    // Secondary signal: the DEFINE persona (`ba`) must NOT be invoked on a
    // brownfield run. Today the fresh-run path falls through to `runDefine`,
    // which invokes `ba` via `agent_invoked` (src/providers/invoke.ts), so
    // this assertion FAILS until C2 routes brownfield to AUDIT.
    const baInvoked = events.some(
      (e) => e.type === 'agent_invoked' && e.agent === 'ba',
    )
    expect(baInvoked).toBe(false)
  }, 60_000)

  // --- check (b): active-run continuation ---------------------------
  test('active run at currentPhase audit dispatches AUDIT, not the no-dispatch fallback', async () => {
    fixture = await setupBrownfieldProject()

    // Minimal fixture (anti-stub rule 3): reach a legitimate
    // `currentPhase: 'audit'` ONLY via the real state primitives.
    // `initRun` with profile 'brownfield' emits run_started +
    // phase_entered(audit) through the orchestrator event-emission
    // primitive (initialPhase('brownfield') === 'audit'), and
    // `writeActiveRun` makes it the active run. No event line is written by
    // hand; no gate file or artifact is faked.
    const runId = generateUlid()
    const runPaths = runPathsFor(fixture.stateDir, fixture.artifactRoot, runId)
    await initRun({ paths: runPaths, profile: 'brownfield', runId })
    await writeActiveRun(runPaths.activeFile, runId)

    // Record the event count after the fixture so we only inspect events
    // the spawned CLI appends. (The fixture's phase_entered(audit) is from
    // initRun, not from a dispatch.)
    const eventsFile = runPaths.eventsFile
    const beforeEvents = await readEventsFromFile(eventsFile)
    const beforeCount = beforeEvents.length

    // Active-run continuation: no --request; routes to handleActiveRun.
    const result = await spawnCodeOzRun(fixture.projectRoot)

    const afterEvents = await readEventsFromFile(eventsFile)
    const dispatchedEvents = afterEvents.slice(beforeCount)

    // POSITIVE load-bearing anchor (C1 fix-first): the post-spawn slice must
    // contain an `agent_invoked(auditor)` — proof the continuation genuinely
    // dispatched AUDIT and ran the auditor persona, not merely "didn't hit
    // the old fallback." It is RED today and only flips GREEN once C3/C4 wire
    // the active-run AUDIT branch to invoke the auditor. A stubbed/crashing
    // `dispatchAudit` at C2 cannot satisfy this anchor.
    const auditorDispatched = dispatchedEvents.some(
      (e) => e.type === 'agent_invoked' && e.agent === 'auditor',
    )
    expect(auditorDispatched).toBe(true)

    // Secondary signal: handleActiveRun has no `audit` branch today, so the
    // run falls through to the terminal "in progress at phase <X>" fallback
    // and exits non-zero with that message. Assert that fallback did NOT
    // happen — this FAILS today and flips green once C2 adds the audit
    // dispatch branch. (Belt-and-suspenders behind the positive anchor.)
    const hitNoDispatchFallback =
      /an active run is in progress at phase audit/.test(result.stderr) &&
      result.exitCode !== 0
    expect(hitNoDispatchFallback).toBe(false)

    // Secondary signal: guard against the wrong-route-to-BUILD shape — the
    // audit run must never dispatch BUILD. (Belt-and-suspenders behind the
    // positive anchor; this catches a misroute, the one above catches the
    // no-dispatch fallback.)
    const routedToBuild = dispatchedEvents.some(
      (e) =>
        (e.type === 'phase_entered' && e.phase === 'build') ||
        e.type === 'build_started',
    )
    expect(routedToBuild).toBe(false)
  }, 60_000)
})
