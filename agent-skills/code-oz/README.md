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

The skill drives code-oz in `--non-interactive --operator <agent>` mode, which
fails closed: it bans the fake provider, blocks SHIP/push, and records operator
provenance. code-oz remains the only writer of gates, events, and reviews.
