// C2 — bootstrap resolver tests.
//
// The script plugins/code-oz/scripts/resolve-code-oz.sh is a thin launcher
// that resolves the code-oz engine via four branches (priority order):
//   1. Windows rejection (uname-detected or CODE_OZ_FAKE_UNAME override)
//   2. code-oz found on PATH  -> exec binary directly
//   3. npx found on PATH      -> exec npx -y @tuel/code-oz@<pinned> <args>
//      - npx exits non-zero   -> print scope-routing caveat on stderr
//   4. neither present        -> hard-stop with install message
//
// All tests run offline, deterministic, and in isolated temp dirs.
// Fake executables replace real PATH entries; CODE_OZ_FAKE_UNAME overrides
// the uname call for Windows-branch reachability on macOS.
//
// macOS note: BSD mktemp ignores TMPDIR, so we capture mkdtemp output
// directly rather than relying on TMPDIR env override.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()

const SCRIPT = join(REPO_ROOT, 'plugins/code-oz/scripts/resolve-code-oz.sh')
const PLUGIN_JSON = join(REPO_ROOT, 'plugins/code-oz/.claude-plugin/plugin.json')

// Minimum PATH needed for the script itself (bash builtins + uname + dirname).
// We include /usr/bin and /bin so that uname, dirname, grep, sed etc. are
// available. We do NOT include the real npx or code-oz paths.
const SYSTEM_BIN = '/usr/bin:/bin'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// ---------------------------------------------------------------------------
// Helper: create an isolated temp dir containing named fake executables.
// Each fake is a shell script whose body is provided.
// Returns the temp dir path.
// ---------------------------------------------------------------------------
async function makeFakeBinDir(
  fakes: Record<string, string>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-oz-resolver-test-'))
  tempDirs.push(dir)
  for (const [name, body] of Object.entries(fakes)) {
    const p = join(dir, name)
    await writeFile(p, body, 'utf8')
    await chmod(p, 0o755)
  }
  return dir
}

// ---------------------------------------------------------------------------
// Helper: spawn the resolver script with a controlled environment.
// env.PATH replaces the real PATH entirely.
// ---------------------------------------------------------------------------
async function runResolver(opts: {
  path: string
  args?: string[]
  extraEnv?: Record<string, string>
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { path, args = ['run'], extraEnv = {} } = opts
  // Build a clean env: only PATH, HOME (bash needs it), TERM, and any extras.
  const env: Record<string, string> = {
    PATH: path,
    HOME: process.env.HOME ?? '/tmp',
    TERM: 'dumb',
    ...extraEnv,
  }
  const proc = Bun.spawn({
    cmd: ['bash', SCRIPT, ...args],
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

// ---------------------------------------------------------------------------
// Read the pinned version from plugin.json so tests stay in sync.
// ---------------------------------------------------------------------------
async function readPinnedVersion(): Promise<string> {
  const raw = await Bun.file(PLUGIN_JSON).text()
  const match = raw.match(/"version"\s*:\s*"([^"]+)"/)
  if (!match) throw new Error('could not parse version from plugin.json')
  return match[1]!
}

// ===========================================================================
// Tests
// ===========================================================================

describe('resolve-code-oz.sh — PATH binary present', () => {
  test('execs the real binary when code-oz is on PATH, forwarding args', async () => {
    const marker = 'FAKE_CODE_OZ_MARKER'
    const fakeDir = await makeFakeBinDir({
      'code-oz': `#!/bin/sh\nprintf '%s' '${marker}'\nfor a in "$@"; do printf ' %s' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['run', '--provider', 'fake'],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(marker)
    expect(result.stdout).toContain('run')
    expect(result.stdout).toContain('--provider')
    expect(result.stdout).toContain('fake')
  })

  test('strips an empty-string positional before exec (no-args plugin card artifact)', async () => {
    // A plugin command card renders `<subcommand> "$ARGUMENTS"`. With no user
    // arguments Claude Code substitutes an empty $ARGUMENTS, leaving a literal
    // `doctor ""`. The empty positional must not reach the engine, whose 0.21.1
    // subcommand dispatcher rejects '' as an unknown subcommand. The fake wraps
    // each forwarded arg in brackets, so an empty arg would appear as `[]`.
    const fakeDir = await makeFakeBinDir({
      'code-oz': `#!/bin/sh\nprintf 'ARGS:'\nfor a in "$@"; do printf '[%s]' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['doctor', ''],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[doctor]')
    expect(result.stdout).not.toContain('[]')
  })

  test('preserves a non-empty positional that contains spaces', async () => {
    // The empty-arg filter must not word-split or drop legitimate args.
    const fakeDir = await makeFakeBinDir({
      'code-oz': `#!/bin/sh\nprintf 'ARGS:'\nfor a in "$@"; do printf '[%s]' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['run', 'fix the login bug'],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[run]')
    expect(result.stdout).toContain('[fix the login bug]')
  })
})

describe('resolve-code-oz.sh — npx fallback', () => {
  test('calls npx with pinned @tuel/code-oz version and forwards args when code-oz absent', async () => {
    const pinnedVersion = await readPinnedVersion()
    const marker = 'FAKE_NPX_MARKER'
    // Fake npx that prints a marker then echoes all args and exits 0.
    const fakeDir = await makeFakeBinDir({
      npx: `#!/bin/sh\nprintf '%s' '${marker}'\nfor a in "$@"; do printf ' %s' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['doctor'],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(marker)
    // npx must be called with -y @tuel/code-oz@<version>
    expect(result.stdout).toContain(`-y`)
    expect(result.stdout).toContain(`@tuel/code-oz@${pinnedVersion}`)
    // The subcommand must be forwarded
    expect(result.stdout).toContain('doctor')
  })

  test('pinned version in npx call matches plugin.json (not a hardcoded literal)', async () => {
    const pinnedVersion = await readPinnedVersion()
    // Verify pinnedVersion looks like a semver pre-release, not empty
    expect(pinnedVersion).toMatch(/^\d+\.\d+\.\d+/)

    const fakeDir = await makeFakeBinDir({
      npx: `#!/bin/sh\nprintf 'npx_called'\nfor a in "$@"; do printf ' %s' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['init'],
    })

    expect(result.exitCode).toBe(0)
    // The exact pinned version string must appear in the npx invocation
    expect(result.stdout).toContain(pinnedVersion)
  })

  test('strips an empty-string positional before the npx invocation too', async () => {
    const fakeDir = await makeFakeBinDir({
      npx: `#!/bin/sh\nprintf 'ARGS:'\nfor a in "$@"; do printf '[%s]' "$a"; done\nprintf '\\n'\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['doctor', ''],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[doctor]')
    expect(result.stdout).not.toContain('[]')
  })
})

describe('resolve-code-oz.sh — npx failure surfaces scope-routing caveat', () => {
  test('prints Homebrew / @tuel:registry guidance on stderr and exits non-zero when npx fails', async () => {
    const fakeDir = await makeFakeBinDir({
      // fake npx that always exits 1 (simulates npm registry 404)
      npx: `#!/bin/sh\nprintf 'npm ERR! 404\n' >&2\nexit 1\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['run'],
    })

    expect(result.exitCode).not.toBe(0)
    // Must mention the scope-routing caveat
    expect(result.stderr).toMatch(/@tuel/)
    // Must suggest Homebrew as an alternative
    expect(result.stderr).toMatch(/[Hh]omebrew|brew/)
    // The Homebrew hint must use the real tap (brew resolves omerakben/code-oz
    // to github.com/omerakben/homebrew-code-oz), not the nonexistent
    // omerakben/homebrew-tap that omerakben/tap/code-oz would target.
    expect(result.stderr).toContain('omerakben/code-oz/code-oz')
    expect(result.stderr).not.toContain('omerakben/tap/code-oz')
    // Must mention the registry workaround
    expect(result.stderr).toMatch(/@tuel:registry/)
  })
})

describe('resolve-code-oz.sh — hard-stop (no code-oz, no npm/npx)', () => {
  test('exits non-zero and prints install instructions when neither code-oz nor npx is available', async () => {
    // PATH contains only bare system utils, no code-oz, no npx, no npm
    const emptyBinDir = await makeFakeBinDir({})

    const result = await runResolver({
      path: `${emptyBinDir}:${SYSTEM_BIN}`,
      args: ['run'],
    })

    expect(result.exitCode).not.toBe(0)
    // Must mention npm install as one option
    expect(result.stdout + result.stderr).toMatch(/npm/)
    // Must mention the package name
    expect(result.stdout + result.stderr).toMatch(/@tuel\/code-oz/)
    // Must mention brew as alternative, with the correct tap form.
    expect(result.stdout + result.stderr).toMatch(/brew/)
    expect(result.stdout + result.stderr).toContain('omerakben/code-oz/code-oz')
    expect(result.stdout + result.stderr).not.toContain('omerakben/tap/code-oz')
  })
})

describe('resolve-code-oz.sh — npx exit-code propagation', () => {
  test('propagates the exact exit code from a failing npx (not just non-zero)', async () => {
    // Fake npx that exits with a distinctive code (42) to verify exact propagation.
    const fakeDir = await makeFakeBinDir({
      npx: `#!/bin/sh\nexit 42\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['run'],
    })

    expect(result.exitCode).toBe(42)
  })
})

describe('resolve-code-oz.sh — malformed plugin.json', () => {
  test('exits non-zero and prints "could not parse version" when plugin.json has no "version" key', async () => {
    // Build a temp dir that mirrors the expected script + plugin layout:
    //   <tmpDir>/scripts/resolve-code-oz.sh
    //   <tmpDir>/.claude-plugin/plugin.json   (malformed — no "version" key)
    const tmpBase = await mkdtemp(join(tmpdir(), 'code-oz-malformed-test-'))
    tempDirs.push(tmpBase)

    const scriptsDir = join(tmpBase, 'scripts')
    const pluginDir = join(tmpBase, '.claude-plugin')
    await mkdir(scriptsDir, { recursive: true })
    await mkdir(pluginDir, { recursive: true })

    // Copy the real script into the temp scripts dir so it uses the sibling plugin.json.
    const realScript = await Bun.file(SCRIPT).text()
    const scriptCopy = join(scriptsDir, 'resolve-code-oz.sh')
    await writeFile(scriptCopy, realScript, 'utf8')
    await chmod(scriptCopy, 0o755)

    // Write a plugin.json that is valid JSON but has no "version" key.
    await writeFile(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: 'code-oz', description: 'missing version field' }),
      'utf8',
    )

    const proc = Bun.spawn({
      cmd: ['bash', scriptCopy, 'run'],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PATH: SYSTEM_BIN,
        HOME: process.env.HOME ?? '/tmp',
        TERM: 'dumb',
      },
    })
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/could not parse version/)
  })
})

describe('resolve-code-oz.sh — Windows rejection', () => {
  test('exits non-zero and prints future milestone message when CODE_OZ_FAKE_UNAME is Windows-like', async () => {
    // No fake binary needed — Windows rejection fires before any PATH resolution.
    const result = await runResolver({
      path: SYSTEM_BIN,
      args: ['run'],
      extraEnv: { CODE_OZ_FAKE_UNAME: 'MINGW64_NT-10.0' },
    })

    expect(result.exitCode).not.toBe(0)
    // Must mention Windows
    expect(result.stdout + result.stderr).toMatch(/[Ww]indows/)
    // Must mention the support status without promising a stale version.
    expect(result.stdout + result.stderr).toMatch(/future distribution milestone/)
  })

  test('rejects before touching PATH when fake uname is MSYS variant', async () => {
    // Even if a fake code-oz is on PATH, Windows rejection must fire first.
    const fakeDir = await makeFakeBinDir({
      'code-oz': `#!/bin/sh\necho SHOULD_NOT_REACH_THIS\n`,
    })

    const result = await runResolver({
      path: `${fakeDir}:${SYSTEM_BIN}`,
      args: ['run'],
      extraEnv: { CODE_OZ_FAKE_UNAME: 'MSYS_NT-10.0-17763' },
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).not.toContain('SHOULD_NOT_REACH_THIS')
    expect(result.stdout + result.stderr).toMatch(/[Ww]indows/)
  })

  test('rejects for CYGWIN variant', async () => {
    const result = await runResolver({
      path: SYSTEM_BIN,
      args: ['run'],
      extraEnv: { CODE_OZ_FAKE_UNAME: 'CYGWIN_NT-10.0' },
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/[Ww]indows/)
  })
})
