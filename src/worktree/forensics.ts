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
 * The three M8 forensics entries appended on a VERIFY-fail attempt
 * (per docs/contracts/WORKTREE.md § "Forensics extensibility" + the
 * M8 commit-0 synthesis pin). `attempt-N.patch` is templated by the
 * `attemptPatchName(n)` helper because the suffix tracks the attempt
 * number. The M7 layout is never relocated; M8 entries live alongside
 * the six required names in the same forensics/<N>/ directory.
 */
export const M8_FORENSICS_EXTRA_NAMES = Object.freeze({
  verifyReport: 'VERIFY.md',
  buildPromptSnapshot: 'build-prompt-snapshot.md',
  attemptPatchTemplate: 'attempt-<N>.patch',
} as const)

/** Resolves the templated attempt-patch filename for a given attempt N. */
export function attemptPatchName(attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attemptPatchName: attempt must be a positive integer; got ${attempt}`)
  }
  return `attempt-${attempt}.patch`
}

export interface WriteVerifyForensicsBundleOptions {
  readonly cwd: string
  readonly runId: string
  readonly attempt: number
  readonly baseCommitSha: string
  readonly stdout: string
  readonly stderr: string
  readonly buildReportContent: string
  readonly manifestText: string
  readonly promptConstraints: string
  /** Frozen VERIFY.md content (the persona-authored + orchestrator-validated artifact). */
  readonly verifyReportContent: string
  /** Frozen patch content for this attempt (the same patch that BUILD applied). */
  readonly attemptPatchContent: string
  /** Snapshot of the BUILD persona prompt that fed this attempt. */
  readonly buildPromptSnapshot: string
}

/**
 * M8-aware forensics writer: invokes writeForensicsBundle with the
 * three M8 extras populated under their canonical names. Per Codex M8
 * decision 8 modification, this writer fires within the
 * orchestrator's locked sequence:
 *
 *   write logs → write canonical VERIFY.md → write forensics bundle
 *   → emit worktree_forensics_preserved → emit verify_failed
 *   → remove worktree → emit worktree_destroyed
 *   → emit verify_restart_initiated (or intervention)
 *
 * This function only handles the "write forensics bundle" step. The
 * caller (M8 commit 10) is responsible for event emission ordering
 * and the worktree removal that follows.
 */
export async function writeVerifyForensicsBundle(
  opts: WriteVerifyForensicsBundleOptions,
): Promise<WriteForensicsBundleResult> {
  if (!opts.verifyReportContent.trim()) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_verify_report_empty',
      reason: 'verifyReportContent must be non-empty',
    })
  }
  if (!opts.attemptPatchContent.trim()) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_attempt_patch_empty',
      reason: 'attemptPatchContent must be non-empty',
    })
  }
  if (!opts.buildPromptSnapshot.trim()) {
    return Object.freeze({
      ok: false as const,
      code: 'forensics_prompt_snapshot_empty',
      reason: 'buildPromptSnapshot must be non-empty',
    })
  }
  return writeForensicsBundle({
    cwd: opts.cwd,
    runId: opts.runId,
    attempt: opts.attempt,
    baseCommitSha: opts.baseCommitSha,
    stdout: opts.stdout,
    stderr: opts.stderr,
    buildReportContent: opts.buildReportContent,
    manifestText: opts.manifestText,
    promptConstraints: opts.promptConstraints,
    extras: {
      [M8_FORENSICS_EXTRA_NAMES.verifyReport]: opts.verifyReportContent,
      [attemptPatchName(opts.attempt)]: opts.attemptPatchContent,
      [M8_FORENSICS_EXTRA_NAMES.buildPromptSnapshot]: opts.buildPromptSnapshot,
    },
  })
}

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
