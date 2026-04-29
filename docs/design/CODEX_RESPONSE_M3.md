# code-oz — M3 Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddab8-4441-7691-84d0-93bdec4c2017`
- **Briefing:** [`CODEX_BRIEFING_M3.md`](./CODEX_BRIEFING_M3.md)

Verbatim reply below.

---

## Where I agree

1. **Hand-rolled FSM.** Correct for M3: the phase graph is two fixed linear sequences, so a `const` transition table plus typed helpers beats XState runtime weight. Use data tables, not scattered `switch` logic.

2. **Per-event fsync.** Correct default: M3 optimizes for crash-correct resume, not event throughput. Use `node:fs` file handles in Bun: append one JSON line, `sync()`, close.

4. **`approve` must enforce FSM legality.** Correct: `approve PLAN` cannot be a dumb writer. It must prove the run is currently waiting on PLAN, reject skips and duplicates, then write the gate.

6. **Gate-boundary resume.** Correct for v0.1: replay the trace and validated gate files, resume at the next unpassed phase. Do not add sub-phase checkpoints now.

7. **`current.json` on phase boundaries only.** Correct because it is derived convenience state. `events.jsonl` and gates remain authoritative.

8. **Per-run subdirectory.** Correct, but document that the pinned spec's `state/GATE_*` examples are logical paths inside the active run dir: `.code-oz/state/runs/<runId>/GATE_DEFINE_PASSED.json`.

## Where I disagree

3. **Use ULID, not UUIDv7, unless you first amend the pinned gate spec.** `file-based-gates.md` explicitly requires `runId` to be a 26-char Crockford ULID. `Bun.randomUUIDv7()` exists and is documented as monotonic/sortable, so Bun availability is not the blocker: the contract mismatch is. Implement a tiny no-dep ULID generator/validator locally.

5. **Do not make `artifactSha256` required at read/advance time while the pinned spec says optional.** Better rule: `code-oz approve` always writes `artifactSha256`; `readGate()` accepts missing hashes per spec; if present, mismatch is fatal. If you want missing hash to block advancement, update the pinned spec first.

9. **Do not use `manifest?: string[]`.** It is too ambiguous and collides mentally with permissions manifests. Use:

```ts
manifest?: {
  files: readonly {
    path: string;
    sha256: string;
    sizeBytes: number;
  }[];
}
```

That records the actual files sent, while `permissions.read` remains only an upper-bound check.

4 adjustment: keep bundled-default liveness out of `approve.ts` internals. Put registry loading in a shared CLI bootstrap/helper used by `approve` now and `run` later.

## What's missing

Matters for v0.1:

- **Concurrency:** add a per-run lock file around gate writes, event appends, active pointer updates, and current rebuild. Fail fast with a typed `lock_busy` issue.
- **Reducer ordering:** replay JSONL in file order only. `ts` is human/audit metadata, never ordering authority.
- **Event schema versioning:** add `version: 1` to every event line now, or explicitly document absent version as v1 forever. I would add it now and update the pinned spec before coding.
- **Partial reads:** canonical readers should hard-fail on malformed or trailing partial non-empty lines. A future `status --tail` can tolerate partials separately.
- **Atomic gate writes:** required. Write temp file in same dir, fsync file, rename, fsync dir.
- **Layering:** `gates.ts` only validates/writes gate files. `run.ts` owns `write gate -> append gate_written -> append phase_exited/phase_entered -> rebuild current`.
- **Delete-to-resume:** not a contradiction if scoped. Success gates are append-only. `NEEDS_INTERVENTION.json` and `PAUSE.json` are active control files and may be deleted to resume; `STOP.json` is terminal.
- **`.gitignore`:** generated `.code-oz/state/` and run traces should be ignored by default. Sharing a run should be an explicit bundle/export later.
- **Cross-file recovery:** critical. A crash can happen after gate rename but before `gate_written`. On resume, reconcile valid gate files against missing events and append recovery/normal transition events deterministically.
- **Path safety:** gate `artifact` must be relative, normalized, no `..`, no absolute paths, and no symlink escape from the run/artifact root.
- **Idempotent approve:** re-running approval for the same phase with the same gate content should recover missing events or no-op, not duplicate transitions. Same phase with different content should fail.
- **Phase artifact map:** define defaults now: DEFINE→`artifacts/SPEC.md`, AUDIT→`artifacts/AUDIT.md`, PLAN→`artifacts/PLAN.md`, BUILD→`artifacts/BUILD_REPORT.md`, VERIFY→`artifacts/VERIFY.md`, REVIEW→`artifacts/REVIEW.md`, SHIP→`artifacts/SHIP.md`.

Can defer:

- Buffered event batching.
- Mid-phase checkpoint events.
- Rich status tailing with partial-line tolerance.
- Team-shared committed run state.
- Full intervention-cleared event taxonomy, as long as v0.1 documents delete-to-resume clearly.

## Concrete M3 implementation order

1. `feat(state): add shared schemas and errors`
   Phases, profiles, event/gate/current types, ULID guard, issue-array errors.

2. `feat(state): add typed phase machine`
   Greenfield/brownfield transition tables, terminal checks, illegal transition tests.

3. `feat(state): add append-only event log`
   JSONL validation, `version: 1`, append+fsync, hard-fail malformed lines, per-run locking.

4. `feat(state): add atomic gate file IO`
   Success/intervention schemas, artifact path safety, sha256 verification, temp-write+rename.

5. `feat(state): add run reducer and recovery`
   Replay events in file order, validate gates, reconcile gate/event gaps, rebuild `current.json`.

6. `feat(commands): add approve command`
   `approve [PHASE]`, active run lookup, TTY confirm only for inferred phase, FSM check, idempotent write, registry bootstrap keepalive.

7. `test(state): add fixtures and regression coverage`
   Valid greenfield/brownfield runs, malformed JSONL, illegal jumps, sha mismatch, duplicate approval, crash gap recovery.

8. `docs(state): document gate contract`
   `docs/contracts/GATES.md`, per-run path mapping, delete-to-resume scope, gitignore policy, event versioning.

Verdict: `proceed-with-modifications`

Source checked for Bun UUIDv7 availability: https://bun.com/docs/api/utils

---

## Claude synthesis (post-debate)

Per rule 9 (Codex's verdict is data, not authority): each Codex finding judged below. Net result is a locked M3 plan that flips two of my nine leans, refines two more, and adopts every "what's missing" addition (eight from my list, four newly surfaced by Codex).

### Nine leans, judged

| # | Decision | Verdict | Reason |
|---|---|---|---|
| 1 | Hand-rolled FSM (data tables, not switch) | Hold | Codex's sanity check is exactly right: two fixed linear sequences are a transition table, not a state-chart. Compiled-binary weight argument holds. |
| 2 | Per-event fsync | Hold | `node:fs` file handle pattern (open, append, sync, close) is the concrete shape. Throughput is not the v0.1 axis. |
| 3 | runId — UUIDv7 vs ULID | **Flip** | The pinned spec at `docs/references/file-based-gates.md:168` says ULID 26-char Crockford. My lean ignored the spec. **Implement no-dep ULID generator/validator locally** (~30 lines: 48-bit ms timestamp + 80-bit random, Crockford base32 encode). Closes the contract drift. |
| 4 | `approve` UX + FSM legality + registry keepalive | Refine | Auto-detect + FSM legality check holds. **Bundled-default liveness moves out of `approve.ts`** into a shared CLI bootstrap (`src/cli/bootstrap.ts` or similar) that every command imports — keeps the asset imports alive and gives M5+ commands the same keepalive without each one re-implementing it. |
| 5 | `artifactSha256` required vs optional | Refine | My lean had a contradiction: enforce stricter-than-spec at write time. Codex's resolution is cleaner: `approve` **always writes** `artifactSha256`; `readGate()` follows the spec (accepts missing); when present, mismatch is fatal. Defense-in-depth without spec drift. |
| 6 | Gate-boundary resume | Hold | Sub-phase checkpoint events deferred to v0.2. M5–M7 phases are bounded; gate-level granularity is sufficient. |
| 7 | `current.json` on phase boundaries only | Hold | Cost calculus stands; `current.json` is derived convenience read. |
| 8 | Per-run subdirectory `state/runs/<runId>/` | Hold (with doc clarification) | Codex flagged that the pinned spec's `state/GATE_*` examples are logical paths inside the run dir. **Update `docs/references/file-based-gates.md` to make this explicit** before coding. |
| 9 | `agent_invoked.manifest` slot for M4 | **Flip** | `string[]` is lossy and overloads the word "manifest" with `permissions`. Codex's typed shape `{ files: { path, sha256, sizeBytes }[] }` records actual files sent (audit trail with content integrity + size for budget tracking) while `permissions.read` stays an upper bound. **Adopt the typed shape**. |

### Adopted from "what's missing"

All v0.1 items adopted (none expand M3 scope materially; most close failure modes my lean glossed over):

**Originally on my list:**
- **Concurrency:** per-run lock file around gate writes, event appends, active-pointer updates, current rebuild. Typed `lock_busy` issue.
- **Reducer ordering:** replay JSONL in file order only. `ts` is metadata, never ordering authority.
- **Event schema versioning:** add `version: 1` to every event line. **Update pinned spec before coding** (commit 1 below).
- **Partial reads:** canonical reader hard-fails on malformed/trailing partial lines. Future `status --tail` may tolerate partials separately.
- **Atomic gate writes:** temp file in same dir → fsync file → rename → fsync dir.
- **Layering:** `gates.ts` only validates/writes; `run.ts` orchestrates `write gate → append gate_written → append phase_exited/entered → rebuild current`.
- **Delete-to-resume scoping:** success gates are append-only; `NEEDS_INTERVENTION.json` and `PAUSE.json` are active control files (deletable to resume); `STOP.json` is terminal.
- **`.gitignore`:** ignore `.code-oz/state/` by default. Sharing a run is an explicit bundle/export (W4+).

**Newly surfaced by Codex (all critical):**
- **Cross-file recovery:** crash window between gate-file rename and `gate_written` event append. On resume, reconcile valid gate files against missing events and append recovery/normal transition events deterministically. Spec-grade behavior — covered in tests.
- **Path safety on gate `artifact`:** relative, normalized, no `..`, no absolute paths, no symlink escape from run/artifact root. Lives in `gates.ts` validation.
- **Idempotent approve:** re-running with same content recovers missing events or no-ops; same phase with different content fails. Necessary for the cross-file recovery path to be safe under retry.
- **Phase artifact map:** define defaults now (`DEFINE → artifacts/SPEC.md`, `AUDIT → artifacts/AUDIT.md`, `PLAN → artifacts/PLAN.md`, `BUILD → artifacts/BUILD_REPORT.md`, `VERIFY → artifacts/VERIFY.md`, `REVIEW → artifacts/REVIEW.md`, `SHIP → artifacts/SHIP.md`). M5+ phases will read from the map.

**Deferred (not in M3 scope):**
- Buffered event batching (perf optimization, no correctness benefit at v0.1 turn-counts).
- Mid-phase checkpoint events (gate-level resume is sufficient).
- Rich status tailing with partial-line tolerance (future `code-oz status --tail`).
- Team-shared committed run state (sharing is explicit bundle/export, W4+).
- Full intervention-cleared event taxonomy (delete-to-resume documented in M3; richer events post-v0.1).

### Locked implementation order

Codex's 8 commits + a prepended pinned-spec update. **9 commits total.** Branch: `feat/m3-state-machine`. Each commit self-contained, `bun test` + `bun run typecheck` clean before next. M1 + M2 regression suites stay green throughout (120 tests).

1. **`docs(spec): clarify gate contract for M3 implementation`** — Updates `docs/references/file-based-gates.md`: per-run subdirectory paths, event-line `version: 1`, delete-to-resume scope (success gates append-only; intervention files deletable; STOP terminal), path-safety rules on gate `artifact`. Spec lands before code that depends on the new contract.
2. `feat(state): add shared schemas and errors` — Phases, profiles, event/gate/current types, ULID generator+guard, issue-array errors (`GateLoadError`, `EventLogError` shaped like `AgentLoadError`).
3. `feat(state): add typed phase machine` — Greenfield/brownfield transition tables, terminal checks, illegal-transition tests.
4. `feat(state): add append-only event log` — `node:fs` file-handle append+fsync, line-level `version: 1` validation, hard-fail on malformed lines, per-run lock file (lock around append).
5. `feat(state): add atomic gate file IO` — Success + intervention schemas, gate `artifact` path safety, sha256 verification when present, temp-write + rename + dir fsync.
6. `feat(state): add run reducer and recovery` — File-order JSONL replay, gate validation, reconcile gate/event gaps (cross-file recovery), `current.json` rebuild on phase boundary.
7. `feat(cli): add shared bootstrap and approve command` — `src/cli/bootstrap.ts` (registry keepalive imported by all commands), `src/commands/approve.ts` (active run lookup, FSM check, TTY confirm only for inferred phase, idempotent write).
8. `test(state): add fixtures and regression coverage` — Valid greenfield/brownfield runs, malformed JSONL, illegal jumps, sha256 mismatch, duplicate approval, crash-gap recovery, lock-busy contention.
9. `docs(state): document gate contract for users` — `docs/contracts/GATES.md` (user-facing summary linking back to `docs/references/file-based-gates.md`).

Approved by Ozzy [pending] 2026-04-29. Implementation begins on `feat/m3-state-machine` after approval.
