// RED-first tests for D1a Task C4 — SessionStart router card + plain-bash hook.
//
// These guard the Claude-only SessionStart hook that injects the code-oz
// router card. Locked decisions exercised here (docs/design/
// CODEX_RESPONSE_D1_CONVERGENCE.md):
//   L3 — plain bash, Claude-only branch. hooks.json matcher startup|clear|compact
//        -> `bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-start"`. Script emits ONLY
//        Claude's hookSpecificOutput.additionalContext. Degrade silently if the
//        card is unreadable.
//   L1 — engine-first wording + tightened trigger (card text).
//   L5 — marker is an idempotence HINT, not suppression (card text).
//
// All tests run offline. The hook script is spawned via bash with a controlled
// CLAUDE_PLUGIN_ROOT so no real engine, network, or provider is touched.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

const PLUGIN_ROOT = join(REPO_ROOT, 'plugins/code-oz')
const HOOKS_JSON = join(PLUGIN_ROOT, 'hooks/hooks.json')
const SESSION_START = join(PLUGIN_ROOT, 'hooks/session-start')
const ROUTER_CARD = join(PLUGIN_ROOT, 'hooks/router-card.md')
const HOST_EXEC_MANIFEST = join(PLUGIN_ROOT, 'hooks/host-exec-manifest.json')

// Minimum PATH so bash builtins + coreutils (cat, dirname) resolve.
const SYSTEM_BIN = '/usr/bin:/bin'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// Spawn the session-start script with a controlled CLAUDE_PLUGIN_ROOT.
async function runSessionStart(opts: {
  scriptPath?: string
  pluginRoot: string
  extraEnv?: Record<string, string>
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { scriptPath = SESSION_START, pluginRoot, extraEnv = {} } = opts
  const env: Record<string, string> = {
    PATH: SYSTEM_BIN,
    HOME: process.env.HOME ?? '/tmp',
    TERM: 'dumb',
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    ...extraEnv,
  }
  const proc = Bun.spawn({
    cmd: ['bash', scriptPath],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

// ===========================================================================
// Test 1 — hooks.json shape (L3)
// ===========================================================================
describe('hooks.json', () => {
  test('parses and declares a Claude-only SessionStart command hook', async () => {
    const raw = await readFile(HOOKS_JSON, 'utf8')
    const parsed = JSON.parse(raw) as {
      hooks: {
        SessionStart: Array<{
          matcher: string
          hooks: Array<{ type: string; command: string }>
        }>
      }
    }

    const entry = parsed.hooks.SessionStart[0]
    expect(entry.matcher).toBe('startup|clear|compact')

    const command = entry.hooks[0].command
    expect(entry.hooks[0].type).toBe('command')
    expect(command).toContain('bash')
    expect(command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/session-start')
    // L3 — no polyglot launcher.
    expect(command).not.toContain('run-hook.cmd')
    // F2 — the command degrades silently at the invocation layer.
    expect(command).toContain('2>/dev/null')
    expect(command).toContain('|| true')
  })

  // F2 — the hooks.json command itself must degrade silently in ALL cases,
  // including before the script's own guards run. If CLAUDE_PLUGIN_ROOT is
  // unset the path collapses to /hooks/session-start and bash exits 127; the
  // `2>/dev/null || true` swallow must turn that into exit 0 with no output.
  test('command degrades silently (exit 0) when CLAUDE_PLUGIN_ROOT is unset', async () => {
    const raw = await readFile(HOOKS_JSON, 'utf8')
    const parsed = JSON.parse(raw) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    }
    const command = parsed.hooks.SessionStart[0]!.hooks[0]!.command

    // Run the exact command string through a shell, with CLAUDE_PLUGIN_ROOT
    // explicitly UNSET (env replaced, not inherited).
    const proc = Bun.spawn({
      cmd: ['sh', '-c', command],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: SYSTEM_BIN, HOME: process.env.HOME ?? '/tmp', TERM: 'dumb' },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr).toBe('')
  })
})

// ===========================================================================
// Test 2 — session-start emits valid Claude-only JSON (L1, L3, L5)
// ===========================================================================
describe('session-start emits valid Claude JSON', () => {
  test('emits hookSpecificOutput.additionalContext with the router card, Claude-only', async () => {
    const result = await runSessionStart({ pluginRoot: PLUGIN_ROOT })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>

    // Claude-only branch — only the nested shape is present.
    const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined
    expect(hso).toBeDefined()
    expect(hso!.hookEventName).toBe('SessionStart')
    const additionalContext = hso!.additionalContext as string
    expect(typeof additionalContext).toBe('string')
    expect(additionalContext.length).toBeGreaterThan(0)

    // L3 — no Cursor (snake_case) and no top-level (SDK-standard) keys.
    expect(parsed.additional_context).toBeUndefined()
    expect(parsed.additionalContext).toBeUndefined()
    expect('additional_context' in parsed).toBe(false)
    expect('additionalContext' in parsed).toBe(false)

    // Card content markers.
    expect(additionalContext).toContain('<!-- code-oz-router v1 -->')
    // L1 — engine-first wording.
    expect(additionalContext).toContain('The engine, not the host')
    expect(additionalContext).toContain('owns')
    // L1 — tightened trigger.
    expect(additionalContext).toContain('production-bound, CI/release, or shared')
    // Subagent-skip line.
    expect(additionalContext).toContain('dispatched as a subagent')
    // L5 — idempotence hint, not suppression.
    expect(additionalContext).toContain('idempotence hint')
  })
})

// ===========================================================================
// Test 3 — JSON escaping survives edge chars (backticks, quotes, arrows, NL)
// ===========================================================================
describe('JSON escaping is correct', () => {
  test('emitted JSON parses even though the card contains backticks, quotes, arrows, and newlines', async () => {
    const cardRaw = await readFile(ROUTER_CARD, 'utf8')
    // Sanity: the card actually contains the dangerous characters we claim to escape.
    expect(cardRaw).toContain('`') // backtick
    expect(cardRaw).toContain('->') // arrow
    expect(cardRaw).toContain('\n') // newline

    const result = await runSessionStart({ pluginRoot: PLUGIN_ROOT })
    expect(result.exitCode).toBe(0)

    // JSON.parse is the oracle: if escaping were wrong, this throws.
    let parsed: Record<string, unknown> | undefined
    expect(() => {
      parsed = JSON.parse(result.stdout) as Record<string, unknown>
    }).not.toThrow()

    const hso = parsed!.hookSpecificOutput as Record<string, unknown>
    const additionalContext = hso.additionalContext as string
    // The decoded card preserves a literal backtick and arrow (escaping was a
    // round-trip, not a deletion).
    expect(additionalContext).toContain('`code-oz run`')
    expect(additionalContext).toContain('->')
  })

  // F4(a) — exercise the risky escaping paths the real card never hits. A
  // synthetic card carries every JSON-forbidden / special character: double
  // quote, backslash, tab, CR, backspace (0x08), form feed (0x0c), ESC (0x1b),
  // backticks, and an arrow. The decoded additionalContext must round-trip
  // byte-for-byte equal to the synthetic input. This proves F3 (complete C0
  // escaping incl. \b, \f, and the generic \u00XX sweep).
  test('synthetic edge-char card round-trips exactly through escaping', async () => {
    const tempPlugin = await mkdtemp(join(tmpdir(), 'code-oz-router-hook-edge-'))
    tempDirs.push(tempPlugin)
    const tempHooks = join(tempPlugin, 'hooks')
    await mkdir(tempHooks, { recursive: true })
    const tempScript = join(tempHooks, 'session-start')
    await copyFile(SESSION_START, tempScript)
    await chmod(tempScript, 0o755)

    // Edge chars: quote " backslash \ tab \t CR \r BS 0x08 FF 0x0c ESC 0x1b
    // backticks ` arrow ->. No NUL (0x00): it cannot survive a shell variable.
    const synthetic = [
      'quote " end',
      'backslash \\ end',
      'tab \t end',
      'cr \r end',
      'bs \b end',
      'ff \f end',
      'esc \x1b end',
      'tick `code-oz run` tick',
      'arrow -> end',
    ].join('\n')
    await writeFile(join(tempHooks, 'router-card.md'), synthetic, 'utf8')

    const result = await runSessionStart({
      scriptPath: tempScript,
      pluginRoot: tempPlugin,
    })
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    const hso = parsed.hookSpecificOutput as Record<string, unknown>
    const decoded = hso.additionalContext as string

    // Byte-for-byte round-trip.
    expect(decoded).toBe(synthetic)
  })
})

// ===========================================================================
// Test 4 — degrade silently when the card is missing
// ===========================================================================
describe('degrade silently', () => {
  test('exits 0 and does not crash when router-card.md is absent', async () => {
    // Build a temp plugin layout with the script but no card.
    const tempPlugin = await mkdtemp(join(tmpdir(), 'code-oz-router-hook-test-'))
    tempDirs.push(tempPlugin)
    const tempHooks = join(tempPlugin, 'hooks')
    await mkdir(tempHooks, { recursive: true })
    const tempScript = join(tempHooks, 'session-start')
    await copyFile(SESSION_START, tempScript)
    await chmod(tempScript, 0o755)
    // Deliberately do NOT copy router-card.md.

    const result = await runSessionStart({
      scriptPath: tempScript,
      pluginRoot: tempPlugin,
    })

    // F4(b) — strict silent degrade: exit 0, emit NOTHING, leak NO error. The
    // script's guard exits before any output, so stdout and stderr are empty.
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toBe('')
  })
})

// ===========================================================================
// Test 5 — router-card.md content + no coercion
// ===========================================================================
describe('router-card.md content', () => {
  test('is within the token budget, contains required phrases, and avoids coercion', async () => {
    const card = await readFile(ROUTER_CARD, 'utf8')

    // Generous char budget (~1500 tokens).
    expect(card.length).toBeLessThan(6000)

    // Required phrases.
    expect(card).toContain('<!-- code-oz-router v1 -->')
    expect(card).toContain('The engine, not the host')
    expect(card).toContain('production-bound, CI/release, or shared')
    expect(card).toContain('dispatched as a subagent')
    expect(card).toContain('idempotence hint')
    expect(card).toContain('code-oz run')
    expect(card).toContain('code-oz doctor')

    // No coercive language.
    expect(card).not.toContain('1%')
    expect(card).not.toContain('no choice')
    expect(card.toUpperCase()).not.toContain('YOU DO NOT HAVE A CHOICE')
    expect(card).not.toMatch(/\bMUST ALWAYS\b/)

    // Rule 20 — D1a is engine-routing only; the card must instruct the host to
    // NEVER write under .code-oz/ (the engine owns it), not to write there.
    expect(card).toContain('never write under `.code-oz/`')
  })
})

// ===========================================================================
// Test 6 — host-exec-manifest.json rule-9 shape
// ===========================================================================
describe('host-exec-manifest.json', () => {
  test('parses and declares all rule-9 fields for the hook script', async () => {
    const raw = await readFile(HOST_EXEC_MANIFEST, 'utf8')
    const m = JSON.parse(raw) as {
      script: string
      command: string[]
      interpreter: string
      cwd: string
      file_roots: { read: string[]; write: string[]; default: string }
      network: string
      env: { allow: string[]; inherit: boolean }
      timeout: number
      timeout_seconds?: number
      output_caps: { stdout_bytes: number; stderr_bytes: number }
      enforcement: string
    }

    // command argv matches the hooks.json invocation: bash + session-start.
    expect(Array.isArray(m.command)).toBe(true)
    expect(m.command[0]).toBe('bash')
    expect(m.command.join(' ')).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/session-start')

    expect(m.interpreter).toBe('bash')
    expect(m.cwd).toBe('${CLAUDE_PLUGIN_ROOT}')

    // F5 — script path is consistent with cwd (${CLAUDE_PLUGIN_ROOT}); the real
    // script lives under ./hooks/session-start.
    expect(m.script).toBe('./hooks/session-start')

    expect(m.file_roots.read).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(m.file_roots.write).toEqual([])
    expect(m.file_roots.default).toBe('none')

    expect(m.network).toBe('deny')

    expect(Array.isArray(m.env.allow)).toBe(true)
    expect(m.env.allow).toContain('CLAUDE_PLUGIN_ROOT')
    expect(m.env.inherit).toBe(false)

    // F1 — rule-9 field name is `timeout` (seconds), not `timeout_seconds`.
    expect(typeof m.timeout).toBe('number')
    expect(m.timeout).toBeGreaterThan(0)
    expect('timeout_seconds' in m).toBe(false)

    expect(m.output_caps.stdout_bytes).toBeGreaterThan(0)
    expect(m.output_caps.stderr_bytes).toBeGreaterThan(0)

    expect(m.enforcement).toBe('declaration')
  })
})
