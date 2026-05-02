# PE-1 — xAI direct HTTP adapter — planning briefing

**For:** Codex (gpt-5.5, xhigh, sandbox: read-only)
**From:** Claude (Opus 4.7, xhigh)
**Date:** 2026-05-01
**Cycle:** PE-1 (xAI direct HTTP adapter), per `docs/design/SESSION_PE1_KICKOFF.md` and `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`
**Reply request:** structured response per the shape at the bottom of this file. Save your reply to `docs/research/CODEX_RESPONSE_PE1.md`.

## Live state (verified, not trusted)

- **Branch:** `feat/pe1-xai-http-adapter`, just created from `main`. One docs commit ahead of origin/main: `7a15dc9 docs(pe1): lock API-key trust boundary before adapter lands`.
- **`main` HEAD:** `a75b23d docs(pe1): add SESSION_PE1_KICKOFF.md for the next milestone`. Also at `origin/main`.
- **Latest tag:** `v0.12.1-alpha.0` at `71fb33d` (the inter-milestone refactor session close).
- **Tests:** 1923 pass / 1 skip / 0 fail offline (re-verified at session start). `bun run typecheck` clean.
- **`.env`:** present with `XAI_API_KEY` (Ozzy provisioned). Bun auto-loads at run/test time.
- **M12 + refactor session status:** both closed. `docs/research/CODEX_REVIEW_M12.md` (push verdict, three nits closed) and `docs/research/CODEX_REVIEW_REFACTOR_2026-05-01.md` (push verdict, two nits closed).

## What this milestone is

PE-1 lands the **first outbound HTTP adapter** in `code-oz`. Until now every provider was either:

1. Subprocess-delegated to a CLI that handled its own auth (`claude login`, `codex login`), or
2. In-process (`fake`, `gemini` stub).

PE-1 reads an API key from env (`XAI_API_KEY`) and transmits it over HTTPS from `code-oz` itself. **One new authority boundary** per CLAUDE.md rule 20: outbound HTTP from `code-oz` + the API-key trust-boundary expansion. Nothing else lands in PE-1.

The shape is locked by `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md` (Codex thread `019de497`, verdict `feature-with-modifications`, Ozzy-adopted serial-with-insertion sequence: `M12 → PE-1 → M13 → M14 → M15`).

## Pre-PE-1 docs lock (already committed, not up for debate)

`7a15dc9 docs(pe1): lock API-key trust boundary before adapter lands` landed three docs additions before this briefing:

1. `docs/references/provider-contract.md` § "Auth model" rename + extend with API-key subsection: env var convention, redaction list, never-log Authorization headers rule, HTTP error mapping (401/403/429/5xx → `ProviderErrorCode`), test-injection seam pattern.
2. `docs/references/provider-contract.md` § "Anti-patterns" gains three entries: auth-header logging, API keys in request DTOs, provider-native server-side tools without an explicit `tool_use` permission scope.
3. `docs/references/provider-contract.md` § "Capability and eligibility (M11)" Forward-compat pins PE-1: new `authSource` value + `DEFAULT_CAPABILITY` row only, **no new field on `ProviderCapability`**.
4. `docs/contracts/PROVIDERS.md` § "Auth model" rename + extend to cover both subscription-first and API-key shapes; cloud-IAM deferred to v0.2+.

These are pressure-test surface for this round, but the locks themselves come from `SESSION_XAI_EXPANSION_KICKOFF.md`. If you spot a drift between the committed prose and the kickoff lock, flag it.

## Locked scope (not up for debate)

Per `SESSION_XAI_EXPANSION_KICKOFF.md` § "PE-1: xAI direct HTTP adapter (committed)":

- New `src/providers/xai.ts` adapter. HTTP-based, reads `XAI_API_KEY`, makes outbound HTTPS to xAI's chat-completions endpoint, maps responses to existing `ProviderEvent` stream.
- `src/providers/capabilities.ts` adds `'xai-api-key'` to `AUTH_SOURCES` enum + `xai` entry to `DEFAULT_CAPABILITY_BY_ID`.
- `src/providers/types.ts` adds `'xai'` to `PROVIDER_IDS` + `PROVIDER_FAMILIES`.
- `src/providers/families.ts` adds `xai: 'xai'` to `DEFAULT_FAMILY_BY_ID`.
- `src/agents/schema.ts` adds `'xai'` to `AGENT_PROVIDERS`.
- `src/config/load.ts` adds `'xai'` to its private `PROVIDERS` list.
- `src/config/schema.ts` adds `'xai'` to `defaultProvider`'s union type.
- `src/cli/bootstrap.ts` registers `XaiProvider` alongside Claude/Codex/Gemini/Fake.
- `docs/contracts/PROVIDERS.md` capability table gains the `xai` row.
- Tests: full coverage for adapter, redaction, error mapping, built-in-tools-disabled-by-default, eligibility rejection.
- Built-in xAI server-side tools (web search, x search, code execution) explicitly disabled by default. The "disable" form is **field omission** — the request body never sets `tools`.

## Locked anti-scope-creep

- **No** HTTP-substrate library separate from the adapter.
- **No** `transport` field on `ProviderCapability` (M11 strict-minimal stays).
- **No** OpenRouter (PE-2 — demand-gated).
- **No** gateway abstraction (PE-3 — demand-gated).
- **No** cloud routes (Azure / Bedrock / Vertex — v0.2+).
- **No** new permission scope for upstream provider-native tools.
- **No** lineage-resolution machinery (PE-1 is direct, not routed).
- **No** M13 / M14 / M15 / M16+ scope.

If anything else surfaces during this round, push it to the deferred bucket. Do not bundle.

## Open questions — leans + reasoning + counter

Each question gets a Claude-proposed lean. Pressure-test each one. Pick the lean, modify it, or replace it; explain the reasoning.

### Q1. Tag naming

**Lean:** `v0.13.0-alpha.0`. PE-1 takes the next M-numbered slot; M13 (Role-cost) shifts to `v0.14.0-alpha.0`, etc.

**Reasoning:** PE-1 is a categorical authority-boundary milestone (first HTTP adapter, first API-key transmission). Tagging it as a patch under v0.12.x conflates the HTTP-trust-boundary expansion (semver-significant) with the inter-milestone refactor (which earned `v0.12.1`). The `SESSION_XAI_EXPANSION_KICKOFF.md` already breaks the tag↔M-numbering 1:1 mapping by introducing PE-N insertion points; honor each tag as the next chronological alpha bump regardless of M/PE provenance.

**Counter:** keep M-numbering aligned with M-tags so retrospective archaeology stays simple — `v0.13.0-alpha.0` would always mean M13. PE-1 takes `v0.12.2-alpha.0` instead.

### Q2. xAI endpoint URL + request shape

**Lean:** `POST https://api.x.ai/v1/chat/completions`. OpenAI-compatible chat-completions wire format. v0.1 subset = no streaming, no function calling, no logprobs. Just `model`, `messages: [{role, content}]`. Response parses `choices[0].message.content` + `usage.completion_tokens`.

**Reasoning:** verified via `docs.x.ai` (Context7-fetched on 2026-05-01): the chat-completions endpoint is OpenAI-compatible with `usage: {prompt_tokens, completion_tokens, total_tokens}` in the response. There's also a newer `/v1/responses` endpoint (OpenAI-Responses-API style with `input` instead of `messages`), but the chat-completions form is simpler, well-documented, and closer to existing adapter shapes. Function calling, streaming, and logprobs are not in PE-1 scope.

**Counter:** prefer `/v1/responses` because it's the newer / preferred xAI surface and matches the direction Anthropic/OpenAI are heading. Counter-counter: PE-1 is "smallest possible HTTP adapter," and `/v1/chat/completions` ships with strictly less surface area to maintain.

### Q3. xAI built-in tools opt-out shape

**Lean:** **omit the `tools` field entirely** in the request body. Built-in tools (`web_search`, `x_search`, `code_interpreter`) are opt-in at xAI's end — they do not trigger unless the `tools` array is present.

**Reasoning:** verified via `docs.x.ai/developers/tools/overview`: every built-in-tool example explicitly passes `tools: [{type: "web_search"}, ...]`. No example shows a default-on tool. The pre-PE-1 anti-pattern entry already spells this out. Omission is safer than `tools: []` because a stray `tools.push(...)` slip can arm them if the array exists.

**Counter:** pin a regression test that asserts the built-in tools stay off by sending `tools: []` explicitly. Counter-counter: a unit test on the adapter's serialized request body covers this without sending a non-empty-but-empty array. The omission form is provably the safer of the two.

### Q4. Streaming vs buffered response

**Lean:** **buffered.** Pass `stream: false` in the request body (or omit; default is buffered for chat-completions). Adapter yields a single `content_chunk` followed by `turn_completed`, mirroring `ClaudeProvider` and `CodexProvider`.

**Reasoning:** subprocess adapters all buffer. The wrapper's tool-call cap is documented as a no-op for non-streaming adapters today (`docs/contracts/PROVIDERS.md` § "v0.1 limitations"). Adding streaming for one adapter breaks parity and surfaces a UX surface (live progress display) that has no consumer in v0.1. The kickoff names this an open question because Bun.fetch supports streams natively, but cheap ≠ in-scope.

**Counter:** if Bun.fetch streaming is genuinely cheap (no extra event-counting logic, no abort-signal complexity), ship streaming now to land the v0.1 streaming pattern with a real adapter rather than waiting for the second HTTP adapter to retrofit. Counter-counter: PE-1 is the first HTTP adapter — every additional concept ripples through Codex review, integration tests, and wrapper assumptions. Buffered first; streaming can land in PE-2 or in a later HTTP-streaming-tighten milestone.

### Q5. `tokensUsed` provenance

**Lean:** populate `turn_completed.response.tokensUsed` from `response.usage.completion_tokens` (output tokens only). Mirror `ClaudeProvider`'s `tokensUsed = parsed?.usage?.output_tokens`.

**Reasoning:** xAI returns OpenAI-shape `usage: {prompt_tokens, completion_tokens, total_tokens}`. The provider contract says `tokensUsed` is "present only when adapter has a real value from the API." xAI gives us a real value; record it. Wrapper falls back to `tokensEstimate` when adapter omits, so omission is also defensible — but recording truth is preferred.

**Counter:** record `total_tokens` instead of `completion_tokens`, since budget accounting cares about end-to-end spend. Counter-counter: existing wrapper accounting separates input (`tokensEstimate` from prompt+manifest) from output (`tokensUsed` from response). Recording `total_tokens` would double-count input. Stay aligned with the existing pattern.

### Q6. HTTPS client choice

**Lean:** `Bun.fetch` (the runtime built-in). No new production dependency. Default for `XaiProvider`.

**Reasoning:** the kickoff explicitly said "Bun.fetch should handle HTTPS — no new HTTP client unless I approve." Bun.fetch supports `headers`, JSON `body`, `AbortSignal`, and streaming via the standard `Response` API. The TODO.md note "production dependency additions (none expected — `Bun.fetch` should handle HTTPS)" is an instruction.

**Counter:** `node:https` for finer control over connection pooling, TLS settings, and predictable request-cancel semantics. Rejected: premature optimization, breaks the no-deps discipline, and Bun.fetch is the obvious default for a Bun project.

**Pressure-test ask:** does Bun.fetch handle abort-signal cleanly when the adapter's outer abort propagates? `bun --version` is 1.3.9. If there's a known Bun.fetch wart (e.g., a streaming bug in 1.3.9 that affects buffered POST + abort), flag it.

### Q7. Demand-checkpoint mechanism

**Lean:** durable doc at `docs/research/XAI_DEMAND_CHECKPOINT_<date>.md` after PE-1 ships. Conversational ask captured in writing (six bullets per `SESSION_XAI_EXPANSION_KICKOFF.md` § "Demand checkpoint": API key direct / OpenRouter / Gateway / Azure / Bedrock / Vertex). Result determines whether PE-2 commits.

**Reasoning:** durable record honors the same evidence-trail discipline as Codex transcripts. The doc is small (a few paragraphs); the cost of writing it down is low and the cost of *not* writing it down is "we asked once, can't remember the answer, and PE-2 starts from scratch."

**Counter:** plain conversational ask without a durable file. Lighter ceremony.

### Q8. Live-test gating

**Lean:** env flag `CODE_OZ_LIVE_PROVIDER_TESTS` with comma-separated provider IDs (`xai`, `xai,openrouter`, etc.). Test files check `process.env.CODE_OZ_LIVE_PROVIDER_TESTS?.split(',').includes('xai')` and skip when absent.

**Reasoning:** comma-separated list composes for PE-2+ adapters without renaming the gate. Single env var keeps the surface minimal. The existing offline-test discipline (rule 8) keeps `bun test` deterministic.

**Counter:** per-test-file flag (`CODE_OZ_LIVE_XAI_TESTS=1`). Rejected because it doesn't compose; PE-2 would need a parallel `CODE_OZ_LIVE_OPENROUTER_TESTS` etc.

## Proposed implementation order (~6-7 commits)

One concern per commit. `bun run typecheck` + targeted `bun test` clean before each commit. The order is intentional: substrate before adapter, adapter before bootstrap, redaction proof before live test, docs surface last.

1. **`feat(providers): add xai substrate (id, family, capability, authSource)`** — pure substrate, no adapter. Updates `PROVIDER_IDS`, `PROVIDER_FAMILIES`, `AGENT_PROVIDERS`, `PROVIDERS` (config/load.ts), `defaultProvider` union, `AUTH_SOURCES`, `DEFAULT_CAPABILITY_BY_ID`, `DEFAULT_FAMILY_BY_ID`. Tests cover the substrate (capabilityOf, familyOf, registry constructor cross-checks).
2. **`feat(providers): xAI HTTP adapter via Bun.fetch (chat-completions, buffered)`** — `src/providers/xai.ts` + `tests/providers-xai.test.ts`. Reads `XAI_API_KEY` at invoke time; throws `provider_auth_missing` on absence/blank. Buffered POST to `https://api.x.ai/v1/chat/completions`. OpenAI-shape request body (no `tools` field). `health()` cheap probe (TBD shape — see "Risks Codex must pressure-test" below). Maps HTTP status → `ProviderErrorCode` per the contract docs. Injectable `runner` (default `Bun.fetch`); injectable `baseUrl` for tests.
3. **`feat(providers): xAI redaction + error mapping coverage`** — dedicated test file `tests/providers-xai-redaction.test.ts`. Asserts API key never appears in `ProviderError.detail`, `event.detail`, gate file content, or any artifact path that touches the adapter. Covers 401/403/429/5xx/network-fail/malformed-JSON/empty-body. Eligibility-rejection test (xai+ineligible-phase combo).
4. **`feat(cli): register XaiProvider in getProviderRegistry`** — `src/cli/bootstrap.ts` adds the adapter to the registry list. Tests assert resolution via `registry.get('xai')` and the registry constructor's family + capability cross-checks.
5. **`docs(providers): add xai row to PROVIDERS.md capability table`** — user-facing capability-table update; small.
6. **`feat(tests): opt-in live-provider gate for xAI`** — `tests/providers-xai-live.test.ts` reads `CODE_OZ_LIVE_PROVIDER_TESTS` and runs a single round-trip against the real endpoint when `xai` is in the list. Skip otherwise. Documents the gate at the top of the file.
7. **`docs(status): close PE-1 in CLAUDE.md status + ROADMAP.md`** — final status compression (one short sentence per the verbosity discipline). Lands at tag time, after Codex implementation review verdict is `push`.

Total: 7 commits. C1+C2 could fold (substrate+adapter together), bringing it to 6, but separation gives Codex review a cleaner per-commit surface. C7 is a closure commit, not implementation.

## Risks Codex must pressure-test

The kickoff names these as "risks Claude missed" in advance — please pressure-test each one rather than accepting Claude's framing.

1. **Redaction completeness.** I plan to cover redaction at the adapter layer (errors never carry the key in `detail`) and add a dedicated test. Audit whether any *existing* path could leak the key when an HTTP adapter is registered: `events.jsonl` events that record `agent_invoked.detail` or any HTTP-request manifest, the wrapper's `recordIntervention` which copies `issue.detail` into `NEEDS_INTERVENTION.json`, doctor command output (table + `--json`), `ProviderError.message` (which the constructor builds from `code+rule+detail`). I lean: as long as the adapter never puts the key into any `detail` or stream, the existing paths are safe. Pressure-test that lean.

2. **Error-mapping edge cases.** What about: 200 with empty body? 200 with malformed JSON? 502 from a CDN edge node (Cloudflare-shaped error HTML, not JSON)? 429 with a `Retry-After` header (do we parse it?)? Pre-flight DNS failure (`fetch failed: getaddrinfo ENOTFOUND api.x.ai`)? Connection reset mid-body? Each maps to *some* `ProviderErrorCode`; the question is which.

3. **Doctor probe semantics for HTTP.** xAI exposes `GET /v1/models` for a cheap auth check. PE-1's `health()` should hit it: 200 → `'ok'`, 401 → `'missing'`, 5xx → `'unknown'`, network → `'unknown'`. **No xAI billing on a GET /v1/models? confirm.** Alternative: skip the probe entirely (`health()` returns `'unknown'` always), but that breaks the doctor's exit policy when an agent declares xai. Pick a position.

4. **Streaming + abort signal handling.** Even though PE-1 is buffered, the wrapper's per-call timeout (when M16+ adds it) and the user's Ctrl+C must propagate cleanly. Bun.fetch in 1.3.9 supports `AbortSignal`; the adapter should accept an optional signal in its request options. Verify Bun.fetch's abort behavior on a buffered POST that has already started writing the request body.

5. **FakeProvider parity for HTTP.** The shared FakeProvider via `aliasFakeProvider('xai', fake)` needs to round-trip cleanly through the wrapper, including the `agent_invoked.provider='xai'` event. Pre-existing tests cover claude/codex/gemini/fake aliases; the xai alias should work without additional code, but verify.

6. **Eligibility for review/debate phases.** I lean: xai is eligible for `ALL_PHASES` (mirroring claude/codex/fake). Cross-family REVIEW already prevents claude-BUILD + xai-REVIEW from being same-family violations. But: should xai be restricted from REVIEW until cross-family parity with Claude/Codex is empirically validated? My answer: no — but pressure-test.

7. **Bundled-defaults personas.** None declare `provider: xai`. The xai provider becomes available via `company:` block override (per M12) only when the user explicitly sets `company.<role>.provider: xai` and provides `XAI_API_KEY`. PE-1 does not change any bundled persona. Confirm this is right and that the M12 invariants still hold (post-override debate-family re-check, capability eligibility check) without any new code in `src/agents/loader.ts`.

8. **Manifest path-safety.** The HTTP adapter sends file content as inlined chat messages (probably the `prompt` + concatenated file content, mirroring `_renderStdin` in claude.ts). The wrapper already path-checks every file before content load. Confirm there's no new escape vector when the manifest reaches an HTTP body vs a CLI stdin.

9. **`AGENT_PROVIDERS` vs `PROVIDER_IDS` drift.** The repo has *five* enumerations of the v0.1 provider list (`PROVIDER_IDS`, `PROVIDER_FAMILIES`, `AGENT_PROVIDERS`, `PROVIDERS` in config/load.ts, and the `defaultProvider` union in config/schema.ts). PE-1 must update all five in C1. Drift between them is a latent bug (already noted as F8 in `REFACTOR_AUDIT_2026-05-01.md` — version-string drift is the same pattern). Pressure-test whether C1 needs an additional regression test that asserts these five lists agree.

10. **Health probe side effects.** Per rule 4 in the validation summary of `provider-contract.md`, `health()` must NOT write `events.jsonl` or any gate file. xAI's `health()` doing an HTTP GET is fine, but what about logging? Some HTTP libraries log every request to stderr by default. Bun.fetch does not, but: confirm xai's `health()` produces no side effects on stderr, stdout, or any file the doctor command might tee.

11. **`XAI_API_KEY` read timing.** `ClaudeProvider` reads CLI args at construction (cliPath) and runs at invoke. `XaiProvider` should read `XAI_API_KEY` at invoke time, not construction, so a test runner that constructs an adapter without the env set still passes (the wrapper layer surfaces the missing-key error, not the import path). Confirm.

12. **Persona-frontmatter `provider: xai`.** The schema validation (`AGENT_PROVIDERS`) accepts xai after C1; the loader's eligibility check uses `capabilityOf('xai').eligiblePhases.includes(phase)`. C1's substrate is enough; no additional loader code needed.

13. **Bundled-defaults `company:` example in `docs/contracts/COMPANY.md`.** The worked example uses Claude/Codex; PE-1 might benefit from a single example showing `lead.provider: xai`. Optional.

## What to defer (parking lot)

- xAI `tool_use.upstream_native_tools` permission scope — defer until measurable demand.
- xAI streaming via `content_chunk` events — defer to next-HTTP-adapter milestone or a dedicated HTTP-streaming-tighten milestone.
- `/v1/responses` endpoint shape — defer until xAI deprecates `/v1/chat/completions` or a downstream feature requires it.
- OpenRouter / Gateway / cloud routes (PE-2, PE-3, v0.2+) — demand-gated.
- Single-source the five provider-list enumerations — F8-shape refactor; never bundle into PE-1.
- `model` frontmatter format validation (Codex M12 review nit) — already deferred; not PE-1 scope.

## Questions Codex must answer (structured reply)

Please return a structured reply at `docs/research/CODEX_RESPONSE_PE1.md` with this shape (verbatim section headers):

```markdown
# Codex planning review — PE-1

## Verdict
accept | accept-with-modifications | reject | debate-required

## Blockers before code

(Findings that must be resolved before any commit lands. Empty if none.)

## Scope corrections

(Corrections to Claude's locked scope or anti-scope-creep list. Empty if none.)

## Open-question resolutions

(Per Q1-Q8: pick a lean, name reasoning, add counter-counter if you flip Claude's lean.)

### Q1. Tag naming
- Resolution:
- Reasoning:

### Q2. Endpoint URL + request shape
- Resolution:
- Reasoning:

### Q3. Built-in tools opt-out
- Resolution:
- Reasoning:

### Q4. Streaming vs buffered
- Resolution:
- Reasoning:

### Q5. tokensUsed provenance
- Resolution:
- Reasoning:

### Q6. HTTPS client
- Resolution:
- Reasoning:

### Q7. Demand-checkpoint mechanism
- Resolution:
- Reasoning:

### Q8. Live-test gating
- Resolution:
- Reasoning:

## Risks the proposing side missed

(New risks beyond the 13 Claude listed. Empty if none.)

## Bugs or stale assumptions Claude missed

(Specific code/doc claims that are wrong. Cite file:line.)

## Implementation order changes

(Reorder, merge, split, or add commits. Empty if order stands as-is.)

## What to defer

(Items Codex thinks should be parked, with reasoning. Empty if Claude's parking lot is right.)

## Final recommendation

(One paragraph. Prefer this synthesis: "[verdict]. Decisions [list]. Implementation order [list]. Open work [list].")
```

## Cycle pointers

- Full cycle: `docs/design/SESSION_CYCLE.md`. PE-1 follows the **full discipline** (authority-boundary milestone). Lite-cycle does NOT apply.
- Pre-PE-1 contract additions: just landed in `7a15dc9 docs(pe1): lock API-key trust boundary before adapter lands` on `feat/pe1-xai-http-adapter`.
- Implementation review (rule 8): a separate Codex round runs after the implementation commits land, before tag.
- Tag/push approval: only after Ozzy explicitly approves. Codex's verdict is data, not authority (CLAUDE.md rule 9).

## Output budget

≤400 lines for this briefing (this file is ~340 lines including frontmatter — under budget). Codex response budget: as long as needed, but stay under ≤500 lines per past rounds.

Thank you.
