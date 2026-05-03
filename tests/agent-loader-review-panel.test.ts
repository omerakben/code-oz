// M14 commit 2 — authoritative loader-side cross-family check for
// `company.reviewer.panel` voters (layer 2 of the 5-layer defense-in-
// depth defined in docs/contracts/REVIEW_PANEL.md).
//
// Layer 1 (src/config/load.ts) is best-effort: it computes the build
// family from `company.builder.provider ?? defaultProvider`. When the
// bundled BUILD agent's frontmatter provider differs from
// defaultProvider AND `company.builder.provider` is unset, layer 1
// cannot see the actual build family. Layer 2 here uses the resolved
// BUILD AgentDefinition's provider, which matches what runtime
// invocation will see.

import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import { type CompanyConfig } from '../src/config/schema.ts'

interface FmOverrides {
  readonly phase?: string
  readonly provider?: string
  readonly model?: string
}

function fmFile(name: string, overrides: FmOverrides = {}, body = '# Title\n\nbody\n'): SourceFile {
  const data: Record<string, unknown> = {
    name,
    type: 'agent',
    phase: overrides.phase ?? 'define',
    provider: overrides.provider ?? 'claude',
    modelPolicy: 'opus-default',
    permissions: { read: '*', write: ['./docs/**'], bash: 'deny' },
    description: `Stub agent ${name} for testing.`,
  }
  if (overrides.model !== undefined) data.model = overrides.model
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return { file: `src/agents/defaults/${name}.md`, content: `---\n${yaml}\n---\n${body}` }
}

describe('enforceReviewerPanelCrossFamily — happy paths', () => {
  test('no panel → check is a no-op', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { reviewer: { provider: 'codex' } },
    })
    expect(reg.getByName('builder')?.provider).toBe('claude')
  })

  test('valid 2-voter cross-family panel passes', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
        ],
      },
    }
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company,
    })
    expect(reg.getByName('builder')?.provider).toBe('claude')
  })

  test('same-family advisory entry passes (no gate authority)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
          { provider: 'claude', role: 'advisory' },
        ],
      },
    }
    expect(() =>
      buildRegistry({ defaults: [builder, reviewer], overrides: [], company }),
    ).not.toThrow()
  })

  test('no BUILD agent → check is a no-op (DEFINE/PLAN-only profile)', () => {
    const ba = fmFile('ba', { phase: 'define', provider: 'claude' })
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          // intentionally same-family voters; loader skips because no BUILD agent
          { provider: 'claude', role: 'voter' },
          { provider: 'claude', role: 'voter' },
        ],
      },
    }
    expect(() => buildRegistry({ defaults: [ba], overrides: [], company })).not.toThrow()
  })
})

describe('enforceReviewerPanelCrossFamily — rejection', () => {
  test('same-family voter against actual BUILD agent → AgentLoadError', () => {
    // BUILD agent provider = claude (frontmatter); panel voter = claude → reject
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'claude', role: 'voter' },
          { provider: 'gemini', role: 'voter' },
        ],
      },
    }
    let err: AgentLoadError | undefined
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [], company })
    } catch (e) {
      err = e as AgentLoadError
    }
    expect(err).toBeInstanceOf(AgentLoadError)
    const issue = err!.issues.find((i) => i.code === 'panel_voter_same_family_as_build')
    expect(issue).toBeDefined()
    expect(issue!.detail).toContain("provider='claude'")
    expect(issue!.rule).toContain('loader layer 2')
  })

  test('same-family voter caught even when company.builder override changes the family', () => {
    // BUILD agent frontmatter = claude; company.builder.provider = codex
    // → resolved BUILD family = codex
    // → panel voter codex must be rejected (config-load layer 1 sees this case
    //   because company.builder.provider is set, but the loader-layer assertion
    //   covers the post-override invariant independently).
    // Reviewer uses 'fake' provider (eligibility-OK + family-distinct from claude/codex)
    // so the cross-family check between BUILD and the bundled REVIEW agent passes
    // and lets us isolate the panel-voter check.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'fake' })
    const company: CompanyConfig = {
      builder: { provider: 'codex' },
      reviewer: {
        panel: [
          { provider: 'codex', role: 'voter' },
          { provider: 'fake', role: 'voter' },
        ],
      },
    }
    let err: AgentLoadError | undefined
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [], company })
    } catch (e) {
      err = e as AgentLoadError
    }
    expect(err).toBeInstanceOf(AgentLoadError)
    expect(err!.issues.some((i) => i.code === 'panel_voter_same_family_as_build')).toBe(true)
  })

  test('both panel voters same-family → both reported', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const company: CompanyConfig = {
      reviewer: {
        panel: [
          { provider: 'claude', role: 'voter' },
          { provider: 'claude', role: 'voter' },
        ],
      },
    }
    let err: AgentLoadError | undefined
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [], company })
    } catch (e) {
      err = e as AgentLoadError
    }
    expect(err).toBeInstanceOf(AgentLoadError)
    expect(
      err!.issues.filter((i) => i.code === 'panel_voter_same_family_as_build').length,
    ).toBe(2)
  })
})
