---
name: codex-briefing-comparison-ace
companion-docs: COMPARISON.md, ../../research/01-maestro-rule-checker.md, ../../research/03-prompt-optimizer-front-door.md
target: Codex pressure-test of the ACE comparison and the proposed Reviewer Memory v1 borrow set
status: ready for `mcp__plugin_agent-codex_codex-native__codex` invocation, gpt-5.5 xhigh, sandbox: read-only
---

# Codex briefing: ACE comparison and Reviewer Memory v1 borrow set

## What you are reviewing

I have written a head-to-head comparison between code-oz (the project you have been reviewing since M2) and ACE (Agentic Context Engineering, Zhang et al., arXiv:2510.04618, 2025), a Python research framework that turns an LLM context into an evolving structured playbook through a Generator / Reflector / Curator loop.

The full comparison is in `docs/comparison/01-ace/COMPARISON.md`. The bottom line:

- code-oz is more complete on the SDLC dimension (phases, gates, debate, panel, budgets, providers, worktrees, permissions, privacy, resume).
- ACE is more complete on the cross-run learning dimension (bullet-shaped playbook, delta operations, helpful/harmful counters, FAISS dedup, bullet usage logs).
- code-oz's roadmap docs (maestro 4-layer FS memory, prompt-optimizer-front-door) describe a Reviewer Memory layer in prose but the runtime is not built.
- The proposed borrow set is **Reviewer Memory v1**: one new milestone (suggested M17) that adopts ACE's bullet format + delta operations + bullet usage log as the on-disk substrate for `./.code-oz/lessons/*.md`. Embedding dedup, helpful/harmful counters, token-budget-aware curation, and self-supervised updates are deferred to subsequent milestones, each a single new authority boundary per rule 20.

## Constraints to respect when evaluating

- **Rule 20 (one new authority per milestone):** A milestone may introduce exactly one new gate or capability domain. A naïve "import all of ACE at once" would blow this rule. Tell me if my decomposition into M17 (bullet format + delta operations + usage log) and later milestones is actually one boundary or several.
- **Rule 19 (run-level budget enforcement):** Any new mutator must be visible in `events.jsonl` and respect cumulative caps. The proposed `budgets.global.memory` is a content-shape budget parallel to the existing run-shape budgets. Tell me if that is the right shape or if memory budgets should ride the existing `maxTokensEstimate` cumulative cap.
- **Rule 11 (NEEDS_INTERVENTION over silent failure):** ACE skips Curator operations on JSON parse failure and prints a warning. code-oz must not import that pattern. Confirm or push back: is there any case where silent skip in the Reviewer Memory layer is acceptable, or must every parse failure write `NEEDS_INTERVENTION.json`?
- **Rule 16 (universal anti-slop in every persona):** ACE prompts are clean but task-specific. The Reviewer Memory mutator prompts must import `src/prompts/universal-rules.md` like every other persona. Tell me if this changes anything about the borrow set.
- **Cross-family review (rule 2):** ACE uses one model family (DeepSeek-V3.1) for Generator, Reflector, and Curator. The Reviewer Memory mutator in code-oz must follow rule 2: if the Builder used family X, the Reviewer Memory updater (which is the moral equivalent of ACE's Curator) must use a different family. Confirm or push back.
- **No new parallel-provider surface without measurable risk-reduction (rule 21):** Reviewer Memory is not a parallel-provider surface — it is a sequential memory layer. So rule 21 should not apply. Confirm.

## The five open questions from COMPARISON.md

These are the points where the comparison is contested or under-evidenced. Please treat each as a separate question and answer with a yes / no / unsure plus a one-paragraph reason.

### Q1. Is the M17 scope (bullet format + delta operations + bullet usage log) actually one authority boundary, or three?

My read: one boundary, because all three are facets of "the on-disk shape and mutation surface for Reviewer Memory entries" and they are useless apart. You cannot have delta operations without a format to mutate, you cannot have a usage log without a bullet ID to reference, and you cannot have a bullet ID without a format. But I have been wrong before about authority decomposition (the empirical M7 row bundled five authorities that should have been split).

Counter-read I want you to consider: the bullet format is a contract surface; delta operations are a mutator runtime; the usage log is a telemetry surface. Three different surfaces, three different review trails, three different rollback shapes. Under that read, M17 should ship the format only, M18 ships the mutator, M19 ships the usage log.

Pick a side and tell me which.

### Q2. Do per-bullet helpful/harmful counters pull their weight above a derived count from `events.jsonl`?

My read: weakly yes, because the counters are read at write time by the Curator (deciding ADD vs MERGE vs DELETE) and reading from `events.jsonl` per write would require a scan that is more expensive than a stored counter. But the marginal value over "loaded N times, run succeeded M times" derived from events is small until the Reviewer Memory has thousands of entries.

Counter-read: code-oz could project the counters lazily from `events.jsonl` on demand and never store them, which avoids the "counter drift vs source-of-truth events" failure mode that bit other systems. The cost is a O(events) scan at compaction time, which is bounded by the run-level budget and probably amortizes to negligible.

Pick a side. If "store the counters," tell me how to keep them in sync with `events.jsonl` without a second source of truth.

### Q3. Have I miscategorized any ACE feature as "code-oz already has this"?

My read: code-oz's `events.jsonl` is finer-grained at the phase level (one event per provider call, gate write, NEEDS_INTERVENTION) but ACE's `curator_operations_diff.jsonl` is finer-grained at the entry level (one diff per bullet ADD / UPDATE / MERGE / DELETE). When Reviewer Memory ships, code-oz will need entry-level diffs too. So this is not "code-oz already has this" — it is "code-oz has nothing analogous because there is no entry to diff yet."

Pressure-test: are there other ACE features where I have made the same mistake — declaring "code-oz has it" because the moral equivalent exists at a different granularity, when actually the entry-level granularity is the load-bearing one?

### Q4. Do ACE's published efficiency claims (-82.3% latency vs GEPA, -91.5% latency on FiNER) transfer to code-oz's domain?

My read: almost none of it transfers, because per-call latency in code-oz is dominated by tool use, file reads, verification (tests, type-check, lint), and provider round-trips, not playbook lookup. ACE's efficiency claims compare against retrain-the-context approaches that re-emit the entire context per sample; code-oz's six-phase spine is already not doing that. So the latency and rollout savings of "delta operations vs full rewrite" land mostly on the Reviewer Memory layer itself, where they matter much less because the layer is touched O(1) per phase, not per sample.

Pressure-test: am I underestimating how much "delta vs full rewrite" matters in any code-oz surface — for example, the BUILD_REPORT.md or VERIFY.md artifacts, which today are written whole each run and could in principle be deltas across resume cycles?

### Q5. Should embedding-based dedup (B5) ship as a hard dependency or as an optional capability behind a `capabilities.embeddingDedup` flag?

My read: optional capability is the right shape, because the embedding library (sentence-transformers in Python; the JS port `@xenova/transformers` in Bun) is large (~50MB) and most users in early ring will not run their Reviewer Memory long enough to need compaction. The capability contract from M11 is the right place to declare it.

Pressure-test: is there a third option I am missing — for example, ship a stub compactor that uses string similarity (Levenshtein, cosine on bag-of-words) and only upgrade to embeddings when the string compactor's false-merge rate exceeds a threshold? That avoids the dependency entirely for the first year and gives a measured ramp.

## Format for your response

I will save your reply as `CODEX_RESPONSE.md` in this folder. Please structure it as:

1. **Verdict**: `accept-with-modifications` / `accept` / `block-soft` / `block-hard` on each of these three:
   - The decision (YES, with selective borrows for Reviewer Memory v1).
   - The borrow set (B1-B7 in COMPARISON.md).
   - The proposed M17 scope (B1 + B2 + B3 only).

2. **Q1-Q5 answers**: One paragraph each, with the yes/no/unsure and the reason.

3. **Authority boundary check**: Does M17 as scoped pass rule 20, or does it need to be split? If split, what is the natural sequence?

4. **Anything I missed**: features of ACE I should have called out but did not, or features of code-oz I should have credited but did not.

5. **Risks**: top 3 risks of the M17 scope as written, ranked by severity.

6. **Verdict on this whole comparison exercise** (separate from the M17 verdict): is this comparison series (one template per session, debated by Codex, archived in `docs/comparison/`) a good use of pre-finalization time, or are we polishing brass on the Titanic?

## Operating notes

- Sandbox: read-only. Do not write any files.
- Read order: `COMPARISON.md` first, then `~/Projects/agents/templates/ace/README.md`, then `~/Projects/agents/templates/ace/ace/core/curator.py` and `reflector.py` if you need source-level confirmation, then `docs/research/01-maestro-rule-checker.md` lines 280-330 for the maestro 4-layer memory and `docs/research/03-prompt-optimizer-front-door.md` lines 50-58 for the MemSkill / Memento-Skills lineage.
- Effort: xhigh.
- If you disagree, disagree concretely — name the file, the line, the assumption.
