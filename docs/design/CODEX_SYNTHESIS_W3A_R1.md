---
session: W3a R1 closure synthesis
status: all findings closed; ready for R2
verdict-input: fix-first (1 block-push + 3 fix-soon + 2 nits + 6 FYI)
verdict-target: R2 push
briefing: docs/design/CODEX_BRIEFING_W3A_R1.md
response: docs/design/CODEX_RESPONSE_W3A_R1.md
synthesis-prior: docs/design/CODEX_SYNTHESIS_W3A.md
---

# Codex R1 closure synthesis — W3a multi-channel distribution

R1 returned `fix-first` with 1 block-push + 3 fix-soon + 2 nits. All
findings closed in this round (no deferrals to v0.20.1 beyond what the
synthesis already locked). Net additions: +5 install-script tests
(downloader chain + temp-dir cleanup) and +3 ci-workflow tests
(workflow ↔ consumer layout contract).

## Closure by finding

### Block-push (closed)

**README is still pre-W3a and will be published inside the npm package.**

- Closed by full README rewrite covering v0.20.0-alpha.0 status, 3353
  tests, three install commands (curl|sh `--version`, npm, brew tap +
  install), and platform-support deferral note (Windows/Scoop →
  v0.20.1; Apple Developer signing + GPG → v0.x stable).
- Files: `README.md` rewritten end-to-end.

### Fix-soon (closed)

**Network-mode `install.sh` leaks its temp release directory on success.**

- Root cause: `fetch_release_bundle` was called via `$(fetch_release_bundle)`
  command substitution. INSTALL_TMP_ROOT set inside the subshell never
  propagated to the parent's EXIT trap, so cleanup_tmp ran with an empty
  variable on success. POSIX sh does not inherit EXIT traps into command
  substitution subshells, so the subshell exit was a no-op too.
- Fix: refactored `fetch_release_bundle` to set `BUNDLE_ROOT` as a
  parent-scope global side-effect (no more stdout capture). Caller
  invokes the function directly: `fetch_release_bundle; bundle_root="$BUNDLE_ROOT"`.
  INSTALL_TMP_ROOT now lives in parent scope for the trap.
- Files: `scripts/install.sh:fetch_release_bundle` + caller block.

**Release layout contract duplicated in hand-built test fixtures.**

- Closed by a new contract describe block in `tests/ci-workflows.test.ts`
  that cross-references release.yml's staging block against both
  consumers' layout expectations:
  - STAGE_NAME shape in release.yml = `code-oz-v${VERSION}-${MATRIX_OS}-${MATRIX_ARCH}`
  - install.sh's `stage_name` derivation pattern
  - npm wrapper's `stageName` derivation pattern
  - Every file install.sh + npm wrapper read from the extracted tarball
    is staged via release.yml (`code-oz`, `install.sh`, `manifest.json`,
    `README.md`)
  - tar invocation preserves STAGE_NAME as the tarball's top-level dir
- Files: `tests/ci-workflows.test.ts` (+3 tests, +1 describe block).

**Untested downloader branches in install.sh.**

- Added a new test-only seam `CODE_OZ_FORCE_DOWNLOADER`
  (curl | wget | none) mirroring the existing `CODE_OZ_SHA_TOOL`
  pattern. The seam lets tests pin the downloader to wget or force the
  fail-closed branch without manipulating PATH on macOS where /usr/bin
  always provides curl.
- Tests added (`tests/install-script.test.ts` "downloader chain" describe):
  - routes through wget when `CODE_OZ_FORCE_DOWNLOADER=wget` (with a
    fake-wget shim handling `-q -O target file://path`)
  - fails closed when `CODE_OZ_FORCE_DOWNLOADER=none` (stderr matches
    "neither curl nor wget")
  - rejects invalid `CODE_OZ_FORCE_DOWNLOADER` override (stderr matches
    "invalid CODE_OZ_FORCE_DOWNLOADER")
- Documented in `--help` under "environment overrides".

### Nit (closed)

**R1 handoff doc internally stale.**

- `docs/handoffs/2026-05-12-w3a-r1-ready.md` updated: HEAD now
  `d40e6db`, commit count now 7 ahead (was `d9d77b7` / 6 ahead at
  prior session close).

**package.json `main` + `module` point at excluded `src/cli.ts`.**

- Removed both fields. The package is CLI-only; `bin` is the only
  programmatic entry, and the `files` allowlist excludes `src/` from
  the npm bundle. Removing `main`/`module` aligns the manifest with
  the published tarball.

## RED-first validation per rule 22

For each behavior change, the failing test was confirmed first by
stashing the install.sh fix, running the test suite, and observing
which tests fail before the fix lands. Recorded results:

| Test | Pre-fix (RED) | Post-fix (GREEN) |
|---|---|---|
| `cleans up temp dir on successful network install (no leak via subshell scope)` | FAIL — leaked path still exists | PASS |
| `fails closed when CODE_OZ_FORCE_DOWNLOADER=none` | FAIL — exits 0 (no env seam) | PASS |
| `rejects invalid CODE_OZ_FORCE_DOWNLOADER override` | FAIL — exits 0 (no env seam) | PASS |

The `cleans up temp dir on network install failure (checksum mismatch)`
test passes on both pre-fix and post-fix because `fail()` calls
cleanup_tmp from within the subshell where INSTALL_TMP_ROOT is set —
the failure-path cleanup is unaffected by the subshell scope bug. It
documents the failure-path invariant; the success-path test catches
the actual bug.

The wget routing test (`routes through wget when CODE_OZ_FORCE_DOWNLOADER=wget`)
also passes on both pre-fix and post-fix at the assertion level (the
binary content is the same regardless of which downloader fetched it);
it is the seam's positive-path coverage paired with the
`CODE_OZ_FORCE_DOWNLOADER=none` negative-path test.

## Test count delta

- Pre-R1: 3353 pass / 0 fail / 2 skip
- Post-R1 (this synthesis): expected 3361 pass / 0 fail / 2 skip
  (+5 install-script, +3 ci-workflows)

Confirmed by `bun test` after the closure batch.

## Scope-deviation rulings (unchanged from R1)

1. **7 commits, not 6** — accepted per R1.
2. **6 version surfaces, not 7** — accepted per R1.
3. **`--version <TAG>` required for network mode** — accepted per R1.

No new scope deviations.

## What R2 should re-confirm

- The install.sh refactor preserves all existing test behavior
  (network mode, SHA chain, Linux detection, CLI flags) and adds the
  cleanup + downloader-chain coverage.
- The README rewrite documents the locked install channels and
  defers Windows + signing per the synthesis.
- The contract test in ci-workflows.test.ts will break if release.yml
  ever drifts the STAGE_NAME pattern or the staged file set.
- package.json main/module removal is safe because no source under
  `src/` was ever shipped via the npm tarball (`files` allowlist).
- Rule 1, Rule 9, Rule 20, Rule 22 invariants unchanged.

## Commits planned for this closure round

Single closure commit (per the project's "closure commit not amended"
discipline), or a small grouped sequence if Codex prefers granularity:

- README + package.json + handoff doc (user-facing surface drift)
- install.sh + install-script.test.ts (the leak fix + new tests)
- ci-workflows.test.ts (contract test)
- This synthesis doc + Codex R1 response

Grouped for clarity into one commit if Codex R2 has no readability
objection; otherwise split per the above bullets.
