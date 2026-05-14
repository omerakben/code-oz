// RED tests for v0.20.2 showstopper #0b: provider-file-refs helper.
//
// Three RED tests required per Codex thread 019e2827 Prompt 6 locked decisions:
//   1. BUILD derivation from `task.fileChanges` returns refs for existing files.
//   2. Added/missing paths are skipped, not surfaced as zero-byte manifest entries.
//   3. Worktree-root isolation — refs point at the worktree, not the host cwd.

import { describe, test, expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deriveBuildTaskFiles,
  deriveReviewChangedFiles,
} from '../src/runtime/provider-file-refs.ts'
import type { PlanTask } from '../src/artifacts/plan.ts'
import type { ManifestEntry } from '../src/worktree/manifest.ts'

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'T-001',
    title: 'Test task',
    files: ['src/example.ts'],
    fileChanges: [{ path: 'src/example.ts', change: 'modified' }],
    validation: 'bun test',
    risk: 'none',
    hypotheses: [],
    sources: ['S-001'],
    ...overrides,
  }
}

async function makeWorktreeWithFiles(files: readonly { path: string; content: string }[]): Promise<string> {
  const worktree = await mkdtemp(join(tmpdir(), 'code-oz-file-refs-'))
  for (const f of files) {
    const abs = join(worktree, f.path)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, f.content, 'utf8')
  }
  return worktree
}

describe('deriveBuildTaskFiles — existing-file derivation', () => {
  test('returns a ProviderFileRef for every file that exists on the worktree', async () => {
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/a.ts', content: 'export const A = 1' },
      { path: 'src/b.ts', content: 'export const B = 2' },
    ])
    try {
      const task = makeTask({
        files: ['src/a.ts', 'src/b.ts'],
        fileChanges: [
          { path: 'src/a.ts', change: 'modified' },
          { path: 'src/b.ts', change: 'modified' },
        ],
      })
      const refs = await deriveBuildTaskFiles(task, worktree)
      expect(refs).toHaveLength(2)
      expect(refs.map((r) => r.path)).toEqual([
        join(worktree, 'src/a.ts'),
        join(worktree, 'src/b.ts'),
      ])
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})

describe('deriveBuildTaskFiles — missing-path skip (Codex test #2)', () => {
  test('skips paths that do not exist (typical "added" first-build case)', async () => {
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/existing.ts', content: 'export const X = 1' },
    ])
    try {
      const task = makeTask({
        files: ['src/existing.ts', 'src/new-file.ts'],
        fileChanges: [
          { path: 'src/existing.ts', change: 'modified' },
          { path: 'src/new-file.ts', change: 'added' },
        ],
      })
      const refs = await deriveBuildTaskFiles(task, worktree)
      expect(refs).toHaveLength(1)
      expect(refs[0]?.path).toBe(join(worktree, 'src/existing.ts'))
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  test('returns empty array when every path is missing (pure scaffold task)', async () => {
    const worktree = await makeWorktreeWithFiles([])
    try {
      const task = makeTask({
        files: ['src/version.ts'],
        fileChanges: [{ path: 'src/version.ts', change: 'added' }],
      })
      const refs = await deriveBuildTaskFiles(task, worktree)
      expect(refs).toEqual([])
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})

describe('deriveBuildTaskFiles — worktree-root isolation (Codex test #3)', () => {
  test('resolves paths against the worktree, not the host cwd', async () => {
    // Build two parallel directories: a "host" with one content,
    // a "worktree" with different content for the same relative path.
    // The helper must pick the worktree's bytes, not the host's.
    const host = await makeWorktreeWithFiles([
      { path: 'src/shared.ts', content: 'host-content' },
    ])
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/shared.ts', content: 'worktree-content' },
    ])
    try {
      const task = makeTask({
        files: ['src/shared.ts'],
        fileChanges: [{ path: 'src/shared.ts', change: 'modified' }],
      })
      const refs = await deriveBuildTaskFiles(task, worktree)
      expect(refs).toHaveLength(1)
      // The absolute path must be inside the worktree, not the host.
      expect(refs[0]?.path.startsWith(worktree)).toBe(true)
      expect(refs[0]?.path.startsWith(host)).toBe(false)
    } finally {
      await rm(host, { recursive: true, force: true })
      await rm(worktree, { recursive: true, force: true })
    }
  })
})

describe('deriveReviewChangedFiles — BUILD_REPORT derivation', () => {
  test('returns refs for modified files', async () => {
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/foo.ts', content: 'post-patch foo' },
    ])
    try {
      const entries: ManifestEntry[] = [
        { path: 'src/foo.ts', sha256: 'a'.repeat(64), change: 'modified' },
      ]
      const refs = await deriveReviewChangedFiles(entries, worktree)
      expect(refs).toHaveLength(1)
      expect(refs[0]?.path).toBe(join(worktree, 'src/foo.ts'))
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  test('skips deleted files (their bytes are gone post-patch)', async () => {
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/kept.ts', content: 'still here' },
    ])
    try {
      const entries: ManifestEntry[] = [
        { path: 'src/kept.ts', sha256: 'a'.repeat(64), change: 'modified' },
        { path: 'src/gone.ts', sha256: 'b'.repeat(64), change: 'deleted' },
      ]
      const refs = await deriveReviewChangedFiles(entries, worktree)
      expect(refs).toHaveLength(1)
      expect(refs[0]?.path).toBe(join(worktree, 'src/kept.ts'))
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  test('includes added files (they exist post-patch)', async () => {
    const worktree = await makeWorktreeWithFiles([
      { path: 'src/new.ts', content: 'fresh patch output' },
    ])
    try {
      const entries: ManifestEntry[] = [
        { path: 'src/new.ts', sha256: 'a'.repeat(64), change: 'added' },
      ]
      const refs = await deriveReviewChangedFiles(entries, worktree)
      expect(refs).toHaveLength(1)
      expect(refs[0]?.path).toBe(join(worktree, 'src/new.ts'))
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})
