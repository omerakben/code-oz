---
name: codex-round2-response-archon
companion-docs: COMPARISON.md, CODEX_RESPONSE.md, CODEX_ROUND2_BRIEFING.md
target: Codex round-2 source-level pressure-test response (with workspace-write + Archon read access)
status: received 2026-05-10; verbatim transcript below; verdict `lock-final` conditional on four source-level corrections
codex-config: gpt-5.5, model_reasoning_effort=xhigh, sandbox=workspace-write, --add-dir ~/Projects/agents/templates/Archon
verdict: lock-final after corrections (B5 reframed; provider count refined; approval_pending already covered by gate_required; retry-constants guardrail added)
tokens-used: 139,885
---

# Codex round-2 response — Archon comparison source-level pressure-test

The body below is Codex's round-2 reply, saved verbatim from the `--output-last-message` capture. Round-2 was dispatched after the original MCP `mcp__plugin_agent-codex_codex-native__codex` upstream `/responses/compact` failures and after round-1 ran out of context budget under exhaustive source exploration. Round-2 ran under `codex exec` with `workspace-write` sandbox and `--add-dir ~/Projects/agents/templates/Archon`, completing within budget at ~140k tokens with full source access to both repos.

## 1. Verdict on three findings

Finding 1: C, defer. Archon's retry constants are real and tied to executable DAG retry behavior, not just naming hygiene: `packages/workflows/src/dag-executor.ts:195-197`, `:2866-2928`. code-oz should not add unused retry-policy constants now. Reopen only if transient provider failures create measured operator noise and the milestone explicitly chooses automatic retry over `NEEDS_INTERVENTION`.

Finding 2: correct, not fully confirm. Reject rows are right: loop/node/skip events are DAG semantics code-oz should not import. But `approval_pending` should not be a new event: code-oz already records this as `gate_required` (`src/state/schemas.ts:92-100`, `src/state/run.ts:868-945`), and active pending state is "latest `gate_required` not later satisfied by `gate_written`" (`src/commands/run.ts:690-707`). `artifact_written` is worth tracking for watch/UI indexing, especially for pre-approval or non-gate artifacts, but not as authority. Gate-bound artifacts are already derivable from gate files. For cancel, prefer existing `run_ended` semantics first: outcomes already include `stopped` and `paused` (`src/state/schemas.ts:421-422`). Add `run_cancelled` only if cancel becomes semantically distinct from stop.

Finding 3: insufficient as phrased. code-oz's 5-provider claim is sufficient (`src/providers/types.ts:23`; Gemini stub via capabilities is fine). Archon's provider claim needs wording correction: Archon has 3 wired/bundled provider registrations, but only Claude and Codex are built-in/core (`packages/providers/src/registry.ts:108-124`); Pi is bundled community with `builtIn: false` (`packages/providers/src/community/pi/registration.ts:15-23`). B5 also needs a small correction: code-oz already has `ProviderToolCall.id` (`src/providers/types.ts:126-130`), while `tool_result` lacks a matching correlation field (`src/providers/types.ts:152-157`). So B5 should be "define call-id semantics and add matching result correlation if PE-2 surfaces HTTP mid-turn tools," not blindly add a second `toolCallId?` to `ProviderToolCall`.

## 2. Final convergence answer

a. No new Archon borrow beyond the modified set. The only addition is event-vocabulary refinement: `artifact_written` may be useful later as an operator index, and B5 should be reframed around result correlation rather than adding duplicate call metadata.

b. Yes: COMPARISON.md should credit code-oz for already having explicit approval-pending semantics via `gate_required`. The current briefing understates this as inference from absence alone; the source shows a positive event plus supersedence logic.

c. Add one guardrail: no automatic retry constants without an executable retry policy, call-site integration, and tests. Unused constants would be decorative infrastructure for a policy code-oz has not accepted.

d. Process risk is low. The remaining issues are wording-level source corrections, not a reason for another broad pass. Fold these into the final comparison before marking it final.

## 3. Lock recommendation

`lock-final` after applying the corrections above: "3 wired/bundled Archon providers, 2 built-in plus Pi community," `approval_pending` already covered by `gate_required`, and B5 reframed as call/result correlation semantics for PE-2.
