# Response — m15-debate-policy-scheduler

**Thread:** `019e0561-3c95-72a2-b786-056eb685307f`
**Codex self-assigned label:** `codex-m15-debate-policy-scheduler-2026-05-07-gpt55-xhigh`
**Date:** 2026-05-07
**Model:** gpt-5.5 xhigh
**Sandbox:** read-only
**Approval:** never
**Brief:** `docs/research/CODEX_BRIEFING_M15.md`

---

## Verdict on the decisions

Overall verdict: accept-with-modifications

§3.1 commit sequence: accept-with-modifications. The authority boundary is right, but commits 4 and 6 are too wide for review. Split hook/evaluate from fire/post-debate review, and split `--debate-policy` from the baseline ship-gate command.

§3.1 also misses required schema: §4.5 uses `debate_scheduler_error`, and §4.8 uses a baseline completion event, but commit 1 only adds evaluated/fired/skipped. Add those explicitly.

§4 locked design choices: accept-with-modifications. Post-REVIEW only, default `manual`, reused `tool_use.debate`, and no runtime change to `requestDebate()` are correct. Required modifications: panel score handling, reviewer debate permission/no-op semantics, aggregate budget preflight, resume correlation, and rule-21 metrics that prove beneficial signal rather than any verdict churn.

## Risks the proposing side missed

The largest concrete bug: M14 panel REVIEW does not have a numeric final score. The canonical panel artifact uses `Final score: panel`, and `review_resolved.finalScore=10` is only a compatibility sentinel. A scheduler predicate that treats panel mode as having a synthesized numeric `Score.Final score` will misfire or silently skip the wrong cases. For panel mode, either disable score grey-zone and use voter-disagreement only, or define a new orchestrator-owned derived score from eligible voters.

Second: default REVIEW cannot auto-debate today. `src/agents/defaults/reviewer.md` has no `tool_use.debate`, and existing tests assert only `lead.md` has the debate scope. With §4.7 as written, `mode: auto` will skip the canonical REVIEW trigger as `persona_no_debate_permission` unless M15 either grants reviewer debate permission or documents auto-mode as opt-in by persona customization. Shipping a scheduler that no-ops under the bundled path would fail rule 21.

Third: the event shape lacks stable correlation. `runId/taskId/attempt` is not enough once an extra REVIEW round is inserted. Add `decisionId`, `reviewRound`, `preReviewReportSha256`, `debateTopic`, and, for completion/baseline, `postReviewReportSha256`. Otherwise verdict-flip/new-finding metrics will be ambiguous.

Fourth: calling `runReview()` recursively for the extra REVIEW round will collide with the existing `.review.lock`. The implementation must either factor the internal round body or return a scheduler outcome to the outer orchestrator after releasing the lock.

## Where I disagree

Q1. Recommendation: post-REVIEW only for v1. Pre-VERIFY is a different authority surface with weaker signals and overlaps VERIFY restart policy. Defer it.

Q2. Recommendation: keep verdict-confidence out of v1 triggers. It is same-prior self-report. At most log it later as telemetry after calibration.

Q3. Recommendation: default `manual`. It preserves M10 behavior, keeps cost/latency unsurprising, and lets `off` remain a hard escape hatch.

Q4. Recommendation: reuse `tool_use.debate`, but revise the default-reviewer issue. No new sub-scope in M15. Either grant reviewer debate permission in the bundled persona or make auto-mode explicitly require a persona opt-in and prove the baseline with that fixture.

Q5. Recommendation: voter disagreement only. Advisory `block` as a trigger launders negative authority through the scheduler. Record it as telemetry; default-off opt-in is M16+.

Q6. Recommendation: strict aggregate preflight. Refuse before firing if the full scheduler transaction would exceed budget: opposing turn, synthesis turn, and the required post-debate REVIEW invocation. For panel REVIEW, preflight the whole panel round too. Do not rely on mid-debate budget failure.

Q7. Recommendation: not sufficient as written. Verdict-flip rate rewards bad flips. Change it to corrective verdict delta against fixture oracle, or at minimum report direction. Change new-finding rate to new actionable finding rate. Add per-trigger breakdown and no-signal-fire rate in v1. Cost and latency can be telemetry, not ship gates.

Q8. Recommendation: broaden the intervention list. `provider_auth_missing`, `provider_permissions_violation`, `debate_concurrent_limit_exceeded`, `debate_topic_collision`, and scheduler-generated `debate_manifest_blocked` should raise intervention. `debate_response_invalid`, `debate_decision_invalid`, and transient provider IO can degrade to the original REVIEW verdict, but must emit `debate_scheduler_error`.

Q9. Recommendation: post-debate REVIEW wins. DECISION.md is evidence, not gate authority. If DECISION says ship and REVIEW still says needs-revision, the gate stays with REVIEW. The no-op cost is exactly what the baseline should measure.

Q10. Recommendation: not a milestone-level rule-20 violation, but split for reviewability. Hook plus result-consumption are one authority, but one commit is too large. `--debate-policy` and `--debate-policy-baseline` should be separate commits. Modes are scheduler config; metrics are the rule-21 ship gate. Same milestone, separate commits.

Q11. Missing load-bearing items:
- Resume: define recovery for `evaluated -> intended fire -> crash before debate_started`, `debate_started -> no resolved`, and `debate_resolved -> no post-review`.
- Manual/scheduler concurrency: scheduler-fired debate must count against M10 `maxConcurrent` for the same phase.
- Manifest: changed files plus `REVIEW.md` is necessary but thin. Include `BUILD_REPORT.md` and `VERIFY.md` unless `maxFiles` blocks it. Pre-skip on manifest size instead of throwing after fire.
- TUI: no real-time inspector in M15. `events.jsonl` plus doctor output is enough.

## What I would defer

Defer pre-VERIFY scheduling, verdict-confidence triggers, advisory-block triggers, a new `tool_use.debate.scheduler` sub-scope, multi-opponent debate, live TUI surfaces, auto-resume from partial debate state, and cost/latency as hard ship gates.

## Recommended next step

Before implementation, revise §3.1, §4, and §5 to lock these changes:

1. Add scheduler event correlation fields and missing `debate_scheduler_error` / `debate_policy_baseline_completed` schemas.
2. Decide reviewer permission semantics: bundled reviewer gets `tool_use.debate`, or auto-mode is explicitly persona-opt-in and the canonical fixture proves that path.
3. Fix panel trigger logic so it does not read a fake numeric panel score.
4. Add aggregate budget and manifest preflight before any `requestDebate()` call.
5. Split commits 4 and 6, then define the no-recursive-lock implementation path for the extra REVIEW round.

---

## Synthesis triage (Claude's pre-morning categorization)

Categorization for Phase 1 Step 1.3 ("Categorize each Codex pushback: `accept`, `accept-with-mod`, `reject-with-reason`"). Synthesis kickoff (`SESSION_M15_IMPL_KICKOFF.md`) authored in the next session — not tonight.

| Pushback | Category | Effect on plan |
|---|---|---|
| Panel has no numeric score (Risk #1) | accept | §4.2 must split: panel-mode triggers = voter-disagreement only; single-mode keeps grey-zone. |
| Bundled reviewer has no `tool_use.debate` (Risk #2) | accept | Either §3.1 commit 0 grants reviewer the scope, or canonical fixture proves auto-mode on a customized persona. Decision needed before implementation. |
| Event correlation fields missing (Risk #3) | accept | §4.6 schema additions: `decisionId`, `reviewRound`, `preReviewReportSha256`, `debateTopic`, `postReviewReportSha256`. |
| `runReview()` recursive lock collision (Risk #4) | accept | Refactor: factor internal round body, or return scheduler outcome to outer orchestrator after releasing `.review.lock`. |
| Q1-Q5, Q9 (post-REVIEW only, no verdict-confidence, default `manual`, reuse permission, voter-only, REVIEW wins) | accept | Codex confirms; no plan change. |
| Q6 (strict aggregate preflight) | accept | §4.5 + §3.1 commit 5 strengthen — preflight covers opposing + synthesis + post-debate REVIEW round; for panel, the whole panel round. |
| Q7 (rule-21 metrics insufficient) | accept-with-mod | §4.8 reshape: verdict-flip → corrective verdict delta vs oracle (or directional split); new-finding → new *actionable* finding; add per-trigger breakdown + no-signal-fire rate. Cost/latency become telemetry, not ship gates. |
| Q8 (intervention list broader) | accept | §4.5 table extends: `provider_permissions_violation`, `debate_concurrent_limit_exceeded`, `debate_topic_collision`, scheduler-generated `debate_manifest_blocked` → NEEDS_INTERVENTION. Parse-failures still degrade silently with `debate_scheduler_error`. |
| Q10 commit splits (4 → 4a/4b, 6 → 6a/6b) | accept | §3.1 grows from 8 → 10 commits. Still single authority boundary; better reviewability. |
| Q11 (resume, concurrency, manifest, TUI) | accept | Resume recovery rules added to DEBATE_POLICY.md. Scheduler-fired debate counts against M10 `maxConcurrent`. Manifest expands to BUILD_REPORT + VERIFY + REVIEW. No TUI surface in M15 (events.jsonl + doctor). |

No `reject-with-reason` items. No new durable CLAUDE.md rule emerged.

**Open follow-up — decide in next session before drafting `SESSION_M15_IMPL_KICKOFF.md`:** does the bundled `reviewer.md` get `tool_use.debate` granted in M15 (the canonical-fixture-friendly path), or is auto-mode opt-in by persona customization (the conservative-permission path)? Codex's recommendation is "either, but pick one and prove the baseline on it." This is the decision that gates the rule-21 metric definition.
