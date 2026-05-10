---
name: comparison-ace
template-path: ~/Projects/agents/templates/ace
template-paper: arXiv:2510.04618 (Zhang et al., 2025) — "Agentic Context Engineering"
companion-docs: ../../research/01-maestro-rule-checker.md, ../../research/03-prompt-optimizer-front-door.md
target: borrow-decision record + Codex debate setup for ACE vs code-oz
status: superseded — read with SYNTHESIS.md as overlay (Codex pressure-test corrected three claims and split M17 into M17-M20)
decision: YES, with selective borrows; original single-M17 proposal replaced by M17-M20 sequence in SYNTHESIS.md
---

# code-oz vs ACE

> **Read this with `SYNTHESIS.md`.** Codex's response (`CODEX_RESPONSE.md`) corrected three load-bearing claims in this doc: (1) ACE's published source only implements the `ADD` delta operation; `UPDATE` / `MERGE` / `DELETE` / `CREATE_META` are TODO comments at `playbook_utils.py:100-141`; (2) ACE's `no_ground_truth` mode still computes correctness via `answer_is_correct`, just hides ground truth from the reflector prompt; (3) the M17 scope (B1+B2+B3) crosses three rule-20 authority boundaries and was split into M17 read substrate / M18 mutator / M19 attribution / M20 budget+compaction. The text below is preserved as the paper trail.

## What ACE is, in one paragraph

ACE (Agentic Context Engineering, Zhang et al., arXiv:2510.04618, 2025) is a Python research framework that turns an LLM context into an evolving structured playbook. Three roles run in a loop: **Generator** answers a question using the playbook; **Reflector** diagnoses errors and tags each used bullet `helpful`, `harmful`, or `neutral`; **Curator** mutates the playbook through delta operations whose validator permits `ADD`, `UPDATE`, `MERGE`, `DELETE`, and `CREATE_META` and does not reject unknown types, but whose published applier at `playbook_utils.py:96-216` only implements `ADD` — the other four are TODO comments at lines 100-104 and 130-141. The playbook stores bullets as `[sec-00001] helpful=4 harmful=1 :: <content>` under named sections (strategies, formulas, code snippets, common mistakes, heuristics, context clues, others). The published `bullet_usage_log.jsonl` (`logger.py:32-81`) stores full bullet content plus 500 characters of question context plus 200 characters of the question itself. This is the privacy shape code-oz's `lesson_consumed` event must not replicate (rule 13). An optional `BulletpointAnalyzer` runs sentence-transformer embeddings + FAISS to dedup near-duplicates above a similarity threshold. The published claims are +10.6% on AppWorld agent tasks and +8.6% on FiNER finance, with -82.3% latency and -75.1% rollouts vs GEPA.

## What code-oz is, restated for contrast

code-oz is a Bun + TypeScript repo-native agentic SDLC runtime. The spine is six phases (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP for greenfield, AUDIT first for brownfield) with file-based gate signals, schema-validated artifacts, cross-family adversarial review, run-level budget enforcement under `budgets.global`, multi-provider abstraction, worktree-per-run isolation, permission manifests, NEEDS_INTERVENTION on provider failures, resume semantics, and one new authority boundary per milestone. Through M16 it has shipped: provider capability contract (M11), company roster (M12), role-cost policy (M13), reviewer panel v1 (M14), debate-policy scheduler v1 (M15), production CLI completion (M16). 3108 tests pass offline.

## Domain boundary

ACE's published evaluations are narrow: financial information extraction (FiNER), structured financial data (XBRL Formula), simulated app environments (AppWorld), web navigation (Mind2Web, Mind2Web2). The unit of work is a question with a ground truth or environment feedback signal. code-oz's unit of work is a multi-file software change verified by tests on a real codebase, where there is no ground truth answer, only schema-validated artifacts and cross-family review. ACE could not run a code-oz milestone. code-oz could not run an FiNER benchmark. The systems do different things.

## Feature matrix

| Surface | ACE | code-oz | Notes |
|---|---|---|---|
| Roles | 3 (Generator, Reflector, Curator) | 6+ (BA/Lead/Builder/Verifier/Reviewer/Synthesizer + Scientist tail) | code-oz has SDLC roles; ACE has context-evolution roles. Different axes. |
| Phases | 1 loop (run → reflect → curate) | 6 phases with hard gates | code-oz's gates have no analog in ACE. |
| Cross-family review | None (single provider in published config) | Mandatory at REVIEW gate (rule 2) | ACE uses one model family for all three roles; code-oz forbids that at REVIEW. |
| Multi-provider | Provider abstraction over OpenAI-compatible (sambanova, together, openai, commonstack) | `IAgentProvider` with 4 SDK adapters + capability contract (M11) | Both have abstraction; code-oz declares capabilities and fails closed if missing. |
| Persistent learning across runs | Playbook with bullet-IDs, helpful/harmful counts, ADD-only delta applier (UPDATE/MERGE/DELETE/CREATE_META are TODO at `playbook_utils.py:100-141`), FAISS dedup | Documented in maestro 4-layer FS memory (`docs/research/01-maestro-rule-checker.md` lines 300-330); not implemented | **The gap.** code-oz has the design; ACE has the runtime (partially — only the ADD op landed in the published source). |
| Repo-aware | No (flat `context` + `question`) | Yes — `tool_use.repo_context` permission scope, file manifests, brownfield AUDIT | Different products. |
| Gate signals | None — accuracy on dataset is the signal | File-based, schema-validated `GATE_<PHASE>_PASSED.json` (rule 1) | code-oz refuses to parse LLM text for pass/fail; ACE has no concept of "pass." |
| Budgets | Playbook token budget (default 80k); per-call max_tokens | `budgets.global` with `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`, `priceTable`; soft warnings at 0.75 ratio (rule 19) | ACE's budget is content-shape; code-oz's is run-shape. Different scopes — both useful. |
| Failure handling | Skip curator op on JSON parse fail or empty/sentinel LLM response; log to `curator_failures.txt` as free-text postmortem blocks (`logger.py:279`) | `NEEDS_INTERVENTION.json` with actionable suggestion (rule 11) | ACE silently degrades through two paths (`curator.py:109-113` empty response, `curator.py:145-153` JSON parse); code-oz halts and asks. |
| Worktree isolation | None | `EnterWorktree` + per-run worktree (M7) | code-oz only. |
| Permission manifest | None | Required for any `.ts` escape-hatch execution (rule 9) | code-oz only. |
| Privacy | None documented | `.code-ozignore`, secret redaction, file-size caps, file-manifest preview (rule 13) | code-oz only. |
| Resume | None | `runId`, idempotent gate writes, `code-oz resume` (rule 12) | code-oz only. |
| Debate runtime | None | `requestDebate()` primitive (M10), reviewer panel (M14), policy scheduler (M15) | code-oz only. |
| Self-improvement loop | Yes — playbook evolves across samples | Documented (Voyager / MemSkill / Memento-Skills lineage in `03-prompt-optimizer-front-door.md`); not implemented | **Same gap.** |
| Online vs offline | Both modes documented and tested | Single mode (per-run); cross-run learning not yet built | code-oz has no "online mode" because there is no playbook to update. |
| Distribution | `uv` Python package; hard deps include `openai`, `sentence-transformers`, `faiss`, `numpy` | `bun build --compile` single-file binary; npm + Homebrew + Scoop | Different stacks. Borrowing `BulletpointAnalyzer` to Bun is a dependency-graph reshape (JS embedding port + JS ANN library), not a re-implementation; deferred to M20+ behind a feature check per SYNTHESIS B5. |
| Auditability of curation | `curator_operations_diff.jsonl` per operation, `bullet_usage_log.jsonl` per generator call (the log emits full bullet content + 500 chars of context + 200 chars of question per `logger.py:32-81` — privacy concern) | `events.jsonl` event log + per-phase artifacts | ACE's logger has diff branches for MERGE/UPDATE/CREATE_META at `logger.py:108-178` but the applier only emits ADD, so those branches are dead code. The fine grain is aspirational; code-oz's per-phase events are concrete today. |
| Embedding-based dedup | Yes (sentence-transformers `all-mpnet-base-v2` + FAISS, threshold 0.9) | None | **Specific borrow candidate.** |

## What ACE has that code-oz lacks

A1. **Bullet-shaped persistent memory format**. Playbook entries follow `[sec-00001] helpful=N harmful=M :: content`. The ID is stable, the counts are signals, the section gives a coarse retrieval index, and the content is one actionable insight. This is what the maestro discipline doc (`docs/research/01-maestro-rule-checker.md` Layer 2) describes in prose without committing to a serialization.

A2. **Delta operations over rewrite-the-context**. ACE never asks the LLM to regenerate the full playbook. The Curator emits a JSON list of `{type: "ADD" | "UPDATE" | "MERGE" | "DELETE" | "CREATE_META", section, content}`, and `playbook_utils.apply_curator_operations` deterministically applies them. This is the mechanism that prevents "context collapse" — iterative rewriting eroding details over time. code-oz currently has no analog because there is no document to mutate.

A3. **Per-bullet helpful/harmful counters as pruning signal**. The Reflector tags each bullet used by the Generator. The counters survive across runs and are available to the Curator at every step. Bullets that consistently harm get pruned; bullets that consistently help survive compaction. The maestro 4-layer memory says "Files older than 90 days that have not been referenced in the last 30 days are archived" but does not commit to a per-entry feedback signal — ACE shows what that signal looks like.

A4. **Embedding-based similarity dedup at compaction time**. `BulletpointAnalyzer` loads sentence-transformer embeddings, builds a FAISS index, finds near-duplicates above a threshold (default 0.90), and asks the LLM to merge them. This is concrete machinery for the maestro doc's "compacts memory monthly: merges entries with high tag overlap" rule. code-oz currently has no compaction code because there is nothing to compact yet.

A5. **Token-budget-aware curation**. The Curator prompt explicitly receives `token_budget`, `current_step`, `total_samples`, `playbook_stats`, and is told to keep the playbook within budget. This is a content-shape budget separate from the run-shape budgets in `budgets.global`. When the Reviewer Memory layer ships, it will need its own content budget for the same reason ACE does — to prevent unbounded growth.

A6. **Bullet usage logs as training signal**. `bullet_usage_log.jsonl` records which bullets each Generator call consumed. This is exactly the "skill outcomes" the maestro doc describes for Layer 3 (`./.codeoz/skills/<skill>/outcomes.jsonl`), but for memory entries instead of skills. Same pattern, different target. **Privacy caveat:** ACE's log also stores full bullet content, the first 500 characters of the question's context, and the first 200 characters of the question itself (`logger.py:32-81`). code-oz's borrow must log lesson ID + entry SHA only, with full content gated behind an explicit debug flag (rule 13). See `SYNTHESIS.md` finding 4.

A7. **`no_ground_truth` prompt mode**. ACE supports a flag that hides ground truth from the Reflector and Curator system prompts, encouraging the Reflector to reason from environment feedback only. **Caveat:** ACE's correctness signal is still `data_processor.answer_is_correct(final_answer, target)` at `ace/ace.py:477,542,622`, which runs regardless of the flag. ACE does not learn from noisy environment feedback; it just hides the labels from one of three prompts. code-oz running off VERIFY/REVIEW pass/fail is genuinely noisier and harder to attribute — the M19 attribution function must stay conservative (see SYNTHESIS M19 scope and finding F18).

## What code-oz has that ACE lacks

C1. **Repo-native execution**. ACE runs a flat question on a flat context. code-oz runs a multi-file change in a real git repo with worktree isolation and brownfield AUDIT.

C2. **File-based gate signals (rule 1)**. ACE has accuracy on a held-out set as its only signal. code-oz refuses to parse LLM text for pass/fail and forces every transition through schema-validated `GATE_<PHASE>_PASSED.json`.

C3. **Cross-family adversarial review (rule 2)**. ACE uses one model family for Generator, Reflector, and Curator in its published config (DeepSeek-V3.1 across all three). code-oz makes BUILD and REVIEW different families a non-negotiable rule.

C4. **3-source verification at PLAN gate (rule 3)**. spec + reference code + library docs before any code is written. ACE has nothing analogous.

C5. **Multi-provider capability contract (M11)**. Each provider declares what it can do; the contract checks at boot and refuses to start a run that needs a missing capability.

C6. **Run-level budget enforcement (rule 19)**. Cumulative spend tracked across the whole run, soft-warns at 0.75, hard-kills at 1.0, with `NEEDS_INTERVENTION` carrying the actionable suggestion.

C7. **NEEDS_INTERVENTION over silent degradation (rule 11)**. ACE has two silent-skip paths: empty/sentinel LLM response at `curator.py:109-113` and JSON parse failure at `curator.py:145-153`. Both return the unchanged playbook and log a free-text warning. code-oz writes a structured intervention artifact and stops, because silent skip is the failure mode that produced "loss of conversation history" in the post-mortems cited in `docs/research/02-llm-failure-research.md`. M18's deterministic applier acceptance criteria require both ACE paths to produce NEEDS_INTERVENTION in code-oz.

C8. **Worktree-per-run isolation (M7)**. ACE has no equivalent because it has no concept of "the workspace."

C9. **Permission manifest for `.ts` escape hatches (rule 9)**. Allowed commands, network, file roots, env vars, timeout, secret access — all required before any escape-hatch executes. ACE runs Python directly with no permission boundary.

C10. **Privacy by default (rule 13)**. `.code-ozignore`, secret redaction, file-size caps, file-manifest preview per phase. ACE has no privacy story because the data is benchmark-public.

C11. **Resume after terminal death (rule 12)**. `runId`, idempotent gate writes, `code-oz resume`. ACE has `--initial_playbook_path` for warm-start but no notion of resuming a partially-completed training run mid-step.

C12. **Debate runtime + reviewer panel + policy scheduler (M10/M14/M15)**. Three milestones of cross-provider verification machinery. ACE has none of this — it would not need it because there is one provider doing all roles.

C13. **One new authority boundary per milestone (rule 20)**. The empirical discipline that lets code-oz add capabilities without bundling bug surfaces. ACE is published as a single research drop.

C14. **Universal anti-slop rules in every persona (rule 16)**. The 20-item list (10 prohibitions + 10 affirmations) lives at `src/prompts/universal-rules.md` and is imported into every persona system prompt. ACE prompts are clean and direct but specific to the bulletpoint task; they do not encode the LLM-failure research code-oz folds in.

## Decision

**YES, with selective borrows.**

ACE is a complement, not a competitor. It solves a problem code-oz already plans for: structured, evolving, persistent learning across runs. Its runtime maps cleanly onto code-oz's documented-but-unbuilt 4-layer FS memory and Reviewer Memory roadmap. ACE could not do code-oz's job; code-oz already does what ACE does not do. ACE has shipped the bullet format, an ADD-only delta applier, helpful/harmful counters, FAISS dedup, and bullet usage logs that the maestro doc describes in prose. These are the substrate code-oz will need when Reviewer Memory v1 lands.

code-oz is more complete on SDLC machinery; ACE is more complete on cross-run-learning machinery. The two systems do different things. The gap to close is the Reviewer Memory layer, which ACE makes concrete and code-oz has only sketched.

## Borrow set, ranked

The borrows are sequenced from "lowest authority cost, highest immediate value" to "needs its own milestone."

**B1 — Bullet format for Reviewer Memory v1.** Adopt `[sec-00001] helpful=N harmful=M :: content` as the on-disk shape for `./.code-oz/lessons/*.md` entries. Cost: format spec only, no runtime change. Value: makes Layer 2 of maestro memory implementable.

**B2 — Delta operation schema (`ADD` / `UPDATE` / `MERGE` / `DELETE`).** Specify the curator JSON schema as the only allowed mutation surface for any future memory document. Forbids "regenerate the whole file" mutations. Cost: contract doc + JSON schema. Value: prevents context collapse before it can happen.

**B3 — Bullet usage log (`bullet_usage_log.jsonl`) as event-log entry type.** Add a `repo_context_consumed` or `lesson_consumed` event to `events.jsonl` whenever a memory entry is loaded into a phase prompt. Cost: one event type + emitter call sites. Value: produces the training signal for B5 without adding a new file.

**B4 — Token-budget-aware curation under `budgets.global.memory`.** Introduce `budgets.global.memory.maxTokens` (default 80k matches ACE) as a content-shape budget, parallel to the run-shape budgets. The compactor refuses to grow past the cap and prefers to MERGE / DELETE before ADD when within 0.9 of the cap. Cost: config schema + assertion in compactor. Value: matches rule 19's discipline for the new memory surface.

**B5 — Embedding-based dedup at compaction time.** Borrow ACE's `BulletpointAnalyzer` pattern (sentence-transformer embeddings + FAISS, threshold 0.90, LLM merge step) for the maestro doc's "compacts memory monthly" hygiene rule. Cost: optional dependency on `@xenova/transformers` or equivalent JS port. Value: real machinery for "merges entries with high tag overlap" instead of prose.

**B6 — Helpful/harmful counters as pruning signal in Reviewer Memory.** Per-entry counters maintained by the Reviewer when a memory entry was loaded into a prompt and the run succeeded or failed. Cost: counter increment + decrement on success/fail; pruning policy. Value: makes the Reviewer Memory self-cleaning in a way ACE has empirically validated.

**B7 — Self-supervised mode for Reviewer Memory updates (`no_ground_truth`).** When VERIFY passes, treat that as positive environment feedback for the entries used in the run; when VERIFY fails, treat that as negative feedback. Mirrors ACE's `REFLECTOR_PROMPT_NO_GT`. Cost: hook into VERIFY result; pass to Reviewer Memory updater. Value: lets the Reviewer Memory layer learn without manual labels.

## Milestone shape

The borrows form a single new authority boundary: **Reviewer Memory v1**. Per rule 20, this is one milestone. Suggested name: **M17 — Reviewer Memory v1 (bullet-format substrate)**. Scope: B1 + B2 + B3 only. Defer B4-B7 to subsequent milestones, each a single new authority boundary, gated on M17's `events.jsonl` showing the substrate is in use.

This sequence respects the empirical lesson from the M7 row (rule 20 gloss: "post-M10 sequence locked"): one authority per milestone prevents authority-creep that masks bugs.

## What this comparison does NOT recommend

- Do not import ACE's three-role decomposition (Generator/Reflector/Curator) over code-oz's six SDLC phases. ACE's three roles solve a different problem (context evolution); code-oz's phases solve software engineering. Both can coexist; one cannot replace the other.
- Do not adopt ACE's prompt style. ACE prompts are clean but specific to the bulletpoint task; code-oz's universal anti-slop rules and persona system are richer and load-bearing for the LLM-failure-research gates.
- Do not adopt ACE's silent-degradation pattern (skip on JSON parse fail, skip on empty/sentinel LLM response). Rule 11 explicitly forbids it.
- Do not migrate to Python. The Bun + native binary distribution is a key wedge for the repo-native CLI category.
- Do not reset bullet IDs to 1 on warm-start. ACE's `ace.py:86-93` always sets `next_global_id = 1` even when loading from `initial_playbook`, which collides with loaded IDs on the next ADD. code-oz lesson IDs must be content-hash-derived or seeded from the loaded state at boot (see SYNTHESIS.md finding 5).
- Do not mutate playbook content without an event-log entry. ACE's `update_bullet_counts` at `playbook_utils.py:50-93` mutates the file in place with no checksum, no event, and no drift detection. M19 derives outcome state from `events.jsonl`; if counters are ever materialized as a cache, they must carry `derivedFromEventSeq` and doctor must fail on drift.
- Do not borrow ACE's benchmark-runner surfaces: `DataProcessor` (`eval/finance/data_processor.py:85-124`) is dataset normalization plus ground-truth scoring, not a code-oz task-adapter analog; `evaluate_test_set` (`utils.py:202-246`) is benchmark parallelism with `max_workers=20`; `online_eval_frequency` (`ace/ace.py:916-964`) is sample-window batching. code-oz keeps PLAN task contracts, VERIFY runner policy, and budget/gate-boundary compaction unless later measurement justifies a scheduler.
- Do not adopt ACE's hardcoded performance thresholds (`high_performing: helpful>5 && harmful<2`, `problematic: harmful>=helpful` at `playbook_utils.py:240-244`) as authoritative pruning policy. If code-oz needs thresholds, they live in config, not derived projections.

## Open questions for Codex

These are the points where the comparison is contested or under-evidenced. The Codex briefing in `CODEX_BRIEFING.md` asks Codex to pressure-test specifically these.

1. Is "bullet format + delta operations + helpful/harmful counters" actually one authority boundary or three? If three, the milestone shape above understates the authority cost. *(Q1 wording note: this question paraphrases B1+B2+B6. The actual M17 scope sent to Codex in `CODEX_BRIEFING.md` was B1+B2+B3 (format + delta operations + usage log). Codex split it into M17-M20 in `SYNTHESIS.md` — that split is the canonical answer.)*
2. Does the helpful/harmful counter add value above and beyond a simple "loaded N times, succeeded N times" log? ACE's counters are tagged by the Reflector at the bullet level; code-oz could derive the same numbers from `events.jsonl` without a per-entry counter — is the per-entry counter pulling its weight?
3. Are there ACE features I have miscategorized as "code-oz already has this" when ACE's version is meaningfully better? Specifically: ACE's `curator_operations_diff.jsonl` is finer-grained than `events.jsonl`. Would that finer grain change any behavior?
4. The published efficiency claims (-82.3% latency vs GEPA, -91.5% latency on FiNER) — how much of that translates to a software-engineering domain where the unit of work is a multi-file change rather than a benchmark question? My instinct is that almost none of it transfers, because the per-call latency in code-oz is dominated by tool use and verification, not playbook lookup. Is that right?
5. Should B5 (embedding-based dedup) ship as a hard dependency or as an optional capability behind a `capabilities.embeddingDedup` flag? Hard dependency is simpler; optional capability lets the binary stay small for users who do not care about Reviewer Memory hygiene.
