---
name: templates-reference
companion-docs: 01-maestro-rule-checker.md, 02-llm-failure-research.md, 03-prompt-optimizer-front-door.md, 05-scientist-and-open-questions-agent.md
target: pinned reference for which influence-library template each design pattern came from
status: extends the table in CLAUDE.md with new contributions surfaced by this session
---

# Templates as the influence library

## Why this exists

CLAUDE.md already names seven open-source templates in `~/Projects/agents/templates/` and the pattern each contributes. That table was written when the maestro rule and the cross-family review rule were the load-bearing architectural decisions. Three new dossiers from this session add patterns the table does not yet cover. This document extends the existing table without modifying it; CLAUDE.md stays the single source of authority, and this file shows what is newly borrowed and from where.

The discipline carried over from CLAUDE.md remains: patterns are borrowed, not vendored. No code dependencies. No submodules. No copy-paste. Templates open via `/add-dir` only, read-only, never modified upstream.

## The table from CLAUDE.md (recap)

For reference. Authority lives in CLAUDE.md.

| Template                             | Pattern as named in CLAUDE.md                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `agent-skills`                       | Skill frontmatter format + DEFINE→SHIP phase taxonomy + Common Rationalizations table        |
| `opencode`                           | `bun build --compile` distribution + MCP host/client + permission system                     |
| `Archon`                             | `IAgentProvider` interface + worktree-per-run isolation                                      |
| `pi-mono`                            | Streaming event model + multi-provider abstraction                                           |
| `maestro`                            | File-based gate signals + 3-source verification + Opus-default policy                        |
| `Auto-claude-code-research-in-sleep` | Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts |
| `claude-code`                        | Plugin format + hook event names + filesystem discovery                                      |

## New contributions surfaced this session

### From the maestro rule-checker dossier (01)

Memory architecture. The four-layer file-system memory in the maestro doc (project rules, lessons learned, skill outcomes, ADRs) extends the `agent-skills` skill format with a layered memory hierarchy. The skill outcomes JSONL line-per-invocation pattern is loosely inspired by the `pi-mono` streaming event model, applied to skill outcomes instead of provider events.

Forced-correction skills. The ten skills in the maestro doc (`verify-symbol`, `repo-search-before-write`, `requirement-restate`, `mutation-test`, `context-compact`, `adversarial-review`, `escalate-deadlock`, `dependency-pin`, `state-handoff`, `null-check`) sit on top of the `agent-skills` SKILL.md format. The trigger-and-procedure shape is `agent-skills`-native; the maestro adds the supervisory wrapping (a skill is invoked by the maestro on a specific signal, not freely by the agent).

Adversarial-review mandate. The reviewer-must-find-counterexample discipline expands `Auto-claude-code-research-in-sleep`'s cross-family review rule by giving the reviewer three explicit output shapes ("I broke it", "I tried these attacks and could not break it", "I cannot break it"). The first two shapes are new contributions to the influence library.

### From the LLM failure research dossier (02)

The 17-family bug map. Synthesizes published taxonomies (Dr.Fix, MAST, the Practical Code Generation hallucinations paper) with practitioner observations (AI slop, sycophancy, scope creep, excess generation). No single template contributed this; it is a research synthesis the project carries forward.

The universal rule sheet. The 20-item ban list and require list in the failure dossier is new. It is sized to the ~150–200 instruction follow-budget HumanLayer measured for frontier thinking models. The format (10 prohibitions + 10 affirmations) is inspired by the Common Rationalizations table from `agent-skills` but at the system-rule layer rather than the persona-rationalization layer.

The "RLHF over-rewards observable virtue" framing. New synthesis. Argues that verbosity, defensive coding, sycophancy, scope creep, and excess generation share a single training-signal cause and need structural-not-behavioral fixes. Becomes a durable note in CLAUDE.md.

### From the prompt-optimizer front-door dossier (03)

DEFINE-0 phase. New contribution. Sits before DEFINE in the phase taxonomy. The phase ordering pattern (INTAKE → DEFINE-0 → DEFINE → PLAN → ...) extends `agent-skills`' DEFINE-to-SHIP taxonomy by adding a pre-DEFINE intent-rewriting stage.

Two-tier optimizer. Borrowed shape from Promptomatix (Salesforce). Cheap meta-prompt by default; heavy DSPy MIPRO compile via `--deep` opt-in. Not present in any of the seven existing templates.

Controller-Executor-Designer skill loop. Borrowed from MemSkill (academic). Maps onto code-oz roles: maestro = Controller (selects which skills to load), persona agents = Executors (run the skills), `code-oz reflect` job = Designer (evolves the skill set). Closest existing template equivalent is `Auto-claude-code-research-in-sleep`'s Reviewer Memory; the controller-executor-designer split is more granular.

INTENT.md schema. New artifact contract; sits alongside SPEC.md in the existing artifact ladder. Six required H2 sections (Restated request, Inferred goals, Stated constraints, Inferred constraints, Assumptions made, Open questions). Plain Markdown, no frontmatter, mirrors SPEC.md.

Skill exemplar library with retrieval. Borrowed shape from Voyager (academic). Skills earn their place in the library only after self-verification confirms task completion. code-oz adds: file-based exemplars, tag-based retrieval with embedding fallback, designer-promoted exemplars from successful runs. The Voyager pattern was Minecraft-bound; this generalizes it to non-game agentic settings.

### From the missing-pieces brainstorm (04)

Codebase context retrieval as agentic search. Borrowed shape from `claude-code` (the `Glob` + `Grep` + targeted file reads pattern Anthropic uses internally). Not previously surfaced as a template contribution because code-oz had not reached that scope.

Iterative BUILD loop. The write → run → see-error → patch loop is canonical Voyager (academic). No code-oz template currently encodes it; M7 is where it lands.

LanguagePack abstraction. New contribution; mirrors the `IAgentProvider` shape from Archon. Specific to multi-language support.

`IIntegration` event-sourced consumer. The events log as integration substrate is `pi-mono`-flavored (streaming events) plus webhook-style consumers borrowed from common patterns in real-world dev tooling.

### From the Scientist meta-agent dossier (05)

Phase-tail meta-agent. New contribution. The Scientist runs at every phase tail without owning a primary artifact. No existing template has this shape; closest analogue is the maestro itself, but the maestro is gate-level not phase-tail.

HYPOTHESES.md and OPEN_QUESTIONS.md as first-class artifacts. New contribution. Plain-Markdown artifact format borrowed from `Auto-claude-code-research-in-sleep`; the epistemic-state-as-artifact pattern is new.

Stable-id epistemic tracking (`H-NNN`, `Q-NNN`). New contribution. Survives across phases; cross-referenced from primary artifacts. No template precedent.

Gate-blocks-on-overdue-questions. New contribution. Extends the file-based-gate-signals rule from `maestro` template by adding an epistemic precondition (open questions overdue at this phase block the gate).

## Updated table including this session's contributions

The CLAUDE.md table stays authoritative. This is a working extension; the user can decide whether and how much of it to fold into CLAUDE.md.

| Template                             | Original pattern                                                               | Extended by this session                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-skills`                       | Skill frontmatter + DEFINE→SHIP + Common Rationalizations                      | Layered memory hierarchy, forced-correction skills, INTENT.md as new pre-DEFINE artifact, exemplar libraries per skill                          |
| `opencode`                           | `bun build --compile` + MCP + permissions                                      | Two-tier optimizer (cheap default, deep opt-in via flag)                                                                                        |
| `Archon`                             | IAgentProvider + worktree-per-run                                              | LanguagePack abstraction (new interface mirroring IAgentProvider for multi-language support)                                                    |
| `pi-mono`                            | Streaming event model + multi-provider                                         | Skill outcomes JSONL log; `IIntegration` event-consumer pattern; new event types for ask-me, scientist, prompter                                |
| `maestro`                            | File-based gate signals + 3-source verification + Opus-default                 | Memory architecture, 17-family bug map, universal rule sheet, gate-blocks-on-overdue-questions                                                  |
| `Auto-claude-code-research-in-sleep` | Cross-family review + Reviewer Memory + 4-round cap + plain-Markdown contracts | DEFINE-0 phase, INTENT.md, HYPOTHESES.md and OPEN_QUESTIONS.md as plain-Markdown artifacts, three reviewer output shapes                        |
| `claude-code`                        | Plugin format + hook events + filesystem discovery                             | Agentic codebase search (`Glob` + `Grep` + LSP); hooks as enforcement points for maestro rules (e.g., Stop hook for "edit only declared files") |

## What is in the influence library that we have not borrowed yet

A short list of patterns that exist in the templates but code-oz has not consumed. Worth a sniff test before W2.

From `claude-code`: the `/permissions` allowlist UI for non-experts, the auto-mode classifier for non-blocking action approval. Maps to non-expert-workflow milestone (items 5, 9, 10 in the missing-pieces dossier).

From `opencode`: OAuth + PKCE-based provider authentication. Currently the Codex adapter uses subprocess + ChatGPT-account auth; the OAuth pattern would let the Codex adapter run as a remote service. Maps to W3 if the Codex adapter ever moves off subprocess-backed.

From `Archon`: the worktree-per-run isolation pattern at depth. Today the M3 single-active-run pointer is enough. When concurrent runs (deferred to W2/W3) ship, the full Archon worktree pattern is the canonical answer.

From `agent-skills`: the curriculum-driven skill acquisition (Voyager-inspired). The skill exemplar library uses retrieval but does not yet have a curriculum that picks the next skill to learn. This is a W3+ research direction.

From `pi-mono`: the per-provider streaming-cost calibration. Today `estimateTokens` from `src/providers/cost.ts` is provider-agnostic at ~4 chars/token. `pi-mono` has provider-specific estimators that converge with measured usage. Worth borrowing in W3.

## Discipline carryover

Every pattern adopted from the templates carries one obligation: name the source in the commit message and in CLAUDE.md if the pattern becomes durable. The Codex round at planning convergence reads CLAUDE.md as ground truth for which patterns are locked. Borrowing without crediting becomes silent assumption (family 14 in the bug map) at the architectural layer.

The other obligation: when a template's pattern fails for code-oz, write down why before discarding it. The lesson lives in `.codeoz/lessons/`; the template stays in the influence library; the next time the pattern looks attractive, the prior failure is searchable.

## How a new template gets added

If the user finds a new open-source repo worth borrowing from:

1. Clone or symlink under `~/Projects/agents/templates/<name>`.
2. Read the README and one canonical file. Note the patterns it offers.
3. Cross-reference against this table. If a pattern duplicates an existing one with no improvement, do not add the template.
4. If the pattern is new, write a 2–3 sentence summary in this file (or CLAUDE.md if it is durable).
5. Borrow the pattern in the next milestone planning round; cite the source in the planning brief and in commit messages.

The bar for adding a template is: it solves a problem code-oz has not solved well yet, in a way that is auditable enough to lift the pattern without lifting the code.
