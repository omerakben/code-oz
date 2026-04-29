# code-oz — Codex briefing: planning + memory borrow strategy from new templates

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. This is **not** a milestone briefing — M3 shipped (`v0.3.0-alpha.0`, 266 tests), M4 is just kicking off in a separate session. This briefing is a **forward-looking design round** for the planning artifact (M6 territory) and the future memory layer (W2+ scratch / W3 project / v0.3+ retrieval), informed by two new template repos that just landed in the influence library.

The two templates:

- `~/Projects/agents/templates/agentic-canvas` — local-first vanilla-JS visual canvas. Plan IS a single versioned JSON file. 10-state node `progress.status`, 7-type evidence vocabulary on claims, dual axes (`progress` vs `review`), distinct `human` vs `wait` primitives. **No memory subsystem.** ~3,275 LOC.
- `~/Projects/agents/templates/Mimir` — multi-agent MCP server. Neo4j-backed knowledge graph + RRF hybrid (vector + BM25) retrieval + PM/Worker/QC pipeline + persona-scoped `ContextManager.filterForAgent()` + `failure_pattern` nodes retrieved into PM context as anti-prompts. Distributed as Docker Compose with 4–6 services.

Your job: **debate when and how each pattern adapts into code-oz**, given the locked architecture. I have leans on ten decisions. Push back hard where my leans are wrong; confirm fast where they hold up. Where you confirm, sanity-check rather than rubber-stamp.

---

## What you should already have read

Read these from code-oz first; they bound the debate:

- `CLAUDE.md` — non-negotiable rules 1–14. Rules **1, 7, 10, 13** are the tightest constraints on this debate (file-based gates only, plain-Markdown artifacts, cost budgets in config, privacy-by-default with explicit file manifests).
- `docs/design/ROADMAP.md` — "Locked decisions" §7 (no SQLite v0.1), the post-MVP queue (W2/W3/W4/W5+/v0.3+), and the explicit mention that "Reviewer Memory is v0.3+".
- `docs/references/file-based-gates.md` — the **canonical pinned spec** for gate schemas, event types, and validation rules. `events.jsonl` event taxonomy (`run_started` / `phase_entered` / `phase_exited` / `agent_invoked` / `agent_completed` / `gate_written` / `gate_required` / `intervention` / `run_ended`) is the surface any new event has to slot into.
- `docs/references/agent-skill-format.md` — the **"Permissions semantics: upper bound, not glob expansion"** section. Load-bearing for prompt 5 below (persona-scoped context).
- `docs/adr/0001-mvp-option-e.md` — Option E (spine-first MVP) decision.
- `docs/design/CODEX_RESPONSE_M3.md` — for format reference. Your reply should follow the same four-section structure (where I agree / where I disagree / what's missing / concrete order).

You do not need to read the M2 or M3 source. Both are stable; this debate is purely additive and forward-looking.

---

## Template summary (compressed; read full files only if needed)

### agentic-canvas — what we want from it

- **One file = the plan.** Schema in `schemas/agent-canvas.schema.json:1-310`, normalizer in `scripts/canvas-schema.mjs:1-419`. Top-level: `schemaVersion`, `workflowKind`, `name`, `designIntent` (free-text seed prompt), `nodes[]`, `connections[]`.
- **Node shape:** `{ id, type, label, purposeInstructions, agent: { role, intent, inputs, outputs, acceptanceCriteria, recommendedTools, riskLevel, notes }, progress: { status, owner, claims[] }, ... }`.
- **10-state `progress.status` enum** (`canvas-schema.mjs:62-73`): `not_started → planned → in_progress → blocked → needs_review → review_pending → completed → rejected → superseded → error`.
- **7-type evidence vocabulary** on claims (`canvas-schema.mjs:76`): `command | file | diff | screenshot | test | url | human_note`. **Validator rejects `status:"completed"` claims with empty `evidence[]`** (`canvas-schema.mjs:354-356`).
- **Dual axis:** agent's `progress.status` vs reviewer's `review.status` (`canvas-schema.mjs:62-75`).
- **`human` (active work) vs `wait` (passive gate)** as distinct node types (`CLAUDE.md:36`).

**Empirical caveat:** zero of the 12 shipped example workflows actually populate the `agent` or `progress.claims` fields (verified by grep). The expressive parts of the schema are aspirational. Easy to over-engineer code-oz the same way.

### Mimir — what we want from it

- **PM → Worker → QC orchestration.** `chain-output.md` (markdown plan, parsed by `parseChainOutput` at `src/orchestrator/task-executor.ts:400`) is the canonical plan artifact between phases.
- **`ContextManager.filterForAgent('worker', { maxFiles: 10 })`** at `src/managers/ContextManager.ts:79-150` — persona-scoped allow-list filter. Workers physically cannot receive PM-only fields.
- **`failure_pattern` node + `findSimilarFailures()`** at `src/orchestrator/agent-chain.ts:329-359` (~30 lines) — past failures keyword-matched into PM context as anti-prompts. Compounds across runs.
- **RRF hybrid retrieval** at `src/managers/UnifiedSearchService.ts` — vector + BM25 with tunable weights, type-filtered. Falls back to plain FTS when embeddings cold.
- **Status-machine-on-the-graph** — per-task fields (`status, attemptNumber, maxRetries, qcScore`) ARE the queue + audit log + resume manifest. No second source of truth.
- **Estimated-tool-calls × 1.5 dynamic circuit breaker** (`docs/architecture/MULTI_AGENT_GRAPH_RAG.md:197-200`) — per-task budget cap.

**Reality check:** Mimir is a kitchen-sink research project at the edges. `MIMIR_NORNICDB_UNIFIED_ARCHITECTURE.md` is `Status: DRAFT`, `nornicdb/README.md` says NornicDB has moved out of repo, the 197KB `pipelines/mimir_orchestrator.py` is "Phase 1 only." Treat aspirational sections with skepticism.

---

## What's locked (not up for debate)

These come from CLAUDE.md, ROADMAP.md, and the pinned spec at `docs/references/file-based-gates.md`. **Do not reopen them.**

1. **Plain-Markdown artifacts only.** Rule 7. `SPEC.md`, `PLAN.md`, `BUILD_REPORT.md`, etc. JSON-canonical plans (canvas's whole shape) are out. We can borrow the *patterns* canvas expresses in JSON, but they have to land as Markdown + YAML frontmatter or as `events.jsonl` event extensions.
2. **`events.jsonl` is the canonical run trace.** Single mutable state file (canvas's whole shape) is out. Any "memory" or "history" pattern must extend the existing event taxonomy or introduce a new file *category* (not mutate an existing one).
3. **No SQLite in v0.1.** ROADMAP.md "Locked decisions §7" explicit. Mimir's RRF hybrid retrieval, vector embeddings, and structured queries are out for v0.1. Memory layer in v0.1 = filesystem + Markdown + grep, period.
4. **Phase taxonomy is fixed.** DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP (greenfield) and AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP (brownfield). Canvas's free-form node graph is out.
5. **File-based gate signals only.** Rule 1. No phase advances by parsing LLM text. Canvas's progress.status enum can map onto our gate file presence + outcome enum, but not onto per-task LLM-text status detection.
6. **Permissions are upper-bound checks, not generators.** Rule 13. Mimir's `ContextManager.filterForAgent()` is borrowable as a *narrower* per-persona check inside the upper bound, not as a substitute for it.
7. **Hand-rolled validation pattern.** No `zod`/`valibot` for any new schemas. Same issue-array `{ file, code, rule, detail }` shape as `AgentLoadError` from M2 and `GateLoadError` from M3.
8. **Bun + TypeScript native binary.** No Go, no Python. Mimir's NornicDB and the parallel Python orchestrator are out by default.
9. **Cross-family REVIEW required at REVIEW gate.** Rule 2. Cannot borrow Mimir's "QC role is just a different prompt of the same model" pattern — code-oz's reviewer must be a different provider family.

---

## Acceptance for this debate (what "done" looks like)

This briefing produces a `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md` with:

- A verdict on each of the ten leans below.
- A list of "what's missing" patterns from agentic-canvas or Mimir that I haven't surfaced as prompts but should be considered.
- A concrete adoption order: **which milestone introduces which pattern**, and which patterns should be *deferred indefinitely* (declared out-of-scope for v0.1 and explicitly listed for v0.3+ design).
- An overall verdict: `proceed-with-leans`, `proceed-with-modifications`, or `reopen-design`.

This is **not** an implementation spec. No code lands from this round. The output is design-doc only — it informs M6 (PLAN contract) and the W3/v0.3+ memory milestones when those briefings are written.

---

## My ten leans (the prompts)

For each: lean + reasoning + counter-argument I'm aware of. You either agree with sanity-check, disagree with a specific better path, or flag a third option.

### 1. PLAN.md task structure for M6 — borrow canvas's node fields, expressed in YAML frontmatter

**Lean: extend the M6 PLAN.md contract with per-task YAML frontmatter blocks** matching canvas's node shape in flatter form. Each task gets:

```yaml
- id: T01
  title: ...
  agent: builder
  dependencies: [T00]
  parallelGroup: 1                  # optional; tasks with same number can run in parallel
  purposeInstructions: |             # canvas's per-node free-text durable knowledge
    ...
  inputs: [SPEC.md, ./src/foo.ts]    # explicit, intersected with permissions.read at runtime
  outputs: [./src/bar.ts]            # explicit, intersected with permissions.write at runtime
  acceptanceCriteria:
    - { type: command, ref: "bun test tests/foo.test.ts" }
    - { type: file,    ref: "./src/bar.ts" }
  estimatedToolCalls: 12             # Mimir's circuit-breaker budget; ×1.5 cap at runtime
  riskLevel: low                     # canvas's risk axis
```

**Reasoning:** canvas's expressive node fields (purposeInstructions, acceptance, risk) directly map to PLAN.md tasks. YAML frontmatter is already the agent-skill-format pattern (rule on hand-rolled parser carries over). Forces the planner persona to commit to evidence types up front, which (combined with prompt 2) makes VERIFY/REVIEW gates unbluffable.

**Counter:** YAML-block-per-task is verbose for a markdown artifact a human reads. A simpler structure — markdown headings + a small structured fence per task — might read better. Also: canvas's nodes-as-graph supports DAGs naturally; markdown-with-frontmatter implies linear ordering with a `dependencies` field, which is fine for code-oz's bounded plans but loses canvas's spatial-layout-as-soft-hint.

**Push back if** the right shape is "markdown body + tiny structured fence" rather than "markdown frontmatter on every task," or if `parallelGroup` should be deferred (M7 doesn't parallelize anyway), or if `estimatedToolCalls` belongs at provider-call time (M4) not at PLAN time.

### 2. Evidence-typed gate adoption — extend `GATE_<PHASE>_PASSED.json` with optional `evidence[]`

**Lean: add an optional `evidence: { type, ref }[]` array to the gate schema**, with `type ∈ { command | file | diff | test | screenshot | url | human_note }` (canvas's seven types verbatim). VERIFY and REVIEW gates **require non-empty `evidence[]`**; DEFINE/PLAN/BUILD/SHIP/AUDIT gates make it optional. Validator rule mirrors canvas's "no completed without evidence" pattern. Refusal becomes typed `gate_evidence_missing`.

**Reasoning:** turns "agent says done" into "agent must show one of {command output, file path, diff, test, screenshot, url, human note}" at the highest-leverage gates (VERIFY = "did it actually work" / REVIEW = "did the reviewer actually see something"). Closes the silent-success class. Cheap to implement (additive optional field; new validator rule). Spec change is small and self-contained.

**Counter:** code-oz already has `artifactSha256` for content integrity. Evidence types are partly redundant — an artifact's SHA already proves a file was produced. The extra schema cost might not buy what canvas claims, especially since canvas's own example workflows don't populate the field. And v0.1 only has one approving entity (the user), which already serves as the human_note evidence.

**Push back if** evidence-typed gates are over-engineering for v0.1's user-approves-everything model, or if a *minimal* version (only `command | file | test` — drop screenshot/url/human_note as YAGNI) is more honest.

### 3. Dual-status (agent self-claim vs reviewer approval) — defer to v0.3, keep single-axis approve in v0.1

**Lean: keep code-oz's current single-axis `approvedBy: user` model in v0.1. Defer canvas's two-axis split (`progress.status` vs `review.status`) to v0.3+** when fully-autonomous mode lands and there's actually a separation between "agent claims done" and "reviewer approves."

**Reasoning:** v0.1's user is the only approving entity at every gate. Splitting the axis adds schema complexity for a distinction the v0.1 product doesn't have. The two-axis pattern matters when an agent autonomously moves to `needs_review` and a separate reviewer agent then sets `review.status: approved` — code-oz hits that case in v0.3 (broad `consult()` + autonomous mode), not v0.1.

**Counter:** REVIEW-lite at M7 already invokes a cross-family reviewer agent. Even though the user is the final gate signer, the reviewer's verdict (score≥6 + verdict=ready per rule 6) is conceptually a separate axis. Encoding it now means M7's REVIEW.md artifact has a clean place to record both the reviewer's score and the user's approval — and v0.3+ doesn't need a schema migration.

**Push back if** the two axes should land at M7 in `REVIEW.md` (not in the gate file — keep gates simple, push the duality into the artifact), or if the dual-status applies to ALL gate writes from M5+ onward (not just REVIEW).

### 4. `failure_pattern` events — add `failure_recorded` event type to events.jsonl, retrieved at PLAN

**Lean: add a new event type `failure_recorded` to the v0.1 event taxonomy:**

```json
{ "version": 1, "type": "failure_recorded", "ts": "...", "runId": "...", "phase": "verify", "agent": "verifier", "code": "test_assertion_failed", "lesson": "regex did not anchor; matched substring of file path", "tags": ["regex", "test"] }
```

**Plus a `findSimilarFailures(query, limit=3)` helper** that grep-scans `*/events.jsonl` files across all run subdirectories under `.code-oz/state/runs/`, filters to `type === "failure_recorded"`, keyword-matches `lesson` + `tags` against the query, and returns the top N. **Called by the lead persona at PLAN time** to prepend "lessons from past runs" to the planning context.

**Reasoning:** Mimir's highest-leverage pattern, ~30 lines of code in their codebase. Compounds across weeks — past mistakes become anti-prompts. Fits the locked event-log model with no new file category. Retrieval is grep over plain-text, no SQLite, no embeddings. Cross-run by default since it walks all run subdirs.

**Counter:** v0.1 has too few runs to make this useful — `findSimilarFailures` returns nothing for the first dozen runs. Premature feature. Better to write `failure_recorded` events from M5 onward (cheap; just an additive event type) but defer the retrieval helper to W3 when there's actually a corpus to search. Also: cross-run retrieval crosses the privacy boundary in rule 13 — a memory-laden lesson from run A could leak into the prompt for run B without an explicit user opt-in.

**Push back if** the right phasing is "add the event in M5, defer the retriever to W3" rather than "ship both together," or if `failure_recorded` should be scoped per-project (read across runs but not across projects), or if the retrieval should require an explicit `--use-memory` flag at v0.1.

### 5. Persona-scoped context — hard `ContextManager.filterForAgent()` boundary at the M4 wrapper

**Lean: add a hard persona-scoped filter as part of M4's wrapper layer, sitting *inside* the `permissions.read` upper bound.** Each persona declares an additional `contextScope` allow-list of fields/files (narrower than `permissions.read`), enforced at provider-call time. A worker physically cannot see PM-only fields.

Concrete shape: extend the agent frontmatter with an optional `contextScope` block:

```yaml
contextScope:
  fromPlan: ['title', 'agent', 'inputs', 'outputs', 'acceptanceCriteria']  # NOT 'purposeInstructions' — that's PM context
  fromArtifacts: ['SPEC.md.requirements', 'PLAN.md.<my-task>']
  maxFiles: 10
  maxTokensEstimate: 8000
```

**Reasoning:** Mimir's single highest-leverage pattern. Adopting it from day-1-of-M4 closes the "worker accidentally relies on PM context, so we can never change PM context" trap before it forms. Aligns with rule 13 (privacy by default; explicit file manifests). Costs one optional frontmatter field + one wrapper-layer check.

**Counter:** v0.1 has 5 personas and a tight phase-graph. Each phase already has explicit logic for what it sends — there's no real "worker accidentally got PM context" because the phase code is the only thing that builds manifests. The persona-scoped filter is a solution looking for a problem at v0.1 scale. Defer to v0.3 when broad `consult()` lands and personas can request files outside their phase's explicit logic.

**Push back if** the right place for this is **inside the phase logic** (each phase's manifest builder declares per-persona narrowing) rather than as a persona frontmatter field, or if the v0.1 5-persona surface genuinely doesn't need it.

### 6. Memory layer arrival timing — scratch in W2, project in W3, retrieval in v0.3+

**Lean: tier the memory layer across the post-MVP queue:**

- **W2:** **scratch memory** (per-run, ephemeral, autodeleted on success). Path: `.code-oz/state/runs/<runId>/scratch/<phase>/<topic>.md`. Free-form markdown. Used by personas to think out loud. No retrieval — just a place to write. Auto-cleaned when the run ships or stops.
- **W3:** **project memory** (long-lived, frontmatter-tagged markdown). Path: `.code-oz/memory/project/<phase>/<topic>.md` with YAML frontmatter (`type`, `phase`, `tags`, `runRef`, `supersededBy`, `createdAt`). Retrieval = grep + frontmatter-tag-match. Auto-indexed at boot.
- **v0.3+:** **retrieval engine upgrade** ONLY IF retrieval becomes the bottleneck (>200 entries linear-scan slowdown). At that point: revisit the SQLite + FTS5 + sqlite-vec decision. Until then, plain markdown wins on simplicity, debuggability, and rule-7 alignment.

**Reasoning:** matches the locked "no SQLite v0.1" constraint without committing to never having retrieval. Tiered introduction lets each layer prove its value before the next is built. Markdown-only retrieval works until ~200 entries; the timing aligns with v0.3 when the project will have enough usage to know if memory size is the bottleneck.

**Counter:** "memory layer in W2/W3" presumes there's something *to* remember — and the v0.1 scope (DEFINE → REVIEW-lite, one atomic task end-to-end) doesn't generate enough cross-run signal to justify any memory beyond `events.jsonl` itself. Defer the entire conversation to v0.3 + Reviewer Memory milestone, when there's a concrete persona (the reviewer) with a concrete need (remembering past review verdicts on similar files). Memory before there's a memory consumer is YAGNI.

**Push back if** the right approach is "memory is a v0.3+ concern only, period" rather than tiered, or if the W2 scratchpad is unnecessary because `events.jsonl` plus the artifact files in `.code-oz/artifacts/` are already the scratchpad.

### 7. Memory storage shape (when it lands) — `.code-oz/memory/project/<phase>/<topic>.md` with frontmatter

**Lean: if memory lands in W3 per prompt 6, the shape is filesystem-tagged markdown:**

```
.code-oz/memory/
  project/
    plan/
      api-design-decisions.md
      ulid-vs-uuid-rationale.md
    review/
      common-regex-mistakes.md
    failures/
      <auto-extracted from failure_recorded events>
```

Each file: YAML frontmatter (`type: memory`, `phase: <phase>`, `tags: [...]`, `runRef: 01J3Z...`, `supersededBy: <path>?`, `createdAt: <iso>`) + free-form markdown body. Retrieval = grep + frontmatter-tag-match. Cross-run within a project; never cross-project (each project has its own `.code-oz/memory/`).

**Reasoning:** mirrors `.code-oz/agents/`, `.code-oz/artifacts/`, `.code-oz/state/` — same directory pattern, same Markdown+YAML format. Greppable, git-trackable, no infrastructure. Project boundary = the `.code-oz/` directory (closes Mimir's biggest weakness: single-graph everything).

**Counter:** filesystem-tagged markdown gets unwieldy past ~50 files. The "topic" axis is a soft structure that drifts (one author calls it `api-design-decisions.md`, another calls it `apis.md`, both end up retrieved or neither is). Frontmatter tags are better but still rely on consistent author discipline. A flat `memory/<phase>/<ulid>-<slug>.md` with mandatory tags + auto-index might scale better.

**Push back if** the directory structure should be flat (no `<phase>/` subdir) with all routing via frontmatter tags, or if the file naming convention should be mandatory ULID-prefixed (sortable, no collision risk), or if the `failures/` subdirectory should be auto-extracted from `failure_recorded` events at boot rather than written by personas.

### 8. Markdown-canonical-plan rule preservation — reinforce, never JSON-canonical

**Lean: REINFORCE the rule-7 markdown-canonical-plan invariant.** Both new templates converge on "human-editable file → validated structure" (canvas via JSON+canvas-UI, Mimir via `chain-output.md`). code-oz already lands on the right side of this debate; the two new repos validate the choice rather than challenging it.

**Reasoning:** rule 7 was a deliberate locked choice. Canvas's JSON-as-canonical pattern would force users into the browser canvas for non-trivial edits — incompatible with code-oz's CLI-first product. Mimir's `chain-output.md` validates the markdown-canonical pattern from a totally different codebase shape.

**Counter:** none from these templates. Both reinforce the existing rule. The only push back here is whether code-oz should add a *companion* parsed-JSON sidecar (`PLAN.parsed.json`) for downstream tooling (TUI, dashboards, telemetry) so the runtime doesn't re-parse markdown on every read. Canvas's whole existence is built on "the parsed structure is the API"; code-oz could borrow that without changing the canonical artifact.

**Push back if** a parsed-sidecar (`PLAN.parsed.json`, derived; rebuilt by `run.ts` on each PLAN gate write) is worth introducing as a v0.1 convenience, or if it's premature (no consumer exists yet).

### 9. Cross-project memory boundary — one `.code-oz/` per project; explicit export to share

**Lean: project boundary = the `.code-oz/` directory.** No global memory, no `~/.code-oz/global-memory/`. If a user wants cross-project knowledge, they explicitly bundle and import. Closes Mimir's single-graph-everything weakness from day one.

**Reasoning:** rule 13 (privacy by default). Aligns with how agents already work (project-local overrides at `.code-oz/agents/<name>.md`). Makes the failure-pattern retrieval (prompt 4) auto-scoped to the project, which is the right default.

**Counter:** a developer working across N projects loses the cross-project compounding (lesson learned in project A doesn't help project B). Mimir explicitly chose the cross-project model; code-oz explicitly rejects it. Worth confirming this is a deliberate trade-off, not an accident of the directory structure.

**Push back if** there's a privacy-safe cross-project pattern (e.g., a `~/.code-oz/global-failures/` that only stores `lesson` text with no file paths or runIds — abstracted away from project specifics) that would be worth designing for v0.3+.

### 10. `designIntent` + `purposeInstructions` versioning — content-address both

**Lean: borrow canvas's `designIntent` (per-run) and `purposeInstructions` (per-task) concepts, content-addressed.**

- `designIntent` already exists in code-oz as `SPEC.md`'s "Goals" section. Add a `specSha256` field to `GATE_DEFINE_PASSED.json` (already there as `artifactSha256`). On replan (a future feature), the system can show "the original intent was $oldHash, the current intent is $newHash."
- `purposeInstructions` per task lands in M6's PLAN.md task contract (prompt 1). Versioning happens implicitly via `artifactSha256` on `GATE_PLAN_PASSED.json`.

**Reasoning:** canvas's slots map cleanly onto code-oz's existing artifact contract. No new schema work — just discipline about how SHAs roll forward across replans. Cheap to set up now, painful to retrofit later if a replan-without-versioning landed first.

**Counter:** v0.1 doesn't have replan. M5–M7 ship a single forward path. The versioning design is YAGNI until there's a replan command. Defer to W4+ when replan lands.

**Push back if** the right move is "do nothing now; revisit when replan is on the table" rather than "set up the discipline before replan needs it."

---

## How to reply

Mirror the M3 response format. Four sections, terse, no hedging:

1. **Where I agree (sanity-checked).** For each lean you confirm: one sentence on why my reasoning holds up under scrutiny, not just that you agree.
2. **Where I disagree (with specific alternative).** For each lean you reject: the better path, concretely. Naming a milestone, a schema shape, a rule, an API surface.
3. **What's missing.** Patterns from agentic-canvas or Mimir I haven't surfaced as prompts that should be considered. Categories I'm aware I haven't thought hard about:
   - Should canvas's `human` vs `wait` distinction land in code-oz at all? The phase-graph already has gate files; canvas's distinction may already be subsumed.
   - Should canvas's 10-state node `progress.status` enum become the per-task status enum in code-oz's PLAN.md? Or is "task done / task pending / task failed" enough at v0.1 scale?
   - Mimir's "estimated tool calls × 1.5 dynamic circuit breaker" — should this be a per-task field in PLAN.md tasks (per prompt 1's `estimatedToolCalls`), or at provider-call time only (M4's wrapper)?
   - Canvas's `connections[]` carry `fromRole`/`toRole` strings — does code-oz need a similar typed-edge concept on PLAN.md task dependencies, or are bare task-IDs enough?
   - Mimir's `parallelGroup: number` field on tasks — when does code-oz need parallelism? M7 is single-task BUILD-lite; M-something-later is when this matters.
   - Should code-oz adopt Mimir's `chain-output.md` reasoning-block pattern (a `<reasoning>...</reasoning>` block at the top of PLAN.md showing the planner's thought process)?
   - Canvas's `runs[]` slot in the schema (declared but unused) — code-oz already has events.jsonl for this. Is there anything in the runs[] *concept* worth borrowing?

   Tell me which of these matter and which should defer, and what I missed.

4. **Concrete adoption order.** A milestone-by-milestone landing schedule:
   - **M4 (provider contract — in flight now):** what (if anything) from this debate lands in M4? Likely just the persona-scoped `contextScope` frontmatter slot if prompt 5 is adopted.
   - **M5 (DEFINE):** what lands?
   - **M6 (PLAN contract):** the bulk of canvas-pattern adoption, per prompts 1, 2, 8, 10.
   - **M7 (BUILD/VERIFY/REVIEW-lite):** evidence-typed gates per prompt 2 take effect at VERIFY/REVIEW gates.
   - **W2 (post-MVP polish):** scratch memory if prompt 6 is adopted.
   - **W3 (multi-provider polish):** project memory + `findSimilarFailures` retriever if prompts 4 and 6 are adopted.
   - **v0.3+ Reviewer Memory milestone:** dual-status if prompt 3 is deferred there; SQLite/retrieval upgrade if prompt 6 is tiered.

Verdict at the end: `proceed-with-leans`, `proceed-with-modifications`, or `reopen-design`. Use the strongest verdict you can defend.

---

Briefing ends. Respond verbatim per the structure above. Cite file paths from `~/Projects/agents/templates/agentic-canvas` or `~/Projects/agents/templates/Mimir` only when the reference adds force.
