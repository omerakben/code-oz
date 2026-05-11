---
session: W3a pre-design synthesis
status: locked
inputs: CODEX_BRIEFING_W3A.md + CODEX_RESPONSE_W3A.md (verdict accept-with-modifications)
outcome: revised W3a scope ships a single binary contract via 3 channels (curl|sh, Homebrew, npm-wrapper), Windows deferred to v0.20.1, fail-closed integrity chain locked
---

# W3a synthesis — distribution surface for v0.20.0-alpha.0

## What Codex changed in the plan

Codex returned `accept-with-modifications` with 4 block findings + 2 fix-soons. The plan locks in the following revisions:

### 1. npm: switch from "path (a) source-via-bun" to "path (c) binary-wrapper"

The pre-design briefing assumed all channels wrap the same versioned binary contract. Codex caught that path (a) (ship `src/` and require bun on user's machine) breaks that framing — it's a different-semantics channel, not a wrapper.

**Locked decision:** ship npm as a **Node-compatible binary launcher** (the esbuild / sharp / better-sqlite3 pattern):

- npm package `code-oz` ships a tiny `index.js` (~50 LOC) plus the binary tarball metadata.
- `package.json` `"bin": { "code-oz": "./index.js" }` — Node-compatible shebang.
- On first invocation, `index.js` detects the user's platform, downloads `code-oz-<os>-<arch>` from the GitHub release matching `package.json:version`, verifies SHA256 against the published `checksums.txt`, caches the binary at `~/.cache/code-oz/<version>/code-oz`, and `execFile`s it.
- Subsequent invocations cache-hit on the cached binary.
- No bun dependency on the user's machine. No postinstall lifecycle hook (executes on `code-oz <cmd>` invocation, not install time — survives `npm ci --ignore-scripts`).

This maintains the single-binary-contract framing: same SHA, same binary, same release source across all three channels (curl|sh, Homebrew, npm).

### 2. install.sh: fail closed on integrity check

Current `scripts/install.sh:94` skips SHA verification if `shasum` isn't present. **Locked:** replace with a fail-closed chain:

```sh
# Try sha256sum (Linux), shasum -a 256 (macOS), openssl dgst -sha256 (fallback).
# Exit non-zero if none are available — never silently skip.
```

Plus: pin the install URL to a tagged release asset, not mutable `main`. Each release's `install.sh` lives at `https://github.com/omerakben/code-oz/releases/download/<TAG>/install.sh`. The README documents the latest-stable curl|sh command as a redirect URL that always points at the latest release.

### 3. Target matrix locked (5 targets → 4 for v0.20)

| OS | Arch | Asset name | Format | Smoke command |
|---|---|---|---|---|
| darwin | arm64 | `code-oz-v0.20.0-alpha.0-darwin-arm64.tar.gz` | tarball | `code-oz --version` + `code-oz init <tmp>` |
| darwin | x64 | `code-oz-v0.20.0-alpha.0-darwin-x64.tar.gz` | tarball | same |
| linux | x64 | `code-oz-v0.20.0-alpha.0-linux-x64.tar.gz` | tarball | same |
| linux | arm64 | `code-oz-v0.20.0-alpha.0-linux-arm64.tar.gz` | tarball | same |
| **windows** | **x64** | **(DEFERRED to v0.20.1)** | n/a | n/a |

`checksums.txt` lists all 4 asset SHA256s. install.sh + npm-wrapper + Homebrew formula all consume the same `checksums.txt`.

### 4. CI baseline added (this is the FIRST CI in the project)

`.github/workflows/test.yml` — on push to main + PR:
- Matrix: `macos-latest` + `ubuntu-latest`
- Steps: `bun install`, `bun run typecheck`, `bun test`
- No Windows runner yet (Windows deferred to v0.20.1)

`.github/workflows/release.yml` — on tag push (`v*.*.*`):
- Matrix: `macos-latest` (builds darwin-arm64 + darwin-x64), `ubuntu-latest` (builds linux-x64 + linux-arm64)
- Build via `bun build --compile --target=<bun-target>`
- Generate per-asset SHA256, append to `checksums.txt`
- Create GitHub release, upload all 4 tarballs + `checksums.txt` + `install.sh`
- Trigger npm publish (separate step after binary upload succeeds — sequencing-critical so first-run downloads find the binary)

### 5. Homebrew formula minimum

`omerakben/homebrew-code-oz/Formula/code-oz.rb`:
- `license "MIT"`
- Per-arch `on_macos do; on_arm do; url; sha256; end; on_intel do; url; sha256; end; end`
- No `depends_on` (binary is self-contained)
- `bin.install "code-oz"`
- `test do; system "#{bin}/code-oz", "init"; end` — tests `init` in Homebrew's temp test path, not just `--version`

Formula bumping is manual for v0.20 (update SHAs per release). Auto-bumping via GitHub Action is a v0.21 polish.

### 6. Scoop explicit deferral

W3a non-goal locked in README + CLAUDE.md status: "Scoop / PowerShell installer deferred; Windows is release-asset-only until v0.20.1 with smoke CI."

## What W3a does NOT cover (forward-deferred)

- **Plugin/skill install command** (`code-oz install npm:@foo/...`): different parser, different runtime decision. Separate authority. Designed in `docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md`; lands in a future milestone if demand surfaces.
- **Auto-update** (`code-oz upgrade --check`): separate authority (runtime decision about new versions). W4 row.
- **GPG-signed checksums**: SHA chain protects against transit tampering; GPG would protect against compromised GitHub release. v0.20 alpha is acceptable without; document as a known limitation.
- **Windows binary + Scoop manifest**: defer to v0.20.1, gated on Windows CI smoke.
- **Apple Developer signing** (gatekeeper-friendly): defer to v0.x stable. install.sh strips quarantine (`xattr -cr`) as a workaround.
- **Linux distro packages** (deb, rpm, AUR, Snap, Flatpak): defer indefinitely; curl|sh + binary tarball covers Linux for v0.20.

## Revised 6-commit implementation plan

| # | Commit | Estimate | Codex finding closed |
|---|---|---|---|
| 1 | Extend `scripts/build-binaries.ts` TARGETS to add `linux-x64` + `linux-arm64`. Lock asset naming convention. | ~45 min | block-impl #3 |
| 2 | Harden `scripts/install.sh`: fail-closed SHA chain (sha256sum/shasum/openssl), tagged release URL, Linux detection. | ~1.5 hr | block-impl #2 |
| 3 | Add `.github/workflows/test.yml` (CI baseline) + `.github/workflows/release.yml` (tagged release with all 4 binaries + checksums.txt + install.sh upload). | ~2.5 hr | block-impl #4 |
| 4 | Create `omerakben/homebrew-code-oz` tap repo + `Formula/code-oz.rb` (per-arch SHA, license, test block). Audit with `brew audit --strict --online` before pushing. | ~2 hr | fix-soon #6 |
| 5 | Write npm wrapper: `npm-wrapper/index.js` (~50 LOC Node-compatible launcher that downloads + caches + execs the platform binary). Update `package.json` to ship the wrapper + remove `dist/` from the publish bundle. | ~2 hr | block-design #1 |
| 6 | Tag commit: bump all 6 version surfaces + scope-amendment note for Scoop/Windows deferral + npm publish + GitHub release publish + Homebrew tap formula push (sequenced: binaries first, then npm). | ~1.5 hr | nit #7 + release residue lesson |

**Total: ~10 hrs implementation + 2 hrs Codex R1+R2 review = single ~1.5 day focused session.**

## Cross-cutting concerns (locked)

- **Binary integrity:** install.sh + npm wrapper + Homebrew formula all consume the same `checksums.txt` from the GitHub release. Single source of truth.
- **Version surfaces:** package.json (now 7 surfaces — original 6 + npm-wrapper version literal). Tag commit touches all in one go.
- **Test discipline:** every commit runs `bun typecheck` + `bun test` locally before commit. Final tag commit verifies green via CI matrix.
- **Codex cadence:** pre-design (this), implementation, R1 (fix-first), R2 (verdict push). No tag before R2 push.
- **Push policy:** local-only until R2 push verdict. Then push main + tag + create GitHub release + npm publish + push Homebrew tap.

## Risk register updated

| ID | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | bun cross-compile to linux from macOS runner fails | Low | Block-tag | CI matrix uses ubuntu-latest for linux builds — native compile, no cross. |
| R2 | npm name `code-oz` taken between synthesis and publish | Very low (404 confirmed) | Recoverable | Reserve immediately by publishing a 0.0.0-placeholder to `code-oz` from the npm-wrapper commit, then real publish at tag. |
| R3 | Homebrew tap audit failures | Medium | Block-tag | Run `brew audit --strict --online` locally before pushing tap. |
| R4 | install.sh fail-closed UX confusing (user sees integrity error and panics) | Low | Fix-soon | Print clear "expected SHA <X>, got SHA <Y>" message + actionable guidance: "verify download isn't corrupted, retry, or file an issue." |
| R5 | npm wrapper download fails (rate limit, network) on first run | Medium | Fix-soon | Retry-with-backoff + cache eviction policy + actionable error on persistent failure pointing at `~/.local/bin/code-oz` manual install. |
| R6 | npm wrapper cache directory permission issues | Low | Fix-soon | Default cache to `os.tmpdir()/code-oz-<version>` if `~/.cache/code-oz` is non-writable. |
| R7 | Windows clamor (users want Windows in v0.20) | Medium | Fix-soon | Release notes explicitly state Windows = v0.20.1; track demand. |
| R8 | First CI run uncovers latent test-suite bugs not seen locally | Medium | Fix-soon | Run CI early (commit #3) so test surprises surface before commits 4+5+6. |
| R9 | npm wrapper introduces new attack surface (network on every first run) | Medium | Block-design | Verify SHA against GitHub release `checksums.txt`; fail closed on mismatch. HTTPS-only. No fallback URLs. |

## Acceptance criteria for v0.20.0-alpha.0 ship

- [ ] All 4 binaries (darwin-arm64, darwin-x64, linux-x64, linux-arm64) build cleanly via CI.
- [ ] `checksums.txt` lists all 4 binary SHAs.
- [ ] `curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh | sh` works on macOS arm64 (manually verified) — fail-closed SHA chain confirmed.
- [ ] `brew install omerakben/code-oz/code-oz` works on macOS — formula audit clean.
- [ ] `npm install -g code-oz` succeeds; first invocation of `code-oz --version` downloads + verifies + caches the binary.
- [ ] All 6 + 1 (npm wrapper) version surfaces touched in tag commit.
- [ ] Codex R2 verdict push.
- [ ] Tag pushed, GitHub release published with all assets, npm package live, Homebrew formula on tap.
- [ ] README updated with all 3 install commands; Scoop/Windows deferral noted.

## Handoff to implementation

Implementation starts now. Each commit references this synthesis section by number. No deviation from the locked decisions without a follow-up Codex round.
