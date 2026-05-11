// Orchestrator for repo-context tool calls.
//
// Steps:
//   1. Intersect agent permissions with the request → effective roots.
//   2. Run the tool with timeout + caps.
//   3. Append a `repo_context_searched` event to events.jsonl (selectedPaths
//      starts as []; the next invocation's wrapper updates it when the
//      agent's tool-result includes selection metadata).
//   4. Return the typed result for the caller (PLAN orchestrator) to feed
//      back into the agent's tool_result continuation.

import { execGlob } from './glob.ts'
import { execGrep } from './grep.ts'
import { execRead } from './read.ts'
import { intersectPermissions } from './permissions.ts'
import { RepoContextError } from './errors.ts'
import type { AgentPermissions } from '../../agents/schema.ts'
import type { Phase } from '../../state/schemas.ts'
import { appendEvent, type EventLogPaths } from '../../state/events.ts'
import type { RepoContextRequest, RepoContextResult } from './types.ts'

/**
 * Known runnable tool names. `'symbol'` is RESERVED (see
 * docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot signal")
 * and intentionally excluded so the symbol-reservation guard below rejects
 * it before any other operation runs.
 */
const RUNNABLE_TOOLS = new Set<string>(['glob', 'grep', 'read'])

export interface RunRepoContextOptions {
  readonly agentName: string
  readonly agentPermissions: AgentPermissions
  readonly phase: Phase
  readonly runId: string
  readonly projectRoot: string
  readonly eventPaths: EventLogPaths
  readonly now?: () => string
}

export interface RunRepoContextSuccess {
  readonly status: 'ok'
  readonly result: RepoContextResult
}

export interface RunRepoContextFailure {
  readonly status: 'error'
  readonly error: Error
}

export type RunRepoContextOutcome = RunRepoContextSuccess | RunRepoContextFailure

/**
 * Run a single repo-context tool call. Always emits exactly one
 * `repo_context_searched` event (success or failure path).
 */
export async function runRepoContextTool(
  opts: RunRepoContextOptions,
  request: RepoContextRequest,
): Promise<RunRepoContextOutcome> {
  const now = opts.now ?? (() => new Date().toISOString())

  // Symbol-reservation guard FIRST. An untyped caller (JSON-decoded payload,
  // test bypass, future call site with untrusted input) can reach this
  // function with `tool === 'symbol'` or any other non-runnable tool. We
  // refuse to log an audit event for a tool we cannot describe — `query`
  // and `roots` derivation below assume a known tool arm and would emit a
  // schema-invalid `repo_context_searched` event (query=undefined),
  // breaking `appendEvent` validation and the "always emits one event"
  // guarantee. Reject up front with the same `tool_unavailable` /
  // `RepoContextError` shape `intersectPermissions` uses. Aligned with
  // docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot
  // signal".
  const requestedTool = (request as { readonly tool: string }).tool
  if (!RUNNABLE_TOOLS.has(requestedTool)) {
    const isReserved = requestedTool === 'symbol'
    // The issue `tool` field's union does not include arbitrary strings;
    // cast to the union for reporting. The audit trail still records the
    // raw string via `rule`/`detail` so an unknown-tool regression is
    // diagnosable.
    return {
      status: 'error',
      error: new RepoContextError([
        {
          code: 'tool_unavailable',
          rule: isReserved
            ? "'symbol' is RESERVED and not permissionable in v0.x. " +
              'See docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot signal".'
            : `tool '${requestedTool}' is not a runnable repo_context tool ` +
              `(allowed: ${[...RUNNABLE_TOOLS].join(', ')})`,
          tool: requestedTool as 'glob' | 'grep' | 'read' | 'symbol',
        },
      ]),
    }
  }

  let result: RepoContextResult | null = null
  let err: Error | null = null
  let resultPaths: readonly string[] = []

  try {
    const intersected = intersectPermissions({
      agentPermissions: opts.agentPermissions,
      request,
      projectRoot: opts.projectRoot,
    })
    const tu = intersected.permissions
    if (request.tool === 'glob') {
      result = await execGlob(request.args, {
        maxResults: tu.maxResults,
        maxBytesPerResult: tu.maxBytesPerResult,
        timeoutMs: tu.timeoutMs,
        projectRoot: opts.projectRoot,
        effectiveRoots: intersected.effectiveRoots,
      })
      resultPaths = result.paths
    } else if (request.tool === 'grep') {
      result = await execGrep(request.args, {
        maxResults: tu.maxResults,
        maxBytesPerResult: tu.maxBytesPerResult,
        timeoutMs: tu.timeoutMs,
        projectRoot: opts.projectRoot,
        effectiveRoots: intersected.effectiveRoots,
      })
      resultPaths = result.matches.map((m) => m.path)
    } else if (request.tool === 'read') {
      result = await execRead(request.args, {
        maxBytesPerResult: tu.maxBytesPerResult,
        projectRoot: opts.projectRoot,
      })
      resultPaths = [result.path]
    }
  } catch (e) {
    err = e as Error
  }

  const tool = request.tool
  const query = describeQuery(request)
  const roots = readRequestedRootsForLog(request)
  const resultBytes = result?.resultBytes ?? 0
  const resultTokensEstimate = Math.ceil(resultBytes / 4)

  await appendEvent(opts.eventPaths, {
    version: 1,
    type: 'repo_context_searched',
    ts: now(),
    runId: opts.runId,
    phase: opts.phase,
    agent: opts.agentName,
    tool,
    query,
    roots: Object.freeze([...roots]),
    resultPaths: Object.freeze([...resultPaths]),
    selectedPaths: Object.freeze<string[]>([]),
    resultBytes,
    resultTokensEstimate,
  })

  if (err !== null) return { status: 'error', error: err }
  if (result === null) {
    // Unreachable in v0.x: 'glob' / 'grep' / 'read' all set `result` above,
    // and 'symbol' is rejected by intersectPermissions before we reach the
    // dispatch (see permissions.ts § "Defense-in-depth for the
    // reserved-but-not-permissionable slot"). Kept as a typed safety net
    // so future tool additions cannot regress the invariant silently.
    return {
      status: 'error',
      error: new Error(`runRepoContextTool: unsupported tool '${request.tool}'`),
    }
  }
  return { status: 'ok', result }
}

function describeQuery(req: RepoContextRequest): string {
  if (req.tool === 'glob') return req.args.pattern
  if (req.tool === 'grep') return req.args.pattern
  return req.args.path
}

function readRequestedRootsForLog(req: RepoContextRequest): readonly string[] {
  if (req.tool === 'glob' || req.tool === 'grep') {
    return req.args.roots ?? []
  }
  return []
}
