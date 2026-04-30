# code-oz — M6 Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M5 has shipped (`v0.5.0-alpha.0`, 542 tests passing offline, three-round Codex review trail closed with `push` verdict). The synthesis round just closed (`docs/research/MERGE_PLAN.md`, `proceed-with-modifications` verdict, thread `019ddc5f`); CLAUDE.md and ROADMAP.md have been updated per the merge plan (rules 15–19 added, M6 grown from 10 to ~14 commits). M6 is the next milestone: **PLAN phase + 3-source verification + repo-context MVP + Scientist substrate + run-level budgets**.

The scope is locked by `docs/design/ROADMAP.md § M6` (newly expanded) and `docs/research/MERGE_PLAN.md`. You are not debating *what* to build — you are debating *how* to build it. I have leans on **twelve decisions**: cap defaults for repo_context, scientist commit ordering, hypothesis-id lifecycle, source-check verification semantics, plus seven implementation-layer details that the merge plan explicitly defers to this round.

Push back hard where my leans are wrong. Confirm fast where they hold up. Where you confirm, sanity-check rather than rubber-stamp. Mirror the verdict format from `CODEX_RESPONSE_M5.md`: "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before code".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1–19 (rules 15–19 are the new additions from the synthesis round) plus cross-model peer review rules 7–10. Rule 1 (file-based gates), 3 (3-source verification before any code), 13 (privacy by default, explicit file manifests), 15 (epistemic sidecars at phase gates), 18 (codebase context retrieval as `tool_use.repo_context`), and 19 (cumulative budgets under `budgets.global`) are the tightest constraints on M6.

- **`docs/research/SYNTHESIS.md`**, **`docs/research/CODEX_RESPONSE_SYNTHESIS.md`**, **`docs/research/MERGE_PLAN.md`** — the synthesis round's three artifacts. Your prior verdict (`019ddc5f`) is in CODEX_RESPONSE_SYNTHESIS.md; the merge plan reflects your push-backs accepted (rule 15 reshape, leaked-source ban, tool_use.repo_context schema, budget namespace correction, Scientist substrate-vs-tail separability). M6 inherits those locks.

- **`docs/research/01-maestro-rule-checker.md`** — the maestro discipline. Skill `repo-search-before-write` is the consumer of the M6 repo-context tools. Skill `requirement-restate` is the discipline at the start of every gate. Skill `state-handoff` is the schema for inter-phase handoffs (PLAN → BUILD).

- **`docs/research/02-llm-failure-research.md`** — 17-family failure research. Family 1 (API and library fabrication) and family 4 (project context conflict) are the two M6 cannot leave open: PLAN's reference search must catch fabricated symbols and surface duplicates of existing repo helpers. Family 8 (verification gap) lands at M7's mutation-test gate, but M6's PLAN.md atomic-task contract pre-loads the discipline by requiring per-task validation commands.

- **`docs/research/05-scientist-and-open-questions-agent.md`** — Scientist meta-agent. M6 ships substrate + PLAN phase-tail; M7 wires BUILD/VERIFY/REVIEW tails. CLI commands and cross-run memory deferred to W2 per merge plan.

- **`docs/design/ROADMAP.md § M6` (updated)** — expanded scope and acceptance criteria. Files list is the per-commit scaffold; commit ordering within the ~14-commit budget is up for debate (prompt 2 below).

- **`docs/design/CODEX_BRIEFING_M5.md`**, **`docs/design/CODEX_RESPONSE_M5.md`**, **`docs/design/CODEX_REVIEW_M5.md`** — M5's planning round, response, and post-implementation review. Format references for what your reply should look like, plus the canonical artifact contract pattern (SPEC.md structure → `parseSpec` → `serializeSpec` → atomic write → gate). M6's PLAN.md and SOURCE_CHECK.md follow the same pattern; HYPOTHESES.md and OPEN_QUESTIONS.md are sidecars.

- **`docs/references/spec-contract.md`** — M5 SPEC contract reference. Pattern for plain-Markdown contracts: title + canonical-order H2 sections + bullet-only bodies + draft-vs-canonical discipline + ready-token grammar. M6 contracts (PLAN, SOURCE_CHECK, HYPOTHESES, OPEN_QUESTIONS, REPO_CONTEXT, SCIENTIST) follow this.

- **`docs/references/file-based-gates.md`** — § 4 (canonical phase → artifact map: `plan → PLAN.md` + `plan → SOURCE_CHECK.md` sidecar map TBD), § 5 (events.jsonl), § 9 (cross-file recovery — a mid-PLAN crash with `PLAN.md` written but no `gate_written` event must recover deterministically when `code-oz approve plan` runs). The gate-preflight extension for HYPOTHESES.md / OPEN_QUESTIONS.md (rule 15) lands inside `requireGate(plan, ...)` — debated in prompt 9 below.

- **`docs/references/provider-contract.md`** — IAgentProvider, ProviderRequest paths-only DTO split, agent_invoked manifest events. M6's repo-context tools live BETWEEN provider invocations (search produces candidate paths; selected paths enter the *next* invocation's manifest). The audit invariant is: bytes sent to a provider == manifest content == `agent_invoked.bytesSent`.

- **`docs/references/agent-skill-format.md`** — frontmatter spec including AgentPermissions. M6 extends the schema with `tool_use.repo_context` per CLAUDE.md rule 18.

You do not need to read every M2–M5 source file. Glance at:

- **`src/providers/invoke.ts`** — the wrapper layer. M6's `assertWithinBudget` extension reads existing `events.jsonl` per-call; the wall-time computation reads `run_started.ts` from the events stream. The new `budget_warning` event (rule 19) emits at `softWarnAtRatio` per-dimension.

- **`src/agents/schema.ts:42-47`** — current AgentPermissions shape. M6 adds the `tool_use` optional field per Codex's TypeScript schema in `MERGE_PLAN.md`.

- **`src/state/schemas.ts`** — EVENT_TYPES, PhaseEvent, validation rule 12 (open-type-union). Lets M6 add the new event types (`repo_context_searched`, `science_*`, `hypothesis_*`, `question_*`, `budget_warning`) without bumping `version: 1`.

- **`src/state/events.ts`** — `validateEvent`. Per-type validation lands for each new event type added.

- **`src/artifacts/spec.ts`** — the canonical artifact-parsing pattern. M6's `parsePlan`, `parseSourceCheck`, `parseHypotheses`, `parseOpenQuestions` mirror the shape: BOM strip, line split, section walk, structural validation, throw `XxxLoadError` with frozen issues.

- **`src/state/run.ts`** — `requireGate`, `approveGate`, cross-file recovery. M6's gate-preflight extension is the load-bearing change here (prompt 9).

- **`src/agents/defaults/ba.md`** — current persona shape. M6's PLAN persona (`src/agents/defaults/lead.md`, currently 43 lines) needs to be expanded substantially with: 3-source verification discipline, repo-context tool usage, hypothesis-emission discipline (the persona names the H-NNN ids it's relying on), and the universal rule sheet (rule 16, but rule sheet ships in M7 — debated in prompt 12 below).

---

## What's locked (not up for debate)

These come from CLAUDE.md, the locked ROADMAP, the merge plan, and M5's closed review trail.

1. **PLAN writes `PLAN.md` and `SOURCE_CHECK.md`** — canonical phase → artifact mapping. Both are plain Markdown. PLAN.md is the primary artifact; SOURCE_CHECK.md is the verification companion (treated as a sidecar of the PLAN gate, not a separate gate).

2. **HYPOTHESES.md and OPEN_QUESTIONS.md are sidecars at the PLAN gate** — rule 15. PLAN persona produces or updates them via the Scientist phase-tail; the gate cannot fire while overdue open questions exist. Substrate lands in M6; per-phase tails for BUILD/VERIFY/REVIEW land in M7.

3. **`tool_use.repo_context` is the only tool category landing in M6** — rule 18 + merge plan decision 3. Network access is denied. Selected paths flow into next-invocation manifest. `repo_context_searched` events are mandatory.

4. **Tool set: `glob`, `grep`, `read` are required; `symbol` is optional in M6** — merge plan decision 3 lock. Deeper LSP integration is W3 territory if M6 cap data justifies.

5. **`budgets.global` is the only namespace** — rule 19 + merge plan decision 5. No `budgets.run`. New fields: `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable`. Wall-time computed from `run_started.ts`.

6. **`claude-code-main` (leaked Anthropic source) is excluded from pattern borrowing** — CLAUDE.md influence library exclusion + merge plan decision 2. Repo-context MVP is clean-room from public `claude-code` docs + `opencode` permissions + `agent-skills`.

7. **Codex round at planning convergence is durable** — CLAUDE.md rules 7–10. This briefing is that round for M6.

8. **3-source verification mandatory before code** — rule 3. PLAN cannot pass without `SOURCE_CHECK.md` naming spec, reference (or explicit none-found rationale), and docs (or explicit no-library rationale).

9. **All artifact contracts plain Markdown** — rule 7. No JSON for inter-phase handoffs.

10. **FakeProvider runs the whole lifecycle offline** — rule 8. M6's e2e test (`tests/e2e/plan-greenfield.test.ts`) exercises the full PLAN flow including repo-context search against a fixture repo.

11. **Wrapper layer is the only path to a provider** — M4 addendum. M6 phase logic calls `invokeAgent` for every persona turn.

12. **Resume is a v0.1 feature** — rule 12. PLAN's gate-preflight + cross-file recovery must handle the post-PLAN-write, pre-gate-fire crash window deterministically.

---

## The twelve prompts

### Prompt 1 — Repo-context cap defaults

**My lean:** `maxResults: 50` (per tool call), `maxBytesPerResult: 64KB`, `maxFilesForNextManifest: 20`, `timeoutMs: 5000`, `network: 'none'` (always).

**Reasoning:** 50 results is enough for a typical Glob/Grep over a 50k-line repo without overwhelming the LLM's context with noise. 64KB/result accommodates a large source file's worth of grep context. 20 files into next manifest matches the typical PLAN-task scope (atomic task, ~5–10 files touched + 5–10 reference files); 50 would inflate `bytesSent` and `tokensEstimate` beyond what the M5 budget defaults can absorb. 5s timeout is conservative for `rg`-backed search on M-class repos; longer means a hung `rg` on a corrupt index can block a turn.

**Counter-argument I am aware of:** 20 files into next manifest may be too tight when M6's 3-source verification needs spec + reference + docs files all in the same invocation. The compromise: per-tool caps as defaults, with the agent permission `maxFilesForNextManifest` overriding upward for known-good personas (PLAN persona explicitly raises to 30). Push back if the global default should be 30; confirm if 20 is right.

### Prompt 2 — M6 commit ordering: substrate-first, persona-last vs. persona-first, substrate-last

**My lean:** Substrate-first. Order:
1. `docs/contracts/{PLAN,SOURCE_CHECK}.md` + `parsePlan`, `parseSourceCheck` + tests (mirrors M5's commit 1)
2. `docs/contracts/{HYPOTHESES,OPEN_QUESTIONS}.md` + parsers + tests
3. `docs/contracts/REPO_CONTEXT.md` + `AgentPermissions.tool_use.repo_context` schema extension + tests
4. New event types in `src/state/schemas.ts` + `validateEvent` per-type (`repo_context_searched`, `science_*`, `hypothesis_*`, `question_*`, `budget_warning`)
5. `src/tools/repo-context/{glob,grep,read}.ts` clean-room implementation + tests
6. `budgets.global` extension in `src/config/schema.ts` + `assertWithinBudget` extension + tests
7. `src/phases/scientist.ts` (phase-tail runner) + atomic write integration
8. Gate-preflight extension in `src/state/run.ts` `requireGate` (validates HYPOTHESES + OPEN_QUESTIONS sidecars)
9. `src/sources/{spec,reference,docs}-source.ts` (3-source verification logic)
10. `src/agents/defaults/lead.md` expanded persona body (PLAN-system-aware)
11. `src/prompts/plan-system.md` (protocol template, Common Rationalizations injection per M5 pattern)
12. `src/phases/plan.ts` orchestrator + `src/commands/run.ts` integration
13. `tests/e2e/plan-greenfield.test.ts` end-to-end with FakeProvider
14. CLI help + docs polish + tag `v0.6.0-alpha.0`

**Reasoning:** Each commit has one logical concern; tests pass at every commit. Substrate before persona means the persona has real tools to call by the time it's wired up. The pattern mirrors M5's "schema → parser → orchestrator → e2e" sequence that closed without rework.

**Counter-argument I am aware of:** Persona-first commits give earlier integration feedback (the PLAN persona's prompt structure surfaces missing capabilities before the substrate is built). Persona-first risks substrate-shape drift mid-milestone; substrate-first risks persona-shape drift but caught later. Confirm if substrate-first is right; push back if persona-first is cheaper given M6's larger commit budget.

### Prompt 3 — DEFINE retro-seed default

**My lean:** Opt-in via `phases.scientist.retroSeedDefine: true`, default `false` in M6. When enabled, generates HYPOTHESES.md / OPEN_QUESTIONS.md from SPEC.md sections; never modifies SPEC.md; never reopens the M5-approved gate.

**Reasoning:** Default-off avoids surprising existing M5-shipped users (anyone who has approved DEFINE in v0.5.0). Opt-in lets the discipline catch up to runs that benefit. The retro-seed is mechanical (one hypothesis per acceptance-criterion bullet, one open-question per `## Open questions` bullet), so the cost of running it is bounded.

**Counter-argument I am aware of:** Default-off means most v0.6 runs ship without DEFINE-phase epistemic state. The phase-tail discipline argument (rule 15) is undermined when DEFINE is the only phase that doesn't carry it. Default-on (auto-seed if HYPOTHESES.md is absent at PLAN start) is consistent with the discipline. Push back if default-on is right.

### Prompt 4 — `repo_context_searched` event budget treatment

**My lean:** Search invocations DO contribute to `budgets.global.maxProviderCalls` (1 per call) but NOT to `tokensEstimate` directly — only the *selected paths* that flow into the next manifest contribute via that next invocation's `agent_invoked.bytesSent` and `tokensEstimate`. Wall-time spent in search counts against `maxWallTimeMinutes`.

**Reasoning:** Search results that the agent does not select should not consume token budget; otherwise verbose search becomes a cost vector. Selected paths are the ones that will be sent to the LLM, and they're already counted by the existing manifest pathway. Provider-call counting is consistent with rule 19's "each LLM-adjacent operation counts."

**Counter-argument I am aware of:** Search results returned to the agent ARE consumed (the agent reads result paths and snippet excerpts) even if not selected for the next manifest. Excluding them from `tokensEstimate` understates the true cost. The alternative: a separate `searchTokensEstimate` cap, or a fold-in via `tokensEstimate` with a `searchToManifestRatio` knob. Push back if the alternative is cleaner.

### Prompt 5 — 3-source verification: what counts as a "source"?

**My lean:**
- **Spec source:** `SPEC.md` (the M5 artifact). Always present in greenfield. Brownfield variant: `AUDIT.md` once W4 lands.
- **Reference source:** A file path in the local repo demonstrating the pattern PLAN proposes to apply (found via repo-context Glob/Grep). When no reference exists in the repo, an explicit `reference_none_found_rationale` field with the agent's reasoning. The reference is a path, not a curated summary, per rule 13.
- **Docs source:** External library documentation, fetched via Context7 MCP for libraries the PLAN proposes to use. When no library is involved, an explicit `docs_no_library_rationale` field. Docs are URL + Context7 query + retrieved-content snapshot, persisted to `.code-oz/state/runs/<runId>/docs/<library>.md` for audit.

**Reasoning:** Each source is a verifiable artifact (file path, fetched URL, local repo grep result), not a vibe. The "explicit-none-found rationale" pattern preserves rule 1 (file-based, machine-checkable) when a source is genuinely absent.

**Counter-argument I am aware of:** Context7 MCP fetches are network-dependent and may fail offline. M6's e2e test runs offline (rule 8); the docs-source must work in offline mode. The compromise: docs-source can also be a local file at `.code-oz/cache/docs/<library>.md` if Context7 is unreachable, with the cache populated from a prior online run. Confirm if this hybrid is right; push back if docs-source must always be live or always be cached.

### Prompt 6 — PLAN.md atomic-task contract

**My lean:** PLAN.md uses 6 H2 sections (mirroring SPEC.md structure for tooling consistency):
- `## Goals` — restate the SPEC.md goals (the agent's restatement; semantic mismatch with SPEC.md is a hard fail of `requirement-restate` skill)
- `## Tasks` — atomic-task list. Each task is one bullet `### Task N: <one-line>` followed by sub-bullets: `Files: <list>`, `Validation: <command>`, `Risk: <one-line>`, `Hypotheses: <H-id list>`.
- `## Sources` — references to `SOURCE_CHECK.md` sections by name (not duplicated content)
- `## Risks` — non-task-specific cross-cutting risks
- `## Out of scope` — tasks deliberately deferred to later phases or milestones
- `## Open questions` — questions PLAN cannot resolve before BUILD; carried forward to `OPEN_QUESTIONS.md`

**Reasoning:** The 6-section structure matches SPEC.md's pattern. Atomic-task discipline (Files/Validation/Risk/Hypotheses) catches family 15 (scope creep) and family 8 (verification gap) at PLAN time. Hypotheses citation makes rule 15 enforceable.

**Counter-argument I am aware of:** "Risk" appearing both per-task and cross-cutting may confuse the persona. The compromise: drop the cross-cutting `## Risks` section, fold cross-cutting risks into `## Open questions` as questions. Push back if the dual-Risk pattern is wrong.

### Prompt 7 — SOURCE_CHECK.md schema

**My lean:** SOURCE_CHECK.md uses 3 H2 sections, one per source kind:
- `## Spec source` — points to SPEC.md sha256 + section names referenced
- `## Reference source` — list of `(repo_path, brief reason)` pairs OR `- None found: <explicit rationale>` bullet
- `## Docs source` — list of `(library, version, url, fetched_at, cache_path)` quads OR `- No library: <explicit rationale>` bullet

**Reasoning:** Plain Markdown, validates against the same parser pattern as SPEC.md. The "explicit rationale" requirement enforces rule 3 — PLAN cannot pass with handwave rationales.

**Counter-argument I am aware of:** Per-task source attribution (Task N cites Reference X) might be more useful than aggregate. The aggregate keeps SOURCE_CHECK.md compact; per-task attribution moves into PLAN.md's Hypotheses field via H-ids. Confirm if aggregate is right; push back if per-task attribution is cleaner.

### Prompt 8 — Hypothesis ID lifecycle (M6 substrate)

**My lean:** H-ids are run-scoped, not phase-scoped. `H-001`, `H-002`, ... allocated in order across the run; ids never reused. Falsified hypotheses move to a `## Falsified hypotheses` section but keep their id. Retired hypotheses (the goal they supported was dropped) move to `## Retired hypotheses` and keep their id. New ids are always max(existing) + 1, regardless of which section any prior id sits in.

**Reasoning:** Run-scoped ids let primary artifacts cite a stable id across phases. Phase-scoped ids would force reissuing on every phase, breaking citation. Never-reuse preserves audit trail.

**Counter-argument I am aware of:** Cross-run id stability would be more useful (the same hypothesis "the spreadsheet has a header row" gets the same id across runs of the same project). That requires a project-scoped id allocator, which is W2 territory (cross-run memory). M6 ships run-scoped; W2 adds cross-run mapping. Confirm if run-scoped is right for M6.

### Prompt 9 — Gate-preflight integration with `requireGate`

**My lean:** Extend `requireGate(plan, ...)` in `src/state/run.ts` to:
1. Read `HYPOTHESES.md` and `OPEN_QUESTIONS.md` from `<artifactRoot>` BEFORE writing `gate_required`.
2. If either file is missing OR fails parse, write `NEEDS_INTERVENTION.json` with `code: 'scientist_sidecar_missing'` and append intervention event; do NOT write gate_required.
3. If any open question has `Latest phase: PLAN` (for PLAN gate; phase-specific check), write `NEEDS_INTERVENTION.json` with `code: 'open_questions_overdue'` and the question ids; do NOT write gate_required.
4. Otherwise, write gate_required as today.

**Reasoning:** The gate-preflight is a single function called once per phase; centralizing the check in `requireGate` avoids per-phase duplication. The two failure modes write distinct intervention codes for actionable suggestions.

**Counter-argument I am aware of:** `requireGate` becoming Scientist-aware couples state machinery to a discipline that lands in M6 but evolves in W2. The alternative: `requireGate` stays unaware; a new `validateScientistSidecars(phase, paths)` is called before `requireGate` from `src/phases/scientist.ts`. Coupling is looser; calling sites multiply (PLAN tail in M6, four more phase tails in M7). Push back if the loose-coupling alternative is right.

### Prompt 10 — Repo-context Glob/Grep/Read implementation backbone

**My lean:** Use `rg` (ripgrep) as the Glob+Grep backbone via subprocess (`Bun.spawn`). Read uses `Bun.file().text()` with byte-cap enforcement. No node-glob, no minimatch — `rg`'s glob support covers the use cases. The `rg` binary is a hard dependency declared in `package.json` engines + `code-oz doctor` checks for it.

**Reasoning:** `rg` is the canonical backbone for Glob+Grep across `claude-code`, `opencode`, `gptme`. Subprocess invocation isolates the search process (independent timeout, no FFI surface). Bun.spawn matches the project's runtime.

**Counter-argument I am aware of:** Subprocess adds dependency on `rg` being installed; users without it get a `code-oz doctor` failure but no auto-fallback. The alternative: a JS fallback via `node-glob` + `find`. The fallback would be ~3x slower on large repos. Confirm if `rg`-only with doctor check is acceptable; push back if a fallback is required for M6 (vs. W3 polish).

### Prompt 11 — Persona prompt for PLAN: how does it know the available repo-context tools?

**My lean:** The persona prompt template (`src/prompts/plan-system.md`) includes a `## Available tools` section auto-generated at compose time from `agent.permissions.tool_use.repo_context.tools`. The persona body in `src/agents/defaults/lead.md` references "the repo-context tools listed below" without naming them; the orchestrator fills in the list per the agent's permission scope.

**Reasoning:** Auto-generation prevents persona-permission drift (persona says "I have grep" but permissions don't grant it; or vice versa). Lets test fixtures override the tool set without touching the persona body.

**Counter-argument I am aware of:** Auto-generation makes the persona's behavior less inspectable from the persona file alone. The alternative: persona body explicitly lists tools, with a startup check that persona ⊆ permissions. The check fails fast on drift. Push back if the explicit-list approach is right.

### Prompt 12 — Universal rule sheet: ship in M6 (with PLAN persona) or M7 (with all personas)?

**My lean:** Ship in M7 alongside BUILD/VERIFY/REVIEW personas, per the merge plan. M6's PLAN persona inherits the universal rule sheet retroactively when M7 lands; M5's BA persona similarly. This avoids one M6 commit on cross-cutting persona changes that affect all personas.

**Reasoning:** The merge plan's M7 scope already includes "Universal rule sheet shipped at `src/prompts/universal-rules.md`." Splitting it across M6 and M7 doubles the surface area; landing in M7 is cleaner. M6's PLAN persona ships with M5-shape Common Rationalizations injection only.

**Counter-argument I am aware of:** PLAN persona is the first new persona since M5; not having universal rules from day one means M6 ships a persona that immediately needs an M7 retrofit. The cost of shipping the rule sheet in M6 is ~1 commit (`src/prompts/universal-rules.md` + `composeDefinePrompt` + `composePlanPrompt` updates). Push back if M6 should land it.

---

## What I want from you

**Verdict** at the top — `proceed`, `proceed-with-modifications`, or `debate-required`. Then mirror the M5 response format:

- **Where I agree** — sanity-check, don't rubber-stamp. If a lean is right but for a reason I missed, flag the better reason.
- **Where I disagree (with specific alternative)** — push back hard where I am wrong. Name the alternative concretely (file path, schema shape, commit-sequence change).
- **Decisions you must lock before code** — what the user must answer before M6 implementation starts. Numbered.

If you flag any of the cap defaults (prompt 1) as wrong, give me the right defaults and the reasoning (e.g., M6 fixture-set characteristics that argue for tighter or looser).

If you flag commit ordering (prompt 2) as wrong, propose an alternative sequence with one paragraph on why it lowers risk.

If you flag the budget treatment of `repo_context_searched` (prompt 4) as wrong, name the cleaner accounting.

If you flag any artifact contract (prompts 6, 7, 8) as wrong-shaped, give me the right shape with a concrete sketch.

If you flag the gate-preflight coupling (prompt 9) as wrong, draw the loose-coupling alternative with one paragraph on the call-site multiplication cost.

Cite file paths and lines where they matter. Keep verdict-relevant claims to one paragraph each. If you flag something `debate-required`, name what evidence would resolve it.

Begin.
