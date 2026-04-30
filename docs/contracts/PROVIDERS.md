# Providers (v0.1)

User-facing summary of the four IAgentProvider adapters that ship in
v0.1-alpha. The canonical contract — interface shape, error codes, doctor
exit semantics — lives in [`docs/references/provider-contract.md`](../references/provider-contract.md).

## Subscription-first auth model

code-oz orchestrates the user's existing paid CLI subscriptions, never a
separately-billed API key. For each upstream CLI:

| Provider | Auth source | How to log in |
|---|---|---|
| Claude | Claude Max OAuth (handled by Claude Code CLI) | `claude login` |
| Codex | ChatGPT Plus/Pro OAuth (handled by Codex CLI) | `codex login` |
| Gemini | Stub in v0.1; lands in W3+ | n/a |
| Fake | Built-in deterministic adapter | n/a |

code-oz never reads or transmits OAuth tokens directly. Auth lives entirely
inside the upstream CLIs (`~/.claude/auth.json`, `~/.codex/auth.json`, OS
credential stores on some platforms). The v0.1 adapters spawn the CLIs as
subprocesses and trust the CLIs' own token handling.

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

The Codex adapter applies three guards beyond the wrapper's manifest
discipline (rule 13: privacy by default; explicit file manifests):

1. **Empty temp working directory.** `codex exec` runs in a fresh
   `mkdtemp()` directory, NOT the project root — closes the
   "Codex recursively scans cwd" hole.
2. **Manifest content via stdin.** The prompt + permission-intersected
   files are piped through stdin (the `-` arg), never via path arguments
   or `-C` flags that would be visible in `ps`.
3. **Sandbox flags.** `--skip-git-repo-check` (empty dir is not a repo)
   + `--sandbox read-only` (no shell mutations from inside the sandbox)
   + `--ephemeral` (no session files persisted).

The Claude adapter doesn't need analogous flags because `claude --print`
operates on stdin only and doesn't recursively scan its cwd.

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

## See also

- [`docs/references/provider-contract.md`](../references/provider-contract.md) — IAgentProvider, request DTOs, ProviderFamily, error codes
- [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — NEEDS_INTERVENTION schema; agent_invoked metric fields
- [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) — permissions semantics (upper bound, not glob expansion)
- [`docs/design/CODEX_RESPONSE_M4.md`](../design/CODEX_RESPONSE_M4.md) — the M4 planning round + locked 10-commit order
- [`docs/design/CODEX_RESPONSE_M4_ADAPTERS.md`](../design/CODEX_RESPONSE_M4_ADAPTERS.md) — the commit-8 adapter shape sub-consultation (subscription-first decision)
