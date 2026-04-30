# BUILD (v0.1)

User-facing summary of the BUILD phase contract — the data BUILD writes and the seam M8's VERIFY consumes. Authoritative for v0.1 and the milestone target of M7.

This file pins the BUILD/VERIFY/REVIEW handoff surface before M7 implementation begins. Splitting BUILD/VERIFY/REVIEW into M7/M8/M9 (CLAUDE.md rule 20) without a shared contract surface would let M8's VERIFY either rewrite this contract or validate the wrong abstraction (Codex M7-M10 shape verdict, risk #2: "fake green gate"). The contract is written once here; M7 implements writers, M8 implements readers + restart, M9 implements review consumers.

## Phase overview

BUILD applies one atomic PLAN task into an isolated worktree, writes `BUILD_REPORT.md`, runs the Scientist phase-tail, and stops before VERIFY. BUILD does not run validation commands (M8's VERIFY does); BUILD does not approve itself (`code-oz approve build` does, after VERIFY). BUILD's authority boundary is **the patch and the manifest** — what changed, against which base, with what hash. Worktree creation, removal, and forensics live in [`WORKTREE.md`](./WORKTREE.md) (M7 commit 1).

## `BUILD_REPORT.md` schema

`.code-oz/artifacts/BUILD_REPORT.md` is plain Markdown with locked H2 sections in canonical order. The orchestrator parses it; the persona authors the body sections under repair/finalize discipline (mirroring PLAN.md).

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

### Required H2 sections

| Section | What it answers | Min content |
|---|---|---|
| `## Task` | Which PLAN task this BUILD applied | 4 bullets (Task, Title, PLAN.md ref, Attempt) |
| `## Base` | The worktree's starting point | 3 bullets (Worktree, Base commit, Dirty tree at base) |
| `## Patch` | The patch artifact and its hash | 3 bullets (Patch path, Patch sha256, Patch byte count) |
| `## Changed files` | The manifest VERIFY and REVIEW will read | ≥ 1 bullet, locked grammar (below) |
| `## Validation command` | The command shape M8 will execute | 4 bullets (Command, Working directory, Timeout (ms), Expected exit code) |
| `## Failure carry-forward` | Prior-attempt context (only on attempt > 1) | bullets per locked grammar (below); `- None (attempt 1).` when attempt = 1 |
| `## Notes` | Free-form one-line notes from the persona | ≥ 1 bullet (use `- None.` if absent) |

Sections appear in canonical order. Bullets are one line each. Multi-line entries split into multiple bullets.

### `## Changed files` grammar (locked)

Each bullet is `<relative-path> | sha256: <hex64> | change: <added | modified | deleted>`.

- Path is relative to the worktree root, never absolute, never `..`-traversing.
- `sha256` is the lower-case hex digest of the **post-patch** file contents (for `added` and `modified`) or the **pre-patch** contents (for `deleted`).
- `change` is one of three locked values; renames decompose into `deleted` + `added`.
- The set of paths matches exactly the patch's affected files; an entry without a corresponding patch hunk fails validation.

### `## Failure carry-forward` grammar (locked)

Populated only when `Attempt > 1`. Mirrors the failure-constraint block VERIFY.md emits on fail (see [`VERIFY.md`](./VERIFY.md) § "Failure constraint (on fail)"). Same field set, written from BUILD's perspective on restart:

```markdown
## Failure carry-forward

- Prior attempt: 1
- Prior forensics: .code-oz/runs/<runId>/forensics/1/
- Prior validation command: bun test tests/scoring-syllable.test.ts
- Prior verdict: fail (exit code 1, duration 842 ms)
- Prior failure summary: expected stress on syllable 2; got stress on syllable 1.
- Constraint: prefer last-syllable stress for two-syllable surnames.
```

`Prior failure summary` and `Constraint` are each capped at 200 characters, single-line. Longer text fails validation; the persona must compress before emit.

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

## Event types emitted

Names listed here; canonical schemas land in `src/state/schemas.ts` during M7 implementation.

| Event | Emitted when |
|---|---|
| `build_started` | BUILD persona invoked, worktree resolved, base commit recorded |
| `build_patch_applied` | Patch successfully applied to worktree; manifest computed |
| `build_completed` | `BUILD_REPORT.md` atomically written, Scientist sidecars updated, gate-preflight passed |
| `build_failed` | BUILD aborted before producing a valid `BUILD_REPORT.md` (patch invalid, manifest mismatch, persona repair exhausted, etc.) |

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

| Error | Meaning | Action |
|---|---|---|
| `build_report_missing_section` | Required H2 absent from BUILD_REPORT.md | Edit or rerun BUILD persona |
| `build_report_section_out_of_order` | Sections present but not canonical | Reorder |
| `build_task_id_unknown` | `Task.Task` cites a `T-NNN` absent from PLAN.md | Fix or rerun PLAN |
| `build_base_commit_unknown` | `Base.Base commit` does not exist in the worktree's git history | Worktree corruption; rerun BUILD |
| `build_patch_sha256_mismatch` | Patch file sha256 does not match the recorded `Patch sha256` | Patch tampered; rerun BUILD |
| `build_manifest_path_unsafe` | A `Changed files` path is absolute or `..`-traversing | Persona repair |
| `build_manifest_patch_drift` | Manifest entry has no corresponding patch hunk | Persona repair |
| `build_validation_command_invalid` | `Validation command` lacks one of the four bullets | Persona repair |
| `build_carry_forward_grammar` | `## Failure carry-forward` shape violates locked grammar | Persona repair |
| `build_carry_forward_attempt_mismatch` | `Attempt > 1` but `## Failure carry-forward` is `None` | Restart-policy bug; investigate |
| `build_validation_failed` | Persona produced a draft that failed both repair and finalize | Inspect `BUILD_REPORT.draft.md` |

## Reference

- **Linked contracts:** [`WORKTREE.md`](./WORKTREE.md) (M7 commit 1), [`VERIFY.md`](./VERIFY.md), [`REVIEW.md`](./REVIEW.md), [`PLAN.md`](./PLAN.md), [`SOURCE_CHECK.md`](./SOURCE_CHECK.md), [`SCIENTIST.md`](./SCIENTIST.md), [`REPO_CONTEXT.md`](./REPO_CONTEXT.md), [`GATES.md`](./GATES.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 7 (Markdown contracts), 9 (permission manifest for any execution), 13 (privacy by default), 15 (Scientist tail), 19 (run-level budget enforcement), 20 (one new authority boundary per milestone)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — split BUILD/VERIFY/REVIEW with shared contract surface; risk #2 ("fake green gate") is the load-bearing reason this contract pins changed-file manifest, base commit, patch hash, and validation command shape
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Pre-M7 (this contract), § M7 (BUILD-lite implementation)
