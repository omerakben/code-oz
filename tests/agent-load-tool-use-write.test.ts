import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import {
  WRITE_TOOL_HARD_CAPS,
  WRITE_TOOL_NAMES,
} from '../src/agents/schema.ts'

function fmFile(permissions: Record<string, unknown>): SourceFile {
  const data = {
    name: 'builder-test',
    type: 'agent',
    phase: 'build',
    provider: 'claude',
    modelPolicy: 'opus-default',
    permissions,
    description: 'Test persona declaring tool_use.write.',
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return {
    file: 'src/agents/defaults/builder-test.md',
    content: `---\n${yaml}\n---\n# Builder\n\n## Overview\nTest agent.\n`,
  }
}

const VALID_WRITE = {
  tools: ['apply-patch'],
  roots: ['.code-oz/runs/<runId>/worktree/'],
  maxBytesPerPatch: 65536,
  timeoutMs: 5000,
}

const VALID_REPO_CONTEXT = {
  tools: ['glob', 'grep', 'read'],
  roots: ['.code-oz/runs/<runId>/worktree/'],
  maxResults: 50,
  maxBytesPerResult: 16384,
  maxFilesForNextManifest: 20,
  timeoutMs: 5000,
  network: 'none',
}

describe('tool_use.write — happy path', () => {
  test('accepts a minimal apply-patch declaration with M7 caps', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/runs/<runId>/worktree/'],
          bash: 'deny',
          tool_use: { write: VALID_WRITE },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def).toBeDefined()
    const w = def?.permissions.tool_use?.write
    expect(w).toBeDefined()
    expect(w?.tools).toEqual(['apply-patch'])
    expect(w?.maxBytesPerPatch).toBe(65536)
    expect(w?.timeoutMs).toBe(5000)
    expect(w?.roots).toContain('.code-oz/runs/<runId>/worktree/')
  })

  test('coexists with tool_use.repo_context', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/runs/<runId>/worktree/'],
          bash: 'deny',
          tool_use: {
            repo_context: VALID_REPO_CONTEXT,
            write: VALID_WRITE,
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.repo_context).toBeDefined()
    expect(def?.permissions.tool_use?.write).toBeDefined()
  })

  test('frozen output (immutability check)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['*'],
          bash: 'deny',
          tool_use: { write: VALID_WRITE },
        }),
      ],
      overrides: [],
    })
    const w = reg.listAll()[0]?.permissions.tool_use?.write
    expect(w).toBeDefined()
    expect(Object.isFrozen(w)).toBe(true)
    expect(Object.isFrozen(w?.tools)).toBe(true)
    expect(Object.isFrozen(w?.roots)).toBe(true)
  })
})

describe('tool_use.write — rejection paths', () => {
  function expectIssue(perm: Record<string, unknown>, ruleSubstring: string): void {
    let err: AgentLoadError | null = null
    try {
      buildRegistry({
        defaults: [fmFile(perm)],
        overrides: [],
      })
    } catch (e) {
      if (e instanceof AgentLoadError) err = e
    }
    expect(err).not.toBeNull()
    const issues = err?.issues ?? []
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.rule.includes(ruleSubstring))).toBe(true)
  }

  test('rejects unknown tool name', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, tools: ['exec-shell'] } },
      },
      'apply-patch',
    )
  })

  test('rejects empty tools array', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, tools: [] } },
      },
      'tools',
    )
  })

  test('rejects empty roots array', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, roots: [] } },
      },
      'roots',
    )
  })

  test('rejects maxBytesPerPatch above hard cap', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, maxBytesPerPatch: 1_000_000 } },
      },
      'maxBytesPerPatch',
    )
  })

  test('rejects timeoutMs above hard cap', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, timeoutMs: 99_999 } },
      },
      'timeoutMs',
    )
  })

  test('rejects zero numeric caps', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, maxBytesPerPatch: 0 } },
      },
      'maxBytesPerPatch',
    )
  })

  test('rejects non-array roots', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, roots: 'not-an-array' } },
      },
      'roots',
    )
  })

  test('rejects unknown sub-scope (debate runtime is M10, not M7)', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { debate: { tools: ['apply-patch'] } },
      },
      'sub-scope',
    )
  })

  test('rejects empty-string root entry', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, roots: [''] } },
      },
      'non-empty',
    )
  })

  test('rejects host-root (no <runId> placeholder) per Codex finding #6', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, roots: ['/'] } },
      },
      'templated worktree root',
    )
  })

  test('rejects wildcard root', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { write: { ...VALID_WRITE, roots: ['*'] } },
      },
      'templated worktree root',
    )
  })

  test('rejects root pointing at a sibling under runs/<runId>/', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: {
          write: { ...VALID_WRITE, roots: ['.code-oz/runs/<runId>/patches/'] },
        },
      },
      'templated worktree root',
    )
  })

  test('accepts the templated worktree root with or without trailing slash', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['*'],
          bash: 'deny',
          tool_use: {
            write: { ...VALID_WRITE, roots: ['.code-oz/runs/<runId>/worktree'] },
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.write?.roots[0]).toBe('.code-oz/runs/<runId>/worktree')
  })
})

describe('hard caps (constants)', () => {
  test('WRITE_TOOL_HARD_CAPS matches BUILD.md schema', () => {
    expect(WRITE_TOOL_HARD_CAPS.maxBytesPerPatch).toBe(65_536)
    expect(WRITE_TOOL_HARD_CAPS.timeoutMs).toBe(5_000)
  })

  test('WRITE_TOOL_NAMES is a single-entry tuple in v0.1', () => {
    expect(WRITE_TOOL_NAMES).toEqual(['apply-patch'])
  })
})
