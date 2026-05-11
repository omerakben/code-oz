---
session: W3a pre-design — distribution surface (npm + curl|sh + Homebrew + binaries)
phase: pre-design (one round, sandbox read-only)
target-version: v0.20.0-alpha.0
prior-context: docs/design/ROADMAP.md § "W3 — Production extension" (currently bundles distribution + provider integration + LanguagePack + IIntegration + DSPy + concurrent runs — too broad for rule 20)
competitive-reference: https://pi.dev/ (Pi Coding Agent by Earendil Works; npm-only distribution)
---

# Codex W3a pre-design briefing — distribution surface

## Goal

One Codex pre-design round on the proposed v0.20.0-alpha.0 = W3a (distribution-only split of the bloated current W3 row). Surface design risks before any commit lands. The cross-model peer review rule fires on every new authority milestone (CLAUDE.md § "Cross-model peer review"); skipping pre-design would be a process drift.

## Why split W3

Current W3 row (`docs/design/ROADMAP.md:406-410`) bundles 5 distinct authorities:
1. Codex/Gemini provider integration (cross-family REVIEW with real providers, not FakeProvider) — provider authority
2. Installer (`curl | sh`, npm, Homebrew tap) — distribution authority
3. Multi-language LanguagePack abstraction — runtime-tool authority
4. `IIntegration` interface (GitHub / Slack / Linear-Jira) — external-systems authority
5. DSPy MIPRO compile for Prompter — meta-prompt authority
6. Concurrent runs + multi-active-run pointer — run-lifecycle authority

That's 6 authorities under one milestone label. Rule 20 demands one. The locked-roadmap row needs to be split before any W3 work starts.

**Proposed split:**
- **W3a** (this milestone) — distribution surface only. v0.20.0-alpha.0.
- **W3b** — Codex/Gemini provider integration (separate, demand-gated after PE-2 friend-survey).
- **W3c** — LanguagePack abstraction.
- **W3d** — IIntegration interface.
- **W3e** — DSPy MIPRO compile.
- **W3f** — Concurrent runs.

Each shipped under its own minor version with its own pre-design + R0/R1/R2 cycle.

## Competitive context — pi.dev

Pi Coding Agent (https://pi.dev/) ships distribution via:

| Surface | Pi |
|---|---|
| `npm install -g @earendil-works/pi-coding-agent` | ✅ |
| `pnpm add -g @earendil-works/pi-coding-agent` | ✅ |
| `bun add -g @earendil-works/pi-coding-agent` | ✅ |
| `curl -fsSL https://pi.dev/install.sh \| sh` | ✅ — wraps npm install |
| Homebrew | ❌ |
| Scoop | ❌ |
| Pre-built binaries | ❌ (npm-distributed Node script) |
| Plugin install (`pi install npm:@foo/...` / `git:github.com/...`) | ✅ |

**Pi's strategy:** ship as Node script via npm registry; their install.sh is a thin wrapper over `npm install -g`. Single distribution channel, three package-manager front doors.

**Code-oz's existing advantage (already shipped via W3-lite):** Bun-compiled single-file binary (~62MB) for darwin-arm64 + darwin-x64. Faster cold start, zero runtime dependency on user's machine. Plus `package.json` already declares `engines.bun >= 1.3.0` and a `bin` field.

## Proposed W3a scope

Single authority: **distribution surface.** Multiple channels (npm, curl|sh, Homebrew) are wrappers around the same versioned binary contract. Plugin/skill install command (`code-oz install npm:@foo/skill`) is a SECOND authority and is explicitly out of W3a scope — defers to a later milestone if demand surfaces.

### 6 implementation commits + tag commit

| # | Commit | Effort | Risk |
|---|---|---|---|
| 1 | Extend `scripts/build-binaries.ts` TARGETS with `linux-x64`, `linux-arm64`, `win32-x64`. Verify `bun build --compile` cross-compiles cleanly for each. | ~30 min | Low — bun supports all 5 targets per docs; CI confirms. |
| 2 | Decide npm bin strategy + refactor `package.json`. Two paths: (a) **source-via-bun**: ship `src/` only, `"bin": { "code-oz": "./src/cli.ts" }`, user needs bun on machine; (b) **postinstall download**: ship a JS shim that downloads the right binary for the user's platform in postinstall. Path (a) is simpler; path (b) gives Node-only users access. **Recommendation: path (a)** for v0.20 because `engines.bun >= 1.3.0` is already declared and the demo audience is bun-native. | ~1 hr | Medium — postinstall hooks are increasingly restricted (npm 11+ deprecates them); path (b) carries that risk. Path (a) excludes Node-only users (acceptable tradeoff for alpha). |
| 3 | GitHub Actions workflow `.github/workflows/release.yml`: on tag push (`v*.*.*`), build all 4 platform binaries via `bun build --compile`, generate SHA256 checksums, upload as release assets + a multi-platform tarball, attach `install.sh`. | ~2 hr | Medium — bun cross-compile from macOS runner to linux is supported; CI bun-availability matrix needs verification. |
| 4 | Update `scripts/install.sh` to: (a) detect Linux + macOS (currently macOS-only), (b) download the right binary from `https://github.com/omerakben/code-oz/releases/download/<TAG>/code-oz-<os>-<arch>`, (c) verify SHA256 against published checksums, (d) install to `~/.local/bin/code-oz`, (e) print PATH hint. The script lives on `main` and is reachable at `https://raw.githubusercontent.com/omerakben/code-oz/main/scripts/install.sh` (no separate domain needed for v0.20). | ~1.5 hr | Medium — `~/.local/bin` PATH discipline; checksums file format consistency between CI upload and install.sh consumption. |
| 5 | Create `omerakben/homebrew-code-oz` tap repo with `Formula/code-oz.rb` pinning `v0.20.0-alpha.0` darwin tarballs. Formula downloads the GitHub release asset, verifies SHA256, installs to Homebrew's prefix. Auto-bumping the formula on each new tag is out of scope for v0.20 (manual update; can automate via Action in v0.21). | ~2 hr | Medium — Homebrew formula authoring conventions, dual-arch fat manifest, brew audit compliance. |
| 6 | npm publish to `code-oz` (unscoped; 404 confirmed available 2026-05-12). Update README install commands to lead with `curl \| sh`, then npm, then Homebrew. | ~30 min | Low — npm publish is a one-shot. |
| 7 | Tag `v0.20.0-alpha.0`. Bump all 6 version surfaces in one commit per the v0.18 residue lesson. Publish GitHub release with notes + all 4 binaries + checksums + install.sh + multi-platform tarball as attached assets. Push tag, release, npm package, brew tap formula together. | ~1 hr (incl. discipline) | Medium — release residue lesson applies; checklist of version surfaces must be exhaustive. |

**Total: ~9 hrs implementation + 2 hrs Codex review overhead = single 1.5-day focused session or two ~half-day cadences.**

### Files touched (read-only inspection of current state)

- `package.json` — version, bin, files[], engines (rule 23 sees no impact; not a budget surface)
- `scripts/build-binaries.ts` — extend TARGETS
- `scripts/install.sh` — Linux detection, GitHub release download, SHA verify
- `scripts/smoke-test.ts` — verify new install paths
- `.github/workflows/release.yml` (new) — tagged release CI
- `README.md` — install instructions (currently has clone+build; add curl|sh + npm + brew)
- `src/cli.ts:PKG_VERSION` — version bump
- `src/config/schema.ts:DEFAULT_CONFIG.version` — version bump
- `tests/m5-fix-first.test.ts:CURRENT` — version bump
- `tests/cli-init.test.ts` — version bump  
- `tests/smoke-test.test.ts:VERSION` — version bump
- New repo: `omerakben/homebrew-code-oz` (out of code-oz repo; separate)

## Rule-20 framing — single authority, multiple channels

**Position to test:** "distribution surface" is one authority. The channels (npm, curl|sh, Homebrew, plus the binary tarballs themselves) are wrappers around the same versioned binary contract — they share a SHA256 checksum, a binary build process, a CI workflow, a version bump cadence, and a single install discipline (PATH, ~/.local/bin).

**Adding a SECOND authority that would split the milestone:**
- Plugin/skill install command (`code-oz install npm:@foo/skill`) — separate authority because it routes to a different parser (skill manifest) + a different runtime decision (load + register). Explicitly OUT of W3a scope.
- Auto-update (`code-oz upgrade --check`) — separate authority (runtime decision about new versions). Explicitly OUT of W3a scope (mentioned in W4 row).
- Cross-platform Linux/Windows BEHAVIOR changes (e.g., Windows path handling) — these are runtime bugs that surface during cross-platform testing and would be patches, not new authority.

**Argument that distribution might be MULTIPLE authorities:**
- npm has its own threat model (postinstall scripts, supply chain).
- Homebrew has its own (formula audit, bottle signing).
- curl|sh has its own (script integrity, MITM risk).

If Codex argues for splitting, the natural split is:
- v0.20a — npm + curl|sh + binaries (web-distribution channels)
- v0.20b — Homebrew tap (macOS-native channel with its own audit/signing)

I lean against the split because all three channels distribute the SAME binary with the SAME SHA256, and the formula's only job is to wrap the GitHub release download. The threat model is shared (compromise the GitHub release → all three channels are compromised).

## Cross-cutting concerns

### Binary signing

macOS gatekeeper requires either Apple Developer signing ($99/yr + cert handling) or the user runs `xattr -cr /path/to/code-oz` (strips quarantine). Current `install.sh` already does the xattr strip post-download. v0.20 ships unsigned (alpha); Developer signing is a v0.x or v1.0 polish.

### SHA verification chain

Single source of truth for binary integrity:
1. CI computes SHA256 per binary during build.
2. CI publishes `checksums.txt` to the GitHub release (one line per binary, format: `<sha256>  <filename>`).
3. `install.sh` downloads `checksums.txt`, downloads the binary, verifies the SHA matches the line for the user's platform.
4. Homebrew formula hard-codes the per-version SHA (formula bump = SHA update).
5. npm tarball is npm registry's own integrity layer (no need to layer ours on top).

### Auto-update

`code-oz upgrade --check` is a W4 row item, NOT W3a. v0.20 ships without it; users update via the same install command they used initially (`brew upgrade`, `npm i -g code-oz`, or re-run `curl | sh`).

### Linux + Windows test coverage

CI runs the full test suite on Linux ubuntu-latest already (the offline test suite is OS-portable). Windows is the new surface — bun + Windows is supported but the test suite has macOS path assumptions in places. **Risk to validate in pre-design:** does the existing test suite pass on Windows runners? If not, W3a should LAND the Linux + macOS binaries first and gate Windows on its own follow-up commit within W3a.

## Risk register

| ID | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | bun cross-compile from macOS runner to Linux fails or produces broken binary | Low (bun supports it per docs) | Block-tag if it does | Validate in commit #1 with a manual `bun build --compile --target=bun-linux-x64` on dev machine before CI work. |
| R2 | npm publish race — `code-oz` package name gets taken between briefing and publish | Very low (404 confirmed today) | Recoverable (fall back to `@code-oz/cli` scope) | Reserve the name day-of by pushing a 0.0.1 placeholder + `unpublish --force` later. OR ship as scoped from the start. |
| R3 | Homebrew tap audit failures (formula style violations) | Medium (auditor is strict) | Block-tag | Run `brew audit --strict --online Formula/code-oz.rb` locally before pushing tap repo. |
| R4 | Windows binary works but test suite fails on win32 paths | Medium | Block-tag for Windows surface only | Gate Windows binary on its own optional flag in W3a; ship Linux + macOS as the v0.20 minimum. |
| R5 | install.sh SHA verification UX confusing on first install | Low | Fix-soon | Print clear "verifying integrity..." line; on SHA mismatch print the expected vs got with explicit guidance. |
| R6 | postinstall lifecycle hook deprecation (npm 11+) bites if we use path (b) | Medium (if we use path b) | Block-tag | Use path (a) — source-via-bun — explicitly avoids postinstall hooks. |
| R7 | Plugin install command (out of scope) gets clamored for by early users | Low-medium | Fix-soon | Note explicitly in v0.20 release notes that it's deferred; point at the agentic-canvas comparison synthesis where the design lives. |
| R8 | Documentation drift: README install commands fall out of sync with actual published surfaces | Medium | Fix-soon | Lock the install commands in README during commit #6 with a test (`tests/smoke-test.test.ts` already checks bin version output; extend to validate the install paths the README claims). |

## Specific questions for Codex

1. **Rule-20 split test.** Is "distribution surface" really one authority or are npm + curl|sh + Homebrew three separate authorities under one umbrella? If three: should v0.20 ship the umbrella (one milestone, three channels) or be split (v0.20a npm + curl|sh, v0.20b Homebrew)?
2. **npm bin strategy (path (a) vs (b)).** Path (a) source-via-bun has the smallest publish footprint and avoids postinstall hooks; path (b) postinstall-download serves Node-only users. Given current `engines.bun >= 1.3.0` and the demo audience, is path (a) the right call for v0.20? Or does path (b) earn its complexity for non-bun users?
3. **Single source of truth for binary integrity.** Is the CI-builds-checksums-and-publishes-to-release model sufficient, or do we need GPG signing of the checksums file too? For v0.20 alpha, what's the right balance?
4. **Windows in v0.20 scope.** Should Windows binary ship in v0.20.0-alpha.0 or wait for v0.20.1? The risk (R4) is the test suite's path assumptions, not bun's compile. What's the smallest verification that gates the Windows ship?
5. **Homebrew tap audit cleanliness.** Are there formula-style gotchas (depends_on, livecheck, head spec, conflicts_with) that an alpha tap should preempt to avoid the `brew audit` user friction? What's the minimum-viable formula shape?
6. **Anything I missed.** Authority drift, rule-23 implications (does any distribution surface change a budget knob, even indirectly?), security threat models I haven't named, README clarity issues that would block adoption.

## Sandbox

`gpt-5.5` xhigh, `sandbox: read-only`. Single round. Decision lock comes from the synthesis after this response lands; implementation does NOT start before the synthesis is written.
