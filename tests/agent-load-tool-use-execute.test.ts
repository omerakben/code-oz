import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import {
  EXECUTE_TOOL_HARD_CAPS,
  EXECUTE_TOOL_NAMES,
} from '../src/agents/schema.ts'

function fmFile(permissions: Record<string, unknown>): SourceFile {
  const data = {
    name: 'verifier-test',
    type: 'agent',
    phase: 'verify',
    provider: 'claude',
    modelPolicy: 'opus-default',
    permissions,
    description: 'Test persona declaring tool_use.execute.',
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return {
    file: 'src/agents/defaults/verifier-test.md',
    content: `---\n${yaml}\n---\n# Verifier\n\n## Overview\nTest agent.\n`,
  }
}

const VALID_EXECUTE = {
  tools: ['test-runner'],
  roots: ['.code-oz/runs/<runId>/worktree/'],
  timeoutMs: 60_000,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  network: 'none',
}

// Note: VERIFY.md's contract example uses `maxFilesForNextManifest: 0`
// (VERIFY does not promote paths into a next manifest), but the M6 schema
// validator currently requires a positive integer. The contract/schema
// drift is captured for M8 commit 9 (verifier persona) — either the
// verifier persona omits the field, the schema relaxes to allow 0, or the
// contract example uses a small positive number. This fixture uses 1 to
// stay scoped to commit 2.
const VALID_REPO_CONTEXT = {
  tools: ['glob', 'grep', 'read'],
  roots: ['.code-oz/runs/<runId>/worktree/'],
  maxResults: 50,
  maxBytesPerResult: 16_384,
  maxFilesForNextManifest: 1,
  timeoutMs: 5_000,
  network: 'none',
}

const VALID_WRITE = {
  tools: ['apply-patch'],
  roots: ['.code-oz/runs/<runId>/worktree/'],
  maxBytesPerPatch: 65_536,
  timeoutMs: 5_000,
}

describe('tool_use.execute — happy path', () => {
  test('accepts a minimal test-runner declaration with M8 caps', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/VERIFY.md'],
          bash: 'deny',
          tool_use: { execute: VALID_EXECUTE },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def).toBeDefined()
    const e = def?.permissions.tool_use?.execute
    expect(e).toBeDefined()
    expect(e?.tools).toEqual(['test-runner'])
    expect(e?.timeoutMs).toBe(60_000)
    expect(e?.maxStdoutBytes).toBe(1_048_576)
    expect(e?.maxStderrBytes).toBe(1_048_576)
    expect(e?.roots).toContain('.code-oz/runs/<runId>/worktree/')
    expect(e?.network).toBe('none')
  })

  test('coexists with tool_use.repo_context (VERIFY canonical shape)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/VERIFY.md'],
          bash: 'deny',
          tool_use: {
            repo_context: VALID_REPO_CONTEXT,
            execute: VALID_EXECUTE,
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.repo_context).toBeDefined()
    expect(def?.permissions.tool_use?.execute).toBeDefined()
  })

  test('coexists with tool_use.write (forward-compatibility)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/runs/<runId>/worktree/'],
          bash: 'deny',
          tool_use: {
            write: VALID_WRITE,
            execute: VALID_EXECUTE,
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.write).toBeDefined()
    expect(def?.permissions.tool_use?.execute).toBeDefined()
  })

  test('frozen output (immutability check)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['*'],
          bash: 'deny',
          tool_use: { execute: VALID_EXECUTE },
        }),
      ],
      overrides: [],
    })
    const e = reg.listAll()[0]?.permissions.tool_use?.execute
    expect(e).toBeDefined()
    expect(Object.isFrozen(e)).toBe(true)
    expect(Object.isFrozen(e?.tools)).toBe(true)
    expect(Object.isFrozen(e?.roots)).toBe(true)
  })

  test('accepts the templated worktree root with or without trailing slash', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['*'],
          bash: 'deny',
          tool_use: {
            execute: { ...VALID_EXECUTE, roots: ['.code-oz/runs/<runId>/worktree'] },
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.execute?.roots[0]).toBe(
      '.code-oz/runs/<runId>/worktree',
    )
  })
})

describe('tool_use.execute — rejection paths', () => {
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
        tool_use: { execute: { ...VALID_EXECUTE, tools: ['shell-runner'] } },
      },
      'test-runner',
    )
  })

  test('rejects empty tools array', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, tools: [] } },
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
        tool_use: { execute: { ...VALID_EXECUTE, roots: [] } },
      },
      'roots',
    )
  })

  test('rejects timeoutMs above hard cap', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, timeoutMs: 600_000 } },
      },
      'timeoutMs',
    )
  })

  test('rejects maxStdoutBytes above hard cap', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, maxStdoutBytes: 10_485_760 } },
      },
      'maxStdoutBytes',
    )
  })

  test('rejects maxStderrBytes above hard cap', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, maxStderrBytes: 10_485_760 } },
      },
      'maxStderrBytes',
    )
  })

  test('rejects zero numeric caps', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, timeoutMs: 0 } },
      },
      'timeoutMs',
    )
  })

  test('rejects non-array roots', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, roots: 'not-an-array' } },
      },
      'roots',
    )
  })

  test('rejects empty-string root entry', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, roots: [''] } },
      },
      'non-empty',
    )
  })

  test('rejects host-root (no <runId> placeholder)', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, roots: ['/'] } },
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
        tool_use: { execute: { ...VALID_EXECUTE, roots: ['*'] } },
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
          execute: { ...VALID_EXECUTE, roots: ['.code-oz/runs/<runId>/forensics/'] },
        },
      },
      'templated worktree root',
    )
  })

  test('rejects network anything other than `none`', () => {
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: { ...VALID_EXECUTE, network: 'allow' } },
      },
      "must be 'none'",
    )
  })

  test('rejects missing network field', () => {
    const { network: _network, ...rest } = VALID_EXECUTE
    expectIssue(
      {
        read: '*',
        write: ['*'],
        bash: 'deny',
        tool_use: { execute: rest },
      },
      "must be 'none'",
    )
  })
})

describe('hard caps (constants)', () => {
  test('EXECUTE_TOOL_HARD_CAPS matches VERIFY.md schema', () => {
    expect(EXECUTE_TOOL_HARD_CAPS.timeoutMs).toBe(60_000)
    expect(EXECUTE_TOOL_HARD_CAPS.maxStdoutBytes).toBe(1_048_576)
    expect(EXECUTE_TOOL_HARD_CAPS.maxStderrBytes).toBe(1_048_576)
  })

  test('EXECUTE_TOOL_NAMES is a single-entry tuple in v0.1', () => {
    expect(EXECUTE_TOOL_NAMES).toEqual(['test-runner'])
  })
})
