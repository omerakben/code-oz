# Synthesis — code-oz vs ARIS borrow audit (v0.17)

**Date:** 2026-05-10
**Author:** Claude Opus 4.7 (xhigh) after Codex gpt-5.5 xhigh adversarial review (thread `019e12c0-5020-7ff3-9db3-32ce22269eda`)
**Inputs:** `COMPARISON.md` (initial verdict + borrow set), `CODEX_RESPONSE.md` (verbatim adversarial review)
**Status:** locks the borrow set + milestone shape for the ARIS comparison. Acceptance criteria for each borrow are defined here; no implementation work begins until the listed acceptance criteria are met.

---

## What changed after Codex review

Codex concurred with the verdict (**YES, with selective borrows**) but rejected the milestone pricing on three of four borrows. Three concrete adjustments:

1. **B1 (effort dial) was over-collapsed.** Splitting work depth from audit strictness is the load-bearing ARIS lesson, not "scale `budgets.global`." The effort contract has *two* axes; conflating them produced draft-quality output under `beast` in ARIS's own data (`skills/shared-references/effort-contract.md:46-68`). The borrow splits.

2. **B2 (fresh-reviewer mode) is its own authority axis.** Reviewer-context selection is gate-relevant. Treating it as a M14 sub-mode collapses two boundaries into one and violates rule 20. Codex's evidence: `src/phases/review.ts:663-777` and `:2329-2349` show that the reviewer currently reads `BUILD_REPORT.md`, `VERIFY.md`, and prior `REVIEW.md`; stripping those is not a path filter, it is a context-policy change.

3. **B3 (anti-repetition) is Failure Memory, not Reviewer Memory.** PLAN-on-retry reading a `failed-plans/` index is a new causal input to planning. Four sub-surfaces (capture, redaction, dedup/overmatch, retrieval-at-retry-time). The ACE synthesis (`docs/comparison/01-ace/SYNTHESIS.md:14-18`, `:50-61`) already corrected an analogous mistake — bundling storage, mutation, and telemetry into a single M17 — and the same correction applies here.

Codex also surfaced one borrow Claude undersized (B5, experiment-queue mechanics as a future parallel-work scheduler primitive) and confirmed one negative borrow (reviewer-routing override generator is cargo-cult).

---

## Locked borrow set

The borrows are renumbered to reflect the splits. Each entry has acceptance criteria; nothing ships without them.

### B1a — `--effort` flag as derived budget envelope (pre-M17 polish)

**Scope.** A top-level `code-oz run --effort {lite|balanced|max|beast}` flag that:
- Derives effective `budgets.global` values *once* at run start by multiplying every cap (`maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`) by the effort multiplier (0.4x / 1x / 2.5x / 6x).
- Scales **all** budget caps together — including per-phase and per-role caps under `budgets.global.roles` (rule 19, M13). No mixed-scale caps.
- Logs the *original* budget envelope and the *effective* envelope in `events.jsonl` at the run-start event.
- Changes **no** phase behavior, reviewer count, debate likelihood, audit strictness, or restart-policy threshold.

**Authority cost.** Zero new boundary. Operates on existing `budgets.global` (rule 19) without changing the enforcement contract.

**Acceptance criteria.**
- An e2e test runs the binary at every effort level and asserts: (a) the effective envelope = original × multiplier, (b) per-phase and per-role caps scale at the same multiplier, (c) `events.jsonl` records both envelopes at run start, (d) no phase behavior or gate threshold differs from baseline.
- `cli --help` documents `--effort` and lists the multiplier table.
- `docs/references/budgets.md` (or equivalent) gains an "Effort multipliers" section that explicitly states: *the flag does not change phase behavior or audit strictness*.

**Milestone slot.** Pre-M17 polish, alongside the next budget or CLI maintenance commit. Not a milestone of its own.

**Deferred bug class** (Codex section 2, B1): `--effort beast` 8x globals but per-phase caps unscaled, mid-run failure. The "scale all caps together" requirement closes it.

### B1b — Assurance-aware effort contract (deferred milestone)

**Scope.** A second axis on the effort flag that controls audit strictness — reviewer rounds, panel size, debate likelihood, mutation gate threshold, restart-policy attempt cap. ARIS calls this "effort changes breadth, depth, iterations, coverage, and implied assurance" (`skills/shared-references/effort-contract.md:5`, `:57-68`, `:72-120`).

**Authority cost.** New behavior axis. Belongs in its own milestone with explicit invariants.

**Project-level invariant** (added by this synthesis, captured in §"New project-level constraint" below): *no effort level may decrease review quality or gate strictness below the baseline*. Effort can only relax *budget* caps, not *quality* gates.

**Acceptance criteria.**
- Designed only after B1a is in production for ≥1 milestone and `events.jsonl` shows the budget-envelope flag is in regular use.
- Requires a written invariant document that lists every gate threshold and proves the effort multiplier never decreases it.
- Required A/B evidence under rule 21 if any audit-strictness lift on `max`/`beast` enables a parallel-provider surface (e.g., extra panel slot).

**Milestone slot.** Deferred. Earliest candidate: post-M17, post-Failure-Memory, when the "what an effort level *means*" surface is large enough to need a unified contract.

### B2 — Zero-context fresh-reviewer mode (M14.1, dedicated milestone)

**Scope.** An opt-in panel sub-mode where one slot is invoked with **only** the BUILD patch + raw VERIFY evidence (test output, mutation report). The slot does **not** receive `BUILD_REPORT.md`, `VERIFY.md` summary, prior `REVIEW.md`, `HYPOTHESES.md`, debate transcripts, or any executor-authored summary.

**Authority cost.** New reviewer-context authority axis — *not* a M17 sub-mode. Codex's evidence: `src/phases/review.ts:663-777` and `:2329-2349` already inject prior context into later reviewer rounds; stripping that is gate-relevant context-policy change, not a path filter.

**Required invariant.** The fresh-reviewer slot still receives raw VERIFY evidence (test output, mutation report) — the filter strips *executor summaries*, not *evidence*. ARIS's own warning: omitting raw evidence is the worse failure mode (Codex section 2, B2).

**Rule 21 gate.** Must demonstrate measurable bug-catch differential against the full-context reviewer on the same BUILD/VERIFY evidence. Required tracked metrics: actionable defects found, false-positive rate, cost ratio. The events.jsonl already records reviewer findings (M14), so the A/B is observable; no new instrumentation needed.

**Acceptance criteria.**
- M14.1 ships with both: (a) the fresh-reviewer slot, and (b) the A/B harness that runs both contexts on the same evidence and emits a `fresh_vs_full_review_compared` event.
- After ≥10 panel runs with the A/B harness, the events.jsonl is analyzed and a verdict is written: *retain*, *adjust*, or *roll back*.
- Pre-merge fixture: a synthetic BUILD where the full-context reviewer would copy a prior round's mistake and the fresh reviewer would not — proves the mechanism is not symbolic.

**Milestone slot.** **M14.1 — Reviewer-context isolation.** A dedicated single-authority milestone. Slots before M17 if Failure Memory is sequenced after it; otherwise after.

**Deferred bug class** (Codex section 2, B2): fresh reviewer reopens already-resolved findings (ping-pong). The acceptance criterion's invariant — *finding identity is preserved across rounds via VERIFY evidence keys, not via REVIEW.md continuity* — closes it. The fresh slot reads structured VERIFY findings (test names, mutation IDs) and reports against those keys.

### B3a — Reserve `failed-plan` / `failed-build` frontmatter values in M17 (storage only)

**Scope.** The M17 ACE-borrow Reviewer Memory v1 bullet schema reserves two frontmatter type values: `type: failed-plan` and `type: failed-build`. The M17 parser accepts entries with these types but **does not write them automatically and does not read them in PLAN or BUILD**.

**Authority cost.** Within the M17 Reviewer Memory boundary. Schema-only; no behavior.

**Acceptance criteria.**
- M17 parser fixture covers both types as valid.
- M17 schema doc explicitly states: *no automatic write, no read hook in PLAN or BUILD; reserved for B3b*.

**Milestone slot.** M17 (alongside ACE B1–B3).

### B3b — Failure Memory milestone (own milestone, post-M17/M18/M19)

**Scope.** Activate `failed-plans/` and `failed-builds/` entry types with:
- Capture: failed PLAN gate or exhausted BUILD restart writes a redacted signature (artifact hashes + error class + restart-policy outcome), event-linked.
- Redaction: secret redaction (rule 13) on the signature contents.
- Dedup / overmatch: a flaky/transient failure does not promote to a durable "failed approach"; require N matching signatures across distinct runs before the entry is read on retry.
- Retrieval: PLAN reads the index on retry; the read is bounded by `budgets.global.memory` (ACE B4) and tagged in the prompt as "prior-failure context — verify before avoiding."

**Authority cost.** New "Failure Memory" boundary. Four sub-surfaces; cannot share M17.

**Rule 21 gate.** Sequential memory; no new parallel-provider surface, so rule 21 does not directly fire. But the rule-2 cross-family review still applies on entries proposed by an LLM. And the *poisoning* failure mode (Codex section 2, B3 bug class) requires a fixture proving a transient flaky test does not poison future planning.

**Acceptance criteria.**
- Designed only after M17 (storage substrate) is in production and ACE B5/B6 (compaction + helpful/harmful counters) have shipped.
- Pre-merge fixture: a transient failure (e.g., a test that fails once on retry) does not become a durable `failed-plan` entry that prevents PLAN from re-attempting the same approach.
- Pre-merge fixture: redaction strips secrets from any captured signature.
- Doctor drift check: `code-oz doctor` reports the size and oldest entry of every `failed-*` index; user can audit and prune.

**Milestone slot.** Post-M17, post-ACE B5/B6 (compaction + counters). Earliest candidate: M19 or later, after the substrate has been in use long enough to prove it is sound.

### B4 — `/meta-optimize` skill candidate (deferred to v0.2+, report-only first)

**Scope.** Log-driven outer-loop optimizer. **First milestone is report-only**: the skill reads `state/events.jsonl`, identifies optimization signals, generates patch *proposals*, runs Codex cross-model review on each proposal, and writes a `META_OPTIMIZE_REPORT.md`. **No apply path.**

**Apply path** comes later, gated by:
- Fixture replay: every proposed patch must be reproducible from a recorded events.jsonl fixture.
- Production-run evidence: ≥50 production runs across distinct repos before any patch is applied to a shipped persona, rule, or budget default.
- Controlled A/B (rule 21): the patched and baseline configurations run on the same task fixture, and the patch is retained only if it shows a measurable improvement on a tracked metric (block-push findings rate, repeated-failure rate, review rounds, gate false-readiness rate).

**Authority cost.** New "harness self-modification" axis. Even the report-only first milestone is a single new boundary.

**Acceptance criteria** (for the report-only milestone).
- The skill reads events.jsonl and produces a `META_OPTIMIZE_REPORT.md` with: signal cited per proposal, proposed diff, Codex review verdict per diff.
- The skill does not write to any persona, rule, budget, or threshold file. The report is read by the maintainer, not auto-applied.
- The skill writes to `.code-oz/meta/optimizations.jsonl` (proposed-only entries).
- A fixture-based test runs the skill against a recorded events.jsonl and asserts the proposal set is stable.

**Milestone slot.** v0.2+. Not before B3b. Not before the harness has accumulated enough production usage to make the signal trustworthy.

**Deferred bug class** (Codex section 2, B4): the optimizer tunes to one user's local log and weakens a universal rule. The "report-only first" requirement closes the immediate risk; the apply-path acceptance criteria close the long-term risk.

### B5 — Experiment-queue mechanics (deferred candidate for parallel-builder candidates milestone)

**Scope.** Borrow the *mechanics*, not the domain: manifest-of-jobs, phase dependencies, wave transitions, OOM-style retry, expected-output completion check, crash-resumable `queue_state.json` (`tools/experiment_queue/queue_manager.py:157-184`, `:303-383`).

**Authority cost.** Not for M17. Becomes relevant when **parallel-builder candidates** enter scope under rule 21 — the rule explicitly lists parallel-builder candidates as a deferred surface. The experiment-queue patterns are the substrate that mechanic would need.

**Acceptance criteria** (for the parallel-builder milestone, when it lands).
- Specify the queue state schema in code-oz's typed style (not Python regex parsing — see B6 negative borrow).
- The `queue_state.json` schema must be schema-validated under `src/state/schemas.ts` (rule 1 generalization).
- Crash-recovery fixture: kill mid-wave, restart, prove the next wave starts where the previous one left off.

**Milestone slot.** Deferred until parallel-builder candidates enter scope under rule 21. Currently `(none planned)` per `CLAUDE.md` rule 20 post-M10 sequence.

### B6 (negative) — Do **not** borrow the reviewer-routing override generator

**Scope.** ARIS's `tools/generate_codex_claude_review_overrides.py` (`:16-25`, `:141-182`) generates regex/string-rewrite reviewer routing overlays.

**Decision.** Cargo-cult. code-oz already has typed provider registry and family gates (M11, M12, M14). The useful borrow is *negative*: a test asserting that any future routing-override mechanism must not reintroduce same-family review or stale async semantics.

**Acceptance criteria.** A test in `tests/` that, given a misconfigured routing override, asserts the reviewer-panel loader rejects it.

---

## New project-level constraint (added by this synthesis)

**Effort-flag invariant** (proposed for inclusion in `CLAUDE.md` next time it is edited): *no effort level may decrease review quality or gate strictness below the baseline*. The effort flag may scale `budgets.global` envelopes, but it cannot:
- Decrease `MAX_REVIEW_ROUNDS`.
- Decrease panel slot count.
- Disable mutation gating in VERIFY.
- Decrease BUILD restart attempt cap.
- Decrease debate-policy thresholds (M15).
- Decrease audit-strictness on the AUDIT phase for brownfield runs.

This constraint is the load-bearing lesson from ARIS (`skills/shared-references/effort-contract.md:46-68`) — separating work depth from assurance — and should land at the same time B1a ships.

---

## Updated milestone shape

The shape after Codex review:

| Slot | Borrow | Authority |
|---|---|---|
| Pre-M17 polish | B1a (effort flag → derived budget envelope) + effort-flag invariant | Zero new boundary (extends rule 19) |
| **M14.1 (new)** — Reviewer-context isolation | B2 (zero-context fresh-reviewer) + A/B harness | New context-policy boundary |
| M17 — Reviewer Memory v1 (already proposed in 01-ace) | ACE B1–B3 + B3a (reserve failure-frontmatter values) | M17 boundary unchanged |
| M19+ — Failure Memory | B3b (capture + redaction + dedup + retrieval-at-retry) | New "Failure Memory" boundary |
| v0.2+ — Meta-optimize report-only | B4 (skill writes report, never applies) | New "harness self-modification" boundary |
| Deferred to parallel-builder candidates | B5 (experiment-queue mechanics) | Substrate for parallel-builder milestone |
| Deferred to assurance milestone | B1b (assurance-aware effort) | New "effort affects assurance" boundary |
| Negative | B6 (reviewer-routing override generator) | Cargo-cult; do not borrow |

The post-M16 sequence published in `CLAUDE.md` rule 20 currently says "M16+ deferred (Researcher phase-tail, parallel builder candidates, multi-opponent debate) until measurable need." This synthesis adds:

- **M14.1** as the next new boundary if reviewer-context isolation earns its A/B evidence faster than the M17 ACE substrate is ready. Otherwise M17 first, M14.1 second.
- **M19+** Failure Memory as the next new boundary after M17/M18 ACE.
- **B1a** as a non-milestone polish row (no new boundary).

This sequence respects rule 20: every new milestone introduces exactly one new authority boundary. Three of the four ARIS borrows are split or deferred; one (B1a) ships pre-milestone.

---

## What this synthesis does NOT recommend (confirmed)

The negative recommendations from `COMPARISON.md` §9 stand. Codex confirmed the cargo-cult on the routing-override generator (B6). No new negatives are added.

---

## Codex's strongest finding — captured

The single most important Codex contribution: **the effort contract is not a budget multiplier; it is two axes (work depth × assurance) that must be kept separate**. Conflating them is what produced ARIS's own draft-quality `beast` output.

This finding rewrites B1 into B1a + B1b, adds the effort-flag invariant as a project-level constraint, and prevents code-oz from importing the same conflation that bit ARIS.

---

## Next steps (sequenced)

1. **No code action this session.** This is a comparison + decision artifact. Implementation work is separate.
2. **B1a (effort flag → derived envelope)** is shippable as a pre-M17 polish row — design doc + acceptance test + CLI flag. Earliest opportunity: alongside the next CLI maintenance commit.
3. **M14.1 (reviewer-context isolation)** earns its slot when (a) the M14 panel events.jsonl is large enough to seed the A/B harness, and (b) the M17 ACE substrate is ready or sequenced after.
4. **B3a (reserve failure-frontmatter)** lands inside M17 with the rest of the ACE Reviewer Memory v1 substrate.
5. **B3b (Failure Memory)**, **B4 (meta-optimize report-only)**, **B5 (experiment-queue)**, **B1b (assurance effort)** are tracked in `docs/design/ROADMAP.md` as named candidate slots, each with its own acceptance criteria, none with a fixed date.

The ARIS comparison closes at this synthesis. The next per-template comparison takes the next slot under `docs/comparison/`.
