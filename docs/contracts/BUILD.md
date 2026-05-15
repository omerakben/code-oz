# BUILD (v0.1)

User-facing summary of the BUILD phase contract — the data BUILD writes and the seam M8's VERIFY consumes. Authoritative for v0.1 and the milestone target of M7.

This file pins the BUILD/VERIFY/REVIEW handoff surface before M7 implementation begins. Splitting BUILD/VERIFY/REVIEW into M7/M8/M9 (CLAUDE.md rule 20) without a shared contract surface would let M8's VERIFY either rewrite this contract or validate the wrong abstraction (Codex M7-M10 shape verdict, risk #2: "fake green gate"). The contract is written once here; M7 implements writers, M8 implements readers + restart, M9 implements review consumers.

## Phase overview

BUILD applies one atomic PLAN task into an isolated worktree, writes `BUILD_REPORT.md`, runs the Scientist phase-tail, and stops before VERIFY. BUILD does not run validation commands (M8's VERIFY does); BUILD does not approve itself (`code-oz approve build` does, after VERIFY). BUILD's authority boundary is **the patch and the manifest** — what changed, against which base, with what hash. Worktree creation, removal, and forensics live in [`WORKTREE.md`](./WORKTREE.md) (M7 commit 1).

## `BUILD_REPORT.md` schema

`.code-oz/artifacts/BUILD_REPORT.md` is plain Markdown with locked H2 sections in canonical order. **The orchestrator authors and serializes most fields; the persona authors only free-form text fields under repair/finalize discipline.** See § "Authoring authority" below for the per-field split. Persona-supplied claims for orchestrator-owned fields are cross-checked, not authoritative (per Codex M7 implementation review C1, thread `019ddeea`).

```markdown
# BUILD_REPORT

## Task

- Task: T-001
- Title: Implement syllable scorer
- PLAN.md ref: .code-oz/artifacts/PLAN.md (sha256: <plan-sha>)
- Attempt: 1

## Base

- Worktree: .code-oz/runs/<runId>/worktree/
- Base commit: 9c1f2a3b4d5e6f7081929394a5b6c7d8e9fa0b1c
- Dirty tree at base: false

## Patch

- Patch path: .code-oz/runs/<runId>/patches/T-001-attempt-1.patch
- Patch sha256: 7f3a9b1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f50617283940a1b2c3d4
- Patch byte count: 4128

## Changed files

- src/scoring/syllable.ts | sha256: a1b2c3d4e5f60718... | change: added
- tests/scoring-syllable.test.ts | sha256: 0f1e2d3c4b5a6978... | change: added

## Validation command

- Command: bun test tests/scoring-syllable.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Failure carry-forward

- None (attempt 1).

## Notes

- One-line risk note from PLAN.md task block, copied verbatim.
```

### Authoring authority

Every field in BUILD_REPORT.md is owned by exactly one party. Persona-supplied claims for orchestrator-owned fields are cross-checked at validation time and rejected on mismatch (per Codex M7 implementation review C1, thread `019ddeea`). The protocol is **patch-first**: the persona's response contains a single fenced `diff` block plus a small report-input block; the orchestrator extracts, applies, computes, and serializes everything else.

| Field | Author | Source |
|---|---|---|
| `Task.Task` (T-NNN id) | orchestrator | selected PLAN task block (one task per BUILD attempt; selection rule pending; see § "BUILD entry preflight") |
| `Task.Title` | persona | free-form text from persona response (≤ 120 chars, single line) |
| `Task.PLAN.md ref` | orchestrator | sha256 of `.code-oz/artifacts/PLAN.md` at BUILD entry |
| `Task.Attempt` | orchestrator | restart bookkeeping (M7: always 1; M8 increments on VERIFY-fail) |
| `Base.Worktree` | orchestrator | resolved run-worktree path |
| `Base.Base commit` | orchestrator | `<runId>/base.txt` (immutable per run) |
| `Base.Dirty tree at base` | orchestrator | `dirtyTreePolicy` at run creation (`clean-base` ⇒ `false`; `stash-and-pin` ⇒ recorded boolean) |
| `Patch.Patch path` | orchestrator | resolved at write time (`patches/<T-NNN>-attempt-<N>.patch`) |
| `Patch.Patch sha256` | orchestrator | sha256 of patch bytes after orchestrator-side write |
| `Patch.Patch byte count` | orchestrator | byte count of patch file after orchestrator-side write |
| `Changed files` (full manifest) | orchestrator | computed by walking the post-apply worktree against the base commit; one bullet per affected path with sha256 and change kind |
| `Validation command` (4 bullets) | orchestrator | copied verbatim from the selected PLAN task block (per Codex M7 implementation review M2 — substitution is rejected) |
| `Failure carry-forward` | orchestrator | M8 emits `prompt-constraints.md` per [`VERIFY.md`](./VERIFY.md); M7 always writes `- None (attempt 1).` |
| `Notes` | persona | free-form text from persona response (≤ 200 chars per bullet, ≥ 1 bullet) |

Persona response shape (locked):

```
<build-ready/>

```diff
<unified diff body>
```

## Title
<short title, ≤ 120 chars>

## Notes
- <one or more single-line notes>
```

The `<build-ready/>` marker signals the persona is done iterating; the orchestrator stops accepting repair turns and proceeds to extract+apply. The fenced ` ```diff ` block is the sole patch source. Title and Notes are persona-authored free text; everything else is computed.

Persona may NOT emit `Patch sha256`, `Patch byte count`, `Changed files` lines, `Validation command`, or any base/path field. If the persona embeds those in its response, the orchestrator drops them silently (they are not authoritative).

### Required H2 sections

| Section                    | What it answers                             | Min content                                                                |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `## Task`                  | Which PLAN task this BUILD applied          | 4 bullets (Task, Title, PLAN.md ref, Attempt)                              |
| `## Base`                  | The worktree's starting point               | 3 bullets (Worktree, Base commit, Dirty tree at base)                      |
| `## Patch`                 | The patch artifact and its hash             | 3 bullets (Patch path, Patch sha256, Patch byte count)                     |
| `## Changed files`         | The manifest VERIFY and REVIEW will read    | ≥ 1 bullet, locked grammar (below)                                         |
| `## Validation command`    | The command shape M8 will execute           | 4 bullets (Command, Working directory, Timeout (ms), Expected exit code)   |
| `## Failure carry-forward` | Prior-attempt context (only on attempt > 1) | bullets per locked grammar (below); `- None (attempt 1).` when attempt = 1 |
| `## Notes`                 | Free-form one-line notes from the persona   | ≥ 1 bullet (use `- None.` if absent)                                       |

Sections appear in canonical order. Bullets are one line each. Multi-line entries split into multiple bullets.

### `## Changed files` grammar (locked)

Each bullet is `<relative-path> | sha256: <hex64> | change: <added | modified | deleted>`.

- Path is relative to the worktree root, never absolute, never `..`-traversing.
- `sha256` is the lower-case hex digest of the **post-patch** file contents (for `added` and `modified`) or the **pre-patch** contents (for `deleted`).
- `change` is one of three locked values; renames decompose into `deleted` + `added`.
- The set of paths matches exactly the patch's affected files; an entry without a corresponding patch hunk fails validation.

### `## Failure carry-forward` grammar (locked)

Populated only when `Attempt > 1`. Two locked sources feed this block (M9 commit 9 substrate per [`CODEX_RESPONSE_M9.md`](../research/CODEX_RESPONSE_M9.md) decision 8):

1. `Source: verify-fail` — VERIFY.md verdict=fail produced a typed `VerifiedFailedAttempt`; restart-policy maps it to this shape (M8). `Prior verdict` describes a validation-command failure.
2. `Source: review-needs-revision` — REVIEW round N exited with verdict=needs-revision (M9 commit 10+); review-remediation maps the unresolved findings into this shape. `Prior verdict` is orchestrator-shaped: `needs-revision (round <N>, sha <reviewReportSha>)` — never a fabricated exit-code-style string.

Both produce the same field set and BUILD's `attempt > 1` validation accepts either:

```markdown
## Failure carry-forward

- Source: verify-fail
- Prior attempt: 1
- Prior forensics: .code-oz/runs/<runId>/forensics/1/
- Prior validation command: bun test tests/scoring-syllable.test.ts
- Prior verdict: fail (exit code 1, duration 842 ms)
- Prior failure summary: expected stress on syllable 2; got stress on syllable 1.
- Constraint: prefer last-syllable stress for two-syllable surnames.
```

REVIEW-driven shape (M9 commit 10):

```markdown
## Failure carry-forward

- Source: review-needs-revision
- Prior attempt: 1
- Prior forensics: .code-oz/artifacts/REVIEW.md
- Prior validation command: bun test tests/scoring-syllable.test.ts
- Prior verdict: needs-revision (round 1, sha eeee...eeee)
- Prior failure summary: reviewer flagged unexplained side-effect in topN.
- Constraint: document the side-effect or remove it before re-review.
```

`Source` is required; the parser rejects carry-forward blocks that omit it (legacy M8 shape) or that name a value outside `verify-fail | review-needs-revision`. `Prior failure summary` and `Constraint` are each capped at 200 characters, single-line. Longer text fails validation; the persona must compress before emit.

### Task id reference

`Task` cites a `T-NNN` id from PLAN.md ([`PLAN.md`](./PLAN.md) § "Task block grammar"). The orchestrator validates that the cited task exists in the run's PLAN.md and that no other completed BUILD attempt for the same task has recorded `verdict: pass` in its VERIFY.md (one BUILD attempt active per task; concurrent task BUILDs are W3+).

## Permissions required

```yaml
provider: claude
modelPolicy: { primary: claude-opus-4-7, fallback: claude-sonnet-4-6 }
permissions:
  read: ['.code-oz/artifacts/SPEC.md', '.code-oz/artifacts/PLAN.md',
         '.code-oz/artifacts/SOURCE_CHECK.md', '.code-oz/artifacts/HYPOTHESES.md',
         '.code-oz/artifacts/OPEN_QUESTIONS.md',
         '.code-oz/runs/<runId>/worktree/']
  write: ['.code-oz/artifacts/BUILD_REPORT.md',
          '.code-oz/runs/<runId>/worktree/',
          '.code-oz/runs/<runId>/patches/']
  bash: deny
  tool_use:
    repo_context:                              # M6 sub-scope, unchanged
      tools: ['glob', 'grep', 'read']
      roots: ['.code-oz/runs/<runId>/worktree/']
      maxResults: 50
      maxBytesPerResult: 16384
      maxFilesForNextManifest: 20
      timeoutMs: 5000
      network: 'none'
    write:                                      # M7 sub-scope (defined here, schema in M7 commit 5-equivalent)
      tools: ['apply-patch']
      roots: ['.code-oz/runs/<runId>/worktree/']
      maxBytesPerPatch: 65536
      timeoutMs: 5000
```

- `tool_use.write` is BUILD's new sub-scope. It governs patch application into the worktree; it does **not** grant arbitrary shell write access. Schema lands in M7 commit 5-equivalent (`src/agents/schema.ts`); the runtime tool lands in M7's BUILD-lite commits.
- `tool_use.repo_context` carries forward unchanged from M6, scoped to the run's worktree (not the host project root) so the BUILD persona reads the post-patch state, not the user's working tree.
- Worktree-runtime permissions (creation, removal, base-commit binding, allowed roots) are governed by [`WORKTREE.md`](./WORKTREE.md), landing in M7 commit 1 before BUILD code.

Worktree isolation is **not** a security sandbox (Codex M7-M10 shape risk #1). Secrets, network, shell execution, and destructive command protection are W4 containerization. BUILD's `bash: deny` and the absence of execution sub-scopes in v0.1 are the load-bearing safeguards until then.

## BUILD entry preflight

Before BUILD persona invocation, the orchestrator runs a preflight pass that binds PLAN to a concrete worktree base. This catches the "PLAN/BUILD substrate drift" failure mode (per Codex M7 implementation review C2, thread `019ddeea`): PLAN's repo-context reads the host tree at PLAN time; the worktree is created lazily at BUILD time off `HEAD` (`clean-base` policy). If the host's `HEAD` moved or the host had unstaged files PLAN read but `clean-base` hides, BUILD would implement against a different substrate than PLAN reasoned over.

Preflight checks (run in order; first failure aborts BUILD with `NEEDS_INTERVENTION.json`):

1. **PLAN.md sha pin.** Compute sha256 of `.code-oz/artifacts/PLAN.md`. Record as `Task.PLAN.md ref`. Mismatch on later re-read fails `build_plan_sha_drift`.
2. **Selected task exists in PLAN.md.** Resolve `T-NNN` from PLAN.md's task block; reject if absent (`build_task_id_unknown` per error table).
3. **Selected task's `Files`/`Tasks references files` block paths exist in the bound base.** For every path the PLAN task names, verify it is reachable in the worktree at `<baseSha>` (or is marked `change: added` and does not exist yet). A task that names `src/foo.ts` but `<baseSha>` lacks `src/foo.ts` and the task does not declare it `added` fails `build_plan_base_drift`.
4. **`tool_use.repo_context.roots` resolves against worktree, not host.** The orchestrator overrides any persona-declared root to the run's `<runId>/worktree/` absolute path before invocation, blocking the host-leak failure mode (per Codex M7 implementation review H1).
5. **`Validation command` from PLAN task is well-formed.** PLAN.md task block must carry the four required bullets (Command, Working directory, Timeout, Expected exit code); the orchestrator copies them verbatim into `BUILD_REPORT.md § Validation command`. Substitution by the persona is rejected (per Codex M7 implementation review M2).

Preflight emits no event on success (the subsequent `worktree_created` and `build_started` events cover it). On failure, `intervention` fires with one of the codes above, plus the offending PLAN task id and base sha for forensics.

## Event types emitted

Names listed here; canonical schemas land in `src/state/schemas.ts` during M7 implementation.

| Event                    | Emitted when                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build_started`          | BUILD attempt begun; worktree resolved, base commit recorded. Fires **before** prompt composition and persona invocation. (Doc previously said "persona invoked"; corrected in v0.20.3 #1.)                  |
| `worktree_reset_to_base` | Verify-fail BUILD attempt > 1 only (review-needs-revision restarts preserve the worktree per the M9 contract). Worktree successfully reset to `baseCommitSha` (via `git reset --hard` + `git clean -fdx`) before prompt composition / file-ref derivation / persona invocation. Added in v0.20.3 #1. |
| `build_patch_applied`    | Patch successfully applied to worktree; manifest computed                                                                                                                                                     |
| `build_completed`        | `BUILD_REPORT.md` atomically written, Scientist sidecars updated, gate-preflight passed                                                                                                                       |
| `build_failed`           | BUILD aborted before producing a valid `BUILD_REPORT.md` (patch invalid, manifest mismatch, persona repair exhausted, reset-failure, etc.)                                                                    |

`build_failed` is distinct from `verify_failed`: BUILD failure means no valid BUILD_REPORT.md exists. VERIFY failure means BUILD_REPORT.md is valid but the validation command fell over. Restart-on-fail (see § "Restart-policy interface") covers VERIFY failure only; BUILD failure produces `NEEDS_INTERVENTION.json` directly.

## Scientist tail

BUILD runs the Scientist phase-tail before writing `GATE_BUILD_PASSED.json`, per non-negotiable rule 15 and [`SCIENTIST.md`](./SCIENTIST.md) § "How the phase-tail runs". The tail reads `BUILD_REPORT.md` plus the prior `HYPOTHESES.md` / `OPEN_QUESTIONS.md`, identifies new load-bearing claims (e.g., "the patch correctly handles two-syllable surnames" → `H-NNN` with falsifier "VERIFY mutation test passes"), and updates the sidecars atomically. Gate-preflight then validates sidecar parsability, falsifier presence, and overdue-question absence.

The Scientist persona's blast radius stays bounded (Codex M7-M10 shape risk #5: "Scientist tail may become gate noise"). M7 sets a tight severity threshold: BUILD's tail emits at most 3 new hypotheses and 3 new questions per attempt; counts above the threshold raise `scientist_tail_excess` and require persona repair, not gate kill.

## Restart-policy interface

BUILD does not implement the restart policy; M8's VERIFY does ([`VERIFY.md`](./VERIFY.md) § "Restart-on-fail policy"). BUILD's contribution is the **input shape** that the restart policy reads on attempt N+1: the `## Failure carry-forward` section above.

Three-line summary for cross-reference:

1. When attempt N's VERIFY emits `verdict: fail`, M8's restart policy preserves forensics in `.code-oz/runs/<runId>/forensics/<N>/`, destroys the worktree as active candidate, and prepares the next BUILD attempt's prompt with the failure-constraint block from VERIFY.md propagated verbatim.
2. The next BUILD attempt enters with `Attempt: N+1` in `BUILD_REPORT.md` and a populated `## Failure carry-forward` section using the locked grammar above.
3. Hard cap: 4 clean BUILD attempts. Attempt 5 produces `NEEDS_INTERVENTION.json` (rule 11) instead of a 5th BUILD invocation.

Failure-carry-forward is **not** a soft patch loop (Decision 3 in the M7-M10 shape debate). Each attempt starts from the same approved PLAN; prior worktrees are forensic, not active.

### Worktree-reset invariant (v0.20.3 #1)

Every BUILD attempt > 1 on the **verify-fail** restart path starts from the run's immutable base commit before the builder persona sees files, the orchestrator derives provider file refs, or `git apply` runs. This is implemented as `resetWorktreeToBase` in `src/worktree/reset.ts`: `git reset --hard <baseCommitSha>` followed by `git clean -fdx`. The reset emits `worktree_reset_to_base` on success (after `build_started`, before prompt composition); on failure it emits `build_failed` followed by `intervention` with code `worktree_reset_failed`. Codex debate `019e28d9-bd57-71e0-b1a2-262cae205234` locked this as a single BUILD-entry authority boundary — VERIFY, REVIEW, scheduler, and approve hooks do **not** call the reset primitive.

**Scope: verify-fail only.** The `review-needs-revision` restart path intentionally preserves the worktree across attempts so that attempt 2's delta patch can build on attempt 1's post-state (per the M9 review-remediation contract, M16 C9 Mod #7; see [`REVIEW.md`](./REVIEW.md)). Resetting on review-revision restarts would clobber prior staged content and break delta-shape builder responses. The reset fires only when `carryForward.source === 'verify-fail'` (the Codex debate brief did not surface the M9 worktree-preservation contract; the verify-fail narrowing closes the gap).

## What VERIFY reads from this

M7 → M8 handoff seam. VERIFY reads exactly the following from `BUILD_REPORT.md`:

- `Task.Task` (the `T-NNN` id) — to bind verdict to PLAN's task.
- `Task.Attempt` — recorded immutably in VERIFY.md's `BUILD ref.Attempt`; drives restart-policy cap counting.
- `Base.Base commit` (`baseCommitSha`) — recorded immutably in VERIFY.md as part of the BUILD ref.
- `Patch.Patch sha256` (`patchSha256`) — recorded immutably in VERIFY.md as part of the BUILD ref; mismatch on re-read fails with `verify_build_ref_mismatch`.
- `Changed files` (the full manifest) — REVIEW (M9) consumes the path list; VERIFY uses it to scope mutation testing in M8.
- `Validation command` (the four bullets verbatim) — VERIFY executes this command shape against the worktree; substitution is rejected.
- `Failure carry-forward` (when present) — VERIFY treats attempt > 1 as eligible for the restart-policy hard cap and emits `verify_restart_initiated` if the carry-forward chain reaches attempt 4.

VERIFY does not read `Notes` (free-form), `Task.Title`, or `Patch.Patch path` (forensics-only). REVIEW reads `Changed files` paths but no other section.

No orphan field: every field in this schema is read by VERIFY (M8) or REVIEW (M9) or used by the orchestrator for restart accounting. Every field VERIFY needs (per [`VERIFY.md`](./VERIFY.md) § "BUILD ref") is a field this schema writes.

## Common errors

| Error                                  | Meaning                                                         | Action                           |
| -------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| `build_report_missing_section`         | Required H2 absent from BUILD_REPORT.md (orchestrator emit bug; rare)               | Investigate orchestrator                              |
| `build_report_section_out_of_order`    | Sections present but not canonical (orchestrator emit bug; rare)                    | Investigate orchestrator                              |
| `build_task_id_unknown`                | Selected `T-NNN` absent from PLAN.md (preflight check 2)                            | Fix or rerun PLAN                                     |
| `build_plan_sha_drift`                 | PLAN.md sha changed between preflight pin and final read (preflight check 1)        | Concurrent run; abort and rerun                       |
| `build_plan_base_drift`                | PLAN task references files absent from bound base (preflight check 3)               | Rerun PLAN against current `HEAD` or pick new task    |
| `build_base_commit_unknown`            | `Base.Base commit` does not exist in the worktree's git history                     | Worktree corruption; rerun BUILD                      |
| `build_patch_apply_check_failed`       | `git apply --check` rejected the patch (malformed diff, hunk mismatch)              | Persona repair (one round; on failure → intervention) |
| `build_patch_partial_apply`            | `git apply` succeeded `--check` but partially applied (git env bug)                 | Investigate git env; emit `intervention`              |
| `build_patch_grammar_invalid`          | Pre-`git apply` scanner rejected diff headers (path-safety, symlink, binary)        | Persona repair (one round; on failure → intervention) |
| `build_patch_binary_unsupported`       | Patch contains binary marker; binary patches deferred to W3                         | Author non-binary patch                               |
| `build_manifest_path_unsafe`           | Computed manifest contains an absolute or `..`-traversing path (orchestrator catch) | Patch invalid; treat as `build_patch_grammar_invalid` |
| `build_manifest_patch_drift`           | Computed manifest disagrees with the patch's affected paths                         | Orchestrator bug; investigate                         |
| `build_validation_command_missing`     | Selected PLAN task block lacks the four `Validation command` bullets (preflight 5)  | Fix or rerun PLAN                                     |
| `build_validation_command_substituted` | Persona response embedded a different command than PLAN's (substitution rejected)   | Persona repair (one round; on failure → intervention) |
| `build_carry_forward_grammar`          | `## Failure carry-forward` shape violates locked grammar (orchestrator emit bug)    | Investigate orchestrator                              |
| `build_carry_forward_attempt_mismatch` | `Attempt > 1` but `## Failure carry-forward` is `None`                              | Restart-policy bug; investigate                       |
| `build_repo_context_root_unbound`      | `tool_use.repo_context.roots` not overridden to worktree path (preflight 4)         | Bug; abort and emit `intervention`                    |
| `build_persona_protocol_violation`     | Response missing `<build-ready/>` marker, no fenced diff, or extra schema sections  | Persona repair (one round; on failure → intervention) |
| `build_validation_failed`              | Persona produced a draft that failed both repair attempts                           | Inspect `<runId>/build-drafts/`; emit `intervention`  |

## Reference

- **Linked contracts:** [`WORKTREE.md`](./WORKTREE.md) (M7 commit 1), [`VERIFY.md`](./VERIFY.md), [`REVIEW.md`](./REVIEW.md), [`PLAN.md`](./PLAN.md), [`SOURCE_CHECK.md`](./SOURCE_CHECK.md), [`SCIENTIST.md`](./SCIENTIST.md), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md), [`GATES.md`](./GATES.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 7 (Markdown contracts), 9 (permission manifest for any execution), 13 (privacy by default), 15 (Scientist tail), 19 (run-level budget enforcement), 20 (one new authority boundary per milestone)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — split BUILD/VERIFY/REVIEW with shared contract surface; risk #2 ("fake green gate") is the load-bearing reason this contract pins changed-file manifest, base commit, patch hash, and validation command shape. [`docs/design/CODEX_RESPONSE_M7.md`](../design/CODEX_RESPONSE_M7.md) (thread `019ddeea`, 2026-04-30) — implementation review; C1 (orchestrator owns computed fields), C2 (BUILD entry preflight drift check), C3 (worktree survives BUILD gate), H1 (repo-context roots resolve against worktree), H3 (real patch path-safety scanner), M2 (validation command copied from PLAN, not synthesized)
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Pre-M7 (this contract), § M7 (BUILD-lite implementation)
