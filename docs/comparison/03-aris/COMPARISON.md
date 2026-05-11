# code-oz vs ARIS — comparison + verdict

**Date:** 2026-05-10
**Author:** Claude Opus 4.7 (xhigh)
**Template under review:** `~/Projects/agents/templates/Auto-claude-code-research-in-sleep` — alias **ARIS**, ML research harness (skills + MCP servers + Codex/Claude reviewer overrides)
**code-oz state:** v0.17.0-alpha.0 (M16 closed), 3108 tests, 17 milestones shipped, PE-1 xAI HTTP adapter live
**Prior round:** none. ARIS is in `CLAUDE.md`'s influence library with the borrow note "Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts" — those landed in M0–M9 era. This is the first per-template head-to-head for ARIS at the v0.17 surface.

This is a one-by-one comparison. Three questions drive it:

1. Are the four already-borrowed ARIS patterns still pulling their weight, or has the runtime moved past them?
2. What ARIS mechanics that did *not* land in 2026-04 deserve a second look at v0.17?
3. Where does code-oz structurally exceed ARIS, and where does the domain gap (ML research vs SDLC) prevent borrowing entirely?

The verdict is at the bottom. Codex's response goes in `CODEX_RESPONSE.md`; the post-debate decisions go in `SYNTHESIS.md`.

---

## 1. What ARIS is

A Markdown-prompt research harness. Every ARIS workflow is a SKILL.md file invoked via slash command (`/idea-discovery`, `/auto-review-loop`, `/paper-writing`, `/meta-optimize`). The runtime is whatever LLM CLI hosts the skills (Claude Code, Cursor, Trae, Codex CLI, OpenClaw). State persistence is by Markdown convention (a `## Pipeline Status` section in `CLAUDE.md`) plus optional shell hooks.

| Layer | Count | Purpose |
|---|---|---|
| Skills (`skills/<name>/SKILL.md`) | 60+ | Idea, experiment, review, paper, patent, rebuttal workflows |
| Workflows (named pipelines) | 5 (W1, W1.5, W2, W3, W4) | End-to-end research → submission |
| MCP servers (`mcp-servers/`) | gemini-review, minimax-chat, llm-chat, image2, feishu-bridge | Reviewer routing, multi-LLM mix-and-match |
| Tools (`tools/*.py`) | 17 | arxiv/openalex/exa fetchers, watchdog daemon, queue manager, image renderer, codex/claude review override generator |
| Templates (`templates/*.md`) | 13 | Idea candidates, experiment plans, narrative reports, patent claims, paper plans |
| Tests (`tests/test_*.py`) | 13 | Codex install, MiniMax, Feishu bridge, watchdog, skill mirror — Python pytest, integration-leaning |

The thesis: **harness design matters as much as model weights**. ARIS treats the harness as a research artifact (`meta-optimize` skill is the embodiment of that — it reads the harness's own usage logs and proposes patches to its own skill prompts).

Five rules govern composition:

- **Executor and reviewer must be different model families.** Cross-model adversarial collaboration is the load-bearing primitive.
- **Reviewer independence**: pass file paths only, never summaries.
- **Effort scales the work**: `lite | balanced | max | beast` is a single dial that propagates through every workflow.
- **Pipeline Status in CLAUDE.md is the recovery contract.** A 30-second-readable snapshot updated on every state change; LLMs read it after compaction or on a fresh session.
- **Skill is the unit of orchestration.** No central runtime — the LLM dispatches skill-to-skill via slash commands.

The pack is opinionated, prompt-driven, and bilingual (every doc has an English and a Chinese version). Every skill follows the same anatomy: name + description + argument-hint + allowed-tools frontmatter, then a Why / How / Phases body with a Constants block and an Output Protocols section.

---

## 2. What code-oz is

A standalone Bun + TypeScript CLI runtime that orchestrates `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` (greenfield) or `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP` (brownfield) — the same lifecycle ARIS solves for research, applied to software engineering. The runtime owns:

- File-based gate signals (`GATE_<PHASE>_PASSED.json`, schema-validated, never LLM-text-parsed)
- Worktree isolation per BUILD attempt + patch contract (M7)
- Mutation gating in VERIFY (M8) — catches test tautologies
- Restart-on-fail with 4-attempt cap + forensics preservation (M8/M16)
- Cross-family REVIEW with the BUILD provider's family rejected at load time
- Reviewer panel with same-family-advisory-only enforcement (M14)
- Debate runtime + `requestDebate()` primitive (M10)
- Debate-policy scheduler (M15)
- Provider capability contract + role-to-provider routing (M11/M12)
- Role-cost policy under `budgets.global` (M13)
- Run-level cumulative budgets read from `events.jsonl` per call, soft warn at 0.75 (rule 19)
- Resume after termination (idempotent gate writes, `runId`-scoped state, multi-task cursor at M16)
- Privacy by default — `.code-ozignore`, secret redaction, file manifests, no recursive context (rule 13)
- Provider neutrality via OAuth tokens from disk (Claude / Codex / Gemini) plus xAI HTTP at PE-1
- Compiled binary distribution via npm + Homebrew + Scoop with auto-PATH-patching (W3-lite)

Personas live as Markdown + YAML frontmatter (six bundled at `src/agents/defaults/{ba,lead,builder,verifier,reviewer,scientist}.md`). Universal anti-slop rules and a single common-rationalizations table compose into every persona prompt.

---

## 3. Already-borrowed patterns — still pulling weight at v0.17?

`CLAUDE.md`'s influence-library line for ARIS: *"Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts"*. Audit at v0.17:

| Borrow | Where it lives | Status at v0.17 |
|---|---|---|
| Cross-family review | rule 2 + `src/phases/review.ts` provider-family gate | Load-bearing. Hardened in M14 (panel) and M15 (scheduler). The "BUILD provider family rejected at REVIEW load time" check has caught misconfigurations in the wild. |
| Reviewer Memory | maestro doc + ACE borrow set (M17 candidate) | Documented but not built. ACE comparison (`01-ace`) proposed M17 to ship the bullet-format substrate. ARIS's reviewer-memory mode (`difficulty: hard`) was the influence; ACE provides the on-disk shape. |
| 4-round cap | `MAX_REVIEW_ROUNDS = 4` in `src/policy/debate-scheduler.ts` + `src/phases/review.ts` | Load-bearing. Empirically validated by M14 (8 review rounds total across the panel surface, but each individual reviewer thread caps at 4) and M16 (R0/R1/R2 sequence). |
| Plain-Markdown artifact contracts | `SPEC.md`, `PLAN.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, `SOURCE_CHECK.md`, `HYPOTHESES.md`, `OPEN_QUESTIONS.md` | Load-bearing. Rule 7 forbids JSON serialization for inter-phase handoffs. The Scientist tail (rule 15) added two more Markdown artifacts in M5. |

All four are still load-bearing. The question is what *else* in ARIS deserves a look now that v0.17 has surfaces (reviewer panel, debate scheduler, multi-task cursor, role-cost policy) that did not exist when the original borrow audit ran.

---

## 4. Feature mapping at v0.17

### A. Effort-as-workflow-modifier (`lite | balanced | max | beast`)

ARIS treats `effort` as a single dial that scales token budgets, paper count, idea count, review rounds, and reasoning effort. The effort token also propagates through workflow chains automatically — `/research-pipeline → /idea-discovery → /experiment-bridge` carries `effort: max` through three skills without re-specifying.

code-oz has `effort` per-call (per the user's Opus-First Philosophy in global CLAUDE.md), but not as a *workflow-level* multiplier on `budgets.global`. The CLI's `--effort` flag, when it exists, is per-invocation, not per-run.

This is a small-surface borrow that maps directly onto rule 19's `budgets.global`.

### B. Zero-context fresh reviewer (`/paper-claim-audit`, `/citation-audit`)

ARIS has a stricter form of reviewer independence than the rule code-oz already adopted: the auditor receives ONLY paper `.tex` + raw evidence files. It does NOT receive `EXPERIMENT_LOG.md`, `AUTO_REVIEW.md`, `NARRATIVE_REPORT.md`, prior audits, or any executor summary. This is "zero-context evidence audit" — strictly stronger than passing file paths instead of summaries.

code-oz's REVIEW phase passes file paths, not summaries, but the reviewer always sees `BUILD_REPORT.md`, `VERIFY.md`, prior `REVIEW.md`, and `HYPOTHESES.md`. The reviewer panel (M14) inherits the full context.

A "fresh reviewer" sub-mode of the panel — invoked with only the BUILD artifact + raw VERIFY evidence (test output, mutation report) and *no* prior reviews or hypotheses — would catch confirmation-bias drift across review rounds. The pattern is empirically validated by ARIS for catching rounding, cherry-picking, and citation drift; the SDLC analogue is a reviewer that does not "know what the answer should be."

### C. `/meta-optimize` — log-driven outer-loop harness optimization

ARIS reads `.aris/meta/events.jsonl` and proposes patches to its own SKILL.md files: signal-cited, minimal-diff, cross-model-reviewed, user-approved-only. The skill explicitly does *not* auto-apply.

code-oz has `state/events.jsonl` (huge — 99k of `events.ts` plus the run-level log), the universal-rules prompt file, six persona Markdown files, and a `budgets.global` config. All four are first-class candidates for log-driven optimization. The pattern: read events, count override signals, propose persona/rule/budget patches, run a Codex review on the patch, present to the user.

The risk under rule 21: ARIS's discipline ("≥5 logged invocations before running") is a *threshold*, not a *measurable risk-reduction effect*. Rule 21 demands a controlled comparison.

### D. Anti-repetition memory on failed work units

ARIS's research-wiki ingests failed ideas as anti-repetition memory; `/idea-creator` reads the wiki before ideation. The same pattern, applied to code-oz: when PLAN fails its gate or BUILD exhausts its restart attempts, the failure signature (artifact hashes + error pattern) enters a per-repo lessons index that PLAN reads on the next attempt.

This aligns directly with the maestro 4-layer FS memory roadmap (rule 17 dossier) and the ACE borrow set (M17 candidate). It is *not* a separate authority — it is an entry type under Reviewer Memory v1.

### E. Watchdog daemon (`tools/watchdog.py`)

ARIS's watchdog is a Python daemon for remote GPU sessions: it polls `nvidia-smi` and screen/tmux liveness, writes `summary.txt` and `alerts.log`, and is consumed via `cron + ssh`. The problem it solves is *long-running remote training that fails silently*.

code-oz is a local CLI. Long-running remote work is out of scope for v0.x. The pattern (background daemon + status file + alert log) might map onto a future "remote build" capability, but at v0.17 there is no consumer.

### F. Pipeline Status convention in `CLAUDE.md`

ARIS's recovery story is a `## Pipeline Status` Markdown block updated on every state change; LLMs read it after compaction. Optional shell hooks (`session-restore.sh`, `pre-compact-remind.sh`) automate the read.

code-oz's recovery story is `state/run.json` + `state/events.jsonl` + `GATE_<PHASE>_PASSED.json` files validated by schemas, plus `code-oz status` and `code-oz resume`. The runtime is the source of truth, not LLM context. ARIS's pattern is a prose-driven workaround for harnesses that *cannot* own state; code-oz's runtime owns state.

### G. Difficulty levels (`medium | hard | nightmare`)

ARIS's `auto-review-loop` has three difficulty modes:
- `medium`: MCP review, executor controls what reviewer sees.
- `hard`: adds Reviewer Memory + Debate Protocol.
- `nightmare`: reviewer reads the repo directly via `codex exec`, bypassing the executor's file manifest.

code-oz's reviewer panel + debate scheduler covers `hard` already. `nightmare` directly violates rule 13 (privacy by default; explicit file manifests, no silent recursive context). This is a *feature not a bug* in code-oz: the file manifest is the trust boundary.

### H. MCP server fanout (`gemini-review`, `minimax-chat`, `llm-chat`)

ARIS provides multiple reviewer backends and routes between them based on `— reviewer:` flag. M14's reviewer panel covers the same surface from a runtime angle — and rule 21 explicitly forbids new parallel-provider surfaces without measurable risk reduction.

### I. Output Versioning + Output Manifest protocols

ARIS writes a timestamped file first, then copies to a fixed name; every output is logged to `MANIFEST.md`. This gives every workflow a per-run audit trail.

code-oz writes idempotently to schema-validated gate JSON files; `events.jsonl` is the audit trail. The timestamped-then-copy pattern adds drift surface for no gain in code-oz's model.

### J. Bilingual docs (English + 中文)

Every ARIS doc has an `_EN` and `_CN` version. Production-maturity signal, not a feature. Out of scope for v0.x.

---

## 5. Where code-oz structurally exceeds ARIS

C1. **State machine + schema-validated gate files (rule 1)**. ARIS's `## Pipeline Status` block is prose; code-oz's `GATE_<PHASE>_PASSED.json` is schema-validated by `src/state/gates.ts`. Prose-driven recovery breaks under model failure modes (LLM forgets to update the block); schema-validated gates do not.

C2. **Worktree isolation per BUILD attempt (M7)**. ARIS has no concept of build isolation — experiments run in-place on the GPU server. code-oz creates a fresh worktree per BUILD attempt, captures the patch on success, and discards on failure with forensics preserved.

C3. **Mutation gating in VERIFY (M8)**. ARIS's `/experiment-audit` is a post-hoc adversarial review of eval code; code-oz's mutation gate runs at runtime and refuses to advance to REVIEW if test mutation kill rate is below threshold. Different problem (test tautology vs eval fraud), same machinery direction (don't trust the executor's claim that the work passes).

C4. **Restart-on-fail policy with attempt cap and forensics (M8/M16)**. ARIS's auto-review-loop retries the *review*, not the *build*. code-oz's BUILD can fail, restart in a fresh worktree, retain the failed worktree for inspection, and surface a `NEEDS_INTERVENTION.json` after 4 attempts.

C5. **Reviewer panel with same-family-advisory-only enforcement (M14)**. ARIS's MCP fanout lets the user pick a reviewer model; code-oz's panel enforces that any reviewer in the BUILD provider's family is *advisory only*, not voting. This is structural, not configurable.

C6. **Debate runtime with `requestDebate()` primitive (M10)**. ARIS's `auto-review-loop` Hard difficulty has a Debate Protocol (Claude rebuts, GPT rules) but it is prompt-level. code-oz lifts debate to a runtime primitive: `requestDebate({ opponent, question, files })` is a typed seam with budgeting, transcript capture, and policy gating.

C7. **Debate-policy scheduler v1 (M15)**. ARIS has no scheduler; debates fire when the reviewer asks. code-oz schedules debates on observable risk signals (REVIEW disagreement, mutation gate near threshold, BUILD restart count) under `budgets.global`.

C8. **Provider capability contract + role-to-provider routing (M11/M12)**. ARIS's "executor != reviewer family" rule is a prompt-level constraint. code-oz's capability contract is a typed interface; provider load-time validation rejects misrouting before any call fires.

C9. **Role-cost policy under `budgets.global` (M13)**. ARIS has `effort` as a budget multiplier; code-oz has per-role cost weights in the global budget envelope, so a `Reviewer` call does not eat from the same line as a `Builder` call beyond the configured ratio.

C10. **Run-level cumulative budget enforcement read from `events.jsonl` (rule 19)**. ARIS has no enforcement; users monitor cost manually. code-oz's `assertWithinBudget` is mandatory, soft-warns at 0.75, hard-kills at 1.0, and produces an actionable `NEEDS_INTERVENTION.json`.

C11. **Permission manifest for `.ts` escape hatches (rule 9)**. ARIS runs Python tools with no permission boundary. code-oz requires allowed-commands, network, file-roots, env-vars, timeout, and secret-access declarations before any escape-hatch executes.

C12. **Privacy by default with file manifests (rule 13)**. ARIS's `nightmare` difficulty bypasses the executor's filter; code-oz forbids it. The file manifest is the trust boundary, not a default the user can override.

C13. **Compiled binary distribution (W3-lite)**. ARIS is a skill pack — distribution is `git clone`. code-oz ships a Mach-O binary via npm + Homebrew + Scoop with auto-PATH-patching. The repo-native CLI thesis depends on this.

C14. **3108 deterministic offline tests (rule 8)**. ARIS has 13 Python tests, integration-leaning. code-oz's spine tests run network-free under `FakeProvider` and the live xAI test is opt-in via two env flags.

C15. **Multi-task cursor (M16)**. ARIS treats one project at a time. code-oz's multi-task cursor lets a single run track per-task lifecycle (DEFINE → SHIP) across multiple work units with crash-during-recreate recovery.

C16. **One new authority boundary per milestone (rule 20)**. The empirical discipline that lets code-oz add capabilities without bundling bug surfaces. ARIS adds skills freely; bug surfaces in a 60-skill pack are not isolated by design.

C17. **No new parallel-provider surface without measurable risk reduction (rule 21)**. ARIS adds reviewer backends as MCP servers ship; code-oz refuses without an `events.jsonl` signal showing the new surface beats the single-provider baseline.

C18. **Brownfield AUDIT artifact (rule 14)**. ARIS treats every project as greenfield research. code-oz has a separate AUDIT phase for brownfield repos — a class of problems ARIS does not cover.

C19. **xAI HTTP adapter with strict request-body allowlist (PE-1)**. ARIS's MCP servers route to vendor APIs but trust the SDK shape. code-oz's first HTTP adapter audits every field: built-in xAI tools disabled by field omission, response parsing strict-allowlisted, trust-boundary discipline locked in `provider-contract.md`.

---

## 6. Decision

**YES, with selective borrows.**

ARIS is structurally complementary, not competing. The four borrows from 2026-04 (cross-family review, Reviewer Memory direction, 4-round cap, plain-Markdown contracts) are still load-bearing at v0.17, and ARIS still has mechanics worth absorbing. But:

- The **runtime gap** between ARIS and code-oz is wider at v0.17 than it was when the original borrows landed. ARIS is still a Markdown skill pack; code-oz has shipped 17 milestones of runtime machinery. The gap is on the SDLC dimension (not the research dimension) — ARIS would not aim at code-oz's surface.
- The **domain gap** rules out several patterns wholesale (watchdog, paper compilation, Overleaf bridge, citation discipline, venue checklists). These are correctly categorized as "out of scope," not "missing."
- The **borrowable mechanics** are narrow but real: effort-as-workflow-modifier, zero-context fresh reviewer, meta-optimize, anti-repetition memory entries.

So the comparison is: code-oz is more complete on the SDLC dimension; ARIS is more complete on the harness-as-research-artifact dimension. Code-oz is ahead overall for its category (repo-native agentic SDLC) because the gate, debate, panel, budget, capability, and provider machinery is load-bearing for that category and ARIS has none of it. But ARIS has shipped four mechanics that map onto code-oz's existing surfaces with low authority cost and clear value.

---

## 7. Borrow set, ranked

The borrows are sequenced from "lowest authority cost, highest immediate value" to "needs its own milestone."

**B1 — Effort-as-workflow-modifier (`--effort {lite|balanced|max|beast}`).** Add a top-level `code-oz run --effort` flag that scales `budgets.global` proportionally (0.4x / 1x / 2.5x / 5–8x). The flag derives a single `budgets.global` envelope at run start and the cumulative-enforcement machinery from rule 19 takes over from there. Cost: one CLI flag, one config wrapper, one row in `cli --help`. Authority: zero new boundary — operates on existing budgets.global. Value: gives users a single dial that propagates through every phase, panel, and debate. Suggested slot: pick up in the next budget-related polish (post-M16 cleanup, before M17).

**B2 — Zero-context fresh-reviewer mode for the M14 panel.** Add an opt-in panel sub-mode where one panel slot is invoked with NO prior REVIEW.md, NO HYPOTHESES.md, NO debate transcripts, NO executor summaries — only the BUILD patch + raw VERIFY evidence (test output, mutation report). Cost: one panel-config field, one path-filter in `review-fire-path.ts`. Authority: extends existing panel surface (M14), no new boundary. Value: catches confirmation-bias drift across review rounds — empirically validated by ARIS's paper-claim-audit catching rounding and cherry-picking. Risk under rule 21: must show a measurable bug-catch differential against the full-context reviewer; the M14 events.jsonl already records reviewer findings, so the A/B is observable. Suggested slot: M17 reviewer-memory milestone or follow-up.

**B3 — Anti-repetition entry type under Reviewer Memory v1.** Add a `failed-plans/` and `failed-builds/` entry type to the M17 ACE-borrow Reviewer Memory substrate. When PLAN fails its gate or BUILD exhausts its 4-attempt cap, the failure signature (artifact hashes + error pattern + restart-policy outcome) enters the per-repo lessons index. PLAN reads the index on the next attempt and produces a "this approach failed N times — here is what was different" hypothesis. Cost: two entry types in the M17 bullet schema, one read-hook in `src/phases/plan.ts`. Authority: under the existing M17 Reviewer Memory boundary. Value: codifies what ARIS calls "failed ideas become anti-repetition memory" using the ACE bullet substrate. Suggested slot: M17 (alongside ACE B1–B3).

**B4 — `/meta-optimize` skill candidate (deferred until v0.2+).** Log-driven outer-loop optimizer that reads `state/events.jsonl` and proposes patches to: (a) `src/prompts/universal-rules.md`, (b) the six persona files, (c) `budgets.global` defaults, (d) `restart-policy.ts` thresholds, (e) `debate-scheduler.ts` thresholds. The skill must be cross-model reviewed (Codex on patches, then Opus on the Codex review), user-approved before apply, and reversible (back up to `.code-oz/meta/backups/`). Cost: own milestone. Authority: introduces a new "harness self-modification" boundary under rule 20. Risk under rule 21: needs a controlled comparison against a baseline — "more recent runs" is not a controlled comparison. Defer until code-oz has accumulated >50 production runs across diverse repos and the events.jsonl can be split into a baseline group and a treatment group.

---

## 8. Milestone shape

**Pre-M17 polish (no new authority boundary):**
- B1 (effort-as-workflow-modifier) lands as a `cli --help` row, a flag in `src/commands/run.ts`, and a config wrapper in `src/config/load.ts`. No new milestone slot needed; pick up alongside the next budget or CLI maintenance commit.

**M17 — ACE-borrow Reviewer Memory v1 (already proposed in 01-ace):**
- The ACE comparison proposes B1–B3 of its borrow set under M17 (bullet format + delta operations + bullet usage log).
- This comparison adds B3 (anti-repetition entry types) under the same M17 boundary. The Reviewer Memory substrate already has slots for `lessons` entries; `failed-plans/` and `failed-builds/` are entry types, not new infrastructure.
- B2 (fresh-reviewer mode) extends the M14 reviewer-panel surface — under rule 20 this is a single milestone boundary (M14 → M14.1 sub-mode). Pick up either at M17 or as a stand-alone polish round.

**Deferred — M19+ candidate:**
- B4 (meta-optimize) needs its own milestone after >50 logged production runs. Schedule for v0.2+. The slot is nameable (M19 or later) but does not block the M17 sequence.

---

## 9. What this comparison does NOT recommend

- **Do not import ARIS's MCP-server fanout for reviewer routing.** Rule 21 forbids new parallel-provider surfaces without measurable risk reduction. M14's reviewer panel covers this already. Adding `gemini-review`, `minimax-chat`, `llm-chat`, etc. as separate routes would be authority creep.
- **Do not adopt ARIS's `nightmare` difficulty.** The pattern (reviewer reads the repo directly, bypassing the executor's file manifest) violates rule 13. The file manifest is the trust boundary, not a default the user can override.
- **Do not adopt the Pipeline Status convention in `CLAUDE.md`.** The runtime is the source of truth, not LLM context. The state machine + events.jsonl + gate JSON files are structurally stronger than a prose recovery contract.
- **Do not adopt the watchdog daemon.** Local CLI scope; no remote consumer. If a v1+ "remote build" capability lands, revisit.
- **Do not adopt the Output Versioning Protocol (timestamped-then-copy).** code-oz writes idempotently to schema-validated gate files; the timestamped-then-copy pattern adds drift surface for no gain.
- **Do not adopt bilingual docs at v0.x.** Production-maturity signal that costs disproportionately at this stage.
- **Do not migrate to ARIS's prompt-only architecture.** The runtime is the wedge. Skill packs without a runtime cannot enforce rules 1–21 structurally.

---

## 10. Open questions for Codex

These are the points where the comparison is contested or under-evidenced. The Codex briefing in `CODEX_BRIEFING.md` asks Codex to pressure-test specifically these.

1. **Effort-as-workflow-modifier vs rule 19.** B1 has the effort flag scale `budgets.global` at run start. Is that consistent with rule 19's mandate ("Run-level budget enforcement is mandatory, not advisory")? My read: yes, because the scaling produces a single derived envelope and the cumulative-enforcement machinery is unchanged. Counter-read: any input that lets the user cheaply 8x their budget is an advisory escape hatch by the back door. Which read is right?

2. **Fresh-reviewer mode as M14 sub-mode vs new authority boundary.** B2 is an opt-in panel mode that strips context from one slot. Under rule 20, is "the panel can run without prior REVIEW.md / HYPOTHESES.md" a new authority axis (because it changes what the reviewer is allowed to see), or an extension of the existing panel surface (because the panel already controls reviewer context)? The answer determines whether B2 fits in M17 or needs M14.1.

3. **Rule 21 evidence threshold for meta-optimize.** ARIS's discipline ("≥5 logged invocations before running") is a *threshold*, not a *measurable risk-reduction effect*. My read of rule 21: the threshold is necessary but not sufficient — code-oz needs a controlled A/B (some runs with the optimized prompts, some with the baseline) before retaining a meta-optimize-applied change. Is that right, or am I over-reading rule 21?

4. **Anti-repetition entries — which surface owns them?** B3 puts `failed-plans/` and `failed-builds/` entries under M17 Reviewer Memory v1. But the ACE comparison reserved Reviewer Memory v1 for *lessons that improve future BUILD attempts*, not *failure signatures that PLAN reads on retry*. Are these the same surface (a per-repo lessons index with multiple entry types) or two surfaces (a Reviewer Memory and a separate Failure Memory)? If two, B3 needs its own milestone.

5. **What patterns did I miscategorize as "out of scope"?** Specifically:
   - `/experiment-queue` (parallel experiment management) — code-oz has multi-task cursor (M16); is the experiment-queue pattern *additionally* useful as a parallel-builder-candidate primitive (which rule 20 lists as a deferred Reviewer Panel v2 surface)?
   - ARIS's `Output Manifest Protocol` (every output → MANIFEST.md) — is this redundant with `events.jsonl` or strictly additional (because MANIFEST.md is human-readable and events.jsonl is machine-readable)?
   - `/result-to-claim` (Codex judges if a claim is supported by the evidence) — does this map onto code-oz's VERIFY phase, or is it a fresh-reviewer claim audit at REVIEW that I missed?

6. **Effort-as-workflow-modifier value over per-call effort.** code-oz already has per-call `effort` (high default per the user's Opus-First Philosophy). What does the run-level `--effort` flag *actually* add over the existing per-call effort plus `budgets.global`? Is it just a UX wrapper, or does the flag enable behavior the per-call effort cannot?
