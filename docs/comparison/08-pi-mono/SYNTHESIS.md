---
template: pi-mono
companion-docs: COMPARISON.md, CODEX_BRIEFING.md, CODEX_RESPONSE.md
codex-thread: 019e12f0-5d93-7c73-b137-925eb6a5b867
verdict: accept-with-modifications (accepted)
status: locked
session: 2026-05-10
---

# Synthesis — pi-mono comparison

## Outcome

Codex's `accept-with-modifications` verdict is accepted in full. Six of the seven disagreements (B2 split, B3 hardening, B5 allowlist-not-verbatim, B6 reframe, B7 deferral, B8 downgrade) are real corrections that tighten authority, privacy, or production-safety claims. The seventh (S1 reject until provider #2) is the YAGNI side of the original briefing's open question and Codex argued it cleanly.

The borrow set drops from 8 to 7 acceptances + 1 rework + 1 deferral + 1 reject-until-trigger. The split count drops from 1 to 0 (S1 deferred). The reject set is unchanged in shape but R1 gets an explicit "demand-gated, not permanent" annotation for OpenRouter / meta-providers.

## Locked decisions

### LD-1 — B2 splits into B2a (mechanism) and B2b (policy)

**B2a** lands as a M13 follow-up: `cacheRetention?: 'none' | 'short' | 'long'` and `cacheSessionId?: string` on `ProviderRequest` and `PreparedProviderRequest`. Defaults to current behavior (no header, no retention hint). Logged in `agent_invoked` events under `cacheRetention` / `cacheSessionId`. No phase policy table.

**`cacheSessionId` derivation rule:** never expose raw `runId` to upstream. Derive an opaque per-provider, per-run id (e.g., `sha256(runId || providerId)[0:16]`) only when `cacheRetention !== 'none'`. Documented as a privacy-by-default invariant (rule 13). Verified by an offline test that asserts `cacheSessionId !== runId` for any non-`none` retention.

**B2b** is its own future authority slice — a "provider request policy" surface that maps phases to retention values. Does **not** land with B2a. Rule-20 footprint is real: per-phase retention policy is request-shaping authority distinct from per-role budget caps (M13). Will require its own briefing if and when a PE milestone needs it.

### LD-2 — B4 lands as 12-directional offline matrix using FakeProvider with family aliasing

One rich handoff fixture parametrized over the 12 directional family pairs (claude/codex/gemini/xai, excluding same-family). Uses the existing `buildProviderRegistry({ providerOverride: 'fake' })` seam to alias provider ids while preserving family identity. Offline-only. Asserts:

1. Message and artifact bytes survive round-trip without semantic drift.
2. Target family !== source family (rule 2 invariant).
3. `agent_invoked` events carry both requested and actual model fields.
4. No hidden recursive repo context introduced (rule 13 + rule 18).

Live-provider handoff stays out of scope until a real provider codec starts transforming tool or reasoning blocks (the empirical trigger).

### LD-3 — B8 downgrades to "model lifecycle guard," full registry deferred to post-PE-2

**Accepted now (small):** Central model constants module (collapsing scattered hardcoded model strings) + a `code-oz doctor providers` check that validates configured default model availability against the provider's own model-listing API (where available) + a typed `provider_model_unavailable` error projected through the wrapper into `NEEDS_INTERVENTION.json` (rule 11 alignment).

**Deferred (large):** Full auto-generated `models.generated.ts` script + registry. Schedule post-PE-2 demand checkpoint, when provider count or model catalog churn justifies generation cost.

**Fact correction accepted:** Codex's verification against the Anthropic deprecation page and model overview is correct — `claude-opus-4-7` (code-oz's current default at `src/config/schema.ts:265`) is **not** in the Jun 15 2026 retirement window. The "catastrophic default-model" framing in the original briefing was overstated. The real pre-PE-2 risk is scattered hardcoded strings + weak availability reporting, not a default that will fail next month.

### LD-4 — S1 rejected until second OpenAI-compat provider lands

The 14-knob `OpenAICompletionsCompat` record is documentation-masquerading-as-infrastructure with one provider. Land source-level compat records only when provider #2 (probably PE-2 / OpenRouter) arrives and gives the catalog real edges to test against.

**Catalog landed as PE-2 checklist in docs:** the 14 knobs (cache-control format, thinking format, max_tokens field, session affinity, OpenRouter routing, ZAI tool stream, strict mode, etc.) are recorded in `docs/references/provider-contract.md` § "PE-2 OpenAI-compat checklist" so the next compat adapter starts with a known edge map rather than rediscovering each trap. The catalog is a doc, not source.

**Auto-detection stays rejected permanently.** Provider family identity must be declared and auditable, never inferred from base URL.

### LD-5 — Reverse-direction inversion audit added to milestone process

Codex's framing is sharper than the original Q5: the more important inversion is not "what would code-oz teach pi-mono" but "are any code-oz authority surfaces silently regressing from runtime enforcement to manual discipline?"

**New milestone-checklist line item:** for any borrow that ships a new wrapper hook, callback, lazy loader, or compat record, the milestone must include a runtime-enforcement test that proves phase code cannot bypass the wrapper. Specifically applies to B3 (hooks must be observer-only by default, mutation requires an explicit wrapper-side seam), B2a (cacheSessionId must be wrapper-derived, never phase-supplied), B7 (compiled-binary must contain every adapter even after lazy refactor), and S1 (compat records can be added only via milestone-gated PRs, never inferred).

This becomes a recurring item in the milestone-template under "rule 20 boundary check."

## Locked responses to missed risks

### MR-1 — CLAUDE.md / status drift (block-push)

**Confirmed.** CLAUDE.md status line at `CLAUDE.md:9` reads `v0.13.0-alpha.0 — PE-1 closed` with `1983 offline tests`. Actual state per memory and `ROADMAP.md:381`: v0.17.0-alpha.0 / M16 closed and pushed / 3108 tests / W3 lite tarballs shipped at v0.14.

**Action:** Out of scope for this comparison session. The drift is a real maintenance miss but fixing it correctly requires a careful pass through CLAUDE.md status text + tests count + W3 status + active migration windows — that is its own commit. Filed as a follow-up todo on the next code-oz cleanup session. The comparison docs themselves are accurate to actual state (they reference v0.17.0-alpha.0, M16, 3108 tests) so they do not propagate the drift; they only highlight it.

### MR-2 — B6 source mischaracterized (block-push)

**Confirmed.** Re-checking pi-mono shows `AssistantMessageDiagnostic` carries error message, stack, code, and `details: any` — not redaction-by-construction. The `secret: boolean` flag idea is a code-oz hardening design, not a borrow.

**Reframe (locked):** B6 becomes an internal code-oz design item ("typed `ProviderDiagnostic` with explicit secret-flagging at the wrapper boundary") rather than a pi-mono borrow. Pi-mono's contribution shrinks to the *idea* of a structured diagnostic shape on every assistant message; the redaction discipline is code-oz-original.

Edits to `COMPARISON.md` and `CODEX_BRIEFING.md` are deferred to the next pass through this folder; the synthesis here supersedes their B6 framing.

### MR-3 — B5 "verbatim" wording is unsafe (fix-soon)

**Confirmed.** Pi-mono's `getProcEnv` parses the entire `/proc/self/environ` into a `Map<string, string>` (`packages/ai/src/env-api-keys.ts:35-59`). For code-oz rule 13, that is too broad — it caches every env var on the system, indefinitely.

**Locked spec:** `src/util/env.ts` ships an allowlisted reader. Caller declares `readEnv(['XAI_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'])`; helper reads the keys from `process.env` first, falls back to a *one-shot, allowlist-filtered, never-cached* read of `/proc/self/environ` only for the requested keys. No global env map. No persistence beyond the call. Test asserts the helper does not log or serialize unrelated env vars.

### MR-4 — B3 hooks can become hidden authority surface (fix-soon)

**Confirmed.** A generic `onPayload(payload) => unknown` callback that can *replace* the outbound payload is not telemetry — it is request mutation. Pi-mono's design is fine for an SDK with one trust principal; code-oz's wrapper layer is the trust boundary itself.

**Locked spec:** B3 ships only the observer/redactor shape. Two callback types:

- `onPayload(payload, ctx) => void` — observation only, no return value, runs before send.
- `onPayloadRedact(payload, ctx) => Payload` — explicit redaction seam, return value is the redacted payload, wrapper-owned (not phase-supplied), runs in a fixed pipeline position so phase code cannot inject arbitrary mutation.
- `onResponse(response, ctx) => void` — observation only.

Phase code never registers callbacks. Wrapper composes them from a fixed code-oz-defined chain. Test asserts that a phase-supplied callback is rejected at the wrapper boundary.

### MR-5 — B7 lazy load may break compiled-binary keepalive (fix-soon)

**Confirmed against source.** `src/cli/bootstrap.ts:1-30` opens with the comment:

```
// Shared CLI bootstrap. Every command that needs the agent registry imports
// this module so the bundled-defaults asset imports stay alive across the
// compiled binary's tree-shaker. Closes the M2 commit fae4064 deferred-liveness
// loose thread.
//
// ... without the explicit imports below, the compiled binary's tree-
// shaker would drop unused adapter modules and the registry would be empty
// in production.
```

A naive lazy-import refactor would silently undo this guard.

**Locked spec:** B7 deferred until a Bun-binary integration test is in place that asserts every built-in adapter is present in the compiled binary (the test runs `code-oz doctor providers --json` on the compiled binary in CI and asserts all five providers report `authStatus !== 'unsupported'` due to module-missing). Once the keepalive test exists, B7 can land safely. Without it, the compounding-startup-cost win is not worth the regression risk.

### MR-6 — B1 naming discipline (nit)

**Confirmed.** `ProviderResponse.model` is currently the actual response model for xAI. Adding `responseModel` would double-record.

**Locked spec:** Rename the new fields to `requestedModel?: string` (the model the wrapper asked for) and `responseId?: string` (upstream message id when present). When `requestedModel === model`, adapters omit `requestedModel` to keep the event compact. Documented in `docs/references/provider-contract.md` § "ProviderResponse fields."

## Updated borrow set (post-synthesis)

| # | Status | Action |
|---|---|---|
| B1 | accepted with naming fix | `requestedModel` + `responseId`, omit `requestedModel` when equal to `model` |
| B2a | accepted | `cacheRetention` + opaque `cacheSessionId`, no policy table, M13 follow-up |
| B2b | deferred | needs its own briefing when a PE milestone justifies per-phase request-shaping policy |
| B3 | accepted with hardening | observer-only by default; explicit `onPayloadRedact` seam owned by wrapper, never phase-registered |
| B4 | accepted | 12-pair offline matrix using FakeProvider family aliasing |
| B5 | accepted with rework | allowlisted, never-cached env reader; reject pi-mono's whole-env Map approach |
| B6 | reframed | code-oz-original typed `ProviderDiagnostic` with `secret: boolean`; pi-mono contributes the *idea* of a structured diagnostic, not the redaction shape |
| B7 | deferred | requires compiled-binary adapter-keepalive test first |
| B8 | downgraded | "model lifecycle guard" now (constants + doctor check + typed unavailable error); full generated registry post-PE-2 |
| S1 | rejected (now) | catalog lands as PE-2 doc checklist; source-level compat records wait for provider #2; auto-detection stays rejected permanently |

Reject set unchanged (R1-R5), with R1 annotated as "demand-gated, not permanent" for future meta-providers like OpenRouter.

## What ships from this comparison (acceptance gates per item)

Nothing ships from the comparison itself — this is research, not implementation. Locked decisions become inputs to:

- **Next M13 follow-up commit** picks up B2a + the `cacheSessionId` privacy invariant test.
- **Next standalone-PR slot** picks up B4 (12-pair handoff matrix; cheap, high leverage, blocks no other work).
- **Next CLAUDE.md cleanup pass** addresses MR-1 status drift independently.
- **PE-2 milestone briefing** picks up S1 source-level compat records, B8 full registry, and B5 (PE-2 will expand env-key reading).
- **Next compiled-binary CI work** picks up the adapter-keepalive test that unblocks B7.
- **B1, B3, B6** are wrapper-layer changes — bundle into the next wrapper-touching milestone.

## Open follow-ups for future sessions

1. Recheck pi-mono's `agent-loop.ts` and `harness/compaction/compaction.ts` (848 lines). This session focused on `pi-ai` because that is where CLAUDE.md's existing borrow lives. The agent runtime + compaction logic may be its own borrow set, particularly for code-oz's M10 debate runtime (which has no compaction story) and Reviewer panel (where reviewers see large argument bundles). Out of scope for this session by Codex's framing (one template per session, focused) but flagged.

2. Re-evaluate R1 if a code-oz user files a real "I want to use my OpenRouter / Vercel Gateway key" demand. The reject is correctly framed as "weakens family identity" but the debate would shift if a user treats meta-providers as wrapping a *single declared family* (e.g., "OpenRouter, but only routing to Anthropic"). That is a future briefing.

3. Run the inversion audit on B3 / B7 / S1 before any of them land. Codex's Q5 reframe added a new milestone-checklist line item; track its first application.

## Closure

The pi-mono comparison closes here. Borrow set is locked at the table above. No code lands from this session. The borrow set becomes the input to the next milestone planning round.
