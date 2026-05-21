---
description: Resume a code-oz run after a NEEDS_INTERVENTION pause.
argument-hint: "[args]"
allowed-tools: Bash
---

This command only invokes the code-oz engine. Do not write `.code-oz/`, do not decide pass/fail, do not simulate review, and do not summarize gate/review status beyond engine output.

## What it does

`code-oz resume` continues a run that stopped at a `NEEDS_INTERVENTION.json` or `PAUSE.json` gate. The engine replays the recorded effective budget envelope and picks up from the last committed gate.

## Cost notice

This command spawns providers, may cost money, and changes files in the worktree. Because you explicitly invoked it, you may proceed — state this in one line before running. If invoked ambiguously (not a clear user request), ask for one explicit confirmation first.

## How to run it

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-code-oz.sh" resume $ARGUMENTS
```

The resolver finds the engine via PATH binary, then npx fallback, then stops with install guidance. If it stops, surface that guidance verbatim; do not work around it.

## Surface results

Relay the engine's stdout and stderr verbatim. If the engine writes a new `NEEDS_INTERVENTION.json`, a `PAUSE.json`, or a `STOP.json`, surface the file path verbatim and stop. Do not open it and do not decide pass/fail or summarize a verdict.

## Boundaries

- Do not write under `.code-oz/` for any reason.
- Do not declare or emit gate state (`GATE_*`); the engine is the only gate writer.
- Do not decide pass/fail from engine output.
- Do not simulate or claim to perform cross-family review; the engine owns that.
- Do not retry automatically after a second `NEEDS_INTERVENTION`; surface it and stop.
- If the engine exits non-zero, show the stderr to the user without paraphrasing.
