---
name: round-1-opus-reviewer
companion-docs: COMPARISON.md, CODEX_BRIEFING.md, CODEX_RESPONSE.md, SYNTHESIS.md
target: log of Round 1 critique (Opus code-reviewer subagent) and fixes applied
status: closed
date: 2026-05-10
reviewer: Opus subagent (`code-reviewer`, agent ID `a61af991e5e656007`)
---

# Round 1 — Opus reviewer pass

## What was reviewed

The 4 ACE-comparison artifacts: `COMPARISON.md`, `CODEX_BRIEFING.md`, `CODEX_RESPONSE.md`, `SYNTHESIS.md`. Briefed against ACE source under `~/Projects/agents/templates/ace/` and the project's writing + non-negotiable rules.

## Severity tally

- block-push: 1
- fix-soon: 10
- nit: 11

## Findings applied this round

| # | Severity | Title | Resolution |
|---|---|---|---|
| F1 | block-push | `curator_failures.jsonl` is wrong (file is `.txt`) | Matrix row "Failure handling" corrected to `curator_failures.txt` with file-format note |
| F2 | fix-soon | Matrix row "delta ops" implies full set is implemented | "Persistent learning across runs" row updated to "ADD-only delta applier (UPDATE/MERGE/DELETE/CREATE_META are TODO at `playbook_utils.py:100-141`)" |
| F3 | fix-soon | Auditability row overstates ACE granularity | Cell now records that MERGE/UPDATE branches in logger are dead code; ACE's fine grain is aspirational |
| F5 | fix-soon | Q1 stale wording (B1+B2+B6 vs B1+B2+B3) | Inline italic note added to Q1 reconciling against the briefing |
| F6 | fix-soon | A6 `bullet_usage_log` privacy leak not disclosed | A6 now explicitly cites the content + 500 chars + 200 chars stored, and refers readers to SYNTHESIS finding 4 |
| F7 | fix-soon | A7 `no_ground_truth` overstated | A7 rewritten: ACE always calls `answer_is_correct(final_answer, target)` regardless of the flag |
| F8 | fix-soon | Paragraph 1 still lists 5 ops without inline correction | Paragraph 1 edited in place: "schema accepts ... published applier only implements `ADD`" |
| F9 | nit | Em-dash density on CODEX_BRIEFING.md:85 | Paired em-dashes replaced with parentheses |
| F13 | nit | Warm-start ID bug not in "what does NOT recommend" | New bullet added: "Do not reset bullet IDs to 1 on warm-start" |
| F14 | fix-soon | Rule 19 not explicit in M17 scope | M17 scope now states `lesson_consumed` events ride existing `events.jsonl` telemetry; no new budget namespace |
| F15 | nit | Rule 21 confirmation missing from SYNTHESIS | M17 scope now states rule 21 does not apply (sequential, not parallel-provider) |
| F16 | nit | Decision paragraph "ahead overall for our market category" is promotional puffery | Replaced with "code-oz is more complete on SDLC machinery; ACE is more complete on cross-run-learning machinery. The two systems do different things." |
| F18 | fix-soon | ACE `eval/*/data_processor.py` cross-check not in M19 | M19 scope now includes pre-tag cross-check against `eval/*` patterns |
| F19 | nit | C14 universal-rules path not concrete | C14 now cites `src/prompts/universal-rules.md` |
| F20 | fix-soon | C7 misses the empty-response silent-skip path | C7 now lists both paths (`curator.py:109-113` empty response, `curator.py:145-153` JSON parse); M18 acceptance criteria call out both |
| F22 | nit | Distribution row understates Python dependency cost | Notes column now records `openai`, `sentence-transformers`, `faiss`, `numpy` and the JS-port dependency-graph reshape for B5 |
| F21 | nit | ACE `update_bullet_counts` has no drift detection | M19 in-scope now cites the ACE source and asserts code-oz's drift-detection requirement; "what this does NOT recommend" also adds "Do not mutate playbook content without an event-log entry" |
| F11 | fix-soon | Section header → slug mapping must be explicit | M17 in-scope now requires an explicit mapping table and rejects runtime initial-derivation (cites ACE's `STRATEGIES & INSIGHTS → sai` drift) |

## Findings deferred

- F4 (nit) — line range `295-330` → `300-330`: applied via the "lines 300-330" replacement in F2's matrix-row edit.
- F12 (nit) — replace research-doc line numbers with anchors: deferred. The current line numbers are stable; if the lineage doc moves, this stale reference will be caught in a future grep. Not worth touching now.
- F17 (nit) — read `EXTENDING_ACE.md` for completeness: deferred. The 16k extension guide is for downstream consumers; the borrow set already covers the load-bearing surface (Generator/Reflector/Curator + applier + playbook format + logs). Reading it would be a museum-cataloging move that Codex explicitly warned against.

## Findings that turned out to be no-ops

- F10 — `Future Outlook` heading concern: confirmed false alarm. The reviewer flagged "Future Operations" appearing in a quoted source-code line; that does not count against the project's style rule for headings in our own docs.

## Decision shape after Round 1

Unchanged. YES with selective borrows; M17-M20 sequence preserved. All Round 1 corrections were claim-level and style-level; none touched the borrow set or milestone decomposition.

## What's next

Round 2: dispatch Opus `code-architect` subagent (systemic angle: contract gaps, milestone-decomposition correctness, missed angles in the broader architecture) and Codex fresh thread (new lens: "what else in ACE deserves a borrow or reject that we missed"). Run in parallel.
