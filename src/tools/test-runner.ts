// VERIFY's validation-command runner.
//
// Spawns the parsed argv via Bun.spawn (no shell), streams stdout/stderr to
// forensics log files as bytes arrive (so a crash mid-execution still leaves
// partial logs), and kills the child when caps or timeout fire. Returns a
// discriminated `terminationReason` so downstream code (the mutation gate, the
// VERIFY verdict logic) can distinguish abnormal kills — timeout, cap kill,
// spawn failure — from an ordinary exit. This is the load-bearing shape Codex
// named in CODEX_RESPONSE_M8.md decision 1's accept-with-modifications:
// mutation pass requires `terminationReason: 'exit'`; the other reasons are
// VERIFY failures or intervention, never mutation success.
//
// Process model:
//   1. Parse the raw command via parseValidationCommand (argv-only grammar).
//   2. Open both forensics log file handles for write+truncate.
//   3. Spawn with Bun.spawn in argv form, scrubbed env, cwd pinned, signal
//      from a single AbortController.
//   4. Concurrently consume stdout and stderr ReadableStreams. On each chunk,
//      append to the log file and accumulate the byte counter; if the cap
//      would be exceeded, write only the remaining slice, mark truncated,
//      flag the cap reason, and abort the child.
//   5. Race child.exited against a timer; on timer fire, flag timeout and
//      abort. Either path resolves child.exited.
//   6. Close log handles, compute durationMs, derive terminationReason from
//      the priority order: spawn-error > timeout > stdout-cap > stderr-cap >
//      exit. (spawn-error is handled before any other state is created.)
//
// Privacy / sandboxing posture (per CLAUDE.md non-negotiable rule 13 +
// CODEX_RESPONSE_M8.md "Risks Claude is not seeing"): the runner spawns with
// a small allowlisted env (PATH, HOME, LANG) plus any caller-supplied
// overrides. `network: 'none'` in the permission manifest is a contract, not
// OS isolation; W4 containerization is the hostile-code defense. The
// allowlist here is the load-bearing token-leak guard until then.

import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseValidationCommand } from './command-grammar.ts'

export type TerminationReason =
  | 'exit'
  | 'timeout'
  | 'stdout-cap'
  | 'stderr-cap'
  | 'spawn-error'

export interface RunValidationCommandInput {
  /** Raw single-line command string from BUILD_REPORT.md / VERIFY.md. */
  readonly command: string
  /** Working directory for the child. Must be a non-empty path. */
  readonly cwd: string
  /** Wall-clock timeout in ms. Must be a positive integer. */
  readonly timeoutMs: number
  /** Forensics log path for stdout. Parent directory is created if missing. */
  readonly stdoutLogPath: string
  /** Forensics log path for stderr. Parent directory is created if missing. */
  readonly stderrLogPath: string
  /** Maximum bytes captured from stdout before kill. Must be a positive integer. */
  readonly maxStdoutBytes: number
  /** Maximum bytes captured from stderr before kill. Must be a positive integer. */
  readonly maxStderrBytes: number
  /**
   * Optional env overrides merged onto the scrubbed allowlist (PATH, HOME, LANG).
   * Unset keys (value === undefined) are deleted. Defaults to none.
   */
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface RunValidationCommandResult {
  /** Process exit code, or `null` when the child never exited cleanly (spawn-error). */
  readonly exitCode: number | null
  readonly durationMs: number
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly truncated: { readonly stdout: boolean; readonly stderr: boolean }
  /** True iff the timer fired before the child exited. Equivalent to terminationReason === 'timeout'. */
  readonly timedOut: boolean
  readonly terminationReason: TerminationReason
  /** Populated only when terminationReason === 'spawn-error'. */
  readonly spawnError?: string
}

export class TestRunnerInputError extends Error {
  readonly field: string
  constructor(field: string, detail: string) {
    super(`runValidationCommand input: ${field} — ${detail}`)
    this.name = 'TestRunnerInputError'
    this.field = field
  }
}

const ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG'] as const

function scrubbedEnv(
  overrides?: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key]
    if (v !== undefined) env[key] = v
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
  return env
}

function validateInput(input: RunValidationCommandInput): void {
  if (typeof input.cwd !== 'string' || input.cwd.length === 0) {
    throw new TestRunnerInputError('cwd', 'must be a non-empty string')
  }
  for (const field of ['timeoutMs', 'maxStdoutBytes', 'maxStderrBytes'] as const) {
    const v = input[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw new TestRunnerInputError(field, 'must be a positive integer')
    }
  }
  if (typeof input.stdoutLogPath !== 'string' || input.stdoutLogPath.length === 0) {
    throw new TestRunnerInputError('stdoutLogPath', 'must be a non-empty string')
  }
  if (typeof input.stderrLogPath !== 'string' || input.stderrLogPath.length === 0) {
    throw new TestRunnerInputError('stderrLogPath', 'must be a non-empty string')
  }
}

interface StreamCapResult {
  readonly bytes: number
  readonly truncated: boolean
}

async function streamWithCap(
  stream: ReadableStream<Uint8Array> | null,
  fh: FileHandle,
  cap: number,
  onCapExceeded: () => void,
): Promise<StreamCapResult> {
  if (stream === null) return Object.freeze({ bytes: 0, truncated: false })
  let bytes = 0
  let truncated = false
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const chunk = value
      const remaining = cap - bytes
      if (chunk.byteLength <= remaining) {
        await fh.write(chunk)
        bytes += chunk.byteLength
        continue
      }
      // Cap would be exceeded by this chunk — write the partial slice that
      // fits, mark truncated, signal cap-exceeded, then drain the reader so
      // the spawn can exit cleanly after the kill propagates.
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining)
        await fh.write(slice)
        bytes += remaining
      }
      truncated = true
      onCapExceeded()
      // Drain remaining chunks but discard them — the kill is in flight.
      while (true) {
        const drain = await reader.read()
        if (drain.done) break
      }
      break
    }
  } finally {
    reader.releaseLock()
  }
  return Object.freeze({ bytes, truncated })
}

async function ensureParentDir(path: string): Promise<void> {
  const parent = dirname(path)
  if (parent && parent !== '.' && parent !== '/') {
    await mkdir(parent, { recursive: true })
  }
}

export async function runValidationCommand(
  input: RunValidationCommandInput,
): Promise<RunValidationCommandResult> {
  validateInput(input)

  // Grammar parse — propagates CommandGrammarError up. The runner does not
  // catch it: malformed commands are persona/contract bugs, not runtime
  // failures, and the VERIFY.md parser will map the reason to a verify_*
  // error code.
  const parsed = parseValidationCommand(input.command)

  await ensureParentDir(input.stdoutLogPath)
  await ensureParentDir(input.stderrLogPath)

  const stdoutFh = await open(input.stdoutLogPath, 'w')
  const stderrFh = await open(input.stderrLogPath, 'w')

  const start = performance.now()

  // Spawn-error path: catch synchronous throws (e.g., ENOENT for unresolved
  // executables, bad cwd). Bun.spawn does not surface every failure
  // synchronously — some bubble through .exited as non-zero — but the
  // synchronous case must be handled distinctly so callers can tell a
  // genuine non-zero exit from a never-started child.
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([parsed.executable, ...parsed.args], {
      cwd: input.cwd,
      env: scrubbedEnv(input.env),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (err) {
    await stdoutFh.close()
    await stderrFh.close()
    return Object.freeze({
      exitCode: null,
      durationMs: Math.round(performance.now() - start),
      stdoutBytes: 0,
      stderrBytes: 0,
      truncated: Object.freeze({ stdout: false, stderr: false }),
      timedOut: false,
      terminationReason: 'spawn-error' as const,
      spawnError: err instanceof Error ? err.message : String(err),
    })
  }

  let timedOut = false
  let stdoutCapped = false
  let stderrCapped = false

  const killChild = (): void => {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already exited.
    }
  }

  const timer = setTimeout(() => {
    timedOut = true
    killChild()
  }, input.timeoutMs)

  const stdoutPromise = streamWithCap(
    child.stdout as ReadableStream<Uint8Array> | null,
    stdoutFh,
    input.maxStdoutBytes,
    () => {
      stdoutCapped = true
      killChild()
    },
  )
  const stderrPromise = streamWithCap(
    child.stderr as ReadableStream<Uint8Array> | null,
    stderrFh,
    input.maxStderrBytes,
    () => {
      stderrCapped = true
      killChild()
    },
  )

  const exitCodeRaw = await child.exited
  clearTimeout(timer)

  const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise])

  await stdoutFh.close()
  await stderrFh.close()

  const durationMs = Math.round(performance.now() - start)

  // Priority: timeout > stdout-cap > stderr-cap > exit. A timeout that races
  // a cap kill is recorded as timeout; a stdout cap that races a stderr cap
  // is recorded as stdout-cap. The order matches what's most diagnostic
  // upstream — a timed-out test had its log clipped; a capped test never
  // got a chance to time out.
  let terminationReason: TerminationReason
  if (timedOut) terminationReason = 'timeout'
  else if (stdoutCapped) terminationReason = 'stdout-cap'
  else if (stderrCapped) terminationReason = 'stderr-cap'
  else terminationReason = 'exit'

  const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : null

  return Object.freeze({
    exitCode,
    durationMs,
    stdoutBytes: stdoutResult.bytes,
    stderrBytes: stderrResult.bytes,
    truncated: Object.freeze({
      stdout: stdoutResult.truncated,
      stderr: stderrResult.truncated,
    }),
    timedOut,
    terminationReason,
  })
}

// Re-export so callers can `import { CommandGrammarError } from './test-runner.ts'`
// when they want to handle grammar rejection alongside runner failures.
export { CommandGrammarError } from './command-grammar.ts'
