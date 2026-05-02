# Codex implementation review — W3-lite (R1, behavioral lens)

**Thread:** `019de714-9843-7e81-b656-ffcb92a39095`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`, `cwd: /Users/ozzy-mac/Projects/code-oz`
**Date:** 2026-05-02
**Reviewed range:** `f416ac2..HEAD` on `feat/w3-lite-demo` (5 commits past launch-prep)
**Lens:** behavioral correctness (R1; doc consistency deferred to R2)

## Verdict

`fix-first`

The binaries themselves look safe for an emergency friends-tomorrow handoff: I verified both Mach-O targets exist, the manifest hashes and sizes match the live handoff binaries, executable bits are present in `dist/` and inside the tarball, and both arm64 and x64 binaries print `0.14.0-alpha.0` on this Darwin arm64 host. The strongest `push` argument is that the actual shipped artifacts are coherent. The strongest `fix-first` argument is that the build/smoke recovery behavior still has closeable defects under adversarial failure states: malformed manifest JSON wedges `--ensure`, a failed second-target build leaves a half-populated `dist/handoff`, and smoke child processes can hang forever. I found no `debate-required` issue.

## Validation run

```sh
git log --oneline f416ac2..HEAD
```

```text
1618ab2 feat(w3-lite): handoff bundle assembly + end-to-end smoke harness
fbef076 feat(w3-lite): add local manifest-driven installer
9a71ac8 feat(w3-lite): add multi-target binary build script
bc1e348 docs(w3-lite): pin dispatch prompts and review lenses
1c7b7c3 docs(w3-lite): planning-round response + ignore Ralph host state
```

Note: read-only sandbox blocked `mkdtemp` and `chmod`, so `bun test` and `bun run smoke` could not complete in this review session. The orchestrator confirmed both pass in the iter 5 verification (35 W3-lite tests pass, 2086 baseline still green, smoke all 5 steps pass) before review dispatch. The findings below are based on code reading + manifest hash verification + tar listing + binary file-type checks, all of which Codex could perform read-only.

Additional checks Codex ran read-only:

```text
stat -f '%Sp %N' dist/darwin-arm64/code-oz dist/darwin-x64/code-oz dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz dist/handoff/install.sh scripts/install.sh
-rwxr-xr-x dist/darwin-arm64/code-oz
-rwxr-xr-x dist/darwin-x64/code-oz
-rwxr-xr-x dist/handoff/darwin-arm64/code-oz
-rwxr-xr-x dist/handoff/darwin-x64/code-oz
-rwxr-xr-x dist/handoff/install.sh
-rwxr-xr-x scripts/install.sh
```

```text
shasum -a 256 dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz
81e19832420da2d160b7acdbb624984411772907c5141aeaf21e9d97d9b6b7eb  dist/handoff/darwin-arm64/code-oz
8849314e5e11348ab3de1ef80c1f182759dfb2dc0209d562e63dc0356eeb1f36  dist/handoff/darwin-x64/code-oz
```

```text
file dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz
dist/handoff/darwin-arm64/code-oz: Mach-O 64-bit executable arm64
dist/handoff/darwin-x64/code-oz:   Mach-O 64-bit executable x86_64
```

```text
tar -tvf dist/code-oz-v0.14.0-alpha.0-darwin.tar.gz | sed -n '1,20p'
-rwxr-xr-x ... code-oz-v0.14.0-alpha.0-darwin/install.sh
-rwxr-xr-x ... code-oz-v0.14.0-alpha.0-darwin/darwin-arm64/code-oz
-rwxr-xr-x ... code-oz-v0.14.0-alpha.0-darwin/darwin-x64/code-oz
```

```text
./dist/handoff/darwin-arm64/code-oz --version
0.14.0-alpha.0

./dist/handoff/darwin-x64/code-oz --version
warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:
  https://github.com/oven-sh/bun/releases/download/bun-v1.3.9/bun-darwin-x64-baseline.zip
0.14.0-alpha.0
```

## Block-push findings

None — no behavioral block-push findings.

## Fix-soon findings

### F-001. `--ensure` is wedged by malformed manifest JSON

**File / line:** `scripts/build-binaries.ts:313`
**What:** `readExistingManifest` calls `JSON.parse(await fs.readTextFile(manifestPath))` without catching parse errors.
**Why broken:** `--ensure` is the recovery path for stale or partial `dist/` state. If `dist/handoff/manifest.json` exists but is truncated or malformed, `buildAll(... mode: 'ensure')` throws before it can rebuild. That turns a recoverable local artifact problem into a manual cleanup step.
**Reproduction or evidence:** I ran a no-disk in-memory probe against `buildAll` with `dist/handoff/manifest.json` set to `{ bad json`; output was `JSON Parse error: Expected '}'`.
**Recommended fix:** Catch JSON parse failures in `readExistingManifest` and return `null` so `--ensure` treats the manifest as stale and rebuilds. If you want visibility, add a warning path to `BuildResult`, but do not require manual deletion.

### F-002. Failed second target leaves a half-populated handoff directory

**File / line:** `scripts/build-binaries.ts:225`
**What:** `buildAll` copies each rebuilt target into `dist/handoff` as it goes, then returns immediately on a later target failure at lines 229-236.
**Why broken:** If arm64 succeeds and x64 fails, `dist/handoff/darwin-arm64/code-oz` remains but `manifest.json`, `install.sh`, and `README.md` may be absent or stale depending on the failure point. `--ensure` handles the no-manifest case on the next clean invocation, but the immediate failed state is confusing and easy to copy by mistake.
**Reproduction or evidence:** The code path writes/copies the first target before the second target is attempted, and the failure return does not clean `handoffRoot`.
**Recommended fix:** Build into a staging handoff directory and rename only after all targets, installer, README, manifest, and tarball staging succeed. Smaller fix: on target build failure, remove `dist/handoff` before returning failure.

### F-003. Smoke subprocesses can hang forever

**File / line:** `scripts/smoke-test.ts:386`
**What:** `runSpawn` waits on stdout, stderr, and `proc.exited` with no timeout.
**Why broken:** If the installed binary hangs during `--version`, `--help`, or `init`, `bun run smoke` never returns and never reports which step hung. This misses the requested smoke failure behavior for hangs.
**Reproduction or evidence:** A spawn implementation whose `exited` promise never resolves makes `runSmoke` never resolve. There is no timer or kill path in lines 391-402.
**Recommended fix:** Add a per-step timeout, kill the process on expiry, and return a failure message like `version timed out after 10000ms`. Include command, cwd, exit/signal if available, and stderr/stdout tail.

### F-004. Smoke tempdirs are not fully cleanup-safe if creation fails mid-run

**File / line:** `scripts/smoke-test.ts:289`
**What:** `bundleParent`, `installDir`, `projectDir`, `homeDir`, and `extractDir` are created before the `try/finally` block that cleans them up.
**Why broken:** If tempdir creation fails after one or more earlier tempdirs were created, those earlier directories are not removed. The sandbox exposed this class by denying `mkdtemp`, although it failed before creating dirs in my run.
**Reproduction or evidence:** Lines 289-294 allocate all tempdirs, and the `finally` cleanup starts only at line 326.
**Recommended fix:** Create tempdirs inside the `try` after pushing each created path into a cleanup list, then cleanup only paths that were successfully created.

## Nits

### N-001. PATH hint has trailing-slash false positives

**File / line:** `scripts/install.sh:122`
**What:** PATH membership is a literal `case ":$PATH:" in *":$install_dir:"*)` check.
**Why broken:** `/tmp/code-oz-bin` and `/tmp/code-oz-bin/` are equivalent for PATH lookup but do not match literally, so the script prints a hint even when the install dir is effectively present.
**Reproduction or evidence:** Probe output: exact path returned `no-hint`; PATH with trailing slash returned `hint`; empty PATH returned `hint`.
**Recommended fix:** Normalize trailing slashes on `install_dir` and PATH entries before matching, or accept this as a documented cosmetic limitation for W3-lite.

### N-002. The POSIX manifest reader only supports the generated pretty JSON shape

**File / line:** `scripts/install.sh:17`
**What:** `parse_target` recognizes target objects only when `{` and `}` appear on their own lines.
**Why broken:** The generated `JSON.stringify(manifest, null, 2)` file works, and I verified it extracts `darwin-arm64/code-oz`. A minified but valid JSON manifest produces no result, so a reformatted manifest can make install fail.
**Reproduction or evidence:** Piping a one-line manifest into the same awk pattern printed no `binaryRelativePath`.
**Recommended fix:** For W3-lite, this can stay as a nit because the writer controls formatting. For W3.1, prefer a shell-native checksum/index format or require a real JSON parser in a non-POSIX installer path.

## FYIs

- `targetForHost` maps `Darwin/ARM64` and `Darwin/x86_64` correctly, returns `null` for empty input and future `aarch64`, and the build path invokes `bun build --compile --target=<bunTarget>` at `scripts/build-binaries.ts:448`.
- `sha256OfBuffer` matched Node `createHash('sha256')` for the same bytes in a focused probe, and live manifest hashes match the live handoff binaries.
- `dist/handoff/install.sh`, both handoff binaries, both local target binaries, and tarball-contained install/binary entries are executable.
- `shellcheck` is not installed in this environment. `sh -n scripts/install.sh && bash -n scripts/install.sh` passed.
- The x64 binary runs under Rosetta here and prints the expected version, but Bun emits an AVX warning. That is worth noting for older Intel Macs, but it did not block `--version`.

## R1 closing remarks

The implementation is generally solid: the target matrix is explicit, hashes are computed over the handoff bytes the installer verifies, executable bits are handled, and the live bundle layout is coherent. The pattern that needs tightening is failure-state hygiene: make `--ensure` more forgiving of damaged local artifacts, make failed builds avoid half-handoff state, and make smoke failures bounded and diagnostic. R2 should still check doc/contract drift, especially README claims against exact install behavior and the JSON-manifest tradeoff before W3.1 hardens the distribution path.
