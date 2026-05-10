# REPO_CONTEXT (v0.1)

User-facing summary of the `tool_use.repo_context` permission sub-scope and the in-process tools (`glob`, `grep`, `read`) that implement agentic codebase search. Authoritative for v0.1.

## Why this exists

Non-negotiable rule 18 (`CLAUDE.md`): codebase context retrieval has its own permission scope. Search is a `tool_use.repo_context` sub-scope on agent permissions. Search results are audited via `repo_context_searched` events. Selected paths enter the **next** invocation's `ProviderRequest.files`, never the search invocation's hidden context. Network access is denied for repo_context tools.

This protects rule 13 (privacy by default; explicit file manifests) — agents never silently absorb the project tree. The wrapper's `agent_invoked` manifest remains the single source of truth for what bytes a provider call sent.

## AgentPermissions extension (locked TypeScript shape)

```ts
interface AgentPermissions {
  read: '*' | readonly string[]
  write: '*' | readonly string[]
  bash: 'deny' | readonly string[]
  tool_use?: {
    repo_context?: {
      tools: readonly ('glob' | 'grep' | 'read' | 'symbol')[]
      roots: readonly string[]
      maxResults: number
      maxBytesPerResult: number
      maxFilesForNextManifest: number
      timeoutMs: number
      network: 'none'
    }
  }
}
```

- The `tool_use.repo_context` sub-scope is the **only** `tool_use` sub-scope in v0.1. Adding `tool_use.web_search` or similar is W3+.
- `network` is fixed at `'none'` in v0.1. Remote tools are W3+.
- `symbol` is optional in M6 (LSP integration deferred to W3 if data justifies).

## Locked default caps

| Setting | M6 default | Rationale |
|---|---|---|
| `maxResults` | 50 | Bounded search result count |
| `maxBytesPerResult` | 16384 (16 KB) | Codex math: 20 selected × 16 KB ÷ 4 chars/token ≈ 81,920 tokens, leaves headroom in PLAN's 300k phase cap |
| `maxFilesForNextManifest` | 20 | How many candidate paths the agent can promote to the next invocation's `ProviderRequest.files` |
| `timeoutMs` | 5000 | Per-tool wall-time cap |
| `network` | `'none'` | No remote calls in v0.1 |

Codex push-back on briefing prompt 1 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 1): the original 64 KB default would let 20 selected files alone estimate at ~327,680 tokens — already over PLAN's 300k cap before the prompt, SPEC.md, or docs cache. Lock at 16 KB. Lead persona may **not** override above 20 selected files until fixture data justifies the increase.

## The three tools

### `glob`

Pattern-match file paths under `roots`, return relative paths.

**Input:** `{ pattern: string, roots?: string[] }`
**Output:** `{ paths: string[] }` (capped at `maxResults`)
**Implementation:** delegates to `rg --files --glob`

### `grep`

Pattern-search file contents under `roots`, return matching lines with file path and line number.

**Input:** `{ pattern: string, roots?: string[], regex?: boolean, ignoreCase?: boolean }`
**Output:** `{ matches: Array<{ path: string, line: number, snippet: string }> }` (capped at `maxResults`; snippet truncated to 200 chars)
**Implementation:** delegates to `rg <pattern>`

### `read`

Read a slice of a file under `roots`. **Targeted reads only**, capped at `maxBytesPerResult`.

**Input:** `{ path: string, lineRange?: [number, number] }`
**Output:** `{ path: string, content: string, truncated: boolean }`
**Implementation:** native filesystem read with byte cap.

### `symbol` (RESERVED — not permissionable in v0.x)

The `'symbol'` member of `RepoContextToolName` is preserved in the type union so the schema slot is callable for backward-compat if the reopen telemetry signal below ever fires. Until then it is **not permissionable**:

- `validateRepoContext` (`src/agents/schema.ts`) rejects any agent that lists `'symbol'` in `permissions.tool_use.repo_context.tools[]` at config-load time with code `schema_invalid_permissions` and a rule pointing at this section.
- `intersectPermissions` (`src/tools/repo-context/permissions.ts`) rejects any direct request whose `tool === 'symbol'` at runtime with code `tool_unavailable`, even if the request bypasses config validation.

The full reservation rationale, the locked reopen condition, and the telemetry signal live in § "Reservation and reopen-the-slot signal" below.

## How tool use flows

1. **Lead persona** issues a `tool_use` block in its provider response (Claude/Codex tool-use protocol).
2. **Wrapper** detects the tool use, intersects the requested arguments with `agent.permissions.tool_use.repo_context`, and runs the tool in-process (no subprocess shell).
3. **Tool execution** is bounded by `timeoutMs`, capped at `maxResults` and `maxBytesPerResult`.
4. **`repo_context_searched` event** is appended to `events.jsonl` with the canonical shape (below).
5. **Tool result** flows back into the agent's continuation as a `tool_result` block. Results are NOT silently absorbed into the next provider call; the agent decides which paths to promote.
6. **The agent's next `ProviderRequest.files`** carries the explicitly selected paths (≤ `maxFilesForNextManifest`). The wrapper's `buildManifest` enforces `permissions.read` on those paths exactly as before.

## `repo_context_searched` event (locked shape)

```ts
{
  version: 1,
  type: 'repo_context_searched',
  ts: string,
  runId: string,
  phase: PhaseName,
  agent: string,
  tool: 'glob' | 'grep' | 'read' | 'symbol',
  query: string,                       // the literal pattern / path / line range
  roots: string[],                     // intersected roots actually searched
  resultPaths: string[],               // paths returned to the agent (capped)
  selectedPaths: string[],             // paths the agent then promoted to next manifest
  resultBytes: number,                 // total bytes returned
  resultTokensEstimate: number         // resultBytes / 4 (conservative estimator)
}
```

`selectedPaths` is populated **on the next invocation** when the agent's tool-result includes selection metadata. If the agent does not select, the field is `[]`.

## Accounting (locked)

Codex push-back on briefing prompt 4 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 4): `repo_context_searched` is **not** a `maxProviderCalls` increment.

| Quantity | Counted by | Where |
|---|---|---|
| Provider calls | `agent_invoked` events | `cost.ts` `assertWithinBudget` reads cumulative count |
| Tool calls | Existing tool-call cap when model-issued | `invoke.ts` |
| Search result bytes | `repo_context_searched.resultBytes` | Audit-only (not budget-counted) |
| Search result tokens | `repo_context_searched.resultTokensEstimate` | Audit-only |
| Bytes actually sent to provider | Next invocation's `agent_invoked.bytesSent` | Wrapper manifest |
| Tokens actually sent to provider | Next invocation's `agent_invoked.tokensEstimate` | Wrapper estimator |

The audit invariant in `docs/references/file-based-gates.md` § 5 (file-based-gates.md:168) — "the manifest is the only source of truth for what bytes a provider call sent" — stays intact because selected files always pass through the next manifest.

## Doctor check (locked)

`code-oz doctor` checks that `rg` is on `PATH`. If missing, doctor reports the failure and `code-oz run` continues to work for any agent that doesn't declare `tool_use.repo_context`. An agent that does declare it gets a typed `ProviderError` (or new `ToolUnavailableError`) on first invocation, which the wrapper surfaces as `NEEDS_INTERVENTION.json` with actionable text:

```text
Tool 'glob' (repo_context) requires 'rg' (ripgrep) on PATH.
Install: brew install ripgrep   # macOS
         sudo apt install ripgrep   # Debian/Ubuntu
         see https://github.com/BurntSushi/ripgrep#installation
Then rerun: code-oz resume
```

Codex push-back on briefing prompt 8 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 8): `package.json` `engines` only carries Bun. Doctor is the right detection point. **No JS fallback in M6** — that is W3 polish.

## Privacy and root semantics

- `roots` is intersected with `agent.permissions.read` at request time. An agent cannot search a path it cannot read.
- `roots` defaults to the project root (`.`) when omitted; the agent's `permissions.read` still applies.
- `.code-ozignore` (if present) is honored by all three tools.
- `.gitignore` is honored by `rg` by default.
- File-size caps from rule 13 are applied at the `read` level (per-result `maxBytesPerResult`).

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `tool_unavailable` | `rg` missing for glob/grep | Install ripgrep; doctor will confirm |
| `tool_root_outside_permissions` | Agent requested a root outside `permissions.read` | Persona prompt or permission widening |
| `tool_result_cap_exceeded` | Result truncated to `maxBytesPerResult` | Narrow query or accept truncation |
| `tool_timeout` | Tool exceeded `timeoutMs` | Narrow query or raise cap (M6: do not raise above defaults) |
| `tool_selected_path_outside_permissions` | Agent tried to promote a path outside `permissions.read` | Wrapper rejects; agent retries with valid paths |

## Reservation and reopen-the-slot signal

The `'symbol'` slot was reserved in M6 as "optional LSP integration deferred to W3." The codegraph comparison (`docs/comparison/06-codegraph/`) revisited that decision. Codex (`gpt-5.5` xhigh, thread `019e12ed`) returned `accept-with-modifications` and the load-bearing catch was Q8: a tool name that appears in the type union, in the permission validator, and in error type unions while the runtime rejects it with a generic "unsupported tool" error is **already contract debt today**, not harmless optionality.

The post-debate verdict is **Option D-reserved**:

- The type-union member stays, so future runtimes can replay archived events and reopen the slot without a breaking schema change.
- The config-load path rejects any agent that declares `'symbol'` in `tools[]` (`validateRepoContext`).
- The runtime path defends against direct `intersectPermissions({ request: { tool: 'symbol' } })` calls with a typed `tool_unavailable` error pointing at this section.
- The persona prompt vocabulary (`src/prompts/index.ts` `TOOL_DESCRIPTIONS.symbol`) describes the slot as RESERVED with a doc anchor here.

### Reopen condition (locked 4-condition AND)

The reservation lifts only when the operator can show, in `events.jsonl` from real runs (not synthetic fixtures):

1. **High search churn within one phase** — five or more `repo_context_searched` events on the same task within a single phase, hitting overlapping root subsets.
2. **Selected-path manifest saturation** — a `repo_context_searched` event with `selectedPaths.length === maxFilesForNextManifest` (i.e., the agent could not promote everything it considered relevant).
3. **Phase-level retrieval token volume above 200k** — sum of `resultTokensEstimate` across that phase's searches > 200,000 (≈ two-thirds of PLAN's 300k phase token cap consumed by retrieval alone).
4. **A downstream VERIFY or REVIEW failure attributable to missed call sites, missed definitions, or missed impact radius** — a finding whose fingerprint can only be explained by symbol-aware traversal that `glob` / `grep` / `read` would not produce, even with extended caps.

All four must fire together on **at least three runs across at least two repos**. Any single condition firing alone is noise (verbose persona, narrow caps, isolated bug). The fourth condition is load-bearing because it ties the symptom to actual SDLC outcome failure, not retrieval inefficiency.

When the AND fires, reopen the four-way decision documented in `docs/comparison/06-codegraph/COMPARISON.md` § "The real question Codex must answer" (LSP / native tree-sitter+SQLite / consume codegraph as MCP / extend the deferral). Do not promote any of those options without rerunning the cross-model peer-review process.

### Until the reopen condition fires

The slot stays reserved. The validator rejection text and the runtime error message both point at this section. Anyone landing tooling that touches `RepoContextToolName` is responsible for keeping all three rejection points (config validator, runtime guard, prompt vocabulary) in sync with this contract.

## Reference

- **Locked TypeScript shape:** `docs/research/CODEX_RESPONSE_SYNTHESIS.md` "Where I disagree" 3
- **Linked contracts:** [`PLAN.md`](./PLAN.md), [`SOURCE_CHECK.md`](./SOURCE_CHECK.md), [`PROVIDERS.md`](./PROVIDERS.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 13 (privacy by default), 18 (tool_use.repo_context scope)
- **Pinned references:** [`docs/references/agent-skill-format.md`](../references/agent-skill-format.md) (extended in M6 commit 4), [`docs/references/file-based-gates.md`](../references/file-based-gates.md) § 5
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M6.md`](../design/CODEX_RESPONSE_M6.md) decisions 1, 2, 8
- **Reservation decision:** [`docs/comparison/06-codegraph/CODEX_RESPONSE.md`](../comparison/06-codegraph/CODEX_RESPONSE.md) Q8 + synthesis
