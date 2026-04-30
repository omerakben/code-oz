import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseUserTurnsFromTranscript } from '../src/commands/run.ts'

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
})
