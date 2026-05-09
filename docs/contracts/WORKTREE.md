# WORKTREE (v0.1)

User-facing summary of the per-run worktree contract — the on-disk layout, base-commit binding, creation/removal commands, and failure forensics shape that BUILD operates inside. Authoritative for v0.1 and the milestone target of M7.

This file pins the worktree layout before M7 implementation begins. Splitting BUILD/VERIFY/REVIEW into M7/M8/M9 (CLAUDE.md rule 20) without a shared worktree contract would let each milestone redefine the run directory layout, the base-commit binding, or the forensics shape — exactly the "fake green gate" failure mode the M7-M10 shape debate flagged. The contract is written once here; M7 implements creation/removal/forensics, M8 reads forensics on restart, M9 reads the changed-file manifest path list.

## Phase overview

The worktree subsystem owns the lifecycle of `.code-oz/runs/<runId>/`. It creates the isolated git worktree before BUILD runs, applies BUILD's patch under path-safety constraints, preserves forensics on failure (per non-negotiable rule 11), and destroys the worktree on success. BUILD personas never invoke `git` directly — the orchestrator does, against an exact-shape allowlist.

## Run directory layout

```
.code-oz/runs/<runId>/
├── worktree/                          # detached git worktree (BUILD's working area)
├── patches/                           # one patch per BUILD attempt, never deleted
│   └── <T-NNN>-attempt-<N>.patch
├── build-attempt-<N>.prompt.txt       # M16 C5: persisted BUILD prompt (one per attempt)
├── forensics/                         # populated only on failure; empty on success
│   └── <N>/                           # frozen evidence from failed attempt N
│       ├── diff.patch
│       ├── stdout.log
│       ├── stderr.log
│       ├── BUILD_REPORT.md
│       ├── manifest.txt
│       └── prompt-constraints.md
├── base.txt                           # immutable base commit SHA (one line, hex)
└── README.md                          # human-readable pointer (runId, base, status)
```

This tree is distinct from `.code-oz/state/runs/<runId>/`, which holds `events.jsonl`, gate files, and `current.json` (see `src/paths.ts`). The two trees share `<runId>` but never write to each other; the worktree subsystem touches only `.code-oz/runs/`, the state subsystem touches only `.code-oz/state/runs/`.

| Path | Owner | Lifetime |
|---|---|---|
| `worktree/` | orchestrator (created), BUILD persona (writes via patch) | destroyed at run end (success or hard cap) |
| `patches/<T-NNN>-attempt-<N>.patch` | orchestrator | retained until `code-oz prune` (W2) |
| `build-attempt-<N>.prompt.txt` | orchestrator (atomic-written before persona invoke; sha256 bound into `build_completed.promptSnapshotSha256`) | retained until `code-oz prune` (W2) |
| `forensics/<N>/` | orchestrator (preserve step) | retained until `code-oz prune` (W2) |
| `base.txt` | orchestrator (worktree_created) | retained for the run's lifetime |
| `README.md` | orchestrator (worktree_created); refreshed on each event | retained for the run's lifetime |

## Base-commit binding

A run's worktree is created from a single, immutable base commit. The base SHA is recorded once at creation in `.code-oz/runs/<runId>/base.txt` (40-char lower-case hex, no trailing newline) and copied verbatim into:

- `BUILD_REPORT.md` § `Base.Base commit` (per [`BUILD.md`](./BUILD.md))
- `events.jsonl` `worktree_created.baseCommitSha`
- `VERIFY.md` § `BUILD ref.baseCommitSha` (per [`VERIFY.md`](./VERIFY.md))

Every BUILD attempt within a run uses the same base. Attempt N+1 starts from a fresh worktree off the same base, not from attempt N's tree (restart-on-fail discipline, per [`BUILD.md`](./BUILD.md) § "Restart-policy interface" and Decision 3 in the M7-M10 shape debate).

A different base requires a different `runId`. Mid-run rebasing is not supported in v0.1.

## Dirty-tree policy

The host project may have an unclean working tree. The run worktree must not inherit it. Two policies, selected via `run.dirtyTreePolicy` in `.code-oz/config.yaml`:

| Policy | `runStartCommit` | Host effect | Default |
|---|---|---|---|
| `clean-base` | `git rev-parse HEAD` | host untouched; host's untracked or unstaged files invisible to the run | yes |
| `stash-and-pin` | `git stash create` (no `stash push`) | host untouched; the synthetic stash commit is the base | no |

Both policies produce a deterministic, content-addressed base SHA. `stash-and-pin` lets a user kick off a run against in-flight work without committing first; `clean-base` is the safer default. Neither policy modifies the host worktree.

## Doctor check (git version)

`code-oz doctor` (added in M7) runs `git --version` and parses the result.

- Required: `git >= 2.40`. (2.40 is the first version where `git worktree add --detach <path>` is reliable across edge cases; older versions emit warnings on Windows refnames.)
- Failure produces `NEEDS_INTERVENTION.json` with code `worktree_git_version_unsupported` and the suggested action `Upgrade git to 2.40 or newer`.
- The check fires at startup for any run that will reach BUILD. Runs that stop at PLAN do not require it (no worktree is created).

## Creation

Worktree creation is a four-step sequence run from the host project root. Failure at any step aborts the run before BUILD persona invocation.

```
1. git rev-parse HEAD                                           # capture baseCommitSha
2. git worktree add --detach <runs>/<runId>/worktree <baseSha>  # detached, no branch
3. mkdir -p <runs>/<runId>/{patches,forensics}
4. write <runs>/<runId>/base.txt and README.md
```

Step 2's `--detach` flag is non-negotiable: a named branch would let the run race with the user's branch state. Steps 3-4 lay down the supporting directories before any agent code runs.

The orchestrator emits `worktree_created` only when all four steps succeed; partial state on failure is destroyed before `worktree_failed` fires.

## Removal

Two removal paths, mutually exclusive per attempt. **Neither path fires on `build_completed` alone.** BUILD-pass is necessary but not sufficient for cleanup; the worktree must survive the BUILD gate so VERIFY can read it (Codex M7 implementation review C3, thread `019ddeea`), and **must continue surviving past VERIFY-approve so REVIEW can read changed files** (Codex M9 substrate catch, `CODEX_RESPONSE_M9.md` decision 5 + risk #1, thread `019de05a`).

| Path | Trigger | Behavior |
|---|---|---|
| Cleanup-on-success | the run's REVIEW gate is approved (M9+) | `git worktree remove --force <worktree>`; `forensics/` empty; `patches/` retained |
| Preserve-on-failure | VERIFY emits `verdict: fail` and the restart policy preserves attempt N (M8+) | populate `forensics/<N>/` first, then `git worktree remove --force <worktree>`; `patches/<T-NNN>-attempt-<N>.patch` retained |

In both paths the worktree directory is removed; the run directory itself survives until `code-oz prune` (W2). The asymmetry is load-bearing: success is cheap to forget, failure must be replayable.

**Cleanup-on-VERIFY-approve does not exist.** The M8 design originally cleaned up at VERIFY-approve, but that left REVIEW with no worktree to read changed files from. The cleanup-on-success path is owned by REVIEW-approve as of M9 commit 1; the VERIFY hook still validates `verdict: pass` before approveGate writes the gate, but it no longer touches the worktree.

**BUILD failure (no valid BUILD_REPORT.md) is distinct from VERIFY failure** and never enters either path above. BUILD failure produces `NEEDS_INTERVENTION.json` directly per [`BUILD.md`](./BUILD.md) § "Event types emitted" (`build_failed` is structurally different from `verify_failed`). The worktree is preserved alongside `.code-oz/runs/<runId>/build-drafts/<T-NNN>-attempt-<N>/` for human inspection; cleanup happens via `code-oz prune` (W2).

### v0.1 lifecycle by milestone

| Milestone | Run terminal gate | Worktree fate at run end |
|---|---|---|
| M7 (BUILD-lite) | BUILD gate (`v0.7.0-alpha.0`) | Worktree survives. No automatic removal. Manual cleanup via `code-oz prune` (W2). |
| M8 (VERIFY-lite) | VERIFY gate (`v0.8.0-alpha.0`) | VERIFY-fail triggers preserve-on-failure (and attempt N+1 starts fresh from same base). VERIFY-pass leaves the worktree alive for REVIEW (M9+). |
| M9 (REVIEW-lite) | REVIEW gate (`v0.9.0-alpha.0`) | REVIEW-pass triggers cleanup-on-success at the REVIEW-approve hook (`preApproveReviewHook` in `src/commands/approve.ts`). Same `git worktree remove --force` semantics as before; `worktree_destroyed` event now records `phase: review`. |
| W4 (SHIP) | SHIP gate | Worktree already gone after REVIEW-approve. SHIP cleanup beyond REVIEW is W4 territory. |

In M7, every successful run leaves a worktree on disk. This is intentional: it lets a human inspect the BUILD output before M8 ships the validation runner, and it surfaces any "fake green gate" failure mode (Codex M7-M10 shape risk #2) where BUILD claimed success but the patch did not reflect the PLAN task.

## Forensics layout

When attempt N fails, the orchestrator writes the forensic dir before the worktree is destroyed. Order matters: a destroyed worktree cannot be re-diffed.

```
.code-oz/runs/<runId>/forensics/<N>/
├── diff.patch                # `git -C <worktree> diff <baseSha>` at time of failure
├── stdout.log                # captured stdout from the validation command (M8)
├── stderr.log                # captured stderr
├── BUILD_REPORT.md           # frozen copy of the failed attempt's BUILD_REPORT.md
├── manifest.txt              # changed-file manifest with sha256 (one bullet per file)
└── prompt-constraints.md     # the failure-constraint block VERIFY emitted (M8)
```

| File | Source | Read by |
|---|---|---|
| `diff.patch` | `git diff <baseSha>` against worktree at failure time | human inspection; `code-oz inspect` (W2) |
| `stdout.log` / `stderr.log` | M8's validation-command runner | human inspection |
| `BUILD_REPORT.md` | atomic copy of `.code-oz/artifacts/BUILD_REPORT.md` at failure time | restart policy bookkeeping; cap counting |
| `manifest.txt` | mirror of `BUILD_REPORT.md` § Changed files | `code-oz inspect`; never re-parsed for restart |
| `prompt-constraints.md` | M8 emits this when VERIFY fails (per [`VERIFY.md`](./VERIFY.md) § "Failure constraint") | attempt N+1's BUILD persona prompt (verbatim, per [`BUILD.md`](./BUILD.md) § "Failure carry-forward grammar") |

The forensic dir is read-only after the worktree is destroyed. Rerunning attempt N is not supported in v0.1; attempt N+1 starts from a fresh worktree off the same base, with the failure constraint surfaced into the BUILD prompt. This is the structural difference between restart-on-fail and a soft patch loop.

### Forensics extensibility

The six files above are the **M7-required minimum**. M8's VERIFY ([`VERIFY.md`](./VERIFY.md)) will append additional entries to the same `forensics/<N>/` path: a frozen copy of `VERIFY.md` itself, a copy of the failed attempt's patch, and the BUILD prompt-constraint snapshot. The forensics writer accepts named additional entries from VERIFY without breaking the M7 layout (per Codex M7 implementation review H2, thread `019ddeea`).

| File | Required since | Owner |
|---|---|---|
| `diff.patch`, `stdout.log`, `stderr.log`, `BUILD_REPORT.md`, `manifest.txt`, `prompt-constraints.md` | M7 | orchestrator (worktree subsystem) |
| `VERIFY.md` (frozen copy), `attempt-<N>.patch` (frozen copy), `build-prompt-snapshot.md` | M8 | orchestrator (VERIFY phase) |

Keys are file basenames; M8 may not rewrite or relocate the M7 entries. The contract is open at the bottom (extensible) and locked at the top (M7 entries are stable).

## Patch application boundary

BUILD persona writes a unified-diff patch under `.code-oz/runs/<runId>/patches/<T-NNN>-attempt-<N>.patch`. The orchestrator applies it.

```
git -C <worktree> apply --check <patch>     # dry-run; on failure: build_patch_apply_failed
git -C <worktree> apply <patch>             # atomic; partial-apply: build_patch_partial_apply
```

- The `--check` step is mandatory before the real apply. A patch that fails `--check` goes to persona repair (per [`BUILD.md`](./BUILD.md) error table), not to a retry loop.
- Apply is atomic: either every hunk lands or none do. Partial apply produces `build_patch_partial_apply` and goes to repair; this is a git environment bug, not a persona bug.
- Binary patches are rejected in v0.1 (`build_patch_binary_unsupported`); W3 adds support if data justifies it.
- Maximum patch size: 65536 bytes (per [`BUILD.md`](./BUILD.md) § `tool_use.write.maxBytesPerPatch`). Larger patches fail at `tool_use.write` schema validation, before the orchestrator sees them.

Path safety is enforced before apply: every path in the patch (file headers, including renames) must be relative and stay under `<worktree>/`. Absolute paths or `..` traversal produce `build_manifest_path_unsafe` (per [`BUILD.md`](./BUILD.md) error table).

## Allowed roots

Two roots, scoped per role:

| Role | Reads | Writes |
|---|---|---|
| BUILD persona | `.code-oz/runs/<runId>/worktree/` (post-patch state via `tool_use.repo_context`) | nothing direct; emits a patch that the orchestrator applies under `.code-oz/runs/<runId>/worktree/` |
| Orchestrator (worktree subsystem) | `.code-oz/runs/<runId>/` | `.code-oz/runs/<runId>/` |
| VERIFY persona (M8) | `.code-oz/runs/<runId>/worktree/` (read-only per VERIFY.md), `.code-oz/runs/<runId>/forensics/<N>/` (on restart) | `.code-oz/artifacts/VERIFY.md`, `.code-oz/runs/<runId>/forensics/<N>/` (preserve step) |
| REVIEW persona (M9) | `.code-oz/runs/<runId>/worktree/` (changed-file paths from BUILD's manifest) | `.code-oz/artifacts/REVIEW.md` |

Worktree creation/removal commands run from the host project root but their target paths must be under `.code-oz/runs/<runId>/`. Targets outside that path are rejected with `worktree_path_outside_run` before any git invocation.

## Permissions required

Worktree management is an orchestrator capability, not an agent capability. The orchestrator's allowlist for worktree operations:

```yaml
# orchestrator (worktree subsystem) — not an agent profile
bash:
  - 'git rev-parse HEAD'
  - 'git --version'
  - 'git stash create'
  - 'git worktree add --detach <path> <sha>'
  - 'git worktree remove --force <path>'
  - 'git -C <worktree> apply --check <patch>'
  - 'git -C <worktree> apply <patch>'
  - 'git -C <worktree> diff <sha>'
read:
  - '.code-oz/runs/<runId>/'
write:
  - '.code-oz/runs/<runId>/'
network: 'none'
```

- The list is exact-shape: agent-supplied bash never reaches this surface. Variable substitution is bounded to `<runId>`, `<sha>`, `<path>`, `<patch>`, `<worktree>` placeholders, validated against the run's known values before invocation.
- This allowlist is a discipline boundary, not a security sandbox. Containerization (W4) is the hostile-code defense.

BUILD personas inherit `tool_use.write` (per [`BUILD.md`](./BUILD.md) § "Permissions required") to emit the patch artifact; that sub-scope governs the patch-write step but not the apply step. The apply step is orchestrator code, not agent code.

## Event types emitted

Names listed here; canonical schemas land in `src/state/schemas.ts` during M7 implementation alongside the existing event union.

| Event | Emitted when |
|---|---|
| `worktree_created` | Steps 1-4 of creation succeeded; `baseCommitSha` recorded |
| `worktree_failed` | Any of steps 1-4 failed; partial state destroyed; run aborted |
| `worktree_patch_applied` | `git apply --check` and `git apply` both succeeded; precedes `build_patch_applied` |
| `worktree_patch_failed` | `git apply --check` failed or `git apply` partially applied; precedes `build_patch_apply_failed` |
| `worktree_forensics_preserved` | Attempt N's `forensics/<N>/` written and verified; precedes `worktree_destroyed` on the failure path |
| `worktree_destroyed` | `git worktree remove --force` returned zero |

`worktree_failed` is distinct from `worktree_destroyed`: the first means creation never completed; the second means a fully-created worktree was removed (success or post-forensics).

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `worktree_git_version_unsupported` | `git --version < 2.40` at doctor or run start | Upgrade git |
| `worktree_create_path_exists` | `<runs>/<runId>/worktree` already exists at creation | Use a new `runId`; investigate orphans (`code-oz prune` in W2) |
| `worktree_create_base_unknown` | `baseCommitSha` does not exist in the host repo (e.g., shallow clone) | Unshallow the repo or pick a different base |
| `worktree_dirty_base_blocked` | `dirtyTreePolicy: clean-base` and the active task references files modified in the host's unstaged tree | Stash, commit, or switch to `stash-and-pin` |
| `worktree_remove_failed` | `git worktree remove --force` returned non-zero (busy fs handle, permission, etc.) | Manual cleanup; emit `intervention` |
| `worktree_forensics_write_failed` | Forensic dir partially written before the worktree was removed | Investigate fs; emit `intervention`; the run is unrecoverable |
| `worktree_path_outside_run` | Orchestrator asked to operate on a path outside `.code-oz/runs/<runId>/` | Bug; abort run; emit `intervention` |

## What BUILD reads from this

BUILD persona invocation receives the following from the worktree subsystem:

- `worktreePath` (`.code-oz/runs/<runId>/worktree/`) — passed as the working directory in `ProviderRequest`.
- `baseCommitSha` — read from `<runId>/base.txt`; copied into `BUILD_REPORT.md` § `Base.Base commit`.
- `attemptNumber` — from the orchestrator's restart bookkeeping; used for the patch filename and `BUILD_REPORT.md` § `Task.Attempt`.
- `failureCarryForward` — when `attemptNumber > 1`, the prior attempt's `prompt-constraints.md` content is injected verbatim into the BUILD persona prompt (per [`BUILD.md`](./BUILD.md) § "Failure carry-forward grammar").

Worktree creation completes before BUILD persona is invoked; removal happens after the run terminates (success path) or after forensics preservation (failure path).

## Not a security sandbox

Per Codex M7-M10 shape risk #1: worktree isolation is not a security sandbox. It bounds the *path* of a BUILD attempt's writes to the run worktree. It does not protect against:

- Secret exfiltration via network calls. (No agent has network in v0.1; W4 hardens.)
- Destructive shell commands. (BUILD's `bash: deny`; W4 containerization.)
- Filesystem escape via symlinks. (W4 chroot-equivalent.)
- Resource exhaustion. (W4 cgroup-equivalent.)

Until W4 ships container-grade isolation, the v0.1 safeguards are: BUILD's `bash: deny`, the absence of agent execution sub-scopes, the orchestrator-only git command set above, and patch path-safety validation. The worktree is a discipline boundary (rule 13 privacy by default; rule 9 permission manifest), not a hostile-code sandbox.

## Reference

- **Linked contracts:** [`BUILD.md`](./BUILD.md) (M7 BUILD-lite implementation; consumes `worktreePath` and `baseCommitSha`), [`VERIFY.md`](./VERIFY.md) (M8 reads validation command from `BUILD_REPORT.md`, owns restart-on-fail), [`REVIEW.md`](./REVIEW.md) (M9 reads changed-file manifest paths), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md) (read-side `tool_use` sub-scope; this contract is the write-side counterpart), [`GATES.md`](./GATES.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 7 (Markdown contracts), 9 (permission manifest), 11 (`NEEDS_INTERVENTION.json` on provider/orchestrator failure), 13 (privacy by default), 19 (run-level budget enforcement), 20 (one new authority boundary per milestone)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — risk #1 ("worktree isolation is not a sandbox"), risk #2 ("fake green gate") is the load-bearing reason this contract pins the layout, base binding, and forensics shape before BUILD code lands; Decision 3 (restart-on-fail vs soft patch loop). [`docs/design/CODEX_RESPONSE_M7.md`](../design/CODEX_RESPONSE_M7.md) (thread `019ddeea`, 2026-04-30) — implementation review; C3 (worktree survives BUILD gate; cleanup is at VERIFY-pass in M8+, not BUILD-pass in M7), H2 (forensics layout extensible — M8 appends VERIFY.md, frozen patch, BUILD prompt-snapshot)
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Pre-M7, § M7 (BUILD-lite implementation; `src/worktree/{create,remove,inspect}-run-worktree.ts`, `src/worktree/manifest.ts`, `src/worktree/forensics.ts`, `src/patches/{apply,validate}-agent-patch.ts`, `src/commands/doctor.ts` adds `git --version` check)
