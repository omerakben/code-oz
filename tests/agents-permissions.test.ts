import { describe, test, expect } from 'bun:test'
import { validateAgent, REPO_CONTEXT_HARD_CAPS } from '../src/agents/schema.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import type { ParsedFrontmatter } from '../src/agents/frontmatter.ts'

const FILE = '/path/to/lead.md'

function fm(data: Record<string, unknown>, body = '# Lead\n\nbody\n'): ParsedFrontmatter {
  return { data, body }
}

const BASE_PERMISSIONS = { read: '*', write: '*', bash: 'deny' as const }

const BASE_FRONTMATTER = {
  name: 'lead',
  type: 'agent',
  phase: 'plan',
  provider: 'claude',
  modelPolicy: 'opus-default',
  description: 'Plans atomic tasks with 3-source verification.',
}

function withRepoContext(rc: Record<string, unknown>): Record<string, unknown> {
  return {
    ...BASE_FRONTMATTER,
    permissions: {
      ...BASE_PERMISSIONS,
      tool_use: { repo_context: rc },
    },
  }
}

const VALID_RC = {
  tools: ['glob', 'grep', 'read'] as const,
  roots: ['.'] as const,
  maxResults: 50,
  maxBytesPerResult: 16384,
  maxFilesForNextManifest: 20,
  timeoutMs: 5000,
  network: 'none' as const,
}

describe('AgentPermissions.tool_use.repo_context — happy path', () => {
  test('absent tool_use is valid', () => {
    const def = validateAgent(
      fm({ ...BASE_FRONTMATTER, permissions: BASE_PERMISSIONS }),
      FILE,
    )
    expect(def.permissions.tool_use).toBeUndefined()
  })

  test('full repo_context with locked caps validates', () => {
    const def = validateAgent(fm(withRepoContext({ ...VALID_RC })), FILE)
    expect(def.permissions.tool_use?.repo_context).toBeDefined()
    expect(def.permissions.tool_use!.repo_context!.tools).toEqual(['glob', 'grep', 'read'])
    expect(def.permissions.tool_use!.repo_context!.network).toBe('none')
    expect(Object.isFrozen(def.permissions.tool_use)).toBe(true)
    expect(Object.isFrozen(def.permissions.tool_use!.repo_context)).toBe(true)
  })

  test('lower-than-cap values validate', () => {
    const def = validateAgent(
      fm(
        withRepoContext({
          ...VALID_RC,
          maxResults: 25,
          maxBytesPerResult: 4096,
          maxFilesForNextManifest: 10,
          timeoutMs: 2500,
        }),
      ),
      FILE,
    )
    expect(def.permissions.tool_use!.repo_context!.maxResults).toBe(25)
  })

  test('symbol tool is RESERVED and rejected at config-load (codegraph synthesis 2026-05-10)', () => {
    // Codex thread 019e12ed Q8: the reserved-but-unsupported `symbol` slot is
    // already contract debt today. The type-union member is preserved so the
    // schema slot is callable for backward-compat when the 4-condition AND
    // telemetry signal in REPO_CONTEXT.md fires; until then, declaring
    // `'symbol'` in tools[] is a config-load error.
    let captured: AgentLoadError | null = null
    try {
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, tools: ['glob', 'grep', 'read', 'symbol'] })),
        FILE,
      )
    } catch (e) {
      captured = e as AgentLoadError
    }
    expect(captured).toBeInstanceOf(AgentLoadError)
    expect(captured!.issues[0]!.code).toBe('schema_invalid_permissions')
    expect(captured!.issues[0]!.rule).toContain('RESERVED')
    expect(captured!.issues[0]!.rule).toContain('REPO_CONTEXT.md')
  })
})

describe('AgentPermissions.tool_use.repo_context — rejections', () => {
  test('rejects unknown tool_use sub-scope', () => {
    expect(() =>
      validateAgent(
        fm({
          ...BASE_FRONTMATTER,
          permissions: { ...BASE_PERMISSIONS, tool_use: { web_search: {} } },
        }),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects empty tools list', () => {
    expect(() => validateAgent(fm(withRepoContext({ ...VALID_RC, tools: [] })), FILE)).toThrow(
      AgentLoadError,
    )
  })

  test('rejects unknown tool name', () => {
    expect(() =>
      validateAgent(fm(withRepoContext({ ...VALID_RC, tools: ['glob', 'web'] })), FILE),
    ).toThrow(AgentLoadError)
  })

  test('rejects non-array roots', () => {
    expect(() =>
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, roots: '.' as unknown as string[] })),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxResults > hard cap', () => {
    expect(() =>
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, maxResults: REPO_CONTEXT_HARD_CAPS.maxResults + 1 })),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxBytesPerResult > hard cap', () => {
    expect(() =>
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, maxBytesPerResult: 32_768 })),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxFilesForNextManifest > hard cap', () => {
    expect(() =>
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, maxFilesForNextManifest: 30 })),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects timeoutMs > hard cap', () => {
    expect(() =>
      validateAgent(fm(withRepoContext({ ...VALID_RC, timeoutMs: 10_000 })), FILE),
    ).toThrow(AgentLoadError)
  })

  test('rejects non-positive maxResults', () => {
    expect(() =>
      validateAgent(fm(withRepoContext({ ...VALID_RC, maxResults: 0 })), FILE),
    ).toThrow(AgentLoadError)
  })

  test('rejects non-integer maxResults', () => {
    expect(() =>
      validateAgent(fm(withRepoContext({ ...VALID_RC, maxResults: 1.5 })), FILE),
    ).toThrow(AgentLoadError)
  })

  test('rejects network !== "none"', () => {
    expect(() =>
      validateAgent(
        fm(withRepoContext({ ...VALID_RC, network: 'offline' as unknown as 'none' })),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })

  test('rejects array tool_use', () => {
    expect(() =>
      validateAgent(
        fm({
          ...BASE_FRONTMATTER,
          permissions: { ...BASE_PERMISSIONS, tool_use: [] as unknown },
        }),
        FILE,
      ),
    ).toThrow(AgentLoadError)
  })
})

describe('REPO_CONTEXT_HARD_CAPS', () => {
  test('match the M6-locked decision', () => {
    expect(REPO_CONTEXT_HARD_CAPS.maxResults).toBe(50)
    expect(REPO_CONTEXT_HARD_CAPS.maxBytesPerResult).toBe(16_384)
    expect(REPO_CONTEXT_HARD_CAPS.maxFilesForNextManifest).toBe(20)
    expect(REPO_CONTEXT_HARD_CAPS.timeoutMs).toBe(5_000)
  })
})
