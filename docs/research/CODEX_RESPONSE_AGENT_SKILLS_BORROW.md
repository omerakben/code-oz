# Response — agent-skills borrow audit

**Thread:** `019de02f-152d-7361-9f93-1aeed2ad6074`
**Date:** 2026-04-30
**Model:** `gpt-5.5` xhigh, sandbox: read-only
**Brief:** [`CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`](./CODEX_BRIEFING_AGENT_SKILLS_BORROW.md)

---

## Verdict per proposal

Proposal 1 (five-axis review) — accept-with-modifications: Land the five axes in `src/prompts/review-system.md` as the reviewer's thinking frame, plus the stronger "review tests first" ordering from agent-skills. Do not add `Axis:` to `REVIEW.md` in M9 unless the parser, serializer, fixtures, and repair path all land with it. M9's authority is cross-family review, not review-schema enrichment. Keep the code-oz severity enum unchanged.

Proposal 2 (orchestration-patterns catalog) — feature-with-modifications: The useful borrow is not a catalog, it is one M10 runtime decision: `requestDebate()` is research isolation, one opposing-provider round-trip, one digest, mandatory `DECISION.md`. Pattern 3 fan-out is the wrong default for M10 because debate is not a shipping panel. Do not add a new `## Pattern` artifact section that competes with the locked `DEBATE.md` schemas.

Proposal 3 (per-phase Common Rationalizations tables) — reject: This forks a small, universal discipline file into multiple prompt fragments before there is evidence the universal table is failing. It adds token load, drift risk, and a proposed `doctor rationalizations` command that is out of proportion to the value. For M9, put only the two or three REVIEW-specific anti-rationalizations directly inside `review-system.md` if needed.

Proposal 4 (source-driven citation discipline) — accept-with-modifications: Borrow the source hierarchy, version detection, and conflict-surfacing behavior into the PLAN persona, but keep `SOURCE_CHECK.md` grammar stable. The existing `Library`, `URL`, `Section`, and `Why` bullets already carry the evidence. A new optional `Hierarchy:` field is schema churn without enough payoff for v0.1.

Proposal 5 (skills layer architecture) — feature-with-modifications: The concept is real, but it should be a dedicated post-M10 authority milestone, not a W2 sidecar. A skills layer needs its own contract, loader behavior, prompt composition rules, permission boundaries, and rule-16 guarantees. Until M9/M10 produce repeated duplication pain, keep skills as influence material, not runtime architecture.

## Risks we are missing

- Critical: A borrowed catalog or skills layer can become a second authority beside `CLAUDE.md`, `REVIEW.md`, and `DEBATE.md`, violating rule 20 by smuggling governance into "reference" docs.
- Critical: Agent-skills' "skills are mandatory hops" model conflicts with rule 16 unless code-oz states that universal rules always load first and skills are additive only.
- High: REVIEW's `repo_context` scope has `maxFilesForNextManifest: 0`; five-axis security or architecture review must not imply the reviewer can silently expand into unrelated files.
- High: Adding optional bullets like `Axis:` or `Hierarchy:` still changes Markdown contract behavior. If the parser cannot round-trip them deterministically, rule 7 is weakened.
- High: M9 can quietly grow from REVIEW-lite into REVIEW-plus-rubric-plus-rationalizations-plus-audit. The axis prompt is cheap; the surrounding process is not.
- Medium: Five-axis review can create false coverage. A REVIEW-lite pass is not a full security audit or performance audit unless the contract says so.
- Medium: Source citation rules can imply live network lookups. v0.1 needs cached or permitted docs paths only, with no new web-search permission.
- Medium: Clean-room paraphrase still needs discipline. Do not copy agent-skills table text into prompts verbatim just because the license is clean.

## Single highest-leverage borrow we should land first

Touch `src/prompts/review-system.md`.

Diff shape: create the REVIEW persona prompt with universal rules first, then reviewer identity, then this process order: read SPEC/PLAN/BUILD_REPORT/VERIFY, review tests before implementation, evaluate changed files across correctness/readability/architecture/security/performance, emit only canonical `REVIEW.md` fields, and treat axes as internal review scaffolding rather than contract output.

This beats the other four because it directly improves M9's only new authority without adding a new schema field, loader, command, permission scope, or documentation hierarchy.

## Single borrow we should reject

Reject Proposal 3, per-phase Common Rationalizations tables.

The value is real but too small for the maintenance surface. The current universal table is short enough to stay loaded everywhere. Forking it by phase creates drift, raises token cost, and tempts a new validation command. M9 only needs REVIEW-specific discipline inside the REVIEW prompt.

## One pattern from agent-skills we have not surfaced

Borrow "review the tests first" from `skills/code-review-and-quality/SKILL.md` and `agents/code-reviewer.md`. M9's contract is strong on findings, severity, rounds, and provider separation, but it does not yet force review order. Tests reveal the intended behavior and the verification gap before the reviewer gets distracted by implementation style. This is a prompt-only improvement with high leverage and no schema impact.

## What you would have done differently if you were Claude

I would have separated "prompt-only borrows" from "contract/runtime borrows" before ranking proposals. The strongest plan is smaller: M9 gets review prompt discipline only, M10 gets a narrow debate-pattern decision only, and every optional schema field, rationalization fork, and skills-loader idea waits for a dedicated post-M10 decision. Claude's proposal correctly found good patterns, but it underpriced the authority cost of making those patterns visible in contracts.
