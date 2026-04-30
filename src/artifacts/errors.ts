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

// --- PLAN.md errors ------------------------------------------------

export type PlanLoadErrorCode =
  | 'plan_empty'
  | 'plan_missing_title'
  | 'plan_missing_section'
  | 'plan_section_out_of_order'
  | 'plan_section_duplicated'
  | 'plan_section_unknown'
  | 'plan_section_empty'
  | 'plan_unexpected_content'
  | 'plan_invalid_bullet'
  | 'plan_task_malformed'
  | 'plan_task_id_collision'
  | 'plan_task_id_format'
  | 'plan_task_missing_block'
  | 'plan_io_error'

export interface PlanLoadIssue {
  readonly file: string
  readonly code: PlanLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
  readonly taskId?: string
}

export class PlanLoadError extends Error {
  readonly issues: readonly PlanLoadIssue[]

  constructor(issues: readonly PlanLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('PlanLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} PLAN issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'PlanLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}

// --- SOURCE_CHECK.md errors ----------------------------------------

export type SourceCheckLoadErrorCode =
  | 'source_check_empty'
  | 'source_check_missing_title'
  | 'source_check_missing_section'
  | 'source_check_section_out_of_order'
  | 'source_check_section_duplicated'
  | 'source_check_section_unknown'
  | 'source_check_section_empty'
  | 'source_check_unexpected_content'
  | 'source_check_id_collision'
  | 'source_check_id_format'
  | 'source_check_id_kind_mismatch'
  | 'source_check_block_missing_field'
  | 'source_check_none_missing_rationale'
  | 'source_check_coverage_invalid'
  | 'source_check_coverage_unknown_source'
  | 'source_check_io_error'

export interface SourceCheckLoadIssue {
  readonly file: string
  readonly code: SourceCheckLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
  readonly sourceId?: string
}

export class SourceCheckLoadError extends Error {
  readonly issues: readonly SourceCheckLoadIssue[]

  constructor(issues: readonly SourceCheckLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('SourceCheckLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} SOURCE_CHECK issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'SourceCheckLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}

// --- HYPOTHESES.md errors ------------------------------------------

export type HypothesesLoadErrorCode =
  | 'hypotheses_empty'
  | 'hypotheses_missing_title'
  | 'hypothesis_missing_section'
  | 'hypothesis_no_falsifier'
  | 'hypothesis_id_collision'
  | 'hypothesis_id_format'
  | 'hypothesis_invalid_status'
  | 'hypothesis_invalid_phase'
  | 'hypothesis_unexpected_content'
  | 'hypotheses_io_error'

export interface HypothesesLoadIssue {
  readonly file: string
  readonly code: HypothesesLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
  readonly hypothesisId?: string
}

export class HypothesesLoadError extends Error {
  readonly issues: readonly HypothesesLoadIssue[]

  constructor(issues: readonly HypothesesLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('HypothesesLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} HYPOTHESES issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'HypothesesLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}

// --- OPEN_QUESTIONS.md errors --------------------------------------

export type OpenQuestionsLoadErrorCode =
  | 'open_questions_empty'
  | 'open_questions_missing_title'
  | 'question_missing_section'
  | 'question_id_collision'
  | 'question_id_format'
  | 'question_invalid_status'
  | 'question_invalid_importance'
  | 'question_invalid_phase'
  | 'question_invalid_dueby'
  | 'question_resolved_missing_resolution'
  | 'question_unexpected_content'
  | 'open_questions_io_error'

export interface OpenQuestionsLoadIssue {
  readonly file: string
  readonly code: OpenQuestionsLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
  readonly questionId?: string
}

export class OpenQuestionsLoadError extends Error {
  readonly issues: readonly OpenQuestionsLoadIssue[]

  constructor(issues: readonly OpenQuestionsLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('OpenQuestionsLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} OPEN_QUESTIONS issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'OpenQuestionsLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
