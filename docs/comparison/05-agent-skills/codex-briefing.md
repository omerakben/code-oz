# Codex briefing — agent-skills comparison round 2

**Date:** 2026-05-10
**Caller:** Claude Opus 4.7 (xhigh) + Ozzy
**Target:** Codex `gpt-5.5` xhigh, sandbox: read-only
**Prior round:** [`docs/research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`](../../research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md) (2026-04-30, thread `019de02f`)
**Companion:** [`comparison.md`](./comparison.md), [`codex-response.md`](./codex-response.md), [`synthesis.md`](./synthesis.md)

---

You are GPT-5.5 at xhigh effort, sandbox read-only, debating Claude Opus 4.7 on a borrow audit between code-oz (the user's project) and the agent-skills template. The April 30 round (~11 days ago) closed five proposals; eleven days and seven milestones (M9–M16) have shipped since.

## Read in this order

1. `docs/comparison/05-agent-skills/comparison.md` — Claude's comparison + verdict for THIS round. The decision prompts you must answer are in section 9.
2. `docs/research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`, `docs/research/CODEX_RESPONSE_AGENT_SKILLS_BORROW.md`, `docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md` — the April 30 audit trio you authored / Claude synthesized. This is the prior debate. Treat your earlier verdicts as data, not as binding.
3. `CLAUDE.md` — non-negotiable rules (1–21). Rule 20 (one new authority per milestone) is load-bearing. Rule 21 (no new parallel-provider surface without measurable risk-reduction) is load-bearing.
4. `src/prompts/review-system.md` — the M9 borrow result (verify it actually landed the patterns the synthesis claimed).
5. `src/prompts/plan-system.md` — confirm Proposal 4 (source-driven citation language) did NOT land.
6. `~/Projects/agents/templates/agent-skills/skills/doubt-driven-development/SKILL.md` — the skill section 6.2 of the comparison wants to evaluate.
7. `~/Projects/agents/templates/agent-skills/references/orchestration-patterns.md` — to validate code-oz's claim that catalog-as-runtime is unnecessary.
8. `~/Projects/agents/templates/agent-skills/skills/source-driven-development/SKILL.md` — to size the Proposal 4 borrow accurately.

## Pressure-test five claims

1. Section 5 claims code-oz now structurally exceeds agent-skills on seven authorities. Did Claude miss an axis where the template still has the better answer?
2. Section 6.1 recommends landing Proposal 4 (source-driven citation language in `plan-system.md`) now. Is the cost actually 30 lines, or am I underpricing the prompt-discipline ripple? Is there a hidden interaction with the SOURCE_CHECK schema?
3. Section 6.2 (doubt-driven). The April 30 round didn't cover this proposal. Read the agent-skills `doubt-driven-development` skill verbatim. Is the right shape (a) an orchestrator skill referenced from BUILD, (b) a Doubter phase-tail sibling to Scientist, or (c) something neither captures? What's the rule-20 cost?
4. Section 6.3 (Skills layer). The April 30 deferral rationale was "until duplication pain surfaces, keep skills as influence material." Has it surfaced? If yes, what's the smallest viable initial roster — fewer than the proposed five? If no, what's the trigger condition that would change the answer?
5. Section 7 lists six patterns to NOT borrow. Did Claude miss one we should reconsider, or include one we should reconsider keeping?

## Return as ONE Markdown document with this structure

```
# Response — agent-skills comparison round 2

## Verdict per claim
(One verdict per the five claims: agree / agree-with-modifications / disagree / reframe + one-paragraph rationale each.)

## Single highest-leverage borrow we should land first
(Name the file, name the diff shape, name the rule-20 cost.)

## Single borrow we should reject (or "land all three")
(Out of the three pending: source-driven-citation, doubt-driven, Skills layer. If all three should land, say so and order them.)

## One pattern from agent-skills we have not surfaced in this comparison
(Apply the same lens as April 30. What did Claude miss this time?)

## What you would have done differently if you were Claude
(One paragraph. Most valuable signal.)

## Honest answer: is the Skills layer worth shipping at v0.18?
(Yes / No / Conditional, with the trigger condition if conditional. If you are reversing your April 30 verdict, state the rule-20 cost.)

## Risks Claude is missing
(Bullet list, severity-ranked. Especially: ways the borrow plan accidentally undermines rule 20, rule 16, rule 18, or rule 7.)

## Anything you want to flag that the prompt did not ask for
(Optional. Use only if it materially changes Claude's verdict.)
```

## Calibration

- The user (Ozzy) is at v0.17.0-alpha.0 with 3108 tests passing.
- Per memory pin "milestone-level e2e is non-negotiable for state-machine work": M16 caught 12 production bugs (8 from C12 e2e + 4 from R1) that survived per-commit Codex review. Doubt-driven might address this; weigh accordingly.
- Per memory pin "Rule 20 needs sharper application — count sub-surfaces": M16 C9 bundled 6 sub-surfaces under one authority label and 8 production bugs survived. Apply this lens when sizing the Skills-layer milestone.
- Treat your verdicts as data, not authority. Claude will weigh disagreement.
- If you think a borrow that already landed in M9/M10 should be reverted, say so explicitly with the rule-20 cost stated.
- Do not produce code patches. Markdown verdict only.
