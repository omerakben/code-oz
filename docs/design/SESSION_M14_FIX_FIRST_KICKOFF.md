# Session kickoff — M14 fix-first (Codex R1 closure)

**Read this first.** Single-document entry point for the next session. Closes the 7 block-push findings from Codex R1 (`docs/research/CODEX_REVIEW_M14.md`, thread `019debc4`) so M14 can tag `v0.15.0-alpha.0`.

## State at session start

- **Branch**: `feat/m14-reviewer-panel` at HEAD `c1cbabf` (13 commits ahead of `main`)
- **Main**: in sync with `origin/main` at `4b846a1` (no push, no tag, no merge)
- **Tests**: 2400 pass / 1 skip / 0 fail (+179 vs baseline 2221)
- **Typecheck**: clean
- **R0 planning** (thread `019deb75`): closed accept-with-modifications, 4 pushbacks accepted into implementation
- **R1 implementation review** (thread `019debc4`): **fix-first**, 7 block-push findings (THIS SESSION'S WORK)
- **Tag target**: `v0.15.0-alpha.0` (DO NOT TAG until all 7 close + R2 returns `push`)

## Discipline (non-negotiable)

- Per CLAUDE.md no-tech-debt rule: ALL 7 block-push findings must close before tag
- Per rule 20 (one authority per milestone): each fix-first commit stays single-axis on the M14 authority surface (panel quorum + cross-family enforcement + synthesis); no scope creep
- Per default no-push policy: never push, never tag, never merge without Ozzy's explicit per-milestone approval
- Per cross-model peer review rule: after fix-first commits land, run Codex R2 before tag consideration
- Per `feedback_review_rounds_catch_different_classes.md`: R2 may surface contract drift / doc consistency issues that R1 missed; budget for the round

## The 7 block-push findings (sequenced)

Full text in `docs/research/CODEX_REVIEW_M14.md`. Recommended grouping below; each group can be one or more commits as long as each commit stays single-axis.

### Group A — production REVIEW lifecycle integration (most architectural, do first)

**F1 — Wire `runReviewPanel` into `runReview`**
- File: `src/phases/review.ts` (new dispatch branch); `src/phases/review-panel.ts` (callable)
- Add panel dispatch inside `runReview` after BUILD/VERIFY/ref checks, before single-reviewer prompt composition
- Use `config.company?.reviewer?.panel` (via `shouldUseReviewPanel`) to detect panel mode
- Construct real panelist invocations through the existing provider wrapper (use `invokeAgent` per-panelist; build prepared requests via `buildManifest`)
- Return through the same `ReviewResult` contract as single mode (resolved/needs_revision/blocked/intervention)
- Add lifecycle test: configured panel → `runReview` → canonical panel REVIEW.md → events → result

**F2 — Make `approve review` mode-aware**
- File: `src/commands/approve.ts:386` (preApproveReviewHook) + `src/commands/approve.ts:421` (event check)
- Use `detectReviewReportMode(reviewMd)` to dispatch parser
- For panel artifacts: parse with `parseReviewPanelReport`, require `score.finalVerdict === 'ready'`
- Accept `review_panel_completed` event (with `panelVerdict: 'ready'`) as the ready-event substitute, OR emit a compatible `review_resolved` from the panel path
- Panel REVIEW path must run Scientist tail + `requireGate('review')` matching `src/phases/review.ts:842`
- Test: full panel round → approve review → gate written

### Group B — orchestrator hardening

**F3 — Registry-owned runtime family resolution**
- File: `src/phases/review-panel.ts:55` (PanelistInvocationResult), `src/phases/review-panel.ts:311` (verdict input construction)
- Remove `providerFamily` from trusted invoker output (or treat as advisory-only)
- Add `ProviderRegistry` to `RunReviewPanelOptions`
- Orchestrator computes `const providerFamily = registry.familyOf(result.providerId)` before staging, serialization, events, and verdict computation
- Regression test: register a family override (e.g., codex → claude) and verify panel rejects it as same-family voter

**F6 — Wire aggregate budget preflight**
- File: `src/phases/review-panel.ts:240` (before first panelist invocation)
- Compute per-panelist token estimates via `estimateTokens`
- Call `assertPanelWithinBudget` once for the whole panel round (refuse before any panelist invokes)
- Emit `budget_warning` events from `detectPanelBudgetSoftWarnings`
- Orchestrator-level test (not just pure cost test): aggregate over budget → no staging artifacts written, no panelist invoked

### Group C — parser hardening (adversarial tests required)

**F4 — Authority-impact consistency enforcement**
- File: `src/artifacts/review-report.ts` `parseReviewPanelReport` finding-section parser
- Build reviewer map from `Reviewers` section
- Compute eligible voter ids: `role === 'voter' AND providerFamily !== buildFamily`
- For each finding: validate every `Sources` id exists in reviewer map
- If ANY source is an eligible voter, `Authority impact` MUST be `voter`; reject with `review_artifact_authority_impact_inconsistent`
- If NO source is an eligible voter, `Authority impact` MUST be `advisory`
- Adversarial tests: serialize an artifact with `voter`-sourced block + `authorityImpact: advisory` → parser rejects

**F5 — Cross-section verdict consistency**
- File: `src/artifacts/review-report.ts` `parseReviewPanelReport` cross-section invariant block
- Add invariant: `synthesis.panelVerdict === lastTimeline.panelVerdict === score.finalVerdict === recomputedVerdict`
- Reject with `review_artifact_verdict_field_inconsistent` on any mismatch
- Adversarial tests: hand-write artifact with `Synthesis.Panel verdict: needs-revision` + `Score.Final verdict: ready` → parser rejects (both directions)

### Group D — rule-21 metric provenance

**F7 — Doctor command emits real metric event + events-derived positive control**
- File: `src/commands/doctor.ts:189` (CLI dispatch) + `src/commands/doctor-panel-baseline.ts:247` (sameFamilyVoteRejectionCount source)
- CLI must construct a temporary RunPaths (or reuse a real one) and pass `runPaths` so `review_panel_baseline_completed` is appended
- For the positive-control count: option (a) doctor command runs an actual invalid panel config through the loader and counts the `panel_quorum_rejected_same_family_vote` events emitted; option (b) drop the "events-derived" claim and rename the field as fixture metadata + add a separate negative-control test that exercises layer 1
- Decide which option in the commit message; (a) is more honest about provenance; (b) is simpler

## Suggested commit sequence

Each commit single-axis. After each, run `bun test` + `bun run typecheck`; never commit broken code.

| # | Subject | Group |
|---|---|---|
| 14 | `feat(phases/review): dispatch to runReviewPanel when company.reviewer.panel configured (F1)` | A |
| 15 | `feat(commands/approve): mode-aware REVIEW.md parser + panel-event acceptance (F2)` | A |
| 16 | `feat(phases/review-panel): registry-owned runtime family resolution (F3)` | B |
| 17 | `feat(phases/review-panel): aggregate panel budget preflight wired into orchestrator (F6)` | B |
| 18 | `feat(artifacts/review-report): parser enforces authority-impact source consistency (F4)` | C |
| 19 | `feat(artifacts/review-report): parser enforces cross-section verdict invariant (F5)` | C |
| 20 | `feat(commands/doctor): events-derived rule-21 metric + CLI emits review_panel_baseline_completed (F7)` | D |
| 21 | `docs(roadmap,thesis): mark M14 closed after Codex R2 verdict push` | (after R2) |

## Test target after fix-first

Cumulative tests should grow:
- F1+F2: lifecycle test (~10 tests) — full runReview→approve flow with panel
- F3: registry override regression (~3 tests)
- F4+F5: adversarial parser tests (~10 tests)
- F6: orchestrator budget preflight test (~5 tests)
- F7: CLI emit verification + actual rejection test (~5 tests)

Target: ~2433 pass / 1 skip / 0 fail.

## R2 review plan

After all 7 fix-first commits land:

1. Brief Codex R2 with focus areas:
   - Verify each F1-F7 closure (was the recommendation followed correctly?)
   - Re-test the original adversarial probes (parser-side malformed artifact rejection)
   - Lifecycle integration: walk through panel-mode `runReview` → `approve review` end-to-end and confirm gate writes
   - Anti-pattern check: did the fix-first cycle introduce any new bundling, new event vocabulary, or scope creep?

2. Codex R2 verdict mapping:
   - `push` → tag `v0.15.0-alpha.0` + merge to main locally + ask Ozzy for explicit push approval
   - `fix-first` → address findings in commits 22+ before tag (no tech-debt rule)
   - `debate-required` → escalate to Ozzy

3. Per `feedback_review_rounds_catch_different_classes.md`: R2 typically surfaces contract drift / doc consistency. Be ready for that class of finding.

## Anti-patterns to keep avoiding (fixed in original Ralph; don't reintroduce)

1. New `panel_cost_warn` event vocabulary — REUSE M13 `budget_warning`
2. Synthesizer-as-persona — orchestrator-only mechanical synthesis stays
3. Configurable quorum knob — fixed exactly 2 cross-family voters
4. Same-family advisory able to force `block` or `needs-revision` — must require cross-family voter corroboration
5. Imaginary ProviderId values in tests — use real PROVIDER_IDS
6. Sequential→parallel — must stay sequential in v1
7. Bundling multiple authority surfaces in one commit — rule 20

## Trail of artifacts

- `docs/research/CODEX_BRIEFING_M14.md` — R0 brief
- `docs/research/CODEX_RESPONSE_M14.md` — R0 verdict
- `docs/design/SESSION_M14_KICKOFF.md` — original locked plan
- `docs/design/RALPH_M14_PROMPT.md` — Ralph loop prompt (overnight session)
- `docs/contracts/REVIEW_PANEL.md` — contract surface
- `docs/research/CODEX_BRIEFING_M14_REVIEW.md` — R1 brief
- `docs/research/CODEX_REVIEW_M14.md` — R1 verdict (THE SOURCE OF TRUTH for what to fix)
- `docs/design/SESSION_M14_FIX_FIRST_KICKOFF.md` — THIS doc (next-session entry point)

## Memory continuity

Read in order:
1. This kickoff doc
2. `~/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/now.md`
3. `~/.claude/projects/-Users-ozzy-mac-Projects-code-oz/memory/m14_progress.md`
4. `docs/research/CODEX_REVIEW_M14.md`

That's everything. Ship M14 to zero tech debt.
