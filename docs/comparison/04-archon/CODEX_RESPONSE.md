---
name: codex-response-comparison-archon
companion-docs: COMPARISON.md, CODEX_BRIEFING.md
target: Codex pressure-test response on the Archon comparison
status: received 2026-05-10; verbatim transcript below
codex-config: gpt-5.5, model_reasoning_effort=high (xhigh dispatched but Codex reported tokens=26k for the doc-review pass), sandbox=read-only
verdicts: accept-with-modifications on (decision, borrow-set, timing)
dispatch-notes: MCP `mcp__plugin_agent-codex_codex-native__codex` invocation failed three times with "stream disconnected before completion" on the upstream `chatgpt.com/backend-api/codex/responses/compact` endpoint (see Codex internal `compact_remote` error 2026-05-10T16:56:55Z). First retry under `codex exec --model gpt-5.5` with full source-exploration scope hit context-window saturation at 232,914 tokens before producing a final message. Final dispatch under `codex exec` with strict "no source exploration, read only the two comparison docs" scope succeeded — 26,521 tokens used, response captured below verbatim.
---

# Codex response — Archon comparison pressure-test

The body below is Codex's reply, saved verbatim from the `--output-last-message` capture.

## 1. Verdict

- The decision: `accept-with-modifications`. Yes, code-oz is ahead of Archon on the discipline axes that matter to code-oz: gate authority, cross-family review, cumulative budgets, permission discipline, privacy, and milestone authority control. But the wording should stay category-scoped. Archon is ahead as a deployable multi-platform harness builder, so "ahead" should not be presented as globally true across product categories.

- The borrow set and no-borrows: `accept-with-modifications`. B1 and B2 are legitimate small borrows. B5 is acceptable only if framed as provider-event correlation metadata, not as the start of a general tool-event redesign. B3 should be downgraded from "defer" to "defer with a very high bar." A4 and A6 are correct no-borrows today.

- The proposed timing: `accept-with-modifications`. B1 in M17 is right because cleanup becomes multi-step there. B5 in PE-2 is plausible if PE-2 actually introduces HTTP mid-turn tool visibility. B3 deferred is right. B2 inter-milestone is only worth doing if it also consolidates scattered recovery semantics, not if it merely adds constants.

## 2. Q1-Q5 answers

Q1: yes, but not for the reason stated. B2 is worth doing if it becomes the single named boundary for resumability decisions, especially around the M16 R1 audit-completeness recovery behavior described in the briefing. I do not buy the "compile-time catches resume of SHIPped run" claim as written. A phase-set constant does not prevent runtime resume attempts unless all resume entrypoints are forced through the typeguard. The real value is not compile-time safety; it is removing implicit, duplicated "recoverable phase" logic and making `resume` failure messages deterministic.

Q2: yes, B3 is close to a no-borrow disguised as a defer. The comparison itself says the canonical event log is `events.jsonl`, and future observers can tail it. That is a strong default. Ephemeral progress signals should first be handled by durable low-authority events if they matter to users, or by local CLI rendering if they are purely cosmetic. I would only borrow B3 when a real `code-oz watch` or dashboard milestone proves that file-tail latency or JSON parsing is a measurable problem, not just an ergonomic annoyance.

Q3: no. A4 does not predict code-oz's likely next shape under the current thesis. The comparison's own domain boundary says Archon is multi-trigger and code-oz is single-trigger local CLI. If `audit-pr` lands, the first move should be a narrow constructor such as `createPrAuditRun(...)` or `loadOrCreatePrAuditRun(...)`, not a broad `IsolationRequest` union. A discriminator like `triggerKind` should only appear after at least two external trigger types exist and their metadata is actually diverging.

Q4: yes, the comparison is directionally right about where Archon's authority model breaks, but it slightly overstates what can be inferred from schema validation. Archon's explicit statuses like `paused` and state fields could catch lifecycle bookkeeping errors, but they would not catch semantic failures where a node returns a structurally valid but wrong result. The comparison's cited examples, especially "node completes without error" versus file-based gate authority and cumulative budget enforcement, are valid category differences. The strongest Archon counterpoint is that `paused` is a useful state code-oz may eventually want, but it is not a substitute for gate files.

Q5: unsure, because the requested source scan is outside this review's constraints. From the briefing and comparison only, the missing pattern most worth calling out is still `adopt(path)`, because it maps to crash recovery and operator-driven forensics without importing Archon's multi-trigger model. A second possible pattern is explicit lifecycle statuses such as `paused`, if code-oz later needs operator suspension distinct from failure or intervention. I cannot confirm whether `@archon/core`, `dag-executor`, or `WorkflowEventEmitter` hide additional load-bearing patterns because I did not read them per your instruction.

## 3. Authority boundary check

B3 can preserve rule 1 only if it is mechanically downstream of `appendEvent`, has no return value that affects orchestration, and is never readable by gate code. The moment a phase, gate, retry policy, or budget check observes emitter state, it becomes authority drift.

The strongest case against B3 ever landing is that it creates a second event plane with weaker durability, weaker replay semantics, and a permanent temptation to place "just UI" facts there. Over time, those facts become operationally meaningful: progress, active node, retry count, current provider, pending tool call, listener health. Once operators trust a watch surface, advisory state becomes de facto authority even if the code says otherwise. File-only events are slower and less ergonomic, but they have one decisive virtue: every meaningful run fact is replayable, inspectable, and auditable after failure.

So B3 should not land as "nice fan-out." It should land only if a named UI/watch milestone proves that tailing `events.jsonl` cannot satisfy a concrete requirement. Even then, the emitter should fan out persisted events only by default. Ephemeral-only events need a separate written justification because they are exactly where authority drift will enter.

## 4. Anything missed

Within the two documents only, three patterns seem under-called:

- Explicit `paused` state. The comparison mentions Archon's `pending|running|completed|failed|cancelled|paused` lifecycle, but does not treat `paused` as a possible borrow. code-oz has `NEEDS_INTERVENTION`, but "operator-paused, resumable, not failed" may become distinct if long-running runs or watch mode arrive.

- Event taxonomy as a design input, not an emitter borrow. The listed Archon events like `loop_iteration_*`, `rate_limit_*`, `session_transition`, and `workflow_artifact` may be more valuable as a checklist for what code-oz intentionally records or rejects than as a reason to add B3. The comparison should separate "event vocabulary audit" from "in-process emitter."

- `adopt(path)` belongs closer to B1 than Q5. If cleanup becomes granular in M17 and W2, adoption/reconciliation of existing worktrees is the sibling operation. Both are about partial state, operator recovery, and avoiding binary cleanup assumptions.

I cannot scan `@archon/core` or `@archon/workflows/dag-executor` under this review's constraints, so I would not claim there is or is not a hidden load-bearing pattern there.

## 5. Risks

1. B5 becomes a Trojan horse for wider provider-event redesign. Adding `toolCallId?: string` is harmless only if it remains correlation metadata on already-existing tool events. If PE-2 starts exposing mid-turn HTTP tool calls, the real design questions are much larger: who executes tools, who authorizes tools, how budgets count them, how events are persisted, and whether tool results are gate-relevant. Do not let an optional field pre-approve that surface.

2. B3 creates non-replayable operational truth. Even if subscribers are advisory, dashboards and watch commands tend to become trusted by humans. If B3 carries events not written to `events.jsonl`, code-oz loses its clean audit story. This is the highest authority-risk borrow.

3. B2 becomes decorative and adds false confidence. `TERMINAL_PHASES` and `RESUMABLE_PHASES` are useful only if resume, forensics, locks, and transition validation all route through them. If they sit beside existing logic, they become stale documentation with type syntax.

## 6. Verdict on the comparison exercise itself

This is load-bearing for the v0.2 or v1.0 pitch, with one caveat: it must stay decision-oriented. Four template comparisons in, the archive is useful because it proves code-oz is not randomly copying agent frameworks. It shows a pattern: borrow small mechanics, reject category drift, and preserve the authority model.

It becomes polishing brass if each session keeps rediscovering that code-oz is "ahead" without turning the result into release-facing claims, roadmap constraints, or explicit no-borrow records. The useful output is not the comparison prose by itself. The useful output is a defensible influence-library ledger: what was borrowed, what was rejected, why the rejection protects the product thesis, and which future milestone would reopen the question.
