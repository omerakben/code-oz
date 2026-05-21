---
description: Scaffold a code-oz project — writes the default config and prepares the repo for a run.
argument-hint: "[args]"
allowed-tools: Bash
---

This command only invokes the code-oz engine. Do not write `.code-oz/`, do not decide pass/fail, do not simulate review, and do not summarize gate/review status beyond engine output.

## What it does

`code-oz init` creates the `.code-oz/` directory, writes the default `config.yaml`, and prepares the repo for a `code-oz run`. The engine is the only writer; this command is a launcher.

## How to run it

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-code-oz.sh" init "$ARGUMENTS"
```

The resolver finds the engine via PATH binary, then npx fallback, then stops with install guidance. If it stops, surface that guidance verbatim; do not work around it.

Confirm the working directory is the repo the user wants to scaffold, then run.

## Surface results

Relay the engine's stdout and stderr verbatim. If the engine writes a `NEEDS_INTERVENTION.json`, surface the file path verbatim and stop. Do not open it and do not decide pass/fail.

## Boundaries

- Do not write under `.code-oz/` for any reason; the engine is the only writer.
- Do not declare or emit gate state (`GATE_*`).
- Do not decide pass/fail from engine output.
- Do not simulate or claim to perform cross-family review; the engine owns that.
- Do not run `init --force` without explicit user approval — `--force` overwrites an existing run.
- If the engine exits non-zero, show the stderr to the user without paraphrasing.
