---
audience: Codex (`gpt-5.5` xhigh, sandbox: read-only)
purpose: pressure-test code-oz's "ahead, with 4 selective borrows" verdict against learn-harness-engineering
companion: COMPARISON.md (read-side)
session: 07
date: 2026-05-10
expected-output: CODEX_RESPONSE.md with verdict (accept | accept-with-modifications | reject) per borrow / reject, plus any missed risks
---

# Codex briefing — code-oz vs learn-harness-engineering

## Goal

The user (Ozzy) and I have completed session 07 of the template-comparison sweep. The target template is `~/Projects/agents/templates/learn-harness-engineering` (the WalkingLabs "Learn Harness Engineering" course site + `harness-creator` skill). My verdict is **YES, code-oz is ahead** (category mismatch: course pedagogy vs. runtime), with **4 selective borrows + 4 rejects**.

Your job: stress-test that verdict, the borrow set, and the reject set. Push back where the analysis is too generous to code-oz, too dismissive of the template, or where the borrow ranking misses load-bearing risks.

## Constraints

- Read-only sandbox.
- This is a **planning-convergence debate**, not an implementation review. No code changes; the borrows have not landed.
- Treat the four borrows as proposals against code-oz's roadmap (M17+ polish, not blocking M16).
- Code-oz at v0.17.0-alpha.0 (M16 closed). Roadmap continues with M17+ polish + demand-gated PE-2.

## Pinned context (do not relitigate)

- **Rule 20**: one new authority boundary per milestone. Pre-empts any borrow that bundles capabilities.
- **Rule 21**: no new parallel-provider surface without measurable risk-reduction effect. Borrow B2 is *the methodology* this rule depends on but the rule itself is locked.
- **Rule 1**: file-based gate signals only; never parse LLM text for pass/fail. Pre-empts borrows that would weaken gate semantics.
- **Rule 16**: universal anti-slop rules embedded in every persona prompt. Pre-empts borrow B4 — confirm B4 lands as an *addition*, not a replacement.
- **PE-2+ is demand-gated**. Pre-empts borrow R4 (rejected — bootstrap pattern is premature).

## What I want you to debate

### Verdict-level

1. **Category mismatch claim**: I argue learn-harness-engineering is *pedagogy*, not a runtime peer. Its substantive content (memory hierarchy, hook trust, tool registry, multi-agent coordinator/fork/swarm) appears to summarize Claude Code's own runtime patterns. Is the category-mismatch frame correct? Or is there a runtime-architectural insight in the course I missed by treating it as pedagogy?

2. **"Ahead" claim**: Code-oz already implements every subsystem the course teaches, in many cases more strictly (file-based gate signals; cross-family REVIEW; debate runtime; reviewer panels; rule-20 authority discipline; AUDIT phase for brownfield). Is there a subsystem where the course's pattern is materially better than code-oz's, that I'm dismissing?

### Borrow-level (B1–B4)

For each, return one of: `accept` / `accept-with-modifications` / `reject` / `defer`. If accept-with-modifications or reject, tell me why and what the better shape is.

3. **B1 — Five-subsystem 1–5 self-assessment scorecard.** Insert as `docs/contracts/HARNESS_AUDIT.md` + optional `code-oz doctor --harness-audit` subcommand. Pedagogical, low cost, helpful for external projects code-oz manages. Concern: does the *subsystem partition* (Instructions / State / Verification / Scope / Lifecycle) carry enough of the course's frame to be actionable, or does it dilute code-oz's six-phase prescriptive frame? Is there a risk this confuses contributors by introducing a competing taxonomy?

4. **B2 — Baseline-vs-harness benchmark methodology for rule 21 enforcement.** Pin under `docs/contracts/RULE21_BENCHMARK.md` as a pre-milestone playbook. Concern: rule 21 today says "measurable in `events.jsonl` against the single-provider baseline." The course's playbook gives shape but is loose on rigor: 2–3 representative tasks, with-vs-without comparison, success/time/tokens/rework. Is this enough rigor to gate a parallel-surface authority decision, or should the methodology be tightened (effect-size threshold, statistical-significance bar, named telemetry counters)? What's the risk of *under-specifying* this and how would it manifest?

5. **B3 — Pin "Hook trust is all-or-nothing" invariant.** Append to `docs/contracts/REPO_CONTEXT.md`. Concern: code-oz has no current hook system; this is a preemptive pin. Is preemptive pinning load-bearing or speculative? Is there a closer existing surface (e.g., the `IAgentProvider` permission contract) where the all-or-nothing invariant is more relevant today?

6. **B4 — Front-load distinctive trigger language in persona/skill descriptions.** Update `src/prompts/universal-rules.md`. Concern: this rule originates from skill-listing budget mechanics specific to Claude Code's runtime. Is it actually load-bearing for code-oz's persona system, or is it Claude-Code-specific noise that creates an unfounded constraint?

### Reject-level (R1–R4)

For each, return one of: `confirm-reject` / `flip-to-borrow` / `flip-to-borrow-modified`.

7. **R1 — Replace six-phase taxonomy with five-subsystem framework.** I argue the course's framework is descriptive while code-oz's is prescriptive. Confirm or flip?

8. **R2 — Adopt `feature_list.json` as artifact.** I argue redundant with gate files + `events.jsonl`. Confirm or flip?

9. **R3 — Adopt AGENTS.md + CLAUDE.md split.** I argue adds noise without enforcement. Confirm or flip? Note: many other ecosystems (Cursor, Codex CLI, generic agents) read `AGENTS.md` rather than `CLAUDE.md`. Is there a cross-tool-compatibility argument I'm missing?

10. **R4 — Adopt four-stage bootstrap (minimal-context → tools → trust → sensitive).** I argue premature for CLI-only entry mode. Confirm or flip?

### Missed risks

11. Is there anything in the course's reference patterns or gotchas list that I should have surfaced as a borrow but didn't? Specifically: review `~/Projects/agents/templates/learn-harness-engineering/skills/harness-creator/references/{memory-persistence,context-engineering,multi-agent,lifecycle-bootstrap,tool-registry,gotchas}.md` for any single mechanic — not pattern, mechanic — that would meaningfully strengthen code-oz's discipline. The 15-item Gotchas list is the most likely source.

12. Is the borrow-ranking order defensible? B2 is ranked as "required before any future parallel surface" while B1/B3/B4 are "post-M16 polish." Should B2 be promoted to a blocking dependency? If rule 21 fires before the methodology is pinned, the rule is unenforceable — is that a real risk?

## Output format

Return a single Markdown response with:

1. **Verdict-level summary** — 2–4 sentences, your overall read.
2. **Per-question response** — one section per question above (1–12), with `accept|accept-with-modifications|reject|defer|confirm-reject|flip-to-borrow|flip-to-borrow-modified` + brief reasoning + any reshape proposal.
3. **Missed risks** — bulleted list, ranked by load-bearingness.
4. **Final recommendation** — accept the verdict as-is, accept with modifications (list them), or replace with a different decision.

Keep total length under 1500 words. Cite specific file paths and line ranges when proposing changes. No code; this is design pressure-testing.
