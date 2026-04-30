// Changed-file manifest computation (per docs/contracts/BUILD.md §
// "Changed files grammar (locked)").
//
// The manifest is computed by the orchestrator after `git apply --index`
// succeeds in the worktree, never authored by the persona (per Codex M7
// implementation review C1, thread 019ddeea). The manifest grammar is:
//
//   <relative-path> | sha256: <hex64> | change: <added | modified | deleted>
//
// Renames decompose into delete + add per BUILD.md.
//
// Why `git apply --index` (not plain `git apply`): the patch must update
// both working tree and index so that newly added files become tracked
// and show up in `git diff <baseSha> --name-status`. Plain `git apply`
// leaves new files untracked, and untracked files are invisible to diff.
// The patch-apply commit (M7 commit 9) uses `--index`; this module is
// the consumer of that contract.

import { createHash } from 'node:crypto'
import { runGit } from './create-run-worktree.ts'

export type ChangeKind = 'added' | 'modified' | 'deleted'

export interface ManifestEntry {
  /** Path relative to the worktree root. Always forward-slash, never traversing. */
  readonly path: string
  /** Lower-case hex sha256 of post-patch content (added/modified) or pre-patch content (deleted). */
  readonly sha256: string
  readonly change: ChangeKind
}

export interface ComputeManifestOk {
  readonly ok: true
  readonly entries: readonly ManifestEntry[]
}

export interface ComputeManifestErr {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type ComputeManifestResult = ComputeManifestOk | ComputeManifestErr

/**
 * Computes the changed-file manifest by diffing the worktree against its
 * base commit. Must run AFTER `git apply` has succeeded in the worktree.
 *
 * - Added (A) and modified (M): sha256 of the post-patch content (read
 *   from the worktree).
 * - Deleted (D): sha256 of the pre-patch content (read from baseSha via
 *   `git show <baseSha>:<path>`).
 * - Rename (R): decomposed into delete (old path) + add (new path).
 */
export async function computeManifest(opts: {
  readonly worktreePath: string
  readonly baseCommitSha: string
}): Promise<ComputeManifestResult> {
  const diff = await runGit(opts.worktreePath, [
    'diff',
    '--name-status',
    '-z',
    opts.baseCommitSha,
  ])
  if (!diff.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'manifest_diff_failed',
      reason: diff.stderr.trim().slice(0, 200),
    })
  }

  const records = parseNameStatusZ(diff.stdout)
  const entries: ManifestEntry[] = []

  for (const rec of records) {
    if (rec.kind === 'A' || rec.kind === 'M') {
      const sha = await sha256OfWorktreeFile(opts.worktreePath, rec.path)
      if (sha === null) {
        return Object.freeze({
          ok: false as const,
          code: 'manifest_file_unreadable',
          reason: `cannot read ${rec.path} from worktree`,
        })
      }
      entries.push({
        path: rec.path,
        sha256: sha,
        change: rec.kind === 'A' ? 'added' : 'modified',
      })
    } else if (rec.kind === 'D') {
      const sha = await sha256OfBaseFile(opts.worktreePath, opts.baseCommitSha, rec.path)
      if (sha === null) {
        return Object.freeze({
          ok: false as const,
          code: 'manifest_base_file_unreadable',
          reason: `cannot read ${rec.path} from base ${opts.baseCommitSha}`,
        })
      }
      entries.push({ path: rec.path, sha256: sha, change: 'deleted' })
    } else if (rec.kind === 'R') {
      // Rename: deleted old path + added new path
      const oldSha = await sha256OfBaseFile(opts.worktreePath, opts.baseCommitSha, rec.oldPath)
      const newSha = await sha256OfWorktreeFile(opts.worktreePath, rec.newPath)
      if (oldSha === null) {
        return Object.freeze({
          ok: false as const,
          code: 'manifest_base_file_unreadable',
          reason: `cannot read ${rec.oldPath} from base ${opts.baseCommitSha}`,
        })
      }
      if (newSha === null) {
        return Object.freeze({
          ok: false as const,
          code: 'manifest_file_unreadable',
          reason: `cannot read ${rec.newPath} from worktree`,
        })
      }
      entries.push({ path: rec.oldPath, sha256: oldSha, change: 'deleted' })
      entries.push({ path: rec.newPath, sha256: newSha, change: 'added' })
    }
  }

  // Sort for deterministic output (path ascending; ties broken by change order).
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return Object.freeze({ ok: true as const, entries: Object.freeze(sorted) })
}

/** Renders the manifest as the locked-grammar bullet list used by BUILD_REPORT.md. */
export function renderManifestBullets(entries: readonly ManifestEntry[]): string {
  return entries
    .map((e) => `- ${e.path} | sha256: ${e.sha256} | change: ${e.change}`)
    .join('\n')
}

interface NameStatusRecord {
  readonly kind: 'A' | 'M' | 'D' | 'R'
  /** For A/M/D — the path. For R — the new path. */
  readonly path: string
  /** Old path for renames; empty otherwise. */
  readonly oldPath: string
  /** New path for renames (alias of `path`); empty otherwise. */
  readonly newPath: string
}

/**
 * Parses `git diff --name-status -z` output. The `-z` flag uses NUL
 * separators, sidestepping path quoting issues. Records:
 *
 *   "M\0path\0"
 *   "A\0path\0"
 *   "D\0path\0"
 *   "R<score>\0oldPath\0newPath\0"
 */
export function parseNameStatusZ(output: string): readonly NameStatusRecord[] {
  const records: NameStatusRecord[] = []
  const tokens = output.split('\0')
  // Tokens always end in an empty string after the final NUL.
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i]
    if (status === undefined || status.length === 0) {
      i += 1
      continue
    }
    const code = status[0]
    if (code === 'A' || code === 'M' || code === 'D') {
      const path = tokens[i + 1]
      if (path === undefined) break
      records.push({ kind: code, path, oldPath: '', newPath: '' })
      i += 2
    } else if (code === 'R') {
      const oldPath = tokens[i + 1]
      const newPath = tokens[i + 2]
      if (oldPath === undefined || newPath === undefined) break
      records.push({ kind: 'R', path: newPath, oldPath, newPath })
      i += 3
    } else {
      // Skip unknown status codes (e.g., 'C' copy, 'T' type-change). v0.1
      // does not handle these; if encountered, the manifest is incomplete
      // and the patch-validate scanner should have rejected the patch.
      i += 1
    }
  }
  return records
}

async function sha256OfWorktreeFile(worktreePath: string, path: string): Promise<string | null> {
  const file = Bun.file(`${worktreePath}/${path}`)
  if (!(await file.exists())) return null
  const buf = await file.arrayBuffer()
  return createHash('sha256').update(Buffer.from(buf)).digest('hex')
}

async function sha256OfBaseFile(
  worktreePath: string,
  baseSha: string,
  path: string,
): Promise<string | null> {
  const result = await runGit(worktreePath, ['show', `${baseSha}:${path}`])
  if (!result.ok) return null
  return createHash('sha256').update(result.stdout, 'utf8').digest('hex')
}
