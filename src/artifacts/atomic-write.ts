// Atomic file write for artifacts. Mirrors the discipline in
// src/state/gates.ts: write to a temp file with random suffix, fsync the
// file handle, close, rename atomically, and (best-effort) fsync the
// containing directory so the rename is durable on POSIX.
//
// Used by src/phases/define.ts to write SPEC.md and SPEC.draft.md. When
// M6 adds AUDIT.md / PLAN.md the same helper applies.

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { open, rename, rm } from 'node:fs/promises'

export interface AtomicWriteOptions {
  /**
   * When true, the helper attempts to fsync the containing directory after
   * rename. Defaults to true. Set false to disable in tests where the
   * sandbox forbids opendir.
   */
  readonly fsyncDir?: boolean
}

/**
 * Atomically write `text` to `targetPath`. The directory must already
 * exist; the helper does not create directories.
 *
 * Discipline:
 *   1. Open `<targetPath>.tmp-<random>` for writing.
 *   2. Write the buffer; fsync the file handle.
 *   3. Close the file handle.
 *   4. Rename temp to target.
 *   5. fsync the containing directory (best-effort).
 *
 * On any error after the temp file is created, the temp file is removed.
 */
export async function atomicWriteFile(
  targetPath: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const buf = Buffer.from(text, 'utf8')
  const tmpPath = `${targetPath}.tmp-${randomBytes(6).toString('hex')}`
  const fh = await open(tmpPath, 'w')
  try {
    await fh.write(buf, 0, buf.length)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmpPath, targetPath)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw err
  }
  // Best-effort directory fsync. Some filesystems / test sandboxes don't
  // support opening a directory for fsync; ignore errors here.
  if (options.fsyncDir !== false) {
    const dir = dirname(targetPath)
    try {
      const dh = await open(dir, 'r')
      try {
        await dh.sync()
      } finally {
        await dh.close()
      }
    } catch {
      // Best-effort; rename has already happened.
    }
  }
}
