import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseUserTurnsFromTranscript, writeInterruptStopGate } from '../src/commands/run.ts'
import { initProject } from '../src/commands/init.ts'
import { generateUlid } from '../src/state/schemas.ts'
import { runPathsFor } from '../src/state/run.ts'

const REPO_ROOT = process.cwd()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

describe('parseUserTurnsFromTranscript', () => {
  test('extracts user turns from comment-delimited blocks in file order', () => {
    const raw = `---
persona: ba
---

<!-- turn:user -->
First request.
<!-- /turn -->

<!-- turn:ba -->
A question?
<!-- /turn -->

<!-- turn:user -->
Second reply.
<!-- /turn -->
`
    const turns = parseUserTurnsFromTranscript(raw)
    expect(turns.length).toBe(2)
    expect(turns[0]).toBe('First request.')
    expect(turns[1]).toBe('Second reply.')
  })

  test('ignores ba turn blocks', () => {
    const raw = `<!-- turn:ba -->only ba<!-- /turn -->`
    expect(parseUserTurnsFromTranscript(raw).length).toBe(0)
  })

  test('returns empty array for a transcript with no user blocks', () => {
    expect(parseUserTurnsFromTranscript('# preamble only').length).toBe(0)
  })

  test('trims surrounding whitespace inside each block', () => {
    const raw = `<!-- turn:user -->\n\n   leading + trailing\n   \n<!-- /turn -->`
    const turns = parseUserTurnsFromTranscript(raw)
    expect(turns).toEqual(['leading + trailing'])
  })

  test('skips empty blocks (whitespace-only body)', () => {
    const raw = `<!-- turn:user -->\n  \n<!-- /turn -->\n<!-- turn:user -->\nreal\n<!-- /turn -->`
    const turns = parseUserTurnsFromTranscript(raw)
    expect(turns).toEqual(['real'])
  })

  test('tolerates whitespace variations inside the comment markers', () => {
    const raw = `<!--   turn:user  -->one<!--   /turn   --><!-- turn:user -->two<!-- /turn -->`
    const turns = parseUserTurnsFromTranscript(raw)
    expect(turns).toEqual(['one', 'two'])
  })

  test('returns a frozen array', () => {
    const turns = parseUserTurnsFromTranscript('<!-- turn:user -->a<!-- /turn -->')
    expect(Object.isFrozen(turns)).toBe(true)
  })
})

// --- subprocess assertions (CLI-level) -----------------------------

interface SubprocResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function runSubprocess(
  args: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string | undefined>> = {},
): Promise<SubprocResult> {
  return runCliSubprocess(['run', ...args], cwd, extraEnv)
}

async function runCliSubprocess(
  args: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string | undefined>> = {},
): Promise<SubprocResult> {
  const proc = Bun.spawn({
    cmd: [process.execPath, 'run', CLI_ENTRY, ...args],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0', ...extraEnv },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe('code-oz run — argument validation', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-run-cli-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('exits 2 with help-friendly error on unknown argument', async () => {
    const r = await runSubprocess(['--bogus'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('unknown argument')
  })

  test('exits 2 when --request and --request-file are both supplied', async () => {
    await mkdir(join(tmp, '.code-oz'), { recursive: true })
    const r = await runSubprocess(
      ['--request', 'go', '--request-file', '/tmp/ignored'],
      tmp,
    )
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('mutually exclusive')
  })

  test('exits 2 when --request value is empty string', async () => {
    await mkdir(join(tmp, '.code-oz'), { recursive: true })
    const r = await runSubprocess(['--request', '   '], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('non-empty')
  })

  test('exits 2 when .code-oz/ is missing', async () => {
    const r = await runSubprocess(['--request', 'hi'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('.code-oz/')
    expect(r.stderr).toContain('code-oz init')
  })

  test('exits 2 when --request-file path does not exist', async () => {
    await mkdir(join(tmp, '.code-oz'), { recursive: true })
    const r = await runSubprocess(['--request-file', join(tmp, 'missing.md')], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('does not exist')
  })

  test('--help prints usage and exits 0', async () => {
    const r = await runSubprocess(['--help'], tmp)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Usage: code-oz run')
    expect(r.stdout).toContain('--request')
    expect(r.stdout).toContain('--request-file')
  })

  test('prints a deprecation hint for old effort aliases', async () => {
    const r = await runSubprocess(['--request', 'hi', '--effort', 'low'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('--effort low is deprecated')
    expect(r.stderr).toContain('--effort lite')
  })

  test('defaults to the first-run fake fixture when required provider CLIs are unavailable', async () => {
    await initProject({ cwd: tmp })
    const emptyPath = await mkdtemp(join(tmpdir(), 'code-oz-empty-path-'))

    const r = await runSubprocess(
      ['--request', 'run the first-run smoke'],
      tmp,
      {
        PATH: emptyPath,
        HOME: join(tmp, 'fresh-home'),
        XAI_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
      },
    )

    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('DEFINE phase complete')
    expect(r.stderr).toContain('--provider fake is active')
  })

  test('code-oz resume is an explicit alias for run --resume', async () => {
    await initProject({ cwd: tmp })
    const r = await runCliSubprocess(['resume'], tmp)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('no active run to resume')
  })
})

describe('code-oz run — interrupt gate', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'code-oz-run-interrupt-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('writes STOP.json for Ctrl-C interrupts', async () => {
    const runId = generateUlid()
    const paths = runPathsFor(join(tmp, 'state'), join(tmp, 'artifacts'), runId)
    await mkdir(paths.runDir, { recursive: true })

    await writeInterruptStopGate(paths, runId, 'SIGINT', () => '2026-05-13T10:00:00.000Z')

    const stop = JSON.parse(await readFile(join(paths.runDir, 'STOP.json'), 'utf8')) as {
      runId?: string
      reason?: string
      createdAt?: string
    }
    expect(stop.runId).toBe(runId)
    expect(stop.reason).toContain('SIGINT')
    expect(stop.createdAt).toBe('2026-05-13T10:00:00.000Z')
  })

  test('writes STOP.json for SIGTERM interrupts in a subprocess', async () => {
    const runId = generateUlid()
    const paths = runPathsFor(join(tmp, 'state'), join(tmp, 'artifacts'), runId)
    await mkdir(paths.runDir, { recursive: true })

    const script = `
      import { installInterruptStopGate } from ${JSON.stringify(join(REPO_ROOT, 'src/commands/run.ts'))};
      const runPaths = ${JSON.stringify(paths)};
      installInterruptStopGate(runPaths, ${JSON.stringify(runId)});
      console.log('ready');
      setInterval(() => {}, 1000);
    `
    const proc = Bun.spawn({
      cmd: ['bun', '--eval', script],
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
    const stdoutReader = proc.stdout.getReader()
    let ready = ''
    while (!ready.includes('ready')) {
      const chunk = await stdoutReader.read()
      if (chunk.done) break
      ready += new TextDecoder().decode(chunk.value)
    }

    proc.kill('SIGTERM')
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toBe('')
    expect(exitCode).toBe(143)

    const stop = JSON.parse(await readFile(join(paths.runDir, 'STOP.json'), 'utf8')) as {
      runId?: string
      reason?: string
    }
    expect(stop.runId).toBe(runId)
    expect(stop.reason).toContain('SIGTERM')
  })
})
