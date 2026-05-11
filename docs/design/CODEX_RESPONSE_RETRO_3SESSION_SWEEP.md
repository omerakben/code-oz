---
session: Retrospective — full 3-session + demo sweep
phase: retro response (read-only, gpt-5.5 xhigh)
thread: 019e188a-fecc-75a3-9a50-3858dfad6432
verdict: fix-first
date: 2026-05-12
briefing: docs/design/CODEX_BRIEFING_RETRO_3SESSION_SWEEP.md
---

# Codex retrospective response — 3-session + demo sweep

## Verdict

**`fix-first`.** Three `block-tag` findings, two `block-next-comparison`, one `fix-soon`, one `nit`. Close the block-tag set before `v0.19.0-alpha.0`.

## Findings

### block-tag #1 — Demo mutation evidence overclaims real test execution

The committed demo VERIFY.md (`docs/demo/01-todo-cli/output/balanced/artifacts/VERIFY.md:13,35`) says "reverted code failed the new tests," but the actual validation command is `test -f src/todo.ts`. The README discloses `bun test` is not run.

This is not just demo prose — the note string comes from `src/phases/verify-mutation.ts:186,191`. The production code hardcodes "new tests" regardless of what the actual validation command is. **The production string is wrong for any cycle where the validation command isn't a test.**

**Fix decision (chosen):** change the production strings to be neutral ("reverted code failed the validation command (exit X !== expected Y); mutation gate satisfied" and the parallel "passed" string). Regenerate the demo captures. The change is honest for `bun test`, `pytest`, `cargo test`, and demo file-existence-check commands alike.

Alternative considered + rejected: change demo validation to `bun test`. Requires extra project setup (package.json), introduces external test-runner failure modes into the demo cycle, and doesn't fix the underlying production prose bug.

### block-tag #2 — Asciicast not committed

`docs/demo/01-todo-cli/cast.cast` is not on disk. The locked synthesis (`docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md:183,191`) orders "Record asciicast" before README/retro/tag.

`asciinema` is not installed on the host. Two paths:
- Install asciinema + record + commit.
- Amend the synthesis scope to "Markdown-first; asciicast as v0.19.x follow-up."

**Fix decision:** surface to Ozzy as an explicit choice. The README walkthrough is self-contained without the cast (all artifacts committed under `output/`); recording can ship as a follow-up tag without delaying v0.19.0-alpha.0.

### block-tag #3 — Canonical status docs not release-clean

- `CLAUDE.md:9` still says 3244 tests; `README.md:7` says 3299. Truth is 3299.
- `README.md:20` says "22 template-comparison borrows landed" — conflates the 22-template comparison series with the 12 substantive borrows the series produced. Two different counts.

**Fix decision:** harmonize. Update `CLAUDE.md` Status block to reflect 3299 tests + v0.18 shipped state (it currently is anchored at v0.18 but the prose is partly v0.17-era). Rewrite the README "22 template-comparison borrows" line to distinguish "22-template comparison sweep" from "12 substantive borrows landed."

### block-next-comparison #4 — Comparison index routing debt

Duplicate numeric prefixes (`06`, `07`, `08`, `11`) and split between `docs/comparison/` (singular) and `docs/comparisons/` (plural) per `docs/comparison/README.md:39,48,62`. Survivable for v0.19; not a clean substrate for the next comparison wave.

**Fix decision:** defer to the next comparison-prep session. Explicitly noted in the Session 3 handoff's "deferred items" section so the next sweep boots aware.

### block-next-comparison #5 — Session 3 memory hygiene incomplete

The Session 3 handoff (`docs/handoffs/2026-05-12-session-3-opencode-triage.md:107`) names a memory candidate about stashes on stale bases but no `feedback_stash_on_stale_base.md` (or similar) lives in `~/.claude/projects/.../memory/`.

**Fix decision:** add the memory entry. Per locked synthesis "Cross-session invariants" line: "Memory entries written per session for surprises, validated approaches, and any rule-tension findings."

### fix-soon #6 — Cross-family REVIEW headline wording

`docs/demo/01-todo-cli/README.md:63,145` and `README.md:61` describe BUILD on Claude family / REVIEW on Codex family. Both routes are FakeProvider scripts; the cross-family check is real but the family labels come from registry routing, not live Anthropic/Codex API calls. The "What's real and what's simulated" table discloses this at the bottom but the headline doesn't.

**Fix decision:** add a one-line disclosure to the cross-family highlight section: "These family labels come from the registry route — both invocations execute through FakeProvider scripts, so the cross-family check is real but the LLM responses are scripted."

### nit #7 — Runner architecture doc stale against implementation

`scripts/demo/01-todo-cli/ARCHITECTURE.md:20,136,220` still describes `Validation: true`, a no-op verifier, and `lite ~0.5`. Implementation uses `test -f src/todo.ts` and `lite = 0.4`.

**Fix decision:** update ARCHITECTURE.md to match the shipped runner. Mark explicit "as-built" updates at the relevant sections.

## Answers to specific questions (in briefing order)

1. **Comparison series cadence.** Mostly calibrated. B1a deserved pre-design + R0 + R1 + R2 (runtime state + event replay + budget semantics). Session 3 single R-merge was right for docs-only merge. Next process fix is index/memory cleanup, not more Codex rounds.
2. **Demo over-promises.** Overclaim is in the mutation artifact wording (block-tag #1) and the missing cast (block-tag #2), not in `--effort` framing. The effort wording is crisp.
3. **Runner architecture risks.** Acceptable for v0.19. Independent from the e2e helper; parser coupling is intentional. `--real-validation` flag is useful later, not required for the tag.
4. **Tag readiness.** Single release-bump commit touching all current version surfaces: `package.json`, `src/cli.ts`, `src/config/schema.ts`, `tests/m5-fix-first.test.ts`, `tests/cli-init.test.ts`, `tests/smoke-test.test.ts`. A canonical `src/version.ts` is worth doing soon but not in the tag commit (would force another review cycle).
5. **Anything missed.** Beyond the findings above, no CLAUDE.md rule violations or synthesis drift.

## Validation Codex ran

`git log --oneline e64e4ff..HEAD`, file reads, committed demo artifacts, event JSONL, docs cross-checks. Read-only sandbox — no test runs.

## Triage summary

| # | Severity | Status | Action |
|---|---|---|---|
| 1 | block-tag | will fix | Change `src/phases/verify-mutation.ts:186,191` strings; regenerate demo captures. |
| 2 | block-tag | needs Ozzy decision | Install + record asciicast OR amend scope to "Markdown-first, asciicast follow-up". |
| 3 | block-tag | will fix | Update CLAUDE.md status + harmonize README borrow wording. |
| 4 | block-next-comparison | defer | Surface in handoff; next comparison-prep session does the rename. |
| 5 | block-next-comparison | will fix | Add `feedback_stash_on_stale_base.md` memory entry. |
| 6 | fix-soon | will fix | One-line disclosure on cross-family highlight. |
| 7 | nit | will fix | Update `ARCHITECTURE.md` to match shipped runner. |
