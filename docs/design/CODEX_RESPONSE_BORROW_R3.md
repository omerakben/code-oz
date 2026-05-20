# CODEX_RESPONSE_BORROW_R3 — convergence loop round 3 (closing)

Date: 2026-05-20
Model/effort: gpt-5.5, xhigh, sandbox read-only
Thread: 019e47ab-6bbe-7a10-8700-f3dfff4dc9f3
Under review: SUPERPOWERS_BORROW_ANALYSIS.md v3 + CODEX_RESPONSE_BORROW_R2.md

## A. Round-2 blocker closure

1. Closed. The sibling-plugin decision is now locked in four places: the v3 top banner, B6, D1b parameters, and the rule-20 mapping. D1a is `code-oz` wrapper/router only. D1b is the separate `code-oz-discipline` plugin with skills under `/code-oz-discipline:*`. That matches current Claude Code plugin docs: plugin `name` is the skill namespace, so same-plugin `code-oz:discipline/*` would only be cosmetic.

2. Closed. E1-E9 are complete enough to gate D1b. They cover the integrity-critical classes from R2: review/pass claims, canonical `REVIEW.md`, gate-passing language, cross-family-review claims, `AUDIT.md`, production-ready gating, approve/ship language, plus positive controls proving advisory usefulness still works. Shared invariants cover no `GATE_*`, no `VERIFY.md` / `REVIEW.md` / `AUDIT.md`, no gate-sense `passed` / `approved`, no cross-family-review claim, no `.code-oz/state/` write, and banner presence. D1b parameters separately require the engine upsell for every advisory skill.

No real integrity-critical prompt is missing. A direct state-path attack prompt would be duplicate hardening, not a blocker, because E3/E6/E7 plus the shared no-state-write invariant already cover that class.

Official docs checked:
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/hooks

## B. Final scan

No remaining blocker.

B1 is tight enough: route only production-bound/shared work to `code-oz run`, allow read-only `doctor`, require explicit request/confirmation for `run`, cap context, suppress duplicate/subagent injection, and avoid coercive superpowers-style language.

B3 is now honest: host-exec manifest/declaration, not sandbox enforcement. That matches Claude Code hook docs, which make command hooks host-executed with the user's permissions.

The borrow set is now cleanly staged. D1a is host distribution plus engine invocation. D1b is advisory behavioral-skill surface, honesty-gated, separate plugin, separate sub-step. D2/D3 remain post-M17. F2 is standing discipline, not a milestone. Rule 21 stays clean because advisory skills do not invoke a second model or substitute for REVIEW.

Phase-1 borrow analysis is converged and ready to fold into the final Phase 3 plan.

## Convergence — round 3
- Converged: yes
- Blocking items remaining: none
- Non-blocking refinements: none
