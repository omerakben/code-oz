DO NOT MERGE

## Summary

Finalizes the v0.20.1 first-run polish and distribution audit fixes.

- Closes all block-ship first-run findings from `FIRST_RUN_AUDIT.md`.
- Adds line-specific intervention pointers, SIGTERM STOP handling, first-run fake fixture gating, release smoke SHA fallbacks, GUI live-run routing, fixture-run approval refusal, and GUI a11y coverage.
- Updates docs and release guidance for provider setup, GUI startup, brownfield scope, and v0.20.1 notes.

## Fix matrix

See `docs/handoffs/codex-finalize/FIRST_RUN_FIXES.md`.

## Verification

- `bun test`: 3390 pass / 2 skip / 0 fail.
- `bun run typecheck`: clean.
- `bun run build:binaries`: produced `dist/code-oz-v0.20.0-alpha.0-handoff.tar.gz`.
- `bun run smoke`: passed against the handoff tarball.
- `code-oz-gui`: `bun test`, `bun run typecheck`, and `bun run test:e2e` passed.
- `code-oz-gui`: `env DISABLE_HMR=true bun run test:a11y` passed outside the sandbox after sandboxed Chromium hit a macOS Mach-port permission failure.

## Notes

- Standalone a11y was also covered inside `bun run test:e2e`.
- Do not merge until CI is green and Ozzy explicitly approves merge.
