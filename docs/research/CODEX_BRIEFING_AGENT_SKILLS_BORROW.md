# Codex briefing — borrowing patterns from agent-skills

**Date:** 2026-04-30
**Status:** thesis (no implementation in this session)
**Caller:** Claude Opus 4.7 + Ozzy
**Target:** Codex `gpt-5.5` xhigh, sandbox read-only
**Cycle:** session-cycle "plan" phase, before any M9 / M10 code

## What you are reading

A pattern-borrow audit. `code-oz` is at `v0.8.0-alpha.0` with M9 (REVIEW-lite) and M10 (Debate runtime) remaining. The user has flagged an external influence — Addy Osmani's `agent-skills` pack at `~/Projects/agents/templates/agent-skills` — as a source of senior-engineering workflow patterns we should consider borrowing into `code-oz`. This briefing audits the pack and proposes a staged borrow plan that does not violate locked rules.

We are not asking you to debate the entire borrow. We are asking you to push back on five concrete proposals and flag what we are missing.

`agent-skills` ships 20 skills (DEFINE → SHIP), 3 personas (code-reviewer / security-auditor / test-engineer), 7 slash commands, 4 reference checklists, and an orchestration-patterns catalog. It is already in our influence library (`CLAUDE.md` "Influence library" row). Patterns are borrowed, not code; no submodules, no copy-paste.

## Where we stand

### What `code-oz` already has that overlaps with `agent-skills`

| `code-oz` surface                                                                   | `agent-skills` analog                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP taxonomy (`CLAUDE.md`, `ROADMAP.md`) | `using-agent-skills` SKILL.md lifecycle and skill-discovery flowchart                      |
| `src/prompts/universal-rules.md` (20 rules: 10 prohibitions + 10 affirmations)      | `using-agent-skills` "Core Operating Behaviors" (6 items)                                  |
| `src/prompts/common-rationalizations.md` (8 entries, single shared table)           | Per-skill "Common Rationalizations" tables in every SKILL.md                               |
| `docs/contracts/SOURCE_CHECK.md` + rule 3 (3-source verification)                   | `source-driven-development` skill (DETECT → FETCH → IMPLEMENT → CITE)                      |
| `docs/contracts/REVIEW.md` Findings + severity (`block`/`fix-first`/`nit`/`fyi`)    | `code-review-and-quality` Five-Axis review + `code-reviewer` persona                       |
| `docs/contracts/DEBATE.md` (process contract, M10 runtime)                          | No analog — debate is `code-oz`-specific                                                   |
| `docs/contracts/SCIENTIST.md` (HYPOTHESES/OPEN_QUESTIONS sidecars + phase-tail)     | No analog — Scientist is `code-oz`-specific                                                |
| `docs/contracts/REPO_CONTEXT.md` (`tool_use.repo_context` permission scope)         | No analog — agent-skills relies on harness-native context tools                            |
| `docs/contracts/WORKTREE.md` + `tool_use.write` (M7 BUILD isolation)                | No analog — agent-skills assumes the host harness manages files                            |
| Phase-orchestrator + CLI subcommands (`code-oz init`, `run`, `approve`)             | Slash commands (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship`) |

### What `agent-skills` has that `code-oz` does not

1. **Skills as a first-class abstraction.** Workflow chunks live in their own files (`skills/<name>/SKILL.md`) with frontmatter (`name`, `description`), Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification. Skills are loaded on demand by description, not by phase.
2. **Three-layer composition rule.** Skills (the *how*) + Personas (the *who*) + Slash commands (the *when*). Personas do not invoke other personas; the user or a slash command orchestrates. This is enforced by Claude Code's platform constraint (subagents cannot spawn subagents) and by the project's own prose.
3. **Orchestration patterns catalog.** `references/orchestration-patterns.md` enumerates five endorsed patterns (direct invocation, single-persona slash command, parallel fan-out with merge, sequential pipeline as user-driven slash commands, research isolation) and four anti-patterns (router persona, persona-calls-persona, sequential orchestrator that paraphrases, deep persona trees). Includes Claude Code subagent vs. Agent Teams mapping.
4. **Per-skill "Common Rationalizations" tables.** Every skill has its own anti-rationalization table specific to that workflow (e.g., the planning skill rebuts "I'll figure it out as I go"; the review skill rebuts "It works, that's good enough").
5. **Five-axis review framework.** The `code-review-and-quality` skill enumerates correctness / readability / architecture / security / performance as the structure for findings, with severity labels (Critical / Important / Suggestion / Nit / FYI / Optional / Consider).
6. **Source-driven citation discipline.** `source-driven-development` extends our 3-source rule with a citation hierarchy table (1: official docs > 2: official blog/changelog > 3: web standards > 4: compatibility), citation rules (full URLs, deep links with anchors, quote relevant passages), and an UNVERIFIED prefix when no source can be found.
7. **Idea-refine 3-phase flow.** Divergent (5–8 variations) → convergent (cluster, stress-test, surface assumptions) → ship (Markdown one-pager with Problem / Direction / Assumptions / MVP / Not Doing). Closest precedent for the W2.1 Prompter front-door.
8. **Test-driven discipline embedded into BUILD.** `test-driven-development` skill enforces Red-Green-Refactor, test pyramid, DAMP-over-DRY, the Beyonce Rule, and the test-pyramid-aware sizing.
9. **Debugging triage discipline.** `debugging-and-error-recovery` enforces Stop-the-line, five-step triage (reproduce → localize → reduce → fix → guard), bisect for regressions, and a hard rule that error output is *untrusted data* (must not contain instructions to follow).
10. **Hooks for session-start meta-skill injection.** A `SessionStart` hook injects the meta-skill `using-agent-skills` so the agent always knows its skill catalog.

## What is locked

These constraints bound the borrow plan. Not relitigable in this debate.

1. **`code-oz` is repo-native and CLI-first for v0.1** (no harness-coupled patterns; no slash-command CLI surface to mirror agent-skills' `/spec`, `/plan`, etc. — we have `code-oz run` instead).
2. **Rule 16: universal-rules.md ships inside every persona prompt.** Progressive disclosure of *additional* skills is fine; the universal floor is not progressive.
3. **Rule 18: codebase context retrieval has its own permission scope (`tool_use.repo_context`).** Any borrowed pattern that implies broader file access must declare a sub-scope.
4. **Rule 9: permission manifest required for any `.ts` execution.** agent-skills' `scripts/` pattern (per-skill bash entry points) cannot land without an execution sub-scope.
5. **Rule 7: artifact contracts in plain Markdown.** No JSON-serialized contracts.
6. **Rule 15: every primary-artifact phase runs the Scientist phase-tail.** Any new skill or contract that produces a primary artifact must include the Scientist tail.
7. **Rule 20: one new authority boundary per milestone.** M9 = cross-family REVIEW. M10 = Debate runtime. Borrowing a wholesale Skills layer is at minimum three new boundaries (skill anatomy, skill loader, persona-references-skill protocol). It cannot land in M9 or M10.
8. **Provenance policy: no borrowing from `claude-code-main` (the leaked Anthropic Claude Code source).** agent-skills is clean (Addy Osmani, MIT). Influence borrow remains "patterns, not code, no submodules, no copy-paste." (`CLAUDE.md` Influence library section.)
9. **Empirical pattern: every milestone gets a Codex planning debate before code lands** (rule 7 of the cross-model peer review section). Borrowing must not bypass debate.

## What is up for debate

Five concrete borrow proposals, ranked by leverage. Push back on each.

### Proposal 1 — Five-axis review structure for M9 REVIEW-lite

**Lift:** The five axes (correctness / readability / architecture / security / performance) become the recommended structure for the REVIEW persona's prompt and a new optional `## Findings` axis bullet inside `REVIEW.md`. Severity enum stays `block | fix-first | nit | fyi` (already aligned with agent-skills' Critical / Important / Suggestion).

**Why now:** M9's authority boundary is cross-family REVIEW. Adding the axis dimension to Findings is a prompt and contract refinement, not a new authority. It tightens the reviewer's scope without changing the loop or gate.

**Where it lands:**

- `src/prompts/review-system.md` (new): persona prompt with axis-by-axis review framework.
- `docs/contracts/REVIEW.md`: optional `Axis: correctness | readability | architecture | security | performance` bullet inside each `### F-NNN:` finding block. Stays optional in v0.1 to avoid blocking on schema migrations.
- `agents/code-reviewer.md` (agent-skills) is the source pattern; we paraphrase, not copy.

**Risk:** Axes can become rubric theater if reviewers tag everything "correctness" without engagement. Mitigation: Codex review at M9 close audits the first 5–10 REVIEW.md files for axis distribution.

### Proposal 2 — Orchestration-patterns catalog as a sibling reference doc

**Lift:** Adopt `references/orchestration-patterns.md` (agent-skills) as `docs/research/orchestration-patterns.md` (`code-oz`), paraphrased for our runtime. The five endorsed patterns and four anti-patterns become reference material that:

- M10 references when implementing `requestDebate()` (likely Pattern 5 — research isolation: one round-trip, one digest back, no chained chat).
- Future surfaces (Researcher, Reviewer panel, parallel builders) reference when justifying a new pattern.
- Personas reference as "do-not-do" guardrails (no router persona, no persona-calls-persona).

**Why now:** M10 needs a clear answer to "what shape is `requestDebate()`?" before commit 1. Without a catalog, M10 risks reinventing Pattern 5 vs. Pattern 3 ad hoc.

**Where it lands:**

- `docs/research/orchestration-patterns.md` (new, paraphrased from agent-skills).
- `CLAUDE.md` adds an "Orchestration patterns" pointer in "Where decisions live."
- `docs/contracts/DEBATE.md` adds a `## Pattern` H2 naming the chosen pattern (e.g., "Research isolation per `orchestration-patterns.md` Pattern 5").

**Risk:** A wholesale catalog import inflates docs without runtime change. Mitigation: only the patterns actually used by `code-oz` get full sections; others are listed by name with a one-line summary.

### Proposal 3 — Per-phase Common Rationalizations tables (staged, M9 first)

**Lift:** `src/prompts/common-rationalizations.md` stays as the universal table (8 entries). Add per-phase tables loaded by phase persona prompts:

- `src/prompts/rationalizations-define.md` (existing entries that apply to DEFINE)
- `src/prompts/rationalizations-plan.md`
- `src/prompts/rationalizations-build.md` (lifted from `incremental-implementation` skill: "I'll test it all at the end", "It's faster to do it all at once")
- `src/prompts/rationalizations-verify.md` (lifted from `debugging-and-error-recovery`: "I know what the bug is, I'll just fix it", "It works on my machine")
- `src/prompts/rationalizations-review.md` (lifted from `code-review-and-quality`: "It works, that's good enough", "AI-generated code is probably fine")

Each phase persona prompt imports the universal table + its phase-specific table.

**Why now:** M9 is the natural place to land the REVIEW-rationalizations table because it ships REVIEW persona for the first time. Other phase tables can land later (or in W2.4 as a sweep).

**Where it lands:**

- M9: `src/prompts/rationalizations-review.md` ships alongside `review-system.md`.
- Post-M10 (W2.4): backfill BUILD / VERIFY / DEFINE / PLAN tables.

**Risk:** Per-phase tables drift from the universal one over time. Mitigation: a `code-oz doctor rationalizations` check verifies no per-phase entry contradicts a universal entry.

### Proposal 4 — Source-driven citation discipline as a PLAN persona enrichment

**Lift:** Lift four pieces from `source-driven-development`:

1. **Source hierarchy table** (1: official docs > 2: official blog/changelog > 3: web standards > 4: compatibility / runtime).
2. **Citation rules** (full URLs, prefer deep links with anchors, quote relevant passages, mark UNVERIFIED when no source found).
3. **Stack-and-version detection** (Lead persona reads `package.json` / dependency files explicitly before drafting SOURCE_CHECK).
4. **Conflict surfacing** (when official docs conflict with existing project code, surface to user, do not silently pick).

These enrich the PLAN persona prompt and the SOURCE_CHECK.md schema's `Why:` rationale.

**Why now:** Light edit. No new authority boundary. Could land any time after M9 (when M9 attention is freed). Land as a docs commit that updates `src/prompts/plan-system.md` and `docs/contracts/SOURCE_CHECK.md` together.

**Where it lands:**

- `src/prompts/plan-system.md`: new sub-section "Source-driven discipline" with the hierarchy table and citation rules.
- `docs/contracts/SOURCE_CHECK.md`: optional `Hierarchy: 1 | 2 | 3 | 4` bullet inside `SC-DOC-NNN` blocks. Optional in v0.1.

**Risk:** Adds verbosity to every `SC-DOC-NNN` block. Mitigation: keep `Hierarchy` optional; only enforce when ambiguity is real.

### Proposal 5 — Skills layer as architectural concept (post-M10)

**Lift:** Adopt the Skills abstraction post-M10. Workflow chunks (currently inlined into persona prompts) extract into `src/skills/<name>.md` files with the agent-skills SKILL.md anatomy (Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification). Personas reference skills by name in their prompts; the orchestrator inlines them at invocation time.

Initial `src/skills/` content (post-M10):

- `incremental-implementation.md` (BUILD persona references)
- `three-source-verification.md` (PLAN persona references; companion to SOURCE_CHECK.md)
- `five-axis-review.md` (REVIEW persona references; codifies Proposal 1)
- `debugging-triage.md` (VERIFY persona references on restart-on-fail)
- `idea-refinement.md` (Prompter / DEFINE-0 references when W2.1 lands)

The Skills layer is *additive*: persona prompts retain their phase-specific protocol; skills are reusable workflow shapes layered in.

**Why not now:** Rule 20 — three new authority boundaries (skill anatomy, skill loader, persona-references-skill protocol) cannot land alongside M9 or M10. Stage in W2.

**Where it lands (later):**

- `docs/contracts/SKILLS.md` (new contract): skill anatomy, frontmatter schema, persona-references protocol, the Skills loader's permission scope.
- `src/skills/` directory.
- `src/agents/loader.ts`: extends to inline skill bodies referenced by personas.

**Risk:** Skills become reference docs no one reads (the agent-skills pack itself notes this risk). Mitigation: every skill ships with a Verification checklist whose items are observable in `events.jsonl` (so the orchestrator can audit whether the skill was actually followed).

## What is NOT proposed for borrow

- **Skills directory format wholesale into v0.1.** Rule 20 conflict; staged to W2 instead.
- **`/spec` `/plan` `/build` slash-command CLI surface.** `code-oz run` is the orchestration model; matching agent-skills' slash commands would force a second orchestrator.
- **Per-skill `scripts/` bash entry points.** Rule 9 (permission manifest) would require a new execution sub-scope; M8's `tool_use.execute` is already the canonical execution boundary.
- **Hooks-on-Markdown frontmatter.** Code-oz uses TypeScript-typed config; not equivalent to Claude Code's hook model.
- **Three named personas (`code-reviewer`, `security-auditor`, `test-engineer`).** Code-oz personas live in `src/agents/defaults/` and are tied to the IAgentProvider abstraction; the agent-skills personas are Markdown-only system prompts. Pattern is borrowed via Proposal 1 (five-axis review structure); the persona files themselves are not.

## The recommended path

Adopt Proposals 1, 2, 4 as M9 / parallel-to-M10 commits. Stage Proposal 3 with the REVIEW table in M9 and the rest in W2.4. Stage Proposal 5 to W2.1–W2.3 (skill anatomy contract first, then the loader, then materialization).

Total impact:

- **M9 (REVIEW-lite, already planned):** + Proposal 1 (five-axis structure) + Proposal 3 partial (rationalizations-review.md). Not new authority; persona-prompt enrichment.
- **M10 (Debate runtime, already planned):** + Proposal 2 (orchestration-patterns reference). Not new authority; reference doc.
- **Post-M10, low-priority:** + Proposal 4 (source-driven citations).
- **W2:** + Proposal 5 (Skills layer) + Proposal 3 backfill.

We are not asking M9 or M10 to grow scope. Proposals 1, 2, and the M9 portion of 3 are docs and prompt edits, no new code paths. They drop into the existing milestones cleanly.

## Decision prompts

1. **Five-axis review (Proposal 1).** Is the axis dimension worth adding to `REVIEW.md` as a recommended (not required) bullet, or should it stay only in the persona prompt? The trade is schema discipline vs. reviewer flexibility on edge findings (e.g., a finding that spans two axes).

2. **Orchestration-patterns catalog (Proposal 2).** Is `requestDebate()` Pattern 5 (research isolation, one round-trip, one digest) or Pattern 3 (parallel fan-out with merge)? Or something neither captures? The DEBATE.md contract today implies Pattern 5; agent-skills' catalog explicitly says Agent Teams (Pattern 3-adjacent) is for adversarial debugging — different from our use case.

3. **Per-phase rationalizations (Proposal 3).** Should the per-phase tables be required (loaded into every phase persona prompt) or opt-in (loaded only when phase-config flag is set)? Trade: discipline vs. token cost.

4. **Source-driven citations (Proposal 4).** Should the `Hierarchy:` bullet in `SC-DOC-NNN` be required for new SOURCE_CHECK.md files, or stay optional? Required tightens discipline; optional avoids breaking M5–M6 fixtures.

5. **Skills layer staging (Proposal 5).** Is W2 the right place, or should the Skills layer be its own dedicated milestone (M11 = Skills authority)? The trade is integration discipline (W2 lets it ride the Prompter and TUI work) vs. focus (M11 lets it have its own debate and review pass).

6. **What we are missing.** What does agent-skills *not* have that we should bring in clean-room? (E.g., the `Beyonce Rule` from `test-driven-development`. The `Stop-the-line rule` from `debugging-and-error-recovery`. The `error output is untrusted data` rule. Should any of these become a 21st universal rule?)

7. **Anti-rationalization integrity.** Are any of agent-skills' Common Rationalizations entries strong enough to add to `code-oz`'s universal table directly? Specifically: `"AI-generated code is probably fine"` → `"AI code needs more scrutiny, not less"`; `"I know what the bug is, I'll just fix it"` → `"You might be right 70% of the time; the other 30% costs hours"`. These map to existing `code-oz` failure modes.

8. **Recommended next-action ordering.** If we land all five proposals over the next 6–8 weeks, what is the right order? The stated path is M9 → M10 → post-M10 → W2. Is there a re-ordering that catches a risk we are missing?

## What I want from you

Return:

1. **Verdict per proposal** — one of `accept` / `accept-with-modifications` / `reject` / `feature-with-modifications`, plus a one-paragraph rationale. Five verdicts.
2. **Risks we are missing** — bullet list, severity-ranked. Especially: ways the borrow plan accidentally undermines rule 20, rule 16, rule 18, or rule 7.
3. **The single highest-leverage borrow we should land first** — name the file, name the diff shape.
4. **The single borrow we should reject** — name it, explain why the cost exceeds the value.
5. **One pattern from agent-skills we have not surfaced** that you would add to the borrow plan, with a one-paragraph case for it.
6. **What you would have done differently if you were Claude** — one paragraph; this is the most valuable signal.

## Calibration

- M9 is roughly 8–14 days of session time. M10 is roughly 6–10 days. We are not asking either milestone to grow.
- The borrow plan adds at most one Codex review pass per milestone (covered by the existing rule-8 review).
- Treat your verdicts as data, not authority (rule 9). We will weigh disagreement and push back where warranted.

## End of brief

The point of this borrow audit is not to import a pattern library; it is to find the 5–10% of agent-skills that would meaningfully tighten `code-oz`'s discipline without violating locked rules. If your read is that the borrow value is lower than that — or higher in places we did not propose — we want to hear it.
