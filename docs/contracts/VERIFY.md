# VERIFY (v0.1)

User-facing summary of the VERIFY phase contract — the data VERIFY writes, how it executes BUILD's recorded command, and how restart-on-fail keeps the gate authoritative. Authoritative for v0.1 and the milestone target of M8.

This contract is part of the pre-M7 handoff surface. M7 implements [`BUILD.md`](./BUILD.md)'s writers; M8 implements this contract's readers, executor, restart policy, and mutation-test gate; M9 ([`REVIEW.md`](./REVIEW.md)) consumes this output.

## Phase overview

VERIFY reads `BUILD_REPORT.md`, executes the validation command verbatim against the run's worktree, captures evidence (stdout / stderr / exit code / duration), evaluates an optional mutation-test gate, writes `VERIFY.md`, runs the Scientist phase-tail, and stops before REVIEW. On fail, VERIFY does not patch — it triggers the restart-on-fail policy: forensics preserved, worktree destroyed as active candidate, attempt N+1 starts clean from the same approved PLAN with a compact failure-constraint block. There is no soft patch loop; the discipline is what makes the gate authoritative (M7-M10 shape Decision 3, accept-with-modifications).

## `VERIFY.md` schema

`.code-oz/artifacts/VERIFY.md` is plain Markdown with locked H2 sections in canonical order. The orchestrator parses it. The persona authors a small structured response (extracted into `Verdict.Rationale` always, plus `Failure constraint.Failure summary` + `Failure constraint.Constraint` when verdict = fail). All other fields — including `Verdict.Verdict` (the binary pass/fail decision) and `Mutation.Notes` — are orchestrator-computed. The persona's narrative about mutation lives only in `Verdict.Rationale`; the orchestrator-owned `Mutation.Notes` is the diagnostic note returned by the mutation-status mapping.

```markdown
# VERIFY

## BUILD ref

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: <build-sha>)
- Task: T-001
- Attempt: 1
- Base commit: 9c1f2a3b4d5e6f7081929394a5b6c7d8e9fa0b1c
- Patch sha256: 7f3a9b1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f50617283940a1b2c3d4

## Validation command

- Command: bun test tests/scoring-syllable.test.ts
- Working directory: .code-oz/runs/<runId>/worktree/
- Timeout (ms): 60000
- Expected exit code: 0

## Evidence

- Exit code: 0
- Duration (ms): 842
- Stdout bytes: 1184
- Stderr bytes: 0
- Stdout log: .code-oz/runs/<runId>/forensics/1/stdout.log
- Stderr log: .code-oz/runs/<runId>/forensics/1/stderr.log

## Verdict

- Verdict: pass
- Rationale: validation command exited 0 within timeout; no stderr; mutation gate satisfied.

## Mutation

- Status: not-applicable
- Notes: BUILD task's PLAN bullet does not assert new behavior; mutation gate skipped.

## Failure constraint

- None (verdict pass).
```

### Required H2 sections

| Section | What it answers | Min content |
|---|---|---|
| `## BUILD ref` | Immutable binding to the BUILD attempt being verified | 5 bullets (BUILD_REPORT.md, Task, Attempt, Base commit, Patch sha256) |
| `## Validation command` | The command shape executed (verbatim from BUILD_REPORT.md) | 4 bullets (Command, Working directory, Timeout (ms), Expected exit code) |
| `## Evidence` | What the execution produced | 6 bullets (Exit code, Duration (ms), Stdout bytes, Stderr bytes, Stdout log, Stderr log) |
| `## Verdict` | Pass-or-fail decision and one-line rationale | 2 bullets (Verdict, Rationale) |
| `## Mutation` | Mutation-test gate result; **orchestrator-recorded** | 2 bullets (Status, Notes); Status ∈ {`pass`, `fail`, `not-applicable`}; Notes is the gate's diagnostic line, not persona prose |
| `## Failure constraint` | Compact directive for attempt N+1 (only on fail) | bullets per locked grammar (below); `- None (verdict pass).` when verdict = pass |

Sections appear in canonical order. Bullets are one line each.

### `## BUILD ref` immutable binding (locked)

The five bullets in `## BUILD ref` are the **immutable binding** from VERIFY back to its source BUILD attempt:

- `BUILD_REPORT.md` records the sha256 of the BUILD_REPORT.md contents at VERIFY-read time. Mismatch on a later read fails with `verify_build_ref_mismatch`.
- `Task` cites the same `T-NNN` id BUILD recorded.
- `Attempt` matches BUILD_REPORT.md's `Task.Attempt` exactly.
- `Base commit` and `Patch sha256` are copied verbatim from BUILD_REPORT.md's `Base.Base commit` and `Patch.Patch sha256`. Drift between BUILD's manifest and VERIFY's binding fails with `verify_build_ref_mismatch` and triggers BUILD-failure intervention (not VERIFY restart).

### `## Validation command` (locked, executed verbatim)

VERIFY copies the four bullets from BUILD_REPORT.md's `## Validation command` without modification, then executes them. Substitution, expansion, or interpolation by the persona is rejected; the orchestrator computes the canonical command line from these bullets and runs it against the worktree.

### `## Evidence` (orchestrator-recorded)

Captured from the executed process, not the persona. `Stdout log` and `Stderr log` point at byte-exact log files in the run's forensics directory, written before VERIFY.md is finalized so they survive a partial verdict abort. Logs are truncated at the test-runner abstraction's configured cap (M8 default: 1 MiB per stream).

### `## Verdict` (persona-authored rationale, orchestrator-validated)

`Verdict` is one of `pass` or `fail`. Other values fail validation. The persona authors `Rationale` (single-line, ≤ 200 chars) explaining the decision; the orchestrator validates that:

- `Verdict: pass` requires `Evidence.Exit code` to match `Validation command.Expected exit code` and `Mutation.Status` ∈ {`pass`, `not-applicable`}.
- `Verdict: fail` requires `Evidence.Exit code` to differ from `Validation command.Expected exit code` **or** `Mutation.Status` = `fail`.

A persona-authored verdict that contradicts evidence fails with `verify_verdict_evidence_mismatch`.

### `## Mutation` (orchestrator-recorded)

`Mutation.Status` is computed by the mutation gate from the runner's `terminationReason` and `exitCode` (per the gate semantics below). `Mutation.Notes` is the diagnostic note returned by the mutation-status mapping — describing why the gate passed, failed, or was skipped. **The persona may not author either field.** A persona that emits a `## Mutation` section in its draft response has those fields dropped; the persona's narrative about mutation belongs in `Verdict.Rationale`.

### `## Mutation` gate

The mutation-test gate (M8 implementation, [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § M8) reverts the patch's changed files to base, replays the validation command, and asserts that **new-behavior tests fail on reverted code**. Status values:

- `pass` — applicable and satisfied (new tests fail without the patch).
- `fail` — applicable and not satisfied (new tests pass without the patch → tautological).
- `not-applicable` — PLAN task's bullet does not assert new behavior; mutation gate skipped (Notes records why).

The applicability rule is conservative in v0.1: tests added in BUILD's `## Changed files` manifest with paths matching `**/*.test.ts` (or the project's configured test glob) are eligible for mutation; modifications-only attempts skip the gate.

### `## Failure constraint` grammar (locked)

Populated only when `Verdict.Verdict = fail`. Mirrors [`BUILD.md`](./BUILD.md) § "Failure carry-forward" field-for-field; the orchestrator copies these six bullets into BUILD attempt N+1's `## Failure carry-forward` section with `Prior` prepended to the first five labels (Constraint stays unprefixed because it is the active directive for the next attempt):

```markdown
## Failure constraint

- Attempt: 1
- Forensics: .code-oz/runs/<runId>/forensics/1/
- Validation command: bun test tests/scoring-syllable.test.ts
- Verdict: fail (exit code 1, duration 842 ms)
- Failure summary: expected stress on syllable 2; got stress on syllable 1.
- Constraint: prefer last-syllable stress for two-syllable surnames.
```

`Failure summary` and `Constraint` are each capped at 200 characters, single-line. The persona authors both: summary is descriptive; constraint is directive. Codex M7-M10 shape Decision 3 calls this the "compact failure constraint" — what makes restart productive without becoming a soft patch loop.

## Permissions required

```yaml
provider: claude
modelPolicy: { primary: claude-opus-4-7, fallback: claude-sonnet-4-6 }
permissions:
  read: ['.code-oz/artifacts/SPEC.md', '.code-oz/artifacts/PLAN.md',
         '.code-oz/artifacts/BUILD_REPORT.md',
         '.code-oz/artifacts/HYPOTHESES.md', '.code-oz/artifacts/OPEN_QUESTIONS.md',
         '.code-oz/runs/<runId>/worktree/']
  write: ['.code-oz/artifacts/VERIFY.md',
          '.code-oz/runs/<runId>/forensics/']
  bash: deny
  tool_use:
    repo_context:                              # M6 sub-scope, narrow read-only access to the worktree
      tools: ['glob', 'grep', 'read']
      roots: ['.code-oz/runs/<runId>/worktree/']
      maxResults: 50
      maxBytesPerResult: 16384
      maxFilesForNextManifest: 0               # VERIFY does not promote paths into a next manifest
      timeoutMs: 5000
      network: 'none'
    execute:                                    # M8 sub-scope (defined here, schema in M8)
      tools: ['test-runner']
      roots: ['.code-oz/runs/<runId>/worktree/']
      timeoutMs: 60000
      maxStdoutBytes: 1048576
      maxStderrBytes: 1048576
      network: 'none'
```

- `tool_use.execute` is VERIFY's new sub-scope. It governs running the validation command — the test runner abstraction in M8 (`src/tools/test-runner.ts`) is the only tool registered under it in v0.1. Arbitrary shell execution is **not** granted; the runtime intersects the requested command with BUILD_REPORT.md's recorded command shape and rejects mismatches.
- Network is `'none'`. Containerization (network isolation, secret-redaction, destructive-command protection) is W4 scope per Codex M7-M10 shape risk #1; in v0.1, the absence of network and `bash: deny` are the load-bearing safeguards.
- VERIFY does not modify the worktree (no `tool_use.write`); the worktree's state at VERIFY entry is the same state BUILD left.

## Event types emitted

Names listed here; canonical schemas land in `src/state/schemas.ts` during M8 implementation.

| Event | Emitted when |
|---|---|
| `verify_started` | VERIFY persona invoked, BUILD ref bound, worktree resolved |
| `verify_completed` | `VERIFY.md` atomically written with `Verdict: pass`, Scientist sidecars updated, gate-preflight passed |
| `verify_failed` | `VERIFY.md` atomically written with `Verdict: fail`, forensics preserved |
| `verify_restart_initiated` | Restart policy entered: failed worktree destroyed as active candidate, attempt N+1's BUILD scheduled (or attempt 5 → `NEEDS_INTERVENTION.json`) |

`verify_failed` is **not** a terminal event. Restart-on-fail proceeds through `verify_restart_initiated`; only the 4-attempt cap or persona-side abort produces `NEEDS_INTERVENTION.json`.

## Scientist tail

VERIFY runs the Scientist phase-tail before writing `GATE_VERIFY_PASSED.json`, per non-negotiable rule 15 and [`SCIENTIST.md`](./SCIENTIST.md) § "How the phase-tail runs". The tail reads `VERIFY.md` plus prior sidecars; on `Verdict: pass`, hypotheses whose falsifiers are now satisfied get marked verified (W2 scope adds the verified-state column; M8 records the falsifier-satisfied annotation in `HYPOTHESES.md`). On `Verdict: fail`, the failure summary may seed a new `Q-NNN` entry in `OPEN_QUESTIONS.md` describing the next decision.

The same M7 severity threshold applies: at most 3 new hypotheses and 3 new questions per VERIFY pass; counts above the threshold raise `scientist_tail_excess` and require persona repair (Codex M7-M10 shape risk #5).

## Restart-on-fail policy

Failed VERIFY does **not** enter a soft patch loop. The discipline is locked here so M8's `src/phases/restart-policy.ts` and BUILD's failure-carry-forward (M7) read the same rules:

1. **Forensics preserved.** On `Verdict: fail`, the orchestrator copies the failed worktree's diff, BUILD_REPORT.md, VERIFY.md, the patch file, both log streams, and the BUILD prompt + Constraint that fed the attempt into `.code-oz/runs/<runId>/forensics/<attempt>/`. Codex M7-M10 shape risk #3 names this list explicitly: "preserved diff, logs, artifact hashes, and prompt constraints, not just a leftover worktree."
2. **Worktree destroyed as active candidate.** The `git worktree remove` (or equivalent path-based cleanup, governed by [`WORKTREE.md`](./WORKTREE.md)) drops the failing worktree from active scheduling. Forensics survive in the runs directory.
3. **Attempt N+1 starts clean from the same approved PLAN.** No PLAN reopening, no worktree carry-forward, no patch reuse. The next BUILD invocation creates a fresh worktree at the same `Base commit`, with `Attempt: N+1` recorded and `## Failure carry-forward` populated from VERIFY's `## Failure constraint` (field-for-field, with `Prior` prepended).
4. **Hard cap: 4 clean BUILD attempts.** Attempts 1–4 are clean BUILD invocations; the count covers BUILD attempts, not patch retries (which do not exist). The 4th attempt's `## Failure carry-forward` carries forward the chain from attempts 1–3.
5. **Attempt 5 → `NEEDS_INTERVENTION.json`** (rule 11). The orchestrator does not invoke a 5th BUILD. The intervention file carries actionable text: the failure summaries from each prior attempt, the validation command, and a pointer to `forensics/`.

The restart-policy interface is shared with [`BUILD.md`](./BUILD.md) § "Restart-policy interface". The two contracts describe the same loop from each side.

## What BUILD reads from this on restart

M8 → M7-restart handoff seam. When VERIFY emits `verdict: fail`, the orchestrator reads exactly the following fields from `VERIFY.md` and propagates them into BUILD attempt N+1:

| VERIFY.md field | BUILD attempt N+1 field |
|---|---|
| `BUILD ref.Attempt` | `Failure carry-forward.Prior attempt` |
| `Failure constraint.Forensics` | `Failure carry-forward.Prior forensics` |
| `Failure constraint.Validation command` | `Failure carry-forward.Prior validation command` |
| `Failure constraint.Verdict` | `Failure carry-forward.Prior verdict` |
| `Failure constraint.Failure summary` | `Failure carry-forward.Prior failure summary` |
| `Failure constraint.Constraint` | `Failure carry-forward.Constraint` |

The orchestrator does the rename mechanically; the persona never sees both labels. BUILD also receives the prior `Constraint` text appended to the BUILD-system prompt as a directive line ("Constraint from prior failed attempt: <constraint>"). No other VERIFY.md field flows backward — `Evidence` (logs, durations) is forensic, not directive.

## What REVIEW reads from this

M8 → M9 handoff seam. REVIEW reads exactly the following from `VERIFY.md`:

- `BUILD ref` (all five bullets) — to bind REVIEW.md to the same Task / Base commit / Patch attempt VERIFY observed.
- `Verdict.Verdict` and `Verdict.Rationale` — REVIEW pre-conditions on `Verdict: pass`; REVIEW does not run on `Verdict: fail` (the run is already in restart-on-fail).
- `Evidence.Exit code` and `Evidence.Duration (ms)` — recorded as REVIEW's input metadata; not used for scoring.

REVIEW also reads BUILD_REPORT.md's `Changed files` paths to scope the reviewer's read access to the worktree. The path list flows REVIEW-side via [`REVIEW.md`](./REVIEW.md) § "What SHIP reads from this", not via VERIFY.md.

REVIEW does not read `Mutation`, `Failure constraint`, `Stdout log`, or `Stderr log` directly; those are forensics. Mutation results indirectly gate REVIEW: VERIFY's `Verdict: pass` requires `Mutation.Status` ∈ {`pass`, `not-applicable`}, so by the time REVIEW runs, mutation gating has already cleared.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `verify_report_missing_section` | Required H2 absent from VERIFY.md | Persona repair |
| `verify_build_ref_mismatch` | `BUILD ref` sha / commit / patch hash differs from BUILD_REPORT.md | BUILD/VERIFY ordering bug; investigate before retry |
| `verify_command_substitution` | Persona modified `Validation command` from BUILD_REPORT.md | Persona repair |
| `verify_evidence_missing` | Evidence bullets absent or pointing at unwritten log paths | Test-runner failure; investigate |
| `verify_verdict_evidence_mismatch` | `Verdict: pass` with non-zero exit, or `Verdict: fail` with matching expected exit | Persona repair |
| `verify_mutation_status_invalid` | `Mutation.Status` not in `{pass, fail, not-applicable}` | Persona repair |
| `verify_failure_constraint_grammar` | `## Failure constraint` shape violates locked grammar | Persona repair |
| `verify_failure_constraint_overlong` | `Failure summary` or `Constraint` over 200 characters | Persona repair |
| `verify_restart_cap_exceeded` | 4-attempt cap reached on a fail | Orchestrator writes `NEEDS_INTERVENTION.json`; not a persona error |
| `verify_validation_failed` | Persona produced a draft that failed both repair and finalize | Inspect `VERIFY.draft.md` |

## Reference

- **Linked contracts:** [`BUILD.md`](./BUILD.md), [`REVIEW.md`](./REVIEW.md), [`WORKTREE.md`](./WORKTREE.md) (M7 commit 1), [`PLAN.md`](./PLAN.md), [`SCIENTIST.md`](./SCIENTIST.md), [`GATES.md`](./GATES.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 6 (4-attempt cap pattern), 7 (Markdown contracts), 9 (permission manifest for execution), 11 (`NEEDS_INTERVENTION.json` on cap), 13 (privacy by default), 15 (Scientist tail), 19 (run-level budget enforcement), 20 (one new authority boundary per milestone)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — Decision 3 (restart-on-fail discipline) and risk #3 (forensics preservation list)
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Pre-M7 (this contract), § M8 (VERIFY-lite + restart-policy + mutation gate implementation)
