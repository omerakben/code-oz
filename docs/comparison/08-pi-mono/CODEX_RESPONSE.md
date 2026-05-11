---
template: pi-mono
companion-doc: CODEX_BRIEFING.md
codex-thread: 019e12f0-5d93-7c73-b137-925eb6a5b867
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only
verdict: accept-with-modifications
captured: 2026-05-10
---

# Codex response — pi-mono comparison

> Reproduced verbatim from Codex thread `019e12f0-5d93-7c73-b137-925eb6a5b867`. No edits, no reformatting beyond Markdown headings to make the structure browseable. Synthesis decisions live in `SYNTHESIS.md`.

## Verdict

**accept-with-modifications**

The borrow set is directionally right, but it is too casual about authority boundaries and privacy. The biggest corrections: split B2, do not copy B5 verbatim, downgrade B8 from "generated registry now" to "small model lifecycle guard now," and treat B6 as a code-oz-designed diagnostic contract, not a pi-mono contract.

## Q1 — B2 framing

Split it.

**B2a**, adding optional `cacheRetention` and an opaque cache-session field to `ProviderRequest`/`PreparedProviderRequest`, is a small provider-contract extension. It can land as a follow-up if it defaults to current behavior, is logged in `agent_invoked`, and no phase policy table changes behavior yet.

**B2b**, automatic per-phase policy like REVIEW=long and DEFINE=short, is new request-shaping authority. It changes cost, provider state retention, and privacy exposure. That is not just M13 budget plumbing. It deserves its own narrow "provider request policy" slice or should be bundled only if a PE milestone explicitly needs it.

Also: do not reuse raw `runId` as upstream `sessionId`. That creates provider-visible correlation across phases and potentially across sensitive repos. Use an opaque per-provider, per-run derived id, and only when `cacheRetention !== 'none'`.

## Q2 — B4 size

Use a 12-directional offline matrix, but do not copy pi-mono's live-test shape.

The briefing says pi-mono parametrizes provider × provider. The actual test generates contexts for available real providers, then each target consumes all other contexts in one request. That is useful for pi-mono's SDK category, but not the right default for code-oz.

For code-oz, the invariant is family handoff under rule 2. FakeProvider can alias all provider ids while preserving family identity through `buildProviderRegistry({ providerOverride: 'fake' })`, so the cheap thing is one rich handoff fixture across all 12 directional family pairs: claude, codex, gemini, xai, excluding same-family. Assert the message/artifact bytes survive, the target family is different, events carry the requested and actual model fields, and no hidden recursive repo context is introduced. Keep it offline. Add live-provider handoff only later, opt-in, when a real provider codec starts transforming tool or reasoning blocks.

## Q3 — B8 timing

Do not schedule the full 2-3 day generated model registry before the PE-2 demand checkpoint. Do schedule a smaller guard now.

I verified the platform fact against current Anthropic docs. `claude-opus-4-20250514` and `claude-sonnet-4-20250514` are deprecated and retire on June 15, 2026, with replacements `claude-opus-4-7` and `claude-sonnet-4-6`. But code-oz's current default is already `claude-opus-4-7` in `src/config/schema.ts:265`, and Anthropic lists `claude-opus-4-7` as active, not retiring before April 16, 2027. So the catastrophic default-model claim is overstated.

The real issue is scattered hardcoded model strings and weak model-availability reporting. Fix that with a smaller pre-PE-2 patch: central model constants, a `doctor providers` check that actually validates configured default availability where the provider supports listing models, and a typed `provider_model_unavailable` style error instead of generic 400/404 handling. Full B8 can wait until after PE-2, when provider count and model catalog churn justify generation.

## Q4 — S1 scope

Do not land a 14-knob `OpenAICompletionsCompat` record for xAI alone.

The xAI adapter is intentionally a strict allowlist over chat completions in `src/providers/xai.ts:242`. A generic compat record with one provider and no edge diversity is documentation masquerading as infrastructure. Worse, it invites future adapters to toggle knobs without a milestone-gated authority review.

Accept the catalog as a PE-2 checklist in docs. Land source-level compat records only when provider #2 arrives, probably PE-2/OpenRouter, because that is when lineage, routing, cache, max-token field, and family identity become real tested edges. Keep auto-detection rejected permanently.

## Q5 — Reverse-direction borrows

Yes, code-oz has lessons pi-mono should learn, but not as a wholesale worktree mandate.

Pi-mono's AGENTS.md-style git discipline is too manual for parallel coding agents. A runtime path guard, dirty-tree snapshot, optional worktree-per-agent mode, and command denylist for `git add -A`, `git stash`, `git reset --hard`, and `--no-verify` would be real wins. But pi-mono is also a single coding-agent harness and SDK; forcing every user into a separate worktree may be too heavy.

The inversion audit for code-oz is sharper: do not let future borrows regress runtime enforcement into "agents should remember." B3 callbacks, B2 session ids, B7 lazy provider loading, and S1 router compatibility all need runtime checks because every one can launder authority if left to convention.

## Missed risks

1. **CLAUDE.md/status drift** — severity: **block-push**. CLAUDE.md still says v0.13/PE-1/1983 tests, while ROADMAP.md says M16 closed locally with 3108 tests and tag pending. The comparison docs also mention W3/v0.14 tarballs. Do not push the comparison without reconciling status language.

2. **B6 source mischaracterized** — severity: **block-push**. Pi-mono's `AssistantMessageDiagnostic` is not redacted-by-construction in the source I read. It stores error message, stack, code, and arbitrary details. The `secret: boolean` idea is good, but it is a code-oz hardening design, not a pi-mono borrow.

3. **B5 "steal verbatim" is unsafe wording** — severity: **fix-soon**. Pi-mono's `/proc/self/environ` helper parses the whole environment into a map. For code-oz rule 13, implement an allowlisted key reader that never logs, serializes, or caches unrelated env vars. The borrow is valid, the verbatim-copy recommendation is not.

4. **B3 callbacks can become a hidden authority surface** — severity: **fix-soon**. `onPayload` that can replace payloads is not just telemetry. In code-oz it should be wrapper-owned, observer/redactor-only by default, and tested to prove phase code cannot inject arbitrary outbound mutation.

5. **B7 lazy provider loading may break compiled-binary keepalive** — severity: **fix-soon**. `src/cli/bootstrap.ts:1` explicitly imports adapters to keep them alive through Bun compilation. Any lazy import refactor must prove the compiled binary still contains every built-in adapter.

6. **B1 audit fields need naming discipline** — severity: **nit**. `ProviderResponse.model` already means actual response model for xAI. Add `requestedModel`/`responseId` at events level, or define `model` vs `responseModel` precisely to avoid double-recording the same value.

## Disagreements with the borrow set

- B2: not a plain M13 follow-up if it ships an automatic per-phase policy table.
- B3: accept only as a constrained wrapper hook, not a generic pi-mono-style payload replacement callback.
- B5: accept the workaround, reject "verbatim."
- B6: accept typed diagnostics, reject the claim that pi-mono already proves the redaction shape.
- B7: defer until compiled-binary inclusion is tested.
- B8: reject full generated registry before PE-2; accept a smaller model lifecycle guard now.
- S1: reject source-level compat record until second OpenAI-compatible provider.

## Confirmations

- B4 is correctly classified as high leverage. It protects rule 2 and should be offline.
- R2 is correct. pi-tui/pi-web-ui are not code-oz's product surface.
- R3 is correct. Lockstep monorepo versioning is irrelevant to a single-package CLI.
- R4 is correct. TypeBox would be churn against the existing Zod/typed-contract direction.
- R5 is correct. Image generation is out of category.
- R1 is mostly correct. A 30-provider matrix would weaken the audited family set. Caveat: PE-2/OpenRouter is not a permanent reject; it is demand-gated with lineage-proof requirements.
- S1's rejection of auto-detection is correct. Provider family identity must be declared and auditable, never inferred from base URL.

## Platform sources Codex checked

- Anthropic's current model deprecation page confirms the June 15, 2026 retirement for `claude-opus-4-20250514` and `claude-sonnet-4-20250514`.
- Anthropic's model overview lists `claude-opus-4-7` as the current active Opus default candidate.
- See [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) and [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview).
