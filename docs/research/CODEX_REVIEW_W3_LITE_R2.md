# Codex implementation review - W3-lite (R2, contract drift lens)

**Thread:** `019de726-82ad-72d1-995f-edff6ed43795`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`, `cwd: /Users/ozzy-mac/Projects/code-oz`
**Date:** 2026-05-02
**Reviewed range:** `f416ac2..HEAD` on `feat/w3-lite-demo` (7 commits past launch-prep)
**Lens:** contract drift / doc consistency (R2; behavioral correctness covered in R1 at docs/research/CODEX_REVIEW_W3_LITE.md)

## Verdict

`fix-first`

The W3-lite branch is internally consistent at the shipped-artifact level: the manifest, installer, smoke reader, bundle README, version trio, Darwin-only scope, and no-W3.1 boundary all line up. I found no block-push contract drift. I did find two fix-soon audit/doc consistency issues: the scope contract's in-scope bundle list omits the shipped `manifest.json`, and the live Ralph state ledger stops before the R1 review and R1-fix iterations even though the dispatch contract requires per-iteration footers.

## Validation run

```sh
git status --short --branch
```

```text
## feat/w3-lite-demo
```

```sh
git log --oneline f416ac2..HEAD
```

```text
d352458 fix(w3-lite): close R1 fix-soons (manifest parse / handoff staging / smoke timeout / tempdir cleanup)
24f9cf4 docs(w3-lite): Codex R1 review (behavioral lens)
1618ab2 feat(w3-lite): handoff bundle assembly + end-to-end smoke harness
fbef076 feat(w3-lite): add local manifest-driven installer
9a71ac8 feat(w3-lite): add multi-target binary build script
bc1e348 docs(w3-lite): pin dispatch prompts and review lenses
1c7b7c3 docs(w3-lite): planning-round response + ignore Ralph host state
```

```sh
bun run typecheck
```

```text
$ tsc --noEmit
```

```sh
bun test tests/build-binaries.test.ts tests/install-script.test.ts tests/smoke-test.test.ts tests/handoff-layout.test.ts
```

```text
13 pass
27 fail
Ran 40 tests across 4 files.
Failures were sandbox EPERM on mkdtemp under /var/folders/.../T, not assertion failures.
```

```sh
sh -n scripts/install.sh
bash -n scripts/install.sh
```

```text
# both exited 0
```

```sh
ls -l dist/handoff
file dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz
shasum -a 256 dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz
tar -tf dist/code-oz-v0.14.0-alpha.0-darwin.tar.gz | sed -n '1,20p'
```

```text
darwin-arm64/  darwin-x64/  install.sh  manifest.json  README.md
dist/handoff/darwin-arm64/code-oz: Mach-O 64-bit executable arm64
dist/handoff/darwin-x64/code-oz:   Mach-O 64-bit executable x86_64
81e19832420da2d160b7acdbb624984411772907c5141aeaf21e9d97d9b6b7eb  dist/handoff/darwin-arm64/code-oz
8849314e5e11348ab3de1ef80c1f182759dfb2dc0209d562e63dc0356eeb1f36  dist/handoff/darwin-x64/code-oz
code-oz-v0.14.0-alpha.0-darwin/
code-oz-v0.14.0-alpha.0-darwin/install.sh
code-oz-v0.14.0-alpha.0-darwin/README.md
code-oz-v0.14.0-alpha.0-darwin/manifest.json
code-oz-v0.14.0-alpha.0-darwin/darwin-arm64/code-oz
code-oz-v0.14.0-alpha.0-darwin/darwin-x64/code-oz
```

```sh
bun -e "...version trio check..."
```

```text
package.json.version=0.14.0-alpha.0
manifest.version=0.14.0-alpha.0
manifest.targetVersions=0.14.0-alpha.0,0.14.0-alpha.0
DEFAULT_CONFIG.version=0.14.0-alpha.0
```

## Block-push findings

None - no contract-drift block-push findings.

## Fix-soon findings

### F-001. Scope contract handoff contents omit the shipped manifest

**File / line:** `docs/contracts/W3_LITE_SCOPE.md:16`
**What:** The in-scope handoff list says `dist/handoff/` contains `darwin-arm64/code-oz`, `darwin-x64/code-oz`, `install.sh`, and `README.md`, but it does not list `manifest.json`.
**Evidence:** Live `dist/handoff/manifest.json:1-25` exists, `dist/handoff/README.md:43-54` lists `manifest.json`, and `scripts/build-binaries.ts:436` stages `manifest.json` into the tarball.
**Why it matters:** The same scope contract later makes the manifest reader discipline explicit at `docs/contracts/W3_LITE_SCOPE.md:107`, so the top-level in-scope artifact list is stale against shipped layout.
**Recommended fix:** Add `manifest.json` to the handoff bundle sentence at `docs/contracts/W3_LITE_SCOPE.md:16` and, if desired, to the Phase 5 line at `docs/contracts/W3_LITE_SCOPE.md:93`.

### F-002. Ralph state ledger stops before R1 and R1-fix iterations

**File / line:** `docs/contracts/W3_LITE_SCOPE.md:72`, `docs/contracts/W3_LITE_SCOPE.md:81`, `.code-oz/state/ralph-state.md:39-55`
**What:** The contract requires a per-iteration `.code-oz/state/ralph-state.md` summary and a footer after each iteration. The live state file ends at iter 5, while the commit log shows later R1 review and R1-fix commits: `24f9cf4` and `d352458`.
**Evidence:** `.code-oz/state/ralph-state.md:51-55` records iter 5 and next phase 6 only. There is no iter 6 R1 review footer and no iter 7 R1-fix footer. `.gitignore:48` also ignores the state file, so these footers were not committed as durable repo history.
**Why it matters:** This is the R2 audit trail contract, not runtime behavior. Morning review cannot reconstruct the loop solely from the promised state ledger.
**Recommended fix:** Append concise live footers for Phase 6 R1, Phase 7 R1 fixes, and this Phase 8 R2 dispatch. If the intent is that `ralph-state.md` stays session-local and uncommitted, adjust the contract wording away from "Codex appends" as a deliverable and keep `ralph-summary.md` as the durable halt artifact.

## Nits

### N-001. Ask-me appendix has one stale rule-number citation

`docs/design/SESSION_W3_KICKOFF.md:297` says "per CLAUDE.md rule 17 cross-family discipline." Current `CLAUDE.md:24` is cross-family review at rule 2, while `CLAUDE.md:39` is rule 17 for maestro discipline. If the appendix is frozen as a session record, leave it. If it is treated as morning-operational guidance, add a note or change it to rule 2.

### N-002. Ask-me appendix x64 note is now partially answered

`docs/design/SESSION_W3_KICKOFF.md:305` says darwin-x64 smoke is deferred or via Rosetta. R1 recorded x64 `--version` under Rosetta at `docs/research/CODEX_REVIEW_W3_LITE.md:67-70`, and I repeated it successfully. This does not require changing the frozen appendix, but the morning summary should say x64 startup was Rosetta-checked and full native Intel validation remains deferred.

## FYIs

- Manifest writer-reader contract is complete enough for W3-lite. Writer row fields are defined at `scripts/build-binaries.ts:85-93` and populated at `scripts/build-binaries.ts:152-167`; install reads `binaryRelativePath`, `sha256`, `sizeBytes`, and `version` at `scripts/install.sh:75-99`; smoke checks schema, target rows, `bunTarget`, `binaryRelativePath`, and versions at `scripts/smoke-test.ts:96-128` and `scripts/smoke-test.ts:247-263`.
- I did not find path re-derivation after manifest selection. `install.sh` uses `binary_relative_path` from the manifest at `scripts/install.sh:84`.
- Bundle README claims match install behavior: bundle-relative manifest discovery at `scripts/install.sh:45-52`, `CODE_OZ_INSTALL_DIR` at `scripts/install.sh:103`, quarantine stripping at `scripts/install.sh:116-118`, and no shell rc writes in `scripts/install.sh:120-132`.
- No accidental W3.1 artifact landed in the reviewed diff. `git diff --name-status f416ac2..HEAD` shows scripts, tests, W3-lite docs, `.gitignore`, and `package.json` only. No `.github/workflows/release.yml`, Homebrew formula, Scoop manifest, npm publish hook, Linux target, or Windows target surfaced.
- Commit messages match content. The R1 fix commit touches `scripts/build-binaries.ts`, `scripts/smoke-test.ts`, and the corresponding tests, which matches the manifest parse, handoff staging, timeout, and tempdir cleanup claims.
- Sentinel paths are consistent as orchestrator-owned paths: `.gitignore:50-51` ignores `.code-oz/state/RALPH_HALT.md` and `.code-oz/state/W3_LITE_DONE.json`; scope references the same paths at `docs/contracts/W3_LITE_SCOPE.md:44`, `docs/contracts/W3_LITE_SCOPE.md:47`, and `docs/contracts/W3_LITE_SCOPE.md:51`.

## R2 closing remarks

R2 caught doc/audit drift that R1 intentionally deferred, not new binary behavior defects. The branch is close: fix the scope artifact list and append the missing loop-state footers, then the R2 halt criterion can converge to `push` or to `fix-first` with fix-soons closed. W3.1 should preserve the explicit manifest reader pattern, the local-handoff versus network-installer boundary, and the habit of separating behavioral review from contract review.
