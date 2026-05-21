# Receipts

This page shows concrete evidence that code-oz's governed-delivery machinery runs and catches real problems. Every section identifies whether the underlying evidence comes from a real external model review (Tier 1) or from a deterministic FakeProvider run that proves event mechanics but involves no real model (Tier 2).

## Two evidence tiers — never conflated

**Tier 1 — real model reviews.** An actual `gpt-5.5` model reviewed actual code and produced actual findings. The W3a R2, M14, and M15 transcripts below are Tier 1: real tokens, real bugs, real fix commits.

**Tier 2 — real machinery, simulated models.** The demo `events.jsonl` ledgers. The gate, review, debate-scheduler, and approval EVENT MACHINERY genuinely executed and is deterministic and network-free, but every model response was produced by the built-in `FakeProvider`, not a real model. The cross-family pairing (`buildFamily:"claude"`, `reviewerFamily:"codex"`) is recorded structurally in the ledger, but no real Codex model judged anything. These ledgers prove event mechanics and determinism, not model quality.

---

## The release gate that blocked its own release (W3a R2)

**What happened.** Before tagging v0.20.0-alpha.0 and pushing the release, a Codex R2 review ran on the candidate branch. R1's six earlier findings (one block-push, three fix-soon, two nits) were already closed. R2 found a new block-push bug — one that would have caused the GitHub Actions release workflow to fail in production the moment the tag landed.

**The Codex finding.** From `docs/design/CODEX_RESPONSE_W3A_R2.md` (lines 38–51):

```
## New concerns

### Block-push (new in R2)

`.github/workflows/release.yml:35` does not install dependencies
before the build step at `release.yml:53`. In a clean `git archive
HEAD` temp checkout, `bun build --compile --target=bun-linux-x64
src/cli.ts` fails with:

> Could not resolve: "yaml". Maybe you need to "bun install"?

A tag push would run this workflow and fail before release assets are
produced. Fix by adding `bun install --frozen-lockfile` after `Setup
Bun` in the `build` job, and add a workflow test for it.
```

Review metadata from lines 2–7 of that file:

```
session: W3a R2 re-review — Codex response
thread: 019e1a2c-9fbe-7742-88c7-7e9808434bd5
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: fix-first
```

**The fix.** Commit `1d520fe` — `fix(w3a): close Codex R2 block-push (release.yml bun install ordering)` — adds three lines to `.github/workflows/release.yml`:

```diff
+      - name: Install dependencies
+        run: bun install --frozen-lockfile
+
       - name: Resolve VERSION
```

The commit also adds `tests/ci-workflows.test.ts` with a behavioral test that finds both the install and build steps and asserts the build step index follows the install step index, RED-confirmed against the pre-fix workflow where `installIdx === -1`.

**Why this matters.** The local test suite was green (3361 pass / 0 fail / 2 skip). Typecheck was silent. The bug was invisible to every offline check. A clean GitHub Actions checkout has no `node_modules` or Bun install cache; the workflow would have exited before producing a single release binary. The cross-model review round, running as a required milestone gate, caught this before the tag.

---

## Cross-family review in practice (M14)

M14 shipped the Reviewer panel v1 — the first surface in code-oz where two provider families could simultaneously review the same code. The review cycle ran nine Codex rounds before the milestone was tagged.

**Thread and model.** From `docs/research/CODEX_REVIEW_M14_R2.md` (lines 1–6):

```
# Codex implementation review — M14 R2

Thread: `019dee08-756b-7ed2-984f-0298ab14c39a`
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m14-reviewer-panel` at `3bb8b65`
```

**R2 verdict: `fix-first`.** R2 found two block-push findings after R1 had already closed seven earlier bugs. Finding 1 (lines 61–75):

```
### 1. block-push — Panel mode cannot continue into a second REVIEW round

Files: `src/phases/review.ts:575`, `src/phases/review-panel.ts:516`

Panel mode now returns `needs_revision`, but a normal round-2 call cannot consume
the prior panel `REVIEW.md`.

`RunReviewOptions.priorReviewMd` is documented as the prior canonical `REVIEW.md`
for `round > 1`, but `runReview` always parses it with the single-reviewer parser
before the panel dispatch:

```ts
if (opts.round > 1 && opts.priorReviewMd != null) {
  priorReport = parseReviewReport(opts.priorReviewMd)
}
```

F2 exists because panel artifacts require `parseReviewPanelReport`; a panel prior
artifact contains `## Reviewers`, not single-mode `## Reviewer`. So panel round 1
`needs_revision` followed by round 2 with the prior panel report fails before it
reaches the panel branch.
```

**R8 verdict: `push`.** After seven fix-first rounds, R8 found no new issues. From `docs/research/CODEX_REVIEW_M14_R8.md` (lines 8–14):

```
## Verdict

`push`

R7's single medium finding is closed. The closure commit aligns the layer-2
contract truth for `panel_voter_same_family_as_build` across the locked rule,
the five-layer table, and the common-errors table, and the implementation/test
evidence matches that wording.

I found no new behavioral or contract-truth issue. After seven fix-first rounds,
another round would be diminishing returns unless it targets a real contract or
runtime gap. I did not find one.
```

**R9 final pre-tag verification.** From `docs/research/CODEX_REVIEW_M14_R9.md` (lines 8–14 and 27–35):

```
## Verdict

`push`

## Findings

None.
```

```
## No-tech-debt rule

`pass`

All expected block-push closure commits are present in `main..HEAD` and `git show --stat` verified them:

- R1 block-push closures: `264e4ec`, `cc4b265`, `fc7dc75`, `a706e87`, `32adc72`, `c517194`, `3bb8b65`
- R2 block-push closures: `91879a9`, `0fc2e90`
- R3 block-push closure: `9605606`
```

The M14 cycle opened with seven block-push findings in R1 and closed at zero by R8, with R9 a final pre-tag verification that found none. That is nine review rounds (R1 through R9) on one milestone.

---

## Debate-policy scheduler (M15)

M15 shipped the debate-policy scheduler — the orchestrator logic that decides whether to fire a debate between providers after a REVIEW round. The planning review caught four load-bearing design gaps before a line of implementation code landed.

**Planning review.** From `docs/research/CODEX_RESPONSE_M15.md` (lines 1–9):

```
# Response — m15-debate-policy-scheduler

**Thread:** `019e0561-3c95-72a2-b786-056eb685307f`
**Codex self-assigned label:** `codex-m15-debate-policy-scheduler-2026-05-07-gpt55-xhigh`
**Date:** 2026-05-07
**Model:** gpt-5.5 xhigh
**Sandbox:** read-only
**Approval:** never
**Brief:** `docs/research/CODEX_BRIEFING_M15.md`
```

One of the four missed risks Codex surfaced (the first, from the `## Risks the proposing side missed` section):

```
## Risks the proposing side missed

The largest concrete bug: M14 panel REVIEW does not have a numeric final score.
The canonical panel artifact uses `Final score: panel`, and
`review_resolved.finalScore=10` is only a compatibility sentinel. A scheduler
predicate that treats panel mode as having a synthesized numeric `Score.Final score`
will misfire or silently skip the wrong cases. For panel mode, either disable
score grey-zone and use voter-disagreement only, or define a new
orchestrator-owned derived score from eligible voters.
```

**Implementation review R1 verdict: `fix-first`.** From `docs/research/CODEX_REVIEW_M15.md` (lines 1–7):

```
# Codex implementation review - M15

Verdict: `fix-first`
Thread: `codex-m15-debate-scheduler-r1-2026-05-08-gpt55-xhigh` (`019e092f-c727-7442-ac18-fb6f57527f82`)
Model: `gpt-5.5`
Sandbox: read-only, approval policy never
Reviewed branch: `feat/m15-debate-scheduler` at `38f2c10`
```

R1 found that production auto-fire was a no-op — `mode: auto` evaluated and continued but never invoked `requestDebate()`. R2 verified all five block-push closures and returned `push` (`docs/research/CODEX_REVIEW_M15_R2.md`, lines 1–15, verdict `push`, thread `019e09bb-adf3-71c2-adca-74296236b755`).

---

## Event ledgers from real gated runs (Tier 2)

**These are FakeProvider runs.** Every model turn in the ledger below was produced by the built-in `FakeProvider` — a deterministic, network-free stub. No real Claude, no real Codex. The ledgers prove that the gate, worktree, budget-envelope, debate-scheduler, cross-family-pairing, and Scientist-tail event machinery all executed and produced a well-formed, replayable event log. They do not prove anything about model output quality.

The `balanced` ledger is at `docs/demo/01-todo-cli/output/balanced/events.jsonl` (71 lines). The JSON blocks below are line-wrapped for readability; each is stored as a single line in the ledger. Key events and what each proves:

**Line 2 — `effort_envelope_applied`** (immediately after `run_started`): records both `originalBudgets` and `effectiveBudgets` in full. Proves rule 23: the budget envelope is recorded once at position 2 in the event log, and active-run continuations replay it directly rather than re-applying `applyEffort` to the current config.

**Line 55 — `review_started`**: records `buildFamily:"claude"`, `reviewerFamily:"codex"`, plus `baseCommitSha`, `patchSha256`, `buildReportSha256`, `verifyReportSha256`. The cross-family pairing is written into the event log as a structural fact — not inferred, not advisory.

```json
{"version":1,"type":"review_started","ts":"2026-05-11T21:37:04.681Z",
"runId":"01KRCFHR2N2GYBHG9JWMJR61A5","phase":"review","agent":"reviewer",
"attempt":1,"taskId":"T-001",
"baseCommitSha":"d5888a71c183728cd142aaa9b3335212841910dc",
"patchSha256":"662a93563e3a34b0cabc71838ea6d751dcc99196d23295e3b16731a81ea1bec5",
"buildReportSha256":"1aeb6d1a91bd2102417ad9fa98304ac2bc524b75f731ca74c0f7479cabfeff9f",
"verifyReportSha256":"74d9a47c4f819e833dbe94c917416ae2eb28d1a0d2f54ae9fd9f83a0573f1ce2",
"buildFamily":"claude","reviewerFamily":"codex"}
```

**Line 58 — `review_round_completed`**: `round:1, score:8, verdict:"ready", findingsRaised:0`. Proves the review machinery ran to a terminal verdict.

```json
{"version":1,"type":"review_round_completed","ts":"2026-05-11T21:37:04.685Z",
"runId":"01KRCFHR2N2GYBHG9JWMJR61A5","phase":"review","agent":"reviewer",
"attempt":1,"taskId":"T-001","round":1,"score":8,"verdict":"ready",
"findingsRaised":0,"findingsResolved":0,
"reviewReportSha256":"bda02db44dd9af86421494c6004f551aeb4f3538dd19a3c5da29cb54981b5641"}
```

**Lines 59–60 — `debate_scheduler_evaluated` then `debate_scheduler_skipped`** (`reason:"mode_manual"`): proves the debate-scheduler hook ran, evaluated, and recorded its decision in the event log — even when the decision was to skip. The `decisionId` is stable and correlatable.

**Line 61 — `review_resolved`**: `finalRound:1, finalScore:8`. The review gate closed on evidence from the event log, not from text parsing.

The ledger also contains: `run_started` (line 1), `phase_entered`/`phase_exited` per phase, `gate_required`/`gate_written` for all five phases (DEFINE, PLAN, BUILD, VERIFY, REVIEW), `worktree_created`/`worktree_patch_applied`/`worktree_destroyed` (lines 26, 31, 67), `build_completed` (line 36), `verify_completed` (line 49), `science_emitted` ×4 (lines 20, 35, 48, 64), `hypothesis_added` (line 18), `question_added` (line 19).

**Reproduce it locally:**

```sh
bun run demo:todo-cli
cat docs/demo/01-todo-cli/output/balanced/events.jsonl | tail -20
```

Two additional variants exist — `lite/` and `beast/` — with different `--effort` multipliers producing different effective budget envelopes in line 2.

A live brownfield bug-fix receipt (a real model run through the AUDIT phase catching and fixing a real defect) is pending live-credentials dogfood and has not been run. It is not represented here.

---

## Full test suite and further reading

Current suite on this branch, measured by a local `bun test` run on 2026-05-21: **3762 pass, 2 skip, 0 fail — 3764 tests across 245 files** (the 2 skips are pre-existing live-gated xAI integration tests behind `CODE_OZ_LIVE_PROVIDER_TESTS=xai`). The v0.21.0-alpha.0 release notes corroborate the 3762 pass count.

Run it: `bun test`

Further reading:
- `README.md` — installation, quick-start, and claim summary
- `docs/comparisons/ai-coding-agents.md` — head-to-head against raw coding agents
- `docs/contracts/` — the formal gate, artifact, and event contracts that the machinery above implements
