# code-oz — Pre-M7 contract-convergence session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else. The non-negotiable rules in there override anything that conflicts in this kickoff.

This session does **not** ship M7. It writes the **shared handoff contract surface** that M7, M8, and M9 will all consume. No code lands. No version tag. The goal is three small, sharp Markdown contracts that make the M7-M10 split safe.

## State at start of this session

- **Repo:** `github.com/omerakben/code-oz` (local-only; not yet pushed). Branch `main` carries the M6 merge.
- **Last release:** `v0.6.0-alpha.0` — M6 closed. PLAN phase + repo-context MVP + Scientist substrate + `budgets.global`. Tagged on `main` locally; 26 commits ahead of origin.
- **Tests:** 783 passing, offline.
- **Binary:** `dist/code-oz` reports `0.6.0-alpha.0`.
- **What works:** DEFINE → PLAN end to end with FakeProvider; repo-context tools (glob, grep, read) under `tool_use.repo_context`; Scientist sidecars (HYPOTHESES.md, OPEN_QUESTIONS.md) at PLAN gate; `budgets.global` cumulative enforcement; universal-rules.md injected into every persona prompt.
- **What's stubbed:** BUILD / VERIFY / REVIEW phases. Worktree-per-run isolation. Scientist tails for BUILD/VERIFY/REVIEW. AUDIT phase. SHIP.

## Why this session exists (the thesis)

After M6 closed, a thesis-level debate (Claude + Codex + Ozzy, thread `019ddea0`) reshaped the M7-M10 plan. The original M7 row in `ROADMAP.md` bundled BUILD-lite + VERIFY-lite + REVIEW-lite + iterative-loop + mutation-gate + Scientist-tails + Prompter-experiment into one milestone. Codex's verdict: that bundle hides bugs behind passing tests (the M6 catch was exactly that pattern, and it required Codex to trace data flow on a single phase). User decision: split BUILD/VERIFY/REVIEW into M7 / M8 / M9 — one new authority boundary per milestone (now CLAUDE.md rule 20).

But splitting implementation does **not** mean splitting the contract surface. Without a shared handoff contract, M8's VERIFY either rewrites M7's BUILD contract or validates the wrong abstraction. So before M7 code lands, this session pins the contract surface — once, sharply, in three sibling docs.

## Must-read artifacts (in this order)

1. **`CLAUDE.md`** — newly added rule 20 (one new authority boundary per milestone) and updated status line (M6 closed, M7-M10 split).
2. **`docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md`** — the brief sent to Codex (thread `019ddea0`).
3. **`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`** — Codex's `accept-with-modifications` verdict on all four decisions, plus the seven risks. Treat this as the spec for what each contract must pin.
4. **`docs/design/ROADMAP.md`** § Pre-M7 + § M7 + § M8 + § M9 + § M10 — the new milestone shape this session is preparing for.
5. **`docs/contracts/PLAN.md`** — pattern reference. The three new contracts follow the same structure (frontmatter, schema section, event types section, permissions section, handoff section).

Skim only what's necessary from M6's contracts to ground each handoff:
- `docs/contracts/SOURCE_CHECK.md` — pattern for cross-referenced ids (the BUILD contract's changed-file manifest follows a similar shape).
- `docs/contracts/SCIENTIST.md` — pattern for phase-tail wiring (each new contract names that the phase runs Scientist before gate).
- `docs/contracts/REPO_CONTEXT.md` — pattern for permission-scoped tooling (the BUILD contract names that the patch tool lives behind a permission scope).

## Your task — write three sibling handoff contracts

Each contract is a single Markdown file in `docs/contracts/`. Each is **scoped to one phase**. Each cross-references the others at the handoff seams. **No code in this session.**

### `docs/contracts/BUILD.md`

Scope: defines the contract M7 implements and M8's VERIFY consumes.

Required sections:

1. **Phase overview** — one paragraph: what BUILD does (apply one atomic PLAN task into an isolated worktree, write `BUILD_REPORT.md`, run Scientist tail, stop before VERIFY).
2. **`BUILD_REPORT.md` schema** — the canonical Markdown schema (sections, required fields). Mandatory fields:
   - Task id reference (`T-NNN` from PLAN.md)
   - Base commit sha (the worktree's starting point)
   - Patch hash (sha256 of the applied patch)
   - Changed-file manifest (path + sha256 + change-type per file)
   - Validation command shape (the command shape M8's VERIFY will execute)
   - Failure carry-forward block (populated only when this BUILD is attempt N+1 after a VERIFY fail; carries the prior failure constraint)
3. **Permissions required** — `tool_use.write` (patch application), `tool_use.repo_context` (already from M6), worktree-runtime (M7's WORKTREE.md will define this).
4. **Event types emitted** — `build_started`, `build_patch_applied`, `build_completed`, `build_failed`. Names only; the actual `state/schemas.ts` entries land in M7 commit 5-equivalent.
5. **Scientist tail** — names that BUILD runs Scientist before writing `GATE_BUILD_PASSED.json`; references `docs/contracts/SCIENTIST.md`.
6. **Restart-policy interface** — names the failure-carry-forward shape M8's restart policy reads from (one paragraph; full restart logic lives in M8's contract).
7. **What VERIFY reads from this** — single paragraph, explicit field list. This is the M7 → M8 handoff seam.

### `docs/contracts/VERIFY.md`

Scope: defines the contract M8 implements; M7's BUILD writes the input; M9's REVIEW consumes the output.

Required sections:

1. **Phase overview** — one paragraph: what VERIFY does (run validation command from BUILD_REPORT.md, emit VERIFY.md, hard-restart on fail).
2. **`VERIFY.md` schema** — the canonical Markdown schema. Mandatory fields:
   - Reference to `BUILD_REPORT.md` (commit sha + patch hash; immutable binding)
   - Validation command shape executed
   - Evidence: stdout / stderr / exit code / duration
   - Verdict (`pass` / `fail`) + one-line rationale
   - Mutation-test results (when applicable; new-behavior tests must fail on reverted code)
3. **Permissions required** — `tool_use.execute` (running the validation command in the worktree); test-runner tool surface.
4. **Event types emitted** — `verify_started`, `verify_completed`, `verify_failed`, `verify_restart_initiated`.
5. **Scientist tail** — names that VERIFY runs Scientist before writing `GATE_VERIFY_PASSED.json`.
6. **Restart-on-fail policy** — explicit rule: failed VERIFY destroys worktree as active candidate, preserves forensics in `.code-oz/runs/<runId>/forensics/<attempt>/`, attempt N+1 starts from same approved PLAN with a compact failure-constraint block (max 4 clean attempts; attempt 5 → `NEEDS_INTERVENTION.json`). No soft patch loop. The discipline is what makes the gate authoritative.
7. **What BUILD reads from this on restart** — names the failure-constraint block that BUILD's failure carry-forward consumes on the next attempt. This is the M8 → M7-restart handoff seam.
8. **What REVIEW reads from this** — VERIFY.md path + BUILD's changed-file manifest paths. Single paragraph. This is the M8 → M9 handoff seam.

### `docs/contracts/REVIEW.md`

Scope: defines the contract M9 implements; M8's VERIFY writes the upstream evidence.

Required sections:

1. **Phase overview** — one paragraph: what REVIEW does (cross-family review of changed files, bounded loop, score+verdict exit).
2. **`REVIEW.md` schema** — the canonical Markdown schema. Mandatory fields:
   - Reference to `BUILD_REPORT.md` and `VERIFY.md`
   - Reviewer provider family (must differ from BUILD persona's provider family)
   - Round count (≤ 4)
   - Findings (per file + line + severity + recommendation)
   - Score (0-10) + verdict (`ready` / `needs-revision` / `block`)
3. **Permissions required** — `tool_use.review-request` (the M4 primitive consumed); read-only access to changed files in the worktree.
4. **Event types emitted** — `review_started`, `review_round_completed`, `review_resolved`, `review_blocked`.
5. **Scientist tail** — names that REVIEW runs Scientist before writing `GATE_REVIEW_PASSED.json`.
6. **Cross-family enforcement** — references CLAUDE.md rule 2; cites M2's load-time enforcement; names that REVIEW will fail-fast at load if the configured reviewer shares family with BUILD.
7. **Loop cap** — references CLAUDE.md rule 6; names the exit condition (score ≥ 6 + verdict = ready) and the cap-exhaust behavior (attempt 5 → `NEEDS_INTERVENTION.json`).
8. **What SHIP reads from this** — REVIEW.md path + final verdict. Single paragraph. This is the M9 → SHIP handoff seam (SHIP itself is W4 scope).

## Acceptance criteria for the session

- Three new files exist: `docs/contracts/BUILD.md`, `docs/contracts/VERIFY.md`, `docs/contracts/REVIEW.md`.
- Each contract has all required sections from the lists above.
- Cross-references between the three contracts are explicit and consistent (the BUILD → VERIFY handoff section names the same fields the VERIFY input section names; same for VERIFY → REVIEW).
- No orphan field: every field a downstream contract reads must be a field the upstream contract writes.
- Each contract names its event types but does NOT add them to `src/state/schemas.ts` (that's M7-M9 work).
- One commit, conventional message: `docs(contracts): pin BUILD, VERIFY, REVIEW handoff surface (pre-M7)`.
- After commit, `bun test` and `bun run typecheck` still pass (no code changes; this is just to confirm nothing accidentally broke).

## Don't-do list (anti-scope-creep)

- **No code.** No `.ts` files. No tests. No fixtures. This session is contracts only.
- **Do not write `WORKTREE.md`** — that's M7 commit 1 (per Codex's recommendation; lives with the BUILD-lite implementation).
- **Do not write `DEBATE.md`** — that's M7 commit 2 (process contract during M7).
- **Do not write SHIP.md** — W4 scope.
- **Do not amend any M6 contract.** PLAN.md / SOURCE_CHECK.md / REPO_CONTEXT.md / SCIENTIST.md / HYPOTHESES.md / OPEN_QUESTIONS.md are immutable as of v0.6.
- **Do not push to GitHub.** Local commit only (CLAUDE.md "Working in this repo" rule 5).
- **Do not invoke Codex implementation review** for this session — Codex's verdict on the contract-shape thesis is already captured in `CODEX_RESPONSE_M7_M10_SHAPE.md`. A second Codex round here is scope creep. Codex's M7 implementation review fires after M7 code lands.
- **Do not invent new permission scopes.** Each contract names its required scopes by reference; the actual schema additions land in M7-M9 implementation commits.
- **Do not write a version tag.** No `v0.6.1` or `v0.7.0-alpha.0`. The next tag is M7's `v0.7.0-alpha.0`.

## Resume notes

If this session crashes mid-write:

- The three contracts are independent — partial completion is recoverable. Resume by reading what's on disk in `docs/contracts/{BUILD,VERIFY,REVIEW}.md` and continuing the missing sections.
- The thesis-debate trail (`docs/research/CODEX_BRIEFING_M7_M10_SHAPE.md` + `CODEX_RESPONSE_M7_M10_SHAPE.md`) is immutable history; do NOT re-run the debate unless the contract scope materially changes.
- If a contract section feels under-specified mid-write, pause and ask Ozzy rather than guessing — the contract is the spec for three milestones of code, so a vague phrase here costs days downstream.

## After this session

The next session is **M7 implementation**:

- Branch `feat/m7` from `main`.
- Commit 1: `docs/contracts/WORKTREE.md`.
- Commit 2: `docs/contracts/DEBATE.md` (process contract; runtime in M10).
- Commits 3+: BUILD-lite implementation per the M7 row in `ROADMAP.md`.
- Codex implementation review per CLAUDE.md rule 8 before tag.
- Tag: `v0.7.0-alpha.0`.

The session starter for M7 implementation will live at `docs/design/SESSION_M7_KICKOFF.md` and gets written either at the end of this session (if Ozzy wants it teed up) or at the start of M7 itself.

## Three of us are building this

Cross-family debate produced this session's plan. Cross-family review will validate M7's implementation. The discipline is the product — never present "ready to proceed" without it.

End of pre-M7 kickoff.
