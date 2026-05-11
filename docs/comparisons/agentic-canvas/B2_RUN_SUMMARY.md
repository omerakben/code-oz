# B2 — Derived RunSummary read-model (borrow from agentic-canvas, Codex R1)

## Status

Backlog. Target M17 or W3.x, paired with B1 (`EvidenceClaim` typed evidence union) and consumed by B3 (skill wrappers — `code-oz status` for Claude Code / Codex CLI surfaces) and B4 (read-only viewer — `code-oz view <runId>` on `127.0.0.1`). This spec stub is the inheritance contract for whichever milestone picks it up; do not start the milestone without re-running planning convergence per the cross-model peer review rule in `CLAUDE.md`.

This is the second of five borrows enumerated in `docs/comparisons/agentic-canvas/COMPARISON.md` §3. It was a Codex round-1 missed-borrow finding integrated into the v2 comparison; the comparison itself does not specify the implementation surface, only the rationale. This stub is the implementation surface.

## Source pattern

agentic-canvas's workflow root schema declares an optional top-level `runs[]` array (`~/Projects/agents/templates/agentic-canvas/schemas/agent-canvas.schema.json` lines 37–42, declared as `{"type": "array", "items": {"type": "object"}}` with the body permissive on purpose). The roadmap text that surrounds the schema treats `runs[]` as a portable execution-history slot: viewers, plugins, and agent surfaces consume the slot directly without re-walking internal claim history or per-node `progress` blobs. The element shape is intentionally loose so that workflow-design decisions and execution telemetry can co-evolve.

The borrow is the *idea* of a portable derived run object, not the schema. agentic-canvas's `runs[]` is permissive (`additionalProperties: true` is intentional, in line with their schema philosophy critiqued in COMPARISON.md §4.1); code-oz's port is strict, derived-only, and never authoritative — the gate files in `state/runs/<runId>/GATE_<PHASE>_PASSED.json` and the append-only `events.jsonl` remain the source of truth, exactly as `docs/contracts/GATES.md` and rule 1 require.

The pinned details from `src/state/run.ts` lines 60–179 set the shape of the existing read surface: `RunPaths` already names every input file `RunSummary` will consume, and `reduceEvents` already returns the minimal `RunState` (runId, profile, currentPhase, phasesCompleted, lastEventAt) that `RunSummary` extends. The borrow is a strict superset of `RunState` plus rollups, computed from inputs that the existing helpers already locate.

## Proposed shape in code-oz

A `RunSummary` is a frozen, read-only TypeScript value derived at call time from the canonical state on disk. No file ever holds a `RunSummary` before a gate write authorizes it; the value exists only in memory or on stdout.

```ts
// src/state/run-summary.ts (new module)

export interface RunSummary {
  readonly version: 1
  readonly runId: string
  readonly profile: Profile               // 'greenfield' | 'brownfield'
  readonly phase: Phase                   // current phase from RunState.currentPhase
  readonly status: RunSummaryStatus
  readonly gates: readonly GateSummary[]
  readonly events: EventCounters
  readonly artifacts: readonly ArtifactRef[]
  readonly debate: DebateRollup
  readonly reviewPanel: ReviewPanelRollup
  readonly budget: BudgetRollup
  readonly lastEventAt: string            // ISO 8601, mirrors RunState.lastEventAt
  readonly lastError?: LastErrorRef       // populated only when status === 'needs_intervention' | 'failed'
  readonly derivedAt: string              // ISO 8601, the wall-clock moment the summary was computed
}

export type RunSummaryStatus =
  | 'in_progress'
  | 'needs_intervention'
  | 'paused'
  | 'shipped'
  | 'failed'

export interface GateSummary {
  readonly phase: Phase                   // 'DEFINE' | 'PLAN' | 'BUILD' | 'VERIFY' | 'REVIEW' | 'SHIP' | 'AUDIT'
  readonly passedAt: string               // ISO 8601 from gate.passedAt; gate file timestamp is the authority
  readonly artifactPath: string           // relative to artifactRoot; never absolute, never traverses
  readonly artifactSha256: string         // mirrors GateFile.gate.artifactSha256
  readonly approverNotes?: string         // optional; redacted via .code-ozignore pipeline
}

export interface EventCounters {
  readonly total: number                  // total appended LoggedEvent rows in events.jsonl
  readonly byType: Readonly<Record<string, number>>   // discriminated EventType → count, plus 'unknown' for forward-compat rows
  readonly firstEventAt: string
  readonly lastEventAt: string
}

export interface ArtifactRef {
  readonly phase: Phase                   // phase that produced the artifact
  readonly kind: ArtifactKind             // 'SPEC' | 'PLAN' | 'SOURCE_CHECK' | 'BUILD_REPORT' | 'VERIFY' | 'REVIEW' | 'AUDIT' | 'HYPOTHESES' | 'OPEN_QUESTIONS'
  readonly path: string                   // relative to artifactRoot
  readonly sha256: string                 // computed at derivation time; the gate file's sha is authoritative on read
  readonly bytes: number
}

export type ArtifactKind =
  | 'SPEC' | 'PLAN' | 'SOURCE_CHECK' | 'BUILD_REPORT'
  | 'VERIFY' | 'REVIEW' | 'AUDIT'
  | 'HYPOTHESES' | 'OPEN_QUESTIONS'

export interface DebateRollup {
  readonly count: number                  // total debates fired in this run (M10 requestDebate primitive)
  readonly lastTopic?: string             // truncated to a configured cap; redacted
  readonly inFlight: boolean              // true iff the latest debate has no terminal verdict event
}

export interface ReviewPanelRollup {
  readonly count: number                  // total panel invocations (M14)
  readonly lastVerdict?: PanelVerdict     // mirrors src/state/schemas.ts PanelVerdict union
  readonly inFlight: boolean
}

export interface BudgetRollup {
  // Mirrors budgets.global from .code-oz/config.yaml. Cumulative reads come
  // from events.jsonl via the existing assertWithinBudget helper (rule 19).
  readonly maxTurns?: number
  readonly turnsUsed: number
  readonly maxProviderCalls?: number
  readonly providerCallsUsed: number
  readonly maxTokensEstimate?: number
  readonly tokensUsed: number
  readonly maxWallTimeMinutes?: number
  readonly wallMinutesUsed: number
  readonly priceTable?: string            // path to the active price table, when configured
  readonly dollarsEstimated?: number      // optional; only when priceTable is present
}

export interface LastErrorRef {
  readonly source: 'NEEDS_INTERVENTION' | 'PAUSE' | 'STOP'
  readonly path: string                   // relative to runDir
  readonly message: string                // first line only; redacted via .code-ozignore pipeline
  readonly atEvent?: number               // events.jsonl line index, when correlatable
}
```

The shape mirrors the existing `RunState` interface (`src/state/schemas.ts` lines 1511–1518) and extends it with rollups that today require ad-hoc walks of `events.jsonl`. `RunSummary` deliberately omits raw event bodies and last-N-events arrays; consumers that need the trace read `events.jsonl` directly under their own permission scope.

## Where it lands (proposed)

- **New file: `src/state/run-summary.ts`.** Declares the `RunSummary` interface plus its sub-types and exports a single pure function:
  ```ts
  export async function deriveRunSummary(paths: RunPaths): Promise<RunSummary>
  ```
  The function reads `events.jsonl`, the gate files in `runDir`, the active intervention gate (if any), and the artifact files referenced by passed gates. It returns a frozen value. It writes nothing to disk. The signature mirrors the existing `loadRun(paths: RunPaths)` shape so call sites read identically.
- **Extension to `src/state/run.ts` is read-only.** A re-export for ergonomics — `export { deriveRunSummary, type RunSummary } from './run-summary.ts'` — is acceptable. No new mutation paths in `run.ts`. The reducer (`reduceEvents`) and lifecycle helpers (`initRun`, `loadRun`, `approveGate`, `requireGate`, `readActiveRun`, `writeActiveRun`) are not modified by B2.
- **JSON schema: `src/state/schemas.ts` adds `runSummarySchema` and `isRunSummary`.** The schema is exposed publicly so that downstream consumers (B3 skills, B4 viewer) validate input without depending on the TypeScript surface. Schema versioning starts at `version: 1`; field additions are additive (new optional fields), field renames or removals require a schema-version bump and migration note. The schema sits next to the existing `gateFileSchema`, `runStateSchema`, and `panelVerdictSchema` exports — same module, same validation idiom.
- **CLI surface: `src/cli/commands/status.ts`.** New command `code-oz status [--json] [--run-id <ULID>]`. Default output is human-readable text (one block per phase, one rollup per surface). `--json` emits a stable JSON envelope `{ schemaVersion: 1, runSummary: RunSummary }` to stdout for skill consumers. `--run-id` overrides the active-run pointer; without it, the command resolves the active runId via `readActiveRun`.
- **Test harness: `tests/state/run-summary.test.ts` plus an e2e companion `tests/e2e/status.test.ts`.** Unit tests cover gate-passed states, pre-gate states, brownfield AUDIT path, intervention/pause/stop gates, redaction of approver notes and last-error message, schema-validation round-trip, and idempotency (`deriveRunSummary` is pure with respect to input files). The e2e test spawns the compiled binary, drives a fixture run through every phase using `FakeProvider`, and asserts the JSON envelope at every gate boundary.

No `src/state/events.ts` changes. No new event types. No new gate types. No `current.json` changes. No new lock acquisitions — `deriveRunSummary` is read-only and tolerates concurrent writers because `events.jsonl` line atomicity is already guaranteed (see rule 9 above and the gate contract's "cross-file recovery" note).

## Derivation rules

`RunSummary` carries only the authority of its inputs. The rules are pinned:

1. **Read-only inputs.** `deriveRunSummary` reads from `events.jsonl`, `GATE_<PHASE>_PASSED.json` files, `NEEDS_INTERVENTION.json` / `PAUSE.json` / `STOP.json` if present, and the artifact files referenced by passed gates. It calls no mutating helper.
2. **Never written before a gate write.** No code path persists a `RunSummary` to disk before the corresponding `approveGate` or `approveReviewTaskGate` completes. The summary is a derived view; persisting it pre-gate would inject phase state that was never approved.
3. **Read-only output to consumers.** `RunSummary` is a frozen value (`Object.freeze` at every level). Callers cannot mutate run state through it; the CLI command does not accept arguments that influence the run.
4. **Secret redaction at the boundary.** All free-form string fields (`approverNotes`, `LastErrorRef.message`, `DebateRollup.lastTopic`) pass through the existing `.code-ozignore` redaction pipeline before serialization. The redaction is applied once at the boundary, not on every field access — the in-memory value is already redacted.
5. **Path safety mirrors the gate contract.** `ArtifactRef.path` and `GateSummary.artifactPath` reuse the gate-file path-safety rules in `docs/contracts/GATES.md` (no absolute paths, no `..` segments, no symlink escape). The summary inherits the gate file's authority on artifact identity.
6. **Sha256 binding inherited from gates.** `GateSummary.artifactSha256` mirrors the gate file's `gate.artifactSha256`. `ArtifactRef.sha256` is recomputed at derivation time from the artifact contents; if the recomputed hash drifts from the gate's recorded hash, `deriveRunSummary` raises `gate_artifact_sha256_mismatch` per the existing gate contract — the summary surface does not silently shadow the canonical error class.
7. **Forward-compatible event handling.** Unknown event types in `events.jsonl` (validation rule 12, M4) flow through `EventCounters.byType` under the bucket `'unknown'` and never alter rollup totals tied to specific event types. The reducer's tolerance is preserved at the summary boundary.
8. **No I/O outside the run subdirectory.** `deriveRunSummary` opens files only under `paths.runDir` and `paths.artifactRoot`. It does not touch `state/active.json`, the worktree, or any provider configuration. Consumers wanting the active runId resolve it through the existing `readActiveRun` helper.
9. **Single read pass per derivation.** `deriveRunSummary` reads each input file at most once per call and pins the read snapshot for the duration of the derivation. A snapshot taken mid-write is acceptable (events are append-only and lines are atomic) but the function does not retry. Caller decides cadence.
10. **Telemetry, not control flow.** Nothing in code-oz reads `RunSummary` to decide gate progression. The reducer (`reduceEvents`), gate writers, and lock helpers are the control-flow inputs; `RunSummary` exists for human and skill surfaces.

## Consumers (planned)

**B3 skill wrappers (`code-oz status` for Claude Code / Codex CLI).** The skill wrappers shell out to `code-oz status --json` and present the envelope to the agent surface. The skills do not parse `events.jsonl`, do not read gate files, and never propose a state mutation; they render the summary and exit. This isolates skill code from internal event schema churn — when M17+ adds new event types, the skills inherit the additions through `EventCounters.byType` without redeploy. The COMPARISON.md §3.3 promotion of skill-wrapper distribution from "post-W3 polish" to "W3.x strategic adoption work" depends on this isolation: a skill that stops working when an internal event type changes is a marketplace liability.

**B4 read-only viewer (`code-oz view <runId>` on 127.0.0.1).** The viewer boots a local HTTP server, fetches the summary via the same `--json` flag, and renders the phase graph plus current state plus rollups. The server has no write API; the only command surface is the existing CLI. The viewer reads at most the last 50 events from `events.jsonl` for a debug pane, but the canonical state on screen comes from `RunSummary`. This is the load-bearing constraint that keeps the viewer compatible with rule 1 — write paths through the viewer would conflict with file-based gate signals, exactly as COMPARISON.md §3.4 calls out. The 127.0.0.1-only bind is the rule 13 mitigation; never `0.0.0.0`, never a UDP listener, never a write socket.

**Future canvas-as-frontend hypothesis (`docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md`).** If the convergence path in COMPARISON.md §3.4 step 2 is ever activated, the canvas frontend reads `RunSummary` to render the phase graph and offers human-edit-the-plan affordances *before* the next BUILD attempt. The canvas never writes `RunSummary` and never bypasses gate files; edits flow through the CLI. The summary is the inter-process contract that lets the canvas evolve without coupling to internal state shapes. Per rule 21, the canvas-frontend is hypothesis-tracked, not hypothesis-built; B2 is the wedge that lets the hypothesis be evaluated cheaply if and when measurable demand appears.

**Operator surface (`code-oz doctor`).** A secondary consumer is the existing `code-oz doctor` command, which today inspects environment health. Adding `--include-status` to surface the active run's `RunSummary` would give operators one command to copy-paste into a bug report. This is optional, low-risk, and not on the critical path for B2 closure.

## Why this is borrow-now-not-borrow-later

The B3 and B4 backlog tickets are blocked on a portable read-model. Without `RunSummary`, every skill wrapper and viewer iteration re-implements `events.jsonl` parsing — a leaky surface that drifts as new event types ship. Each downstream surface that re-parses the event log is a place where future event-schema changes can silently break a published skill or viewer build. Borrowing the derived-summary pattern now collapses three potential drift surfaces into one, with one schema to version.

The borrow earns its keep against rule 21 in two ways. First, it is a single sub-surface (a derived view), and rule 20 admits only one new authority per milestone — `RunSummary` is *not* an authority; it inherits authority from the gate files. The milestone implementing B2 is free to ship B1 alongside it because both are pure derivations with no new control-flow effect. Second, the risk reduction is measurable: the M17 milestone closeout records the count of skill / viewer call sites that read `events.jsonl` directly versus through `RunSummary`. The single-surface refactor wins exactly when that ratio inverts.

The convergence path in COMPARISON.md §3.4 names canvas-as-frontend-to-runtime as a plausible UX moat. The summary is the wedge that lets the convergence happen — a canvas frontend that reads `RunSummary` over HTTP can be evaluated without any change to the runtime authority surface. If the hypothesis fails, `RunSummary` still pays for itself through B3 and B4. If it succeeds, code-oz never had to re-architect to support it.

## Cost estimate

- **Sub-surfaces touched:** 3 — new `src/state/run-summary.ts` module, `src/state/schemas.ts` schema additions (`runSummarySchema`, `isRunSummary`), new `src/cli/commands/status.ts`. No existing module's authority changes. Counted by the M16 rule-20 sharper-application memo (sub-surfaces, not authority labels).
- **Commit count estimate:** 4 commits. (1) module + types + schema, (2) `deriveRunSummary` implementation + unit tests, (3) `code-oz status [--json]` CLI command + integration tests, (4) e2e test that exercises the binary against a fixture run with all gate states. Allow a fifth commit for any post-Codex fix-first follow-up; never amend.
- **Risk profile:** Low. Pure derivation; no new control-flow effect; no new event types; no new gate types; redaction reuses an existing pipeline. The three real risks are (a) sha256 recomputation cost on large artifacts (mitigation: cache `ArtifactRef.sha256` computation per derivation; do not recompute across calls), (b) schema-versioning churn if downstream consumers ship before the schema stabilizes (mitigation: hold B3 / B4 until B2 lands schema v1 with a test snapshot), and (c) drift between the in-memory `RunSummary` and a future cached form (mitigation: do not introduce a cache in B2; defer caching to a follow-up that explicitly owns invalidation).

## Rule check

- **Rule 1 (file-based gate signals only):** compatible. `RunSummary` is derived from gate files; gate decisions remain file-based. The summary never authorizes a phase advance.
- **Rule 7 (artifact contracts in plain Markdown):** compatible. `RunSummary` is a JSON sidecar surface, not a phase artifact. Inter-phase handoffs continue to use Markdown.
- **Rule 13 (privacy by default):** needs-care. `LastErrorRef.message`, `DebateRollup.lastTopic`, and `GateSummary.approverNotes` must pass through `.code-ozignore` redaction before serialization. The implementation milestone owns proving this with a redaction test fixture that covers each free-form field.
- **Rule 19 (run-level budget enforcement):** compatible. `BudgetRollup` mirrors `budgets.global`; cumulative spend is read via the existing `assertWithinBudget` helper, never via a parallel state store. The summary surfaces budget data; it does not enforce.
- **Rule 20 (one new authority boundary per milestone):** compatible. `RunSummary` is a derived read-only view; it introduces no authority. Pairing B2 with B1 in the same milestone is allowed under rule 20 because B1 is also a pure typed-evidence schema with no new authority. The implementing milestone must not bundle a third borrow.

## Open questions

1. **Inline events vs. counters only.** Should `RunSummary` include the last N events inline (e.g., last 10 `LoggedEvent` rows for skill-side debugging) or stay counter-only and force the viewer to re-read `events.jsonl` for the trace pane? Counter-only is simpler and keeps the summary small; inline adds skill ergonomics but couples the summary to event schema churn.
2. **Point-in-time vs. lookback for in-flight debate state.** `DebateRollup.inFlight` represents a point-in-time snapshot. Should the summary also expose a lookback window (e.g., debates in the last 24h)? Lookback is useful for B4 viewer dashboards but adds a clock dependency to the derivation; point-in-time is purer.
3. **Public schema vs. internal.** Is the `runSummarySchema` part of the public contract (semver-bumped on change, documented in `docs/references/`) or an internal surface that downstream consumers must adapt to per release? Skill marketplace presence (B3) argues for public; rapid iteration argues for internal.
4. **Cross-run summary surface.** Should there be a `code-oz status --all-runs` flag that emits one `RunSummary` per known runId? Useful for the viewer's run-picker; risky if older runs have non-current schema versions.
5. **Sha256 recomputation policy.** Should `ArtifactRef.sha256` always recompute (catching post-gate corruption) or trust the gate file's recorded hash and skip recomputation? Always-recompute matches the existing gate-read behavior; trust-and-skip is faster on large repos.
6. **Schema-version field placement.** Should `RunSummary.version` be at the top level (mirroring `RunState.version`) or live on a separate envelope returned by the CLI (`{ schemaVersion: 1, runSummary: RunSummary }`)? Top-level is simpler; envelope leaves room for future cross-run wrappers.

## Anti-patterns to avoid

1. **Persisting `RunSummary` to disk before a gate write.** The derived view must never become the source-of-truth that the gate later inherits. If a future milestone needs a cached summary, the cache lives at `state/runs/<runId>/summary.cache.json` and is invalidated on every event append; it is never consulted by the reducer.
2. **Using `RunSummary` as ground truth in tests.** Spine tests assert against `events.jsonl` and gate files. `RunSummary` is asserted as an output of `deriveRunSummary`, never as input that drives the run forward. A test that initializes a run from a hand-rolled `RunSummary` is a bug.
3. **Reading `RunSummary` from inside `reduceEvents`, `approveGate`, or other control-flow helpers.** Control flow reads events and gate files directly. The summary is a one-way derivation surface; making it bidirectional would re-introduce the parsing-LLM-output failure mode that rule 1 exists to prevent.
4. **Skill wrappers that fall back to `events.jsonl` parsing on missing fields.** The whole point of the borrow is to collapse parsing to a single surface. A skill that reads the summary and then parses the event log on its own is a regression; the milestone closeout test should grep for direct event-log reads in skill code and fail if they appear.

## Acceptance criteria for the implementing milestone

- `src/state/run-summary.ts` exports `deriveRunSummary(paths: RunPaths): Promise<RunSummary>` and the full set of summary types listed under "Proposed shape."
- `src/state/schemas.ts` exports `runSummarySchema` and `isRunSummary`. Both validate every shape variant in the unit tests.
- `code-oz status` and `code-oz status --json` commands ship in `src/cli/commands/status.ts`. The text output is human-readable; the JSON output is the documented envelope.
- Tests cover: (a) gate-passed state for every phase, (b) pre-gate / partial-gate state, (c) brownfield AUDIT profile, (d) intervention / pause / stop gates each populating `lastError`, (e) sha256 mismatch surfacing the canonical error class, (f) redaction of `approverNotes`, `lastTopic`, and `LastErrorRef.message` against a fixture `.code-ozignore`, (g) forward-compat behavior for unknown event types, (h) schema-validation round-trip on the CLI output.
- E2E test spawns the compiled binary against a fixture run that has reached every gate state used in production today (including review-panel multi-task and debate-policy in-flight) and asserts `code-oz status --json` returns a schema-valid summary.
- No changes to `src/state/events.ts`. No changes to `src/state/run.ts` other than the optional re-export. No new event types. No new gate types. No `current.json` schema change.
- Codex round 1 + round 2 closure on the milestone PR: both the borrow (B2) and the paired borrow (B1, if shipped together) reviewed independently. Block-push and block-next-milestone findings closed before tag.
- Doc deltas: `docs/contracts/GATES.md` gets a one-paragraph forward reference to the summary surface; `docs/references/` gets the new pinned spec for the schema; `CLAUDE.md` quick-references list adds `code-oz status`.
- Closes COMPARISON.md §7 action 2 (the EvidenceClaim + RunSummary backlog ticket) jointly with B1.
