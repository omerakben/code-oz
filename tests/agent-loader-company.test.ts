// M12: company:block override application + post-override checks.
//
// `applyCompanyOverrides` overlays the resolved (provider, model) on each
// matching AgentDefinition before the cross-family + eligibility +
// debate-family checks run, so all three checks see the resolved values.
// Pinned in docs/research/CODEX_RESPONSE_M12.md (thread 019de4bb).
//
// Key invariants:
// - Override semantics: config-wins on `provider` and `model` (Decision C).
// - Application point: between bundled-vs-override merge and the
//   resolved-provider checks (Decision D).
// - Roster authority: the locked six-name `M12_COMPANY_ROLES` constant —
//   project-local personas with names outside this list are NOT routable
//   as company roles in v0.1 (Decision A flip).
// - Post-override debate-family check: schema-time `validateDebate`
//   uses frontmatter; this re-check uses resolved (Risk #4).
// - Override cascade precedence: bundled < project-local < company
//   (Risk #6).
// - AgentLoadIssue does NOT carry actionableSuggestions (M11 lock).

import { describe, test, expect } from 'bun:test'
import {
  buildRegistry,
  type SourceFile,
} from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import { type CompanyConfig } from '../src/config/schema.ts'

interface FmOverrides {
  readonly phase?: string
  readonly provider?: string
  readonly model?: string
  readonly tool_use?: Record<string, unknown>
}

function fmFile(
  name: string,
  overrides: FmOverrides = {},
  body = '# Title\n\nbody\n',
): SourceFile {
  const data: Record<string, unknown> = {
    name,
    type: 'agent',
    phase: overrides.phase ?? 'define',
    provider: overrides.provider ?? 'claude',
    modelPolicy: 'opus-default',
    permissions: {
      read: '*',
      write: ['./docs/**'],
      bash: 'deny',
      ...(overrides.tool_use !== undefined ? { tool_use: overrides.tool_use } : {}),
    },
    description: `Stub agent ${name} for testing.`,
  }
  if (overrides.model !== undefined) data.model = overrides.model
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return { file: `src/agents/defaults/${name}.md`, content: `---\n${yaml}\n---\n${body}` }
}

function fmLeadWithDebate(opposingProviders: readonly string[]): SourceFile {
  return fmFile('lead', {
    phase: 'plan',
    provider: 'claude',
    tool_use: {
      debate: {
        opposingProviders,
        maxConcurrent: 1,
        previewBeforeSend: true,
        maxFiles: 20,
        timeoutMs: 600000,
      },
    },
  })
}

describe('applyCompanyOverrides — happy paths', () => {
  test('no company config means identity (every persona keeps frontmatter)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    expect(reg.getByName('builder')?.provider).toBe('claude')
    expect(reg.getByName('reviewer')?.provider).toBe('codex')
  })

  test('provider override is applied (no model field set)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { provider: 'fake' } },
    })
    expect(reg.getByName('builder')?.provider).toBe('fake')
    expect(reg.getByName('reviewer')?.provider).toBe('codex')
  })

  test('model override is applied (no provider field set)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { model: 'claude-opus-4-7' } },
    })
    expect(reg.getByName('builder')?.provider).toBe('claude')
    expect(reg.getByName('builder')?.model).toBe('claude-opus-4-7')
  })

  test('both provider and model override are applied together', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { provider: 'fake', model: 'fake-model-1' } },
    })
    const def = reg.getByName('builder')!
    expect(def.provider).toBe('fake')
    expect(def.model).toBe('fake-model-1')
  })

  test('empty override row leaves the persona unchanged', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const before = buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    const after = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: {} },
    })
    expect(after.getByName('builder')?.provider).toBe(before.getByName('builder')?.provider)
    expect(after.getByName('builder')?.model).toBe(before.getByName('builder')?.model)
  })

  test('overrides are isolated per role (other personas unchanged)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { provider: 'fake' } },
    })
    expect(reg.getByName('reviewer')?.provider).toBe('codex')
  })
})

describe('applyCompanyOverrides — resolved-provider feeds existing checks', () => {
  test('cross-family violation fires when override puts REVIEW in same family as BUILD', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [],
        company: { reviewer: { provider: 'claude' } },
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_cross_family_violation')
      // The detail should name the resolved provider (claude), not the
      // persona's frontmatter provider (codex).
      expect(issue.detail).toContain('reviewer')
      expect(issue.detail).toContain('claude')
    }
  })

  test('eligibility violation fires when override resolves to ineligible provider', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [],
        company: { builder: { provider: 'gemini' } },
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_provider_phase_not_eligible')
      // Detail should name the resolved provider (gemini), not the
      // frontmatter provider (claude).
      expect(issue.detail).toContain('gemini')
      expect(issue.detail).toContain('build')
    }
  })

  test('override that resolves to compatible provider passes', () => {
    // Override builder from claude to fake (every phase eligible) — no
    // cross-family or eligibility violation.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { provider: 'fake' } },
    })
    expect(reg.getByName('builder')?.provider).toBe('fake')
  })
})

describe('applyCompanyOverrides — post-override debate-family check (Risk #4)', () => {
  test('override that puts resolved family into opposingProviders fails at load time', () => {
    // lead frontmatter: provider=claude, opposingProviders=['codex'] (passes
    // schema-time validateDebate because claude !== codex). Override
    // company.lead.provider=codex makes the resolved family codex, which
    // now appears in opposingProviders → schema_invalid_permissions.
    const lead = fmLeadWithDebate(['codex'])
    try {
      buildRegistry({
        defaults: [lead],
        overrides: [],
        company: { lead: { provider: 'codex' } },
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('schema_invalid_permissions')
      // Detail should name the resolved provider/family and the
      // opposingProviders list so the user can trace the conflict.
      expect(issue.detail).toContain('resolved provider=codex')
      expect(issue.detail).toContain('resolved family=codex')
      expect(issue.detail).toContain('codex')
    }
  })

  test('override that does NOT change the family preserves debate validity', () => {
    // claude → claude family family stays unchanged; opposingProviders=['codex'] OK.
    const lead = fmLeadWithDebate(['codex'])
    const reg = buildRegistry({
      defaults: [lead],
      overrides: [],
      company: { lead: { model: 'claude-opus-4-7' } },
    })
    expect(reg.getByName('lead')?.provider).toBe('claude')
    expect(reg.getByName('lead')?.model).toBe('claude-opus-4-7')
  })

  test('persona without debate permissions is not affected', () => {
    // No tool_use.debate, so the post-override check is a no-op even
    // when the override changes provider.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [builder, reviewer],
      overrides: [],
      company: { builder: { provider: 'fake' } },
    })
    expect(reg.getByName('builder')?.provider).toBe('fake')
  })
})

describe('applyCompanyOverrides — override cascade precedence (Risk #6)', () => {
  test('bundled < project-local < company precedence holds', () => {
    // Layer 1 (bundled): builder=claude, model=claude-opus-4-7
    // Layer 2 (project-local override): builder=fake/fake-bundled (would
    //   normally win over bundled — flips provider away from claude)
    // Layer 3 (company): builder=claude/claude-final (must win over
    //   project-local — flips provider back, replaces model)
    // The cascade direction (claude → fake → claude) proves both
    // overrides take effect at their layer; the model chain
    // (claude-opus-4-7 → fake-bundled → claude-final) is independent.
    // Reviewer stays at codex; resolved cross-family invariant holds
    // (claude family ≠ codex family).
    const bundled = fmFile('builder', {
      phase: 'build',
      provider: 'claude',
      model: 'claude-opus-4-7',
    })
    const projectLocal = fmFile('builder', {
      phase: 'build',
      provider: 'fake',
      model: 'fake-bundled',
    })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [bundled, reviewer],
      overrides: [projectLocal],
      company: { builder: { provider: 'claude', model: 'claude-final' } },
    })
    const def = reg.getByName('builder')!
    expect(def.provider).toBe('claude')
    expect(def.model).toBe('claude-final')
  })

  test('partial company override leaves project-local model intact', () => {
    // Layer 1: bundled claude/opus
    // Layer 2: project-local fake/fake-bundled (replaces both)
    // Layer 3: company.builder.provider=claude only (model unchanged from L2)
    const bundled = fmFile('builder', {
      phase: 'build',
      provider: 'claude',
      model: 'claude-opus-4-7',
    })
    const projectLocal = fmFile('builder', {
      phase: 'build',
      provider: 'fake',
      model: 'fake-bundled',
    })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({
      defaults: [bundled, reviewer],
      overrides: [projectLocal],
      company: { builder: { provider: 'claude' } },
    })
    const def = reg.getByName('builder')!
    expect(def.provider).toBe('claude')
    expect(def.model).toBe('fake-bundled')
  })
})

describe('applyCompanyOverrides — shipped-role boundary (Risk #1)', () => {
  test('unknown role key is rejected at the loader (defensive runtime check)', () => {
    // Caller bypasses loadConfig and constructs CompanyConfig with a key
    // outside M12_COMPANY_ROLES. The loader rejects with
    // loader_company_role_unknown even though the schema-time TypeScript
    // type would prevent this in normal flow.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [],
        // TypeScript escape hatch — exercises the runtime defensive check.
        company: { 'agile-coach': { provider: 'codex' } } as unknown as CompanyConfig,
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_company_role_unknown')
      expect(issue.detail).toContain("'agile-coach'")
      expect(issue.rule).toContain('ba')
      expect(issue.rule).toContain('scientist')
    }
  })

  test('unknown role rejected even when project-local persona of that name loads', () => {
    // The persona file `agile-coach.md` is a valid loadable persona; it
    // appears in the merged definitions list. But the locked roster is
    // the authority — `company.agile-coach: ...` is rejected regardless
    // of whether a same-named persona file exists. This is the
    // load-bearing test from Codex Risk #1.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const agileCoach = fmFile('agile-coach', { phase: 'plan', provider: 'claude' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [agileCoach],
        company: { 'agile-coach': { provider: 'codex' } } as unknown as CompanyConfig,
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      const e = err as AgentLoadError
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_company_role_unknown')
      // The error names the locked roster, not the loaded persona set.
      expect(issue.rule).toContain('builder')
    }
  })

  test('error code is in the loader namespace and lacks actionableSuggestions', () => {
    // Mirrors agent-loader-eligibility.test.ts — same M11 invariant
    // applies to M12: AgentLoadIssue carries `rule` + `detail`, never
    // `actionableSuggestions`.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [],
        company: { extra: { provider: 'codex' } } as unknown as CompanyConfig,
      })
    } catch (err) {
      const issue = (err as AgentLoadError).issues[0] as unknown as Record<string, unknown>
      expect(typeof issue.code).toBe('string')
      expect((issue.code as string).startsWith('loader_')).toBe(true)
      expect('actionableSuggestions' in issue).toBe(false)
    }
  })
})

describe('applyCompanyOverrides — test-seam discipline (Risk #7)', () => {
  test('loader uses real capabilityOf defaults; eligibility violations surface without registry overrides', () => {
    // M11's capabilityOverrides belongs to ProviderRegistry, not the
    // loader. The loader uses pure capabilityOf() — gemini's
    // eligiblePhases is [] in v0.1 by default. This test relies on the
    // real default capability and does NOT inject any seam.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    try {
      buildRegistry({
        defaults: [builder, reviewer],
        overrides: [],
        company: { builder: { provider: 'gemini' } },
      })
      throw new Error('expected loader to reject')
    } catch (err) {
      const e = err as AgentLoadError
      // Detail should mention `[]` for gemini's eligibility list — proof
      // that the real capabilityOf was consulted, not a test seam.
      expect(e.issues[0]!.detail).toContain('[]')
    }
  })
})
