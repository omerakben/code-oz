// Typed errors for the artifact layer. Mirrors src/state/errors.ts and
// src/agents/errors.ts: each error class carries a frozen issues array
// with { file, code, rule, detail? } — the same machine-readable contract.

export type SpecLoadErrorCode =
  | 'spec_empty'
  | 'spec_missing_title'
  | 'spec_missing_section'
  | 'spec_section_out_of_order'
  | 'spec_section_duplicated'
  | 'spec_section_unknown'
  | 'spec_section_empty'
  | 'spec_unexpected_content'
  | 'spec_invalid_bullet'
  | 'spec_io_error'

export interface SpecLoadIssue {
  readonly file: string
  readonly code: SpecLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class SpecLoadError extends Error {
  readonly issues: readonly SpecLoadIssue[]

  constructor(issues: readonly SpecLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('SpecLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} SPEC issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'SpecLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
