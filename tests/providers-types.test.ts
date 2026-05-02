import { describe, test, expect } from 'bun:test'
import {
  PROVIDER_IDS,
  PROVIDER_FAMILIES,
  type ProviderId,
  type ProviderFamily,
} from '../src/providers/types.ts'
import { DEFAULT_FAMILY_BY_ID } from '../src/providers/families.ts'
import { ProviderError, providerError } from '../src/providers/errors.ts'

describe('ProviderId / ProviderFamily', () => {
  test('every ProviderId has a default family mapping', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_FAMILY_BY_ID[id]).toBeDefined()
      expect(PROVIDER_FAMILIES).toContain(DEFAULT_FAMILY_BY_ID[id])
    }
  })

  test('v0.1 mapping is identity (every id matches its same-named family)', () => {
    for (const id of PROVIDER_IDS) {
      const family: ProviderFamily = DEFAULT_FAMILY_BY_ID[id]
      // The TypeScript type system already enforces both unions; this guard
      // is the runtime check that the data agrees.
      expect(family).toBe(id as unknown as ProviderFamily)
    }
  })

  test('PROVIDER_IDS and PROVIDER_FAMILIES are frozen at declaration', () => {
    // `as const` produces readonly tuples — TypeScript enforces this at the
    // type level. Verify the values themselves match the documented contract.
    expect(PROVIDER_IDS).toEqual(['claude', 'codex', 'gemini', 'fake', 'xai'])
    expect(PROVIDER_FAMILIES).toEqual(['claude', 'codex', 'gemini', 'fake', 'xai'])
  })
})

describe('ProviderError', () => {
  test('happy path: stores frozen issue array', () => {
    const err = new ProviderError([
      {
        code: 'provider_auth_missing',
        rule: 'no auth file',
        detail: '/tmp/auth.json',
        actionableSuggestions: ['run `claude login`'],
      },
    ])
    expect(err.name).toBe('ProviderError')
    expect(err.issues.length).toBe(1)
    expect(err.issues[0]?.code).toBe('provider_auth_missing')
    expect(() => {
      // @ts-expect-error: issues is readonly
      err.issues[0].rule = 'mutated'
    }).toThrow()
  })

  test('rejects empty issue array', () => {
    expect(() => new ProviderError([])).toThrow(/at least one issue/)
  })

  test('rejects an issue without actionableSuggestions', () => {
    expect(
      () =>
        new ProviderError([
          {
            code: 'provider_io_error',
            rule: 'oops',
            actionableSuggestions: [],
          },
        ]),
    ).toThrow(/at least one actionableSuggestion/)
  })

  test('message summarizes every issue', () => {
    const err = new ProviderError([
      { code: 'provider_rate_limit', rule: 'too many calls', actionableSuggestions: ['back off'] },
      { code: 'provider_budget_exceeded', rule: 'over tokens', actionableSuggestions: ['raise budget'] },
    ])
    expect(err.message).toContain('provider_rate_limit')
    expect(err.message).toContain('provider_budget_exceeded')
    expect(err.message).toContain('2 issues')
  })

  test('providerError factory wraps a single issue', () => {
    const err = providerError(
      'provider_permissions_violation',
      'file outside permissions.read',
      ['narrow the file manifest', 'broaden agent.permissions.read'],
      '/etc/passwd',
    )
    expect(err.issues.length).toBe(1)
    expect(err.issues[0]?.code).toBe('provider_permissions_violation')
    expect(err.issues[0]?.detail).toBe('/etc/passwd')
    expect(err.issues[0]?.actionableSuggestions.length).toBe(2)
  })

  test('providerError factory omits detail when not given', () => {
    const err = providerError('provider_io_error', 'EIO', ['retry'])
    expect(err.issues[0]?.detail).toBeUndefined()
  })
})

describe('ProviderId branded check', () => {
  // Type-only check — these must compile.
  test('typed assignments to ProviderId / ProviderFamily compile', () => {
    const id: ProviderId = 'claude'
    const family: ProviderFamily = DEFAULT_FAMILY_BY_ID[id]
    expect(family).toBe('claude')
  })
})
