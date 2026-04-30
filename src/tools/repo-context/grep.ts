// Grep via `rg <pattern>`. Returns matches with file path, line number, and
// a snippet capped at GREP_SNIPPET_MAX_CHARS.

import { relative } from 'node:path'
import { runRg } from './glob.ts'
import { RepoContextError } from './errors.ts'
import { GREP_SNIPPET_MAX_CHARS, type GrepArgs, type GrepMatch, type GrepResult } from './types.ts'

export interface GrepOptions {
  readonly maxResults: number
  readonly maxBytesPerResult: number
  readonly timeoutMs: number
  readonly projectRoot: string
  readonly effectiveRoots: readonly string[]
}

export async function execGrep(args: GrepArgs, opts: GrepOptions): Promise<GrepResult> {
  if (typeof args.pattern !== 'string' || args.pattern.length === 0) {
    throw new RepoContextError([
      { code: 'tool_invalid_arg', rule: 'grep.pattern must be a non-empty string', tool: 'grep' },
    ])
  }
  // rg flags:
  //   --line-number — emit `path:line:text`
  //   --color never — clean output
  //   --no-heading  — flat lines, no per-file headers
  //   --max-count   — cap matches per file (also bounded globally below)
  //   -F            — fixed-string match (when args.regex !== true)
  //   -i            — ignore case (when args.ignoreCase === true)
  const cliArgs: string[] = ['--line-number', '--color=never', '--no-heading']
  if (args.regex !== true) cliArgs.push('-F')
  if (args.ignoreCase === true) cliArgs.push('-i')
  cliArgs.push(args.pattern)
  cliArgs.push(...opts.effectiveRoots)

  const { stdout } = await runRg(cliArgs, opts.timeoutMs, 'grep')
  const lines = stdout.split('\n').filter((l) => l.length > 0)

  const matches: GrepMatch[] = []
  let truncated = false
  for (const line of lines) {
    const m = parseRgLine(line)
    if (m === null) continue
    if (matches.length >= opts.maxResults) {
      truncated = true
      break
    }
    const rel = relative(opts.projectRoot, m.path) || m.path
    matches.push(
      Object.freeze({
        path: rel,
        line: m.line,
        snippet:
          m.snippet.length > GREP_SNIPPET_MAX_CHARS
            ? m.snippet.slice(0, GREP_SNIPPET_MAX_CHARS) + '...'
            : m.snippet,
      }),
    )
  }
  // truncated is also true if we got >maxResults raw lines
  if (!truncated && lines.length > matches.length) {
    truncated = true
  }

  let resultBytes = 0
  for (const m of matches) {
    resultBytes += Buffer.byteLength(m.path, 'utf8') + Buffer.byteLength(m.snippet, 'utf8') + 8
  }
  return Object.freeze({
    tool: 'grep',
    matches: Object.freeze(matches),
    truncated,
    resultBytes,
  })
}

function parseRgLine(line: string): { path: string; line: number; snippet: string } | null {
  // rg's --line-number format: PATH:LINE:TEXT (text may contain colons).
  // Find the first two colons.
  const i1 = line.indexOf(':')
  if (i1 === -1) return null
  const i2 = line.indexOf(':', i1 + 1)
  if (i2 === -1) return null
  const path = line.slice(0, i1)
  const lineStr = line.slice(i1 + 1, i2)
  const text = line.slice(i2 + 1)
  const lineNum = Number.parseInt(lineStr, 10)
  if (!Number.isFinite(lineNum) || lineNum < 1) return null
  return { path, line: lineNum, snippet: text }
}
