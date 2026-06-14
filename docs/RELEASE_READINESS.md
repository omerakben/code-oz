# Release readiness

Current status as of 2026-06-14: `v0.21.2-alpha.0` is published on GitHub release assets and Homebrew. npm `@tuel/code-oz@0.21.2-alpha.0` is package-ready but still pending publish authorization; the repo-side path is `.github/workflows/npm-publish.yml`, which uses npm trusted publishing with GitHub Actions OIDC.

This page separates what is publishable today from what is manual, experimental, or future work.

## Publishable surfaces today

| Surface | Package or path | Status | Notes |
|---|---|---|---|
| CLI binary | `src/cli.ts` compiled by `bun build --compile` | Publishable for macOS/Linux | GitHub release workflow builds per-arch tarballs and `checksums.txt`. Windows is not built. |
| npm launcher | `@tuel/code-oz` | Publish-ready, auth pending | `package.json.files` includes `npm-wrapper/`, `README.md`, and `LICENSE`. The wrapper downloads the matching GitHub release binary on first run. |
| Homebrew formula | `docs/homebrew/code-oz.rb.template` | Published for `0.21.2-alpha.0` | Render from release checksums, then commit to `omerakben/homebrew-code-oz`. |
| Claude Code plugin marketplace | `.claude-plugin/marketplace.json` | Repo-root marketplace metadata present | Contains `code-oz` engine wrapper plugin and advisory `code-oz-discipline` plugin. |
| Agent skill bundle | `agent-skills/code-oz/` | Text-only integration surface | No executable. It teaches external agents how to drive the CLI without owning gates. |

## Not publishable as standalone products yet

| Surface | Current state | Before publishing |
|---|---|---|
| `code-oz-gui` | Private Next app in `code-oz-gui/`; fixture and local live-run UI | Decide supported runtime, desktop/web packaging, auth story, persistence, update flow, accessibility baseline, and release channel. |
| Windows/Scoop | Explicitly unsupported by launcher and plugin resolver | Add Windows binary build, launcher branch, Scoop manifest, and Windows smoke CI. |
| Signed artifacts | SHA-256 checksums only | Add Apple Developer signing/notarization, signed checksums, and SLSA/Sigstore provenance. |
| Live Gemini / OpenCode / Roo | Future adapter candidates or stub | Implement provider adapters and offline/live tests before documenting as supported. |
| Full benchmark proof | Deterministic `code-oz Fake` column measured | Run direct-agent and live-provider columns with credentials before making model-quality claims. |

## Root package publishing checklist

Run from the repo root before publishing a new alpha:

```sh
bun install
bun run typecheck
bun test ./tests
bun test
bun run build:binary
npm pack --dry-run --json
scripts/release/fresh-clone-smoke.sh
```

Expected package shape for `npm pack --dry-run --json`: a small launcher tarball containing `LICENSE`, `README.md`, `npm-wrapper/index.cjs`, and `package.json`. The native binary is not packed into npm; it is downloaded from the matching GitHub release by the wrapper.

Do not publish npm before the GitHub release assets for the exact version exist, because the first npm invocation downloads `https://github.com/omerakben/code-oz/releases/download/v<version>/...`.

`scripts/release/fresh-clone-smoke.sh` clones the current branch from git, so it validates committed `HEAD`, not uncommitted working-tree edits. Run it after the release-readiness patch is committed.

## npm publish authorization

Preferred path: use npm trusted publishing for `.github/workflows/npm-publish.yml`.

Account-side setup on npmjs.com:

1. Open `@tuel/code-oz` package settings.
2. Add a trusted publisher:
   - Provider: GitHub Actions
   - Organization or user: `omerakben`
   - Repository: `code-oz`
   - Workflow filename: `npm-publish.yml`
   - Allowed action: `npm publish`
3. Run the workflow from GitHub Actions with `version=0.21.2-alpha.0`.

CLI trigger after the workflow is on `main`:

```sh
gh workflow run npm-publish.yml -f version=0.21.2-alpha.0
gh run watch --exit-status
npm view @tuel/code-oz@0.21.2-alpha.0 version
npm view @tuel/code-oz dist-tags --json
```

Fallback path: publish locally after authenticating to npm:

```sh
npm login
npm whoami
npm publish --access public --tag alpha
npm view @tuel/code-oz@0.21.2-alpha.0 version
```

Direct local publishing requires an npm account with publish rights to `@tuel/code-oz` and either account 2FA or a granular access token with publish rights and bypass 2FA enabled. Alpha versions publish under the `alpha` dist-tag, not `latest`. The current machine is not authenticated to npm, so local publish returns `E401`.

## Plugin publishing checklist

Run:

```sh
bun test tests/plugins/manifest-shape.test.ts \
  tests/plugins/discipline-manifest.test.ts \
  tests/plugins/router-hook.test.ts \
  tests/plugins/bootstrap-resolver.test.ts
bun run skills:check
```

Manual checks:

- `/plugin marketplace add omerakben/code-oz` resolves the repo-root marketplace.
- `/plugin install code-oz@code-oz-marketplace` installs the enforcing wrapper plugin.
- `/plugin install code-oz-discipline@code-oz-marketplace` installs advisory skills only.
- A fresh plugin command with no user arguments does not forward an empty-string positional to the engine.
- Users can tell the wrapper plugin invokes the engine, while the discipline plugin is advisory only.

## GUI planning checklist

Run from `code-oz-gui/`:

```sh
bun install
bun run typecheck
bun test tests/unit
bun run build
```

Before calling the GUI standalone-ready, decide and document:

- whether it ships as a local web app, desktop app, or hosted service
- how it locates or installs the CLI binary
- whether run registry state persists beyond process memory
- how credentials are configured without leaking into artifacts
- which viewports are supported
- accessibility acceptance criteria
- packaging, signing, update, and rollback flow

## Current validation receipt

Measured locally on 2026-06-14:

- `bun run typecheck`: pass.
- `bun run build:binary`: pass.
- `bun test ./tests`: 3796 pass, 2 skip, 0 fail across 241 files.
- `bun test`: 3818 pass, 2 skip, 0 fail across 246 files.
- `npm pack --dry-run --json`: pass, launcher package contains `LICENSE`, `README.md`, `npm-wrapper/index.cjs`, and `package.json`.
- `scripts/release/fresh-clone-smoke.sh`: pass from committed branch `codex/release-readiness-confidence`; full tests, both demos, and drift checks passed.
- `bash scripts/release/fresh-clone-smoke.sh --help`: pass.
- `bun test tests/plugins/manifest-shape.test.ts tests/plugins/discipline-manifest.test.ts tests/plugins/router-hook.test.ts tests/plugins/bootstrap-resolver.test.ts`: pass.
- `bun run skills:check`: pass.
- `claude plugin validate --strict .claude-plugin/marketplace.json`, `plugins/code-oz`, and `plugins/code-oz-discipline`: pass.
- Isolated Claude Code marketplace install with temporary `HOME`: `code-oz@code-oz-marketplace` and `code-oz-discipline@code-oz-marketplace` install and appear enabled in `claude plugin list --json`; `claude plugin details` reports the expected one hook for `code-oz` and three advisory skills for `code-oz-discipline`.
- `code-oz-gui`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun test tests/unit`, and `bun run build` pass.
- Dogfood flows: first-run fake provider, `bun run demo:todo-cli`, `bun run demo:failure-gates`, `doctor providers`, `doctor tools`, `doctor git`, and `bench agent-gate --fixture todo-cli-real-tests --provider fake` pass.

These are enough to call the docs/package/plugin/GUI release-prep patch ready for review. The public release is live through GitHub release assets, curl install, and Homebrew. npm still needs one authorization step through trusted publishing or an authenticated local publish.
