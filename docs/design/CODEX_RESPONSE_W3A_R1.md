---
session: W3a R1 implementation review — Codex response
thread: 019e1a19-f127-7332-9a8b-6963e40cc3a0
model: gpt-5.5
reasoning-effort: xhigh
sandbox: read-only
verdict: fix-first
briefing: docs/design/CODEX_BRIEFING_W3A_R1.md
synthesis: docs/design/CODEX_SYNTHESIS_W3A.md
---

# Codex R1 response — W3a multi-channel distribution sweep

## Verdict: fix-first

## Scope-deviation rulings

1. **Accepted.** The impl 2 split is justified by Rule 22: network-mode
   consumer tests needed the release artifact contract first.
2. **Accepted.** Runtime `../package.json` lookup in
   `npm-wrapper/index.cjs:32` is better than a seventh version literal.
3. **Accepted.** Explicit `--version <TAG>` is the right alpha contract
   for versioned asset names. No implicit `latest` is fine for v0.20.

## Findings

### Block-push (must close before tag)

- **README is still pre-W3a and will be published inside the npm
  package.** `README.md:7` still says `v0.18.0-alpha.0` and 3299 tests,
  and the only install path is clone plus Bun build at `README.md:38`.
  But `package.json:45` includes `README.md` in the npm bundle, so
  `npm publish` would ship stale public install docs. This also misses
  the locked synthesis acceptance that README documents all three
  install commands and the Windows/Scoop deferral. Fix before tag with
  current status, curl|sh with `--version`, npm, Homebrew, and
  Windows/Scoop deferral.

### Fix-soon (close before publish or in v0.20.1)

- **Network-mode `install.sh` leaks its temp release directory on
  success.** `fetch_release_bundle` sets `INSTALL_TMP_ROOT` at
  `scripts/install.sh:180`, but the caller captures it via command
  substitution at `scripts/install.sh:224`. That assignment does not
  propagate to the parent shell, so the parent `trap cleanup_tmp EXIT`
  at `scripts/install.sh:20` sees no temp root. Integrity is still
  fail-closed, but every curl|sh network install can leave the
  tarball, checksums, and extracted bundle behind.

- **The file:// seam is right-sized for curl/tar/download behavior,
  but the release layout contract is still duplicated in hand-built
  test fixtures.** Current `release.yml` stages the expected root
  layout at `.github/workflows/release.yml:75`, and the consumers
  match it, but a future workflow layout drift could pass the
  install/npm tests. Add one contract test that ties the workflow
  staging layout to the consumer assumptions.

- **`install.sh` has untested downloader branches:** curl path is
  covered, but wget fallback and the no-curl/no-wget fail-closed
  branch at `scripts/install.sh:167` are not behavior-covered.

### Nit

- The R1 handoff doc is internally stale: it says "6 unpushed
  commits" and `HEAD: d9d77b7` at
  `docs/handoffs/2026-05-12-w3a-r1-ready.md:11`, while live repo state
  is `d40e6db` and 7 ahead.

- `package.json` still points `main` and `module` at `src/cli.ts`,
  but the npm `files` allowlist excludes `src/`. CLI usage works
  through `bin`, but importing the package would resolve to a missing
  file.

### FYI

- Rule 9: I do not think `scripts/install.sh` needs a runner
  permission manifest. It is a user-invoked installer, not an
  orchestrator-owned executable runner.
- Rule 1: no new changed code path writes `.code-oz/state/runs/*`,
  gate files, or `events.jsonl`.
- Workflow injection: no direct `github.*` or `matrix.*` expression
  is spliced inside `run:` blocks; those values are bound through
  `env:`.
- SHA chain and fetch contract: install.sh, npm wrapper, and Homebrew
  all fail closed on missing or mismatched checksums. Homebrew bakes
  SHAs from `checksums.txt` at render time.
- Release notes sequence is correct: GitHub release assets are
  verified before `npm publish` at
  `docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md:76`.
- GitHub runner image: `macos-latest` currently maps to macOS 15
  arm64 (weekly image updates). Reference:
  https://github.com/actions/runner-images#available-images

## Rationale

The implementation is structurally sound on the core distribution
mechanics: tagged release URLs, checksum verification, per-arch
tarball naming, npm wrapper cache behavior, Homebrew SHA pinning, and
workflow context binding all line up with the W3a synthesis. No Rule
1, Rule 9, or fundamental authority-boundary violation.

The blocker is release readiness, not the installer core. This sweep
creates public install channels, and the npm package explicitly
publishes the README, but the README still describes an older
source-build flow and stale release status. That is user-facing
contract drift at the exact surface W3a is shipping.

Codex did not rerun `bun test` because the read-only sandbox denies
temp writes; relied on the handoff result of 3353 pass / 0 fail / 2
skip plus static review.
