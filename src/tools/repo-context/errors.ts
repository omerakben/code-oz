// Typed errors for the repo-context tool family. Mirrors the typed-issues
// pattern in src/providers/errors.ts and src/state/errors.ts.

export type RepoContextErrorCode =
  | 'tool_unavailable'              // rg missing on PATH
  | 'tool_root_outside_permissions' // requested root not in agent.permissions.read
  | 'tool_not_in_permissions'       // tool name not in agent's tool_use.repo_context.tools
  | 'tool_no_permissions'           // agent has no tool_use.repo_context scope at all
  | 'tool_timeout'                  // wall-time exceeded the agent's timeoutMs
  | 'tool_invalid_arg'              // malformed pattern, line range, etc.
  | 'tool_subprocess_failed'        // rg exited non-zero with stderr
  | 'tool_io_error'                 // filesystem read failed
  | 'tool_path_unsafe'              // path normalization rejected (.., etc.)

export interface RepoContextErrorIssue {
  readonly code: RepoContextErrorCode
  readonly rule: string
  readonly detail?: string
  readonly tool?: 'glob' | 'grep' | 'read' | 'symbol'
}

export class RepoContextError extends Error {
  readonly issues: readonly RepoContextErrorIssue[]

  constructor(issues: readonly RepoContextErrorIssue[]) {
    if (issues.length === 0) {
      throw new Error('RepoContextError requires at least one issue')
    }
    const first = issues[0]!
    super(
      issues.length === 1
        ? `${first.code}: ${first.rule}`
        : `${issues.length} repo-context issues`,
    )
    this.name = 'RepoContextError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
