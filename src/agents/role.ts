// M13 (Codex Q9 lock, CODEX_RESPONSE_M13.md, thread 019de672): canonical
// CompanyRole identity for an agent definition. Used by the six bundled-
// role invocation sites to populate `ProviderRequest.role` so the wrapper
// layer can apply per-role budget gating and per-role soft warnings.
//
// The canonicalizer fails CLOSED on every name outside `M12_COMPANY_ROLES`:
// - Project-local personas with names outside the roster return undefined;
//   their invocations bypass per-role gating (global + per-phase still
//   enforce — rule 19).
// - Synthetic debate-opponent agents (`src/tools/debate-request.ts`)
//   intentionally use names outside the roster, so they also return
//   undefined. The opposing turn is a real provider call counted against
//   global + per-phase, never against a role budget.
//
// Authority: `M12_COMPANY_ROLES` is the single source of truth (rule 20).

import { M12_COMPANY_ROLES, type CompanyRole } from '../config/schema.ts'

/**
 * Map an agent definition (or anything with a `name` property) to its
 * CompanyRole identity. Returns undefined when `agent.name` is not in the
 * locked six-role roster — including project-local personas, synthetic
 * debate-opponent agents, and anything else outside `M12_COMPANY_ROLES`.
 */
export function canonicalRoleFromAgent(agent: { readonly name: string }): CompanyRole | undefined {
  if ((M12_COMPANY_ROLES as readonly string[]).includes(agent.name)) {
    return agent.name as CompanyRole
  }
  return undefined
}
