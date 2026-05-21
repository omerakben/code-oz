---
description: Run a read-only health check on the code-oz installation and active run state.
argument-hint: "[args]"
allowed-tools: Bash
---

This command only invokes the code-oz engine. Do not write `.code-oz/`, do not decide pass/fail, do not simulate review, and do not summarize gate/review status beyond engine output.

## What it does

`code-oz doctor` runs a read-only health check across the installation, provider auth, and active run state. It produces no provider calls and incurs no provider spend. A first run may download the engine via npx if the binary is absent.

## How to run it

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-code-oz.sh" doctor "$ARGUMENTS"
```

The resolver finds the engine via PATH binary, then npx fallback, then stops with install guidance. If it stops, surface that guidance verbatim; do not work around it.

This command has no provider spend, so run it without asking for confirmation.

## Surface results

Relay the engine's stdout and stderr verbatim. If the engine writes a `NEEDS_INTERVENTION.json`, surface the file path verbatim and stop. Do not open it and do not decide pass/fail.

## Boundaries

- Do not write under `.code-oz/` for any reason.
- Do not declare or emit gate state (`GATE_*`).
- Do not decide pass/fail from engine output.
- Do not simulate or claim to perform cross-family review; the engine owns that.
- If the engine exits non-zero, show the stderr to the user without paraphrasing.
