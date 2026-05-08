# Briefing — M15 Debate-policy scheduler v1 — implementation review (R1)

**Brief date:** 2026-05-08
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (implementation completion)
**Branch under review:** `feat/m15-debate-scheduler` at HEAD `38f2c10`
**Base:** `f7aca73` (Phase 1 implementation kickoff lock)

## What you're reviewing

11 commits delivered overnight via Ralph loop on `feat/m15-debate-scheduler`. M15 is the **orchestrator-side automatic-trigger policy** for the existing single-opponent `requestDebate()` runtime built in M10. Authority boundary (rule 20, single-axis): **mechanical predicate that decides *when* to fire a debate based on objective signals from completed REVIEW artifacts + measurable risk metric (rule-21 ship gate)**. The M10 primitive is unchanged. The M14 panel surface is read-only consumed.

```
38f2c10 feat(tests,docs): M15 e2e fixtures + ROADMAP closure
b08b9d8 feat(agents): default reviewer gets tool_use.debate (M15 path A)
94e63d4 docs(contracts/DEBATE_POLICY): orchestrator-owned authority surface
9df1fbd feat(commands/doctor): --debate-policy-baseline rule-21 ship gate
b18d55e feat(commands/doctor): --debate-policy config inspector
23931fc feat(providers): scheduler aggregate budget preflight + hook plumbing
1a31f1d feat(phases/review): scheduler fire path + executor seam + lock-collision fix
4538c88 feat(phases/review): post-verdict scheduler evaluate hook
4b2942f feat(config): debatePolicy block in CodeOzConfig
0aedfcd feat(policy): pure debate-policy scheduler decision function
91c71c6 feat(state): debate scheduler event types + correlation fields
```

(Listed newest-first per `git log --oneline`. The implementation order is reverse: 91c71c6 schemas → 0aedfcd policy → 4b2942f config → 4538c88 hook eval → 1a31f1d fire path → 23931fc preflight → b18d55e doctor inspector → 9df1fbd doctor baseline → 94e63d4 contract doc → b08b9d8 reviewer permission → 38f2c10 e2e + closure.)

## Required reading

1. `docs/research/CODEX_BRIEFING_M15.md` — original planning brief (your prior context, 7-decision matrix Q1-Q11)
2. `docs/research/CODEX_RESPONSE_M15.md` — your R0 verdict (`accept-with-modifications`, thread `019e0561`); 4 risks + 11 pushbacks recorded
3. `docs/design/SESSION_M15_IMPL_KICKOFF.md` — locked plan synthesizing R0 pushbacks (~40k chars; sample sections, don't deep-read)
4. `docs/contracts/DEBATE_POLICY.md` — the contract surface (commit 94e63d4); your authoritative spec for what M15 promised

## Required code reading (load-bearing paths)

Sample (don't deep-read everything). The load-bearing paths in implementation order:

- `src/state/schemas.ts` (commit 91c71c6) — `DebateSchedulerMode`, `SchedulerFireReason`, `SchedulerSkipReason`, `SchedulerErrorReason`, `SchedulerReviewVerdict`, the 6 event-type literals, correlation fields (`decisionId` ULID, `reviewRound`, `preReviewReportSha256`, `debateTopic`, `postReviewReportSha256`)
- `src/policy/debate-scheduler.ts` (commit 0aedfcd) — pure `evaluateSchedulerDecision(input: SchedulerInput): SchedulerDecision`; locked gate ordering (11 gates, first-match-wins); panel-vs-single trigger split
- `src/config/schema.ts` + `src/config/load.ts` (commit 4b2942f) — `debatePolicy?` block on `CodeOzConfig`; YAML strict validation; `DEFAULT_DEBATE_POLICY` (mode='manual')
- `src/phases/review-scheduler-hook.ts` (commits 4538c88 + 1a31f1d) — runtime caller; `runReviewSchedulerHook` builds `SchedulerInput`, calls policy, emits events; `firePathExecutor?` seam; lock-collision fix (executor never re-acquires `.review.lock`)
- `src/phases/review.ts` (commits 4538c88 + 1a31f1d) — call sites: `runReviewInner` line ~949 (single mode), `runReviewPanelBranch` line ~2066 (panel mode). **Note:** both production call sites pass NO `firePathExecutor` argument → seam runs in transitional `fired: false` mode (see "Open follow-up #1" below).
- `src/providers/cost.ts` (commit 23931fc) — `aggregateDebateSchedulerPreflight` (opposing turn + synthesis turn + post-debate REVIEW round; panel-aware); first-breach-wins matches `assertWithinBudget` ordering
- `src/commands/doctor-debate-policy.ts` (commit b18d55e) — `--debate-policy` config inspector + event tabulation
- `src/commands/doctor-debate-baseline.ts` (commit 9df1fbd) — `--debate-policy-baseline` rule-21 ship gate (canonical fixture set, control = mode:off, treatment = mode:auto, 4 metric definitions)
- `src/agents/defaults/reviewer.md` (commit b08b9d8) — bundled reviewer gets `tool_use.debate { opposingProviders: ['claude'], maxConcurrent: 1, ... }` (Path A locked)
- `tests/fixtures/debate-scheduler-baseline/*` (commit 38f2c10) — 6 canonical fixtures (single-grey-zone-corrective, single-grey-zone-anti-corrective, single-needs-revision-high-score, single-no-signal-fire, panel-voter-disagreement, manifest-size-exceeds) + control + treatment + oracle.json each
- `tests/e2e/debate-scheduler-grey-zone.test.ts` + `tests/e2e/debate-scheduler-panel-disagreement.test.ts` (commit 38f2c10) — e2e proofs the rule-21 ship gate PASSES on the canonical set

Test deltas (commit 38f2c10 included): 2425 → 2635 pass / 0 fail / 1 skip (live xAI gated).

## Verdict format

Return one of: `push` | `fix-first` | `debate-required`. Format your response as `docs/research/CODEX_REVIEW_M15.md` (mirror M11/M12/M13/M14 review files).

## What you must verify (R0 pushback closure)

For each of your 4 R0 risks + 11 Q-pushbacks, verify the implementation honors it:

### R0-Risk #1 (panel has no numeric score)

- Is the trigger evaluation mode-aware? `evaluateSchedulerDecision` step 11 must split: panel mode evaluates ONLY `panel_voter_disagreement`; single mode evaluates `score_in_grey_zone` (default `[5, 7]`) OR `needs_revision_with_high_score` (verdict='needs-revision' AND score>=6).
- Walk a panel REVIEW with `verdictPre/Post: 'panel'` literal through the postreview event validator. Does it accept the literal sentinel without coercing to a number?
- T1-T9 of `tests/policy-debate-scheduler.test.ts`: do the panel-mode tests verify single-mode triggers NEVER fire on panel input?

### R0-Risk #2 (bundled reviewer needs tool_use.debate)

- Is `src/agents/defaults/reviewer.md` granted `tool_use.debate` with `opposingProviders: ['claude']`?
- Why is `gemini` NOT in `opposingProviders`? (Expected: M11 capabilities mark gemini as `eligiblePhases: NO_PHASES` — stub provider — so `persona_no_eligible_opponent` would fire.)
- Does the M15 e2e test exercise the **bundled** reviewer path, not a customized persona?
- Does `tests/agents-reviewer-debate-permission.test.ts` lock the permission shape?

### R0-Risk #3 (event correlation fields)

- Do all 6 scheduler events carry `decisionId` (run-scoped ULID)?
- Does `debate_scheduler_postreview` carry both `preReviewReportSha256` and `postReviewReportSha256`?
- Does the rule-21 baseline reducer join evaluated → fired/skipped → postreview/error using `decisionId`?
- Schema-validator backstop: does `src/state/events.ts` reject scheduler events missing correlation fields?

### R0-Risk #4 (runReview recursive lock collision)

- Production fire-path executor MUST NOT re-acquire `.review.lock`. Walk the executor seam: when `firePathExecutor` is wired, does the executor invoke `requestDebate` + reviewer persona re-invocation **directly** without nesting into `runReview()`?
- `tests/review-scheduler-fire.test.ts`: is there a test that fails if the executor re-acquires the lock?
- **Critical follow-up question (see Open follow-ups below):** the production call sites in `src/phases/review.ts` lines ~949 and ~2066 pass NO `firePathExecutor` argument. The hook silently returns `fired: false` for fire decisions in production. Is this honest enough to ship M15 — or does the production wiring need to land before tag?

### Q1-Q5, Q9 (post-REVIEW only, no verdict-confidence, default manual, reuse permission, voter-only, REVIEW wins)

- Single call site only? `src/phases/review.ts` should be the only production caller of `runReviewSchedulerHook`. No VERIFY-side caller.
- Verdict-confidence absent from `SchedulerInput`? It must NOT appear as a primary signal.
- `DEFAULT_DEBATE_POLICY.mode === 'manual'`?
- No new permission sub-scope (`tool_use.debate.scheduler` would be a violation)?
- Advisory-`block` is NOT a trigger? Walk `tests/policy-debate-scheduler.test.ts` panel-mode tests — does an advisory voter raising `block` fail to trigger `panel_voter_disagreement`?
- `debate_scheduler_postreview` event uses pre-debate verdict if post-debate REVIEW returns same verdict (REVIEW always wins)?

### Q6 (strict aggregate preflight)

- `aggregateDebateSchedulerPreflight` covers opposing turn + synthesis turn + post-debate REVIEW round?
- Panel mode: does preflight cover the **whole panel round** (all eligible voters)?
- First-breach-wins ordering matches `assertWithinBudget` (commit 23931fc)?
- Does `SchedulerInput.budget.aggregatePreflightWouldTip` flip the decision to `budget_exhausted`?

### Q7 (rule-21 metrics — corrective verdict delta + new actionable findings)

- `corrective verdict delta rate` (numerator: corrective fires, denominator: total fired count) implemented in `doctor-debate-baseline.ts`?
- Floor `>= 0.10` on corrective rate enforced?
- `new-actionable-finding rate` filters severity to `{block, fix-first}` only — `nit` and `fyi` excluded?
- Floor `>= 0.30` on new-actionable rate enforced?
- Per-trigger breakdown + no-signal-fire rate emitted as telemetry?
- Does the canonical fixture set genuinely pass (`correctiveDeltaRate=0.40, newActionableFindingRate=0.80` per kickoff acceptance)?

### Q8 (broader intervention list)

- The 5 operator-actionable errors (auth_missing, permissions_violation, concurrent_limit_exceeded, topic_collision, manifest_blocked) raise `NEEDS_INTERVENTION.json`?
- The 3 degrade reasons (artifact_invalid, transient_io, other) emit `debate_scheduler_error` and degrade to original REVIEW verdict?
- `DEBATE_POLICY.md` § "Failure surface" matches the implementation?

### Q10 (commit splits — 4 → 4a/4b, 6 → 6a/6b)

- Commits 4538c88 (4a hook eval) and 1a31f1d (4b fire path) are independently buildable / testable?
- Commits b18d55e (6a inspector) and 9df1fbd (6b baseline) are independently buildable / testable?
- Each commit ships a single authority slice (rule 20)?

### Q11 (resume, concurrency, manifest, TUI)

- Resume semantics defined for 3 crash points in `DEBATE_POLICY.md` § "Resume semantics"?
- Scheduler-fired debate counts against M10 `maxConcurrent: 1` (gate 5 = `concurrent_limit`)?
- Manifest expanded to BUILD_REPORT + VERIFY + REVIEW (or pre-skip via gate 10 `manifest_size_exceeds_maxFiles`)?
- TUI deferred (no real-time inspector in M15)?

## Anti-patterns to flag if you find them

These would be R0 pushback violations:

1. New `tool_use.debate.scheduler` permission sub-scope (Q4 forbade)
2. Pre-VERIFY scheduling (Q1 forbade)
3. Verdict-confidence as primary signal (Q2 forbade)
4. `auto` as default mode (Q3 forbade)
5. Advisory-`block` as a trigger (Q5 forbade)
6. Mid-debate budget kill as primary mechanism (Q6 forbade)
7. Verdict-flip rate without direction (Q7 forbade)
8. `any-new-finding` rate without severity filter (Q7 forbade)
9. Adding a Scheduler **persona** (DEBATE_POLICY.md anti-pattern #1)
10. Replacing `requestDebate()` body (DEBATE_POLICY.md anti-pattern #10; M10 primitive frozen)
11. Configurable quorum / k-of-N voters (deferred to M16+)
12. Multi-opponent variants in v0.1 (deferred to M16+)
13. Same-family auto-debate (rule 2 violation)
14. Bypassing `budgets.global` (rule 19 violation)
15. New gate file for scheduler decisions (rule 1 + rule 20 violation)
16. Bundling multiple authority surfaces in one commit (rule 20)
17. "update memory" or non-atomic content in commit subjects

## Rule-20 audit (commit-by-commit single-axis check)

Walk each of the 11 implementation commits:

1. Does it serve exactly one slice of the M15 authority boundary (orchestrator-side automatic-trigger policy + measurable risk metric)?
2. Did anything from a future milestone (M16 multi-opponent, M16 Researcher, M16 pre-VERIFY) leak in?
3. Is the test count delta proportional to the slice (not zero, not enormous)?
4. Does any commit subject promise something the diff doesn't deliver, or vice versa?

Flag any commit that bundles or sneaks in an unrelated change.

## What I want you to find (test the briefing's negative space)

These are the questions where I have low confidence in my own self-review:

1. **Production fire-path executor wiring is deferred** (m15_progress.md "Open follow-up #1"). The seam exists in the hook (`firePathExecutor?: SchedulerFirePathExecutor`), the mock-executor tests prove correctness of the seam, but `src/phases/review.ts` lines ~949 and ~2066 pass no executor argument so production currently no-ops on `decision.fire === true`. The rule-21 baseline is verified through pre-recorded events.jsonl fixtures, NOT live FakeProvider runs. **Is this honest enough as a M15 deliverable, or does the production wiring need to land before tag?** Argue both sides; pick one.

2. **Fixtures generate the events directly, not from a live run.** `tests/fixtures/debate-scheduler-baseline/*/control.jsonl` and `treatment.jsonl` are hand-crafted JSONL. The metric math is proven; what is NOT proven end-to-end is "does production code emit these events when the scheduler fires." Is the gap between fixture math and production wiring a block-push or a fix-soon?

3. **Anti-corrective fixture (single-grey-zone-anti-corrective) is hand-crafted.** It's there to surface the regression-signal metric. A real treatment run might never produce this. Should the canonical set drop it once we have real Fake-driven data? Or is it correct that the rule-21 ship gate proves the metric DEFINITION holds even on adversarial input?

4. **`debate_policy_baseline_completed.costOverheadAvgTokens: 0` on the canonical set** because fixtures don't include `agent_invoked` events with `debateTopic` correlation. Is "telemetry zero on offline fixtures" acceptable for v0.1, or should the fixtures synthesize agent_invoked too?

5. **Gate ordering correctness.** The 11 gates in `evaluateSchedulerDecision` evaluate first-match-wins. Walk a panel-mode same-family advisory voter through the gates: does it skip with `persona_no_eligible_opponent` or `no_trigger_matched`? Does the order match `DEBATE_POLICY.md` § "Defense-in-depth"?

6. **Manifest size pre-skip vs throw-after-fire.** Gate 10 (`manifest_size_exceeds_maxFiles`) is a pre-skip. Codex Q11 said "Pre-skip on manifest size instead of throwing after fire" — is the implementation a true pre-skip, or does the request still build the manifest before checking size?

7. **Path A consequence on rule-21 baseline.** `src/agents/defaults/reviewer.md` got `tool_use.debate` with `opposingProviders: ['claude']`. Could this narrow list cause `persona_no_eligible_opponent` to fire silently if the BUILD persona happens to be claude (same-family rejection)? Trace the canonical fixture's BUILD provider — what is it? Is the rule-21 PASS dependent on BUILD provider != claude?

8. **`MEMORY.md` index size and Phase 3 closure.** This R1 review IS Phase 3 entry. Does the implementation match the kickoff acceptance gate (`m15_progress.md` § "Acceptance gate state per kickoff §12")? Are all checked items truly checked?

## Test surface verification

- Total tests at HEAD `38f2c10`: **2635 pass / 0 fail / 1 skip** (live xAI gated). Verified by Claude pre-briefing.
- `bun run typecheck` clean. Verified by Claude pre-briefing.
- `bun run dev doctor --debate-policy` runs without error (claimed; not re-verified pre-briefing).
- `bun run dev doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` exits 0 with `passedRuleTwentyOne: true` (claimed; not re-verified pre-briefing).

If you can't independently verify (read-only sandbox), trust + flag any test that you suspect doesn't actually test what it claims.

## Operating rules

1. **Be specific.** Vague verdicts ("looks fine") rejected. Each finding should be a concrete `file:line` (or `file:line-range`) + severity.
2. **Severity classes:**
   - `block-push` — stops the milestone tag; must be addressed before push
   - `fix-soon` — should be addressed in the same milestone but not blocking-push
   - `fix-next-milestone` — defer; acceptable if no tech debt
   - `nit` — trivia; safe to defer
   - `fyi` — informational
3. **Verdict mapping:**
   - `push` — no block-push or fix-soon findings (or all addressed); ready to tag v0.16.0-alpha.0
   - `fix-first` — has block-push or fix-soon findings; address then re-review
   - `debate-required` — fundamental issue (e.g., authority boundary mis-shaped); needs another planning round
4. **Token economy.** Aim for 5-8k response. Quality > volume.
5. **Sandbox is read-only.** Print the response inline; Claude will write it to `docs/research/CODEX_REVIEW_M15.md`.

Begin.
