---
name: codex-response-comparison-ace
companion-docs: COMPARISON.md, CODEX_BRIEFING.md
target: cross-family peer review of the ACE comparison and the proposed Reviewer Memory v1 borrow set
status: captured verbatim from Codex (gpt-5.5, xhigh, sandbox: read-only, thread `019e12ab-fcbc-7823-8e98-4515d03d1990`)
date: 2026-05-10
---

# Codex response (verbatim)

## 1. Verdict

- The decision, YES with selective borrows for Reviewer Memory v1: `accept-with-modifications`. The strategic call is right. The modification is that ACE should be treated as an existence proof for a memory substrate, not as a mature implementation to mirror. `COMPARISON.md:15` and `COMPARISON.md:53` overstate ACE's delta runtime.
- The borrow set B1-B7: `accept-with-modifications`. Keep B1, B3, and the "no full rewrite" invariant from B2. Do not adopt authoritative helpful/harmful counters in M17. Do not use `budgets.global.memory`. Do not put embedding dedup into the M11 provider capability shape.
- The proposed M17 scope, B1+B2+B3 only: `block-soft`. It is close, but as written it crosses format contract, mutation authority, and telemetry authority. It passes rule 20 only if B2 is reduced to a schema/spec placeholder with no LLM mutator and no UPDATE/MERGE/DELETE runtime.

## 2. Q1-Q5 answers

**Q1**: No. M17 is not one authority boundary as written. The bullet format is a storage contract, delta operations are a write authority, and usage logging is an audit/telemetry surface. Rule 20 can tolerate support files inside one capability, but `COMPARISON.md:109` makes B2 "the only allowed mutation surface", which is real authority. Also ACE itself does not actually support the full op set: `ace/playbook_utils.py:100-104` marks UPDATE/MERGE/CREATE_META/DELETE as future work, `ace/playbook_utils.py:131-139` leaves them commented, and `ace/prompts/curator.py:49-53` exposes only ADD.

**Q2**: No for v1. Per-bullet counters do not pull enough weight above `events.jsonl` until there is enough volume to justify materialization. If counters are stored in lesson files, they become a second source of truth and will drift. The M17 shape should log `lesson_consumed` with lesson id, file path, entry sha, phase, agent, and run/task context. Later, a compactor can derive helpful/harmful from events. If stored counters are eventually needed, make them a generated cache with `derivedFromEventSeq` or log hash, and fail doctor checks on drift.

**Q3**: Yes. The biggest miscategorizations are ACE "delta operations" and "auditability of curation." `COMPARISON.md:46` says both systems have auditability and ACE is finer-grained, but ACE logs diffs for operations that its applier mostly does not implement. `logger.py` has branches for MERGE/UPDATE/CREATE_META, while the actual applier only ADDs. Also `COMPARISON.md:119` gives too much weight to ACE `no_ground_truth`: the source still computes correctness through `data_processor.answer_is_correct` in `ace/ace.py:492-558`; it just hides ground truth from the reflector prompt. That is not equivalent to code-oz learning from noisy test/lint/review outcomes.

**Q4**: No, the published efficiency claims mostly do not transfer. Your read is right: code-oz latency is dominated by provider calls, file manifests, repo reads, tests, type-check, lint, review loops, and human intervention points. Delta-vs-full-rewrite matters for memory compaction, not for canonical artifacts like `BUILD_REPORT.md` or `VERIFY.md`. Those artifacts should remain whole, plain Markdown handoffs; entry-level diffs belong beside memory mutation events, not as a replacement for phase artifacts.

**Q5**: No to hard dependency, and I would not put this behind `capabilities.embeddingDedup` as an M11-style capability. `src/providers/capabilities.ts:57-76` defines provider capability as auth source, eligible phases, advisory cost, and rate limits. Embedding dedup is a local runtime/install capability, not provider eligibility. Third option is best: ship deterministic tag/string similarity first, with conservative "suggest merge, do not auto-merge" behavior. Add embeddings later behind a local feature check or optional package, after the string compactor shows measurable false-negative cost.

## 3. Authority boundary check

M17 as scoped does not pass rule 20 if it includes a working mutator. Natural sequence:

- **M17**: Reviewer Memory read substrate. Stable lesson entry IDs, markdown/frontmatter format, parser/validator, read-only retrieval, and `lesson_consumed` events in `events.jsonl`. No LLM writer.
- **M18**: Memory mutation authority. Deterministic op schema and applier, probably ADD first. UPDATE/MERGE/DELETE require separate fixtures because ACE's version is not mature.
- **M19**: Outcome attribution. Derive helpful/harmful from `events.jsonl`; only then consider materialized counters.
- **M20**: Curation budget and compaction. Put provider-call spend under existing `budgets.global.maxTokensEstimate`; put stored-memory size under a separate `memory.maxStoredTokens`, not `budgets.global.memory`.

Rule 11: no silent skip for mutator parse failures. A malformed optional memory entry can be loud non-terminal only if it logs an event and doctor surfaces it. A failed memory write/update must produce `NEEDS_INTERVENTION.json`.

Rule 16: ACE prompts cannot be copied as-is. `ace/prompts/*` asks for chain-of-thought fields. code-oz should ask for a short rationale/decision summary and import `src/prompts/universal-rules.md`.

Rule 2: if an LLM proposes Reviewer Memory updates based on Builder output, it must be a different family from Builder. A deterministic applier has no family issue.

Rule 21: agreed, Reviewer Memory is sequential, not a parallel-provider surface. Rule 21 applies only if you later add competing memory updaters, panels, or multi-curator votes.

## 4. Anything I missed

- ACE has a real ID bug worth noting: `ace/ace.py:86-93` loads `initial_playbook` but still sets `next_global_id = 1`; `get_next_global_id` exists in `playbook_utils.py:29` but is not used there. Warm-start can duplicate IDs unless another path corrects it.
- ACE usage logs copy bullet content and sample snippets into `bullet_usage_log.jsonl` (`logger.py:51-75`). code-oz should log IDs and hashes, not full lesson content or repo snippets, unless an explicit debug mode is enabled.
- ACE fails open in more places than curator JSON: reflector tag parse failure just warns, and `BulletpointAnalyzer` keeps the first bullet on parse/merge failure (`bulletpoint_analyzer.py:266-291`). That is useful research ergonomics, not code-oz behavior.
- `COMPARISON.md:138` is stale against the briefing: it says Q1 is "bullet format + delta operations + helpful/harmful counters", while the actual proposed M17 scope is B1+B2+B3 with usage log.
- Credit code-oz more for open event-type forward compatibility. `docs/references/file-based-gates.md:240` already allows unknown event types to survive in `events.jsonl`, so M17 can add memory events without a schema-version bump.

## 5. Risks

1. **Scope creep masked as "substrate"**. If M17 ships format, mutator, usage log, counters, and prompt updater together, it repeats the M7 rule-20 failure pattern.
2. **Memory poisoning**. Run-level VERIFY/REVIEW success is not bullet-level causality. Bad lessons can be reinforced unless attribution stays conservative and derived.
3. **Audit/privacy regression**. ACE's usage-log style stores content snippets. In code-oz, lesson consumption should be hash/id based by default, with provider calls and memory writes visible in `events.jsonl`.

## 6. Verdict on this whole comparison exercise

This comparison series is a good use of pre-finalization time, not polishing brass on the Titanic, if it stays selective and decision-forcing. This session found a real blocker: the proposed M17 boundary is too broad, and ACE's advertised delta surface is weaker than the comparison says. That is exactly the kind of issue worth catching before code lands.

The discipline should be: one template per session, read source not just README, end with accept/defer/reject borrows, and stop once the series stops changing near-term milestones. Do not turn it into a museum catalog of every agent framework.
