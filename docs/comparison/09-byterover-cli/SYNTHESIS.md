# Synthesis — byterover-cli comparison (2026-05-10) — CLOSED

**Date:** 2026-05-10
**Resolved by:** Claude Opus 4.7 (1M context) acting as session maestro under Ozzy's autonomy grant.
**Status:** **CLOSED — landing batch shipped on `feat/byterover-09-borrows`** (4 commits; 3128 offline tests passing; pre-design + post-implementation Codex rounds both consumed).
**Inputs:**

- [`COMPARISON.md`](./COMPARISON.md) — Claude's first read: 21-row matrix, 6 borrows (B1-B6), 10 rejects (R1-R10).
- [`CODEX_BRIEFING.md`](./CODEX_BRIEFING.md) — debate brief; locked answers; recommended landing plan.
- [`CODEX_RESPONSE.md`](./CODEX_RESPONSE.md) — Codex `gpt-5.5` xhigh, thread `019e12ec-fe61-7030-b681-af492075a3eb`. Verdict: `fix-first`. 8 findings (1 block-push, 2 block-next-milestone, 2 fix-soon, 3 fyi).
- [`CODEX_PREDESIGN_B3.md`](./CODEX_PREDESIGN_B3.md) — Codex pre-implementation design memo, thread `019e1318`. Verdict: `revise-and-implement`. Caught: no `src/phases/debate-runtime.ts` (debate runtime is `src/tools/debate-request.ts`); review-panel uses an invoker-injection pattern with request construction in `src/cli/production-seams.ts`; debate set sites are `src/phases/review.ts:1270` + `:2676`; reducer is a separate `summarizeByParentTask` not a field on `BudgetCounts`.
- Live-repo verification of the two load-bearing F1/F3 claims — both confirmed; implementation followed Codex's revised file map exactly.

User decisions in §5 were resolved by Claude under the autonomy grant ("don't wait for or ask my permission for actions"). The seven decisions converged to: B3 hotfix shipped first; rule 22 consolidated B1+B4; B2 deferred to M17/M18; B5/B6 pattern-only; R10 reclassified to defer-with-high-bar; F7 backlog accepted; CLAUDE.md status-line refresh bundled into Commit 2.

---

## 1. What Codex caught that lands directly

### 1.1 F1 (block-push) — B2 invented a `code-oz consult` surface that does not exist

This is the load-bearing finding. COMPARISON.md (§3 row A6, §5 B2) framed B2 as "deterministic `code-oz search` adjacent to LLM-synthesized `code-oz consult`" — implying both surfaces exist and B2 adds the deterministic half. **They don't.** Live verification:

- `src/commands/` has 11 files (`approve.ts`, `dispatch-build-helpers.ts`, `dispatch-review-helpers.ts`, `dispatch-verify-helpers.ts`, `doctor.ts`, `init.ts`, `run.ts`, etc.) — no `consult.ts`.
- `CLAUDE.md:52` says: "Broad `consult()` is v0.3."
- `docs/contracts/REPO_CONTEXT.md` v0.1 names the actual surface: `tool_use.repo_context` permission sub-scope with `glob` / `grep` / `read` / `symbol` tools, `repo_context_searched` events, `maxFilesForNextManifest` cap, network denied.

**Resolution:** rewrite B2 around the *actual* current surface. The borrow is "add deterministic BM25 retrieval to the existing `tool_use.repo_context` family" — either as a new sub-tool (`tool_use.repo_context.tools += 'search'`) or as a public CLI command after the in-process tool ships. The invented `code-oz consult` surface is removed from the borrow language. The COMPARISON document stays as Claude's first read (per the round 5 precedent, the COMPARISON is preserved as the raw pre-Codex read; reframes land here).

This is the same failure class as the agent-skills round 2 catch ("Codex caught the rule-7 trip wire Claude missed"). Cross-model peer review fired exactly as designed.

### 1.2 F2 (block-next-milestone) — B2 sub-surface accounting under-counts

COMPARISON priced B2 at 2 rule-20 sub-surfaces. Codex's reframe, anchored to `docs/contracts/REPO_CONTEXT.md` and the byterover `SearchKnowledgeService` reference (`src/server/infra/executor/search-knowledge-service.ts`), is that the public/orchestrator-usable shape costs at least 3:

1. **Public retrieval surface.** CLI command and/or tool API plus output contract (paths, scores, totalFound shape).
2. **Permission/event contract extension.** `tool_use.repo_context.tools` extends past the locked `glob | grep | read | symbol` set. Caps, audit event shape (`repo_context_searched` extension or new `repo_context_search_indexed`), and manifest-promotion semantics for the search hits.
3. **BM25 index lifecycle.** Build, invalidate, cap, lock, score, and failure policy. Codex's reading of byterover's real implementation is that this is *not* "just storage" — the indexer owns mtime scans, MiniSearch population, sidecar ranking signals, OOD thresholds, score propagation, and fail-open behavior.
4. **Persisted index storage** — only if the index is written under `.code-oz/` (not if it's ephemeral/in-memory).

If the first ship is in-memory rebuild on each invocation, drop item 4 — not item 3. The minimum is 3.

This is the M16 sub-surface bundling lesson applied to my own borrow estimate (memory pin: `feedback_rule20_sharper_application.md`). I under-counted. Adopted.

### 1.3 F3 (block-next-milestone) — B3 is a hotfix, not a M13 follow-up

Live verification (sampled to confirm Codex's claim before relabeling):

- `src/state/schemas.ts:442-489` — `agent_invoked` carries `role`, `debateTopic`, `debateTurn`, `costEstimateUSD`, `model`, `manifest`. **No `parentTaskId` or `operationId`.**
- `src/providers/cost.ts` — `summarizeBudgetUse` reduces FIFO-by-phase: `pendingByPhase: Map<Phase, PendingEntry[]>`. Pairs `agent_invoked` to `agent_completed` by *phase order*, not by orchestrator operation. No durable join key for fan-out.
- `src/phases/review-panel.ts:340,439,646` — panel events carry their own `taskId`, but the per-provider reviewer calls fired *underneath* the panel run do not record that taskId as a parent reference.

The detached-row problem already exists in production `events.jsonl` from M14/M15 runs. B3 is a **pre-M17 telemetry hotfix**, not "M13 follow-up commit at the next docs cycle." It should land before any M17/M18 authority work.

**Shape (Codex-recommended, schema-compatible):**

- Add an optional `parentTaskId` (or `operationId` — naming question for Ozzy) field to `agent_invoked` and `agent_completed`. Optional → existing readers parse new events identically (M13 forward-compat precedent).
- Set the field at reviewer-panel and debate-policy fire paths from the orchestrator step's task ID.
- Reducer/report tests prove rollup without changing scheduling, provider choice, gate outcomes, or budget refusal.

**Rule-21 cost:** zero. Telemetry on existing fan-out calls. Does not introduce a new parallel-provider surface; surfaces a measurement onto the ones that already shipped.

### 1.4 F4 (fix-soon) — R10 is defer-with-high-bar, not reject

The original COMPARISON §6 R10 said "Defer until SHIP completion clarifies the artifact set" and then mis-titled the row "Reject." Codex's reframe is correct: **defer-with-high-bar after SHIP artifact stability** is the right shape. Read-only evidence MCP can preserve rule 7 (Markdown gate files stay canonical) and rule 13 (serves only explicit run artifacts, never recursive repo context). Cost when it lands: at least 3 sub-surfaces (MCP server lifecycle/transport + artifact projection/authorization + tool schema versioning), 4 if it later exposes live run watching.

Adopted. R10 reclassified.

### 1.5 F5 (fix-soon) — B1 and B4 placement, plus stale CLAUDE.md status line

Codex flagged two placement issues with one fix:

1. Adding rules 22 (Outside-In) and 23 (TDD ordering) takes the non-negotiable list from 21 to 23 items. Risks turning the list into a style guide.
2. `CLAUDE.md:7-9` still says "v0.13.0-alpha.0" and "1983 tests" while `package.json` says `0.17.0-alpha.0`; the M16 baseline is 3108 tests, and this branch raises the count to 3128 with the B3 coverage. Stale canonical orientation file. The agent-skills round 2 SYNTHESIS already flagged this (commit 4 in that round's landing plan); the staleness has not been addressed since.

**Resolution (Claude's lean, decision point §4 below):**

- Consolidate B1 + B4 into a single new rule 22: "Consumer-first design and proof-first implementation." Two bullets: (a) Outside-In feature design — every new code path starts from a concrete consumer, etc.; (b) Strict TDD ordering for behavior changes — failing test first, etc.
- The detailed RED-first sequence (5-step ordering with the "if you catch yourself…" framing) lives in `src/agents/defaults/builder.md` (the agent-skills round 2 SYNTHESIS commit 3 already pointed there). Universal-rules.md keeps the universal anti-slop rules; rule 22 is structural, not stylistic.
- Bundle the stale-status-line fix into the same docs commit. Update `CLAUDE.md:7-9` to v0.17.0-alpha.0 / 3128 offline tests / M16 closed.

This collapses Briefing commits 1+2 into one commit while picking up the agent-skills round 2 carry-over.

### 1.6 F6 / F7 / F8 (fyi) — wording and scope confirmations

- **F6:** keep verdict wording category-scoped — "code-oz exceeds byterover on SDLC discipline mechanics," not "code-oz is better." Adopted.
- **F7:** RuntimeSignalStore is correctly out of scope for v0.17. The analog code-oz could derive (per-file audit analytics: how many manifests selected this file, how many REVIEW findings touched it, how many VERIFY restarts it caused, how many tokens it consumed) is buildable from `agent_invoked.manifest`, REVIEW findings, VERIFY events, and `repo_context_searched` events without a sidecar. Track as backlog.
- **F8:** `curl | sh` stays in W3 distribution; not an M17/M18 contender. Adopted.

---

## 2. Where Codex pushed harder than Claude

### 2.1 B2 indexer = real authority, not glue

Claude's COMPARISON treated B2's indexer as "minisearch-as-a-library + storage." Codex's reading of byterover's `SearchKnowledgeService` is that the indexer owns enough state machinery (mtime scans, OOD thresholds, score propagation, sidecar fail-open, concurrent build locking, schema version invalidation) that calling it "just a library" is the under-counting move. **Adopted.** The reframe matters because it changes B2 from a 2-sub-surface candidate to a 3-or-4-sub-surface candidate, which changes whether B2 fits in M17 or M18 at all.

### 2.2 B3 is already a production gap, not a future improvement

Claude's COMPARISON used soft language ("the gap that grows with M14/M15"). Codex anchored it: M14 and M15 are already shipped, the rows already exist in `events.jsonl`, and the FIFO-by-phase reducer in `cost.ts` cannot rebuild orchestrator-operation rollup from that data. **Adopted.** The relabeling is "pre-M17 telemetry hotfix."

### 2.3 R10 should not say "reject" if the body says "defer until SHIP"

Codex caught a wording inconsistency Claude did not. The COMPARISON row body said "Defer until SHIP completion (M17 candidate per agent-skills round) clarifies the artifact set" but the column header said "Reject." Mismatched verbs. **Adopted.** Reclassified as defer-with-high-bar.

---

## 3. Open questions Codex raised (carried to user decision points)

These come from `CODEX_RESPONSE.md` § "Open questions for SYNTHESIS.md" and need Ozzy's call:

1. **B2 first ship: tool or command?** Should B2 first land as `tool_use.repo_context.tools += 'search'` (in-process tool, agents call it from inside an invocation) rather than as a public `code-oz search` CLI command? Claude's lean: yes — adding the in-process tool first lets the orchestrator use it before exposing a public command, which makes the rule-21 case easier (orchestrator-internal cost reduction is measurable in `events.jsonl`; public CLI usage is not).
2. **B3 correlation field name: `parentTaskId`, `operationId`, or `decisionId` reuse?** `decisionId` already exists for debate decisions; reusing it conflates orchestrator-operation rollup with debate-decision identity. Claude's lean: new optional `parentTaskId` field on `agent_invoked` and `agent_completed`. The "task" framing matches byterover's vocabulary and our existing `taskId` on panel events.
3. **B3 rollup: invoke-only or both events?** Claude's lean: both `agent_invoked` and `agent_completed`. Setting it on invoke means the row is correlated even if the call crashes; setting it on completed means the cost rollup can join cleanly. Both is the cheap, safe choice.
4. **Read-only MCP artifact set (R10 deferred):** when this lands, what does it expose? Gate files only, `events.jsonl`, manifests, doctor reports, or a generated bundle? Claude's lean: gate files + run-scoped manifest, not raw `events.jsonl` (rule 13 — `events.jsonl` may contain truncated provider responses with sensitive content).
5. **B1+B4 detail location:** if rule 22 is consolidated, where does the RED-first 5-step sequence live? Claude's lean: `src/agents/defaults/builder.md` (already the home of build-time validation language per agent-skills round 2 SYNTHESIS commit 3).

---

## 4. Final landing plan

In landing order, all four commits priced at zero rule-20 *new authority cost* (B3 extends the M13 schema by an optional field, which is forward-compat-only). The four commits replace the three originally proposed in `CODEX_BRIEFING.md` §4.

### Commit 1: feat(state,cost,phases): B3 — thread parentTaskId through reviewer panel + debate fan-out

- Files: `src/providers/types.ts`, `src/state/schemas.ts`, `src/state/events.ts`, `src/providers/invoke.ts`, `src/providers/cost.ts`, `src/tools/debate-request.ts`, `src/phases/review.ts`, `src/phases/review-panel.ts`, `src/cli/production-seams.ts`, plus `tests/state-events-parent-task-id.test.ts`, `tests/provider-invoke-parent-task-id.test.ts`, and `tests/cost-by-parent-task.test.ts`.
- Behavior: add optional `parentTaskId` field to `agent_invoked` and `agent_completed` schemas (forward-compat — existing readers parse new events identically). Reviewer panel and debate-policy fire paths set it from the orchestrator step's task ID. Cost reducer report adds an optional `byParentTaskId` rollup section without changing the existing `byPhase`/`byRole` rollups (rule 1 — file-based gate signals untouched; rule 19 — budget enforcement untouched).
- Tests: reducer/report tests prove rollup; wrapper tests prove invoke/complete pass-through and omission back-compat; event-validator tests prove optional `T-NNN` enforcement.
- Estimated diff: ~50-80 lines code + ~30-50 lines tests.
- Rule-20 cost: 0 new authority (schema extension is forward-compat). Codex framing: "telemetry hotfix."
- Rule-21 cost: 0.

### Commit 2: docs(rules): rule 22 — Consumer-first design and proof-first implementation; refresh CLAUDE.md status line

- File: `CLAUDE.md`.
- Add to non-negotiable rules:
  > **22. Consumer-first design and proof-first implementation.**
  > **(a) Outside-In feature design.** Every new code path starts from a concrete consumer (CLI subcommand, agent skill, persona prompt). Define the minimal interface the consumer requires; implement the service to fulfill it; extract entities only when shared structure emerges across consumers. Reviewing or planning that defines entities, types, or store interfaces before any consumer exists is Inside-Out and must be flagged.
  > **(b) Strict TDD ordering for behavior changes.** For any behavior change, the failing test is written first, run to confirm it fails for the right reason, then minimal implementation lands, then tests run again to confirm green, then refactor. The detailed RED-first sequence (and the "if you catch yourself…" framing) lives in `src/agents/defaults/builder.md` for execution; rule 22 is the structural non-negotiable.
- Update `CLAUDE.md:7-9` (Status line) — v0.13.0-alpha.0 → v0.17.0-alpha.0; 1983 tests → 3128 offline tests (3108 baseline + 20 in B3); PE-1 reference → M16 closed (production CLI completion); add `docs/comparison/09-byterover-cli/` to "Where decisions live."
- Estimated diff: ~15-25 lines.
- Rule-20 cost: 0.

### Commit 3: docs(builder): RED-first 5-step ordering detail in builder persona

- File: `src/agents/defaults/builder.md`.
- Add a short section "Test ordering for behavior changes" after the existing validation language: 5-step RED-first sequence, "if you catch yourself…" framing. Reference rule 22(b) as the upstream non-negotiable.
- Estimated diff: ~10-15 lines.
- Rule-20 cost: 0.

### Commit 4: docs(comparison): close 09-byterover-cli round

- Files: `docs/comparison/09-byterover-cli/{COMPARISON.md,CODEX_BRIEFING.md,CODEX_RESPONSE.md,CODEX_PREDESIGN_B3.md,SYNTHESIS.md}`.
- The branch deliberately does not edit `docs/comparison/README.md`; the README index entry is left for a separate sync commit on main to avoid colliding with parallel template-comparison sessions.
- Estimated diff: ~820 lines of comparison artifacts.
- Rule-20 cost: 0.

### Future milestones

- **M17/M18 contenders** (one of, debated next round):
  - **(a) SHIP runtime completion** — already on the M17 short-list from agent-skills round 2.
  - **(b) Doubt-driven pre-BUILD checkpoint** — agent-skills round 2 candidate.
  - **(c) B2 two-tier search** — reframed against `tool_use.repo_context`, repriced at 3-4 sub-surfaces. Stronger candidate for M18 than M17 given the rule-20 cost.
- **Pattern-only (apply when surface needs it):** B5 AsyncLocalStorage snapshot for policy-at-task-creation; B6 ESLint-enforced import boundary (M17+ when CLI grows past four subcommands).
- **Defer-with-high-bar:** R10 read-only evidence MCP — costs 3 sub-surfaces minimum at land time; gated on SHIP artifact stability.
- **Backlog:** F7 per-file audit analytics derived from `agent_invoked.manifest` + REVIEW findings + VERIFY events + `repo_context_searched`; F8 `curl | sh` installer (W3 distribution slot).

---

## 5. User decision points — resolved 2026-05-10

Resolved by Claude under Ozzy's autonomy grant ("don't wait for or ask my permission for actions"). Each decision is recorded with the verdict and the artifact that operationalizes it.

1. **Land Commits 1-4 as the byterover-cli landing batch.** Resolved: yes. Shipped on `feat/byterover-09-borrows` as 4 atomic commits (19 files; 1444 insertions, 2 deletions in the branch diff). 3128 tests passing (3108 baseline + 20 in B3).
2. **B3 correlation field name.** Resolved: `parentTaskId`. Codex pre-design confirmed no conflict with `decisionId` (ULID join key for scheduler events). Lives on `ProviderRequest` (`src/providers/types.ts`) and on both `agent_invoked` / `agent_completed` schema variants (`src/state/schemas.ts`); validator enforces canonical `T-NNN` pattern when present (`src/state/events.ts`).
3. **B3 rollup on both events.** Resolved: yes — both invoke and completed carry the field. Crashed turns still attribute their estimate to the parent task; `summarizeByParentTask` mirrors `summarizeBudgetUse`'s "crashed turn still counts" rule.
4. **B1+B4 placement.** Resolved: consolidated into single rule 22 ("Consumer-first design and proof-first implementation") per Codex F5 to avoid rule-list bloat. The detailed RED-first 5-step sequence lives in `src/agents/defaults/builder.md` (Commit 3); rule 22(b) is the structural non-negotiable.
5. **B2 first-ship shape.** Resolved: deferred to M17/M18 per Codex F2 (3-4 sub-surfaces, not 2). When B2 lands, the in-process `tool_use.repo_context.tools += 'search'` shape is the rule-21-friendly path; a public `code-oz search` CLI is optional follow-up.
6. **R10 reclassification.** Resolved: defer-with-high-bar after SHIP artifact stability; priced at 3+ sub-surfaces (MCP server lifecycle + artifact projection/authorization + tool schema versioning).
7. **F7 backlog item — per-file audit analytics.** Resolved: yes, accepted as backlog. Buildable when SHIP completion forces query at scale. Source data already exists in `agent_invoked.manifest`, REVIEW findings, VERIFY events, and `repo_context_searched`; no sidecar required.

---

## 6. Verdict

**Q1: Is code-oz now meeting its needs vs the byterover-cli template?** Yes, *scoped to SDLC discipline mechanics*. byterover-cli is more product-mature on memory-layer runtime engineering (daemon, REPL, web UI, MCP, 21 providers, public benchmarks). Code-oz operates in a different category and structurally exceeds byterover on the discipline authorities that define the SDLC-runtime category. The complementary framing in COMPARISON §4 holds; Codex confirmed.

**Q2: Where does code-oz exceed byterover-cli?** Twelve axes in COMPARISON §4 (phase gates, cross-family REVIEW, 3-source verification, AUDIT, Scientist sidecars, universal anti-slop, one-authority-per-milestone, demand-driven providers, file-manifest context, cumulative budget enforcement, idempotent resume, NEEDS_INTERVENTION). All confirmed by Codex F6 with sharper wording.

**Q3: What earns its place at v0.17?** Four commits in §4. **One pre-M17 hotfix** (B3 parentTaskId rollup — closes a real production telemetry gap in M14/M15 fan-out paths) plus **three zero-cost docs commits** (rule 22 consolidated; builder RED-first detail; comparison closure docs). Two M17/M18 contenders carry forward (B2 reframed against `tool_use.repo_context`; doubt-driven pre-BUILD checkpoint from agent-skills round). One reject reclassified to defer-with-high-bar (R10 read-only MCP).

**Q4: What did cross-model review save us?** One block-push (B2 framed against an invented surface); two block-next-milestone (B2 under-priced, B3 mis-categorized as docs-cycle work when it's a production hotfix); two fix-soon (R10 wording, rule-list bloat). Codex thread `019e12ec-fe61-7030-b681-af492075a3eb`. The agent-skills round 2 lesson — "Codex catches the schema/contract trip wires Claude misses" — fired again. The cross-model peer review rule earned its place again.

**The takeaway:** byterover-cli is exhausted as a borrow source for code-oz's SDLC-runtime authorities. The three borrows that earn their place (B3 hotfix, rule 22 consolidated B1+B4, B2 reframed for future M17/M18 debate) land what's takeable. Future byterover updates should be re-audited annually or when byterover ships a surface that names a discipline mechanic not already covered by code-oz contracts.

---

## 7. Cross-references

- This round: [`COMPARISON.md`](./COMPARISON.md), [`CODEX_BRIEFING.md`](./CODEX_BRIEFING.md), [`CODEX_RESPONSE.md`](./CODEX_RESPONSE.md), this file.
- Prior round (agent-skills): [`docs/comparison/05-agent-skills/synthesis.md`](../05-agent-skills/synthesis.md). Two carry-over items closed here: (a) stale CLAUDE.md status-line refresh bundled into Commit 2; (b) RED-first builder detail (agent-skills round 2 commit 3) re-anchored to rule 22(b).
- Memory pins most relevant: `feedback_rule20_sharper_application.md` (M16 sub-surface bundling — fired again on B2); `feedback_per_commit_cross_model_review.md` (catches load-bearing bugs before commit — fired again on F1); `feedback_review_rounds_catch_different_classes.md` (R1 surfaces behavioral bugs, R2 surfaces contract drift — F1 is contract drift, F3 is behavioral, F2 is sub-surface accounting).
- Influence library: `CLAUDE.md` § "Influence library." byterover-cli was unaudited at session start; this round closes the audit. Verdict for influence-library entry: "memory layer reference; complementary category, not borrow source for runtime authorities."
- Next template up: per the user's "one project per session" rule, this comparison closes the byterover-cli surface. Backlog from `docs/comparison/README.md`: `agentic-canvas` (already done in `docs/comparisons/agentic-canvas/` — non-canonical folder), `Chorus`, `claude-coder`, `codegraph`, `codex`, `gptme`, `learn-harness-engineering`, `Mimir`, `prd-taskmaster`, `skills`, plus the four influence-library carry-overs (`opencode`, `pi-mono`, `maestro`, `claude-code`).
