import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, mkdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { applyAgentPatch } from '../src/patches/apply-agent-patch.ts'
import { computeManifest } from '../src/worktree/manifest.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'
const TASK = 'T-001'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`patch-apply tests require git >= 2.40`)
  }
})

async function withFixtureRepo<T>(
  fn: (cwd: string, baseSha: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-pa-'))
  try {
    await runGit(cwd, ['init', '-q', '-b', 'main'])
    await runGit(cwd, ['config', 'user.email', 'test@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Test'])
    await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(join(cwd, 'src/a.ts'), 'export const a = 1\n')
    await runGit(cwd, ['add', '.'])
    await runGit(cwd, ['commit', '-q', '-m', 'init'])
    const head = await runGit(cwd, ['rev-parse', 'HEAD'])
    if (!head.ok) throw new Error('git rev-parse failed')
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

const MODIFY_PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-export const a = 1
+export const a = 42
`

const ADD_PATCH = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,1 @@
+export const x = 7
`

describe('applyAgentPatch — happy paths', () => {
  test('applies a modify patch and returns sha + path', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: MODIFY_PATCH,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.patchPath).toContain(`${TASK}-attempt-1.patch`)
      expect(result.patchSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(result.patchBytes).toBe(Buffer.byteLength(MODIFY_PATCH, 'utf8'))
      expect(result.paths).toContain('src/a.ts')
    })
  })

  test('writes the patch file under runs/<runId>/patches/', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: MODIFY_PATCH,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(await pathExists(result.patchPath)).toBe(true)
      const written = await readFile(result.patchPath, 'utf8')
      expect(written).toBe(MODIFY_PATCH)
    })
  })

  test('mutates the worktree file content', async () => {
    await withFixtureRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: MODIFY_PATCH,
      })
      expect(result.ok).toBe(true)
      const after = await readFile(join(created.worktreePath, 'src/a.ts'), 'utf8')
      expect(after).toBe('export const a = 42\n')
    })
  })

  test('add-patch creates new file AND it appears in manifest (--index in effect)', async () => {
    await withFixtureRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: ADD_PATCH,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const newPath = join(created.worktreePath, 'src/new.ts')
      expect(await pathExists(newPath)).toBe(true)

      // Critical: with `--index`, the new file is tracked, so the manifest
      // sees it. This is the integration check between apply and manifest.
      const manifest = await computeManifest({
        worktreePath: created.worktreePath,
        baseCommitSha: created.baseCommitSha,
      })
      expect(manifest.ok).toBe(true)
      if (!manifest.ok) return
      const found = manifest.entries.find((e) => e.path === 'src/new.ts')
      expect(found).toBeDefined()
      expect(found?.change).toBe('added')
    })
  })
})

describe('applyAgentPatch — failure paths', () => {
  test('rejects oversized patch before write', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: 'x'.repeat(70000), // > MAX_PATCH_BYTES
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('build_patch_size_exceeded')
      expect(result.patchPath).toBeUndefined() // file never written
    })
  })

  test('rejects path-traversing patch before write', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: `diff --git a/../escape.ts b/../escape.ts
--- a/../escape.ts
+++ b/../escape.ts
@@ -1,1 +1,1 @@
-x
+y
`,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('build_manifest_path_unsafe')
      expect(result.patchPath).toBeUndefined()
    })
  })

  test('reports build_patch_apply_check_failed on hunk mismatch', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      // Patch tries to modify a line that doesn't exist
      const badPatch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-this line is not in the file
+something else
`
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: badPatch,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('build_patch_apply_check_failed')
      // Patch file IS written (we want forensic visibility)
      expect(result.patchPath).toBeDefined()
      expect(await pathExists(result.patchPath!)).toBe(true)
    })
  })

  test('rejects binary patch before write', async () => {
    await withFixtureRepo(async (cwd) => {
      await createRunWorktree({ cwd, runId: RUN_ID })
      const result = await applyAgentPatch({
        cwd,
        runId: RUN_ID,
        taskId: TASK,
        attempt: 1,
        patchContent: `diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('build_patch_binary_unsupported')
    })
  })
})
