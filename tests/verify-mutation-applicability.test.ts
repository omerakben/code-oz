import { describe, test, expect } from 'bun:test'
import {
  DEFAULT_TEST_SUFFIX,
  evaluateApplicability,
  type ChangedFileEntry,
} from '../src/phases/verify-mutation.ts'

const SHA = 'a'.repeat(64)

function file(path: string, change: 'added' | 'modified' | 'deleted'): ChangedFileEntry {
  return { path, sha256: SHA, change }
}

describe('evaluateApplicability — happy: applicable', () => {
  test('one added test + one modified behavior file → applicable', () => {
    const r = evaluateApplicability({
      changedFiles: [
        file('tests/scoring.test.ts', 'added'),
        file('src/scoring.ts', 'modified'),
      ],
      expectedExitCode: 0,
    })
    expect(r.applicable).toBe(true)
    expect(r.addedTests).toHaveLength(1)
    expect(r.behaviorFiles).toHaveLength(1)
    expect(r.behaviorFiles[0]?.path).toBe('src/scoring.ts')
    expect(r.reason).toContain('1 added test')
  })

  test('multiple added tests → applicable, all listed', () => {
    const r = evaluateApplicability({
      changedFiles: [
        file('tests/a.test.ts', 'added'),
        file('tests/b.test.ts', 'added'),
        file('src/foo.ts', 'modified'),
      ],
      expectedExitCode: 0,
    })
    expect(r.applicable).toBe(true)
    expect(r.addedTests).toHaveLength(2)
  })

  test('added test only (no behavior files) → applicable with empty behaviorFiles', () => {
    const r = evaluateApplicability({
      changedFiles: [file('tests/new.test.ts', 'added')],
      expectedExitCode: 0,
    })
    expect(r.applicable).toBe(true)
    expect(r.addedTests).toHaveLength(1)
    expect(r.behaviorFiles).toHaveLength(0)
  })
})

describe('evaluateApplicability — not-applicable cases', () => {
  test('no test files → not-applicable', () => {
    const r = evaluateApplicability({
      changedFiles: [
        file('src/foo.ts', 'modified'),
        file('docs/readme.md', 'modified'),
      ],
      expectedExitCode: 0,
    })
    expect(r.applicable).toBe(false)
    expect(r.reason).toContain('no added test')
  })

  test('only modified test file (no added test) → not-applicable', () => {
    const r = evaluateApplicability({
      changedFiles: [
        file('tests/existing.test.ts', 'modified'),
        file('src/foo.ts', 'modified'),
      ],
      expectedExitCode: 0,
    })
    expect(r.applicable).toBe(false)
    expect(r.reason).toContain('modifications-only')
  })

  test('expectedExitCode != 0 → not-applicable', () => {
    const r = evaluateApplicability({
      changedFiles: [file('tests/new.test.ts', 'added')],
      expectedExitCode: 1,
    })
    expect(r.applicable).toBe(false)
    expect(r.reason).toContain('expectedExitCode')
  })

  test('empty changed files → not-applicable', () => {
    const r = evaluateApplicability({ changedFiles: [], expectedExitCode: 0 })
    expect(r.applicable).toBe(false)
  })

  test('not-applicable returns frozen empty arrays for partition fields', () => {
    const r = evaluateApplicability({
      changedFiles: [file('src/foo.ts', 'modified')],
      expectedExitCode: 0,
    })
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.addedTests)).toBe(true)
    expect(Object.isFrozen(r.behaviorFiles)).toBe(true)
  })
})

describe('evaluateApplicability — custom test suffix', () => {
  test('custom suffix: .spec.ts', () => {
    const r = evaluateApplicability({
      changedFiles: [
        file('tests/scoring.spec.ts', 'added'),
        file('src/scoring.ts', 'modified'),
      ],
      expectedExitCode: 0,
      testSuffix: '.spec.ts',
    })
    expect(r.applicable).toBe(true)
    expect(r.addedTests).toHaveLength(1)
  })

  test('default suffix used when none provided (constant exposed for callers)', () => {
    expect(DEFAULT_TEST_SUFFIX).toBe('.test.ts')
  })
})
