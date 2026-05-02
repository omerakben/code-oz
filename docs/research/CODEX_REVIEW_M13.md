# Codex implementation review — M13

**Thread:** `019de6ad-1170-7c93-83ba-74613183c2cc`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`, `cwd: /Users/ozzy-mac/Projects/code-oz`
**Date:** 2026-05-01
**Reviewed:** commits `4f6d8bc^..dddcf1d` on branch
`feat/m13-role-cost-policy` (range adjusted by Codex to include the
first M13 commit; plain `4f6d8bc..dddcf1d` would exclude it).

## Verdict

`fix-first`.

I treated the reviewed implementation as `4f6d8bc^..dddcf1d` because
`4f6d8bc` is the first M13 commit; plain `4f6d8bc..dddcf1d` excludes it.

Codex blocker status:

- Blocker 1: partially closed. `ProviderRequest.role` exists and call
  sites pass it, but per-role token accounting still derives
  completed-call role from agent name.
- Blocker 2: closed. `byRole` excludes `maxTurns` in
  [schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:51),
  and `maxTurns` is rejected as an unsupported row key in
  [load.ts](/Users/ozzy-mac/Projects/code-oz/src/config/load.ts:394).
- Blocker 3: closed. Claude model prices live in
  `DEFAULT_CONFIG.budgets.global.priceTable` in
  [schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:212),
  while `DEFAULT_CAPABILITY_BY_ID.claude` still omits `costPerMTok` in
  [capabilities.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/capabilities.ts:88).

Validation: `bun run typecheck` passed. `git diff --check
4f6d8bc^..dddcf1d` passed. Focused M13 tests were partially blocked by
read-only sandbox `mkdtemp EPERM`; the pure cost/event/cascade tests in
that run passed before temp-backed config tests failed.

## Block-push findings

1. Per-role `budget_warning` events lose their role before they hit
   `events.jsonl`.

`detectBudgetSoftWarnings` returns `SoftBudgetWarning.role`, but the
writer in
[invoke.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/invoke.ts:156)
appends only `metric`, `ratio`, `current`, and `limit`. That violates
the M13 Q8 contract and makes per-role warnings look global. It also
breaks the duplicate guard because future warning detection keys prior
events as `maxTokensEstimate|global` instead of
`maxTokensEstimate|builder`.

Fix: include `...(w.role !== undefined ? { role: w.role } : {})` in the
appended `budget_warning` event, and add an `invokeAgent` integration
test proving a byRole soft warning persists `role`.

2. Per-role token accounting still sniffs `agent_completed.agent`.

In [cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:162),
completion handling derives role via
`canonicalRoleFromAgent({ name: e.agent })` at
[cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:176).
That means completed-call role is inferred from agent name, not from
the explicit `agent_invoked.role` field. This leaves blocker 1 not
fully closed.

Fix: make the pending queue store `{ estimate, role }` from
`agent_invoked`; when an `agent_completed` arrives, consume the
matching pending record and apply `tokensUsed` to that stored role.
The cost reducer should not import `canonicalRoleFromAgent`.

## Fix-soon findings

- `ProviderRequest.role` is still typed as `string`, not `CompanyRole`,
  in [types.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/types.ts:82).
  Runtime validation catches bad roles at event write, but the
  TypeScript contract does not match the Codex resolution. Move
  `CompanyRole`/`M12_COMPANY_ROLES` to a lower-level roles module or
  export a dedicated role type without creating the current import
  cycle.

- There is no wrapper-level test for role-bearing `budget_warning`
  emission. Existing tests cover the pure detector in
  [cost-byrole.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/cost-byrole.test.ts:243)
  and the event validator in
  [state-events-m13.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/state-events-m13.test.ts:140),
  but not the `invokeAgent` writer path that currently drops the field.

## Nits

- The invocation sites call `canonicalRoleFromAgent(...)` twice inside
  object spreads, for example
  [ask-me.ts](/Users/ozzy-mac/Projects/code-oz/src/phases/ask-me.ts:437)
  and [plan.ts](/Users/ozzy-mac/Projects/code-oz/src/phases/plan.ts:506).
  Compute once before constructing the request.

- [COMPANY.md](/Users/ozzy-mac/Projects/code-oz/docs/contracts/COMPANY.md:178)
  marks M13 as closed before this review has cleared. That is harmless
  locally, but it should land only after the fix-first commit.

## Final recommendation

Do not push or tag `v0.14.0-alpha.0` yet. Fix the two block-push
findings, add the missing `invokeAgent` warning-role regression test,
then rerun `bun run typecheck` and the focused M13 tests outside the
read-only sandbox.

---

# Claude closure plan (2026-05-01)

Per the no-tech-debt memory (`feedback_no_tech_debt.md`), every
block-push and fix-soon finding closes in this milestone before tag.
Nits may defer with explicit user approval; I'll close all of them
opportunistically since they're cheap.

## Closure commits planned

1. **`fix(providers): persist budget_warning.role in events.jsonl + cost reducer uses explicit role pairing`**
   - Block-push #1: include `role` in the appended `budget_warning`
     event in `src/providers/invoke.ts`.
   - Block-push #2: change `pendingByRole` queue from `number[]` to
     `Array<{ estimate: number, role?: string }>` populated from
     `agent_invoked.role` directly; remove
     `canonicalRoleFromAgent` import from `src/providers/cost.ts`.
   - Fix-soon #2: add a wrapper-integration test proving a byRole
     soft warning persists `role` round-trip.
   - Nit #1: factor `canonicalRoleFromAgent(...)` into a single local
     `const role = canonicalRoleFromAgent(...)` at each call site
     instead of two evaluations inside the spread.

2. **`refactor(types): move M12_COMPANY_ROLES to a leaf module + ProviderRequest.role typed as CompanyRole`**
   - Fix-soon #1: extract `M12_COMPANY_ROLES` + `CompanyRole` to a
     leaf module (e.g., `src/agents/roles.ts`) so
     `src/providers/types.ts` can import it without creating a cycle.
     Update existing importers (`src/config/schema.ts`,
     `src/agents/loader.ts`, `src/agents/role.ts`,
     `src/state/events.ts`, `src/config/load.ts`).
   - Tighten `ProviderRequest.role` from `string` to
     `CompanyRole | undefined`.
   - Verify cycle is broken via typecheck.

3. **`docs(m13): mark COMPANY.md M13 closure after fix-first cycle clears`** (combined with above or separate)
   - Nit #2 — but actually marking M13 as closed now is correct
     since the fix-first cycle resolves before tag. The doc text
     stays. (Will revisit if needed.)

After the closure commits land, re-run Codex review on the new commits
to confirm the verdict flips to `push`. Tag pending Ozzy approval.

## Test deltas expected

- One new wrapper-integration test for byRole soft warning
  persistence (Codex fix-soon #2).
- The cost-byrole.test.ts pendingByRole change may need test
  updates if any tests inspect the internal queue shape (they
  don't — the tests test public invariants).
- Suite should remain green; no behavioral regressions intended.
