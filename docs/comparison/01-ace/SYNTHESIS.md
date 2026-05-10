---
name: synthesis-comparison-ace
companion-docs: COMPARISON.md (original analysis), CODEX_BRIEFING.md (questions), CODEX_RESPONSE.md (Codex verdicts)
target: post-debate decisions and corrections from the ACE comparison
status: closed
date: 2026-05-10
decision: YES, with selective borrows; M17-M20 sequence supersedes the original single-M17 proposal
---

# Synthesis: ACE comparison, post-Codex debate

## What changed after the debate

Codex's verdict on the original M17 scope was `block-soft`. Three findings survived the round trip and force changes to the comparison:

1. **ACE does not actually implement the full delta runtime.** `playbook_utils.py:96-141` shows `apply_curator_operations` only handles `ADD`. `UPDATE`, `MERGE`, `CREATE_META`, and `DELETE` are TODO comments; the prompt at `prompts/curator.py:49-53` only exposes `ADD`. The "five operations" framing in `COMPARISON.md` paragraph 1 and the matrix overstates what the published source ships.
2. **The proposed M17 scope (B1+B2+B3) crosses three authority boundaries.** Format is a storage contract, mutation is a write authority, telemetry is an audit surface. The original framing read them as facets of one capability; that read does not survive the rule-20 stress test.
3. **`no_ground_truth` is not equivalent to noisy environment-feedback learning.** ACE still computes correctness through `data_processor.answer_is_correct` in `ace/ace.py` (per Codex; correctness gating is real even when the reflector prompt does not see ground truth). code-oz running off VERIFY/REVIEW outcomes is genuinely noisier and harder.

A fourth finding is a privacy improvement to record before any borrow lands:

4. **ACE's `bullet_usage_log.jsonl` stores full bullet content and sample snippets.** code-oz's `lesson_consumed` event must log lesson ID + entry SHA only, with full content gated behind an explicit debug flag. Privacy by default (rule 13) is not negotiable.

A fifth finding is a cautionary tale about ACE's own implementation that informs what code-oz should avoid:

5. **ACE has a warm-start ID-collision bug.** `ace.py:86-93` always sets `next_global_id = 1` even when loading from `initial_playbook`. The next `ADD` collides with whatever IDs the loaded playbook already used. code-oz's lesson IDs must be derived from a stable hash or a seed-from-loaded-state path that is verified at boot, never reset to 1.

## Revised decision

**YES, with selective borrows. Reviewer Memory is a four-milestone sequence, not one.**

The strategic call (borrow ACE's substrate ideas, keep code-oz's SDLC spine) is unchanged. The implementation cadence changes from one bundled milestone to four sequential ones, each carrying exactly one new authority boundary per rule 20.

## Borrow set, revised

| Borrow | Status | Milestone |
|---|---|---|
| B1 — Bullet format `[sec-00001] helpful=N harmful=M :: content` | Accepted; counters are display-only in M17 (derived from events, not stored truth) | M17 |
| B2 — Delta operation schema (mutation invariant: never rewrite the whole file) | Reduced to a schema/spec placeholder in M17; deterministic ADD-only applier in M18 | M17 spec, M18 runtime |
| B3 — Bullet usage log as `lesson_consumed` event in `events.jsonl` | Accepted; log lesson ID + entry SHA only (no content) | M17 |
| B4 — Token budget for memory content | Accepted with shape change: `memory.maxStoredTokens` separate from `budgets.global`; provider-call spend rides existing `maxTokensEstimate` | M20 |
| B5 — Embedding-based dedup | Deferred; ship deterministic string/tag similarity first ("suggest merge, do not auto-merge"), upgrade to embeddings only after measurable false-negative cost. Not a provider capability. | M20 (string), later (embeddings) |
| B6 — Helpful/harmful counters as authoritative truth | Rejected as authoritative storage. Derive from `events.jsonl` lazily; if materialized later, mark as cache with `derivedFromEventSeq` and fail doctor on drift | M19 derives, later cache if measured-needed |
| B7 — Self-supervised mode (`no_ground_truth`) | Accepted with caveat: VERIFY/REVIEW pass/fail is the environment signal; this is genuinely noisier than ACE's `answer_is_correct` substrate, so attribution must stay conservative | M19 |

## Milestone sequence

Each milestone introduces exactly one new authority boundary (rule 20).

### M17 — Reviewer Memory read substrate

**Authority added:** stable on-disk shape and read-side retrieval for `./.code-oz/lessons/*.md`.

**In scope:**
- Lesson entry markdown format with frontmatter and bullet-shape body. Bullet line: `[<slug>-<5digit>] helpful=N harmful=M :: <content>` (counters are display-only in this milestone, set to 0 at write time).
- Stable lesson ID generation. IDs derive from a content hash + collision-checked seed at boot. Never reset to 1 on warm-start (the ACE bug at `ace/ace.py:86-93`).
- Explicit section header → slug mapping table. Adding a new section requires updating the mapping; the slug is never derived from initials at runtime. (ACE's `STRATEGIES & INSIGHTS` section falls through to a "first letters of words" branch in `utils.py:55-77` and produces slug `sai` — a drift between the header a user reads and the slug stored in IDs. code-oz's mapping must be explicit.)
- Parser and validator. Parser failures produce `NEEDS_INTERVENTION.json` per rule 11; no silent skip.
- Read-only retrieval API consumed by phase prompts (initial readers: REVIEW, BUILD).
- New event type `lesson_consumed` in `events.jsonl` with fields: lesson ID, entry SHA, phase, agent, run/task ID. No content snippets. The event-type forward-compat path at `docs/references/file-based-gates.md:240` makes this additive.
- Rule 19: `lesson_consumed` events ride existing `events.jsonl` telemetry. No new budget namespace at M17; the new namespace `memory.maxStoredTokens` arrives in M20.
- Rule 21: does not apply at M17. Reviewer Memory is a sequential memory layer, not a parallel-provider surface. Rule 21 re-engages only if M20+ introduces competing memory updaters or curation panels.

**Out of scope:** any LLM mutator, any UPDATE/MERGE/DELETE behavior, any helpful/harmful counter derivation, any compaction, any embedding work.

**Gate exit:** validator round-trips a fixture lesson; offline test exercises the read path through a phase prompt; `lesson_consumed` events appear in `events.jsonl` for a fake-provider run.

### M18 — Memory mutation authority

**Authority added:** deterministic ADD-only applier and the JSON op schema.

**In scope:**
- Op schema: `{type: "ADD", section, content}` with strict validation. `UPDATE`, `MERGE`, `DELETE` rejected at parse. (ACE's published source only ships `ADD`; we follow the implementation, not the marketing.)
- Deterministic applier (`applyMemoryOperations`) that takes the current lesson file + ops and returns the updated file. Pure function, network-free, fully tested with `FakeProvider`.
- Cross-family rule (rule 2): if an LLM proposes ops based on Builder output, the proposer must be a different provider family from Builder. The applier itself has no family.
- Mutator parse failures produce `NEEDS_INTERVENTION.json`. No silent skip (rule 11).
- Universal anti-slop rules imported into the proposer system prompt (rule 16).

**Out of scope:** UPDATE/MERGE/DELETE, attribution, compaction, dedup.

**Gate exit:** offline tests show ADD-only round-trip; mutator failures surface as `NEEDS_INTERVENTION.json`; cross-family check enforced at runtime.

### M19 — Outcome attribution (helpful/harmful, derived)

**Authority added:** the rule that lesson outcomes are derived from `events.jsonl`, never stored as authoritative counters.

**In scope:**
- Derivation function: given a lesson ID, scan `events.jsonl` for `lesson_consumed` followed by terminal phase results (`gate_passed`, `verify_failed`, `review_blocked`). Project to `(loaded, succeeded, failed)` triples.
- Conservative attribution: a lesson is "helpful" only if it was consumed in a run that reached `gate_passed` and did not produce a `NEEDS_INTERVENTION` in any later phase; "harmful" only if explicitly cited by a Reviewer in a `review_blocked` artifact. Run-level VERIFY pass alone is not sufficient evidence (the Codex memory-poisoning risk).
- Derivation is read-time. No materialized counters in M19. If counters are added later as a cache, they must carry `derivedFromEventSeq` and `doctor` must fail on drift. (Drift detection is the discipline ACE skips: its `update_bullet_counts` at `playbook_utils.py:50-93` mutates the playbook in place with no checksum, no event entry, and no drift check.)
- `no_ground_truth` mode: VERIFY/REVIEW outcomes are the environment signal. The attribution function is the same in both modes; only the run-level signal source differs. The mode name is borrowed from ACE for legibility; the actual semantics are different (ACE still calls `answer_is_correct` regardless; code-oz has no ground truth and relies entirely on terminal phase results).
- Cross-check before tagging: ACE's `eval/<task>/data_processor.py` is the load-bearing correctness-signal extension point. Confirm no `eval/*` pattern in ACE uses a richer signal than `gate_passed && !NEEDS_INTERVENTION` that code-oz would want to mirror.

**Out of scope:** mutators that act on the counters, compaction, dedup.

**Gate exit:** derivation function tested against fixtures with seeded `events.jsonl` traces; conservative attribution verified to flag known memory-poisoning patterns.

### M20 — Curation budget and string-similarity compaction

**Authority added:** stored-memory size budget + deterministic compaction.

**In scope:**
- Config schema: `memory.maxStoredTokens` (default 80000, ACE's number is sane). Provider-call spend continues to ride `budgets.global.maxTokensEstimate` per rule 19.
- Compactor that runs on demand or at gate boundaries; walks `./.code-oz/lessons/*.md`, prefers MERGE / DELETE over ADD when within 0.9 of `memory.maxStoredTokens`. (MERGE / DELETE land here because the deterministic applier is now justified by a measured need.)
- String/tag similarity dedup as the first compaction strategy. "Suggest merge, do not auto-merge" — the compactor produces a proposed merge plan in `NEEDS_INTERVENTION.json` for human approval. No automatic destructive ops in v1.
- Embedding-based dedup deferred until the string compactor produces a measurable false-negative rate. When added, it ships behind a local feature check or optional package, not a provider capability (rejected per Codex Q5).

**Out of scope:** automatic destructive merges, multi-curator votes, parallel-provider memory updaters.

**Gate exit:** compactor exercised on a synthetic lesson set above the budget; merge proposals surface through the intervention path; offline tests pass.

## Corrections to COMPARISON.md

The original COMPARISON.md is preserved as the paper trail. Three specific lines need to be read with this synthesis as overlay:

- Paragraph 1 ("Generator → Reflector → Curator … delta operations (ADD, UPDATE, MERGE, DELETE, CREATE_META)"): only `ADD` is implemented in the published source. The other ops are aspirational. (`playbook_utils.py:100-104, 130-141`; `prompts/curator.py:49-53`.)
- Section "What ACE has that code-oz lacks" item A2 ("Delta operations over rewrite-the-context"): the *invariant* (never rewrite the whole context) is real and worth borrowing; the operation set is not. Read this item as supporting B2's invariant only.
- Section "What ACE has that code-oz lacks" item A7 ("Self-supervised mode `no_ground_truth`"): ACE still computes correctness via `data_processor.answer_is_correct`. The mode hides ground truth from the reflector prompt; it does not eliminate it. code-oz running off VERIFY/REVIEW is genuinely noisier.
- Open question Q1 stale wording ("bullet format + delta operations + helpful/harmful counters"): the actual M17 scope per the briefing was B1+B2+B3 (bullet format + delta operations + bullet usage log). The synthesis above splits all of these across M17-M20.

## Verdict on the comparison series itself

Codex called this exercise a good use of pre-finalization time *if it stays selective and decision-forcing*. This session cleared that bar: the original M17 scope would have repeated the M7 rule-20 failure pattern (bundled authorities) and would have inherited an overstatement of ACE's actual delta runtime. Catching both before code lands is cheaper than catching them in review.

The discipline going forward: one template per session, read source not just README, end with accept / defer / reject borrows, and stop the series the moment it stops changing near-term milestones. Do not turn `docs/comparison/` into a museum.
