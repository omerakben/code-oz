// Env reader for code-oz.
//
// This helper exists because env access is a privacy boundary in this project,
// not just a convenience. CLAUDE.md rule 13 says agents receive explicit
// manifests, never silent recursive context. The same discipline applies to
// process environment: callers must name the keys they are allowed to observe,
// and this module returns only those keys.
//
// Bun on Linux can expose an empty `process.env` even when the process has an
// environment (`oven-sh/bun#27802`). To handle that narrow runtime bug without
// widening the trust boundary, the fallback reads `/proc/self/environ` only when
// Bun reports an empty env on Linux, and it decodes values only for the
// allowlisted keys requested by the caller.
//
// There is deliberately no module-level cache. Every call re-checks
// `process.env`, so late env changes in tests, wrappers, or process launch
// shims are observed without retaining unrelated environment state.

import { readFileSync } from 'node:fs'

const PROC_SELF_ENVIRON = '/proc/self/environ'

export function readEnv(allowedKeys: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  const missingKeys: string[] = []

  for (const key of allowedKeys) {
    const value = process.env[key]
    if (value === undefined) {
      missingKeys.push(key)
    } else {
      values[key] = value
    }
  }

  if (missingKeys.length === 0 || !shouldReadProcEnv()) {
    return values
  }

  const fallbackValues = readAllowedProcEnv(missingKeys)
  for (const key of Object.keys(fallbackValues)) {
    const value = fallbackValues[key]
    if (value !== undefined) {
      values[key] = value
    }
  }
  return values
}

function shouldReadProcEnv(): boolean {
  return process.platform === 'linux'
    && process.versions?.bun !== undefined
    && Object.keys(process.env).length === 0
}

function readAllowedProcEnv(allowedKeys: readonly string[]): Record<string, string> {
  let environ: Buffer
  try {
    environ = readFileSync(PROC_SELF_ENVIRON)
  } catch {
    return {}
  }

  const values: Record<string, string> = {}
  const seen = new Set<string>()
  for (const key of allowedKeys) {
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const value = findProcEnvValue(environ, key)
    if (value !== undefined) {
      values[key] = value
    }
  }
  return values
}

function findProcEnvValue(environ: Buffer, key: string): string | undefined {
  if (key === '' || key.includes('=')) {
    return undefined
  }

  const needle = Buffer.from(`${key}=`, 'utf8')
  let offset = 0

  while (offset < environ.length) {
    const match = environ.indexOf(needle, offset)
    if (match === -1) {
      return undefined
    }

    if (match === 0 || environ[match - 1] === 0) {
      const valueStart = match + needle.length
      const nul = environ.indexOf(0, valueStart)
      const valueEnd = nul === -1 ? environ.length : nul
      return environ.subarray(valueStart, valueEnd).toString('utf8')
    }

    offset = match + 1
  }

  return undefined
}
