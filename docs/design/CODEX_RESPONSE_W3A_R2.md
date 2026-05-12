---
session: W3a R2 re-review — Codex response
thread: 019e1a2c-9fbe-7742-88c7-7e9808434bd5
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: fix-first
briefing: docs/design/CODEX_BRIEFING_W3A_R1.md (re-used)
r1-response: docs/design/CODEX_RESPONSE_W3A_R1.md
r1-synthesis: docs/design/CODEX_SYNTHESIS_W3A_R1.md
---

# Codex R2 response — W3a re-review after R1 closure

## Verdict: fix-first

## Closure assessment

- **Block-push (README):** Closed on the substantive issue.
  `README.md:38` now documents curl|sh with `--version`, npm, Homebrew,
  and platform deferrals. Residual test-count drift is listed below.
- **Fix-soon (temp-dir leak):** Closed. `scripts/install.sh:169` no
  longer calls `fetch_release_bundle` through command substitution,
  and `INSTALL_TMP_ROOT` remains visible to the parent `EXIT` trap.
- **Fix-soon (layout contract test):** Closed.
  `tests/ci-workflows.test.ts:190` now pins the release tarball
  layout to both consumer expectations.
- **Fix-soon (downloader branches + new env seam):** Closed.
  `scripts/install.sh:174` adds `CODE_OZ_FORCE_DOWNLOADER`, with wget,
  none, and invalid override coverage.
- **Nit (handoff doc):** Closed for the R1-ready document's historical
  state. `docs/handoffs/2026-05-12-w3a-r1-ready.md:55` now matches the
  pre-closure R1 handoff point.
- **Nit (package.json main/module):** Closed. `package.json:43` is
  CLI-only through `bin`; `npm pack --dry-run --json` includes only
  `LICENSE`, `README.md`, `npm-wrapper/index.cjs`, and `package.json`.

## New concerns

### Block-push (new in R2)

`.github/workflows/release.yml:35` does not install dependencies
before the build step at `release.yml:53`. In a clean `git archive
HEAD` temp checkout, `bun build --compile --target=bun-linux-x64
src/cli.ts` fails with:

> Could not resolve: "yaml". Maybe you need to "bun install"?

A tag push would run this workflow and fail before release assets are
produced. Fix by adding `bun install --frozen-lockfile` after `Setup
Bun` in the `build` job, and add a workflow test for it.

### Nit (new in R2)

Public/status docs still say `3353` tests while verified HEAD is
`3361`:
- `README.md:7`
- `CLAUDE.md:9`
- `docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:52`

## Rationale

The R1 closure commit did close the targeted findings. R2 verified
the focused closure surface with `bun test tests/install-script.test.ts
tests/ci-workflows.test.ts --bail` (48 pass), `bun run typecheck`
(silent), `bun test --bail` (3361 pass / 0 fail / 2 skip), `git diff
--check origin/main...HEAD`, and `npm_config_cache=/private/tmp/code-oz-npm-cache
npm pack --dry-run --json`.

The blocker is now the release workflow itself: the next prescribed
step is to push the tag and let `release.yml` build/upload assets,
but that workflow starts from a clean GitHub checkout and currently
skips dependency installation. That makes the release path
non-shippable even though the local test suite is green.
