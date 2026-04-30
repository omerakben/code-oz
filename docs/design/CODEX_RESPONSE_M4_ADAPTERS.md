# code-oz — M4 commit-8 adapter shape (Codex sub-consultation)

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddb8d-f50c-7171-bf1c-d4af51bb64e0`
- **Trigger:** Ozzy's subscription-first preference override on commit 8 of M4 — the locked synthesis in [`CODEX_RESPONSE_M4.md`](./CODEX_RESPONSE_M4.md) said `claude.ts` would use `@anthropic-ai/sdk` and left the `codex.ts` choice open (the resume doc recommended Option C: stub deferred to W3). The new constraint: every adapter must use the user's existing CLI subscription tokens (Claude Max, ChatGPT Plus/Pro, Google AI Pro), never a separately-billed API key.

This doc is a tactical sub-consultation within M4 — not a milestone re-plan. The 10-commit order from `CODEX_RESPONSE_M4.md` stays intact; this only refines what commit 8 actually ships.

Verbatim reply below.

---

## Where I agree

Option B is dead. As of April 29, 2026, the public OpenAI API uses API keys for HTTP Bearer auth, not ChatGPT subscription OAuth tokens. ChatGPT Plus docs also state API usage is separate and billed independently, and Codex auth docs separate "Sign in with ChatGPT for subscription access" from "API key for usage-based access." A public Codex model endpoint exists, but it is API-priced and API-key authenticated. code-oz should not read `~/.codex/auth.json` and replay that token against public API endpoints.

`codex exec` is the subscription-first integration surface. Current official Codex docs say normal `codex exec` streams progress to stderr and prints only the final agent message to stdout. With `--json`, stdout becomes JSONL events, not SSE. Event types include `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`. Local CLI help for `codex-cli 0.125.0` matches this: `--json` prints events to stdout as JSONL.

The wrapper boundary already supports A_lite. [src/providers/invoke.ts](../../src/providers/invoke.ts) releases the run lock before adapter streaming, counts only explicit `tool_call` events, and writes `agent_completed` later. A Codex adapter that emits `turn_started -> content_chunk -> turn_completed` fits that contract cleanly.

## Where I disagree

I disagree with shipping Option C under the new owner constraint. [SESSION_M4_RESUME.md](./SESSION_M4_RESUME.md) recommended C because commit 9 can prove registry-level cross-family routing without real Codex execution. That was defensible before the subscription-first override. With the product position now being "orchestrates the user's existing paid CLI subscriptions," a Codex stub makes the v0.1 promise materially weaker unless the product is explicitly described as Claude-only live execution.

I also disagree with making `CodexProvider` health depend on directly parsing `~/.codex/auth.json`. Official Codex auth docs say credentials may live in `~/.codex/auth.json` or the OS credential store, and ChatGPT tokens refresh during CLI use. For the CLI-backed path, health should use `codex login status` through an injected runner. Locally, that reports `Logged in using ChatGPT`. Do not inspect or transmit the token.

I would not do full Option A. The JSONL stream is documented, but it is a broad Codex trajectory stream with agent messages, reasoning, commands, file changes, MCP calls, web searches, and plan updates. Mapping that into code-oz `ProviderToolCall` semantics in commit 8 is unnecessary risk. Buffer the final answer.

## What's missing

A_lite must preserve code-oz privacy rules. Do not run `codex exec -C <projectRoot>` and let Codex inspect the whole repo. That would bypass the explicit manifest discipline in [provider-contract.md](../references/provider-contract.md). Instead, render the already-prepared manifest content into stdin and run Codex from an empty temp working directory, with `--skip-git-repo-check`, `--ephemeral`, `--color never`, and `--sandbox read-only`.

Commit 8 should ship these concrete changes:

- `src/providers/codex.ts`: CLI-backed buffered provider. It accepts an injected runner, defaults to `Bun.spawn`, calls `codex login status` for health, calls `codex exec ... -` for invoke, buffers stdout, maps it to one `content_chunk` and one `turn_completed`.
- `src/providers/claude.ts`: should be rechecked against the same subscription-first rule. If `@anthropic-ai/sdk` requires a separately billed API key, that is the Claude version of Option B.
- `src/providers/gemini.ts`: keep the unsupported stub.
- `src/providers/errors.ts`: either reuse `provider_io_error` for missing CLI and nonzero subprocess failures, or add a specific auth-method error if API-key login must be rejected. Current codes are listed at [errors.ts](../../src/providers/errors.ts).
- `src/cli/bootstrap.ts`: add `getProviderRegistry()` with Fake, Claude, Codex, Gemini keepalive imports, as planned in [SESSION_M4_RESUME.md](./SESSION_M4_RESUME.md).
- `tests/providers-codex.test.ts`: mock the runner. Cover ChatGPT login status ok, missing CLI, nonzero auth failure, successful buffered invoke, malformed empty stdout, and "does not touch real ~/.codex."

For commit 9, "builder=claude + reviewer=codex must succeed" should mean the family check passes and `invokeAgent` is reached. [SESSION_M4_RESUME.md](./SESSION_M4_RESUME.md) already phrases it that way. Option C only suffices if the test spies before real invocation or swaps in a fake Codex-family provider. A_lite lets the test proceed through the Codex adapter with a mocked subprocess, which is a stronger acceptance signal without network.

## Verdict

Recommend A_lite. It is the only option here that respects subscription-first, ships real Codex execution in v0.1, and keeps default tests offline if subprocess execution is injected. Use buffered stdout, not full JSONL event mapping. Document the limitations clearly: no Codex tool-call events, no token usage provenance from Codex, and no real streaming UX for Codex in v0.1.

Sources checked: OpenAI API auth docs, Codex auth docs, Codex non-interactive docs, ChatGPT Plus billing docs, GPT-5.3-Codex API model docs.

**A_lite**

---

## Claude synthesis (post-debate)

Per CLAUDE.md rule 9 (Codex's verdict is data, not authority): each finding judged below. Net result: Codex's verdict adopted in full plus the privacy refinement and the parallel scrutiny on Claude. Two design impacts go beyond the original commit-8 spec and one materially changes the resume-doc recommendation.

### Adopted from Codex

1. **A_lite for Codex.** Buffered single-shot subprocess via `codex exec --json` (or whichever flag the installed codex CLI version exposes for non-interactive single-shot output). Adapter emits one `content_chunk` (the buffered final answer) and one `turn_completed`. No tool-call events from Codex in v0.1; no token-usage provenance; no streaming UX through code-oz (codex's own stderr streaming is its own concern). Documented as a v0.1 limitation in `provider-contract.md`.

2. **Privacy guards on subprocess invocation.** Hard requirements per rule 13 (privacy by default; explicit file manifests):
   - Run from an empty temp working directory, NOT `<projectRoot>` — closes the "Codex inspects the whole repo" hole.
   - Pass manifest content via stdin, NOT via file paths or `-C` flags.
   - Pass `--skip-git-repo-check --color never --sandbox read-only` (and `--ephemeral` if available on the installed CLI version) so Codex can't accidentally read or modify anything outside the explicit manifest.

3. **Health via `codex login status`, NOT auth-file parsing.** Codex's own subscription auth refreshes during CLI use and may live in the OS credential store on some platforms. The CLI's `login status` is the canonical health probe. Adapter never reads or transmits the OAuth token directly. Health output parsing is the runner's job (mockable in tests).

4. **Same subscription-first scrutiny on Claude.** This is the consequential pivot. The original synthesis in `CODEX_RESPONSE_M4.md` had `claude.ts` use `@anthropic-ai/sdk`. But `@anthropic-ai/sdk` is the public Anthropic API and requires a separately-billed `ANTHROPIC_API_KEY` — the Claude Max subscription auth at `~/.claude/auth.json` is bound to claude.ai / Claude Code / Cowork surfaces, not the public API. Using the SDK = Option B for Claude. Subscription-first says: spawn the `claude` CLI as a subprocess (`claude --print` or equivalent non-interactive mode), same A_lite shape as Codex. Auth is whatever `claude login` set up; code-oz never reads or transmits the OAuth token directly.

5. **Test infrastructure: injected runner.** Adapters take an optional `runner` constructor option; default is a thin wrapper around `Bun.spawn`. Tests pass a mock runner that returns scripted stdout/stderr/exitCode triples. No real subprocess execution in the default test suite; no real `~/.claude` or `~/.codex` reads. Live-CLI tests are opt-in via env flag (matches the kickoff's offline-test discipline).

6. **commit 9 acceptance criterion strengthens.** With A_lite for both Codex and Claude, the cross-family REVIEW test (`builder=claude + reviewer=codex must succeed`) actually executes through the real Codex adapter (with a mocked runner), not just a registry-level family check. That's a stronger v0.1 acceptance signal.

### Where I push back on Codex

None. Codex's analysis is sound and the privacy point about `-C <projectRoot>` was a real gap I missed in the original briefing. The subscription-first override does change the calculus on Option C — shipping a stub for Codex while shipping a working Claude adapter would create asymmetry that contradicts the v0.1 product positioning.

### Locked changes to commit 8

The 10-commit order from `CODEX_RESPONSE_M4.md` stays intact. Commit 8's internal shape changes:

| File | Original spec (resume doc) | Locked spec (this synthesis) |
|---|---|---|
| `src/providers/claude.ts` | `@anthropic-ai/sdk` with OAuth file | Subprocess via `claude` CLI (A_lite shape, injected runner, mocked in tests) |
| `src/providers/codex.ts` | Option C: stub `provider_codex_not_yet_supported` | A_lite via `codex exec` subprocess (injected runner, privacy guards, mocked in tests) |
| `src/providers/gemini.ts` | Stub `provider_gemini_not_yet_supported` | Unchanged — stub deferred to W3 (per kickoff) |
| `src/cli/bootstrap.ts` | `getProviderRegistry()` keepalive | Unchanged |
| `tests/providers-{claude,codex}.test.ts` | Mocked OAuth file fixtures | Mocked runner — no auth-file fixtures needed |
| `tests/fixtures/auth/*.json` | Listed in resume doc | Removed — no longer needed (auth is the CLI's responsibility) |
| `docs/contracts/PROVIDERS.md` (commit 10) | Documents auth-file locations | Documents which CLIs to install + how to log in (`claude login`, `codex login`) |

### Open implementation questions

These should be resolved during commit 8 itself, not before:

1. **Exact Codex CLI flags.** Codex's reply cites `codex-cli 0.125.0`. Verify the installed version on this machine and the actual flag surface (`--json` vs `--ndjson` vs `-q`, `--skip-git-repo-check` availability, etc.). If the CLI doesn't support all the expected flags, fall back gracefully and note the limitation in `provider-contract.md`.

2. **Exact Claude CLI flags.** Claude Code CLI has `--print` for non-interactive output. Verify the version on this machine and confirm the flags for stdin prompt input + JSON output. Fallback to plain stdout parsing if no machine-readable mode exists at the installed version.

3. **Runner abstraction shape.** Either a function `(cmd, args, options) => Promise<{ stdout, stderr, exitCode }>` or a class with a `run(cmd, args, options)` method. Pick the simpler one; tests will tell us if the abstraction needs to grow.

4. **Error code coverage.** The current `ProviderErrorCode` union doesn't have a `provider_cli_missing` or `provider_subprocess_failed` code. Decide whether to (a) reuse `provider_io_error` for both missing CLI and non-zero exits, or (b) add codes. Codex suggests reuse; the synthesis defers to commit-8 implementation experience.

### Verdict (initial — superseded by opencode addendum below)

**A_lite for both Codex and Claude.** Commit 8 ships subprocess-backed adapters with injected runners, privacy guards (stdin manifest + empty temp cwd + sandbox flags), and health via the upstream CLIs' own `login status` commands. No auth-file parsing. No `@anthropic-ai/sdk` dependency. Default tests stay offline via runner mocking. Documented v0.1 limitations: no real streaming through code-oz for either Codex or Claude (their CLIs stream to their own stderr), no tool-call events from Codex (the JSONL trajectory stream isn't mapped in v0.1), no token-usage provenance from either CLI.

Approval pending from Ozzy. Commit 8 implementation begins after explicit "yes" in chat.

---

## Addendum (2026-04-29) — opencode pattern researched

Ozzy pointed at opencode's "Connect a provider" UI showing **OpenAI (ChatGPT Plus/Pro or API key)** and asked whether opencode's actual implementation suggests a third path. An Explore agent + direct read of `~/Projects/agents/templates/opencode/packages/opencode/src/plugin/codex.ts` (619 lines) confirmed yes — for Codex/OpenAI specifically. For Claude, no.

### What opencode actually does

**For Codex/OpenAI ChatGPT Plus subscription** — `packages/opencode/src/plugin/codex.ts:1-619`:

- **Auth flow:** OAuth 2.0 with PKCE (browser flow on `localhost:1455`) OR device authorization grant (headless). Issuer `https://auth.openai.com`, client ID `app_EMoamEEZ73f0CkXaXp7hrann` (opencode's registered OAuth app).
- **Token storage:** opencode's own `~/.opencode/data/auth.json` (NOT the codex CLI's auth.json). Standard refresh_token flow.
- **API endpoint:** `https://chatgpt.com/backend-api/codex/responses` (NOT `api.openai.com`). Bearer token in `Authorization` header + optional `ChatGPT-Account-Id` header for org subscriptions. Calls fan in via `@ai-sdk/openai`'s fetch hook with URL rewriting.
- **Model gating:** OAuth path is restricted to specific Codex/GPT models (`gpt-5.1-codex`, `gpt-5.2-codex`, `gpt-5.3-codex`, etc.) — model list is enforced client-side. Costs zeroed because they're included in the subscription. `gpt-5.5` models have restricted context (400k context, 272k input, 128k output).
- **Distinguishing flag:** request includes `originator: opencode` header so OpenAI knows which client is calling.

**For Anthropic/Claude** — `packages/opencode/src/provider/transform.ts`:

- API key only. The plugin loader uses `@ai-sdk/anthropic` with `x-api-key` + `anthropic-version: 2023-06-01` headers against `api.anthropic.com/v1/messages`. No subscription path. No Claude Max OAuth code anywhere in the CLI's plugin tree.
- (The `console/app/src/routes/zen/util/provider/anthropic.ts` is opencode's hosted-backend Zen proxy — not part of the CLI client.)

### What this changes for code-oz

The map of viable v0.1 paths:

| Provider | Subscription HTTP path? | Subprocess fallback? | What opencode does |
|---|---|---|---|
| OpenAI/Codex | YES (OAuth+PKCE → ChatGPT backend) | `codex exec` | OAuth+PKCE direct HTTP |
| Claude | NO known | `claude --print` | API key only |
| Gemini | Unknown for v0.1 | `gemini` CLI | (not in opencode's popular list) |

### Three real options (Path A retired in favor of these)

**Path A_revised — Pure subprocess for both** (smallest commit 8, lowest UX)
- Codex via `codex exec` subprocess; Claude via `claude --print` subprocess
- Both subscription-first via the CLIs' own auth
- ~150 lines of subprocess wrapper per adapter
- No real streaming through code-oz; no tool_call events for Codex
- Estimated commit 8 effort: 60-90 min
- v1 upgrade path: swap subprocess for HTTP without changing IAgentProvider contract

**Path B — Hybrid: opencode pattern for Codex, subprocess for Claude** (best UX, biggest commit 8)
- Codex: port opencode's OAuth+PKCE pattern. Need to register code-oz as OAuth client with OpenAI to get our own `client_id` (out-of-band admin step on OpenAI's developer portal) — or temporarily reuse opencode's client_id as a placeholder during dev (NOT for distribution; ethical and likely-banned at scale).
- Codex adapter ~600 lines (port from opencode `codex.ts`); native streaming; tool_call event mapping possible
- Claude: subprocess via `claude --print`
- Gemini: stub (unchanged)
- Estimated commit 8 effort: 4-6 hours, likely needs splitting into commits 8a (Claude+Gemini+wrapper plumbing) and 8b (Codex OAuth implementation)
- Adds OpenAI OAuth client registration as a prerequisite

**Path C — opencode pattern for Codex, API key for Claude** (uniform HTTP, defeats subscription-first for Claude)
- Same as Path B but Claude uses `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`
- Cleanest code (no subprocess at all); lost subscription-first promise for Claude
- Estimated commit 8 effort: 4-6 hours
- Likely the "v0.5+" path once Anthropic ships subscription OAuth (currently nonexistent per April 2026)

### My recommendation

**Path A_revised for commit 8; document Path B as the W3 upgrade.**

Reasons:

1. **Atomic commits matter.** M3 had 10 atomic commits; commit 8 should be 8, not 8a+8b. Path B explodes scope substantially.
2. **Path A_revised honors subscription-first today.** Both Codex and Claude use the user's existing CLI subscription auth via subprocess. The OAuth flow is the CLIs' problem, not ours.
3. **The IAgentProvider contract is stable across paths.** Whatever shape commit 8 ships, the wrapper (commit 7) doesn't change, and the cross-family REVIEW (commit 9) doesn't change. Adapter internals can swap from subprocess to opencode-style HTTP without breaking the public contract — that's the upgrade path for W3.
4. **OAuth client registration with OpenAI is real-world admin overhead.** Worth doing deliberately, not bundled into a milestone-mid sub-decision.
5. **opencode itself has had the OAuth code for a while** and has had time to validate it across user environments. We can borrow when we have time to do it properly (W3+).
6. **Tool-call mapping for Codex via JSONL stream is tricky.** Even with Path B, capturing the full Codex trajectory (agent messages + reasoning + commands + file changes + MCP calls + web searches + plan updates) and fanning into ProviderEvent semantics is its own feature, not a commit-8 deliverable.

### Where I'd push back on the "borrow opencode wholesale" lean

Worth being honest about three things:

1. **opencode's client_id is theirs, not ours.** Reusing `app_EMoamEEZ73f0CkXaXp7hrann` in code-oz would impersonate opencode at OpenAI. They could request OpenAI revoke it; in practice OpenAI sees `originator: opencode` on every call and treats it as opencode traffic. Don't do it.
2. **OpenAI may revoke the ChatGPT-backend integration model** — it's not a documented public API; it's the same surface the codex CLI uses. If OpenAI tightens that surface, Path B breaks; Path A_revised survives because we're invoking codex CLI itself.
3. **The 600 lines is substantial.** Even with the pattern handed to us, porting + testing + handling edge cases (token refresh, OS credential store fallback, expired tokens mid-stream, callback server port collisions) is real work.

### Locked changes from this addendum

- **Path A_revised wins** unless Ozzy explicitly opts for Path B and accepts the scope expansion.
- **W3 milestone scope acquires:** "Codex adapter Phase 2 — opencode-style OAuth+PKCE replacing subprocess; register code-oz as OpenAI OAuth client; port + audit `codex.ts` pattern."
- **Documentation discipline:** `docs/contracts/PROVIDERS.md` (commit 10) describes the v0.1 subprocess approach AND links to the planned W3 upgrade. Honest about what's shipped vs. what's coming.

Approval pending from Ozzy. Pick A_revised or B, then commit 8 begins.
