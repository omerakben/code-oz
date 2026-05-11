---
session: 07
date: 2026-05-10
inputs: COMPARISON.md (Opus analysis) + CODEX_RESPONSE.md (Codex pressure-test)
final-verdict: YES, ahead — accept-with-modifications, post-Codex revision
status: closed
---

# Synthesis — Code-Oz vs learn-harness-engineering

## Headline

**Code-oz is ahead** of `learn-harness-engineering` in the runtime-vs-pedagogy comparison, with **5 selective borrows + 4 confirmed rejects + 1 flipped reject**, post-Codex revision. The category distinction (course vs runtime) holds. The original verdict was *too generous* in two places — Codex flagged that the course's tool-registry mechanics and benchmark methodology are more concrete than pure pedagogy, and that the comparison missed code-oz's own existing `AGENTS.md` pointer-file (which is the right cross-tool pattern, already shipped).

This synthesis is the canonical record. The original COMPARISON.md and the verbatim CODEX_RESPONSE.md remain unchanged for audit.

## What Codex changed

Five revisions to the original borrow / reject set:

| # | Original | Codex revision | Reason |
|---|----------|----------------|--------|
| B1 | Five-subsystem scorecard, optional CLI | Keep as **external-project diagnostic only**; map subsystems back to DEFINE→SHIP; **defer** the `code-oz doctor --harness-audit` subcommand until demand exists | A competing taxonomy for code-oz's internal phases would dilute rule 20 authority discipline; the scorecard's value is for *projects code-oz manages*, not for code-oz itself |
| B2 | Borrow course's "2–3 tasks, with-vs-without" sketch under `RULE21_BENCHMARK.md` | **Promote B2 to rank-1 and mark blocking** for any future parallel-provider surface. **Generalize `DEBATE_POLICY.md`'s existing methodology** (control/treatment events, corrective-rate floor 0.10, new-actionable-finding floor 0.30, no-signal rate, cost/latency overhead) into `RULE21_BENCHMARK.md` rather than borrowing the looser course playbook | The course's "tokens/time/rework" sketch is too loose to gate a load-bearing rule. M15 already shipped the rigor bar; B2 is generalization, not invention |
| B3 | Pin "Hook trust is all-or-nothing" to `REPO_CONTEXT.md` | **Defer** until the first hook/extension contract milestone | `REPO_CONTEXT.md` is scope-locked to `tool_use.repo_context` (network denied, manifest-bound). Cross-loading hook semantics into a sub-scoped contract would violate the contract's own discipline. Pinning the hook invariant in a hook-less contract today is speculative |
| B4 | Front-load trigger language in `src/prompts/universal-rules.md` | **Move out of universal-rules.md** to skill-authoring guidance (a separate doc, not the anti-slop sheet) | Description-budget mechanics are skill-metadata advice; `universal-rules.md` is execution discipline (rule 16 anti-slop). Mixing the two dilutes rule 16 |
| R3 | Reject AGENTS.md + CLAUDE.md split | **Flip to borrow-modified**: code-oz already has `AGENTS.md` as a one-line pointer to `CLAUDE.md` (`<repo-root>/AGENTS.md`). Confirm and document this pattern as the canonical cross-agent compatibility shape | Original analysis missed an existing artifact. The pointer-file pattern (vs. content duplication) is the right cross-tool-compatibility solution and is already deployed |

One addition Codex flagged as the strongest missed borrow:

| # | Borrow | Source | Insertion |
|---|--------|--------|-----------|
| B5 | **Fail-closed tool registry semantics** — per-call concurrency classification, stateful permission evaluator with side effects (denial tracking, mode transforms), protected-path / protected-command lists that bypass auto-approve, and the tool-safety-review checklist | [tool-registry-pattern.md](../../../templates/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md) | Pin into the existing `tool_use.*` permission contract surface, **not** `REPO_CONTEXT.md`. Likely lands as a sibling `docs/contracts/TOOL_REGISTRY.md` or as new sections in `docs/references/provider-contract.md` |

Codex also surfaced three secondary missed mechanics — flagged for future milestones, not immediate borrows:

- **Memory write invariants**: two-step topic-file-then-index write + bounded one-line index. Useful when code-oz adds a project-scoped memory layer (no current roadmap need).
- **Cache invalidation discipline**: memoized context builders must invalidate at mutation points. Useful for any future repo-context cache; informs the M-series after `tool_use.repo_context` is exercised in production.
- **Two-phase eviction**: clean disk output eagerly, in-memory record lazily after parent notified. Useful for any future background-task surface.

These three remain in the influence library as informational; no commit insertion proposed.

## Final borrow set, ranked (post-Codex)

| Rank | Borrow | Insertion | Effort | Status | Blocking? |
|------|--------|-----------|--------|--------|-----------|
| 1 | **B2 — Generalized rule-21 benchmark methodology** (control/treatment events, gating floors, no-signal/overhead telemetry, generalized from `DEBATE_POLICY.md`) | new `docs/contracts/RULE21_BENCHMARK.md` + cross-ref from `ROADMAP.md` § rule 21 | 2 commits | post-M16 polish | **YES** — blocking for any future M14/M15-style parallel surface |
| 2 | **B5 — Fail-closed tool registry semantics** (per-call concurrency, stateful permission, protected paths/commands, safety-review checklist) | new `docs/contracts/TOOL_REGISTRY.md` (or new sections in `docs/references/provider-contract.md`); cross-ref from any `tool_use.*` sub-scope contract | 2–3 commits | post-M16 polish | recommended before next `tool_use.*` extension |
| 3 | **B1 — External-project harness audit scorecard** (5-subsystem 1–5 rubric, mapped back to DEFINE→SHIP) | new `docs/contracts/HARNESS_AUDIT.md`; the `code-oz doctor --harness-audit` subcommand is **deferred until demand** | 1 commit (doc) | post-M16 polish | no |
| 4 | **R3-flipped — AGENTS.md as pointer file (already shipped)** | document the existing `AGENTS.md` pattern as canonical in `docs/contracts/CROSS_AGENT_COMPAT.md` (or as a new section in `CLAUDE.md`'s "How decisions live" block) | 1 commit (doc) | post-M16 polish | no — confirms existing pattern |
| 5 | **B4 — Front-load distinctive trigger language** (skill / agent-pack metadata authoring guidance, NOT in universal-rules.md) | new `docs/contracts/SKILL_AUTHORING.md` (or sibling doc to the maestro dossier) | 1 commit | post-M16 polish | no |

## Final reject set (post-Codex)

| # | Reject | Codex verdict | Reason |
|---|--------|---------------|--------|
| R1 | Replace six-phase taxonomy with five-subsystem framework | confirm-reject | Course's framework is descriptive (harness quality); code-oz's phases are authority boundaries with gate semantics |
| R2 | Adopt `feature_list.json` as canonical artifact | confirm-reject | Conflicts with Markdown artifact contracts + gate files. If ever wanted, must be a *projection* from PLAN + `events.jsonl`, not source of truth |
| R4 | Adopt four-stage bootstrap (minimal-context → tools → trust → sensitive) | confirm-reject | PE-2+ demand-gated. Retain the trust-boundary staging as *future acceptance criteria* when hooks / server / SDK modes appear |
| B3-deferred | Pin hook-trust all-or-nothing | defer | Belongs in the first hook/extension contract, not today's repo-context contract |

## Decisions locked

1. **B2 is the only blocking borrow.** It must land before any future M-series milestone proposes a new parallel-provider surface. The methodology generalization work uses `DEBATE_POLICY.md` § "Rule-21 metric definitions" as the source spec.
2. **B5 (fail-closed tool registry) is now the second-priority borrow.** Codex was correct that the original comparison underweighted concrete tool-safety mechanics. B5 lands as a sibling contract, not as a fold-in to `REPO_CONTEXT.md`.
3. **R3 flipped, but the work is already done.** `AGENTS.md` exists at the repo root as a one-line pointer (`<repo-root>/AGENTS.md:1`). The borrow is *documenting* the pattern, not adding a file.
4. **B3 is removed from the active borrow set.** It re-enters at the first hook/extension milestone (no current roadmap entry).
5. **B4 is preserved but relocated.** Skill-authoring guidance is a separate concern from rule-16 anti-slop discipline.
6. **All four original rejects hold** (R1, R2, R4 confirmed; R3 flipped).
7. **Three secondary mechanics** (memory two-step write, cache invalidation, two-phase eviction) remain in the influence library as informational notes; no commit insertion proposed.

## Pattern emerging across the comparison sweep

After session 07, the influence library splits cleanly:

- **Runtime peers** (ace, archon, aris): contribute architectural mechanics and milestone-shape inputs
- **Pedagogy templates** (agent-skills, learn-harness-engineering): contribute writing conventions, diagnostic rubrics, and *one or two* concrete mechanics extracted from upstream runtime patterns

Code-oz should resist absorbing pedagogy *as architecture*. The rule-20 authority discipline depends on staying lean. The post-Codex revision tightened B1 (external-only diagnostic), defers B3 (premature pin), and relocates B4 (skill metadata, not anti-slop) — each move guards rule 20 from absorbing competing taxonomies.

## Insertion scope (no commits in this session)

This session produces only the comparison documents. The 5 borrows are tracked here for future post-M16 polish work; no implementation commits land in the comparison session itself, per the established sweep cadence.

Cross-references for the next implementer:

- B2 source spec: `docs/contracts/DEBATE_POLICY.md` § "Rule-21 metric definitions" (lines 128–164 in v0.17.0-alpha.0)
- B5 source pattern: `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md`
- B1 source rubric: `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/SKILL.md.en` § Phase 2 (lines 70–82)
- R3-flipped existing artifact: `<repo-root>/AGENTS.md` (1 line, pointer to CLAUDE.md)
- B4 source: gotchas.md § 12 (front-load distinctive trigger language)

## Closing note for the influence library

The course's substantive contribution to code-oz is **not** the harness-creator skill itself (code-oz is a step beyond it) but the explicit articulation of two patterns the runtime needs to formalize: rule-21 measurement rigor (now B2) and tool-safety semantics (now B5). The four rejects and the deferred borrow confirm code-oz's existing discipline is already at the right granularity. The flipped R3 is a small but real win for cross-agent compatibility documentation.
