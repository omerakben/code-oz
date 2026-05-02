# Codex implementation review — PE-1 (round 1)

**Thread:** `019de60e-2362-71d2-861e-5cceb9a4f97a`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`docs/research/CODEX_BRIEFING_PE1_REVIEW.md`](./CODEX_BRIEFING_PE1_REVIEW.md)
**Branch HEAD reviewed:** `8cb52bc feat(tests): opt-in live-provider gate for xAI` (8 commits ahead of origin/main)

> Codex's session was read-only per the cycle's review-round invocation pattern, so it could not write this file. The reply is verbatim below; the synthesis at the end is Claude's, written immediately after the round closed.

---

## Verdict
fix-first

The adapter implementation is close and I do not see a debate-required architecture issue. Do not tag or push yet. Two planning locks are not actually closed: the canonical provider contract still has stale PE-1 snippets, and the API-key redaction proof does not cover the doctor path or secret-bearing fetch-error messages.

## Block-push findings

1. Canonical provider docs still contradict PE-1.

`docs/references/provider-contract.md` calls itself the pinned spec, but its canonical snippets still omit PE-1 state:

- [docs/references/provider-contract.md](../references/provider-contract.md) line 134 — `ProviderErrorCode` omits `provider_model_missing`, while source has it in [src/providers/errors.ts](../../src/providers/errors.ts) line 11.
- [docs/references/provider-contract.md](../references/provider-contract.md) line 347 — `AuthSource` omits `xai-api-key`, while source has it in [src/providers/capabilities.ts](../../src/providers/capabilities.ts) line 31.
- [docs/references/provider-contract.md](../references/provider-contract.md) line 380 — the default eligibility table omits the `xai` row.
- [docs/references/provider-contract.md](../references/provider-contract.md) line 283 — the HTTP mapping table omits the PE-1 locked `4xx-other -> provider_io_error` row and does not mention pre-network `provider_model_missing`.
- [docs/references/provider-contract.md](../references/provider-contract.md) line 340 — says `tools: []` is acceptable, but PE-1 locked built-in tools disabled by field omission, not `tools: []`.
- [docs/contracts/COMPANY.md](../contracts/COMPANY.md) line 51 — still prints `AGENT_PROVIDERS = ['claude', 'codex', 'gemini', 'fake']` and frames xAI as future.

This is not just polish. Future milestones treat these contract snippets as authority.

2. Redaction is not proven for doctor output or secret-bearing fetch errors.

`sanitizeFetchError` is truncation, not redaction: [src/providers/xai.ts](../../src/providers/xai.ts) line 360. If a fetch-layer error message includes `Authorization: Bearer <key>` or the key sentinel itself, the current helper would preserve it in `ProviderError.detail`, `ProviderError.message`, and doctor JSON.

The tests do not close that gap:

- [tests/providers-xai-redaction.test.ts](../../tests/providers-xai-redaction.test.ts) line 200 — covers a network error, but the thrown message contains only the body sentinel, not the API-key sentinel or an auth header.
- [tests/commands-doctor.test.ts](../../tests/commands-doctor.test.ts) line 15 — clears `XAI_API_KEY` because the production doctor path cannot inject a fetch runner, so it never exercises xAI `health()` with an API key.
- [src/commands/doctor.ts](../../src/commands/doctor.ts) line 444 — serializes the full report to JSON, including `lastError.detail`.

Fix before tag: make fetch-error sanitization secret/header-aware, and add doctor table plus `--json` tests that run xAI health through an injected `FetchRunner` with `XAI_API_KEY` set.

## Fix-soon findings

`provider-enum-drift.test.ts` catches membership drift, but not the full xAI eligibility lock. It proves xAI exists and has `xai-api-key` at [tests/provider-enum-drift.test.ts](../../tests/provider-enum-drift.test.ts) line 94, but a future accidental change from `ALL_PHASES` to a subset would pass. Add a direct assertion mirroring the Claude/Codex/Fake tests in [tests/provider-capabilities.test.ts](../../tests/provider-capabilities.test.ts) line 57: `DEFAULT_CAPABILITY_BY_ID.xai.eligiblePhases` equals `AGENT_PHASES`.

## Nits

[tests/config-load-company.test.ts](../../tests/config-load-company.test.ts) line 324 says every `AgentProvider` value is accepted but only checks four providers. Either include xAI there or reword the comment, since `provider-enum-drift.test.ts` now owns the exhaustive check.

The `XaiProvider` comments say "Bun.fetch," while the default runner calls global `fetch` at [src/providers/xai.ts](../../src/providers/xai.ts) line 202. That is fine under Bun, but "Bun global fetch" would be more exact.

## FYI

The core adapter behavior is good: explicit model before network, request-body allowlist, no tool/search/store fields, `usage.completion_tokens`, status mapping, no public baseUrl config, live-test env gating, and buffered chat-completions all landed.

`bun run typecheck` is clean. I attempted the targeted PE-1 tests, but this read-only sandbox denied `mkdtemp` under `/var/folders/...`, so three temp-writing tests failed with `EPERM`. The non-temp PE-1 cases ran 50 pass / 0 behavioral fail before the sandbox failures. I did not independently verify the reported full offline suite or live xAI run.

I could not save this to `docs/research/CODEX_REVIEW_PE1.md` because the filesystem is read-only.

## Risks the proposing side missed

The bootstrap `runner` vs `FetchRunner` asymmetry is not just ergonomics. It directly caused the doctor tests to clear `XAI_API_KEY` instead of mocking the xAI health path, which left a locked redaction surface untested.

The docs drift is concentrated in canonical snippets, not random prose. That is where the next milestone is most likely to copy from.

## Where I disagree

I disagree that `tests/providers-xai-redaction.test.ts` fully closes Codex Blocker #3. It covers adapter errors and wrapper gate/event artifacts, but not doctor output with xAI health under an API key, and not a fetch error message that itself contains the key or an auth header.

I also disagree that stale-doc repair is complete. `PROVIDERS.md` is mostly coherent, but `provider-contract.md` and `COMPANY.md` still contain current-state contradictions.

## What I would defer

Do not bundle Responses API migration, retry/backoff, `Retry-After` handling, public `baseUrl` config, gateways, OpenRouter, native xAI tools, or live-test exact text matching into PE-1.

Keep the live test loose on content. Asserting non-empty content, `end_turn`, model string, and `tokensUsed > 0` is enough; exact "PE1" matching would add model-behavior flake without improving the adapter contract much.

## Recommended next step

Land one follow-up commit before the closure commit: update the canonical docs, add a `fetchRunner?: FetchRunner` seam through `getProviderRegistry` and doctor test setup, harden `sanitizeFetchError` to redact current API keys and auth-header patterns, then rerun typecheck, full offline tests, and the opt-in xAI live test. After that, the closure commit and tag should be straightforward.

---

## Synthesis (Claude, 2026-05-01)

**Verdict absorbed:** `fix-first`. Codex caught two real block-push items the planning round under-specified. Closing both before any tag/push.

### What's wrong

1. **Canonical doc drift (block-push #1)**: The provider-contract.md "pinned spec" sections include verbatim TypeScript fragments that I missed updating in commit 1's stale-doc repair. Six concrete drift points, plus COMPANY.md's hardcoded `AGENT_PROVIDERS` snippet. These contradictions become authority for future milestones — the failure mode is "M13 reads provider-contract.md, sees 4 providers, drifts."

2. **Redaction proof incomplete (block-push #2)**: Two concrete gaps:
   - `sanitizeFetchError` is a length-truncator. If a future Bun.fetch error message ever embeds a Bearer header, it would survive the truncate. Defense: pattern-replace.
   - The `commands-doctor.test.ts` workaround (clear `XAI_API_KEY` to avoid network) leaves the doctor JSON / table path untested for xAI under a real key. The right fix is the architectural seam (fetchRunner injection through getProviderRegistry → runDoctorProviders), which I considered in commit 4 and deferred. Codex is right that the asymmetry directly caused the test gap.

3. **Drift-test misses eligibility (fix-soon)**: My drift test catches membership drift but not the eligiblePhases shape. A future accidental restriction would slip through. Direct assertion needed.

4. **Two nits**: `config-load-company.test.ts` comment vs assertion mismatch; "Bun.fetch" wording inaccurate (it's `globalThis.fetch`).

### Pushbacks

None. Every Codex finding is correct.

### Locked fix order

Three follow-up commits (A, B, C) before commit 7 (closure):

**A. `docs(pe1): close Codex review block-push #1 — canonical doc drift`**
- Update `provider-contract.md` ProviderErrorCode list (line 134) + AuthSource list (line 347) + default eligibility table (line 380) + HTTP mapping table (line 283) + the "tools: []" sentence (line 340)
- Update `COMPANY.md:51` AGENT_PROVIDERS snippet

**B. `feat(providers): close Codex review block-push #2 — fetch-error redaction + fetchRunner injection seam`**
- Harden `sanitizeFetchError` to redact `Bearer <token>` and the literal API key value (read once at construction, pattern-replace on output)
- Add `fetchRunner?: FetchRunner` to `ProviderRegistryOptions` in `bootstrap.ts` + pass to XaiProvider when present
- Add `fetchRunner?: FetchRunner` to `RunDoctorProvidersOptions` + thread through `runDoctorProviders` to the registry
- Add new test in `tests/commands-doctor.test.ts` covering xAI health with `XAI_API_KEY=<sentinel>` set + injected FetchRunner that throws an error containing the sentinel; assert no leak in doctor table OR JSON output
- Strengthen the existing redaction test to cover an API-key sentinel inside a fetch error message

**C. `test(providers): close Codex fix-soon + nits`**
- Drift test gains explicit `DEFAULT_CAPABILITY_BY_ID.xai.eligiblePhases === AGENT_PHASES` assertion
- `provider-capabilities.test.ts` gains a per-id xai eligibility test mirroring claude/codex/fake
- `config-load-company.test.ts:324` comment + assertion: include xai
- `xai.ts` comment wording: "Bun global fetch" instead of "Bun.fetch"

### After all three commits

Re-run `bun run typecheck` + full `bun test` (offline) + opt-in live test. If clean, re-invoke Codex review on the new commits. If verdict is `push`, ship commit 7 (closure: version bump + ROADMAP/CLAUDE.md status compress + close PE-1).

Tag candidate: `v0.13.0-alpha.0` per Codex Q1 lock.

---

## Round 2 (closure verification)

**Thread:** `019de61a-cb15-7ac0-b60f-1f3d7e270902`
**Date:** 2026-05-01
**Verdict:** `push`

### Verbatim Codex round-2 reply (verdict + key findings)

> **Verdict: push**. The three follow-up commits genuinely close the round-1 block-push items. I do not see a new block-push or fix-soon issue in the closure changes.
>
> **Block-push #1 closed:** the canonical provider contract now includes `provider_model_missing`, `xai-api-key`, the `xai` default eligibility row, the `4xx-other -> provider_io_error` mapping, pre-network missing-key/missing-model handling, and the corrected field-omission language for tools. `COMPANY.md` now matches the live `AGENT_PROVIDERS` enum.
>
> **Block-push #2 closed:** `sanitizeFetchError` now redacts the current `XAI_API_KEY`, `Bearer <token>`, `Authorization: <value>`, and `x-api-key: <value>` patterns before truncation. The doctor path now accepts `fetchRunner` and threads it to `XaiProvider`. `doctorCommand()` does not expose that seam to CLI users.
>
> **Fix-soon closed:** the eligibility drift hole is closed in both places — `provider-enum-drift.test.ts` locks `xai.eligiblePhases === AGENT_PHASES`, and `provider-capabilities.test.ts` adds the per-id assertion.
>
> **Nits:** a little `Bun.fetch` wording remains in `xai.ts:31`, `xai.ts:344`, and `provider-contract.md:315`. Not behaviorally important.
>
> **Recommended next step:** proceed with closure (version bump, ROADMAP/CLAUDE status, tag).

### Synthesis

Verdict absorbed: `push`. Lingering wording nit closed in commit `<TBD>` for the no-tech-debt rule. Proceeding to commit 7 (closure: version bump to `v0.13.0-alpha.0`, ROADMAP PE-1 row, CLAUDE.md status compression).
