# REVIEW (v0.1)

User-facing summary of the REVIEW phase contract — the data REVIEW writes, how cross-family is enforced, how the loop cap closes, and the single field SHIP consumes. Authoritative for v0.1 and the milestone target of M9.

This contract is part of the pre-M7 handoff surface. M7 implements [`BUILD.md`](./BUILD.md)'s writers; M8 implements [`VERIFY.md`](./VERIFY.md)'s readers + restart; M9 implements this contract. SHIP (W4 scope) consumes one immutable field from REVIEW.md and nothing else.

**Panel-mode extension (M14):** when `reviewer.panel: [...]` is configured under the `company:` block with two or more entries, REVIEW delegates to the panel orchestrator. Panel mode runs cross-family quorum (exactly 2 voters) with optional same-family advisory panelists, stages per-panelist drafts, and synthesizes one canonical `REVIEW.md` after all panelists complete. See [`REVIEW_PANEL.md`](./REVIEW_PANEL.md) for the full panel contract; the schema, events, and verdict semantics in this document continue to govern when no panel is configured.

## Phase overview

REVIEW invokes a different-family reviewer on the changed files BUILD recorded, runs a bounded loop (≤ 4 rounds) with score-and-verdict exit, writes `REVIEW.md`, runs the Scientist phase-tail, and stops before SHIP. REVIEW's authority is **cross-family disagreement made auditable** (non-negotiable rule 2): the reviewer's provider family must differ from BUILD's, the reviewer receives file paths (not curated summaries), and the loop closes on agreement (`score ≥ 6` AND `verdict: ready`) or exhaustion (round 5 → `NEEDS_INTERVENTION.json`).

## `REVIEW.md` schema

`.code-oz/artifacts/REVIEW.md` is plain Markdown with locked H2 sections in canonical order. The orchestrator parses it; the reviewer persona authors `Findings` and `Score` per round; the orchestrator records `Round count`, `Round timeline`, and the immutable BUILD/VERIFY refs.

```markdown
# REVIEW

## Upstream refs

- BUILD_REPORT.md: .code-oz/artifacts/BUILD_REPORT.md (sha256: <build-sha>)
- VERIFY.md: .code-oz/artifacts/VERIFY.md (sha256: <verify-sha>)
- Task: T-001
- Attempt: 1
- Base commit: 9c1f2a3b4d5e6f7081929394a5b6c7d8e9fa0b1c
- Patch sha256: 7f3a9b1c2d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f50617283940a1b2c3d4

## Reviewer

- Provider family: codex
- Provider id: codex
- Model policy: { primary: gpt-5.5-xhigh, fallback: gpt-5.5 }
- Cross-family check: passed (BUILD family: claude; reviewer family: codex)

## Round timeline

- Round 1: 2026-05-14T18:11:23Z | findings raised: 3 | score: 5 | verdict: needs-revision
- Round 2: 2026-05-14T18:34:08Z | findings raised: 1 | score: 7 | verdict: ready

## Findings

### F-001: Stress-pattern heuristic ignores hyphenated surnames

- File: src/scoring/syllable.ts
- Line: 42-58
- Severity: fix-first
- Recommendation: split on `-` before counting syllables; add fixture for "Ali-Khan".
- Round raised: 1
- Round resolved: 2

### F-002: Test only covers two-syllable surnames

- File: tests/scoring-syllable.test.ts
- Line: 12-28
- Severity: nit
- Recommendation: add a three-syllable case ("Anderson") to lock the heuristic boundary.
- Round raised: 1
- Round resolved: unresolved

## Score

- Round count: 2
- Final score: 7
- Final verdict: ready
- Exit reason: score >= 6 AND verdict = ready

## Cap status

- Cap: 4 rounds
- Rounds used: 2
- Cap exhausted: false
```

### Required H2 sections

| Section | What it answers | Min content |
|---|---|---|
| `## Upstream refs` | Immutable binding to BUILD attempt and VERIFY pass | 6 bullets (BUILD_REPORT.md, VERIFY.md, Task, Attempt, Base commit, Patch sha256) |
| `## Reviewer` | Identity and cross-family proof | 4 bullets (Provider family, Provider id, Model policy, Cross-family check) |
| `## Round timeline` | Per-round summary in chronological order | ≥ 1 bullet, locked grammar (below) |
| `## Findings` | All findings raised across rounds | ≥ 0 H3 blocks; `- None.` if zero |
| `## Score` | Final round count, score, verdict, exit reason | 4 bullets (Round count, Final score, Final verdict, Exit reason) |
| `## Cap status` | Whether the loop hit the 4-round cap | 3 bullets (Cap, Rounds used, Cap exhausted) |

Sections appear in canonical order. `## Tasks`-style H3 blocks (`### F-NNN:`) live only inside `## Findings`; all other sections are bullets-only (mirroring PLAN.md's discipline).

### `## Upstream refs` immutable binding (locked)

Mirrors VERIFY.md's `## BUILD ref` pattern, extended with the VERIFY.md reference. Drift between REVIEW's recorded `Patch sha256` and BUILD_REPORT.md's `Patch.Patch sha256` (or VERIFY.md's `BUILD ref.Patch sha256`) fails with `review_upstream_mismatch` and triggers run-level intervention — REVIEW does not retry around drift.

### `## Reviewer` cross-family check (locked)

`Provider family` must differ from BUILD's `provider` family at run config time. The check fires at **load time** in `src/agents/loader.ts` (M2 enforcement, extended in M9): if the configured REVIEW persona's `provider` matches the configured BUILD persona's `provider` family, the run aborts before BUILD runs with `review_cross_family_violation`. By the time REVIEW.md is written, `Cross-family check: passed` is a recorded post-condition, not a runtime gate.

Provider family equivalence in v0.1: `claude` and `codex` are different families; `gemini` is a third family (stub in v0.1). Future Anthropic / OpenAI / Google sub-models inherit their parent's family (e.g., `claude-haiku-4-5` is family `claude`).

### `## Round timeline` grammar (locked)

Each bullet is `Round <N>: <ISO timestamp> | findings raised: <count> | score: <0-10> | verdict: <ready | needs-revision | block>`.

- `N` starts at 1 and increments by 1 per round; gaps fail validation.
- `score` is integer 0–10 inclusive.
- `verdict` is one of three locked values; other strings fail validation.
- The final timeline bullet's `score` and `verdict` must match `## Score.Final score` and `## Score.Final verdict` exactly.

### `## Findings` grammar (locked)

Each H3 block is a finding with stable `F-NNN` id, run-scoped:

```markdown
### F-NNN: <one-line title>

- File: <relative path inside the worktree>
- Line: <single line "42" or range "42-58">
- Severity: block | fix-first | nit | fyi
- Recommendation: <one-paragraph or one-line directive>
- Round raised: <1-4>
- Round resolved: <1-4 | unresolved>
```

- `Severity` is one of four locked values:
  - `block` — finding must clear before the loop can exit `ready`.
  - `fix-first` — must clear before the loop can exit `ready`. Locked stricter as of M9 commit 1: an unresolved `fix-first` at exit fails `Final verdict: ready` (Codex `CODEX_RESPONSE_M9.md` decision 3 catch — the original draft's severity table and findings exit rule disagreed on whether `fix-first` is a `ready` blocker; this edit picks the stricter exit rule and removes the contradiction).
  - `nit` — minor, optional.
  - `fyi` — informational only.
- `Round resolved: unresolved` is allowed only for severities `nit` and `fyi` at exit. An exit with `Final verdict: ready` and any `block` or `fix-first` finding still `unresolved` fails with `review_unresolved_blocker`.
- `File` paths must be a subset of BUILD_REPORT.md's `Changed files` paths (cross-checked at parse time).
- `Recommendation` is the reviewer's directive; the BUILD persona consumes it on the next round if `Final verdict: needs-revision`. `block` verdict halts the loop and writes `NEEDS_INTERVENTION.json`.

## Permissions required

```yaml
provider: codex                                # cross-family with BUILD's claude default
modelPolicy: { primary: gpt-5.5-xhigh, fallback: gpt-5.5 }
permissions:
  read: ['.code-oz/artifacts/SPEC.md', '.code-oz/artifacts/PLAN.md',
         '.code-oz/artifacts/SOURCE_CHECK.md',
         '.code-oz/artifacts/BUILD_REPORT.md', '.code-oz/artifacts/VERIFY.md',
         '.code-oz/artifacts/HYPOTHESES.md', '.code-oz/artifacts/OPEN_QUESTIONS.md',
         '.code-oz/runs/<runId>/worktree/']
  write: ['.code-oz/artifacts/REVIEW.md']
  bash: deny
  tool_use:
    repo_context:                              # M6 sub-scope, narrow read-only access to changed-file paths
      tools: ['glob', 'grep', 'read']
      roots: ['.code-oz/runs/<runId>/worktree/']
      maxResults: 50
      maxBytesPerResult: 16384
      maxFilesForNextManifest: 0               # REVIEW does not promote paths into a next manifest
      timeoutMs: 5000
      network: 'none'
    review_request:                             # M4 primitive consumed (reviewer-side); schema in src/agents/schema.ts
      tools: ['request-review']
      providers: ['codex', 'gemini']           # which families the BUILD persona may request reviewer from
      maxRounds: 4
      timeoutMsPerRound: 120000
      network: 'provider-only'                 # provider auth uses ambient credentials; no other network
```

- `tool_use.review_request` consumes the M4 primitive (`src/tools/review-request.ts`). REVIEW is the only phase that calls it in v0.1; broader `consult()` and `requestDebate()` are M10 / v0.3 scope.
- The reviewer reads file paths from BUILD_REPORT.md's `Changed files` manifest; reviewer prompts include the path list, not curated summaries (rule 2). The reviewer's own `tool_use.repo_context` reads file contents from the worktree.
- `network: 'provider-only'` is a v0.1 simplification: the reviewer makes provider-API calls through the configured CLI OAuth, no other network. W4 containerization will tighten this further.

## Event types emitted

Names listed here; canonical schemas land in `src/state/schemas.ts` during M9 implementation.

| Event | Emitted when |
|---|---|
| `review_started` | REVIEW persona invoked, upstream refs bound, cross-family check confirmed |
| `review_round_completed` | A round finishes with a recorded score and verdict |
| `review_resolved` | Loop exits with `score ≥ 6` AND `verdict: ready`; `REVIEW.md` atomically written |
| `review_blocked` | Loop exits with `verdict: block` (any round) or 4-round cap exhausted; `NEEDS_INTERVENTION.json` written |

`review_resolved` and `review_blocked` are mutually exclusive terminal events for the REVIEW phase; the orchestrator emits exactly one.

## Scientist tail

REVIEW runs the Scientist phase-tail before writing `GATE_REVIEW_PASSED.json`, per non-negotiable rule 15 and [`SCIENTIST.md`](./SCIENTIST.md) § "How the phase-tail runs". The tail reads `REVIEW.md` plus prior sidecars; severity-`block` and `fix-first` findings that escaped a `ready` exit (which the schema does not permit) seed `Q-NNN` open questions; reviewer-affirmed claims (e.g., "the heuristic correctly handles hyphenated surnames after F-001 fix") get marked verified in `HYPOTHESES.md`.

The same M7 severity threshold applies: at most 3 new hypotheses and 3 new questions per REVIEW close; counts above raise `scientist_tail_excess` (Codex M7-M10 shape risk #5).

## Cross-family enforcement

Non-negotiable rule 2 is load-bearing for REVIEW. The enforcement is **layered**:

1. **Load time** (`src/agents/loader.ts`, M2 enforcement extended in M9). When `code-oz run` resolves the agent set, the loader compares the BUILD persona's `provider` family with the REVIEW persona's `provider` family. Equality fails the run before any phase invocation with error code `review_cross_family_violation`. The run does not start.
2. **REVIEW invocation time** (`src/phases/review.ts`, M9). The phase runner re-checks the configured reviewer's family against the BUILD persona that produced the run's BUILD_REPORT.md. A mismatch with the run's actual BUILD provider (e.g., a config edit between BUILD and REVIEW) fails with the same error code; the run does not advance.
3. **Recorded post-condition** (`REVIEW.md` § "Reviewer.Cross-family check"). Once REVIEW.md is written, the bullet `Cross-family check: passed` is the durable record. Validation rejects `failed`; the orchestrator never writes a REVIEW.md with a failed cross-family check.

The discipline is the load-bearing reason REVIEW is not stubbed by a second Claude persona reading the BUILD output. Single-family review structurally cannot catch the bugs cross-family review catches (ARIS lesson, [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Locked decisions).

## Loop cap

Non-negotiable rule 6: max 4 rounds, exit on `score ≥ 6` AND `verdict: ready`.

| Round | What happens |
|---|---|
| 1 | Reviewer reads BUILD_REPORT.md `Changed files` paths from the worktree, raises findings, scores 0–10, verdicts `ready` / `needs-revision` / `block` |
| 2–3 | If `verdict: needs-revision`, BUILD persona is re-invoked with the round's findings; new BUILD attempt produces an updated BUILD_REPORT.md and VERIFY.md (which gates again); REVIEW resumes with the same `F-NNN` ids |
| 4 | Final round; if `score < 6` or `verdict ≠ ready`, the loop exits |
| Round 5 | Not invoked. Cap exhaustion → `NEEDS_INTERVENTION.json` per rule 11 |

Exit conditions, in priority order:

1. Any round emits `verdict: block` → write `REVIEW.md` with `Final verdict: block`, emit `review_blocked`, write `NEEDS_INTERVENTION.json`.
2. A round emits `score ≥ 6` AND `verdict: ready` AND no `block` / `fix-first` finding remains `unresolved` → write `REVIEW.md` with `Final verdict: ready`, emit `review_resolved`, advance.
3. Round 4 ends without satisfying (1) or (2) → write `REVIEW.md` with the round-4 score/verdict and `Cap exhausted: true`, emit `review_blocked`, write `NEEDS_INTERVENTION.json`.

**Cap composition (locked, M9 commit 1).** The 4-round REVIEW cap and VERIFY's 4-attempt BUILD cap are **two monotonic global counters scoped to `(runId, taskId)`**, not a multiplicative budget (Codex `CODEX_RESPONSE_M9.md` decision 4 catch on the briefing's 4×4=16 lean). Whichever cap trips first owns the intervention. **VERIFY restarts between REVIEW rounds do not increment REVIEW round count.** When REVIEW round N's follow-up BUILD attempt exhausts VERIFY's 4-attempt cap, the intervention is VERIFY-owned with context "while addressing REVIEW round N"; `review_blocked` is **not** also emitted (avoiding double-terminal state that corrupts resume semantics). Run-level budget enforcement (rule 19, `budgets.global`) supersedes both caps when its own thresholds trip first.

## What SHIP reads from this

M9 → SHIP handoff seam (SHIP is W4 scope). SHIP reads exactly two fields from `REVIEW.md`:

- `Score.Final verdict` — must be `ready` for SHIP to proceed; `block` is terminal for the run.
- The path `.code-oz/artifacts/REVIEW.md` itself — SHIP records the REVIEW.md sha256 in its own gate signal as the immutable binding back to the approved review.

SHIP does not read findings, scores, round timelines, or upstream refs; those are forensic and audit. The narrow surface here is intentional — SHIP's authority boundary (W4) is release packaging, not review interpretation. Widening this seam is a W4 contract decision, not an M9 one.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `review_upstream_mismatch` | `Upstream refs` sha / commit / patch hash differs from BUILD_REPORT.md or VERIFY.md | Run-level intervention; not a persona retry |
| `review_cross_family_violation` | Reviewer family equals BUILD family at load or invocation | Edit config to use a different reviewer family |
| `review_round_gap` | `Round timeline` bullet skips a round number | Persona repair |
| `review_round_grammar` | `Round timeline` bullet violates locked grammar | Persona repair |
| `review_finding_id_collision` | Two findings share an `F-NNN` id | Renumber via the orchestrator |
| `review_finding_path_unknown` | `File:` path absent from BUILD_REPORT.md `Changed files` | Persona repair (reviewer cited a file outside the patch) |
| `review_severity_invalid` | `Severity` not in `{block, fix-first, nit, fyi}` | Persona repair |
| `review_verdict_invalid` | `Final verdict` not in `{ready, needs-revision, block}` | Persona repair |
| `review_unresolved_blocker` | `Final verdict: ready` with a `block` or `fix-first` finding still `unresolved` | Persona repair (raise verdict or resolve finding) |
| `review_cap_exhausted` | 4-round cap reached without `verdict: ready` | Orchestrator writes `NEEDS_INTERVENTION.json`; not a persona error |
| `review_validation_failed` | Persona produced a draft that failed both repair and finalize | Inspect `REVIEW.draft.md` |

## Reference

- **Linked contracts:** [`BUILD.md`](./BUILD.md), [`VERIFY.md`](./VERIFY.md), [`PLAN.md`](./PLAN.md), [`SOURCE_CHECK.md`](./SOURCE_CHECK.md), [`SCIENTIST.md`](./SCIENTIST.md), [`REVIEWER_MEMORY.md`](./REVIEWER_MEMORY.md), [`PROVIDERS.md`](./PROVIDERS.md), [`GATES.md`](./GATES.md)
- **M17 Reviewer Memory pointer:** [`REVIEWER_MEMORY.md`](./REVIEWER_MEMORY.md) captures the file-based lesson hygiene rubric for reusable REVIEW findings; this contract remains the per-run REVIEW artifact authority.
- **Non-negotiable rules:** `CLAUDE.md` rules 1 (file-based gates), 2 (cross-family review at REVIEW gate), 6 (4-round loop cap), 7 (Markdown contracts), 11 (`NEEDS_INTERVENTION.json` on cap), 13 (privacy by default), 15 (Scientist tail), 19 (run-level budget enforcement), 20 (one new authority boundary per milestone)
- **Design rationale:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30) — M9 = cross-family REVIEW authority, contract-shape-before-implementation thesis
- **Roadmap:** [`docs/design/ROADMAP.md`](../design/ROADMAP.md) § Pre-M7 (this contract), § M9 (REVIEW-lite implementation), § M10 (Debate runtime — separate from REVIEW)
