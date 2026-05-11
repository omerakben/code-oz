# Doc-rot backlog ticket — surfaced 2026-05-10

> Filed during the agentic-canvas comparison. Codex round 1 (`CODEX_RESPONSE.md` finding 1) and round 2 (`CODEX_RESPONSE_R2.md` finding 7) both surfaced canonical-doc drift in `CLAUDE.md` and `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` relative to shipped state. This ticket captures the evidence so a future close-out session can fix the drift without re-deriving it.

## Status

**Open.** Not in scope for this comparison session (scope is strictly `docs/comparisons/agentic-canvas/`). Target: next milestone close-out checklist (whichever milestone closes first after this PR merges).

## Evidence

### `CLAUDE.md` line 9

The status block reads:

> Status: **v0.13.0-alpha.0 — PE-1 closed.** First HTTP adapter: `XaiProvider` reads `XAI_API_KEY`, posts to `api.x.ai/v1/chat/completions` (buffered, OpenAI-compatible subset, strict request-body allowlist; built-in xAI tools disabled by field omission). Trust-boundary discipline locked in `docs/references/provider-contract.md` § "Auth model — subprocess delegation + API-key transmission (v0.1)"; review trail in `docs/research/CODEX_REVIEW_PE1.md` (rounds 1+2, both blockers closed). 1983 offline tests pass; live integration test gated behind `CODE_OZ_LIVE_PROVIDER_TESTS=xai` + `CODE_OZ_LIVE_XAI_MODEL=<grok-variant>`. Demand checkpoint pending before PE-2.

The actual state at the time of this filing (per `package.json` + `MEMORY.md` milestone trail):

- **version:** `0.17.0-alpha.0` (4 milestones ahead — M13/M14/M15/M16 closed since the PE-1 line was written)
- **tests:** ~3108 (per `m16_progress.md`, +1125 since the PE-1 line)
- **last shipped:** M16 (production CLI completion); released and pushed
- **PE-2:** still demand-gated; the framing is fine but the surrounding milestone status is stale

### `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`

Codex flagged that the thesis "still frames M9/M10 as future in places." Specifically: any prose that says "M10 will introduce…" or "the future Debate runtime…" describing M10 as forthcoming when M10 has been shipped (per `m10_progress.md`, v0.10.0-alpha.0, pushed to origin/main 2026-05-01). M11–M16 are not addressed at all in the thesis prose — the thesis was last updated post-M10 framing (May 3 file mtime).

## Why this matters

1. **Future readers are misled.** Anyone (Codex, Claude, a human teammate) reading `CLAUDE.md` to understand current state gets a 4-milestone-stale picture and may make decisions on outdated assumptions (e.g., "we have not shipped Reviewer panel v1 yet" when M14 has shipped).
2. **The doc-rot pattern recurs.** This is the second comparison session in a row to surface canonical-doc drift (the cross-PR review-fix propagation memo and the canonical-doc-precedence-chain memo both warn about exactly this class).
3. **Credibility cost.** A status block that says "1983 tests" while the test count is actually ~3108 erodes trust in the rest of the document.

## Proposed fix scope

The fix is small, but it touches a shared file (`CLAUDE.md`) that other parallel sessions are reading. The right execution shape:

1. **At the next milestone close-out**, update `CLAUDE.md` line 9 to reflect the milestone's shipped state. Use the current line as the template; replace the version, test count, and "last shipped" fragment.
2. **Same milestone**, sweep `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` for "M9", "M10", "M11", "M12", "M13", "M14", "M15", "M16", and "PE-1" mentions; mark each as shipped or revise the surrounding prose if it framed them as future.
3. **Add to the milestone close-out checklist (`docs/design/SESSION_CYCLE.md`?):** a one-line "doc-rot sweep" step — re-read `CLAUDE.md` status block + thesis after every milestone tag.

The fix does not touch any code. Estimated time: 30 minutes during a milestone close-out.

## What this ticket is not

This is **not** a directive to fix the drift in this session. The agentic-canvas comparison session scopes itself to `docs/comparisons/agentic-canvas/` and intentionally avoids writing to `CLAUDE.md` to prevent merge conflicts with parallel template-comparison sessions also reading the same file. The ticket file is the deferral artifact: the evidence is captured locally so a future session does not have to re-derive it from scratch.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-10 | Filed as open ticket; no fix in this session | Scope discipline — this comparison session writes only to `docs/comparisons/agentic-canvas/`; `CLAUDE.md` is shared state that parallel sessions are also reading. |
| 2026-05-10 | Codex R2 finding 7 confirmed the deferral was acceptable but required a concrete ticket | This file is the ticket. |
