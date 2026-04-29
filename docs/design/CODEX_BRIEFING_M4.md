# code-oz — M4 Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M3 shipped (`v0.3.0-alpha.0`, 9 base commits + 4 review-fix commits, 266 tests passing offline, ~690ms). M4 is the next milestone: the `IAgentProvider` contract, `FakeProvider`, three real adapters (Claude / Codex / Gemini-stub), the wrapper-layer (permissions + cost + manifest + metrics), `requestReview` cross-family primitive, and `code-oz doctor providers`.

The scope is locked by `docs/design/SESSION_M4_KICKOFF.md`. You are not debating *what* to build — you are debating *how* to build it. I have leans on thirteen decisions: nine from the kickoff's design questions, three opened by the cross-cutting addendum from `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md`, and one composition-shape question the wrapper layer surfaces. Push back hard where my leans are wrong; confirm fast where they hold up. Where you confirm, sanity-check rather than rubber-stamp.

---

## What you should already have read

- `CLAUDE.md` — non-negotiable rules 1–14 plus cross-model peer review rules 7–10. Rules 2 (cross-family REVIEW), 8 (FakeProvider runs full lifecycle offline), 10 (cost budgets are config), 11 (provider failures become actionable `NEEDS_INTERVENTION.json`), and 13 (privacy by default; explicit file manifests) are the tightest constraints on M4.
- `docs/design/ROADMAP.md` § M4 — files to create + acceptance criteria.
- `docs/design/SESSION_M4_KICKOFF.md` — full M4 task description, the deep-dive table on what `pi-mono` / `Archon` / `Auto-claude-code` contribute, the nine pre-drafted prompts I am extending here, and the cross-cutting addendum at the end.
- `docs/design/CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md` — the just-completed forward-looking design round whose synthesis is the cross-cutting addendum on the M4 kickoff. Three of its decisions affect M4 directly. **Addendum wins on conflict** with anything I propose below.
- `docs/references/file-based-gates.md` — the **authoritative pinned spec** for gate-class taxonomy, JSON schemas, validation rules, the integrity binding via `artifactSha256`, the append-only `events.jsonl` contract, and (relevant to M4) the `agent_invoked.manifest` slot M3 designed and M4 populates. Note: M4 must amend section 5 to land the new required-when-`agent_invoked` metric fields before the code that produces them.
- `docs/references/agent-skill-format.md` — the M2 frontmatter spec, especially the **"Permissions semantics: upper bound, not glob expansion"** section. Load-bearing for M4: every file in the manifest sent to a provider must be allowed by the agent's `permissions.read`. The runtime check is M4's responsibility.
- `docs/adr/0001-mvp-option-e.md` — refinement #1 ("FakeProvider ships on day 1 alongside ClaudeProvider") and refinement #2 (cross-provider primitive narrowed to `requestReview`, broad `consult()` is v0.3+).
- `docs/design/CODEX_BRIEFING_M3.md` and `docs/design/CODEX_RESPONSE_M3.md` — format references for what your reply should look like.

You do not need to read the M2 source. You should glance at:

- `src/state/events.ts` — current `validateEvent`, especially the closed `EVENT_TYPES` allow-list and the existing `agent_invoked.manifest` shape. This is the validator M4 mutates.
- `src/state/run.ts` — the per-run-lock layered transaction pattern (`writeGate → appendEvent(gate_written) → appendEvent(phase_exited) → appendEvent(phase_entered/run_ended) → writeCurrentUnlocked`). M4's wrapper layer plugs into this when M5+ drives runs.
- `src/state/gates.ts` — the path-safety + atomic-write template M4 mirrors for `NEEDS_INTERVENTION.json` writes.
- `src/cli/bootstrap.ts` — the shared CLI bootstrap M4 extends (the doctor command pulls the agent registry from here; future M5+ commands consume providers from a parallel `getProviderRegistry()` helper).
- `src/config/schema.ts` — current `Budgets` shape. M4 adds `maxToolCallsPerTurn` and (per addendum) optional `toolCallBudgetMultiplier`.

---

## What's locked (not up for debate)

These come from CLAUDE.md, the kickoff, the ADR refinements, and the cross-cutting addendum. Do not reopen.

1. **`FakeProvider` ships on day 1** alongside `ClaudeProvider` and `CodexProvider`. Every spine test in M5–M7 uses `FakeProvider` by default; live-provider tests are opt-in only and gated behind env flags. Designing `IAgentProvider` without a working second implementation is the worst version of an abstraction (ADR refinement #1).
2. **Only `requestReview` is callable in v0.1.** No `consult()`. Cross-family is enforced before invocation; broad consult is v0.3+ (ADR refinement #2; rule 6).
3. **Wrapper layer is the only place permissions/cost/manifest/metrics live.** Adapters do not enforce these. Mirrors M3's `run.ts` wrapping gates+events under one lock — closes the audit-trail loop M3 designed for. The kickoff's "Don't" list explicitly forbids putting permissions inside individual adapters.
4. **Provider failures become `NEEDS_INTERVENTION.json`** with machine-readable `code`, `rule`, and `actionableSuggestions`. Never opaque SDK stack traces, never silent success. Kickoff's "Don't" list is unambiguous on this.
5. **Cross-family enforcement is mandatory at REVIEW gate.** `requestReview` rejects `reviewer.provider === buildAgent.provider` before invoking the reviewer. Test fixtures: claude+claude must fail; claude+codex must succeed (rule 2; kickoff acceptance).
6. **`GeminiProvider` is a stub.** Frontmatter rejection rule + stub adapter that throws `provider_gemini_not_yet_supported` is the v0.1 contract. The `experimental: true` flag is **not** a license to wire the real Gemini SDK in v0.1. (ADR refinement on Gemini; kickoff "Don't" list.)
7. **Cost-budget enforcement is pre-call.** Wrapper reads running totals from `events.jsonl`, estimates next-call cost, refuses if it would exceed configured budget. Refusal becomes typed `NEEDS_INTERVENTION` with `code: 'provider_budget_exceeded'`. Kickoff's "Don't" list rejects post-call accounting for v0.1.
8. **Tests must be offline.** `bun test` cannot touch network or real provider auth. M4 uses `FakeProvider` and mocked auth files for `claude.ts` / `codex.ts` tests.
9. **Bun + TypeScript. Hand-rolled validation pattern.** No `zod`. M2 + M3 chose hand-rolled typed errors with `{ file, code, rule, detail? }` issue arrays; M4 uses the same pattern for `ProviderError`.
10. **Cross-cutting addendum (`CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md`) overrides anything below it conflicts with:**
    - **(a)** Context metrics on every `agent_invoked` event: `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`. Required-when-`agent_invoked` (not optional). Validator in `src/state/events.ts` enforces presence.
    - **(b)** No `contextScope` field in agent frontmatter. Scope is enforced in code: a **provider-request DTO + phase-owned manifest builders** that intersect explicit phase logic with `permissions.read` (upper bound). Persona files describe identity, not runtime narrowing.
    - **(c)** Tool-call circuit breaker is config-only, not PLAN-encoded. Lives in `.code-oz/config.yaml` (`maxToolCallsPerTurn`, optional `toolCallBudgetMultiplier`). PLAN.md tasks (M6) carry advisory `estimatedToolCalls` only — runtime ignores it for budget enforcement.
11. **No M5+ scope creep.** No DEFINE phase logic, no PLAN parser, no worktrees, no patch contract, no bounded retry loop. M4 ships the primitives those phases will eventually consume.

---

## M4 acceptance summary (from kickoff)

- `FakeProvider` runs the whole lifecycle offline, deterministically.
- Real adapters fail with actionable `NEEDS_INTERVENTION.json` if auth missing or budget exceeded — never an opaque SDK stack trace. `code` is machine-readable: `provider_auth_missing`, `provider_rate_limit`, `provider_budget_exceeded`, `provider_malformed_response`, `provider_permissions_violation`, `provider_gemini_not_yet_supported`, etc.
- `consult()` deliberately not added. Only `requestReview()` is callable, only from REVIEW gate orchestration. Cross-family rejection at the entry point.
- `code-oz doctor providers` returns structured per-provider health (`{ provider, authStatus, modelDefaultAvailable, latencyMs?, lastError? }`). Failed health checks aggregate, never crash the command.
- M3's `agent_invoked.manifest` slot is populated with real `{ path, sha256, sizeBytes }` entries by M4's wrapper layer.
- `agent_invoked` events also carry the four addendum-required metrics (`filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`). Validator enforces presence.
- Permissions check happens in the wrapper: every file in the manifest must match `agent.permissions.read`. Outside the upper bound surfaces typed `provider_permissions_violation`.
- Cost-budget pre-call refusal: `NEEDS_INTERVENTION` with `code: 'provider_budget_exceeded'` and `actionableSuggestions` naming the budget that would be exceeded.
- Tool-call cap (`maxToolCallsPerTurn` from `.code-oz/config.yaml`) enforced at provider-call site. PLAN-level advisory estimates ignored by runtime.
- `bun test` passes offline. `bun run typecheck` clean. M1 + M2 + M3 regression suites stay green (266 tests pre-M4 → ~340 post-M4 estimate).
- The compiled binary `dist/code-oz` continues to embed bundled persona defaults; `code-oz doctor` becomes a real path that exercises the provider registry (so Bun's tree-shaker doesn't drop M4's adapter imports either).

---

## My proposed design (the thing to debate)

### Module shape

```text
src/providers/
  types.ts             # IAgentProvider interface, ProviderId, ProviderHealth, ProviderError, ProviderRequest DTO
  fake.ts              # FakeProvider — deterministic, offline; scripted expectations + default fall-through
  claude.ts            # ClaudeProvider — CLI OAuth at ~/.claude/auth.json
  codex.ts             # CodexProvider — CLI OAuth at ~/.codex/auth.json
  gemini.ts            # GeminiProvider — stub; throws provider_gemini_not_yet_supported
  registry.ts          # ProviderRegistry — typed lookup by ProviderId; loaded once via cli/bootstrap
  health.ts            # health checks per provider; aggregate runner for `doctor providers`
  invoke.ts            # the wrapper layer: withPermissions + withCost + withMetrics + manifest hashing
  manifest.ts          # buildManifest({ files, agent }): hashes + sizes + permissions intersection
  cost.ts              # readRunningTotals({ events }) + estimateNext + checkBudget
  errors.ts            # ProviderError (issue-array shape mirroring AgentLoadError / GateLoadError)
src/tools/
  review-request.ts    # requestReview({ reviewer, files, question }); cross-family enforced
src/commands/
  doctor.ts            # `code-oz doctor providers` — was a stub since M1; M4 wires it
docs/contracts/
  PROVIDERS.md         # user-facing summary
docs/references/
  provider-contract.md # NEW pinned spec — IAgentProvider, request DTO, error codes, metric semantics
tests/
  provider-contract.test.ts        # interface conformance test that all providers must pass
  provider-health.test.ts
  providers-fake.test.ts           # scripted-expectations fixture suite
  providers-claude.test.ts         # mocked auth file
  providers-codex.test.ts          # mocked auth file
  providers-gemini.test.ts         # stub-throws assertion
  providers-permissions.test.ts    # wrapper rejection paths
  providers-cost.test.ts           # pre-call refusal paths + NEEDS_INTERVENTION write
  providers-metrics.test.ts        # the four required fields + fieldsRemovedByScope semantics
  providers-manifest.test.ts       # hash+size+intersection
  providers-invoke.test.ts         # wrapper composition + agent_invoked event content
  tools-review-request.test.ts     # cross-family enforcement
  commands-doctor.test.ts
```

### Type sketches

```ts
// src/providers/types.ts
export type ProviderId = 'claude' | 'codex' | 'gemini' | 'fake'

export interface ProviderRequest {
  readonly agent: AgentDefinition          // from src/agents/schema.ts
  readonly phase: Phase                    // from src/state/schemas.ts
  readonly runId: string                   // ULID
  readonly prompt: string                  // composed by the phase logic; the persona body is part of `agent`
  readonly files: readonly ProviderFileInput[]   // explicit phase manifest before hashing
  readonly model?: string                  // overrides agent.model
  readonly maxOutputTokens?: number        // adapter-specific cap
  readonly toolCallCapHint?: number        // optional hint surfaced from PLAN.md (M6); runtime ignores for enforcement
}

export interface ProviderFileInput {
  readonly path: string                    // absolute or relative-to-cwd; wrapper normalizes
  readonly content: Buffer | string        // already in memory by the time the wrapper runs
  readonly droppedFields?: readonly string[]   // optional: phase logic recorded which agent-frontmatter or persona-body fields it omitted; counted into fieldsRemovedByScope metric
}

export interface ProviderResponse {
  readonly content: string
  readonly tokensUsed?: number
  readonly toolCalls?: readonly ProviderToolCall[]   // for M5+ tool-bearing phases
  readonly model: string
  readonly stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'budget_exceeded' | 'error'
}

export interface IAgentProvider {
  readonly id: ProviderId
  invoke(req: ProviderRequest): AsyncIterable<ProviderEvent>   // streaming (see prompt 1)
  health(): Promise<ProviderHealth>
}

export type ProviderEvent =
  | { readonly type: 'turn_started'; readonly model: string }
  | { readonly type: 'content_chunk'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ProviderToolCall }
  | { readonly type: 'tool_result'; readonly result: unknown }
  | { readonly type: 'turn_completed'; readonly response: ProviderResponse }

export interface ProviderHealth {
  readonly provider: ProviderId
  readonly authStatus: 'ok' | 'missing' | 'expired' | 'unknown'
  readonly modelDefaultAvailable: boolean
  readonly latencyMs?: number
  readonly lastError?: { code: string; rule: string; detail?: string }
}

export interface ProviderErrorIssue {
  readonly file?: string                   // typically not file-bound for provider errors
  readonly code: ProviderErrorCode
  readonly rule: string
  readonly detail?: string
  readonly actionableSuggestions: readonly string[]   // required: kickoff acceptance
}

export type ProviderErrorCode =
  | 'provider_auth_missing'
  | 'provider_auth_expired'
  | 'provider_rate_limit'
  | 'provider_malformed_response'
  | 'provider_budget_exceeded'
  | 'provider_permissions_violation'
  | 'provider_tool_call_cap_exceeded'
  | 'provider_gemini_not_yet_supported'
  | 'provider_io_error'

export class ProviderError extends Error {
  constructor(public readonly issues: readonly ProviderErrorIssue[]) { /* ... */ }
}
```

### Wrapper-layer composition

```ts
// src/providers/invoke.ts
export interface InvokeContext {
  readonly registry: ProviderRegistry
  readonly runPaths: RunPaths        // from src/state/run.ts
  readonly config: CodeOzConfig      // from src/config/schema.ts
}

export async function* invokeAgent(
  ctx: InvokeContext,
  req: ProviderRequest,
): AsyncIterable<ProviderEvent> {
  // 1. Build manifest: hash + size + intersect with agent.permissions.read.
  //    Throws ProviderError(provider_permissions_violation) on first out-of-bounds file.
  const { entries, droppedFieldCount } = await buildManifest(req)

  // 2. Pre-call cost-budget check. Refusal writes NEEDS_INTERVENTION.json
  //    and throws ProviderError(provider_budget_exceeded).
  await assertWithinBudget(ctx, req, entries)

  // 3. Tool-call cap pre-check (config-only, addendum item c).
  //    Throws ProviderError(provider_tool_call_cap_exceeded) if hint > config cap.
  assertToolCallCap(ctx.config, req.toolCallCapHint)

  // 4. Append agent_invoked event with manifest + metrics.
  await appendEvent(eventPathsFor(ctx.runPaths), {
    version: 1,
    type: 'agent_invoked',
    ts: new Date().toISOString(),
    runId: req.runId,
    phase: req.phase,
    agent: req.agent.name,
    provider: req.agent.provider,
    manifest: { files: entries },
    filesSent: entries.length,
    bytesSent: entries.reduce((s, e) => s + e.sizeBytes, 0),
    tokensEstimate: estimateTokens(req, entries),
    fieldsRemovedByScope: droppedFieldCount,
  })

  // 5. Stream from the adapter.
  const adapter = ctx.registry.get(req.agent.provider as ProviderId)
  let tokensUsed: number | undefined
  for await (const ev of adapter.invoke(req)) {
    if (ev.type === 'turn_completed') tokensUsed = ev.response.tokensUsed
    yield ev
  }

  // 6. agent_completed (run.ts pattern: append after all adapter work is done).
  await appendEvent(eventPathsFor(ctx.runPaths), {
    version: 1,
    type: 'agent_completed',
    ts: new Date().toISOString(),
    runId: req.runId,
    phase: req.phase,
    agent: req.agent.name,
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
  })
}
```

### Validator change (M4 must land first commit, before adapter code)

The current `src/state/events.ts` `validateEvent` for `agent_invoked`:
- treats `manifest` as **optional** (the M3 audit-slot design)
- has a closed `EVENT_TYPES` allow-list

M4 mutates this to:
- require `filesSent` (non-negative integer), `bytesSent` (non-negative integer), `tokensEstimate` (non-negative integer), `fieldsRemovedByScope` (non-negative integer) on every `agent_invoked` event
- keep `manifest` itself as optional-on-the-event-but-required-when-the-wrapper-emits-it (some `agent_invoked` events from edge cases may still legitimately omit a manifest, e.g., a future no-files agent invocation; but **wrapper-emitted** events always include a manifest, even an empty one, plus all four metric fields)
- the `EVENT_TYPES` union opens (per kickoff loose thread): the validator's `version: 1` rule is the contract; the type union becomes "first-class types we know" without rejecting unknown future types — this lets M7 add `failure_recorded` without a schema migration

**This is a spec-doc-first change** (M3 commit-1 pattern): `docs/references/file-based-gates.md` § 5 (events.jsonl event types) needs the four new required fields documented, plus an explicit "type allow-list is open after this version; consumers must not reject unknown event types when version === 1" rule.

### My nine kickoff leans + four addendum-opened leans

For each: lean + reasoning + counter-argument I'm aware of. Same shape as the M3 briefing.

#### 1. `IAgentProvider.invoke()` shape: streaming events or batch response?

**Lean: streaming.** Yields a typed event sequence (`turn_started`, `content_chunk`, `tool_call`, `tool_result`, `turn_completed`). Claude SDK is stream-native; Codex too. FakeProvider emits canned sequences. Aligns with M3's append-only event-log discipline — the wrapper layer just consumes the stream and emits its own `agent_invoked`/`agent_completed` events. Sets up M5+/W5+ TUI work without retrofitting.

**Counter:** stream complexity for v0.1. A batch shape (one Promise resolves to the full response) is far simpler to mock and test against. Streaming can be retrofitted in v0.2 when a TUI exists. No M4 caller needs intra-turn observability — DEFINE/PLAN/REVIEW are full-text artifacts.

**Push back if** a hybrid exists (adapter returns `Promise<ProviderResponse>` for batch consumers + exposes an optional `stream()` for callers that want it), or if streaming will inflate FakeProvider's scripting API past usefulness.

#### 2. OAuth token reading: read on every call, or cache with mtime invalidation?

**Lean: read on every call.** Simple, no staleness, no cache-invalidation bugs. ~10ms file IO per call is acceptable at v0.1 turn counts (BUILD-lite caps near 50 turns; no run will exceed ~250 invocations). The cumulative IO is sub-second and never on a hot loop.

**Counter:** long-running phases in M7 (BUILD-lite + REVIEW-lite + bounded retries) may issue dozens of calls; cumulative IO matters, especially when the OAuth file is large or symlinked across home-dir overlays. Cache with `fs.stat(mtime)` is a five-line addition.

**Push back if** Bun has a known issue with frequent re-reads of `~/.claude/auth.json` (file watchers, fs cache misses), or if the cache pattern ships better with M4 because M5+ phase logic will hammer providers more than v0.1's caps suggest.

#### 3. Manifest assembly: provider computes sha256+sizeBytes, or caller (wrapper) pre-computes?

**Lean: wrapper pre-computes.** Phase logic owns the file list; the wrapper hashes + sizes + intersects with `permissions.read` before the adapter sees the request. Avoids re-reading content in adapters that already received it via `ProviderRequest.files[].content`. One `buildManifest()` shared across all four adapters.

**Counter:** ergonomic to put it in the provider — every adapter would do the same hash computation otherwise. But a shared helper in `providers/manifest.ts` resolves that without coupling adapters; this is what the lean already proposes.

**Push back if** there's a third location (`src/state/manifest.ts` since the manifest is an event-log concern, not provider concern), or if the `ProviderFileInput.droppedFields` slot is the wrong way to surface narrowing-evidence to the metrics calculation.

#### 4. Permissions check location: wrapper layer (single chokepoint), or each adapter?

**Lean: wrapper layer (`src/providers/invoke.ts` via a `buildManifest` step).** Every adapter inherits the same check; no adapter forgets. Mirrors M3's `run.ts` wrapping `gates.ts` + `events.ts` under one lock. Closes the audit-trail loop M3 designed for: every `agent_invoked` event has the manifest the permissions check ran against.

**Counter:** providers see the API key and the actual outbound request — they could reject more efficiently (avoid encoding the prompt before refusing). But the file-list check is in-memory boolean intersection on already-loaded paths; the cost is microseconds, not milliseconds. No efficiency gain from pushing it down.

**Push back if** the wrapper's composition style is wrong (single-entry function vs. `withPermissions(withCost(withMetrics(adapter)))` higher-order shape — see prompt 13), or if cross-family enforcement should also live here for symmetry instead of in `tools/review-request.ts`.

#### 5. NEEDS_INTERVENTION discipline: provider throws `ProviderError` → wrapper writes the gate. Or: provider writes the gate directly.

**Lean: typed error + wrapper writes.** Adapter throws `ProviderError({ issues: [{ code, rule, detail, actionableSuggestions }] })`; the wrapper catches and writes `NEEDS_INTERVENTION.json` via `gates.ts` `writeNeedsInterventionGate`. Adapter focuses on talking to LLMs; gate-writing is uniform across providers. Mirrors M3's layering rule (gates.ts + events.ts are pure I/O modules; orchestration sits above them).

**Counter:** providers know more about their failure modes (rate limits with retry-after, malformed responses with parsing context). But that information goes into the typed error's `detail` field — no information lost.

**Push back if** the wrapper should write `NEEDS_INTERVENTION.json` for *all* error codes vs. only some (e.g., should `provider_rate_limit` write a NEEDS_INTERVENTION when the orchestrator's retry policy might reasonably absorb it without user intervention?), or if the `actionableSuggestions: readonly string[]` requirement is too rigid for some failure modes that have no user-facing remediation.

#### 6. `FakeProvider` determinism: scripted expectations, or pure function on input?

**Lean: scripted with deterministic-default fall-through.** Tests register expectations: `fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: 'canned spec', tokensUsed: 100 })`. Untestered combos return `{ content: 'fake response', tokensUsed: 50, model: 'fake-default', stopReason: 'end_turn' }`. Lets specific tests be precise without forcing every test to set up every call.

The scripted API also supports failure-mode injection: `fake.expect({ ... }).fail({ code: 'provider_rate_limit', ... })` for testing wrapper-layer NEEDS_INTERVENTION paths.

**Counter:** pure (input → output deterministic by hash) makes broader integration tests easier to author without per-test scripting. But pure is less expressive — tests can't easily simulate "first call returns retry-required, second call succeeds" or "this specific persona+phase combo fails."

**Push back if** the scripted API needs a strictness mode (default = fall-through to defaults; strict = throw on unscripted invocation), or if the queue-of-responses pattern (`fake.queue([{...}, {...}])`) is more useful than per-(phase,agent) routing for the spine tests M7 will write.

#### 7. Cross-family enforcement location: in `tools/review-request.ts`, or in the wrapper?

**Lean: `src/tools/review-request.ts`.** The review-request tool reads the build agent's provider from the event log + the reviewer agent's provider from the registry, compares families, refuses if equal. Provider doesn't know about families; wrapper doesn't either. Single chokepoint where the only cross-family primitive is invoked.

**Counter:** the wrapper has the same invocation visibility and could enforce centrally for all primitives (current and future). But there's only one cross-family primitive in v0.1 (`requestReview`); putting it in the wrapper is over-generalizing. v0.3+'s broader `consult()` would also live in `tools/`, where the same enforcement applies.

**Push back if** the family comparison logic (`provider !== other.provider` is too coarse — what about a hypothetical future case where `claude-sonnet` and `claude-opus` count as the same family vs. different; the kickoff implies family = `provider` field exactly) is fragile, or if reading the build-agent's provider from the event log is the wrong source vs. reading from the agent-registry by build-agent name.

#### 8. Cost-budget enforcement: pre-call (refuses calls that would exceed budget) or post-call (records and surfaces breach later)?

**Lean: pre-call.** Wrapper reads running totals from `events.jsonl` (sum of `agent_completed.tokensUsed` per phase + `agent_invoked.tokensEstimate` for in-flight calls), estimates the next call's cost (rough heuristic per provider), refuses if it would exceed `config.budgets.global.maxTokensEstimate` or `config.budgets.perPhase[phase].maxTokensEstimate`. Refusal becomes `NEEDS_INTERVENTION` with `code: 'provider_budget_exceeded'` and `actionableSuggestions` naming the budget that would be exceeded and how to raise it.

Per-call counts: `maxTurns` (count of `phase_entered` events for the phase) and `maxProviderCalls` (count of `agent_invoked` events for the phase) are simpler; use exact integer counts, not estimates.

**Counter:** pre-call estimates are imprecise (we don't know output token count until after); a soft warning at 80% of budget is friendlier UX. But hard cap > soft warning when the user is paying real money, and the kickoff's "Don't" list rules out post-call.

**Push back if** the per-provider token-estimation heuristic should live in adapters (each provider knows its own tokenizer) vs. in `cost.ts` (one heuristic shared across providers), or if the running-totals read should cache per-run (one `events.jsonl` scan per run boot) vs. re-scan per call.

#### 9. `GeminiProvider` stub contract: throw `provider_gemini_not_yet_supported`, or accept `experimental: true` and execute via Gemini SDK?

**Lean: throw `provider_gemini_not_yet_supported` from `gemini.ts.invoke()`.** The frontmatter `experimental: true` flag (which doesn't yet exist in M2's `agent_PROVIDERS = ['claude', 'codex', 'gemini', 'fake']` allow-list — it's already permitted by name) prevents loader-level rejection but does NOT unlock the adapter. Honest stub. `health()` reports `authStatus: 'unknown'` and `modelDefaultAvailable: false`.

**Counter:** `experimental: true` could mean "I accept the risk — try it." A real attempt with the Gemini SDK gives users a path forward. But the SDK isn't audited, no NEEDS_INTERVENTION discipline on its errors, and we'd be supporting a half-working surface. Stub is honest; flip to real adapter in W3.

**Push back if** the `health()` shape for the stub should differ from real adapters (e.g., a separate `'stubbed'` value on `authStatus`), or if the `code-oz doctor providers` output should explicitly call out gemini as deferred rather than just reporting it as a failed health check.

---

#### 10. Context metrics shape on `agent_invoked` events (addendum item a opens this).

The addendum locks the four required fields: `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`. The shape and validator semantics are open.

**Lean: sibling fields on the event (top-level).** Same level as `manifest`. Validator requires presence-when-`type === 'agent_invoked'` (not optional). The pinned spec at `docs/references/file-based-gates.md` § 5 amends to document them. Update lands in M4 commit 1 (spec) before any code that emits them (mirrors M3 commit 1 pattern).

```jsonc
{ "version": 1, "type": "agent_invoked", "ts": "...", "runId": "...", "phase": "build", "agent": "builder", "provider": "claude",
  "manifest": { "files": [{ "path": "...", "sha256": "...", "sizeBytes": 0 }] },
  "filesSent": 3, "bytesSent": 12480, "tokensEstimate": 4200, "fieldsRemovedByScope": 0 }
```

**Counter:** nest under a `metrics: { filesSent, bytesSent, tokensEstimate, fieldsRemovedByScope }` key for grouping. Cleaner JSON. But it's one more level of indentation in every event for marginal benefit — and the validator already gets to enforce structural shape regardless of nesting. Sibling fields keep the `manifest` field next to the metric counts for human readability.

**Push back if** the validator change should be more aggressive (treat the four fields as required across all event types via a baseline "metric fields if present must be non-negative integers"), or if `tokensEstimate` should be `tokensEstimateUpperBound` for accuracy (the heuristic estimates the *next call's expected token cost*, including the prompt prefix; the post-call `agent_completed.tokensUsed` is the actual count). Also: should `fieldsRemovedByScope` be 0-or-positive integer, or should it accept null when the phase logic didn't perform any narrowing (vs. zero meaning "narrowing happened, removed nothing")?

#### 11. Tool-call cap config keys + enforcement location (addendum item c opens this).

The addendum locks: cap is config-only, lives in `.code-oz/config.yaml`, ignores PLAN-level estimates. Key names and where the check fires are open.

**Lean: add `maxToolCallsPerTurn: number` (required; default 10) and `toolCallBudgetMultiplier: number` (optional; default 1.5) to `Budgets.global`.** Enforcement fires in the wrapper at `assertToolCallCap()` step before the adapter runs. The hint surfaced in `ProviderRequest.toolCallCapHint` (advisory from PLAN.md, M6+) is logged via `agent_invoked` for observability but never compared against the cap — the cap is policy, not per-task estimate.

The multiplier exists for callers that want "hard cap" vs "soft cap" (`maxToolCallsPerTurn * toolCallBudgetMultiplier` is the absolute ceiling; the base is the soft warning threshold). M4 enforces the hard ceiling only; soft warning lands in W2 if needed.

**Counter:** `maxToolCallsPerTurn` may be the wrong unit if the M5+ phase logic doesn't drive a clear "turn" boundary in DEFINE/PLAN; a per-phase `maxToolCalls` with the global as a fallback is the addendum's split. But the addendum explicitly says "per turn"; deviating reopens what the addendum closed.

**Push back if** `toolCallBudgetMultiplier` is YAGNI for M4 (drop it; reintroduce in W2 if needed) — it adds two config keys and a multiplication that nothing in v0.1 actually uses. Or: the cap should fire at every `tool_call` event from the stream, not pre-call (the pre-call check is an estimate; the stream-time check is exact).

#### 12. Open the `EVENT_TYPES` union in M4 (addendum loose thread → kickoff loose thread).

The kickoff says: "M7 will add a `failure_recorded` event type. M4's event-schema validator must already tolerate unknown event types via the existing `version: 1` versioning rule (no allow-list of types). Confirm during planning that the validator doesn't lock the type union."

The current code in `src/state/events.ts:73` has a closed allow-list (`EVENT_TYPES` constant). Unknown types are rejected with `event_invalid_type`. The kickoff's claim that "the validator doesn't lock the type union" is not currently true.

**Lean: open the allow-list in M4.** The validator's `version: 1` rule remains the contract. Unknown event types pass schema validation (just shape: `version === 1` and `type` is a non-empty string). Specific known types still get type-specific field validation; unknown types are stored as-is in the log.

The reducer in `run.ts:reduceEvents` already only switches on the known types it cares about (`run_started`, `phase_entered`, `phase_exited`); unknown types currently never reach the reducer because the validator rejects them. Opening the validator means the reducer ignores unknown types (cleanly — a `default:` case that no-ops), which is the desired forward-compat behavior.

**Counter:** opening the union loses the "unknown event types are bugs" signal. M7's `failure_recorded` could be added in M7 with a one-line schema bump (`'failure_recorded'` to the array). The kickoff's confidence that M7 won't need a schema migration is overstated — a schema bump is two lines (type union + reducer case).

**Push back if** the schema-bump-per-new-event pattern is the right v0.1 default (closed allow-list keeps validation strict; unknown types are bugs we want to fail loudly), or if a halfway pattern fits (validator records `unknown_event_type_v1` warnings but stores the events vs. rejecting outright).

#### 13. Wrapper composition style: single entrypoint or higher-order chain?

The kickoff describes the wrapper as "permissions check + cost budgets + manifest hashing + metrics" but doesn't pin the composition style.

**Lean: single entrypoint (`invokeAgent(ctx, req)` in `invoke.ts`).** Inline sequential steps in a single async generator: `buildManifest → assertWithinBudget → assertToolCallCap → appendEvent(agent_invoked) → adapter.invoke → appendEvent(agent_completed)`. Linear control flow; one place to read; easy to trace. Mirrors M3's `approveGate` orchestration style (one function inside `withLock`, sequential awaits).

**Counter:** higher-order composition (`withPermissions(withCost(withMetrics(adapter)))`) is more compositional and lets tests substitute layers (mock cost, real permissions). It's the pattern from `pi-mono`. But each layer has to know about the request shape, the next layer's interface, and the streaming contract; in practice this becomes an indirection without test wins (M4 has direct unit tests for `buildManifest`, `assertWithinBudget`, etc., individually).

**Push back if** `pi-mono`'s actual composition style is materially better than what I propose (you have `/add-dir` access to `~/Projects/agents/templates/pi-mono`), or if a third pattern fits (e.g., single async generator with named pre/post hooks for tests to override).

---

## How to reply

Four sections. Be terse. No hedging. If you'd recommend a different structure, say so first.

1. **Where I agree (sanity-checked).** For each lean you confirm: one sentence on why my reasoning holds up under scrutiny. If you only nod without checking, you are not earning your seat at this round.

2. **Where I disagree (with specific alternative).** For each lean you reject: the better path, concretely. Name a library, a code shape, a rule, an API surface.

3. **What's missing.** Categories I haven't asked about that the M4 provider contract + wrapper layer + adapters + doctor command still have to get right. Candidates I'm aware I haven't thought hard about:

   - Token-estimation heuristic: wrapper-shared (one heuristic across all providers) vs. per-provider (each adapter knows its own tokenizer). The `tokensEstimate` metric's accuracy bound matters for budget refusal correctness.
   - `agent_completed.tokensUsed` provenance: adapter reports back from API response vs. wrapper post-counts the streamed content. Provider responses lie sometimes (e.g., chunked streams sum differently than the API total).
   - Manifest content vs. paths: the `ProviderRequest.files[].content` slot already requires the phase logic to load file content into memory. Should the wrapper instead receive paths only and do its own (privacy-bounded, redaction-aware) read, with content loaded lazily after permission check passes? Affects rule 13's "files sent to provider preview."
   - Provider preview surface: the kickoff mentions "files sent to provider preview per phase" but doesn't specify when/where it surfaces. Should `code-oz doctor providers` include a dry-run preview, or is preview a `code-oz status` concern?
   - `requestReview` reading the build-agent's provider: from `agent_invoked` events in the log, or from the agent registry by build-agent name? The former is more decoupled (the reviewer doesn't need to know which agent did the build); the latter is simpler but requires phase logic to pass the build-agent name through.
   - Cross-family check granularity: `provider` field (`claude` vs `codex` vs `gemini` vs `fake`) is the family discriminator the kickoff implies. Is there a future case where two `claude`-provider adapters (claude-cli vs anthropic-direct-api) should count as different families for review purposes? v0.1 has only one adapter per provider, so this is theoretical, but the family-comparison primitive should not paint itself into a corner.
   - Auth file format: `~/.claude/auth.json` and `~/.codex/auth.json` formats are not in any pinned spec. Should M4 land a pinned reference for them (with version/expiry expectations), or read the formats opportunistically and treat unknown shapes as `provider_auth_missing`?
   - Default model resolution chain: agent.model → config.models.primary → adapter.defaultModel. Is this the right precedence? Where does `config.models.reviewer` fit (kickoff doesn't mention it but it's in the M3 config schema)?
   - Test fixture strategy for mocked auth files: per-test-temp-dir vs. shared `tests/fixtures/auth/` vs. injected paths. M4's mocked Claude/Codex tests need to write files outside `~/`.
   - Health-check side effects: should `health()` write events to events.jsonl (it's a provider invocation, technically), or stay invisible to the run trace because doctor runs outside any active run?
   - `code-oz doctor` exit code semantics: zero on all-providers-healthy, non-zero on any failure, vs. zero always (report-only). Kickoff says "failed health checks aggregate, never crash the command" but doesn't specify exit code policy.
   - The "phase-owned manifest builder" concept (addendum item b): does M4 ship a single shared builder with phase-keyed strategies, or does each phase ship its own builder (M5+ owns DEFINE's builder, M6+ owns PLAN's builder)? M4 ships at least one to prove the pattern; the question is which.
   - `tokensEstimate` source-of-truth when the adapter is `fake`: synthetic constant, or scripted per-expectation. Affects how M5–M7 cost-budget tests are authored.
   - The wrapper's interaction with the per-run lock from M3: does the wrapper's `appendEvent` calls live inside an existing lock acquired by phase orchestration (M5+), or does the wrapper acquire its own lock per call? The current `appendEvent` in M3 has a `skipLock: true` option for callers that already hold the lock.
   - `.gitignore` policy for test-generated `.code-oz/` directories: tests creating temp `.code-oz/` directories shouldn't clutter `git status`. M3's tests already deal with this; M4 inherits the pattern but should confirm it doesn't write rules that would later block `.code-oz/memory/project/` (per addendum item — out of M4 scope but worth not blocking).
   - Does the M4 spec amendment (`docs/references/file-based-gates.md` § 5 + the new `docs/references/provider-contract.md`) land in commit 1 (spec-first, M3 pattern), or can it batch with the implementation commits?

   Tell me which of these matter for v0.1 and which can defer, and what I missed.

4. **Concrete M4 implementation order.** Eight-to-ten file commits in the order you'd land them. Each commit self-contained, `bun test` + `bun run typecheck` clean before next. M2 had 7, M3 had 9 base + 4 review-fix; M4 likely 8–10 base + 2–4 review-fix. Ground in the locked acceptance: FakeProvider runs lifecycle offline; real adapters fail with NEEDS_INTERVENTION; cross-family rejection in requestReview; doctor returns structured per-provider health; agent_invoked carries manifest + four metric fields; permissions enforced in wrapper; cost-budget pre-call refusal writes NEEDS_INTERVENTION; tool-call cap config-only; M1+M2+M3 regression suites stay green (266 tests).

The verdict at the end: `proceed-with-leans`, `proceed-with-modifications`, or `reopen-design`. Use the strongest verdict you can defend.

---

## Pointers for your reply

- Mirror the four-section shape from `CODEX_RESPONSE_M3.md` and `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md`. Numbered findings, not prose.
- When citing files, use repo-relative paths (e.g., `src/providers/invoke.ts`, `src/state/events.ts:73`).
- When proposing a code shape, give the actual TypeScript surface, not pseudocode.
- Cite upstream templates by repo name when you borrow a pattern (e.g., "pi-mono's `pickProvider` shape").
- If you spot a contradiction between this briefing and the cross-cutting addendum, the addendum wins — flag the contradiction in your reply so I can fix the briefing.
