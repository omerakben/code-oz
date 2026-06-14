// Provider-file-ref derivation helper.
//
// v0.20.2 showstopper #0b (Codex thread 019e2827, Option D verdict):
// BUILD and REVIEW phases need to pass file content to their provider
// invocations. The file-manifest pipeline at `src/providers/manifest.ts`
// already loads + hashes + intersects-with-permissions, but the
// orchestrator currently calls `productionInvokePersona` with
// `files: []`. This helper produces the `ProviderFileRef[]` array from
// either a selected PLAN task (BUILD) or a BUILD_REPORT's `changedFiles`
// (REVIEW).
//
// Three locked behaviors (Codex thread 019e2827):
//   1. Missing paths are skipped silently. `task.fileChanges[].change`
//      of `'added'` typically points at a path that does not exist yet
//      on the worktree; passing it through `buildManifest` would throw
//      ENOENT. The path remains visible to the builder via #0a's
//      TASK_BLOCK.
//   2. Paths are resolved against the run worktree, not the host cwd.
//      A naive implementation could leak host-checkout content. The
//      helper takes `worktreePath` explicitly to make this the only
//      possible resolution root.
//   3. The helper returns `ProviderFileRef[]` (path-only). The wrapper
//      at `src/providers/manifest.ts` does the read + sha256 +
//      sizeBytes step under its existing strict contract.
//
// Rule 18 (`tool_use.repo_context`) is NOT realized by this helper.
// No `repo_context_searched` events are emitted. The path is just an
// explicit-manifest expansion. Broader repo_context tool-use remains future work.

import { access, constants } from 'node:fs/promises'
import { resolve as resolvePath, sep } from 'node:path'

import type { PlanTask } from '../artifacts/plan.ts'
import type { ManifestEntry } from '../worktree/manifest.ts'
import type { ProviderFileRef } from '../providers/types.ts'

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a repo-relative path against the worktree root and verify the
 * result lives inside the worktree boundary. Returns the resolved
 * absolute path on success; returns null when the input traverses out
 * of the worktree (via `../` segments) or resolves to a different root.
 *
 * Background: `node:path.join` normalizes `../` segments, so
 * `join('/run/worktree', '../../etc/passwd')` returns `/etc/passwd`
 * — escaping the worktree boundary. PLAN.md is user-authored content,
 * so a malicious or buggy task could include traversal segments. The
 * helper enforces the boundary explicitly with `path.resolve` plus a
 * prefix check on the normalized result (Codex thread 019e2837
 * block-push #5).
 */
function safeWorktreeJoin(worktreeRoot: string, repoRelative: string): string | null {
  const normalizedRoot = resolvePath(worktreeRoot)
  const resolved = resolvePath(normalizedRoot, repoRelative)
  if (resolved === normalizedRoot) {
    // Edge case: empty or '.' path resolves to the root itself; never a file ref.
    return null
  }
  if (!resolved.startsWith(normalizedRoot + sep)) {
    return null
  }
  return resolved
}

/**
 * Derive `ProviderFileRef[]` from a selected PLAN task for BUILD invocation.
 *
 * Behavior:
 *   - For every entry in `task.fileChanges`, check whether the path exists
 *     on the worktree. If present, include a path-only `ProviderFileRef`.
 *     If absent (typical for `change: 'added'` on the first BUILD attempt),
 *     skip silently — the path is still visible to the builder through
 *     the TASK_BLOCK injection from v0.20.2 #0a.
 *   - Paths in `task.fileChanges` are repo-relative; the helper resolves
 *     them against `worktreePath`. This is the only resolution root to
 *     prevent any leakage of host-checkout content (a worktree-isolation
 *     bug Codex flagged as test #3 in the locked decisions).
 *
 * Returned refs use absolute paths so downstream `buildManifest` does not
 * need to know about the worktree root — it just reads the path. Per the
 * existing manifest contract, callers MUST ensure agent `permissions.read`
 * permits these paths; the wrapper layer enforces that before reading.
 */
export async function deriveBuildTaskFiles(
  task: PlanTask,
  worktreePath: string,
): Promise<ProviderFileRef[]> {
  const refs: ProviderFileRef[] = []
  for (const fc of task.fileChanges) {
    const absPath = safeWorktreeJoin(worktreePath, fc.path)
    if (absPath === null) continue
    if (await pathExists(absPath)) {
      refs.push({ path: absPath })
    }
  }
  return refs
}

/**
 * Derive `ProviderFileRef[]` from `BUILD_REPORT.changedFiles` for REVIEW
 * invocation. Symmetric counterpart to `deriveBuildTaskFiles`.
 *
 * Behavior:
 *   - Skips entries marked `change: 'deleted'` (the file no longer exists
 *     on the post-patch worktree; REVIEW reasons about deletions from the
 *     patch and BUILD_REPORT, not from absent file bytes).
 *   - For `'added'` and `'modified'` entries, includes the absolute path
 *     when the file exists. After a successful BUILD apply, both `'added'`
 *     and `'modified'` files are present in the worktree.
 *
 * v0.20.2 ships only the helper. REVIEW production wiring (passing this
 * helper's output into `runReview`'s invokePersona) is deferred to a
 * follow-up commit since the call surface in `src/phases/review.ts`
 * touches multiple sites and is logically independent of the BUILD fix.
 */
export async function deriveReviewChangedFiles(
  changedFiles: readonly ManifestEntry[],
  worktreePath: string,
): Promise<ProviderFileRef[]> {
  const refs: ProviderFileRef[] = []
  for (const entry of changedFiles) {
    if (entry.change === 'deleted') continue
    const absPath = safeWorktreeJoin(worktreePath, entry.path)
    if (absPath === null) continue
    if (await pathExists(absPath)) {
      refs.push({ path: absPath })
    }
  }
  return refs
}
