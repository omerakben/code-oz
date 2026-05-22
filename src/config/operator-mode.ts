// Shared external-operator-mode resolver. Centralizes the precedence
// (CLI --operator flag > env CODE_OZ_OPERATOR > config.yaml operator:) and
// the fail-closed malformed-id rejection in ONE place so `code-oz run` and
// `code-oz approve` resolve operator mode identically. Pure + freezable —
// unit-testable without bootstrap or process.env.

/** Bounded id for an external operator driving the CLI. Alphanumeric plus
 *  `.`, `_`, `:`, `-`; 1-64 chars. Mirrors the historical inline pattern in
 *  src/commands/run.ts so existing operator ids stay valid. */
export const OPERATOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

export interface OperatorModeInputs {
  readonly flagOperator?: string
  readonly flagNonInteractive?: boolean
  readonly envOperator?: string | undefined
  readonly configOperator?: string | undefined
}

export interface OperatorMode {
  readonly operator?: string
  readonly nonInteractive: boolean
}

/** Resolve effective operator mode from CLI flag > env > config.
 *  Validates ALL non-empty sources first, then applies precedence (fail-closed).
 *  A malformed id from any source throws, regardless of which source wins. */
export function resolveOperatorMode(inp: OperatorModeInputs): OperatorMode {
  const candidates = [inp.flagOperator, nonEmpty(inp.envOperator), nonEmpty(inp.configOperator)]
  for (const s of candidates) {
    if (s !== undefined && !OPERATOR_ID_PATTERN.test(s)) {
      throw new Error(`operator id must match ${OPERATOR_ID_PATTERN.source} (got ${JSON.stringify(s)})`)
    }
  }
  const operator = candidates.find((s) => s !== undefined)
  const nonInteractive = inp.flagNonInteractive === true || operator !== undefined
  return Object.freeze(operator !== undefined ? { operator, nonInteractive } : { nonInteractive })
}

function nonEmpty(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s
}
