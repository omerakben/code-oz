---
name: CODEX_BRIEFING_B1A_R0
status: pending-invocation
review-round: R0 (read-only design review on the existing diff)
codex-model: gpt-5.5
codex-effort: xhigh
sandbox: read-only
date: 2026-05-12
source-design-doc: docs/design/B1A_EFFORT_FLAG.md
source-synthesis: docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md
pre-design-thread: 019e1318 (already closed; 4 load-bearing bugs caught and incorporated)
worktree: .claude/worktrees/aris-borrows-pre-m17
branch: worktree-aris-borrows-pre-m17
base-commit: 252baac (applyEffort pure transform, Commit 1 of 2)
---

# Codex R0 briefing — B1a Commit 2 (`--effort` flag wiring + active-run replay)

This is the **R0 read-only design review** on the **existing 8-file / 471-line working-tree diff** for B1a Commit 2. The diff is NOT yet committed; this review precedes the Commit 2 commit. Pre-design review (thread `019e1318`, four load-bearing bugs) already closed; this review is the post-implementation lens.

## Scope and authority

B1a adds a top-level `code-oz run --effort {lite|balanced|max|beast}` flag that scales the budget envelope at run start. Authority boundary: one new rule (`rule 23`, renumbered from rule 22 because main's rule 22 is now consumer-first/RED-first TDD). Touchlist: 9 code sub-surfaces.

**Commit 1 (already on the worktree branch, SHA `252baac`):** `src/config/effort.ts` (110 LoC) + `tests/config-effort-unit.test.ts` (381 LoC). Pure transform, 44 unit tests, no wiring.

**Commit 2 (this review's subject, working tree only):**

| File | Lines | Role |
|---|---|---|
| `CLAUDE.md` | +1 | Add rule 23 invariant text (renumbered from rule 22 per synthesis D3) |
| `docs/design/B1A_EFFORT_FLAG.md` | +26 (modifies committed file) | Renumber rule 22 → 23 throughout; add "Event order lock" subsection per synthesis step 3 |
| `docs/references/budgets.md` | +45 | New "Effort multipliers (B1a)" section |
| `src/commands/run.ts` | +187 | `--effort` arg parsing + validation + four active-run reload sites (`applyRecordedEffort`) + mismatch rejection |
| `src/state/events.ts` | +97 | `effort_envelope_applied` event-union member + runtime validator |
| `src/state/run.ts` | +82 | `initRun()` emits the envelope event between `run_started` and `phase_entered` (position 2, per event-order lock) |
| `src/state/schemas.ts` | +48 | Static event-shape schema entry |
| `tests/e2e/cli-effort-envelope.test.ts` | +375 (new) | Binary-spawn e2e: fresh run × 4 levels, active-run continuation, mismatch rejection |

## Pre-review actions taken in Session 2 (delta from initial diff)

1. **Rule 22 → 23 renumber** across 16 sites in 6 files. Working tree on `worktree-aris-borrows-pre-m17` carries the renumber; the merge to main at step 11 will conflict on `CLAUDE.md` because both main and this branch add a "rule after 21" — manual resolution will keep main's rule 22 (consumer-first) and place rule 23 (effort-flag) below it.
2. **Event order locked at position 2** (between `run_started` and `phase_entered`). The initial implementation placed it at position 3 (after `phase_entered`), but three canonical docs (CLAUDE.md rule 23 text, design doc § "Where the flag lives", budgets.md § "Effort multipliers (B1a)") all said position 2. Moved `appendEvent` block in `src/state/run.ts` and updated test assertions in `tests/e2e/cli-effort-envelope.test.ts`. New subsection "Event order lock (synthesis step 3, 2026-05-12)" added to `docs/design/B1A_EFFORT_FLAG.md`.

## Debate prompts

Per `docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md` § "Session 2 — B1a effort flag" step 4, please respond to all four:

### (a) Event order — is position 2 correct?

The lock places `effort_envelope_applied` between `run_started` and `phase_entered`. The rationale is that the envelope describes the run, not the first phase, so it should be captured at run start ahead of any phase work. The opposite ordering (after `phase_entered`) would let the first phase enter "before the run's budget envelope is recorded" — semantically weird for forensics.

Is position 2 the right call, or do you see a reason to prefer position 3? If position 3, the three canonical docs (CLAUDE.md rule 23, design doc, budgets.md) all need rewording in the same fix.

### (b) Renumber completeness — did I miss any rule-22 references?

I grepped the 6 files in the touchlist plus `CLAUDE.md` and found 16 sites. All renumbered. The remaining "rule 22" mentions in the design doc are deliberate "Renumbered from rule 22" provenance notes. Please grep the worktree for any rule-22 references I missed in files outside the touchlist (skill prompts, persona prompts, contract docs, README), and flag them as fix-soon if so.

### (c) Coupling bugs in the existing diff

I notice three latent concerns and want your independent read:

1. **"Emission is unconditional" lie.** `src/state/run.ts` docblock and inline comments say "emission is unconditional", but the actual emission is gated by `if (originalBudgets !== undefined && effectiveBudgets !== undefined)` at the move's new location (around line 293 post-move). The defaulting chain at lines 273-274 (`effectiveBudgets ?? opts.originalBudgets`, `originalBudgets ?? effectiveBudgets`) means the guard skips emission only when BOTH inputs are undefined (i.e., callers that pass no budgets at all — e.g., legacy `initRun` tests). The CLI path always supplies budgets. Should the comment be made honest, or should the guard be removed (and a synthetic balanced-envelope event be emitted even when no budgets are supplied)?

2. **`budgetsToSnapshot` JSON round-trip.** The helper at `src/state/run.ts:~127` does `JSON.parse(JSON.stringify(b))`. This drops `undefined` keys but does not preserve `Object.freeze` semantics. Loader-side budgets are frozen (per `src/config/load.ts`); after snapshot they are mutable plain objects. The event log persists JSON, so this is fine for serialization, but is there any downstream consumer that depends on the loader's freeze semantics being preserved when it reads the event back? Active-run reload sites re-run `applyEffort()` from the recorded snapshot — does that path re-freeze the result?

3. **Active-run mismatch error wording.** The four reload sites in `src/commands/run.ts` reject when `--effort` on an active run differs from the recorded value. Are all four sites consistent in error message and exit code? Is the mismatch detection symmetric (recorded=lite + passed=balanced rejects in the same way as recorded=balanced + passed=lite)?

### (d) Sub-surface split candidates

The Codex pre-design round (thread `019e1318`) approved the 9-sub-surface count for B1a. With the working-tree diff in front of you, is anything still bundled that should split into a follow-up? Concrete candidates I want you to consider rejecting or accepting:

- The "mismatch rejection on active run" sub-surface (in `src/commands/run.ts` at four sites). Could it be a separate commit landed after the core wiring? Or is it load-bearing to keep it in Commit 2 to avoid a window where active-run continuation is non-idempotent?

- The `budgets.md` "Effort multipliers (B1a)" section (45 lines, new). Doc-only; could it be a separate doc commit. But that violates `feedback_canonical_doc_precedence_chain.md` (canonical doc precedence within milestone).

- Anything else?

## How to invoke

```
mcp__plugin_agent-codex_codex-native__codex({
  model: "gpt-5.5",
  effort: "xhigh",
  sandbox: "read-only",
  cwd: "/Users/ozzy-mac/Projects/code-oz/.claude/worktrees/aris-borrows-pre-m17",
  prompt: "Read this briefing in full: docs/design/CODEX_BRIEFING_B1A_R0.md. Then read the design doc (docs/design/B1A_EFFORT_FLAG.md) and inspect the working-tree diff via `git diff` on the worktree branch. Answer all four debate prompts in CODEX_RESPONSE_B1A_R0.md format (see docs/research/CODEX_REVIEW_PE1.md or docs/comparison/03-aris/CODEX_RESPONSE.md for prior-art format). Return verdict: push / fix-first / debate-required."
})
```

## Acceptance for advancing past R0

- Codex returns one verdict: `push`, `fix-first`, or `debate-required`.
- Block-push and block-next-milestone findings get addressed in a follow-up edit (NOT amending Commit 1; Commit 2 hasn't landed yet, so changes go to working tree).
- Nits/fyis may defer to R1 or beyond.
- After R0 closes: commit working tree as Commit 2, run targeted tests + full suite, invoke R1.
