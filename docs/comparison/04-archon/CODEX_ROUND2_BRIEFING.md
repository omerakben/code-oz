---
name: codex-round2-briefing-archon
companion-docs: COMPARISON.md, CODEX_BRIEFING.md, CODEX_RESPONSE.md
target: Codex round-2 source-level pressure-test on Archon comparison + 3 new findings from Opus deep-scan
status: ready for dispatch (codex exec, gpt-5.5 xhigh, sandbox=workspace-write so Codex can read both repos)
---

# Codex round-2 briefing: Archon comparison source-level review

## Context

Round-1 (`CODEX_RESPONSE.md`) returned `accept-with-modifications` on the decision, the borrow set, and the timing. Round-1 was constrained by an upstream `chatgpt.com/backend-api/codex/responses/compact` failure that prevented full source exploration; Codex acknowledged this with: *"I cannot scan @archon/core or @archon/workflows/dag-executor under this review's constraints, so I would not claim there is or is not a hidden load-bearing pattern there."*

Round-2 is the source-level follow-up. Two Opus Explore agents have done the deep-scan work Codex couldn't:

1. **Archon deep-scan agent** read `@archon/core`, `@archon/workflows/dag-executor`, `@archon/workflows/event-emitter`, `@archon/server`, `@archon/cli`, `@archon/adapters/*`, `auth-service/`, `migrations/`, `@archon/git`, `@archon/paths` — the surfaces round-1 did not see. Findings below.

2. **code-oz fact-check agent** verified 18 specific claims in `COMPARISON.md` against the actual `src/` source. Result: **16 confirmed, 2 cannot-verify (forward-looking design policy / integration-level), 0 wrong**. The comparison doc is factually sound at source level.

Your round-2 task: react to the three new findings below, decide whether they change the borrow set, and produce a shorter response that I can save as `CODEX_ROUND2_RESPONSE.md`.

## Three new findings from round-2 Opus deep-scan

### Finding 1 — Retry policy constants in Archon's DAG executor

`packages/workflows/src/dag-executor.ts` defines `DEFAULT_NODE_MAX_RETRIES = 2` and `DEFAULT_NODE_RETRY_DELAY_MS = 3000` as named constants for node-level retry on TRANSIENT errors (network, 429, 502, 503, 504, timeouts). FATAL errors (auth, permission) fail fast.

**code-oz current state**: no per-node / per-phase retry constants. Provider failures land in `NEEDS_INTERVENTION` per rule 11 (explicit > silent). Retry happens implicitly when an operator re-runs `code-oz run`.

**Question**: is there a B-tier here?

  - **A**: Yes — adopt the *naming pattern* (named constants in a `policy/` or `retry/` module) without changing semantics, so future retry logic is easier to introduce. This is small (~20 LOC + tests) and prevents "magic number in a future PR" drift.
  - **B**: No — code-oz's posture is "no automatic retries; surface to `NEEDS_INTERVENTION`." Retry constants are infrastructure for a policy code-oz has explicitly rejected (rule 11). The constants would be unused; introducing them invites borrow-creep.
  - **C**: Defer — track as a candidate for a future "retry on transient failures" milestone (M18+) only if a real workload demonstrates that `NEEDS_INTERVENTION` on every transient is too noisy.

Pick A, B, or C with one paragraph.

### Finding 2 — Event vocabulary audit (concrete table from deep-scan)

Codex round-1 (section 4) asked for an event vocabulary audit separate from the B3 emitter decision. Opus produced this concrete mapping:

| Archon event | code-oz current state | Recommendation |
|---|---|---|
| `workflow_started` | `phase_entered`/`run_started`-equivalent in `events.jsonl` | already covered |
| `workflow_completed` | `phase_completed`-equivalent + `run_ended` | already covered |
| `workflow_failed` | `phase_failed`-equivalent + `run_ended` | already covered |
| `loop_iteration_started/completed/failed` | n/a (single-turn per phase) | reject — out of single-turn scope |
| `node_started/completed/failed` | n/a (no DAG nodes) | reject — fixed phase taxonomy |
| `node_skipped` | n/a | reject — code-oz has no conditional skip semantics |
| `tool_started/completed` | `tool_use_started`/`tool_use_completed` exist on the provider boundary | already covered |
| `approval_pending` | gate-required state inferred from absence of `gate_written` event | **action**: explicit `approval_pending` event makes operator watch UI cleaner |
| `workflow_cancelled` | n/a (no cancel command yet) | **action**: when `code-oz abort`/`cancel` lands, record `run_cancelled` |
| `workflow_artifact` | artifact paths inferred from gate writes | **action**: explicit `artifact_written` event gives operators a direct index without re-deriving from gate writes |

**Question**: do you confirm the three "action" rows are events code-oz should add to `src/state/events.ts` (in a future commit, not this session), and that the four "reject" rows are correctly categorized?

  - Particularly: is `approval_pending` redundant with the existing absence-of-`gate_written` inference, or does explicit emission earn its keep? Argue both sides briefly.
  - Is `artifact_written` actually load-bearing, or is the implicit "look at gate writes for paths" sufficient?
  - Is there any Archon event listed above that code-oz already records under a different name and the deep-scan missed?

### Finding 3 — fact-check zero-error result

The fact-check agent found 0 wrong claims in COMPARISON.md across 18 verifications. This is unusually clean for a doc this size.

**Question**: is there any claim in COMPARISON.md or in the round-1 `CODEX_RESPONSE.md` that you, on second look, want to flag as needing source-level verification I haven't yet run? Specifically:

- The claim "Archon has 3 first-party providers" — round-2 deep-scan did not enumerate `@archon/providers` providers source-by-source; was the round-1 number (Claude, Codex, Pi) accurate?
- The claim "code-oz has 5 concrete providers (Claude, Codex, Gemini stub, Fake, xAI)" — confirmed at `src/providers/{claude,codex,fake,xai}.ts` and `src/providers/capabilities.ts:103` for Gemini stub. Sufficient?
- The decision to call B5 (`toolCallId?` on `ProviderToolCall`) "cheap optionality" — Opus deep-scan confirmed `ProviderToolCall` has `id`, `name`, `input` only (no correlation field). The borrow remains correct as stated. Sufficient?

If you have any further claim you want pressure-tested before I lock COMPARISON.md as FINAL, name it.

## Final convergence question

The user's instruction for this session is: **converge on "I cannot find any more improvements, fixes, better approaches, or anything cleaner than the template" — or surface them.**

After:
- Round-1 review you produced (`CODEX_RESPONSE.md`)
- Round-2 deep-scan covering surfaces round-1 missed
- Round-2 fact-check verifying 18 claims with 0 errors
- Three new findings above

**Do you have any remaining concerns about the Archon comparison?** Specifically:

a. Any pattern in Archon you now believe code-oz should borrow that the comparison currently rejects or omits?
b. Any pattern in Archon you now believe code-oz already does *better* in a way COMPARISON.md does not credit?
c. Any pattern in Archon you now believe code-oz should explicitly reject as a guardrail document (a new no-borrow with reasoning)?
d. Any process risk in the comparison itself (methodology, scope, framing) you want flagged before lock?

If your answer is "no remaining concerns," say so explicitly and the comparison can be locked as FINAL.

## Format for your response

Save your reply for the user as `CODEX_ROUND2_RESPONSE.md`. Structure:

1. **Verdict on three findings**: A/B/C on Finding 1; confirm/correct on Finding 2; sufficient/insufficient on Finding 3.
2. **Final convergence answer**: a/b/c/d above with one paragraph each (or "no concerns" if none).
3. **Lock recommendation**: explicit `lock-final` / `one-more-pass-needed` / `block-lock-with-reason`.

Keep it tight — under 800 words. The decision-shape matters more than the prose.

## Operating notes

- Sandbox: `workspace-write` (you have read access to both `~/Projects/agents/templates/Archon/` and `~/Projects/code-oz/` if you want to verify any specific source claim; you may also write to `/tmp` if you need to draft).
- Effort: xhigh.
- Model: gpt-5.5.
- Read order: `docs/comparison/04-archon/COMPARISON.md` (read SYNTHESIS section), `docs/comparison/04-archon/CODEX_RESPONSE.md` (your round-1 answer), this briefing.
- If you disagree with any Opus finding, cite the file + line.
