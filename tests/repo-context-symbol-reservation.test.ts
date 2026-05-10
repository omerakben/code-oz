// Defense-in-depth coverage for the `'symbol'` reservation closed by the
// codegraph comparison synthesis (Codex thread 019e12ed Q8).
//
// Two layers protect the slot:
//
//   1. Config-load: `validateRepoContext` rejects any agent that lists
//      `'symbol'` in `permissions.tool_use.repo_context.tools[]`. Covered
//      by tests/agents-permissions.test.ts.
//
//   2. Runtime: `intersectPermissions` rejects any direct request whose
//      `tool === 'symbol'` with `tool_unavailable`, even if the request
//      bypasses config validation (e.g., a test, an internal call site,
//      or a future caller that builds a request from untrusted input).
//
// This file owns layer 2 plus a check that the persona prompt vocabulary
// describes the slot as RESERVED (so personas read consistent language).

import { describe, test, expect } from 'bun:test'
import { intersectPermissions } from '../src/tools/repo-context/permissions.ts'
import { RepoContextError } from '../src/tools/repo-context/errors.ts'
import { RESERVED_REPO_CONTEXT_TOOLS } from '../src/agents/schema.ts'
import type { AgentPermissions } from '../src/agents/schema.ts'
import type { RepoContextRequest } from '../src/tools/repo-context/types.ts'
import { TOOL_DESCRIPTIONS } from '../src/prompts/index.ts'

const PROJECT = '/tmp/code-oz-symbol-reservation'

function permsAllowingSymbol(): AgentPermissions {
  // Synthetic permissions object that bypasses config validation (which
  // would reject this). Used to prove the runtime guard fires anyway.
  return Object.freeze({
    read: '*',
    write: '*',
    bash: 'deny',
    tool_use: Object.freeze({
      repo_context: Object.freeze({
        tools: Object.freeze(['glob', 'grep', 'read', 'symbol'] as const),
        roots: Object.freeze(['.']),
        maxResults: 50,
        maxBytesPerResult: 16384,
        maxFilesForNextManifest: 20,
        timeoutMs: 5000,
        network: 'none',
      }),
    }),
  })
}

describe('symbol reservation — runtime guard (defense-in-depth)', () => {
  test('intersectPermissions rejects tool=symbol with tool_unavailable', () => {
    const req = { tool: 'symbol', args: { name: 'whatever' } } as unknown as RepoContextRequest
    let captured: RepoContextError | null = null
    try {
      intersectPermissions({
        agentPermissions: permsAllowingSymbol(),
        request: req,
        projectRoot: PROJECT,
      })
    } catch (e) {
      captured = e as RepoContextError
    }
    expect(captured).toBeInstanceOf(RepoContextError)
    expect(captured!.issues.length).toBe(1)
    expect(captured!.issues[0]!.code).toBe('tool_unavailable')
    expect(captured!.issues[0]!.tool).toBe('symbol')
    expect(captured!.issues[0]!.rule).toContain('RESERVED')
    expect(captured!.issues[0]!.rule).toContain('REPO_CONTEXT.md')
  })

  test('runtime guard fires before any other intersection check', () => {
    // Even with no permissions at all, the symbol guard wins because it
    // runs first. Proves the order-of-checks invariant.
    const req = { tool: 'symbol', args: { name: 'x' } } as unknown as RepoContextRequest
    const noPerms: AgentPermissions = Object.freeze({
      read: '*',
      write: '*',
      bash: 'deny',
    })
    expect(() =>
      intersectPermissions({
        agentPermissions: noPerms,
        request: req,
        projectRoot: PROJECT,
      }),
    ).toThrow(RepoContextError)
  })
})

describe('symbol reservation — RESERVED list shape', () => {
  test('RESERVED_REPO_CONTEXT_TOOLS contains symbol and only symbol in v0.x', () => {
    expect([...RESERVED_REPO_CONTEXT_TOOLS]).toEqual(['symbol'])
    expect(Object.isFrozen(RESERVED_REPO_CONTEXT_TOOLS)).toBe(true)
  })
})

describe('symbol reservation — persona prompt vocabulary', () => {
  test('TOOL_DESCRIPTIONS.symbol describes the slot as RESERVED with doc anchor', () => {
    const desc = TOOL_DESCRIPTIONS.symbol ?? ''
    expect(desc).toContain('RESERVED')
    expect(desc).toContain('Not permissionable')
    expect(desc).toContain('REPO_CONTEXT.md')
  })

  test('TOOL_DESCRIPTIONS for non-reserved tools stays unchanged shape', () => {
    expect(TOOL_DESCRIPTIONS.glob).toContain('glob')
    expect(TOOL_DESCRIPTIONS.grep).toContain('grep')
    expect(TOOL_DESCRIPTIONS.read).toContain('read')
  })
})
