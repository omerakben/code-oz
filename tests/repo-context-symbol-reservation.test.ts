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
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { intersectPermissions } from '../src/tools/repo-context/permissions.ts'
import { runRepoContextTool } from '../src/tools/repo-context/runner.ts'
import { readEvents } from '../src/state/events.ts'
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
    // runs first. Proves the order-of-checks invariant: if the symbol
    // guard regressed below `tu === undefined` or `tools.includes(...)`,
    // we would see `tool_no_permissions` or `tool_not_in_permissions`
    // instead of `tool_unavailable`. Assert on the specific issue code
    // and tool to prove the symbol-reservation guard fired, not a
    // generic permissions check.
    const req = { tool: 'symbol', args: { name: 'x' } } as unknown as RepoContextRequest
    const noPerms: AgentPermissions = Object.freeze({
      read: '*',
      write: '*',
      bash: 'deny',
    })
    let captured: RepoContextError | null = null
    try {
      intersectPermissions({
        agentPermissions: noPerms,
        request: req,
        projectRoot: PROJECT,
      })
    } catch (e) {
      captured = e as RepoContextError
    }
    expect(captured).toBeInstanceOf(RepoContextError)
    expect(captured!.issues.length).toBe(1)
    // `tool_unavailable` proves the symbol guard fired. If order
    // regressed, we'd see `tool_no_permissions` (the next check in
    // intersectPermissions when `tool_use.repo_context` is missing).
    expect(captured!.issues[0]!.code).toBe('tool_unavailable')
    expect(captured!.issues[0]!.tool).toBe('symbol')
    expect(captured!.issues[0]!.rule).toContain('RESERVED')
  })
})

describe('symbol reservation — runner-level guard', () => {
  test('runRepoContextTool rejects tool=symbol with tool_unavailable error', async () => {
    // Untyped caller path: an internal/test/future call site reaches the
    // runner directly with `tool === 'symbol'`. Before this guard,
    // intersectPermissions would throw (good) but the runner's downstream
    // event-emission path called `describeQuery`/`readRequestedRootsForLog`
    // with an unknown tool, producing `query=undefined`. `appendEvent`
    // then threw `EventLogError` (schema validation), violating the
    // "always emits one event" guarantee. The runner-level guard MUST
    // reject the request before any other operation runs.
    const dir = await mkdtemp(join(tmpdir(), 'codeoz-runner-symbol-'))
    const req = { tool: 'symbol', args: { name: 'x' } } as unknown as RepoContextRequest
    const outcome = await runRepoContextTool(
      {
        agentName: 'test',
        agentPermissions: permsAllowingSymbol(),
        phase: 'plan',
        runId: '01J3Z89H5R8K3CZ8B0K4MZTGNH',
        projectRoot: dir,
        eventPaths: { file: join(dir, 'events.jsonl'), lockDir: join(dir, '.lock') },
        now: () => '2026-05-10T00:00:00.000Z',
      },
      req,
    )
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    expect(outcome.error).toBeInstanceOf(RepoContextError)
    const rce = outcome.error as RepoContextError
    expect(rce.issues[0]!.code).toBe('tool_unavailable')
    expect(rce.issues[0]!.tool).toBe('symbol')
    expect(rce.issues[0]!.rule).toContain('RESERVED')
  })

  test('runner guard fires before event log is touched (no event emitted)', async () => {
    // Stronger proof of order: if the runner-level guard runs FIRST,
    // no `repo_context_searched` event is written. The previous bug
    // path would either emit a malformed event or throw EventLogError
    // out of appendEvent. We assert the events file is empty/absent
    // AND no exception bubbled — the symbol guard intercepted the call
    // before any side effect.
    const dir = await mkdtemp(join(tmpdir(), 'codeoz-runner-symbol-events-'))
    const eventsFile = join(dir, 'events.jsonl')
    const req = { tool: 'symbol', args: { name: 'x' } } as unknown as RepoContextRequest
    const outcome = await runRepoContextTool(
      {
        agentName: 'test',
        agentPermissions: permsAllowingSymbol(),
        phase: 'plan',
        runId: '01J3Z89H5R8K3CZ8B0K4MZTGNH',
        projectRoot: dir,
        eventPaths: { file: eventsFile, lockDir: join(dir, '.lock') },
        now: () => '2026-05-10T00:00:00.000Z',
      },
      req,
    )
    expect(outcome.status).toBe('error')
    // No event file should exist because the runner-level guard
    // returned before any appendEvent call. If a regression moved the
    // guard below event emission, readEvents would either find a row or
    // throw EventLogError for the missing-query schema violation.
    const events = await readEvents({ file: eventsFile, lockDir: join(dir, '.lock') }).catch(
      () => [],
    )
    expect(events.length).toBe(0)
  })

  test('runner guard rejects other unknown tools too, not just symbol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codeoz-runner-unknown-'))
    const req = { tool: 'wat', args: { pattern: 'x' } } as unknown as RepoContextRequest
    const outcome = await runRepoContextTool(
      {
        agentName: 'test',
        agentPermissions: permsAllowingSymbol(),
        phase: 'plan',
        runId: '01J3Z89H5R8K3CZ8B0K4MZTGNH',
        projectRoot: dir,
        eventPaths: { file: join(dir, 'events.jsonl'), lockDir: join(dir, '.lock') },
        now: () => '2026-05-10T00:00:00.000Z',
      },
      req,
    )
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    const rce = outcome.error as RepoContextError
    expect(rce.issues[0]!.code).toBe('tool_unavailable')
    // Cast for the union: an unknown tool string survives in `rule` text;
    // the issue tool is typed to the union for reporting.
    expect(rce.issues[0]!.tool).toBe('wat' as 'glob' | 'grep' | 'read' | 'symbol')
    expect(rce.issues[0]!.rule).toContain('wat')
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
