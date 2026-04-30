import { describe, test, expect } from 'bun:test'
import { intersectPermissions } from '../src/tools/repo-context/permissions.ts'
import { RepoContextError } from '../src/tools/repo-context/errors.ts'
import type { AgentPermissions } from '../src/agents/schema.ts'
import type { RepoContextRequest } from '../src/tools/repo-context/types.ts'

const PROJECT = '/tmp/code-oz-perm-tests'

function perms(opts: {
  tools?: readonly ('glob' | 'grep' | 'read' | 'symbol')[]
  roots?: readonly string[]
} = {}): AgentPermissions {
  const tools: readonly ('glob' | 'grep' | 'read' | 'symbol')[] =
    opts.tools ?? (['glob', 'grep', 'read'] as const)
  return Object.freeze({
    read: '*',
    write: '*',
    bash: 'deny',
    tool_use: Object.freeze({
      repo_context: Object.freeze({
        tools: Object.freeze([...tools]),
        roots: Object.freeze([...(opts.roots ?? ['.'])]),
        maxResults: 50,
        maxBytesPerResult: 16384,
        maxFilesForNextManifest: 20,
        timeoutMs: 5000,
        network: 'none',
      }),
    }),
  })
}

describe('intersectPermissions — happy path', () => {
  test('uses agent.roots when request omits roots', () => {
    const req: RepoContextRequest = { tool: 'glob', args: { pattern: '*.ts' } }
    const out = intersectPermissions({
      agentPermissions: perms({ roots: ['.'] }),
      request: req,
      projectRoot: PROJECT,
    })
    expect(out.effectiveRoots.length).toBe(1)
    expect(out.effectiveRoots[0]).toBe(PROJECT)
  })

  test('honors request roots when provided', () => {
    const req: RepoContextRequest = { tool: 'glob', args: { pattern: '*.ts', roots: ['src', 'tests'] } }
    const out = intersectPermissions({
      agentPermissions: perms(),
      request: req,
      projectRoot: PROJECT,
    })
    expect(out.effectiveRoots.length).toBe(2)
    expect(out.effectiveRoots[0]).toBe(`${PROJECT}/src`)
    expect(out.effectiveRoots[1]).toBe(`${PROJECT}/tests`)
  })

  test('read: path inside an effective root is accepted', () => {
    const req: RepoContextRequest = { tool: 'read', args: { path: 'src/x.ts' } }
    const out = intersectPermissions({
      agentPermissions: perms({ roots: ['src'] }),
      request: req,
      projectRoot: PROJECT,
    })
    expect(out.permissions.tools).toContain('read')
  })
})

describe('intersectPermissions — rejections', () => {
  test('rejects when agent lacks tool_use.repo_context', () => {
    const noTu: AgentPermissions = Object.freeze({ read: '*', write: '*', bash: 'deny' })
    const req: RepoContextRequest = { tool: 'glob', args: { pattern: '*' } }
    expect(() => intersectPermissions({ agentPermissions: noTu, request: req, projectRoot: PROJECT })).toThrow(
      RepoContextError,
    )
  })

  test('rejects tool not in agent.tools', () => {
    const req: RepoContextRequest = { tool: 'grep', args: { pattern: 'x' } }
    expect(() =>
      intersectPermissions({
        agentPermissions: perms({ tools: ['glob'] }),
        request: req,
        projectRoot: PROJECT,
      }),
    ).toThrow(RepoContextError)
  })

  test('rejects request root outside project root', () => {
    const req: RepoContextRequest = { tool: 'glob', args: { pattern: '*', roots: ['/etc'] } }
    expect(() =>
      intersectPermissions({
        agentPermissions: perms(),
        request: req,
        projectRoot: PROJECT,
      }),
    ).toThrow(RepoContextError)
  })

  test('rejects read path with `..`', () => {
    const req: RepoContextRequest = { tool: 'read', args: { path: '../escape.txt' } }
    expect(() =>
      intersectPermissions({
        agentPermissions: perms(),
        request: req,
        projectRoot: PROJECT,
      }),
    ).toThrow(RepoContextError)
  })

  test('rejects read path outside any effective root', () => {
    const req: RepoContextRequest = { tool: 'read', args: { path: 'tests/x.ts' } }
    expect(() =>
      intersectPermissions({
        agentPermissions: perms({ roots: ['src'] }),
        request: req,
        projectRoot: PROJECT,
      }),
    ).toThrow(RepoContextError)
  })
})
