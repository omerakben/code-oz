import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO_ROOT, 'scripts/release/fresh-clone-smoke.sh')

async function runScript(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bash', SCRIPT, ...args],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      TERM: 'dumb',
    },
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { exitCode, stdout, stderr }
}

describe('scripts/release/fresh-clone-smoke.sh', () => {
  test('--help exits before cloning or running the smoke flow', async () => {
    const result = await runScript(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: scripts/release/fresh-clone-smoke.sh')
    expect(result.stdout).toContain('fresh clone')
    expect(result.stdout).not.toContain('=== 1/6')
    expect(result.stderr).toBe('')
  })

  test('unknown arguments fail before cloning', async () => {
    const result = await runScript(['--wat'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown argument: --wat')
    expect(result.stderr).toContain('Usage: scripts/release/fresh-clone-smoke.sh')
  })

  test('Bun summary parser matches whole summary fields, not substrings like 3815 pass', async () => {
    const text = await readFile(SCRIPT, 'utf8')

    expect(text).toContain('$2 == "pass"')
    expect(text).toContain('$2 == "fail"')
    expect(text).not.toContain("grep -oE '[0-9]+ fail'")
  })
})
