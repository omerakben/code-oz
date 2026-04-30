# Provider contract — canonical spec for code-oz

This document is the **pinned spec** for the `IAgentProvider` interface, the request DTO split, the wrapper layer, the `requestReview` cross-family primitive, and `code-oz doctor providers`. It locks the M4 surface that M5+ phase logic, M7's REVIEW orchestration, and W3+'s second-family adapter work plug into.

The upstream templates are influence; this file is the authority for `code-oz`. When upstream and this file disagree, this file wins for `code-oz` purposes.

## Provenance

- **Upstream influences:**
  - `~/Projects/agents/templates/pi-mono` — streaming `invoke()` event model; `IAgentProvider`-style multi-provider abstraction
  - `~/Projects/agents/templates/Archon` — function-like provider shape (stateless, each call self-contained)
  - `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — narrow cross-family REVIEW primitive (`requestReview`); broad `consult()` deliberately deferred to v0.3
- **No code dependency, no submodule, no copy-paste.** Patterns are borrowed; the implementation is `code-oz`.
- **Sync policy (subscription-first auth, locked in M4 commit 8 per [`docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`](../design/CODEX_RESPONSE_M4_ADAPTERS.md)):** v0.1 adapters delegate auth entirely to the upstream CLIs (`claude login`, `codex login`). code-oz NEVER reads or transmits OAuth tokens directly — `~/.claude/auth.json` and `~/.codex/auth.json` are not in our trust boundary. Health probes use the CLIs' own status surfaces (`claude --version`, `codex login status`). If upstream CLIs change their auth file format or token storage backend (some platforms use the OS credential store), `code-oz` is unaffected. The W3 milestone may add HTTP-based adapters with their own OAuth flows; until then, every provider call goes through the upstream CLI as a subprocess.

## Why this exists

M4 lands four surfaces that need a stable contract before M5+ depends on them:

1. **The interface** — `IAgentProvider` is the seam every adapter implements and every phase logic plugs into.
2. **The request DTO split** — `ProviderRequest` (paths only) is what phase code constructs; `PreparedProviderRequest` (content + manifest + metrics) is what the wrapper produces and adapters consume. The split is load-bearing for non-negotiable rule 13: phase code never loads file content; the wrapper is the only path that reads disk after permissions intersection.
3. **`ProviderFamily`** — cross-family REVIEW enforcement (rule 2) compares provider families, not provider IDs. In v0.1 every `ProviderId` maps to its same-named `ProviderFamily`; in W3+ when `claude-cli` and `anthropic-api` adapters land, both share `family: 'claude'` and REVIEW correctly rejects them as same-family. Locking the type now avoids a refactor later.
4. **`ProviderError` + the `NEEDS_INTERVENTION → intervention` event sequence** — every provider failure becomes a typed error with `{ code, rule, detail?, actionableSuggestions: string[] }`. The wrapper catches and writes both the gate file (`NEEDS_INTERVENTION.json`) and the matching `intervention` event under a short post-call lock. Adapters never write either.

## The interface

```ts
type ProviderId = 'claude' | 'codex' | 'gemini' | 'fake'
type ProviderFamily = 'claude' | 'codex' | 'gemini' | 'fake'   // == ProviderId in v0.1

interface IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent>
  health(): Promise<ProviderHealth>
}
```

Adapters are stateless. Every `invoke()` call spawns the upstream CLI fresh (subscription-first via `claude login` / `codex login`) or, for `FakeProvider`, walks its scripted expectation queue. No shared mutable state across calls; no in-memory token caching. The Archon discipline.

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

## Auth model — subprocess delegation (v0.1)

The v0.1 adapters delegate auth entirely to the upstream CLIs. code-oz never reads, parses, or transmits an OAuth token, and never knows what platform-specific storage backend (auth.json file, OS credential store, etc.) the CLI uses.

- **`ClaudeProvider`** spawns `claude --print --output-format json --no-session-persistence` from an empty `mkdtemp()` working directory, with manifest content piped through stdin. Auth is whatever `claude login` set up. Health probe is `claude --version` (ENOENT → `'missing'`; non-zero exit → `'unknown'`; zero exit → `'ok'`). The empty temp cwd is a privacy guard — Claude Code auto-discovers `CLAUDE.md` files up the working-directory hierarchy at session start, so an inherited project cwd would expand the trust surface beyond the explicit manifest.
- **`CodexProvider`** spawns `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -` (read prompt from stdin) from an empty `mkdtemp()` working directory. Auth is whatever `codex login` set up. Health probe is `codex login status` (parses `'logged in'` substring on either stdout or stderr — codex CLI 0.125 writes to stderr — to set `'ok'`; ENOENT → `'missing'`; otherwise → `'unknown'`).
- **`GeminiProvider`** does not spawn anything. `invoke()` throws `provider_gemini_not_yet_supported`; `health()` returns `authStatus: 'unsupported'`. Real Gemini lands in W3+.
- **`FakeProvider`** never spawns. Tests register expectations against the in-process adapter.

Adapters expose two test-injection seams that never touch the real filesystem in the default suite:

- **`runner`** — a `(cmd, args, options) => Promise<{stdout, stderr, exitCode}>` function. Default uses `Bun.spawn`; tests inject mocks that return canned subprocess results.
- **`tempCwd`** — a `() => Promise<string>` factory that returns the working directory passed to the runner. Default creates a fresh `mkdtemp()`; tests can inspect or replace.

Failure mapping for non-zero CLI exits:

- ENOENT during spawn → `provider_io_error` with rule `"<provider> CLI not found in PATH"`.
- Non-zero exit + auth-keyword stderr (`"not logged in"`, `"please log in"`, `"login required"`) → `provider_auth_missing` with `actionableSuggestions: ["run \`<provider> login\`"]`.
- Non-zero exit otherwise → `provider_io_error` with the CLI's stderr in `detail`.

The W3 upgrade path replaces the subprocess with a direct HTTP adapter (e.g., opencode-style OAuth+PKCE → `chatgpt.com/backend-api/codex/responses` for Codex; equivalent if/when Anthropic ships subscription HTTP auth for Claude Max). The `IAgentProvider` contract is unchanged; only adapter internals swap. Wrappers (`src/providers/invoke.ts`) and tools (`src/tools/review-request.ts`) keep working without modification.

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

## What this file is not

- **Not the M4 implementation plan.** See `docs/design/SESSION_M4_KICKOFF.md` and `docs/design/CODEX_RESPONSE_M4.md` for that.
- **Not a substitute for reading the upstream templates.** `pi-mono` shaped the streaming model; `Archon` shaped the stateless adapter discipline; `Auto-claude-code-research-in-sleep` shaped the cross-family review primitive. Read those for patterns; this file pins the contract for `code-oz`.
- **Not the marketplace contract.** Provider-pack distribution is W3+.
- **Not the Gemini integration design.** Gemini is a stub in v0.1. W3 may flip the adapter to a real implementation; this spec's `provider_gemini_not_yet_supported` code stays.
