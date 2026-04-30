# code-oz — M7 Codex briefing (BUILD-lite implementation)

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M6 has shipped (`v0.6.0-alpha.0`, 783 tests passing offline, 19-commit sequence with three-round Codex review trail closed). The M7-M10 shape thesis debate closed with `accept-with-modifications` (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`, 2026-04-30); CLAUDE.md rule 20 ("one new authority boundary per milestone") added; ROADMAP updated to split BUILD / VERIFY / REVIEW across M7 / M8 / M9. The shared contract surface is now pinned:

- `docs/contracts/BUILD.md` (commit `d1cfb8e`, pre-M7) — BUILD_REPORT.md schema, locked grammar, permissions, restart-policy interface, what VERIFY/REVIEW read
- `docs/contracts/VERIFY.md` (commit `d1cfb8e`, pre-M7) — VERIFY.md schema, restart-on-fail policy seam, mutation gate seam
- `docs/contracts/REVIEW.md` (commit `d1cfb8e`, pre-M7) — REVIEW.md schema, cross-family handoff
- `docs/contracts/WORKTREE.md` (commit `f504c3d`, M7 commit 1) — `.code-oz/runs/<runId>/` layout, base-commit binding, dirty-tree policy, doctor check, forensics shape, allowed roots
- `docs/contracts/DEBATE.md` (commit `b8f0d00`, M7 commit 2) — process-only debate format; runtime is M10

**M7 is now BUILD-lite implementation only.** Acceptance per ROADMAP:

> BUILD applies one atomic PLAN task into an isolated worktree; writes `BUILD_REPORT.md` with full changed-file manifest + base-commit + patch hash + command-shape; runs Scientist tail; **stops before VERIFY** (M8 picks up). Worktree cleanup-on-success destroys the worktree; failure preserves diff + logs + artifact hashes + prompt constraints in `.code-oz/runs/<runId>/forensics/`. DEBATE.md process contract pinned (no runtime; runtime is M10). BUILD-lite e2e with FakeProvider: DEFINE → PLAN → BUILD produces complete worktree, BUILD_REPORT.md, Scientist sidecars; stops at BUILD gate. All M6 tests still pass (783 carried). Tag: `v0.7.0-alpha.0`.

You are not debating *what* to build (the contracts pin that). You are debating *how* to build it — twelve implementation decisions where my leans need pressure. Push back hard where the leans are wrong; sanity-check rather than rubber-stamp where they hold.

Mirror the verdict format from `CODEX_RESPONSE_M6.md`: numbered decisions, "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1-20. Rules 1 (file-based gates), 2 (cross-family review), 7 (Markdown contracts), 9 (permission manifest for execution), 11 (`NEEDS_INTERVENTION.json`), 13 (privacy by default), 15 (Scientist tail at gates), 16 (universal-rules.md injection), 19 (`budgets.global` enforcement), 20 (one new authority boundary per milestone — M7's boundary is **worktree-isolation + BUILD artifact authority**) are the tightest constraints on M7.

- **`docs/contracts/BUILD.md`** (commit `d1cfb8e`) — BUILD_REPORT.md schema with seven required H2 sections (Task, Base, Patch, Changed files, Validation command, Failure carry-forward, Notes), locked Changed-files grammar, locked Failure-carry-forward grammar, permissions including new `tool_use.write` sub-scope, four event names (`build_started`, `build_patch_applied`, `build_completed`, `build_failed`), Scientist tail spec, restart-policy interface, the M7→M8 handoff seam ("What VERIFY reads from this"), error table.

- **`docs/contracts/WORKTREE.md`** (commit `f504c3d`, M7 commit 1) — run directory layout (`worktree/` + `patches/` + `forensics/<N>/` + `base.txt` + `README.md`), distinct from `.code-oz/state/runs/<runId>/`. Base-commit binding (immutable per run, captured at creation, copied into BUILD_REPORT.md and `worktree_created` event). Dirty-tree policy (`clean-base` default; `stash-and-pin` opt-in). `git --version >= 2.40` doctor check. Four-step creation. Two removal paths (cleanup-on-success vs preserve-on-failure with forensics-first ordering). Patch application boundary (`git apply --check` then `git apply`, atomic-or-none, 65536-byte cap, binary rejected v0.1). Six `worktree_*` event names. Path-safety enforcement. **Worktree isolation is NOT a security sandbox** (W4 containerization is the hostile-code defense; v0.1 safeguards are bash deny + no execution sub-scopes + orchestrator-only git allowlist + patch path-safety).

- **`docs/contracts/DEBATE.md`** (commit `b8f0d00`, M7 commit 2) — process-only contract. Names the artifact layout under `.code-oz/artifacts/debates/<phase>-<topic>/`, the locked verdict enums, event types, `tool_use.debate` sub-scope, DECISION.md mandatory rationale. **No runtime in M7.** M10 implements `requestDebate()`.

- **`docs/contracts/SCIENTIST.md`**, **`docs/contracts/PLAN.md`**, **`docs/contracts/REPO_CONTEXT.md`**, **`docs/contracts/GATES.md`** — the M6 substrate BUILD-lite consumes. PLAN.md task block grammar (`T-NNN` ids), `repair → finalize` discipline, gate-preflight pattern that BUILD-lite mirrors.

- **`docs/design/ROADMAP.md § M7`** — file list (commits 3+: `src/worktree/{create,remove,inspect}-run-worktree.ts`, `src/worktree/{manifest,forensics}.ts`, `src/patches/{apply,validate}-agent-patch.ts`, `src/phases/build.ts`, `src/artifacts/build-report.ts`, `src/agents/defaults/builder.md`, `src/prompts/build-system.md`, `src/commands/doctor.ts` git check, tests).

- **`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`** — your prior verdict. Risk #1 ("worktree is not a sandbox"), risk #2 ("fake green gate" without pinned manifest/base/patch/command), risk #3 ("restart-on-fail vs soft patch loop"), risk #4 ("archived theater" → DECISION.md mandatory), risk #5 ("Scientist tail may become gate noise"). M7 is the first milestone where these risks bite implementation.

You do not need to re-read every M2-M6 source file. Glance at:

- **`src/phases/plan.ts`** (20k) — the canonical phase pattern. BUILD-lite phase mirrors: persona invocation → draft → repair → finalize → atomic write → Scientist tail → gate-preflight. Reuse `repairAndFinalize` shape.
- **`src/artifacts/plan.ts`** (21k) — canonical artifact-parsing pattern. BUILD-lite's `parseBuildReport` follows: BOM strip, line split, section walk, section-order check, grammar validation per section, throw `BuildReportLoadError` with frozen issues.
- **`src/agents/defaults/lead.md`** (5.1k) — current PLAN persona. BUILD persona mirrors structure (preamble + universal-rules-injection + role + discipline + format).
- **`src/prompts/universal-rules.md`** (2.4k) — the 20-item rule sheet (rule 16). Injected into every persona prompt.
- **`src/state/schemas.ts`**, **`src/state/events.ts`** — event union pattern. M7 adds 4 `build_*` + 6 `worktree_*` event types per the contracts.
- **`src/agents/schema.ts:42-47`** — `AgentPermissions` shape. M7 adds `tool_use.write` per BUILD.md.
- **`src/state/run.ts`** `requireGate`, `approveGate`, cross-file recovery. BUILD's gate-preflight extension validates BUILD_REPORT.md plus Scientist sidecars (per rule 15).
- **`src/agents/defaults/builder.md`** — current 1.6k stub, replaced wholesale in M7.

---

## What's locked (not up for debate)

These come from CLAUDE.md, the pinned contracts, and the M7-M10 shape thesis debate.

1. **BUILD writes `BUILD_REPORT.md` with the seven-section schema in `BUILD.md`.** Section order, grammar, error codes are pinned. Persona may not invent sections.
2. **`tool_use.write` is the only new sub-scope landing in M7.** It governs patch authoring; the runtime tool is `apply-patch` with `roots: ['.code-oz/runs/<runId>/worktree/']`. Schema lands in `src/agents/schema.ts`.
3. **Worktree creation/removal/forensics owned by orchestrator, not persona.** Personas never invoke git; the orchestrator runs the exact-shape git allowlist in WORKTREE.md.
4. **Path-safety enforced before patch apply.** `git apply --check` first, then `git apply`. Atomic-or-none. Binary patches rejected (`build_patch_binary_unsupported`). 65536-byte cap.
5. **BUILD persona is `claude` family in v0.1.** REVIEW (M9) is the first cross-family enforcement point; pinning BUILD as Claude in M7 establishes the relation REVIEW will validate. Codex-as-BUILD is W3+.
6. **BUILD-lite stops before VERIFY.** No validation command execution in M7; `BUILD_REPORT.md` records the command shape only. M8 brings the runner.
7. **No iterative build-patch loop in M7.** Restart-on-fail discipline lives in M8 (failed VERIFY destroys worktree as active candidate, attempt N+1 starts clean from same approved PLAN). M7 produces one BUILD attempt per run.
8. **No mutation-test gate in M7.** Lands in M8.
9. **Universal rules sheet (rule 16) injected into BUILD persona prompt.** Already shipped in M6 (`src/prompts/universal-rules.md`); M7 imports it.
10. **Scientist tail runs at BUILD gate** per rule 15 + BUILD.md § "Scientist tail". Cap of 3 new hypotheses + 3 new questions per attempt is named in BUILD.md but the value is up for debate (decision 5 below).
11. **No DEBATE runtime in M7.** Process contract was M7 commit 2; runtime is M10.
12. **All tests offline via FakeProvider.** Live-provider tests opt-in only.

---

## What's up for debate

Twelve decisions. Numbered for your reply.

### Decision 1 — Patch authoring path (persona-as-file-author vs persona-as-tool-user)

**My lean: persona writes the patch as a file artifact under `.code-oz/runs/<runId>/patches/<T-NNN>-attempt-<N>.patch`; orchestrator applies it via `git apply`.**

Two paths considered:

(a) **File-artifact path** (lean): persona's response is parsed for the patch body (fenced code block tagged `diff` or `patch`), atomic-written to the patches dir, orchestrator runs `git apply --check && git apply`. The patch sha256 lands in `BUILD_REPORT.md § Patch.Patch sha256`.

(b) **Tool-call path**: persona invokes a `tool_use.write.apply-patch` tool whose handler accepts `{ patch: string, taskId: string, attempt: number }` and applies directly. The tool is the only `tool_use.write` consumer in v0.1.

Trade: (a) gives a file-on-disk audit trail and matches the M5/M6 pattern of "persona writes Markdown, orchestrator validates and persists." (b) is closer to the eventual M10 tool-call style for `requestDebate`, but it splits "the patch" across response-parsing and tool-handler code paths, and the tool-call ends up writing the same file anyway.

**Counter-cases to consider:** If (a), how does the persona's response signal "this is the patch" versus "this is repair commentary"? PLAN's pattern uses fenced code blocks with section headers; BUILD's response is structurally simpler (one fenced patch block + one BUILD_REPORT.md draft). Does that fit cleanly?

**Question for you:** Is (a) the right call, or does the eventual M10 tool-call style make (b) load-bearing now?

### Decision 2 — When does worktree creation fire (eager vs lazy)

**My lean: lazy, fired on first `phase_entered build` event.**

Eager creation (at run start, before DEFINE) wastes worktree resources on runs that stop at PLAN — which is the common case for ask-me-driven user research. Lazy creation fires once we know BUILD will run.

**Counter-case:** if creation fails (e.g., `git --version` regression mid-session), we lose the entire DEFINE+PLAN session work. Eager creation surfaces that failure before any agent runs.

**Question for you:** lazy with doctor-pre-check at run start (so version failure surfaces immediately even though worktree creation defers), or eager?

### Decision 3 — Test runner abstraction in M7 (stub vs defer)

**My lean: defer. M7 ships zero `src/tools/test-runner.ts`. The validation-command shape lands in `BUILD_REPORT.md` but no runner is invoked.**

ROADMAP M8 owns the runner (`src/tools/test-runner.ts`). M7 can pin the BUILD_REPORT schema (already done in BUILD.md) without shipping any execution code.

**Counter-case:** without a runner, the BUILD-lite e2e test cannot exercise the failure path. We can only assert "BUILD_REPORT.md is well-formed" not "BUILD's command shape would actually parse." A read-only "validation-command parser" stub (no execution; pure shape validation) might be cheap insurance.

**Question for you:** worth a parser-only stub in M7, or pure defer?

### Decision 4 — Forensics population test surface in M7

**My lean: M7 ships only the forensics *layout* (mkdir + empty files writable) and a unit test for `worktree/forensics.ts:writeForensicsBundle()`. No e2e test exercises a *populated* forensics dir because that requires VERIFY-fail.**

The contract says forensics fires only on VERIFY-fail. BUILD-fail produces `NEEDS_INTERVENTION.json` directly (per BUILD.md event taxonomy). So in M7 the forensics path is structurally implemented but never end-to-end fired.

**Counter-case:** untested code rots. We could fire forensics from a unit test that synthesizes a fake VERIFY-fail by direct call into `writeForensicsBundle`, asserting all six files are written and the worktree is removed. That gives M7 confidence the layout works without waiting for M8.

**Question for you:** unit-test only is enough, or also a synthetic e2e?

### Decision 5 — Scientist tail blast radius cap (3/3 vs 1/1 vs configurable)

**My lean: 3 new hypotheses + 3 new questions max per BUILD attempt, matching BUILD.md.**

Codex M7-M10 risk #5: "Scientist tail may become gate noise." A tight cap forces the persona to compress. Empirically, the M6 PLAN tail emits 1-2 hypotheses per phase invocation; 3 is a soft ceiling.

**Counter-case:** 1/1 is sharper but might force the persona to lose information. Configurable shifts the discipline to ops, not the schema.

**Question for you:** 3/3, 1/1, or `phases.build.scientistTailCap` config knob?

### Decision 6 — Builder persona size and content (5k vs 8k vs >8k)

**My lean: ~6-7k. Includes universal-rules-import + role-framing + 3-source-verification reminders + atomic-task discipline + patch-authoring grammar + manifest discipline + Scientist-tail discipline + repair instructions.**

Current `src/agents/defaults/builder.md` is 1.6k stub. PLAN's `lead.md` is 5.1k. BUILD's persona has a narrower job (apply one task) but more output structure (patch + report).

**Counter-case:** longer prompts are not always better. M5's review trail flagged a couple of M5 personas as "instruction-bloated, persona repair triggered too often." A leaner 4k prompt with tighter examples might actually produce better output.

**Question for you:** target ~6-7k, or push for ~4k with worked examples?

### Decision 7 — `repair → finalize` cap for BUILD_REPORT.md (3 vs 2)

**My lean: 3 attempts, matching PLAN.**

PLAN's repair cap is 3 (`src/phases/plan.ts` `repairAndFinalize`). Same shape applies to BUILD: persona drafts BUILD_REPORT.md, orchestrator validates section grammar, on failure feeds back the issues, persona retries.

**Counter-case:** BUILD draft is structurally simpler (locked sections, locked grammar); 2 attempts may be enough. Tighter caps reduce token spend on hopeless drafts.

**Question for you:** 3 to match PLAN, 2 to tighten, or driven by `phases.build.maxRepairAttempts` config?

### Decision 8 — doctor command scope in M7

**My lean: doctor adds only the `git --version >= 2.40` check. Orphan-worktree detection (`git worktree list` → cleanup) defers to `code-oz prune` in W2.**

ROADMAP M7 says "`src/commands/doctor.ts` adds `git --version` check" — narrow scope.

**Counter-case:** orphan worktrees from interrupted runs accumulate without cleanup. A simple "warn if `.code-oz/runs/` has dirs older than 7 days" is cheap and prevents disk bloat.

**Question for you:** narrow (just version), or include the orphan warning?

### Decision 9 — BUILD-lite e2e fixture (extend `greenfield-web` vs new fixture)

**My lean: extend an existing fixture (likely the M6 PLAN fixture under `tests/fixtures/`) so the same SPEC.md → PLAN.md trail used in M6 e2e flows into BUILD's atomic-task selection. Single new e2e: `tests/e2e/build-lite-greenfield.test.ts`.**

ROADMAP M9 introduces `tests/fixtures/greenfield-web/`; M7 should not preempt that name. Use the M6 fixture name, add a `tasks: [T-001]` block to its PLAN.md.

**Counter-case:** preemptive fixture creation under `tests/fixtures/build-lite/` keeps M7's e2e self-contained, avoiding M9 churn when the canonical greenfield-web fixture lands.

**Question for you:** extend M6 fixture, or new self-contained one?

### Decision 10 — Patch grammar validation (pre-`git apply --check` strictness)

**My lean: minimal pre-validation (size cap, binary marker rejection, path-safety scan); rely on `git apply --check` for everything else.**

Reimplementing unified-diff parsing duplicates git's work and creates a second source of truth. Let git be authoritative for diff validity; we only enforce v0.1 constraints (size, no binary, paths under worktree).

**Counter-case:** if `git apply --check` fails on a malformed diff, the error message is git's, which may not match our error taxonomy (`build_patch_grammar_invalid`). Pre-validating grammar gives cleaner error codes for persona repair.

**Question for you:** trust git, or pre-validate for cleaner errors?

### Decision 11 — `BUILD_REPORT.md` write atomicity in failure modes

**My lean: persona drafts → orchestrator validates → on success, single atomic write to `.code-oz/artifacts/BUILD_REPORT.md`. On any failure (validation exhausted, patch reject, etc.), `.code-oz/artifacts/BUILD_REPORT.draft.md` is preserved for inspection but the canonical path is never written.**

Mirrors PLAN.md and SPEC.md atomic-write discipline. Ensures `BUILD_REPORT.md` either is fully canonical or does not exist.

**Counter-case:** does BUILD_REPORT.draft.md leak into the wrong space? Should it live under `.code-oz/runs/<runId>/forensics/<N>/` instead? But N=0 forensics doesn't exist (forensics is keyed by attempt N where N corresponds to a VERIFY-fail; BUILD-fail has no N).

**Question for you:** drafts under `.code-oz/artifacts/` (lean), or under a new `.code-oz/runs/<runId>/build-drafts/` path?

### Decision 12 — Permission validation for `tool_use.write` at load time

**My lean: load-time validation in `src/agents/load.ts` enforces: only one `tool_use.write` tool (`apply-patch`); only one root (the run's worktree path); `maxBytesPerPatch` ≤ 65536; `timeoutMs` ≤ 5000. Personas declaring out-of-bounds values fail load with `agent_permission_invalid`.**

Same shape as `tool_use.repo_context` validation in M6 (`src/agents/load.ts`).

**Counter-case:** runtime enforcement (at tool-call time) is the only enforcement that matters. Load-time validation is documentation; the tool handler itself is authoritative. Why duplicate?

**Question for you:** belt-and-suspenders (lean), or runtime-only?

---

## The recommended path (commit-by-commit, ~9 commits after the two contract commits already on `feat/m7`)

```
M7 commit 3:  src/agents/schema.ts adds tool_use.write; src/agents/load.ts validates;
              tests/agent-load-tool-use-write.test.ts
M7 commit 4:  src/state/schemas.ts + src/state/events.ts add 6 worktree_* + 4 build_*
              event types; tests/state-events-build-worktree.test.ts
M7 commit 5:  src/worktree/create-run-worktree.ts + src/worktree/remove-run-worktree.ts
              + src/worktree/inspect-run-worktree.ts; tests/worktree-{create,cleanup,base,
              dirty-tree}.test.ts
M7 commit 6:  src/worktree/forensics.ts + src/worktree/manifest.ts;
              tests/worktree-{preserve,manifest}.test.ts
M7 commit 7:  src/patches/apply-agent-patch.ts + src/patches/validate-agent-patch.ts;
              tests/{patch-apply,patch-validate,patch-path-safety}.test.ts
M7 commit 8:  src/artifacts/build-report.ts (parse/serialize/atomic-write);
              tests/build-report-{parse,serialize,grammar}.test.ts
M7 commit 9:  src/agents/defaults/builder.md + src/prompts/build-system.md
              (universal-rules import, full prompt; no test commit — covered by phase test)
M7 commit 10: src/phases/build.ts (orchestrator: invoke → repair → finalize → patch →
              manifest → Scientist tail → gate-preflight); tests/build-phase.test.ts +
              tests/build-scientist-tail.test.ts
M7 commit 11: src/commands/doctor.ts adds git --version check;
              tests/commands-doctor.test.ts
M7 commit 12: tests/e2e/build-lite-greenfield.test.ts (full DEFINE → PLAN → BUILD with
              FakeProvider against extended M6 fixture)
```

Plus a thirteenth Codex-review-fix commit if your verdict is `fix-first`.

Tag: `v0.7.0-alpha.0` after Codex review verdict = `push`.

---

## Decision prompts (numbered for your reply)

1. **Decision 1** — patch authoring: file-artifact (a) or tool-call (b)?
2. **Decision 2** — worktree creation: lazy with doctor pre-check, or eager?
3. **Decision 3** — test runner in M7: pure defer, or parser-only stub?
4. **Decision 4** — forensics test surface: unit-only, or synthetic e2e?
5. **Decision 5** — Scientist cap: 3/3, 1/1, or configurable?
6. **Decision 6** — builder persona size: ~6-7k, or push to ~4k?
7. **Decision 7** — repair cap: 3 (match PLAN), 2 (tighten), or config-driven?
8. **Decision 8** — doctor scope: version-only, or include orphan warning?
9. **Decision 9** — e2e fixture: extend M6, or new self-contained?
10. **Decision 10** — patch grammar: trust git, or pre-validate for cleaner errors?
11. **Decision 11** — draft path: `.code-oz/artifacts/BUILD_REPORT.draft.md`, or under `.code-oz/runs/<runId>/`?
12. **Decision 12** — `tool_use.write` validation: load-time + runtime (lean), or runtime-only?

---

## What I want from you

- Numbered verdict on each of the twelve decisions: `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications`. The verdict enum is in `docs/contracts/DEBATE.md`.
- For each `accept-with-modifications` or `reject`, the specific alternative — concrete enough that I can land it in a commit without further round-trips.
- Risks I'm not seeing. M7 is the first milestone where M2-M6 substrate gets stress-tested by actual code mutation. What does the contract surface miss? Especially: where could persona-orchestrator boundary violations sneak in?
- Decisions you would defer. If any of the twelve should be punted to M8 or later, name them.
- A recommended commit-order critique. The 9-commit path above mirrors M5/M6 cadence; if you see a better ordering (e.g., persona prompt before phase orchestrator, or schemas before worktree code), say so.

This is the M7 *implementation* briefing. The thesis-level shape debate is closed (`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`); do not relitigate the M7/M8/M9 split. Stay inside the twelve decisions.

---

## Reference

- **Pinned contracts:** [`BUILD.md`](../contracts/BUILD.md), [`VERIFY.md`](../contracts/VERIFY.md), [`REVIEW.md`](../contracts/REVIEW.md), [`WORKTREE.md`](../contracts/WORKTREE.md), [`DEBATE.md`](../contracts/DEBATE.md)
- **Roadmap:** [`docs/design/ROADMAP.md § M7`](./ROADMAP.md)
- **Prior debate:** [`docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`](../research/CODEX_RESPONSE_M7_M10_SHAPE.md) (thread `019ddea0`, 2026-04-30)
- **Empirical history:** `docs/design/CODEX_BRIEFING_M{2..6}.md` + matching responses
- **Non-negotiable rules:** `CLAUDE.md` rules 1-20, especially 7 (this debate satisfies it), 11 (intervention codes), 19 (`budgets.global`), 20 (one new authority boundary)
