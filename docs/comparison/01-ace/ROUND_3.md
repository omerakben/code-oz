---
name: round-3-final-sweep
companion-docs: ROUND_1.md, ROUND_2.md, SYNTHESIS.md, CONTRACTS_NEEDED.md, CLOSE_OUT.md
target: log of Round 3 (Opus pr-review-toolkit + Codex fresh thread) and the Round 4 Codex confirmation pass
status: closed
date: 2026-05-10
opus-reviewer: Opus pr-review-toolkit code-reviewer subagent (agent ID `a2528ef755ecd046c`)
codex-thread-r3: 019e132c-fb66-7243-8070-d22b3308d940 (fresh thread, "final sweep" lens)
codex-thread-r4: 019e1409-3519-76f1-8013-d0f28a5aad27 (fresh thread, "Round 4 confirmation")
---

# Round 3 — final sweep, plus Round 4 convergence confirmation

## Severity tally (combined Round 3, deduplicated)

- block-push: 0
- fix-before-merge: 1 (Codex, M19 event-name mismatch against canonical registry)
- fix-soon: 4 (Opus reviewer, 3 citation + 1 em-dash style)
- nit: 3 (Opus reviewer em-dash + meta)

## Findings applied

### Codex Round 3 (thread `019e132c`)

| # | Severity | Title | Resolution |
|---|---|---|---|
| R3C-1 | fix-before-merge | M19 derivation function referenced `gate_passed` events and `NEEDS_INTERVENTION` events; canonical code-oz registry uses `gate_written` + `phase_exited` with `outcome: "passed"`, plus task-level `task_completed`, and event-type `intervention` (the NEEDS_INTERVENTION.json is a control file, not an event). | M19 derivation updated in `SYNTHESIS.md:109` and `CONTRACTS_NEEDED.md:25` with the canonical event-type literals. L1/L2/L3 lenses otherwise clean. |

Codex's L1 lens (did Round 2 over-correct) confirmed no over-corrections. M18 closed-enum + capability query is coherent. M19 helpful-only does not orphan a required harmful-attribution path because the manual doctor override covers v0.1 exclusion. M20 proposals-only is useful as human-review intervention output, not dead weight. L2 (missed ACE features) confirmed the borrow set is complete: ACE's `bullet_ids` analog maps to B3, lazy embedding load is implicit in deferred optional dedup, and `best_playbook` is benchmark validation bookkeeping rather than a code-oz lesson-snapshot pattern. L3 (staged-deferred files self-contained) confirmed.

### Opus pr-review-toolkit reviewer Round 3 (agent `a2528ef755ecd046c`)

| # | Severity | Title | Resolution |
|---|---|---|---|
| R3O-F1 | fix-soon | `parse_playbook_line` cited at `playbook_utils.py:23-46`; function actually at lines 13-27 (def line 13, returns line 27). The 23-46 range covered the tail of `parse_playbook_line` plus all of `get_next_global_id` plus the start of `format_playbook_line`. | `SYNTHESIS.md:65` and `CONTRACTS_NEEDED.md:20` updated to cite `playbook_utils.py:13-27`. The factual claim about ACE permissiveness is unchanged and verified correct. |
| R3O-F2 | fix-soon | M19 derivation claimed all four event-type literals (`lesson_consumed`, `gate_written`, `phase_exited`, `intervention`, `task_completed`) matched the v0.1 registry at `file-based-gates.md:153-161`. `task_completed` is not in that block; it lives in `src/state/run.ts:454+` and lands additively under the open-type-union rule at line 240. | `SYNTHESIS.md:109` and `CONTRACTS_NEEDED.md:25` updated to split the citations: registry block at 153-161 for the four registry types, and the post-M7 `src/state/run.ts:454+` location for `task_completed` with explicit reference to the open-type-union rule at 240. |
| R3O-F3 | fix-soon | `CONTRACTS_NEEDED.md:51` (C3) instructed M17 implementer to add `lesson_consumed` "to the recognized types list at line 240." Line 240 is the Open-type-union rule (prose); the recognized-types list is the JSON block at lines 153-161. An implementer following this literally would have added the new literal at the wrong location. | `CONTRACTS_NEEDED.md:51` updated to point at the JSON literal block at 153-161 for the additive type, with a separate update to the line-240 prose to list the new type in the "Recognized types" sentence. |
| R3O-F4 | fix-soon | `COMPARISON.md:17` paragraph 1 has two em-dashes ("only implements `ADD` — ..." and "...question itself — privacy shape..."). User's writing rule: one em-dash max per paragraph. | `COMPARISON.md:17` rewritten — second em-dash replaced with a period and a new sentence: "This is the privacy shape code-oz's `lesson_consumed` event must not replicate (rule 13)." |
| R3O-F5 | nit | `CONTRACTS_NEEDED.md:25` M19 join semantics bullet used paired em-dashes around the success-signal aside. | Rewritten with parens-and-semicolons: "fires (phase-level: `gate_written` plus matching `phase_exited` with `outcome: "passed"`; or task-level: `task_completed`)". |
| R3O-F6 | nit | `ROUND_2.md:89` "What's next" paragraph had paired em-dashes. | Replaced with parentheses. |
| R3O-F7 | nit | `CLOSE_OUT.md` status fields and convergence-table row for this very reviewer were placeholders pending this pass returning. | After R3O-F1 through R3O-F6 applied, CLOSE_OUT.md status and table row updated to reflect the Opus reviewer's verdict and the applied fixes. |

The reviewer also spot-checked 25+ other citations (`ace.py:86-93`, `playbook_utils.py:50-93`, `playbook_utils.py:96-216`, `playbook_utils.py:100-104, 130-141`, `playbook_utils.py:240-244`, `prompts/curator.py:49-53`, `curator.py:109-113`, `curator.py:145-153`, `curator.py:210-215`, `eval/finance/data_processor.py:85-124`, `utils.py:55-77`, `utils.py:202-246`, `ace/ace.py:477,542,622`, `ace/ace.py:916-964`, `bulletpoint_analyzer.py:266-291`, `logger.py:32-81`, `logger.py:108-178`, `logger.py:279`, `src/providers/capabilities.ts:57-76`, `docs/references/file-based-gates.md:240`, `docs/research/01-maestro-rule-checker.md` lines 280-330 and 300-330, `docs/research/03-prompt-optimizer-front-door.md` lines 50-58, `docs/design/ROADMAP.md` ~382) and confirmed them all correct. Internal consistency check (borrow set in SYNTHESIS.md vs. "what this does NOT recommend" list in COMPARISON.md): no contradictions detected. All cross-references point to files that exist.

## Round 4 (Codex confirmation, thread `019e1409`)

After applying the Round 3 fixes, Codex re-read SYNTHESIS M19 derivation, CONTRACTS_NEEDED C1 M19 join semantics, and CONTRACTS_NEEDED C3 placement instruction. Verdict, verbatim:

> Round 4 clean. PR-merge-ready.

That is the convergence signal both critics had to return for close-out.

## Decision shape after Round 3 + Round 4

Unchanged from Round 2. YES with selective borrows; M17-M20 sequence; 6 risks carried forward; two contract files staged; two propagations staged. All Round 3 changes were citation-level and style-level; none touched the strategic call or the milestone decomposition.

## What's next

CLOSE_OUT.md finalized. Push branch. Open PR.
