---
name: claude-code-trigger-prompt
companion-docs: 01 through 06 in this bundle
target: copy-paste prompt for a Claude Code session, with the Codex round wired in per CLAUDE.md rules 7-10
status: ready to invoke once the bundle is dropped into the repo
---

# Claude Code session trigger: synthesis + Codex round

## How to use this file

This document contains two things. The first is the human-readable session plan: what the session is for, what state it expects, what it must produce. The second, in the fenced block at the end, is the prompt to paste into Claude Code to start the session.

The session is a strategic planning session, not an implementation session. It synthesizes the five research dossiers into proposed updates to CLAUDE.md, the milestone plan, and the next CODEX_BRIEFING. It does not change M5 (locked, Codex-approved). It does not write code outside `docs/`. It runs the Codex round per CLAUDE.md rules 7–10 before any plan is treated as final.

## Pre-session checklist

Before pasting the prompt, do these manually:

1. Drop this bundle into `~/Projects/code-oz/docs/research/` as a single commit on a new branch:

   ```bash
   cd ~/Projects/code-oz
   git switch -c docs/research-synthesis
   mkdir -p docs/research
   cp /path/to/code-oz-research-bundle/*.md docs/research/
   git add docs/research/
   git commit -m "docs(research): land 7-doc research synthesis bundle"
   ```

   The bundle commit lands as a sibling to your M5 work. It does not interfere with `feat/m5-define`.

2. Confirm M5 commit 1 is still staged on `feat/m5-define`. The session prompt assumes M5 has not advanced since the bundle was authored. If M5 has moved, the session can still run but the synthesis output must take the new state into account.

3. Confirm the Codex MCP server is available. The prompt invokes `mcp__plugin_agent-codex_codex-native__codex` with `gpt-5.5` at `xhigh` effort, `sandbox: read-only`, `approval: never`. If the MCP server is down, the session aborts at the Codex round; Claude saves a draft and surfaces the failure rather than skipping the round.

4. Confirm `~/.codex/config.toml` has the global xhigh effort default, per CLAUDE.md rule 10.

5. Open Claude Code in the repo root: `cd ~/Projects/code-oz && claude`.

## What the session produces

Three commits on `docs/research-synthesis`, in order:

1. `docs(research): proposed CLAUDE.md updates and milestone-plan deltas`. Adds `docs/research/SYNTHESIS.md` listing the proposed durable rules (new CLAUDE.md entries 15+), the proposed M6/M7/W2/W3/W4 scope deltas, and the open questions that need user decisions.

2. `docs(research): codex round on the synthesis`. Adds `docs/research/CODEX_BRIEFING_SYNTHESIS.md` and `docs/research/CODEX_RESPONSE_SYNTHESIS.md`. Captures the Codex review of the synthesis. Verdict is one of `proceed`, `proceed-with-modifications`, or `debate-required`.

3. `docs(research): synthesis-merge plan`. After Codex's response is folded in, writes the final plan: which entries land in CLAUDE.md, which become milestone scope changes, which are deferred. This commit is the artifact the user reads to make the actual decisions.

The session does NOT modify CLAUDE.md, the ROADMAP, or any milestone kickoff doc. Those are user-owned changes that follow from the synthesis-merge plan. The session output is a recommendation, not an act.

## What the session does not do

- It does not implement the Scientist persona, the Prompter persona, the codebase-context retriever, or any other code from the bundle.
- It does not push to origin. Local commits only, per CLAUDE.md.
- It does not amend or rebase commits.
- It does not change M5 scope. M5 is Codex-approved and proceeding.
- It does not run live Codex on every milestone affected by the synthesis. One Codex round on the synthesis itself, then the user fans the changes out into the per-milestone planning rounds at their own pace.

## What to expect during the session

Claude reads the bundle, reads CLAUDE.md, reads the active state (now.md, recent.md, the M5 docs), runs through the synthesis logic, drafts SYNTHESIS.md, writes the Codex briefing, invokes Codex, captures the response, drafts the merge plan. Stops there. Total time: ~30–60 minutes elapsed, mostly waiting on Codex.

## The trigger prompt

Paste everything between the fence marks into Claude Code. Do not modify the prompt body unless the bundle landed under a different path; in that case, change the path reference in step 1 to match.

```text
You are starting a code-oz strategic-planning session, not an implementation
session. Your job is to synthesize five research dossiers into proposed
updates to CLAUDE.md, the milestone plan, and the next Codex briefing.
You will not write production code, modify CLAUDE.md directly, or change
the M5 scope. M5 is locked, Codex-approved, and proceeding on
feat/m5-define.

The bundle you will read is in docs/research/ as files numbered 01–06,
plus this file as 07 (skip 07 itself; it is the trigger you are running).

The five substantive dossiers, by topic:

  01-maestro-rule-checker.md       The maestro rule-checker discipline
                                   (9-family bug map, 10 skills, memory
                                   architecture, hard SDLC gates,
                                   adversarial review)

  02-llm-failure-research.md       17-family failure research with
                                   citations from 2024–2026 papers
                                   (verbosity, defensive over-coding,
                                   pattern mimicry, sycophancy,
                                   assumption propagation, scope creep,
                                   excess generation, overconfidence)

  03-prompt-optimizer-front-door.md DEFINE-0 phase + Prompter persona +
                                   self-evolving skill library (W2
                                   milestone proposal)

  04-missing-pieces-brainstorm.md  10 gaps blocking real-world use,
                                   priority-sequenced

  05-scientist-and-open-questions  Scientist meta-agent + HYPOTHESES.md +
                                   OPEN_QUESTIONS.md (post-M6
                                   milestone proposal)

  06-templates-reference.md        Extended influence-library table:
                                   patterns borrowed from each template
                                   in ~/Projects/agents/templates/

Read these in order, then read CLAUDE.md, then read the active state
(.remember/now.md, .remember/recent.md, docs/design/SESSION_M5_KICKOFF.md,
docs/design/CODEX_RESPONSE_M5.md).

After reading, your task is to produce three commits on a new branch
named docs/research-synthesis. Each commit corresponds to one phase of
the session.

PHASE 1: Draft the synthesis (one commit).

Write docs/research/SYNTHESIS.md with the following sections:

  ## Proposed CLAUDE.md additions

  Each new rule numbered starting at 15 (existing rules go to 14). For
  each: rule text, source dossier, evidence justifying it as durable.
  Limit: at most five new rules. CLAUDE.md is for universally
  applicable rules; per-milestone discipline goes in milestone docs.

  ## Proposed milestone scope changes

  For M6: codebase context retrieval (item 1 from dossier 04), iterative
  BUILD loop coupling (item 2), run-level budgets (item 6 from dossier
  04). Each as a one-line scope addition with the dossier reference.

  For M7: same shape; flag what newly belongs in BUILD/VERIFY/REVIEW
  given the iterative-loop addition.

  For W2: list the items now grouped under the non-expert workflow
  milestone (Prompter + items 5, 9, 10 from dossier 04).

  For W3: list multi-language and integrations work (items 3, 7 from
  dossier 04).

  For W4: AUDIT depth (item 4 from dossier 04) plus any deferred items.

  Propose a new mid-milestone (between M6 and M7) called M-Scientist
  that lands the Scientist meta-agent (dossier 05). Justify the slot.

  ## Decisions the user must make

  Three to five binary or short-list questions the synthesis cannot
  answer alone. Each with: the decision, the lean recommendation, the
  alternative, the reason it cannot be auto-resolved.

  Examples likely to appear:
    - Does the Scientist land between M6 and M7, or as W2?
    - Does the Prompter ship as W2 or wait until W3?
    - Does multi-language support climb to before W3 because OneStream
      is C#?

  ## Open questions for the next Codex round

  Two to four prompts in the lean+reasoning+counter format you already
  use in CODEX_BRIEFING_M*.md. These are the load-bearing planning
  prompts the Codex round will debate.

Once SYNTHESIS.md is written:

  git add docs/research/SYNTHESIS.md
  git commit -m "docs(research): proposed CLAUDE.md updates and milestone-plan deltas"

PHASE 2: Run the Codex round (two artifacts, one commit).

Write docs/research/CODEX_BRIEFING_SYNTHESIS.md following the same
format as docs/design/CODEX_BRIEFING_M5.md. The briefing's substance is
the prompts from SYNTHESIS.md's "Open questions for the next Codex round"
section, plus a "context for Codex" preamble that points to the five
bundle dossiers.

Then invoke the Codex MCP tool:

  mcp__plugin_agent-codex_codex-native__codex with:
    model: gpt-5.5
    model_reasoning_effort: xhigh
    sandbox: read-only
    approval: never
    cwd: ~/Projects/code-oz
    request: <contents of CODEX_BRIEFING_SYNTHESIS.md>

Capture the verbatim Codex reply into docs/research/CODEX_RESPONSE_SYNTHESIS.md
following the format of docs/design/CODEX_RESPONSE_M5.md. Include the
thread id, model, effort, sandbox, approval, date.

If the Codex MCP call fails, write what was attempted into
CODEX_RESPONSE_SYNTHESIS.md as a `status: failed` block with the error,
do not invent a Codex reply, and proceed to phase 3 noting the gap.

  git add docs/research/CODEX_BRIEFING_SYNTHESIS.md docs/research/CODEX_RESPONSE_SYNTHESIS.md
  git commit -m "docs(research): codex round on the synthesis"

PHASE 3: Write the merge plan (one commit).

Write docs/research/MERGE_PLAN.md. Sections:

  ## What CLAUDE.md should add
  Final list of rules to add, after Codex's review. Each with a one-line
  diff sketch ("Add as rule 15: [text]").

  ## Milestone scope deltas to ROADMAP
  Final list. Each with a marker: `accepted`, `modified-per-codex`,
  `deferred`, `rejected-per-codex`.

  ## Open questions still requiring user decision
  Same shape as in SYNTHESIS.md, but updated with Codex's input. The
  user reads this section to make the actual calls.

  ## Recommended next session
  One paragraph: what is the next session and what does it produce.
  Likely candidates: write CODEX_BRIEFING_M_SCIENTIST.md if the user
  approves M-Scientist as a milestone; or write
  CODEX_BRIEFING_W2_NON_EXPERT.md if W2 is the next planning push.

  git add docs/research/MERGE_PLAN.md
  git commit -m "docs(research): synthesis-merge plan after codex round"

CONSTRAINTS:

  - Do not modify CLAUDE.md, ROADMAP.md, or any SESSION_M*_KICKOFF.md.
    The synthesis output is a recommendation; the user applies the
    changes themselves in a later session.
  - Do not push to origin.
  - Do not amend or rebase. Three new commits, in order.
  - Do not implement personas, phases, or artifacts from the bundle.
    All implementation work happens in milestone-specific sessions
    later.
  - Do not bypass the Codex round. If Codex is unreachable, mark the
    failure and continue; do not skip the artifact.
  - Stay inside docs/research/. The synthesis touches no other path.
  - Keep MERGE_PLAN.md under 400 lines. SYNTHESIS.md under 600. The
    Codex briefing under 300.

REPORTING:

  At the end of phase 3, summarize for me in chat:
    - The three commits, with shas and one-line subjects
    - The Codex verdict (proceed / proceed-with-modifications / debate-required)
    - The top three open questions still requiring user decision
    - The recommended next session

Do not push, do not tag, do not merge. The branch
docs/research-synthesis stays local until I review it.

Begin.
```

## Notes on the trigger prompt's design

The prompt enforces several disciplines from CLAUDE.md and the bundle without restating them in the prompt itself. Quick map for audit:

- "M5 is locked" — CLAUDE.md rule 12 (resume) plus the Codex-approved planning round in `CODEX_RESPONSE_M5.md`. The prompt re-states this so Claude does not try to be helpful by re-opening M5.
- "Codex round in phase 2" — CLAUDE.md rules 7–10. The prompt names the model, effort, sandbox, approval explicitly so Claude does not have to remember.
- "do not push to origin" — CLAUDE.md "Don't" list in `SESSION_M5_KICKOFF.md` and CLAUDE.md rule 5.
- "do not amend or rebase" — CLAUDE.md "Don't" list and the `feedback_no_tech_debt.md` rule.
- "stay inside docs/research/" — Maestro skill `state-handoff` rule from dossier 01: declare scope, edit only declared files.
- "do not invent a Codex reply" — Failure-research dossier family 17 (overconfidence and false claims). The prompt is explicit so Claude does not fabricate a Codex reply if the MCP call fails.
- "verify-before-assert" — The prompt's reporting block requires shas and a verdict, both verifiable from disk, not generated.

## What if Codex says debate-required

If the Codex verdict is `debate-required`, the synthesis is incomplete. The merge plan should:

- Not promote any debated item to CLAUDE.md.
- Capture the debate prompts as new entries in `docs/research/MERGE_PLAN.md` under "Items requiring further debate".
- Recommend a follow-up Codex round in the "Recommended next session" block.

The user then runs another session with a new briefing focused on the debated items. This is the same pattern M3 used (two Codex rounds during planning) and M4 used (planning round plus implementation review plus re-review).

## What if Codex finds a structural issue with the bundle itself

This is possible. The bundle is research synthesis; Codex is the cross-family check on that synthesis. If Codex flags a load-bearing claim that the bundle made (for example, "the 79% figure from MAST does not generalize to single-LLM agentic settings"), the merge plan should:

- Treat the flag as a finding against the dossier, not against the synthesis.
- Note in MERGE_PLAN.md which dossier section the flag attaches to.
- Add a remediation entry: update the dossier with a footnote, or downgrade the affected claim, or open a follow-up research thread.

The dossiers are not gospel. They are working documents, and Codex's job is to push back on them just like any other artifact.

## After the session

The user reads `docs/research/MERGE_PLAN.md`, makes the decisions flagged there, then runs follow-up sessions to:

1. Apply CLAUDE.md updates (a small commit, manual or Claude-assisted).
2. Update `docs/design/ROADMAP.md` with the milestone scope deltas.
3. Write the next CODEX_BRIEFING for whichever milestone the merge plan recommends as the next session.

The bundle stays under `docs/research/` indefinitely. It is a snapshot of where the research stood at this synthesis point. Future research sessions add new dossiers; the table-of-contents in `00-README.md` (in this bundle) is the index.

## Variants of the trigger prompt

Two situational variants worth noting.

**If you want only the synthesis without the Codex round (faster, cheaper).** Remove phase 2 from the prompt and have phase 3 produce a placeholder `CODEX_BRIEFING_SYNTHESIS.md` only. The merge plan then has a `status: codex-pending` marker on every item. This is appropriate if you are exploring the synthesis interactively before formalizing.

**If you want the synthesis to also produce CLAUDE.md updates as a draft commit.** Add a phase 4 that writes `docs/research/CLAUDE_DELTA.md` showing the proposed before-and-after for each new rule. Do not modify CLAUDE.md itself; the user applies the diff manually after reviewing.

The default prompt above is the conservative version: synthesis + Codex round + merge plan, no CLAUDE.md or ROADMAP changes. You can always run a follow-up session to apply changes once the merge plan is reviewed.

## Final note

The point of this prompt is to make the synthesis auditable. Three commits, three artifacts, one Codex round. Each artifact stands alone and can be read by the user, by a future Claude session, or by a future Codex round. The bundle plus the synthesis is the project's research memory at this point in time. Everything that follows references it; nothing inside it is hidden state.
