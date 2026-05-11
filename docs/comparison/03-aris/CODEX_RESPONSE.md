# Codex response — code-oz vs ARIS borrow audit (v0.17)

**Reviewer:** gpt-5.5 xhigh, sandbox: read-only
**Thread:** `019e12c0-5020-7ff3-9db3-32ce22269eda`
**Date:** 2026-05-10
**Briefing:** `CODEX_BRIEFING.md` (this folder)
**Comparison under review:** `COMPARISON.md` (this folder)

Codex's response is captured below verbatim. The synthesis (`SYNTHESIS.md`) processes the disagreements and locks the borrow set + milestone shape.

---

## Section 1 — Verdict on the verdict

Concur with **YES, with selective borrows**, but not with the comparison's low-authority-cost framing. The borrow set is real; the milestone pricing is soft.

The strongest missing ARIS evidence is not `/paper-claim-audit`; it is `skills/auto-paper-improvement-loop/SKILL.md:20-22` and `:186-196`, where ARIS documents score inflation from reused reviewer context and makes fresh reviewer threads the default. That strengthens B2, but it also proves B2 is a context-authority decision, not a trivial panel option.

I would not shift to YES-ahead-no-borrows because ARIS has two mechanics code-oz should absorb: reviewer context isolation and failure anti-repetition. I would not shift to NO-credible-gap because code-oz still structurally exceeds ARIS on gates, budget enforcement, provider-family checks, worktrees, and rule 21 discipline (`CLAUDE.md:21-43`, `docs/comparison/03-aris/COMPARISON.md:154-192`). The correction is narrower: **YES, selective borrows, but B2 and B3 need harder authority boundaries than Claude priced.**

## Section 2 — Per-borrow review

### B1, effort-as-workflow-modifier

- **Authority cost:** Disagree with "zero" unless this is only a derived budget envelope. ARIS effort changes breadth, depth, iterations, coverage, and implied assurance (`skills/shared-references/effort-contract.md:5`, `:57-68`, `:72-120`). If code-oz only scales `budgets.global`, it is mostly UX sugar. If it changes phase depth, reviewer count, debate likelihood, or audit strictness, it is new behavior authority.
- **Rule 21 risk:** Agree it bypasses rule 21 only while it does not add a new provider surface. If `max` or `beast` auto-enables panel/debate/fresh-reviewer behavior, it needs measurable bug-catch lift against the single-provider baseline.
- **Milestone fit:** Pre-M17 is acceptable only as `--effort` -> logged effective `budgets.global` values, with no phase behavior changes. Full ARIS-style effort belongs in a later budget/assurance milestone.
- **Bug class:** A CI or local run uses `--effort beast`, silently expands global caps 8x, but per-phase/by-role caps remain unscaled and fail mid-run in a non-obvious place.

### B2, zero-context fresh reviewer mode

- **Authority cost:** Disagree. This is a new reviewer-context authority axis. ARIS is explicit that prior feedback, fix lists, and executor explanations contaminate judgment (`skills/auto-paper-improvement-loop/SKILL.md:186-196`). code-oz currently reads `BUILD_REPORT.md`, `VERIFY.md`, and prior `REVIEW.md` for later rounds (`src/phases/review.ts:663-777`, `src/phases/review.ts:2329-2349`). Stripping that is not just a path filter.
- **Rule 21 risk:** Agree it is gated by rule 21. Required evidence: fresh reviewer finds accepted actionable defects missed by full-context review on the same BUILD/VERIFY evidence, with false-positive and cost rates tracked.
- **Milestone fit:** Not M17. Make it M14.1 or a dedicated review-context-isolation milestone before memory retrieval expands context further.
- **Bug class:** The fresh reviewer lacks prior finding identity and reopens already-resolved issues, causing ping-pong or duplicate remediation. The opposite bug is worse: the filter omits raw VERIFY evidence and the reviewer misses a real regression.

### B3, anti-repetition entry types

- **Authority cost:** Disagree. Claude's claim conflicts with the ACE synthesis: M17 is read substrate only; mutation, attribution, and compaction were split into M18-M20 (`docs/comparison/01-ace/SYNTHESIS.md:30-61`, `:65-106`). `failed-plans/` and `failed-builds/` are not just entry types if PLAN reads them on retry and BUILD reads them on restart.
- **Rule 21 risk:** Agree it bypasses rule 21 if it is sequential memory, not a parallel-provider surface. It still needs rule 2 if an LLM proposes entries based on Builder output.
- **Milestone fit:** Reserve the schema names in M17 if useful, but no automatic write/read behavior. Ship the failure-memory behavior after M17, likely with attribution/redaction controls from M19.
- **Bug class:** Memory poisoning. A transient flaky test or bad verifier parse becomes a durable "failed approach" and PLAN avoids a valid solution forever.

### B4, `/meta-optimize`

- **Authority cost:** Agree it is new authority, but "own milestone" is still underpriced. It can alter prompts, defaults, convergence rules, workflow ordering, and schemas (`skills/meta-optimize/SKILL.md:18-27`). Those are separate control planes in code-oz.
- **Rule 21 risk:** Partly disagree. Rule 21 applies when it changes panel/debate/provider surfaces. The broader risk is rule 20 plus safety: self-modification can weaken rules without adding a provider.
- **Milestone fit:** M19+ is still too early if M17-M20 memory is active. Make the first milestone report-only: read events, propose patches, no apply path. Applier comes only after fixture replay and production-run evidence.
- **Bug class:** The optimizer tunes to one user's local event log, lowers a universal anti-slop rule or budget threshold, and improves apparent completion while increasing escaped defects.

## Section 3 — The five contested questions

1. **Effort flag vs rule 19:** Single derived envelope, if effective caps are computed once, logged, and still enforced by `assertWithinBudget`. Back door, if `--effort` mutates defaults, bypasses per-phase/by-role caps, or hides the original budget in `events.jsonl`.

2. **Fresh-reviewer mode:** New authority axis. The panel already invokes reviewers, but B2 changes what evidence a reviewer may see. That is gate-relevant context selection. Treat it as M14.1, not incidental M17 work.

3. **Meta-optimize threshold:** Five invocations is only a readiness reminder. code-oz needs controlled replay or A/B evidence: fewer block-push findings, fewer repeated failures, or lower review rounds without higher cost, privacy leakage, or false readiness.

4. **Anti-repetition entries:** Same storage substrate, separate behavior surface. "Reviewer Memory" can store lessons; "Failure Memory" changes retry planning. That requires redaction, attribution, and anti-overmatch rules before PLAN consumes it.

5. **Miscalategorized patterns:** Yes. `experiment-queue` is not current-scope, but it is a future parallel-work scheduler primitive (`skills/experiment-queue/SKILL.md:78-92`, `:191-198`). Output Manifest is not canonical state, but it is a human-readable artifact index (`skills/shared-references/output-manifest.md:1-23`). `/result-to-claim` is a REVIEW-adjacent claim-support audit, not plain VERIFY (`skills/result-to-claim/SKILL.md:40-73`, `:200-204`).

6. **Run-level effort value:** It adds real behavior only if it propagates across phases, budgets, audit strictness, debate/panel preflights, and retry depth. If it only multiplies `maxTokensEstimate`, it is a convenience wrapper over config.

## Section 4 — What Claude missed

1. **Assurance-aware effort contract, load-bearing.** Claude reduced B1 to budget scaling. ARIS separates work depth from audit strictness and documents why conflating them produced draft-quality output under `beast` (`skills/shared-references/effort-contract.md:46-68`). code-oz should not borrow effort without an invariant that review quality and gate strictness never drop.

2. **Experiment queue as a stateful work scheduler, load-bearing later.** Claude treated remote GPU orchestration as out of scope. The domain is out of scope; the mechanics are not: manifest jobs, phase dependencies, wave transitions, OOM retry, expected-output completion, and crash-resumable `queue_state.json` (`skills/experiment-queue/SKILL.md:43-92`, `tools/experiment_queue/queue_manager.py:157-184`, `:303-383`). This is relevant to future parallel-builder candidates, not M17.

3. **Reviewer-routing override generator, cargo-cult for code-oz.** ARIS has its own reviewer routing overlay generator (`tools/generate_codex_claude_review_overrides.py:16-25`, `:141-182`). Do not copy it. It is regex/string-rewrite routing, while code-oz already has typed provider registry and family gates. The useful borrow is a negative test lens: generated overlays must not reintroduce same-family review or stale async semantics.

## Section 5 — One thing Claude is wrong about

The weakest claim is B3: "Authority: under the existing M17 Reviewer Memory boundary" (`docs/comparison/03-aris/COMPARISON.md:218`, `:229-232`).

Steelman the opposing position: B3 is **Failure Memory**, not just Reviewer Memory. The moment a failed PLAN or exhausted BUILD writes a signature and PLAN reads it on retry, code-oz has added a new causal input to planning. That crosses at least four sub-surfaces: failure capture, redaction, dedup/overmatch, and retry-time retrieval. ACE synthesis already corrected the earlier mistake of bundling storage, mutation, and telemetry into one M17 (`docs/comparison/01-ace/SYNTHESIS.md:14-18`, `:50-61`).

Concrete strengthening: in M17, allow only a reserved `type: failed-plan | failed-build` frontmatter value in the parser fixture. No automatic writes. No PLAN read hook. No "avoid this approach" prompt injection. Ship actual failure-memory behavior later with redacted event-linked entries, conservative attribution, doctor drift checks, and a fixture proving a transient/flaky failure does not poison future planning.
