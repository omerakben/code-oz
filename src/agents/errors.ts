export type AgentLoadErrorCode =
  | 'frontmatter_missing_delimiter'
  | 'frontmatter_invalid_yaml'
  | 'frontmatter_duplicate_key'
  | 'frontmatter_not_object'
  | 'schema_missing_field'
  | 'schema_invalid_value'
  | 'schema_invalid_name'
  | 'schema_name_file_mismatch'
  | 'schema_description_too_long'
  | 'schema_invalid_permissions'
  | 'schema_invalid_body'
  | 'loader_invalid_symlink'
  | 'loader_io_error'
  | 'loader_phase_mismatch_override'
  | 'loader_cross_family_violation'

export interface AgentLoadIssue {
  readonly file: string
  readonly code: AgentLoadErrorCode
  readonly rule: string
  readonly detail?: string
}

export class AgentLoadError extends Error {
  readonly issues: readonly AgentLoadIssue[]

  constructor(issues: readonly AgentLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('AgentLoadError requires at least one issue')
    }
    const summary =
      issues.length === 1
        ? `${issues[0]!.file}: ${issues[0]!.rule}`
        : `${issues.length} agent loading issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'AgentLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
