import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runValidationCommand } from '../src/tools/test-runner.ts'

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures/test-runner')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeoz-runner-timeout-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('runValidationCommand — timeout', () => {
  test('sleep-forever fixture is killed by 200ms timeout', async () => {
    const start = Date.now()
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/sleep-forever.ts`,
      cwd: workDir,
      timeoutMs: 200,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    const elapsed = Date.now() - start

    expect(result.terminationReason).toBe('timeout')
    expect(result.timedOut).toBe(true)
    expect(result.truncated.stdout).toBe(false)
    expect(result.truncated.stderr).toBe(false)
    // Wall-clock should not greatly exceed the timeout. 200ms target with
    // generous 5s upper bound covers slow CI without making the test
    // useless. Lower bound 150ms allows some scheduler slop without being
    // flaky.
    expect(elapsed).toBeGreaterThanOrEqual(150)
    expect(elapsed).toBeLessThan(5_000)
    expect(result.durationMs).toBeGreaterThanOrEqual(150)
  })

  test('forensics log files exist (possibly empty) after timeout', async () => {
    const stdoutPath = join(workDir, 'stdout.log')
    const stderrPath = join(workDir, 'stderr.log')
    await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/sleep-forever.ts`,
      cwd: workDir,
      timeoutMs: 150,
      stdoutLogPath: stdoutPath,
      stderrLogPath: stderrPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    // Both files should exist; the timeout discipline preserves forensics
    // even when the child wrote nothing.
    const stdoutStat = await stat(stdoutPath)
    const stderrStat = await stat(stderrPath)
    expect(stdoutStat.isFile()).toBe(true)
    expect(stderrStat.isFile()).toBe(true)
  })

  test('terminationReason=timeout takes priority over any cap state', async () => {
    // A program that prints nothing then sleeps — if any cap fired we'd
    // see a 'cap' termination, but we should see 'timeout' since nothing
    // was written.
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/sleep-forever.ts`,
      cwd: workDir,
      timeoutMs: 100,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 8,
      maxStderrBytes: 8,
    })
    expect(result.terminationReason).toBe('timeout')
    expect(result.truncated.stdout).toBe(false)
    expect(result.truncated.stderr).toBe(false)
  })
})
