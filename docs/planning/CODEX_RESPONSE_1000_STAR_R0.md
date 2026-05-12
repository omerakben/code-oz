---
session: 1000-star plan R0 independent design review
thread: 019e1cda-3baa-74e0-9d12-9b9a16e5873e
model: gpt-5.5
reasoning-effort: xhigh
sandbox: read-only
verdict: revise
plan-under-review: docs/planning/1000_STAR_PLAN.md
prior-debate: docs/planning/CODEX_DEBATE_1000_STAR.md (not yet written; debate thread 019e1c94)
---

# Codex R0 response — 1000-star plan independent design review

## Verdict: revise

Do not approve Phase 2 as written. The plan has the right instinct, but
it bundles too many new surfaces into one launch-critical milestone and
underestimates the AUDIT runtime work. **The biggest hard miss:** current
`code-oz run` has dispatch branches for `plan/build/verify/review`, but no
`audit` runner branch, so registering `auditor.md` is not enough to make
the Phase 2 demo runnable. See `src/commands/run.ts:942` and the fallback
at `src/commands/run.ts:1134`.

## Lens-by-lens findings

### Rule 22 (consumer-first + RED-first TDD)

Partially consumer-first, but still too speculative. Phase 2.0 picks a
SWE-bench instance before 2.1, which helps, but 2.1 defines the persona
contract before the `runAudit` consumer and SWE-bench adapter contract
exist. The plan also names a non-existent `src/agents/defaults/registry.ts`;
bundled defaults are actually wired through
`src/agents/bundled-defaults.ts:14`.

Correct split: first write a failing brownfield CLI/runtime test for
`AUDIT → approve audit → PLAN`, driven by a minimal fixture or the locked
SWE-bench instance metadata. Then implement only what that consumer needs:
`src/phases/audit.ts`, CLI dispatch, bundled default import, `AUDIT.md`
parser/serializer, Scientist tail, and approval path. Defer SWE-bench
adapter and demo capture.

### Rule 20 (one phase per milestone)

Phase 2 is too large. It includes at least four distinct sub-surfaces:
AUDIT persona authority, SWE-bench adapter surface, brownfield evaluation
surface, and demo capture surface. That violates the sharper M16 lesson:
C9 hid bugs because multiple dispatch sub-surfaces were bundled under one
label.

Split it:
1. **M17:** AUDIT runtime slice. No SWE-bench harness. Read-only
   repo-context only unless execution is explicitly earned.
2. **M17.5:** SWE-bench adapter and official-harness-compatible
   evaluation.
3. **Launch artifact pass:** cross-family demo, screencast, README
   receipts.

### Rule 16 (no LLM-generated personas)

The intended design is compliant only if the persona text is genuinely
hand-authored and the universal rules import is mechanical.

Temptation points: "Claude writes" execution mode, "iterate persona
prompt," and any request like "draft auditor.md from this outline." An
LLM can review the persona for rule violations, but should not generate
the persona body. Use a deterministic template or human-authored text.

### Cost realism

`<$50` for Phase 2 is not realistic. Anthropic Claude Opus 4.7 at $5/M
input, $25/M output. GPT-5.5 at $5/M input, $30/M output. A 2M-token full
run lands roughly $16–$35 depending on output ratio and caching. Five
runs can plausibly hit $80–$175.

**Budget Phase 2 at $100–$150, with a hard stop after two failed live
runs unless the failure is clearly infrastructure-only.**

### Timeline realism

32h is optimistic. Realistic breakdown:
- 2.0 triage: 2–4h
- AUDIT runtime slice: 18–24h
- SWE-bench adapter: 16–24h
- pilot + debug: 6–12h
- cross-family run: 4–8h
- screencast: 4–6h

**Phase 2 is more like 50–75h.**

### Marketing realism (comparison table)

The comparison table will get hit. Three rows are inaccurate enough to
invite reputation damage on HN:

1. **"Multi-provider (Claude+Codex+Gemini)" is overclaimed for code-oz.**
   Gemini is a stub that throws `provider_gemini_not_yet_supported` in
   `src/providers/gemini.ts:1`, and its capability has no eligible phases
   in `src/providers/capabilities.ts:85`. Fix: say "Claude + Codex today;
   Gemini stub" or drop Gemini from the row.

2. **Cursor as "no multi-provider" is likely wrong.** Cursor's pricing
   page advertises OpenAI, Claude, and Gemini model usage. Mark Cursor
   "partial" or change the row to "orchestrated cross-provider phase
   roles."

3. **"Single binary install" is too vague.** Claude Code has a native
   installer, and code-oz itself still ships through npm/Homebrew/curl
   wrappers. Fix the row to "same SHA-pinned native release asset across
   npm/Homebrew/curl."

### Brownfield should-fail story

Credible as an engineering receipt, weak as the main launch story.
"We declined to submit a broken fix" is useful only if REVIEW catches a
non-obvious failure before official evaluation. It does not replace a
resolved SWE-bench instance.

A single unresolved instance does not evaporate all value, but it does
evaporate the "real bug fix" README headline. **Hedge with 3 locked
candidate instances and publish a matrix: resolved, caught-before-submit,
unresolved. Require at least one resolved instance before using the demo
as above-fold proof.**

### Missed risks

Top three missing or underweighted risks:

1. **Audience mismatch:** ">1k audience" may be the wrong segment for
   GitHub stars or HN adoption. Add a pre-launch segment test before
   assuming amplification.

2. **SWE-bench harness compatibility:** local `evaluate-locally.ts` may
   diverge from the official Docker harness. Official SWE-bench
   evaluation expects JSONL predictions and containerized evaluation.
   Use the official harness for the publishable result.

3. **macOS trust friction:** Apple Developer signing and notarization
   are deferred. Default Gatekeeper trust depends on Developer ID
   signing and notarization for distributed Mac software. This can hurt
   first-run conversion.

Also: npm name squatting is already in the Phase 1 register, but it
should be an immediate blocker, not a normal Phase 1 task.

### Sequencing

Move part of Phase 3 earlier. Ship a Phase 1.6 README rewrite without
the GIF: tagline, install commands, badges, one short "what it does,"
and a clearly labeled current demo. Keep the comparison table, SWE-bench
receipts, and "real bug fix" claims gated on Phase 2 success.

## Top-3 plan changes recommended

1. Split Phase 2 into M17 AUDIT runtime and M17.5 SWE-bench adapter/evaluation.
2. Add `runAudit` and brownfield CLI e2e as the consumer before authoring
   the final AUDIT prompt.
3. Raise Phase 2 budget to $100–$150 and time to 50–75h.

## Top-3 plan claims to soften

1. "Claude+Codex+Gemini" → "Claude+Codex today; Gemini stub/deferred."
2. "Third-party-verifiable real bug fix" → only after official SWE-bench
   harness success.
3. "All three install commands work" → add unsigned macOS caveat until
   signing/notarization is solved.

## Probability-adjusted outcome estimate

- P(plan executes within 68h): **20%**
- P(brownfield demo lands as published artifact): **45%**
- P(resolved SWE-bench artifact): **30%**
- P(1000 stars at 90 days under this plan): **6–10%**

Sources checked for current facts: Anthropic pricing, OpenAI GPT-5.5
pricing, SWE-bench evaluation/dataset docs, Cursor pricing, Continue
model docs, Aider model docs, Devin docs, Apple Gatekeeper/notarization
docs.
