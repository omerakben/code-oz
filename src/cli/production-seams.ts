// Production-side seams composed by the CLI dispatchers (C6/C7/C8 in M16).
//
// Phase functions (`runBuild`, `runVerify`, `runReview`) accept seams as
// options. Tests inject canned shims (see
// `tests/e2e/review-lite-greenfield-pass.test.ts:445-457`); production
// dispatchers compose the real implementations exported here. M16 ships
// the seams; the dispatchers that consume them land in C6/C7/C8.
//
// Three exports:
//
//   1. productionInvokePersona — wraps `invokeAgent` and drains the
//      AsyncIterable<ProviderEvent> into the final `turn_completed`
//      content. Optional `onChunk` callback forwards `content_chunk`
//      events for streaming progress UX. Replaces the test-shim
//      `invokePersona: async () => CANNED_TEXT`.
//
//   2. productionRunner — implements `RunnerSeam` by composing the
//      already-extant `runValidationCommand` (src/tools/test-runner.ts).
//      That helper handles every contract bullet from R0 Risk #7
//      (timeout kill, stdout/stderr truncation, log paths,
//      'spawn-error' on synchronous spawn failures). C3 does NOT
//      duplicate the spawn logic.
//
//   3. productionRevertSeam — implements `RevertSeam` against a real
//      git worktree. snapshot reads current contents into memory;
//      revert dispatches per `change` flag (added → unlink,
//      modified/deleted → `git checkout <baseSha> -- <path>`); restore
//      writes contents back (or unlinks where the snapshot indicates
//      the file did not exist before). All paths resolved under
//      worktreeRoot — escapes are rejected.
//
// Wall-time vs. run-level budget (R0 caveat in C3 handoff): the runner
// honors per-attempt `timeoutMs`. It does NOT consult
// `budgets.global.maxWallTimeMinutes` — that is the orchestrator's
// concern. M17 / W2 may extend if needed.

import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { AgentDefinition } from '../agents/schema.ts'
import type { CompanyRole } from '../agents/role.ts'
import type {
  ChangedFileEntry,
  MutationRunnerInput,
  RevertSeam,
  RunnerResultShape,
  RunnerSeam,
} from '../phases/verify-mutation.ts'
import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import type {
  ProviderEvent,
  ProviderFileRef,
  ProviderRequest,
  ProviderResponse,
} from '../providers/types.ts'
import type { Phase } from '../state/schemas.ts'
import {
  runValidationCommand,
  type RunValidationCommandInput,
  type RunValidationCommandResult,
} from '../tools/test-runner.ts'

// --- productionInvokePersona ---------------------------------------

export interface ProductionInvokePersonaOptions {
  /** Phase identity threaded onto every ProviderRequest. */
  readonly phase: Phase
  /** Run identity threaded onto every ProviderRequest. */
  readonly runId: string
  /**
   * File manifest threaded onto every ProviderRequest. Defaults to an
   * empty array; callers that need to send files (BUILD, REVIEW) populate
   * this with the paths their persona may read. The wrapper layer
   * intersects against `agent.permissions.read` and rejects escapes.
   */
  readonly files?: readonly ProviderFileRef[]
  /**
   * Bundled `CompanyRole` identity for per-role budget gating. Computed
   * via `canonicalRoleFromAgent(agent)` at the call site so it is
   * `undefined` for project-local personas (which still gate against
   * global + per-phase budgets). Forwarded to ProviderRequest only when
   * present, mirroring `src/phases/ask-me.ts:439-447`.
   */
  readonly role?: CompanyRole
  /** Optional model override (rare; defaults to `agent.model`). */
  readonly model?: string
  /** Optional max-output-tokens cap. */
  readonly maxOutputTokens?: number
  /**
   * Streaming progress callback. When provided, fires for every
   * `content_chunk` event as it arrives. The CLI dispatcher decides
   * what to print (a dot, the agent name + chunk count, or the chunk
   * text itself). The seam itself does no I/O — non-TTY environments
   * stay clean by default.
   */
  readonly onChunk?: (text: string) => void
}

/**
 * Build a `(composedPrompt) => Promise<string>` shim suitable for
 * `runBuild({ invokePersona })`, `runVerify({ invokePersona })`, and
 * `runReview({ invokePersona })`. Production dispatchers (C6/C7/C8)
 * compose this once per phase invocation; the closure captures the
 * agent + invokeCtx so the shim signature stays minimal.
 *
 * Throws when the underlying provider stream ends without a
 * `turn_completed` event (matches `collectProviderResponse` at
 * `src/providers/fake.ts:259-272`). Provider errors surface as
 * thrown `ProviderError`; phase functions already catch and translate
 * those into intervention results.
 */
export function productionInvokePersona(
  invokeCtx: InvokeContext,
  agent: AgentDefinition,
  opts: ProductionInvokePersonaOptions,
): (composedPrompt: string) => Promise<string> {
  return async (composedPrompt) => {
    const req: ProviderRequest = {
      agent,
      phase: opts.phase,
      runId: opts.runId,
      prompt: composedPrompt,
      files: opts.files ?? [],
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.role !== undefined ? { role: opts.role } : {}),
    }
    let final: ProviderResponse | null = null
    const stream: AsyncIterable<ProviderEvent> = invokeAgent(invokeCtx, req)
    for await (const ev of stream) {
      if (ev.type === 'content_chunk' && opts.onChunk !== undefined) {
        opts.onChunk(ev.text)
      }
      if (ev.type === 'turn_completed') {
        final = ev.response
      }
    }
    if (final === null) {
      throw new Error('productionInvokePersona: stream ended without turn_completed event')
    }
    return final.content
  }
}

// --- productionRunner ----------------------------------------------

export interface ProductionRunnerOptions {
  /**
   * Test-only override. Production callers pass nothing and get the
   * real `runValidationCommand`. Tests inject a stub to exercise the
   * adapter contract without spawning a subprocess.
   */
  readonly runner?: (input: RunValidationCommandInput) => Promise<RunValidationCommandResult>
}

/**
 * Build a `RunnerSeam` backed by `runValidationCommand`. The helper
 * already implements every R0 Risk #7 bullet (timeout kill,
 * stdout/stderr truncation, log paths, 'spawn-error' on synchronous
 * spawn failures); we just translate the seam's
 * `MutationRunnerInput` onto its input shape and return the result.
 *
 * `RunValidationCommandResult` is a structural superset of
 * `RunnerResultShape` (it carries the same `terminationReason`,
 * `exitCode`, `durationMs`, `stdoutBytes`, `stderrBytes`, and a
 * required `truncated` block where the seam type marks it optional).
 * The function signature widens the return to `RunnerResultShape` so
 * downstream `mutationStatusFromResult` reads exactly the fields it
 * cares about and the runner's extras (`timedOut`, `spawnError`) stay
 * available to anything that wants them.
 */
export function productionRunner(opts: ProductionRunnerOptions = {}): RunnerSeam {
  const runner = opts.runner ?? runValidationCommand
  return async (input: MutationRunnerInput): Promise<RunnerResultShape> => {
    const result = await runner({
      command: input.command,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      stdoutLogPath: input.stdoutLogPath,
      stderrLogPath: input.stderrLogPath,
      maxStdoutBytes: input.maxStdoutBytes,
      maxStderrBytes: input.maxStderrBytes,
    })
    return result
  }
}

// --- productionRevertSeam ------------------------------------------

/**
 * Snapshot value for a single path: `null` when the file did not exist
 * before revert (so restore should remove anything currently present);
 * a Buffer otherwise. The map is the opaque `unknown` returned by
 * `snapshot()` and consumed by `restore()`.
 */
type SnapshotMap = ReadonlyMap<string, Buffer | null>

export interface ProductionRevertSeamOptions {
  /**
   * Test-only override for the git checkout invocation. Production
   * callers pass nothing and the seam spawns `git -C <worktreeRoot>
   * checkout <baseSha> -- <path>`. Tests inject a recorder + a stub
   * filesystem mutation so they don't need a real git repo.
   */
  readonly gitCheckout?: (input: {
    readonly worktreeRoot: string
    readonly baseCommitSha: string
    readonly path: string
  }) => Promise<void>
}

class WorktreeEscapeError extends Error {
  constructor(path: string, worktreeRoot: string) {
    super(`productionRevertSeam: path escapes worktree root: ${path} (root=${worktreeRoot})`)
    this.name = 'WorktreeEscapeError'
  }
}

class GitCheckoutError extends Error {
  readonly path: string
  readonly baseCommitSha: string
  readonly exitCode: number | null
  readonly stderr: string
  constructor(input: {
    readonly path: string
    readonly baseCommitSha: string
    readonly exitCode: number | null
    readonly stderr: string
  }) {
    super(
      `productionRevertSeam: git checkout failed for ${input.path} @ ${input.baseCommitSha} (exit=${input.exitCode}): ${input.stderr.trim()}`,
    )
    this.name = 'GitCheckoutError'
    this.path = input.path
    this.baseCommitSha = input.baseCommitSha
    this.exitCode = input.exitCode
    this.stderr = input.stderr
  }
}

function resolveInsideWorktree(worktreeRoot: string, p: string): string {
  const root = resolve(worktreeRoot)
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new WorktreeEscapeError(p, worktreeRoot)
  }
  return abs
}

async function defaultGitCheckout(input: {
  readonly worktreeRoot: string
  readonly baseCommitSha: string
  readonly path: string
}): Promise<void> {
  const proc = Bun.spawn(
    ['git', '-C', input.worktreeRoot, 'checkout', input.baseCommitSha, '--', input.path],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text()
    throw new GitCheckoutError({
      path: input.path,
      baseCommitSha: input.baseCommitSha,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      stderr,
    })
  }
}

async function readIfExists(absPath: string): Promise<Buffer | null> {
  if (!existsSync(absPath)) return null
  return await readFile(absPath)
}

async function ensureParentDir(absPath: string): Promise<void> {
  const parent = dirname(absPath)
  if (parent && parent !== absPath) {
    await mkdir(parent, { recursive: true })
  }
}

/**
 * Build a `RevertSeam` rooted at `worktreeRoot`. All file operations
 * resolve under that root; relative inputs join against it; absolute
 * inputs that escape it throw `WorktreeEscapeError`. Top-level repo
 * touches are impossible by construction.
 */
export function productionRevertSeam(
  worktreeRoot: string,
  opts: ProductionRevertSeamOptions = {},
): RevertSeam {
  const gitCheckout = opts.gitCheckout ?? defaultGitCheckout

  return Object.freeze({
    async snapshot(paths: readonly string[]): Promise<unknown> {
      const map = new Map<string, Buffer | null>()
      for (const p of paths) {
        const abs = resolveInsideWorktree(worktreeRoot, p)
        const content = await readIfExists(abs)
        map.set(abs, content)
      }
      return map as SnapshotMap
    },

    async revert(files: readonly ChangedFileEntry[], baseCommitSha: string): Promise<void> {
      for (const file of files) {
        const abs = resolveInsideWorktree(worktreeRoot, file.path)
        if (file.change === 'added') {
          // The file did not exist at baseCommitSha — delete the
          // post-build copy so the replay sees the pre-build worktree.
          if (existsSync(abs)) {
            await unlink(abs)
          }
          continue
        }
        // 'modified' or 'deleted': git checkout restores the path to
        // its base contents. For 'deleted' this re-creates the file;
        // for 'modified' it overwrites.
        await ensureParentDir(abs)
        await gitCheckout({
          worktreeRoot,
          baseCommitSha,
          path: file.path,
        })
      }
    },

    async restore(snapshot: unknown): Promise<void> {
      if (!(snapshot instanceof Map)) {
        throw new Error(
          'productionRevertSeam.restore: snapshot is not the value returned by snapshot()',
        )
      }
      const typed = snapshot as SnapshotMap
      for (const [abs, content] of typed) {
        if (content === null) {
          // The path did not exist before revert; if revert/replay
          // re-created it (e.g. 'deleted' branch), undo that.
          if (existsSync(abs)) {
            await unlink(abs)
          }
          continue
        }
        await ensureParentDir(abs)
        await writeFile(abs, content)
      }
    },
  })
}

// Re-exports so consumers import seam types from one location.
export type {
  ChangedFileEntry,
  MutationRunnerInput,
  RevertSeam,
  RunnerResultShape,
  RunnerSeam,
} from '../phases/verify-mutation.ts'
