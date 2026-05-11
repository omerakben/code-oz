---
name: MCP_TRUST_BOUNDARY
status: design (implementation deferred until demand checkpoint)
companion-docs: ../comparison/11-opencode/SYNTHESIS.md (origin), ../references/provider-contract.md (sibling trust-boundary lock), REPO_CONTEXT.md (existing tool-scope contract)
rules-anchored: 9, 11, 13, 18
---

# MCP_TRUST_BOUNDARY (v0.1 design)

## Purpose and scope

This contract governs how a future MCP (Model Context Protocol) consumer integrates with code-oz, and what the trust boundary requires before any server is contacted. Implementation is demand-gated and is not part of v0.17.0-alpha.0; this contract exists now so that when an implementation milestone opens, the surface is fixed and cannot drift into opencode-style startup auto-load semantics (`packages/opencode/src/mcp/index.ts:524-560`) that are hostile to rule 13. Upstream MCP SDKs are influence; this file is the authority for code-oz.

## Status

Design only — no implementation in v0.17.0-alpha.0. Implementation milestone slot opens when a demand checkpoint surfaces a Researcher-tier capability need (e.g., Sentry, GitHub, web fetch). Refinements that change any axiom in §3 require a Codex debate round per the cross-model peer review rule.

## Trust boundary axioms

Any implementation MUST satisfy every item below. These are invariants, not defaults.

1. **No startup auto-connect.** Servers are configured but not contacted at boot. The first `tool_use.mcp` invocation against a server id is what triggers connection. This inverts opencode's `Object.entries(config)` startup load.
2. **Per-server allowlist.** A server id absent from `mcp.servers` returns the typed error `mcp_server_not_allowed` and never spawns, never opens a socket, never resolves DNS. Allowlist membership is structural, not advisory.
3. **Local servers — binary allowlist (per-server pinning).** The allowlist *is* the per-server `command[0]` value plus the optional `binarySha256`; there is no global `approvedBinaries` list, only per-server enumeration. Spawn proceeds only when `command[0]` resolves and (when `binarySha256` is set) the resolved binary's hash matches.
4. **Local servers — env redaction.** Environment variables passed to the spawned process are redacted from `events.jsonl`. The audit log records env *keys* only, never values. Secrets sourced from process env (e.g., `GITHUB_TOKEN`) are never serialized.
5. **Local servers — optional sha256 pinning.** When `binarySha256` is present in config, the wrapper hashes the resolved binary before spawn. Mismatch refuses the spawn with `errorClass: hash_mismatch`. When absent, no hash check runs and `mcp_server_started.hashVerified` is `false`.
6. **Remote servers — host allowlist.** The configured `url`'s host must be in the per-config `networkAllowlist`. Off-allowlist hosts return `mcp_network_denied` before any TCP connect.
7. **Remote servers — header redaction.** Request headers (including `Authorization`, `Cookie`, custom auth headers) are redacted from `events.jsonl`. Header *names* may appear; values never.
8. **Remote servers — OAuth token discipline.** OAuth tokens (access, refresh, ID) are never logged, never written to gate files, never echoed in `NEEDS_INTERVENTION.json`. Refresh failures surface as `errorClass: oauth_refresh_failed` with sanitized detail. Unlike the subscription-first OAuth path in `docs/references/provider-contract.md` § "Auth model" — where code-oz never reads the token — MCP remote OAuth is a new direct-token trust boundary; tokens are held in process memory only, never written to disk, never logged, and never echoed in error messages.
9. **No silent recursive context.** Per rule 18, MCP tool results are persisted before they enter agent context. File-shaped results promote into the next invocation's `ProviderRequest.files`. Non-file payloads (JSON responses, event lists, fetched documents) are written to a wrapper-managed artifact directory under `.code-oz/state/runs/<runId>/mcp/<serverId>/<callDigest>.json` and the path is added to the next invocation's manifest. The agent decides which payloads to promote; the wrapper enforces the persistence step. Hidden context-injection from a tool call is forbidden.
10. **`tool_use.mcp` is denied by default.** Agent frontmatter that omits `permissions.tool_use.mcp` cannot invoke any MCP tool. Opt-in is per `serverId`, not blanket.
11. **Network access is denied by default (remote transport only).** For remote servers, the wrapper denies all outbound HTTP destinations not in `networkAllowlist`. The wrapper is the HTTP client and can refuse connection before any TCP open. For local servers, the wrapper does not control the subprocess's network surface; trust in local servers is placed in the binary allowlist (axiom 3) and optional sha256 pinning (axiom 5). Local-server network sandboxing is an open question in §8 and a precondition before any local MCP server with network reach ships.
12. **Local-server network surface is unenforced (current limitation).** A spawned local MCP subprocess can open arbitrary sockets; the wrapper has no in-process means to block them without OS-level sandboxing. This gap is named here so it cannot hide behind axiom 11. Closing it is tracked in §8 under "Local server sandboxing" and is a precondition before any local MCP server with network reach is added to the per-config allowlist.

## Config schema (informative)

The canonical schema lands when the implementation milestone opens. The shape below is informative and exists to scope §3.

```yaml
mcp:
  servers:
    - id: <slug>
      transport: local | remote
      # local fields:
      command: [<binary>, <arg>, ...]
      binarySha256: <optional hex>
      env: { ... }
      # remote fields:
      url: https://...
      headers: { ... }
      oauth: { ... } | false
      # common:
      networkAllowlist: [host, host, ...]
      timeoutMs: 5000
```

The binary allowlist is implicit in the per-server `command[0]` value. There is no global `approvedBinaries` field; an attacker who can edit `mcp.servers` can already specify any binary, so the per-server schema is the allowlist boundary.

Notes:

- `id` is a slug; agent frontmatter references it by exact match.
- `transport` discriminates the union; mutually exclusive field sets are validated structurally.
- `env` and `headers` keys are sent verbatim; values never appear in logs.
- `oauth: false` declares the remote server is unauthenticated; any other value declares an OAuth profile whose token storage and refresh policy is part of the implementation milestone.
- `timeoutMs` is per-tool-call wall time, default 5000.

## Audit events

The wrapper emits the following events into `events.jsonl`. Payload shapes are locked; field additions in later versions are append-only.

All MCP events share the standard event envelope mirrored from `docs/contracts/REPO_CONTEXT.md` § "`repo_context_searched` event (locked shape)": every event row carries `{ version: 1, type, ts, runId, phase, agent, ...payload }`. The shapes below describe the payload portion only; the envelope is mandatory and identical across event types. The `version` field exists so future schema additions are append-only and observable in `events.jsonl`.

- `mcp_server_started` — `{ serverId, transport, connectedAt, redactedCommandOrUrl, hashVerified? }`. Emitted once per lazy connection. `redactedCommandOrUrl` is the binary path or scheme+host; args, query strings, and credentials are stripped. `hashVerified` is present only for local servers.
- `mcp_server_failed` — `{ serverId, errorClass, message, attemptCount }`. `errorClass` is one of `hash_mismatch`, `spawn_failed`, `oauth_refresh_failed`, `timeout`, `protocol_error`. `message` is sanitized; secrets and tokens never appear.
- `mcp_tool_called` — `{ serverId, toolName, argDigest, durationMs }`. `argDigest` is a sha256 of the canonical-JSON-serialized arguments; the payload itself is never logged. This satisfies rule 13 for tool calls whose arguments may carry user prompts or secrets.
- `mcp_tool_result_persisted` — `{ serverId, toolName, fileManifestEntries: [...] }`. Emitted when results are promoted into the next invocation's manifest per axiom 9. `fileManifestEntries` is the list of paths the wrapper added to the next `ProviderRequest.files`.
- `mcp_server_not_allowed` — `{ serverId, reason }`. Allowlist miss or post-failure connection refusal; no connection attempted. `reason` is one of `not_in_servers`, `binary_not_in_allowlist`, `host_not_in_allowlist`, `transport_closed`. The `transport_closed` value is reserved for the post-`mcp_server_failed` case described in §7 — once a server is marked unhealthy for the run, subsequent invocations short-circuit through this event rather than reattempting connection.
- `mcp_network_denied` — `{ serverId, host, reason }`. Network-allowlist miss for a remote tool call. `reason` is `host_not_in_network_allowlist`.

## Permission integration

`tool_use.mcp` slots into `AgentPermissions` next to existing sub-scopes (`repo_context`, `write`, `execute`, `review_request`, `debate`) defined in `src/agents/schema.ts`. The new sub-scope MUST satisfy:

1. The agent declares an opt-in array of `serverId` strings: `permissions.tool_use.mcp.servers: [<id>, ...]`.
2. The intersection guarantee from REPO_CONTEXT.md § "AgentPermissions extension" extends to MCP: request servers ⊆ `agent.permissions.tool_use.mcp.servers` ⊆ `mcp.servers[*].id` from project config. Any miss at any layer denies.
3. Schema validates shape (the `serverId` array is well-typed, no duplicates, no empty strings). The agent loader cross-validates `serverId` values against `mcp.servers[*].id` after both config and agent definitions are parsed; unknown ids fail the load with a typed `ConfigError`. This split mirrors the existing pattern where schema validates `permissions.tool_use.repo_context` shape, and runtime enforcement happens in `src/tools/repo-context/permissions.ts`.
4. Personas may not relax the universal rule sheet (rule 16); MCP opt-in does not bypass redaction or rule 13.

The existing intersection helper that backs `repo_context` (`src/tools/repo-context/permissions.ts:8-10`) is the pattern to mirror; MCP's intersection runs before any spawn or socket open.

## Failure modes and recovery

- **Server in config is missing from allowlist.** Boot fails closed with a typed `ConfigError` carrying the missing server id. `code-oz run` does not start. No `mcp_server_started` event is written.
- **Local binary fails sha256.** Spawn refused. `mcp_server_failed` with `errorClass: hash_mismatch`. The phase invocation that triggered the lazy connect receives a typed `ProviderError` and the wrapper writes `NEEDS_INTERVENTION.json` per rule 11 with actionable text ("Update `binarySha256` in config or reinstall the binary").
- **Remote OAuth refresh fails.** `mcp_server_failed` with `errorClass: oauth_refresh_failed`. No automatic retry. `NEEDS_INTERVENTION.json` is written with re-auth instructions; the run halts at the current phase. Resume requires re-auth out-of-band, then `code-oz resume`.
- **Tool call times out.** `mcp_server_failed` with `errorClass: timeout`. The tool result returned to the agent is empty (`{ ok: false, reason: "timeout" }`). The phase decides whether to proceed without the tool's data or to escalate to `NEEDS_INTERVENTION`.
- **Protocol error from server.** `mcp_server_failed` with `errorClass: protocol_error` and a sanitized message. The connection is closed and the server is marked unhealthy for the remainder of the run; subsequent tool calls return `mcp_server_not_allowed` with `reason: transport_closed`.

In all failure modes, the wrapper is the only writer of failure events and intervention files. Adapters never write either, matching the discipline in `docs/references/provider-contract.md` § "ProviderError + NEEDS_INTERVENTION".

## Open questions for the implementation milestone

The following are deliberately deferred. The implementation milestone briefing must answer each before code lands.

- **Choice of MCP SDK.** Official Anthropic MCP SDK vs. hand-rolled minimal client. The official SDK simplifies protocol conformance but introduces a dependency surface; a hand-rolled client keeps the trust boundary auditable in-tree. Decision pending the demand checkpoint's capability shape.
- **Local server sandboxing.** Whether spawned local servers run under their own sandbox (e.g., bubblewrap on Linux, sandbox-exec on macOS) separate from the agent process. Per axiom 12, the wrapper does not enforce network restrictions on local subprocesses today; **sandboxing is therefore a precondition for shipping any local MCP server with network reach.** Local servers that are pure-local (filesystem reads inside the project root, no outbound network) may ship before sandboxing lands; servers that need outbound network must wait for the sandbox decision. Implementation milestone briefing decides the sandbox mechanism (bubblewrap on Linux, sandbox-exec on macOS, or a code-oz-managed proxy that intercepts subprocess sockets) before any network-reaching local server lands.
- **Event-family integration.** How `mcp_tool_result_persisted` integrates with the `repo_context_searched` event family from REPO_CONTEXT.md. Both populate the next invocation's manifest; the implementation milestone decides whether to unify them under a `tool_result_persisted` umbrella or keep them parallel.
- **Cost-budget integration.** Whether MCP tool calls count toward `budgets.global` (rule 19) or get their own sub-budget under `budgets.mcp`. The decision is informed by whether MCP calls are expected to be free (local servers) or paid (remote API gateways) at the demand-checkpoint use site.

## Reference

- **Origin:** [`docs/comparison/11-opencode/SYNTHESIS.md`](../comparison/11-opencode/SYNTHESIS.md) §2 (B3 trust-boundary requirements)
- **Codex pressure-test:** [`docs/comparison/11-opencode/CODEX_RESPONSE.md`](../comparison/11-opencode/CODEX_RESPONSE.md) Q3 (block-push finding 2)
- **Sibling trust-boundary lock:** [`docs/references/provider-contract.md`](../references/provider-contract.md) § "Auth model — subprocess delegation + API-key transmission (v0.1)"
- **Existing tool-scope contract:** [`REPO_CONTEXT.md`](./REPO_CONTEXT.md) (the pattern this contract mirrors)
- **Non-negotiable rules:** `CLAUDE.md` rules 9 (permission manifest required for execution), 11 (provider failures become `NEEDS_INTERVENTION.json`), 13 (privacy by default), 18 (tool_use scope discipline)
- **Schema neighborhood:** `src/agents/schema.ts:226-358` (`AgentPermissions`, `tool_use` validator, `KNOWN_SUB_SCOPES`)
