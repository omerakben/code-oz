# Synthesis — agent-skills borrow + product thesis (2026-04-30)

**Date:** 2026-04-30
**Resolved by:** Ozzy (pending) + Claude Opus 4.7
**Inputs:**

- [`CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`](./CODEX_BRIEFING_AGENT_SKILLS_BORROW.md) → [`CODEX_RESPONSE_AGENT_SKILLS_BORROW.md`](./CODEX_RESPONSE_AGENT_SKILLS_BORROW.md) (thread `019de02f`)
- [`CODEX_BRIEFING_PRODUCT_THESIS.md`](./CODEX_BRIEFING_PRODUCT_THESIS.md) → [`CODEX_RESPONSE_PRODUCT_THESIS.md`](./CODEX_RESPONSE_PRODUCT_THESIS.md) (thread `019de031`)

This is Claude's read on Codex's read. It is not a `DECISION.md`. The user's approval converts the recommended path into actionable commits. Where Claude leans against Codex, that is flagged explicitly. Where Codex pushed harder than Claude, that is flagged too.

---

# Topic 1 — borrowing patterns from agent-skills

## What is locked (both sides agree)

- The borrow is patterns, not code; no submodules, no copy-paste, clean-room paraphrase only.
- Rule 20 (one new authority boundary per milestone) protects M9 and M10 from scope expansion.
- Rule 16 (universal rules in every persona prompt) is non-negotiable. Any borrowed skills/discoverability layer is *additive* on top of universal rules.
- Rule 7 (Markdown contracts) means optional schema additions still carry parser/serializer/fixture cost; "optional" is not free.
- agent-skills (Addy Osmani, MIT) is an audited template; the leaked `claude-code-main` source is excluded.

## What Claude and Codex agree on (ready for commit when M9 starts)

| Decision                                                                                                            | Lands at                          | Surface                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reject per-phase Common Rationalizations table fork** (Proposal 3)                                                | n/a                               | Universal `common-rationalizations.md` stays single. M9 inlines 2–3 REVIEW-specific rebuttals directly into `review-system.md` if needed. No new doctor command.                                                                                          |
| **Borrow five-axis review structure as prompt-only scaffolding** (Proposal 1, modified)                             | M9                                | `src/prompts/review-system.md` (new file): universal rules first, reviewer identity, axes (correctness / readability / architecture / security / performance) as internal scaffolding. Severity enum unchanged. Findings format in `REVIEW.md` unchanged. |
| **Borrow "review tests first" ordering** (Codex pattern surface)                                                    | M9                                | Same `review-system.md` file. Reviewer reads tests before implementation; tests reveal intended behavior and verification gaps.                                                                                                                           |
| **`requestDebate()` is research-isolation, not parallel fan-out** (Proposal 2, modified)                            | M10                               | `docs/contracts/DEBATE.md` already implies one round-trip / one digest / mandatory `DECISION.md`. M10 implements as Pattern-5-shape, not Pattern-3. No new `## Pattern` section.                                                                          |
| **Source-driven citation discipline lands in PLAN persona, not in `SOURCE_CHECK.md` schema** (Proposal 4, modified) | post-M9 docs commit               | `src/prompts/plan-system.md` adds source-hierarchy + version-detection + conflict-surfacing language. `SOURCE_CHECK.md` grammar untouched (no `Hierarchy:` field).                                                                                        |
| **Skills layer architecture is post-M10, dedicated milestone, not W2 sidecar** (Proposal 5, modified)               | future milestone (M16+ candidate) | Defers until M9/M10 produce duplication pain. Until then, agent-skills patterns remain influence material in `CLAUDE.md`.                                                                                                                                 |

### Claude's read on the agreement

Codex's reframing is correct. The clean separation is **prompt-only borrows now (M9), schema/runtime borrows later (post-M10 in their own debate-and-commit cycles)**. The Proposal 1 → "axes inside the prompt, not the artifact" version is strictly better than the original because it preserves M9's schema stability while still tightening the review's cognitive scaffolding.

The "review tests first" lift is the strongest single Codex addition. It maps to a real failure mode — reviewers anchor on implementation style and miss the verification gap. Adding it to the prompt is two paragraphs of work and changes review quality non-trivially.

## Where Claude pushed harder than Codex

- **Codex rejected Proposal 3 entirely.** Claude leans agree but flags one residual: when post-M10 work materializes per-phase failures (e.g., "the BUILD persona ignored the simplicity-check 3 runs in a row"), the right move is to **strengthen the universal table**, not fork it. Per memory pin: "feedback memories save *why*"; the rationalizations table is a feedback layer for personas. Folding strong findings back into the universal one entry at a time keeps it short and authoritative.

## Where Codex pushed harder than Claude

- **The "skills as mandatory hops" rule-16 conflict** that Codex flagged as Critical was a risk Claude underestimated. Codex is right: agent-skills' opening line is "If a task matches a skill, you MUST invoke it" — that authority model competes with universal-rules.md if Skills land naively. The future Skills-layer milestone must explicitly state: universal rules load first, skills are *additive workflow shapes referenced by personas*, never authority overrides.
- **Codex's "false coverage" warning** on five-axis review is real. A REVIEW-lite pass through five axes can produce a false sense of security on the "security" axis when no security audit actually ran. The `review-system.md` prompt should explicitly say: "the security axis flags surface-level concerns; full security audit is W4 SHIP scope."

## User decision points (Topic 1)

1. **M9 commit plan accepted?** Write `src/prompts/review-system.md` with universal-rules-first + reviewer-identity + review-tests-first + five axes as internal scaffolding + REVIEW.md schema unchanged. (Claude lean: yes.)
2. **Reject Proposal 3 (per-phase rationalizations) entirely?** (Claude lean: yes; revisit only if a per-phase failure surfaces evidence the universal table is failing.)
3. **Add a future-milestone slot for the Skills layer architecture?** (Claude lean: yes, but the slot stays unnamed/untimed until the post-M10 sequence settles. Roadmap-only annotation.)
4. **Land source-driven citation language in `plan-system.md` as a separate post-M9 commit?** (Claude lean: yes, low-risk one-file edit.)

---

# Topic 2 — `code-oz` AI software company thesis

## What is locked (both sides agree)

- The product north-star *thesis* is right: single-model confidence is not enough for production work; multi-provider coordination through artifacts, evidence gates, debate, and cross-family review is the wedge.
- M9 = REVIEW-lite (cross-family REVIEW authority). M10 = Debate runtime (`requestDebate()` authority). Neither expands to fit the thesis.
- Rule 20 (one authority/milestone) is load-bearing.
- Rule 2 (cross-family review at REVIEW gate) is non-negotiable.
- Rule 13 (privacy) and rule 19 (run-level budgets) extend to any post-M10 multi-provider surface.
- Provenance policy (no `claude-code-main` borrow) stays.
- Hosted SaaS is post-v1.0; v0.1 is repo-native CLI offline-first.

## What Claude and Codex agree on (recommended for adoption)

### Positioning

- **External category: "repo-native agentic SDLC runtime."** "AI software company runtime" is the *internal metaphor* and tagline only. Buyers pattern-match "AI software company" onto research projects (ChatDev, MetaGPT) rather than production tooling. The metaphor is evocative but mis-locates the buyer.
- **Strongest one-line wedge:** "`code-oz` is the repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship." (Codex's exact wording, Claude endorses.)
- **README primary pitch:** "Run coding agents through an auditable SDLC from your terminal." Tagline-only: "Run an AI software company from your terminal."
- **Single positioning trap to reject explicitly:** *Company cosplay*. Human-sounding roles, exec personas, panels, and parallel workers that exist because the metaphor sounds compelling rather than because they reduce risk.

### Product principles update

- **Replace** principle #1: "Do not trust a model. Trust the process." → "Trust evidence and bounded process over model confidence." (Sharper, more honest, doesn't elide that the process includes models.)
- **Add** principle #11 (candidate rule #21): "No new parallel-provider surface without measurable risk-reduction effect in `events.jsonl` against the simpler-baseline." (Mitigates Agentless caution drift.)
- **Add** principle: "Provider neutrality means capability-aware routing, not interchangeability." (Mitigates Codex's Critical risk on provider asymmetry.)

### Post-M10 roadmap (Codex's M11–M15 sequence supersedes Claude's earlier draft)

| Milestone | Authority boundary (single, per rule 20)                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M11       | **Provider capability contract.** Capability/auth/cost traits per provider; load-time rejection of impossible role assignments. No new roles.                                                               |
| M12       | **Company roster for shipped roles only.** BA + Lead + Builder + Verifier + Reviewer + Scientist + Debate opponent + Orchestrator. Maps roles to providers. No Researcher, no panels, no parallel builders. |
| M13       | **Role-cost policy under `budgets.global`.** Per-role budget gating + preflight estimates. Must precede any simultaneous-provider surface.                                                                  |
| M14       | **Reviewer panel v1.** First simultaneous-provider surface. Panel quorum + cross-family enforcement (same-family panelists are advisory only) + synthesis.                                                  |
| M15       | **Debate-policy scheduler v1.** Automatic-trigger policy for the existing single-opponent `requestDebate()`. *Not* multi-opponent debate.                                                                   |

Codex caught two rule-20 violations hiding in Claude's earlier draft:

- Claude's M11 bundled roster + config schema + per-role policy + role-cost (4 boundaries).
- Claude's M12 added Researcher (an unshipped role) before the company roster proves out with shipped roles.
- Claude's parallel-builders proposal at M14 actually bundled three boundaries (parallel worktrees + candidate selection + tournament-judging Reviewer).

The Codex sequence sequences these correctly: capability *first*, roster *second*, cost *third*, simultaneous-provider *only after the cost story is solid*, scheduler *last*.

## Where Claude pushed harder than Codex

- **The Researcher role is real**, not a metaphor artifact. Codex defers it indefinitely; Claude leans toward landing it as M16 (post-M15). The empirical reason: source verification today is a Lead-persona responsibility (PLAN phase) but the source-hierarchy + version-detection + conflict-surfacing borrow from Topic 1 implies a wider research surface than the Lead persona should own. Researcher-as-phase-tail (sibling to Scientist) is a clean way to decouple. **Suggestion:** add Researcher to the post-M15 row but explicitly mark "deferred until measurable need."
- **Parallel builder candidates** were rejected as a near-term surface by Codex. Claude leans agree for v0.2 — but flags that *one* downstream user-driven scenario justifies revisiting: **prompt-injection / supply-chain spoofing detection**. If a single-builder run is ever compromised by malicious tool output, two competing builders from different families would catch the divergence. This is a security wedge that may justify M17+ work but is not v0.2 priority.

## Where Codex pushed harder than Claude

- **The "trust the process overclaims" reframing** is sharper than Claude originally proposed. The thesis used "Don't trust a model. Trust the process." Codex's "Trust evidence and bounded process over model confidence" is more honest — the process includes models, so the original framing collapses on inspection.
- **The "company cosplay" trap** is a stronger formulation than Claude's "noisy swarm" framing. "Cosplay" names the failure mode precisely: roles that exist because the metaphor wants them, not because they reduce risk.
- **The Reviewer-panel cross-family-laundering risk** (same-family panelist satisfying rule 2 by majority vote) is a structural risk Claude missed. M14's contract must explicitly say: same-family panelists are advisory; cross-family quorum is required for `verdict: ready`.
- **The artifact-volume-ceremony risk** generalizes. Every artifact must have a consumer, a validator, and a decision it changes. This is a candidate for a 22nd universal rule but probably belongs as a soft principle in the thesis rather than an absolute rule.

## User decision points (Topic 2)

1. **Adopt "repo-native agentic SDLC runtime" as external category?** (Claude lean: yes, in `README.md` and `CLAUDE.md` "What this project is" sentence. Keep "AI software company" as the metaphor and tagline.)
2. **Add candidate rule #21:** "No new parallel-provider surface without measurable risk reduction in `events.jsonl` against the simpler baseline." (Claude lean: yes. This is the strongest Agentless-drift mitigation and converts the thesis principle into a non-negotiable.)
3. **Add candidate rule #22:** "Provider neutrality means capability-aware routing, not interchangeability." (Claude lean: yes if the user is willing to grow the rules table; otherwise fold into the thesis's "What it is" section.)
4. **Replace product principle #1?** "Don't trust a model. Trust the process." → "Trust evidence and bounded process over model confidence." (Claude lean: yes. The new wording is more honest and survives Codex pressure.)
5. **Adopt the M11–M15 post-M10 sequence?** Provider capability → roster (shipped only) → role-cost → reviewer panel → debate scheduler. (Claude lean: yes. Codex's sequence explicitly fixes the rule-20 violations Claude introduced.)
6. **Apply Codex's concrete edits to `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`?** Section-by-section: thesis, what it is, what it is not, company roles, product promise, why use it, market context, research context, differentiation, product principles, roadmap placement, open questions for debate. (Claude lean: yes, in a single follow-up commit; Codex's edits are tight and tighten the doc against the trap.)
7. **Replace `ROADMAP.md` post-M10 bullet list with the M11–M15 sequence?** (Claude lean: yes. Aligns roadmap with the sharpened thesis.)
8. **Keep the existing draft at `docs/design/CODEX_BRIEFING_PRODUCT_THESIS.md`?** Or delete in favor of `docs/research/CODEX_BRIEFING_PRODUCT_THESIS.md`? (Claude lean: delete the design/ draft; the research/ file is the authoritative briefing per the cross-model peer review pattern.)

---

# Cross-topic — what touches both

- **The "review tests first" prompt borrow** (Topic 1) and **Reviewer panel v1** (Topic 2 / M14) compose: panel reviewers all read tests first. The rule lands now in `review-system.md` and is inherited automatically when M14 widens to a panel.
- **Source-driven citation discipline** (Topic 1 Proposal 4) and **Researcher role** (Topic 2 deferred to M16) compose: when Researcher lands, it inherits the citation-hierarchy + version-detection + conflict-surfacing language already deposited in `plan-system.md`. No re-borrow needed.
- **Skills-layer architecture** (Topic 1 Proposal 5, deferred) and **post-M10 productization** (Topic 2 M11–M15) compete for milestone slots. Recommendation: thesis productization (M11–M15) ships first; Skills layer becomes M16 or M17 depending on whether duplication pain has surfaced by then.

---

# Suggested next-action ordering

In rough priority. The user picks; this is just Claude's read after the debates closed.

1. **Apply concrete edits to `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`** (decision points 6 + 1 + 4). Single doc commit. No code change.
2. **Update `CLAUDE.md`** with: external category line, post-M10 row update with M11–M15 sequence, candidate rules #21 (and #22 if accepted). Single doc commit.
3. **Update `README.md`** primary pitch + tagline (decision point 1). Single doc commit.
4. **Update `ROADMAP.md`** post-M10 section to the M11–M15 sequence (decision point 7). Single doc commit.
5. **Delete or merge `docs/design/CODEX_BRIEFING_PRODUCT_THESIS.md`** (decision point 8). Cleanup commit.
6. **Commit the synthesis cycle artifacts** (this file plus the briefings/responses) on the current `docs/product-thesis` branch. The artifacts are the audit trail.
7. **At M9 kickoff** (next session): write `src/prompts/review-system.md` per the agreed Topic-1 plan. Plumbed into M9's Codex briefing as a sub-decision rather than a debate of its own.
8. **At M10 kickoff:** the briefing pins `requestDebate()` shape as research-isolation per Topic 1 Proposal 2's M10 sub-decision. No new artifact section.
9. **post-M9 standalone commit** (low priority): land source-driven citation language in `plan-system.md`.
10. **At M11 design time** (post-M10): write the provider-capability contract and re-debate.

Steps 1–6 are docs commits with no code change and no test impact. They are safe to land on `docs/product-thesis` immediately and merge without reopening M8.

Steps 7–10 are subsequent-session commits, each with their own Codex pre-debate per CLAUDE.md rule 7.
