---
session: W3a pre-design response
phase: pre-design response (read-only, gpt-5.5 xhigh)
thread: 019e18e9-21cd-7292-b40d-7d6db3084f62
verdict: accept-with-modifications
date: 2026-05-12
briefing: docs/design/CODEX_BRIEFING_W3A.md
---

# Codex W3a pre-design response

## Verdict

**`accept-with-modifications`.** W3 must be split per rule 20; W3a as "versioned distribution/binary contract" is a valid one-authority milestone *only if* the contract framing is explicit. 4 block-level findings + 2 fix-soon + 1 nit.

## Findings

### block-design #1 — npm path (a) contradicts the "same binary contract" framing

The briefing says W3a is one distribution authority because all channels wrap the same versioned binary contract. But path (a) (source-via-bun) changes npm to `./src/cli.ts`, requiring Bun on the user machine and bypassing the release binary + SHA chain entirely. That's not a wrapper; it's a different channel with different semantics.

References: briefing lines 58, 65, 91; current `package.json:8` declares the binary-oriented `"bin": { "code-oz": "./dist/code-oz" }`.

**Codex's call:** decide explicitly. Either npm is a Bun-source alpha channel (separate semantics, not part of the binary contract) OR npm ships/launches the same prebuilt binary. Postinstall-download (path (b)) is weak because `npm ci --ignore-scripts` (and similar) disables lifecycle scripts entirely — postinstall is not a reliable install contract.

### block-impl #2 — install.sh must fail closed on integrity check

Current `scripts/install.sh:94` skips SHA verification if `shasum` is not present. Unacceptable for `curl | sh` distribution.

**Fix:** add an SHA-tool fallback chain (sha256sum first for Linux, shasum -a 256 for macOS, openssl dgst -sha256 as ultimate fallback) and **fail closed** if none are present. Also pin the installer URL to a tagged release asset, not a mutable `main` URL (briefing line 67 says `raw.githubusercontent.com/.../main/scripts/install.sh` — that's mutable). Use the tagged `<TAG>` URL from the GitHub release.

### block-impl #3 — Target/artifact matrix is inconsistent and Darwin-only in code

Briefing adds Linux x64, Linux arm64, Windows x64 to existing two Darwin targets, then says "all 4." Off-by-one. Current `TARGETS` (`scripts/build-binaries.ts:20`), host detection (`:132`), tarball naming (`:419`), and smoke validation (`scripts/smoke-test.ts:300`) are all Darwin-only.

**Fix:** lock one matrix before implementation with exact artifact names, extensions, checksums, tar/zip policy, and smoke command per target.

### block-impl #4 — Linux CI premise is not true

Briefing says "CI runs the full test suite on Linux ubuntu-latest already." There is no `.github/` workflow directory in the repo. The proposed release workflow is the FIRST CI in the project.

**Fix:** W3a must include a baseline CI matrix that runs `bun run typecheck` + `bun test` + build + checksum + binary smoke on macOS + Linux (+ Windows if shipping Windows). Not just the release workflow.

### fix-soon #5 — Windows in v0.20.0-alpha.0 should be gated on smoke

Don't advertise Windows as supported unless `.exe` is built and smoked. Minimum gate: build `bun-windows-x64` (or `bun-windows-x64-baseline` for older CPUs), run `code-oz.exe --version`, `--help`, and `init` in a temp directory on a Windows runner, verify checksums file. If that doesn't pass, ship Linux + macOS in v0.20.0-alpha.0 and defer Windows to v0.20.1 OR mark as "experimental, asset only" in release notes.

### fix-soon #6 — Homebrew formula minimum

The briefing's Homebrew plan is directionally enough but should be tighter:
- Per-arch URL + SHA256 (separate `on_macos do; on_arm do; ...; end` blocks)
- `license "MIT"`
- No `depends_on "bun"` (the binary is self-contained)
- `bin.install` to standard prefix
- `test do` block that runs `code-oz init` in Homebrew's temp test path, not just `--version`

### nit #7 — Scoop deferral not explicit

`CLAUDE.md:55` and `docs/design/ROADMAP.md:22` name distribution as "npm + Homebrew + Scoop with auto-PATH-patching install script." W3a omits Scoop without an explicit deferral. Add a one-line W3a non-goal: "Scoop/PowerShell installer deferred; Windows is release asset only unless separately gated."

## Answers to the six briefing questions (numbered)

1. **Rule-20 split.** Accept the W3 split. Treat distribution as one authority only if the **release binary contract** is the authority. If npm remains source-via-Bun, call that out as a separate channel semantics exception.
2. **npm strategy.** Reject path (b) postinstall-download for alpha (lifecycle hooks are unreliable). Use path (a) only if documented as the Bun-source channel; or choose a third binary-wrapper strategy if npm must preserve the binary contract.
3. **SHA chain.** Sufficient for v0.20 alpha if the installer fails closed and uses tag-bound release assets. GPG/Sigstore can wait, but document that SHA does not protect against a compromised GitHub release.
4. **Windows.** Ship only behind Windows CI smoke. Otherwise defer or mark experimental asset only.
5. **Homebrew formula minimum.** Install Darwin binary directly, hard-code per-arch SHA, `license "MIT"`, no `depends_on "bun"`, `test do` block running `code-oz init`.
6. **Anything missed.** Baseline x64 targets (Bun has `-baseline` variants for older CPUs); mutable `main` installer risk; no existing GitHub Actions baseline; the npm/source-vs-binary contract contradiction.

Codex consulted: npm `bin` and lifecycle/config docs, Bun single-file executable target docs, Homebrew Formula Cookbook, pi.dev's current install commands.
