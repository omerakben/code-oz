# code-oz — M3 Codex review

- **Round:** Implementation review (CLAUDE.md rule 8)
- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddae7-6bdd-7130-a2d1-fb27efbfaaef`
- **Branch reviewed:** `feat/m3-state-machine` (head `d5316bd`, ten commits)
- **Verdict:** `fix-first`

Verbatim reply below.

---

## Findings

- `block-push` [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:552) only `stat()`s gate files for existing `gate_written` events. That means resume does not re-validate the gate schema, `runId`, `phase`, path safety, or `artifactSha256`; mutating an approved artifact after the gate is written will not fail on `loadRun()`, despite the contract saying it must. Fix: in `validateRunIntegrity`, call `readGate(filePath, paths.artifactRoot)` for every `gate_written`, verify `gate.runId === e.runId`, `gate.phase === e.phase`, and `e.file === gateFilename(e.phase)`, then add a regression where an artifact changes after approval and `loadRun()` rejects with `gate_artifact_sha256_mismatch`.

- `block-push` [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:511) recovers an orphaned gate by appending only `gate_written`; [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:327) then skips `phase_exited` / `phase_entered` whenever the gate already existed. After a crash between gate rename and event append, the run can stay stuck on the old phase. The test at [tests/state-regression.test.ts](/Users/ozzy-mac/Projects/code-oz/tests/state-regression.test.ts:274) even describes completing the transition, but only asserts no duplicate `gate_written`. Fix: recovery must deterministically append the missing transition events exactly once, or `approveGate` must do so when `gate_written` exists but the phase transition is missing. Add assertions for `currentPhase === 'plan'` and the full event sequence after orphan recovery.

- `block-push` [src/commands/approve.ts](/Users/ozzy-mac/Projects/code-oz/src/commands/approve.ts:128) regenerates `approvedAt` on every retry, while [src/state/gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:632) includes `approvedAt` in equality. The idempotency tests pass because they inject the same fixed timestamp; a real retry after an orphaned gate will usually produce different content and trip `gate_idempotency_violation`. Fix: when a gate already exists, compare against or reuse the existing gate content for recovery instead of generating a new approval timestamp, and add a test with two different `now()` values.

- `block-push` [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:235), [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:258), and [src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:420) do not meet the lock contract. `loadRun()` reads, recovers, validates, and rebuilds `current.json` outside one transaction; `writeCurrent()` has no lock of its own; `initRun()` writes `active.json` after releasing the run lock; `writeActiveRun()` is also unprotected. Fix: wrap `loadRun()` recovery and current rebuild in `withLock`, keep `skipLock: true` only for inner calls, and protect active pointer updates with a documented lock that actually serializes concurrent active-run writers.

- `block-push` [src/state/gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:510) checks `..` after `normalize()`, so `foo/../SPEC.md` normalizes to `SPEC.md` and passes. I reproduced `_validateArtifactSyncPath('foo/../SPEC.md', 'gate.json')` returning `null`. Fix: reject raw path segments equal to `.` or `..` before normalization, then keep the `realpath` escape check.

- `block-next-milestone` [src/state/gates.ts](/Users/ozzy-mac/Projects/code-oz/src/state/gates.ts:608) treats an existing but malformed success gate as "not found" and allows `writeGate()` to overwrite it. Success gates are append-only decision records; parse or validation failure should stop, not be repaired by replacement. Fix: if the target file exists but cannot be parsed or validated, surface a typed gate error or `gate_idempotency_violation` and never overwrite.

## Confirmations

- The two planning flips landed: `runId` is a no-dep ULID in [src/state/schemas.ts](/Users/ozzy-mac/Projects/code-oz/src/state/schemas.ts:69), and `agent_invoked.manifest` is the typed `{ files: [{ path, sha256, sizeBytes }] }` shape in [src/state/schemas.ts](/Users/ozzy-mac/Projects/code-oz/src/state/schemas.ts:111) and [src/state/events.ts](/Users/ozzy-mac/Projects/code-oz/src/state/events.ts:139).

- The spec amendment landed before code: `7f6ff5a` is docs-only and precedes `2d43993`. The amended `file-based-gates.md` contains per-run layout, event `version: 1`, delete-to-resume scoping, rules 7-11, and the typed manifest.

- Layering is mostly right: `gates.ts` has no `appendEvent` calls, and the fresh approval sequence is composed in `run.ts`.

- Event append shape is right: [src/state/events.ts](/Users/ozzy-mac/Projects/code-oz/src/state/events.ts:319) opens append, writes one JSONL line, syncs, and closes; `readEvents()` hard-fails malformed or partial lines.

- The M2 liveness loose thread is closed in source: [src/cli/bootstrap.ts](/Users/ozzy-mac/Projects/code-oz/src/cli/bootstrap.ts:33) calls `loadBundledDefaults()`, and `approve` reaches it. `dist/code-oz --version` reports `0.3.0-alpha.0`.

- Validation here: `bun run typecheck` is clean. `bun test` could not be independently confirmed in this read-only sandbox: it failed on temp-dir `mkdtemp` `EPERM` after 132 passes, same sandbox interference pattern as the prior M2 review.

## Verdict

fix-first

The branch is close structurally, but not push-ready. The blockers are not style issues: they affect resume correctness, gate integrity, idempotent crash recovery, and the lock contract that M3 explicitly adopted.
