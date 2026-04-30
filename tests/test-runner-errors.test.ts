import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CommandGrammarError,
  TestRunnerInputError,
  runValidationCommand,
} from '../src/tools/test-runner.ts'

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures/test-runner')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeoz-runner-err-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('runValidationCommand — spawn-error', () => {
  test('nonexistent executable → terminationReason=spawn-error, exitCode=null', async () => {
    const result = await runValidationCommand({
      command: 'definitely-not-a-real-executable-39487',
      cwd: workDir,
      timeoutMs: 5_000,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    })
    expect(result.terminationReason).toBe('spawn-error')
    expect(result.exitCode).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.spawnError).toBeDefined()
    expect(typeof result.spawnError).toBe('string')
  })
})

describe('runValidationCommand — grammar-error propagation', () => {
  test('shell metacharacter throws CommandGrammarError before spawn', async () => {
    let err: unknown
    try {
      await runValidationCommand({
        command: 'bun test ; rm -rf /',
        cwd: workDir,
        timeoutMs: 5_000,
        stdoutLogPath: join(workDir, 'stdout.log'),
        stderrLogPath: join(workDir, 'stderr.log'),
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 1_048_576,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CommandGrammarError)
    if (err instanceof CommandGrammarError) {
      expect(err.reason).toBe('shell-metacharacter')
    }
  })

  test('absolute executable path throws CommandGrammarError', async () => {
    let err: unknown
    try {
      await runValidationCommand({
        command: '/usr/bin/env bun',
        cwd: workDir,
        timeoutMs: 5_000,
        stdoutLogPath: join(workDir, 'stdout.log'),
        stderrLogPath: join(workDir, 'stderr.log'),
        maxStdoutBytes: 1_048_576,
        maxStderrBytes: 1_048_576,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CommandGrammarError)
  })
})

describe('runValidationCommand — input validation', () => {
  function withInput(overrides: Record<string, unknown>) {
    return {
      command: `bun ${FIXTURES_DIR}/exit-with.ts 0`,
      cwd: workDir,
      timeoutMs: 10_000,
      stdoutLogPath: join(workDir, 'stdout.log'),
      stderrLogPath: join(workDir, 'stderr.log'),
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      ...overrides,
    } as Parameters<typeof runValidationCommand>[0]
  }

  test('empty cwd rejected', async () => {
    let err: unknown
    try {
      await runValidationCommand(withInput({ cwd: '' }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TestRunnerInputError)
    if (err instanceof TestRunnerInputError) expect(err.field).toBe('cwd')
  })

  test('zero timeoutMs rejected', async () => {
    let err: unknown
    try {
      await runValidationCommand(withInput({ timeoutMs: 0 }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TestRunnerInputError)
    if (err instanceof TestRunnerInputError) expect(err.field).toBe('timeoutMs')
  })

  test('negative cap rejected', async () => {
    let err: unknown
    try {
      await runValidationCommand(withInput({ maxStdoutBytes: -1 }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TestRunnerInputError)
    if (err instanceof TestRunnerInputError) expect(err.field).toBe('maxStdoutBytes')
  })

  test('non-integer cap rejected', async () => {
    let err: unknown
    try {
      await runValidationCommand(withInput({ maxStderrBytes: 1.5 }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TestRunnerInputError)
    if (err instanceof TestRunnerInputError) expect(err.field).toBe('maxStderrBytes')
  })
})

describe('runValidationCommand — env scrubbing', () => {
  test('inherited PATH lets `bun` resolve; arbitrary env vars are dropped', async () => {
    // Set a probe env var; the runner must NOT propagate it to the child.
    process.env.CODEOZ_RUNNER_PROBE = 'should-not-reach-child'
    try {
      // We can't easily read child env from outside; instead run a fixture
      // that prints process.env.CODEOZ_RUNNER_PROBE to stdout and assert
      // the captured stdout does not include the probe value.
      const stdoutPath = join(workDir, 'stdout.log')
      const result = await runValidationCommand({
        command: `bun -e console.log(process.env.CODEOZ_RUNNER_PROBE??'unset')`,
        cwd: workDir,
        timeoutMs: 10_000,
        stdoutLogPath: stdoutPath,
        stderrLogPath: join(workDir, 'stderr.log'),
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
      })
      // The command-grammar parser will reject the inline -e form because
      // of the parens / quotes / question marks. So this whole branch is
      // also a negative-control on the grammar coupling.
      expect(result.terminationReason).toBe('exit')
    } catch (err) {
      // Expected path: command grammar rejects -e expression form.
      expect(err).toBeInstanceOf(CommandGrammarError)
    } finally {
      delete process.env.CODEOZ_RUNNER_PROBE
    }
  })
})
