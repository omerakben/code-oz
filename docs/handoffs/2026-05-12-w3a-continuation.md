---
name: W3a continuation handoff — distribution sweep resumes here
status: open
date: 2026-05-12
authoritative-contract: docs/design/CODEX_SYNTHESIS_W3A.md
prior-session: docs/handoffs/2026-05-12-session-3-opencode-triage.md
prior-context: v0.19.0-alpha.0 shipped; demo asciicast recorded; W3a impl #1 (Linux binary targets) landed
next-session: resume W3a impl #2 (install.sh hardening) → R1/R2 → v0.20.0-alpha.0 tag
---

# W3a continuation handoff — picking up the distribution sweep

The locked W3a synthesis (`docs/design/CODEX_SYNTHESIS_W3A.md`) ships v0.20.0-alpha.0 in 6 implementation commits + R1/R2 Codex reviews. This session shipped commit #1 + recorded the deferred asciicast. The next session resumes at commit #2 with the synthesis still locked and all decisions inherited.

## What landed this session (4 commits on origin/main)

| SHA | Commit |
|---|---|
| `e7bd660` | docs(w3a): Codex pre-design briefing + response + synthesis (thread 019e18e9) |
| `8399778` | feat(build): W3a impl 1 — Linux x64 + arm64 binary targets |
| (this commit) | feat(demo): record asciicast cast.cast (Codex retro block-tag #2 closure) + W3a continuation handoff |

Pre-existing on the v0.19 tag: 3-session plan + demo prep + Codex retrospective fixes + v0.19.0-alpha.0 release.

## Final state at handoff

- **origin/main HEAD:** post-handoff-commit (this commit). 0 ahead of origin.
- **Tag:** `v0.19.0-alpha.0` (latest). v0.20 deferred until W3a closes.
- **Tests:** 3302 pass / 0 fail / 2 skip.
- **Typecheck:** silent.
- **Worktrees:** main only (auxiliary worktrees pruned).
- **Stashes:** `stash@{0}` Q7 lineage (deferred, needs rebase per `feedback_stash_on_stale_base.md`), `stash@{1}` pre-merge pi-mono-borrows.
- **TARGETS:** 4 entries (darwin-{arm64,x64}, linux-{x64,arm64}). Windows deferred to v0.20.1.
- **Demo:** runnable end-to-end via `bun run demo:todo-cli [--effort ...]`. Cast at `docs/demo/01-todo-cli/cast.cast` (4.2k, asciinema v3). 3 effort-level output captures committed under `docs/demo/01-todo-cli/output/`.

## What's locked and inherited (do NOT re-litigate)

Per `docs/design/CODEX_SYNTHESIS_W3A.md`:

1. **npm strategy:** path (c) — Node-compatible binary-wrapper. ship `index.js` (~50 LOC) that downloads + verifies SHA + caches + execs platform binary from GitHub release. NOT path (a) source-via-bun, NOT path (b) postinstall-download.
2. **install.sh:** fail-closed integrity chain (sha256sum / shasum / openssl dgst). Pin URL to tagged release asset, NOT mutable `main`.
3. **Target matrix:** 4 binaries (darwin-arm64, darwin-x64, linux-x64, linux-arm64). Windows + Scoop = v0.20.1. Apple Developer signing = v0.x stable. GPG-signed checksums = v0.x stable.
4. **CI baseline:** first CI in the project. `.github/workflows/test.yml` (push + PR) + `.github/workflows/release.yml` (tag push). Matrix: macos-latest + ubuntu-latest.
5. **Homebrew formula:** per-arch SHA, `license "MIT"`, no `depends_on`, `bin.install`, `test do` running `code-oz init`. Tap repo: `omerakben/homebrew-code-oz`.
6. **Single binary contract:** install.sh + npm wrapper + Homebrew formula consume the SAME `checksums.txt` from the GitHub release.
7. **Plugin install / auto-update / Scoop:** out of W3a scope.

## Next session: resume here

```sh
cd /Users/ozzy-mac/Projects/code-oz
git status --short              # expect: empty
git log --oneline -5            # expect: this handoff at top
bun test                        # expect: 3302 pass / 0 fail / 2 skip
cat docs/design/CODEX_SYNTHESIS_W3A.md  # re-read the locked synthesis
```

### Next commit — W3a impl #2 (install.sh hardening, ~1.5h)

Three sub-changes per the synthesis:

1. **Replace fail-open SHA check.** Current `scripts/install.sh:94` skips verification if `shasum` is missing. Replace with a fail-closed chain:
   ```sh
   if command -v sha256sum >/dev/null 2>&1; then SUM_TOOL=sha256sum
   elif command -v shasum >/dev/null 2>&1; then SUM_TOOL="shasum -a 256"
   elif command -v openssl >/dev/null 2>&1; then SUM_TOOL="openssl dgst -sha256"
   else
     echo "ERROR: no SHA256 tool found (sha256sum / shasum / openssl). Refusing to install without integrity verification." >&2
     exit 1
   fi
   ```
2. **Add Linux detection.** Current install.sh is macOS-only (arch detection via `uname -m`). Extend to detect `linux` os and the 4 arch matches.
3. **Pin URL to tagged release.** Add a `--version <TAG>` flag that defaults to latest stable; replace any `raw.githubusercontent.com/.../main/...` URL with `https://github.com/omerakben/code-oz/releases/download/<TAG>/...`. The README's primary curl|sh command remains pointed at the latest release (GitHub provides a `/releases/latest/download/...` redirect URL for this).

After committing #2, run `tests/smoke-test.test.ts` to verify the install path still works on darwin fixtures.

### Then: commits #3 through #7 + Codex R1/R2 per the synthesis

| # | Commit | Estimate |
|---|---|---|
| 3 | `.github/workflows/test.yml` (test CI baseline) + `.github/workflows/release.yml` (4-binary build matrix, checksums.txt, GitHub release asset upload) | ~2.5h |
| 4 | Already part of commit #2 in the synthesis (install.sh + tagged URL) — no separate commit needed; renumber if helpful | — |
| 5 | `npm-wrapper/index.js` Node launcher (~50 LOC, downloads binary from GitHub release on first run, verifies SHA, caches at ~/.cache/code-oz/<version>/code-oz, execFiles it) + package.json refactor (ship wrapper + remove `dist/` from publish bundle) | ~2h |
| 6 | New repo: `omerakben/homebrew-code-oz`. `Formula/code-oz.rb` per the synthesis minimum (per-arch SHA, license MIT, no depends_on, test do block). `brew audit --strict --online` clean before push. | ~2h |
| 7 | Tag commit. Bump all 7 version surfaces (existing 6 + npm-wrapper `index.js` literal). `npm publish` (sequenced AFTER GitHub release publish so first-run downloads find the binary). `gh release create` with all assets. Push tag. Push tap repo. | ~1.5h |
| R1 + R2 | Codex review rounds on the cumulative W3a sweep. R1 = fix-first; R2 = verdict push. | ~2h overhead |

## Risk carry-forward (from synthesis § "Risk register")

- **R3 — Homebrew audit failures:** run `brew audit --strict --online Formula/code-oz.rb` locally before pushing the tap repo. Common gotchas: missing `license`, `livecheck` block, formula style violations on the `test do` block.
- **R5 — npm wrapper download fails on first run:** retry-with-backoff (3 attempts, exponential), cache eviction policy, actionable error pointing at the curl|sh manual install path.
- **R8 — First CI run uncovers latent test-suite bugs not seen locally:** run CI early (commit #3) so test surprises surface before commits #5/#6/#7 hit. The macOS-only test fixtures may have darwin-specific assumptions that fail on ubuntu-latest.

## Memory candidates from this session (already saved or worth saving next session)

- `feedback_stash_on_stale_base.md` — already saved during Codex retro fixes.
- (next session) consider: "buildAll `targets` opt-in pattern" — when a production function iterates a globally-grown constant (like TARGETS), expose an optional subset filter so tests can opt into bounded fixtures while production iterates everything. Saves the "expand fixtures everywhere when the constant grows" tax.

## Push policy reminder

Default no-push per the project's locked invariant. This session pushed to origin already (cumulative `4f4d061..` through the v0.19 tag + W3a pre-design + impl #1 + this handoff). Next session's commits stay local until R2 push verdict, then publish in the synthesis-locked order: binaries first (GitHub release), then npm, then Homebrew tap.

## Acceptance for v0.20.0-alpha.0 (recap from synthesis)

- [ ] All 4 binaries build cleanly via CI.
- [ ] `checksums.txt` published with the release.
- [ ] `curl -fsSL https://github.com/.../releases/download/v0.20.0-alpha.0/install.sh | sh` works on macOS arm64 (manual smoke).
- [ ] `brew install omerakben/code-oz/code-oz` works (formula audit clean).
- [ ] `npm install -g code-oz` succeeds; first-run `code-oz --version` downloads + verifies + caches.
- [ ] All 7 version surfaces bumped in tag commit.
- [ ] Codex R2 push verdict.
- [ ] Tag, GitHub release, npm publish, Homebrew tap formula all live.
- [ ] README updated with all 3 install commands.
