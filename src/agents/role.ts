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
// Authority: this file is the leaf module that owns the role identity
// vocabulary. `src/config/schema.ts` re-exports `M12_COMPANY_ROLES` and
// `CompanyRole` for back-compat with existing consumers, but the
// definitions live here so the type can flow into `ProviderRequest.role`
// (`src/providers/types.ts`) without re-introducing the
// providers → agents → providers cycle. M13 review fix-soon #1 closure
// (CODEX_REVIEW_M13.md).
//
// This module imports nothing — it is the leaf. Changing that property
// would re-introduce the cycle the move was designed to break.

/**
 * Locked six-role roster shipped by M12. Project-local personas with
 * names outside this list are not routable as company roles in v0.1
 * (custom-role routing is M16+ work, gated on measurable need).
 */
export const M12_COMPANY_ROLES = [
  'ba',
  'lead',
  'builder',
  'verifier',
  'reviewer',
  'scientist',
] as const
export type CompanyRole = (typeof M12_COMPANY_ROLES)[number]

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
