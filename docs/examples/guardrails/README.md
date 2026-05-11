# Guardrail rule examples (inert until copied to `.code-oz/`)

This folder ships example guardrail rules for the rule-9 enforcement layer
(see `docs/contracts/GUARDRAILS.md`). Examples here are **not loaded by the
runtime** — they are templates operators copy into one of:

- `.code-oz/guardrails.md` (single-file form)
- `.code-oz/guardrails/<rule-name>.md` (per-file form)

The runtime wire-in slice that actually loads `.code-oz/guardrails*` is
deferred to a follow-up commit (gated on Codex's post-implementation review
of the contract + module). Examples land first so operators can read the
schema in concrete form.

## Files

- `block-rm-rf.md` — block-action runtime rule on the `Bash` tool.
  Demonstrates: `action: block`, single-condition `command contains rm -rf`.
- `warn-console-log-in-prod-source.md` — warn-action runtime rule.
  Demonstrates: multi-condition AND (`file_path` glob + `new_content`
  contains), `dedupKey` template, `maxMatchesPerRun`.
- `artifact-authoring-secret-leak.md` — artifact-authoring scope rule.
  Demonstrates: `scope: artifact-authoring` (does not fire on runtime tool
  calls), regex with `maxLength`, `priority` higher than warn defaults.

## Reading the examples

Each example file is a complete guardrail rule. Frontmatter is the schema
contract; the Markdown body is the message that surfaces to the operator
on a `warn` or `block` decision.

To try an example, copy it to `.code-oz/guardrails/` (creating the directory
if necessary) once the wire-in slice has landed. Until then, copying does
nothing — the runtime does not yet read the directory.
