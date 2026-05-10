---
name: checklists
companion-docs: docs/contracts/SPEC.md, docs/contracts/PLAN.md, docs/contracts/SCIENTIST.md
target: deterministic DEFINE-gate and PLAN-gate advisory checklists
status: v0.1 advisory rubric only
---

# CHECKLISTS (v0.1)

Contract for deterministic DEFINE-gate and PLAN-gate review checklists. These checklists are static yes/no rubrics. They do not call an LLM, do not create a persona, do not add a permission scope, and do not add a new authority axis.

In v0.1 they are advisory only. They exist so personas and reviewers can cite the same concrete gap language before any blocking preflight is justified.

## Boundary

The checklists sit beside the existing contracts:

- DEFINE is still governed by `docs/contracts/SPEC.md`.
- PLAN is still governed by `docs/contracts/PLAN.md` and `docs/contracts/SOURCE_CHECK.md`.
- The Scientist tail is still governed by `docs/contracts/SCIENTIST.md`.

The checklist is a sibling discipline to the Scientist tail. Scientist captures hypotheses and open questions. CHECKLISTS captures static gate-readiness questions for SPEC.md and PLAN.md. Neither one replaces the other.

## DEFINE-gate checklist

Use this against `.code-oz/artifacts/SPEC.md` before approving DEFINE. Every item is yes/no.

| Item | Yes/no check |
|---|---|
| D1 | Does `## Goals` state the concrete outcome, not just an activity label? |
| D2 | Does `## Users` name who uses the result and what they need from it? |
| D3 | Does `## Constraints` name technical, product, time, privacy, or operating limits that shape the work? |
| D4 | Does `## Acceptance criteria` contain verifiable outcomes that can be checked later? |
| D5 | Does `## Explicit non-goals` exclude at least one plausible scope creep path? |
| D6 | Does `## Open questions` either name unresolved questions or explicitly say none are known at define time? |
| D7 | Does the run path match the locked classification contract: greenfield enters DEFINE, while brownfield or existing-code work enters AUDIT before PLAN (`CLAUDE.md` rule 14; `ROADMAP.md` "Locked decisions" 3)? |
| D8 | For every named dependency, external system, provider account, or human approval mentioned in SPEC `## Goals` or `## Acceptance criteria`, is the same noun also present in `## Constraints` or `## Open questions`? |
| D9 | Is the main risk or hard tradeoff visible enough that PLAN can reason about it instead of discovering it during BUILD? (advisory only - promotion would need a different mechanical test) |
| D10 | Is there a rollback or stop condition for the intended change, even if the rollback is "do not ship" for a greenfield artifact? (advisory only - promotion would need a different mechanical test) |
| D11 | Are assumptions stated as assumptions rather than silently converted into requirements? (advisory only - promotion would need a different mechanical test) |

Source basis: `docs/contracts/SPEC.md` required fields, `CLAUDE.md` rule 14, `docs/design/ROADMAP.md` "Locked decisions" 3, plus Mimir Ecko's gap-analysis structure: intent, missing information, technical challenges, decision points, and success criteria.

## PLAN-gate checklist

Use this against `.code-oz/artifacts/PLAN.md` and `.code-oz/artifacts/SOURCE_CHECK.md` before approving PLAN. Every item is yes/no.

| Item | Yes/no check |
|---|---|
| P1 | Does each task have one atomic, independently testable outcome? |
| P2 | Does each task name exact file targets with change kind where available? |
| P3 | Does each task include one validation command or an explicit none-available rationale? |
| P4 | Does each task include a risk note, even when the risk is `none`? |
| P5 | Does each task cite source ids from `SOURCE_CHECK.md` rather than prose-only evidence? |
| P6 | Does `SOURCE_CHECK.md` preserve the 3-source trace: spec source, reference source or none-found rationale, and library/docs source or no-library rationale? |
| P7 | Does each task cite relevant hypotheses or explicitly say `none` when no hypothesis is attached? |
| P8 | For each task with a `Files:` entry marked `deleted`, does `Risk:` include `rollback`, `revert`, or `abort`; tasks without `deleted` pass this item? |
| P9 | Does `## Out of scope` carry forward SPEC non-goals plus any PLAN-specific exclusions? |
| P10 | Does the plan name a scope-cut option that preserves a useful result if time, cost, or provider budget tightens? (advisory only - promotion would need a different mechanical test) |
| P11 | Do open questions either map to `OPEN_QUESTIONS.md` ids or explicitly say none are known at plan time? |
| P12 | Does `## Tasks` contain only `### T-NNN` task blocks, and does every task block include the five locked bullets (`Files`, `Validation`, `Risk`, `Hypotheses`, `Sources`)? |

Source basis: `docs/contracts/PLAN.md`, including the `Files:` change-kind grammar, `docs/contracts/SOURCE_CHECK.md`, and Mimir Ecko's deliverable-enumeration structure: concrete outputs with format, content, purpose, and downstream use.

## Promotion gate

The checklist is advisory in v0.1. It is promoted to a blocking preflight only after evidence exists.

Promotion requires all of these:

1. At least one DEFINE-gate or PLAN-gate failure is identified in `events.jsonl` history.
2. The failure occurred late enough that an earlier checklist pass would have reduced wasted work or review loops.
3. The failed condition maps to a specific checklist item above.
4. The proposed blocking check is deterministic and does not require an LLM judgment.
5. The promotion is documented in the relevant contract before code changes land.

Synthetic examples are not enough for promotion. A fixture may prove parser behavior after promotion is approved, but the justification must start from real run history.

If the evidence exists for only one gate, only that gate may become blocking. DEFINE evidence does not justify PLAN blocking checks, and PLAN evidence does not justify DEFINE blocking checks.

## How to use today

In advisory mode:

- A persona prompt may reference this checklist as a rubric.
- A human reviewer may cite checklist item ids in `REVIEW.md`.
- A Codex or Claude review may say, for example, "PLAN misses P6."
- Gate preflight does not consume this file.
- `code-oz approve define` and `code-oz approve plan` do not change verdict behavior because of checklist results.
- A failed checklist item does not block a gate unless an existing contract already blocks it.

This keeps the checklist useful without adding hidden authority. The parser contracts remain the gate contracts.

## Non-authority rule

Checklist language must not create a new persona or a new decision-maker. In particular:

- No "Prompt Architect" persona is introduced.
- No generated prompt is handed to BA or Lead as a canonical artifact.
- No checklist verdict is stored as a gate signal.
- No checklist item can override `SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, or the Scientist sidecars.
- No LLM call is made to score the checklist.

If future work promotes an item to blocking preflight, the implementation belongs in the existing gate-preflight path for that phase and must cite the historical `events.jsonl` failure that justified it. Promotion consumes that milestone's `CLAUDE.md` rule-20 authority budget; it is not free and costs the same as any other new authority axis.

## Reference

- Source decision: `docs/comparison/11-mimir/SYNTHESIS.md` section "B5".
- Mimir source pattern: `/Users/ozzy-mac/Projects/agents/templates/Mimir/docs/agents/v2/00-ecko-preamble.md:11-18` and `:77-122`.
- Related code-oz contracts: `docs/contracts/SPEC.md`, `docs/contracts/PLAN.md`, `docs/contracts/SOURCE_CHECK.md`, `docs/contracts/SCIENTIST.md`.
- Borrowed checklist structure only. No code dependency.

Pinned 2026-05-10 from the Mimir comparison.
