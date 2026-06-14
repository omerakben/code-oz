# 2026-06-14 release-readiness audit

This note captures the `v0.21.2-alpha.0` release-readiness truth sync after the shipped `v0.21.1-alpha.0` line. It was later updated after the actual `v0.21.2-alpha.0` publication completed.

## Current state

- GitHub release assets, curl install, Homebrew, and npm now publish `v0.21.2-alpha.0`.
- npm publishes `@tuel/code-oz@0.21.2-alpha.0` under the `alpha` dist-tag and exact version. The `latest` dist-tag still points at `0.21.1-alpha.0` until a separate npm 2FA dist-tag promotion.
- Recent post-tag commits fix Claude Code plugin marketplace installation and no-argument command handling.
- The root npm package is a launcher package, not a binary bundle.
- `code-oz-gui` is private and local-only; it is not a standalone packaged app.

## Validation measured in this audit

- `bun run typecheck`: pass.
- `bun run build:binary`: pass.
- `bun test ./tests`: 3796 pass, 2 skip, 0 fail across 241 files.
- `bun test`: 3818 pass, 2 skip, 0 fail across 246 files.
- `npm pack --dry-run --json`: package contains the expected launcher files only.
- `scripts/release/fresh-clone-smoke.sh`: pass from committed branch `codex/release-readiness-confidence`.
- `bash scripts/release/fresh-clone-smoke.sh --help`: pass.
- Plugin manifest, resolver, router, and skill-sync checks: pass.
- Claude Code `plugin validate --strict` for marketplace and both plugins: pass.
- Isolated Claude Code marketplace add/install with temporary `HOME`: both plugins install, enable, and report the expected component inventory.
- `code-oz-gui` install, typecheck, lint, unit tests, and production build: pass.
- Dogfood flows for first-run fake provider, public demos, doctors, and fake benchmark: pass.

## Findings closed

- CLI help no longer claims SHIP artifact-production work is a future M17 item.
- Windows support wording no longer promises stale `v0.21+` timing.
- `fresh-clone-smoke.sh --help` now exits before running the smoke flow.
- `fresh-clone-smoke.sh` now parses Bun test summaries by fields, avoiding false failures from matching `5 fail` inside `3815 pass`.
- Current docs now separate shipped features, experimental surfaces, and future work.

## Still not proven

- Live brownfield AUDIT dogfood still requires local provider credentials.
- Unqualified npm installs still resolve through the `latest` dist-tag until `npm dist-tag add @tuel/code-oz@0.21.2-alpha.0 latest --otp=<code>` runs.
- The isolated Claude Code marketplace install passed; a real user-profile install can still be repeated manually before announcement if desired.
- GUI standalone packaging is not designed or implemented.
