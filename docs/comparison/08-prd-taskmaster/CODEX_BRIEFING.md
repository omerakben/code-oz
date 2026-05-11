---
name: codex-briefing-prd-taskmaster
companion-docs: COMPARISON.md (analysis), CODEX_RESPONSE.md (verdicts), SYNTHESIS.md (locks)
target: structured Codex debate input for the prd-taskmaster comparison
status: dispatched-pending
date: 2026-05-10
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only
---

# Codex briefing — comparison with prd-taskmaster

## Why we are debating

Single-model verdicts on whether to borrow from a template have blind spots. This briefing structures a Codex round on the comparison so the borrow set in `COMPARISON.md` is pressure-tested before any milestone ledger entry is written.

Codex must read **`docs/comparison/08-prd-taskmaster/COMPARISON.md`** and the template at **`/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/`** before responding. The response goes in `CODEX_RESPONSE.md` with a verdict (`push` / `accept-with-modifications` / `reject` / `block-soft` / `block-hard`).

## Project state Codex needs

- code-oz is at v0.17.0-alpha.0 (M16 closed and pushed). Tests: 3108 passing, 1 skip.
- Roadmap milestones M11 → M16 are closed. Post-M16 sequence is open; this debate may inform a small SPEC-validator-refinement milestone (working name M-SPEC1).
- Pinned non-negotiable rules live in `CLAUDE.md` 1–21. Of those, the ones most relevant here:
  - Rule 1 — file-based gate signals only (no LLM text parsing for pass/fail)
  - Rule 13 — privacy by default
  - Rule 16 — universal anti-slop rules in every persona prompt
  - Rule 20 — one new authority boundary per milestone
  - Rule 21 — no new parallel-provider surface without measurable risk reduction
- code-oz's SPEC contract: six required sections (Goals, Users, Constraints, Acceptance criteria, Open questions, Explicit non-goals), bullet-only, deterministic schema, sha256-bound at gate approval. Pinned at `docs/references/spec-contract.md`.

## What prd-taskmaster is

A Claude Code skill (single SKILL.md + 1079-line `script.py`) that generates a Product Requirements Document, validates it with 13 quality checks, sets up a `.taskmaster/` directory, optionally hands off to TaskMaster MCP / CLI for task expansion, and offers four execution modes (Sequential / Parallel / Full Autonomous / Manual). Authority surface ends at PRD creation + USER-TEST checkpoint insertion every 5 tasks. No cross-family review. No file-based gates with sha256 binding. No run-level budgets. No worktree isolation. No event log.

## Pre-debate decision (this is what Codex must stress-test)

**YES — code-oz exceeds. Two prompt-adjacent borrows; one future milestone; zero new authority footprint.**

The two borrows:

- **B1 — Vague-language linter on SPEC.md.** Add a regex check for `fast|slow|quick|good|bad|user-friendly|easy|simple|secure|safe|scalable|flexible|performant|efficient` (with optional `should be / must be / needs to be` lead-in) when not accompanied by a number or specific criterion. New error code `spec_vague_language`. Warning-only, never block-write. Implemented in `src/artifacts/spec.ts`.

- **B2 — Executive-summary length check on SPEC.md.** Adapt prd-taskmaster's "executive summary 50–200 words" check to code-oz's bullet-only Goals section as a "Goals must have ≥ N bullets *and* ≥ M total words" rule. New error code `spec_goals_underspecified`. Warning-only.

Both bundled under one future milestone (M-SPEC1). Authority footprint: zero new authority — same gate (DEFINE), same artifact (SPEC.md), same writer.

## Locked answers (do not redebate)

- **Six other prd-taskmaster mechanics are already stronger in code-oz.** Cross-family REVIEW, file-based gates with sha256 binding, run-level budgets, provider abstraction, repo-context permission scope, privacy by default. Codex should not propose code-oz adopt prd-taskmaster's *runtime*; that ground is settled.
- **Five prd-taskmaster mechanics are deliberately out of scope.** USER-TEST checkpoint insertion, datetime tracking + accuracy learning, per-task git rollback tagging, security-audit regex sweep, TaskMaster MCP delegation. The reasons live in `COMPARISON.md` § "Rejected borrow candidates".
- **The 13 PRD checks are not adopted wholesale.** Most are PRD-specific (executive summary, business impact, REQ-NNN, Must/Should/Could, NFR targets) and do not match code-oz's six-section bullet-only SPEC. Adopting them would force a SPEC schema rewrite, not a refinement.
- **`CLAUDE.md` template generation is rejected.** Generic templates dilute project-memory specificity.

## Open questions for the debate (these are what Codex addresses)

1. **Cadence:** Should B1 (vague-language) and B2 (Goals-volume) bundle under one milestone (M-SPEC1) or split into two? Both touch the same artifact and same writer; bundling fits Rule 20's "one authority per milestone" cleanly. Splitting ships two smaller milestones each touching one validation rule. Pre-debate position: bundle, because zero new authority.

2. **Authority of the vague-language vocabulary:** Is the word list a *config* (per-project, drift over time, editable in `.code-oz/config.yaml`) or a *contract* (pinned in `docs/references/spec-contract.md`, only changes with a contract version bump)? Pre-debate position: contract, because configurable validation rules are how Rule 1's "file-based gate signals only" gets weakened.

3. **USER-TEST resurrection:** The pre-debate decision rejects USER-TEST every-5-tasks because code-oz is autonomous. But Rule 21 says new parallel-provider surfaces (and arguably any new authority surface) need measurable risk reduction. Could a *cumulative-risk-checkpoint* — write `cumulative_checkpoint_due.json` after every Nth task or every Xth dollar — be a Rule-21-compatible borrow? Pre-debate position: no, because the next milestone-wide budget kill is the right granularity, and per-task user-prompts are the wrong product shape.

4. **Generalisation:** Should B1's vague-language linter live in `src/artifacts/spec.ts` (paired with existing parser-tolerance rules) or as a standalone `src/artifacts/lint-vagueness.ts` so PLAN / BUILD_REPORT / REVIEW can import it later? Pre-debate position: in `spec.ts` for the first ship, generalised on the *second* call site — premature module extraction was a Rule-3 violation in past milestones.

5. **Borrow validity check on the vocabulary itself:** prd-taskmaster's word list is a heuristic with no empirical justification. Are there words that *must* be added (e.g. `robust`, `seamless`, `intuitive`, `minimal`) or removed (e.g. `simple` is often legitimate in "no auth, no DB, simple file system")? Pre-debate position: ship prd-taskmaster's list verbatim as v1, learn from false positives.

6. **Cross-rule check:** Are there hidden authority footprints in B1+B2 we missed? Pre-debate analysis says zero new authority because the gate, artifact, writer, and approval flow are unchanged. Codex should explicitly try to find a violation.

7. **Privacy footprint:** prd-taskmaster's `bullet_usage_log.jsonl` analogue (its progress.md log) records full task titles and durations. code-oz's events.jsonl already does this. Is there a privacy concern in the vague-language linter (the matched terms get logged as part of the warning)? Pre-debate position: no, because the matched terms are tokens from a pinned 14-word list; no user content is exfiltrated beyond the matched word and its surrounding sentence.

## What "good" looks like in the response

- A verdict at the top: `push` / `accept-with-modifications` / `reject` / `block-soft` / `block-hard`.
- Per open question, a one-paragraph answer with disagreement explicit.
- Any *new* findings (mechanics in prd-taskmaster the briefing missed, hidden authority footprints in B1/B2, false-positive risks in the vocabulary list).
- Severity tags on findings: `block-push`, `fix-soon`, `nit`, `fyi`.
- A revised borrow set if the verdict is `accept-with-modifications` or stricter.

## Reading list

- `docs/comparison/08-prd-taskmaster/COMPARISON.md` (this folder)
- `/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/SKILL.md`
- `/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/script.py`
- `/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/reference/validation-checklist.md`
- `/Users/ozzy-mac/Projects/agents/templates/prd-taskmaster/templates/taskmaster-prd-comprehensive.md` (skim only, structure not content)
- `docs/references/spec-contract.md` (code-oz SPEC contract)
- `docs/contracts/SPEC.md`
- `CLAUDE.md` rules 1, 13, 16, 20, 21
