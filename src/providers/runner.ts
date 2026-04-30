// Subprocess runner abstraction. The seam where adapters meet the OS.
// Adapters take a Runner via constructor option so tests can inject a mock
// without ever spawning a real process — closes the offline-test discipline
// from the M4 kickoff.
//
// Default runner uses Bun.spawn. Buffered stdout/stderr (no streaming UX
// through code-oz in v0.1; CLIs handle their own UX on stderr). ENOENT
// surfaces verbatim so adapters can map it to provider_io_error with a
// "CLI not installed" rule.

import { Buffer } from 'node:buffer'

export interface RunnerOptions {
  /** Optional payload to write to the subprocess stdin. */
  readonly stdin?: string
  /** Working directory for the subprocess. Critical for Codex privacy guard
   * (run from empty temp cwd, not projectRoot). */
  readonly cwd?: string
  /** Environment overrides; merged onto process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface RunnerResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export type Runner = (
  cmd: string,
  args: readonly string[],
  options?: RunnerOptions,
) => Promise<RunnerResult>

/**
 * Default subprocess runner. Spawns via Bun.spawn, pipes stdin if supplied,
 * buffers stdout + stderr, returns the exit code. Throws when spawn itself
 * fails (e.g., ENOENT for missing binary) — adapters distinguish that from
 * a non-zero exit.
 */
export const defaultRunner: Runner = async (cmd, args, options = {}) => {
  const proc = Bun.spawn([cmd, ...(args as string[])], {
    stdin: options.stdin !== undefined ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: options.cwd,
    env: mergeEnv(options.env),
  })

  if (options.stdin !== undefined && proc.stdin !== undefined && proc.stdin !== null) {
    const sink = proc.stdin
    sink.write(Buffer.from(options.stdin, 'utf8'))
    sink.end()
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited

  return Object.freeze({
    stdout,
    stderr,
    exitCode: typeof exitCode === 'number' ? exitCode : -1,
  })
}

function mergeEnv(
  overrides?: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  if (overrides === undefined) return undefined
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete merged[k]
    } else {
      merged[k] = v
    }
  }
  return merged
}
