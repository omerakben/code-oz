// M9 commit 1 substrate: the load-time cross-family check uses
// shared familyOf() (src/providers/families.ts) instead of literal
// provider id comparison. This locks the contract that two ids
// resolving to the same family — even when their literal id strings
// differ — fail load-time enforcement, future-proofing the rule for
// W3+ when claude-cli + anthropic-api both map to family 'claude'.
//
// Codex M9 substrate catch (CODEX_RESPONSE_M9.md decision 5, thread
// 019de05a): a 'codex'-declared reviewer with a misconfigured adapter
// could otherwise be operationally same-family at runtime; the shared
// lookup closes that hole at load time.

import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import { familyOf, DEFAULT_FAMILY_BY_ID } from '../src/providers/families.ts'
import { PROVIDER_IDS } from '../src/providers/types.ts'

function fmFile(
  name: string,
  overrides: Record<string, unknown> = {},
  body = '# Title\n\nbody\n',
): SourceFile {
  const data = {
    name,
    type: 'agent',
    phase: 'define',
    provider: 'claude',
    modelPolicy: 'opus-default',
    permissions: { read: '*', write: ['./docs/**'], bash: 'deny' },
    description: `Stub agent ${name} for testing.`,
    ...overrides,
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return { file: `src/agents/defaults/${name}.md`, content: `---\n${yaml}\n---\n${body}` }
}

describe('familyOf — pure lookup (M9 commit 1 substrate)', () => {
  test('every PROVIDER_ID has a family', () => {
    for (const id of PROVIDER_IDS) {
      expect(familyOf(id)).toBe(DEFAULT_FAMILY_BY_ID[id])
    }
  })

  test('v0.1 mapping is identity (each id maps to its same-named family)', () => {
    expect(familyOf('claude')).toBe('claude')
    expect(familyOf('codex')).toBe('codex')
    expect(familyOf('gemini')).toBe('gemini')
    expect(familyOf('fake')).toBe('fake')
  })
})

describe('buildRegistry cross-family enforcement uses familyOf, not literal ids', () => {
  test('error message names the resolved family, not just the provider id', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [] })
      throw new Error('expected loader to reject same-family BUILD/REVIEW pairing')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_cross_family_violation')
      // Family info present in detail — proof the comparison went through
      // familyOf() rather than a literal provider-id check.
      expect(issue.detail).toContain('family=claude')
      // Rule string mentions FAMILY explicitly per the cross-family contract.
      expect(issue.rule).toContain('family')
    }
  })

  test('different families pass even when both ids exist (claude vs codex)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    expect(reg.getByName('builder')?.provider).toBe('claude')
    expect(reg.getByName('reviewer')?.provider).toBe('codex')
  })

  test('codex BUILD + claude REVIEW also passes (cross-family, opposite direction)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'codex' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    const reg = buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    expect(reg.listAll()).toHaveLength(2)
  })

  test('rule string explicitly names "family" (not just "provider")', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'codex' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [] })
      throw new Error('expected loader to reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule.toLowerCase()).toContain('family')
    }
  })
})
