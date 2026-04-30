// M8 forensics-extras tests for writeVerifyForensicsBundle.
//
// The M7 writer (writeForensicsBundle) already accepts arbitrary extras
// per the M7 review. This test file pins the M8-specific naming and
// shape: VERIFY.md, attempt-<N>.patch, build-prompt-snapshot.md, all
// alongside the six M7 required entries in the same forensics/<N>/.

import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import {
  M7_REQUIRED_FORENSICS_ENTRIES,
  M8_FORENSICS_EXTRA_NAMES,
  attemptPatchName,
  writeVerifyForensicsBundle,
} from '../src/worktree/forensics.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN_ID = '01J3Z89H5R8K3CZ8B0K4MZTGNH'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(`forensics tests require git >= 2.40`)
  }
})

async function withCommittedRepo<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeoz-m8fr-'))
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

const M7_INPUTS = {
  stdout: 'test stdout\n',
  stderr: 'test stderr\n',
  buildReportContent: '# BUILD_REPORT\n\n## Task\n- Task: T-001\n',
  manifestText: '- src/a.ts | sha256: aaa | change: modified',
  promptConstraints: 'Constraint: prefer last-syllable stress.',
}

const M8_INPUTS = {
  verifyReportContent: '# VERIFY\n\n## BUILD ref\n- Task: T-001\n',
  attemptPatchContent: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1,1 +1,1 @@\n-1\n+999\n',
  buildPromptSnapshot: '# BUILD prompt\n\nApply the patch.\n',
}

describe('M8 forensics constants', () => {
  test('M8_FORENSICS_EXTRA_NAMES exposes the three locked names', () => {
    expect(M8_FORENSICS_EXTRA_NAMES.verifyReport).toBe('VERIFY.md')
    expect(M8_FORENSICS_EXTRA_NAMES.buildPromptSnapshot).toBe('build-prompt-snapshot.md')
    expect(M8_FORENSICS_EXTRA_NAMES.attemptPatchTemplate).toBe('attempt-<N>.patch')
  })

  test('attemptPatchName resolves the templated name for a given N', () => {
    expect(attemptPatchName(1)).toBe('attempt-1.patch')
    expect(attemptPatchName(4)).toBe('attempt-4.patch')
  })

  test('attemptPatchName rejects non-positive N', () => {
    expect(() => attemptPatchName(0)).toThrow()
    expect(() => attemptPatchName(-1)).toThrow()
    expect(() => attemptPatchName(1.5)).toThrow()
  })
})

describe('writeVerifyForensicsBundle — happy path', () => {
  test('writes all 9 entries (6 M7 + 3 M8)', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      await writeFile(join(created.worktreePath, 'src/a.ts'), 'export const a = 999\n')

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 2,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        ...M8_INPUTS,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      // 6 M7 entries
      for (const name of M7_REQUIRED_FORENSICS_ENTRIES) {
        expect(result.entries).toContain(name)
      }
      // 3 M8 entries
      expect(result.entries).toContain('VERIFY.md')
      expect(result.entries).toContain('build-prompt-snapshot.md')
      expect(result.entries).toContain('attempt-2.patch') // templated for attempt=2
      expect(result.entries).toHaveLength(9)

      // Verify content was written byte-for-byte
      const verifyContent = await readFile(join(result.forensicsPath, 'VERIFY.md'), 'utf8')
      expect(verifyContent).toBe(M8_INPUTS.verifyReportContent)
      const patchContent = await readFile(join(result.forensicsPath, 'attempt-2.patch'), 'utf8')
      expect(patchContent).toBe(M8_INPUTS.attemptPatchContent)
      const promptContent = await readFile(join(result.forensicsPath, 'build-prompt-snapshot.md'), 'utf8')
      expect(promptContent).toBe(M8_INPUTS.buildPromptSnapshot)
    })
  })

  test('attempt=4 → attempt-4.patch filename', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 4,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        ...M8_INPUTS,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.entries).toContain('attempt-4.patch')
      expect(result.entries).not.toContain('attempt-2.patch')
    })
  })
})

describe('writeVerifyForensicsBundle — preserveExistingStdoutStderr (Codex bp#3)', () => {
  test('preserves an existing stdout.log on disk instead of clobbering with empty', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      // Simulate the runner streaming logs into the forensics dir before
      // writeVerifyForensicsBundle is called.
      const { mkdir: mk } = await import('node:fs/promises')
      const forensicsDir = join(cwd, '.code-oz/runs', RUN_ID, 'forensics', '1')
      await mk(forensicsDir, { recursive: true })
      const streamedStdout = 'TEST FAILED: expected 1, got 999\nthis is the streamed log content\n'
      const streamedStderr = 'Error at src/a.ts:1\n'
      await writeFile(join(forensicsDir, 'stdout.log'), streamedStdout)
      await writeFile(join(forensicsDir, 'stderr.log'), streamedStderr)

      // Mutate worktree so git diff produces output
      await writeFile(join(created.worktreePath, 'src/a.ts'), 'export const a = 999\n')

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        // Caller passes empty markers — bundle writer must preserve the
        // already-streamed log files rather than overwriting them with ''.
        ...M7_INPUTS,
        stdout: '',
        stderr: '',
        ...M8_INPUTS,
        preserveExistingStdoutStderr: true,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const stdoutAfter = await readFile(join(result.forensicsPath, 'stdout.log'), 'utf8')
      const stderrAfter = await readFile(join(result.forensicsPath, 'stderr.log'), 'utf8')
      expect(stdoutAfter).toBe(streamedStdout)
      expect(stderrAfter).toBe(streamedStderr)
    })
  })

  test('without the flag, empty stdout/stderr DO clobber existing files (legacy M7 behavior)', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      const { mkdir: mk } = await import('node:fs/promises')
      const forensicsDir = join(cwd, '.code-oz/runs', RUN_ID, 'forensics', '1')
      await mk(forensicsDir, { recursive: true })
      await writeFile(join(forensicsDir, 'stdout.log'), 'streamed content')

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        stdout: '',
        stderr: '',
        ...M8_INPUTS,
        // preserveExistingStdoutStderr: not set → defaults to false
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const stdoutAfter = await readFile(join(result.forensicsPath, 'stdout.log'), 'utf8')
      // Without the flag the existing file IS clobbered with empty —
      // documents the legacy behavior we're protecting against in VERIFY.
      expect(stdoutAfter).toBe('')
    })
  })
})

describe('writeVerifyForensicsBundle — input validation', () => {
  test('empty verifyReportContent rejected', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        ...M8_INPUTS,
        verifyReportContent: '',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('forensics_verify_report_empty')
    })
  })

  test('empty attemptPatchContent rejected', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        ...M8_INPUTS,
        attemptPatchContent: '   \n  ',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('forensics_attempt_patch_empty')
    })
  })

  test('empty buildPromptSnapshot rejected', async () => {
    await withCommittedRepo(async (cwd) => {
      const created = await createRunWorktree({ cwd, runId: RUN_ID })
      if (!created.ok) return

      const result = await writeVerifyForensicsBundle({
        cwd,
        runId: RUN_ID,
        attempt: 1,
        baseCommitSha: created.baseCommitSha,
        ...M7_INPUTS,
        ...M8_INPUTS,
        buildPromptSnapshot: '',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('forensics_prompt_snapshot_empty')
    })
  })
})
