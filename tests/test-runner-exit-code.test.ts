import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runValidationCommand } from '../src/tools/test-runner.ts'

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures/test-runner')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeoz-runner-exit-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function runExitCode(code: number) {
  return runValidationCommand({
    command: `bun ${FIXTURES_DIR}/exit-with.ts ${code}`,
    cwd: workDir,
    timeoutMs: 10_000,
    stdoutLogPath: join(workDir, 'stdout.log'),
    stderrLogPath: join(workDir, 'stderr.log'),
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
  })
}

describe('runValidationCommand — exit code propagation', () => {
  test('exit 1 surfaces as exitCode=1, terminationReason=exit', async () => {
    const result = await runExitCode(1)
    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(1)
    expect(result.timedOut).toBe(false)
    expect(result.truncated.stdout).toBe(false)
    expect(result.truncated.stderr).toBe(false)
  })

  test('exit 7 (arbitrary non-zero) surfaces as exitCode=7', async () => {
    const result = await runExitCode(7)
    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(7)
  })

  test('exit 42 (the answer)', async () => {
    const result = await runExitCode(42)
    expect(result.terminationReason).toBe('exit')
    expect(result.exitCode).toBe(42)
  })

  // The mutation-gate semantics (CODEX_RESPONSE_M8.md decision 11) require
  // that mutation pass only on terminationReason='exit' AND a non-expected
  // exit code. This test pair locks that distinction at the runner layer:
  // 'exit' + zero and 'exit' + non-zero must both be reachable; the gate
  // logic compares against expectedExitCode in a layer above this one.
  test('zero and non-zero both classify as terminationReason=exit', async () => {
    const zero = await runExitCode(0)
    const nonzero = await runExitCode(3)
    expect(zero.terminationReason).toBe('exit')
    expect(nonzero.terminationReason).toBe('exit')
    expect(zero.exitCode).toBe(0)
    expect(nonzero.exitCode).toBe(3)
  })
})
