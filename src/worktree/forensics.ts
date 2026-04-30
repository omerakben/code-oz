// M7 forensics writer (per docs/contracts/WORKTREE.md § "Forensics layout"
// + § "Forensics extensibility").
//
// Order matters: the diff capture (`git diff`) MUST run BEFORE the worktree
// is destroyed. A destroyed worktree cannot be re-diffed.
//
// Per Codex M7 implementation review H2 (thread 019ddeea): the writer
// accepts named additional entries so M8 can append VERIFY.md, the frozen
// patch, and the BUILD prompt-snapshot without breaking the M7 layout.

import { mkdir, writeFile } from 'node:fs/promises'
import { runGit } from './create-run-worktree.ts'
import { forensicsAttemptPath, runPaths } from './paths.ts'

export interface WriteForensicsBundleOptions {
  readonly cwd: string
  readonly runId: string
  readonly attempt: number
  readonly baseCommitSha: string
  /** Captured stdout from the validation command (M8 will populate). */
  readonly stdout: string
  /** Captured stderr from the validation command. */
  readonly stderr: string
  /** Frozen copy of the failed attempt's BUILD_REPORT.md content. */
  readonly buildReportContent: string
  /** Frozen manifest text (locked grammar from BUILD_REPORT.md § Changed files). */
  readonly manifestText: string
  /** VERIFY's failure-constraint block — what attempt N+1's BUILD prompt reads. */
  readonly promptConstraints: string
  /** Optional named extras (M8+ may add VERIFY.md, attempt-<N>.patch frozen, etc.). */
  readonly extras?: Readonly<Record<string, string>>
}

export interface WriteForensicsBundleOk {
  readonly ok: true
  readonly forensicsPath: string
  /** Names of files written under forensicsPath, sorted. */
  readonly entries: readonly string[]
}

export interface WriteForensicsBundleErr {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type WriteForensicsBundleResult = WriteForensicsBundleOk | WriteForensicsBundleErr

/** The six required entries M7 ships. M8 may append additional names. */
export const M7_REQUIRED_FORENSICS_ENTRIES = [
  'diff.patch',
  'stdout.log',
  'stderr.log',
  'BUILD_REPORT.md',
  'manifest.txt',
  'prompt-constraints.md',
] as const

/**
 * Writes the forensics bundle for a failed attempt N. The diff is captured
 * from the live worktree; all other files come from the caller (M8 has
 * already collected them by the time it calls this).
 *
 * Caller is responsible for emitting `worktree_forensics_preserved` on ok
 * AND for invoking removeRunWorktree() afterward — this function does NOT
 * destroy the worktree (separation of concerns; failure here must not
 * accidentally lose forensics).
 */
export async function writeForensicsBundle(
  opts: WriteForensicsBundleOptions,
): Promise<WriteForensicsBundleResult> {
  if (!Number.isInteger(opts.attempt) || opts.attempt < 1) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_invalid_attempt',
      reason: `attempt must be a positive integer; got ${opts.attempt}`,
    })
  }

  const dir = forensicsAttemptPath(opts.cwd, opts.runId, opts.attempt)
  const worktreePath = runPaths(opts.cwd, opts.runId).worktree

  // Capture diff FIRST (before any other write) — the worktree may be in
  // a fragile state and we want this evidence above all else.
  const diff = await runGit(worktreePath, ['diff', opts.baseCommitSha])
  if (!diff.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_diff_capture_failed',
      reason: diff.stderr.trim().slice(0, 200) || 'git diff returned non-zero',
    })
  }

  try {
    await mkdir(dir, { recursive: true })
  } catch (err) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_mkdir_failed',
      reason: (err as Error).message.slice(0, 200),
    })
  }

  const written: string[] = []

  // Write the six required entries first, then any extras.
  const required: ReadonlyArray<readonly [string, string]> = [
    ['diff.patch', diff.stdout],
    ['stdout.log', opts.stdout],
    ['stderr.log', opts.stderr],
    ['BUILD_REPORT.md', opts.buildReportContent],
    ['manifest.txt', opts.manifestText],
    ['prompt-constraints.md', opts.promptConstraints],
  ]

  for (const [name, content] of required) {
    const ok = await writeOne(dir, name, content)
    if (!ok.ok) return ok
    written.push(name)
  }

  if (opts.extras) {
    for (const [name, content] of Object.entries(opts.extras)) {
      // Reject extras that would shadow required names — M7 entries are stable.
      if ((M7_REQUIRED_FORENSICS_ENTRIES as readonly string[]).includes(name)) {
        return Object.freeze({
          ok: false as const,
          code: 'forensics_extras_shadow_required',
          reason: `extras.${name} shadows a required M7 entry`,
        })
      }
      // Reject path-traversing or absolute names.
      if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
        return Object.freeze({
          ok: false as const,
          code: 'forensics_extras_unsafe_name',
          reason: `extras filename must be a single bare basename; got ${name}`,
        })
      }
      const ok = await writeOne(dir, name, content)
      if (!ok.ok) return ok
      written.push(name)
    }
  }

  return Object.freeze({
    ok: true as const,
    forensicsPath: dir,
    entries: Object.freeze([...written].sort()),
  })
}

async function writeOne(
  dir: string,
  name: string,
  content: string,
): Promise<{ ok: true } | WriteForensicsBundleErr> {
  try {
    await writeFile(`${dir}/${name}`, content, { encoding: 'utf8' })
    return { ok: true }
  } catch (err) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_write_failed',
      reason: `${name}: ${(err as Error).message.slice(0, 200)}`,
    })
  }
}
