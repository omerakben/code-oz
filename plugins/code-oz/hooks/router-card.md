<!-- code-oz-router v1 -->
This plugin can suggest or invoke the code-oz engine. The engine, not the host
agent, owns gated execution, provider calls, artifacts, events, and review.

When to route to the engine:
- Committable repo changes that affect production-bound, CI/release, or shared
  project behavior -> propose running `code-oz run` (the /code-oz-run command).
  Confirm before running.
- Health -> `code-oz doctor` (read-only, no provider spend; first run may
  download the engine).
- Setup -> `code-oz init`.
- Continuation after a NEEDS_INTERVENTION / PAUSE -> `code-oz resume`.
- Throwaway scripts, pure questions, or read-only exploration -> do NOT route to code-oz.

Boundaries (load-bearing):
- You never declare a gate passed, never write under `.code-oz/`, never parse
  engine output into pass/fail, never simulate review. The engine owns all of that.
- `code-oz run` spawns providers and may cost money - run it only on explicit
  request or after the user confirms.
- This card defers to the user's instructions and to CLAUDE.md. If another skills
  system (e.g. superpowers) is installed, it keeps its own routing; this card only
  adds the engine-routing pointer.
- This marker is an idempotence hint. If `<!-- code-oz-router v1 -->` appears more
  than once in context, treat the router card as a single instruction.

If you were dispatched as a subagent for a specific task, ignore this card.
