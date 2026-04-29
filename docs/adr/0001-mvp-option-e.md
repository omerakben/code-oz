# ADR 0001 — MVP scope: Option E (spine-first), not Option C (DEFINE+PLAN only)

- **Date:** 2026-04-29
- **Status:** Accepted
- **Author:** Ozzy (Omer Akben)
- **Reviewers:** Claude Opus 4.7 (max effort), GPT-5.5 (xhigh effort) — debate via Codex MCP
- **Supersedes:** N/A
- **Related artifacts:** `docs/design/ROADMAP.md`, `docs/design/CODEX_BRIEFING.md`, `docs/design/CODEX_RESPONSE.md`

## Context

The project was scoped via a structured ask-me interview (2026-04-29). Decisions Q1–Q5 (architecture, stack, spine, file format, provider model) were settled before debate began. Q6 — MVP scope — was open. Two LLMs debated four candidate scopes:

- **A:** Port maestro's session loop to Bun (≈3 weeks). Rejected by Opus: doesn't earn the rename, the differentiator (non-tech intent elicitation, full phase graph) is absent.
- **B:** One full lifecycle, Claude-only (≈6 weeks). Considered as v0.2 follow-up.
- **C:** Vertical slice — DEFINE + PLAN only, with the killer non-tech UX (≈3–4 weeks). Opus's recommendation.
- **D:** Full vision v0.1 (≈5 months). Rejected by both: scope-creep death.

GPT-5.5 introduced **Option E:** spine-first end-to-end MVP. DEFINE → PLAN → BUILD-lite → VERIFY-lite → REVIEW-lite on a deliberately tiny target, with a `FakeProvider` that runs the full lifecycle offline.

## Decision

**Adopt Option E.** Reject Option C.

The hardest risk in code-oz is not whether a BA persona can elicit good intent from a non-technical user. The harder risk is whether the product can safely move from human intent to repo changes through enforced gates, observable execution, resumable state, provider boundaries, and adversarial review without trusting agent prose. Option C does not exercise that risk. Option E does.

The killer non-tech UX is preserved (DEFINE phase still runs the ask-me intent elicitation). The spine extends through BUILD-lite (one atomic task in an isolated worktree, applied via patch contract), VERIFY-lite (one configured smoke command), and REVIEW-lite (cross-family review via `requestReview`, capped at four rounds).

## Refinements bundled with this decision

1. **`FakeProvider` ships on day 1 alongside `ClaudeProvider`** — designing the `IAgentProvider` interface but only implementing one provider is the worst version of an abstraction (real complexity, no proof). `FakeProvider` is deterministic, offline, and lets the full e2e test run with no network or auth.
2. **Cross-provider primitive narrowed.** Replace broad `consult(agent, question)` with `requestReview({ reviewer, files, question })` callable only at the REVIEW gate. Broad consult ships in v0.3 if there's evidence the narrower primitive is insufficient.
3. **State model = typed FSM + JSONL event log + schema-validated gate files.** No SQLite in v0.1. `src/state/machine.ts` owns legal phase transitions; `state/events.jsonl` is the append-only run trace; `state/GATE_*_PASSED.json` are the durable gate signals. SQLite waits until queryable history is earned by use.
4. **Brownfield AUDIT has its own artifact.** `AUDIT.md` (repo map, detected stack, existing commands, risk areas, test surface, owner assumptions) is a first-class phase output, not an absence. Brownfield is not "skip DEFINE."

## Consequences

**Positive:**
- The architecture is exercised end-to-end in v0.1, not just the front half. Gate mechanics, worktree isolation, patch contracts, and cross-family review all live in the first release.
- Offline e2e tests via `FakeProvider` make the entire spine testable without network or provider auth.
- Discipline locked in by structure: `requestReview()` only at REVIEW gate prevents agents from quietly summoning each other in BUILD; the typed FSM prevents phase skipping; the JSONL log makes runs replayable.

**Negative:**
- Larger v0.1 scope than Option C — calendar realistically 2–4 weeks for a solo engineer rather than the 3–4 weeks Opus estimated for C.
- More upfront investment in test infrastructure (`FakeProvider`, fixture repos, transcript snapshots).
- Worktree integration + patch contracts in M7 are the riskiest milestone.

**Neutral / consciously deferred:**
- Gemini provider stubbed behind `experimental: true`. Frontmatter cannot claim Gemini support until the adapter runs.
- SHIP phase is a stub.
- Marketplace, telemetry bundling, and self-upgrade defer to W2–W4.

## Implementation milestones

See `docs/design/ROADMAP.md` for the full M1–M7 plan. M1 (this commit) bootstraps the CLI binary and the `code-oz init` command.
