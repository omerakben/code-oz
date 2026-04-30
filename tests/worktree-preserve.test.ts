// Synthetic preserve-on-failure test (per Codex M7 implementation review,
// rejection of decision 4: "unit-only forensics coverage is too weak").
//
// We synthesize a VERIFY-fail by directly calling writeForensicsBundle()
// with fake stdout/stderr/prompt-constraints, then assert all required
// files exist and survive worktree removal.

import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { removeRunWorktree } from '../src/worktree/remove-run-worktree.ts'
import {
  writeForensicsBundle,
  M7_REQUIRED_FORENSICS_ENTRIES,
} from '../src/worktree/forensics.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`forensics tests require git >= 2.40`)
  }
})

async function withCommittedRepo<T>(
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-fr-'))
  try {
    await runGit(cwd, ['init', '-q', '-b', 'main'])
    await runGit(cwd, ['config', 'user.email', 'test@example.com'])
    await runGit(cwd, ['config', 'user.name', 'Test'])
    await runGit(cwd, ['config', 'commit.gpgsign', 'false'])
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(join(cwd, 'src/a.ts'), 'export const a = 1\n')
    await runGit(cwd, ['add', '.'])
    await runGit(cwd, ['commit', '-q', '-m', 'init'])
    return await fn(cwd)
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

const FAKE_STDOUT = 'TEST FAILED: expected 1, got 999\n'
const FAKE_STDERR = 'Error at src/a.ts:1\n'
const FAKE_BUILD_REPORT = '# BUILD_REPORT\n\n## Task\n- Task: T-001\n'
const FAKE_MANIFEST = '- src/a.ts | sha256: aaa | change: modified'
const FAKE_PROMPT_CONSTRAINTS = 'Constraint: prefer last-syllable stress.'

describe('writeForensicsBundle — synthetic preserve', () => {
  test('writes all 6 M7 required entries', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      // Mutate the worktree so `git diff` produces non-empty output
      await writeFile(join(created.worktreePath, 'src/a.ts'), 'export const a = 999\n')

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: FAKE_STDOUT,
        stderr: FAKE_STDERR,
        buildReportContent: FAKE_BUILD_REPORT,
        manifestText: FAKE_MANIFEST,
        promptConstraints: FAKE_PROMPT_CONSTRAINTS,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // All 6 required entries present
      for (const name of M7_REQUIRED_FORENSICS_ENTRIES) {
        expect(result.entries).toContain(name)
        expect(await pathExists(join(result.forensicsPath, name))).toBe(true)
      }
    })
  })

  test('diff.patch contains the worktree mutation', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      await writeFile(join(created.worktreePath, 'src/a.ts'), 'export const a = 42\n')

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: '',
        stderr: '',
        buildReportContent: '',
        manifestText: '',
        promptConstraints: '',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const diff = await readFile(join(result.forensicsPath, 'diff.patch'), { encoding: 'utf8' })
      expect(diff).toContain('src/a.ts')
      expect(diff).toContain('-export const a = 1')
      expect(diff).toContain('+export const a = 42')
    })
  })

  test('captures provided stdout/stderr/build_report/manifest/prompt verbatim', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: FAKE_STDOUT,
        stderr: FAKE_STDERR,
        buildReportContent: FAKE_BUILD_REPORT,
        manifestText: FAKE_MANIFEST,
        promptConstraints: FAKE_PROMPT_CONSTRAINTS,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(await readFile(join(result.forensicsPath, 'stdout.log'), 'utf8')).toBe(FAKE_STDOUT)
      expect(await readFile(join(result.forensicsPath, 'stderr.log'), 'utf8')).toBe(FAKE_STDERR)
      expect(await readFile(join(result.forensicsPath, 'BUILD_REPORT.md'), 'utf8')).toBe(FAKE_BUILD_REPORT)
      expect(await readFile(join(result.forensicsPath, 'manifest.txt'), 'utf8')).toBe(FAKE_MANIFEST)
      expect(await readFile(join(result.forensicsPath, 'prompt-constraints.md'), 'utf8')).toBe(FAKE_PROMPT_CONSTRAINTS)
    })
  })

  test('forensics survives subsequent worktree removal', async () => {
    // The ordering bug Codex flagged: if we destroy the worktree before
    // capturing the diff, the diff is lost. The bundle's contract is that
    // diff.patch is captured FIRST, so removal afterward is safe.
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      await writeFile(join(created.worktreePath, 'src/a.ts'), 'export const a = 7\n')

      const bundle = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: 'fail',
        stderr: 'err',
        buildReportContent: '# report',
        manifestText: '- m',
        promptConstraints: 'c',
      })
      expect(bundle.ok).toBe(true)
      if (!bundle.ok) return

      // Now destroy the worktree (mimicking M8's preserve-on-failure)
      await removeRunWorktree({ cwd, runId: RUN_ID })

      // All forensics still readable
      for (const name of M7_REQUIRED_FORENSICS_ENTRIES) {
        expect(await pathExists(join(bundle.forensicsPath, name))).toBe(true)
      }
      const diff = await readFile(join(bundle.forensicsPath, 'diff.patch'), 'utf8')
      expect(diff).toContain('a = 7')
    })
  })

  test('accepts extras (M8 will pass VERIFY.md, frozen patch, etc.)', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: '',
        stderr: '',
        buildReportContent: '',
        manifestText: '',
        promptConstraints: '',
        extras: {
          'VERIFY.md': '# VERIFY frozen\n',
          'attempt-1.patch': 'diff --git a/x b/x\n',
        },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.entries).toContain('VERIFY.md')
      expect(result.entries).toContain('attempt-1.patch')
      expect(await pathExists(join(result.forensicsPath, 'VERIFY.md'))).toBe(true)
    })
  })

  test('rejects extras that shadow M7 required entries', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: '',
        stderr: '',
        buildReportContent: '',
        manifestText: '',
        promptConstraints: '',
        extras: { 'diff.patch': 'forged content' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('forensics_extras_shadow_required')
    })
  })

  test('rejects path-traversing extras names', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        stdout: '',
        stderr: '',
        buildReportContent: '',
        manifestText: '',
        promptConstraints: '',
        extras: { '../escape.txt': 'nope' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('forensics_extras_unsafe_name')
    })
  })

  test('rejects attempt < 1', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const result = await writeForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 0,
        baseCommitSha: created.baseCommitSha,
        stdout: '',
        stderr: '',
        buildReportContent: '',
        manifestText: '',
        promptConstraints: '',
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('forensics_invalid_attempt')
    })
  })
})
