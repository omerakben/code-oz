import { test, expect } from 'bun:test'

import { readEnv } from '../src/util/env.ts'

function withEnv(updates: Record<string, string | undefined>, run: () => void): void {
  const saved: Record<string, string | undefined> = {}
  const keys = Object.keys(updates)

  for (const key of keys) {
    saved[key] = process.env[key]
    const next = updates[key]
    if (next === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = next
    }
  }

  try {
    run()
  } finally {
    for (const key of keys) {
      const previous = saved[key]
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
  }
}

test('returns existing env var from process.env', () => {
  withEnv({ CODE_OZ_UTIL_ENV_ONE: 'alpha' }, () => {
    expect(readEnv(['CODE_OZ_UTIL_ENV_ONE'])).toEqual({ CODE_OZ_UTIL_ENV_ONE: 'alpha' })
  })
})

test('omits keys that are missing', () => {
  withEnv({ CODE_OZ_UTIL_ENV_MISSING: undefined }, () => {
    expect(readEnv(['CODE_OZ_UTIL_ENV_MISSING'])).toEqual({})
  })
})

test('returns multiple keys correctly', () => {
  withEnv({
    CODE_OZ_UTIL_ENV_FIRST: 'one',
    CODE_OZ_UTIL_ENV_SECOND: 'two',
  }, () => {
    expect(readEnv(['CODE_OZ_UTIL_ENV_FIRST', 'CODE_OZ_UTIL_ENV_SECOND'])).toEqual({
      CODE_OZ_UTIL_ENV_FIRST: 'one',
      CODE_OZ_UTIL_ENV_SECOND: 'two',
    })
  })
})

test('does not include un-requested keys from process.env', () => {
  withEnv({
    CODE_OZ_UTIL_ENV_ALLOWED: 'visible',
    CODE_OZ_UTIL_ENV_UNREQUESTED: 'hidden',
  }, () => {
    expect(readEnv(['CODE_OZ_UTIL_ENV_ALLOWED'])).toEqual({
      CODE_OZ_UTIL_ENV_ALLOWED: 'visible',
    })
  })
})

test('empty allowlist returns an empty object', () => {
  expect(readEnv([])).toEqual({})
})

test('calling readEnv twice for the same key produces the same result', () => {
  withEnv({ CODE_OZ_UTIL_ENV_REPEAT: 'stable' }, () => {
    expect(readEnv(['CODE_OZ_UTIL_ENV_REPEAT'])).toEqual({ CODE_OZ_UTIL_ENV_REPEAT: 'stable' })
    expect(readEnv(['CODE_OZ_UTIL_ENV_REPEAT'])).toEqual({ CODE_OZ_UTIL_ENV_REPEAT: 'stable' })
  })
})

test('does not throw on the non-Linux fallback-skipped path', () => {
  withEnv({ CODE_OZ_UTIL_ENV_DARWIN_MISSING: undefined }, () => {
    // The `/proc/self/environ` fallback is intentionally not mocked here:
    // `process.platform` and `/proc` are runtime surfaces. On the local darwin
    // path, the platform check skips `/proc` before any read can occur.
    expect(() => readEnv(['CODE_OZ_UTIL_ENV_DARWIN_MISSING'])).not.toThrow()
  })
})
