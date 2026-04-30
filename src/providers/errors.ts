// Provider error model — typed issue arrays mirroring AgentLoadError (M2)
// and GateLoadError / EventLogError (M3). Adapters throw ProviderError; the
// wrapper layer (commit 7) catches and converts to NEEDS_INTERVENTION.json
// + an `intervention` event.
//
// Every issue carries a machine-readable `code`, a human-readable `rule`,
// optional `detail`, and a non-empty `actionableSuggestions` list. The
// suggestions are required: every error a user sees must propose a concrete
// next step (a shell command, a config key to raise, a doc link).

export type ProviderErrorCode =
  | 'provider_auth_missing'
  | 'provider_auth_expired'
  | 'provider_rate_limit'
  | 'provider_malformed_response'
  | 'provider_budget_exceeded'
  | 'provider_permissions_violation'
  | 'provider_tool_call_cap_exceeded'
  | 'provider_gemini_not_yet_supported'
  | 'provider_io_error'

export interface ProviderErrorIssue {
  readonly code: ProviderErrorCode
  readonly rule: string
  readonly detail?: string
  /**
   * Required, non-empty. At least one entry should be a concrete shell
   * command or a config key the user can act on.
   */
  readonly actionableSuggestions: readonly string[]
}

export class ProviderError extends Error {
  readonly issues: readonly ProviderErrorIssue[]

  constructor(issues: readonly ProviderErrorIssue[]) {
    if (issues.length === 0) {
      throw new Error('ProviderError requires at least one issue')
    }
    for (const issue of issues) {
      if (!issue.actionableSuggestions || issue.actionableSuggestions.length === 0) {
        throw new Error(
          `ProviderError issue ${JSON.stringify(issue.code)} must include at least one actionableSuggestion`,
        )
      }
    }
    const summary = issues
      .map((i) => `[${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
      .join('\n')
    super(`provider error (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${summary}`)
    this.name = 'ProviderError'
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })))
  }
}

/**
 * Convenience factory for the common single-issue case. Equivalent to
 * `new ProviderError([{ code, rule, detail, actionableSuggestions }])`.
 */
export function providerError(
  code: ProviderErrorCode,
  rule: string,
  actionableSuggestions: readonly string[],
  detail?: string,
): ProviderError {
  const issue: ProviderErrorIssue = detail !== undefined
    ? { code, rule, detail, actionableSuggestions }
    : { code, rule, actionableSuggestions }
  return new ProviderError([issue])
}
