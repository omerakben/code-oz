---
name: code-oz
description: Drive the code-oz agentic SDLC runtime to build or fix code with enforced gates and cross-family review. Use when the user asks to build, implement, or fix something in a code repository and wants gated, reviewed delivery rather than ad-hoc edits.
---

# Driving code-oz

code-oz is a gated SDLC runtime. YOU are the operator; code-oz owns the gates,
the event log, and cross-family review. You drive it through its CLI. You never
write its state.

## Preconditions

1. Check it is installed: run `code-oz --version` (or `code-oz doctor`).
2. If it is missing, STOP and tell the user to install it:
   `npm i -g @tuel/code-oz`  OR  `brew install omerakben/tap/code-oz`.
   Do NOT auto-run `curl`, `npx`, or `bunx` to install it yourself.

## How to drive it

Set this ONCE at the start of your session so every code-oz call runs in
fail-closed operator mode (the engine enforces it even if you forget the
per-command flags):

```
export CODE_OZ_OPERATOR=<your-agent-name>
```

Then drive normally:

- Start/advance a run: `code-oz run --request "<the task>"`
- Approve a reversible gate when the engine asks (name the phase):
  `code-oz approve <phase>` (phases: define, audit, plan, build, verify, review)
- Continue/inspect: `code-oz resume`, `code-oz doctor`.

Equivalent per-command flags also exist (`--operator <id> --non-interactive`) if
you prefer not to use the env var:

- `code-oz run --operator <agent> --non-interactive --request "<the task>"`
- `code-oz approve --operator <agent> --non-interactive <phase>`

Read the engine's stdout and the run's `state/` gate files + `events.jsonl` as
the only source of truth for what happened.

## Hard boundaries (do not cross)

- Never write under `.code-oz/`, never create or edit gate files (`GATE_*`),
  `events.jsonl`, artifacts, or config.
- Never decide pass/fail yourself. The engine decides; you relay it.
- Never simulate or claim to perform cross-family review. The engine owns it.
- Never use the fake provider, `--fake-script`, or `--artifact`. They are
  rejected in `--non-interactive` mode anyway.
- Never `git push`, merge, or publish. SHIP is human-only: when the engine says
  human approval is required, surface that and stop.
- Run one code-oz run at a time.

## When the engine stops

If the engine writes `NEEDS_INTERVENTION.json`, `PAUSE.json`, or `STOP.json`, or
prints "human approval required", surface the file path / message verbatim to the
user and stop. Do not open the file to decide a verdict, and do not start a fresh
run to retry unless the user asks.
