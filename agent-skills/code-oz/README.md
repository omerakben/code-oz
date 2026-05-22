# code-oz agent skill (Hermes / OpenClaw)

Text-only agentskills.io skill that teaches a self-hosted agent to drive the
`code-oz` CLI safely. No bundled executable — the agent calls an installed
`code-oz` directly.

## Install

Copy this `code-oz/` folder into your agent's skills directory:

- Hermes: `~/.hermes/skills/code-oz/`  (or `hermes skills add <path>`)
- OpenClaw: your personal/project skills dir.

Then ensure the engine is installed: `npm i -g @tuel/code-oz` or
`brew install omerakben/tap/code-oz`.

The skill drives code-oz in fail-closed operator mode, which bans the fake
provider, blocks SHIP/push, and records operator provenance. Bind the project
once with `code-oz init --operator <agent>` (or add `operator: <agent>` to
`.code-oz/config.yaml`) so every run/approve enforces operator mode
automatically — no per-command flags. The session env var `export
CODE_OZ_OPERATOR=<agent>` and the per-command `--non-interactive --operator
<agent>` flags also work. code-oz remains the only writer of gates, events, and
reviews.
