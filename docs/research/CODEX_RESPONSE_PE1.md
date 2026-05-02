# Codex planning review — PE-1

**Thread:** `019de5df-3777-7650-a8c3-5fc63cf03917`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`docs/research/CODEX_BRIEFING_PE1.md`](./CODEX_BRIEFING_PE1.md)

> **Note on file authorship:** Codex's session was read-only per the locked planning-round invocation pattern. The reply below is Codex's verbatim text; the synthesis at the end is Claude's, written immediately after the round closed.

---

## Verdict
accept-with-modifications

PE-1 should proceed. The one authority boundary is still clean: first outbound HTTP adapter plus API-key trust handling. I do not see a reason for a new debate round, but the plan needs a few pre-code corrections around stale provider docs, xAI model selection, redaction proof, and live-test inputs.

## Blockers before code
1. Fix the canonical provider docs before adapter code lands, or make it the first part of commit 1. `docs/references/provider-contract.md:14` still says every provider call goes through an upstream CLI until W3, while the same file now adds PE-1 API-key HTTP auth. `docs/references/provider-contract.md:27` and `docs/contracts/PROVIDERS.md:3` still describe four providers.

2. Lock xAI model behavior. Do not hardcode `xai-default`. `AgentDefinition.model` is optional (`src/agents/schema.ts:239`), and `buildManifest` only forwards a model when `req.model ?? req.agent.model` exists (`src/providers/manifest.ts:127`). For `provider: xai`, require an explicit model binding via frontmatter or `company.<role>.model`, then fail with a typed actionable provider error if absent.

3. Redaction cannot be adapter-only. `ProviderError` embeds `detail` into `Error.message` (`src/providers/errors.ts:56`), and the wrapper writes `issue.detail` into `NEEDS_INTERVENTION.json` (`src/providers/invoke.ts:249`). Tests must cover `err.message`, `issues[].detail`, doctor table, doctor JSON, gate files, and events.

## Scope corrections
- Keep chat-completions for PE-1, but document that xAI now recommends Responses and labels Chat Completions legacy/deprecated. This is a conscious minimal-risk choice, not ignorance of the newer endpoint. Sources: [xAI Chat endpoint](https://docs.x.ai/developers/rest-api-reference/inference/chat), [xAI comparison guide](https://docs.x.ai/developers/model-capabilities/text/comparison).

- "Built-in tools disabled" should be implemented as a request-body allowlist. Send only the fields PE-1 needs. Assert absence of `tools`, `tool_choice`, `parallel_tool_calls`, `search_parameters`, `background`, and `store` where relevant. Sources: [xAI Web Search](https://docs.x.ai/developers/tools/web-search), [xAI Code Execution](https://docs.x.ai/developers/tools/code-execution).

- Do not add an abort/cancellation field to `IAgentProvider` or `PreparedProviderRequest` in PE-1. The current interface is `invoke(req)` only (`src/providers/types.ts:186`), and the wrapper calls `adapter.invoke(prepared)` with no signal (`src/providers/invoke.ts:158`). A cancellation contract is separate work.

- `health()` should use `GET /v1/models` as a non-generative auth probe, but do not claim "billing-free" unless xAI docs state that directly. Source: [xAI Models API](https://docs.x.ai/developers/rest-api-reference/inference/models).

## Open-question resolutions
### Q1. Tag naming
- Resolution: Use `v0.13.0-alpha.0`.
- Reasoning: PE-1 is semver-significant for this alpha line because it expands the runtime trust boundary. `v0.12.2-alpha.0` makes it look like a patch to M12. The M-number and tag-number no longer need to stay 1:1 once PE-N insertion points exist.

### Q2. Endpoint URL + request shape
- Resolution: Use `POST https://api.x.ai/v1/chat/completions`, buffered, OpenAI-compatible chat-completions subset: `model`, `messages`, optional `max_tokens` only if mapped from `req.maxOutputTokens`. Require explicit model binding for xAI.
- Reasoning: The official docs still expose `/v1/chat/completions`, and the REST overview confirms `https://api.x.ai` plus bearer auth. Responses is the strategic endpoint, but it introduces storage/tooling semantics PE-1 does not need. Chat Completions is the smaller privacy surface for this milestone.

### Q3. Built-in tools opt-out
- Resolution: Omit tool-related fields entirely, and make the request body an allowlist.
- Reasoning: xAI tool examples opt in with explicit tools. Omission is safer than `tools: []`, and PE-1 should also omit adjacent tool/search fields so legacy live search or Responses-style tooling cannot be armed accidentally.

### Q4. Streaming vs buffered
- Resolution: Buffered only.
- Reasoning: This matches Claude/Codex adapter behavior and avoids adding the first streaming UX semantics in the same milestone as the first HTTP/API-key trust boundary. Yield one `content_chunk` and one `turn_completed`.

### Q5. tokensUsed provenance
- Resolution: Use `usage.completion_tokens` as output-token `tokensUsed` when present and numeric. Do not use `total_tokens`.
- Reasoning: Current budget accounting already records input estimate at `agent_invoked` and output actual at `agent_completed`. `total_tokens` would double-count prompt/file input.

### Q6. HTTPS client
- Resolution: Use Bun's built-in fetch surface with an injected fetch-like runner for tests. No production dependency.
- Reasoning: This matches the Bun stack and the kickoff's no-dependency lock. Keep `baseUrl` test-only if added. Do not expose a public gateway/base-url config in PE-1.

### Q7. Demand-checkpoint mechanism
- Resolution: Use `docs/research/XAI_DEMAND_CHECKPOINT_<date>.md`.
- Reasoning: Durable and cheap. Capture the six route buckets from the kickoff, anonymized demand notes, date, and decision: PE-2 now vs M13 next. Do not include API keys, account names, or screenshots.

### Q8. Live-test gating
- Resolution: Use `CODE_OZ_LIVE_PROVIDER_TESTS=xai`, parsed as a trimmed comma-separated set. Add a second live-test-only model input, preferably `CODE_OZ_LIVE_XAI_MODEL`, because PE-1 should not hardcode a default model.
- Reasoning: The provider gate composes for PE-2+. The model env is necessary because xAI requests require `model`, and model names drift faster than this repo should.

## Risks the proposing side missed
- xAI model selection is load-bearing. Without an explicit model, a `company.<role>.provider: xai` override can pass provider validation but fail only at HTTP time.

- Raw upstream error bodies can leak more than API keys. They may include prompt or file-content echoes. Provider error `detail` should never dump raw request bodies, raw response bodies, or full headers. Use status, sanitized upstream error code/message, content type, body length, and a short redacted excerpt only if needed.

- Responses API has privacy semantics that need separate design. The xAI comparison guide says Responses is recommended, but the REST schema includes storage-oriented fields. Do not "modernize" to Responses inside PE-1 without a storage/privacy decision.

- `modelDefaultAvailable` is awkward for xAI. `/v1/models` can show that the key can list models; it does not prove the configured role model is valid unless the adapter/doctor is given that exact model.

- The live test cannot be "single round trip" without a model source. Add the model env or explicitly load one from a test fixture config.

## Bugs or stale assumptions Claude missed
- `docs/references/provider-contract.md:14` is stale: it says HTTP-based adapters are W3 and every provider call goes through an upstream CLI until then.

- `docs/references/provider-contract.md:27` and `docs/contracts/PROVIDERS.md:3` are stale four-provider snippets. PE-1 docs work must update both, not just the capability table.

- `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md:108` says PE-1 may tag as `v0.12.0-alpha.0`; that is stale after M12 and the `v0.12.1-alpha.0` refactor tag.

- Claude's redaction lean is too adapter-centered. `ProviderError` includes `detail` in the thrown message (`src/providers/errors.ts:56`), and the wrapper persists detail to `NEEDS_INTERVENTION.json` (`src/providers/invoke.ts:249`).

- The abort-signal pressure-test assumes a contract that does not exist. `IAgentProvider.invoke` only accepts `PreparedProviderRequest` (`src/providers/types.ts:186`), and the wrapper passes no signal (`src/providers/invoke.ts:158`).

- Closure commit 7 is underspecified. Version consistency is pinned by `tests/m5-fix-first.test.ts:29`; current version surfaces are `package.json:3`, `src/cli.ts:7`, and `src/config/schema.ts:153`. If PE-1 tags `v0.13.0-alpha.0`, those must update with the status docs.

## Implementation order changes
1. Add a pre-code docs repair or fold it into commit 1: provider-contract stale sync policy, interface snippet, PROVIDERS "four adapters" wording, and PE-1 tag typo.

2. Keep commit 1 as substrate, but add a provider-enum consistency regression: `PROVIDER_IDS`, `PROVIDER_FAMILIES`, `DEFAULT_FAMILY_BY_ID`, `AUTH_SOURCES`, `DEFAULT_CAPABILITY_BY_ID`, `AGENT_PROVIDERS`, `config/load.ts` provider validation, and `defaultProvider` schema acceptance must all recognize `xai`.

3. In the adapter commit, include the explicit-model-required path and tests. Do not wait for live tests to reveal missing model behavior.

4. In redaction coverage, test thrown `ProviderError.message`, `issues[].detail`, `NEEDS_INTERVENTION.json`, doctor output, and malformed/HTML upstream bodies.

5. In the live-test commit, gate by `CODE_OZ_LIVE_PROVIDER_TESTS=xai` and require `CODE_OZ_LIVE_XAI_MODEL` when the gate is active.

6. Expand the closure commit to update `CLAUDE.md`, `ROADMAP.md`, `package.json`, `src/cli.ts`, `src/config/schema.ts`, and the version consistency test.

## What to defer
- Responses API migration, including storage policy, `input` shape, `store`, tool semantics, and response parsing.

- Streaming and cancellation contract changes.

- xAI web search, x search, code execution, MCP, or any upstream-native tool permission scope.

- OpenRouter, gateways, cloud routes, and routed-provider lineage.

- Single-sourcing provider enums. Add regression tests now; refactor later.

- Pricing, rate-limit enforcement, and `Retry-After` sleep/retry policy. Parse or surface `Retry-After` if cheap, but do not add retry behavior in PE-1.

## Final recommendation
accept-with-modifications. Decisions: `v0.13.0-alpha.0`, chat-completions buffered via Bun fetch, omit all tool/search fields, record `completion_tokens`, durable demand checkpoint, opt-in live gate with explicit live model. Implementation order: repair stale provider docs first, land xAI substrate with drift tests, land the adapter with explicit-model handling, then redaction/error tests, bootstrap registration, docs, live test, and full version/status closure. Open work: no Responses API, no streaming/cancellation contract, no upstream-native tools, no routed-provider lineage. I did not write `docs/research/CODEX_RESPONSE_PE1.md` because this session is read-only.

Sources used for platform facts: [xAI REST overview](https://docs.x.ai/developers/rest-api-reference/inference), [xAI Chat endpoint](https://docs.x.ai/developers/rest-api-reference/inference/chat), [xAI Models API](https://docs.x.ai/developers/rest-api-reference/inference/models), [xAI Chat vs Responses comparison](https://docs.x.ai/developers/model-capabilities/text/comparison), [xAI Web Search](https://docs.x.ai/developers/tools/web-search), [xAI Code Execution](https://docs.x.ai/developers/tools/code-execution).

---

## Synthesis (Claude, 2026-05-01)

**Verdict absorbed:** `accept-with-modifications`. Codex returned three concrete blockers (stale docs, xAI model lock, redaction coverage), four scope corrections (allowlist request body, no abort contract, Responses caveat, no billing-free claim), and concurred with all eight open-question leans (often tightening — e.g., adding `CODE_OZ_LIVE_XAI_MODEL` to Q8). Codex also caught two real bugs the briefing missed: the abort-signal risk pressure-tested a contract that doesn't exist, and the closure commit was underspecified about version-consistency surfaces.

Per CLAUDE.md rule 9, every Codex finding is data, not authority — I judged each one and absorbed all material findings. Two minor pushbacks below.

### Locked decisions

| Decision | Lock | Source |
|---|---|---|
| Tag naming | `v0.13.0-alpha.0` (M13 shifts to `v0.14.0-alpha.0`, etc.) | Q1 |
| Endpoint URL + shape | `POST https://api.x.ai/v1/chat/completions`; OpenAI-compatible buffered subset (`model`, `messages`, optional `max_tokens`) | Q2 |
| xAI model binding | **Required.** Adapter throws typed error when `req.model` is undefined. New `ProviderErrorCode` value: `provider_model_missing`. | Codex Blocker #2 + Q2 tightening |
| Built-in tools opt-out | **Field omission + request-body allowlist.** Test asserts serialized body has only allowlisted keys. Forbid `tools`, `tool_choice`, `parallel_tool_calls`, `search_parameters`, `background`, `store`, `stream`. | Q3 + Codex scope correction |
| Streaming vs buffered | Buffered. Yield one `content_chunk` + one `turn_completed`. | Q4 |
| `tokensUsed` provenance | `usage.completion_tokens` only when present and numeric. Do NOT record `total_tokens`. | Q5 |
| HTTPS client | `Bun.fetch` with injectable fetch-like `runner`. No new production dependency. `baseUrl` is test-only / internal-constant; not a public config field. | Q6 |
| Demand-checkpoint | Durable `docs/research/XAI_DEMAND_CHECKPOINT_<YYYY-MM-DD>.md` after PE-1 ships. No keys / account names / screenshots in the file. | Q7 |
| Live-test gating | `CODE_OZ_LIVE_PROVIDER_TESTS=xai` (comma-separated set) **AND** `CODE_OZ_LIVE_XAI_MODEL=<grok-variant>`. Both required. | Q8 + Codex Risk #5 |
| Abort/cancellation | **Not in PE-1.** No new field on `IAgentProvider` or `PreparedProviderRequest`. Risk #4 in the briefing pressure-tested a non-existent contract. | Codex scope correction + bug |
| Responses API | Not in PE-1. Document the legacy/deprecated note for chat-completions in the adapter source as a forward-compat reference. | Codex scope correction |
| Stale doc fragments | Fold into commit 1. `provider-contract.md:14`, `provider-contract.md:27`, `PROVIDERS.md:3`, `SESSION_XAI_EXPANSION_KICKOFF.md:108` all need a one-line repair to match the new state. | Codex Blockers #1 + Bugs #1-3 |
| Redaction coverage | Cover **every artifact path**: `ProviderError.message`, `issues[].detail`, `NEEDS_INTERVENTION.json`, `events.jsonl`, doctor table + JSON, malformed/HTML upstream bodies. Detail field must NOT contain raw response body, raw headers, or the API key — only status + sanitized upstream code/message + content-type + body-length, plus a short redacted excerpt only if necessary for triage. | Codex Blocker #3 + Risk #2 |
| Closure commit scope | `package.json:3`, `src/cli.ts:7`, `src/config/schema.ts:153` `DEFAULT_CONFIG.version`, `tests/m5-fix-first.test.ts:29` (`CURRENT`), `tests/cli-init.test.ts` asserted version, CLAUDE.md status, ROADMAP.md PE-1 row. | Codex Bug #6 |

### Pushbacks (minor; non-material)

1. **`SESSION_XAI_EXPANSION_KICKOFF.md:108` repair (Codex Bug #3).** Codex says the line is stale because it references `v0.12.0-alpha.0` for PE-1's tag. Re-reading: the line is already qualified ("or whatever the milestone tag is — naming TBD; see Open follow-ups below"). It's a pre-M12 lean, not a binding statement. Repair plan: add a one-line annotation pointing to PE-1's resolved tag, but don't rewrite the historical lean. Research artifacts preserve provenance.

2. **`provider-contract.md:14` "every provider call goes through the upstream CLI" (Codex Blocker #1).** Repair plan: tighten the v0.1 sync-policy paragraph to say "subscription-first via subprocess delegation **or** API-key transmission (PE-1+)," not a flat "subscription-first only." The Provenance section's M4 commit-8 reference stays.

Both are minor wording fixes; both land in commit 1 alongside the substrate. No semantic disagreement.

### Locked implementation order (7 commits)

One concern per commit. `bun run typecheck` + targeted `bun test` clean before each commit. Full suite + Codex implementation review at the end.

1. **`feat(providers): xai substrate (id, family, capability, authSource, model_missing error code) + stale-doc repair`**
   - Updates **five** enumerations: `PROVIDER_IDS` / `PROVIDER_FAMILIES` (`src/providers/types.ts`), `AGENT_PROVIDERS` (`src/agents/schema.ts`), `PROVIDERS` (`src/config/load.ts`), `defaultProvider` union (`src/config/schema.ts`).
   - Adds `'xai-api-key'` to `AUTH_SOURCES`, `xai` row to `DEFAULT_CAPABILITY_BY_ID` (eligiblePhases: ALL_PHASES, no transport field), `xai: 'xai'` to `DEFAULT_FAMILY_BY_ID`.
   - Adds new `ProviderErrorCode` value `provider_model_missing` for the adapter to throw.
   - Repairs stale doc fragments (provider-contract.md:14 + :27, PROVIDERS.md:3, SESSION_XAI_EXPANSION_KICKOFF.md:108).
   - Adds **provider-enum consistency regression test**: asserts all five enumerations + the AUTH_SOURCES + DEFAULT_CAPABILITY_BY_ID + DEFAULT_FAMILY_BY_ID + config provider-validation list all recognize `xai`. Drift between any two fails the test.

2. **`feat(providers): xAI HTTP adapter via Bun.fetch (chat-completions, buffered)`**
   - New `src/providers/xai.ts` implementing `IAgentProvider`.
   - Reads `XAI_API_KEY` at invoke time. Throws `provider_auth_missing` on absence/blank (after `trim()`).
   - Throws `provider_model_missing` if `req.model` undefined.
   - Buffered POST to `https://api.x.ai/v1/chat/completions`. Request-body allowlist: `model`, `messages`, optional `max_tokens` only.
   - Maps HTTP status → `ProviderErrorCode` per `provider-contract.md` § "API-key transmission for HTTP adapters".
   - Sanitized error `detail`: status + sanitized upstream code/message + content-type + body-length only; never raw body or headers.
   - Injectable `runner` (default `Bun.fetch`); internal `BASE_URL` constant; injectable for test seam.
   - `health()`: GET `/v1/models` cheap probe. 200 → `'ok'`; 401 → `'missing'`; 5xx → `'unknown'`; network → `'unknown'`.
   - Side-effect-free `health()` (rule 4 + 10): no events, no gates, no stderr noise.
   - Tests cover request-body allowlist (assert serialized JSON has only allowlisted keys), success path, `tokensUsed` propagation, both error codes (auth-missing + model-missing), and `health()` shape.

3. **`feat(providers): xAI redaction + sanitized error mapping coverage`**
   - Dedicated tests asserting redaction across every artifact path: `ProviderError.message`, `issues[].detail`, `NEEDS_INTERVENTION.json`, `events.jsonl`, doctor table output, doctor JSON output.
   - Covers HTTP error mapping for 401/403/429/5xx/network-fail/malformed-JSON/empty-body/HTML upstream-body.
   - Asserts `Authorization` headers never appear in any artifact.
   - Asserts request-body content (prompt + file content) never appears in error `detail` (sanitized excerpt only).
   - Eligibility-rejection test: agent declaring `provider: xai, phase: <phase>` is rejected at load time when `eligiblePhases` excludes that phase (it doesn't today, but the test guards against future restriction).

4. **`feat(cli): register XaiProvider in getProviderRegistry`**
   - `src/cli/bootstrap.ts` adds `new XaiProvider({...opts.runner ? {runner: opts.runner} : {}})` to the `providers` list.
   - Tests assert registry resolution (`registry.get('xai')`), family + capability cross-checks pass.

5. **`docs(providers): xai row in PROVIDERS.md capability table`**
   - User-facing capability-table update. Single row addition.

6. **`feat(tests): opt-in live-provider gate for xAI`**
   - `tests/providers-xai-live.test.ts` reads both `CODE_OZ_LIVE_PROVIDER_TESTS` AND `CODE_OZ_LIVE_XAI_MODEL`. Both must be set; skip with a clear message otherwise.
   - Parses `CODE_OZ_LIVE_PROVIDER_TESTS` as comma-separated set; runs only when `xai` is in the set.
   - Single round-trip: `health()` against real endpoint, then `invoke()` with a small prompt; asserts `tokensUsed > 0` on the response.

7. **`docs(status): close PE-1 + bump v0.13.0-alpha.0`**
   - Lands at tag time, after Codex implementation review verdict is `push`.
   - Updates `package.json:3`, `src/cli.ts:7`, `src/config/schema.ts:153` `DEFAULT_CONFIG.version`, `tests/m5-fix-first.test.ts:29` `CURRENT`, `tests/cli-init.test.ts` asserted version.
   - Compresses CLAUDE.md status to two sentences (per existing verbosity discipline).
   - ROADMAP.md gains a PE-1 closed row.

### Risks the synthesis carries forward

These are the briefing's 13 risks, refined per Codex's pressure-test:

1. **Redaction completeness** — covered by commit 3.
2. **Error-mapping edge cases** — covered by commit 3 (sanitized detail discipline).
3. **Doctor probe semantics for HTTP** — `health()` uses GET /v1/models; 200/401/5xx mapping is in commit 2.
4. **Streaming + abort signal** — REMOVED from PE-1. Abort contract doesn't exist.
5. **FakeProvider parity** — verified during implementation (alias mechanism in `buildProviderRegistry` already handles xai by id).
6. **Eligibility for review/debate** — xai gets `ALL_PHASES`. Cross-family REVIEW already prevents same-family violations.
7. **Bundled-defaults personas** — none declare xai; xai opts in via M12 `company:` block + env var.
8. **Manifest path-safety** — wrapper's `buildManifest` already path-checks; HTTP body is just inlined chat content. No new escape vector.
9. **Provider-enum drift** — closed by commit 1's regression test.
10. **`health()` side effects** — covered by commit 2 (no events / gates / stderr).
11. **`XAI_API_KEY` read timing** — invoke-time, not construction-time. Covered by commit 2.
12. **Persona-frontmatter `provider: xai`** — schema accepts after commit 1; loader's eligibility check uses `capabilityOf('xai').eligiblePhases`. No new loader code.
13. **`docs/contracts/COMPANY.md` example** — optional; can defer if it doesn't naturally fit.

Plus Codex's five additional risks:
14. **xAI model selection load-bearing** — covered by commit 2 (provider_model_missing).
15. **Raw upstream error bodies leak more than keys** — covered by commit 3 (sanitized detail discipline).
16. **Responses API privacy semantics** — deferred; PE-1 stays on chat-completions.
17. **`modelDefaultAvailable` awkward** — `health()` reports `true` when /v1/models 200; no per-model probe.
18. **Live test needs model env** — covered by commit 6 (require CODE_OZ_LIVE_XAI_MODEL).

### Output budget

This synthesis is ~95 lines past the response itself. Total file is ~270 lines, well under the 500-line budget.

### Stop point

Per `docs/design/SESSION_PE1_KICKOFF.md` and `TODO.md`: STOP for Ozzy approval after this synthesis. Do not start coding without explicit "go ahead" from Ozzy.
