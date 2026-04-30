import { describe, test, expect } from 'bun:test'
import {
  mutationStatusFromResult,
  type RunnerResultShape,
} from '../src/phases/verify-mutation.ts'

function res(over: Partial<RunnerResultShape>): RunnerResultShape {
  return {
    terminationReason: 'exit',
    exitCode: 0,
    durationMs: 100,
    truncated: { stdout: false, stderr: false },
    ...over,
  } as RunnerResultShape
}

describe('mutationStatusFromResult — pass path', () => {
  test('exit + non-expected exit code → pass', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'exit', exitCode: 1 }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('pass')
    expect(r.notes).toContain('reverted code failed')
    expect(r.notes).toContain('mutation gate satisfied')
  })

  test('exit code 7 vs expected 0 → pass', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'exit', exitCode: 7 }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('pass')
    expect(r.notes).toContain('exit 7')
  })
})

describe('mutationStatusFromResult — fail-tautological path', () => {
  test('exit + matching expected exit code → fail (tautological)', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'exit', exitCode: 0 }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('tautological')
  })
})

describe('mutationStatusFromResult — abnormal-termination path (Codex M8 decision 1)', () => {
  test('timeout → fail (cannot conclude)', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'timeout', exitCode: null, durationMs: 60_000 }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('timed out')
    expect(r.notes).toContain('60000')
  })

  test('stdout-cap → fail (cannot conclude)', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'stdout-cap', exitCode: null }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('stdout cap')
  })

  test('stderr-cap → fail (cannot conclude)', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'stderr-cap', exitCode: null }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('stderr cap')
  })

  test('spawn-error → fail (cannot conclude)', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'spawn-error', exitCode: null }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('failed to spawn')
  })

  test('exit + exitCode=null (anomalous) → fail', () => {
    const r = mutationStatusFromResult({
      result: res({ terminationReason: 'exit', exitCode: null }),
      expectedExitCode: 0,
    })
    expect(r.status).toBe('fail')
    expect(r.notes).toContain('null')
  })
})

describe('mutationStatusFromResult — frozen output', () => {
  test('result is frozen', () => {
    const r = mutationStatusFromResult({
      result: res({ exitCode: 1 }),
      expectedExitCode: 0,
    })
    expect(Object.isFrozen(r)).toBe(true)
  })
})
