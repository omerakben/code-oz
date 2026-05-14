# A3-distribution findings

Sub-task: A3
Operator: codex-subtask-A3
Started: 2026-05-13T22:05:00Z
Finished: 2026-05-13T22:24:00Z

## Summary

I found 3 findings: 1 block-ship and 2 fix-soon. The biggest risk is `npm-wrapper/index.cjs` trusting any existing cached `code-oz` binary by path alone, which violates the A3 tampered-cache requirement and can execute modified cache contents without a checksum check. The tagged `scripts/install.sh` path worked on macOS arm64, release asset SHAs matched `checksums.txt`, targeted distribution tests passed, and workflow source inspection matched the W3a contract. Linux host install and Homebrew strict online audit remain partially unverified due local Docker daemon and current Homebrew audit constraints.

## Findings

### F3.1 - npm wrapper executes a tampered cached binary without verification

- **Severity:** block-ship
- **Where:** `npm-wrapper/index.cjs:125-128`, `npm-wrapper/index.cjs:163-168`, `tests/npm-wrapper.test.ts:34-46`, A3 checklist item in `docs/handoffs/2026-05-13-codex-finalize-distribution.md:138-140`
- **Evidence:**

  `npm-wrapper/index.cjs` returns the cached binary immediately when the file exists:

  ```text
  125 async function ensureBinary({ version, host, cacheRoot, baseUrl }) {
  126   const cacheDir = path.join(cacheRoot, version)
  127   const cachedBinary = path.join(cacheDir, 'code-oz')
  128   if (fs.existsSync(cachedBinary)) return cachedBinary
  ```

  The current tests prove cache reuse but do not cover a corrupted cache. A manual cache-tamper check executed the modified cached file even with the release URL unavailable:

  ```text
  command: HOME=/private/tmp/code-oz-a3-npm-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-npm-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm NPM_CONFIG_USERCONFIG=/private/tmp/code-oz-a3-npm-home/.npmrc BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun bash -lc 'set -eu; printf "#!/bin/sh\necho cached-binary-tampered-live\n" > /private/tmp/code-oz-a3-wrapper-cache/0.20.0-alpha.0/code-oz; chmod +x /private/tmp/code-oz-a3-wrapper-cache/0.20.0-alpha.0/code-oz; CODE_OZ_NPM_CACHE_DIR=/private/tmp/code-oz-a3-wrapper-cache CODE_OZ_NPM_BASE_URL=file:///missing-after-tamper HOME=/private/tmp/code-oz-a3-npm-home node npm-wrapper/index.cjs --version'
  exit: 0
  output: cached-binary-tampered-live
  ```

  A smaller temp-fixture repro produced the same behavior:

  ```text
  command: HOME=/private/tmp/code-oz-a3-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun bash -lc 'set -eu; ROOT=$(mktemp -d /private/tmp/code-oz-a3-corrupt-cache.XXXXXX); mkdir -p "$ROOT/home" "$ROOT/cache/0.20.0-alpha.0"; printf "#!/bin/sh\necho tampered-cache-ran \"$@\"\n" > "$ROOT/cache/0.20.0-alpha.0/code-oz"; chmod +x "$ROOT/cache/0.20.0-alpha.0/code-oz"; CODE_OZ_NPM_CACHE_DIR="$ROOT/cache" CODE_OZ_NPM_BASE_URL="file:///definitely-missing-release" HOME="$ROOT/home" node npm-wrapper/index.cjs --probe'
  exit: 0
  output: tampered-cache-ran
  ```

- **Why it matters for first-run UX:** The npm channel claims a SHA-verified single-binary contract, but after first download the wrapper no longer proves the cached executable is the release binary.
- **Proposed fix:** After extracting the tarball, read `manifest.json`, verify the extracted binary SHA against the manifest row, and persist a sidecar such as `code-oz.sha256` or the manifest next to the cached binary. On cache hit, compute the cached binary SHA and compare it to the sidecar or manifest before executing. If the check fails, delete the cache entry and re-download; if re-download is unavailable, fail closed with a clear cache-corruption message. Add a failing test that creates a valid cache, mutates `cache/<version>/code-oz`, points `CODE_OZ_NPM_BASE_URL` at a missing URL, and asserts the tampered binary is not executed.
- **Effort estimate:** s

### F3.2 - npm wrapper permits non-HTTPS download URLs and redirect downgrade

- **Severity:** fix-soon
- **Where:** `npm-wrapper/index.cjs:65-80`, W3a risk lock in `docs/design/CODEX_SYNTHESIS_W3A.md` requires HTTPS-only release fetch behavior
- **Evidence:**

  ```text
  65 async function download(url, destination) {
  66   if (url.startsWith('file://')) {
  ...
  74   const protocol = url.startsWith('https://') ? require('node:https') : require('node:http')
  ...
  78       if (status >= 300 && status < 400 && response.headers.location) {
  79         response.resume()
  80         download(response.headers.location, destination).then(resolve, reject)
  ```

  The default base URL is HTTPS, but the downloader accepts any non-HTTPS URL through `node:http`, and redirects are followed without rejecting a protocol downgrade.

- **Why it matters for first-run UX:** Without signed checksums, HTTPS is part of the integrity chain; if both tarball and `checksums.txt` are fetched over HTTP, a network attacker can replace both.
- **Proposed fix:** Parse URLs with `new URL()`. Allow only `https:` for production downloads and `file:` for explicit test fixtures. Reject `http:` and reject redirects whose resolved protocol is not `https:`. Add a unit test with a local redirect target that downgrades to `http:` and assert a clear fail-closed error.
- **Effort estimate:** xs

### F3.3 - Homebrew audit command in the release recipe is not executable on this Homebrew setup

- **Severity:** fix-soon
- **Where:** `docs/homebrew/code-oz.rb.template:15-16`, `docs/homebrew/README.md:56-58`
- **Evidence:**

  The rendered formula has valid Ruby syntax:

  ```text
  command: HOME=/private/tmp/code-oz-a3-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun ruby -c docs/homebrew/code-oz.rb.template
  exit: 0
  output: Syntax OK
  ```

  The documented path-based audit command is blocked by the installed Homebrew:

  ```text
  command: HOME=/private/tmp/code-oz-a3-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun bash -lc 'set -eu; TMP=$(mktemp -d /private/tmp/code-oz-a3-homebrew.XXXXXX); sed -e "s/__VERSION__/0.20.0-alpha.0/g" -e "s/__SHA256_DARWIN_ARM64__/25f441e30a67b690db6e7b2fd6db5fd748e1738e6862e0c7f61f1fa59b8c6df6/" -e "s/__SHA256_DARWIN_X64__/dd6178dee576b9b1932fb1c7d584487b9416676625f49bd981639ed2f99b7cdf/" -e "s/__SHA256_LINUX_ARM64__/f97e2c99403cbf26010d282a0f6351eee38f5b6e5b3dfb1fc606ad00dc9fe1b1/" -e "s/__SHA256_LINUX_X64__/2ac24d187ea08d5ee17137a4e342a35caedbc009d68e1b21343554df892e6a46/" docs/homebrew/code-oz.rb.template > "$TMP/code-oz.rb"; HOMEBREW_CACHE=/private/tmp/code-oz-a3-brew-cache HOMEBREW_LOGS=/private/tmp/code-oz-a3-brew-logs brew audit --strict --online "$TMP/code-oz.rb"'
  exit: 1
  output: Error: Calling `brew audit [path ...]` is disabled! Use `brew audit [name ...]` instead.
  ```

  `brew help audit` on this machine confirms the accepted shape is `brew audit [options] [formula|cask ...]`, with `--tap` available.

- **Why it matters for first-run UX:** The release operator cannot produce the required Homebrew audit evidence using the documented local render command, so the Homebrew channel can look ready while its strict audit gate is unverified.
- **Proposed fix:** Update the Homebrew release recipe to audit the formula in a real tap checkout by name or tap, not by arbitrary path. For example, render into `Formula/code-oz.rb` inside `omerakben/homebrew-code-oz`, then run the current supported audit form for that tap before pushing. Re-run and capture the exact passing command in the handoff.
- **Effort estimate:** xs

## Checks completed

- `scripts/install.sh --version v0.20.0-alpha.0` on macOS arm64 downloaded from the tagged release, SHA-verified, installed to a clean temp install dir, and the installed binary printed `0.20.0-alpha.0`.
- `checksums.txt` from the GitHub release matched all four release tarballs with `shasum -a 256 -c checksums.txt`.
- `npm-wrapper/index.cjs` first invocation with a clean temp cache downloaded the current per-arch binary and printed `0.20.0-alpha.0`.
- `npm-wrapper/index.cjs` second invocation with `CODE_OZ_NPM_BASE_URL=file:///missing-after-cache` reused cache and printed `0.20.0-alpha.0`.
- `npm pack --dry-run --json` showed the package contains `LICENSE`, `README.md`, `npm-wrapper/index.cjs`, and `package.json`; unpacked size 13153 bytes.
- Targeted distribution tests passed: `51 pass`, `0 fail` across `tests/install-script.test.ts`, `tests/npm-wrapper.test.ts`, and `tests/homebrew-formula.test.ts`.
- `.github/workflows/release.yml` has `bun-version: 1.3.9`, an explicit `bun install --frozen-lockfile` before build, four build matrix targets, checksums assembly, `install.sh` upload, and all four tarball upload globs.
- `.github/workflows/test.yml` has `ubuntu-latest` and `macos-latest`, `bun-version: 1.3.9`, `bun install --frozen-lockfile`, typecheck, and `bun test`; no skipped jobs found by source inspection.

## Gaps and unverified items

- Real Linux install was not executed. `docker --version` succeeded, but `docker image ls` failed because the Docker daemon socket was unavailable. Synthetic Linux coverage exists in `tests/install-script.test.ts` and passed, including `linux-x64` network mode and SHA-tool fallbacks.
- `gh release view v0.20.0-alpha.0 --repo omerakben/code-oz --json tagName,assets` was attempted under the required clean `HOME` and failed with exit 4 because GitHub CLI auth was absent. I used unauthenticated GitHub API and direct release asset downloads as fallback evidence.
- `brew audit --strict --online` on the rendered formula remains unverified because current Homebrew rejected path-based audit. Ruby syntax and template structure tests passed, but a supported tap/name audit command still needs to be run.
- I did not run full GitHub Actions workflows locally; workflow findings are source inspection plus live release artifact evidence.

## Commands run

Common command prefix unless noted: `HOME=/private/tmp/code-oz-a3-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun`

```text
command: mkdir -p /private/tmp/code-oz-a3-home /private/tmp/code-oz-a3-cache /private/tmp/code-oz-a3-npm /private/tmp/code-oz-a3-bun
exit: 0

command: git status --short --branch
exit: 0
output: ## finalize/v0.20.1-first-run-polish...origin/main

command: sed -n '1,240p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit: 0

command: sed -n '1,260p' CLAUDE.md
exit: 0

command: sed -n '1,260p' docs/design/CODEX_SYNTHESIS_W3A.md
exit: 0

command: sed -n '1,220p' README.md
exit: 0

command: sed -n '1,220p' docs/ABOUT.md
exit: 0

command: sed -n '260,520p' docs/handoffs/2026-05-13-codex-finalize-distribution.md
exit: 0

command: rg -n "W3|v0\\.20|distribution|Homebrew|npm|install\\.sh|release\\.yml|test\\.yml|checksums|Scoop|Windows" docs/design/ROADMAP.md
exit: 0

command: rg --files -uu .github docs/handoffs/codex-finalize scripts npm-wrapper docs/homebrew
exit: 0

command: sed -n '1,260p' scripts/install.sh
exit: 0

command: sed -n '260,520p' scripts/install.sh
exit: 0

command: sed -n '1,300p' npm-wrapper/index.cjs
exit: 0

command: sed -n '1,240p' docs/homebrew/code-oz.rb.template
exit: 0

command: sed -n '1,320p' .github/workflows/release.yml
exit: 0

command: sed -n '1,260p' .github/workflows/test.yml
exit: 0

command: sed -n '1,280p' tests/install-script.test.ts
exit: 0

command: sed -n '280,640p' tests/install-script.test.ts
exit: 0

command: sed -n '1,320p' tests/npm-wrapper.test.ts
exit: 0

command: sed -n '1,260p' tests/homebrew-formula.test.ts
exit: 0

command: bun test tests/install-script.test.ts tests/npm-wrapper.test.ts tests/homebrew-formula.test.ts
exit: 0
output: 51 pass, 0 fail

command: bash -lc 'set -eu; ROOT=$(mktemp -d /private/tmp/code-oz-a3-corrupt-cache.XXXXXX); mkdir -p "$ROOT/home" "$ROOT/cache/0.20.0-alpha.0"; printf "#!/bin/sh\necho tampered-cache-ran \"$@\"\n" > "$ROOT/cache/0.20.0-alpha.0/code-oz"; chmod +x "$ROOT/cache/0.20.0-alpha.0/code-oz"; CODE_OZ_NPM_CACHE_DIR="$ROOT/cache" CODE_OZ_NPM_BASE_URL="file:///definitely-missing-release" HOME="$ROOT/home" node npm-wrapper/index.cjs --probe'
exit: 0
output: tampered-cache-ran

command: gh release view v0.20.0-alpha.0 --repo omerakben/code-oz --json tagName,assets
exit: 4
output: gh auth login required

command: curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/checksums.txt
exit: 0

command: HOME=/private/tmp/code-oz-a3-install-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-install-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun CODE_OZ_INSTALL_DIR=/private/tmp/code-oz-a3-install-bin sh scripts/install.sh --version v0.20.0-alpha.0
exit: 0
output: code-oz installed at /private/tmp/code-oz-a3-install-bin/code-oz (version 0.20.0-alpha.0)

command: bash -lc 'set -eu; ROOT=$(mktemp -d /private/tmp/code-oz-a3-release-sha-ok.XXXXXX); cd "$ROOT"; curl -fsSLO https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/checksums.txt; for asset in code-oz-v0.20.0-alpha.0-darwin-arm64.tar.gz code-oz-v0.20.0-alpha.0-darwin-x64.tar.gz code-oz-v0.20.0-alpha.0-linux-arm64.tar.gz code-oz-v0.20.0-alpha.0-linux-x64.tar.gz; do curl -fsSLO "https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/$asset"; done; shasum -a 256 -c checksums.txt'
exit: 0
output: all four tarballs OK

command: HOME=/private/tmp/code-oz-a3-install-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-install-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun /private/tmp/code-oz-a3-install-bin/code-oz --version
exit: 0
output: 0.20.0-alpha.0

command: command -v brew
exit: 0
output: /opt/homebrew/bin/brew

command: curl -fsSL https://api.github.com/repos/omerakben/code-oz/releases/tags/v0.20.0-alpha.0
exit: 0

command: ruby -c docs/homebrew/code-oz.rb.template
exit: 0
output: Syntax OK

command: bash -lc 'set -eu; TMP=$(mktemp -d /private/tmp/code-oz-a3-homebrew.XXXXXX); sed -e "s/__VERSION__/0.20.0-alpha.0/g" -e "s/__SHA256_DARWIN_ARM64__/25f441e30a67b690db6e7b2fd6db5fd748e1738e6862e0c7f61f1fa59b8c6df6/" -e "s/__SHA256_DARWIN_X64__/dd6178dee576b9b1932fb1c7d584487b9416676625f49bd981639ed2f99b7cdf/" -e "s/__SHA256_LINUX_ARM64__/f97e2c99403cbf26010d282a0f6351eee38f5b6e5b3dfb1fc606ad00dc9fe1b1/" -e "s/__SHA256_LINUX_X64__/2ac24d187ea08d5ee17137a4e342a35caedbc009d68e1b21343554df892e6a46/" docs/homebrew/code-oz.rb.template > "$TMP/code-oz.rb"; HOMEBREW_CACHE=/private/tmp/code-oz-a3-brew-cache HOMEBREW_LOGS=/private/tmp/code-oz-a3-brew-logs brew audit --strict --online "$TMP/code-oz.rb"'
exit: 1
output: brew audit path form disabled

command: HOME=/private/tmp/code-oz-a3-npm-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-npm-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm NPM_CONFIG_USERCONFIG=/private/tmp/code-oz-a3-npm-home/.npmrc BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun CODE_OZ_NPM_CACHE_DIR=/private/tmp/code-oz-a3-wrapper-cache node npm-wrapper/index.cjs --version
exit: 0
output: 0.20.0-alpha.0

command: npm pack --dry-run --json
exit: 0

command: HOME=/private/tmp/code-oz-a3-npm-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-npm-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm NPM_CONFIG_USERCONFIG=/private/tmp/code-oz-a3-npm-home/.npmrc BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun CODE_OZ_NPM_CACHE_DIR=/private/tmp/code-oz-a3-wrapper-cache CODE_OZ_NPM_BASE_URL=file:///missing-after-cache node npm-wrapper/index.cjs --version
exit: 0
output: 0.20.0-alpha.0

command: HOME=/private/tmp/code-oz-a3-npm-home XDG_CACHE_HOME=/private/tmp/code-oz-a3-npm-home/.cache NPM_CONFIG_CACHE=/private/tmp/code-oz-a3-npm NPM_CONFIG_USERCONFIG=/private/tmp/code-oz-a3-npm-home/.npmrc BUN_INSTALL_CACHE_DIR=/private/tmp/code-oz-a3-bun bash -lc 'set -eu; printf "#!/bin/sh\necho cached-binary-tampered-live\n" > /private/tmp/code-oz-a3-wrapper-cache/0.20.0-alpha.0/code-oz; chmod +x /private/tmp/code-oz-a3-wrapper-cache/0.20.0-alpha.0/code-oz; CODE_OZ_NPM_CACHE_DIR=/private/tmp/code-oz-a3-wrapper-cache CODE_OZ_NPM_BASE_URL=file:///missing-after-tamper HOME=/private/tmp/code-oz-a3-npm-home node npm-wrapper/index.cjs --version'
exit: 0
output: cached-binary-tampered-live

command: docker --version
exit: 0
output: Docker version 29.2.1, build a5c7197

command: docker image ls --format '{{.Repository}}:{{.Tag}}'
exit: 1
output: failed to connect to the docker API at unix:///var/run/docker.sock
```
