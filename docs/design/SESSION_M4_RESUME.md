# code-oz — M4 mid-milestone resume

This doc orients **both** (1) the next Claude session that continues M4 implementation from commit 7 and (2) the Codex review round that fires after commit 10. It is short and load-bearing — read in addition to (not instead of) `CLAUDE.md`, `SESSION_CYCLE.md`, `SESSION_M4_KICKOFF.md`, `CODEX_BRIEFING_M4.md`, and `CODEX_RESPONSE_M4.md`.

The locked plan from `CODEX_RESPONSE_M4.md` is in flight on `feat/m4-providers`. Six of ten commits have landed; four remain. This doc tells you exactly where to continue and the per-commit specs for 7-10, distilled from the full Codex synthesis so you don't re-read 700 lines to find the next concrete step.

## Boot prompt — paste-ready

A new Claude Code session inside `~/Projects/code-oz/` boots cleanly with this prompt:

```
Read CLAUDE.md, docs/design/SESSION_CYCLE.md, docs/design/SESSION_M4_KICKOFF.md
(including the cross-cutting addendum), docs/design/CODEX_RESPONSE_M4.md (synthesis +
locked 10-commit order), and docs/design/SESSION_M4_RESUME.md (per-commit specs for the
remaining work). Branch feat/m4-providers is at commit 6 of 10. Continue with commit 7
(feat(providers): add invoke wrapper) per the spec in SESSION_M4_RESUME.md. Run bun test
and bun run typecheck clean before each commit; do not push without explicit user
approval; do not amend commits.
```

## State at handoff (2026-04-29)

- **Branch:** `feat/m4-providers` cut from `main` after two pre-implementation docs commits (`docs(session-cycle): ...` + `docs(m4): codex planning round ...`).
- **Tip:** `27b9fb4 feat(providers): add manifest + permissions builder + preview`
- **Tests:** 325 passing, offline, ~600ms.
- **Typecheck:** `bun run typecheck` clean.
- **Working tree:** clean.

## Six landed commits — what each one shipped

| # | Commit | Adds |
|---|---|---|
| 1 | `docs(spec): pin provider and event metric contracts for M4` | `docs/references/file-based-gates.md` § 5 + § 12 + § 13 amendments; `docs/references/provider-contract.md` (new pinned spec). |
| 2 | `feat(state): widen event schema for M4 provider telemetry` | Required `manifest` + four metric fields (`filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`) on `agent_invoked`; opens `EVENT_TYPES` allow-list (rule 12 — `LoggedEvent = PhaseEvent \| UnknownPhaseEvent`, `isKnownPhaseEvent` predicate); `readEvents` returns `LoggedEvent[]`; reducer + recovery filter through the predicate. |
| 3 | `feat(config): add provider budget config loading` | `maxToolCallsPerTurn` + optional `toolCallBudgetMultiplier` on `Budgets.global`; `loadConfig({ cwd, configPath })` in `src/config/load.ts` with hand-rolled validation, deep-merge over `DEFAULT_CONFIG`, typed `ConfigLoadError`. `DEFAULT_CONFIG.version` bumped to `0.4.0-alpha.0`. |
| 4 | `feat(providers): add core types, errors, and registry` | `src/providers/{types,errors,registry}.ts`. `IAgentProvider`, `ProviderRequest` paths-only, `PreparedProviderRequest` content+manifest+metrics, `ProviderFamily`, `ProviderError` issue-array. `ProviderRegistry` with `familyOf()` as the cross-family authority. |
| 5 | `feat(providers): add deterministic FakeProvider` | `src/providers/fake.ts` with scripted `expect({...}).respondWith({...})` / `.fail({...})`, FIFO queue, most-specific-match-wins, strict mode, `collectProviderResponse(stream)` test helper. |
| 6 | `feat(providers): add manifest + permissions builder + preview` | `src/providers/manifest.ts` (`buildManifest` — path safety mirroring gates, permission intersection with glob support, sha256 + size + four metrics, first-violation-wins), `src/providers/cost.ts` (`estimateTokens` ~4 chars/token upper bound), `src/providers/preview.ts` (pure `previewProviderRequest`). |

## Four remaining commits — the spec

The locked synthesis is in `docs/design/CODEX_RESPONSE_M4.md`. The per-commit work below is the implementation contract distilled from it. Do not re-debate the design — the synthesis is approved.

### Commit 7 — `feat(providers): add invoke wrapper`

Files:
- `src/providers/invoke.ts` (the wrapper entrypoint)
- `tests/providers-invoke.test.ts`
- `tests/providers-cost.test.ts` (if not already covered by manifest tests)

Surface:

```ts
export interface InvokeContext {
  readonly registry: ProviderRegistry
  readonly runPaths: RunPaths        // from src/state/run.ts
  readonly config: CodeOzConfig      // from src/config/schema.ts
}

export async function* invokeAgent(
  ctx: InvokeContext,
  req: ProviderRequest,
): AsyncIterable<ProviderEvent>
```

Behavior in this exact order:

1. **Build manifest** via `buildManifest(req, { projectRoot })` (commit 6). Throws on permissions violation or path safety. Project root comes from `ctx.runPaths` or a sibling field — likely the parent of `runPaths.runDir`'s grandparent or pass it explicitly via `InvokeContext.projectRoot`. Add the field if needed; update `buildManifest` callers.
2. **Pre-call short lock** (`withLock(ctx.runPaths.lockDir, async () => { ... })` from `src/state/lock.ts`):
   - `await readEvents(eventPathsFor(ctx.runPaths))` — get current totals.
   - `assertWithinBudget(ctx.config, req, prepared, events)` — sum per-phase `agent_invoked.tokensEstimate` + `agent_completed.tokensUsed` for `req.phase`; sum global the same way; count `phase_entered` for `req.phase` against `maxTurns`; count `agent_invoked` for `req.phase` against `maxProviderCalls`. Compare next-call estimate against `config.budgets.perPhase[req.phase].maxTokensEstimate` and `config.budgets.global.maxTokensEstimate`. On breach: throw `providerError('provider_budget_exceeded', ...)`.
   - `await appendEvent(eventPaths, agentInvokedEvent, { skipLock: true })` where `agentInvokedEvent` has `manifest`, `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope` from `prepared.manifest` + `prepared.metrics`.
3. **Lock released. Stream from adapter:**
   - `adapter = ctx.registry.get(req.agent.provider as ProviderId)`
   - `let toolCalls = 0; const cap = Math.floor(ctx.config.budgets.global.maxToolCallsPerTurn * (ctx.config.budgets.global.toolCallBudgetMultiplier ?? 1))` (note: when the user explicitly sets `toolCallBudgetMultiplier: undefined`, default to 1, not 1.5 — but with the schema's optional default of 1.5, the practical default is 1.5. Use `?? 1` only when the value is genuinely absent at runtime; the schema's `DEFAULT_CONFIG.budgets.global.toolCallBudgetMultiplier = 1.5` keeps the default at 1.5).
   - For each event from `adapter.invoke(prepared)`:
     - If `event.type === 'tool_call'` and `++toolCalls > cap`: throw `providerError('provider_tool_call_cap_exceeded', ...)`.
     - If `event.type === 'turn_completed'`: capture `tokensUsed` from `event.response.tokensUsed` (only when present — never post-count from chunks).
     - `yield event`.
4. **Post-call short lock (success path):**
   - `await appendEvent(eventPaths, agentCompletedEvent, { skipLock: true })` — `tokensUsed` only when adapter reported it.
5. **Error path:** wrap the adapter loop in `try { ... } catch (err) { ... }`. If `err instanceof ProviderError`:
   - Acquire post-call short lock.
   - `writeNeedsInterventionGate({ paths: gatePaths, gate: { version: 1, runId, phase, agent, code, rule, detail?, actionableSuggestions, createdAt } })` — use `err.issues[0]` for the gate fields (multi-issue ProviderError takes first issue's fields; the rest go in detail or are summarized).
   - `await appendEvent(eventPaths, interventionEvent, { skipLock: true })` with `code: err.issues[0].code, phase: req.phase`.
   - Re-throw the `ProviderError` so the caller knows.
   - For non-`ProviderError` exceptions: don't catch; let them propagate (those are bugs, not provider failures).

Notes:
- Generator function (`async function*`). The `yield event` inside the for-await loop is correct Bun/Node behavior.
- `withLock` returns a `Promise<T>`. Two separate `await withLock(...)` calls produce the two short locks.
- `gateFilename` from `src/state/gates.ts` for control gates is hard-coded inside the gate writers — `writeNeedsInterventionGate` already handles the filename.
- Lock acquisition for the gate writer: pass `skipLock: true` to keep the wrapper holding the single lock for the gate-write + intervention append. Same M3 layering pattern as `approveGate` in `run.ts`.
- The wrapper is the ONLY emitter of `agent_invoked`, `agent_completed`, and `intervention` events. Adapters never emit them.

Tests:
- Happy path: scripted FakeProvider returns content; assert `agent_invoked` + `agent_completed` events appear in the log with correct manifest + metrics.
- Budget refusal: pre-load `events.jsonl` with high `agent_completed.tokensUsed` for the same phase; assert `provider_budget_exceeded` + `NEEDS_INTERVENTION.json` written + `intervention` event appended.
- Tool-call cap: FakeProvider scripts a stream with N `tool_call` events where N > cap; assert `provider_tool_call_cap_exceeded`.
- Permission violation: file outside `permissions.read`; assert thrown without any event written (the failure is in `buildManifest` before the wrapper acquires the lock).
- `tokensUsed` provenance: scripted response without `tokensUsed`; assert `agent_completed` event omits the field (M3 schema accepts the absence).

### Commit 8 — `feat(providers): add Claude, Codex, and Gemini adapters`

Files:
- `src/providers/claude.ts`
- `src/providers/codex.ts`
- `src/providers/gemini.ts`
- `tests/providers-claude.test.ts`
- `tests/providers-codex.test.ts`
- `tests/providers-gemini.test.ts`
- `tests/fixtures/auth/{claude.valid.json, claude.expired.json, codex.valid.json}` (mocked auth file fixtures)
- Update `src/cli/bootstrap.ts` to add `getProviderRegistry()` (the keepalive that survives tree-shake)

Open question for the next session — the upstream-SDK choice for the live path:

The contract per `docs/references/provider-contract.md`:
- `ClaudeProvider` reads `authPath ?? ~/.claude/auth.json`
- `CodexProvider` reads `authPath ?? ~/.codex/auth.json`
- Adapters must classify unreadable / missing / parse-failed shapes as `provider_auth_missing` and shapes that parse but indicate token expiry as `provider_auth_expired`
- Default tests must NOT touch real `~/.claude` or `~/.codex` and must NOT make network calls
- Live-provider tests are opt-in (gated behind an env flag)

For `claude.ts`, the natural choice is `@anthropic-ai/sdk` (the official package). Add it to `package.json` deps if not present. The `invoke()` body wraps `client.messages.create({ stream: true })` and translates SDK chunks into `ProviderEvent` stream.

For `codex.ts`, the upstream surface is less defined publicly. Pragmatic options:
- **Option A:** Spawn the `codex` CLI as a subprocess (since that's how the user already invokes Codex in this harness). Auth is whatever `codex login` set up. The adapter pipes through stdout/stderr.
- **Option B:** Use OpenAI's official SDK pointed at OpenAI Codex's actual API endpoint, if one is public.
- **Option C (deferred):** Land `codex.ts` as a stub that reads auth + reports health, but `invoke()` throws `provider_codex_not_yet_supported` until W3. This matches the Gemini stub pattern and avoids upstream-SDK uncertainty.

**Recommend Option C for v0.1.** Codex is actively used as a *reviewer* in the M4 acceptance test (cross-family REVIEW: builder=claude + reviewer=codex). But "reviewer" in v0.1 means *the runtime can route to a Codex adapter without crashing* — actually executing the API call against Codex is W3+ scope per the ROADMAP. The M4 test fixture for `requestReview` (commit 9) needs `CodexProvider` to register in the registry with the right `family: 'codex'` and survive `health()`. It does NOT need `invoke()` to actually work in v0.1 — that's why the M5-M7 spine uses FakeProvider for the cross-family review path.

Add a new error code `provider_codex_not_yet_supported` to the `ProviderErrorCode` union if going with Option C. Document the choice in `docs/references/provider-contract.md`'s anti-patterns rejection list as "real Codex SDK invocation deferred to W3."

For `gemini.ts`, the spec is explicit: throws `provider_gemini_not_yet_supported`, `health()` returns `authStatus: 'unsupported'`. No auth read.

For each real adapter:
- Constructor: optional `{ authPath?: string; homeDir?: string }`. Default `homeDir` = `process.env.HOME ?? ''`.
- `readAuth()` (private): tries `authPath ?? join(homeDir, '.${id}/auth.json')`. ENOENT → `provider_auth_missing`. JSON parse failure → `provider_auth_missing`. Parses but no token / token expired → `provider_auth_expired`. Otherwise → returns `{ token, expiresAt? }`.
- `invoke()`: call `readAuth()` first. If error: throw it. Otherwise: call SDK / spawn subprocess / throw `not_yet_supported`.
- `health()`: call `readAuth()`, return `authStatus` accordingly. Don't write events or gates (rule).

Tests use `tests/fixtures/auth/` and pass `authPath` via the constructor option. Default test suite never reads real `~/.claude` or `~/.codex`.

`getProviderRegistry()` in `src/cli/bootstrap.ts`:

```ts
export function getProviderRegistry(opts: BootstrapOptions = {}): ProviderRegistry {
  return new ProviderRegistry({
    providers: [
      new FakeProvider(),
      new ClaudeProvider({ homeDir: opts.homeDir }),
      new CodexProvider({ homeDir: opts.homeDir }),
      new GeminiProvider(),
    ],
  })
}
```

The mere act of importing all four adapter modules in this file keeps them alive in the compiled binary.

### Commit 9 — `feat(tools): add requestReview primitive`

Files:
- `src/tools/review-request.ts`
- `tests/tools-review-request.test.ts`

Surface:

```ts
export interface ReviewRequest {
  readonly buildProvider: ProviderId       // explicit, not inferred from event log
  readonly reviewer: AgentDefinition
  readonly files: readonly ProviderFileRef[]
  readonly question: string
  readonly runId: string
  readonly phase: 'review'                 // ALWAYS review
}

export async function* requestReview(
  ctx: InvokeContext,
  req: ReviewRequest,
): AsyncIterable<ProviderEvent>
```

Behavior:
1. `if (ctx.registry.familyOf(req.buildProvider) === ctx.registry.familyOf(req.reviewer.provider as ProviderId))`: throw `providerError('provider_permissions_violation', 'REVIEW provider must differ from BUILD provider family', [...])`.
2. Otherwise: construct a `ProviderRequest` from `{ agent: req.reviewer, phase: 'review', runId: req.runId, prompt: req.question, files: req.files }` and call `invokeAgent(ctx, providerRequest)`.

The cross-family check uses `registry.familyOf()` — never direct ProviderId comparison. `buildProvider` is passed explicitly by REVIEW orchestration (M5+) and never inferred from the event log.

Tests:
- builder=claude + reviewer.provider=claude: rejects with `provider_permissions_violation` before any invocation.
- builder=claude + reviewer.provider=codex: passes the family check, proceeds to invokeAgent.
- builder=fake + reviewer.provider=fake: rejects (same-family).
- builder=fake + reviewer.provider=claude: passes.

### Commit 10 — `feat(commands): doctor providers + version bump`

Files:
- `src/commands/doctor.ts` (currently a stub; M4 makes it real)
- Update `src/cli.ts`: bump `PKG_VERSION` to `'0.4.0-alpha.0'`; update help text for `doctor`.
- `docs/contracts/PROVIDERS.md` (user-facing summary linking back to `docs/references/provider-contract.md`).
- `tests/commands-doctor.test.ts`
- Binary smoke test: rebuild and confirm `code-oz --version` reports `0.4.0-alpha.0` and `code-oz doctor providers` exits cleanly.

`doctor providers` behavior:
1. `bootstrap()` — load agent registry + provider registry.
2. For each provider in `getProviderRegistry().all()`: `await provider.health()`. Aggregate into `ProviderHealth[]`. Never crash on a single failed probe — wrap each in `try / catch` and store the error in `lastError`.
3. Output:
   - Default: human-readable table (`provider | authStatus | modelDefaultAvailable | latencyMs | lastError`).
   - `--json`: emit the `ProviderHealth[]` as a JSON document.
4. Exit policy:
   - Determine the set of *required* providers: every distinct `provider` declared by an agent in the agent registry.
   - Compute health for every adapter in the provider registry.
   - For each *required* provider: success = `authStatus === 'ok'`. (Anything else, including `'missing'`, `'expired'`, `'unsupported'`, `'unknown'`, fails.)
   - For non-required providers (e.g., Gemini when no agent declares it): `'unsupported'` is success-by-design; ignored.
   - Exit 0 when every required provider succeeds; exit 1 otherwise.

`PROVIDERS.md` is a short user-facing summary: how to authenticate Claude/Codex, how to interpret `doctor providers` output, where the canonical contract lives (`docs/references/provider-contract.md`). Two pages max.

Binary smoke test:
- `bun run build:binary` produces `dist/code-oz`.
- `dist/code-oz --version` reports `0.4.0-alpha.0`.
- `dist/code-oz doctor providers --json` returns valid JSON (exit code may be 1 in a sandbox without auth — that's expected).

## Codex review round (after commit 10)

Per `CLAUDE.md` rule 8 and `SESSION_CYCLE.md` phase 4. Mandatory.

1. Once tests pass and typecheck is clean and all base commits are landed, invoke Codex review:

```
mcp__plugin_agent-codex_codex-native__codex(
  model: 'gpt-5.5',
  config: { model_reasoning_effort: 'xhigh' },
  sandbox: 'read-only',
  approval-policy: 'never',
  cwd: '/Users/ozzy-mac/Projects/code-oz',
  prompt: 'Review the new commits on feat/m4-providers (commits between main and HEAD).
           Goals: validate cross-family enforcement, NEEDS_INTERVENTION + intervention
           event sequence, manifest path safety, lock boundaries (no holding across
           network), permission intersection. Read docs/references/provider-contract.md
           and docs/design/CODEX_RESPONSE_M4.md for the locked contract. Verdict: push /
           fix-first / debate-required. Use the same four-section format as
           CODEX_REVIEW_M3.md. Be specific about file:line on findings.'
)
```

2. Save reply as `docs/design/CODEX_REVIEW_M4.md` with provenance header (model, effort, sandbox, date, thread id, commits reviewed).

3. **No-tech-debt rule (CLAUDE.md rule 8 + `~/.claude/projects/.../memory/feedback_no_tech_debt.md`):** every `block-push` AND `block-next-milestone` finding gets addressed in the same milestone before tag, never deferred. Only `nit` and `fyi` severity findings can defer without explicit approval.

4. Fix commits are NEW commits (never `--amend`). Re-invoke review on the fix commits until clean.

## Tag and push (after explicit Ozzy approval only)

Per `SESSION_CYCLE.md` phase 5. Never run without an explicit "yes, push" from Ozzy in chat.

1. Merge `feat/m4-providers` → `main` with `--no-ff`.
2. Tag `v0.4.0-alpha.0` with annotated message + Codex audit-trail link.
3. Push `main` and the tag.
4. `gh release create v0.4.0-alpha.0` with milestone-themed release notes.

## Handoff: write SESSION_M5_KICKOFF.md

Per `SESSION_CYCLE.md` phase 6. The session that ships M4 writes `docs/design/SESSION_M5_KICKOFF.md` before ending. It must include:

- State at start (what shipped in M4: provider contract + 4 adapters + wrapper + requestReview + doctor)
- What's stubbed (no DEFINE phase logic, no PLAN parser, no worktrees, real Codex adapter deferred to W3)
- Template references for M5 (DEFINE phase): `agent-skills` (BA persona patterns), `Auto-claude-code` (ask-me flow shape)
- Deep-dive table (pre-extracted)
- M5 task description (DEFINE phase implementation; ask-me flow; SPEC.md contract)
- Open design questions (lean + reasoning + counter)
- Cross-model peer review pointer to `SESSION_CYCLE.md`
- Don't list
- First commands
- Loose threads from M4

Cross-cutting addenda from M4 to flag in M5's kickoff:
- The short-lock pattern (pre-call lock + adapter unlocked stream + post-call lock) is the canonical wrapper-layer discipline. M5+ phase logic should mirror this in any code that talks to providers.
- Conservative token estimator (`src/providers/cost.ts`) is the single shared estimator. Per-provider overrides are W3+.
- `ProviderFamily` is the cross-family authority; never compare `ProviderId` directly.
- `agent_invoked` events ALWAYS carry the four metrics; M5+ phase logic that constructs ProviderRequests must respect this (the wrapper enforces it; phase code just passes paths-only).
- Codex remains a stub-or-CLI-spawn in v0.1 — the M5 spine should default to FakeProvider for offline tests and only invoke real Claude when explicitly opted in.

## Loose threads to remember

- The `ConfigLoadError` class exists in `src/config/load.ts` but isn't exported from a top-level barrel — M5+ commands that load config will need to import it directly. Consider a `src/config/index.ts` re-export if more callers emerge.
- `DEFAULT_CONFIG.version` is `'0.4.0-alpha.0'` (commit 3) but the binary `PKG_VERSION` in `src/cli.ts` is still `'0.3.0-alpha.0'` until commit 10. Don't confuse them — the config version is the schema version, the CLI version is the binary version.
- The `LoggedEvent`/`PhaseEvent` distinction is M4-new. Code reading `events.jsonl` should use `LoggedEvent`; code emitting events should use `PhaseEvent`. The `isKnownPhaseEvent` predicate bridges them. Reducer + recovery code already filters via the predicate.
- The `EVENT_TYPES` array still exists for the validator to identify known types; adding a new type later requires updating BOTH the array AND the `PhaseEvent` union (one schema bump per new type for write-side strictness).
- Path safety in `src/providers/manifest.ts` mirrors `src/state/gates.ts:validateArtifactSyncPath` + `resolveArtifactPath`. If those evolve, M4's manifest builder should track them — there's no shared helper yet (could be one in M5 if both modules need to evolve together).
- The Codex MCP server is configured in this harness — `mcp__plugin_agent-codex_codex-native__codex` invokes it. The Codex review round (after commit 10) uses this same MCP tool. Don't confuse with a future "real" `CodexProvider` adapter that calls Codex's API directly.

## Authority

This doc tells you *where to continue and what to build next*. It does not override:
- `CLAUDE.md` (project rules; non-negotiable)
- `SESSION_CYCLE.md` (the cycle itself)
- `SESSION_M4_KICKOFF.md` + its addendum (locked decisions)
- `CODEX_RESPONSE_M4.md` (the synthesis; verdict and locked 10-commit order)

If any of those conflicts with this doc, those win. This doc is a working aid, not a contract.
