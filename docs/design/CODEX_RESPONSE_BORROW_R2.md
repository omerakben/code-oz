# CODEX_RESPONSE_BORROW_R2 — convergence loop round 2

Date: 2026-05-20
Model/effort: gpt-5.5, xhigh, sandbox read-only
Thread: 019e47a3-6b00-7dc1-b86d-ed8cd6b337b0
Under review: SUPERPOWERS_BORROW_ANALYSIS.md v2 + CODEX_RESPONSE_BORROW_R1.md

## A. Round-1 blockers

1. Closed. B2 is split into B2a manifest packaging and B2b host bootstrap behavior. D1a is Claude-only; D2/D3 are deferred.

2. Closed. B3 is reclassified as executable hook infrastructure. D1a gets Unix hook only; Windows polyglot waits unless the v0.20.2 Windows deliverable explicitly covers host plugin hooks, plus quoting/no-bash review.

3. Closed with one wording tighten. B1 now has trigger scope, authority bound, 1500-token cap, idempotent marker, coexistence rules, consent semantics, and subagent skip. Interpret consent as: `code-oz run` only after explicit user request or confirmation; read-only `doctor` may run without prompting.

4. Closed. B4 now requires structured stream-json parsing, offline `FakeProvider` engine invocation proof, filesystem assertion that skills do not write `.code-oz/`, negative gate-shaped-output tests, and no reliance on `--dangerously-skip-permissions` as product proof.

5. Not fully closed. Banner, denylist, output policy, upsell, and universal-rules import are locked. Two pieces remain: final D1b namespace decision and exact D1b adversarial eval corpus. Current Claude Code docs make plugin name the real namespace (`/plugin-name:skill-name`), so `code-oz:discipline/*` inside the same plugin is only a naming convention, not a hard UX split.

## B. New-problem check

B1 is sound. The trigger heuristic is tight enough: production-bound/shared code routes to the engine; throwaway scripts, pure questions, and read-only exploration do not. Keep the router card short and non-coercive. The subagent-stop rule is also right, but implementation should test that no router card is injected when hook input has `agent_id`, and that no `SubagentStart` router context is registered.

B3 rule-9 manifest is the right call, not a category error, because code-oz would be distributing the executable hook. But call it a host-exec manifest/declaration, not runtime sandbox enforcement. Claude Code command hooks run with the user's host permissions. The manifest can validate intended command/env/file/network behavior in CI and review; it cannot honestly claim file-root or network enforcement unless the runner adds an actual sandbox. For D1a's SessionStart context injection, declared read-plugin-dir/no-network behavior is acceptable.

D1b is not airtight if it stays in the same `code-oz` plugin. Commit to the sibling plugin now: D1a stays `code-oz` and contains wrapper/router only; D1b becomes `code-oz-discipline` with advisory skills under `/code-oz-discipline:*`. The existing banner, denylist, non-canonical output policy, and engine upsell are the right mitigations once the namespace is truly separate.

Sources checked for current host behavior: Claude Code plugin docs and reference, plus hooks docs:
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills

## C. Residual open items

1. B1 trigger scope: confirmed tight enough. No change beyond the consent wording above.

2. D1b namespace/UX: do not rely on same-plugin UX. Use sibling `code-oz-discipline` now.

3. B3 rule-9 manifest: correct as a code-oz-distributed host-exec contract. Not correct if described as code-oz runtime permission enforcement.

4. Remaining missing/misclassification: no remaining reclassification issue. The only missing material is the exact D1b adversarial eval corpus and the sibling-plugin lock.

## Convergence — round 2
- Converged: no
- Blocking items remaining:
1. Revise D1b to a sibling plugin now: `code-oz` contains wrapper/router only; `code-oz-discipline` contains advisory skills under `/code-oz-discipline:*`.
2. Add the exact D1b adversarial eval corpus: prompt list plus expected assertions covering gate/review/audit/enforcement language, no `GATE_*`, no `VERIFY.md`/`REVIEW.md`/`AUDIT.md`, no gate-sense `passed`/`approved`, no cross-family-review claim, no canonical writes, banner present, engine upsell present.
- Non-blocking refinements:
1. Tighten B1 consent wording: `code-oz run` requires explicit user request or confirmation; read-only `doctor` may run without prompting.
2. In B3, say host-exec manifest/declaration and not runtime sandbox; claim actual env/file/network enforcement only where implemented.
3. Add a B1 implementation test for subagent skip: no router card when hook input has `agent_id`, and no `SubagentStart` router injection.
- Anything still missing:
1. Exact D1b adversarial eval corpus.
2. Sibling-plugin decision reflected in v2 itself.
