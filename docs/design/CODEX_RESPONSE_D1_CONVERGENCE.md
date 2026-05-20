# CODEX_RESPONSE — D1 convergence debate + synthesis

Date: 2026-05-20
Reviewer: Codex gpt-5.5 xhigh, sandbox read-only (thread `019e47c5-80aa-71e1-9a0a-0c5f64aa2802`)
Briefing: `CODEX_BRIEFING_D1_CONVERGENCE.md`
Verdict: **Converged: no** — 4 blocking items, all accepted. This doc is the authoritative D1a surface lock (post-dates `SUPERPOWERS_BORROW_ANALYSIS.md` v3 and `SESSION_D1_KICKOFF.md` where they conflict).

## Codex findings (verbatim tags) and disposition

| # | Question | Codex tag | Disposition |
|---|----------|-----------|-------------|
| 1 | Trigger-scope safety | change-required | **Accept** |
| 2 | Command-set minimality | safe | **Accept** (keep exactly four) |
| 3 | Hook shape (polyglot vs plain bash) | change-required | **Accept** (plain bash) |
| 4 | Authority smuggling | change-required | **Accept** |
| 5 | Idempotence claim | change-required | **Accept** (downgrade to hint) |

## Locked decisions for implementation

### L1 — Router card wording is engine-first (finding 1 + 4)
Replace the briefing draft's "You (the host agent) do the building; code-oz enforces the process and leaves an audit trail." with:

> This plugin can suggest or invoke the code-oz engine. The engine, not the host agent, owns gated execution, provider calls, artifacts, events, and review.

Tighten the route trigger to: **"committable repo changes that affect production-bound, CI/release, or shared project behavior."** Throwaway scripts, pure questions, and read-only exploration stay out of scope.

### L2 — Keep exactly four commands (finding 2)
`run / init / doctor / resume`. No host-side `status / review / verify / approve / view`. If a future `status` is added it must be a pure engine passthrough with zero host interpretation.

### L3 — Plain bash hook, Claude-only branch (finding 3)
`hooks/hooks.json` matcher `startup|clear|compact` → `bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-start"`. **No `run-hook.cmd` polyglot in D1a.** The `session-start` script emits ONLY Claude's `hookSpecificOutput.additionalContext` — drop the Cursor/Copilot detection branches (they smuggle D2/D3 into the D1a boundary, rule 20). Script name is extensionless to keep the future Windows path open. Degrade silently (exit 0) if reading the card fails. The polyglot runner is added only when Windows/multi-host hooks are actually in scope. This supersedes kickoff §4 C4's literal `run-hook.cmd session-start`.

### L4 — Consent + boundaries repeated inline in every command (finding 4)
Each of the four command files opens with:

> This command only invokes the code-oz engine. Do not write `.code-oz/`, do not decide pass/fail, do not simulate review, and do not summarize gate/review status beyond engine output.

- `/code-oz-run`: proceed only when the user explicitly invoked the command or after one explicit confirmation (spawns providers, costs money, changes files).
- `/code-oz-doctor`: read-only health check with **no provider spend**. Do NOT call it "free" — the bootstrap resolver may `npx`-download the pinned engine on first run (one-time). Word it "read-only, no provider spend (first run may download the engine)."

### L5 — Idempotence marker is a hint, not suppression (finding 5)
A stateless SessionStart hook cannot suppress duplicate injection. Keep `<!-- code-oz-router v1 -->` as a **model-facing idempotence hint**, not a suppression mechanism. Add one card sentence: "If this marker appears more than once, treat the router card as a single instruction." **Correction to `SUPERPOWERS_BORROW_ANALYSIS.md` v3 line 50:** "duplicate injection ... is suppressed by the marker" overclaims — it is hinted, not suppressed. B4 must assert: duplicate injected cards cause at most one route proposal and never an auto-run.

## Net effect on the C1–C5 plan
- C1 (scaffold/manifest): unchanged.
- C2 (bootstrap resolver): unchanged; doctor wording note (L4) flows into C3.
- C3 (commands): add the inline consent/boundary header (L4) to all four; fix doctor wording.
- C4 (hook/card): plain bash, Claude-only branch (L3); engine-first card wording + tightened trigger (L1); marker-as-hint sentence (L5).
- C5 (B4 harness): add the duplicate-injection test (L5); everything else per kickoff §6.

Converged after synthesis: **yes** (all four blocking items have locked resolutions above). Implementation may proceed RED-first.
