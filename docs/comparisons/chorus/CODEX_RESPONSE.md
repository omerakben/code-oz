# Codex peer review — code-oz vs Chorus comparison

> **Round 1 — DISPATCH FAILED.** Captured 2026-05-10. Model: `gpt-5.5` xhigh, sandbox read-only.
> Threads: `019e12ed-52d6-74a3-b648-40b2d071fa45` (run 1), `019e1300-4443-76c3-ad82-f68e69a4b73a` (run 2).
> Briefing: `CODEX_BRIEFING.md`.

## Status

**Both dispatch attempts failed before Codex produced a final structured review.** Per dispatcher instructions ("If it fails again, report back with the error — do NOT fall back to a different model or sandbox setting"), no further retries were attempted.

## Failure mode

Both runs hit the same transient OpenAI infrastructure failure: `remote compaction failed … stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)`. In each case Codex consumed roughly 237k of its 258k context-window tokens reading the draft + cited code, then the server-side compaction call that frees space for the final assistant turn died mid-stream and Codex emitted `turn.failed` instead of the structured response.

Stderr excerpt (run 2):

```
2026-05-10T17:57:19.641467Z ERROR codex_core::compact_remote: remote compaction failed
  turn_id=019e1300-4815-7e22-a8c0-41109be84c11
  last_api_response_total_tokens=237479
  model_context_window_tokens=Some(258400)
  compact_error=stream disconnected before completion:
    error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)
```

A separate `rmcp` MCP-transport auth-refresh error (`invalid_grant: Refresh token is invalid`) appeared in stderr at startup on both runs but did not block reasoning — Codex completed 79 read-only tool calls (file reads / sed / rg / git) before the compaction failure.

## Salvageable signal — Codex's in-progress agent messages

These are *not* the structured review. They are the brief planning notes Codex emits between tool calls. Captured here because they were the only output before `turn.failed` and they hint at what the round-1 findings would have been. Synthesizer should treat these as priors to verify in round 2, not as findings.

### Run 1 (thread `019e12ed-52d6-74a3-b648-40b2d071fa45`, 4 progress messages)

1. "I'll keep this read-only and return the `CODEX_RESPONSE.md` content in the final answer instead of writing the file. I'm going to verify the draft against both repositories and only cite files I actually inspect."
2. "The live `code-oz` checkout is on `main` with untracked `docs/comparison/` and `docs/comparisons/`; Chorus is on `main` and clean from the short status output. I'm starting with the draft, `CLAUDE.md`, and the milestone docs so the comparison is grounded in the current repo, not just the briefing."
3. "The draft has one internal timing inconsistency already: §3.3 still says MCP server target is `v0.3+`, while §5 and §7 promote it to first `v0.2` after W3. I'm checking the underlying Chorus MCP/permission code now, then I'll decide whether that promotion is warranted or scope creep."
4. "Chorus's permission story is strong but not as clean as the draft phrases it: many 'public' MCP tools are still mutating, including comments, notification read state, elaboration answers, and task creation/update. That does not invalidate the borrow, but it does mean code-oz should copy the permission-map coverage discipline, not Chorus's public/gated split wholesale."

### Run 2 (thread `019e1300-4443-76c3-ad82-f68e69a4b73a`, 4 progress messages)

1. "I'll use the `code-review` skill for this because the task is explicitly a peer review with findings, then read the project orientation files before checking the draft and cited code."
2. "The orientation file is stale relative to the briefing: `CLAUDE.md` says v0.13.0-alpha.0 while the briefing says v0.17.0-alpha.0. I'll treat source files and package metadata as current and call out doc-rot only where it affects the comparison."
3. "I've got the draft. Next I'm checking the actual permission, MCP, acceptance-criteria, event, and contract files instead of relying on the prose claims."
4. "Two concrete draft problems are already visible: §3.3's target contradicts itself inside the draft, and §3.5 proposes adding provider/model/cost fields that `agent_invoked` already carries. I'm checking the remaining 'missed pattern' candidates so the response does not over-focus on obvious doc drift."

## Inferred round-1 themes (priors only, not Codex findings)

These are the synthesizer's read of the progress-message signal. They should be re-asked in round 2 once the OpenAI compaction service recovers — do not treat them as Codex's verdict.

- **Doc-rot:** `CLAUDE.md` "Status:" line still pinned to v0.13.0-alpha.0; should be v0.17.0-alpha.0 post-M16.
- **§3.3 internal inconsistency:** the draft promotes `code-oz mcp serve` to "first v0.2 milestone" in §5 / §7 but a `v0.3+` reference allegedly survives in §3.3. Synthesizer should grep the draft and reconcile.
- **§3.5 partial-overlap:** `events.jsonl` `agent_invoked` events allegedly already carry `provider` / `model` / cost-relevant fields; the borrow may need to be narrowed to "extend, not add."
- **§3.1 borrow shape:** Chorus's permission-grid is more nuanced than the draft phrases it — many "public" MCP tools mutate (comments, notification read state, elaboration answers, task create/update), so the borrow should be "permission-map coverage discipline" rather than "Chorus's public/gated split."

## Recommended next actions for the synthesizer

1. Wait 1–2 hours and retry with the same params (`gpt-5.5` xhigh, `sandbox: read-only`, both `~/Projects/code-oz` and `~/Projects/agents/templates/Chorus` in `--add-dir`). The compaction-service failure looked transient.
2. If round-2 retry hits the same compaction failure, consider trimming the briefing — the prompt is large enough that the model is approaching context-window exhaustion before it can compact and answer. Splitting into "borrows" round and "rejects + missed patterns" round may avoid the failure mode. Note: dispatcher instructions explicitly forbade fallback to a different model or sandbox; trimming the prompt is a different lever.
3. The four "inferred themes" above are *priors only*. Verify each in the next round by quoting Codex's own structured findings — do not treat the salvaged progress messages as a finding count.

## Failure files preserved

- `/tmp/codex-chorus-review/events.jsonl` — run 1 events stream (162 events, 1.7M)
- `/tmp/codex-chorus-review/stderr.log` — run 1 stderr including the compaction error
- `/tmp/codex-chorus-review-r2/events.jsonl` — run 2 events stream (1.0M)
- `/tmp/codex-chorus-review-r2/stderr.log` — run 2 stderr
- `/tmp/codex-chorus-review/prompt.md` — the literal prompt sent to both runs (matches §6 of CODEX_BRIEFING.md plus the one-line preface)
