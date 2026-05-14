---
release: v0.20.1-alpha.0
codename: first-run polish
status: draft
base: v0.20.0-alpha.0
---

# v0.20.1-alpha.0 — first-run polish

This draft tracks the first-run distribution PR:
`finalize/v0.20.1-first-run-polish`.

## Planned scope

- No-key CLI first run defaults to `FakeProvider`; explicit `--provider fake`
  keeps phase-valid scripted behavior.
- `code-oz resume` and `code-oz run --resume` route to the existing active-run
  continuation path.
- `code-oz doctor` has a concise aggregate mode, and each doctor subcommand
  handles `--help` before probing.
- `NEEDS_INTERVENTION.json` carries non-empty actionable suggestions plus a
  stable `eventPointer` diagnostic field for new writes.
- npm wrapper and `install.sh` fail closed with clearer recovery hints and
  stronger SHA/cache validation.
- Release workflow smoke checks staged binaries before upload.
- `code-oz-gui` dev startup works from the monorepo checkout, resolves the
  current CLI before stale local binaries, and includes self-contained unit,
  Playwright, and axe gates.
- Provider setup is documented in one table:
  [`docs/PROVIDER_SETUP.md`](../PROVIDER_SETUP.md).

## Deferred

- M17 AUDIT runtime implementation.
- Windows binaries, Scoop, Apple signing, GPG checksums, SWE-bench, Sentry, and
  telemetry.

## Validation target

- `bun test` with total `>=3366`
- `bun run typecheck`
- `bun run build:binary`
- `bun run scripts/smoke-test.ts`
- `cd code-oz-gui && bun test && bun run typecheck && bun run test:e2e && bun run test:a11y`
- npm-pack install smoke with transcript committed under
  `docs/handoffs/codex-finalize/SMOKE_TRANSCRIPT.md`
