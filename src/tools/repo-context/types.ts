// Public types for the repo-context tool family.
//
// Tools live BETWEEN provider invocations: a persona issues a `tool_use` block
// in its provider response; the wrapper detects it, runs the appropriate tool,
// and feeds the result back as a `tool_result` continuation. Selected paths
// flow into the NEXT invocation's ProviderRequest.files (preserving rule 13's
// explicit-manifest invariant).

export type RepoContextToolName = 'glob' | 'grep' | 'read' | 'symbol'

export interface GlobArgs {
  readonly pattern: string
  /** Optional override for roots; intersected with agent.permissions.read. */
  readonly roots?: readonly string[]
}

export interface GrepArgs {
  readonly pattern: string
  readonly roots?: readonly string[]
  readonly regex?: boolean
  readonly ignoreCase?: boolean
}

export interface ReadArgs {
  readonly path: string
  /** Inclusive [start, end] line range; 1-indexed. Optional; full file when omitted. */
  readonly lineRange?: readonly [number, number]
}

export type RepoContextRequest =
  | { readonly tool: 'glob'; readonly args: GlobArgs }
  | { readonly tool: 'grep'; readonly args: GrepArgs }
  | { readonly tool: 'read'; readonly args: ReadArgs }

export interface GrepMatch {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

export interface GlobResult {
  readonly tool: 'glob'
  readonly paths: readonly string[]
  readonly truncated: boolean
  readonly resultBytes: number
}

export interface GrepResult {
  readonly tool: 'grep'
  readonly matches: readonly GrepMatch[]
  readonly truncated: boolean
  readonly resultBytes: number
}

export interface ReadResult {
  readonly tool: 'read'
  readonly path: string
  readonly content: string
  readonly truncated: boolean
  readonly resultBytes: number
}

export type RepoContextResult = GlobResult | GrepResult | ReadResult

/** Conservative grep snippet cap; avoids over-long lines blowing past
 *  maxBytesPerResult. */
export const GREP_SNIPPET_MAX_CHARS = 200
