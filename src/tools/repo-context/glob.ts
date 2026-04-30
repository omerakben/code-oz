// Glob via `rg --files --glob`.
//
// rg honors .gitignore by default; we leave that on. `--null-data` simplifies
// path delimiting, but we just split on '\n' since we don't expect filenames
// containing newlines for code-oz fixtures. Output is paths relative to the
// project root.

import { spawn } from 'node:child_process'
import { relative } from 'node:path'
import { RepoContextError } from './errors.ts'
import type { GlobArgs, GlobResult } from './types.ts'

export interface GlobOptions {
  readonly maxResults: number
  readonly maxBytesPerResult: number
  readonly timeoutMs: number
  readonly projectRoot: string
  readonly effectiveRoots: readonly string[]
}

export async function execGlob(args: GlobArgs, opts: GlobOptions): Promise<GlobResult> {
  if (typeof args.pattern !== 'string' || args.pattern.length === 0) {
    throw new RepoContextError([
      { code: 'tool_invalid_arg', rule: 'glob.pattern must be a non-empty string', tool: 'glob' },
    ])
  }
  const cliArgs = ['--files', '--glob', args.pattern, '--no-messages', ...opts.effectiveRoots]
  const { stdout } = await runRg(cliArgs, opts.timeoutMs, 'glob')
  const allPaths = stdout
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((abs) => relative(opts.projectRoot, abs) || abs)

  const cap = opts.maxResults
  const truncated = allPaths.length > cap
  const paths = truncated ? allPaths.slice(0, cap) : allPaths

  let resultBytes = 0
  for (const p of paths) resultBytes += Buffer.byteLength(p, 'utf8') + 1
  return Object.freeze({
    tool: 'glob',
    paths: Object.freeze(paths),
    truncated,
    resultBytes,
  })
}

interface RgRunResult {
  readonly stdout: string
  readonly stderr: string
}

async function runRg(args: readonly string[], timeoutMs: number, tool: 'glob' | 'grep'): Promise<RgRunResult> {
  return await new Promise<RgRunResult>((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('rg', args as string[], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      rejectPromise(
        new RepoContextError([
          {
            code: 'tool_unavailable',
            rule: 'failed to spawn `rg`; is ripgrep on PATH?',
            detail: (err as Error).message,
            tool,
          },
        ]),
      )
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      // ENOENT: rg missing.
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        rejectPromise(
          new RepoContextError([
            {
              code: 'tool_unavailable',
              rule: '`rg` (ripgrep) not on PATH',
              detail: 'install ripgrep — see https://github.com/BurntSushi/ripgrep#installation',
              tool,
            },
          ]),
        )
      } else {
        rejectPromise(
          new RepoContextError([
            {
              code: 'tool_subprocess_failed',
              rule: 'rg subprocess failed',
              detail: err.message,
              tool,
            },
          ]),
        )
      }
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        rejectPromise(
          new RepoContextError([
            {
              code: 'tool_timeout',
              rule: `rg subprocess exceeded ${timeoutMs}ms`,
              tool,
            },
          ]),
        )
        return
      }
      // rg exits 1 when no matches found; that's a success for us.
      if (exitCode !== null && exitCode !== 0 && exitCode !== 1) {
        rejectPromise(
          new RepoContextError([
            {
              code: 'tool_subprocess_failed',
              rule: `rg exited with code ${exitCode}`,
              detail: stderr.slice(0, 500),
              tool,
            },
          ]),
        )
        return
      }
      resolvePromise({ stdout, stderr })
    })
  })
}

// Re-export for grep.ts to share the runner without circular imports.
export { runRg }
