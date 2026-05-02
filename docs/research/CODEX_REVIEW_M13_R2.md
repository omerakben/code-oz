# Codex implementation review — M13 (round 2)

**Thread:** `019de6b8-bfab-7721-9405-afaa1346f410`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`
**Date:** 2026-05-01
**Reviewed:** post-fix range — commits `b567b03` and `fc713a9` on top of
`dddcf1d` (the original M13 commit-7 closure).

## Verdict

fix-first

## Findings

1. Contract drift remains in the canonical provider spec.
   [docs/references/provider-contract.md](/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md:1)
   declares itself the canonical provider contract, but its
   `ProviderRequest` snippet still omits `role?: CompanyRole` at
   [docs/references/provider-contract.md](/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md:46),
   and its cost-budget section still describes only per-phase/global
   checks at
   [docs/references/provider-contract.md](/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md:184).
   That conflicts with the new M13 surface, and
   [docs/references/budgets.md](/Users/ozzy-mac/Projects/code-oz/docs/references/budgets.md:7)
   explicitly says conflicts resolve to `provider-contract`. Fix
   before push: either update `provider-contract.md` with
   `ProviderRequest.role`, `byRole`, `costEstimateUSD` /
   `costActualUSD`, and the per-phase → per-role → global order, or
   make `budgets.md` the canonical budget contract instead of
   subordinate prose.

2. Stale comment in the fixed reducer still describes the old blocker.
   [src/providers/cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:68)
   says completed-call role is populated via
   `canonicalRoleFromAgent({name: agent})`; the implementation below
   correctly uses the queued `agent_invoked.role`. This is comment-only,
   but it is directly adjacent to the round-1 block-push #2 fix and
   should be corrected with the docs fix.

## What I verified

- Block-push #1 is behaviorally closed:
  [src/providers/invoke.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/invoke.ts:156)
  appends `budget_warning` with
  `...(w.role !== undefined ? { role: w.role } : {})`.
- Block-push #2 is behaviorally closed:
  [src/providers/cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:125)
  stores `{ estimate, role }` in `pendingByPhase`, and
  [src/providers/cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:159)
  consumes the queued role on `agent_completed`. No runtime import/call
  to `canonicalRoleFromAgent` remains in `cost.ts`.
- Fix-soon #1 is closed in code:
  [src/agents/role.ts](/Users/ozzy-mac/Projects/code-oz/src/agents/role.ts:31)
  owns `M12_COMPANY_ROLES` / `CompanyRole` as a leaf module,
  [src/config/schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:15)
  re-exports it, and
  [src/providers/types.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/types.ts:86)
  types `ProviderRequest.role` as `CompanyRole`.
- Fix-soon #2 is covered:
  [tests/provider-invoke-role.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/provider-invoke-role.test.ts:166)
  asserts the byRole soft-warning round trip and
  [tests/provider-invoke-role.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/provider-invoke-role.test.ts:202)
  preserves global-warning back-compat.
- Nit #1 is closed at the invocation sites I checked: ask-me, plan,
  scientist, review-request, and debate synthesis each compute
  `canonicalRoleFromAgent` once into a local.
- M11/M12 runtime invariants looked intact: provider capability tests,
  family-aware loader tests, provider type/cost tests, company override
  tests, and cost wall-time tests passed.

Validation run:

```text
bun run typecheck
pass

bun test tests/agents-role.test.ts tests/cost-byrole.test.ts tests/state-events-m13.test.ts tests/cost-usd-cascade.test.ts
67 pass, 0 fail

bun test tests/provider-capabilities.test.ts tests/family-aware-loader.test.ts tests/agent-loader-company.test.ts tests/providers-types.test.ts tests/providers-cost.test.ts tests/cost-wall-time.test.ts
87 pass, 0 fail

git diff --check main...HEAD
pass

TypeScript-AST runtime import-cycle scan over src/
no runtime import cycles in src
```

I also attempted temp-backed wrapper/config tests, but the read-only
sandbox blocked them at `mkdtemp EPERM`; the failures were sandbox
write-permission failures, not assertion failures.

## Final recommendation

fix-first

Runtime closure looks good, but M13 should not push with the canonical
provider contract contradicting the new role-cost contract. The fix is
small and docs-only plus one comment cleanup: update
`docs/references/provider-contract.md` so the canonical spec matches
the implemented `ProviderRequest.role`, byRole budget layer, and M13
cost telemetry, then clean the stale `cost.ts` comment and rerun the
same typecheck/focused tests. After that, this should flip to `push`.

---

# Claude closure (2026-05-01)

Both findings closed in the same fix commit:

- **provider-contract.md update:** `ProviderRequest` snippet (line 46)
  now declares `role?: CompanyRole` with the canonicalizer pointer.
  Cost-budget pre-call check section (line 184) now lists per-phase →
  per-role → global ordering, calls out `byRole` semantics including
  the `maxTurns`-absent rule, and adds a new "Cost telemetry" section
  documenting `costEstimateUSD` / `costActualUSD` with the price-cascade
  + Claude defaults + output-tokens-only semantics. Cross-references
  to `docs/references/budgets.md`.
- **Stale comment in cost.ts (line 68):** rewritten to describe the
  fixed pairing (`{estimate, role}` queue records, no
  name-canonicalization on the complete side).

Suite: 2086 pass / 1 skip / 0 fail. Typecheck clean. No M11/M12
invariants touched. After this commit, the canonical provider contract
matches the implementation and the budgets contract; no contract drift.
