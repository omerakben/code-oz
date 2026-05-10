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
  // Defense-in-depth for the reserved-but-not-permissionable slot. Config
  // load (validateRepoContext) already rejects 'symbol' in tools[]; this
  // guard catches any caller that builds a request directly bypassing the
  // type union (JSON-decoded payloads, untyped tests, future call sites
  // that take untrusted input). Aligned with docs/contracts/REPO_CONTEXT.md
  // § "Reservation and reopen-the-slot signal". The cast through `string`
  // is intentional: `RepoContextRequest` does NOT include a 'symbol' arm,
  // so this check is unreachable from typed callers and only fires when
  // someone reaches the runtime with an untyped `tool` field.
  if ((request.tool as string) === 'symbol') {
    throw new RepoContextError([
      {
        code: 'tool_unavailable',
        rule:
          "'symbol' is RESERVED and not permissionable in v0.x. " +
          'See docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot signal".',
        tool: 'symbol',
      },
    ])
  }
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
  const candidateRoots = readRequestedRoots(request, tu, projAbs)
  const effectiveRoots: string[] = []
  for (const r of candidateRoots) {
    if (r.startsWith('__OUTSIDE_DECLARED__:')) {
      const original = r.slice('__OUTSIDE_DECLARED__:'.length)
      throw new RepoContextError([
        {
          code: 'tool_root_outside_permissions',
          rule: `requested root '${original}' is outside the agent's declared roots [${tu.roots.join(', ')}]`,
          tool: request.tool,
        },
      ])
    }
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
  projectRoot: string,
): readonly string[] {
  const declaredAbs = (perms.roots.length > 0 ? perms.roots : ['.']).map((r) =>
    isAbsolute(r) ? normalize(r) : resolve(projectRoot, r),
  )
  if (request.tool === 'glob' || request.tool === 'grep') {
    const requested = request.args.roots
    if (requested === undefined || requested.length === 0) {
      return declaredAbs
    }
    // Intersect: every requested root must be inside at least one declared
    // root. Anything outside fails permission intersection (caller throws).
    const intersected: string[] = []
    for (const r of requested) {
      const reqAbs = isAbsolute(r) ? normalize(r) : resolve(projectRoot, r)
      if (declaredAbs.some((d) => isInside(d, reqAbs))) {
        intersected.push(r)
      } else {
        // Bubble the violation up via a sentinel root the caller will reject.
        // We keep the original (relative) form so the error message is clear.
        intersected.push(`__OUTSIDE_DECLARED__:${r}`)
      }
    }
    return intersected
  }
  // read: roots come from the agent's permissions. The path is checked
  // against the resulting effective set.
  return declaredAbs
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  if (isAbsolute(rel)) return false
  return true
}
