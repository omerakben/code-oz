# Codex peer review — code-oz vs Chorus comparison (round 1 retry, trimmed)

> **Round 1 retry (R1B) — raw response.** Captured 2026-05-10. Model: `gpt-5.5` xhigh, sandbox read-only.
> Thread: `019e1321-4c1b-7833-a20e-6114a68c4bf9`. Briefing: trimmed inline (see prior briefing at CODEX_BRIEFING.md for context).
> Earlier round-1 attempts failed at ~237k tokens (compaction error); see CODEX_RESPONSE.md for failure record.

# Codex peer review — Chorus comparison (round 1 retry, trimmed)

## 1. Verdict
agree-with-modifications

The comparison is directionally sound: code-oz still exceeds Chorus as a governed SDLC runtime, and Chorus exposes real borrowable adoption/transport patterns. The self-verified priors mostly hold. The two material changes I would require are: do not import Chorus’s 5×3 grid as a replacement or wrapper for code-oz’s existing layered `AgentPermissions`, and reverse the write-capable MCP-server promotion. Keep the MCP idea, but split it into a demand-gated read-only introspection server first; defer write/control tools until the auth and gate-boundary model earns its own milestone.

## 2. Findings

[fix-first] [scope-creep] Reverse the §3.3 write-capable MCP server promotion, not the agentic-canvas skill-wrapper promotion.
- Cites: `docs/comparisons/chorus/COMPARISON.md:148`, `docs/comparisons/chorus/COMPARISON.md:166`, `docs/comparisons/chorus/COMPARISON.md:255`, `docs/design/ROADMAP.md:398`, `docs/comparison/11-mimir/SYNTHESIS.md:59`
- Suggested fix: Keep skill wrappers as W3.x strategic because they are thin distribution wrappers and do not add runtime authority. Move `code-oz mcp serve` back to demand-gated v0.3+/external-integration territory, or make the first milestone read-only only. Remove `code_oz_approve_phase`, `request_review`, and `request_debate` from the first MCP shape.

[fix-first] [framing] §3.1’s Resource × Action grid conflicts with the current layered permission model if treated as “richer grid.”
- Cites: `src/agents/schema.ts:219`, `src/agents/schema.ts:226`, `src/agents/defaults/builder.md:7`, `docs/contracts/BUILD.md:193`, `docs/contracts/DEBATE.md:179`
- Suggested fix: Borrow Chorus’s coverage-map discipline, not the 5×3 grid as a new root model. code-oz already has top-level `read/write/bash` plus `tool_use.repo_context/write/execute/review_request/debate`, each with caps, roots, providers, network, or concurrency. A flat `spec:write` / `review:write` / `approve` grid would duplicate or disagree with `permissions.write` and `tool_use.write`. If added, make it an artifact-emitter coverage map, not a “repo_context becomes one cell” replacement.

[fyi] [false-borrow] §3.5 is correctly narrowed for `agent_invoked`, but “every event must carry actor binding” is too blunt.
- Cites: `src/state/events.ts:202`, `src/state/schemas.ts:440`, `src/state/schemas.ts:513`, `src/state/schemas.ts:539`, `src/state/schemas.ts:554`, `src/state/schemas.ts:1011`
- Suggested fix: State the verified facts precisely: `agent_invoked` requires `agent`, `provider`, manifest, `filesSent`, `bytesSent`, `tokensEstimate`, and `fieldsRemovedByScope`; `model`, `role`, and `costEstimateUSD` are optional and validated when present. Replace “no event type may emit without actor binding” with an actor-policy table by event class: agent/tool/provider/human events need explicit actor fields; pure orchestrator lifecycle events may use an implicit orchestrator category.

[fyi] [framing] §3.1 self-verified prior #4 is confirmed, and the reframe is the right borrow shape.
- Cites: `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts:29`, `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts:283`, `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts:521`, `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts:763`, `~/Projects/agents/templates/Chorus/src/mcp/tools/public.ts:905`, `~/Projects/agents/templates/Chorus/docs/PERMISSIONS.md:85`, `~/Projects/agents/templates/Chorus/src/mcp/tools/permission-map.ts:1`, `~/Projects/agents/templates/Chorus/src/mcp/__tests__/server.test.ts:131`
- Suggested fix: Keep the current caveat. I verified 29 `server.registerTool` calls in `public.ts`, including mutating comments, notification read-state, elaboration answers, `chorus_create_tasks`, and `chorus_update_task`. The load-bearing Chorus borrow is the test-enforced permission inventory, not the public/gated split.

[nit] [doc-rot] §3.3’s internal timing contradiction is fixed; remaining `v0.3+` references are historical, not contradictory.
- Cites: `docs/comparisons/chorus/COMPARISON.md:30`, `docs/comparisons/chorus/COMPARISON.md:166`, `docs/comparisons/chorus/COMPARISON.md:255`, `docs/comparisons/chorus/COMPARISON.md:265`, `docs/comparisons/chorus/COMPARISON.md:274`
- Suggested fix: No blocker. For clarity, change `earlier than the agentic-canvas comparison's "v0.3+"` at §6 to name the actual referent, because agentic-canvas promoted skill wrappers to W3.x while its viewer stayed v0.3+.

## 3. Recommended next actions

1. Update §3.1 target text: “Borrow permission-map coverage tests and artifact-emitter permission declarations; do not replace `AgentPermissions.tool_use` with a resource/action grid.”
2. Update §3.3 / §5 / §7 target: “Read-only `code-oz mcp serve` is demand-gated after W3; mutating MCP control tools are deferred.”
3. Update §3.5: add an actor-policy table and explicitly mark `model`, `role`, `costEstimateUSD` as optional on `agent_invoked`.
4. Keep the Chorus `public.ts` caveat and cite the mutating public tools as the reason not to copy Chorus’s split.

## 4. One disagreement held back
I almost pushed to reject the MCP-server borrow outright, but that would overcorrect. Multiple comparisons are converging on the same signal: external agent surfaces need a programmatic way to inspect code-oz runs. The correction is sequencing and write-boundary discipline, not rejection.

## 5. Trim sufficiency note
The trimmed scope was right. §3.6 and §5 matter only because they inherit the §3.3 promotion decision, which this prompt included. I did not find an independent blocker in §3.2, §3.4, or §4 that needed to be brought back into the retry.
