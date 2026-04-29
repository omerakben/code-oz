// Per-run advisory lock via mkdir-as-lock-file. The mkdir(2) syscall is atomic
// on POSIX: only one caller can create a given directory; any concurrent caller
// gets EEXIST. Callers translate LockBusyError to their module's typed error
// (event_lock_busy, gate_lock_busy).

import { mkdir, rmdir } from 'node:fs/promises'

export class LockBusyError extends Error {
  readonly lockDir: string

  constructor(lockDir: string) {
    super(`lock is busy: ${lockDir}`)
    this.name = 'LockBusyError'
    this.lockDir = lockDir
  }
}

export async function withLock<T>(lockDir: string, fn: () => Promise<T>): Promise<T> {
  try {
    await mkdir(lockDir, { recursive: false })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new LockBusyError(lockDir)
    throw err
  }
  try {
    return await fn()
  } finally {
    try {
      await rmdir(lockDir)
    } catch {
      // Best-effort cleanup. A stuck lock self-heals on next acquire attempt
      // when the holder process has exited; otherwise it surfaces as
      // LockBusyError, which the caller maps to a typed actionable issue.
    }
  }
}
