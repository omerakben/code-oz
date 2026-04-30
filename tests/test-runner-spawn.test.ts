import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runValidationCommand } from '../src/tools/test-runner.ts'

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures/test-runner')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeoz-runner-spawn-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('runValidationCommand — spawn / happy path', () => {
  test('zero-exit: terminationReason=exit, exitCode=0, durationMs ≥ 0', async () => {
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/exit-with.ts 0`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })

    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.truncated.stdout).toBe(false)
    expect(result.truncated.stderr).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.stdoutBytes).toBe(0)
    expect(result.stderrBytes).toBe(0)
  })

  test('captures stdout and stderr and writes to forensics paths', async () => {
    const stdoutPath = join(workDir, 'stdout.log')
    const stderrPath = join(workDir, 'stderr.log')
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/print-and-exit.ts`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: stdoutPath,
      stderrLogPath: stderrPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })

    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(0)
    expect(result.stdoutBytes).toBe('hello-from-stdout\n'.length)
    expect(result.stderrBytes).toBe('hello-from-stderr\n'.length)

    const stdoutContents = await readFile(stdoutPath, 'utf8')
    const stderrContents = await readFile(stderrPath, 'utf8')
    expect(stdoutContents).toBe('hello-from-stdout\n')
    expect(stderrContents).toBe('hello-from-stderr\n')
  })

  test('truncates log files on each call (write+truncate semantics)', async () => {
    const stdoutPath = join(workDir, 'stdout.log')
    const stderrPath = join(workDir, 'stderr.log')

    await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/print-and-exit.ts`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: stdoutPath,
      stderrLogPath: stderrPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    // Second invocation against the same paths must overwrite, not append.
    const second = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/exit-with.ts 0`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: stdoutPath,
      stderrLogPath: stderrPath,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })

    expect(second.stdoutBytes).toBe(0)
    const stdoutContents = await readFile(stdoutPath, 'utf8')
    expect(stdoutContents).toBe('')
  })

  test('result is frozen', async () => {
    const result = await runValidationCommand({
      command: `bun ${FIXTURES_DIR}/exit-with.ts 0`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.truncated)).toBe(true)
  })
})
