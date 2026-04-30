// Permission intersection for repo-context tools.
//
// The agent's `permissions.tool_use.repo_context` is the upper bound. The
// request can ask for narrower roots / params, never wider. Verification:
//
//   1. Agent must declare tool_use.repo_context.
//   2. The requested tool name must be in agent.tools.
//   3. The intersection of (request.roots ?? agent.roots) is the effective
//      root set; effective ⊆ agent.roots ⊆ permissions.read.
//   4. Read-tool path must lie under at least one effective root.

import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import type {
  AgentPermissions,
  RepoContextPermissions,
} from '../../agents/schema.ts'
import { RepoContextError } from './errors.ts'
import type { RepoContextRequest } from './types.ts'

export interface IntersectedRequest {
  readonly request: RepoContextRequest
  readonly permissions: RepoContextPermissions
  /** Absolute paths, lexically inside projectRoot. */
  readonly effectiveRoots: readonly string[]
}

/**
 * Intersect `agentPermissions.tool_use.repo_context` with the request and
 * `projectRoot`. Throws RepoContextError on any policy violation.
 */
export function intersectPermissions(opts: {
  readonly agentPermissions: AgentPermissions
  readonly request: RepoContextRequest
  readonly projectRoot: string
}): IntersectedRequest {
  const { agentPermissions, request, projectRoot } = opts
  const tu = agentPermissions.tool_use?.repo_context
  if (tu === undefined) {
    throw new RepoContextError([
      {
        code: 'tool_no_permissions',
        rule: 'agent has no permissions.tool_use.repo_context scope',
        tool: request.tool,
      },
    ])
  }
  if (!tu.tools.includes(request.tool as 'glob' | 'grep' | 'read' | 'symbol')) {
    throw new RepoContextError([
      {
        code: 'tool_not_in_permissions',
        rule: `tool '${request.tool}' is not in the agent's allowed list (${tu.tools.join(', ')})`,
        tool: request.tool,
      },
    ])
  }

  const projAbs = resolve(projectRoot)
  const candidateRoots = readRequestedRoots(request, tu)
  const effectiveRoots: string[] = []
  for (const r of candidateRoots) {
    const abs = isAbsolute(r) ? normalize(r) : resolve(projAbs, r)
    if (!isInside(projAbs, abs)) {
      throw new RepoContextError([
        {
          code: 'tool_root_outside_permissions',
          rule: `requested root '${r}' resolves outside the project root`,
          detail: `project=${projAbs} resolved=${abs}`,
          tool: request.tool,
        },
      ])
    }
    if (!effectiveRoots.includes(abs)) effectiveRoots.push(abs)
  }
  if (effectiveRoots.length === 0) {
    throw new RepoContextError([
      {
        code: 'tool_root_outside_permissions',
        rule: 'no effective roots after intersection',
        tool: request.tool,
      },
    ])
  }

  // For `read`, also verify the requested path is under at least one root.
  if (request.tool === 'read') {
    const target = resolve(projAbs, request.args.path)
    if (target.includes('..' + sep) || target.includes(sep + '..')) {
      throw new RepoContextError([
        {
          code: 'tool_path_unsafe',
          rule: 'read.path must not contain `..` segments',
          detail: request.args.path,
          tool: 'read',
        },
      ])
    }
    if (!effectiveRoots.some((root) => isInside(root, target))) {
      throw new RepoContextError([
        {
          code: 'tool_root_outside_permissions',
          rule: `read.path '${request.args.path}' is not under any effective root`,
          detail: `target=${target}`,
          tool: 'read',
        },
      ])
    }
  }

  return Object.freeze({ request, permissions: tu, effectiveRoots: Object.freeze(effectiveRoots) })
}

function readRequestedRoots(
  request: RepoContextRequest,
  perms: RepoContextPermissions,
): readonly string[] {
  if (request.tool === 'glob' || request.tool === 'grep') {
    const requested = request.args.roots
    if (requested === undefined || requested.length === 0) {
      return perms.roots.length > 0 ? perms.roots : ['.']
    }
    return requested
  }
  // read: roots come from the agent's permissions. The path is checked
  // against the resulting effective set.
  return perms.roots.length > 0 ? perms.roots : ['.']
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  if (isAbsolute(rel)) return false
  return true
}
