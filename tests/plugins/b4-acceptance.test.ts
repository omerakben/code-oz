// C5a — OFFLINE arm of the B4 acceptance harness (D1a gate).
//
// Everything here runs under plain `bun test`: deterministic, network-free,
// no `claude -p`, no live providers. The live behavioral arm lands in C5b.
//
// Five assertion groups (B4 acceptance contract):
//   1. Engine-invocation proof — the WRAPPER (resolve-code-oz.sh) spawns the
//      engine and the engine writes real gate/event/artifact files under
//      `.code-oz/`. Driven THROUGH the resolver, not by calling the CLI
//      directly.
//   2. Zero skill-side `.code-oz/` writes — static scan of the whole wrapper
//      surface for any write OPERATION targeting `.code-oz/`, plus a dynamic
//      confirmation that the engine is the only producer in the group-1 run.
//   3. Negative — no wrapper file emits gate-shaped content as its OWN output
//      (rule-1/rule-2 negative for the whole D1a surface).
//   4. Auth/provider-failure path — a deterministically failing provider makes
//      the ENGINE write `NEEDS_INTERVENTION.json` (rule 11); the wrapper relays
//      the path and offers no host-side review fallback.
//   5. Duplicate-injection idempotence (L5, structural) — router-card carries
//      the idempotence hint and no command auto-runs `code-oz run`.
//
// macOS note: BSD mktemp ignores TMPDIR, so we capture mkdtemp output directly
// (matching tests/plugins/bootstrap-resolver.test.ts).

import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')
const RESOLVER = join(REPO_ROOT, 'plugins/code-oz/scripts/resolve-code-oz.sh')
const WRAPPER_DIR = join(REPO_ROOT, 'plugins/code-oz')

// System bins the resolver + engine need (bash builtins, uname, dirname, grep,
// sed). We deliberately exclude any real npx/code-oz so the only `code-oz` the
// resolver finds is the deterministic shim we plant.
const SYSTEM_BIN = '/usr/bin:/bin'
const BUN_BIN = process.execPath

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

interface SpawnResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

// ---------------------------------------------------------------------------
// Build an isolated temp dir whose `code-oz` is a tiny shim that EXECs the dev
// CLI through bun. This is the deterministic, offline engine the resolver
// branch-2 (`command -v code-oz` -> `exec code-oz "$@"`) will pick.
// ---------------------------------------------------------------------------
async function makeEngineShimDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-oz-b4-shim-'))
  tempDirs.push(dir)
  const shim = join(dir, 'code-oz')
  // EXEC so signals + exit code propagate exactly as a real binary would.
  await writeFile(shim, `#!/bin/sh\nexec "${BUN_BIN}" run "${CLI_ENTRY}" "$@"\n`, 'utf8')
  await chmod(shim, 0o755)
  return dir
}

// ---------------------------------------------------------------------------
// Scaffold a temp project with `.code-oz/` via the engine's own init. Init runs
// with a normal PATH (full bun toolchain); only the resolver run is sandboxed
// to the shim PATH, which is what proves the wrapper located the engine.
// ---------------------------------------------------------------------------
async function makeInitializedProject(): Promise<string> {
  const proj = await mkdtemp(join(tmpdir(), 'code-oz-b4-proj-'))
  tempDirs.push(proj)
  const init = Bun.spawn({
    cmd: [BUN_BIN, 'run', CLI_ENTRY, 'init'],
    cwd: proj,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const exitCode = await init.exited
  if (exitCode !== 0) {
    const stderr = await new Response(init.stderr).text()
    throw new Error(`init failed (exit ${exitCode}): ${stderr}`)
  }
  return proj
}

// ---------------------------------------------------------------------------
// Run the resolver script with a controlled PATH (shim + system bins only) and
// a controlled cwd (the initialized project). This is the wrapper invoking the
// engine — the engine inherits `process.cwd()` from this cwd.
// ---------------------------------------------------------------------------
async function runResolverInProject(opts: {
  shimDir: string
  projectDir: string
  args: readonly string[]
  extraEnv?: Record<string, string>
}): Promise<SpawnResult> {
  const { shimDir, projectDir, args, extraEnv = {} } = opts
  const proc = Bun.spawn({
    cmd: ['bash', RESOLVER, ...args],
    cwd: projectDir,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: `${shimDir}:${SYSTEM_BIN}`,
      HOME: process.env.HOME ?? '/tmp',
      TERM: 'dumb',
      FORCE_COLOR: '0',
      ...extraEnv,
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

// ---------------------------------------------------------------------------
// Recursively collect every regular file under a directory (returns absolute
// paths). Returns [] if the directory does not exist.
// ---------------------------------------------------------------------------
async function listFilesRecursive(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(p)
      } else if (e.isFile()) {
        out.push(p)
      }
    }
  }
  await walk(root)
  return out
}

// ---------------------------------------------------------------------------
// Enumerate every file in the wrapper surface (commands, hooks, scripts,
// manifest). Used by the static-scan groups (2, 3, 5).
// ---------------------------------------------------------------------------
async function wrapperFiles(): Promise<Array<{ path: string; rel: string; text: string }>> {
  const all = await listFilesRecursive(WRAPPER_DIR)
  const out: Array<{ path: string; rel: string; text: string }> = []
  for (const p of all) {
    const text = await readFile(p, 'utf8')
    out.push({ path: p, rel: p.slice(WRAPPER_DIR.length + 1), text })
  }
  return out
}

// ===========================================================================
// Group 1 — Engine-invocation proof (THE WRAPPER spawns the engine).
// ===========================================================================
describe('B4 group 1 — wrapper spawns the engine, engine writes .code-oz/', () => {
  test(
    'resolve-code-oz.sh run --provider fake drives the engine to write events.jsonl + SPEC.md',
    async () => {
      const shimDir = await makeEngineShimDir()
      const proj = await makeInitializedProject()

      // Snapshot .code-oz/state BEFORE the run so we can prove the engine (not
      // init, not the wrapper) produced the gate/event files.
      const stateDir = join(proj, '.code-oz', 'state')
      const beforeStateFiles = await listFilesRecursive(stateDir)
      // init does not create per-run state; events.jsonl must not pre-exist.
      expect(beforeStateFiles.some((f) => f.endsWith('events.jsonl'))).toBe(false)

      const r = await runResolverInProject({
        shimDir,
        projectDir: proj,
        // Mirror the first-run fake fixture path: a single DEFINE phase under
        // FakeProvider. The lightest path that still writes real .code-oz/.
        args: ['run', '--request', 'B4 offline engine-invocation proof', '--provider', 'fake'],
      })

      // The engine ran (DEFINE completed, exit 0). If the resolver had failed
      // to locate the engine we'd see a hard-stop install message + non-zero.
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('DEFINE phase complete')

      // The engine wrote real gate/event/artifact files under .code-oz/.
      const afterStateFiles = await listFilesRecursive(stateDir)
      const eventsFile = afterStateFiles.find((f) => f.endsWith('events.jsonl'))
      expect(eventsFile).toBeDefined()

      // events.jsonl carries a real gate_required(define) event — the
      // file-based gate signal (rule 1), produced by the engine.
      const eventsText = await readFile(eventsFile!, 'utf8')
      const events = eventsText
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { type?: string; phase?: string })
      const gateRequired = events.find(
        (e) => e.type === 'gate_required' && e.phase === 'define',
      )
      expect(gateRequired).toBeDefined()

      // Canonical artifact landed too (SPEC.md under .code-oz/artifacts).
      const specPath = join(proj, '.code-oz', 'artifacts', 'SPEC.md')
      expect(existsSync(specPath)).toBe(true)
      const specText = await readFile(specPath, 'utf8')
      expect(specText).toContain('# SPEC')
    },
    60_000,
  )

  test('resolver hard-stops (engine NOT spawned) when no code-oz/npx is on PATH', async () => {
    // Negative control: with an empty shim dir the resolver must NOT silently
    // pretend success — it proves the group-1 success above is the resolver
    // actually finding + execing our shim, not some ambient code-oz.
    const emptyShim = await mkdtemp(join(tmpdir(), 'code-oz-b4-empty-'))
    tempDirs.push(emptyShim)
    const proj = await makeInitializedProject()
    const r = await runResolverInProject({
      shimDir: emptyShim,
      projectDir: proj,
      args: ['run', '--request', 'no engine on PATH', '--provider', 'fake'],
    })
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout + r.stderr).toMatch(/@tuel\/code-oz/)
    // No per-run events.jsonl was produced.
    const stateFiles = await listFilesRecursive(join(proj, '.code-oz', 'state'))
    expect(stateFiles.some((f) => f.endsWith('events.jsonl'))).toBe(false)
  })
})

// ===========================================================================
// Group 2 — Zero skill-side `.code-oz/` writes (static + dynamic).
// ===========================================================================
describe('B4 group 2 — wrapper never writes under .code-oz/', () => {
  // A WRITE OPERATION targeting `.code-oz/`. We match the redirection / copy /
  // move / tee verbs FOLLOWED BY a .code-oz/ target. Prohibition prose like
  // "Do not write under `.code-oz/`" or "never write `.code-oz/`" does NOT
  // contain a write OPERATOR adjacent to a .code-oz/ target, so it is not
  // matched. Markdown code-fence backticks around `.code-oz/` are stripped
  // before matching so "tee `.code-oz/x`" style would still be caught.
  const WRITE_OP_PATTERNS: ReadonlyArray<RegExp> = [
    />>?\s*`?\.code-oz\//, // > .code-oz/  or  >> .code-oz/
    /\btee\b[^\n]*`?\.code-oz\//, // tee ... .code-oz/
    /\bcp\b[^\n]*`?\.code-oz\//, // cp ... .code-oz/
    /\bmv\b[^\n]*`?\.code-oz\//, // mv ... .code-oz/
    /\bmkdir\b[^\n]*`?\.code-oz\//, // mkdir ... .code-oz/
    /\bdd\b[^\n]*of=`?\.code-oz\//, // dd of=.code-oz/
    /writeFile\s*\([^\n]*\.code-oz\//, // writeFile(... .code-oz/
  ]

  test('no wrapper file performs a shell/JS write operation targeting .code-oz/', async () => {
    const files = await wrapperFiles()
    expect(files.length).toBeGreaterThan(0)
    const offenders: Array<{ rel: string; pattern: string; line: string }> = []
    for (const f of files) {
      for (const line of f.text.split('\n')) {
        for (const re of WRITE_OP_PATTERNS) {
          if (re.test(line)) {
            offenders.push({ rel: f.rel, pattern: re.source, line: line.trim() })
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('control: the same matcher DOES flag a redirection into .code-oz/', () => {
    // Guards against a vacuous matcher. A synthetic offending line must be
    // caught by at least one pattern; a prohibition sentence must not.
    const offending = 'echo passed > .code-oz/state/GATE_DEFINE_PASSED.json'
    const prohibition = 'Do not write under `.code-oz/` for any reason.'
    const hit = (line: string) => WRITE_OP_PATTERNS.some((re) => re.test(line))
    expect(hit(offending)).toBe(true)
    expect(hit(prohibition)).toBe(false)
  })

  test('dynamic: only the engine wrote under .code-oz/ during the group-1 run', async () => {
    const shimDir = await makeEngineShimDir()
    const proj = await makeInitializedProject()
    const stateDir = join(proj, '.code-oz', 'state')

    const before = await listFilesRecursive(stateDir)
    const r = await runResolverInProject({
      shimDir,
      projectDir: proj,
      args: ['run', '--request', 'B4 zero-skill-write dynamic check', '--provider', 'fake'],
    })
    expect(r.exitCode).toBe(0)
    const after = await listFilesRecursive(stateDir)

    // New files appeared under .code-oz/state (events.jsonl, current.json,
    // active.json). Each new file is engine-owned: it lives under the engine's
    // runs/ tree or is the active-run pointer the engine writes. The wrapper
    // (resolve-code-oz.sh) execs the engine and does nothing to .code-oz/
    // itself — proven by the static scan above; here we confirm the producer.
    const newFiles = after.filter((f) => !before.includes(f))
    expect(newFiles.length).toBeGreaterThan(0)
    for (const f of newFiles) {
      const rel = f.slice(stateDir.length + 1)
      // Every new state file is either the active-run pointer or lives under a
      // per-run directory — the engine's run-registry shape, not a wrapper
      // artifact.
      const engineOwned = rel === 'active.json' || rel.startsWith('runs/')
      expect(engineOwned).toBe(true)
    }
  })
})

// ===========================================================================
// Group 3 — Negative: wrapper never emits gate-shaped output as its OWN output.
// ===========================================================================
describe('B4 group 3 — wrapper claims no gate/review authority', () => {
  // First-person / imperative claims that the WRAPPER produces gate-shaped
  // output. Attributions to the engine ("the engine writes GATE_*") are
  // allowed and must NOT match.
  const SELF_AUTHORITY_PATTERNS: ReadonlyArray<RegExp> = [
    /\bI approve\b/i,
    /\bI reviewed\b/i,
    /mark[^.\n]*passed\b/i,
    /\bwrite\s+REVIEW\.md/i,
    /\bwrite\s+VERIFY\.md/i,
    /\bwrite\s+AUDIT\.md/i,
    /\bemit\s+(?:a\s+)?GATE_/i,
    /\bwrite\s+(?:a\s+)?GATE_/i,
  ]

  test('no wrapper file claims gate/review authority for itself', async () => {
    const files = await wrapperFiles()
    const offenders: Array<{ rel: string; line: string }> = []
    for (const f of files) {
      for (const line of f.text.split('\n')) {
        for (const re of SELF_AUTHORITY_PATTERNS) {
          if (re.test(line)) {
            offenders.push({ rel: f.rel, line: line.trim() })
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('GATE_ mentions are only ever prohibitions or engine attributions', async () => {
    const files = await wrapperFiles()
    for (const f of files) {
      for (const line of f.text.split('\n')) {
        if (!line.includes('GATE_')) continue
        // Allowed contexts: the wrapper telling the host NOT to write/emit a
        // gate, or attributing gate authorship to the engine.
        const allowed =
          /do not|never|not write|no gate|cannot write|only gate writer|engine/i.test(line)
        if (!allowed) {
          throw new Error(`unexpected GATE_ context in ${f.rel}: ${line.trim()}`)
        }
        expect(allowed).toBe(true)
      }
    }
  })

  test('control: a self-authority sentence IS flagged but an engine attribution is not', () => {
    const selfClaim = 'I approve this phase and mark it passed.'
    const attribution = 'the engine writes GATE_* and performs cross-family review.'
    const hit = (line: string) => SELF_AUTHORITY_PATTERNS.some((re) => re.test(line))
    expect(hit(selfClaim)).toBe(true)
    expect(hit(attribution)).toBe(false)
  })
})

// ===========================================================================
// Group 4 — Auth/provider-failure -> engine NEEDS_INTERVENTION, no host
// review fallback.
// ===========================================================================
describe('B4 group 4 — provider failure routes to engine NEEDS_INTERVENTION', () => {
  // We inject a deterministic provider FAILURE offline via the test-only
  // `--fake-script` seam (gated behind CODE_OZ_TEST_FAKE_SCRIPT_OK=1 +
  // --provider fake). An empty turn_completed.content with stopReason
  // end_turn is the malformed-response trigger that invokeAgent rejects with
  // ProviderError(provider_malformed_response) and writes NEEDS_INTERVENTION
  // (tests/m5-fix-first.test.ts finding #4). This is the faithful OFFLINE
  // analogue of an upstream provider-auth failure: in both cases the engine
  // gets no usable agent turn and routes to NEEDS_INTERVENTION rather than
  // letting any host fabricate a verdict (rule 11). A genuine network/auth
  // 401 is not reproducible offline; this seam reproduces the same engine
  // code path (ProviderError -> writeNeedsInterventionGate).
  async function writeFailScript(dir: string): Promise<string> {
    const p = join(dir, 'fail.jsonl')
    await writeFile(
      p,
      '{"matcher": {"phase": "define", "agent": "ba"}, "response": {"content": "", "stopReason": "end_turn"}}\n',
      'utf8',
    )
    return p
  }

  test(
    'failing provider through the resolver makes the engine write NEEDS_INTERVENTION.json',
    async () => {
      const shimDir = await makeEngineShimDir()
      const proj = await makeInitializedProject()
      const script = await writeFailScript(proj)

      const r = await runResolverInProject({
        shimDir,
        projectDir: proj,
        args: [
          'run',
          '--request',
          'B4 provider-failure path',
          '--provider',
          'fake',
          `--fake-script=${script}`,
        ],
        extraEnv: { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
      })

      // The engine ran through the resolver and reported the DEFINE failure
      // (no host swallow). Output mentions the provider error, not a verdict.
      expect(r.stdout + r.stderr).toContain('DEFINE phase failed')

      // The engine wrote NEEDS_INTERVENTION.json under the run dir (rule 11).
      const runsDir = join(proj, '.code-oz', 'state', 'runs')
      const runDirs = await readdir(runsDir, { withFileTypes: true })
      const runDir = runDirs.find((d) => d.isDirectory())
      expect(runDir).toBeDefined()
      const interventionPath = join(runsDir, runDir!.name, 'NEEDS_INTERVENTION.json')
      expect(existsSync(interventionPath)).toBe(true)

      const intervention = JSON.parse(await readFile(interventionPath, 'utf8')) as {
        code?: string
        phase?: string
      }
      // The failure surfaces AS that file with the provider-failure code, not
      // a fabricated pass/fail verdict.
      expect(intervention.code).toBe('provider_malformed_response')
      expect(intervention.phase).toBe('define')

      // No GATE_DEFINE_PASSED.json was written — the engine did not pass the
      // gate on a failed provider turn.
      const gatePath = join(runsDir, runDir!.name, 'GATE_DEFINE_PASSED.json')
      let gateMissing = false
      try {
        await stat(gatePath)
      } catch (e) {
        gateMissing = (e as NodeJS.ErrnoException).code === 'ENOENT'
      }
      expect(gateMissing).toBe(true)
    },
    60_000,
  )

  test('run/resume commands offer NO host-side review fallback on engine failure', async () => {
    // Static: the failure-relay surface (run + resume commands) must instruct
    // surfacing the NEEDS_INTERVENTION path verbatim and must NOT offer to
    // review/approve/decide pass-fail on the user's behalf.
    const runCmd = await readFile(
      join(WRAPPER_DIR, 'commands', 'code-oz-run.md'),
      'utf8',
    )
    const resumeCmd = await readFile(
      join(WRAPPER_DIR, 'commands', 'code-oz-resume.md'),
      'utf8',
    )

    for (const content of [runCmd, resumeCmd]) {
      // Relays the engine's NEEDS_INTERVENTION path verbatim.
      expect(content).toContain('NEEDS_INTERVENTION.json')
      expect(content.toLowerCase()).toContain('verbatim')
      // Explicitly forbids deciding pass/fail.
      expect(content).toContain('do not decide pass/fail')
      // No host-side review-fallback offers: the wrapper never claims to
      // review/approve/decide for the user when the engine fails.
      expect(content).not.toMatch(/review it yourself/i)
      expect(content).not.toMatch(/\bI(?:'ll| will| can)?\s+(?:approve|review)\b/i)
      // An affirmative self-claim to decide the verdict (not the "do not
      // decide pass/fail" prohibition, which is required above).
      expect(content).not.toMatch(/\b(?:you (?:can|may|should)|I(?:'ll| will| can)?) decide\b/i)
    }
  })
})

// ===========================================================================
// Group 5 — Duplicate-injection idempotence (L5, structural).
// ===========================================================================
describe('B4 group 5 — duplicate router-card injection is idempotent (structural)', () => {
  test('router-card.md carries the idempotence hint + single-instruction guidance', async () => {
    const card = await readFile(join(WRAPPER_DIR, 'hooks', 'router-card.md'), 'utf8')
    expect(card).toContain('idempotence hint')
    expect(card.toLowerCase()).toContain('single instruction')
  })

  test('no command auto-runs `code-oz run` — every invocation needs explicit confirmation', async () => {
    // If a command auto-ran the engine, two injected router cards could chain
    // into an auto-run. Each command that reaches `code-oz run` must gate it
    // behind explicit invocation / confirmation language.
    const runCmd = await readFile(join(WRAPPER_DIR, 'commands', 'code-oz-run.md'), 'utf8')
    const resumeCmd = await readFile(join(WRAPPER_DIR, 'commands', 'code-oz-resume.md'), 'utf8')
    for (const content of [runCmd, resumeCmd]) {
      // Confirmation / explicit-invocation language is present.
      expect(content.toLowerCase()).toMatch(/confirm|explicitly invoked|explicit request/)
      // No auto-run language.
      expect(content).not.toMatch(/automatically run/i)
      expect(content).not.toMatch(/auto-?run/i)
      expect(content).not.toMatch(/run .* without (?:asking|confirmation)/i)
    }
  })

  test('router-card.md proposes at most a route and never instructs an auto-run', async () => {
    const card = await readFile(join(WRAPPER_DIR, 'hooks', 'router-card.md'), 'utf8')
    // The card proposes / suggests routing and requires confirmation.
    expect(card.toLowerCase()).toMatch(/propose|suggest/)
    expect(card.toLowerCase()).toContain('confirm')
    // It must not instruct an unconditional auto-run of the engine.
    expect(card).not.toMatch(/auto-?run/i)
    expect(card).not.toMatch(/automatically (?:run|invoke)/i)
  })
})
