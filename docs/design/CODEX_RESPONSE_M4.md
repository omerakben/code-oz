# code-oz — M4 Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddb46-d9c0-7582-ad71-6d433533b8ae`
- **Briefing:** [`CODEX_BRIEFING_M4.md`](./CODEX_BRIEFING_M4.md)

Verbatim reply below.

---

## Where I agree (sanity-checked)

1. Streaming `IAgentProvider.invoke()` is the right contract. Add a test helper like `collectProviderResponse(stream)` so tests stay batch-simple while adapters remain stream-native.

2. Read OAuth files on every call. The cost is trivial for M4, and it avoids stale auth. Tests need injected auth paths, not real `~/`.

3. Wrapper-owned manifest, permissions, metrics, and cost checks are correct. `src/state/events.ts` already has the `agent_invoked.manifest` slot, and `docs/references/agent-skill-format.md` makes permissions an upper-bound check, not a generator.

4. Provider errors should be typed and centrally converted into `NEEDS_INTERVENTION.json`. The wrapper should also append the existing `intervention` event after writing the gate, using the same short lock discipline as `src/state/run.ts`.

5. `FakeProvider` should be scripted with deterministic fallback. Add `strict: true` for tests that must fail on unexpected calls.

6. Pre-call cost budgets are correct. Use `agent_invoked.tokensEstimate` for estimated in-flight cost and `agent_completed.tokensUsed` only when the adapter has a real usage value.

7. Gemini should stay a stub. `health()` should return an explicit unsupported state, not pretend auth is merely unknown.

8. Top-level context metric fields are fine: `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`. `0` means no narrowing or nothing removed. Do not use `null`.

9. Open event validation in M4. `src/state/events.ts` currently rejects unknown event types, so M4 must widen the reader type to known plus unknown v1 events, while known event types keep strict validation.

10. Use one public wrapper entrypoint: `invokeAgent(ctx, req)`. Keep helper modules testable, but avoid higher-order wrapper chains.

## Where I disagree (with specific alternative)

1. Do not put file content in the public `ProviderRequest`. That lets phase code load bytes before the permission check. Split public request from prepared adapter request.

```ts
export interface ProviderRequest {
  readonly agent: AgentDefinition
  readonly phase: Phase
  readonly runId: string
  readonly prompt: string
  readonly files: readonly ProviderFileRef[]
  readonly model?: string
  readonly maxOutputTokens?: number
}

export interface ProviderFileRef {
  readonly path: string
  readonly droppedFields?: readonly string[]
}

export interface PreparedProviderRequest extends Omit<ProviderRequest, 'files'> {
  readonly files: readonly ProviderFile[]
  readonly manifest: AgentManifest
  readonly metrics: ProviderContextMetrics
}

export interface IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent>
  health(): Promise<ProviderHealth>
}
```

2. Contradiction: the briefing's wrapper step 3 compares `toolCallCapHint` to config, but `SESSION_M4_KICKOFF.md` addendum says PLAN estimates are advisory and ignored by runtime enforcement. Addendum wins. Remove `toolCallCapHint` from M4 enforcement. Enforce exact tool calls while streaming.

```ts
let toolCalls = 0
const hardCap = Math.floor(
  config.budgets.global.maxToolCallsPerTurn *
    (config.budgets.global.toolCallBudgetMultiplier ?? 1),
)

for await (const ev of adapter.invoke(prepared)) {
  if (ev.type === 'tool_call' && ++toolCalls > hardCap) {
    throw new ProviderError([{
      code: 'provider_tool_call_cap_exceeded',
      rule: 'provider emitted more tool calls than config allows',
      actionableSuggestions: ['raise budgets.global.maxToolCallsPerTurn in .code-oz/config.yaml'],
    }])
  }
  yield ev
}
```

3. Do not make `requestReview()` infer the build provider from the event log. Pass it from REVIEW orchestration. Event logs can contain multiple build invocations and recovery events.

```ts
export interface ReviewRequest {
  readonly buildProvider: ProviderId
  readonly reviewer: AgentDefinition
  readonly files: readonly ProviderFileRef[]
  readonly question: string
}

if (registry.familyOf(req.buildProvider) === registry.familyOf(req.reviewer.provider)) {
  throw providerError('provider_permissions_violation', 'REVIEW provider must differ from BUILD provider family')
}
```

4. Add `ProviderFamily` now, even if it equals `ProviderId` in v0.1. Future `claude-cli` and `anthropic-api` adapters should still be same-family for REVIEW.

```ts
export type ProviderFamily = 'claude' | 'codex' | 'gemini' | 'fake'
```

5. Do not pin private auth JSON formats as a durable spec unless official docs confirm them. Implement injected auth readers, classify unreadable or unknown shapes as `provider_auth_missing` or `provider_auth_expired`, and keep `docs/references/provider-contract.md` focused on code-oz behavior.

## What's missing

1. `src/config/schema.ts` has defaults but no visible config loader. M4 needs `loadConfig()` before budget enforcement can be real.

2. Lock boundaries: do not hold the per-run lock across a network call. Use short locked windows for `readEvents -> budget check -> append agent_invoked`, then another for `agent_completed` or `NEEDS_INTERVENTION + intervention`.

3. Token estimation: use a shared conservative estimator in `src/providers/cost.ts`, with optional provider override later. No tokenizer dependency in M4.

4. `agent_completed.tokensUsed`: only write actual provider-reported usage or FakeProvider scripted usage. Do not post-count streamed text and call it actual usage.

5. Provider preview: M4 should expose a pure `previewProviderRequest(req)` from the same manifest builder. CLI surfacing can defer to `status --verbose`; `doctor providers` should stay auth/health only.

6. Doctor side effects: `health()` must not write `events.jsonl` or `NEEDS_INTERVENTION.json`; doctor runs outside a run. Invocation failures inside a run write gates.

7. Doctor exit policy: exit non-zero for unhealthy supported providers required by loaded agents; do not fail solely because Gemini is intentionally unsupported.

8. Path safety: manifest builder must normalize repo-relative paths, reject absolute or `..` escapes, and realpath-check symlinks like `src/state/gates.ts`.

9. Test auth fixtures: use temp dirs and injected `homeDir` or explicit `authPath`. No tests should read or write real `~/.claude` or `~/.codex`.

10. Provider registry belongs beside `bootstrap()`: add `getProviderRegistry()` in `src/cli/bootstrap.ts` so compiled binary imports keep adapters alive.

## Concrete M4 implementation order

1. `docs(spec): pin provider and event metric contracts`
   Update `docs/references/file-based-gates.md` for required `agent_invoked` metrics and open v1 event types. Add `docs/references/provider-contract.md`.

2. `feat(state): widen event schema for M4 provider telemetry`
   Add metric fields to `agent_invoked`, widen known/unknown event types, update `src/state/events.ts` tests.

3. `feat(config): add provider budget config loading`
   Add `maxToolCallsPerTurn`, optional `toolCallBudgetMultiplier`, and `loadConfig()` from `.code-oz/config.yaml`.

4. `feat(providers): add core types, errors, registry`
   `types.ts`, `errors.ts`, `registry.ts`, provider family metadata, bootstrap keepalive.

5. `feat(providers): add deterministic FakeProvider`
   Scripted expectations, fallback response, strict mode, failure injection, stream collection helper.

6. `feat(providers): add manifest and permissions builder`
   Paths-only request DTO, permission intersection, sha256, size, metrics, preview output, path-safety tests.

7. `feat(providers): add invoke wrapper`
   Budget pre-check, short-lock event appends, tool-call stream cap, `NEEDS_INTERVENTION.json`, `intervention` event, completion event.

8. `feat(providers): add Claude, Codex, and Gemini adapters`
   Auth readers with injected paths, mocked auth tests, Gemini unsupported stub, no network in default tests.

9. `feat(tools): add requestReview primitive`
   Cross-family check via registry family metadata, no `consult()`, tests for claude+claude reject and claude+codex pass.

10. `feat(commands): implement doctor providers`
    Aggregate health, structured JSON-capable output, stable exit semantics, help text, `docs/contracts/PROVIDERS.md`, binary smoke.

proceed-with-modifications

---

## Claude synthesis (post-debate)

Per CLAUDE.md rule 9 (Codex's verdict is data, not authority): each Codex finding judged below. Net result: Codex's pushback flips one of my thirteen leans (prompt 11 — and notes a contradiction with the addendum that I had baked into the briefing), refines four more, confirms eight with valuable add-ons. Five "what's missing" items surface real gaps (config loader, short locks, token-estimation discipline, preview surface, doctor exit policy) that didn't appear in the briefing.

### Briefing contradiction Codex caught (and the fix)

My briefing's prompt 11 + the wrapper sketch in `invoke.ts` both had `assertToolCallCap(ctx.config, req.toolCallCapHint)` — a pre-call comparison between PLAN's advisory `estimatedToolCalls` hint and the config cap. The cross-cutting addendum (`docs/design/CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md` item c) explicitly says PLAN estimates are advisory only and the runtime ignores them for budget enforcement. Codex correctly flagged the contradiction; the addendum wins.

**Fix locked:** the cap is a streaming `tool_call` event counter inside the wrapper's `for await` loop. The advisory PLAN hint (when M6+ supplies it) is recorded on `agent_invoked` for observability and never enters the enforcement decision. The actual cap is `Math.floor(maxToolCallsPerTurn * (toolCallBudgetMultiplier ?? 1))`. Adopted from Codex's code shape verbatim.

The briefing will be left as written (it's the historical artifact); this synthesis is the corrected contract M4 implements.

### Thirteen leans, judged

| #   | Decision                                          | Verdict                                                                                                                                                                                                                                                                                                                          | Reason                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Streaming `invoke()`                              | Hold (with helper)                                                                                                                                                                                                                                                                                                               | Codex confirms streaming + adds a `collectProviderResponse(stream)` test helper so batch-style assertions stay simple. Adopt the helper.                                                                                                                                                                                                                                                                                            |
| 2   | OAuth read every call                             | Hold                                                                                                                                                                                                                                                                                                                             | Confirmed. Tests must inject auth paths (no real `~/.claude` or `~/.codex` reads in the test suite).                                                                                                                                                                                                                                                                                                                                |
| 3   | Manifest pre-compute by wrapper                   | **Refine (split DTOs)**                                                                                                                                                                                                                                                                                                          | My `ProviderRequest.files[].content` slot let phase code load bytes before the permission check. Codex's split is the real fix: **public `ProviderRequest` carries paths only (`ProviderFileRef`); the wrapper produces a private `PreparedProviderRequest` with content, manifest, and metrics; adapters only see prepared.** Closes the privacy boundary properly. Adopt verbatim.                                               |
| 4   | Permissions in wrapper                            | Hold                                                                                                                                                                                                                                                                                                                             | Single chokepoint stays. With the split DTOs above, the wrapper is the only thing that loads file content; permissions are checked before any byte enters the prepared request.                                                                                                                                                                                                                                                    |
| 5   | NEEDS_INTERVENTION typed error + wrapper writes   | **Refine**                                                                                                                                                                                                                                                                                                                       | Codex adds the audit-trail piece: after `writeNeedsInterventionGate`, append the existing `intervention` event (M3 already validates it) under short-lock discipline mirroring `run.ts`. The provider error → gate file → intervention event sequence becomes the canonical pattern.                                                                                                                                               |
| 6   | FakeProvider scripted + fall-through              | Hold (add `strict`)                                                                                                                                                                                                                                                                                                              | Adopt `strict: true` mode for tests that must fail on unexpected calls. Default stays fall-through-to-default for ergonomic spine-test authoring.                                                                                                                                                                                                                                                                                   |
| 7   | Cross-family in `tools/review-request.ts`         | **Refine (don't infer)**                                                                                                                                                                                                                                                                                                         | My lean assumed `requestReview` would read the build provider from `events.jsonl`. Codex's pushback is right: event logs can have multiple `agent_invoked` entries (recovery, retries, multiple build agents in M5+). **Pass `buildProvider` explicitly from REVIEW orchestration into the `ReviewRequest` DTO.** Decoupled and unambiguous. Combined with finding 4 below, the family comparison goes through `registry.familyOf`. |
| 8   | Pre-call cost-budget                              | Hold                                                                                                                                                                                                                                                                                                                             | Confirmed. Codex's clarification: estimated cost uses `agent_invoked.tokensEstimate`; actual usage on `agent_completed.tokensUsed` only when the adapter (or scripted FakeProvider) reports a real value. Don't post-count streamed text and pretend it's real.                                                                                                                                                                    |
| 9   | Gemini stub throws                                | **Refine (explicit unsupported)**                                                                                                                                                                                                                                                                                                | Codex sharpens: `health()` returns an explicit `'unsupported'` (or `'stubbed'`) state, not `'unknown'`. Doctor exit policy then treats Gemini's unsupported state as success-by-design (see "what's missing" item 7), not a failed health check.                                                                                                                                                                                    |
| 10  | Sibling fields on `agent_invoked` (4 new metrics) | Hold                                                                                                                                                                                                                                                                                                                             | Confirmed. `0` always means "no narrowing happened or nothing was removed"; never `null`.                                                                                                                                                                                                                                                                                                                                           |
| 11  | Tool-call cap config keys + location              | **Flip (streaming counter, drop advisory comparison)**                                                                                                                                                                                                                                                                           | Briefing contradicted the addendum. Cap is a streaming `tool_call` event counter, hard ceiling = `Math.floor(maxToolCallsPerTurn * (toolCallBudgetMultiplier ?? 1))`. Advisory PLAN hint is never compared. Removed `assertToolCallCap(ctx.config, req.toolCallCapHint)` from the wrapper sketch.                                                                                                                                  |
| 12  | Open `EVENT_TYPES` union                          | Hold (with refinement)                                                                                                                                                                                                                                                                                                           | Codex confirms: widen the reader type to "known + unknown v1 events"; known types keep strict per-type field validation; unknown types pass shape validation (`version === 1`, non-empty string `type`) and survive in the log. M7 adds `failure_recorded` without a schema migration.                                                                                                                                              |
| 13  | Single entrypoint composition                     | Hold                                                                                                                                                                                                                                                                                                                             | Confirmed: one public `invokeAgent(ctx, req)` async generator; helper modules (`buildManifest`, `assertWithinBudget`, etc.) are individually unit-testable; no higher-order wrapper chain.                                                                                                                                                                                                                                          |

### Adopted from "where I disagree" (the four that aren't directly above)

- **`ProviderFamily` type added now.** Even though it equals `ProviderId` in v0.1, the registry exposes `familyOf(id: ProviderId): ProviderFamily`. Forward-compat: future `claude-cli` and `anthropic-api` adapters share `family: 'claude'` and so REVIEW correctly rejects them as same-family. No code rewrite when that day comes.
- **Don't pin auth JSON formats in the public spec.** `docs/references/provider-contract.md` (the new pinned reference) describes code-oz behavior — auth file location, error codes, retry semantics. Internal auth-file shapes are read opportunistically; unreadable or unknown shapes classify as `provider_auth_missing` or `provider_auth_expired`. No external spec drift if the upstream CLIs change their auth file format.
- **Inject auth paths in tests.** Adapters take an optional `authPath` (or `homeDir`) override; tests use temp directories. Default behavior reads `~/.claude/auth.json` etc. when override absent. Closes the "tests must not touch real `~/`" concern from the kickoff's offline-tests rule.
- **Family-based cross-family check via `registry.familyOf()`.** Replaces direct `provider !== other.provider` comparison. Cleaner abstraction; correctness preserved; future-proof.

### Adopted from "what's missing" (all ten items)

All ten items are real gaps. None expand M4 scope materially; most close failure modes the lean glossed over. Categorized:

**Core wiring (must land in M4):**

1. **`loadConfig()`** — `src/config/schema.ts` has defaults but no loader. M4 needs `loadConfig({ cwd })` reading `.code-oz/config.yaml`, falling back to `DEFAULT_CONFIG`, validating shape with the M2 hand-rolled pattern. Lands as commit 3 in Codex's order.
2. **Short lock boundaries.** Never hold the per-run lock across a network call. Lock-1 reads events + checks budget + appends `agent_invoked`; lock released; adapter streams unlocked; lock-2 appends `agent_completed` or (on error) writes `NEEDS_INTERVENTION.json` + appends `intervention`. Pattern mirrors M3's `appendEvent({ skipLock })` discipline already in `events.ts`.
3. **Shared conservative token estimator** in `src/providers/cost.ts`. No tokenizer dep in M4. Heuristic: ~4 chars/token English upper bound + per-provider safety multiplier. Provider-specific overrides land later if accuracy matters; M4's bound is "refuse before catastrophic spend."
4. **`agent_completed.tokensUsed` provenance.** Only writes adapter-reported (real API usage) or FakeProvider-scripted values. No post-count of streamed content. Write `agent_completed` without `tokensUsed` field when the adapter doesn't report it (the M3 schema already accepts the optional field — confirmed in `events.ts:194-209`).
5. **Manifest path safety mirroring `gates.ts`.** Normalize, reject absolute, reject `..` segments before normalization (defense-in-depth), realpath the project root and verify resolved path stays inside. The same `validateArtifactSyncPath` discipline; M4 adds `validateManifestPath` that handles the wider case (any project file, not just artifact root).

**Surfaces / contracts (locked in M4 but small additions):**

6. **`previewProviderRequest(req)`** — pure function exposing the manifest builder's output without invoking. Used by `code-oz status --verbose` later; also the building block for the rule-13 "files sent to provider preview" UX. M4 ships the pure helper; CLI surfacing defers.
7. **Doctor side effects rule.** `health()` must not write `events.jsonl` or `NEEDS_INTERVENTION.json`. Doctor runs outside any active run; the per-run lock and event log don't exist there. Invocation failures *inside* an active run write gates as designed.
8. **Doctor exit policy.** Exit zero when all *required* providers (any loaded agent's provider) are healthy; non-zero when a required provider is unhealthy. Gemini's `'unsupported'` state is success-by-design (zero exit) when no loaded agent declares Gemini; non-zero only when an agent claims Gemini and the stub refuses.
9. **Test auth fixtures.** Temp dirs + injected `homeDir` or `authPath`. No real `~/` reads. Add `tests/fixtures/auth/{claude.valid.json,claude.expired.json,codex.valid.json}` for the mocked adapter tests.
10. **`getProviderRegistry()` in `src/cli/bootstrap.ts`.** Parallel to existing `AgentRegistry` in the same module — keeps adapter imports alive in the compiled binary's tree-shaker (mirrors M2's `loadBundledDefaults()` keepalive pattern that closed M2 commit `fae4064`'s deferred-liveness loose thread).

### Locked implementation order

Codex's 10 commits are the right shape. Adopt verbatim. Branch: `feat/m4-providers`. Each commit self-contained, `bun test` + `bun run typecheck` clean before the next. M1 + M2 + M3 regression suites stay green throughout (266 tests pre-M4).

| #   | Commit                                                               | What lands                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs(spec): pin provider and event metric contracts`                | Update `docs/references/file-based-gates.md` § 5 (required `agent_invoked` metrics + open v1 event types). Add `docs/references/provider-contract.md` (IAgentProvider, request DTO split, ProviderFamily, error codes, doctor exit semantics — no auth file format). |
| 2   | `feat(state): widen event schema for M4 provider telemetry`          | Add `filesSent` / `bytesSent` / `tokensEstimate` / `fieldsRemovedByScope` required-when-`agent_invoked` to `src/state/events.ts` validator. Widen reader type to known + unknown v1 events; known types keep strict per-type validation. Test additions.            |
| 3   | `feat(config): add provider budget config loading`                   | Add `maxToolCallsPerTurn` (required, default 10) and optional `toolCallBudgetMultiplier` (default 1.5) to `Budgets.global` in `src/config/schema.ts`. Implement `loadConfig({ cwd })` reading `.code-oz/config.yaml` with hand-rolled validation.                    |
| 4   | `feat(providers): add core types, errors, registry`                  | `src/providers/{types,errors,registry}.ts`. `IAgentProvider`, `ProviderRequest` (paths-only), `PreparedProviderRequest` (content+manifest+metrics), `ProviderFamily`, `ProviderError`, `ProviderHealth`. `getProviderRegistry()` in `src/cli/bootstrap.ts`.            |
| 5   | `feat(providers): add deterministic FakeProvider`                    | `src/providers/fake.ts`. Scripted expectations API (`fake.expect({...}).respondWith({...})`, `.fail({...})`), fallback default response, `strict: true` mode, `collectProviderResponse(stream)` test helper.                                                        |
| 6   | `feat(providers): add manifest and permissions builder`              | `src/providers/manifest.ts` + `src/providers/preview.ts`. Paths-only → prepared transformation, permission intersection (rejects out-of-bounds files), sha256 + size, four metrics, `previewProviderRequest()`, path safety mirroring `gates.ts`.                   |
| 7   | `feat(providers): add invoke wrapper`                                | `src/providers/invoke.ts` + `src/providers/cost.ts`. Short-lock pre-budget check, `agent_invoked` append (lock released), adapter stream consumption with streaming `tool_call` cap, `agent_completed` or `NEEDS_INTERVENTION + intervention` (second short lock).   |
| 8   | `feat(providers): add Claude, Codex, and Gemini adapters`            | `src/providers/{claude,codex,gemini}.ts`. Injected auth path support, mocked-auth fixture tests, no network in default test suite. Gemini stub throws `provider_gemini_not_yet_supported`; `health()` returns `'unsupported'`.                                      |
| 9   | `feat(tools): add requestReview primitive`                           | `src/tools/review-request.ts`. `ReviewRequest` carries explicit `buildProvider` (no inference from log). Cross-family check via `registry.familyOf(...)`. Tests: claude+claude reject, claude+codex pass.                                                          |
| 10  | `feat(commands): implement doctor providers`                         | `src/commands/doctor.ts` becomes real. Aggregate `health()` calls, structured table output, JSON output via `--json`, exit policy (only required providers gate exit code), `docs/contracts/PROVIDERS.md`, binary smoke test. CLI help text + version bump to `0.4.0-alpha.0` land here. |

### Verdict

**`proceed-with-modifications`** — synthesis adopts Codex's three concrete pushbacks (split request DTO, streaming tool-call cap, explicit-buildProvider in ReviewRequest), all four "where I disagree" architectural additions (ProviderFamily type, no auth-format spec pinning, injected auth paths in tests, family-based cross-family check), all ten "what's missing" gaps (config loader, short locks, conservative estimator, tokensUsed provenance, path safety, preview helper, doctor side-effect rule, doctor exit policy, test auth fixtures, registry keepalive), and Codex's 10-commit implementation order verbatim. The briefing's tool-call-cap contradiction with the addendum is corrected.

Approval pending from Ozzy. Implementation begins on `feat/m4-providers` after explicit "yes" in chat.
