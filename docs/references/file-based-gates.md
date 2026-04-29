# File-based gate signals — canonical spec for code-oz

This document is the **pinned spec** for the file-based gate signal mechanism `code-oz` uses to coordinate phase transitions, intervention requests, and run state. It extends the file-only-enforcement pattern from `maestro` with structured success gates and an append-only event log — both `code-oz` extensions.

The upstream is the influence; this file is the authority for `code-oz`. When upstream and this file disagree, this file wins for `code-oz` purposes.

## Provenance

- **Upstream:** `~/Projects/agents/templates/maestro`
- **Upstream HEAD pinned at:** `3672a635e716338a2d89812ff1bfe6f7bc381824` (2026-04-29)
- **Canonical upstream files:**
  - `orchestrator/orchestrator.sh` lines 209–249 — file-existence checks for intervention gates (the no-text-parsing pattern)
  - `orchestrator/README.md` lines 219–226 — the `NEEDS_INTERVENTION` mechanism
  - `CLAUDE.md` line 85 — `.claudeignore` isolation pattern preventing the agent from reading orchestrator code that contains gate keywords (closes a v1 false-positive class)
  - `orchestrator/state.json` schema — `{ cycle_count, consecutive_failures, last_phase, last_session_id, intervention_required, intervention_reason }`

Sync policy: upstream changes do not auto-propagate. When upstream introduces a gate-class file `code-oz` should adopt, update this file and bump the pinned hash above.

## Why this exists

Non-negotiable rule 1 (`CLAUDE.md`): **file-based gate signals only — never parse LLM text output for pass/fail.** This is the hardest-won lesson from maestro v1: text-output scanning had false positives whenever Claude's prose contained the literal words "intervention" or "pause." Maestro v2 fixed it by checking for **files**, not strings.

`code-oz` inherits the rule and the mechanism. Every gate transition — pass, fail, pause, intervene, stop — is a file on disk. Schemas are validated by `src/state/gates.ts`. There is no other source of truth.

## Storage layout (per-run subdirectory)

Every run's gate-class files live in a per-run subdirectory under `.code-oz/state/`:

```text
.code-oz/state/
  active.json                       # { "version": 1, "runId": "01J3Z..." } pointer to active run
  runs/
    01J3Z.../                       # ULID-named directory per run
      events.jsonl
      current.json
      GATE_DEFINE_PASSED.json
      GATE_PLAN_PASSED.json
      ...
      NEEDS_INTERVENTION.json       # optional, present only when written
      PAUSE.json                    # optional
      STOP.json                     # optional
```

`<runId>` is the 26-character Crockford-base32 ULID validated by `src/state/gates.ts`. The active-run pointer file `state/active.json` names the run that orchestration commands (`code-oz approve`, `code-oz status`, `code-oz resume`) operate on by default. Multi-run support is structural: every run has its own subdirectory; v0.1 enforces single-active-run by writing the pointer atomically.

All gate-class file paths shown in the taxonomy below are relative to a run's subdirectory. The fully qualified path is `.code-oz/state/runs/<runId>/<filename>`.

## Gate file taxonomy

`code-oz` defines six file types inside `state/runs/<runId>/`. Three are intervention gates inherited from maestro (`NEEDS_INTERVENTION.json`, `PAUSE.json`, `STOP.json`); two are `code-oz` extensions for typed phase progression and run trace (`GATE_<PHASE>_PASSED.json`, `events.jsonl`); one is a derived convenience state file rebuilt from the event log (`current.json`).

### 1. `NEEDS_INTERVENTION.json` (intervention — deletable to resume)

The orchestrator stops, surfaces a structured error, and waits for the user to delete the file or replace it with a `PAUSE.json` / `STOP.json`.

**When written:** an agent or runtime detects a condition it cannot resolve (provider auth missing, budget exceeded, unrecoverable error, repeated review failure).

**Lifecycle:** the user clears the gate by deleting the file (or replacing it with `PAUSE.json` / `STOP.json`). On the next `code-oz` invocation, the absence of the file is the resume signal.

**Schema (extension over maestro's plain-text reason):**

```json
{
  "version": 1,
  "runId": "01J3Z...ULID",
  "phase": "build",
  "agent": "builder",
  "code": "provider_auth_missing",
  "rule": "CodexProvider could not read OAuth token from ~/.codex/auth.json",
  "detail": "ENOENT: no such file or directory",
  "actionableSuggestions": [
    "run `code-oz doctor providers`",
    "run `codex login` and retry"
  ],
  "createdAt": "2026-04-29T17:00:00Z"
}
```

Fields are required except `detail`. The `code` and `rule` shape mirrors `AgentLoadError`'s `AgentLoadIssue` from M2 — same machine-readable contract.

### 2. `PAUSE.json` (intervention — deletable to resume)

The orchestrator stops at the next phase boundary and waits. The user resumes by deleting the file.

**Lifecycle:** active control file. Deleted by the user to resume. Never archived or moved within the run.

**Schema:**

```json
{
  "version": 1,
  "runId": "01J3Z...ULID",
  "reason": "stepping away — keep state",
  "createdAt": "2026-04-29T17:05:00Z"
}
```

### 3. `STOP.json` (intervention — terminal, never deleted within run)

The orchestrator terminates the run permanently. State is preserved for forensics; resume is not possible from a stopped run.

**Lifecycle:** terminal. Once written, never deleted within the run's lifetime. To start over, increment `runId` (a new run starts a new subdirectory).

**Schema:**

```json
{
  "version": 1,
  "runId": "01J3Z...ULID",
  "reason": "scope changed, restarting",
  "createdAt": "2026-04-29T17:10:00Z"
}
```

### 4. `GATE_<PHASE>_PASSED.json` (success — `code-oz` extension, append-only)

The user (or runtime, in fully-autonomous modes that v0.1 does not yet support) signs off on a phase output. The orchestrator advances to the next phase only when this file exists, schema-validates, and references the expected artifact.

**Lifecycle:** append-only. Once written, never deleted to retry. To redo a phase, start a new `runId` (a new run subdirectory). Cross-file recovery (validation rule 9) handles crash windows where the gate file is on disk but the corresponding `gate_written` event is missing from `events.jsonl`.

**`<PHASE>` is one of:** `DEFINE`, `PLAN`, `BUILD`, `VERIFY`, `REVIEW`, `SHIP`, `AUDIT`.

**Schema:**

```json
{
  "version": 1,
  "runId": "01J3Z...ULID",
  "phase": "define",
  "artifact": "artifacts/SPEC.md",
  "artifactSha256": "8c2e...",
  "agent": "ba",
  "agentProvider": "claude",
  "approvedBy": "user",
  "approvedAt": "2026-04-29T17:15:00Z",
  "notes": "matches the user's stated intent — go"
}
```

Required: `version`, `runId`, `phase`, `artifact`, `agent`, `approvedBy`, `approvedAt`. Optional: `artifactSha256` (locks the artifact contents at signoff so later edits don't silently re-pass the gate), `agentProvider`, `notes`.

`artifactSha256` is the integrity binding: if the artifact changes after the gate file is written, the orchestrator detects mismatch on resume and refuses to advance. Prevents the "I tweaked SPEC.md after the gate; now BUILD is using something we never approved" silent-corruption class.

### 5. `events.jsonl` (run trace — `code-oz` extension)

Append-only JSON Lines event log. One event per line. Schemas validated on append by `src/state/events.ts`.

**Maestro does not have this.** It is a `code-oz` innovation that supports replay, telemetry export, and resume. Per the ROADMAP: "the append-only run trace."

**Event types (v0.1 known set):**

```json
{ "version": 1, "type": "run_started",     "ts": "...", "runId": "...", "profile": "greenfield" }
{ "version": 1, "type": "phase_entered",   "ts": "...", "runId": "...", "phase": "define" }
{ "version": 1, "type": "phase_exited",    "ts": "...", "runId": "...", "phase": "define", "outcome": "passed" }
{ "version": 1, "type": "agent_invoked",   "ts": "...", "runId": "...", "phase": "define", "agent": "ba", "provider": "claude", "manifest": { "files": [{ "path": "...", "sha256": "...", "sizeBytes": 0 }] }, "filesSent": 1, "bytesSent": 0, "tokensEstimate": 0, "fieldsRemovedByScope": 0 }
{ "version": 1, "type": "agent_completed", "ts": "...", "runId": "...", "phase": "define", "agent": "ba", "tokensUsed": 1834 }
{ "version": 1, "type": "gate_written",    "ts": "...", "runId": "...", "phase": "define", "file": "GATE_DEFINE_PASSED.json" }
{ "version": 1, "type": "gate_required",   "ts": "...", "runId": "...", "phase": "define", "blockedOn": "user signoff" }
{ "version": 1, "type": "intervention",    "ts": "...", "runId": "...", "code": "...", "phase": "..." }
{ "version": 1, "type": "run_ended",       "ts": "...", "runId": "...", "outcome": "shipped" | "stopped" | "paused" }
```

Required on every event: `version` (currently `1`), `type`, `ts` (ISO 8601), `runId`. Other fields are type-specific. Lines without `version` are rejected by the canonical reader; future schema bumps increment this number.

**The known event-type set is open after `version: 1`.** Canonical readers must accept events whose `type` is a non-empty string they don't recognize, so long as `version`, `ts`, and `runId` are valid. Recognized types still get strict per-type field validation; unknown types pass shape validation and survive verbatim in the log. This is the forward-compat rule that lets later milestones (e.g., M7's `failure_recorded`) extend the type set without a schema-version bump. Reducers in `src/state/run.ts` ignore unknown types via a `default:` no-op case.

**`agent_invoked` manifest + metric fields (M4 contract).** Wrapper-emitted `agent_invoked` events ALWAYS carry both an explicit file manifest and four context metrics:

- `manifest`: `{ files: { path, sha256, sizeBytes }[] }` — the explicit list of files sent to the provider for that turn. `path` is the file path sent, `sha256` is the content hash at send time (audit trail), `sizeBytes` is the size for budget tracking. The manifest is a record of *what was sent*, not an upper-bound permission check; permissions semantics are defined in `agent-skill-format.md`.
- `filesSent`: non-negative integer. Count of files in the manifest. `0` is legal (no-files invocation).
- `bytesSent`: non-negative integer. Sum of `sizeBytes` across the manifest.
- `tokensEstimate`: non-negative integer. Wrapper-layer pre-call token estimate (the same heuristic used by the cost-budget pre-call check). `0` means "estimator returned zero," not "absent."
- `fieldsRemovedByScope`: non-negative integer. Count of fields the phase-owned manifest builder dropped relative to the upper-bound `permissions.read`. `0` means "no narrowing happened or nothing was removed" (single semantics; never use `null` to distinguish the two cases — the metric tracks evidence of narrowing work, and zero means "no evidence").

Manifest and the four metrics are required-when-`type === 'agent_invoked'` for any event the wrapper emits. The validator in `src/state/events.ts` enforces presence on `agent_invoked` from M4 onward.

`gate_written.file` is the gate filename relative to the run's subdirectory (e.g., `GATE_DEFINE_PASSED.json`), not a full path.

The append must be atomic — partial writes on crash are not permitted. Implement by writing each event line followed by `fsync` (or Bun equivalent). Replay ordering is determined by line position in the file, never by `ts` (clock skew or out-of-process appenders make `ts` unreliable as a sort key).

**Lifecycle:** append-only. Each event line is final once written. The file grows monotonically until the run ends.

### 6. `current.json` (derived state — `code-oz` extension)

A derived convenience state file rebuilt from the event log on each phase boundary. It is **not** authoritative — `events.jsonl` is. `current.json` exists for fast `code-oz status` reads without scanning the entire event log.

**Schema:**

```json
{
  "version": 1,
  "runId": "01J3Z...ULID",
  "profile": "greenfield",
  "currentPhase": "plan",
  "phasesCompleted": ["define"],
  "lastEventAt": "2026-04-29T17:30:00Z"
}
```

Tools must NEVER write `current.json` directly — only the event applier in `src/state/run.ts` writes it, and only by reducing over the event log.

## The .claudeignore isolation pattern (carried over)

Maestro's `.claudeignore` prevents Claude sessions from reading orchestrator code that contains gate keywords like `NEEDS_INTERVENTION`, `PAUSE`, `STOP`. Without this, an agent reading orchestrator source could quote those strings in its prose and trigger the v1 false-positive (which is no longer a problem with file-based gates, but the isolation is still good hygiene — agents should not be reading orchestration internals).

`code-oz` adopts the same pattern via `.code-ozignore` (rule 13: "agents receive explicit file manifests, never silent recursive repo context"). The default `.code-ozignore` template includes `state/`, `runs/`, and `src/state/` so agents in DEFINE/PLAN/BUILD never read gate files or runtime internals.

## Canonical phase → artifact map

`GATE_<PHASE>_PASSED.json.artifact` defaults to a per-phase canonical filename, **relative to the run's artifact root** (v0.1: `.code-oz/artifacts/`). Values below are bare filenames; `resolveArtifactPath` joins them with the artifact root at I/O time.

| Phase | Canonical artifact (relative to artifact root) |
|---|---|
| `define` | `SPEC.md` |
| `audit` | `AUDIT.md` |
| `plan` | `PLAN.md` |
| `build` | `BUILD_REPORT.md` |
| `verify` | `VERIFY.md` |
| `review` | `REVIEW.md` |
| `ship` | `SHIP.md` |

M5+ phases write to these paths by default; `code-oz approve <PHASE>` reads them by default. Override is supported via `--artifact <path>` on the approve command (still subject to path-safety rule 7 below). The map is exported from `src/state/schemas.ts` as `CANONICAL_ARTIFACTS`.

## Validation rules (M3 + M4 loader contract)

The `src/state/gates.ts` and `src/state/events.ts` modules enforce:

1. Every gate file is valid JSON with `version: 1`. Every line of `events.jsonl` is a valid JSON event with `version: 1`.
2. `runId` is a ULID (Crockford base32, 26 chars).
3. `phase` (where present) is in the canonical phase enum.
4. ISO 8601 timestamps for all `*At` fields.
5. `GATE_<PHASE>_PASSED.json` references an `artifact` that exists relative to the run root; if `artifactSha256` is set, the file's actual sha256 must match. Path-safety rules apply (rule 7).
6. The orchestrator never advances a phase by reading agent output text — only by reading and validating the gate file.
7. Gate `artifact` paths are subject to path-safety: relative (no leading `/`), normalized (no `.` or `..` segments after normalization), and must not resolve outside the run/artifact root via symlinks. Violations produce `gate_artifact_path_unsafe`.
8. Replay ordering for `events.jsonl` is line position only — never `ts`. Malformed lines (including non-empty trailing partial writes) are rejected by the canonical reader. A future `code-oz status --tail` may tolerate partials separately.
9. Cross-file recovery: on resume, if a `GATE_<PHASE>_PASSED.json` file exists and validates but the corresponding `gate_written` event is absent from `events.jsonl`, the orchestrator appends the missing event before continuing. The reverse (event present, file absent) produces `gate_written_event_missing_file` and stops the run.
10. Concurrency: gate writes, event appends, active-pointer updates, and `current.json` rebuilds are protected by a per-run lock file. Concurrent attempts produce `lock_busy`.
11. Idempotent approve: re-running `code-oz approve <PHASE>` against an existing `GATE_<PHASE>_PASSED.json` recovers missing events (rule 9) or no-ops if the gate content matches; same phase with different content produces `gate_idempotency_violation`.
12. Open-type-union (M4): the `type` field on event lines is a non-empty string. Recognized types (`run_started`, `phase_entered`, `phase_exited`, `agent_invoked`, `agent_completed`, `gate_written`, `gate_required`, `intervention`, `run_ended`) get strict per-type field validation. Unknown `type` values pass shape validation (`version === 1`, `ts`, `runId`) and survive verbatim in the log. Reducers ignore unknown types via a `default:` no-op. Future milestones extend the recognized set without bumping `version`.
13. `agent_invoked` metric fields (M4): every `agent_invoked` event the wrapper emits carries `manifest`, `filesSent`, `bytesSent`, `tokensEstimate`, `fieldsRemovedByScope`. Each metric is a non-negative integer (`0` is legal). `manifest` is `{ files: { path, sha256, sizeBytes }[] }` with `path` non-empty, `sha256` a 64-char lowercase hex string, `sizeBytes` a non-negative integer. The wrapper layer in `src/providers/invoke.ts` is the only path that emits `agent_invoked`; its events always satisfy this rule.

Any validation failure is reported as a typed `GateLoadError` (gates) or `EventLogError` (events) with `{ file, code, rule, detail? }` — the same shape as `AgentLoadError` from M2.

## Anti-patterns rejected by this spec

- Parsing agent stdout for "intervention" or "approved" — rule 1, hard fail.
- A single mutable `state.json` containing the entire run state (maestro's pattern). `code-oz` uses an event log + derived `current.json` so the audit trail is preserved.
- Writing gate files from inside agent prompts. Only the user (via `code-oz approve`) or the runtime (via specific code paths in `src/state/`) writes gate files.
- Using `unlink` on success gate files (`GATE_<PHASE>_PASSED.json`) to "retry" — success gates are append-only artifacts of decisions. To redo a phase, start a new `runId`. Intervention control files (`NEEDS_INTERVENTION.json`, `PAUSE.json`) **are** intentionally deletable: the user clears the file to resume the run. `STOP.json` is terminal — never deleted within the same run's lifetime.
- Using `ts` to order events on replay. Ordering is determined by line position in `events.jsonl`. Cross-process clock skew or out-of-order appenders make `ts` unreliable as a sort key. `ts` is human-readable audit metadata, not the ordering authority.
- Writing `current.json` directly. Only the reducer in `src/state/run.ts` writes it, and only by reducing over `events.jsonl` on phase boundaries.
- Layering `events.jsonl` writes inside `gates.ts`. Gates module only validates and writes gate files; `run.ts` orchestrates the sequence (write gate → append `gate_written` event → append phase transition events → rebuild `current.json`).

## What this file is not

- **Not the M3 implementation plan.** See `docs/design/SESSION_M3_KICKOFF.md` for that.
- **Not a substitute for reading maestro.** The file-based-only pattern is concrete in `orchestrator/orchestrator.sh`. Read it for the discipline; this file pins the contract for `code-oz`.
- **Not the marketplace contract.** Agent-pack-emitted gate files are out of scope; only the runtime writes gates in v0.1.
