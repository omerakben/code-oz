# Codex briefing: v0.20.1-alpha.0 first-run polish

> **Codex role:** planning-convergence debate (read-only sandbox, ~10 min). Verdict: `accept` / `accept-with-modifications` / `revise` / `revise-and-redebate`. This is debate before implementation, not review of code that exists.

## Goal of this briefing

Get an independent (non-Anthropic-family) review of the v0.20.1-alpha.0 first-run polish design *before* any implementation lands on `finalize/v0.20.1-first-run-polish`. Per CLAUDE.md cross-model peer review rule: "never present 'ready to proceed' without the debate."

Specifically: validate that pulling forward the locked Option D Phase 3 trust/community/proof tasks into a v0.20.1 polish release **before** M17 ships in v0.21 is the right call given the GPT-5.5 Pro third-party audit findings, and validate the scope, ordering, and acceptance criteria of the polish work.

## Constraints (non-negotiable, do not relitigate)

These are CLAUDE.md non-negotiables and Option D locked decisions. Codex should assume them and review *given* them — not propose alternatives.

- **Rule 1**: file-based gate signals only; orchestrator-owned primitives in `src/state/gates.ts`.
- **Rule 17**: Maestro discipline is named and authoritative.
- **Rule 20**: one new authority boundary per milestone — v0.20.1 is finalize/polish, not a new milestone, and adds NO new authority. M17 (AUDIT runtime) is the next milestone; it stays in v0.21.
- **Rule 22**: consumer-first design + RED-first TDD for any behavior change. Failure-demo tests are the only behavior-change track in v0.20.1.
- **Cross-model peer review**: Codex debate at planning convergence (this briefing); per-task Codex verdict at implementation completion; final pre-tag Codex review.
- **Option D Phase 2 (M17 AUDIT runtime, 30–40h)**: stays in v0.21, NOT in v0.20.1. Do not relitigate the M17 ordering — that survived 3 R0 revisions already.
- **Option D Phase 3.2 comparison table**: reuse VERBATIM in `docs/comparisons/ai-coding-agents.md`. Do not propose row edits; the table survived 3 R0 revisions specifically against HN reputation risk.
- **Option D Phase 5 launch sequence**: stays gated behind M17. v0.20.1 ships polish only; no Show HN / Twitter / community dispatch.
- **Budget**: ≤$10 LLM spend advisory (this Codex R0 + one final Codex review pre-tag). Per-task verdicts via ChatGPT subscription auth = $0 incremental.

## Recommended plan (the design under review)

Pull-forward of GPT Pro audit fixes from behind M17 into v0.20.1, in 5 tracks, single-session execution (~12h Maestro):

### Track 1: Truth correction (≈3h)

| File | Change |
|---|---|
| `README.md` | Hero: "Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship." → **"CI-style gates for AI coding agents."** Replace "What it is" architecture-first formulation with plain-English value. Add "Why not just Claude Code or Codex?", "What is real today?", "What is simulated?" sections per GPT Pro §7 exact replacement blocks. Add "Star this repo if..." section. |
| `docs/ABOUT.md` | Receive demoted dense architecture content + "AI software company" metaphor (one paragraph, below fold) + influence-library detail. |
| `docs/contracts/PROVIDERS.md` | Audit provider table for honesty: Claude (live, CLI), Codex (live, CLI), xAI (live, HTTP+API key), FakeProvider (live, deterministic), Gemini (STUB — throws), OpenCode (future adapter candidate, not v0.1), Roo Code (future adapter candidate, not v0.1). |
| `package.json` | Description: "Multi-agent software-company simulation CLI with hard SDLC gates" → "CI-style gates for AI coding agents — local-first governed delivery loop". Add `keywords` array. |

### Track 2: Trust hygiene (≈3h)

Files created: `SECURITY.md`, `CONTRIBUTING.md`, 4 issue templates + 1 config + PR template under `.github/`, `docs/TRUST.md`. Acceptance: GitHub Community Standards mostly green.

### Track 3: Proof assets (≈4h)

- `docs/demo/02-failure-gates/` with 5 fixtures (tampered artifact, scope-escape, verify-fail, same-family-review, reviewer-blocks-risk) + orchestration script + RED-first tests at `tests/demo/failure-gates.test.ts` per rule 22.
- `docs/benchmarks/agent-gate-bench.md` (doc skeleton, TBD baselines, no runner this release per scope cut).
- `docs/comparisons/ai-coding-agents.md` (reuse Option D §3.2 table verbatim + intro/closer paragraphs).
- `docs/ROADMAP.md` simplified to public Now/Next/Later.

### Track 4: Release prep (≈2h)

CHANGELOG entry + release-notes draft + backfill for v0.20.0-alpha.0 thin notes per GPT Pro audit issue #5.

### Track 5: GitHub UI (≈30min, Ozzy)

Repo description, topics, 5 good-first-issues. Outside Maestro automation.

Full design at `docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md` (read this for complete locked decisions, file-by-file inventory, acceptance criteria per track, and risk register).

## Acceptance criteria for v0.20.1

- All 5 GPT Pro "five changes to make first" shipped.
- GitHub Community Standards green.
- `bun test` 0 failures (currently 3390 pass / 0 fail / 2 skip).
- `bun run scripts/demo/02-failure-gates/run-demo.ts` exits 0, all 5 fixtures snapshot-matched.
- Codex pre-tag verdict: `push` (or `fix-first` with all block-push closed before tag).
- v0.20.1-alpha.0 tagged on origin; install smoke green across curl, npm, Homebrew.

## Debate prompts (please address each)

### 1. Pull-forward call

Is pulling Phase 3 trust/community/proof tasks from behind M17 to v0.20.1 the correct trade-off, given:
- M17 is 30–40h and 3–4 weeks out at current cadence;
- the GPT Pro audit shows live trust holes (Gemini overclaim, "simulation" in package.json description, no SECURITY.md) that bleed visitors every day; and
- the locked Option D Phase 5 launch sequence stays gated behind M17 either way?

Or is there a stronger argument for following Option D's strict sequencing (M17 first → Phase 3 → Phase 5) even if v0.20.1 ships with the trust holes intact?

### 2. Comparison table reuse vs. rewrite

The locked Option D §3.2 comparison table survived 3 R0 revisions specifically against HN reputation risk (footnotes verified against competitor docs as of 2026-05-12). The v0.20.1 design reuses it verbatim. GPT Pro audit drafts a different (simpler) comparison table in `docs/code-oz-gpt-pro-research-prompt.md` line ~993. Is verbatim reuse correct, or does the GPT Pro draft contain claims that should override?

### 3. Failure demo as the centerpiece proof asset

The failure demo (`docs/demo/02-failure-gates/`) is the single highest-leverage proof asset per GPT Pro audit ("the demo to watch before trusting the tool"). Five fixtures: tampered artifact, scope-escape, verify-fail, same-family-review, reviewer-blocks-risk. Each must be deterministic via FakeProvider. RED-first tests at `tests/demo/failure-gates.test.ts`.

Is the 5-fixture set complete enough? Should any be cut for v0.20.1 scope (and deferred to v0.21)? Any fixture that would surface a gate that does not yet exist in `src/state/gates.ts` and would force scope creep?

### 4. Benchmark doc without runner

The design ships `docs/benchmarks/agent-gate-bench.md` as a doc skeleton with TBD baseline rows and explicitly defers the executable runner to v0.21. GPT Pro audit recommends shipping doc + runner together. The trade: shipping doc-only this release lets v0.20.1 stay 12h; shipping runner adds 4–6h and risks RED-first scope creep.

Is doc-only the right v0.20.1 cut? Or does shipping a benchmark doc without an executable runner damage the proof claim more than it helps?

### 5. "AI software company" metaphor disposition

Three options for the metaphor:
- **(a) Demote to ABOUT.md, one paragraph below fold** (locked default; GPT Pro recommends this).
- **(b) Delete entirely from all surfaces** (sharper, but loses the existing identity material).
- **(c) Keep as a secondary tagline below the new hero** (preserves identity but may dilute "CI-style gates" message).

Is (a) the right call given GPT Pro's "roleplay risk" finding (option scored "Medium roleplay risk" in §6 positioning table)? Or is there a sharper option?

### 6. Codex review cadence for v0.20.1

The design proposes: single Codex R0 debate (this briefing) + per-task Codex verdict on substantive commits + final pre-tag Codex review. For a 12h finalize/polish release with mostly doc work and one code-track (failure demo), is this cadence right? Should per-task verdicts be skipped for doc-only commits and reserved for the failure-demo code track + final pre-tag review?

### 7. Acceptance-criteria gaps

Are there acceptance criteria the design should add that would catch HN-class drift between commit and tag? Specifically:
- Should we add a "fresh-clone smoke test" before tag (clone repo, follow README, complete demo, verify links, confirm no overclaim)?
- Should we add a "GitHub Community Standards percentage" target (e.g., 8/8 green)?
- Should we add a markdownlint pass on every new doc file?

### 8. Missed risks

What does the design's risk register miss? Specifically: is there a class of HN-comment-class objection that the v0.20.1 polish does not preempt and would surface within 4h of a Show HN post? (Even though Show HN is not in v0.20.1 scope, v0.20.1 sets the public surface that any HN-bound visitor will hit.)

## Verdict format

Please return:

1. **Verdict**: `accept` / `accept-with-modifications` / `revise` / `revise-and-redebate`.
2. **Per-prompt response** (8 prompts above) with explicit accept/modify/reject + rationale.
3. **Block-approve findings** (must close before implementation lands).
4. **Medium findings** (should close before tag).
5. **FYI / nit findings** (defer to follow-up if not blocking).
6. **Missed risks** (anything the design did not consider).
7. **Recommended scope cut or scope add** if your verdict is `accept-with-modifications`.

## Files to read

- `docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md` (this design — primary)
- `docs/planning/1000_STAR_PLAN.md` (Option D, locked plan — context)
- `docs/code-oz-gpt-pro-research-prompt.md` (GPT Pro audit, lines 505–2606 = the result; lines 1–504 = the prompt that produced it)
- `README.md` (current state; you will see the dense hero "Repo-native agentic SDLC runtime…" that v0.20.1 replaces)
- `package.json` (current state; you will see the "Multi-agent software-company simulation CLI" description that v0.20.1 replaces)
- `docs/contracts/PROVIDERS.md` (current state)
- `docs/ABOUT.md` (current state; v0.20.1 thickens this to receive demoted content)
- `CLAUDE.md` (non-negotiable rules — especially rule 1, 17, 20, 22, and the cross-model peer review rule)

## Files NOT to read

- `src/**` (no source code changes in v0.20.1 except the failure-demo orchestration script and tests)
- `tests/**` except `tests/demo/failure-gates.test.ts` (only file added)
- `node_modules/**`, `dist/**`, `.code-oz/**`

## Constraint reminders

- **Sandbox: read-only** for this briefing (planning debate, no file writes).
- **Model: gpt-5.5 xhigh effort** (per CLAUDE.md Codex configuration).
- **Verdict is data, not authority.** I will weigh disagreement and push back when warranted; the point is structural review, not deference.
