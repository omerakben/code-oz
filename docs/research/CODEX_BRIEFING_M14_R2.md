# Briefing — M14 Reviewer panel v1 — implementation review (R2)

**Brief date:** 2026-05-03 (afternoon)
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** R1 fix-first verdict closure (CLAUDE.md cross-model peer review rule)
**Branch under review:** `feat/m14-reviewer-panel` at HEAD `3bb8b65` (21 commits ahead of `main`)

## Context

Round 1 (`docs/research/CODEX_REVIEW_M14.md`, thread `019debc4`) returned `fix-first` with 7 block-push findings against the original 11 commits. This round reviews the 7 closure commits that landed on top:

```
3bb8b65 feat(commands/doctor): events-derived rule-21 metric + CLI emits review_panel_baseline_completed (F7)
c517194 feat(artifacts/review-report): parser enforces cross-section verdict invariant (F5)
32adc72 feat(artifacts/review-report): parser enforces authority-impact source consistency (F4)
a706e87 feat(commands/approve): mode-aware REVIEW.md parser + panel-event acceptance (F2)
fc7dc75 feat(phases/review): dispatch to runReviewPanel when company.reviewer.panel configured (F1)
cc4b265 feat(phases/review-panel): aggregate panel budget preflight wired into orchestrator (F6)
264e4ec feat(phases/review-panel): registry-owned runtime family resolution (F3)
```

(Sequence locked in `docs/design/SESSION_M14_FIX_FIRST_KICKOFF.md` was 14=F1, 15=F2, 16=F3, 17=F6, 18=F4, 19=F5, 20=F7. Implementation order swapped F3+F6 ahead of F1 because both extend `RunReviewPanelOptions`; doing them first kept the F1 dispatch a single-axis wiring change. Single-axis discipline preserved per rule 20.)

Tests: 2419 pass / 1 skip / 0 fail (was 2400 baseline + 19 new tests across 7 commits). Typecheck clean.

## Required reading (in order)

1. `docs/research/CODEX_REVIEW_M14.md` — your R1 verdict (THE SOURCE OF TRUTH for what was supposed to land)
2. `docs/design/SESSION_M14_FIX_FIRST_KICKOFF.md` — the closure plan, including the suggested commit sequence and anti-pattern list
3. The 7 fix-first commits above (in order)

Sample (don't deep-read) the implementation files; the diffs are scoped:
- F3: `src/phases/review-panel.ts` (registry-owned family resolution path)
- F6: `src/phases/review-panel.ts` (aggregate budget preflight insertion)
- F1: `src/phases/review.ts` (panel branch + helper at end of file)
- F2: `src/commands/approve.ts` (mode-aware parser dispatch)
- F4: `src/artifacts/review-report.ts` (authority-impact source consistency block)
- F5: `src/artifacts/review-report.ts` (synthesis vs lastTimeline panel-verdict invariant)
- F7: `src/commands/doctor-panel-baseline.ts` + `src/commands/doctor.ts` (events-derived metric path)

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M14_R2.md` (mirror prior round files; preserve the "Verdict / Findings / Anti-pattern audit / Rule-20 commit-by-commit / What Claude could have done better / Summary" structure).

## What you must verify

### R1 finding closure (one section per finding)

For each of the 7 R1 block-push findings, confirm the closure is correct AND complete:

#### F1 — `runReview` dispatch to `runReviewPanel`

- Does `runReview` branch on `shouldUseReviewPanel(opts.invokeCtx.config.company)` after BUILD/VERIFY/ref checks but BEFORE the single-reviewer cross-family check (the cross-family check is for the single reviewer agent and does not apply in panel mode)?
- Does the panel branch return through the same `ReviewResult` contract: `resolved` / `needs_revision` / `blocked` / `intervention`?
- Is `review_resolved` emitted on the resolved path so `approve.ts` works without contract change?
- Is the Scientist tail run on the resolved path? Is `requireGate('review')` invoked?
- For the `needs_revision` path, is `decideReviewRemediation` called against the synthesized findings (panel synthesized findings are `ReviewSynthesizedFinding extends ReviewFinding`, so they fit)?
- For the `blocked` path, is `review_blocked(reason='block')` emitted before the terminal intervention?
- Is the per-panelist token estimate honest (sum of BUILD changed-file sizes via `fs.stat`) or hand-waved?
- Is the lifecycle test (`tests/review-phase-panel-dispatch.test.ts`) comprehensive enough? Three tests: happy resolved path, missing invoker rejection, same-family reviewerAgent does not block panel branch.

#### F2 — `approve review` mode-aware parser

- Does `preApproveReviewHook` call `detectReviewReportMode` and dispatch to `parseReviewPanelReport` for panel artifacts?
- Both modes still gate on `finalVerdict === 'ready'`?
- Cross-check still fires on `review_resolved` event sha (which F1 emits from the panel branch); is the panel-only fallback to `review_panel_completed` event sha-matched correctly?
- The two added lifecycle tests: panel runReview → preApproveReviewHook end-to-end, and blocking panelist → finalVerdict=block → hook rejects. Are these sufficient?
- Did F2 drop any field reference (`reviewData.upstreamRefs.taskId`) that should have been migrated to the shared `upstreamRefs` variable?

#### F3 — Registry-owned runtime family resolution

- `RunReviewPanelOptions.registry: ProviderRegistry` — required, not optional?
- Per-panelist family computed via `opts.registry.familyOf(result.providerId)` (NOT the invoker-supplied `result.providerFamily`)?
- Verdict input, `review_panelist_completed` event payload, canonical reviewers, and `crossFamilyCheck` derivation all use the registry-resolved family?
- `review_panel_started.panelComposition.providerFamily` is also registry-resolved (not declared)?
- Defense-in-depth: a registry override that collapses a voter to `buildFamily` triggers `panel_voter_same_family_at_runtime` intervention BEFORE any artifact materializes?
- An unknown `providerId` from the invoker triggers `panel_provider_family_unresolved`?
- The `PanelistInvocationResult.providerFamily` field is documented as advisory-only (kept for fixture compat, never read by the orchestrator)?
- The 3 regression tests prove the right thing?

#### F6 — Aggregate budget preflight

- `RunReviewPanelOptions` extends with `config: CodeOzConfig`, `events: readonly LoggedEvent[]`, `perPanelistTokensEstimate: number`, optional `panelRole?: string`?
- `assertPanelWithinBudget` is called BEFORE `review_panel_started` is emitted and BEFORE the panelist loop iterates?
- Refusal path returns a `panel_budget_exceeded` intervention with no staging artifacts written and no panelists invoked?
- Soft-warn path emits real `budget_warning` events (M13 vocabulary, no new event types)?
- The 2 orchestrator-level regression tests (over-budget + soft-warn band) prove what they should?
- Anti-pattern: was a new `panel_cost_warn` event vocabulary smuggled in? (Should be NONE.)

#### F4 — Authority-impact source consistency

- Parser computes `eligibleVoterIds` from the `Reviewers` section (role='voter' AND providerFamily !== buildFamily)?
- Each finding's `sources` ids must reference real reviewer ids (`review_artifact_unknown_source_id`)?
- If ANY source is an eligible voter, `authorityImpact` MUST be `voter`; if NO source is, it MUST be `advisory` (`review_artifact_authority_impact_inconsistent`)?
- 4 adversarial parser tests: voter-source + advisory mark, advisory-source + voter mark, unknown source id, mixed sources (voter + advisory) → must accept canonical case?
- Does the layered ordering matter? (F4 fires before the existing parse-time quorum recompute — make sure the F4 issues do not silence the recompute issue or vice-versa.)

#### F5 — Cross-section verdict invariant

- Parser enforces `synthesis.panelVerdict === lastTimeline.panelVerdict`?
- Combined with the existing `score.finalVerdict === lastTimeline.panelVerdict` and `recomputed === synthesis` checks, is full transitivity (synthesis = score = lastTimeline = recomputed) achieved?
- 4 adversarial tests in the dedicated file? Including a regression test that the existing single-axis check still fires?
- Does the new check fire ONLY when synthesis disagrees with timeline (not on canonical artifacts)?

#### F7 — Doctor metric event + events-derived count

- CLI `doctor --panel-baseline` constructs an ephemeral `RunPaths` and threads it into `loadAndRunPanelBaseline`?
- `review_panel_baseline_completed` event is now actually appended to the run-local log?
- `emitSameFamilyVoteRejectionEvents` runs each fixture-declared attempt through `loadConfig` against a synthetic same-family panel YAML?
- Each rejection emits a real `panel_quorum_rejected_same_family_vote` event with `layer='config-load'`?
- The metric `sameFamilyVoteRejectionCount` reads BACK from the run-local log (NOT from the fixture field)?
- Defense-in-depth: if `loadConfig` does NOT reject (real layer-1 regression), the helper throws a typed error rather than silently underreporting?
- The 1 regression test: real events emitted with `layer='config-load'` and `providerFamily===buildFamily`?
- Did Codex's option (a) get implemented honestly, or did Claude shortcut to option (b) with a relabel?

### Anti-pattern audit (rule-20 + new-vocabulary discipline)

The kickoff doc lists 7 anti-patterns to keep avoiding. For each, confirm none reintroduced:

1. New `panel_cost_warn` event vocabulary — F6 must reuse M13 `budget_warning`
2. Synthesizer-as-persona — orchestrator-only mechanical synthesis stays
3. Configurable quorum knob — fixed exactly 2 cross-family voters
4. Same-family advisory able to force `block` or `needs-revision` — must require cross-family voter corroboration
5. Imaginary ProviderId values in tests — use real `PROVIDER_IDS`
6. Sequential→parallel — must stay sequential in v1
7. Bundling multiple authority surfaces in one commit — rule 20

### Rule-20 commit-by-commit audit

Walk each of the 7 fix-first commits:
1. Does it serve exactly one R1 finding?
2. Are there leaked changes from a different finding's scope?
3. Is the test count delta proportional to the closure (not zero, not enormous)?
4. Does the commit message accurately describe the closure or does it overpromise / underdescribe?

Flag any commit that bundles or sneaks in unrelated changes.

### What I want you to find (test the briefing's negative space)

- Did the F1 panel branch take any shortcut that loses a property the single-reviewer path has? Specifically: resume-mismatch detection, draft persistence, mid-round failure recovery — these are NOT obviously translated to panel mode.
- Is there a contract drift in the comments / docs between the contract (`REVIEW_PANEL.md`) and the F1-F7 implementations? (R2 typically catches this class per `feedback_review_rounds_catch_different_classes.md`.)
- Did F1's `review_resolved` emission shape match what `preApproveReviewHook` expects? Specifically the `finalScore` field uses `REVIEW_SCORE_MAX` as a sentinel — is that defensible or an honest documentation gap?
- F4 + F5 together change the parse-time invariants; does any existing test fixture or downstream consumer rely on the old (more permissive) behavior in a way that did not surface as a test failure but would surface in production?
- F7 emits real events from a temp cwd via `mkdtemp`. On filesystems where `mkdtemp` symlink-escapes (e.g., macOS `/tmp` → `/private/tmp`), does the chain break? Is there any path-safety concern with the synthetic config write?
- Did F3's `panel_voter_same_family_at_runtime` intervention introduce a new event-vocabulary surface? (It's an intervention, not an event, but worth confirming.)

## Test surface verification

Quick checks Codex can run:

- `bun run typecheck` should be clean.
- `bun test` should report 2419 pass / 1 skip / 0 fail.
- `bun test tests/review-phase-panel-dispatch.test.ts` — F1 lifecycle (5 tests).
- `bun test tests/review-report-panel-adversarial.test.ts` — F4 adversarial (4 tests).
- `bun test tests/review-report-panel-verdict-invariant.test.ts` — F5 adversarial (4 tests).
- `bun test tests/review-panel-orchestrator.test.ts` — F3 + F6 regression (23 tests).
- `bun test tests/e2e/review-panel-baseline.test.ts` — F7 events-derived (11 tests).

If you cannot run tests in your sandbox (read-only), note it and rely on the file evidence + the commit-message claims.

## R2 verdict mapping (what happens after this round)

- `push` → tag `v0.15.0-alpha.0` + merge to `main` locally + ask Ozzy for explicit push approval (default no-push policy still applies).
- `fix-first` → address findings in commits 22+ before tag (no tech-debt rule).
- `debate-required` → escalate to Ozzy.

The fix-first round was deliberate; per `feedback_review_rounds_catch_different_classes.md` you (R2) typically catch a different class than R1 — contract drift, doc consistency, narrow grammar issues. Be ready for that class of finding rather than re-litigating R1.
