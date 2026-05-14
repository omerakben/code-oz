# Providers (v0.1)

User-facing summary of the IAgentProvider adapter surface in v0.1-alpha. The canonical contract — interface shape, error codes, doctor exit semantics — lives in [`docs/references/provider-contract.md`](../references/provider-contract.md).

## Provider status (v0.1)

This is the single source of truth for which providers are live, which are stubs, and which are future adapter candidates. **Phantom contract entries (treating future candidates as if they were live) are forbidden** per the CLAUDE.md non-negotiables.

### Live adapters

| Provider | Family    | Auth source                                             | Eligible phases | Notes |
|----------|-----------|---------------------------------------------------------|------------------|-------|
| `claude` | anthropic | Claude Max OAuth via Claude Code CLI subprocess         | all phases       | `claude login` |
| `codex`  | openai    | ChatGPT Plus/Pro OAuth via Codex CLI subprocess         | all phases       | `codex login` |
| `xai`    | xai       | Direct HTTPS with `XAI_API_KEY` env var (no upstream CLI) | all phases     | API-key transmission, redaction discipline at adapter |
| `fake`   | fake      | Built-in deterministic adapter                          | all phases       | Test + demo runtime; no network, no spend |

### Stubs (listed for transparency, not for use)

| Provider | Family | Adapter behavior | Status |
|----------|--------|------------------|--------|
| `gemini` | google | `invoke()` throws `provider_gemini_not_yet_supported` at runtime; loader-level eligibility rejection (`loader_provider_phase_not_eligible`) added in M11 | Stub for transparency only; not invocable. Real Gemini adapter is on the future-candidates roadmap, not the v0.1 contract surface. |

### Future adapter candidates, not in v0.1

The following providers appear in audit findings or competitor surveys but are **not** v0.1 adapters. They are not implemented in code-oz today. Listing them here prevents phantom contract entries and signals adoption intent.

| Provider | Source | Status |
|----------|--------|--------|
| `gemini-live` | Google Gemini CLI / ADK | Future adapter candidate; v0.1 ships only the stub above. |
| `opencode` | OpenCode CLI | Future adapter candidate; no v0.1 implementation. |
| `roo`      | Roo Code CLI | Future adapter candidate; no v0.1 implementation. |

## Auth model (v0.1)

code-oz supports two auth shapes in v0.1: **subscription-first delegation** to
upstream CLIs, and **direct API-key transmission** for HTTP adapters that
have no upstream-CLI option. Cloud-IAM auth (Azure / Bedrock / Vertex) is
v0.2+ scope.

### Subscription-first (preferred when an upstream CLI exists)

For every provider with an upstream CLI that already handles the user's
subscription auth, code-oz orchestrates the existing CLI rather than
billing a separate API key. The v0.1 subscription-first adapters:

| Provider | Auth source | How to log in |
|---|---|---|
| Claude | Claude Max OAuth (handled by Claude Code CLI) | `claude login` |
| Codex | ChatGPT Plus/Pro OAuth (handled by Codex CLI) | `codex login` |
| Fake | Built-in deterministic adapter | n/a |

The Gemini stub uses no auth (it throws on invocation). See § "Provider status (v0.1)" for the explicit three-category split.

code-oz never reads or transmits OAuth tokens directly. Auth lives entirely
inside the upstream CLIs (`~/.claude/auth.json`, `~/.codex/auth.json`, OS
credential stores on some platforms). The subscription-first adapters spawn
the CLIs as subprocesses and trust the CLIs' own token handling.

### API-key transmission (PE-1: xAI)

When a provider has no upstream-CLI option (xAI is the first), code-oz
reads a per-provider API key from the environment and transmits it directly
to the upstream over HTTPS:

| Provider | Auth source | How to set up |
|---|---|---|
| xAI | API key via env var | `export XAI_API_KEY=...` (per shell) or `.env` (auto-loaded by Bun) |

**Env var convention:** `<PROVIDER>_API_KEY` (e.g., `XAI_API_KEY`). No
generic `API_KEY` or shared name across providers. Adapters read the
variable on each `invoke()` call; missing or empty values surface as a
typed `ProviderError(provider_auth_missing)` with a concrete suggestion to
export the right variable.

**Redaction discipline:** API keys must never appear in `events.jsonl`,
gate files, doctor output, error messages, or request / response logs.
Authorization headers (`Authorization`, `x-api-key`, `xi-api-key`, etc.)
are stripped before any serialization at any layer. The discipline is a
property of every artifact-producing path that touches an HTTP adapter,
not of the adapter alone.

**HTTP error mapping:** 401 → `provider_auth_missing`; 403 →
`provider_permissions_violation`; 429 → `provider_rate_limit`; 5xx →
`provider_io_error`; malformed JSON → `provider_malformed_response`. Each
code carries at least one actionable suggestion. See
[`docs/references/provider-contract.md`](../references/provider-contract.md)
§ "Auth model — subprocess delegation + API-key transmission (v0.1)" for
the full canonical mapping.

### Cloud-IAM (deferred to v0.2+)

Azure AI Foundry, AWS Bedrock, and Google Vertex AI each carry their own
IAM, region, deployment-name, and catalog discipline. Each lands as its
own milestone in v0.2+ when there is measurable demand for it. v0.1
explicitly does not encode cloud-IAM auth shapes in the contract; PE-1's
narrow API-key shape does not generalize to cloud routes.

## v0.1 limitations

These are deliberate scope choices, not bugs:

- **No streaming UX through code-oz.** The Claude / Codex CLIs stream to
  their own stderr in interactive mode; in `--print` / `exec` mode they
  buffer the final answer to stdout. code-oz gets the final answer as a
  single chunk, which is enough for the v0.1 spine but not for a future
  TUI.
- **No tool_call event surfacing for Codex.** The streaming `tool_call`
  cap in `src/providers/invoke.ts` is a no-op for Codex calls because the
  Codex CLI handles its own tool use internally; we only see the final
  message.
- **No `tokensUsed` provenance from Codex.** `codex exec` text mode
  doesn't expose token counts. The wrapper falls back to the recorded
  `tokensEstimate` for budget accounting.
- **Claude `tokensUsed` from JSON only.** When `--output-format json`
  returns a `usage.output_tokens` field, the wrapper records it. Plain
  text output omits the field entirely (M3 schema accepts the absence).

The W3 upgrade path replaces the subprocess approach with direct HTTP
integrations (opencode-style OAuth+PKCE for Codex; equivalent for Claude
when Anthropic ships subscription auth) without changing the
IAgentProvider contract. Wrappers and tools (`requestReview`) stay
identical.

## Privacy guards

Both subprocess adapters apply guards beyond the wrapper's manifest
discipline (rule 13: privacy by default; explicit file manifests).

**Codex adapter (`src/providers/codex.ts`):**

1. **Empty temp working directory.** `codex exec` runs in a fresh
   `mkdtemp()` directory, NOT the project root — closes the
   "Codex recursively scans cwd" hole.
2. **Manifest content via stdin.** The prompt + permission-intersected
   files are piped through stdin (the `-` arg), never via path arguments
   or `-C` flags that would be visible in `ps`.
3. **Sandbox flags.** `--skip-git-repo-check` (empty dir is not a repo)
   + `--sandbox read-only` (no shell mutations from inside the sandbox)
   + `--ephemeral` (no session files persisted) + `--color never`
   (clean output for buffered parsing).

**Claude adapter (`src/providers/claude.ts`):**

1. **Empty temp working directory.** `claude --print` runs in a fresh
   `mkdtemp()` directory. Claude Code auto-discovers `CLAUDE.md` files
   up the working-directory hierarchy at session start (per
   https://code.claude.com/docs/en/memory). Without an empty cwd, the
   subprocess would inherit project + parent + ancestor `CLAUDE.md`
   context outside the wrapper's explicit manifest.
2. **Manifest content via stdin.** Same pattern as Codex — never via
   path arguments or `--add-dir` flags that would expand the cwd
   surface.
3. **No session persistence.** `--no-session-persistence` skips the
   on-disk session file so the print-mode invocation can't be resumed
   from disk and leaves no manifest residue after the call.

## `code-oz doctor providers`

Aggregate health probe with a required-providers exit policy:

- **Required providers** = every distinct `provider` value across loaded
  agents. With the bundled v0.1 personas, that's `claude` + `codex`.
- For each required provider: success means `authStatus === 'ok'`.
- Non-required providers (e.g., `gemini` when no agent declares it) are
  ignored for exit code. `'unsupported'` is success-by-design.
- Exit 0 when every required provider is healthy; exit 1 otherwise.

Output:
- Default: human-readable table.
- `--json`: full `DoctorProvidersReport` as JSON.

`health()` never writes events.jsonl or NEEDS_INTERVENTION.json. Doctor
runs outside any active run; the per-run lock and event log don't exist
in that context. Provider failures *inside* an active run write gates —
that's the wrapper's job (see `src/providers/invoke.ts`).

## Capabilities and eligibility (M11)

Every provider declares a static `ProviderCapability` record naming its
auth source and the phases it is eligible to run an agent for. Eligibility
is checked at agent-load time, before any run starts. The full TypeScript
shape and design rationale live in
[`docs/references/provider-contract.md`](../references/provider-contract.md)
§ "Capability and eligibility (M11)".

### v0.1 defaults

| Provider | Auth source                | Eligible phases                              |
|----------|----------------------------|----------------------------------------------|
| `claude` | `claude-cli-oauth`         | every phase (`define`, `plan`, `build`, `verify`, `review`, `ship`, `audit`) |
| `codex`  | `chatgpt-cli-oauth`        | every phase                                                                  |
| `gemini` | `gemini-stub`              | none — stub provider; running it surfaces `provider_gemini_not_yet_supported` at runtime today, and `loader_provider_phase_not_eligible` at agent-load time as of M11 |
| `fake`   | `in-process-fake`          | every phase (test runtime supports all)                                      |
| `xai`    | `xai-api-key`              | every phase (`XAI_API_KEY` required at invoke; explicit model binding required via persona frontmatter or `company.<role>.model`)                                  |

"Eligible for phase X" means *the provider may run an agent declared with
`phase: X`*. It does not mean phase X's runtime exists — SHIP and AUDIT
remain stubbed in v0.1, and exercising them surfaces those stubs as the
actionable error.

For `xai`, "eligible" also assumes the upstream API has not changed shape
since PE-1 shipped. Adapter-level failure modes (missing key, missing
model, network / 4xx / 5xx, malformed JSON) flow through the standard
`ProviderError` plumbing; see § "Auth model (v0.1)" above and
[`docs/references/provider-contract.md`](../references/provider-contract.md)
§ "Auth model — subprocess delegation + API-key transmission (v0.1)".

### What M11 does

- Adds `ProviderCapability` as a static per-provider record (`authSource`,
  `eligiblePhases`, optional advisory `costPerMTok`, optional advisory
  `rateLimits`).
- Adds load-time eligibility check: an agent declaring `provider: gemini,
  phase: build` fails at load time before any run begins, with
  `loader_provider_phase_not_eligible` aggregated into `AgentLoadError`.
- Preserves cross-family REVIEW (`registry.familyOf` authority unchanged).
- Preserves subscription-first auth (`authSource` records the mechanism, not
  the user's subscription tier).
- Preserves doctor's contract: `health()` remains side-effect-free and
  scoped to auth + model availability; no capability probe.

### What M11 does not do

- Does not introduce a company roster, role naming, or role-to-provider
  routing — those are M12.
- Does not enforce cost or rate-limit budgets — that is M13 under existing
  `budgets.global` namespace.
- Does not encode `editSemantics`, `shellSemantics`, `mcpSupport`, or
  `sandboxProfile` as v0.1 TypeScript fields. The v0.1 `tool_use` runtime is
  provider-uniform; those traits become divergent in W3+ when HTTP adapters
  arrive. They live in the canonical contract as deferred prose.
- Does not extend `AgentLoadIssue` with `actionableSuggestions` or any
  provider-error shape. Loader issues use `rule` + `detail`.

## See also

- [`docs/references/provider-contract.md`](../references/provider-contract.md) — IAgentProvider, request DTOs, ProviderFamily, error codes, M11 capability and eligibility
- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — NEEDS_INTERVENTION schema; agent_invoked metric fields
- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — permissions semantics (upper bound, not glob expansion)
- [`docs/design/CODEX_RESPONSE_M4.md`](../design/CODEX_RESPONSE_M4.md) — the M4 planning round + locked 10-commit order
- [`docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`](../design/CODEX_RESPONSE_M4_ADAPTERS.md) — the commit-8 adapter shape sub-consultation (subscription-first decision)
- [`docs/research/CODEX_BRIEFING_M11.md`](../research/CODEX_BRIEFING_M11.md) and [`docs/research/CODEX_RESPONSE_M11.md`](../research/CODEX_RESPONSE_M11.md) — M11 planning-convergence debate (thread `019de44e-e8a7-7441-9d82-d79a0595f591`)
- [`docs/design/SESSION_M11_KICKOFF.md`](../design/SESSION_M11_KICKOFF.md) — synthesized M11 locks and 4-commit sequence
