// Typed errors for the state layer. Mirrors src/agents/errors.ts: each error class
// carries a frozen issues array with { file, code, rule, detail? } — the same
// machine-readable contract as AgentLoadError.

export type GateLoadErrorCode =
  | 'gate_invalid_json'
  | 'gate_invalid_version'
  | 'gate_missing_field'
  | 'gate_invalid_value'
  | 'gate_invalid_runid'
  | 'gate_invalid_phase'
  | 'gate_invalid_timestamp'
  | 'gate_artifact_missing'
  | 'gate_artifact_path_unsafe'
  | 'gate_artifact_sha256_mismatch'
  | 'gate_idempotency_violation'
  | 'gate_written_event_missing_file'
  | 'gate_io_error'
  | 'gate_lock_busy'

export interface GateLoadIssue {
  readonly file: string
  readonly code: GateLoadErrorCode
  readonly rule: string
  readonly detail?: string
}

export class GateLoadError extends Error {
  readonly issues: readonly GateLoadIssue[]

  constructor(issues: readonly GateLoadIssue[]) {
    if (issues.length === 0) {
      throw new Error('GateLoadError requires at least one issue')
    }
    const summary =
      issues.length === 1
        ? `${issues[0]!.file}: ${issues[0]!.rule}`
        : `${issues.length} gate loading issues across ${new Set(issues.map((i) => i.file)).size} file(s)`
    super(summary)
    this.name = 'GateLoadError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}

export type EventLogErrorCode =
  | 'actor_attribution_missing'
  | 'event_invalid_json'
  | 'event_invalid_version'
  | 'event_missing_field'
  | 'event_invalid_type'
  | 'event_invalid_value'
  | 'event_invalid_runid'
  | 'event_invalid_phase'
  | 'event_invalid_timestamp'
  | 'event_partial_line'
  | 'event_io_error'
  | 'event_lock_busy'

export interface EventLogIssue {
  readonly file: string
  readonly code: EventLogErrorCode
  readonly rule: string
  readonly detail?: string
  readonly line?: number
}

export class EventLogError extends Error {
  readonly issues: readonly EventLogIssue[]

  constructor(issues: readonly EventLogIssue[]) {
    if (issues.length === 0) {
      throw new Error('EventLogError requires at least one issue')
    }
    const summary =
      issues.length === 1
        ? `${issues[0]!.file}: ${issues[0]!.rule}`
        : `${issues.length} event log issues`
    super(summary)
    this.name = 'EventLogError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}
