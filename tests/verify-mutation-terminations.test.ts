import { describe, test, expect } from 'bun:test'
import {
  evaluateMutation,
  type ChangedFileEntry,
  type EvaluateMutationInput,
  type RevertSeam,
  type RunnerSeam,
  type RunnerResultShape,
} from '../src/phases/verify-mutation.ts'

const SHA = 'a'.repeat(64)
const BASE_SHA = 'b'.repeat(40)

function file(path: string, change: 'added' | 'modified' | 'deleted'): ChangedFileEntry {
  return { path, sha256: SHA, change }
}

interface SeamCalls {
  snapshotPaths: string[][]
  reverted: ChangedFileEntry[][]
  restored: number
  order: string[]
}

function makeSeam(): { seam: RevertSeam; calls: SeamCalls } {
  const calls: SeamCalls = { snapshotPaths: [], reverted: [], restored: 0, order: [] }
  const seam: RevertSeam = {
    async snapshot(paths) {
      calls.order.push('snapshot')
      calls.snapshotPaths.push([...paths])
      return { token: calls.snapshotPaths.length }
    },
    async revert(files, baseCommitSha) {
      calls.order.push('revert')
      calls.reverted.push([...files])
      expect(baseCommitSha).toBe(BASE_SHA)
    },
    async restore(_snapshot) {
      calls.order.push('restore')
      calls.restored++
    },
  }
  return { seam, calls }
}

function makeRunner(result: RunnerResultShape): { runner: RunnerSeam; invocations: number } {
  let invocations = 0
  const runner: RunnerSeam = async () => {
    invocations++
    return result
  }
  return { runner, get invocations() { return invocations } } as { runner: RunnerSeam; invocations: number }
}

function baseInput(over: Partial<EvaluateMutationInput>): EvaluateMutationInput {
  return {
    changedFiles: [
      file('tests/foo.test.ts', 'added'),
      file('src/foo.ts', 'modified'),
    ],
    baseCommitSha: BASE_SHA,
    command: 'bun test tests/foo.test.ts',
    cwd: '/tmp/worktree',
    timeoutMs: 60_000,
    expectedExitCode: 0,
    stdoutLogPath: '/tmp/forensics/1/stdout.log',
    stderrLogPath: '/tmp/forensics/1/stderr.log',
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    runner: async () => ({
      terminationReason: 'exit',
      exitCode: 1,
      durationMs: 100,
      truncated: { stdout: false, stderr: false },
    }),
    revertSeam: makeSeam().seam,
    ...over,
  }
}

describe('evaluateMutation — applicable + pass', () => {
  test('runner exit 1 ≠ expected 0 → pass; seams called in order snapshot→revert→restore', async () => {
    const { seam, calls } = makeSeam()
    const { runner, invocations: _ } = makeRunner({
      terminationReason: 'exit',
      exitCode: 1,
      durationMs: 50,
      truncated: { stdout: false, stderr: false },
    })
    const r = await evaluateMutation(baseInput({ runner, revertSeam: seam }))
    expect(r.status).toBe('pass')
    expect(calls.order).toEqual(['snapshot', 'revert', 'restore'])
    expect(calls.snapshotPaths[0]).toEqual(['src/foo.ts'])
    expect(calls.reverted[0]?.map((f) => f.path)).toEqual(['src/foo.ts'])
    expect(calls.restored).toBe(1)
  })
})

describe('evaluateMutation — applicable + fail (tautological)', () => {
  test('runner exit 0 === expected 0 → fail with tautological note', async () => {
    const { runner } = makeRunner({
      terminationReason: 'exit',
      exitCode: 0,
      durationMs: 50,
      truncated: { stdout: false, stderr: false },
    })
    const r = await evaluateMutation(baseInput({ runner }))
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('tautological')
  })
})

describe('evaluateMutation — applicable + abnormal terminations', () => {
  for (const reason of ['timeout', 'stdout-cap', 'stderr-cap', 'spawn-error'] as const) {
    test(`terminationReason=${reason} → fail`, async () => {
      const { runner } = makeRunner({
        terminationReason: reason,
        exitCode: null,
        durationMs: 60_000,
        truncated: { stdout: reason === 'stdout-cap', stderr: reason === 'stderr-cap' },
      })
      const r = await evaluateMutation(baseInput({ runner }))
      expect(r.status).toBe('fail')
    })
  }
})

describe('evaluateMutation — restore runs even on revert/replay error', () => {
  test('runner throws → restore still called', async () => {
    const { seam, calls } = makeSeam()
    const runner: RunnerSeam = async () => {
      throw new Error('runner exploded mid-replay')
    }
    let caught: unknown
    try {
      await evaluateMutation(baseInput({ runner, revertSeam: seam }))
    } catch (e) {
      caught = e
    }
    expect((caught as Error)?.message).toContain('runner exploded')
    expect(calls.order).toEqual(['snapshot', 'revert', 'restore'])
    expect(calls.restored).toBe(1)
  })
})

describe('evaluateMutation — not-applicable skip path', () => {
  test('no added test files → returns not-applicable WITHOUT invoking runner or seam', async () => {
    const { seam, calls } = makeSeam()
    let runnerInvocations = 0
    const runner: RunnerSeam = async () => {
      runnerInvocations++
      return {
        terminationReason: 'exit',
        exitCode: 0,
        durationMs: 1,
        truncated: { stdout: false, stderr: false },
      }
    }
    const r = await evaluateMutation(
      baseInput({
        runner,
        revertSeam: seam,
        changedFiles: [file('src/foo.ts', 'modified')],
      }),
    )
    expect(r.status).toBe('not-applicable')
    expect(calls.order).toEqual([])
    expect(runnerInvocations).toBe(0)
  })

  test('expectedExitCode != 0 → not-applicable, no runner invocation', async () => {
    const { seam, calls } = makeSeam()
    let runnerInvocations = 0
    const runner: RunnerSeam = async () => {
      runnerInvocations++
      return {
        terminationReason: 'exit',
        exitCode: 0,
        durationMs: 1,
        truncated: { stdout: false, stderr: false },
      }
    }
    const r = await evaluateMutation(
      baseInput({ runner, revertSeam: seam, expectedExitCode: 1 }),
    )
    expect(r.status).toBe('not-applicable')
    expect(runnerInvocations).toBe(0)
    expect(calls.order).toEqual([])
  })
})
