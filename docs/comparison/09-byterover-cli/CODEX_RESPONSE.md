# Codex response — byterover-cli comparison

**Reviewer:** OpenAI Codex CLI, model `gpt-5.5`, reasoning effort `xhigh`, sandbox `read-only`.
**Thread:** `019e12ec-fe61-7030-b681-af492075a3eb`.
**Date:** 2026-05-10.
**Briefing:** [`CODEX_BRIEFING.md`](./CODEX_BRIEFING.md).
**Comparison under review:** [`COMPARISON.md`](./COMPARISON.md).

> Codex was asked to write to this file directly. The read-only sandbox rejected the patch (correct behavior — Codex has no write authority during a review round). The verbatim content below was authored by Codex and pasted here by Claude. Validation footer preserved.

---

## Verdict

`fix-first`

The comparison is directionally right: code-oz is ahead on SDLC-runtime discipline, while byterover-cli is ahead on memory-layer runtime engineering. I would not ship the landing plan as written because B2 invents an existing `code-oz consult` surface and undercounts the search borrow. B3 should also be treated as a production telemetry bug before the next milestone, not as a loose M13 follow-up.

## Severity table

| ID | Severity | Finding | Required action |
|---|---|---|---|
| F1 | block-push | B2 is framed against an existing `code-oz consult` command/surface that does not exist today. | Rewrite B2 around the actual `tool_use.repo_context` path, not `code-oz consult`, before SYNTHESIS.md. |
| F2 | block-next-milestone | B2 is underpriced at 2 rule-20 sub-surfaces for the public BM25 shape described. | Reprice B2 as 3 minimum, 4 if persisted index storage lands. |
| F3 | block-next-milestone | B3 is a hotfix-sized telemetry gap in already-shipped M14/M15 fan-out paths. | Land before any M17/M18 authority work, with tests around panel and debate fan-out attribution. |
| F4 | fix-soon | R10 is rejected too quickly; read-only evidence MCP is a plausible future validation surface, just not v0.17. | Change R10 from reject to defer-with-high-bar and price it explicitly. |
| F5 | fix-soon | B1+B4 as two new top-level rules add rule-list bloat, and CLAUDE.md is stale if touched. | Consolidate the rule wording or move detail into influence-library guidance; update the stale status line in the same docs pass. |
| F6 | fyi | The verdict is honest only when scoped to SDLC discipline, not runtime/product maturity. | Keep the SYNTHESIS wording category-scoped. |
| F7 | fyi | RuntimeSignalStore is correctly out of scope for v0.17, but the analog is per-file audit analytics, not maturity scoring. | Track as derived analytics over existing manifests/events before considering a sidecar. |
| F8 | fyi | `curl | sh` is not an M17/M18 contender. | Keep installer work in W3 distribution unless SHIP exposes a real friend-install blocker. |

## Findings

### F1 — B2 invents `code-oz consult`

COMPARISON.md says B2 should add `code-oz search <query>` beside an existing `code-oz consult <question>` and says consult is "currently the only way to run repo_context" (`docs/comparison/09-byterover-cli/COMPARISON.md:134`). The briefing repeats the same shape in the future-milestone list (`docs/comparison/09-byterover-cli/CODEX_BRIEFING.md:89-92`) and prompt 5.3 (`docs/comparison/09-byterover-cli/CODEX_BRIEFING.md:122-128`). Live repo truth does not match that: `CLAUDE.md` says broad `consult()` is v0.3 (`CLAUDE.md:52`), `REPO_CONTEXT.md` describes model-issued in-process `glob`/`grep`/`read` tool use (`docs/contracts/REPO_CONTEXT.md:48-85`), and `src/commands/` has no `consult.ts`.

Fix: rewrite B2 as "add deterministic BM25 retrieval to the existing `tool_use.repo_context` family, optionally with a public `code-oz search` command later." Do not let SYNTHESIS.md preserve the invented `code-oz consult` surface.

### F2 — B2 sub-surface accounting is too low

COMPARISON.md prices B2 at 2 sub-surfaces: a CLI subcommand plus repo-index storage (`docs/comparison/09-byterover-cli/COMPARISON.md:144-147`). That only works if "BM25" is a private library call under an already-approved authority. The proposed shape is public, audited, permission-scoped, and orchestrator-usable. `REPO_CONTEXT.md` locks the v0.1 tools to `glob | grep | read | symbol`, fixed caps, no network, `repo_context_searched` events, and next-invocation manifests (`docs/contracts/REPO_CONTEXT.md:19-34`, `docs/contracts/REPO_CONTEXT.md:78-122`). Adding BM25 means changing that contract, not just adding storage.

Byterover's implementation also shows that the indexer is not just "storage." `search-executor.ts` is small, but delegates to `SearchKnowledgeService` (`src/server/infra/executor/search-executor.ts:18-40`). The real service owns index state, cache TTL, concurrent build locking, schema version invalidation, mtime scans, MiniSearch population, symbolic trees, sidecar ranking signals, OOD thresholds, score propagation, access-hit flushing, and sidecar fail-open behavior (`search-knowledge-service.ts:219-248`, `search-knowledge-service.ts:503-710`, `search-knowledge-service.ts:713-860`, `search-knowledge-service.ts:879-1045`, `search-knowledge-service.ts:1139-1445`). If code-oz borrows the idea, rule-20 accounting should be:

1. Public retrieval surface: CLI command and/or tool API plus output contract.
2. Permission/event contract extension: `tool_use.repo_context` tool list, caps, audit event shape, and manifest promotion semantics.
3. BM25 index lifecycle: build, invalidate, cap, lock, score, and failure policy.
4. Persisted index storage, only if the index is written under `.code-oz/`.

If the first implementation is ephemeral and only rebuilds in memory, drop item 4, not item 3. That makes B2 a 3-sub-surface minimum for the proposed public/orchestrator path.

### F3 — B3 is a hotfix, not a loose M13 follow-up

The comparison itself says M14 reviewer panel and M15 debate scheduler are the first fan-out surfaces and that M13 did not anticipate fan-out (`docs/comparison/09-byterover-cli/COMPARISON.md:151-161`). The live event schema confirms the current correlation is partial: `agent_invoked` carries `role`, `debateTopic`, and `debateTurn`, but no parent task/operation id (`src/state/schemas.ts:442-489`); `summarizeBudgetUse` reduces cost FIFO by phase and role, not by orchestrator operation (`src/providers/cost.ts:101-200`); panel execution emits aggregate panel events with `taskId` but per-provider cost rows still need a durable join key (`src/phases/review-panel.ts:260-343`).

This does not create a rule-21 surface if implemented strictly as telemetry on existing fan-out calls. It should be a hotfix before M17 because the production rows already exist. The safe shape is a schema-compatible optional `parentTaskId` or `operationId` on `agent_invoked` and `agent_completed`, set by reviewer-panel and debate-policy fire paths, with reducer/report tests proving rollup without changing scheduling, provider choice, gate outcomes, or budget refusal.

### F4 — R10 should be defer-with-high-bar, not reject

COMPARISON.md rejects outbound MCP because code-oz does not produce stable knowledge as a primary artifact (`docs/comparison/09-byterover-cli/COMPARISON.md:203-212`). The briefing's own prompt is stronger: exposing `events.jsonl` and gate files read-only could let other agents consume code-oz's gate signals as evidence (`docs/comparison/09-byterover-cli/CODEX_BRIEFING.md:142-146`). I agree it should not land now, and I agree it must not become a second authority plane. But "reject" is too final.

A read-only evidence MCP can preserve rule 7 if Markdown gate files remain canonical and preserve rule 13 if it serves only explicit run artifacts, never recursive repo context. The cost is at least 3 sub-surfaces: MCP server lifecycle/transport, artifact projection and authorization over `events.jsonl` plus gate files, and stable tool schema/versioning for external consumers. If it later exposes live run watching, add a fourth watch/liveness surface. Recommendation: defer until SHIP defines the artifact set, then debate it as an evidence-export milestone, not as a memory-layer borrow.

### F5 — B1/B4 should not both become new top-level rules as drafted

Byterover's language is crisp: RED-first TDD is mandatory (`byterover-cli/CLAUDE.md:39-47`) and Outside-In applies to planning, review, coding, and auditing (`byterover-cli/CLAUDE.md:51-58`). The borrow is valid. The placement is the issue. The root rules list is already 21 items, and the landing plan adds two more top-level rules (`docs/comparison/09-byterover-cli/CODEX_BRIEFING.md:57-71`). That risks turning the non-negotiable list into a style guide.

I would either add one rule, "Consumer-first design and proof-first implementation," with two bullets, or keep one top-level Outside-In rule and put TDD ordering in persona/build guidance where it is executable. Also, if the next commit edits `CLAUDE.md`, fix the stale status line at the same time: `package.json` is `0.17.0-alpha.0`, while `CLAUDE.md` still says v0.13.0-alpha.0 and 1983 tests (`package.json:1-4`, `CLAUDE.md:7-9`). That staleness is not a comparison blocker, but it weakens the canonical file that B1/B4 would modify.

### F6 — Verdict honesty is acceptable, with tighter words

The verdict is honest if phrased as "code-oz exceeds byterover on SDLC discipline mechanics." COMPARISON.md already says byterover is more mature on runtime engineering and that the projects are complementary (`docs/comparison/09-byterover-cli/COMPARISON.md:104`, `docs/comparison/09-byterover-cli/COMPARISON.md:220-231`). Keep that distinction in SYNTHESIS.md. Byterover's daemon, REPL, web UI, MCP, provider catalog, bundled installer, query log, and benchmarks are real engineering surface, not noise. They should inform future cost estimates without pulling code-oz out of its current category.

### F7 — RuntimeSignalStore is not a v0.17 borrow

The RuntimeSignalStore pattern is interesting because byterover moved file-level usage/maturity out of markdown frontmatter (`byterover-cli/CLAUDE.md:103`) and the search service reads/writes those signals during ranking (`search-knowledge-service.ts:1143-1213`, `search-knowledge-service.ts:1272-1287`). Code-oz does not need maturity ranking for repo files today. Its analog would be derived analytics: which files were repeatedly selected into manifests, drew review findings, caused VERIFY restarts, or consumed provider tokens. Start by deriving that from `agent_invoked.manifest`, REVIEW findings, VERIFY events, and `repo_context_searched` before adding a new sidecar store.

### F8 — `curl | sh` is not worth an early slot

The ROADMAP already places installer work in W3 distribution (`docs/design/ROADMAP.md:399-404`). A secure `curl | sh` path is not a one-line convenience; it implies release artifacts, install script behavior, checksum/signature verification, PATH handling, uninstall/upgrade behavior, and platform matrix smoke tests. That is useful for friend installs after SHIP is credible, but it should not compete with B3, SHIP completion, doubt-driven checkpointing, or B2.

## Open questions for SYNTHESIS.md

1. Should B2 first land as a repo-context tool (`tool_use.repo_context.tools += search`) rather than as a public `code-oz search` command?
2. What is the exact correlation field for B3: `parentTaskId`, `operationId`, or reuse of existing `decisionId` where present?
3. Should B3 roll up both `agent_invoked` and `agent_completed`, or only the invoke row with completion joined by existing FIFO semantics?
4. What artifact set would read-only MCP expose after SHIP: gate files only, `events.jsonl`, manifests, doctor reports, or a generated bundle?
5. If B1/B4 become one consolidated rule, where does the detailed RED-first sequence live so agents actually execute it?

## Reframes

No locked answer in CODEX_BRIEFING.md section 3 needs to be reopened.

Requested wording changes that are not locked-answer reframes:

- Change B2 from "beside existing `code-oz consult`" to "inside or adjacent to the existing `tool_use.repo_context` flow."
- Change R10 from "reject" to "defer with high bar after SHIP artifact stability."
- Change B3 from "M13 follow-up" to "pre-M17 telemetry hotfix."

---

## Validation footer (from Codex)

> Read the requested comparison/briefing, pinned contracts, byterover `CLAUDE.md`/`AGENTS.md`, `search-executor.ts`, and relevant live code-oz cost/event/repo-context files. Attempted the requested write with `apply_patch`; it was rejected by the read-only sandbox.
