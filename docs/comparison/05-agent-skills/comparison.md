# code-oz vs agent-skills — comparison + verdict

**Date:** 2026-05-10
**Author:** Claude Opus 4.7 (xhigh)
**Template under review:** `~/Projects/agents/templates/agent-skills` — Addy Osmani, MIT
**code-oz state:** v0.17.0-alpha.0 (M16 closed), 3108 tests, 17 milestones shipped
**Prior round:** [`docs/research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`](../../research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md) (2026-04-30) — five proposals, three landed, one rejected, one deferred

This is a one-by-one comparison. The April 30 borrow audit closed five proposals; eleven days and seven milestones have shipped since, so the surface has shifted. Three questions drive this round:

1. Is code-oz now meeting its needs vs the template?
2. Where does code-oz structurally exceed it?
3. What pending borrows still earn their place at v0.17?

The verdict is at the bottom. Codex's response goes in `codex-response.md` and the final synthesis goes in `synthesis.md`.

---

## 1. What agent-skills is

A 22-skill pack (21 lifecycle skills + 1 meta) plus 3 personas, 7 slash commands, 4 reference checklists, and 2 hooks. Distributed as a Claude Code plugin and as plain Markdown that any agent harness can consume.

| Layer | Count | Purpose |
|---|---|---|
| Skills (`skills/<name>/SKILL.md`) | 22 | Workflows with steps, anti-rationalizations, verification |
| Personas (`agents/<role>.md`) | 3 | code-reviewer, security-auditor, test-engineer |
| Commands (`.claude/commands/`) | 7 | `/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship` |
| References (`references/`) | 4 | testing, security, performance, accessibility checklists |
| Hooks (`hooks/`) | 2 | sdd-cache (HTTP ETag revalidation), simplify-ignore (block protection) |

Three rules govern composition:

- **Skills are the *how*, personas are the *who*, slash commands are the *when*.**
- **Personas do not invoke other personas.** The user (or a slash command) is the orchestrator.
- **Parallel fan-out with merge** is the only multi-persona pattern endorsed. `/ship` is the canonical example.

The pack is opinionated and process-driven. Every skill follows the same anatomy: Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification.

---

## 2. What code-oz is

A standalone Bun + TypeScript CLI that orchestrates the same DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP lifecycle, but as a runtime — not as a prompt pack. The runtime owns:

- File-based gate signals (`GATE_<PHASE>_PASSED.json`, schema-validated, never LLM-text-parsed)
- Worktree isolation per BUILD attempt + patch contract
- Mutation gating in VERIFY (catches test tautologies)
- Restart-on-fail with 4-attempt cap + forensics preservation
- Cross-family REVIEW with the BUILD provider's family rejected at load time
- Debate runtime (`requestDebate()` as research-isolation pattern)
- Reviewer panel with same-family-advisory-only enforcement
- Debate-policy scheduler (M15)
- Provider capability contract + role-to-provider routing (M11/M12)
- Run-level budgets (cumulative, read from `events.jsonl`, soft warn at 0.75)
- Resume after termination (idempotent gate writes, `runId`-scoped state)
- Privacy by default (file manifests, no recursive context, secret redaction)
- Provider neutrality via OAuth tokens from disk (Claude / Codex / Gemini) plus xAI HTTP at PE-1

Personas live as Markdown + YAML frontmatter (six bundled at `src/agents/defaults/{ba,lead,builder,verifier,reviewer,scientist}.md`). Universal rules (`src/prompts/universal-rules.md`) and a single common-rationalizations table (`src/prompts/common-rationalizations.md`) compose into every persona prompt.

The product framing is: **repo-native agentic SDLC runtime** (market category), **AI software company** (internal metaphor and tagline). Locked 2026-04-30 after the product-thesis pressure-test (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`).

---

## 3. Side-by-side matrix

### 3.1 Phase taxonomy and lifecycle

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Phase names | DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP | Same, plus AUDIT for brownfield (auto-detected) | code-oz superset |
| Phase entry | User invokes `/spec`, `/plan`, etc. | `code-oz run` walks gates; `code-oz approve <PHASE>` writes the gate file | Different mechanism, same goal |
| Pass/fail signal | Persona prose + user judgment | `GATE_<PHASE>_PASSED.json` validated against `src/state/gates.ts` schemas | code-oz stronger (rule 1) |
| Cross-phase handoff | Markdown artifacts (SPEC, plan doc, etc.) | Same Markdown contracts (`SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`) | Aligned |
| Resume | Not addressed | First-class (`code-oz resume <runId>`, idempotent writes) | code-oz only |

### 3.2 Persona / agent layer

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Persona format | Markdown + YAML frontmatter | Same, extended with `type`, `phase`, `provider`, `modelPolicy`, `permissions`, `tool_use` sub-scopes | code-oz extension |
| Persona roster | code-reviewer, security-auditor, test-engineer | ba, lead, builder, verifier, reviewer, scientist (six locked at M12) | Different but functionally adjacent |
| Persona-on-persona invocation | Forbidden (Claude Code platform constraint) | Forbidden (rule 20 + capability contract enforces single-authority) | Aligned |
| Provider binding | Implicit (whatever Claude Code is connected to) | Explicit (`provider: claude / codex / gemini / fake / xai`) with capability eligibility check | code-oz stronger |
| Permission scope | Tool-name `tools:` and `disallowedTools:` lists | Sub-scoped per tool family (`tool_use.repo_context`, `tool_use.write`, `tool_use.execute`, `tool_use.review_request`, `tool_use.debate`) with cap fields (results, bytes, timeout, network) | code-oz stronger |

### 3.3 BUILD discipline

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Atomic-task discipline | `incremental-implementation` skill + ~100-line target + simplicity rule + scope discipline | PLAN.md atomic tasks with `Files`, `Validation`, `Risk`, `Hypotheses`, `Sources`; BUILD persona scoped to one task per round | Aligned, code-oz contract-enforced |
| Filesystem isolation | None — assumes harness manages files | Per-attempt git worktree at `.code-oz/runs/<runId>/worktree/` (M7 authority) | **code-oz only** |
| Output protocol | Free-form code edits | Single fenced unified-diff patch + `## Title` + `## Notes` (`docs/contracts/BUILD.md`) | **code-oz only** |
| Repair on failure | Implicit retry by harness | One repair round on patch validation failure; `NEEDS_INTERVENTION` after | code-oz contract-enforced |
| Scope expansion guardrail | "scope discipline" prose rule | Patch grammar rejects files outside PLAN task's `Files` list at parse time | code-oz mechanism-enforced |

### 3.4 VERIFY discipline

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Test-driven discipline | `test-driven-development` (RED-GREEN-REFACTOR + Prove-It pattern) | Validation command from PLAN; test execution in worktree | Aligned |
| Stop-the-Line | `debugging-and-error-recovery` Stop-the-Line rule | Restart-on-fail with 4-attempt cap + forensics preservation (M8 authority) | code-oz contract-enforced |
| Test-pyramid balance | Test pyramid 80/15/5 + Beyonce Rule + DAMP-over-DRY | Not enforced — validation is single command, no pyramid distribution check | **agent-skills has, code-oz lacks** |
| Mutation gating | Not addressed | Mutation gate in M8 (catches tautological tests) | **code-oz only** |
| Evidence-grounded rationale | "Verification" checklist per skill | `VERIFY.md` Rationale + Failure summary + Constraint, all evidence-grounded by orchestrator | Aligned, code-oz parser-enforced |
| Untrusted-data boundary on error output | `debugging-and-error-recovery` "Treating error output as untrusted data" rule | Not stated — repo_context contract restricts file scope but no general "tool output is untrusted data" rule | **agent-skills has, code-oz lacks** |

### 3.5 REVIEW discipline

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Five-axis structure | Correctness, readability, architecture, security, performance | Same five axes in `src/prompts/review-system.md` as internal scaffolding (borrowed M9) | **Borrowed** |
| Read tests first | `code-reviewer` persona explicit | Same in `review-system.md` (borrowed M9) | **Borrowed** |
| Severity labels | Critical / Important / Suggestion / Nit / FYI / Optional / Consider | block / fix-first / nit / fyi (4-level locked enum) | code-oz constrained |
| Cross-family review | "Multi-Model Review Pattern" prose suggestion | Non-negotiable (rule 2); load-time rejection if BUILD and REVIEW providers share a family | **code-oz mechanism-enforced** |
| Round cap | Implicit | Hard cap 4 rounds; exit on score≥6 + verdict=ready | **code-oz only** |
| Same-family panelist laundering | Not addressed | M14 panel: same-family panelists are advisory only; cross-family quorum required for `verdict: ready` | **code-oz only** |
| False-coverage warning on security axis | Not stated | Explicit cap: "security axis flags surface-level concerns; full security audit is W4 SHIP scope" | **code-oz stronger** |
| Score-honesty discipline | "score honestly, leave headroom" implicit | Round-1 cap of 8-9 for clean small diffs; reserve 10 for resolved-prior-blocker patches | code-oz codified |

### 3.6 Skills, source-citation, debate, scientist

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Skills as first-class abstraction | Yes — 22 skills with `name`/`description` frontmatter, loaded on demand by description | No — workflow lives inside persona prompts and contracts | **agent-skills has, code-oz deferred** (M16/M17 candidate) |
| Common Rationalizations | Per-skill table (22 tables) | Single universal table (`src/prompts/common-rationalizations.md`, 8 entries) | Deliberate code-oz choice (Codex rejected the per-phase fork 2026-04-30) |
| Source-driven citation discipline | `source-driven-development` (DETECT → FETCH → IMPLEMENT → CITE) with hierarchy table, deep-link rule, UNVERIFIED prefix | 3-source verification gate-enforced via `SOURCE_CHECK.md`; **but no source-hierarchy table, no version-detection language, no conflict-surfacing rule in `plan-system.md`** | **Partial — Proposal 4 from April 30 never landed** |
| Doubt-driven (in-flight per-decision review) | `doubt-driven-development` (CLAIM → EXTRACT → DOUBT → RECONCILE → STOP, 3-cycle cap, optional cross-model escalation) | Codex review at milestone-close (out-of-process, post-hoc) | **agent-skills has in-flight discipline; code-oz only post-hoc** |
| Hypotheses + open questions | `spec-driven-development` "Open Questions" section | Scientist phase-tail emits `HYPOTHESES.md` + `OPEN_QUESTIONS.md` with falsifiers; gate-preflight blocks on overdue/blocking questions | **code-oz stronger** |
| Debate runtime | None — competing-hypothesis Agent Teams pattern documented as a worked example only (requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | `requestDebate()` primitive + `DECISION.md` artifact + opposing-provider scheduling | **code-oz only** |
| Doc cache | `sdd-cache` hook with HTTP `If-None-Match`/`If-Modified-Since` revalidation; never serves from memory without origin freshness check | `.code-oz/cache/docs/<library>.md` referenced in PLAN persona but no revalidation contract | **agent-skills has cleaner freshness model** |

### 3.7 Orchestration patterns

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Catalog of endorsed patterns | `references/orchestration-patterns.md` enumerates 5 endorsed (direct, single-persona slash, fan-out-with-merge, sequential-pipeline, research-isolation) and 4 anti-patterns (router persona, persona-calls-persona, sequential paraphrase, deep persona trees) | Implicit — rule 20 + capability contract + DEBATE.md/REVIEW_PANEL.md/DEBATE_POLICY.md contracts enumerate by example | **agent-skills has explicit catalog; code-oz has implicit** |
| Pattern selection for new surface | Decision flow walks the patterns | Rule 20 forces "one new authority per milestone" debate | Different mechanism, same goal |
| Anti-router enforcement | Prose + Claude Code platform constraint | Capability contract + load-time validation | Aligned |

### 3.8 Distribution and runtime

| Concern | agent-skills | code-oz | Verdict |
|---|---|---|---|
| Distribution | Claude Code plugin (`.claude-plugin/plugin.json`); Cursor `.cursor/rules/`; Gemini CLI native skills; OpenCode AGENTS.md; Copilot persona files | Bun-compiled native single-file binary; npm + Homebrew + Scoop + tarball (W3-lite shipped 2026-05-02) | Different distribution category — agent-skills extends a host harness, code-oz is the host harness |
| Runtime | The host harness | Own runtime (state machine, event log, gate writer, worktree manager, patch applier, mutation gate, panel quorum, scheduler, capability contract) | **code-oz is the runtime** |
| Cost / budget enforcement | Not addressed | Cumulative `budgets.global` from `events.jsonl`; soft warn at 0.75; hard kill at 1.0; `priceTable` for dollar telemetry | **code-oz only** |
| Resume | Not addressed | First-class | **code-oz only** |
| Multi-provider | Implicit via the host harness | `IAgentProvider` with capability contract; OAuth-token-from-disk for Claude/Codex/Gemini, HTTP for xAI; eligibility-aware role routing | **code-oz only** |

---

## 4. What was already borrowed (April 30 round)

From `SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`, three borrows landed; one was rejected; one was deferred.

### Landed

| Borrow | Where | Status |
|---|---|---|
| Five-axis review structure as internal scaffolding | `src/prompts/review-system.md` lines 58-68 | Shipped M9 |
| "Review tests first" ordering | `src/prompts/review-system.md` lines 47-56 | Shipped M9 |
| Explicit security-axis false-coverage warning | `src/prompts/review-system.md` line 65 (security axis cap at 8) | Shipped M9 |
| `requestDebate()` as research-isolation (Pattern 5), not parallel fan-out | `docs/contracts/DEBATE.md` | Shipped M10 |

### Rejected (Codex-led, Claude agreed)

- **Per-phase Common Rationalizations fork** (Proposal 3) — universal table stays single. M9 inlined three REVIEW-specific rebuttals directly into `review-system.md` lines 27-31. No per-phase fragmentation, no `code-oz doctor rationalizations` command.

### Deferred

- **Source-driven citation discipline language in `plan-system.md`** (Proposal 4). The synthesis flagged this as "post-M9 standalone commit, low-priority one-file edit." **It never landed.** `src/prompts/plan-system.md` (147 lines, last modified May 2) has no source-hierarchy table, no version-detection language, no conflict-surfacing rule.
- **Skills layer architecture** (Proposal 5). Synthesis said "post-M10, dedicated milestone, M16 or M17 depending on whether duplication pain has surfaced." M16 just shipped (production CLI completion). The Skills layer slot is now eligible for the next milestone debate — if duplication pain has surfaced.

---

## 5. Where code-oz now structurally exceeds agent-skills

The April 30 audit covered M9 + M10. Since then, M11 → M16 shipped seven more authority boundaries, all of which extend code-oz beyond what agent-skills has — by design, because agent-skills is a prompt pack and code-oz is a runtime.

| Authority | Milestone | Why agent-skills cannot match |
|---|---|---|
| Provider capability contract | M11 | agent-skills has no provider abstraction |
| Company roster + role-to-provider routing | M12 | agent-skills personas are harness-bound |
| Role-cost policy under `budgets.global` | M13 | agent-skills has no budget surface |
| Reviewer panel v1 | M14 | agent-skills has no quorum mechanism |
| Debate-policy scheduler v1 | M15 | agent-skills has no scheduler |
| Production CLI completion (per-task cursor, dispatch infra, e2e through binary) | M16 | agent-skills has no own runtime to complete |

These are not borrows — they are runtime authorities that have no analog in a prompt pack. They tighten the discipline agent-skills implies: same-family panel laundering is structurally rejected at load time; debate is bounded by scheduler policy + per-role cost; gate signals never depend on LLM text parsing.

Code-oz also has six discipline rules that agent-skills does not state explicitly:

1. **Rule 1** — file-based gate signals only.
2. **Rule 2** — cross-family review at REVIEW gate (load-time enforced).
3. **Rule 9** — permission manifest required for any `.ts` execution.
4. **Rule 13** — privacy by default (file manifests, no silent recursive context).
5. **Rule 19** — run-level cumulative budget enforcement read from `events.jsonl`.
6. **Rule 21** — no new parallel-provider surface without measurable risk-reduction effect against the simpler baseline (Agentless caution as product policy).

---

## 6. What code-oz still does not have

Three patterns from agent-skills are real and not yet borrowed.

### 6.1 Source-driven citation discipline (Proposal 4 from April 30)

**Symptom:** `plan-system.md` describes the SOURCE_CHECK schema but does not teach the persona how to *choose* sources, *cite* them deeply, or *surface conflicts*. Today the prompt says "cite at least one Spec / Reference / Docs source per task" but does not differentiate official-doc vs blog vs StackOverflow.

**Borrow shape (one-file edit):** Add a "Source-driven discipline" section to `src/prompts/plan-system.md` with:

- **Source hierarchy table** (1: official documentation > 2: official blog/changelog > 3: web standards > 4: compatibility/runtime).
- **Stack-and-version detection rule** ("read package.json / pyproject.toml / Cargo.toml / go.mod before drafting; state versions explicitly").
- **Citation rules** (full URLs, prefer deep links with anchors, quote relevant passages).
- **UNVERIFIED prefix** when no official source can be found.
- **Conflict-surfacing rule** ("when official docs conflict with existing project code, surface to user; do not silently pick").

**Risk:** Adds verbosity to the PLAN prompt. **Mitigation:** keep it concise — ~30 lines of borrowed prose paraphrased clean-room. No schema change to `SOURCE_CHECK.md` (per Codex's April 30 ruling).

**Why it earns its place at v0.17:** The PLAN persona currently grounds in "spec + reference + docs" but says nothing about *quality* of those docs. With xAI integration shipped (PE-1) and live providers in production, the cost of a hallucinated API call has gone up. This is the cheapest single durability improvement the PLAN prompt can carry.

### 6.2 Doubt-driven discipline (in-flight per-decision review)

**Symptom:** Codex review fires only at milestone close (post-hoc). Claude (the lead implementer) makes 50+ decisions per milestone in-session — none of them get a doubt cycle until the milestone is done. M16 C9 shipped 8 production bugs that survived per-commit Codex review precisely because per-commit review is still the wrong granularity for a state-machine reducer ([memory pin: feedback_milestone_e2e_non_negotiable.md, feedback_rule20_sharper_application.md]).

**What agent-skills has that we don't:**

- **CLAIM → EXTRACT → DOUBT → RECONCILE → STOP** five-step cycle for non-trivial decisions in-flight.
- **Bounded loop** (3 cycles, then escalate; not recursion).
- **Adversarial-prompt-only** (the reviewer must be told "find what is wrong"; never told the CLAIM).
- **Optional cross-model escalation** (Codex / Gemini CLI), interactive-only, with PATH check + working-binary test + user authorization per invocation.

**Borrow shape (option A — orchestrator skill):** Add a `src/skills/doubt-driven-development.md` file (start of Skills layer if Proposal 5 lands) that the BUILD or PLAN persona can reference when a `Risk: high` task block names "non-trivial". The orchestrator wires the skill to spawn a fresh-context reviewer (Codex via existing `requestReview()` in REVIEW; or a new in-phase `requestDoubt()` primitive).

**Borrow shape (option B — phase-tail):** Add a `Doubter` phase-tail (sibling to Scientist) that runs after PLAN.md and BUILD_REPORT.md are written, takes the artifact + contract, asks "find what is wrong", returns a `DOUBT.md` sidecar. Hard cap: 1 cycle per gate-write.

**Risk:** Token cost of a per-gate doubt cycle. **Mitigation:** opt-in via PLAN task `Risk: high` tag; not a default.

**Why it earns its place:** The empirical pattern from M16 (12 production bugs caught: 8 from C12 e2e + 4 from Codex R1) confirms that *post-hoc* review is too late for state-machine and contract-drift bugs. A doubt cycle on the PLAN task block — before BUILD writes the patch — is the right granularity. This is a **new authority boundary**, so it must wait for its own milestone debate (rule 20). M17 candidate.

### 6.3 Skills layer architecture (Proposal 5 from April 30)

**Symptom:** Universal rules + common rationalizations + per-persona system prompts now duplicate content. `review-system.md` (180 lines) inlines three REVIEW-specific rebuttals; `plan-system.md` (150 lines) inlines source-citation guidance (would, if Proposal 4 lands); BUILD persona system prompt would inline incremental-implementation discipline; VERIFY persona would inline debugging-triage discipline. Without a Skills layer, every persona prompt grows unboundedly.

**What agent-skills has that we don't:**

- `skills/<name>/SKILL.md` files with frontmatter (`name`, `description`), Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification.
- Personas reference skills by name: "Follow the `test-driven-development` skill for writing tests."
- Skills loaded on demand by description matching, not by phase.
- Progressive disclosure: only the meta-skill loads at startup; full SKILL.md loads when an agent decides it applies.

**Borrow shape (the deferred plan):** Per the synthesis, this is a dedicated milestone. Initial roster (5 skills):

- `incremental-implementation.md` (BUILD persona references)
- `three-source-verification.md` (PLAN persona references; companion to `SOURCE_CHECK.md`)
- `five-axis-review.md` (REVIEW persona references; codifies the M9 borrow)
- `debugging-triage.md` (VERIFY persona references on restart-on-fail)
- `idea-refinement.md` (DEFINE / Prompter front-door reference)

**Risk:** Three new authority boundaries (skill anatomy, skill loader, persona-references-skill protocol). Rule 20 says one per milestone. **Mitigation:** sequence the milestone as M-Skills-A (anatomy contract + bundled skill files), M-Skills-B (loader + persona-references protocol), M-Skills-C (additional skills + verification audit).

**Why it earns its place — or not — at v0.17:** Open question. The original deferral rationale was "until M9/M10 produce repeated duplication pain, keep skills as influence material." Seven milestones later, the duplication is real but bounded: 6 personas × ~150 lines each = ~900 lines of prompt prose, with visible overlap on review-tests-first, repo-context discipline, output protocol. Not catastrophic. **This question is the most worth Codex pressure.**

---

## 7. Patterns we should NOT borrow

These are agent-skills features that fit code-oz badly. The April 30 audit got most of these right; one is new.

| Pattern | Why not |
|---|---|
| `/spec`, `/plan`, `/build`, `/test`, `/review`, `/code-simplify`, `/ship` slash commands | code-oz `run` is the orchestration model. Slash commands would force a second orchestrator with its own state. |
| Per-skill `scripts/` bash entry points | Rule 9 (permission manifest) requires a new execution sub-scope; M8's `tool_use.execute` is the canonical execution boundary. |
| Three named personas (code-reviewer / security-auditor / test-engineer) | code-oz personas are tied to the IAgentProvider abstraction and the locked M12 roster. The pattern is borrowed via Proposal 1 (five-axis structure); the persona files themselves are not. |
| `frontend-ui-engineering`, `browser-testing-with-devtools` skills | Out of scope for code-oz the runtime. Could become content for an agent-pack code-oz consumes, but not for the runtime itself. |
| `simplify-ignore` hook | The pattern is interesting (block-level protection of perf-critical code from the model) but applies to in-place editing, not patch-based BUILD. |
| Per-phase rationalizations table fork (Proposal 3 from April 30) | Already rejected. Rule stands: fold strong findings into the universal table one entry at a time. |

---

## 8. Verdict

**Q1: Is code-oz now meeting its needs vs the template?** **Yes.** The runtime mechanics (gates, worktree, mutation, debate, panel, scheduler, capability, budgets, resume, privacy, multi-provider) structurally exceed what a prompt pack can offer. The template's discipline (lifecycle, anti-rationalization, five-axis, review-tests-first, source-driven) is borrowable and either has been borrowed or is borrowable in one-file edits.

**Q2: Where does code-oz exceed agent-skills?** Section 5. The seven post-M10 authorities (capability, roster, role-cost, panel, scheduler, production CLI, plus rule 20 / rule 21) have no analog in a prompt pack — by design.

**Q3: What earns its place at v0.17?**

- **YES, land Proposal 4 (source-driven citation language in `plan-system.md`)** as a single low-risk doc commit. ~30 lines of borrowed prose, paraphrased clean-room. No schema change. The PLAN persona's hallucination cost has gone up since April 30 (live providers in production); this is the cheapest single durability improvement.
- **OPEN QUESTION on doubt-driven** (section 6.2). The empirical M16 evidence (8 production bugs surviving per-commit review) suggests in-flight per-decision review is the right next layer, but it is a new authority boundary and must wait for its own milestone debate. **M17 candidate; not v0.17.**
- **OPEN QUESTION on Skills layer** (section 6.3). The duplication is real but bounded (~900 lines across 6 personas). The April 30 deferral rationale ("until duplication pain surfaces") is still defensible. **Codex's read is the deciding factor.**

The recommended commit sequence:

1. `docs(plan): borrow source-driven citation discipline from agent-skills` — single file edit, ~30 lines added to `src/prompts/plan-system.md`. Land alongside this comparison doc.
2. After Codex response: synthesize verdict for doubt-driven + Skills layer. If accepted, schedule M17 / M18 debate-then-implement.

---

## 9. Codex debate prompt

Briefing for Codex (`gpt-5.5` xhigh, sandbox: read-only):

> **Subject:** comparison + borrow audit, agent-skills vs code-oz at v0.17, eleven days after the April 30 round.
>
> **Read first:** this file (`docs/comparison/05-agent-skills/comparison.md`); the April 30 briefing-response-synthesis trio (`docs/research/CODEX_BRIEFING_AGENT_SKILLS_BORROW.md`, `CODEX_RESPONSE_AGENT_SKILLS_BORROW.md`, `SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`); the current `src/prompts/{review-system,plan-system,universal-rules,common-rationalizations}.md`; the template at `~/Projects/agents/templates/agent-skills`.
>
> **Pressure-test five claims:**
>
> 1. Section 5 claims code-oz now structurally exceeds agent-skills on seven authorities. Did I miss an axis where the template still has the better answer?
> 2. Section 6.1 recommends landing Proposal 4 (source-driven citation language in `plan-system.md`) now. Is the cost actually 30 lines, or am I underpricing the prompt-discipline ripple? Is there a hidden interaction with the SOURCE_CHECK schema?
> 3. Section 6.2 (doubt-driven). The April 30 round didn't cover this proposal. Read the agent-skills `doubt-driven-development` skill verbatim. Is the right shape (a) an orchestrator skill referenced from BUILD, (b) a Doubter phase-tail sibling to Scientist, or (c) something neither captures? What's the rule-20 cost?
> 4. Section 6.3 (Skills layer). The April 30 deferral rationale was "until duplication pain surfaces, keep skills as influence material." Has it surfaced? If yes, what's the smallest viable initial roster — fewer than the proposed five? If no, what's the trigger condition that would change the answer?
> 5. Section 7 lists six patterns to NOT borrow. Did I miss one we should reconsider, or include one we should reconsider keeping?
>
> **Return:**
>
> 1. Verdict per claim — `agree` / `agree-with-modifications` / `disagree` / `reframe` plus a one-paragraph rationale.
> 2. Single highest-leverage borrow we should land first — name the file, name the diff shape.
> 3. Single borrow we should reject (out of the three pending). If "land all three", say so.
> 4. One pattern from agent-skills we have not surfaced in this comparison. Apply the same lens as the April 30 round — what did Claude miss this time?
> 5. What you would have done differently if you were Claude — one paragraph. The most valuable signal.
> 6. Honest answer to: is the Skills layer worth shipping at v0.18, or should it stay deferred?
>
> **Calibration:**
>
> - The borrow plan adds at most one Codex review pass per accepted proposal.
> - Treat your verdicts as data, not authority (rule 9). I will weigh disagreement and push back where warranted.
> - If your read is that a borrow that landed in M9/M10 should be reverted, say so explicitly with the rule-20 cost stated.

Codex response landed at [`codex-response.md`](./codex-response.md). Final synthesis at [`synthesis.md`](./synthesis.md). Briefing extracted to [`codex-briefing.md`](./codex-briefing.md).

---

*This file is the Claude-Opus side of the comparison. The Codex side and the synthesis live as siblings.*
