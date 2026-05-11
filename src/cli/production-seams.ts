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

// --- productionPanelistInvoker (M16 C8) ---------------------------

/**
 * Production-side per-panelist invocation seam used by `dispatchReview`
 * when `company.reviewer.panel.length >= 2`. Mirrors
 * `productionInvokePersona` but constructs a single `PanelistInvocationResult`
 * from the persona's structured JSON response.
 *
 * The contract: each panelist persona, when invoked, returns a JSON object
 * with the shape:
 *
 *   {
 *     "score": <0..10 integer>,
 *     "verdict": "ready" | "needs-revision" | "block",
 *     "findings": [
 *       { "file": "<path>", "line": "<grammar string>", "title": "<≤120>",
 *         "severity": "block"|"fix-first"|"nit"|"fyi",
 *         "recommendation": "<≤500>" },
 *       ...
 *     ],
 *     "manifestHash": "<64-hex>",
 *     "stagingContent": "<full Markdown for staging draft>"
 *   }
 *
 * Per Codex M14 R1 finding #3, `runReviewPanel` re-resolves the panelist's
 * runtime family via `registry.familyOf`; this seam reports an advisory
 * `providerFamily` value derived from the same registry but the orchestrator
 * never trusts it for verdict computation.
 *
 * Throws on malformed responses (the orchestrator surfaces the throw as
 * `panel_invocation_failed` intervention). Provider errors propagate
 * unchanged; `runReviewPanel` already maps them to a typed intervention.
 */
export interface ProductionPanelistInvokerOptions {
  /** Provider registry for the run; family resolution comes from
   *  `registry.familyOf(providerId)`. */
  readonly registry: import('../providers/registry.ts').ProviderRegistry
  /** Invoke context shared with the orchestrator (provider registry +
   *  runPaths + projectRoot + config). */
  readonly invokeCtx: InvokeContext
  /** Persona definition for each panelist. The orchestrator passes
   *  `cfg.id` / `cfg.provider` / `cfg.role` per call; the seam looks up
   *  the corresponding `AgentDefinition` here. v0.1 ships a single
   *  bundled `reviewer` persona shared across panelists; this map lets a
   *  future profile differentiate per-panelist personas without changing
   *  the seam shape. Falls back to `defaultAgent` when the panelist id
   *  is not in the map. */
  readonly agents: ReadonlyMap<string, AgentDefinition>
  /** Default panelist persona when `agents.get(panelistId)` returns
   *  undefined. Required because the `PanelistInvoker` callback does not
   *  receive the AgentDefinition directly. */
  readonly defaultAgent: AgentDefinition
  /** Run identity threaded onto each ProviderRequest. */
  readonly runId: string
  /** Composed prompt builder for the panelist. The orchestrator (single-
   *  mode) holds the prompt composer for review; for the seam, the
   *  builder is supplied by the dispatcher and may share scaffolding
   *  with `composeReviewPrompt`. */
  readonly composePrompt: (
    panelistConfig: {
      readonly id: string
      readonly provider: string
      readonly role: 'voter' | 'advisory'
      readonly model?: string
    },
    round: number,
  ) => Promise<string>
  /** File manifest threaded onto every panelist's ProviderRequest. v0.1
   *  uses a single shared manifest (M14 manifest equality invariant). */
  readonly files?: readonly ProviderFileRef[]
  /** Optional max-output-tokens cap. */
  readonly maxOutputTokens?: number
  /** Streaming callback (mirrors productionInvokePersona). */
  readonly onChunk?: (panelistId: string, text: string) => void
}

class PanelistResponseParseError extends Error {
  constructor(panelistId: string, reason: string) {
    super(`productionPanelistInvoker: panelist '${panelistId}' response parse failed — ${reason}`)
    this.name = 'PanelistResponseParseError'
  }
}

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/
const PANELIST_SCORE_MIN = 0
const PANELIST_SCORE_MAX = 10
const PANELIST_VERDICTS = ['ready', 'needs-revision', 'block'] as const
const PANELIST_SEVERITIES = ['block', 'fix-first', 'nit', 'fyi'] as const

interface ParsedPanelistResponse {
  readonly score: number
  readonly verdict: 'ready' | 'needs-revision' | 'block'
  readonly findings: readonly {
    readonly file: string
    readonly line: string
    readonly title: string
    readonly severity: 'block' | 'fix-first' | 'nit' | 'fyi'
    readonly recommendation: string
  }[]
  readonly manifestHash: string
  readonly stagingContent: string
}

function parsePanelistResponse(
  panelistId: string,
  raw: string,
): ParsedPanelistResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new PanelistResponseParseError(
      panelistId,
      `not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PanelistResponseParseError(panelistId, 'top-level value is not a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.score !== 'number' || !Number.isInteger(obj.score) || obj.score < PANELIST_SCORE_MIN || obj.score > PANELIST_SCORE_MAX) {
    throw new PanelistResponseParseError(panelistId, `score must be an integer in [${PANELIST_SCORE_MIN}, ${PANELIST_SCORE_MAX}]`)
  }
  if (typeof obj.verdict !== 'string' || !(PANELIST_VERDICTS as readonly string[]).includes(obj.verdict)) {
    throw new PanelistResponseParseError(panelistId, `verdict must be one of: ${PANELIST_VERDICTS.join(' | ')}`)
  }
  if (!Array.isArray(obj.findings)) {
    throw new PanelistResponseParseError(panelistId, 'findings must be an array')
  }
  const findings = obj.findings.map((f, i) => {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) {
      throw new PanelistResponseParseError(panelistId, `findings[${i}] must be an object`)
    }
    const finding = f as Record<string, unknown>
    if (typeof finding.file !== 'string' || finding.file.length === 0) {
      throw new PanelistResponseParseError(panelistId, `findings[${i}].file must be a non-empty string`)
    }
    if (typeof finding.line !== 'string') {
      throw new PanelistResponseParseError(panelistId, `findings[${i}].line must be a string`)
    }
    if (typeof finding.title !== 'string' || finding.title.length === 0) {
      throw new PanelistResponseParseError(panelistId, `findings[${i}].title must be a non-empty string`)
    }
    if (
      typeof finding.severity !== 'string' ||
      !(PANELIST_SEVERITIES as readonly string[]).includes(finding.severity)
    ) {
      throw new PanelistResponseParseError(panelistId, `findings[${i}].severity must be one of: ${PANELIST_SEVERITIES.join(' | ')}`)
    }
    if (typeof finding.recommendation !== 'string') {
      throw new PanelistResponseParseError(panelistId, `findings[${i}].recommendation must be a string`)
    }
    return Object.freeze({
      file: finding.file,
      line: finding.line,
      title: finding.title,
      severity: finding.severity as 'block' | 'fix-first' | 'nit' | 'fyi',
      recommendation: finding.recommendation,
    })
  })
  if (typeof obj.manifestHash !== 'string' || !SHA256_HEX_REGEX.test(obj.manifestHash)) {
    throw new PanelistResponseParseError(panelistId, 'manifestHash must be a 64-char lowercase hex string')
  }
  if (typeof obj.stagingContent !== 'string' || obj.stagingContent.length === 0) {
    throw new PanelistResponseParseError(panelistId, 'stagingContent must be a non-empty string')
  }
  return Object.freeze({
    score: obj.score,
    verdict: obj.verdict as 'ready' | 'needs-revision' | 'block',
    findings: Object.freeze(findings),
    manifestHash: obj.manifestHash,
    stagingContent: obj.stagingContent,
  })
}

/**
 * Build a `PanelistInvoker` shim suitable for `runReview({ panelistInvoker })`.
 * Production dispatchReview composes this once per panel-mode invocation; the
 * closure captures `invokeCtx` + the per-panelist persona registry so the
 * panel runtime can iterate over panelists without re-resolving each time.
 *
 * Each call:
 *   1. Resolves the panelist's persona via `agents.get(id)` or
 *      `defaultAgent`.
 *   2. Composes the panelist-specific prompt via `composePrompt(cfg, round)`.
 *   3. Invokes the persona via `invokeAgent` and drains the stream.
 *   4. Parses the persona's structured JSON response.
 *   5. Returns a `PanelistInvocationResult` with the registry-resolved
 *      `providerFamily` (advisory only — `runReviewPanel` re-resolves).
 *
 * Throws `PanelistResponseParseError` on malformed responses; throws the
 * underlying `ProviderError` on provider failures. `runReviewPanel`
 * surfaces both as a typed intervention.
 */
export function productionPanelistInvoker(
  opts: ProductionPanelistInvokerOptions,
): import('../phases/review-panel.ts').PanelistInvoker {
  return async (cfg, round, invokeCtx) => {
    const agent = opts.agents.get(cfg.id) ?? opts.defaultAgent
    const composedPrompt = await opts.composePrompt(cfg, round)
    const req: ProviderRequest = {
      agent,
      phase: 'review',
      runId: opts.runId,
      prompt: composedPrompt,
      files: opts.files ?? [],
      ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      // 09-byterover-cli B3 (Codex thread `019e1318`): correlate every
      // panelist provider call back to the panel operation's task id.
      // `runReviewPanel` always passes the ctx; defensive `?.` keeps
      // pre-B3 fixtures and test seams that omit it from breaking.
      ...(invokeCtx?.parentTaskId !== undefined
        ? { parentTaskId: invokeCtx.parentTaskId }
        : {}),
    }
    let final: ProviderResponse | null = null
    const stream: AsyncIterable<ProviderEvent> = invokeAgent(opts.invokeCtx, req)
    for await (const ev of stream) {
      if (ev.type === 'content_chunk' && opts.onChunk !== undefined) {
        opts.onChunk(cfg.id, ev.text)
      }
      if (ev.type === 'turn_completed') {
        final = ev.response
      }
    }
    if (final === null) {
      throw new Error(
        `productionPanelistInvoker: panelist '${cfg.id}' stream ended without turn_completed event`,
      )
    }
    const parsed = parsePanelistResponse(cfg.id, final.content)
    let providerFamily: import('../providers/types.ts').ProviderFamily
    try {
      providerFamily = opts.registry.familyOf(cfg.provider)
    } catch (err) {
      throw new Error(
        `productionPanelistInvoker: registry.familyOf('${cfg.provider}') failed — ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return Object.freeze({
      panelistId: cfg.id,
      providerId: cfg.provider,
      providerFamily,
      modelPolicy: cfg.model ?? agent.model ?? 'any',
      role: cfg.role,
      score: parsed.score,
      verdict: parsed.verdict,
      findings: parsed.findings,
      manifestHash: parsed.manifestHash,
      stagingContent: parsed.stagingContent,
    })
  }
}

// Exported for tests so they can assert the parser surface independently.
export { PanelistResponseParseError }

// Re-exports so consumers import seam types from one location.
export type {
  ChangedFileEntry,
  MutationRunnerInput,
  RevertSeam,
  RunnerResultShape,
  RunnerSeam,
} from '../phases/verify-mutation.ts'
