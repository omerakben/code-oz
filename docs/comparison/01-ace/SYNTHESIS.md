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

**Authority added:** stable on-disk shape and read-side retrieval for `./.code-oz/lessons/*.md`. One authority, four sub-surfaces (storage contract, event-type addition, read-path API, ID-generation) tracked explicitly per the M16 C9 lesson on counting sub-surfaces.

**Sub-surface accounting (per rule 20 sharper application):**

1. **S1 storage contract** — lesson entry markdown format on disk.
2. **S2 event-type addition** — `lesson_consumed` event in `events.jsonl`.
3. **S3 read-path API** — retrieval API surface consumed by phase prompts.
4. **S4 ID-generation** — content-hash-derived IDs, collision detection, warm-start seed.

Each sub-surface has a distinct rollback shape and ships with its own acceptance test. M17 stays one authority because S1-S4 are *all aspects of read substrate*; no LLM mutator authority is introduced. If any sub-surface needs to be deferred, it splits cleanly to a follow-up milestone without touching the others.

**In scope:**
- (S1) Lesson entry markdown format with frontmatter and bullet-shape body. Bullet line: `[<slug>-<5digit>] helpful=N harmful=M :: <content>` (counters are display-only in this milestone, set to 0 at write time).
- (S1) **Strict parser.** Full-line anchored grammar: slug must exist in the explicit mapping table, suffix is exactly five digits, counters are nonnegative integers, content after `::` is non-empty. Do not mirror ACE's permissive `parse_playbook_line` at `playbook_utils.py:23-46`, which accepts empty content via regex.
- (S1) Parser failures produce `NEEDS_INTERVENTION.json` per rule 11; no silent skip.
- (S1) Section header → slug mapping table lives in `src/memory/section-slugs.ts` as a frozen TypeScript const. Adding a new section is a code change + migration script + doctor validation that no existing lesson IDs reference the new slug. The slug is never derived from initials at runtime. (ACE's `STRATEGIES & INSIGHTS` section falls through to a "first letters of words" branch in `utils.py:55-77` and produces slug `sai` — code-oz rejects that drift.)
- (S2) New event type `lesson_consumed` in `events.jsonl` with fields: lesson ID, entry SHA, phase, agent, run ID, task ID. **No content snippets, no question snippets, no context snippets.** The event-type forward-compat path at `docs/references/file-based-gates.md:240` (the Open-type-union rule) makes this additive without a version bump.
- (S3) Read-only retrieval API consumed by phase prompts (initial readers: REVIEW, BUILD).
- (S4) Stable lesson ID generation. IDs derive from a content hash + collision-checked seed at boot. Never reset to 1 on warm-start (the ACE bug at `ace/ace.py:86-93`).
- Doctor check: `code-oz doctor memory` validates that `lesson_consumed` events contain only `{ lessonId, entrySha, phase, agent, runId, taskId }` and rejects any privacy-leaking field (rule 13).
- Rule 19: `lesson_consumed` events ride existing `events.jsonl` telemetry. No new budget namespace at M17; the new namespace `memory.maxStoredTokens` arrives in M20.
- Rule 21: does not apply at M17. Reviewer Memory is a sequential memory layer, not a parallel-provider surface. Rule 21 re-engages only if M20+ introduces competing memory updaters or curation panels.

**Out of scope:** any LLM mutator, any UPDATE/MERGE/DELETE behavior, any helpful/harmful counter derivation, any compaction, any embedding work.

**Gate exit:**
- Validator round-trips a fixture lesson (S1).
- **Warm-start collision test:** load a fixture lesson with ID `<slug>-00042`, add a new entry, verify the new ID is `<slug>-00043` or higher, never `<slug>-00001` (S4 against the ACE bug).
- Offline test exercises the read path through a phase prompt (S3).
- `lesson_consumed` events appear in `events.jsonl` for a fake-provider run (S2).
- Doctor check fails when seeded with a privacy-leaking event fixture.

### M18 — Memory mutation authority

**Authority added:** deterministic ADD-only applier and the JSON op schema.

**In scope:**
- Op schema: `{type: "ADD", section, content}` with strict validation. `UPDATE`, `MERGE`, `DELETE`, `CREATE_META` are NOT accepted; the applier rejects them with `op_not_supported` (an explicit failure, not a silent skip). ACE's validator at `ace/core/curator.py:210-215` warns on unknown types and then silently drops them — code-oz must reject loudly. Reserving the future operation names in the schema documentation is allowed; *implementing* them is a later milestone.
- **Forward-compat rule:** the op-type field is a closed enum in M18 (only `ADD`). When a future milestone ships UPDATE/MERGE/DELETE, that milestone bumps the op-schema version and updates the M18 applier's enum together. M19 and M20 callers MUST query the applier's capability surface, never assume the op set.
- Deterministic applier (`applyMemoryOperations`) that takes the current lesson file + ops and returns the updated file. Pure function, network-free, fully tested with `FakeProvider`.
- Cross-family rule (rule 2): if an LLM proposes ops based on Builder output, the proposer must be a different provider family from Builder. The applier itself has no family.
- Mutator parse failures and `op_not_supported` rejections produce `NEEDS_INTERVENTION.json`. No silent skip (rule 11).
- Empty/sentinel LLM response from the proposer (ACE's `INCORRECT_DUE_TO_EMPTY_RESPONSE` path at `curator.py:109-113`) also produces `NEEDS_INTERVENTION.json`. Both silent-skip paths ACE has are closed.
- Universal anti-slop rules imported from `src/prompts/universal-rules.md` into the proposer system prompt (rule 16).
- **Scientist tail (rule 15):** after the applier writes the updated lesson file, M18 emits `HYPOTHESES.md` and `OPEN_QUESTIONS.md` sidecars under `./.code-oz/scientist/memory-mutation/` recording which ops were load-bearing and what open questions remain. The mutated lesson file is a primary artifact; rule 15 applies.

**Out of scope:** UPDATE/MERGE/DELETE/CREATE_META applier logic, attribution, compaction, dedup.

**Gate exit:** offline tests show ADD-only round-trip; UPDATE/MERGE/DELETE/CREATE_META rejected as `op_not_supported`; both ACE silent-skip paths produce `NEEDS_INTERVENTION.json`; cross-family check enforced at runtime; Scientist sidecars present after a fake-provider mutation run.

### M19 — Outcome attribution (helpful only, derived)

**Authority added:** the rule that lesson outcomes are derived from `events.jsonl`, never stored as authoritative counters. **v0.1 ships helpful-attribution only.** Harmful-attribution is deferred until the citation-tracking infrastructure exists.

**Why helpful-only:** the memory-poisoning failure mode the architect raised in Round 2 is real. A malicious or sloppy entry can cause BUILD to succeed quickly and produce a worse artifact that humans only catch post-deploy; M19 would see the success events and incorrectly credit the entry. Codex's "harmful only if explicitly cited by a Reviewer in a `review_blocked` artifact" rule would require ReviewArtifact and NEEDS_INTERVENTION to carry cited lesson IDs — an undeclared schema change that bundles authority into M19 (rule 20 violation). The clean split: ship helpful-derivation now, defer harmful-derivation to a milestone that ships the citation infrastructure too.

**In scope:**
- Derivation function (helpful only): given a lesson ID, scan `events.jsonl` for `lesson_consumed` followed by a phase-level success signal (`gate_written` plus matching `phase_exited` with `outcome: "passed"`) or a task-level success signal (`task_completed`) in the same run/task scope, with no later `intervention` event and no active `NEEDS_INTERVENTION.json` control file in that same scope. Project to `(loaded, succeeded)` pairs. Event-type literals match `docs/references/file-based-gates.md:153-161` (the canonical event registry).
- Conservative attribution: a lesson is "helpful" only if it was consumed in a run/task that reached the success signal AND did not produce an `intervention` event at any later phase in the same scope. Run-level VERIFY pass alone is not sufficient evidence.
- Harmful-attribution is OUT OF SCOPE for M19. Manual override path: `code-oz doctor memory flag-harmful <lesson-id> --reason "..."` writes a manual override event to `events.jsonl`. Doctor-flagged entries are excluded from retrieval until a follow-up milestone ships derived harmful-attribution + citation tracking.
- Derivation is read-time. No materialized counters in M19. If counters are added later as a cache, they must carry `derivedFromEventSeq` and `doctor` must fail on drift. (Drift detection is the discipline ACE skips: its `update_bullet_counts` at `playbook_utils.py:50-93` mutates the playbook in place with no checksum, no event entry, and no drift check.)
- `no_ground_truth` mode: VERIFY/REVIEW outcomes are the environment signal. The mode name is borrowed from ACE for legibility; the actual semantics are different (ACE still calls `answer_is_correct(final_answer, target)` regardless of the flag; code-oz has no ground truth and relies entirely on terminal phase results).
- **`memoryStats` projection:** a derived read-only summary `{ total, unused, withHelpfulSignal, byMappedSection }` computed from `events.jsonl` on demand. **Reject ACE's hardcoded thresholds** (`high_performing: helpful>5 && harmful<2`, `problematic: harmful>=helpful` at `playbook_utils.py:240-244`) as authoritative policy; if code-oz needs thresholds later, they live in config, not in derived projections.
- Doctor privacy check (continued from M17): `code-oz doctor memory` verifies no `lesson_consumed` event carries privacy-leaking fields. M19 makes this check load-bearing because its derivation function would silently consume leaked content if a regression slipped in.
- Cross-check before tagging: ACE's `eval/<task>/data_processor.py` is the load-bearing correctness-signal extension point. Confirm no `eval/*` pattern uses a richer signal than "phase-success without a later `intervention` event" that code-oz would want to mirror.

**Out of scope:** harmful-attribution derivation, mutators that act on the counters, compaction, dedup, the citation-tracking infrastructure for ReviewArtifact / NEEDS_INTERVENTION.

**Gate exit:** derivation function tested against fixtures with seeded `events.jsonl` traces; helpful-attribution verified against the conservative rule; `memoryStats` projection produces stable output for a known fixture; doctor privacy check fails when seeded with a privacy-leaking event.

### M20 — Curation budget and compaction-proposal authority

**Authority added:** stored-memory size budget + deterministic compaction-proposal generator. **M20 emits proposals only; applying approved destructive ops is M21 work that extends M18's mutator.** This keeps M20 one authority (compaction proposal policy) by separating it from the M18-extension authority (destructive op runtime).

**In scope:**
- Config schema: `memory.maxStoredTokens` (default 80000, ACE's number is sane) under a new `memory.*` config namespace. Provider-call spend continues to ride `budgets.global.maxTokensEstimate` per rule 19 — the new namespace is for stored-content size only.
- Compactor that runs on demand or at gate boundaries; walks `./.code-oz/lessons/*.md`, identifies merge or delete candidates when within 0.9 of `memory.maxStoredTokens`.
- Compactor produces a proposed merge/delete plan in `NEEDS_INTERVENTION.json` for human approval. **The compactor never applies destructive ops.** Approval routes through M21 (or a later M18 extension that adds MERGE/DELETE to the applier with the schema-version bump M18 reserves for).
- String/tag similarity dedup as the first compaction strategy. **Deterministic only, no LLM voting.** ACE's `BulletpointAnalyzer` LLM-merge step is rejected for v0.1.
- Embedding-based dedup deferred until the string compactor produces a measurable false-negative rate. When added, it ships behind a local feature check or optional package, not a provider capability (rejected per Codex Q5).
- Rule 21 explicit: does NOT apply at M20. Compaction proposals are deterministic; no parallel-provider surface. Rule 21 re-engages only if a future milestone adds LLM-based merge voting or multi-curator panels.

**Out of scope:** automatic destructive merges, applying approved ops (M21), LLM-based merge voting, embedding dedup, multi-curator votes, parallel-provider memory updaters.

**Gate exit:** compactor exercised on a synthetic lesson set above the budget; merge/delete proposals surface through the intervention path; no destructive op fires without human approval routing through the M21 (or M18-extension) applier; offline tests pass.

## Risks carried forward

Logged here so the canonical doc carries them, not only the captured Codex response.

1. **Scope creep masked as "substrate"** (R1, original). If a future implementer ships format + mutator + usage log + counters + prompt updater under one milestone label, it repeats the M7 / M16-C9 sub-surface bundling failure. The sub-surface accounting in M17 (S1-S4) is the discipline that prevents this; M18-M21 must inherit the same accounting.
2. **Memory poisoning** (R1, R2 architect). Run-level VERIFY/REVIEW success is not bullet-level causality. M19 ships helpful-attribution only; harmful-attribution waits for citation-tracking infrastructure. Until that ships, doctor-flagged entries are the only "this lesson is wrong" signal.
3. **Audit / privacy regression** (R1). ACE's usage-log shape stores content snippets and context excerpts. code-oz's `lesson_consumed` event is ID + SHA only. A regression that adds content fields would silently propagate through M19's derivation. Doctor check (M17 in-scope, M19 load-bearing) is the guard.
4. **Parser / slug drift** (R2 Codex). Permissive parsing can create lesson IDs that M19's derivation cannot attribute cleanly. The strict full-line-anchored grammar + explicit section→slug mapping at `src/memory/section-slugs.ts` is the guard. Doctor validates the mapping at boot.
5. **Attribution signal mismatch** (R2 Codex). Terminal phase events may be too coarse for lesson-level causality. Without a pinned event-shape contract for `lesson_consumed` (`docs/contracts/REVIEWER_MEMORY.md`, see CONTRACTS_NEEDED.md), M19's derivation will inherit whatever shape M17 happened to ship. The contract file is M17 work, not a future cleanup.
6. **Compaction approval deadlock** (R2 Codex). Over-budget memory plus human-approved-merge proposals can repeatedly pause runs if the user does not respond. M20 must define a "soft denial" path: when `memory.maxStoredTokens` is exceeded and no human approval has come within N hours, M20 stops emitting new compaction proposals and instead disables ADD-only writes until the user clears the intervention. This converts a deadlock into a stop, not a stall.

## Corrections to COMPARISON.md

The original COMPARISON.md is preserved as the paper trail. Three specific lines need to be read with this synthesis as overlay:

- Paragraph 1 ("Generator → Reflector → Curator … delta operations (ADD, UPDATE, MERGE, DELETE, CREATE_META)"): only `ADD` is implemented in the published source. The other ops are aspirational. (`playbook_utils.py:100-104, 130-141`; `prompts/curator.py:49-53`.)
- Section "What ACE has that code-oz lacks" item A2 ("Delta operations over rewrite-the-context"): the *invariant* (never rewrite the whole context) is real and worth borrowing; the operation set is not. Read this item as supporting B2's invariant only.
- Section "What ACE has that code-oz lacks" item A7 ("Self-supervised mode `no_ground_truth`"): ACE still computes correctness via `data_processor.answer_is_correct`. The mode hides ground truth from the reflector prompt; it does not eliminate it. code-oz running off VERIFY/REVIEW is genuinely noisier.
- Open question Q1 stale wording ("bullet format + delta operations + helpful/harmful counters"): the actual M17 scope per the briefing was B1+B2+B3 (bullet format + delta operations + bullet usage log). The synthesis above splits all of these across M17-M20.

## Verdict on the comparison series itself

Codex called this exercise a good use of pre-finalization time *if it stays selective and decision-forcing*. This session cleared that bar: the original M17 scope would have repeated the M7 rule-20 failure pattern (bundled authorities) and would have inherited an overstatement of ACE's actual delta runtime. Catching both before code lands is cheaper than catching them in review.

The discipline going forward: one template per session, read source not just README, end with accept / defer / reject borrows, and stop the series the moment it stops changing near-term milestones. Do not turn `docs/comparison/` into a museum.
