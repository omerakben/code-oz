---
name: comparison-prd-taskmaster
companion-docs: ../README.md (index), CODEX_BRIEFING.md (debate input), CODEX_RESPONSE.md (debate output), SYNTHESIS.md (post-debate locks)
target: head-to-head comparison between code-oz and the prd-taskmaster Claude Code skill
status: closed (post-Codex synthesis applied 2026-05-10)
date: 2026-05-10
template-path: /Users/ozzy-mac/Projects/agents/templates/prd-taskmaster
template-commit: local clone, no remote SHA captured (last-modified 2026-05-08)
codex-thread: 019e12f0-43a3-7e31-bcf8-1e1bb4f83093
codex-verdict: accept-with-modifications
post-debate-locks: SYNTHESIS.md
---

> **Note (post-debate):** This document was edited after the Codex round to fold in
> three factual corrections: the vague-language vocabulary is 15 terms (`poor` was
> initially omitted); prd-taskmaster's runtime authority is wider than first
> stated (Write/Edit/Bash + four execution modes + `git reset --hard` rollback);
> and `learn-accuracy.py` computes averages, not adjustment factors. The borrow
> set is unchanged in count but tightened in scope. See SYNTHESIS.md for the
> ledger of changes.

# Comparison: code-oz vs prd-taskmaster

## Executive read

**Decision (pre-debate): YES — code-oz exceeds, with two narrow prompt-adjacent borrows.**

`prd-taskmaster` is a single-purpose Claude Code skill that turns a feature idea into a Product Requirements Document, then hands the PRD to TaskMaster (an external task generator) for breakdown and execution. It is ~3.7k LOC concentrated in one Python `script.py` plus a `SKILL.md` workflow. Its authority surface ends at *PRD draft + 13-check validation + USER-TEST checkpoint insertion*. code-oz, by contrast, is a multi-phase runtime with file-based gates, sha256-bound artifacts, cross-family review at REVIEW, run-level budgets, worktree isolation, and a debate-scheduler.

The structural answer to the framing question is unambiguous: code-oz does not need to absorb prd-taskmaster's runtime. Six of prd-taskmaster's nine signature mechanics are *already stronger or differently implemented* in code-oz; two more are out of scope (TaskMaster MCP, Git checkpoint tagging — both deliberately deferred); only two are worth borrowing as small refinements to the existing SPEC contract.

The two borrows are scoped as **prompt-adjacent contract refinements**, not new authority boundaries, so they fit under Rule 20 if a future SPEC-validator milestone bundles them under one axis.

## What prd-taskmaster is

A 12-step skill that runs entirely inside a single Claude Code conversation. The skill grants itself
a wide runtime: `allowed-tools` lists `Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion`
(`SKILL.md:9-16`), and four execution modes (Sequential / Parallel / Full Autonomous / Manual)
authorise branch creation, merging to main, checkpoint tagging, and up to five concurrent tasks
in Full Autonomous (`SKILL.md:259-288`). The generated `rollback.sh` runs `git reset --hard` on
the requested checkpoint tag (`script.py:762-786`).

| Step | Mechanic | Where it lives |
|---|---|---|
| 1 | Preflight + crash detection | `script.py preflight` reads `.taskmaster/state/execution-state.json` |
| 2 | Detect existing PRD | Glob `.taskmaster/docs/*.md` |
| 3 | Detect TaskMaster (MCP > CLI > none) | `_detect_taskmaster_method()` checks `.mcp.json` and `which taskmaster` |
| 4 | 13 discovery questions | AskUserQuestion calls in the skill body |
| 5 | Initialize `.taskmaster/` | `script.py init-taskmaster --method <cli|mcp>` |
| 6 | Generate PRD from template | `script.py load-template --type comprehensive\|minimal` + AI fill |
| 7 | **13 quality checks** | `script.py validate-prd --input <path>` |
| 8 | Parse + expand tasks | Delegated to TaskMaster (out of skill scope) |
| 9 | Insert USER-TEST tasks every 5 | `script.py gen-test-tasks --total <n>` |
| 10 | Generate 5 helper scripts | `script.py gen-scripts --output-dir` writes track-time, rollback, learn-accuracy, security-audit, execution-state |
| 10.5 | Generate `CLAUDE.md` for project | Loads template, asks if Codex too |
| 11 | Choose execution mode | Sequential / Parallel / Full Autonomous / Manual |
| 12 | Summary + handoff or autonomous loop | AI-driven |

Authority shape: **all decisions live in the skill prompt; all mechanics live in `script.py` (1079 lines, 11 subcommands, all emit JSON).** This is a clean "AI judgment, deterministic mechanics" split, similar in spirit to code-oz's contracts → artifacts split, but at a fraction of the surface area and with no cross-family second opinion anywhere.

## Surface-by-surface comparison

| # | prd-taskmaster mechanic | Closest code-oz seam | Verdict |
|---|---|---|---|
| 1 | **Discovery: 13 questions across essential / technical / taskmaster** | DEFINE phase + ask-me runtime (`src/phases/define.ts`, `src/phases/ask-me.ts`) running an interactive BA persona to up to 8 rounds | code-oz ahead — DEFINE is a phase with budget enforcement, event log, repair/finalize rituals, sha256 binding on the final SPEC. prd-taskmaster's question list is a sound discovery checklist but lives only in the skill prompt with no cross-family second opinion and no resume contract. |
| 2 | **PRD template (12 sections, comprehensive)** with REQ-NNN / Must-Should-Could / SMART metric structure | SPEC.md (six sections, bullet-only, deterministic schema) | **Mixed — code-oz simpler by intent; prd-taskmaster richer by intent.** code-oz's SPEC is a constraint contract, not a PRD. The richer PRD shape is *useful as a strict-mode upgrade* for users who want it, but it is not the right default: the deterministic six-section schema is what makes pass/fail machine-checkable per Rule 1. |
| 3 | **13-check PRD validator** (executive-summary length, problem-statement user impact + business impact, SMART goals, ≥3 acceptance criteria per story, vague-word detector, REQ-NNN numbering, Must/Should/Could priority, NFR specific targets, task-breakdown hints, dependencies, out-of-scope) | SPEC validator: ≥1 bullet per six required sections, no paragraphs / code fences / sub-headings | **prd-taskmaster has more semantic checks; code-oz has stronger structural enforcement.** code-oz's validator refuses to write an invalid SPEC.md (sha256 binding depends on it); prd-taskmaster's validator scores 0–60 and warns. The 13 checks themselves are largely *content-quality heuristics* a reviewer would apply by reading. **Borrow candidate B1** below. |
| 4 | **Vague-language detector** (regex over 15 terms: `fast, quick, slow, good, bad, poor, user-friendly, easy, simple, secure, safe, scalable, flexible, performant, efficient` with optional `should be / must be / needs to be` lead-in; `script.py:95-105`) | SPEC validator does not check vocabulary; universal-rules.md system prompt nudges personas away from vague language | **Borrow candidate B2.** A static vocabulary check is a low-risk pre-emit linter that would tighten DEFINE outputs without changing the SPEC schema. |
| 5 | **USER-TEST checkpoint insertion every 5 tasks** | code-oz has no equivalent — VERIFY runs once per task; no human-in-the-loop checkpoint between tasks | **No-borrow (deliberate).** code-oz's design is "phases run autonomously, gates are file-based, the user reviews artifacts at gate approval." Inserting a fixed-cadence human-checkpoint is a different product (interactive supervisor vs autonomous SDLC runtime). The thesis explicitly chose non-interactive. |
| 6 | **`track-time.py` UTC datetime tracking** + `learn-accuracy.py` (computes per-task duration averages from `.taskmaster/state/time-tracking.json`; `script.py:795-825`) | code-oz events.jsonl carries timestamps on every event; budget telemetry tracks tokens / wall-time / provider calls; no cross-run accuracy-learning loop yet | **No-borrow.** code-oz's per-event timing is finer-grained than prd-taskmaster's per-task timing. `learn-accuracy.py` is a duration averager, not an adjustment-factor learner. The missing piece (cross-run estimation calibration) is a future analytics surface, not a missing primitive. |
| 7 | **`rollback.sh` to checkpoint tag** + per-task git tagging | code-oz has worktree isolation per run, but no per-task checkpoint tagging or rollback | **No-borrow (out of scope).** Per-task checkpoint tagging assumes the runtime owns commits; code-oz's design is the user owns commits, the runtime owns artifacts + events. Rollback inside an autonomous run is the *restart-policy* surface, which already exists for VERIFY-fail. |
| 8 | **`security-audit.py` regex codebase scan** | No equivalent. Closest is REVIEW persona prompts, which are content-driven, not regex-driven | **No-borrow.** The script is a static-analysis crutch for AI runs without a real reviewer; code-oz has an actual cross-family REVIEW phase that is structurally stronger. |
| 9 | **`execution-state.py` crash recovery + auto-resume** | code-oz has a typed FSM, idempotent gate writes, `code-oz resume` semantics, runId-scoped events.jsonl, sha256-bound artifacts | code-oz dramatically ahead. prd-taskmaster's "auto-resume" is one JSON file with `current_task` / `current_subtask` / `mode`. code-oz's resume contract is the entire state model. |
| 10 | **TaskMaster integration (MCP > CLI fallback)** is *required* for the no-existing-PRD path (`SKILL.md:34-39, 76-85`) | code-oz's PLAN phase produces its own task list with structured fields (id, title, dependencies, files, acceptance) under `src/artifacts/plan.ts` | **No-borrow.** TaskMaster is a different product, and prd-taskmaster blocks if it is not detected. code-oz's PLAN artifact already encodes the task graph code-oz needs; deferring task generation to a separate MCP creates an authority-boundary leak. |
| 11 | **`CLAUDE.md` template generation** with TDD workflow + agent usage rules + parallel-task guidelines | code-oz has its own CLAUDE.md, written by hand, project-specific | **No-borrow.** Generic CLAUDE.md generation is a useful one-shot trick for a Claude Code skill, but code-oz's CLAUDE.md is a *project memory contract* curated by the maintainer. Templated generation would dilute it. |
| 12 | **`calc-tasks` heuristic** `ceil(requirements * 1.5)` clamped to 10–40 | code-oz has no auto task-count heuristic; PLAN phase emits whatever tasks the planner persona produces, validated structurally | **No-borrow.** A 1.5x multiplier with a 10–40 clamp is a "feels-right" heuristic without empirical justification. code-oz's PLAN phase uses persona judgment + verification, which is the right authority shape. |

## Where code-oz is structurally ahead

Six dimensions where the gap is not close, and the comparison documents *why*:

1. **Cross-family review.** prd-taskmaster never gets a second opinion. code-oz's REVIEW phase requires the reviewer be a different provider family than BUILD (rule 2). This is the single biggest structural improvement code-oz makes over a single-skill PRD generator.

2. **File-based gates with sha256 binding.** prd-taskmaster's "validation" is a 0–60 score the user can ignore. code-oz's gate writer refuses to write `GATE_<PHASE>_PASSED.json` if the artifact fails validation, and binds the sha256 of the artifact at approval time so post-approval edits trip a `gate_artifact_sha256_mismatch` (rule 1).

3. **Run-level budgets as code, not vibes.** prd-taskmaster has no budget surface; AI calls are ungated. code-oz has `budgets.global.{maxTurns, maxProviderCalls, maxTokensEstimate, maxWallTimeMinutes}` enforced cumulatively from `events.jsonl` per call, soft-warns at 0.75, hard-kills at 1.0 (rule 19).

4. **Provider abstraction.** prd-taskmaster runs only inside a Claude Code session (single provider, single auth, single billing). code-oz has `IAgentProvider` with `FakeProvider` for offline tests, Codex for cross-family review, xAI for direct HTTP, and a contract pinned in `docs/references/provider-contract.md`.

5. **Repo-context as a permission scope.** prd-taskmaster scans the codebase silently inside the skill body. code-oz has `tool_use.repo_context` as an explicit permission sub-scope, audited via `repo_context_searched` events, with selected paths entering the *next* invocation's `ProviderRequest.files` rather than the search invocation's hidden context (rule 18).

6. **Privacy by default.** prd-taskmaster has no `.code-ozignore` analogue, no secret redaction, no file-size cap, no "files sent to provider" preview. code-oz pins these as rule 13.

## Where prd-taskmaster is structurally simpler-and-fine

prd-taskmaster ships things code-oz deliberately does not, and the asymmetry is correct:

- **Single Python file.** 1079 LOC vs code-oz's multi-package TypeScript runtime. For its purpose (one-shot PRD generation), the simpler shape wins.
- **No FSM, no event log, no resume.** A PRD generator does not need any of these.
- **No worktree isolation.** A PRD generator does not modify the codebase, so worktrees are unnecessary.
- **TaskMaster MCP delegation.** Pushing task expansion to an external agent is the right move when the host runtime is just a skill.

These are *not* gaps in code-oz. They are differences in product shape.

## Borrow set (ranked, scoped, milestone-mapped)

Two borrows survive the cross-rule filter (Rule 20: one new authority boundary per milestone; Rule 21: no new parallel-provider surface without measurable risk-reduction). Both are *prompt-adjacent contract refinements* under the existing SPEC contract — they do not introduce a new authority boundary, they tighten an existing one.

### B1 — Vague-language linter on SPEC.md (high confidence)

**What:** Add a deterministic regex-based vague-language *diagnostic* (warning-only) to the SPEC artifact layer. The rule fires on the 15 terms prd-taskmaster pins in source — `fast, quick, slow, good, bad, poor, user-friendly, easy, simple, secure, safe, scalable, flexible, performant, efficient` (`script.py:95-99`) — with the optional `should be / must be / needs to be` lead-in. Suppress when the same SPEC bullet contains an explicit metric or named control.

**Why it's a borrow, not a duplicate:** code-oz's universal-rules.md prompts personas *away* from vague language at generation time, but there is no static post-emit check. A regex linter on the parsed SPEC catches drift that the prompt-time guidance missed.

**How to apply (post-Codex revisions):**
- Implement as a new helper `lintSpecQuality(spec): readonly SpecLintIssue[]` in `src/artifacts/spec.ts`, **separate from `parseSpec`**.
- Do **not** add `spec_vague_language` to `SpecLoadErrorCode`. The hard parser surface (`src/artifacts/errors.ts:5-15`) is what gates `GATE_DEFINE_PASSED.json` via `parseSpec` in `src/commands/approve.ts:213`. Adding the diagnostic to `SpecLoadError` would be a new gate-blocking authority — it would convert a quality heuristic into hard contract enforcement.
- Surface diagnostics only as a DEFINE completion message after the gate is written. Approval flow untouched.
- Privacy: log term + section + bullet index *only*. Never log surrounding sentence (rule 13).
- Pin the 15-term list in `docs/references/spec-contract.md` as contract, not as `.code-oz/config.yaml` knob (configurable validation rules are how rule 1's "file-based gate signals only" gets weakened).
- Drift surface: every word in the vocabulary is one regex away from being a false positive on legitimate use. v1 ships the list with comments justifying each entry. Bullet-level qualifier suppression is the primary false-positive mitigator.

**Authority footprint:** Zero new authority — *only if implemented as a diagnostic surface separate from `SpecLoadError`*. If it touches the parser-error path, it is a new authority footprint.

**Milestone target:** Future SPEC-validator-refinement milestone. Suggested name **M-SPEC1 — DEFINE rigour: vague-language diagnostic + Goals sufficiency diagnostic** (paired with B2 below to keep the milestone's surface coherent).

### B2 — Goals sufficiency diagnostic on SPEC.md (medium confidence)

**What:** A diagnostic that warns when the Goals section is empty in spirit. v1 fires only when Goals has **fewer than 2 bullets AND fewer than 15 total words** (AND, not OR).

**Why it's plausible:** Empty-spirit Goals sections are the single most common DEFINE failure mode below the structural ≥1-bullet floor. The AND condition prevents firing on legitimate one-goal specs ("Help a parent name their newborn"), which the SPEC contract explicitly permits (`docs/references/spec-contract.md:62-70`).

**Why medium confidence (not high):** the borrow is the *idea* of a content-volume floor; the exact thresholds are unproven and may need tuning after first use.

**How to apply (post-Codex revisions):**
- Add a `spec_goals_underspecified` warning to `lintSpecQuality` (the same helper as B1).
- Hard contract stays at ≥1 bullet per section. The diagnostic is a quality heuristic, not a new minimum.
- Same warning-only, non-blocking escalation as B1.
- N=2 bullets and M=15 words live in the SPEC contract reference, pinned as contract.

**Authority footprint:** Zero new authority — same caveat as B1.

**Milestone target:** Same as B1 (M-SPEC1).

## Rejected borrow candidates and why

| Candidate | Why rejected |
|---|---|
| 13 PRD checks wholesale | Most are PRD-specific (executive summary, business impact section, REQ-NNN numbering, Must/Should/Could priority, NFR targets) and do not match code-oz's six-section bullet-only SPEC schema. Adopting them would force a SPEC schema rewrite — a structural change, not a refinement. |
| `Must/Should/Could` priority labels in SPEC bullets | Same reasoning. Priority labels in DEFINE pre-empt PLAN's job. The acceptance-criteria bullet *is* the priority statement. |
| `REQ-NNN` numbering in SPEC | Acceptance-criteria bullets are already addressable by section + index. Numbering in SPEC duplicates structure that PLAN provides. |
| USER-TEST checkpoint every 5 tasks | Inserts human-in-the-loop into an otherwise autonomous SDLC runtime. Wrong product shape; thesis explicitly chose autonomous. |
| `learn-accuracy.py` adjustment factor | Cross-run learning is a future surface that needs a real authority boundary (rule 20). Not a quick borrow. |
| TaskMaster MCP delegation | Authority leak; PLAN already produces the task graph code-oz needs. |
| `security-audit.py` regex sweep | Substituting regex for cross-family REVIEW would weaken code-oz's strongest gate. |
| `rollback.sh` per-task tagging | Wrong commit-ownership model. The user owns commits in code-oz, not the runtime. |
| `CLAUDE.md` template generation | Generic templates dilute project-memory specificity. |
| `calc-tasks` 1.5x heuristic | Persona judgment + structural validation is the right authority shape; a hard heuristic is brittle. |

## Debate inputs (the seven open questions Codex addressed)

1. **Cadence:** Bundle B1 + B2 under one M-SPEC1 milestone, or split into two?
2. **Vocabulary authority:** Pin in contract or expose as config?
3. **USER-TEST resurrection:** Is a `cumulative_checkpoint_due.json` gate a Rule-21-compatible borrow, or out of scope?
4. **Generalisation:** B1 lives in `spec.ts` first ship vs a standalone `lint-vagueness.ts` module that PLAN / BUILD_REPORT / REVIEW could import later?
5. **Vocabulary validity:** Ship the prd-taskmaster list verbatim, or curate at v1?
6. **Cross-rule check:** Are there hidden authority footprints in B1 / B2 that the analysis missed?
7. **Privacy footprint:** Does the linter exfiltrate user content beyond the matched word?

Codex's per-question answers are in [CODEX_RESPONSE.md](./CODEX_RESPONSE.md). The post-debate locks are in [SYNTHESIS.md](./SYNTHESIS.md).

## Verdict (post-debate)

**YES — code-oz is ahead.** Two narrow diagnostic-only borrows worth integrating; nothing in prd-taskmaster's surface justifies inserting a new milestone or rewriting the SPEC schema. The full borrow scope (B1 + B2) sits inside one future milestone (M-SPEC1) with zero new authority footprint, *provided* the diagnostics live outside `SpecLoadError` and never gate approval. Codex confirmed this read at `accept-with-modifications`. The eight rejected mechanics — USER-TEST, datetime tracking, learn-accuracy, security-audit, rollback tagging, TaskMaster delegation, CLAUDE.md generation, calc-tasks heuristic — stay rejected.
