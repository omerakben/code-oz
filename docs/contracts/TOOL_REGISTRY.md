---
name: tool registry and safety
companion-docs: ../../CLAUDE.md (rules 1, 13, 16, 18, 20), ./REPO_CONTEXT.md (worked sub-scope), ./DEBATE_POLICY.md (worked sub-scope), ../references/provider-contract.md (IAgentProvider)
target: any tool_use.* sub-scope contract; runtime tool dispatch and permission evaluation
status: contract — defines the canonical safety semantics for tool registration, concurrency classification, permission evaluation, and audit
---

# TOOL_REGISTRY (v0.1)

User-facing contract for the **canonical safety semantics** that any `tool_use.*` permission sub-scope inherits. This document does not introduce a new authority boundary; it codifies what is already implicit in the two existing sub-scopes (`tool_use.repo_context`, `tool_use.debate`) so the next sub-scope cannot quietly relax it.

The pattern is borrowed from `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md` (B5 in the session-07 comparison synthesis). The course articulates four mechanics that production agent runtimes need: fail-closed registration defaults, per-call concurrency classification, a stateful multi-source permission evaluator, and bypass-immune protected-pattern lists. Code-oz already enforces variants of all four; this contract names them and pins the shape so future `tool_use.*` work is reviewable against an explicit checklist.

## 1. Scope and what this contract owns

This contract is the **generalized** safety surface. The sub-scope contracts (`REPO_CONTEXT.md`, `DEBATE_POLICY.md`) are **instantiations**.

**Defines (in this contract):**

- The `ToolDefinition` registration shape with fail-closed defaults.
- The runtime classification function for per-call concurrency partitioning.
- The five-layer permission evaluation pipeline with strict priority order and stateful side effects.
- The protected-paths and protected-commands lists that bypass auto-approve.
- The audit event shape for `tool_concurrency_partition` and `tool_protected_pattern_matched`.
- The tool-safety review checklist any new `tool_use.*` sub-scope must satisfy before its sub-scope contract is accepted.

**Does NOT define (lives in the sub-scope contract):**

- Specific tool implementations (`glob` / `grep` / `read` belong to `REPO_CONTEXT.md`; `requestDebate` belongs to `DEBATE.md`).
- Specific permission rule grammar — that's runtime config under `.code-oz/config.yaml`, owned by the sub-scope.
- New authority boundaries — rule 20 still applies. This contract codifies what is already implicit; it does not introduce new gates, new permissions, new phases, or new event types beyond the two audit events listed above.
- Tool implementations not behind a `tool_use.*` scope (e.g., the wrapper's own file-loading via `src/providers/manifest.ts`). Those are not "tools" in the sub-scope sense; they are part of the provider contract.

**Cross-references:**

- `REPO_CONTEXT.md` is the worked example for the `tool_use.repo_context` sub-scope: `glob` / `grep` / `read` are read-only and concurrent-safe; network is denied; result paths flow through the next manifest, not hidden context.
- `DEBATE_POLICY.md` (and `DEBATE.md`) is the worked example for the `tool_use.debate` sub-scope: `requestDebate()` is single-opponent, single-concurrent, cross-family-enforced.
- `../references/provider-contract.md` defines what a "tool" is in code-oz at the provider seam (`ProviderToolCall`, the streaming `tool_call` / `tool_result` event pair). This contract sits one level above: it defines what a `tool_use.*` sub-scope's runtime must satisfy regardless of which adapter is invoking it.

## 2. Registration shape (fail-closed defaults)

Adapted from `tool-registry-pattern.md:70-102` to code-oz's TypeScript style (mirrors `IAgentProvider` and `AgentPermissions` in `../references/provider-contract.md`).

```ts
type ToolSubScope =
  | 'repo_context.glob'
  | 'repo_context.grep'
  | 'repo_context.read'
  | 'repo_context.symbol'
  | 'debate.request'
  // future tool_use.* sub-scopes append here

interface ToolDefinition {
  readonly name: string                                // canonical tool name (e.g., 'glob')
  readonly subScope: ToolSubScope                      // the parent permission sub-scope
  readonly handler: (call: ToolCall, ctx: ToolContext) => Promise<ToolResult>

  // Safety classification — both fields default to FALSE when omitted.
  readonly isReadOnly?: boolean                        // default: false
  readonly isConcurrentSafe?: boolean                  // default: false

  // Optional custom permission logic. When present, runs as the last step
  // of the pipeline (Section 4) before the registration-time defaults apply.
  readonly permissionCheck?: (
    call: ToolCall,
    ctx: PermissionContext,
  ) => Promise<PermissionResult>

  // Bypass-immune patterns specific to this tool. Merged with the
  // contract-wide protected lists in Section 5; tool-specific patterns
  // never relax the contract-wide ones, only extend them.
  readonly protectedPathPatterns?: readonly string[]
  readonly protectedCommandPatterns?: readonly string[]
}

type PermissionResult = 'allow' | 'deny' | 'ask' | 'defer'
```

### Default-deny posture (load-bearing)

A tool registered without explicit `isReadOnly: true` AND `isConcurrentSafe: true` MUST:

1. Run **serially** — the runtime never parallelizes a batch that contains a non-concurrent-safe call.
2. Pass through the **full permission pipeline** before its `handler` is invoked.

This protects against:

- Accidental concurrent state mutation when a new tool is registered without auditing its side-effect surface.
- Silent data corruption from races between read-only and write-capable invocations of the same tool family.
- A misconfigured registration claiming `isConcurrentSafe: true` for a tool that mutates shared state (the registration must justify the claim against this contract's checklist).

Mirrors the source pattern's "Default to Fail-Closed" rule (`tool-registry-pattern.md:15-19`). The TypeScript shape encodes the rule by leaving both fields optional with default `false`; consumers must positively assert safety, never inherit it.

### Worked example: `tool_use.repo_context.search`

`glob` and `grep` are **read-only AND concurrent-safe** — registered with both flags `true`. The runtime may parallelize a batch of N glob/grep calls that target paths within the agent's `permissions.read` set. `read` is **read-only AND concurrent-safe** for the same reason: native filesystem reads with byte caps do not race against each other.

A hypothetical future `tool_use.repo_context.write` (NOT in v0.1; reserved for illustration) would register with `isReadOnly: false`, `isConcurrentSafe: false`. The runtime would force every write call into a serial segment, forbid parallel partitions, and route every call through the permission pipeline regardless of caller history. The `tool_use.repo_context` sub-scope contract would have to declare the write tool explicitly and pass this contract's safety review checklist (Section 6) before landing.

### Worked example: `tool_use.debate.request`

`requestDebate()` is **NOT read-only** (it produces gate-class artifacts: `DECISION.md`, debate event records) and **NOT concurrent-safe** (M10 `maxConcurrent: 1`). Both fields default to `false`; the registration is correct without setting them. The pipeline serializes every call and forces full permission evaluation. See `DEBATE.md` for the underlying primitive and `DEBATE_POLICY.md` for the scheduler that fires it.

## 3. Per-call concurrency classification (the central insight)

Source: `tool-registry-pattern.md:21-37`.

The same tool can be safe for some inputs and unsafe for others. **Concurrency classification is per-call, not per-tool.** A static per-tool flag is not enough; the runtime must inspect each call's arguments before deciding to parallelize.

### Examples

```
Safe (can run in parallel):
  - cat file.txt
  - grep "pattern" src/
  - ls -la
  - read({ path: 'src/state/lock.ts', lineRange: [1, 80] })
  - glob({ pattern: 'src/**/*.ts' })

Unsafe (must run serially):
  - rm -rf build/
  - sed -i 's/old/new/g' *.ts
  - npm install (network + filesystem mutation)
  - any write to a path matching protected_paths
  - any command matching protected_commands
```

### Runtime contract

The wrapper's tool-dispatch loop partitions a batch of `ProviderToolCall` events as follows:

```ts
function isCallConcurrentSafe(call: ToolCall, def: ToolDefinition): boolean {
  // Step 1: registration-level gate. A tool that is not declared
  // concurrent-safe at registration NEVER enters a parallel partition,
  // regardless of input. This is the fail-closed guard.
  if (def.isConcurrentSafe !== true) return false

  // Step 2: per-call argument inspection. Even a concurrent-safe tool
  // can become unsafe on specific inputs (a path matching a protected
  // pattern, a regex pattern that mutates files, etc.). The check
  // delegates to the sub-scope contract's classifier (see, e.g.,
  // REPO_CONTEXT.md's read/glob/grep argument shape).
  return classifyCallByArguments(call, def) === 'safe'
}
```

The runtime then partitions the batch into consecutive groups: contiguous safe calls form a parallel partition; any unsafe call starts a new serial segment. A batch of `[safe, safe, unsafe, safe, safe]` produces three partitions: `[safe, safe]` parallel, `[unsafe]` serial, `[safe, safe]` parallel.

### Anti-pattern

Registering a tool with a static concurrency flag and trusting the flag without re-checking inputs at dispatch. The source pattern shows this in its `toolRegistry.register('shell', { concurrentSafe: false })` example (`tool-registry-pattern.md:79`). For `shell`, that's the right call — but for any tool whose argument space includes both safe and unsafe inputs, a static flag is wrong. The classification function MUST run per call.

### Audit event

When classification changes the dispatch shape — i.e., when the runtime would have parallelized N calls but partitioned into M > 1 segments because of unsafe calls in the batch — emit `tool_concurrency_partition` to `events.jsonl`:

```ts
{
  version: 1,
  type: 'tool_concurrency_partition',
  ts: string,                                // ISO-8601
  runId: string,
  phase: PhaseName,
  agent: string,
  toolBatchSize: number,                     // total calls in the batch
  partitions: ReadonlyArray<{
    readonly kind: 'parallel' | 'serial'
    readonly callCount: number
    readonly subScope: ToolSubScope
  }>
  unsafeCallReasons: readonly string[]       // why each unsafe call was partitioned
                                             // (e.g., 'path matches protected_paths',
                                             //  'argument-classifier returned unsafe')
}
```

Audit-only; not budget-counted (mirrors `repo_context_searched` accounting in `REPO_CONTEXT.md` § Accounting). The event lets reducers measure how often concurrency classification fires and which tools / inputs trigger serialization.

## 4. Permission pipeline (stateful, not pure)

Source: `tool-registry-pattern.md:41-51, 105-131`.

The permission evaluator is **multi-source** and **stateful**. Each call re-runs the full pipeline; results are never cached across calls.

### Strict priority order (top to bottom = highest to lowest)

1. **Policy** — org-wide settings. Empty in v0.1; reserved for future SaaS / multi-tenant deployments.
2. **User settings** — `~/.code-oz/config.yaml` (per-user, applies across all projects).
3. **Project rules** — `<repo>/.code-oz/config.yaml` (committed; applies to everyone working on the project).
4. **Local overrides** — `<repo>/.code-oz/config.local.yaml` (gitignored; per-developer machine-local overrides).
5. **Session grants** — in-memory grants from the current run (e.g., the agent asked for permission and the operator granted it for this session).

Each layer returns one of three results: `allow` / `deny` / `defer` (consult the next layer). A layer's `allow` or `deny` is final; only `defer` continues. The first non-`defer` result wins.

```ts
async function evaluatePermission(
  toolCall: ToolCall,
  def: ToolDefinition,
  context: PermissionContext,
): Promise<PermissionResult> {
  // Step 0: bypass-immune check ALWAYS runs first (Section 5).
  // If a path or command matches a protected pattern, the result is
  // 'ask' (or 'deny' under --no-confirm), bypassing every layer below.
  const protectedResult = checkProtectedPatterns(toolCall, def, context)
  if (protectedResult !== 'defer') return protectedResult

  // Step 1: policy (org-wide; empty in v0.1)
  const policyResult = await context.policyEngine.check(toolCall, context)
  if (policyResult !== 'defer') return policyResult

  // Step 2: user settings
  const userResult = await context.userSettings.check(toolCall, context)
  if (userResult !== 'defer') return userResult

  // Step 3: project rules
  const projectResult = await context.projectRules.check(toolCall, context)
  if (projectResult !== 'defer') return projectResult

  // Step 4: local overrides (gitignored, machine-local)
  const localResult = await context.localOverrides.check(toolCall, context)
  if (localResult !== 'defer') return localResult

  // Step 5: session grants (in-memory, ephemeral)
  const sessionResult = context.sessionGrants.check(toolCall, context)
  if (sessionResult !== 'defer') return sessionResult

  // Step 6: tool's optional custom permissionCheck (registration-time).
  if (def.permissionCheck) {
    const customResult = await def.permissionCheck(toolCall, context)
    if (customResult !== 'defer') return customResult
  }

  // Step 7: registration default. A tool that reaches this step inherits
  // the fail-closed posture: read-only AND concurrent-safe tools default
  // to 'allow'; everything else defaults to 'ask'.
  return def.isReadOnly === true && def.isConcurrentSafe === true
    ? 'allow'
    : 'ask'
}
```

### Stateful side effects (load-bearing)

The evaluator IS stateful. Specifically, the `context` argument tracks:

- **Denial history** — every `deny` result is appended to a per-run denial log. Future telemetry / rate-limiting hooks consume this; v0.1 emits it for audit only.
- **Mode transformations** — within a session, an `auto` mode that produces a `deny` for a given tool MAY transform to `ask` for subsequent calls of that same tool. The default mode-transform table is empty in v0.1; the seam exists for sub-scope contracts to opt in.
- **Session-grant updates** — when an operator grants permission for a single call vs. for the rest of the session, the session-grants store is updated in place. Subsequent calls in the same run see the updated state.

Because of the stateful contract, the evaluator is **not a pure function**. Two sub-rules follow:

1. **Never cache permission results across calls.** Each `evaluatePermission` invocation re-runs the full pipeline.
2. **Never reorder concurrent permission evaluations.** When a batch of safe calls is partitioned for parallel dispatch, each call's permission evaluation still runs in batch-arrival order against the shared context. Parallel handler execution does not imply parallel permission evaluation.

Mirrors source pattern Gotcha #2 (`tool-registry-pattern.md:157`): "Permission evaluation has side effects — don't cache results across calls."

### Cross-reference: REPO_CONTEXT.md as an instance

`REPO_CONTEXT.md`'s permission semantics for `tool_use.repo_context.*` are an **instance** of this pipeline. The roots intersection (`agent.permissions.read`) at `REPO_CONTEXT.md` § "Privacy and root semantics" is the project-rules layer's check for repo_context. The `maxResults` / `maxBytesPerResult` / `timeoutMs` caps in `REPO_CONTEXT.md` § "Locked default caps" are the registration-default constraints applied after a permission evaluator returns `allow`. This contract is the general shape; that contract is the worked sub-scope.

## 5. Protected paths and protected commands (bypass-immune)

Source: `tool-registry-pattern.md:137-152`.

Some operations should NEVER be auto-approved, regardless of any layer's `allow` result. The protected-pattern check runs **first** in the permission pipeline (Section 4, Step 0) — earlier than policy, earlier than user settings, earlier than session grants.

### Contract-wide protected paths

Every tool whose argument space includes filesystem paths MUST check the call against this list before dispatch:

```
/etc/**
/usr/**
/sys/**
/proc/**
node_modules/**
.git/**
~/.ssh/**
~/.aws/**
~/.config/**
**/.env
**/.env.*
**/*credentials*
**/*secret*
```

Plus the rule 13 privacy boundary: any path **outside the active run's worktree root**. The worktree root is the canonical path returned by the M7 `WORKTREE.md` contract; paths above it (i.e., paths whose canonical form does not start with the worktree root) match as protected even if no glob in the list above matches them.

### Contract-wide protected commands

Every tool whose argument space includes shell-like command strings MUST check the call against this list:

```
rm -rf*
rm -fr*
rmdir -p*
mkfs*
dd of=*
DROP TABLE*
DROP DATABASE*
DELETE FROM*
TRUNCATE*
git push --force*
git push -f*
git reset --hard*
git checkout -- *
chmod -R 777*
chown -R*
sudo*
```

The list is conservative; matching a pattern does not mean the command is destructive in the calling context, only that it requires explicit confirmation. False positives are acceptable here; false negatives are not.

### Implementation contract

Pattern lists live in `src/runtime/protected-patterns.ts` (the file is downstream; this contract DECLARES its expected exports — implementation lands when the next `tool_use.*` sub-scope earns it):

```ts
// src/runtime/protected-patterns.ts (declared, not implemented in v0.1)
export const CONTRACT_WIDE_PROTECTED_PATHS: readonly string[]
export const CONTRACT_WIDE_PROTECTED_COMMANDS: readonly string[]

// Each tool's optional protectedPathPatterns / protectedCommandPatterns
// from its ToolDefinition (Section 2) is merged with the contract-wide
// lists at registration time. The merge is union-only; sub-scope
// patterns can EXTEND the lists, never remove entries.
export function resolveProtectedPatterns(
  def: ToolDefinition,
): { paths: readonly string[]; commands: readonly string[] }
```

### Behavior on match

When a call matches a protected pattern:

- The pipeline's Step 0 returns `'ask'` by default (operator must confirm before dispatch).
- When `--no-confirm` is set on the run (or when the run is non-interactive AND no confirmation source is configured), the result transforms to `'deny'`. The call never runs.
- The session-grants layer CANNOT auto-approve a protected match. An operator may grant permission for the single call, but the grant does not extend to subsequent calls matching the same pattern (they re-trigger Step 0 fresh).

### Audit event

Every protected-pattern match emits `tool_protected_pattern_matched` to `events.jsonl`, whether the call ultimately runs or not:

```ts
{
  version: 1,
  type: 'tool_protected_pattern_matched',
  ts: string,
  runId: string,
  phase: PhaseName,
  agent: string,
  subScope: ToolSubScope,
  matchKind: 'path' | 'command' | 'worktree_escape',
  matchedPattern: string,                    // the literal pattern that matched
                                             // (NEVER the path/command itself —
                                             // rule 13 privacy)
  resolution: 'asked-and-allowed'
            | 'asked-and-denied'
            | 'denied-no-confirm'
            | 'denied-session-grant-rejected'
}
```

The `matchedPattern` field carries the pattern, not the offending path or command, to avoid leaking sensitive content (a path like `~/.env.production` matches `**/.env.*` but the path itself stays out of the event). Sub-scope contracts MAY add additional fields; they MAY NOT remove any of the fields above.

### Append-only at the contract level

The `CONTRACT_WIDE_PROTECTED_PATHS` and `CONTRACT_WIDE_PROTECTED_COMMANDS` lists are **append-only at the contract level**. PRs that modify either list (additions or removals) require Codex review explicitly noting the change in the review prompt; the review verdict must reference the rationale for the change. Removals from the list cross a trust boundary and are blocked-by-default in review.

Sub-scope-level extensions (via `ToolDefinition.protectedPathPatterns` / `protectedCommandPatterns`) follow the sub-scope contract's review process; they do not require this contract to update.

## 6. Tool safety review checklist

A new `tool_use.*` sub-scope MUST satisfy this checklist before its sub-scope contract is accepted into `docs/contracts/`. The checklist is the safety bar code-oz applies to every permission-gated tool surface.

### Classification

- [ ] `isReadOnly` value declared in registration (true / false / depends on args — if depends, document the classifier).
- [ ] `isConcurrentSafe` value declared in registration (true / false / depends on args).
- [ ] Per-call concurrency-classification function (Section 3) provided when concurrency depends on arguments.
- [ ] Unsafe input patterns documented in the sub-scope contract (with examples).
- [ ] Worked example included showing one safe call and one unsafe call for the tool.

### Permission requirements

- [ ] Default permission mode set in registration (the registration default falls out of `isReadOnly` + `isConcurrentSafe` per Section 4 Step 7; document the resolved default explicitly).
- [ ] Bypass-immune patterns (Section 5) defined — at minimum, the contract-wide lists apply; the sub-scope MAY extend them via `ToolDefinition`.
- [ ] Custom `permissionCheck` implemented (when sub-scope-specific logic is required beyond the five layers).
- [ ] Audit logging enabled — at minimum, `tool_concurrency_partition` (when classification fires) and `tool_protected_pattern_matched` (always). Sub-scopes MAY add their own audit events (e.g., `repo_context_searched`).
- [ ] Cross-referenced from `REPO_CONTEXT.md` or `DEBATE_POLICY.md` as a worked example IF the new sub-scope is structurally similar; otherwise, the sub-scope's own contract serves as its worked example.

### Testing

- [ ] Tested with safe inputs — pipeline returns `allow`, handler runs, no `tool_protected_pattern_matched` event.
- [ ] Tested with unsafe inputs — pipeline returns `ask` or `deny`, handler does NOT run when result is `deny`, `tool_protected_pattern_matched` event emitted.
- [ ] Tested concurrent execution — batches with mixed safe/unsafe calls partition correctly; `tool_concurrency_partition` event emitted; serial segments respect order.
- [ ] Tested error handling — handler failures are caught, logged via the existing `ProviderError` path or sub-scope-specific error type; state remains consistent (no partial side effects when serial ordering matters).
- [ ] Tested protected-pattern matching — every pattern in the contract-wide list AND every sub-scope-added pattern has at least one matching test fixture.

### Audit and review

- [ ] Sub-scope's audit event shape documented in the sub-scope contract (e.g., `repo_context_searched` in `REPO_CONTEXT.md`).
- [ ] Codex review on the sub-scope contract before the contract lands.
- [ ] Cross-references added to `CLAUDE.md` non-negotiable rules (typically rules 1, 13, 16, 20 — verify which rules apply to the sub-scope's specifics).

## 7. Anti-patterns

If you find yourself doing any of these, stop. Each item names the trap, the symptom, and the fix.

1. **Static per-tool concurrency flag without per-call classification.** Symptom: the registration sets `isConcurrentSafe: true` and the runtime parallelizes every call regardless of arguments; eventually a destructive input slips through and corrupts state. Fix: implement the per-call classifier (Section 3); the registration flag is necessary but not sufficient.

2. **Caching permission results across calls.** Symptom: a session grant for one call is silently reused for subsequent calls; mode-transform side effects do not fire because the cached result short-circuits the evaluator. Fix: re-run `evaluatePermission` for every call (Section 4). Permission evaluation IS stateful precisely because no result should be cached.

3. **Default-allow for tools without custom permission logic.** Symptom: a new tool registers without `permissionCheck` and without claiming `isReadOnly: true` AND `isConcurrentSafe: true`, but the runtime defaults its permission to `allow`. Fix: the Section 4 Step 7 default is `ask` for any tool not positively asserted as both read-only AND concurrent-safe. The default-deny posture is the contract's central guarantee.

4. **Folding tool-registry semantics into REPO_CONTEXT.md.** Symptom: a future PR proposes to expand `REPO_CONTEXT.md` with general tool-safety semantics (concurrency classification, multi-source permission pipeline, protected-pattern lists). Fix: REPO_CONTEXT.md is scope-locked to `tool_use.repo_context` with `network: 'none'` (rule 18 + the contract's own discipline). Broad tool-registry semantics dilute the sub-scope's discipline. Land them in this contract instead. This is the literal Codex Q5 rejection from the session-07 comparison.

5. **Adding a new `tool_use.*` sub-scope without updating this contract's checklist.** Symptom: the new sub-scope's contract lands without explicit citations to Sections 2 / 3 / 4 / 5 / 6 of this document; reviewers can't tell whether the safety bar was met. Fix: every new `tool_use.*` sub-scope contract MUST cross-reference this contract by section number and MUST satisfy Section 6's checklist before merge. Rule 20 says one authority per milestone — but this contract's checklist applies to the sub-scope contract regardless of which milestone it ships in.

6. **Bypass-immune list as runtime config, not contract.** Symptom: an operator's `.code-oz/config.yaml` removes a contract-wide protected-pattern entry (e.g., disables `**/.env*` matching for performance reasons). Fix: contract-wide lists are NOT operator-configurable. Sub-scope-level extensions (via `ToolDefinition`) ARE configurable through the sub-scope contract. The contract-wide list is append-only and modifications require Codex review (Section 5 § "Append-only at the contract level").

7. **Adapter-side permission checks instead of wrapper-side.** Symptom: a provider adapter implements its own permission filter on tool calls before forwarding them to the wrapper. Fix: per `../references/provider-contract.md` § "Validation rules summary" rule 2, adapters NEVER enforce permissions; the wrapper does. The permission pipeline (Section 4) lives at the wrapper layer (`src/providers/invoke.ts` and friends). Adapter-side checks are duplication and create drift.

8. **Holding the per-run lock across permission evaluation.** Symptom: a tool dispatch holds `.code-oz/state/<runId>/.run.lock` while waiting for an operator confirmation prompt; concurrent runs block. Fix: permission evaluation that requires operator interaction MUST release the lock before prompting and re-acquire it after the result. Mirrors the lock boundaries in `../references/provider-contract.md` § "Lock boundaries": short locks, never one long lock.

9. **Treating `defer` as `allow` at the bottom of the pipeline.** Symptom: every layer returns `defer`, so the registration default fires (Section 4 Step 7); a sub-scope assumes `defer` at the bottom means "go ahead." Fix: the registration default is `ask` for non-safe tools, NOT `allow`. Reaching the bottom of the pipeline with `defer` is normal; the default-deny posture takes over from there.

10. **Logging the matched path or command in `tool_protected_pattern_matched`.** Symptom: the audit event records `path: '/Users/me/.env.production'`. Fix: only the matched **pattern** goes into the event (Section 5 § "Audit event"). Paths and command strings stay out of `events.jsonl` to preserve rule 13 privacy. The pattern is enough to attribute the match; the offending value lives in transient runtime state, not audit.

## When this contract fires

This contract fires for every existing and future `tool_use.*` permission sub-scope. Today it covers `tool_use.repo_context` (worked example: `REPO_CONTEXT.md`) and `tool_use.debate` (worked example: `DEBATE_POLICY.md` and `DEBATE.md`). When the next sub-scope is proposed — `tool_use.upstream_native_tools`, `tool_use.web_search`, `tool_use.repo_context.write`, `tool_use.shell`, or any other extension — its sub-scope contract MUST cite this document by section number and MUST satisfy Section 6's review checklist before landing. The intent is structural: code-oz's tool-safety bar should be reviewable from one document, not reconstructed from each sub-scope's prose.
