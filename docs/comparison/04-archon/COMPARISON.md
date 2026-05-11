---
name: comparison-archon
template-path: ~/Projects/agents/templates/Archon
template-version: 0.3.10 (Bun monorepo, snapshot 2026-05-08)
companion-docs: ../../adr/0001-mvp-option-e.md, ../../references/provider-contract.md, ../../contracts/WORKTREE.md
target: borrow-decision record + Codex debate setup for Archon vs code-oz
status: FINAL — locked 2026-05-10 after Codex round-2 source-level pass returned `lock-final` (4 corrections applied; round-3 verification of faithful application captured in CODEX_ROUND3_RESPONSE.md)
decision: YES, code-oz is ahead **on the discipline axes that matter to code-oz**, with selective borrows (post-round-2 set; see SYNTHESIS sections below)
prior-borrows: IAgentProvider interface, worktree-per-run isolation (CLAUDE.md influence library)
---

# code-oz vs Archon

## What Archon is, in one paragraph

Archon (`coleam00/archon`, MIT) is an open-source **harness builder for AI coding** — a Bun monorepo (v0.3.10) that ships 17 default workflows and binds them to multi-platform adapters (Web/SSE, CLI, Slack, Telegram, GitHub, Discord, Community). Core packages are `@archon/providers` (provider abstraction), `@archon/isolation` (git-worktree isolation), `@archon/workflows` (DAG engine + event emitter), `@archon/core` (config/state), `@archon/cli`, `@archon/server` (HTTP), `@archon/web` (React UI), `@archon/adapters/*`, plus an `auth-service`, SQL `migrations/`, a `Dockerfile` + `docker-compose.yml`, a Caddy reverse-proxy example, and a `homebrew/` tap. Workflows are YAML DAGs of nodes; each node executes through `IAgentProvider.sendQuery` and emits typed events (`workflow_started`, `loop_iteration_*`, `node_*`, `rate_limit_*`, `session_transition`, `workflow_artifact`). Provider capabilities are declared statically (`sessionResume`, `mcp`, `hooks`, `skills`, `agents`, `toolRestrictions`, `structuredOutput`, `envInjection`, `costControl`, `effortControl`, `thinkingControl`, `fallbackModel`, `sandbox`). Three providers are bundled in the registry: two first-party built-in (`builtIn: true`) — Claude (CLI subprocess) and Codex (CLI subprocess) — plus Pi as bundled community (`builtIn: false`, `packages/providers/src/community/pi/registration.ts:15-23`). Cost is post-execution telemetry on `MessageChunk.result.cost`. State is a workflow run with explicit `pending|running|completed|failed|cancelled|paused` statuses; terminal and resumable subsets are constants.

## What code-oz is, restated for contrast

code-oz is a Bun + TypeScript **repo-native agentic SDLC runtime** with file-based gate signals, schema-validated artifacts, cross-family adversarial review, run-level cumulative budget enforcement, multi-provider abstraction, worktree-per-run isolation, permission manifests, `NEEDS_INTERVENTION` discipline, and one new authority boundary per milestone. Through M16 it has shipped: provider capability contract (M11), company roster (M12), role-cost policy (M13), reviewer panel v1 (M14, first simultaneous-provider surface), debate-policy scheduler v1 (M15, single-opponent), production CLI completion (M16). 3108 tests pass offline. PE-1 added the first HTTP adapter (xAI). Distribution is `bun build --compile` single-file binary plus npm + Homebrew + Scoop.

## Domain boundary

Archon is a **multi-platform AI harness builder** designed to be deployed (Docker, Caddy, auth-service, Postgres-or-SQLite, web UI) and surfaced through chat platforms and bots. Its unit of work is a workflow run on a server, optionally triggered by an Issue / PR / Review / Thread / Task event, with isolated git worktrees per trigger. code-oz is a **local-first repo-native CLI** whose unit of work is a single SDLC run on a developer's machine, gated through six phases against schema-validated artifacts. Roughly 60 percent of Archon's surface area — Web/Slack/Telegram/Discord adapters, auth-service, Docker deployment, React UI, multi-tenant migrations — is out of category for code-oz. The 40 percent that overlaps is the provider abstraction, worktree isolation, event model, capability declaration, run state, and cost tracking. This comparison focuses on the overlap.

## Feature matrix

Legend: **A** = Archon, **C** = code-oz. `=` overlap; `>` ahead; `<` behind; `n/a` out of category.

| Surface | A | C | Notes |
|---|---|---|---|
| Provider abstraction | `IAgentProvider.sendQuery` async-gen of `MessageChunk` | `IAgentProvider.invoke` async-iter of `ProviderEvent` | `=` Same shape, both stateless, both streaming. code-oz adds `health()` and `family/capability` as readonly fields. |
| Provider implementations | 2 built-in (Claude CLI, Codex CLI) + 1 community-bundled (Pi); registry total 3 | 5 concrete: Claude (CLI), Codex (CLI), Gemini (stub w/ `eligiblePhases: NO_PHASES`), Fake (offline), xAI (HTTP, PE-1) | `>` code-oz has the first HTTP adapter wired with audited trust boundary; Archon hasn't crossed CLI→HTTP yet for first-party. |
| Static capability declaration | `ProviderCapabilities` (13 flags) on `ProviderRegistration` | `ProviderCapability` (M11) — `authSource`, `eligiblePhases`, `costPerMTok?`, `rateLimits?` + structural equality at registration | `=` Both treat capabilities as declared truth. Archon's flag set is wider (`mcp`, `hooks`, `skills`, `agents`, `toolRestrictions`, `effortControl`, `thinkingControl`); code-oz's is phase-eligibility-shaped. |
| MessageChunk / Event union | 8 variants incl. `workflow_dispatch`, stable `toolCallId` | 5 core variants (`turn_started`, `content_chunk`, `tool_call`, `tool_result`, `turn_completed`) | `<` Archon has `toolCallId` for concurrent tool/result pairing; code-oz CLI providers do not yet surface mid-turn tool events at all. Borrow candidate B5. |
| Worktree isolation | `IIsolationProvider.{create,destroy,get,list,adopt?,healthCheck}` discriminated by `workflowType` (Issue / PR / Review / Thread / Task) | `createRunWorktree` + `loadOrCreateRunWorktree` (M16 idempotent) + `removeRunWorktree` + `forensics` | `=` Both isolate per unit of work. code-oz adds idempotent reentry, audit-completeness recovery, and orphaned-partial-state intervention. Archon's discriminated request union is wider (5 trigger types) because Archon is multi-trigger; code-oz is single-trigger. |
| Cleanup result granularity | `DestroyResult { worktreeRemoved, branchDeleted, remoteBranchDeleted, directoryClean, warnings[] }` | `RemoveRunWorktreeResult = Ok \| Failed { code, reason }` | `<` Archon reports partial-failure granularly; code-oz is binary. Borrow candidate **B1** (becomes load-bearing in M17 `ship` + W2 `prune`). |
| Concurrent run safety | `GIT_OPERATION_TIMEOUT_MS = 5min`; cleanup is best-effort | `withLock(lockDir, fn)` advisory mkdir locks (per-run, per-phase in M16); typed `LockBusyError` → intervention | `>` code-oz has a real lock model; Archon documents partial-failure but no hold-time guarantees. |
| Run state machine | `pending|running|completed|failed|cancelled|paused`; `TERMINAL_*` and `RESUMABLE_*` as constants | DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP linear FSM with `validateTransition`; restart-on-fail (M8) handled by re-entry without explicit "resumable" set | `=` Both encode lifecycle. Archon is generic-DAG with status sets; code-oz is fixed-phase with profile validation. Archon's explicit constants are formalization worth borrowing as a doc/typeguard. Borrow candidate **B2**. |
| Phase-gate authority | None — workflow nodes are YAML, completion is "node finished without error" | `state/GATE_<PHASE>_PASSED.json` schema-validated by `src/state/gates.ts`; never parse LLM text for pass/fail (rule 1) | `>` code-oz only. Archon does not have a gate-file authority model; node completion is the implicit signal. |
| Cross-family review | Not enforced (any provider can run any node); CLAUDE.md mentions "phase-gated development" but no review provider constraint visible in code | Mandatory at REVIEW gate (rule 2); panelist quorum 2 with same-family advisory-only authority (M14) | `>` code-oz only. Cross-family review is a structural property of the spine, not a workflow choice. |
| Debate runtime | Not present | `requestDebate()` primitive (M10); auto-trigger scheduler (M15, single-opponent) | `>` code-oz only. |
| Universal anti-slop rules | Not present | Rule 16 + `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations) imported into every persona | `>` code-oz only. |
| Maestro discipline | Not present | Rule 17 + `docs/research/01-maestro-rule-checker.md` (rule-checker, 9-family bug map, four-layer FS memory) | `>` code-oz only. |
| Scientist tails / hypotheses | Not present | Rule 15 + `docs/contracts/SCIENTIST.md` + `HYPOTHESES.md` / `OPEN_QUESTIONS.md` blocked at gate preflight | `>` code-oz only. |
| 3-source verification | Not present | Rule 3 + `SOURCE_CHECK.md` blocks PLAN gate | `>` code-oz only. |
| Permissions / sandbox | `ProviderCapabilities.sandbox` flag + `NodeConfig.allowed_tools / denied_tools` | Permission manifest required for any `.ts` escape-hatch (rule 9); `tool_use.repo_context` permission scope (rule 18); deny network for repo_context tools | `>` code-oz only. Archon delegates to provider/SDK; code-oz has its own scope vocabulary. |
| Run-level cumulative budgets | Per-call `maxBudgetUsd`; post-execution cost telemetry | `budgets.global` (`maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`, optional `priceTable`); `assertWithinBudget` reads `events.jsonl` cumulative; soft warn at `softWarnAtRatio`; hard kill → `NEEDS_INTERVENTION` (rule 19); per-role caps (M13) | `>` code-oz only. Archon's budget is per-call; code-oz's is per-run with mandatory cumulative enforcement. |
| Resume / idempotency | `forkSession`, `persistSession`, `resumeSessionId`; `parent_conversation_id`; status set explicitly RESUMABLE | `runId`, idempotent gate writes, `code-oz resume` (rule 12); idempotent `loadOrCreateRunWorktree` (M16); audit-completeness forensics walk (M16 R1 fix) | `=` Both have it. Archon's is conversation-shape; code-oz's is run-shape. Different units. |
| Privacy by default | Not visible — workflows can read repo as configured | `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview, agents receive explicit file manifests, never silent recursive context (rule 13) | `>` code-oz only. |
| Brownfield AUDIT artifact | Not present | Brownfield profile + `AUDIT.md` (rule 14) | `>` code-oz only. |
| Event emission | `WorkflowEventEmitter` singleton, fire-and-forget, listener errors swallowed; 10+ typed events | Append-only `events.jsonl` per run; phase code reads/appends through pure helpers | `<` for hook fan-out specifically — Archon's emitter is the right shape for in-process observers. Borrow candidate **B3** (NOT for gates). |
| DAG workflow engine | YAML DAG with conditional edges; 17 default workflows | Fixed phase taxonomy, no DAG | `n/a` Deliberate divergence. Rule 20 ("one new authority per milestone") cannot be enforced against an open-ended graph. code-oz is correct to refuse the DAG. |
| Multi-platform adapters | Web/SSE, CLI, Slack, Telegram, GitHub, Discord, Community (`@archon/adapters/*`) | CLI only | `n/a` Out of code-oz's category. The "AI software company" thesis (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`) commits to repo-native; multi-platform fan-out belongs to a different product. |
| Web UI / server | React `@archon/web` + Express-style `@archon/server` (`/api/health`) | `code-oz doctor run` read-only state inspector (M16) | `n/a` Out of category. |
| Auth service | Standalone `auth-service/` (user accounts, presumably OAuth) | Subprocess delegation to provider CLIs (Claude, Codex login); API-key transmission discipline for HTTP adapters (PE-1) | `n/a` Out of category. code-oz is single-user local-first; Archon is multi-tenant deployable. |
| Migrations / persistence | SQL migrations under `migrations/`; SQLite default, optional Postgres | Files only — `events.jsonl`, gate JSONs, Markdown artifacts; no SQLite v0.1 (architecture lock) | `n/a` Out of category. code-oz commits to file-only persistence per architecture lock. |
| Distribution | Pre-built Docker image `ghcr.io/coleam00/archon:latest`; docker-compose + Caddyfile; homebrew tap | `bun build --compile` single binary; npm + Homebrew + Scoop with auto-PATH-patch (W3+) | `=` Both have a distribution story. Different shapes — Archon is server-deploy; code-oz is local CLI. |
| Cross-model peer review at every milestone | Not enforced as workflow rule | Mandatory (CLAUDE.md "Cross-model peer review (durable rule)") — Codex debate at planning convergence + Codex review at implementation completion, every milestone | `>` code-oz only. This is a process commitment Archon does not make. |

## What Archon has that code-oz lacks

A1. **Granular cleanup result reporting (`DestroyResult`)**. Archon's `IIsolationProvider.destroy(envId, options)` returns `{ worktreeRemoved, branchDeleted, remoteBranchDeleted, directoryClean, warnings[] }` rather than a boolean. Concurrent-cleanup-safe by construction: an operator can read warnings and decide whether to retry, accept partial success, or escalate. code-oz's `RemoveRunWorktreeResult` is binary (`Ok | Failed { code, reason }`) because today's cleanup is exactly one git op. The shape becomes load-bearing as soon as cleanup grows multi-step (branch removal, remote prune, registry update, run-dir compaction). M17 `ship` + W2 `prune` are the natural insertion points.

A2. **Explicit `TERMINAL_WORKFLOW_STATUSES` and `RESUMABLE_WORKFLOW_STATUSES` constants**. Archon's workflow run schema commits to explicit subset constants. code-oz's M8 restart-on-fail behavior is implicit: an operator runs `code-oz run` again, the loader notices the existing run, skips earlier-passed phases, and re-enters the failed phase. The semantics are right; the constants are missing. A small TS module — `RESUMABLE_PHASES`, `TERMINAL_PHASES` — and a typeguard at the FSM boundary would make `code-oz resume` failures self-explanatory and would catch a class of "tried to resume a SHIPped run" bugs at compile time.

A3. **Fire-and-forget `WorkflowEventEmitter` for in-process observers**. Archon emits typed events to a singleton emitter; listeners cannot block or crash the executor. Errors thrown by listeners are swallowed. This is the right shape for **hook fan-out only** — anything that wants to subscribe to phase progress for telemetry, dashboards, or local notifications without polluting the gate-file authority model. code-oz today writes everything to `events.jsonl` and lets readers tail the file. That works for durable inspection and external tools, but it is awkward for in-process subscribers (a reviewer-panel UI surface, a future `code-oz watch` command). The borrow is narrow: an in-process emitter that fans out the same events `appendEvent` already writes; gates and authority signals stay file-based per rule 1.

A4. **Discriminated request union for isolation contexts**. Archon's `IsolationRequest = IssueIsolationRequest | PRIsolationRequest | ReviewIsolationRequest | ThreadIsolationRequest | TaskIsolationRequest`. Each carries trigger-specific metadata (PR adds `prBranch`, `prSha`, `isForkPR`; Task adds `fromBranch`). code-oz today has a single run shape. The pattern is interesting but speculative — borrowing it would only earn its keep if code-oz adds a second trigger type (e.g., a `code-oz audit-pr` mode that runs against a GitHub PR rather than a local branch). Not load-bearing today; tracked for the eventual `external-trigger` milestone if it ever lands. **No-borrow today**.

A5. **Stable call-id correlation across tool events**. Archon's `MessageChunk.tool` and `MessageChunk.tool_result` carry a `toolCallId` from the underlying SDK so concurrent calls pair correctly. code-oz's CLI-hosted providers do not surface mid-turn tool events at all — Claude and Codex CLIs handle tool execution internally and the spine sees a content stream. **Refined in round-2 source review**: `ProviderToolCall.id` already exists in code-oz at `src/providers/types.ts:126-130`; the actual gap is on the **result side**, where the `tool_result` event variant at `src/providers/types.ts:152-157` lacks a matching correlation field. The borrow lands when code-oz wires direct-HTTP adapters that do see mid-turn tools (PE-2 onward). The work is "add matching `toolCallId` to the `tool_result` event variant + define call/result pairing semantics," not "add a duplicate `toolCallId?` to `ProviderToolCall`." **Borrow candidate B5** — small, defensive (see round-2 synthesis for the corrected scope).

A6. **Wider capability flag set**. Archon's `ProviderCapabilities` declares 13 flags including `mcp`, `hooks`, `skills`, `agents`, `effortControl`, `thinkingControl`, `fallbackModel`, `sandbox`. code-oz's `ProviderCapability` is phase-eligibility-shaped (`eligiblePhases`, `authSource`, `costPerMTok?`, `rateLimits?`). Different axes. Archon's flags describe runtime knobs; code-oz's describe gate authority. **No-borrow**: rule 20 ("one new authority per milestone") makes flag inflation actively harmful; code-oz earns each capability by milestone.

## What code-oz has that Archon lacks (the disciplines that justify the category)

C1. **File-based gate signals only (rule 1)**. `state/GATE_<PHASE>_PASSED.json` schema-validated by `src/state/gates.ts`. The orchestrator never parses LLM text for pass/fail. Archon's "node completed without error" is a weaker contract — a node that hallucinated a successful completion in its message text would still pass.

C2. **Cross-family review at REVIEW gate (rule 2)**. Reviewer must be a different provider family than Builder. M14 reviewer panel quorum is two cross-family voters; same-family panelists raise findings but their authority is advisory unless an eligible voter independently raises the same fingerprint. Archon does not encode this constraint.

C3. **3-source verification before code (rule 3)**. PLAN cannot pass without `SOURCE_CHECK.md` (spec + reference code + library docs). Archon does not require this.

C4. **Run-level cumulative budget enforcement (rule 19)**. `budgets.global` with `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxWallTimeMinutes`, soft warning at `softWarnAtRatio` (default 0.75), hard kill → `NEEDS_INTERVENTION` with actionable suggestion. Per-role caps under the same namespace (M13). Archon tracks per-call cost post-execution; code-oz enforces cumulative budgets pre-execution against `events.jsonl`.

C5. **Universal anti-slop rules (rule 16)**. `src/prompts/universal-rules.md` (10 prohibitions + 10 affirmations) imported by every persona prompt. Personas may add rules below; they may not relax universal ones. Archon does not encode persona-prompt discipline.

C6. **Maestro discipline (rule 17)**. The rule-checker role + 9-family bug map + adversarial-review skills + four-layer FS memory documented in `docs/research/01-maestro-rule-checker.md`. Personas reference the dossier; the orchestrator implements the skills. Archon does not have an equivalent disciplinary spine.

C7. **Scientist tails (rule 15)**. Every phase contract producing a primary artifact must include the Scientist tail: `HYPOTHESES.md` + `OPEN_QUESTIONS.md`, gate preflight blocks overdue open questions. Archon has no analog.

C8. **Permission manifest for any `.ts` escape hatch (rule 9)**. Allowed commands, network, file roots, env vars, timeout, secret access. Default: no execution. Archon delegates sandboxing to providers via the `sandbox` capability flag.

C9. **Privacy by default (rule 13)**. `.code-ozignore`, secret redaction, file-size caps, "files sent to provider" preview per phase. Agents receive explicit file manifests, never silent recursive repo context. Archon ships full repo recursive context unless the workflow node is configured otherwise.

C10. **Brownfield AUDIT artifact (rule 14)**. Brownfield profile starts at AUDIT, not DEFINE. Archon does not distinguish greenfield from brownfield work.

C11. **One new authority boundary per milestone (rule 20)**. M11 = capability contract, M12 = roster, M13 = role-cost, M14 = reviewer panel, M15 = debate-policy scheduler, M16 = production CLI completion. Archon's authority growth is unconstrained — the workflow DAG is open-ended.

C12. **Risk-reduction-measurable parallel-provider expansion (rule 21)**. Multi-agent / multi-provider features land only when their effect is measurable in `events.jsonl` against the single-provider baseline. Archon does not encode this discipline.

C13. **Cross-model peer review at every milestone (durable workflow rule)**. Codex debate at planning convergence + Codex review at implementation completion, every milestone. Empirically validated 2026-04-29 (Codex flipped the MVP from Option C to Option E) and many times since (e.g., M16 12 production bugs caught and closed across 3 review rounds). Archon does not encode this process.

C14. **Explicit `gate_required` event + supersedence-by-`gate_written` semantics** (post-Codex-round-2 credit). code-oz already records pending-approval state as a positive `gate_required` event in `events.jsonl` (`src/state/schemas.ts:92-100`, emitted via `src/state/run.ts:868-945`); active pending state is computed as "latest `gate_required` not later satisfied by `gate_written`" (`src/commands/run.ts:690-707`). This is what Archon's `approval_pending` event provides — code-oz already has it, and the supersedence-by-gate-write logic is *more* operationally precise than Archon's transient pending flag because it is replayable from the durable log. Round-1 missed this credit and round-2 surfaced it.

C15. **`run_ended` with `outcome` field covers cancel semantics** (post-Codex-round-2 credit). code-oz's `run_ended` event already carries an `outcome` field that includes `stopped` and `paused` values (`src/state/schemas.ts:421-422`). Archon's `workflow_cancelled` event is a separate channel that code-oz collapses into the unified terminal event. Adding a distinct `run_cancelled` event would only earn its keep if cancel becomes semantically distinct from stop — currently it does not.

## Decision: YES, with three small selective borrows

code-oz already extracted the two patterns that mattered (provider abstraction shape, worktree-per-run isolation) and has evolved them through M11/M13/M16 without architectural drift. The remaining Archon surface area is divided into three buckets:

- **Out of category (no-borrow)**: multi-platform adapters, Web UI, auth-service, Docker/Caddy deployment, migrations, DAG flexibility. ~60% of Archon. code-oz is local-first repo-native by deliberate commitment; absorbing any of this would betray the product thesis.
- **Discipline gaps Archon also has (no-borrow)**: file-based gate authority, cross-family review enforcement, universal anti-slop rules, maestro discipline, scientist tails, 3-source verification, permission manifests, privacy-by-default, run-level cumulative budgets, brownfield AUDIT, rule 20, rule 21, cross-model peer review. ~13 distinct disciplines code-oz has and Archon lacks. These are the load-bearing reasons code-oz exists as a separate product.
- **Selective borrows (3 small mechanics)**:
  - **B1** — Granular cleanup result type for M17 `ship` / W2 `prune` (when removal grows multi-step). Track in M17 kickoff.
  - **B2** — Explicit `TERMINAL_PHASES` / `RESUMABLE_PHASES` constants + typeguard at FSM boundary. Small, defensive, self-contained. ~50 LOC + tests. Suitable for an inter-milestone refactor commit.
  - **B3** — Fire-and-forget in-process event emitter for hook fan-out only (NOT for gates). Same events that `appendEvent` writes; subscribers are advisory; listener errors swallowed. Suitable for the eventual `code-oz watch` / dashboard surface — defer until that demand exists. Track as candidate, do not borrow yet.
  - **B5** (optional, **refined in round-2**) — Add matching `toolCallId` to the `tool_result` event variant for call/result pairing under concurrency (call side already has `ProviderToolCall.id`; gap is on the result side). Could land in PE-2 if HTTP mid-turn tool visibility opens.

**Score**: code-oz is ahead of Archon on 13 disciplinary axes, even with the post-round-2 borrow set (B1, B2, B5 active borrows; B3, B6, B7 tracked as candidates) folded in. The two seed borrows (`IAgentProvider`, worktree isolation) have absorbed M11/M13/M16 evolution cleanly without drifting from Archon's intent — verifying the influence-library policy works.

**Ranked borrow set**:

1. B2 — `TERMINAL_PHASES` / `RESUMABLE_PHASES` constants (inter-milestone refactor; ~50 LOC).
2. B1 — Granular cleanup result type at M17 (when removal grows multi-step; otherwise speculative).
3. B5 (**refined in round-2**) — Matching `toolCallId` correlation on the `tool_result` event variant at PE-2 (call side already has `ProviderToolCall.id`; result-side gap at `src/providers/types.ts:152-157`).
4. B3 — In-process event emitter (defer until `code-oz watch` / dashboard demand exists).

A4 (discriminated isolation request union), A6 (wider capability flags), and the entire Archon out-of-category set explicitly do not borrow.

## Open questions for Codex debate

Q1. **Is B2 worth the inter-milestone effort, or does the implicit M8 restart-on-fail mechanism already cover the failure modes that explicit constants would catch?** Specifically: name a real bug that compile-time `RESUMABLE_PHASES` would prevent that runtime FSM `validateTransition` does not already catch.

Q2. **Is B3 actually a no-borrow disguised as a defer?** If the file-based event log is canonical and any in-process observer can tail it, is there ever a reason to add a second emission surface? Or is fan-out through a single sink (the file) cleaner? Argue the strongest case against ever borrowing B3.

Q3. **Does Archon's discriminated-request isolation pattern actually predict a code-oz future state**, or is the pattern a Chesterton fence specific to multi-trigger harnesses? If the eventual `audit-pr` or `external-trigger` milestone lands, would code-oz reach for this pattern, or would a simpler per-trigger constructor (e.g., `createPrAuditRun(...)`) be more in keeping with rule 20?

Q4. **Where would Archon's authority model break under code-oz's high-stakes constraints?** Specifically: if code-oz adopted the "node completes without error → phase passes" semantics, which of the 12 production bugs caught in M16 R1 would Archon's model have missed?

Q5. **Is the comparison missing any Archon pattern that would be a load-bearing borrow if code-oz scales beyond single-developer single-run usage?** For example, when multi-run parallelism arrives (currently deferred), does Archon's lock-free best-effort cleanup model become attractive, or does code-oz's advisory-mkdir-lock model still win?

## Process notes

- This comparison was prepared from two parallel Explore-agent reports (Archon mapping + code-oz current state), file-grep verification of three specific surfaces (`TERMINAL_*` / `RESUMABLE_*` constants, `RemoveRunWorktreeResult` shape, `tool_call` event surfacing), and direct reads of `IAgentProvider` / `IIsolationProvider` interfaces in both repos.
- Codex pressure-test dispatched 2026-05-10 via `codex exec --model gpt-5.5` after three failures of the MCP `mcp__plugin_agent-codex_codex-native__codex` path against a flaky upstream `chatgpt.com/backend-api/codex/responses/compact` endpoint. Final response captured under strict "no source exploration" scope (26.5k tokens) — full transcript in `CODEX_RESPONSE.md`.
- See SYNTHESIS section below for the post-debate decision set.

## Synthesis after Codex review

Codex returned `accept-with-modifications` on the decision, the borrow set, and the timing. Five modifications absorbed below; nothing rejected.

### Decision (post-Codex wording)

**YES, code-oz is ahead of Archon on the discipline axes that matter to code-oz** — gate authority, cross-family review, cumulative budgets, permission discipline, privacy, and milestone authority control. The "ahead" claim is **category-scoped**: Archon is ahead of code-oz as a deployable multi-platform harness builder. The two products live in different categories. The thesis (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`) commits code-oz to repo-native; Archon's lead in deployable / multi-tenant / chat-platform surface area is real and not a gap for code-oz.

### Final borrow set (post-Codex)

| ID | Mechanic | Status | Trigger condition |
|---|---|---|---|
| B1 | Granular `DestroyResult` cleanup shape | **borrow at M17** (cleanup grows multi-step in `ship` + `prune`) | M17 kickoff |
| B2 | `TERMINAL_PHASES` / `RESUMABLE_PHASES` + typeguard at FSM boundary | **borrow only if it consolidates scattered recovery semantics** | inter-milestone; gated on Codex Q1 reframe — value is removing duplicated "recoverable phase" logic and making `resume` failure messages deterministic, NOT compile-time type safety |
| B3 | In-process event emitter for hook fan-out | **defer with a very high bar** (downgrade from "defer") | only if a named UI/watch milestone proves `events.jsonl` tail cannot satisfy a concrete requirement. Even then: persisted events only by default; ephemeral-only events need separate written justification |
| B5 (reframed in round-2) | Add matching `toolCallId` correlation to the `tool_result` **event variant** (call side already has `id` at `src/providers/types.ts:126-130`; result side at `src/providers/types.ts:152-157` lacks the matching field — that is the actual gap). Define call-id pairing semantics. | **borrow at PE-2 IF and only if PE-2 introduces HTTP mid-turn tool visibility** | scoped strictly to correlation between existing `tool_call` and `tool_result` events. NOT the start of a tool-event redesign. The wider questions (who executes tools, who authorizes, how budgets count, gate-relevance of tool results) need their own milestone surface |
| B6 | `adopt(path)` for crash-recovery + operator-driven forensics | **borrow at M17 alongside B1** (re-categorized from Q5 footnote) | partial-state + operator recovery sibling of B1; both reject binary cleanup assumptions |
| B7 (candidate) | Explicit `paused` state for operator suspension | **defer until long-running runs / watch mode demand it** | distinct from `NEEDS_INTERVENTION` (failure-with-resume) and `failed` (terminal). Track but do not borrow |
| A4 | Discriminated `IsolationRequest` union | **no-borrow** | single-trigger today; `audit-pr` (if it lands) reaches for `createPrAuditRun(...)` constructor first; discriminator added only after ≥2 external trigger types diverge |
| A6 | Wider 13-flag capability set | **no-borrow** | rule 20 ("one new authority per milestone") makes flag inflation actively harmful; code-oz earns each capability declaration by milestone |

### Process action items from the "anything missed" review

1. **Event taxonomy audit (separate from B3)**. Codex flagged that Archon's `loop_iteration_*`, `rate_limit_*`, `session_transition`, `workflow_artifact` events are more useful as a checklist of what code-oz intentionally records or rejects than as evidence for adding an in-process emitter. Action: when M16 follow-up work or M17 kickoff opens, scan `src/state/events.ts` against this Archon vocabulary and decide explicitly which events code-oz wants and which it rejects. No code change required from this comparison; the audit is an item for the next milestone-relevant session.

2. **B2 must consolidate, not decorate**. Codex's strongest pushback: phase-set constants are decorative unless `resume`, `forensics`, `lock`, and `validateTransition` all route through them. If B2 lands and any of those four call sites still has its own implicit "recoverable phase" logic, the constants are stale-documentation-with-type-syntax. The B2 implementation contract is therefore: (a) define the constants, (b) refactor all four call sites to consume them, (c) add a single typeguard helper at the FSM boundary, (d) tests cover all four sites against the same source of truth. Anything less is no-borrow.

3. **B5 framing language matters**. Codex elevated risk #1 to "Trojan horse for wider provider-event redesign." When B5 lands, the PR description and the contract update must explicitly state: "this is correlation metadata on already-emitted tool events; it does not pre-approve mid-turn HTTP tool surfacing, tool authorization, tool budget counting, or tool-result gate authority." Each of those is a separate milestone authority boundary under rule 20.

### Q1 reframe (Codex correction)

The earlier B2 rationale ("compile-time type safety prevents resume of SHIPped run") was wrong as written. A constant alone does not enforce anything unless every resume entrypoint routes through the typeguard, and runtime `validateTransition` already catches the "resume of SHIPped run" case (terminal phase has no in-progress predecessor; resume finds nothing to resume). The corrected B2 value statement is: **B2 consolidates scattered "this phase is recoverable" decisions (currently distributed across `forensics.ts`, `loadOrCreateRunWorktree`, `validateTransition`, `code-oz resume`) into a single named source of truth, and produces deterministic operator-facing error messages on resume failure.** That is the test for whether B2 earns its keep.

### Verdict on the comparison exercise (Codex's process critique, accepted)

Codex's verdict was conditional: **load-bearing for v0.2 / v1.0 IF the comparison series produces a defensible influence-library ledger** — release-facing claims, roadmap constraints, explicit no-borrow records — **not load-bearing if each session keeps rediscovering "we're ahead" in narrative form.** Action: the four-template archive (`01-ace`, `02-agenticSeek`, `03-aris`, `04-archon`) needs a single ledger document at v0.2 cut or earlier that lists every borrow (with milestone target), every no-borrow (with reasoning that protects the product thesis), and every reopen-condition. This document is the deliverable that turns the comparison series from polishing brass into a defensible v0.2 release pitch ("here's what we copied, here's what we deliberately did not, here's why"). Tracked as a deliverable for the v0.2 release prep, not for this session.

### Closure

The Archon comparison is closed under: **YES, code-oz is ahead on the discipline axes that matter, with the modified borrow set above.** The two seed borrows (`IAgentProvider`, worktree-per-run isolation) verified; six new candidates ranked (B1, B2, B3, B5, B6, B7); two no-borrows recorded with reasoning (A4, A6); three process action items captured. **Both Claude (Opus 4.7, this session as orchestrator) and Codex (gpt-5.5 xhigh, two source-level review rounds + one faithfulness verification) explicitly converge on `lock-final` as of 2026-05-10.** See round-2 synthesis below for source-level corrections folded in.

## Synthesis after Codex round-2 (source-level pass)

A second source-level review was run 2026-05-10 with Codex granted `workspace-write` sandbox + `--add-dir ~/Projects/agents/templates/Archon`. Two parallel Opus Explore agents preloaded the round with (a) deep-scan of Archon surfaces round-1 could not read (`@archon/core`, `dag-executor`, `@archon/server`, `@archon/cli`, `@archon/adapters`, `@archon/git`, `@archon/paths`, `auth-service`, `migrations`) and (b) a fact-check of 18 specific COMPARISON.md claims against `code-oz/src/`. Fact-check result: **16 confirmed, 2 cannot-verify (forward-looking design policy / integration features), 0 wrong**. Codex round-2 verdict: **`lock-final` after four corrections** (full transcript in `CODEX_ROUND2_RESPONSE.md`).

### Round-2 corrections folded in

1. **B5 reframed**. `ProviderToolCall.id` already exists in code-oz at `src/providers/types.ts:126-130` — round-1 mischaracterized this. The actual gap is on the *result side*: `tool_result` event at `src/providers/types.ts:152-157` does not carry a matching correlation field. B5 is now "add matching `toolCallId` to the `tool_result` event variant for call/result pairing under concurrency," not "add `toolCallId?` to `ProviderToolCall`." Folded into the borrow table above.

2. **Archon provider count refined**. Archon has **3 wired/bundled** provider registrations (Claude, Codex, Pi) but only **2 first-party built-in** (`builtIn: true` — Claude, Codex per `packages/providers/src/registry.ts:108-124`). Pi is bundled-community (`builtIn: false` per `packages/providers/src/community/pi/registration.ts:15-23`). One-paragraph and feature-matrix wording updated.

3. **`approval_pending` is not a borrow — code-oz already has it**. Round-1 deep-scan missed that code-oz emits a positive `gate_required` event with supersedence-by-`gate_written` semantics. The recommendation to "add `approval_pending`" is withdrawn. New C14 entry added crediting code-oz for the existing mechanism.

4. **`run_cancelled` is not a borrow either**. code-oz's `run_ended.outcome` field (with values including `stopped` and `paused` per `src/state/schemas.ts:421-422`) already covers cancel semantics. Adding a distinct event earns its keep only if cancel becomes semantically distinct from stop. New C15 entry records the existing capability.

### New project-level guardrail (Codex round-2)

**G1 — No automatic retry constants without an executable retry policy, call-site integration, and tests.** Archon's `DEFAULT_NODE_MAX_RETRIES = 2` and `DEFAULT_NODE_RETRY_DELAY_MS = 3000` (`packages/workflows/src/dag-executor.ts:195-197, :2866-2928`) are tied to executable DAG retry behavior, not naming hygiene. code-oz's posture is "no automatic retries; surface to `NEEDS_INTERVENTION`" (rule 11). Importing the constants without the policy would be decorative infrastructure. Reopen only if (a) transient provider failures create measured operator noise *and* (b) a milestone explicitly chooses automatic retry over `NEEDS_INTERVENTION`. Tracked as a deferred-with-trigger candidate, not a borrow.

### Refined event-vocabulary audit (round-2 final mapping)

The deep-scan agent enumerated Archon's full event vocabulary; Codex round-2 corrected the mapping. Final disposition:

| Archon event | code-oz state | Final disposition |
|---|---|---|
| `workflow_started` / `workflow_completed` / `workflow_failed` | already covered (`phase_entered`, `phase_completed`, `run_ended`) | no change |
| `loop_iteration_*` | n/a (single-turn per phase) | reject — out of scope by design |
| `node_*` (started/completed/failed/skipped) | n/a (no DAG nodes) | reject — fixed phase taxonomy is deliberate |
| `tool_started` / `tool_completed` | already covered on provider boundary | no change |
| `approval_pending` | **already covered as `gate_required` + supersedence-by-`gate_written`** (C14) | no change; reverse the round-1 "add this event" recommendation |
| `workflow_cancelled` | **already covered as `run_ended.outcome ∈ {stopped, paused}`** (C15) | no change unless cancel becomes semantically distinct from stop |
| `workflow_artifact` | partially covered (gate-bound artifacts derivable from gate writes) | **defer** — `artifact_written` could index pre-approval / non-gate artifacts for a future `code-oz watch` UI; not load-bearing for v0.2; add only when a watch-mode milestone surfaces a measurable need |
| `rate_limit_*` | n/a | track if/when M18+ runtime adopts an explicit rate-limit awareness layer; currently retries-via-NEEDS_INTERVENTION elides this |
| `session_transition` | n/a (single-session per run) | reject — multi-session is out of single-trigger CLI scope |

### Final borrow set after round-2 corrections

The borrow set ranking is unchanged. The **count and shape of borrows did not change in round-2**; only the wording of B5 was refined. A4/A6 remain no-borrows. B6 (`adopt(path)`) and B7 (`paused` state) remain candidates as recorded in round-1 synthesis. B1, B2, B3 unchanged. Two new C-discipline credits (C14, C15) were added based on round-2 source verification. One new project-level guardrail (G1) was added.

### Round-2 lock recommendation

Codex round-2 verdict: **`lock-final` after the four corrections above are folded in.** All four corrections have been folded in. Process risk is low; remaining issues are wording-level source corrections, not a reason for another broad pass.

### Final closure

**The Archon comparison is locked as FINAL on 2026-05-10.** Both Claude (Opus 4.7, this session as orchestrator) and Codex (gpt-5.5 xhigh, two source-level review rounds) explicitly converge on: **no remaining improvements, fixes, better approaches, or cleaner mechanics to extract from the Archon template that have not already been recorded as borrows, candidates, no-borrows, project-level guardrails, or existing code-oz disciplines.** The two seed borrows verified; six borrow candidates ranked with trigger conditions; two explicit no-borrows with reasoning; two new C-discipline credits surfaced by source-level review; one new project-level guardrail; one event-vocabulary audit table; three process action items. Future Archon comparison work would only be triggered by a new Archon major version that introduces patterns not present in v0.3.10.
