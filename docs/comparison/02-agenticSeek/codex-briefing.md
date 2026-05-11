---
name: codex-briefing-agenticSeek
companion-doc: comparison.md
target: pressure-test the Opus draft of `comparison.md` (code-oz vs agenticSeek), challenge any weak claim, and contribute borrow / non-borrow decisions
mode: debate (one round, structured response)
codex-model: gpt-5.5 xhigh, sandbox: read-only
date: 2026-05-10
---

# Codex briefing — Code-Oz vs agenticSeek

## Goal

Pressure-test `docs/comparison/02-agenticSeek/comparison.md`. The Opus draft concludes **YES, with selective borrows**: code-oz is structurally ahead on every directly-overlapping mechanic, agenticSeek's distinctive features are off-mission, and four borrow candidates (B1–B4) enter as roadmap candidates gated by Rule 21 (measurable risk-reduction effect) and Rule 20 (one new authority per milestone).

Your job is to push back hard. Do not just nod. The point of the cross-model peer review rule is to catch blind spots, not to confirm what the lead already wrote.

## What to read first

Required (in order):

1. `/Users/ozzy-mac/Projects/code-oz/CLAUDE.md` — non-negotiable rules, especially 1 (file-based gates), 2 (cross-family review), 9 (permission manifest), 18 (`tool_use.repo_context`), 19 (run-level budgets), 20 (one authority per milestone), 21 (no parallel-provider surface without measurable effect).
2. `/Users/ozzy-mac/Projects/code-oz/docs/product/AI_SOFTWARE_COMPANY_THESIS.md` — product north star (repo-native agentic SDLC runtime; AI software company metaphor; multi-cloud / multi-role thesis).
3. `/Users/ozzy-mac/Projects/code-oz/docs/comparison/02-agenticSeek/comparison.md` — the Opus draft you are pressure-testing. Sections 0 (TL;DR), 3 (matrix), 4 (where code-oz is structurally better), 5 (borrow candidates B1–B4), 6 (off-mission), 7 (open questions for Codex).

Reference (skim if time):

4. `/Users/ozzy-mac/Projects/agents/templates/agenticSeek/README.md` — the template's pitch and capabilities.
5. `/Users/ozzy-mac/Projects/agents/templates/agenticSeek/sources/agents/planner_agent.py` — agenticSeek's planner / re-planning loop (~300 lines).
6. `/Users/ozzy-mac/Projects/agents/templates/agenticSeek/sources/router.py` — the trained `AdaptiveClassifier` routing pattern.
7. `/Users/ozzy-mac/Projects/agents/templates/agenticSeek/sources/tools/safety.py` — substring denylist sandbox (compare with code-oz Rule 9).

## Constraints on your debate response

1. **No code suggestions.** This is a comparison and roadmap-candidate decision, not an implementation. Patterns only.
2. **No cheerleading.** If you agree with a claim, say *why* and on what evidence; if you disagree, name the failure mode. "Reasonable" without a load-bearing reason is not useful.
3. **Respect rule-20 / rule-21.** Borrow recommendations must clear "one new authority per milestone" and "measurable risk-reduction effect against the single-provider baseline." If you propose a borrow, state the measurement.
4. **Off-mission is not a slur.** When the briefing says voice / browser / local-first are off-mission, that is a category claim, not a quality judgment. Push back only if you think the category itself is wrong.
5. **Do not propose new milestones.** You may propose ROADMAP candidates and rank them; milestone slot decisions are the operator's.

## Open questions (re-stated for convenience)

Answer all seven. Each in 4–8 sentences. Disagreement is welcome.

1. **Verdict shape.** Is "YES, with selective borrows" the right shape, or does agenticSeek demonstrate a category-defining primitive that the draft mis-labels as off-mission?
2. **B1 (plan-revision telemetry).** Useful signal in `events.jsonl`, or noise without a clear consumer? Gate-file artifact instead? Or refuse the borrow entirely?
3. **B2 (advisory complexity classifier at DEFINE).** Does the advisory framing risk training operators to skip phases by default? How does it sit against Rule 20?
4. **B3 (MCP finder sub-scope).** What is the failure mode when an operator approves an MCP server that turns malicious? Does the sub-scope need a stronger trust boundary than `tool_use.repo_context`?
5. **B4 (local-first provider).** Generic `LocalOpenAIProvider` enough, or does Ollama merit a dedicated adapter? Demand-gate it to PE-2, or leave it out entirely until v0.2?
6. **Per-turn routing.** Code-oz binds role to phase; agenticSeek picks per turn. Are we leaving capability on the table inside the Reviewer panel slot selection or the M15 debate scheduler?
7. **Safety differential.** Would adding the substring denylist on top of the permission manifest be measurably safer, or is it noise that produces false positives without changing the threat model?

## Bonus questions (answer only if you have a strong opinion)

8. **Memory compression.** agenticSeek runs a LED summarizer over conversation history. Code-oz uses `events.jsonl` + per-phase artifacts. Is there a load-bearing case for adding a summarizer between phases for very long runs?
9. **Re-planning vs. restart-on-fail.** Are dynamic re-planning and VERIFY-fail restart actually equivalent under the hood, or do they catch different failure classes?
10. **Front-end gap.** A React UI is off-mission for v0.1. Is it off-mission for v0.2 once the non-tech-user DEFINE flow is in production, or does the CLI plus W3-lite native binary cover that surface?

## Output format

Plain Markdown. Headings per question. Two final sections at the bottom:

- **Verdicts I would change.** Borrow candidates I would promote, demote, or kill, with one sentence each.
- **Blind spots Opus missed.** Anything not in the seven open questions that bites later if ignored.

## Codex model fallback

`gpt-5.5` at `xhigh`, sandbox `read-only`. The `gpt-5.5-codex` and `gpt-5.1-codex-max` variants do not work on the operator's ChatGPT-account auth — fall back to `gpt-5.5` if those fail.
