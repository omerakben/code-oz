---
release: v0.20.0-alpha.0
codename: W3a distribution sweep
status: tag-prep
prerequisites: Codex R1 fix-first + R2 push verdict
---

# v0.20.0-alpha.0 — W3a multi-channel distribution

First release that ships official install channels (curl|sh, npm,
Homebrew). Closes the W3a synthesis (`docs/design/CODEX_SYNTHESIS_W3A.md`,
Codex thread `019e18e9`) and the v0.19 demo continuation handoff
(`docs/handoffs/2026-05-12-w3a-continuation.md`).

## What landed

| # | Commit | Surface |
|---|---|---|
| 1 | W3a impl 1 | `scripts/build-binaries.ts` TARGETS extended 2 → 4 (darwin-{arm64,x64} + linux-{x64,arm64}); test fixtures updated; per-target tarball staging unchanged for local dev |
| 2 | W3a impl 2 | `scripts/install.sh` hardened: fail-closed SHA chain (sha256sum → shasum -a 256 → openssl dgst -sha256 → refuse), Linux OS detection (xattr quarantine strip darwin-only), `--version <TAG>` flag + `--help`, repo + asset URL constants |
| 3 | W3a impl 3 | First project CI: `.github/workflows/test.yml` (push + PR matrix on ubuntu + macos; bun install + typecheck + test) and `.github/workflows/release.yml` (v*.*.* tag matrix builds 4 per-arch binaries, stages per-arch tarballs, assembles checksums.txt, `gh release create --verify-tag` uploads everything) |
| 4 | W3a impl 4 | `scripts/install.sh` network-mode fetch: when no local bundle exists, downloads `code-oz-v${VER}-${OS}-${ARCH}.tar.gz` + checksums.txt from the tagged release URL via curl or wget, verifies SHA against checksums.txt entry (fail-closed on miss or mismatch), extracts, re-enters bundle-local install |
| 5 | W3a impl 5 | npm Node launcher at `npm-wrapper/index.cjs`: reads version from `package.json`, resolves binary at `~/.cache/code-oz/<version>/code-oz`, downloads + verifies + extracts on cache miss, spawns binary with stdio: inherit. `package.json` bin switches from `./dist/code-oz` to the wrapper; `files` allowlist trims publish bundle |
| 6 | W3a impl 6 | `docs/homebrew/code-oz.rb.template` (license MIT, per-arch on_macos + on_linux blocks, `test do` exercises `code-oz init`) + `docs/homebrew/README.md` tap-setup recipe (one-time `gh repo create omerakben/homebrew-code-oz`, per-release sed substitution from checksums.txt, `brew audit --strict --online` before push) |
| 7 | W3a impl 7 (this commit) | Version bump 0.19.0-alpha.0 → 0.20.0-alpha.0 across all 6 surfaces (package.json, src/cli.ts:PKG_VERSION, src/config/schema.ts:DEFAULT_CONFIG.version, tests/m5-fix-first.test.ts:CURRENT, tests/cli-init.test.ts, tests/smoke-test.test.ts:VERSION); CLAUDE.md status updated; this release notes file added |

## What's deferred

- **Scoop + Windows binary** — synthesis non-goal; v0.20.1 with Windows smoke CI.
- **Apple Developer signing** — install.sh keeps `xattr -d com.apple.quarantine` workaround; v0.x stable.
- **GPG-signed checksums** — SHA chain covers transit tampering; GPG would harden against a compromised GitHub release. v0.x stable.
- **Linux distro packages** (deb, rpm, AUR, Snap, Flatpak) — curl|sh + tarball covers Linux for v0.20.
- **Auto-update** (`code-oz upgrade --check`) — separate authority; W4 row.
- **Plugin/skill install** (`code-oz install npm:...`) — separate parser; future milestone if demand surfaces.
- **Homebrew formula auto-bump via GitHub Action** — manual sed substitution for v0.20; v0.21 polish.
- **`latest` URL resolution in install.sh + npm wrapper** — `--version <TAG>` is required for network-mode in v0.20. Latest resolution requires GitHub API parsing (versioned asset names break `/releases/latest/download/` redirects); deferred to v0.x stable.

## Single-binary contract

The three install channels deliver the same artifact via the same
`checksums.txt` source of truth:

- **curl|sh:** `curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh | sh -s -- --version v0.20.0-alpha.0` (or run install.sh from an unpacked tarball)
- **npm:** `npm install -g code-oz` — wrapper downloads + SHA-verifies + caches on first invocation
- **Homebrew:** `brew tap omerakben/code-oz && brew install omerakben/code-oz/code-oz` — formula verifies SHA via the `sha256` block

Same `code-oz-v0.20.0-alpha.0-${OS}-${ARCH}.tar.gz` artifact, same SHA,
same release.

## Test surface

`bun test` runs 3362 offline tests (was 3302 at v0.19.0-alpha.0 close).
Net +60 tests cover: SHA chain (6), Linux detection (4), CLI flags (3),
network-mode fetch (6), CI workflow structure (13) + release ↔ consumer
layout contract (3) + bun-install ordering guard (1), npm wrapper (7),
Homebrew formula template (12), and post-R1/R2 closure: install.sh
temp-dir cleanup (2) + downloader chain seam (3).

Live xAI integration tests stay opt-in
(`CODE_OZ_LIVE_PROVIDER_TESTS=xai`); the new `test.yml` workflow leaves
that env unset so CI runs the offline suite only.

## Push prerequisites

The W3a synthesis locks tag + publish behind two Codex review rounds:

1. **R1 (fix-first):** Codex reads the cumulative W3a sweep and returns
   `accept` / `fix-first` / `debate-required`. block-push and
   block-tag findings get a follow-up commit (never amended) before R2.
2. **R2 (push verdict):** Codex re-reads after R1 closures and returns
   `push` / `fix-first`. Only `push` clears the tag + release ops.

## Publish sequence (post-R2)

Per the synthesis, the publish order matters because the npm wrapper
downloads the binary from the GitHub release on first invocation:

1. `git push origin main` + `git tag v0.20.0-alpha.0 && git push origin v0.20.0-alpha.0`
2. `release.yml` runs in CI; produces the 4 tarballs + checksums.txt + uploads to the new release (~10 min on GitHub-hosted runners).
3. `gh release view v0.20.0-alpha.0 --json assets` to confirm all 6 assets attached (4 tarballs + checksums.txt + install.sh).
4. Manual smoke from macOS: `curl -fsSL .../v0.20.0-alpha.0/install.sh | sh -s -- --version v0.20.0-alpha.0`.
5. `npm publish` from repo root (the `files` allowlist already trims the bundle).
6. Render Homebrew formula via `docs/homebrew/README.md` recipe; push to `omerakben/homebrew-code-oz`.
7. Manual smoke: `brew tap omerakben/code-oz && brew install omerakben/code-oz/code-oz && code-oz --version`.
