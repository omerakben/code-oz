# Codex Briefing — gptme vs code-oz

**Briefing date:** 2026-05-10
**Briefer:** Claude Opus 4.7 (1M ctx) — code-oz session
**Codex model:** gpt-5.5 xhigh, sandbox: read-only
**Convention:** This is a debate at planning convergence per CLAUDE.md cross-model peer review rule. Your verdict is data, not authority. Push back hard on assumptions you find weak.

---

## Reading order

1. `docs/comparisons/gptme/COMPARISON.md` — full structural review and recommended verdict
2. `CLAUDE.md` — code-oz non-negotiable rules (1-21), especially Rule 20 (one authority per milestone) and Rule 21 (no parallel-provider surface without measurable risk-reduction)
3. `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` — product north star
4. `~/Projects/agents/templates/gptme/` — the template under review (read-only); key files: `gptme/chat.py`, `gptme/tools/autocompact/decision.py`, `gptme/checkpoint.py`, `gptme/prompts/__init__.py` (AGENT_FILES list), `gptme/hooks/__init__.py`, `gptme/tools/subagent/api.py`

---

## Goal

Determine whether code-oz already exceeds gptme in the SDLC-runtime domain, and which (if any) gptme primitives are worth borrowing **without violating Rule 20 or Rule 21**.

---

## Recommended verdict (challenge me)

**Code-oz exceeds gptme in repo-native SDLC discipline; gptme exceeds code-oz in general-purpose agent CLI ergonomics. Different products. Not competing.**

Borrow set: **3 now, 2 deferred, 5 rejected.**

| Action | Item | Rule-21 measurement plan |
|---|---|---|
| Borrow now | B1: Autocompact decision engine with cache-invalidation guard | log `compaction_skipped_savings_ratio` and `compaction_applied_tokens_saved` to events.jsonl; gate on observed > 0.10 ratio |
| Borrow now | B2: Checkpoint kind-classification (`clean_git`/`dirty_git`/`non_git`/`multi_root`) with refusal modes | log `audit_completeness_recovered_via_checkpoint` count; drop if zero |
| Borrow now | B3: Cross-tool AGENT_FILES ingestion at AUDIT/DEFINE | log `agent_files_loaded` count + paths; survey on a brownfield corpus |
| Defer (v0.2) | D1: Generalized hook lifecycle (16 types) | revisit when ≥3 features want to subscribe to the same event |
| Defer (v0.2) | D2: Subagent batch+planner pattern | revisit when M14.x or later proves Reviewer panel needs concurrency |
| Reject | R1: Lessons keyword/tool auto-injection | conflicts with Rule 16 (deterministic phase prompts) |
| Reject | R2: Plugin entry-points (Python packages) | Rule 20 — extension-surface authority creep |
| Reject | R3: Persistent-agent journal/people/projects (Bob) | category mismatch (personal-assistant runtime ≠ SDLC runtime) |
| Reject | R4: Architect/editor split prompt | already structurally present as PLAN→BUILD |
| Reject | R5: Web UI / REST / Tauri / ACP | CLI-only is a deliberate distribution choice |

---

## Locked answers (not up for debate; argue around them)

- **Cross-family REVIEW** is non-negotiable (Rule 2). Borrows must not undermine.
- **File-based gate signals** are non-negotiable (Rule 1). Borrows must not introduce any LLM-text-parsed gate.
- **Universal anti-slop rules + per-persona prompts** are how knowledge is injected (Rule 16). No keyword auto-injection.
- **One authority per milestone** (Rule 20). Each "borrow now" must fit as a single milestone's authority.
- **No parallel-provider surface without measurable effect** (Rule 21). Each "borrow now" needs an `events.jsonl` measurement plan.
- **Repo-native SDLC, not personal-assistant** (product thesis). No journal/people/projects layer.
- **CLI-only distribution** (architecture lock). No web UI / REST / Tauri / ACP.

---

## Specific challenge prompts

Push back where the recommendation is weakest:

### 1. Is B1 (autocompact) actually needed?

I argue yes because long M14+ runs accumulate Reviewer-panel transcripts and debate-scheduler rounds, plus a 1-hour cache TTL means cache-aware compaction matters. gptme's `MIN_SAVINGS_RATIO = 0.10` exists for the same reason.

**Counter-argument I want you to make if it holds:** Phase boundaries already bound context per phase. We could instead write a discipline rule — "no phase artifact may exceed N tokens at gate-write time" — and refuse to advance otherwise. That would be cheaper than building a compaction engine.

Is the discipline-rule alternative actually viable, or does the M14 reviewer-panel + M15 debate-scheduler experience already produce contexts large enough that compaction is the right tool?

### 2. Is B2 (checkpoint) redundant with worktree audit-completeness recovery?

I argue no because the worktree primitive recovers from "create-worktree but did not finish gate write." Checkpoint covers a different gap: BUILD has emitted edits to the working tree but VERIFY has not yet run, and the process dies. Audit-completeness can detect the partial state but cannot rewind it.

**Counter-argument I want you to make if it holds:** The gap is artificial. BUILD writes are already to a per-run worktree which is throwaway; if BUILD dies mid-write the next run starts from the gate-known state. We do not need a separate checkpoint primitive — the worktree IS the checkpoint.

Is the gap real, or am I inventing a problem?

### 3. Is B3 (cross-tool AGENT_FILES) a security issue?

I argue no because they are user-authored files in the repo the user is asking us to operate on, but with a confirm at AUDIT/DEFINE that lists which files were ingested.

**Counter-argument I want you to make if it holds:** `.cursorrules` and `.windsurfrules` may contain prompt-injection-style instructions intended for those specific tools. Ingesting them blindly into code-oz personas is a trust-boundary violation. We should require the user to opt-in per file.

Which side wins?

### 4. Did I misclassify D1 or D2?

I deferred D1 (hook lifecycle, 16 types) and D2 (subagent batch+planner) because they are large surfaces and Rule 20/21 say "wait for measurable need." But:

- gptme's hook system is mature and porting it later is *more* expensive than porting now.
- Subagent batch+planner is a clean pattern that matches code-oz's M14 Reviewer-panel exactly.

**Counter-argument I want you to make if it holds:** Promote D1 or D2 to "borrow now" because the cost of porting later exceeds the Rule-21 cost of borrowing speculatively.

If you disagree with deferral, give me the milestone slot they should land in and the measurement plan.

### 5. Did I miss anything?

Specifically:

- **`morph` tool** (fast LLM edits) vs code-oz's BUILD edit pattern — is morph a real efficiency win for BUILD?
- **`precommit.py` integration** vs code-oz's VERIFY gate — should code-oz's VERIFY shell out to pre-commit hooks if `.pre-commit-config.yaml` exists?
- **`eval/` suite** vs code-oz's offline tests — does gptme's eval pattern (`docs/evals.rst`) suggest something code-oz lacks for measuring run quality across releases?
- **Architect/editor prompt template** — I rejected this as structurally redundant, but is the *prompt template itself* worth lifting into PLAN/BUILD persona prompts even though the structural separation already exists?
- **Cost tracking integrated into the chat loop** vs `budgets.global` — is gptme doing something here we should copy?

---

## Output format

Please write your response in `docs/comparisons/gptme/CODEX_RESPONSE.md` (or as a single response that I will save to that path). Required structure:

1. **Verdict on the recommended decision matrix** (each line: agree / accept-with-modifications / reject; show your reasoning).
2. **Specific counter-arguments** for the five challenge prompts above.
3. **Risks I missed.** Things I did not see in the comparison that matter for code-oz's path.
4. **Final verdict.** One of: `push` (proceed with borrow set as recommended), `fix-first` (concrete changes to the borrow/defer/reject classification before proceeding), `debate-required` (the recommendation is wrong enough that another round is warranted).

Sandbox: read-only. Do not edit files. Reason without writing.
