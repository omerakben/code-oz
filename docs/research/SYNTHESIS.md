# Research synthesis — proposed deltas to CLAUDE.md, the milestone plan, and the next Codex round

**Authored:** 2026-04-30, on `docs/research-synthesis`
**Bundle commit:** `a3eea10` (the 7+1 dossiers under `docs/research/`)
**Current state reconciled against:** M5 has shipped (v0.5.0-alpha.0 tagged on main, 542 tests passing). The bundle was authored when M5 was still in flight on `feat/m5-define`; the bundle's "M5 commit 1 staged" framing in 00-README is now historical.

This file is the first of three synthesis commits. It collects: proposed durable CLAUDE.md additions, milestone scope changes, decisions the user must make, and the prompts the Codex round (commit 2) will debate. CLAUDE.md, ROADMAP.md, and milestone kickoff docs are NOT modified by this commit — those lands follow the merge plan in commit 3.

---

## Proposed CLAUDE.md additions

CLAUDE.md currently has 14 numbered non-negotiable rules. The bundle suggests up to nine candidates; this synthesis recommends five for durable rule status. The other four are either already covered structurally (e.g., the wrapper layer enforces budget caps without needing a new rule) or belong in milestone docs / persona prompts rather than universal rules.

CLAUDE.md is for universally applicable rules. Per HumanLayer's CLAUDE.md analysis (cited in dossier 02), frontier thinking models follow ~150–200 instructions reliably; smaller models decay exponentially. The 14-rule bar is already conservative; five additions takes it to 19. Anything more goes in milestone docs.

### Rule 15 — Epistemic state is a first-class artifact

> Every phase that produces a primary artifact (SPEC, AUDIT, PLAN, BUILD_REPORT, VERIFY, REVIEW) also produces or updates `HYPOTHESES.md` and `OPEN_QUESTIONS.md`. The phase gate cannot fire while an open question carries a `Latest phase: <this phase>` deadline. Hypotheses without falsifiers and questions without resolution criteria are rejected by the maestro before the gate is consulted.

**Source:** dossier 05 (scientist-and-open-questions-agent.md), reinforced by dossier 02 families 14 (assumption propagation) and 17 (overconfidence).

**Why durable, not milestone-local:** The discipline applies to every phase, not one. Adding it to a single milestone doc means each future phase author has to re-discover it. Adding it to CLAUDE.md means the maestro and every persona inherit it from the rule book.

**Why not deferred:** Without this, the SPEC.md `## Open questions` section is a single-phase proxy — questions don't survive into PLAN, and PLAN's load-bearing premises don't get re-verified at BUILD. That's the exact assumption-propagation pathway the failure-research dossier flags as one of the highest-impact families.

### Rule 16 — Universal anti-slop rules ship inside every persona prompt

> Every persona's system prompt imports the universal rule sheet from `src/prompts/universal-rules.md`. The rule sheet is the 20-item list (10 prohibitions + 10 affirmations) defined in `docs/research/02-llm-failure-research.md`. Personas may add their own rules below; they may not relax the universal ones.

**Source:** dossier 02 §"The rule sheet (embeddable)".

**Why durable:** Today the Common Rationalizations table is DEFINE-only and 8 rows. The 20-item universal rule sheet covers the cross-cutting failure families (verbosity, defensive over-coding, sycophancy, scope creep, excess generation, overconfidence) that recur in every phase. Putting it in CLAUDE.md ensures every future persona inherits it from the start; not putting it there means M6/M7 personas miss the discipline by accident.

**Why not deferred:** The discipline is shippable now as a one-file addition + a prompt-compose change, no new abstractions required. Holding it for a milestone of its own is over-engineering.

### Rule 17 — The maestro discipline is named and authoritative

> The maestro discipline (rule-checker role + 9-family bug map + adversarial-review skills + four-layer file-system memory) is documented in `docs/research/01-maestro-rule-checker.md`. Personas reference it; the orchestrator implements its skills; the bundle dossier is the spec. Updates to the discipline land as commits on the dossier with a top-of-file "## Update <date>" annotation.

**Source:** dossier 01 directly; cross-referenced by 02, 03, 05, 06.

**Why durable:** The dossier is what every other dossier depends on. Without naming it as authoritative, the discipline has no anchor. The alternative — duplicate the discipline into CLAUDE.md — would either be too short to be useful or too long to fit CLAUDE.md's "keep universal rules under 200 instructions" budget.

**Why not deferred:** Authority is what makes the dossier useful for new sessions. Without rule 17, future Claude sessions have no signal that dossier 01 is durable vs. exploratory.

### Rule 18 — Codebase context retrieval has its own permission scope

> Agentic codebase search (Glob, Grep, LSP-style symbol lookup) is a separate `tool_use` capability with its own permission scope, declared in agent frontmatter as `permissions.tool_use`. Search results land in the *next* invocation's manifest, not the search invocation's. The maestro's skill `repo-search-before-write` is the consumer; the search backend is the new piece. Search invocations log their queries to `events.jsonl` for audit.

**Source:** dossier 04 item 1 (codebase context retrieval), dossier 06 (claude-code template), reconciles with rule 13 (privacy by default, explicit file manifests).

**Why durable:** This is the structural answer to the apparent conflict between "manifests are upper bounds" (rule 13) and "the agent needs to read files it didn't pre-declare" (M6's three-source verification). Without the rule, every milestone re-litigates the conflict.

**Why not deferred:** M6 cannot ship three-source verification without it. Either the rule lands now as part of the spine, or M6 ships without verification (defeating its purpose).

### Rule 19 — Run-level budget enforcement is mandatory, not advisory

> Per-phase budgets (rule 10) are insufficient for non-expert protection. The wrapper layer's `assertWithinBudget` extends to read cumulative spend across all events in the run; the run-level budget is configured in `.code-oz/config.yaml` under `budgets.run` (maxTurnsCumulative, maxProviderCallsCumulative, maxTokensEstimateCumulative, maxWallTimeMinutes). Soft warnings fire at 75% of cap; hard kills at 100%. Spend telemetry includes a real-dollar estimate based on the provider registry's price table.

**Source:** dossier 04 item 6, motivated by family 16 (excess generation), reinforced by the user's "friends will not tolerate surprise bills" framing.

**Why durable:** The trust gate for non-experts is "can I run this without it costing me $200?" Per-phase caps protect against per-phase runaways but don't sum across phases. A single rule pinning run-level enforcement saves every future milestone from forgetting it.

**Why not deferred:** The hooks belong in the wrapper layer, which already exists. The data the rule reads is already in `events.jsonl`. Cost is one config-schema extension and one summarizer function; benefit is a step-function increase in trust posture.

### Rules considered but NOT promoted to CLAUDE.md

These are real disciplines that belong in milestone docs or persona prompts, not as universal rules.

- **DEFINE-0 / Prompter as default-on.** This is a W2 milestone decision (dossier 03), not a universal discipline. The Prompter is one of several W2 features; promoting it to a CLAUDE.md rule prematurely locks the W2 design before the M7 mini-experiment runs.

- **Mutation-test as a verification gate.** This is a VERIFY-phase discipline (dossier 02 family 8). Belongs in M7's `docs/contracts/VERIFY.md`, not CLAUDE.md. The universal rule "tests must fail when production code is reverted" is implied by the existing rule 1 (file-based gate signals + schema validation) when VERIFY's contract pins it.

- **Cross-family review of INTENT.md / HYPOTHESES.md.** This extends rule 2 (cross-family review at REVIEW gate). Adding a separate rule for each new artifact is rule-sheet inflation; the existing rule 2 already covers "cross-family review of any artifact at any gate" with a milestone-doc spec for *which* artifacts at *which* gates.

- **Skill outcomes JSONL log.** This is a memory-architecture detail, covered by rule 17's pointer to dossier 01. Not durable enough on its own.

---

## Proposed milestone scope changes

The bundle's recommendations cluster into spine-completion (must ship before M7), non-expert workflow (W2), production extension (W3+), and always-on (cross-cutting). This synthesis maps each cluster to existing milestones rather than inventing new ones.

### M6 — Plan phase + 3-source verification (existing scope)

**Existing scope from ROADMAP.md:** PLAN persona; 3-source verification; outputs PLAN.md and SOURCE_CHECK.md; gate before BUILD-lite.

**Proposed additions (one-line each, with source):**

- **Codebase context retrieval as a `tool_use` capability.** Glob + Grep + targeted file reads + LSP symbol lookup (where available), borrowed from the `claude-code-main` template. Required for SOURCE_CHECK.md to find reference implementations in the local repo. **Source:** dossier 04 item 1 + dossier 06 templates section.

- **Run-level budget enforcement in `assertWithinBudget`.** Extension of the existing wrapper to read cumulative spend across phases. New config keys: `budgets.run.maxTurnsCumulative`, `maxProviderCallsCumulative`, `maxTokensEstimateCumulative`, `maxWallTimeMinutes`. **Source:** dossier 04 item 6.

- **Tool-use permission schema extension.** `AgentPermissions` gains a `tool_use` field declaring allowed tools, allowed network destinations (or `none`), file roots, env-var allowlist, timeout, secret access. Required before BUILD-lite (M7) lands or the codebase-context retrieval has implicit unbounded scope. **Source:** rule 9 + dossier 04 + Q4 from the in-chat analysis.

- **Phase-tail Scientist for PLAN.** PLAN's primary artifact (PLAN.md + SOURCE_CHECK.md) is followed by a Scientist phase-tail that produces or updates HYPOTHESES.md and OPEN_QUESTIONS.md. The phase-tail runs after the artifact is written but before the gate fires. Adds two new event types (`science_started`, `science_completed`) and one new gate dependency. **Source:** dossier 05.

### M7 — BUILD-lite + VERIFY-lite + REVIEW-lite (existing scope)

**Existing scope:** Builder runs one atomic task in a worktree; Verifier runs configured commands; Reviewer cross-family review with `requestReview`; outputs BUILD_REPORT.md, VERIFY.md, REVIEW.md.

**Proposed additions:**

- **Iterative BUILD loop (write → run → see-error → patch → self-verify-before-commit).** Voyager-pattern. Builder runs the test-runner abstraction, captures error output, attempts a bounded number of patch rounds before declaring success or routing to NEEDS_INTERVENTION. Capped at maxBuildPatchRounds in config. Self-verification gate before BUILD_REPORT.md is committed: revert-and-replay, smoke test, mutation-test sample. **Source:** dossier 02 family 6 (cognitive deadlock recovery), dossier 04 item 2.

- **Mutation-test gate in VERIFY-lite.** For new tests, revert the production change and run the new tests; tests that pass on reverted code are tautological and rejected. Required for any test marked as "asserts a new behavior"; advisory for legacy/baseline tests. **Source:** dossier 02 family 8, dossier 01 skill `mutation-test`.

- **Phase-tail Scientist for BUILD, VERIFY, REVIEW.** Same shape as PLAN's. By M7's close, every shipping phase has Scientist wired in.

- **DEFINE-0 / Prompter mini-experiment.** Replay the M5 canned transcripts with a hand-written INTENT.md as input to the BA. Measure: ask-me round count delta; SPEC quality delta (subjective, against a hand-graded gold standard). Result feeds the W2 Prompter decision (Q24 below). Lives in `docs/research/M7_PROMPTER_EXPERIMENT.md`. **Source:** dossier 03 acceptance section.

- **Universal rule sheet (rule 16) shipped.** New file `src/prompts/universal-rules.md` with the 20-item ban/require list. Prompt-compose updated to inject it into every persona prompt. **Source:** dossier 02.

### W2 — Non-expert workflow (existing post-MVP slot)

**Existing scope from ROADMAP.md:** "Real Claude integration polish, non-technical UX hardening (canned transcripts → expected SPEC snapshots), Common Rationalizations table integrated into all phase prompts."

**Proposed reshaped scope:** W2 becomes the coordinated non-expert workflow milestone, bundling four work streams.

- **W2.1 — DEFINE-0 / Prompter front door** (gated on the M7 mini-experiment). Tier-1 only (cheap meta-prompt). Default-off via `--prompter` opt-in for v0.1; default-on after exemplars mature. INTENT.md as separate artifact, sampled cross-family review at 20%, two-tier optimizer scaffolding (tier-2 deferred to W3). **Source:** dossier 03.

- **W2.2 — TUI inspector + failure-recovery UX.** TUI built on ink/charmbracelet (CLI-first philosophy). Diff viewer, hunk-level accept/reject, "what did the agent do and why" reads `events.jsonl`. `code-oz resume-after-intervention` command. **Source:** dossier 04 items 5 + 10.

- **W2.3 — Onboarding + tour mode.** Example project (TUEL-AI-blueprint-shaped seed). `code-oz tour` walks through one DEFINE→SHIP cycle on a toy repo. 5–10 hand-written exemplars in the Prompter library for cold-start. **Source:** dossier 04 item 9.

- **W2.4 — `code-oz reflect` designer job.** On-demand reflection over the last N runs; promotes successful (raw-request, INTENT) pairs into the exemplar library; demotes failed ones. Skill outcomes JSONL log lands here as the substrate. **Source:** dossier 03 + dossier 01.

### W3 — Production extension (existing scope expanded)

**Existing scope:** Codex/Gemini provider integration; cross-family REVIEW with real providers; installer.

**Proposed additions:**

- **Multi-language LanguagePack abstraction.** Bundled packs: TypeScript/Node, Python. C# pack scoped now if OneStream-internal use is realistic v1. **Source:** dossier 04 item 3.

- **Real-world `IIntegration` interface (events-log-as-substrate).** Implementations for GitHub (read issues into INTENT.md, open PRs at SHIP, status checks), Slack (NEEDS_INTERVENTION notifications), Linear/Jira (ticket round-trip). **Source:** dossier 04 item 7.

- **Tier-2 DSPy MIPRO compile for Prompter** (opt-in via `code-oz run --deep`). **Source:** dossier 03.

- **Concurrent runs + multi-active-run pointer.** Worktree-per-run isolation at depth (Archon pattern). Single-active-run pointer schema change is small; UX implications cascade. **Source:** dossier 04.

### W4 — AUDIT depth + privacy hardening

**Existing scope:** Brownfield AUDIT phase fully implemented; `.code-ozignore`; secret redaction.

**Proposed additions:**

- **AUDIT.md schema with full sections.** Architecture map, convention sniffer, dependency graph, hot-files report, test coverage map, doc extraction. The schema lands in M6 alongside SPEC.md schema (sections marked TBD); the implementation lands in W4. **Source:** dossier 04 item 4.

- **Containerized BUILD execution.** Devcontainer or firecracker microVM. Required if real-world integrations (W3) move agents toward writing code that touches user data. **Source:** dossier 04 not-in-top-10 list.

### Cross-cutting (always-on)

- **Memory architecture (`.codeoz/lessons/`, `.codeoz/skills/<name>/outcomes.jsonl`, `.codeoz/rules/`, `.codeoz/adr/`).** File-system based per dossier 01. Hooks land in M6/M7 alongside Scientist; designer (`code-oz reflect`) lands in W2. **Source:** dossier 01.

- **Telemetry feedback (`RunOutcome` events).** Git history reader (merged vs. reverted vs. amended), CI-status webhook (post-merge test pass/fail), post-merge metrics ingestion. Hooks land in M7 alongside the build loop; full integration is W2/W3. **Source:** dossier 04 item 8.

### Proposal: do NOT add a separate M-Scientist milestone

**Bundle dossier 04 + 05 propose** a "M-Scientist" milestone between M6 and M7 to land the Scientist meta-agent.

**This synthesis recommends against** that and instead:

- The HYPOTHESES.md / OPEN_QUESTIONS.md artifact contracts land in M6 commits alongside PLAN's primary artifact (one or two commits in M6's existing 10-commit budget).
- The phase-tail wiring lands per-phase in M6 (PLAN tail) and M7 (BUILD/VERIFY/REVIEW tails).
- This avoids a separate milestone slip in the spine completion path; Option E's whole point was to ship spine end-to-end.

The trade-off: Scientist's commits compete with M6's existing 10-commit budget. M6 may grow to 12 commits. That's cheaper than a separate milestone with its own planning round, Codex briefing, and tag.

---

## Decisions the user must make

These are decisions the synthesis cannot resolve alone. Each has a lean recommendation, the alternative, and the reason it cannot be auto-resolved.

### Decision 1 — Borrow patterns from `claude-code-main` (leaked Anthropic source) at all?

**Lean:** Yes, but credited with explicit "leaked-source" annotation in the templates table. Pattern-borrowing rules in CLAUDE.md (no copy-paste, no code dependencies, audit and credit) apply unchanged.

**Alternative:** Skip the template entirely on legal/ethical posture; design Glob+Grep+LSP fresh from scratch.

**Why not auto-resolved:** This is a values + risk call, not a technical one. The leak was public and the source has been on disk for inspection since 2026-04, but pattern-borrowing from a leak has provenance implications the user owns.

### Decision 2 — Adopt rule 15 (Scientist) before W2, or wait for W3?

**Lean:** Adopt before M6 starts. The Scientist phase-tail is a small commit in M6, and assumption-propagation (family 14) is one of the highest-impact failure families.

**Alternative:** Defer; ship M6 and M7 spine without Scientist; add as W2 part of non-expert workflow (Scientist's HYPOTHESES.md is also useful for friends-as-auditors).

**Why not auto-resolved:** The Scientist's value compounds over phases — early adoption protects M6/M7 quality; late adoption protects W2 friend-onboarding. Both are real; the user's call is which matters more given current cost-of-rework.

### Decision 3 — DEFINE-0 / Prompter at all?

**Lean:** Run the M7 mini-experiment first. Decide based on data: if the BA's ask-me converges in fewer rounds with hand-written INTENT.md, ship Prompter in W2; if not, the design is over-engineered and the friends' onboarding problem is solved differently (better BA persona, better hand-written exemplars in BA body).

**Alternative:** Adopt Prompter as W2 scope unconditionally; the dossier's research base (Promptomatix, PromptTailor, MemSkill) is mature enough to justify the design without a project-local experiment.

**Why not auto-resolved:** The Prompter's worth depends on whether real users in the BA's ask-me converge or get stuck. The mini-experiment is cheap (one Friday afternoon); not running it is a category error.

### Decision 4 — Push the project to GitHub now (`omerakben/code-oz`) or wait for v1.0?

**Lean:** Push after M7 closes the spine. v0.5.0-alpha.0 has a working DEFINE phase but no spine demo; M7's `code-oz run --provider fake --fixture greenfield-web` is the demo-able artifact for the 1000-star ambition.

**Alternative:** Push now; build-in-public is a recruiting + community signal that compounds before v1.0.

**Why not auto-resolved:** Public-vs-local is a strategy call. The lean is conservative; the alternative is the ambition path. Memory says the user's bar is "1000+ GitHub stars, beat raw coding agents via Claude+Codex orchestration; cross-family review is the visible product." If cross-family review is the visible product, building in public starting at M5 is a feature, not a bug.

### Decision 5 — Memory architecture — file-system (maestro) or knowledge graph (Mimir)?

**Lean:** File-system for v0.1 + W2. Auditability and grep-ability beat graph traversal at this scale. Revisit if W3 surfaces graph-traversal use cases that file-system memory cannot serve.

**Alternative:** Knowledge graph (Neo4j + NornicDB) from the start, per Mimir template. Adds an external dependency and an MCP server but unlocks cross-run reasoning patterns earlier.

**Why not auto-resolved:** The trade-off is auditability + simplicity (file-system) vs. expressive cross-run queries (graph). Either is defensible; the user picks based on whether the friends-as-users target benefits more from one or the other.

---

## Open questions for the next Codex round

These are the prompts the Codex round (commit 2) will debate. Format mirrors the M5 briefing: lean + reasoning + counter-argument the synthesis is aware of.

### Prompt 1 — Should rule 15 (Scientist as universal discipline) actually be a CLAUDE.md rule, or should it stay in dossier 01/05 as the maestro discipline that personas adopt by reference?

**Lean:** Add as rule 15. The discipline applies across every phase, not one; without a universal rule, each future phase author re-discovers it.

**Reasoning:** The 17-family failure research (dossier 02) shows assumption propagation (family 14) and overconfidence (family 17) account for a large share of agentic failures that survive structural defenses. The Scientist is the structural fix. Putting it in CLAUDE.md makes it inheritable; putting it in a referenced dossier makes it discoverable but not enforced.

**Counter-argument the synthesis is aware of:** CLAUDE.md is for universally applicable rules at the orchestration layer; the Scientist is closer to a phase-tail discipline that belongs in `docs/contracts/SCIENTIST.md`. Adopting it as a CLAUDE.md rule conflates layers: the orchestrator runs phases, the phase-tail is part of phase execution, the rule lives at the wrong altitude.

### Prompt 2 — Should the codebase context retrieval (Glob + Grep + LSP) borrow patterns from `claude-code-main` (leaked source), or is the legal/provenance posture too risky?

**Lean:** Borrow patterns with explicit "leaked-source" annotation. The leak was public; the source has been on disk since 2026-04. Pattern-borrowing rules apply unchanged. Crediting it accurately preserves auditability.

**Reasoning:** The alternative — designing Glob+Grep+LSP fresh — costs M6 weeks of work for capabilities Anthropic has already designed and debugged. The dossier's provenance discipline says "name the source"; naming it as leaked is the auditable move.

**Counter-argument the synthesis is aware of:** Borrowing from a leak (even publicly available) signals a posture the user may not want associated with code-oz. The 1000-star ambition path may be hurt more by the provenance question than it is helped by the time saved. A clean-room design from public Anthropic docs (skills, hooks, MCP) plus the agent-skills + opencode templates is the conservative alternative.

### Prompt 3 — Phase-tail Scientist (commits inside M6/M7) vs. dedicated M-Scientist milestone — which best preserves Option E (spine-first end-to-end)?

**Lean:** Phase-tail, inside M6/M7. Adding M-Scientist between M6 and M7 inserts an extra planning round, Codex briefing, and tag, which delays the spine demo at v0.7.0-alpha.0+. The phase-tail approach grows M6 from 10 commits to ~12 and M7 from existing scope to ~12, but keeps the spine on the Option E path.

**Reasoning:** Option E's whole motivation was "ship spine end-to-end with FakeProvider before adding more phases." The Scientist is a phase tail, not a phase; treating it as a phase deserves a separate milestone, but the bundle's design treats it as the discipline-after-each-phase, which is closer to a hook than to a milestone.

**Counter-argument the synthesis is aware of:** Phase-tail scope bleed risks under-shipping the Scientist. If M6 is already 10 commits and Scientist adds 2 more, pressure to skip or stub the Scientist's harder bits (gate-blocking on overdue questions, retroactive falsification of prior hypotheses) is real. A dedicated M-Scientist forces the discipline to land complete.

### Prompt 4 — Run-level budget at the wrapper layer — read cumulative spend from `events.jsonl` per-call (cheap, simple) or maintain a running counter in `current.json` (faster, more state)?

**Lean:** Read cumulative spend from `events.jsonl` per-call. The wrapper's pre-call short-lock already reads events; summing four counters across that read is constant overhead. No new state file means no new sync semantics to debug.

**Reasoning:** `current.json` is already a derived convenience state; adding a budget summary to it is consistent. But every counter is one more thing to keep in sync, and the wrapper layer's discipline is "events.jsonl is the truth, current.json is the cache." Keeping the budget computation on the truth side preserves the discipline.

**Counter-argument the synthesis is aware of:** As runs grow long (50+ provider calls, large conversation transcripts in events.jsonl), the per-call read cost grows linearly. At what scale does that matter? Probably W3+ when concurrent runs land. Pre-emptively maintaining a running counter avoids a future migration.

---

## Constraints honored by this synthesis

- Does not modify CLAUDE.md, `docs/design/ROADMAP.md`, or any `SESSION_M*_KICKOFF.md`. Recommendations only.
- Does not modify M5 scope (M5 is closed; v0.5.0-alpha.0 tagged).
- Does not push to origin.
- Does not amend or rebase prior commits.
- Stays inside `docs/research/`.
- ≤600 lines (current: under 600).

The Codex round (commit 2) debates the four prompts above. The merge plan (commit 3) folds Codex's verdict into a final-form recommendation that the user reads to make the actual calls.

---

## Recommended next session after the merge plan

If the merge plan endorses rules 15–19 with `proceed` or `proceed-with-modifications`, the recommended next session is:

**Write `CODEX_BRIEFING_M6.md` with the Bucket B items baked in.** That is: M6's existing PLAN-phase scope plus codebase context retrieval, run-level budget, tool-use permission schema, and phase-tail Scientist. The briefing's prompts debate trade-offs at the M6 implementation layer (e.g., LSP integration depth, mutation-test scope, exemplar library cold-start). The synthesis's Codex round in commit 2 is at the meta-layer; the M6 round is at the implementation layer.

If the merge plan flags `debate-required` on any rule, the recommended next session is a follow-up Codex round on the debated items before M6 starts.

End of synthesis.
