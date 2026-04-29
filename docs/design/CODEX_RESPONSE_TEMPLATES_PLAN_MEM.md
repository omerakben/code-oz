# code-oz — Codex response: planning + memory borrow strategy

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019ddb2a-048b-7902-ba6e-40d5269e0bdf`
- **Briefing:** [`CODEX_BRIEFING_TEMPLATES_PLAN_MEM.md`](./CODEX_BRIEFING_TEMPLATES_PLAN_MEM.md)
- **Scope:** forward-looking design round (M4 wrapper telemetry, M6 PLAN contract, M7 evidence-typed gates, W3 + v0.3+ memory layer). **No code lands from this round.**

Verbatim reply below.

---

## Where I agree (sanity-checked)

1. **Dual-status defer.** Keep gates single-axis in v0.1 because the user is still the only signer; put reviewer score/verdict in `REVIEW.md`, not `GATE_REVIEW_PASSED.json`.

2. **Markdown-canonical plan.** Correct: `PLAN.md` stays canonical and any parsed shape is derived runtime state only; do not add `PLAN.parsed.json` until a TUI/dashboard needs it.

3. **Project memory boundary.** Correct: `.code-oz/` is the privacy boundary, and cross-project sharing must be explicit export/import, not a default global graph.

4. **Content addressing.** Correct if it means "use existing `artifactSha256` discipline"; do not add a duplicate `specSha256` field.

## Where I disagree (with specific alternative)

1. **Reject per-task YAML frontmatter.** Use markdown headings plus one strict fenced YAML block per task in M6; defer `parallelGroup`, and keep tool-call estimates advisory only.

   ```markdown
   ### T01 - Add parser validation

   ```yaml code-oz-task
   id: T01
   agent: builder
   dependsOn: [T00]
   inputs: ["SPEC.md", "src/artifacts/plan.ts"]
   outputs: ["src/artifacts/plan.ts"]
   acceptance:
     - type: command
       ref: "bun test tests/plan-phase.test.ts"
   riskLevel: medium
   plannerNotes: "Parser must reject duplicate IDs and unsafe paths."
   ```

   ```

2. **Reject the full seven-type gate evidence set for v0.1.** Add phase-scoped evidence only: VERIFY requires `command | test | file`; REVIEW requires `review | diff | file`; no `screenshot`, `url`, or `human_note` as required evidence until Playwright/browser verification exists.

3. **Do not ship retrieval with `failure_recorded`.** M7 may write `failure_recorded` events for VERIFY/REVIEW failures, but `findSimilarFailures()` waits until W3 or v0.3 and must be project-local, redacted, and visible in the provider preview.

4. **Reject `contextScope` in agent frontmatter.** M4 should add a provider-request/context DTO and phase-owned manifest builders; scopes are enforced in code as narrower-than-permissions checks, not user-editable persona metadata.

5. **Reject W2 scratch memory.** `events.jsonl` plus artifacts are already the scratchpad; add memory only when a consumer exists.

6. **Reject phase/topic memory paths.** Use ULID-prefixed project-local markdown under semantic buckets:

   ```text
   .code-oz/memory/project/
     decisions/01J...-ulid-vs-uuid.md
     failures/01J...-verify-regex-anchor.md
     reviews/01J...-reviewer-findings-cache.md
   ```

   Frontmatter: `type`, `phase`, `tags`, `runRef`, `sourceEvent`, `createdAt`, `supersededBy?`.

## What's missing

- **Human vs wait:** Do not model it. Human approval is already represented by gate files; wait/passive state is `gate_required`.
- **10-state task status:** Do not adopt. M6 `PLAN.md` is intent, not runtime state; later task runners can use `pending | ready | running | blocked | passed | failed | skipped`.
- **Tool-call circuit breaker:** Enforce at provider-call time from `.code-oz/config.yaml`; the Mimir source contradicts itself (`1.5x` in docs, `10x` in `task-executor.ts`), so do not encode that multiplier into PLAN.
- **Typed dependency edges:** Bare task IDs are enough for M6. Add edge reasons only when a parallel scheduler proves it needs them.
- **Parallel groups:** Defer until multi-task BUILD exists. M7 is single-task BUILD-lite.
- **Reasoning block:** Reject `<reasoning>...</reasoning>` in `PLAN.md`; use short rationale/assumptions sections and `SOURCE_CHECK.md`, not planner thought dumps.
- **Canvas `runs[]`:** Already covered by `events.jsonl`, gates, and `current.json`; the useful derivative is a generated run summary later, not another mutable run slot.
- **Strict parsing discipline:** Borrow the warning from Mimir's regex parser: code-oz should parse strict fenced YAML blocks, not bold-label markdown.
- **Context metrics:** Borrow Mimir's context-reduction measurement as M4 telemetry: files sent, byte count, token estimate, and removed-field count.
- **Memory redaction:** Any failure lesson promoted into memory must strip raw stack traces, secrets, absolute paths, and large context blocks before retrieval.

## Concrete adoption order

**M4:** Add provider request DTO, phase-owned manifest builders, permission intersection, provider preview, and context metrics. No `contextScope` frontmatter.

**M5:** No template borrow except preserving `SPEC.md` as design intent through existing `artifactSha256`.

**M6:** Land strict `PLAN.md` task blocks, task parser/validator, duplicate-ID checks, dependency cycle checks, path-safety checks, acceptance evidence vocabulary, and markdown-canonical rule reinforcement.

**M7:** Require narrowed evidence on VERIFY/REVIEW gates, record reviewer verdict/score in `REVIEW.md`, and emit `failure_recorded` events for typed VERIFY/REVIEW failures. No retrieval.

**W2:** No scratch memory. Add generated run summary/redaction helpers only if needed for UX.

**W3:** If enough failures exist, add project-local `findSimilarFailures()` behind explicit config and provider preview. Otherwise defer.

**M6/M7 later or W5+:** Add `parallelGroup` or richer dependency edges only when BUILD handles multiple tasks.

**v0.3+ reviewer memory:** Add ULID markdown project memory, reviewer-specific retrieval, dual agent/reviewer status for autonomous mode, optional export/import, and SQLite/FTS only after markdown scan is measurably slow.

Verdict: `proceed-with-modifications`

---

## Claude synthesis (post-debate)

Per CLAUDE.md rule 9 (Codex's verdict is data, not authority): each Codex finding judged below. Net result: Codex's pushback flips three of my ten leans to better shapes, sharpens four more, confirms three with valuable refinements. Three brand-new patterns surface in "what's missing" (strict parsing discipline, context metrics, memory redaction) that didn't appear in the briefing.

### Ten leans, judged

| #   | Decision                                                   | Verdict                   | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PLAN.md per-task YAML frontmatter                          | **Flip**                  | Codex's "markdown heading + one strict fenced ` ```yaml code-oz-task ` block per task" is cleaner. Heading is human-readable; the fenced block with explicit lang tag is parser-friendly and unambiguous. The lang-tag (`code-oz-task`) prevents collision with vanilla yaml fences. **Adopt verbatim.** Defer `parallelGroup` (W5+). Keep `estimatedToolCalls` advisory only — circuit-breaking lives in M4's wrapper, not in PLAN tasks.                                                                                                              |
| 2   | Seven-type evidence set on gates                           | **Refine**                | Codex's phase-scoped subset is the honest YAGNI: `screenshot` needs Playwright (W5+), `url` needs public deploys (post-MVP), `human_note` is partly subsumed by `approvedBy: user`. **Adopt phase-scoped vocabulary at M7 design time:** VERIFY ⊆ `{command, test, file}`; REVIEW ⊆ `{diff, file, review}`; DEFINE/PLAN/AUDIT/SHIP gate evidence stays optional. The `review` type Codex introduced needs a precise definition at M7 — likely "structured cross-family reviewer verdict object referenced by hash" — but locking the token now is fine. |
| 3   | Defer dual-status to v0.3                                  | **Hold**                  | Codex's refinement: reviewer score/verdict lives in `REVIEW.md` body, NOT in `GATE_REVIEW_PASSED.json` schema. Sharp distinction — gates stay simple, the artifact carries the dual-axis information. M7 spec for `REVIEW.md` lands this.                                                                                                                                                                                                                                                                                                               |
| 4   | `failure_recorded` event + `findSimilarFailures` retriever | **Flip (split)**          | Codex separates write from retrieve. **Write in M7** (`failure_recorded` event when VERIFY/REVIEW fails terminally); **retrieve in W3+** (only if a corpus exists, behind explicit config flag, with redaction + provider-preview visibility). My original lean conflated the two; splitting them preserves the audit trail without committing to retrieval before there's signal.                                                                                                                                                                      |
| 5   | `contextScope` frontmatter                                 | **Flip**                  | Codex is right: persona files are *identity*, not *runtime narrowing*. Move scope enforcement into code: M4 ships **a provider-request DTO + phase-owned manifest builders** that intersect `permissions.read` (upper bound) with explicit per-phase logic. No frontmatter cruft. Aligns with rule 13's "permissions as check, never generator" principle.                                                                                                                                                                                              |
| 6   | W2 scratch memory tier                                     | **Flip (drop)**           | Codex's argument is correct: `events.jsonl` + the artifact files in `.code-oz/artifacts/` are already the scratchpad. Adding `.code-oz/state/runs/<runId>/scratch/` was YAGNI. **Drop the W2 tier entirely.** Memory layer arrives in W3 (write only) and v0.3+ (retrieve), nowhere earlier.                                                                                                                                                                                                                                                            |
| 7   | Memory path: phase/topic vs ULID-bucket                    | **Flip**                  | Codex's ULID-prefixed semantic buckets (`decisions/`, `failures/`, `reviews/`) are sortable, collision-free, and match the ULID-as-runId discipline elsewhere in the project. Frontmatter adds `sourceEvent` (pointer back to the originating `events.jsonl` line) — closes the audit loop. **Adopt verbatim** for W3 design.                                                                                                                                                                                                                           |
| 8   | Markdown-canonical plan, no parsed sidecar                 | **Hold**                  | Codex's "do not add `PLAN.parsed.json` until a TUI/dashboard needs it" is the right YAGNI rule. Confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | One `.code-oz/` per project, explicit cross-project export | **Hold**                  | Confirmed. The boundary is locked. Cross-project sharing happens via explicit bundle/import (W4+ scope, design later).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | `designIntent` + `purposeInstructions` versioning          | **Refine (no new field)** | Codex caught the duplication: a `specSha256` field would shadow the existing `artifactSha256` on `GATE_DEFINE_PASSED.json`. **Use the existing field; document the discipline that replan compares old vs new `artifactSha256` across runs.** No schema change.                                                                                                                                                                                                                                                                                         |

### Adopted from "what's missing" (all twelve items)

Codex's "what's missing" introduces three patterns the briefing didn't surface, plus eight refinements/clarifications. All adopted:

**New patterns:**

- **Strict parsing discipline.** code-oz parses strict fenced YAML blocks (`` ```yaml code-oz-task ``), not bold-label markdown. Mimir's regex parser is a cautionary tale (and contradicts itself between docs and code on the tool-call multiplier — Codex flagged the source bug). Lands in M6 task parser.
- **Context metrics in M4.** Every provider call records: `filesSent: number`, `bytesSent: number`, `tokensEstimate: number`, `fieldsRemovedByScope: number`. Stored on `agent_invoked` event. Gives users observable evidence that the wrapper-layer narrowing is doing real work.
- **Memory redaction.** Any failure lesson promoted into project memory must strip: raw stack traces, secrets (matched against the standard secret-pattern list), absolute paths (relativize to project root), and large context blocks (>2KB body). Lands as part of the W3 memory write path.

**Refinements adopted:**

- Don't model `human` vs `wait` — gate files + `gate_required` events already cover both.
- Don't adopt canvas's 10-state task status enum for PLAN.md (intent ≠ runtime state). When a runtime task runner exists, it uses `pending | ready | running | blocked | passed | failed | skipped`.
- Tool-call circuit breaker enforced at provider-call time from `.code-oz/config.yaml`, not encoded in PLAN tasks.
- Typed dependency edges deferred until parallel scheduler proves the need.
- `parallelGroup` deferred until multi-task BUILD exists.
- No `<reasoning>...</reasoning>` block in PLAN.md — short rationale/assumptions sections + `SOURCE_CHECK.md` carry the planner's thinking.
- Canvas's `runs[]` slot — already covered by events.jsonl/gates/current.json. The useful derivative is a generated run summary, not a new mutable slot.
- 10-state status enum: keep PLAN.md as intent; runtime task runner gets its own simpler enum.

### Locked adoption order

| Milestone                         | Adopted from this debate                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M4** (in flight)                | Provider request DTO + phase-owned manifest builders + permission intersection (upper-bound check) + provider preview + **context metrics** on `agent_invoked` events. **No `contextScope` frontmatter.** Hard cap at provider-call time from `.code-oz/config.yaml` (no PLAN-level encoding).                                                                                                                   |
| **M5** (DEFINE)                   | No template borrow. Preserve `SPEC.md` as design intent via existing `artifactSha256` on `GATE_DEFINE_PASSED.json`.                                                                                                                                                                                                                                                                                              |
| **M6** (PLAN contract)            | **Strict fenced `code-oz-task` YAML blocks** (Codex's shape). Task parser/validator with duplicate-ID checks, dependency cycle checks, path-safety checks. Acceptance-evidence vocabulary scaffolding (the M7-narrowed types). Markdown-canonical rule reinforcement. **Strict parsing discipline** (no bold-label markdown).                                                                                    |
| **M7** (BUILD/VERIFY/REVIEW-lite) | Phase-scoped evidence requirement on VERIFY (`{command, test, file}`) and REVIEW (`{diff, file, review}`) gates. Reviewer verdict + score recorded in `REVIEW.md` body (NOT in the gate schema). `failure_recorded` events emitted for typed VERIFY/REVIEW failures. **No retrieval helper yet.**                                                                                                                |
| **W2** (real-Claude polish)       | **Nothing.** Generated run-summary helpers + memory-redaction utilities only if real-usage UX surfaces a need.                                                                                                                                                                                                                                                                                                   |
| **W3** (multi-provider polish)    | **Project memory write path** at `.code-oz/memory/project/{decisions,failures,reviews}/<ULID>-<slug>.md` with frontmatter (`type`, `phase`, `tags`, `runRef`, `sourceEvent`, `createdAt`, `supersededBy?`). `findSimilarFailures()` retriever **only if there's a corpus** — behind explicit config flag, redacted, surfaced in the provider preview. Cross-project sharing remains explicit export/import only. |
| **W4** (brownfield AUDIT polish)  | Cross-project export/import design (scoping for memory bundle/share contract — design only, not implementation).                                                                                                                                                                                                                                                                                                 |
| **W5+ / M-multi-task**            | `parallelGroup` field on PLAN tasks. Typed dependency edges. Multi-task BUILD scheduler.                                                                                                                                                                                                                                                                                                                         |
| **v0.3+ Reviewer Memory**         | Dual-status (agent self-claim vs reviewer approval) IF fully-autonomous mode lands. SQLite/FTS retrieval upgrade ONLY if markdown-scan is measurably slow at that point. Reviewer-specific retrieval.                                                                                                                                                                                                            |

### Patterns explicitly out of scope (declared, not deferred)

These patterns from agentic-canvas or Mimir are **not adopted at any milestone**:

- **Canvas's JSON-canonical plan file.** Conflicts with rule 7 (plain Markdown artifacts). The patterns canvas expresses in JSON are borrowed structurally; the storage shape isn't.
- **Canvas's `human` vs `wait` node primitives.** Subsumed by code-oz's gate files + `gate_required` events.
- **Canvas's 10-state `progress.status` enum on PLAN.md tasks.** PLAN.md is intent, not runtime state.
- **Canvas's `<reasoning>...</reasoning>` block in PLAN.md.** Replaced by short rationale/assumptions sections + `SOURCE_CHECK.md`.
- **Canvas's `runs[]` slot.** Already covered by events.jsonl + gates + current.json.
- **Mimir's Neo4j / NornicDB / Docker-compose stack.** Conflicts with native-binary constraint and "no SQLite v0.1" (and stricter than that — no graph DB ever, period).
- **Mimir's single-`:Node`-label graph model.** Conflicts with project boundary discipline (rule 13).
- **Mimir's parallel Python orchestrator.** Conflicts with Bun + TS stack lock.
- **Mimir's `vm`-sandboxed Lambda task type.** Out of scope; security commitment for a problem code-oz doesn't have.
- **Cross-project default memory.** Each `.code-oz/` is its own boundary. Cross-project sharing is explicit, designed in W4+.

### Status

**Approval: confirmed by Ozzy, 2026-04-29.** No code lands from this round. The synthesis above is the design contract that informs M4 (in flight, manifest builder + context metrics), M6 (PLAN task parser shape), M7 (evidence-typed gates + failure_recorded events), and the W3+/v0.3+ memory milestones when their briefings are written.

A cross-cutting addendum was added to [`SESSION_M4_KICKOFF.md`](./SESSION_M4_KICKOFF.md) capturing the synthesis decisions that affect M4 (context metrics on `agent_invoked`, no `contextScope` frontmatter, tool-call circuit-breaker enforced at provider-call time from `.code-oz/config.yaml`).

### Cross-references for future briefings

When the M6 briefing is written, it should cite this doc and lock the strict fenced `code-oz-task` shape from prompt 1's flip.

When the M7 briefing is written, it should cite this doc and lock the phase-scoped evidence vocabulary (`{command, test, file}` / `{diff, file, review}`) plus the `failure_recorded` event addition.

When the W3 (or v0.3+) memory briefing is written, it should cite this doc and lock the path structure (`.code-oz/memory/project/{decisions,failures,reviews}/<ULID>-<slug>.md`), the frontmatter shape, the redaction discipline, and the explicit-config gate on retrieval.
