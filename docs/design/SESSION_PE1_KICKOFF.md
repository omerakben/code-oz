# PE-1 — xAI direct HTTP adapter — session kickoff

**Date:** 2026-05-01 (written at end of inter-milestone refactor session, before PE-1 boot)
**Branch on next session start:** `main` (or fresh `feat/pe1-xai-http-adapter`)
**State at start:**
- HEAD: `71fb33d chore(provenance): drop leaked-source warnings (templates cleaned)` on `main`
- Tag: `v0.12.1-alpha.0` points at HEAD
- Tests: 1923 pass / 1 skip / 0 fail offline; `bun run typecheck` clean
- `origin/main` synced (refactor session pushed cleanly)
- Working tree clean (TODO.md is gitignored)

**Pre-locks already in place** (read these before writing any briefing):
- `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md` — the xAI expansion roadmap doc with 9 Codex-pressure-tested decisions and the locked PE-1 scope
- `docs/contracts/PROVIDERS.md` — the v0.1 provider contract (subscription-first auth, doctor exit policy, capability table)
- `docs/references/provider-contract.md` — canonical IAgentProvider spec (M11 capability + eligibility section is load-bearing for PE-1)
- `docs/research/CODEX_REVIEW_M12.md` — M12 implementation review (closed risks #2/#3/#4)
- `docs/research/REFACTOR_AUDIT_2026-05-01.md` — just-closed inter-milestone refactor (closed M12 latent risks F2 + F3, plus blank-model widening across schema/config/events)
- `docs/research/CODEX_REVIEW_REFACTOR_2026-05-01.md` — Codex `push` verdict on the refactor

## Why this exists

PE-1 lands the **first outbound HTTP adapter** in code-oz. Until this session, every provider was either subprocess-delegated to a CLI that handled its own auth (`claude login`, `codex login`) or in-process (`fake`, `gemini` stub). PE-1 is the first time code-oz reads an API key from env and transmits it over HTTPS from its own process — a categorical change in trust posture, not "add another provider."

Demand: friends asking for xAI Grok access. Surfaced as the measurable signal that earns the insertion slot between M12 and M13 (per CLAUDE.md rule 21's "measurable risk reduction" pattern, generalized to "measurable demand evidence").

## Authority boundary (CLAUDE.md rule 20)

**One new authority boundary:** outbound HTTP from `code-oz` itself, plus the API-key trust-boundary expansion. Nothing else lands in PE-1.

## What ships in PE-1

Implementation locked by `SESSION_XAI_EXPANSION_KICKOFF.md` § "PE-1: xAI direct HTTP adapter (committed)":

- `src/providers/xai.ts` — new `IAgentProvider` adapter. HTTP-based, reads `XAI_API_KEY` from env, makes outbound HTTPS to xAI's chat-completions endpoint, maps responses to existing `ProviderEvent` stream
- `src/providers/capabilities.ts` — adds `xai-api-key` to `AUTH_SOURCES` enum + `xai` entry to `DEFAULT_CAPABILITY_BY_ID` (`authSource: 'xai-api-key'`, `eligiblePhases: <full AGENT_PHASES>` or restricted by review consensus). **NO `transport` field. NO other capability fields.** M11 strict-minimal stays.
- `src/providers/types.ts` — adds `'xai'` to `PROVIDER_IDS` + `PROVIDER_FAMILIES`
- `src/providers/families.ts` — adds `xai: 'xai'` to `DEFAULT_FAMILY_BY_ID`
- `src/cli/bootstrap.ts` — registers `XaiProvider` alongside Claude/Codex/Gemini/Fake
- `docs/contracts/PROVIDERS.md` — extends v0.1 capability table with the `xai` row
- `docs/references/provider-contract.md`:
  - § Auth model gains "API-key transmission for HTTP adapters" subsection (env var name, redaction, "never log Authorization headers", request/response logging redaction list)
  - § Anti-patterns gains the auth-header-logging entry
  - § "Capability and eligibility (M11)" gains a note that HTTP-based adapters do not require new capability fields in v0.1
- Tests: full coverage for adapter, redaction, error mapping, built-in-tools-disabled-by-default, eligibility rejection of impossible (provider, phase) combinations

Built-in xAI server-side tools (web search, code execution) explicitly **disabled by default** in the adapter's request shape.

## Pre-PE-1 contract additions (land BEFORE PE-1 commit 1)

These are docs-only and lock the trust-boundary discipline before any code. Land them as a single docs commit; PE-1 commit 1 (the adapter) builds on them.

1. **`docs/references/provider-contract.md` § "Auth model — subprocess delegation (v0.1)"** → rename and extend to "Auth model — subprocess delegation + API-key transmission (v0.1)". Add "API-key transmission for HTTP adapters" subsection covering:
   - Env var naming convention (`<PROVIDER>_API_KEY`, e.g., `XAI_API_KEY`)
   - Redaction discipline: API keys must not appear in any artifact (`events.jsonl`, gate files, `NEEDS_INTERVENTION.json`, doctor output, error messages, request/response logs)
   - "Never log Authorization headers" rule + the redaction list
   - HTTP error mapping (401 → `provider_auth_missing`; 403 → `provider_permissions_violation`; 429 → `provider_rate_limit`; 5xx → `provider_io_error`)

2. **`docs/references/provider-contract.md` § "Anti-patterns rejected by this spec"**: add three entries:
   - Logging Authorization headers, x-api-key headers, or any provider-specific auth header in any artifact
   - Embedding API keys in `ProviderRequest` / `PreparedProviderRequest` / persona prompts (auth always at the adapter layer)
   - Enabling provider-native server-side tools (e.g., xAI built-in web search, code execution) without an explicit `tool_use` permission scope authorizing them

3. **`docs/contracts/PROVIDERS.md` § "Subscription-first auth model"** → rename and extend to cover API-key auth for HTTP adapters. Document policy: prefer subscription-first via upstream CLI when available; HTTP API key is acceptable when no CLI option exists; cloud-IAM auth is v0.2+ scope.

The PE-1 planning Codex round will pressure-test these.

## What does NOT ship in PE-1

Locked anti-scope-creep boundary:

- **No HTTP-substrate library separate from the adapter.** The minimal shared HTTP helper inside the adapter only.
- **No `transport` field on `ProviderCapability`.** M11 strict-minimal stays.
- **No OpenRouter (PE-2).** Demand-gated insertion point after PE-1 ships.
- **No gateway abstraction (PE-3).** Demand-gated.
- **No cloud routes (Azure / Bedrock / Vertex).** v0.2+ scope.
- **No new permission scope for upstream provider-native tools.** Deferred until measurable need.
- **No lineage-resolution machinery.** PE-1 is direct, not routed.
- **No M13 role-cost work, no M14 panels, no M15 debate scheduler, no M16+ scope.**

If anything else surfaces, push it to a deferred bucket; do not bundle.

## Cycle to follow (full discipline — authority-boundary milestone)

PE-1 is a trust-boundary event. Apply the **full** cycle from `docs/design/SESSION_CYCLE.md`. The lite-cycle compromise discussed in the closing turn of the refactor session does NOT apply here. Specifically:

1. **Boot + state verification** (commands below)
2. **Land the pre-PE-1 contract additions** (single docs commit, no Codex round needed for documentation-only locks already pressure-tested in `SESSION_XAI_EXPANSION_KICKOFF.md`)
3. **Codex planning round** — write `docs/research/CODEX_BRIEFING_PE1.md` (≤400 lines), invoke `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` xhigh + `sandbox: read-only`, save reply to `docs/research/CODEX_RESPONSE_PE1.md`, append synthesis. Required sections: locked scope, leans for open questions, scope corrections requested, bugs/risks Claude missed
4. **Stop for Ozzy approval after synthesis.** Do not start coding without it.
5. **Implementation in ~6–8 scoped commits per Codex's locked order.** One concern per commit. Tests interleave. `bun run typecheck` + targeted `bun test` clean before each commit
6. **Codex implementation review** — save to `docs/research/CODEX_REVIEW_PE1.md`. Verdict push / fix-first / debate-required
7. **Close every block-push and fix-soon finding** in follow-up commits; re-run review if needed
8. **Final handoff.** Tag candidate is `v0.13.0-alpha.0` (likely; PE-1 takes the next M-numbered slot per the open question Codex round will resolve). No push, no tag, no `gh release` without explicit Ozzy approval.

## Open questions PE-1's planning round will answer

1. **Tag naming.** `v0.13.0-alpha.0` (PE-1 takes the next M-numbered slot, M13 shifts to `v0.14.0-alpha.0`) vs. `v0.12.2-alpha.0` (PE-1 inserts as patch, M-numbering aligned with M-tags). Both defensible; pick once.
2. **xAI endpoint URL + request shape.** Verify the canonical endpoint (`api.x.ai/v1/chat/completions`?), confirm the OpenAI-compatible chat-completions wire format, decide what subset of features to support in v0.1 (function calling? streaming? logprobs?).
3. **xAI built-in tools opt-out shape.** What request-body field disables web search + code execution? Is it default-off or default-on at xAI's end?
4. **Streaming vs buffered response.** Subprocess adapters buffer; HTTP adapter could stream. Decide: stream and surface chunks via `content_chunk` events, or buffer to match existing pattern?
5. **`tokensUsed` provenance from xAI.** Does the API return real input/output token counts? If yes, populate `agent_completed.tokensUsed`; if no, fall back to the wrapper's tokens-estimate.
6. **HTTPS client choice.** `Bun.fetch()` (built-in) vs `node:https`. Bun.fetch is the obvious default; verify it handles streaming + abort-signal correctly for the doctor probe and the cap-exceeded paths.
7. **Demand-checkpoint mechanism.** After PE-1 ships, document the friend-survey result somewhere durable. Conversational ask + a `docs/research/XAI_DEMAND_CHECKPOINT_<date>.md` is the lightest discipline.
8. **Live-test gating.** Offline tests use a mock HTTP runner (similar to the `runner` injection seam used by claude.ts and codex.ts). Live tests against the real xAI endpoint must be opt-in, gated behind an env flag like `CODE_OZ_LIVE_PROVIDER_TESTS=xai`. Decide the gate name and where it lives.

## API-key prep (Ozzy)

PE-1 needs a working `XAI_API_KEY` in the environment for the live integration test. Provision the key before the planning round so it's available when implementation starts. The doctor command will probe `xai.health()` once the adapter exists — that's the cheapest live-auth check.

**Do not commit `.env` files. Do not paste the key into chat.** The redaction discipline this milestone introduces explicitly bans key material from any artifact, including this kickoff.

## Loose threads from the just-closed refactor session

- **Tech-debt register entries that stay parked:** F7 (stale M11 forward-compat prose), F8 (version-string single-source refactor — never bundle into PE-1), F9 (dead config keys: `defaultProvider` / `models.primary` / `models.reviewer`), F10 (byterover-cli inclusion gate — re-evaluate after PE-1 ships).
- **Non-atomic config-write race** flagged by Codex: `loadConfig()` can observe a partial YAML write. Fix is writer-side atomic-save discipline. Not in PE-1 scope.
- **Lite cycle for non-authority refactor sessions** is OK going forward. PE-1 stays full discipline.

## Cross-model peer review (durable rule)

CLAUDE.md rules 7+8 stand. Both Codex rounds (planning + implementation review) run for PE-1. Verdict is data, not authority — Codex finds things Claude misses (this session: F2 widened from one layer to three because Codex pressure-tested the audit). Same value expected here.

## What earns Ozzy's intervention

Stop and ask only for:
- Destructive git operations
- Push / tag / release / PR
- Production dependency additions (PE-1 should not need any if `Bun.fetch` is used; flag if a new HTTPS client is proposed)
- Scope conflict with CLAUDE.md
- Secret / API-key handling uncertainty
- A Codex `debate-required` verdict

Otherwise: implement in scoped commits, validate per commit, full test suite + Codex review at the end.

## Boot prompt (paste-ready)

See `TODO.md` at repo root. Triggerable from a fresh Claude Code session.
