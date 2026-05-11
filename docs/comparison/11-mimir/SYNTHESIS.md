# Synthesis — code-oz vs Mimir borrow audit (v0.17)

**Date:** 2026-05-10
**Author:** Claude Opus 4.7 (xhigh) after Codex gpt-5.5 xhigh adversarial review (thread `019e12f0-d136-70b0-8d9b-f573981f90bb`)
**Inputs:** `COMPARISON.md` (initial verdict + borrow set), `CODEX_RESPONSE.md` (verbatim adversarial review)
**Status:** locks the borrow set + acceptance criteria for the Mimir comparison. No implementation work begins until the listed acceptance criteria are met.

**Path notation:** `<templates-root>` refers to the influence-library root documented in `CLAUDE.md` ("Influence library" section, default `~/Projects/agents/templates/`). All citations into Mimir source use `<templates-root>/Mimir/...` so the synthesis is portable across operator machines.

---

## Verdict (locked)

**YES, code-oz is ahead on the discipline axes that matter to code-oz** — file-based gates, cross-family review, debate runtime, run-level cumulative budgets, universal anti-slop rules, maestro discipline, scientist tails, 3-source verification, permission manifests, privacy-by-default, brownfield AUDIT, rule 20, rule 21, cross-model peer review, worktree isolation with idempotent recovery (15 axes total).

**Mimir is ahead in its category** — memory-native MCP product (persistent graph + embeddings + MCP tool exposure to external agents). That category is out of scope for code-oz by deliberate commitment (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`); code-oz's category is repo-native SDLC runtime.

The verdict is *not* "code-oz is globally ahead." It is "ahead on the disciplines that justify code-oz's category, with a small selective borrow set." Codex flagged the verdict-shape grammar; this synthesis adopts the Archon-style framing (`docs/comparison/04-archon/COMPARISON.md:148-150`).

## What changed after Codex review

Codex concurred with the verdict shape but rejected the milestone pricing on three of three borrows and surfaced two mechanics the initial comparison undersized:

1. **B1 (MCP server) needs an explicit no-write-back fence.** Mimir's MCP tools are mutable (`graph.tools.ts:14-30`); copying that shape into code-oz would create a second gate authority alongside `writeGate` / `approveGate` (`src/state/gates.ts:73-91`, `src/state/run.ts:378-430`). The borrow stays read-only at v0.1; if write-back ever lands, it writes *advisory request files*, not gates or canonical artifacts.

2. **B2 (OpenAI-compat) inverts the timing.** Land *after* PE-2 brings the second concrete HTTP adapter, then extract `OpenAICompatProvider` from two passing adapters. Codex cited concrete divergence quirks per provider (Together, Fireworks, OpenRouter, Groq, Ollama) that would force the abstraction to diverge if extracted from xAI alone.

3. **B3 (rate-limit queue) is an honest gap, not a production bug.** Defer until PE-2 or first real 429. Implement as a bounded per-`(provider, model)` FIFO wrapper around `IAgentProvider.invoke` with timeout/cancel + `events.jsonl` telemetry. Do not copy Mimir's hour-window singleton (`<templates-root>/Mimir/src/orchestrator/rate-limit-queue.ts:21-26`).

4. **The COMPARISON conflated Claudette prompt aliases with MCP tool names.** Claudette teaches `discover/store/link/recall` as cognitive aliases (`.agents/claudette-mimir-v3.yaml:67-77`); the MCP server actually exposes `memory_node`, `memory_edge`, `index_folder`, vector search, and todo tools (`README.md:451-474`). Synthesis below uses the corrected names.

5. **Two new file-based borrow candidates surfaced** that survive code-oz's discipline rules:
   - **B4** — Memory-hygiene rubric (`evolved_from`, `contradicts`, duplicate-check, store-at-durable-points) as input to the M17-M20 Reviewer Memory roadmap. File-based; no Neo4j.
   - **B5** — Ecko-as-checklist: a deterministic DEFINE / PLAN review checklist derived from Mimir's Ecko preamble structure (`docs/agents/v2/00-ecko-preamble.md:11-18`, `:77-122`), only if it tightens existing prompts. Not a new Prompter authority.

6. **N5 is reaffirmed but refined.** LLM-generated personas (Mimir's Agentinator, `src/api/orchestration/agentinator.ts:124-147`) remain no-borrow under rule 16. A *deterministic template renderer* that mechanically imports `universal-rules.md` and fills role-specific blanks is acceptable later — but not under "agentinator" naming and not before code-oz's persona count grows past current six.

---

## Locked borrow set

The borrows are renumbered to reflect the Codex modifications. Each entry has acceptance criteria; nothing ships without them.

### B1 — Read-only MCP-server adapter for code-oz run state (deferred, demand-gated)

**Scope.** A read-only MCP server bound to a specific `runId` that exposes:

- `phase_current` — current phase + transition history
- `gate_status` — gate-file states for each phase (passed / pending / blocked)
- `events_tail` — last N events from `events.jsonl`
- `artifact_read` — read a named artifact (`SPEC.md`, `PLAN.md`, `BUILD_REPORT.md`, etc.) by phase
- `budget_remaining` — cumulative budget headroom from `budgets.global` enforcement
- `intervention_pending` — current `NEEDS_INTERVENTION.json` if any

**Authority cost.** Zero new authority axis at the gate boundary. New integration-boundary authority (rule 20). Operates strictly downstream of the file system; reads gate files / events / artifacts; writes nothing.

**Permanent fence (project-level constraint).** **No write-back to gates or canonical artifacts, ever.** If write-back is added in a future milestone, it must write *advisory request files* (same shape as `NEEDS_INTERVENTION.json` — a request the next phase preflight may consider, not authority that bypasses gate validation). The fence is added to rule 1 as a clarification: file-based gates are written by `writeGate` / `approveGate` only; MCP tool calls are not gate writes.

**Acceptance criteria.**
- A named external consumer (Claude Code, Cursor, or another MCP client) requests programmatic access to a code-oz run's state. The borrow does not ship speculatively.
- The MCP server is a separate process spawned by `code-oz mcp serve --run <runId>`; it does not run inside the orchestrator's main loop.
- Each tool returns a structured response (typed) or an explicit error. No tool can mutate the file system.
- Tool responses honor rule 13 (privacy by default): file-size caps, secret redaction, no recursive directory exposure. The `artifact_read` tool reads only the explicit named artifact set; it does not expose arbitrary paths.
- An e2e test runs `code-oz mcp serve` against a completed run and asserts: (a) every tool returns the expected shape, (b) no tool can write any file, (c) attempting `artifact_read` on an unlisted path returns an explicit error, (d) the server emits MCP-call telemetry into the run's `events.jsonl` (read-only, append-event-only — the server does not own the events file, the orchestrator does).
- `docs/contracts/MCP_SERVER.md (to be created at B1 implementation)` documents the read-only fence and the advisory-request-file pattern for any future write-back.

**Milestone slot.** Post-SHIP / W4+. Earliest candidate: a "code-oz external integration" milestone after M17 (Reviewer Memory) ships. **Demand-gated.**

### B2 — `OpenAICompatProvider` extraction (after PE-2, two passing adapters)

**Scope.** A shared base class extracted from `XaiProvider` and a second concrete HTTP adapter (likely Groq, Together, or OpenRouter at PE-2). The base class enforces the strict request-body allowlist and audited trust boundary already established at PE-1 (`src/providers/xai.ts:1-21`, `:242-260`). Per-provider subclasses override only the divergence axes documented below.

**Authority cost.** No new authority axis if extracted from two passing adapters. The PE-1 trust-boundary discipline (rule 13, secret transmission audit) is the load-bearing constraint and must be preserved.

**Acceptance criteria.**
- PE-2 implements its second adapter as a *direct copy* of the `XaiProvider` shape, not as a use of an abstraction. Both adapters pass independently first.
- After both pass, the abstraction is extracted in a separate refactor commit. The extraction is reviewed against the divergence axes Codex documented:
  - **Together** — parameter and response-shape differences, ignored OpenAI fields, Together-specific usage/reasoning shapes.
  - **Fireworks** — extra request/response fields, different context-overflow behavior.
  - **OpenRouter** — `models`, `route`, `provider` routing fields.
  - **Groq** — prompt-caching changes usage / rate-limit interpretation.
  - **Ollama** — OpenAI shape locally; requires unused API key in SDK setup.
- The base class strict-allowlist is *additive only* (each subclass may extend it; none may relax it). A test enforces this against a frozen baseline.
- The trust-boundary audit (request body shape, header set, env-key read site) is repeated for every subclass added; `docs/research/CODEX_REVIEW_PE<n>.md` exists for each adapter.

**Milestone slot.** PE-2 follow-up commit (after the second adapter passes), not PE-2 itself.

### B3 — Pre-execution rate-limit queue (deferred until first 429)

**Scope.** A bounded per-`(provider, model)` FIFO wrapper around `IAgentProvider.invoke` that:

- Reads `ProviderCapability.rateLimits` (declared at M11) for the target `(provider, model)` and queues calls when in-flight RPM/TPM would breach the declared limit.
- Has explicit timeout and cancel behavior (a queued call that times out fires `NEEDS_INTERVENTION` with rate-limit context, not a silent stall).
- Emits queue/wait/drop telemetry into `events.jsonl` (`rate_limit_queued`, `rate_limit_waited`, `rate_limit_dispatched`, `rate_limit_dropped`) — Codex's `fix-soon` requirement to keep run state visible alongside rule-19 cumulative budget state.
- Does **not** copy Mimir's singleton hour-window FIFO (`rate-limit-queue.ts:89-102`, `:190-223`) — code-oz's queue is per-`(provider, model)`, request-and-token-shaped (not hour-shaped), and stateless across runs (re-reads the cap on each invocation).

**Authority cost.** Zero new authority axis. Operates as a provider-wrapper at the `invoke` boundary.

**Acceptance criteria.**
- A real 429 fires in PE-2 or later — the borrow ships in response to evidence, not speculation. (If PE-2 + PE-3 finish without ever hitting a 429, the borrow stays deferred.)
- `events.jsonl` telemetry shape is added to `docs/references/provider-contract.md § "Telemetry visibility for runtime queues"` before any queue code lands.
- An e2e test simulates a provider that throttles after N requests and asserts: (a) the wrapper queues correctly, (b) telemetry is emitted, (c) timeout produces a typed `NEEDS_INTERVENTION`, (d) cumulative budget enforcement (rule 19) still applies — the queue does not let calls bypass `assertWithinBudget`.

**Milestone slot.** Pre-execution-rate-limit milestone if a 429 fires; otherwise deferred indefinitely.

### B4 — File-based memory-hygiene rubric (input to M17-M20 Reviewer Memory)

**Scope.** A documented rubric (file, not code) that captures the durable parts of Claudette's memory pattern (`.agents/claudette-mimir-v3.yaml:28-51`):

- **Duplicate-check before store**: when storing a candidate "lesson" entry, search existing entries for fingerprint match before writing.
- **`evolved_from` link**: when a new lesson supersedes an old one, link forward and mark old as obsolete; do not delete (keeps the trail of why the lesson changed).
- **`contradicts` link**: when two lessons disagree, link them explicitly so the reader (or the M17+ retrieval surface) sees the disagreement instead of silently picking one.
- **Store-at-durable-points only**: skip ephemeral debugging, exploratory hypotheses, conversation-specific context. Codify the "what is durable" predicate explicitly.

**Authority cost.** Zero (it is a rubric, not code). The rubric is consumed by the M17-M20 Reviewer Memory milestones already on the ACE roadmap (see `docs/comparison/01-ace/SYNTHESIS.md` on the `feat/comparison-01-ace` branch; not yet merged to main as of this writing).

**Acceptance criteria.**
- `docs/contracts/REVIEWER_MEMORY.md` (existing or to be created at M17 kickoff) imports the rubric.
- The M17 design captures the four primitives (`duplicate-check`, `evolved_from`, `contradicts`, `store-at-durable-points`) as file-system operations on a per-repo `.code-oz/reviewer-memory/` directory; no DB.
- The borrow ships as a doc commit before M17 implementation begins.

**Milestone slot.** Pre-M17 doc commit (rubric capture). Implementation lands inside M17-M20.

### B5 — Ecko-as-checklist (DEFINE / PLAN review checklist)

**Scope.** Convert the structure of Mimir's Ecko preamble (`docs/agents/v2/00-ecko-preamble.md:11-18`, `:77-122` — gap analysis + deliverable enumeration) into a **deterministic** review checklist that is **advisory in v0.1** and **becomes blocking preflight only after the promotion-gate criteria (documented in the CHECKLISTS contract) fire**. The checklist is a Markdown file with explicit yes/no items; it is not an LLM call and not a new persona.

**Authority cost.** Zero new persona. **Advisory mode (v0.1):** no new authority axis — the checklist is a static rubric referenced by personas and reviewers; gate preflight does not consume it. **Blocking promotion (deferred):** consumes the relevant milestone's rule-20 authority budget per the promotion-gate criteria documented in `docs/contracts/CHECKLISTS.md`.

**Acceptance criteria.**

*Advisory ship (v0.1 — met by this branch):*
- The checklist is purely text; no LLM call, no new tool, no new permission.
- The checklist is referenced from `docs/contracts/SCIENTIST.md` (rule 15) so the Scientist tail's `OPEN_QUESTIONS.md` integration is consistent.
- The non-authority rule in the checklist contract explicitly forbids checklist items from being treated as gate signals while advisory.

*Blocking promotion (deferred until evidence):*
- At least one DEFINE-gate or PLAN-gate failure in `events.jsonl` history is identified that the checklist would have caught earlier.
- The failed condition maps to a specific item in the checklist.
- The proposed blocking check is deterministic and does not require LLM judgment.
- The promotion consumes the relevant milestone's rule-20 authority budget.
- A pre-merge fixture demonstrates the checklist catching the historical gap pattern.

**Milestone slot.** Inter-milestone polish commit when one of the named DEFINE / PLAN preflight failures recurs.

---

## Locked negative borrows (no-go list, with refinements)

| ID | What | Why no-borrow | Severity |
|---|---|---|---|
| N1 | Knowledge graph / Neo4j persistent memory | Architecture lock (no DB, file-only); product-thesis lock (repo IS memory); duplicates ACE M17-M20 Reviewer Memory roadmap intent. | Risk-3 if borrowed. |
| N2 | Web Studio + VS Code extension | Out of category — local-first repo-native CLI by deliberate commitment. UI/platform authority drift. | Risk-2 if borrowed. |
| N3 | LangGraph Python pipeline tier | Violates Bun + TS single-binary architecture lock. | Risk-3 if borrowed. |
| N4 | AWS Lambda distributed executor | Violates local-first thesis; adds sandbox/distributed execution authority. | Risk-3 if borrowed. |
| N5 | Agentinator LLM persona generation | Conflicts with rule 16 (universal anti-slop rules import); LLM-generated personas cannot be trusted to preserve mechanical universal-rules import. | Risk-3 if borrowed as-is. **Refined**: deterministic template renderer (no LLM call) is acceptable later if persona count grows past current six. |
| N6 | OAuth/RBAC multi-tenancy | Out of category; code-oz is single-user local; Mimir's multi-tenant story requires hosted-server product surface. | Risk-2 if borrowed. |
| N7 | NornicDB GPU-accelerated graph engine | Same architecture-lock + product-thesis violation as N1; adds GPU dependency that breaks single-binary distribution. | Risk-3 if borrowed. |

---

## New project-level constraints (added by this synthesis)

These are general rules that came out of the Mimir debate and apply beyond this comparison. They are added to the rule set but tracked here until the next CLAUDE.md update window.

**C-MIMIR-1: MCP write-back fence.** Any future MCP tool that wants to write into a code-oz run must write *advisory request files* in a dedicated request-queue directory (shape modeled on `NEEDS_INTERVENTION.json`). MCP tool calls cannot write gate files, cannot write canonical artifacts, and cannot append to `events.jsonl` directly. The orchestrator owns those writes; MCP-borne requests are advisory inputs to phase preflights. This clarifies rule 1 (file-based gate signals only) for the future MCP server surface.

**C-MIMIR-2: Telemetry visibility for runtime queues.** Any pre-execution gating or queueing wrapper around provider invocation (rate-limit queue, cost throttle, retry backoff) must emit typed events into `events.jsonl` with the same visibility as rule-19 cumulative budget enforcement. Invisible runtime state — queues, retries, throttles — beside visible budget state is a discoverability hole. Codify in `docs/references/provider-contract.md § "Telemetry visibility for runtime queues"` before any queue code lands.

**C-MIMIR-3: HTTP adapter abstraction extraction discipline.** A shared `OpenAICompatProvider` base class is extracted only after at least two concrete HTTP adapters pass independently. The PE-1 trust-boundary discipline (strict request-body allowlist, audited env-key read site) must be preserved across all subclasses. Each subclass adds its own `docs/research/CODEX_REVIEW_PE<n>.md`. The strict allowlist is additive across subclasses; no subclass may relax it.

**C-MIMIR-4: LLM-generated personas are forbidden.** Rule 16 (universal anti-slop rules import) cannot be enforced against an LLM-generated persona prompt because the universal-rules import is a mechanical text concatenation that the generation pass might rewrite or omit. Personas are hand-authored or rendered from deterministic templates only. This is a clarification of rule 16, not a new rule.

---

## Borrow ranking (post-Codex)

| Rank | Borrow | Slot | Authority cost | Acceptance gate |
|---|---|---|---|---|
| 1 | B5 — Ecko-as-checklist | Inter-milestone polish | None (gate-preflight item) | One DEFINE / PLAN-gate failure history-trace |
| 2 | B4 — Memory-hygiene rubric | Pre-M17 doc commit | None (doc) | M17 kickoff design integrates rubric |
| 3 | B3 — Rate-limit queue | First 429 milestone | None (provider wrapper) | Real 429 in PE-2+ |
| 4 | B2 — `OpenAICompatProvider` | PE-2 follow-up commit | None (refactor) | Two passing adapters |
| 5 | B1 — Read-only MCP server | Post-SHIP / W4+ | New integration boundary (rule 20) | Named external consumer |

The order reflects a "ship the cheapest, most discipline-aligned borrows first" rule: B5 and B4 are documentation work that sharpens existing prompts and contracts; B3 fixes a known honest-gap; B2 reduces drift after PE-2; B1 is the most ambitious and gated on real demand.

---

## Decision summary

- **Verdict:** YES, ahead on the disciplines that matter to code-oz, with five small selective borrows (B1-B5) and seven negative borrows (N1-N7).
- **Codex agreement:** `accept-with-modifications` (thread `019e12f0`).
- **New project-level constraints:** four (C-MIMIR-1 through C-MIMIR-4).
- **Block-borrow risks closed:** two (B1 write-back fence, B2 trust-boundary preservation).
- **Fix-soon items closed:** two (MCP-tool-name evidence corrected; rate-queue telemetry requirement codified).
- **Out-of-category surfaces correctly rejected:** seven (N1-N7).
- **Mimir's product-category lead is acknowledged** — code-oz does not compete in memory-native MCP-product space, and this is by deliberate commitment, not by gap.

The Mimir comparison closes here. Implementation work starts when the named acceptance criteria fire.

## Implementation status (as of 2026-05-10)

**Shipped in branch `feat/mimir-borrows`** (doc-only subset):

- B4 → `docs/contracts/REVIEWER_MEMORY.md`
- B5 → `docs/contracts/CHECKLISTS.md` (advisory; promotion gate documented)
- C-MIMIR-1 → `CLAUDE.md` rule 1 sub-paragraph
- C-MIMIR-2 → `docs/references/provider-contract.md` § "Telemetry visibility for runtime queues"
- C-MIMIR-3 → `docs/references/provider-contract.md` § "HTTP adapter abstraction extraction discipline"
- C-MIMIR-4 → `CLAUDE.md` rule 16 sub-paragraph

**Deferred per acceptance criteria**:

- B1 — read-only MCP-server adapter (gate: named external consumer, post-SHIP / W4+)
- B2 — `OpenAICompatProvider` extraction (gate: PE-2 second adapter passes independently)
- B3 — pre-execution rate-limit queue (gate: first 429 observed; telemetry shape pre-codified per C-MIMIR-2)
