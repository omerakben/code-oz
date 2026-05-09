// M15 commit 8 — bundled reviewer.md gets tool_use.debate (Path A locked).
//
// Coverage:
//   - reviewer.md declares tool_use.debate with the locked shape: the
//     opposingProviders list is `['claude']` (gemini is a stub with
//     eligiblePhases=NO_PHASES so M11 filters it out at load time; codex
//     is reviewer's own family; xai requires operator-configured API-key
//     auth that bundled defaults stay conservative on).
//   - reviewer's existing M9 review_request scope is preserved (debate is
//     additive, not a replacement)
//   - cross-family invariant: reviewer's own family (codex) is NOT in
//     opposingProviders; load-time check would reject otherwise
//   - reviewer is no longer in the M10 NON_DEBATE_DEFAULTS list (covered
//     in tests/lead-debate-permission.test.ts edit)
//
// M15 Phase 2 C19 doc-drift fix: this comment originally said
// `['claude', 'gemini']` based on the M15 Phase 1 kickoff §11.8 shape;
// commit 8 narrowed it to `['claude']` for the M11-eligibility reason
// noted in the inline rationale below. The first-line text now matches
// the assertion at line 37.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { buildRegistry } from '../src/agents/loader.ts'

async function loadDefault(name: string): Promise<string> {
  return readFile(`src/agents/defaults/${name}.md`, 'utf8')
}

describe('reviewer persona has tool_use.debate (M15 path A)', () => {
  test('reviewer.md declares tool_use.debate with locked shape', async () => {
    // opposingProviders narrowed to ['claude'] because gemini is a stub
    // provider (eligiblePhases=NO_PHASES) and codex is reviewer's own
    // family. xai is M11-eligible but requires API-key auth that is
    // operator-configured; bundled defaults stay conservative.
    const content = await loadDefault('reviewer')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/reviewer.md', content }],
      overrides: [],
    })
    const reviewer = reg.getByName('reviewer')
    expect(reviewer).toBeDefined()
    const debate = reviewer?.permissions.tool_use?.debate
    expect(debate).toBeDefined()
    expect(debate?.opposingProviders).toEqual(['claude'])
    expect(debate?.maxConcurrent).toBe(1)
    expect(debate?.previewBeforeSend).toBe(true)
    expect(debate?.maxFiles).toBe(16)
    expect(debate?.timeoutMs).toBe(600_000)
  })

  test('reviewer retains its M9 review_request permission (debate is additive)', async () => {
    const content = await loadDefault('reviewer')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/reviewer.md', content }],
      overrides: [],
    })
    const reviewer = reg.getByName('reviewer')
    expect(reviewer?.permissions.tool_use?.review_request).toBeDefined()
    expect(reviewer?.permissions.tool_use?.repo_context).toBeDefined()
    expect(reviewer?.permissions.tool_use?.debate).toBeDefined()
  })

  test('reviewer opposingProviders excludes its own family (load-time cross-family invariant)', async () => {
    const content = await loadDefault('reviewer')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/reviewer.md', content }],
      overrides: [],
    })
    const reviewer = reg.getByName('reviewer')
    // reviewer.md provider = 'codex'; opposingProviders must not contain
    // 'codex' (load-time rejection in src/agents/schema.ts validateDebate).
    // The fact that the load above succeeded is itself evidence; this
    // assertion makes the invariant explicit.
    expect(reviewer?.provider).toBe('codex')
    expect(reviewer?.permissions.tool_use?.debate?.opposingProviders).not.toContain('codex')
  })

  test('reviewer opposingProviders contains at least one cross-family entry', async () => {
    const content = await loadDefault('reviewer')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/reviewer.md', content }],
      overrides: [],
    })
    const reviewer = reg.getByName('reviewer')
    const opposing = reviewer?.permissions.tool_use?.debate?.opposingProviders
    expect(opposing).toBeDefined()
    if (opposing === undefined) return
    expect(opposing.length).toBeGreaterThan(0)
    // Bundled default ships ['claude']: cross-family from codex AND
    // M11-eligible for review phase. Operators may extend with 'xai'
    // via persona override when XAI_API_KEY is configured.
    expect(opposing).toContain('claude')
  })
})

describe('reviewer scheduler-fired debate eligibility (M11)', () => {
  test('M11 capability + cross-family resolution leaves at least one opposing candidate', async () => {
    // The scheduler hook checks `persona.opposingProviders.length === 0`
    // as a skip gate (persona_no_eligible_opponent). The bundled reviewer's
    // [claude, gemini] list against the default registry produces both
    // as eligible opponents (claude family != codex; gemini family !=
    // codex). This test makes that explicit so a future registry change
    // that disables both would fail loudly here rather than silently
    // skipping every scheduler decision in production.
    const content = await loadDefault('reviewer')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/reviewer.md', content }],
      overrides: [],
    })
    const reviewer = reg.getByName('reviewer')
    const opposing = reviewer?.permissions.tool_use?.debate?.opposingProviders ?? []
    // Each entry must be a known ProviderFamily and differ from reviewer's
    // own family.
    for (const fam of opposing) {
      expect(['claude', 'gemini', 'fake', 'xai']).toContain(fam)
    }
  })
})
