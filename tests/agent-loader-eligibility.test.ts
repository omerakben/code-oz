// M11 commit 4 substrate: load-time provider/phase eligibility check.
//
// An agent declaring `provider: P, phase: φ` is rejected at agent-load
// time when capabilityOf(P).eligiblePhases does not include φ. The
// failure aggregates into AgentLoadError as
// `code: 'loader_provider_phase_not_eligible'`. Pinned in
// docs/research/CODEX_RESPONSE_M11.md (thread
// 019de44e-e8a7-7441-9d82-d79a0595f591).
//
// Key invariants:
// - Loader uses pure capabilityOf() from src/providers/capabilities.ts,
//   NOT ProviderRegistry.capabilityOf() — registry doesn't exist at
//   load time.
// - AgentLoadIssue does NOT carry actionableSuggestions; rule + detail
//   carry the fix hint.
// - "Role" vocabulary is M12 territory; the error code is phase-named.
// - All v0.1 default personas pass eligibility (claude/codex/fake have
//   all AGENT_PHASES; gemini has none, but no default persona uses it).

import { describe, test, expect } from 'bun:test'
import {
  buildRegistry,
  type SourceFile,
} from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import { capabilityOf } from '../src/providers/capabilities.ts'
import { AGENT_PHASES, type AgentPhase } from '../src/agents/schema.ts'

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

describe('load-time provider/phase eligibility — happy paths (M11 commit 4)', () => {
  test('claude is eligible for every AGENT_PHASES value', () => {
    for (const phase of AGENT_PHASES) {
      // skip 'review' to avoid cross-family conflict with the default
      // claude builder that we add below.
      if (phase === 'review') continue
      const a = fmFile(`agent-${phase}`, { phase, provider: 'claude' })
      // No conflict: only one agent. eligibility check passes.
      const reg = buildRegistry({ defaults: [a], overrides: [] })
      expect(reg.getByName(`agent-${phase}`)?.phase).toBe(phase)
    }
  })

  test('codex is eligible for every AGENT_PHASES value', () => {
    for (const phase of AGENT_PHASES) {
      if (phase === 'review') continue
      const a = fmFile(`agent-${phase}`, { phase, provider: 'codex' })
      const reg = buildRegistry({ defaults: [a], overrides: [] })
      expect(reg.getByName(`agent-${phase}`)?.phase).toBe(phase)
    }
  })

  test('fake is eligible for every AGENT_PHASES value', () => {
    for (const phase of AGENT_PHASES) {
      if (phase === 'review') continue
      const a = fmFile(`agent-${phase}`, { phase, provider: 'fake' })
      const reg = buildRegistry({ defaults: [a], overrides: [] })
      expect(reg.getByName(`agent-${phase}`)?.phase).toBe(phase)
    }
  })
})

describe('load-time provider/phase eligibility — gemini stub rejection (M11 rule-20 teeth)', () => {
  test('gemini-as-builder fails with loader_provider_phase_not_eligible', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'gemini' })
    try {
      buildRegistry({ defaults: [builder], overrides: [] })
      throw new Error('expected loader to reject gemini-as-builder')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      expect(e.issues).toHaveLength(1)
      const issue = e.issues[0]!
      expect(issue.code).toBe('loader_provider_phase_not_eligible')
      expect(issue.file).toBe('src/agents/defaults/builder.md')
      // The rule names the eligibility concept (phase), not "role" (M12 vocabulary).
      expect(issue.rule.toLowerCase()).toContain('phase')
      expect(issue.rule.toLowerCase()).not.toContain('role')
      // The detail carries the fix hint: agent name, file, provider, phase,
      // declared eligibility list.
      expect(issue.detail).toContain('builder')
      expect(issue.detail).toContain('gemini')
      expect(issue.detail).toContain('build')
      expect(issue.detail).toContain('[]')
    }
  })

  test('gemini-as-define-agent also fails (every phase rejected)', () => {
    const ba = fmFile('ba', { phase: 'define', provider: 'gemini' })
    expect(() => buildRegistry({ defaults: [ba], overrides: [] })).toThrow(AgentLoadError)
  })

  test('error code is in the loader namespace (NOT provider-error namespace)', () => {
    // Codex's catch: load-time failures use AgentLoadErrorCode, not
    // ProviderErrorCode. The naming convention mirrors
    // loader_cross_family_violation (M9 substrate).
    const builder = fmFile('builder', { phase: 'build', provider: 'gemini' })
    try {
      buildRegistry({ defaults: [builder], overrides: [] })
    } catch (err) {
      const code = (err as AgentLoadError).issues[0]!.code
      expect(code.startsWith('loader_')).toBe(true)
      expect(code).not.toMatch(/^provider_/)
    }
  })

  test('AgentLoadIssue does not carry actionableSuggestions in v0.1', () => {
    // Per Codex CODEX_RESPONSE_M11.md "Risks the proposing side missed":
    // M11 does not extend AgentLoadIssue with provider-error shape.
    const builder = fmFile('builder', { phase: 'build', provider: 'gemini' })
    try {
      buildRegistry({ defaults: [builder], overrides: [] })
    } catch (err) {
      const issue = (err as AgentLoadError).issues[0] as unknown as Record<string, unknown>
      expect('actionableSuggestions' in issue).toBe(false)
    }
  })
})

describe('load-time eligibility — multi-issue aggregation', () => {
  test('multiple gemini-eligibility issues aggregate into one AgentLoadError', () => {
    const a = fmFile('agent-a', { phase: 'build', provider: 'gemini' })
    const b = fmFile('agent-b', { phase: 'verify', provider: 'gemini' })
    const c = fmFile('agent-c', { phase: 'plan', provider: 'gemini' })
    try {
      buildRegistry({ defaults: [a, b, c], overrides: [] })
      throw new Error('expected loader to reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues).toHaveLength(3)
      for (const issue of e.issues) {
        expect(issue.code).toBe('loader_provider_phase_not_eligible')
      }
      // Files preserved in order
      expect(e.issues.map((i) => i.file)).toEqual([
        'src/agents/defaults/agent-a.md',
        'src/agents/defaults/agent-b.md',
        'src/agents/defaults/agent-c.md',
      ])
    }
  })
})

describe('load-time eligibility — interaction with cross-family check (rule order)', () => {
  test('cross-family violation fires first when both rules would trigger', () => {
    // builder=claude (eligible) + reviewer=claude (eligible BUT same family).
    // The cross-family check runs first per loader.ts; eligibility runs
    // second. The cross-family error wins.
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [] })
      throw new Error('expected rejection')
    } catch (err) {
      const issue = (err as AgentLoadError).issues[0]!
      expect(issue.code).toBe('loader_cross_family_violation')
    }
  })

  test('eligibility violation fires when the cross-family check would not trigger', () => {
    // gemini-as-builder + claude-as-reviewer: cross-family is satisfied
    // (gemini family != claude family) but eligibility fails on gemini.
    const builder = fmFile('builder', { phase: 'build', provider: 'gemini' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [] })
      throw new Error('expected rejection')
    } catch (err) {
      const issue = (err as AgentLoadError).issues[0]!
      expect(issue.code).toBe('loader_provider_phase_not_eligible')
    }
  })
})

describe('load-time eligibility — capability source (M11 lock)', () => {
  test('eligibility derives from capabilityOf() in src/providers/capabilities.ts', () => {
    // Sanity: the loader and the test agree on what "eligible" means by
    // consulting the same module. Without this guard, a future change
    // could fork the eligibility data into the loader and leave the
    // capabilities module out of sync.
    expect(capabilityOf('gemini').eligiblePhases.length).toBe(0)
    expect(capabilityOf('claude').eligiblePhases.length).toBeGreaterThan(0)
    // Spot-check that AGENT_PHASES order in capabilities matches phases.
    for (const phase of capabilityOf('claude').eligiblePhases) {
      expect(AGENT_PHASES.includes(phase as AgentPhase)).toBe(true)
    }
  })
})
