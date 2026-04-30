import { describe, test, expect } from 'bun:test'
import {
  selectBehaviorFiles,
  type ChangedFileEntry,
} from '../src/phases/verify-mutation.ts'

const SHA = 'a'.repeat(64)

function file(path: string, change: 'added' | 'modified' | 'deleted'): ChangedFileEntry {
  return { path, sha256: SHA, change }
}

describe('selectBehaviorFiles — partition discipline', () => {
  test('test files retained, non-test files selected for revert', () => {
    const files = [
      file('tests/foo.test.ts', 'added'),
      file('src/foo.ts', 'modified'),
      file('docs/readme.md', 'modified'),
    ]
    const behavior = selectBehaviorFiles(files)
    expect(behavior).toHaveLength(2)
    expect(behavior.map((f) => f.path)).toEqual(['src/foo.ts', 'docs/readme.md'])
  })

  test('modified test files stay (Codex M8 decision 11): kept at post-patch contents', () => {
    const files = [
      file('tests/existing.test.ts', 'modified'),
      file('src/foo.ts', 'added'),
    ]
    const behavior = selectBehaviorFiles(files)
    // The modified test file is NOT in the revert set — it stays at
    // post-patch contents during replay so the new assertions are exercised
    // against reverted source.
    expect(behavior).toHaveLength(1)
    expect(behavior[0]?.path).toBe('src/foo.ts')
  })

  test('deleted behavior file is included in revert set (re-create from base)', () => {
    const files = [
      file('tests/x.test.ts', 'added'),
      file('src/old-module.ts', 'deleted'),
    ]
    const behavior = selectBehaviorFiles(files)
    expect(behavior).toHaveLength(1)
    expect(behavior[0]?.change).toBe('deleted')
  })

  test('all-test changeset → empty behavior set', () => {
    const files = [
      file('tests/a.test.ts', 'added'),
      file('tests/b.test.ts', 'modified'),
    ]
    const behavior = selectBehaviorFiles(files)
    expect(behavior).toHaveLength(0)
  })

  test('all-behavior changeset → all retained', () => {
    const files = [
      file('src/a.ts', 'modified'),
      file('src/b.ts', 'added'),
    ]
    const behavior = selectBehaviorFiles(files)
    expect(behavior).toHaveLength(2)
  })

  test('returned array is frozen', () => {
    const behavior = selectBehaviorFiles([file('src/foo.ts', 'modified')])
    expect(Object.isFrozen(behavior)).toBe(true)
  })

  test('custom suffix .spec.ts treats .spec.ts files as tests', () => {
    const files = [
      file('tests/scoring.spec.ts', 'added'),
      file('src/scoring.ts', 'modified'),
      // .test.ts no longer matches when suffix=.spec.ts → treated as behavior
      file('tests/old.test.ts', 'modified'),
    ]
    const behavior = selectBehaviorFiles(files, '.spec.ts')
    expect(behavior).toHaveLength(2)
    expect(behavior.map((f) => f.path).sort()).toEqual([
      'src/scoring.ts',
      'tests/old.test.ts',
    ])
  })
})
