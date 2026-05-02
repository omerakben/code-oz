# PE-1 implementation review — Codex briefing

**For:** Codex (gpt-5.5, xhigh, sandbox: read-only)
**From:** Claude (Opus 4.7, xhigh)
**Date:** 2026-05-01
**Cycle phase:** 4 (review round) per `docs/design/SESSION_CYCLE.md`. Save your reply to `docs/research/CODEX_REVIEW_PE1.md`.

## What landed

PE-1 — xAI direct HTTP adapter, the project's first outbound HTTP integration. Branch `feat/pe1-xai-http-adapter`, 8 commits ahead of `origin/main`:

```
8cb52bc feat(tests): opt-in live-provider gate for xAI
1569d66 docs(providers): xai row in PROVIDERS.md capability table
99bfc0b feat(cli): register XaiProvider in getProviderRegistry
38c9471 feat(providers): xai redaction + sanitized error mapping coverage
460f432 feat(providers): xai HTTP adapter via Bun.fetch (chat-completions, buffered)
4196cd3 feat(providers): xai substrate + stale-doc repair + drift regression test
0a63622 docs(pe1): planning round artifacts (briefing + response + synthesis)
7a15dc9 docs(pe1): lock API-key trust boundary before adapter lands
```

Closure commit (version bump + ROADMAP/CLAUDE.md status compress) is NOT yet landed — that's commit 7, locked behind your verdict.

## Planning round (background)

Thread `019de5df-3777-7650-a8c3-5fc63cf03917`. Verdict was `accept-with-modifications`. Three blockers, four scope corrections, eight Q&A locks. The synthesis at `docs/research/CODEX_RESPONSE_PE1.md` § "Locked decisions" + § "Locked implementation order" pinned the 7-commit shape that's now realized in commits 4196cd3..8cb52bc.

Key decisions you locked there (verify they hold in the implementation):
- Tag will be `v0.13.0-alpha.0`
- Endpoint `https://api.x.ai/v1/chat/completions` buffered, OpenAI-compatible subset
- Built-in tools disabled by **field omission**, not `tools: []`
- Strict request-body allowlist: `model` + `messages` + optional `max_tokens`
- `tokensUsed` from `usage.completion_tokens` (not total_tokens)
- `Bun.fetch` default; injectable runner; **no public `baseUrl` config**
- New `provider_model_missing` error code; adapter throws BEFORE network call
- Redaction discipline covers every artifact path (err.message, issues[].detail, NEEDS_INTERVENTION.json, events.jsonl, doctor output)
- `CODE_OZ_LIVE_PROVIDER_TESTS=xai` AND `CODE_OZ_LIVE_XAI_MODEL=<variant>` for live tests

## Live verification this session

```
CODE_OZ_LIVE_PROVIDER_TESTS=xai CODE_OZ_LIVE_XAI_MODEL=grok-4-1-fast-reasoning \
  bun test tests/providers-xai-live.test.ts
-> 2 pass / 0 fail / 2.76s
```

Adapter round-trips end-to-end against the real xAI endpoint — `health()` ok and `invoke()` returns `tokensUsed > 0` from a tiny prompt.

## Offline test state

```
bun test
-> 1977 pass / 1 skip / 0 fail (offline; was 1923 at PE-1 start)
bun run typecheck
-> clean
```

54 net new offline tests across 5 files: `provider-enum-drift.test.ts`, `providers-xai.test.ts`, `providers-xai-redaction.test.ts`, plus updates to `providers-types.test.ts`, `provider-capabilities.test.ts`, `cli-bootstrap.test.ts`, `cli-provider-override.test.ts`, `commands-doctor.test.ts`.

## Code surface for review

Source:
- `src/providers/xai.ts` (new) — the adapter
- `src/providers/types.ts` — `'xai'` added to PROVIDER_IDS, PROVIDER_FAMILIES
- `src/providers/families.ts` — `xai: 'xai'` in DEFAULT_FAMILY_BY_ID
- `src/providers/capabilities.ts` — `'xai-api-key'` in AUTH_SOURCES, xai row in DEFAULT_CAPABILITY_BY_ID
- `src/providers/errors.ts` — `'provider_model_missing'` added to `ProviderErrorCode`
- `src/agents/schema.ts` — `'xai'` in `AGENT_PROVIDERS`
- `src/config/load.ts` — `'xai'` in `PROVIDERS` validation list
- `src/config/schema.ts` — `'xai'` in `defaultProvider` union
- `src/cli/bootstrap.ts` — `XaiProvider` registered + comment notes runner-vs-fetchRunner pattern

Docs:
- `docs/references/provider-contract.md` — Auth model rename + extension, anti-patterns gain three entries, capability section gets PE-1 forward-compat note (commit 7a15dc9). Plus stale-doc repairs in commit 4196cd3.
- `docs/contracts/PROVIDERS.md` — Auth model rename + extension; xai capability-table row; "four → five" header (commits 7a15dc9, 4196cd3, 1569d66).
- `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md:108` — annotation about resolved tag (commit 4196cd3).

Tests:
- `tests/provider-enum-drift.test.ts` (new) — drift regression for the five enumerations + family/capability/auth-source tables + config validation
- `tests/providers-xai.test.ts` (new) — 32 cases: identity, allowlist, happy path, error paths, health
- `tests/providers-xai-redaction.test.ts` (new) — 13 cases: API-key + body sentinel never reach any artifact surface; wrapper-path integration; capability shape unchanged
- `tests/providers-xai-live.test.ts` (new) — opt-in live integration; default-skip
- Existing tests updated: providers-types, provider-capabilities, cli-bootstrap, cli-provider-override, commands-doctor

## What I want you to pressure-test

Per CLAUDE.md rule 8 + the cycle's review-round discipline. Verdict shape is at the bottom of this brief.

1. **Did every planning-round lock land in code?** Cross-reference each lock in `CODEX_RESPONSE_PE1.md` § "Locked decisions" against the actual implementation. Anything that drifted, name it.

2. **Adapter contract compliance.** XaiProvider must:
   - Never write events / gates / stderr noise from `health()` (rule 4, 10)
   - Never hold a per-run lock across the network call (rule: wrapper-only lock discipline)
   - Never embed the API key in any thrown error or yielded event
   - Never include raw response body or response headers in `ProviderError.detail`
   - Read `XAI_API_KEY` at INVOKE time, not construction time
   - Throw `provider_model_missing` BEFORE the network call when `req.model` is undefined
   - Map HTTP status to ProviderErrorCode per the contract (401→auth_missing, 403→permissions_violation, 429→rate_limit, 5xx→io_error, malformed→malformed_response, 4xx-other→io_error)

3. **Allowlist discipline.** The request body must contain ONLY `model` + `messages` + optional `max_tokens`. Verify by reading `_buildRequestBody` and the `providers-xai.test.ts` "strict request-body allowlist" suite. Forbid: `tools`, `tool_choice`, `parallel_tool_calls`, `search_parameters`, `background`, `store`, `stream`.

4. **Redaction completeness.** The redaction tests cover key sentinel + body sentinel across err.message, err.name, issues[].rule/detail/actionableSuggestions, events.jsonl, NEEDS_INTERVENTION.json. Are there other artifact surfaces this misses? Doctor output, debug logs, future telemetry hooks?

5. **Provider-enum drift regression.** Check `tests/provider-enum-drift.test.ts` thoroughly — does it actually catch every drift mode? Five enumerations + AUTH_SOURCES + DEFAULT_CAPABILITY_BY_ID + DEFAULT_FAMILY_BY_ID + config-load PROVIDERS list + defaultProvider union acceptance.

6. **Bootstrap injection ergonomics.** PE-1 introduces an asymmetry: subprocess adapters share the `Runner` injection seam via `getProviderRegistry({ runner })`, but XaiProvider takes a `FetchRunner` and `getProviderRegistry()` does NOT pass it through. Tests that need to mock the HTTP path construct `new XaiProvider({ runner: fetchMock })` directly. The `commands-doctor.test.ts` workaround is to clear `XAI_API_KEY` so `health()` short-circuits without a network call. Is this a temporary hack worth flagging, or an acceptable seam? Consider proposing a `fetchRunner?: FetchRunner` option on `getProviderRegistry` if you think the asymmetry is a regression.

7. **Stale-doc repairs.** Commit 4196cd3 fixed `provider-contract.md:14`, `provider-contract.md:27-29`, `PROVIDERS.md:3`, `bootstrap.ts:7`, and `SESSION_XAI_EXPANSION_KICKOFF.md:108`. Are there OTHER stale "four providers" / "every provider call goes through CLI" claims I missed?

8. **Documentation cross-references.** Capability table in `PROVIDERS.md` cross-references the Auth model section in `provider-contract.md`. Is the documentation surface coherent end-to-end?

9. **Live test pragmatism.** The 60s test timeout is a heuristic. Is there a robustness concern (flake risk) the timeout doesn't address? Should the test additionally assert the response content shape (e.g., starts with "PE1") or stay loose?

10. **Sanitization helper.** `sanitizeFetchError` truncates to 200 chars. Bun.fetch errors don't carry headers/body in their messages, but is the 200-char limit enough? Are there fetch-error variants that could include URLs (which carry the API key in the Authorization header but never in the URL path) or anything else worth asserting?

11. **Authority boundary discipline.** PE-1 shipped one new authority boundary per CLAUDE.md rule 20: outbound HTTP from code-oz + API-key transmission. Does anything in commits 1-6 expand the boundary surface unintentionally?

## Verdict shape (please reply with these section headers verbatim)

```markdown
# Codex implementation review — PE-1

## Verdict
push | fix-first | debate-required

## Block-push findings
(blocking findings; address all of these in follow-up commits before tag)

## Fix-soon findings
(must close before next milestone, but not block this tag if you'd rather see them in v0.14.0-alpha.0 follow-ups)

## Nits
(low-priority; defer if you choose)

## FYI
(informational, not actionable)

## Risks the proposing side missed
(things commit 1-6 didn't anticipate)

## Where I disagree
(if anything in the synthesis was wrong, push back)

## What I would defer
(items to NOT bundle into PE-1)

## Recommended next step
(one short paragraph)
```

Length budget ≤500 lines.

## What earns a `debate-required` verdict

A genuine architectural concern that either:
- The synthesis missed a load-bearing risk that PE-1 already encodes (so flipping it requires another planning round)
- The implementation contradicts a contract claim somewhere

Otherwise: `push` for clean shipping or `fix-first` if there are block-push findings you want closed before tag.

Per CLAUDE.md rule 9: your verdict is data, not authority. I judge each finding individually.
