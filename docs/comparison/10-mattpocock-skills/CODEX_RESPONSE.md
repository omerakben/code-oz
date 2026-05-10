# Codex response - Matt Pocock `skills` comparison

## 1. Independent verdict

Partially agree with "YES, with selective borrows." The comparison is directionally right that this template is useful for vocabulary discipline and day-to-day engineering heuristics, not for runtime architecture. But I disagree with the borrow budget and milestone target.

The material corrections:

- Several claimed "zero authority cost" borrows are not zero-cost if code-oz intends to enforce them. B2 and B5 touch VERIFY/BUILD behavior, not just wording. B6 touches an AUDIT contract that does not exist yet.
- B1 is a stronger borrow than the comparison states, but the proposed `state/GLOSSARY.md` shape loses the main upstream value: Matt's `CONTEXT.md` is project-scoped and reused across sessions, not just run-scoped. See `/Users/ozzy-mac/Projects/agents/templates/skills/skills/engineering/grill-with-docs/SKILL.md:20-52` and `CONTEXT-FORMAT.md:49-77`.
- "Bundle all six in M17" conflicts with current code-oz planning. `docs/design/SESSION_M16_KICKOFF.md:55-75` says M17 is SHIP.md, runShip, resume, and intervention-resolve. `docs/design/ROADMAP.md:406-408` defers full AUDIT depth to W4. Do not repurpose M17 as a vocabulary pass without reopening that plan.

Verdict on the comparison itself: useful, but fix-first before synthesis.

## 2. Per-borrow review

| ID | Verdict | Rationale |
|---|---|---|
| B1 project glossary | Modify, keep high | Borrow the glossary, but not as `state/GLOSSARY.md`. Matt's pattern is durable root `CONTEXT.md` or multi-context `CONTEXT-MAP.md`, created lazily and consumed by later work. A run-local state artifact will not solve terminology drift across runs. Start with `.code-oz/artifacts/GLOSSARY.md` plus an explicit opt-in promotion path to root `CONTEXT.md`, or go directly project-scoped if the user approves. Include term, definition, avoid aliases, flagged ambiguities, and optional relationships. Defer example dialogue unless token pressure is low. |
| B2 feedback-loop primacy | Modify, keep high | If enforced, this is a contract change. Current VERIFY is orchestrator-owned evidence execution: the persona authors only rationale/failure summary/constraint, while command/evidence/verdict are computed (`docs/contracts/VERIFY.md:11-14`, `src/prompts/verify-system.md:31-52`). Matt's "do not proceed until you have a loop" rule (`diagnose/SKILL.md:12-51`) belongs earlier: PLAN must name the feedback loop per task, BUILD records it, VERIFY executes and reports quality. |
| B3 deep-modules vocabulary | Modify, keep medium-low | Keep as a reviewer reference, not a finding schema or strict parser surface. Upstream says "Use these terms exactly" and rejects substitutions like "boundary" (`LANGUAGE.md:1-4`, `LANGUAGE.md:49-53`). That strictness can help, but in cross-family panel mode it should guide language, not invalidate otherwise good reviewer output. |
| B4 3-true ADR gate | Modify, keep medium | Good heuristic. Do not put it in SOURCE_CHECK. SOURCE_CHECK is about spec/reference/docs evidence (`docs/contracts/SOURCE_CHECK.md:5-13`), not target-project decision recording. Put it in DEFINE/PLAN prompt guidance and only write target repo ADRs when the PLAN task explicitly includes that file scope. |
| B5 tagged debug instrumentation | Modify, keep small | Useful, but the proposed VERIFY cleanup command is wrong for code-oz. VERIFY does not mutate the worktree and its execute scope is the test runner, not arbitrary cleanup (`docs/contracts/VERIFY.md:127-160`). BUILD should use a collision-resistant prefix like `[CODEOZ-DEBUG-<runId>]`; VERIFY can search changed files via repo_context and fail if the prefix remains. |
| B6 AUDIT provenance prefix | Reject for now | The source pattern is for issue-tracker comments (`triage/SKILL.md:8-14`), not internal artifacts. Also, `docs/contracts/AUDIT.md` is absent and full AUDIT is W4. Revisit when AUDIT or external issue posting exists. If borrowed later, use a top-level provenance note in AUDIT.md and an external-comment disclaimer when posting to GitHub/Linear, not a per-finding `AUDIT-<runId>` prefix. |

## 3. No-borrow review

| ID | Verdict | Rationale |
|---|---|---|
| N1 prototype | Keep no-borrow as phase | Do not add a prototype phase. The upstream skill explicitly creates throwaway code and says to delete or absorb it later (`prototype/SKILL.md:8-30`). That conflicts with code-oz's gate-driven artifact flow unless scoped as a human-triggered DEFINE exploration. |
| N2 caveman | Keep no-borrow, allow measured experiment later | Do not use caveman text in canonical artifacts or inter-agent contracts. The skill drops articles/filler and persists across turns (`caveman/SKILL.md:10-20`), which is hostile to parser-stable Markdown. A POC is acceptable only on non-authority summaries, measuring token delta, parser failures, semantic loss, and task success across identical fixtures. |
| N3 to-prd | Modify no-borrow | SPEC.md does not actually include long user stories; it has goals/users/constraints/acceptance/open questions/non-goals (`docs/contracts/SPEC.md:73-87`). Still, a PRD issue template is not needed now. Defer the "synthesize current context, do not re-interview" pattern to future GitHub/Linear export. |
| N4 zoom-out | Modify no-borrow | REPO_CONTEXT is a permissioned search tool, not the same as the `zoom-out` intent. The upstream skill is a tiny command to produce a module/caller map (`zoom-out/SKILL.md:1-7`). Defer as an AUDIT/PLAN prompt affordance, not a runtime primitive. |
| N5 triage | Modify to deferred-with-trigger | The state machine does not map cleanly to current AUDIT, but it maps well to future issue export and AFK work intake: `ready-for-agent`, `ready-for-human`, `needs-info`, `wontfix` (`triage/SKILL.md:21-40`). Revisit with W3 issue integrations or W4 AUDIT. |
| N6 setup-matt-pocock-skills | Modify no-borrow | `code-oz init` is not equivalent to Matt's setup. Matt configures issue tracker, triage labels, and domain docs (`setup-matt-pocock-skills/SKILL.md:9-15`, `:61-69`). Defer until project-scoped glossary or issue integration lands. |
| N7 write-a-skill | Modify no-borrow | code-oz is not a skills repo, but the meta-guidance is relevant to persona/agent-pack authoring. The strongest borrow is "description is the only thing the agent sees when deciding to load a skill" and "split files when SKILL.md exceeds 100 lines" (`write-a-skill/SKILL.md:60-75`, `:100-117`). Defer to a persona-authoring guide, not runtime. |

## 4. Per-debate-prompt review

**Q1 - Borrow count and authority budget.** I do not buy the "4 of 6 are zero-cost" claim. Prompt edits are zero-cost only when they remain advisory. B2 becomes contract authority if VERIFY/PLAN must prove a feedback loop. B5 becomes runtime authority if VERIFY must grep and fail on debug residue. B6 is a contract change against an unimplemented contract. If this lands in two milestones, put B1+B4 in one "domain language and decision-recording" milestone after M17, and put B2+B5 in a separate "validation-loop discipline" milestone.

**Q2 - B1 glossary.** Separate artifact beats SPEC section. SPEC is strict, six-section, bullets-only (`docs/contracts/SPEC.md:73-87`), and a glossary will either bloat it or weaken validation. But run-scoped state is too weak. Use durable project context with opt-in root promotion. Include flagged ambiguities from upstream v1 because ambiguity resolution is the point (`CONTEXT-FORMAT.md:34-47`).

**Q3 - B2 feedback loop.** Correct version is a contract change, not a prompt nudge. The new field should probably live on PLAN task or BUILD validation command metadata, not VERIFY.md, because VERIFY executes what BUILD recorded. A reference appendix is fine, but the canonical enforcement should be "each task names the fastest deterministic feedback loop and why it is enough."

**Q4 - B3 vocabulary.** Do not defer solely because some models might choke. Cross-family reviewers can handle narrow vocabulary if it is presented as definitions. But do not make exact term usage a parser rule. Keep it as `ARCHITECTURE_LANGUAGE.md` guidance and measure whether panel disagreements increase or decrease after introduction.

**Q5 - N2 caveman.** Run the experiment only if token cost is an observed bottleneck. Measurement contract: same fixture, same providers, full-prose vs compressed non-authority summaries, record token delta, wall time, parser failures, artifact validation failures, reviewer score, and semantic-equivalence rating. Never caveman canonical Markdown.

**Q6 - N5 triage.** AUDIT findings should eventually have disposition, but not Matt's issue-tracker labels verbatim. Future code-oz states should be closer to: `needs-info`, `plan-ready`, `human-required`, `out-of-scope`, `accepted-risk`. The upstream `ready-for-agent` and agent-brief discipline is more relevant to issue export than brownfield AUDIT (`triage/AGENT-BRIEF.md:1-36`).

**Q7 - Strategic risk.** The philosophical disagreement matters, but it does not imply `--ad-hoc`. code-oz's product thesis is process ownership. The risk Matt exposes is not "too much process"; it is opaque process that users cannot debug. The right mitigation is preview, pause, intervention, artifact editability, and explicit escape points. A gate-skipping mode would blur the category and weaken the proof story.

## 5. Missed risks

**Block now:** The comparison assumes `AUDIT.md` has a current contract. It does not. There is an artifact map entry (`src/state/schemas.ts:28-39`) and a future W4 roadmap item (`docs/design/ROADMAP.md:406-408`), but no `docs/contracts/AUDIT.md`. B6 and N5 should not be synthesized as current AUDIT edits.

**Block next milestone:** M17 is already scoped to SHIP/resume/intervention resolution (`docs/design/SESSION_M16_KICKOFF.md:55-75`). Do not silently turn it into a six-borrow vocabulary pass.

**Block next milestone:** B2 and B5 need an enforcement design. Advisory prompt text will not change gate quality; enforced text changes PLAN/BUILD/VERIFY contracts.

**Nit:** The comparison says to put B4 in SOURCE_CHECK. That mixes evidence provenance with target-project decision recording.

## 6. Final ranking

1. B1 modified - durable project glossary with opt-in root `CONTEXT.md` promotion.
2. B2 modified - feedback-loop declaration in PLAN/BUILD/VERIFY contracts.
3. B4 modified - ADR offer gate in DEFINE/PLAN prompts, no SOURCE_CHECK coupling.
4. B5 modified - CODEOZ debug prefix plus changed-file residue check.
5. B3 modified - architecture vocabulary reference for REVIEW, advisory only.
6. N5 reclassified - deferred issue/finding disposition state.
7. N4 reclassified - deferred zoom-out map affordance.

Rejected for now: B6, N1, N2, N3, N6, N7.

## 7. Push verdict

fix-first

Do not adopt the current COMPARISON.md borrow set as written. Synthesis should correct the M17 conflict, reclassify B2/B5 as contract/runtime design work, remove B6 from current scope, and replace "AUDIT.md freeform today" with the actual current state: AUDIT is mapped but not contracted or implemented.
