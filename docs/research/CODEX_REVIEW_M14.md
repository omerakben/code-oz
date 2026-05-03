# Codex implementation review — M14

Thread: `019debc4-ff6a-7471-91b8-570d746caa15` (R0 was thread `019deb75`)
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m14-reviewer-panel` at `29cdd7b`
Date: 2026-05-03

## Verdict

`fix-first`

M14 is not ready to tag. The pure verdict helper and much of the schema work are directionally aligned with the R0 plan, but the milestone does not yet integrate panel mode into the real REVIEW lifecycle. The branch currently has a well-tested sidecar panel helper plus a synthetic baseline command, not a production REVIEW phase that can run, resolve, require approval, and pass `code-oz approve review`.

The main blockers are:

- `runReview` never dispatches to `runReviewPanel`.
- A panel `REVIEW.md` cannot be approved by the existing review approval hook.
- `runReviewPanel` does not emit the same gate-completion signals as single REVIEW.
- The panel runtime trusts invoker-supplied provider families instead of resolving them through `registry.familyOf()`.
- The aggregate budget preflight helper is not called.
- Parser-side recomputation still trusts artifact-owned `authorityImpact` and accepts contradictory panel verdict fields.
- The rule-21 doctor metric is partly fixture-declared and the CLI path does not append the metric event.

Validation Codex ran:

- `bun run typecheck` passed.
- `bun test tests/review-report-multi-reviewer-schema.test.ts` passed.
- `bun test tests/review-panel-orchestrator.test.ts` was blocked by read-only sandbox `mkdtemp EPERM`, so could not independently verify that file.
- Two pure parser probes with `bun -e`; both showed `parseReviewPanelReport` accepts malformed contradictory panel artifacts.

## R0 pushback closure audit

### Q1. Authority-laundering construction

Partially closed, not production-safe.

Layer 1 config validation exists in `src/config/load.ts:335` and catches same-family voters using the best-effort builder/default provider family. Layer 2 loader validation exists in `src/agents/loader.ts:291`. Layer 4 quorum filtering exists in `src/phases/review-panel-verdict.ts:180`. Layer 5 event validation exists in `src/state/events.ts:1399`.

The closure is incomplete because the runtime panel orchestrator does not itself resolve provider family through `registry.familyOf()`. It accepts `providerFamily` from `PanelistInvocationResult` at `src/phases/review-panel.ts:55` and feeds that value directly into quorum computation at `src/phases/review-panel.ts:311`. A buggy caller can launder `providerId: claude` as `providerFamily: codex`.

Layer 3 is also weaker than the contract claims. `parseReviewPanelReport` says it enforces authority-impact/source consistency, but it only validates `Authority impact` as an enum and `Sources` as non-empty. It does not verify that a voter source implies `authorityImpact: voter`.

### Q7. Same-family advisory has no gate authority

Mostly closed in the pure helper for the simple T1-T9 cases, but not fully closed.

The helper filters block/fix-first checks by `authorityImpact === 'voter'`, which closes the obvious negative authority-laundering path. Advisory-only `block` does not veto. Severity is preserved only when the advisory finding remains advisory-only.

The ratification case is under-tested and under-implemented. If a same-family advisory raises `block` and a cross-family voter raises the same fingerprint as `nit`, the helper returns `ready` and serializes severity `nit`. That loses the advisory's recorded severity once the finding is shared. R0 asked for advisory severity to be recorded faithfully and to become voter-impact only when a cross-family voter raises the same fingerprint. Current T9 only proves the easy case where the voter also says `block`.

### Q2. Quorum exactly 2 cross-family voters

Closed in config and pure verdict computation.

`src/config/load.ts:443` rejects voter counts other than 2. `src/phases/review-panel-verdict.ts:289` hard-codes `eligibleVoters.length !== 2`. No `quorum` config knob found.

Caveat: the production REVIEW path does not use panel mode yet, so this invariant is closed in the new helper surface, not in the actual REVIEW lifecycle.

### Q9. Stage per-panelist drafts; canonical only after synthesis

Partially closed.

`runReviewPanel` writes per-panelist staging files under `review-panel/round-N/panelist-<id>.md` at `src/phases/review-panel.ts:277` and writes canonical `REVIEW.md` only after verdict synthesis at `src/phases/review-panel.ts:392`.

The missing piece is lifecycle integration. There is no resume path from panel staging events back into production REVIEW, and the panel helper does not emit `review_resolved` / `gate_required`. A process can leave staging files and `review_panelist_completed` events, but the actual REVIEW phase has no panel-aware resume behavior.

### Q8. Rule-21 ship gate via `review_panel_baseline_completed`

Not closed.

The event schema exists and the library function can append `review_panel_baseline_completed` when `runPaths` is passed. The actual CLI path in `src/commands/doctor.ts:187` calls `loadAndRunPanelBaseline(fixturePath)` without `runPaths`, so `code-oz doctor --panel-baseline` prints a report but does not append the metric event.

The same-family rejection count also comes from `fixture.sameFamilyVoteRejectionAttempts` at `src/commands/doctor-panel-baseline.ts:247`, not from observed `panel_quorum_rejected_same_family_vote` events. That makes the positive-control metric declarative, not measured.

## Findings

### 1. block-push — Panel mode is not wired into production REVIEW

**File:** `src/phases/review.ts:80`

`src/phases/review-panel.ts` exports `shouldUseReviewPanel` and `runReviewPanel`, but `src/phases/review.ts` never imports or calls either. The production REVIEW phase still executes the M9 single-reviewer path: one reviewer agent, one prompt, one `serializeReviewReport`, one `review_round_completed`. `rg` shows `runReviewPanel` is used only in tests and the panel helper itself, not by the real REVIEW orchestrator.

**Recommendation:** Add a panel dispatch branch inside `runReview` after BUILD/VERIFY/ref checks and before single-reviewer prompt composition. It should use `config.company?.reviewer?.panel`, construct real panelist invocations through the existing provider wrapper, and return through the same REVIEW result contract as single mode.

### 2. block-push — Panel `REVIEW.md` cannot pass approval or gate completion

**File:** `src/commands/approve.ts:386`

`preApproveReviewHook` always calls `parseReviewReport`, the single-reviewer parser, at `src/commands/approve.ts:386`. A panel artifact uses `## Reviewers` and `## Synthesis`, so approval rejects it as malformed. The hook also requires a `review_resolved` event at `src/commands/approve.ts:421`, but `runReviewPanel` emits only `review_panel_completed` at `src/phases/review-panel.ts:426`.

**Recommendation:** Make approval mode-aware via `detectReviewReportMode`. For panel artifacts, parse with `parseReviewPanelReport`, require `score.finalVerdict === 'ready'`, and accept a matching ready `review_panel_completed` event or emit a compatible `review_resolved` from the panel path. The panel REVIEW path must also run the Scientist tail and `requireGate('review')`, matching `src/phases/review.ts:842`.

### 3. block-push — Runtime family authority is delegated to the panelist invoker

**File:** `src/phases/review-panel.ts:55`

`PanelistInvocationResult` includes `providerFamily`, and `runReviewPanel` trusts it. The canonical verdict input is built from `inv.providerFamily` at `src/phases/review-panel.ts:311`. This violates the R0 requirement that runtime family resolution use `registry.familyOf()`, not caller-provided or pure static values. A miswired invoker can report a cross-family value for a same-family provider and satisfy quorum.

**Recommendation:** Remove `providerFamily` from trusted invoker output or treat it as advisory. `RunReviewPanelOptions` should receive the runtime `ProviderRegistry`, and the orchestrator should compute `const providerFamily = registry.familyOf(result.providerId)` before staging, artifact serialization, events, and verdict computation. Add a regression test with a registry family override proving the panel path honors registry resolution.

### 4. block-push — Parser trusts artifact-owned `authorityImpact`

**File:** `src/artifacts/review-report.ts:2473`

The parser validates `Authority impact` only as `voter | advisory` and `Sources` only as non-empty. It does not verify that source ids exist, or that any eligible voter source forces `authorityImpact: voter`. Codex confirmed with a pure probe that a canonical-looking panel report with a voter-sourced `block` finding marked as `authorityImpact: advisory` is accepted as `ready`.

**Recommendation:** In `parseReviewPanelReport`, build a reviewer map, compute eligible voter ids from `Reviewers`, and validate every finding's `sources`. If any source is an eligible voter, `authorityImpact` must be `voter`; if no source is an eligible voter, it must be `advisory`. Reject unknown source ids. Also compare synthesized finding authority against recomputed eligibility before comparing verdicts.

### 5. block-push — Panel parser accepts contradictory canonical verdict fields

**File:** `src/artifacts/review-report.ts:1887`

`parseReviewPanelReport` compares recomputed verdict only to `Synthesis.Panel verdict`. It checks `Score.Final verdict` only against the last round timeline entry. It never requires `Synthesis.Panel verdict`, last timeline `panel verdict`, and `Score.Final verdict` to agree. Codex confirmed with a pure probe that the parser accepts `Synthesis.Panel verdict: needs-revision` while `Score.Final verdict: ready`.

**Recommendation:** Add a cross-section invariant: `synthesis.panelVerdict === lastTimeline.panelVerdict === score.finalVerdict === recomputed.panelVerdict`. Add tests for both contradiction directions.

### 6. block-push — Aggregate panel budget preflight is not called

**File:** `src/phases/review-panel.ts:240`

`assertPanelWithinBudget` and `detectPanelBudgetSoftWarnings` were added in `src/providers/cost.ts:565`, but `runReviewPanel` never imports or calls them. The panel loop starts invoking panelists at `src/phases/review-panel.ts:240`, so the branch can produce partial staging artifacts before aggregate budget refusal. That violates R0 Q6.

**Recommendation:** Compute per-panelist token estimates before any panelist invocation, call `assertPanelWithinBudget` once for the whole panel round, and emit existing `budget_warning` events from `detectPanelBudgetSoftWarnings` before the first panelist call. Add an orchestrator-level test, not only pure cost tests.

### 7. block-push — Rule-21 positive control is fixture-declared, not events-derived

**File:** `src/commands/doctor-panel-baseline.ts:247`

The rule-21 metric says `sameFamilyVoteRejectionCount` counts `panel_quorum_rejected_same_family_vote` events. The implementation sets it from `fixture.sameFamilyVoteRejectionAttempts`. The CLI path also does not append `review_panel_baseline_completed`, because `src/commands/doctor.ts:189` does not pass `runPaths`.

**Recommendation:** Either make `doctor --panel-baseline` run an actual invalid panel config through the config loader and append the rejection event into the metric log, or rename the field as fixture metadata and do not claim it is event-derived. For shipping M14 under rule 21, the CLI should produce the `review_panel_baseline_completed` event in a deterministic run-local event log or the contract should explicitly stop saying the doctor command emits it.

## Anti-pattern audit

- New `panel_cost_warn` event vocabulary: not found. M13 `budget_warning` was reused in the helper surface.
- Synthesizer-as-persona: not found. Synthesis is mechanical.
- Configurable quorum: not found. Fixed 2-voter quorum is implemented.
- Same-family advisory can force block alone: not in the pure helper. However parser trust can misclassify authority impact, and mixed-severity advisory ratification loses advisory severity.
- Imaginary provider ids: not found in the canonical fixture; it uses real `codex` and `gemini`.
- Advisory severity coerced to nit/fyi: not directly coerced, but advisory `block` is dropped when a voter shares the fingerprint with lower severity.
- Sequential vs parallel: sequential, as required.
- Panel as default mode: not default. Panel is opt-in, but it is also not wired into production REVIEW.
- Rule 20 bundling: commits mostly stay within M14's boundary, but the implementation stops short of the actual boundary because production REVIEW/gate integration is missing.
- `update memory` in commit subject: not present.

## Rule-20 commit-by-commit audit

1. `0da4e78 docs(m14)`: planning-only. Fine as setup, not implementation.

2. `5d97983 docs(contracts/review-panel)`: single-axis contract commit. Good shape, but it overpromises event emission and parser recomputation that code does not fully deliver.

3. `1c3e3ff feat(config)`: single-axis config validation. Good voter-count and same-family checks. Missing actual rejection-event emission.

4. `53ff03f feat(artifacts/review-report)`: correct slice, but contains two blockers: authority-impact trust and missing Synthesis/Score/timeline consistency.

5. `0e859b1 feat(state/events)`: event taxonomy is scoped correctly. Layer-5 only validates `eligibleVoterFamilies.length === 2` for ready, not ancestry against `review_panelist_completed`.

6. `e1a1c3e feat(phases/review-panel-verdict)`: pure helper split was the right move. T1-T9 exist, but T9 is too narrow and misses mixed-severity ratification.

7. `39b614b feat(phases/review-panel)`: runtime slice is not complete. It is a standalone helper, not integrated REVIEW authority. It also trusts invoker family and omits budget preflight.

8. `921db06 feat(providers/cost)`: scoped pure helper, but not wired to the orchestrator. Test delta is useful but proves only the helper.

9. `67ff66a feat(commands/doctor-panel-baseline)`: rule-21 surface exists, but the key positive-control metric is fixture-declared and the CLI path does not emit the event.

10. `569afb4 test(e2e/review-panel)`: useful seam tests, but not full e2e. It does not cover `runReview`, `review_resolved`, `gate_required`, or `approve review`.

11. `29cdd7b docs(roadmap,thesis)`: docs closure is premature while the above blockers remain. CLI wiring exists for printing the doctor report, not for emitting the metric event.

## What Claude could have done better

Claude treated "panel helper works" as equivalent to "REVIEW supports panel mode." The implementation needed one full lifecycle test: configured panel → `runReview` dispatch → canonical panel `REVIEW.md` → `review_panel_completed` or `review_resolved` → Scientist tail → `gate_required(review)` → `code-oz approve review` succeeds.

Claude also should have written adversarial parser tests instead of only serializer round-trip tests. Round-trip tests prove the serializer and parser agree on honest data; they do not prove the parser rejects malicious or contradictory panel artifacts.

The rule-21 fixture should have been driven from observed events, not a synthetic count field. If the positive control is not emitted by the same code path that rejects a same-family voter, it proves the fixture author wrote `1`, not that the construction fired.

Finally, the runtime family boundary needed a hard rule: provider family is never panelist-authored. It comes from `ProviderRegistry.familyOf()` inside the orchestrator, and every artifact/event records that resolved value.

## Summary

Verdict `fix-first`. Do not tag or merge M14 yet. The block-push issues are production integration, approval/gate completion, registry-owned family resolution, parser recomputation gaps, unused aggregate budget preflight, and synthetic rule-21 metrics. Fix these in follow-up commits, then re-run typecheck, focused panel tests, and a real lifecycle test covering `runReview` through `approve review`.
