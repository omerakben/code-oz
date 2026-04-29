# Gate contract — user guide

This is the user-facing summary of how phase gates work in `code-oz`. The authoritative pinned spec lives in [`docs/references/file-based-gates.md`](../references/file-based-gates.md); this file orients you to the model and the rules you'll bump into during day-to-day use.

## What a gate is

Every phase in a `code-oz` run ends at a gate. The gate is **a file on disk**, not a string in agent output. The orchestrator advances a run only when the gate file exists, schema-validates, and references the artifact you approved.

There are three kinds of gates:

- **Success gates** — `GATE_<PHASE>_PASSED.json`, written by `code-oz approve`. Append-only: once written, never deleted to retry. To redo a phase, start a new `runId`.
- **Intervention gates** — `NEEDS_INTERVENTION.json`, `PAUSE.json`. Active control files. The user **deletes** the file to clear the gate and resume.
- **Terminal gate** — `STOP.json`. Permanently ends the run. State is preserved for forensics; resume is not possible.

## Where gates live

```
.code-oz/state/
  active.json                       # { "version": 1, "runId": "01J3Z..." } pointer
  runs/
    01J3Z.../                       # ULID-named directory, one per run
      events.jsonl                  # append-only run trace
      current.json                  # derived state (rebuilt on phase boundaries)
      GATE_DEFINE_PASSED.json
      GATE_PLAN_PASSED.json
      ...
```

The active-run pointer (`state/active.json`) names the run that orchestration commands operate on by default. v0.1 enforces single-active-run; multi-run is structural (each run has its own subdirectory).

## What `code-oz approve` does

```bash
code-oz approve [PHASE] [--artifact PATH] [--notes TEXT]
```

- **Without PHASE**: reads the active run's current phase and prompts you to confirm.
- **With PHASE**: PHASE must match the run's current phase. Skipping ahead or approving an already-passed phase is rejected.

What happens when you approve, in order, under a single per-run lock:

1. Validate the gate object (schema, ULID `runId`, ISO timestamp, path safety on `artifact`).
2. Verify the artifact file exists and compute its sha256.
3. Atomically write `GATE_<PHASE>_PASSED.json` (temp file → fsync → rename → directory fsync).
4. Append `gate_written` event to `events.jsonl` (per-event fsync).
5. Append `phase_exited` event with `outcome: "passed"`.
6. Append `phase_entered` event for the next phase, **or** `run_ended` if the phase was terminal.
7. Rebuild `current.json`.

If you re-run `code-oz approve` for a phase whose gate already exists with identical content, the call is a no-op (idempotent recovery). Different content fails with `gate_idempotency_violation`.

## Path safety on `gate.artifact`

Validation rule 7 in the pinned spec rejects:

- Absolute paths (`/etc/passwd`).
- Backslash separators (Windows-style).
- Any normalized path with `..` segments (`../foo`, `docs/../../escape`).
- Symlinks that resolve outside the artifact root (`.code-oz/artifacts/`).

The synchronous checks happen before any filesystem touch; the symlink-escape check uses `realpath` after the artifact file is opened.

## Sha256 integrity binding

When `code-oz approve` writes a success gate, it computes `gate.artifactSha256` from the artifact's contents at approval time. On every subsequent read, the orchestrator re-hashes the artifact and compares.

If the artifact was modified after the gate was written, the next read fails with `gate_artifact_sha256_mismatch`. This catches the silent-corruption class: "I tweaked SPEC.md after approving, and now BUILD is using something we never approved."

The pinned spec keeps `artifactSha256` optional on read (`code-oz` accepts gates without it for backward compatibility with future tooling) but `code-oz approve` always writes it.

## Cross-file recovery

A crash window between writing the gate file and appending the `gate_written` event leaves the state inconsistent: gate on disk, no event. On the next `loadRun`, the orchestrator detects the orphan and appends the missing event automatically. Validation rule 9.

The reverse condition (event present, gate file absent) is unrecoverable — `code-oz` will not synthesize gate files from events. You'll see `gate_written_event_missing_file` and need to start a new run.

## What you can commit; what you shouldn't

The bundled `.gitignore` excludes:

- `state/active.json` — local single-active-run pointer
- `state/runs/` — every per-run subdirectory (events, gate files, current.json)
- `runs/` — per-run worktrees (M7+)

This makes runs **local by default**. Sharing a run is an explicit bundle/export step (W4+) — committing in-progress run state would mix transient files with intentional decisions. To share a run after completion, use `code-oz bundle <runId>` (post-v0.1).

What **is** worth committing:

- `config.yaml` — run configuration shared by the team
- `agents/` — project-local persona overrides
- `artifacts/` — phase outputs (SPEC.md, PLAN.md, ...) once finalized

## Common errors and what they mean

| Error code | Meaning | Action |
|---|---|---|
| `gate_invalid_runid` | runId is not a 26-char Crockford ULID | Check the gate file or active.json — likely manual edit |
| `gate_invalid_phase` | phase is not in the canonical set | Same — manual edit, or out-of-sync code |
| `gate_artifact_missing` | artifact file referenced by the gate does not exist | Restore the artifact, or start a new run |
| `gate_artifact_path_unsafe` | artifact path tries to escape the artifact root | Use a relative path inside `.code-oz/artifacts/` |
| `gate_artifact_sha256_mismatch` | artifact was modified after gate was written | Restore the artifact or start a new run |
| `gate_idempotency_violation` | re-approving a phase with different content | Start a new runId to redo a phase |
| `gate_written_event_missing_file` | event log says a gate was written but the file is gone | Unrecoverable; start a new run |
| `gate_lock_busy` | another `code-oz` process holds the per-run lock | Wait for the other process, or check for a stale `.lock/` directory |
| `event_invalid_version` | events.jsonl line lacks `version: 1` | Pre-M3 log; not supported in v0.1 |
| `event_partial_line` | malformed line in events.jsonl | Crash mid-write; investigate before continuing |
| `event_lock_busy` | another process holds the per-run lock during an event append | Same as `gate_lock_busy` |

## Reference

- **Pinned spec:** [`docs/references/file-based-gates.md`](../references/file-based-gates.md) — schemas, validation rules, anti-patterns, lifecycle for each gate class
- **Design rationale:** [`docs/adr/0001-mvp-option-e.md`](../adr/0001-mvp-option-e.md) — why state is `events.jsonl` + derived `current.json`, not a mutable `state.json`
- **M3 implementation:** [`src/state/`](../../src/state/) — `schemas.ts`, `machine.ts`, `events.ts`, `gates.ts`, `run.ts`, `lock.ts`, `errors.ts`
