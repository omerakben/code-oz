---
name: W3a publish status — tag shipped, CI green, npm + Homebrew need hands
status: open
date: 2026-05-12
authoritative-contract: docs/design/CODEX_SYNTHESIS_W3A.md
prior-session: docs/handoffs/2026-05-12-w3a-r1-ready.md
codex-rounds: R1 fix-first → R2 fix-first → R3 push
release-tag: v0.20.0-alpha.0
---

# W3a publish status — v0.20.0-alpha.0 shipped, npm + Homebrew pending

## What shipped this session

The full Codex review cycle and the GitHub-side release ops completed
autonomously. The remaining steps (npm publish, Homebrew tap creation
+ formula push) need interactive auth or a deliberate one-time-tap
decision.

| Step | State |
|---|---|
| R1 Codex review (read-only) | done — fix-first, 1 block-push + 3 fix-soon + 2 nits, 6 FYI |
| R1 closure commit `0108eff` | done — all R1 findings closed; +8 tests (3353 → 3361) |
| R2 Codex review (workspace-write) | done — fix-first, 1 new block-push (release.yml missing `bun install`) + 1 nit (test-count drift) |
| R2 closure commit `1d520fe` | done — release.yml install step added, ordering pinned by new test, drift cleaned; +1 test (3361 → 3362) |
| R3 Codex re-review (workspace-write) | done — verdict **push**, no new concerns |
| `git push origin main` | done — 9 commits ahead → pushed |
| Tag `v0.20.0-alpha.0` push | done |
| `test.yml` on main push | done — 49s, success |
| `release.yml` on tag push | done — 4 builds + publish job all green |
| GitHub release assets | done — 6 assets uploaded (4 tarballs + checksums.txt + install.sh) |
| curl\|sh smoke install | done — `~/.local/bin/code-oz --version` returns `0.20.0-alpha.0`; `code-oz doctor tools` returns `All required tools available.` |
| `npm publish --access public` | **blocked — interactive auth required** |
| Homebrew tap repo `omerakben/homebrew-code-oz` | **blocked — does not exist yet; one-time `gh repo create`** |
| Homebrew formula render + push | **blocked — depends on tap repo** |

## Verified release artifacts

```
checksums.txt                                           434 B
code-oz-v0.20.0-alpha.0-darwin-arm64.tar.gz           22.3 MB
code-oz-v0.20.0-alpha.0-darwin-x64.tar.gz             24.6 MB
code-oz-v0.20.0-alpha.0-linux-arm64.tar.gz            38.6 MB
code-oz-v0.20.0-alpha.0-linux-x64.tar.gz              39.1 MB
install.sh                                            9.9 KB
```

Release URL: https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0

## Next steps that need hands-on

### npm publish

```sh
cd /Users/ozzy-mac/Projects/code-oz
npm whoami                          # error → run `npm adduser` first
npm view code-oz versions --json    # 404 confirmed: name available
npm publish --access public         # one-time first publish
```

After `npm publish` succeeds:
- `npm view code-oz versions` should list `0.20.0-alpha.0`.
- `npm install -g code-oz` on a fresh machine should install via the
  wrapper; first invocation downloads + SHA-verifies the per-arch
  binary from the GitHub release.

### Homebrew tap (one-time + first formula)

```sh
# 1. Create the public tap repo.
gh repo create omerakben/homebrew-code-oz \
  --public \
  --description "Homebrew tap for the code-oz CLI"
git clone git@github.com:omerakben/homebrew-code-oz.git ~/Projects/homebrew-code-oz
mkdir -p ~/Projects/homebrew-code-oz/Formula

# 2. Render the formula from the template using release checksums.
VERSION=0.20.0-alpha.0
TAG="v${VERSION}"
TAP=~/Projects/homebrew-code-oz

curl -fsSL "https://github.com/omerakben/code-oz/releases/download/${TAG}/checksums.txt" \
  -o /tmp/checksums.txt

SHA_DA="$(awk -v f="code-oz-${TAG}-darwin-arm64.tar.gz" '$2==f{print $1}' /tmp/checksums.txt)"
SHA_DX="$(awk -v f="code-oz-${TAG}-darwin-x64.tar.gz"   '$2==f{print $1}' /tmp/checksums.txt)"
SHA_LA="$(awk -v f="code-oz-${TAG}-linux-arm64.tar.gz"  '$2==f{print $1}' /tmp/checksums.txt)"
SHA_LX="$(awk -v f="code-oz-${TAG}-linux-x64.tar.gz"    '$2==f{print $1}' /tmp/checksums.txt)"

sed -e "s/__VERSION__/${VERSION}/g" \
    -e "s/__SHA256_DARWIN_ARM64__/${SHA_DA}/" \
    -e "s/__SHA256_DARWIN_X64__/${SHA_DX}/" \
    -e "s/__SHA256_LINUX_ARM64__/${SHA_LA}/" \
    -e "s/__SHA256_LINUX_X64__/${SHA_LX}/" \
    docs/homebrew/code-oz.rb.template > "${TAP}/Formula/code-oz.rb"

# 3. Audit + push.
cd "${TAP}"
brew audit --strict --online Formula/code-oz.rb
git add Formula/code-oz.rb
git commit -m "code-oz ${VERSION}"
git push -u origin main

# 4. Smoke from a fresh shell.
brew untap omerakben/code-oz 2>/dev/null || true
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
code-oz --version    # should print 0.20.0-alpha.0
```

## Codex rounds — full trail

- `docs/design/CODEX_BRIEFING_W3A_R1.md` — R1 brief (re-used for R2 + R3)
- `docs/design/CODEX_RESPONSE_W3A_R1.md` — R1 findings
- `docs/design/CODEX_SYNTHESIS_W3A_R1.md` — R1 closure summary
- `docs/design/CODEX_RESPONSE_W3A_R2.md` — R2 new block-push (release.yml install)
- `docs/design/CODEX_RESPONSE_W3A_R3.md` — R3 push verdict

## Key learnings from this round

1. **Three Codex rounds caught three different bug classes.** R1
   found user-facing contract drift (README) + behavioral leak
   (subshell scope). R2 found infrastructure-readiness drift
   (release.yml missing `bun install`) that only surfaces when
   imagining a clean GitHub checkout running the workflow. R3
   confirmed closure. The pattern matches your prior
   "review-rounds-catch-different-classes" feedback note.

2. **macOS BSD mktemp ignores TMPDIR.** The first version of the
   cleanup test passed in the buggy code because TMPDIR overrides
   are silently ignored by macOS mktemp (it uses
   `_CS_DARWIN_USER_TEMP_DIR` via confstr). Switched to a fake
   `mktemp` shim that records the allocated path so the test can
   verify post-exit cleanup deterministically.

3. **`$(fn)` in POSIX sh does not propagate function-local
   assignments to the parent.** EXIT traps are not inherited into
   command substitution subshells either. Refactored
   `fetch_release_bundle` to set `BUNDLE_ROOT` as a parent-scope
   side-effect global; INSTALL_TMP_ROOT now lives in parent scope
   for the trap.

## Push policy reminder

Main + tag + GitHub release are pushed per the explicit boot
prescription (R3 push verdict cleared all gates). `npm publish` is
deliberately deferred — irreversible, needs `npm adduser`. Homebrew
tap creation is also deferred — public footprint, one-time decision.
Both are queued for the next interactive session.
