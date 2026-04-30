// Orchestrator-side patch application (per docs/contracts/BUILD.md +
// docs/contracts/WORKTREE.md § "Patch application boundary").
//
// Two-step apply:
//   1. validate (path-safety scanner + size + binary/symlink rejection)
//   2. write patch file → `git apply --check` → `git apply --index`
//
// `--index` is non-negotiable: it ensures newly-added files become tracked
// so the manifest computation (computeManifest in src/worktree/manifest.ts)
// sees them in `git diff --name-status`.
//
// Per Codex M7 implementation review (thread 019ddeea): persona writes
// the patch as a fenced diff block in its response; orchestrator extracts,
// validates, computes sha/byte-count, applies. Persona-supplied sha/bytes
// claims are never authoritative.

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { runGit } from '../worktree/create-run-worktree.ts'
import { patchFilePath, runPaths } from '../worktree/paths.ts'
import { validatePatch, type PatchValidationOk } from './validate-agent-patch.ts'

export interface ApplyAgentPatchOptions {
  readonly cwd: string
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
  /** Raw unified-diff text from the persona response. */
  readonly patchContent: string
}

export interface ApplyAgentPatchOk {
  readonly ok: true
  readonly patchPath: string
  /** 64-char lower-case hex sha256 of the patch file bytes. */
  readonly patchSha256: string
  /** Byte count of the patch file. */
  readonly patchBytes: number
  /** Distinct paths the patch touches (collected by validator). */
  readonly paths: readonly string[]
}

export interface ApplyAgentPatchErr {
  readonly ok: false
  readonly code: string
  readonly reason: string
  /** Set when the failure happens AFTER a patch file was already written. */
  readonly patchPath?: string
}

export type ApplyAgentPatchResult = ApplyAgentPatchOk | ApplyAgentPatchErr

/**
 * Validates → writes → check-applies → applies a persona-supplied patch
 * into the run's worktree. Returns the canonical patch metadata that
 * the orchestrator copies into BUILD_REPORT.md.
 *
 * Caller emits worktree_patch_applied / worktree_patch_failed.
 */
export async function applyAgentPatch(
  opts: ApplyAgentPatchOptions,
): Promise<ApplyAgentPatchResult> {
  // Step 1 — validate header path-safety, size, binary/symlink rejection.
  const validation = validatePatch(opts.patchContent)
  if (!validation.ok) {
    return Object.freeze({
      ok: false as const,
      code: validation.code,
      reason: validation.reason,
    })
  }

  // Step 2 — compute sha256 + byte count BEFORE write so even a write
  // failure produces a complete failure record.
  const sha256 = createHash('sha256').update(opts.patchContent, 'utf8').digest('hex')
  const patchPath = patchFilePath(opts.cwd, opts.runId, opts.taskId, opts.attempt)

  // Step 3 — write patch file.
  try {
    await writeFile(patchPath, opts.patchContent, { encoding: 'utf8' })
  } catch (err) {
    return Object.freeze({
      ok: false as const,
      code: 'build_patch_write_failed',
      reason: (err as Error).message.slice(0, 200),
    })
  }

  // Step 4 — `git apply --check` (dry run). Failure goes to persona repair.
  const worktreePath = runPaths(opts.cwd, opts.runId).worktree
  const check = await runGit(worktreePath, ['apply', '--check', patchPath])
  if (!check.ok) {
    return Object.freeze({
      ok: false as const,
      code: 'build_patch_apply_check_failed',
      reason: check.stderr.trim().slice(0, 200) || 'git apply --check returned non-zero',
      patchPath,
    })
  }

  // Step 5 — `git apply --index`. The --index flag updates the index too
  // so newly-added files become tracked (visible to subsequent diff).
  const apply = await runGit(worktreePath, ['apply', '--index', patchPath])
  if (!apply.ok) {
    // If apply fails after --check passed, this is a partial-apply or
    // git environment bug, not a persona bug.
    return Object.freeze({
      ok: false as const,
      code: 'build_patch_partial_apply',
      reason: apply.stderr.trim().slice(0, 200) || 'git apply --index returned non-zero',
      patchPath,
    })
  }

  return Object.freeze({
    ok: true as const,
    patchPath,
    patchSha256: sha256,
    patchBytes: validation.bytes,
    paths: (validation as PatchValidationOk).paths,
  })
}
