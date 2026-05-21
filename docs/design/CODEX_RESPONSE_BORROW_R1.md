# CODEX_RESPONSE_BORROW_R1 — convergence loop round 1

Date: 2026-05-20
Model/effort: gpt-5.5, xhigh, sandbox read-only
Thread: 019e479e-97bc-79d1-9f27-c5b09f513596
Under review: SUPERPOWERS_BORROW_ANALYSIS.md (Phase 1 draft)

---

## A. Open questions

1. B1 is mechanically prompt-only, but not authority-free. Position: keep it only as a bounded "behavioral authority" inside D1a, with a tighter contract. It may route a task to `code-oz run`; it may not declare gate status, parse engine output into pass/fail, write `.code-oz/`, simulate review, or fall back to host-local review. The bootstrap text must say "invoke the engine for enforcement," not "you are now enforcing code-oz."

2. Ship D1b in the same plugin, but only if the namespace and UI make the split obvious. Position: same plugin, distinct namespace, for D1: `code-oz` wrapper commands plus `code-oz:discipline/*` advisory skills. If Claude marketplace/plugin UX cannot visually distinguish those surfaces, split to a sibling `code-oz-discipline` plugin before release.

3. Yes, B1 risks context-budget and co-existence collisions, especially with superpowers installed. A co-existence contract is needed. Code-oz should not copy superpowers' full "using-superpowers" style. Use a short, capped router card with an idempotent marker, explicit priority rules, and no coercive "1%" language. It should not duplicate `CLAUDE.md` or `universal-rules.md`; it should point to engine enforcement and wrapper commands.

4. B4 is not sufficient by itself. The skill-triggering harness proves "Claude loaded the skill." D1a also needs an offline `FakeProvider` integration assertion that the wrapper invoked the engine and that all `.code-oz/` gate/artifact/event writes came from the engine path, not the skill/plugin path. It should also assert provider-auth failures surface the engine's `NEEDS_INTERVENTION.json` without host-side fallback.

5. Missing material: explicit-skill-request tests, not only naive-trigger tests; hook registration files as first-class borrow details; context-injection idempotence and size limits; exact D1b denylist/adversarial corpus; and a Windows runner quoting/failure-mode review before borrowing `run-hook.cmd`.

## B. Pressure-test

B1: classification is acceptable only as "prompt-only behavioral authority." Calling it merely prompt-only underplays the rule-20 cost. The risky smuggle is auto-routing too broadly or treating SessionStart text as enforcement. D1a is the right stage only if B1 is engine-wrapper discovery, not advisory discipline.

B2: misclassified. "Per-host manifest" is packaging, but "host-detection bootstrap" is not pure packaging. Split it:
- B2a manifests: packaging.
- B2b host-specific SessionStart output shape: prompt/bootstrap mechanism, D1a for Claude only.
Do not implement Cursor/Copilot branches in D1a just because superpowers has them. That would quietly start D3 early.

B3: misclassified. The polyglot runner is executable hook infrastructure, so it is packaging/runtime-adjacent, not just packaging. It does not own code-oz gates, but it does create a host-executed script surface. If D1a uses it, it belongs in D1a's boundary and needs a permission/command contract. "Folds into existing Windows deliverable" is too loose unless that deliverable explicitly covers host plugin hooks.

B4: classification is right as tooling/test, but the proposed assertion overreaches unless it actually traces engine execution and filesystem writes. Grepping stream-json for `Skill` is not enough for D1a acceptance.

B5: classification is right as tooling/release automation. It is post-M17. Its risk is publishing/repo-sync authority, not runtime authority.

B6: classification is prompt-only, but it is a behavioral authority surface. Do not borrow superpowers' "skills override default system prompt" wording as-is. Code-oz wording must say advisory skills never override user instructions, `CLAUDE.md`, engine contracts, or system/developer constraints. B6 belongs in D1b and must not land with D1a.

Rule-20 mapping is mostly right, with two required fixes:
- D1a = B1 + B2a Claude manifest + B2b Claude bootstrap + B3 if used + B4 acceptance. Keep it one boundary by making every piece serve engine invocation only.
- D1b = B6 plus advisory skills. Separate commit/sub-step remains mandatory. No advisory skill content in the D1a bootstrap.

Rule 21 remains clean only if the plugin never invokes a second model or asks the host model to substitute for REVIEW. Cross-family review must stay engine-owned.

## C. Missing details or borrows

B1 blockers:
1. Exact trigger scope is missing: which user intents should route to `code-oz run`, which should route to `doctor/init/resume`, and which should not trigger code-oz at all.
2. Exact bootstrap text budget is missing. Set a hard token/word cap.
3. Co-existence behavior is missing: marker string, duplicate-injection guard, behavior when superpowers is also installed, and behavior on compact/clear.
4. Consent semantics are missing: whether the skill may execute `code-oz run` immediately or must ask before running a subprocess for ambiguous tasks.
5. Subagent behavior is missing. Borrow superpowers' `<SUBAGENT-STOP>` idea or define an equivalent so delegated agents do not all re-bootstrap and over-route.

B4 blockers:
1. Replace grep-only validation with structured stream-json parsing.
2. Add filesystem assertions around `.code-oz/` writes.
3. Add a fake engine or `FakeProvider` fixture proving wrapper-to-engine invocation.
4. Add negative tests: advisory prompt must not produce `GATE_*`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, `passed`, or `approved`.
5. Do not make `--dangerously-skip-permissions` the only proof path. It is fine for harness isolation, not for product acceptance.

D1b blockers:
1. Final namespace is not locked.
2. Final banner text is not locked.
3. Skill list is not locked.
4. Upsell wording is not locked.
5. "Advisory output" file policy is not locked. If advisory skills write anything, those files must be clearly non-canonical and non-gate-shaped.
6. `universal-rules.md` import strategy is not locked. Rule 16 implies deterministic templating, not LLM-generated skill prose.

Missing borrows worth adding:
1. Superpowers' explicit-skill-request test harness, alongside naive trigger tests.
2. Superpowers' `run-all.sh` prompt corpus pattern for eval-gated skill changes.
3. Hook registration files, not just `session-start`, as part of B1/B2.
4. OpenCode's idempotent bootstrap/cache pattern as a future co-existence reference, even if OpenCode itself is out of scope.
5. Codex plugin metadata shape: `interface.defaultPrompt`, capabilities, icon/logo fields. D0 can verify current marketplace rules before adopting, but the borrow set should name marketplace UX metadata as part of packaging.
6. Anchored-exclude plus destination-metadata preservation in B5. The draft mentions deterministic sync but not the metadata-preservation detail that prevents foreign marketplace churn.

## D. Highest-risk item

Highest risk: B6/D1b advisory skills, amplified by B1 auto-trigger.

Reason: B1 can be bounded to "invoke the engine." D1b intentionally operates without the engine. Even with honest banners, it is the surface most likely to become the thing users think is code-oz while bypassing file gates, event evidence, budgets, and cross-family review. The mitigation is not to delete D1b, since Ozzy accepted it; the mitigation is hard namespace separation, adversarial denylist tests, no gate-shaped artifacts, and a mandatory engine upsell whenever enforcement or review language appears.

## Convergence — round 1
- Converged: no
- Blocking items remaining:
1. Split B2 into manifest packaging and bootstrap behavior; stage only Claude bootstrap in D1a.
2. Reclassify B3 as executable hook infrastructure and decide whether it is in D1a or deferred.
3. Lock B1 trigger scope, context cap, co-existence/idempotence behavior, and subprocess consent semantics.
4. Add the D1a offline `FakeProvider`/filesystem assertion proving no skill-side `.code-oz/` writes.
5. Lock D1b namespace, banner text, denylist, output file policy, and adversarial eval corpus.
- Non-blocking refinements:
1. Add explicit-skill-request tests alongside naive-trigger tests.
2. Use structured stream-json parsing instead of grep in the harness.
3. Name marketplace metadata fields as part of D0 packaging research.
4. Carry forward B5 metadata-preservation detail for later sync work.
- Reclassifications required:
1. B1: prompt-only behavioral authority, not low-authority prompt text.
2. B2: split into B2a manifests as packaging and B2b host bootstrap as prompt/bootstrap behavior.
3. B3: packaging/runtime-adjacent executable hook infrastructure.
4. B6: prompt-only behavioral authority with advisory-only constraints.
- Missing borrows/details to add:
1. Explicit-skill-request eval harness.
2. Hook registration files and host-specific output-shape contract.
3. Bootstrap idempotence, token cap, compact/clear behavior, and superpowers co-existence rule.
4. D1a fake-provider plus filesystem no-write smoke gate.
5. D1b namespace/banner/denylist/adversarial corpus.
6. Windows runner quoting and no-bash failure behavior review.
