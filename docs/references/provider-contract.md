# Provider contract — canonical spec for code-oz

This document is the **pinned spec** for the `IAgentProvider` interface, the request DTO split, the wrapper layer, the `requestReview` cross-family primitive, and `code-oz doctor providers`. It locks the M4 surface that M5+ phase logic, M7's REVIEW orchestration, and W3+'s second-family adapter work plug into.

The upstream templates are influence; this file is the authority for `code-oz`. When upstream and this file disagree, this file wins for `code-oz` purposes.

## Provenance

- **Upstream influences:**
  - `~/Projects/agents/templates/pi-mono` — streaming `invoke()` event model; `IAgentProvider`-style multi-provider abstraction
  - `~/Projects/agents/templates/Archon` — function-like provider shape (stateless, each call self-contained)
  - `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — narrow cross-family REVIEW primitive (`requestReview`); broad `consult()` deliberately deferred to v0.3
- **No code dependency, no submodule, no copy-paste.** Patterns are borrowed; the implementation is `code-oz`.
- **Sync policy (auth model, v0.1):** the v0.1 contract supports two auth shapes — subscription-first delegation to upstream CLIs (Claude, Codex; locked in M4 commit 8 per [`docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`](../design/CODEX_RESPONSE_M4_ADAPTERS.md)), and direct API-key transmission for HTTP adapters that have no upstream-CLI option (xAI; landed in PE-1 per [`docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`](../design/SESSION_XAI_EXPANSION_KICKOFF.md), Codex thread `019de497`). For subscription-first adapters: code-oz never reads or transmits OAuth tokens directly — `~/.claude/auth.json` and `~/.codex/auth.json` are not in our trust boundary; health probes use the CLIs' own status surfaces (`claude --version`, `codex login status`). For API-key adapters: code-oz reads `<PROVIDER>_API_KEY` from env at invoke time and transmits it as Bearer auth over HTTPS; the trust-boundary discipline (redaction, never-log-Authorization, sanitized error detail) is pinned in § "Auth model — subprocess delegation + API-key transmission (v0.1)" below. The W3 milestone may add additional HTTP-based adapters that swap subprocess auth for direct OAuth+PKCE; the `IAgentProvider` contract stays unchanged.

## Why this exists

M4 lands four surfaces that need a stable contract before M5+ depends on them:

1. **The interface** — `IAgentProvider` is the seam every adapter implements and every phase logic plugs into.
2. **The request DTO split** — `ProviderRequest` (paths only) is what phase code constructs; `PreparedProviderRequest` (content + manifest + metrics) is what the wrapper produces and adapters consume. The split is load-bearing for non-negotiable rule 13: phase code never loads file content; the wrapper is the only path that reads disk after permissions intersection.
3. **`ProviderFamily`** — cross-family REVIEW enforcement (rule 2) compares provider families, not provider IDs. In v0.1 every `ProviderId` maps to its same-named `ProviderFamily`; in W3+ when `claude-cli` and `anthropic-api` adapters land, both share `family: 'claude'` and REVIEW correctly rejects them as same-family. Locking the type now avoids a refactor later.
4. **`ProviderError` + the `NEEDS_INTERVENTION → intervention` event sequence** — every provider failure becomes a typed error with `{ code, rule, detail?, actionableSuggestions: string[] }`. The wrapper catches and writes both the gate file (`NEEDS_INTERVENTION.json`) and the matching `intervention` event under a short post-call lock. Adapters never write either.

## The interface

```ts
type ProviderId = 'claude' | 'codex' | 'gemini' | 'fake' | 'xai'
type ProviderFamily = 'claude' | 'codex' | 'gemini' | 'fake' | 'xai'   // == ProviderId in v0.1

interface IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  readonly capability: ProviderCapability   // M11 — see § "Capability and eligibility (M11)" below
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent>
  health(): Promise<ProviderHealth>
}
```

Adapters are stateless. Every `invoke()` call spawns the upstream CLI fresh (subscription-first via `claude login` / `codex login`), makes an outbound HTTPS request reading `<PROVIDER>_API_KEY` from env (PE-1: xAI), or, for `FakeProvider`, walks its scripted expectation queue. No shared mutable state across calls; no in-memory token caching. The Archon discipline.

## Request DTO split

```ts
// Public — what phase logic constructs
interface ProviderRequest {
  readonly agent: AgentDefinition          // from src/agents/schema.ts
  readonly phase: Phase                    // from src/state/schemas.ts
  readonly runId: string                   // ULID
  readonly prompt: string                  // composed by phase logic; persona body is part of `agent`
  readonly files: readonly ProviderFileRef[]   // paths only, never content
  readonly model?: string                  // overrides agent.model
  readonly maxOutputTokens?: number        // adapter-specific cap
}

interface ProviderFileRef {
  readonly path: string                    // absolute or repo-relative; wrapper normalizes
  readonly droppedFields?: readonly string[]   // optional: phase logic recorded which agent-frontmatter or persona-body fields it omitted; counted into fieldsRemovedByScope metric
}

// Internal — what the wrapper produces and adapters consume
interface ProviderFile {
  readonly path: string                    // normalized absolute path
  readonly content: Buffer                 // loaded by the wrapper, never by phase code
  readonly sha256: string                  // 64-char lowercase hex
  readonly sizeBytes: number
}

interface PreparedProviderRequest extends Omit<ProviderRequest, 'files'> {
  readonly files: readonly ProviderFile[]
  readonly manifest: AgentManifest         // shape from src/state/schemas.ts
  readonly metrics: ProviderContextMetrics
}

interface ProviderContextMetrics {
  readonly filesSent: number
  readonly bytesSent: number
  readonly tokensEstimate: number
  readonly fieldsRemovedByScope: number
}
```

The split enforces rule 13 by construction: phase code that wants to read file content has nowhere to put it. Only the wrapper layer (`src/providers/manifest.ts`) loads bytes, and only after permissions intersection.

## Streaming events

```ts
type ProviderEvent =
  | { readonly type: 'turn_started'; readonly model: string }
  | { readonly type: 'content_chunk'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ProviderToolCall }
  | { readonly type: 'tool_result'; readonly result: unknown }
  | { readonly type: 'turn_completed'; readonly response: ProviderResponse }

interface ProviderResponse {
  readonly content: string
  readonly tokensUsed?: number             // present only when adapter has a real value from the API
  readonly toolCalls?: readonly ProviderToolCall[]
  readonly model: string
  readonly stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'budget_exceeded' | 'error'
}
```

Adapters yield `turn_started` once at the top of the stream, zero or more `content_chunk` and `tool_call` / `tool_result` pairs, and exactly one `turn_completed` at the end. The wrapper treats the stream as a state machine: it counts `tool_call` events for the streaming cap, reads `tokensUsed` from `turn_completed.response`, and never holds the per-run lock across this loop.

## ProviderFamily and cross-family REVIEW enforcement

Non-negotiable rule 2 — REVIEW agent must be in a different provider family from BUILD. The check happens in `src/tools/review-request.ts` before invoking the reviewer:

```ts
interface ReviewRequest {
  readonly buildProvider: ProviderId       // explicit, not inferred from event log
  readonly reviewer: AgentDefinition       // the reviewer agent (loaded from registry)
  readonly files: readonly ProviderFileRef[]
  readonly question: string
}

if (registry.familyOf(buildProvider) === registry.familyOf(reviewer.provider)) {
  throw new ProviderError([{
    code: 'provider_permissions_violation',
    rule: 'REVIEW provider must differ from BUILD provider family',
    actionableSuggestions: [
      'configure a reviewer agent on a different provider family',
      `current build family: ${registry.familyOf(buildProvider)}; reviewer family: ${registry.familyOf(reviewer.provider)}`,
    ],
  }])
}
```

`buildProvider` is passed explicitly by REVIEW orchestration — never inferred from `events.jsonl`. Logs may contain multiple `agent_invoked` events from recovery, retries, or future multi-task BUILD; relying on log inference would be ambiguous.

`registry.familyOf()` is the single authority for family comparison. Never compare `ProviderId` fields directly.

## ProviderError code list (canonical)

```ts
type ProviderErrorCode =
  | 'provider_auth_missing'
  | 'provider_auth_expired'
  | 'provider_rate_limit'
  | 'provider_malformed_response'
  | 'provider_budget_exceeded'
  | 'provider_permissions_violation'
  | 'provider_tool_call_cap_exceeded'
  | 'provider_gemini_not_yet_supported'
  | 'provider_io_error'

interface ProviderErrorIssue {
  readonly code: ProviderErrorCode
  readonly rule: string                    // human-readable, machine-parseable
  readonly detail?: string                 // adapter-specific context
  readonly actionableSuggestions: readonly string[]   // required, ≥ 1 entry
}

class ProviderError extends Error {
  constructor(public readonly issues: readonly ProviderErrorIssue[]) { /* ... */ }
}
```

`actionableSuggestions` is required and must contain at least one concrete shell command or remediation step. Examples: `'run `code-oz doctor providers`'`, `'run `claude login` and retry'`, `'raise budgets.global.maxTokensEstimate in .code-oz/config.yaml'`.

## NEEDS_INTERVENTION → intervention event discipline

Adapter throws `ProviderError`. Wrapper catches and:

1. Writes `NEEDS_INTERVENTION.json` to the run subdirectory via `writeNeedsInterventionGate({ runId, phase, agent, code, rule, detail, actionableSuggestions, createdAt })` (M3 contract).
2. Appends an `intervention` event to `events.jsonl`: `{ version: 1, type: 'intervention', ts, runId, code, phase }`.

Both writes happen under one short post-call per-run lock acquisition. The lock is **not** held across the network call; the adapter has already returned (with error) before lock 2 is acquired.

Adapters never write `NEEDS_INTERVENTION.json` and never append `intervention` events. The wrapper is the only path. Mirrors M3's layering rule: I/O modules are pure; orchestration sits above them.

## Cost-budget pre-call check

Wrapper, before invoking the adapter, under a short pre-call per-run lock:

1. `readEvents(runPaths.eventsFile)` for running totals.
2. Per-phase tallies:
   - `phaseTurns = count(phase_entered events for this phase)` vs `config.budgets.perPhase[phase].maxTurns`
   - `phaseProviderCalls = count(agent_invoked events for this phase)` vs `config.budgets.perPhase[phase].maxProviderCalls`
   - `phaseTokens = sum(agent_completed.tokensUsed for this phase) + sum(agent_invoked.tokensEstimate for in-flight)` vs `config.budgets.perPhase[phase].maxTokensEstimate`
3. Global tallies use the same shape against `config.budgets.global.{maxTurns, maxProviderCalls, maxTokensEstimate}`.
4. Conservative token estimator (`src/providers/cost.ts`): rough heuristic upper bound on the next call's token cost (~4 chars/token English upper bound; per-provider safety multiplier later). No tokenizer dependency in v0.1 — bound is "refuse before catastrophic spend," not "predict to within 5%."
5. If next-call estimate would breach any global or per-phase budget, throw `ProviderError(provider_budget_exceeded)` with `actionableSuggestions` naming the specific budget and the config key to raise.

The check, the budget refusal, and (on success) the `agent_invoked` event append all happen under the same short lock. Lock released before the network call.

## Tool-call cap streaming enforcement

The cap lives in `.code-oz/config.yaml`:

```yaml
budgets:
  global:
    maxToolCallsPerTurn: 10              # required, default 10
    toolCallBudgetMultiplier: 1.5         # optional, default 1.5
```

Hard ceiling = `Math.floor(maxToolCallsPerTurn * (toolCallBudgetMultiplier ?? 1.5))`.

The wrapper's `for await (const ev of adapter.invoke(prepared))` loop counts `tool_call` events. On exceeding the ceiling, throw `ProviderError(provider_tool_call_cap_exceeded)` with `actionableSuggestions: ['raise budgets.global.maxToolCallsPerTurn in .code-oz/config.yaml']`. The error flows through the standard NEEDS_INTERVENTION + intervention event path.

**Advisory PLAN-level estimates are never compared.** When M6 lands the `estimatedToolCalls` field on PLAN.md task blocks, the wrapper records it on `agent_invoked` for observability but does not gate enforcement on it. Cap is policy, not per-task estimate.

## `code-oz doctor providers` contract

`code-oz doctor providers` invokes `health()` on every provider in the registry and aggregates structured per-provider rows:

```ts
interface ProviderHealth {
  readonly provider: ProviderId
  readonly authStatus: 'ok' | 'missing' | 'expired' | 'unsupported' | 'unknown'
  readonly modelDefaultAvailable: boolean
  readonly latencyMs?: number               // optional, when health probe measured a real round-trip
  readonly lastError?: { code: string; rule: string; detail?: string }
}
```

**Side-effect rule:** `health()` must NOT write `events.jsonl`, `NEEDS_INTERVENTION.json`, or any other gate-class file. Doctor runs outside any active run; the per-run lock and event log do not exist there. Invocation failures *inside* an active run write gates as designed.

**Exit policy:** zero when all *required* providers are healthy. A "required" provider is any provider declared by a loaded agent in the registry. Gemini's `'unsupported'` `authStatus` is success-by-design when no loaded agent declares Gemini; non-zero only when an agent claims `gemini` and the stub refuses, or when a required provider returns `missing` / `expired` / `unknown` with `lastError`.

Output formats:

- **Default** — table view: one row per provider, columns `provider | authStatus | modelDefaultAvailable | latencyMs | lastError`.
- **`--json`** — `ProviderHealth[]` as a single JSON document.

The command never crashes on a single failed health probe; failures are aggregated into the output.

## Auth model — subprocess delegation + API-key transmission (v0.1)

v0.1 supports two auth shapes: subprocess delegation to upstream CLIs (Claude / Codex), and direct API-key transmission for HTTP adapters that have no upstream-CLI option (PE-1: xAI). The two shapes share the same `IAgentProvider` contract; only their auth substrates differ.

### Subprocess delegation (Claude, Codex)

Subprocess-backed adapters delegate auth entirely to the upstream CLIs. code-oz never reads, parses, or transmits an OAuth token, and never knows what platform-specific storage backend (auth.json file, OS credential store, etc.) the CLI uses.

- **`ClaudeProvider`** spawns `claude --print --output-format json --no-session-persistence` from an empty `mkdtemp()` working directory, with manifest content piped through stdin. Auth is whatever `claude login` set up. Health probe is `claude --version` (ENOENT → `'missing'`; non-zero exit → `'unknown'`; zero exit → `'ok'`). The empty temp cwd is a privacy guard — Claude Code auto-discovers `CLAUDE.md` files up the working-directory hierarchy at session start, so an inherited project cwd would expand the trust surface beyond the explicit manifest.
- **`CodexProvider`** spawns `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -` (read prompt from stdin) from an empty `mkdtemp()` working directory. Auth is whatever `codex login` set up. Health probe is `codex login status` (parses `'logged in'` substring on either stdout or stderr — codex CLI 0.125 writes to stderr — to set `'ok'`; ENOENT → `'missing'`; otherwise → `'unknown'`).
- **`GeminiProvider`** does not spawn anything. `invoke()` throws `provider_gemini_not_yet_supported`; `health()` returns `authStatus: 'unsupported'`. Real Gemini lands in W3+.
- **`FakeProvider`** never spawns. Tests register expectations against the in-process adapter.

Subprocess adapters expose two test-injection seams that never touch the real filesystem in the default suite:

- **`runner`** — a `(cmd, args, options) => Promise<{stdout, stderr, exitCode}>` function. Default uses `Bun.spawn`; tests inject mocks that return canned subprocess results.
- **`tempCwd`** — a `() => Promise<string>` factory that returns the working directory passed to the runner. Default creates a fresh `mkdtemp()`; tests can inspect or replace.

Failure mapping for non-zero CLI exits:

- ENOENT during spawn → `provider_io_error` with rule `"<provider> CLI not found in PATH"`.
- Non-zero exit + auth-keyword stderr (`"not logged in"`, `"please log in"`, `"login required"`) → `provider_auth_missing` with `actionableSuggestions: ["run \`<provider> login\`"]`.
- Non-zero exit otherwise → `provider_io_error` with the CLI's stderr in `detail`.

The W3 upgrade path replaces these subprocesses with direct HTTP integrations (e.g., opencode-style OAuth+PKCE → `chatgpt.com/backend-api/codex/responses` for Codex; equivalent if/when Anthropic ships subscription HTTP auth for Claude Max). The `IAgentProvider` contract is unchanged; only adapter internals swap. Wrappers (`src/providers/invoke.ts`) and tools (`src/tools/review-request.ts`) keep working without modification.

### API-key transmission for HTTP adapters (PE-1)

PE-1 ships the first HTTP-based adapter (`XaiProvider`) that reads an API key from the environment and transmits it directly to the upstream over HTTPS. Until PE-1, every v0.1 adapter either subprocess-delegated to a CLI that handled its own auth or ran in-process. The API-key transmission path is a categorical trust-boundary expansion, not "another adapter."

The shape is intentionally narrow: a single env var per provider, mandatory redaction, and a fixed HTTP-status-to-`ProviderErrorCode` mapping. Cloud-IAM auth (Azure / Bedrock / Vertex) is v0.2+ scope and earns its own contract section when committed.

**Env var naming convention.** Per-provider env var, named `<PROVIDER>_API_KEY` (e.g., `XAI_API_KEY`). No generic `API_KEY` or shared name across providers. Adapters read via `process.env.XAI_API_KEY` (or equivalent) at invocation time and surface a typed `ProviderError(provider_auth_missing)` when the value is absent or empty (after `trim()`).

**Redaction discipline (mandatory).** API keys must never appear in any artifact code-oz produces or persists:

- `events.jsonl` (no `agent_invoked.detail`, no `intervention.detail`, etc.)
- gate files (`NEEDS_INTERVENTION.json`, `GATE_*_PASSED.json`)
- doctor command output (table form and `--json` form)
- `ProviderError` messages and the structured `issues[].detail` field
- HTTP request and response logging at any layer (adapter, wrapper, future telemetry)

The redaction discipline is a property of the artifact-producing layer, not of the adapter alone. Tests assert it for every artifact path that touches an HTTP-adapter code path.

**Never log Authorization headers.** The set of header names that must not appear in any artifact, in any case (case-insensitive matching where applicable):

- `Authorization`
- `x-api-key`
- `api-key`
- any provider-specific auth header (e.g., `xi-api-key`, `OpenAI-Project`)

Adapters that record the HTTP request for debugging strip these headers before serialization. The same rule applies to response headers (some upstreams echo auth back).

**HTTP error mapping.** HTTP-based adapters map upstream status codes onto the existing `ProviderErrorCode` set:

| HTTP status | `ProviderErrorCode` | `actionableSuggestions` |
|---|---|---|
| 401 | `provider_auth_missing` | export the per-provider env var (`XAI_API_KEY=...`) and rerun |
| 403 | `provider_permissions_violation` | check API-key scopes / enabled models on the upstream account |
| 429 | `provider_rate_limit` | wait and retry; or raise `budgets.global.maxProviderCalls` if the cap is the cause |
| 5xx | `provider_io_error` | upstream transient error; retry, then file an issue if persistent |
| network / DNS / abort | `provider_io_error` | check connectivity; verify the configured base URL |
| malformed JSON body | `provider_malformed_response` | rerun; if persistent, the upstream API has likely changed shape |

Adapters never bypass the `ProviderError` model on HTTP failures — every failure path maps to a typed code with at least one actionable suggestion.

**Test-injection seam.** Mirroring the subprocess `runner` seam, HTTP adapters take an injectable fetch-like function as a constructor option (`runner` for symmetry, or a more specific name per the adapter). Default is `Bun.fetch`; tests inject mocks that return canned `Response` objects, keeping the offline-test discipline (rule 8) intact. Live tests against the real upstream endpoint are gated behind an opt-in env flag.

## Lock boundaries

The per-run lock from `src/state/lock.ts` (M3) is held briefly for atomic event-log + gate-file transactions. The wrapper's interaction with the lock:

1. **Pre-call short lock:** `withLock(runPaths.lockDir, async () => { await readEvents(...); /* budget check */; await appendEvent(agent_invoked, {skipLock: true}) })`.
2. **Lock released.** Adapter streams. The lock is **never** held across the network call.
3. **Post-call short lock (success):** `withLock(...)` to `await appendEvent(agent_completed, {skipLock: true})`.
4. **Post-call short lock (error):** `withLock(...)` to `await writeNeedsInterventionGate({skipLock: true}); await appendEvent(intervention, {skipLock: true})`.

The `appendEvent` and `writeGate` family already accept `{ skipLock: true }` for callers that hold the lock — M4 wrapper calls in this pattern.

## Validation rules summary

1. Adapters NEVER write `events.jsonl` or gate files; the wrapper does.
2. Adapters NEVER enforce `permissions.read`; the wrapper does (via `src/providers/manifest.ts`).
3. Adapters NEVER hold the per-run lock across a network call.
4. Adapters NEVER post-count tokens from streamed text and report it as actual usage; `tokensUsed` on `turn_completed.response` is reported only when the API response carries a real value.
5. Wrapper-emitted `agent_invoked` events ALWAYS carry `manifest`, `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`. Manifest is non-empty `{ files }` (possibly empty array, never absent).
6. Wrapper-emitted `agent_completed` events MAY omit `tokensUsed` when the adapter does not report it (the M3 schema accepts this).
7. Wrapper enforces tool-call cap via streaming counter, never via PLAN advisory hint.
8. `ProviderRegistry.familyOf` is the only authority for cross-family comparison; never compare `ProviderId` fields directly.
9. `requestReview` carries `buildProvider` explicitly; never infer from event log.
10. `health()` is side-effect-free; doctor runs outside any active run.
11. Manifest paths are subject to path-safety mirroring `src/state/gates.ts`: relative or repo-anchored, no `..` segments before normalization (defense-in-depth), realpath check rejecting symlink escapes from project root.

Any validation failure is reported as a typed `ProviderError` with `{ code, rule, detail?, actionableSuggestions }` — same shape as `AgentLoadError` from M2 and `GateLoadError` / `EventLogError` from M3.

## Anti-patterns rejected by this spec

- **`consult()` in v0.1.** Only `requestReview` at REVIEW gate. Broad consult ships in v0.3 if there's evidence the narrower primitive is insufficient.
- **Putting file content in `ProviderRequest`.** Use `ProviderFileRef` paths-only; the wrapper produces `PreparedProviderRequest`. Anything else lets phase code load bytes before the permission check.
- **Adapters writing `NEEDS_INTERVENTION.json` or appending `intervention` events.** Wrapper-only.
- **Reading or transmitting OAuth tokens from `~/.claude/auth.json` or `~/.codex/auth.json`.** Subscription-first delegates auth to the upstream CLIs. code-oz spawns the CLIs and lets them handle their own token storage / refresh / expiry. Adapters that read these files are rejected for v0.1.
- **Inferring `buildProvider` from event log inside `requestReview`.** Pass it explicitly via `ReviewRequest.buildProvider`.
- **Inheriting the caller's cwd in subprocess-backed adapters.** Both Claude and Codex auto-discover context files (CLAUDE.md, AGENTS.md, .codexrc) up the working-directory hierarchy. Always spawn from an empty `mkdtemp()` cwd and clean it in `finally`.
- **Pinning private auth file formats as a durable spec.** Readers are opportunistic; this spec describes `code-oz` behavior, not upstream-CLI internals.
- **Pre-call comparison of advisory PLAN tool-call estimates against the config cap.** Cap is a streaming counter; PLAN estimates (`estimatedToolCalls`, M6+) are advisory only.
- **Comparing `ProviderId` fields directly for cross-family checks.** Use `registry.familyOf()`.
- **Holding the per-run lock across a network call.** Always two short locks, never one long lock.
- **`health()` writing to `events.jsonl` or any gate file.** Doctor runs outside any active run.
- **Logging `Authorization`, `x-api-key`, or any provider-specific auth header in any artifact.** Includes `events.jsonl`, gate files, doctor output, error messages, and request / response logs. Strip these headers before any serialization. Mirrors the OAuth-token rule for subprocess adapters; same trust boundary, different substrate.
- **Embedding API keys in `ProviderRequest` / `PreparedProviderRequest` / persona prompt bodies.** Auth lives at the adapter layer; the request DTO never carries credentials. Phase logic constructs `ProviderRequest` without ever touching env-resolved secrets, and the wrapper's `buildManifest` only loads file content (the request body's `prompt` and the persona's body), never auth material.
- **Enabling provider-native server-side tools (e.g., xAI built-in `web_search`, `x_search`, `code_interpreter`) without an explicit `tool_use` permission scope authorizing them.** v0.1 HTTP adapters disable these by default. For OpenAI-compatible chat-completions endpoints that take an opt-in `tools` field, "disable" means **never sending the field** — sending an empty array `tools: []` is also acceptable but the omission form is preferred so a misuse adding `tools.push(...)` mid-request can't accidentally arm them. A future permission scope (`tool_use.upstream_native_tools`) may authorize specific tools when measurable demand surfaces.

## Capability and eligibility (M11)

M11 lands a static `ProviderCapability` record per provider plus a load-time check that an agent's declared `provider` is eligible to run for that agent's declared `phase`. Authority boundary (CLAUDE.md rule 20): provider eligibility. M11 introduces no new persona-side frontmatter, no new runtime surface, and no parallel-provider parallelism (rule 21).

```ts
type AuthSource =
  | 'claude-cli-oauth'
  | 'chatgpt-cli-oauth'
  | 'gemini-stub'
  | 'in-process-fake'

interface ProviderCostPerMTok {
  readonly input: number      // USD per 1M input tokens
  readonly output: number     // USD per 1M output tokens
}

interface ProviderRateLimits {
  readonly requestsPerMinute?: number
  readonly tokensPerMinute?: number
  readonly outputTokensPerMinute?: number
}

interface ProviderCapability {
  readonly authSource: AuthSource
  readonly eligiblePhases: readonly AgentPhase[]   // AgentPhase from src/agents/schema.ts
  readonly costPerMTok?: ProviderCostPerMTok       // advisory; M13 may enforce
  readonly rateLimits?: ProviderRateLimits         // advisory; M13 may enforce
}
```

The shape is **strict-minimal**. Four traits the M11 ROADMAP row originally named (`editSemantics`, `shellSemantics`, `mcpSupport`, `sandboxProfile`) are deliberately *not* on this record. Load-bearing reason: v0.1's `tool_use` runtime is provider-uniform — the wrapper extracts tools from the persona response and applies them in-process (or via orchestrator-side patch application for `write`, or via subprocess for `execute`), regardless of provider. Encoding those traits as TS fields in M11 would mark orchestrator-owned behavior as provider-owned behavior and turn decorative slots into accidental enforcement hooks. Divergent runtime semantics land in W3+ when HTTP adapters arrive (opencode-style OAuth+PKCE for Codex; equivalent for Claude). Until then, those traits live as deferred contract territory in this section's prose; the TS shape stays focused on what is real today (auth source, eligibility) and what feeds future enforcement (advisory cost / rate-limits for M13).

### `authSource` — mechanism, not subscription

`authSource` records the **mechanism** the adapter uses to authenticate, not the user's subscription tier. Max / Plus / Pro are SKU labels outside the code-oz trust boundary and may rebrand. Claude Max users authenticate through `claude login`, which is the same mechanism a hypothetical Claude Pro user would use; both record `authSource: 'claude-cli-oauth'`. This contract does not encode subscription tier.

### Default eligibility (v0.1)

| ProviderId | `authSource` | `eligiblePhases` | Reason |
|---|---|---|---|
| `claude` | `'claude-cli-oauth'` | every value in `AGENT_PHASES` | live adapter |
| `codex` | `'chatgpt-cli-oauth'` | every value in `AGENT_PHASES` | live adapter |
| `gemini` | `'gemini-stub'` | `[]` (empty) | stub; runtime throws `provider_gemini_not_yet_supported` |
| `fake` | `'in-process-fake'` | every value in `AGENT_PHASES` | test runtime supports all |

"Eligible" means *the provider may run an agent for this phase*, not *the phase runtime exists*. SHIP and AUDIT are stubbed today; eligibility for them is a forward-compat statement, not a claim about implementation status. Per CLAUDE.md rule 9, the runtime stub is itself the actionable error if a stubbed phase is exercised — eligibility is the load-time gate, not a phase-runtime probe.

`gemini`'s empty list is the rule-20 teeth: a config that names `gemini` as the BUILD provider (or any other phase) fails at agent-load time with `loader_provider_phase_not_eligible`, before any run begins. Today that same misconfig fails later, at runtime CLI spawn (`provider_gemini_not_yet_supported`); M11 moves the failure to load time without changing the surface area of any other provider.

### Cost and rate-limit advisory data

`costPerMTok` and `rateLimits` are **advisory** in M11. Recorded for telemetry; consumed by M13 under the existing `budgets.global` namespace (rule 19 — no parallel namespace). M11 adds no enforcement; raising `budgets.global.maxTokensEstimate` already covers spend ceilings.

Concrete dollar / token values rot quickly. The defaults module (`src/providers/capabilities.ts`) carries dated source comments for every populated value (e.g., `// per CLAUDE.md model reference, 2026-04-30`). When verified data is unavailable, the field is omitted; this contract does not pretend to know current vendor pricing without a source.

### Authority — where capabilities live

`src/providers/capabilities.ts` is the single source of truth: a frozen `DEFAULT_CAPABILITY_BY_ID: Readonly<Record<ProviderId, ProviderCapability>>` table plus a pure `capabilityOf(id): ProviderCapability` function. Same architectural pattern as `src/providers/families.ts` (M9): the load-time loader (`src/agents/loader.ts`) imports `capabilityOf()` directly because no `ProviderRegistry` exists at load time; the runtime registry seeds from the same defaults and layers optional overrides on top.

`ProviderRegistry` gains:

- `capabilityOverrides?: Readonly<Partial<Record<ProviderId, ProviderCapability>>>` constructor field, paralleling `familyOverrides`. Test seam + W3+ seam (when HTTP adapters land with divergent capability records).
- `capabilityOf(id): ProviderCapability` instance method, seeded from `DEFAULT_CAPABILITY_BY_ID`, layered with overrides.
- An adapter cross-check at registration time: `adapter.capability` must equal the registry-resolved capability for `adapter.id` under **structural equality** (deep value comparison), mirroring the existing `family` cross-check that prevents misregistered-adapter laundering. Reference equality is brittle for composite objects.

Adapters declare their capability statically, by reading from `capabilityOf(this.id)`. The data does not duplicate across `capabilities.ts` and adapter source.

### Eligibility check (load time)

`src/agents/loader.ts` runs `enforceProviderPhaseEligibility(definitions)` in the existing load chain. For every loaded agent it asserts `capabilityOf(agent.provider).eligiblePhases.includes(agent.phase)`. The same check then walks any persona's `tool_use.debate.opposingProviders` and asserts each declared opposing provider is also eligible for the persona's phase — closing the M10 synthetic-debate-opponent path that would otherwise route a runtime-built `provider: opposing, phase: caller` agent past the load-time gate. Failures aggregate into the existing `AgentLoadError` issues array as `AgentLoadIssue { file, code: 'loader_provider_phase_not_eligible', rule, detail }`. The check runs after schema validation and before bootstrap returns.

`AgentLoadIssue` does **not** carry `actionableSuggestions` in v0.1. M11 does not extend the loader's error shape; the existing `rule` and `detail` fields carry the fix hint (e.g., `rule: "agent's provider is not eligible for the agent's phase"`, `detail: "agent file=src/agents/defaults/builder.md, provider=gemini, phase=build, eligible phases for gemini=[]"`). If a future milestone needs structured suggestions on loader issues, it adds the field deliberately, with its own contract decision.

### Doctor unchanged

`code-oz doctor providers` keeps the M4 contract intact. `health()` remains scoped to auth + model availability; no capability probe. M11 surfaces all eligibility failures at agent-load time, not preflight, not a `--probe` flag. The doctor's exit policy and side-effect-free discipline stay as defined in this document above.

### Forward-compat

- **M12 (company roster — closed 2026-05-01, `v0.12.0-alpha.0`)** introduced a config-side `company:` block mapping the six bundled-persona role names (`ba | lead | builder | verifier | reviewer | scientist`) to `{ provider?, model? }` overrides only. Per-role budgets defer to M13 under `budgets.global`; permissions stay persona-shaped. M12's load-time check reuses `capabilityOf(provider).eligiblePhases.includes(phase)` against the resolved phase, plus a post-override debate-family re-check. See `docs/contracts/COMPANY.md` for the canonical contract.
- **M13 (role-cost policy)** consumes `costPerMTok` and `rateLimits` advisory fields under existing `budgets.global` namespace.
- **M14 (reviewer panel v1)** may derive `phase → ProviderId[]` reverse maps on demand; M11 does not store the reverse direction.
- **PE-1 (xAI direct HTTP adapter)** adds the `xai-api-key` value to `AuthSource` and a `xai` row to `DEFAULT_CAPABILITY_BY_ID`. **No new field on `ProviderCapability`.** The trust-boundary expansion (outbound HTTPS, API-key transmission) lives in § "Auth model — subprocess delegation + API-key transmission (v0.1)" above, not in the capability record. The strict-minimal shape (`authSource` + `eligiblePhases` + advisory cost / rate-limit) is sufficient: doctor's `health()` already owns probe semantics, and `authSource` already names the mechanism. Adding a `transport` field at PE-1 would foreclose decisions M14 / M15 should make on their own evidence (Codex Decision D in `docs/research/CODEX_RESPONSE_XAI_EXPANSION.md`).
- **W3 HTTP adapters** introduce divergent `editSemantics` / `shellSemantics` / `mcpSupport` / `sandboxProfile` fields when the runtime stops being provider-uniform. The shape change lands at that milestone's contract.

### Anti-patterns rejected by this M11 spec

- **Calling `ProviderRegistry.capabilityOf()` from agent-load time.** The registry does not exist yet at load time; loader imports pure `capabilityOf()` from `src/providers/capabilities.ts`, mirroring `familyOf()`.
- **Smuggling `actionableSuggestions` into `AgentLoadIssue`.** Use `rule` and `detail`. Adding the field is a separate contract decision.
- **Reference equality on capability objects.** Composite `ProviderCapability` requires structural equality; the family check's primitive comparison does not generalize.
- **Storing a reverse `phase → ProviderId[]` map.** Derive on demand; a stored hybrid will drift and quietly serve M14 before M14 earns it.
- **Naming the eligibility field "role" or "eligibleRoles".** M11 has no roles; that vocabulary belongs to M12. The check is `(provider, phase)` only.
- **Encoding subscription tier (Max / Plus / Pro) in the `authSource` enum.** Mechanism only.
- **Adding `editSemantics` / `shellSemantics` / `mcpSupport` / `sandboxProfile` as v0.1 TS fields.** Decorative slots become accidental enforcement hooks; defer to W3 when divergent runtime semantics arrive.
- **Per-phase `sandboxProfile` overrides.** Forecloses M12 / M14 role policy; sandboxing in v0.1 is a fact of the upstream CLI invocation, not a per-role decision.

Designed in `docs/research/CODEX_BRIEFING_M11.md` and `docs/research/CODEX_RESPONSE_M11.md` (thread `019de44e-e8a7-7441-9d82-d79a0595f591`); locks in `docs/design/SESSION_M11_KICKOFF.md`.

## What this file is not

- **Not the M4 implementation plan.** See `docs/design/SESSION_M4_KICKOFF.md` and `docs/design/CODEX_RESPONSE_M4.md` for that.
- **Not a substitute for reading the upstream templates.** `pi-mono` shaped the streaming model; `Archon` shaped the stateless adapter discipline; `Auto-claude-code-research-in-sleep` shaped the cross-family review primitive. Read those for patterns; this file pins the contract for `code-oz`.
- **Not the marketplace contract.** Provider-pack distribution is W3+.
- **Not the Gemini integration design.** Gemini is a stub in v0.1. W3 may flip the adapter to a real implementation; this spec's `provider_gemini_not_yet_supported` code stays.
- **Not the company roster contract.** M11's eligibility check anchors on `phase`; M12's `company:` block lands the role → `{ provider?, model? }` mapping (per-role budgets defer to M13). See `docs/contracts/COMPANY.md` for the company-roster contract; role vocabulary belongs there, not in this provider-eligibility document.
