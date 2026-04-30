import { describe, test, expect } from 'bun:test'
import { isAbsolute, join } from 'node:path'
import {
  runPaths,
  patchFilePath,
  forensicsAttemptPath,
  buildDraftsAttemptPath,
} from '../src/worktree/paths.ts'

const CWD = '/abs/proj'
const RUN = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

describe('runPaths', () => {
  test('returns absolute paths for every field', () => {
    const p = runPaths(CWD, RUN)
    expect(isAbsolute(p.run)).toBe(true)
    expect(isAbsolute(p.worktree)).toBe(true)
    expect(isAbsolute(p.patches)).toBe(true)
    expect(isAbsolute(p.forensics)).toBe(true)
    expect(isAbsolute(p.buildDrafts)).toBe(true)
    expect(isAbsolute(p.baseFile)).toBe(true)
    expect(isAbsolute(p.readme)).toBe(true)
  })

  test('places run under cwd/.code-oz/runs/<runId>', () => {
    const p = runPaths(CWD, RUN)
    expect(p.run).toBe(join(CWD, '.code-oz', 'runs', RUN))
  })

  test('worktree is under run', () => {
    const p = runPaths(CWD, RUN)
    expect(p.worktree).toBe(join(p.run, 'worktree'))
  })

  test('patches is under run', () => {
    const p = runPaths(CWD, RUN)
    expect(p.patches).toBe(join(p.run, 'patches'))
  })

  test('forensics is under run', () => {
    const p = runPaths(CWD, RUN)
    expect(p.forensics).toBe(join(p.run, 'forensics'))
  })

  test('buildDrafts is under run', () => {
    const p = runPaths(CWD, RUN)
    expect(p.buildDrafts).toBe(join(p.run, 'build-drafts'))
  })

  test('baseFile is run/base.txt', () => {
    const p = runPaths(CWD, RUN)
    expect(p.baseFile).toBe(join(p.run, 'base.txt'))
  })

  test('readme is run/README.md', () => {
    const p = runPaths(CWD, RUN)
    expect(p.readme).toBe(join(p.run, 'README.md'))
  })

  test('returned object is frozen', () => {
    const p = runPaths(CWD, RUN)
    expect(Object.isFrozen(p)).toBe(true)
  })

  test('worktree path is distinct from .code-oz/state/runs/<runId>/', () => {
    const p = runPaths(CWD, RUN)
    expect(p.run).not.toContain('state/runs')
    expect(p.run).toContain('.code-oz/runs')
  })
})

describe('patchFilePath', () => {
  test('formats <T-NNN>-attempt-<N>.patch under patches/', () => {
    const path = patchFilePath(CWD, RUN, 'T-001', 1)
    expect(path).toBe(join(CWD, '.code-oz', 'runs', RUN, 'patches', 'T-001-attempt-1.patch'))
  })

  test('rejects taskId without T- prefix', () => {
    expect(() => patchFilePath(CWD, RUN, '001', 1)).toThrow(/invalid taskId/)
  })

  test('rejects taskId with too few digits', () => {
    expect(() => patchFilePath(CWD, RUN, 'T-1', 1)).toThrow(/invalid taskId/)
  })

  test('rejects attempt 0', () => {
    expect(() => patchFilePath(CWD, RUN, 'T-001', 0)).toThrow(/invalid attempt/)
  })

  test('rejects negative attempt', () => {
    expect(() => patchFilePath(CWD, RUN, 'T-001', -1)).toThrow(/invalid attempt/)
  })

  test('rejects non-integer attempt', () => {
    expect(() => patchFilePath(CWD, RUN, 'T-001', 1.5)).toThrow(/invalid attempt/)
  })

  test('accepts T- with 4+ digits', () => {
    const path = patchFilePath(CWD, RUN, 'T-9999', 2)
    expect(path).toContain('T-9999-attempt-2.patch')
  })
})

describe('forensicsAttemptPath', () => {
  test('formats forensics/<N>/', () => {
    const path = forensicsAttemptPath(CWD, RUN, 3)
    expect(path).toBe(join(CWD, '.code-oz', 'runs', RUN, 'forensics', '3'))
  })

  test('rejects attempt 0', () => {
    expect(() => forensicsAttemptPath(CWD, RUN, 0)).toThrow(/invalid attempt/)
  })
})

describe('buildDraftsAttemptPath', () => {
  test('formats build-drafts/<T-NNN>-attempt-<N>/', () => {
    const path = buildDraftsAttemptPath(CWD, RUN, 'T-001', 2)
    expect(path).toBe(
      join(CWD, '.code-oz', 'runs', RUN, 'build-drafts', 'T-001-attempt-2'),
    )
  })

  test('rejects invalid taskId', () => {
    expect(() => buildDraftsAttemptPath(CWD, RUN, 'task1', 1)).toThrow(/invalid taskId/)
  })

  test('rejects invalid attempt', () => {
    expect(() => buildDraftsAttemptPath(CWD, RUN, 'T-001', 0)).toThrow(/invalid attempt/)
  })
})
