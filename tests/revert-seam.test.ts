// Integration tests for the production GitRevertSeam.
//
// These tests use a real git repository + worktree to verify that
// snapshot → revert → restore actually round-trips file contents,
// including the three change-kind variants (added/modified/deleted).
// Closes Codex review M8 finding bp#4.

import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, mkdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'
import { createGitRevertSeam } from '../src/worktree/revert-seam.ts'
import type { ChangedFileEntry } from '../src/phases/verify-mutation.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const SHA = 'd'.repeat(64)

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`revert-seam tests require git >= 2.40`)
  }
})

async function withCommittedRepo<T>(fn: (cwd: string, baseCommit: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-revert-'))
  try {
    await runGit(cwd, ['init', '-q', '-b', 'main'])
    await runGit(cwd, ['config', 'user.email', 'test@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Test'])
    await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(join(cwd, 'src/foo.ts'), 'export const stress = "first"\n')
    await writeFile(join(cwd, 'src/old.ts'), 'export const removed = true\n')
    await runGit(cwd, ['add', '.'])
    await runGit(cwd, ['commit', '-q', '-m', 'init'])
    const head = await runGit(cwd, ['rev-parse', 'HEAD'])
    if (!head.ok) throw new Error('failed to read HEAD')
    return await fn(cwd, head.stdout.trim())
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('GitRevertSeam — modified file', () => {
  test('reverts modified file to base via git checkout, restores post-revert via snapshot', async () => {
    await withCommittedRepo(async (cwd, baseCommit) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      // Apply a "post-patch" modification to the worktree
      const fooAbs = join(created.worktreePath, 'src/foo.ts')
      const postPatch = 'export const stress = "last"\n'
      await writeFile(fooAbs, postPatch)

      const seam = createGitRevertSeam({ worktreePath: created.worktreePath })
      const files: ChangedFileEntry[] = [{ path: 'src/foo.ts', sha256: SHA, change: 'modified' }]

      // Snapshot captures post-patch state
      const snap = await seam.snapshot(files.map((f) => f.path))

      // Revert to base
      await seam.revert(files, baseCommit)
      const afterRevert = await readFile(fooAbs, 'utf8')
      expect(afterRevert).toBe('export const stress = "first"\n')

      // Restore brings back post-patch
      await seam.restore(snap)
      const afterRestore = await readFile(fooAbs, 'utf8')
      expect(afterRestore).toBe(postPatch)
    })
  })
})

describe('GitRevertSeam — added file', () => {
  test('removes added file on revert, recreates on restore', async () => {
    await withCommittedRepo(async (cwd, baseCommit) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      // The "post-patch" worktree has a new file that didn't exist at base
      const newAbs = join(created.worktreePath, 'src/new.ts')
      const newContent = 'export const added = 42\n'
      await writeFile(newAbs, newContent)

      const seam = createGitRevertSeam({ worktreePath: created.worktreePath })
      const files: ChangedFileEntry[] = [{ path: 'src/new.ts', sha256: SHA, change: 'added' }]

      const snap = await seam.snapshot(files.map((f) => f.path))
      await seam.revert(files, baseCommit)
      expect(await pathExists(newAbs)).toBe(false)

      await seam.restore(snap)
      const after = await readFile(newAbs, 'utf8')
      expect(after).toBe(newContent)
    })
  })
})

describe('GitRevertSeam — deleted file', () => {
  test('recreates deleted file on revert, removes on restore', async () => {
    await withCommittedRepo(async (cwd, baseCommit) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      // The "post-patch" worktree had src/old.ts deleted (existed at base).
      const oldAbs = join(created.worktreePath, 'src/old.ts')
      // Simulate the post-patch state: file is removed.
      await import('node:fs/promises').then((m) => m.unlink(oldAbs)).catch(() => null)
      expect(await pathExists(oldAbs)).toBe(false)

      const seam = createGitRevertSeam({ worktreePath: created.worktreePath })
      const files: ChangedFileEntry[] = [{ path: 'src/old.ts', sha256: SHA, change: 'deleted' }]

      const snap = await seam.snapshot(files.map((f) => f.path))
      await seam.revert(files, baseCommit)
      // Reverted: file should exist again with base content
      expect(await pathExists(oldAbs)).toBe(true)
      const reverted = await readFile(oldAbs, 'utf8')
      expect(reverted).toBe('export const removed = true\n')

      await seam.restore(snap)
      // Restored: file is gone again (snapshot recorded null content)
      expect(await pathExists(oldAbs)).toBe(false)
    })
  })
})

describe('GitRevertSeam — error handling', () => {
  test('revert against bad base commit throws', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return
      const seam = createGitRevertSeam({ worktreePath: created.worktreePath })
      const files: ChangedFileEntry[] = [{ path: 'src/foo.ts', sha256: SHA, change: 'modified' }]
      let threw = false
      try {
        await seam.revert(files, 'deadbeef'.repeat(5)) // 40-hex but not a real commit
      } catch (err) {
        threw = true
        expect((err as Error).message).toContain('git checkout')
      }
      expect(threw).toBe(true)
    })
  })

  test('restore on snapshot from different seam throws', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return
      const seam = createGitRevertSeam({ worktreePath: created.worktreePath })
      let threw = false
      try {
        await seam.restore({ token: 'someone-elses-seam', worktreePath: cwd, entries: [] } as unknown)
      } catch (err) {
        threw = true
        expect((err as Error).message).toContain('different seam')
      }
      expect(threw).toBe(true)
    })
  })
})
