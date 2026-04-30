// Targeted file reads for the repo-context tool family.
//
// `read` is *not* a recursive scanner. It reads a slice of one named file,
// capped at maxBytesPerResult. Optional 1-indexed inclusive line range.

import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import { RepoContextError } from './errors.ts'
import type { ReadArgs, ReadResult } from './types.ts'

export interface ReadOptions {
  readonly maxBytesPerResult: number
  /** Absolute project root used to resolve a relative `path`. */
  readonly projectRoot: string
}

export async function execRead(args: ReadArgs, opts: ReadOptions): Promise<ReadResult> {
  if (args.lineRange !== undefined) {
    const [a, b] = args.lineRange
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) {
      throw new RepoContextError([
        {
          code: 'tool_invalid_arg',
          rule: 'read.lineRange must be a [start, end] tuple of positive integers with start ≤ end',
          detail: JSON.stringify(args.lineRange),
          tool: 'read',
        },
      ])
    }
  }

  const target = resolve(opts.projectRoot, args.path)
  let content: Buffer
  try {
    const fh = await open(target, 'r')
    try {
      const buf = Buffer.allocUnsafe(opts.maxBytesPerResult + 1)
      const { bytesRead } = await fh.read(buf, 0, opts.maxBytesPerResult + 1, 0)
      content = buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  } catch (err) {
    throw new RepoContextError([
      {
        code: 'tool_io_error',
        rule: `failed to read ${args.path}`,
        detail: (err as Error).message,
        tool: 'read',
      },
    ])
  }

  // Truncation: did we hit the cap?
  let truncated = content.length > opts.maxBytesPerResult
  if (truncated) content = content.subarray(0, opts.maxBytesPerResult)

  let text = content.toString('utf8')

  if (args.lineRange !== undefined) {
    const [a, b] = args.lineRange
    const lines = text.split(/\r?\n/)
    const slice = lines.slice(a - 1, b)
    text = slice.join('\n')
  }

  const out = text
  const resultBytes = Buffer.byteLength(out, 'utf8')

  return Object.freeze({
    tool: 'read',
    path: args.path,
    content: out,
    truncated,
    resultBytes,
  })
}
