// M10 commit 8: lead persona gets tool_use.debate; other bundled
// personas (BA, Builder, Verifier, Reviewer, Scientist) do NOT.
//
// Per CODEX_RESPONSE_M10.md D12 lock: bundled defaults are PLAN-only
// in M10; the runtime primitive (src/tools/debate-request.ts) stays
// phase-agnostic. Negative-permission tests below prove no other
// bundled persona accidentally inherits debate authority.

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRegistry } from '../src/agents/loader.ts'
import { fileURLToPath } from 'node:url'

// Read the bundled persona file directly via fs; mirrors how the test
// suite typically loads default personas. Defaults live at
// src/agents/defaults/<name>.md in the repo source.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

async function loadDefault(name: string): Promise<string> {
  return readFile(join(REPO_ROOT, 'src/agents/defaults', `${name}.md`), 'utf-8')
}

describe('lead persona has tool_use.debate (M10 default)', () => {
  test('lead.md declares tool_use.debate with opposingProviders=[codex] and maxConcurrent=1', async () => {
    const content = await loadDefault('lead')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/lead.md', content }],
      overrides: [],
    })
    const lead = reg.getByName('lead')
    expect(lead).toBeDefined()
    const debate = lead?.permissions.tool_use?.debate
    expect(debate).toBeDefined()
    expect(debate?.opposingProviders).toEqual(['codex'])
    expect(debate?.maxConcurrent).toBe(1)
    expect(debate?.previewBeforeSend).toBe(true)
    expect(debate?.maxFiles).toBe(20)
    expect(debate?.timeoutMs).toBe(600_000)
  })

  test('lead persona retains its M6 repo_context permission (debate is additive)', async () => {
    const content = await loadDefault('lead')
    const reg = buildRegistry({
      defaults: [{ file: 'src/agents/defaults/lead.md', content }],
      overrides: [],
    })
    const lead = reg.getByName('lead')
    expect(lead?.permissions.tool_use?.repo_context).toBeDefined()
    expect(lead?.permissions.tool_use?.debate).toBeDefined()
  })
})

describe('other bundled personas do NOT inherit tool_use.debate (D12 lock)', () => {
  // These personas exist in src/agents/defaults/. M10 grants debate to
  // lead only; M15 commit 8 added reviewer (Path A — canonical-fixture-
  // friendly so the rule-21 baseline measures on the bundled product
  // path). Future milestones may extend (e.g., builder for design-time
  // debate during BUILD), but those expansions need their own
  // pre-implementation Codex debate per CLAUDE.md rule 7.
  const NON_DEBATE_DEFAULTS = ['ba', 'builder', 'verifier', 'scientist']

  for (const name of NON_DEBATE_DEFAULTS) {
    test(`${name}.md does NOT declare tool_use.debate`, async () => {
      const content = await loadDefault(name)
      const reg = buildRegistry({
        defaults: [{ file: `src/agents/defaults/${name}.md`, content }],
        overrides: [],
      })
      const persona = reg.getByName(name)
      expect(persona).toBeDefined()
      expect(persona?.permissions.tool_use?.debate).toBeUndefined()
    })
  }
})

describe('the requestDebate primitive remains phase-agnostic (D12 lock)', () => {
  test('a custom non-PLAN persona declaring tool_use.debate loads successfully', () => {
    // Proves the runtime primitive will accept a build-phase or verify-
    // phase persona that legitimately declares tool_use.debate; the
    // bundled defaults are PLAN-only by policy, but the schema is not
    // PLAN-coupled.
    const customBuilderWithDebate = `---
name: custom-builder
type: agent
phase: build
provider: claude
modelPolicy: any
permissions:
  read: '*'
  write: ['.code-oz/runs/<runId>/worktree/']
  bash: deny
  tool_use:
    debate:
      opposingProviders: ['codex']
      maxConcurrent: 1
      previewBeforeSend: true
      maxFiles: 10
      timeoutMs: 600000
description: Custom builder declaring debate; proves the primitive is phase-agnostic.
---

# Custom Builder

## Overview

Custom builder for testing.
`
    const reg = buildRegistry({
      defaults: [],
      overrides: [{ file: 'agents/custom-builder.md', content: customBuilderWithDebate }],
    })
    const persona = reg.getByName('custom-builder')
    expect(persona).toBeDefined()
    expect(persona?.phase).toBe('build')
    expect(persona?.permissions.tool_use?.debate).toBeDefined()
    expect(persona?.permissions.tool_use?.debate?.opposingProviders).toEqual(['codex'])
  })
})
