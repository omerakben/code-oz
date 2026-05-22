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
provider, blocks SHIP/push, and records operator provenance. Set it once for the
session with `export CODE_OZ_OPERATOR=<agent>` so every call enforces it even if
a per-command flag is forgotten; the equivalent `--non-interactive --operator
<agent>` flags also work. code-oz remains the only writer of gates, events, and
reviews.
