// M13 Commit 3: canonicalRoleFromAgent — pure helper for binding
// CompanyRole identity from an agent definition.
//
// Codex Q9 lock (CODEX_RESPONSE_M13.md): the canonicalizer fails CLOSED
// on every name outside `M12_COMPANY_ROLES` — project-local personas and
// synthetic debate-opponent agents both return undefined and bypass
// per-role gating (global + per-phase still enforce).

import { describe, test, expect } from 'bun:test'
import { canonicalRoleFromAgent } from '../src/agents/role.ts'
import { M12_COMPANY_ROLES } from '../src/config/schema.ts'

describe('canonicalRoleFromAgent — happy paths', () => {
  test.each(M12_COMPANY_ROLES.map((r) => [r]))(
    'maps bundled role name "%s" to itself',
    (role) => {
      expect(canonicalRoleFromAgent({ name: role })).toBe(role)
    },
  )
})

describe('canonicalRoleFromAgent — fail-closed on non-roster names', () => {
  test('project-local persona name returns undefined', () => {
    expect(canonicalRoleFromAgent({ name: 'agile-coach' })).toBeUndefined()
  })

  test('case-mismatch returns undefined (typo guard)', () => {
    // Codex's Q9 concern: a typo (`Builder` vs `builder`) silently bypasses
    // per-role gating. The canonicalizer fails closed on capitalization
    // mismatch — the caller is responsible for canonical lowercase names.
    expect(canonicalRoleFromAgent({ name: 'Builder' })).toBeUndefined()
    expect(canonicalRoleFromAgent({ name: 'BUILDER' })).toBeUndefined()
  })

  test('synthetic debate-opponent name returns undefined', () => {
    // src/tools/debate-request.ts intentionally uses names outside the
    // roster for synthetic opposing agents (e.g.,
    // `debate-opposing:codex` style). Verify the canonicalizer does not
    // accidentally classify them as a role.
    expect(canonicalRoleFromAgent({ name: 'debate-opposing:codex' })).toBeUndefined()
    expect(canonicalRoleFromAgent({ name: 'opposing-claude' })).toBeUndefined()
  })

  test('empty-string name returns undefined', () => {
    expect(canonicalRoleFromAgent({ name: '' })).toBeUndefined()
  })

  test('name with whitespace returns undefined', () => {
    expect(canonicalRoleFromAgent({ name: ' builder' })).toBeUndefined()
    expect(canonicalRoleFromAgent({ name: 'builder ' })).toBeUndefined()
  })
})

describe('canonicalRoleFromAgent — pure / no side effects', () => {
  test('returns identical result on repeated calls', () => {
    const a = canonicalRoleFromAgent({ name: 'reviewer' })
    const b = canonicalRoleFromAgent({ name: 'reviewer' })
    expect(a).toBe(b)
    expect(a).toBe('reviewer')
  })

  test('does not mutate the input', () => {
    const agent = { name: 'lead' }
    canonicalRoleFromAgent(agent)
    expect(agent).toEqual({ name: 'lead' })
  })
})
