# CODEX_BRIEFING — D1 convergence (before code)

Date: 2026-05-20
Reviewer: Codex gpt-5.5 xhigh, sandbox read-only
Cycle: planning-convergence debate (CLAUDE.md "Cross-model peer review" step 1)
Read first: `docs/design/D0_FINDINGS.md` (frozen contracts), `docs/design/DISTRIBUTION_PLAN_FINAL.md`, `docs/design/SUPERPOWERS_BORROW_ANALYSIS.md` v3, `docs/design/SESSION_D1_KICKOFF.md`

## Goal

Ship two Claude Code plugins without touching the engine or adding runtime authority:
- **D1a `code-oz`**: slash commands + a SessionStart router card that discover and invoke the existing `code-oz` engine binary. The binary stays the only writer of gates/events/reviews/artifacts.
- **D1b `code-oz-discipline`** (sibling plugin): honest advisory skills that never emit gate-shaped output and always upsell to the engine.

darwin/linux only. No engine changes. No new runtime authority. This briefing settles the **D1a surface + router card** before any code lands. D1b is reviewed at completion, not here.

## Hard constraints (non-negotiable rules in play)

- **Rule 1** — file-based gate signals only; only orchestrator-owned engine primitives write `state/GATE_*`, `NEEDS_INTERVENTION.json`, `events.jsonl`, canonical artifacts. The plugin must NEVER write under `.code-oz/`, declare a gate passed, or parse engine output into pass/fail.
- **Rule 2 / Rule 21** — cross-family review stays engine-owned. The plugin never invokes a second model and never asks the host agent to substitute for REVIEW.
- **Rule 9** — any host-executed script ships a permission/command manifest (declaration, validated in CI/review; host hooks run unsandboxed so it is NOT enforcement).
- **Rule 20** — one authority boundary per milestone. D1a = "Claude host distribution + engine invocation." Nothing in the router card is advisory discipline.

## Frozen D1a surface (from D0_FINDINGS)

### Bootstrap contract (every wrapper surface depends on it)
```
1. command -v code-oz resolves        -> run the binary directly.
2. else if npm available              -> npx -y @tuel/code-oz@<pinned> <args>
   CAVEAT: if this 404s on npm.pkg.github.com, the user has @tuel scope routing.
   Tell them to install via Homebrew (bypasses npm scope routing) or set
   @tuel:registry=https://registry.npmjs.org/.
3. else                               -> hard-stop: "code-oz is not installed.
   Install: npm i -g @tuel/code-oz  OR  brew install omerakben/tap/code-oz".
```
`<pinned>` = the plugin's released version (plugin and engine version-lock). Never float to @latest. Windows hard-stops with the v0.21+ note.

### Slash commands (4)
`/code-oz-run`, `/code-oz-init`, `/code-oz-doctor`, `/code-oz-resume`. Each ~30 lines: prerequisite (bootstrap resolver) -> default flow (exec the subcommand, surface stdout/stderr + `NEEDS_INTERVENTION.json` path verbatim) -> boundaries (never write `.code-oz/`, never parse pass/fail, `run` needs confirmation, `doctor` is read-only and free).

### SessionStart router card (literal, <=1500 tokens)
Injected via `hookSpecificOutput.additionalContext`. Idempotent marker `<!-- code-oz-router v1 -->`.
```
<!-- code-oz-router v1 -->
This repo can use code-oz, a runtime that puts enforced gates and a
different-model review around AI coding work. You (the host agent) do the
building; code-oz enforces the process and leaves an audit trail.

When to route to the engine:
- The user wants to build or change production-bound or shared code -> propose
  running `code-oz run` (the /code-oz-run command). Confirm before running.
- Setup / health / continuation -> `code-oz doctor` (read-only, run freely),
  `code-oz init`, `code-oz run` to resume after NEEDS_INTERVENTION.
- Throwaway scripts, questions, or read-only exploration -> do NOT route to code-oz.

Boundaries (load-bearing):
- You never declare a gate passed, never write under `.code-oz/`, never parse
  engine output into pass/fail, never simulate review. The engine owns all of that.
- `code-oz run` spawns providers and may cost money - run it only on explicit
  request or after the user confirms.
- This card defers to the user's instructions and to CLAUDE.md. If another
  skills system (e.g. superpowers) is installed, it keeps its own routing; this
  card only adds the engine-routing pointer.

If you were dispatched as a subagent for a specific task, ignore this card.
```

### Hook
`hooks/hooks.json` matcher `startup|clear|compact` -> a Unix bash `session-start` script that emits the card. Subagent-skip is the prose line in the card (D0 §1.4: no `SubagentStart` hook exists; do NOT gate on `agent_id`). Degrade silently if no bash.

## Questions to settle (debate prompts)

1. **Trigger-scope safety.** Is "build/change production-bound or shared code -> propose `code-oz run`; throwaway/questions/read-only -> do not route" tight enough to avoid both over-routing (annoying, costs money) and under-routing (engine never used)? Any wording that would make a host agent over-claim authority?

2. **Command-set minimality.** Are `run/init/doctor/resume` the right minimal four? Anything missing that a first session needs, or anything that should be cut to honor rule 20?

3. **Hook shape — polyglot vs plain bash.** Kickoff C4 names superpowers' polyglot `run-hook.cmd session-start`; D0 §2.3 and the borrow analysis say "Unix bash hook only, Windows deferred (no Windows binary)." Recommend: ship the polyglot indirection (extensionless `session-start`, future-proofs Windows) but exercise only the Unix arm, OR ship a plain `hooks.json -> bash session-start` and add the polyglot when Windows lands? Which is the smaller honest surface?

4. **Authority smuggling.** Does anything in the card or commands let the host agent believe it is "enforcing code-oz" rather than "invoking the engine"? Is the boundaries block sufficient, or does the consent model (`run` confirm / `doctor` free) need to be in the commands too, not just the card?

5. **Idempotence + co-existence.** Is a model-facing marker (`<!-- code-oz-router v1 -->`) the right idempotence mechanism for re-injection on `compact`/`clear`, given the hook is stateless and superpowers does not dedupe? Any risk when superpowers is co-installed?

Return a structured verdict: per-question finding (safe / change-required / debate-required), a short rationale each, and one "converged: yes/no, blocking items: <list>" line. This is data, not authority — disagreement is weighed, not deferred to.
