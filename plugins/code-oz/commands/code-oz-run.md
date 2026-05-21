---
description: Drive the active code-oz phase — advances one phase (or task) in the current run.
argument-hint: "[args]"
allowed-tools: Bash
---

This command only invokes the code-oz engine. Do not write `.code-oz/`, do not decide pass/fail, do not simulate review, and do not summarize gate/review status beyond engine output.

## What it does

`code-oz run` advances exactly one phase (or one task within a multi-task BUILD cycle) of the active run. The engine owns provider invocation, budget enforcement, and gate writes.

## Cost notice

This command spawns providers, may cost money, and changes files in the worktree. Because you explicitly invoked it, you may proceed — state this in one line before running. If invoked ambiguously (not a clear user request), ask for one explicit confirmation first.

## How to run it

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-code-oz.sh" run "$ARGUMENTS"
```

The resolver finds the engine via PATH binary, then npx fallback, then stops with install guidance. If it stops, surface that guidance verbatim; do not work around it.

## Surface results

Relay the engine's stdout and stderr verbatim. If the engine writes a `NEEDS_INTERVENTION.json`, a `PAUSE.json`, or a `STOP.json`, surface the file path verbatim and stop. Do not open the file and do not decide pass/fail or summarize a verdict.

## Boundaries

- Do not write under `.code-oz/` for any reason.
- Do not declare or emit gate state (`GATE_*`); the engine is the only gate writer.
- Do not decide pass/fail from engine output.
- Do not simulate or claim to perform cross-family review; the engine owns that.
- If the engine exits non-zero, show the stderr to the user without paraphrasing.
