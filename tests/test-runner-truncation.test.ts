import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runValidationCommand } from '../src/tools/test-runner.ts'

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures/test-runner')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeoz-runner-trunc-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('runValidationCommand — stdout cap', () => {
  test('5 MiB output with 1 KiB cap → terminationReason=stdout-cap, child killed', async () => {
    const stdoutPath = join(workDir, 'stdout.log')
    const result = await runValidationCommand({
      // 5120 KiB = 5 MiB of `a`. Cap kicks in after 1024 bytes.
      command: `bun ${FIXTURES_DIR}/spam-stdout.ts 5120`,
      cwd: workDir,
      timeoutMs: 30_000,
      stdoutLogPath: stdoutPath,
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1024,
      maxStderrBytes: 1_048_576,
    })

    expect(result.terminationReason).toBe('stdout-cap')
    expect(result.truncated.stdout).toBe(true)
    expect(result.truncated.stderr).toBe(false)
    expect(result.stdoutBytes).toBe(1024)
    expect(result.timedOut).toBe(false)

    // Log file should contain exactly the cap-bound prefix.
    const logged = await readFile(stdoutPath, 'utf8')
    expect(logged.length).toBe(1024)
    expect(logged).toBe('a'.repeat(1024))
  })

  test('output below cap → no truncation, terminationReason=exit', async () => {
    const stdoutPath = join(workDir, 'stdout.log')
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/spam-stdout.ts 1`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: stdoutPath,
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    expect(result.terminationReason).toBe('exit')
    expect(result.truncated.stdout).toBe(false)
    expect(result.stdoutBytes).toBe(1024)
  })
})

describe('runValidationCommand — stderr cap', () => {
  test('5 MiB stderr with 1 KiB cap → terminationReason=stderr-cap', async () => {
    const stderrPath = join(workDir, 'stderr.log')
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/spam-stderr.ts 5120`,
      cwd: workDir,
      timeoutMs: 30_000,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: stderrPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1024,
    })

    expect(result.terminationReason).toBe('stderr-cap')
    expect(result.truncated.stderr).toBe(true)
    expect(result.truncated.stdout).toBe(false)
    expect(result.stderrBytes).toBe(1024)

    const logged = await readFile(stderrPath, 'utf8')
    expect(logged.length).toBe(1024)
    expect(logged).toBe('b'.repeat(1024))
  })
})
