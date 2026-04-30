---
name: code-oz-research-bundle-readme
target: index and orientation for the bundle
---

# code-oz research bundle

This is the research memory from one extended planning session. Seven Markdown files. One topic per file. Together they propose how code-oz extends to real-world use, with citations to 2024–2026 papers and a working sequencing plan.

The bundle is meant to live under `~/Projects/code-oz/docs/research/` once the user is ready to land it. It is read by Claude Code sessions, by Codex review rounds, and by the user when making milestone decisions. It is a snapshot, not a destination — future sessions add new dossiers; existing dossiers get updated when the underlying research shifts.

## What is in the bundle

```
00-README.md                           This file
01-maestro-rule-checker.md             Rule-checker discipline; 9-family bug map; 10 skills; memory architecture
02-llm-failure-research.md             17-family failure research with citations from 2024–2026 papers
03-prompt-optimizer-front-door.md      DEFINE-0 phase + Prompter persona (W2 milestone proposal)
04-missing-pieces-brainstorm.md        10 gaps that block real-world use; priority sequencing
05-scientist-and-open-questions.md     Scientist meta-agent + HYPOTHESES.md + OPEN_QUESTIONS.md
06-templates-reference.md              Influence-library mapping; what each template contributed
07-claude-code-trigger-prompt.md       Copy-paste session prompt for Claude + Codex synthesis round
```

## Reading order

If you have time for one file, read **04**. It is the brainstorm of what is missing and where each item slots.

If you have time for two, read **04** and **02**. The second tells you which failures the gaps are protecting against.

If you have time for three, add **01**. It defines the discipline that ties everything together.

If you have time for the full bundle, read in order 04 → 02 → 01 → 05 → 03 → 06 → 07. That sequence goes from the gap analysis to the failure evidence to the gatekeeper discipline to the epistemic layer to the front door to the influence library, finishing with the trigger prompt that operationalizes the synthesis.

## Current state of code-oz this bundle assumes

- Repo: `~/Projects/code-oz`, branch `feat/m5-define`.
- Last release: `v0.4.0-alpha.0` (M4: provider contract + 4 adapters + wrapper + requestReview + doctor).
- M5 commit 1 staged but not committed (SPEC + spec-contract pinning, per Codex's `proceed-with-modifications` verdict).
- 391 tests passing offline.
- The seven non-negotiable rules in CLAUDE.md plus the four cross-model peer-review rules (rules 7–10) are durable.

If the state has moved when you run the trigger prompt, the prompt still works but Claude must reconcile the bundle's assumptions against the current state. The trigger prompt explicitly asks Claude to read `now.md`, `recent.md`, and the M5 docs before drafting the synthesis.

## How to use the bundle

### Quick path: run the synthesis session

1. Drop the bundle into the repo:

   ```bash
   cd ~/Projects/code-oz
   git switch -c docs/research-synthesis
   mkdir -p docs/research
   cp /path/to/code-oz-research-bundle/*.md docs/research/
   git add docs/research/
   git commit -m "docs(research): land 7-doc research synthesis bundle"
   ```

2. Open Claude Code: `cd ~/Projects/code-oz && claude`.

3. Paste the trigger prompt from file 07 (the fenced block).

4. Wait. The session produces three commits: the synthesis draft, the Codex round, and the merge plan.

5. Read `docs/research/MERGE_PLAN.md`. Make the decisions it surfaces. Run follow-up sessions to apply CLAUDE.md updates, ROADMAP updates, and the next milestone's planning round.

### Slower path: read first, run later

Read 04 and 02 in chat or in your editor. Decide whether the gap analysis matches your read of where code-oz needs to go. If yes, then drop the bundle and run the synthesis session. If no, the bundle is wrong and a different session is needed first to revise the gap analysis.

### Bypass path: cherry-pick

Each dossier stands alone. If only the Scientist (file 05) interests you right now, you can pull just that one file into the project and ignore the rest. The Scientist references the maestro and the bug map, but it does not depend on them being implemented for its own design to make sense.

## What this bundle does not contain

- Code. No TypeScript, no implementations. Every dossier proposes a design; M5–M7 actuals plus W2/W3/W4 follow-ups are where code lives.
- A new ROADMAP.md. The bundle proposes scope changes to the existing roadmap; the user applies them through the synthesis session, not through the bundle.
- A modified CLAUDE.md. Same logic: proposed rule additions live in the synthesis output, not in the bundle itself.
- Implementation milestones. The trigger prompt's output recommends the next planning session; the user runs that session at their own pace.

## Authority and dependence

The bundle is research synthesis, not authority. CLAUDE.md is authority. The seven non-negotiable rules in CLAUDE.md plus rules 7–10 (cross-model peer review) override anything the bundle says. If a dossier proposes something that conflicts with CLAUDE.md, CLAUDE.md wins; the dossier is wrong and gets revised.

The bundle depends on:

- CLAUDE.md (the rule book)
- The seven open-source templates in `~/Projects/agents/templates/` (the influence library)
- The Codex MCP server being available for the synthesis round
- The user being able to read 7 dossiers and make decisions

It does not depend on any specific milestone state. M5 in flight, M5 closed, M6 in flight — the bundle's proposals adjust to current state via the synthesis session, but the bundle itself is state-independent.

## How the bundle gets updated

If a future research session produces a new dossier (for example, a deep-dive on test-driven development for LLM agents, or a study of devcontainer-based sandboxing), it lands as `08-<topic>.md`, `09-<topic>.md`, etc. This README's table of contents and reading order get updated. The trigger prompt in 07 stays the same; new dossiers are added to its list of "files to read."

If a dossier's content gets falsified by new research or by lived experience, the dossier gets a new top-of-file note: `## Update <date>: <what changed and why>`. The original content stays; the update annotates. Auditability over neatness.

## Citations

Every claim in the bundle that depends on external research has a citation. Citations are in each file's "Citation index" or inline as `arXiv:NNNN.NNNNN` references. The full list across the bundle covers:

- Multi-agent system failure taxonomies (MAST, the Berkeley NeurIPS 2025 paper)
- LLM hallucination and bug taxonomies for code (Dr.Fix, Practical Code Generation, Beyond Functional Correctness, the Hallucination Survey)
- SWE-Bench and its variants (Verified, +, Pro)
- Empirical studies on LLM-generated code quality (RobGen, FeatBench, GitClear, the AI Slop literature)
- Sycophancy research (Sharma et al., ELEPHANT, Causal Separation)
- Automatic prompt optimization (Promptomatix, DSPy + MIPRO, MemAPO, PromptTailor)
- Self-evolving agents (Voyager, MemSkill, Memento-Skills, Reflexion, MARS, GEPA)
- The "Why Johnny Can't Prompt" CHI 2023 paper
- EviBound (Evidence-Bound Autonomous Research)
- Anthropic's context-engineering and Claude Code best-practices documentation

A consolidated bibliography is not part of the bundle by design — each dossier's citations stay local to that dossier so the file is self-contained. If a future session wants a unified bib, it can be derived in one pass.

## Authoring note

The bundle was authored in one session. The dossiers were written in the order maestro-rule-checker → llm-failure-research → prompt-optimizer-front-door → missing-pieces-brainstorm → scientist-and-open-questions → templates-reference → claude-code-trigger-prompt → this README. Each dossier was a response to a specific prompt; together they cohere because each picked up what the prior one left unfinished.

The bundle is not a research paper. It is engineering memory written in research style: load-bearing claims have evidence, designs have alternatives considered, every borrowed pattern has a source named. The format is what makes the bundle reusable across sessions.

## Closing

This bundle is the research substrate for code-oz's path from spine-shipping (M7) to real-world use. The synthesis session that 07 sets up is the next step. The merge plan that session produces is what turns the research into actual milestone scope changes.

Read 04 first if in a hurry. Run the synthesis session when ready. Apply the merge plan in follow-up sessions. The bundle stays under `docs/research/` as the project's growing research memory.
