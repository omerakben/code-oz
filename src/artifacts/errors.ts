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

// --- AUDIT.md errors -----------------------------------------------
//
// Parse-time validator codes for the brownfield AUDIT.md artifact. The set
// mirrors the rejection rules in docs/contracts/AUDIT.md. Two contract codes
// are intentionally NOT emitted by the parse-time validator:
//   - `audit_reproduction_unresolved_not_routed` (rule 15) is a cross-file
//     check owned by gate-preflight (`validateScientistSidecars`), because
//     OPEN_QUESTIONS.md is written by the Scientist phase-tail after AUDIT.md.
//   - `audit_validation_failed` is an orchestrator-level outcome (the draft
//     failed repair + finalize rituals), not a structural parse rule.

export type AuditLoadErrorCode =
  | 'audit_empty'
  | 'audit_missing_frontmatter'
  | 'audit_frontmatter_malformed'
  | 'audit_frontmatter_wrong_artifact'
  | 'audit_frontmatter_wrong_phase'
  | 'audit_frontmatter_wrong_profile'
  | 'audit_frontmatter_runid_mismatch'
  | 'audit_title_missing'
  | 'audit_missing_section'
  | 'audit_section_out_of_order'
  | 'audit_section_duplicated'
  | 'audit_section_empty'
  | 'audit_localization_missing_citation'
  | 'audit_localization_citation_format'
  | 'audit_localization_missing_separator'
  | 'audit_reproduction_no_proposed'
  | 'audit_reproduction_observed_unverified'
  | 'audit_unexpected_content'
  | 'audit_io_error'

export interface AuditLoadIssue {
  readonly file: string
  readonly code: AuditLoadErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class AuditLoadError extends Error {
  readonly issues: readonly AuditLoadIssue[]

  constructor(issues: readonly AuditLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('AuditLoadError requires at least one issue')
    }
    const first = issues[0]!
    const summary =
      issues.length === 1
        ? `${first.file}: ${first.rule}`
        : `${issues.length} AUDIT issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'AuditLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
