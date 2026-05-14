# A4-binaries findings

Sub-task: A4
Operator: codex-subtask-4
Started: 2026-05-13T22:04:00Z
Finished: 2026-05-13T22:19:59Z

## Summary

Four target binaries were produced locally after one sandboxed toolchain-download failure and one approved rerun: darwin-arm64, darwin-x64, linux-x64, and linux-arm64. macOS arm64 passed `--version`, `--help`, installer smoke, `init`, and `doctor tools`; macOS x64 ran under Rosetta with matching stdout but emitted Bun's AVX warning on stderr. Linux targets were synthetically checked only from this Darwin arm64 host. Findings: 1 block-ship, 2 fix-soon, 1 nit.

## Findings

### F4.1 - Release workflow uploads binaries without running the W3a smoke commands

- **Severity:** block-ship
- **Where:** `.github/workflows/release.yml:56`, `.github/workflows/release.yml:113`, `docs/design/CODEX_SYNTHESIS_W3A.md:41`
- **Evidence:**
  ```text
  Static inspection:
  .github/workflows/release.yml builds each matrix binary at lines 56-68,
  stages a tarball at lines 70-122, uploads at lines 124-130, and releases at
  lines 173-189.

  Command:
  rg -n -- "--version|doctor|init|smoke|build:binaries|scripts/build-binaries" .github/workflows/release.yml .github/workflows/test.yml scripts/build-binaries.ts package.json
  Exit: 0
  Output:
  package.json:14:    "build:binaries": "bun run scripts/build-binaries.ts",
  package.json:15:    "smoke": "bun run scripts/smoke-test.ts",
  scripts/build-binaries.ts:53:code-oz --version

  W3a target matrix requires each asset to smoke:
  darwin-arm64: code-oz --version + code-oz init <tmp>
  darwin-x64: same
  linux-x64: same
  linux-arm64: same
  ```
- **Why it matters for first-run UX:** The tag workflow can publish a tarball that was built and checksummed but never executed, so a wrong-version or non-starting binary can reach curl, npm, and Homebrew users.
- **Proposed fix:** Add a release-workflow smoke step before tarball upload. At minimum, run the built binary's `--version` and `init` on targets executable by the runner, then run synthetic `file`, executable-bit, manifest-version, and size/SHA checks for targets not executable on that runner. Prefer native runners or explicit emulation for linux-arm64 before treating it as fully covered. Keep the local `scripts/smoke-test.ts` command as a separate host smoke, but do not let it be the only binary execution gate for release assets.
- **Effort estimate:** m

### F4.2 - Local multi-target build script emits one misleading `darwin` tarball instead of the four release asset names

- **Severity:** fix-soon
- **Where:** `scripts/build-binaries.ts:443`, `scripts/build-binaries.ts:456`, `scripts/build-binaries.ts:625`
- **Evidence:**
  ```text
  Command:
  bun run scripts/build-binaries.ts
  Exit: 0 after approved rerun
  Output:
  code-oz binaries ready: 0.20.0-alpha.0
  - darwin-arm64 dist/handoff/darwin-arm64/code-oz ... 61645792 bytes
  - darwin-x64 dist/handoff/darwin-x64/code-oz ... 66537712 bytes
  - linux-x64 dist/handoff/linux-x64/code-oz ... 103723011 bytes
  - linux-arm64 dist/handoff/linux-arm64/code-oz ... 101287771 bytes
  manifest: dist/handoff/manifest.json
  tarball: dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz

  Command:
  tar -tzf dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz | sed -n '1,80p'
  Exit: 0
  Output excerpt:
  code-oz-v0.20.0-alpha.0-darwin/linux-arm64/
  code-oz-v0.20.0-alpha.0-darwin/darwin-x64/
  code-oz-v0.20.0-alpha.0-darwin/darwin-arm64/
  code-oz-v0.20.0-alpha.0-darwin/linux-x64/

  Command:
  ls -1 dist/code-oz-v0.20.0-alpha.0-*.tar.gz dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz 2>/dev/null
  Exit: 0
  Output:
  dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz
  dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz
  ```
- **Why it matters for first-run UX:** The script name and output look like a Darwin release asset while containing Linux binaries too, which can cause a maintainer to upload or checksum the wrong local bundle when trying to reproduce the release contract.
- **Proposed fix:** Either make `scripts/build-binaries.ts` emit the same four tarballs as `.github/workflows/release.yml` (`code-oz-v<version>-darwin-arm64.tar.gz`, `darwin-x64`, `linux-x64`, `linux-arm64`) or rename the aggregate output to an explicit non-release name such as `code-oz-v<version>-all-platforms.tar.gz`. Update `scripts/smoke-test.ts` to validate whichever contract is chosen.
- **Effort estimate:** s

### F4.3 - The literal A4 `doctor` smoke fails even though `doctor tools` passes

- **Severity:** fix-soon
- **Where:** `docs/handoffs/2026-05-13-codex-finalize-distribution.md:153`, binary command `code-oz doctor`
- **Evidence:**
  ```text
  Command:
  env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz init
  Exit: 0
  Output:
  code-oz: initialized greenfield project at /private/tmp/code-oz-a4-project-RB5wow/.code-oz

  Command:
  env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz doctor
  Exit: 1
  Output excerpt:
  Usage: code-oz doctor <subcommand> [options]

  Command:
  env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz doctor tools
  Exit: 0
  Output:
  TOOL  AVAILABLE  VERSION
  rg    yes        ripgrep 15.1.0

  All required tools available.
  ```
- **Why it matters for first-run UX:** The playbook asks A4 to smoke `init` and `doctor`; a user or release worker following that literally hits an exit-1 usage page after a successful init.
- **Proposed fix:** Choose one contract and make docs plus CLI match it. Either make bare `code-oz doctor` run a default read-only summary, or update the first-run playbook and README examples to use a specific subcommand such as `doctor tools` or `doctor providers`.
- **Effort estimate:** s

### F4.4 - darwin-x64 local smoke under Rosetta has matching stdout but emits a Bun AVX warning on stderr

- **Severity:** nit
- **Where:** `dist/handoff/darwin-x64/code-oz`
- **Evidence:**
  ```text
  Command:
  dist/handoff/darwin-x64/code-oz --version
  Exit: 0
  Output:
  warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:
    https://github.com/oven-sh/bun/releases/download/bun-v1.3.9/bun-darwin-x64-baseline.zip
  0.20.0-alpha.0

  Command:
  diff -u /tmp/a4-arm64-help.txt /tmp/a4-x64-help.txt
  Exit: 0

  Command:
  sed -n '1,4p' /tmp/a4-x64-help.stderr
  Exit: 0
  Output:
  warn: CPU lacks AVX support, strange crashes may occur. Reinstall Bun or use *-baseline build:
    https://github.com/oven-sh/bun/releases/download/bun-v1.3.9/bun-darwin-x64-baseline.zip
  ```
- **Why it matters for first-run UX:** Help and version stdout are identical, but a user forced onto the x64 binary can see a runtime warning before every CLI response.
- **Proposed fix:** Treat darwin-x64 as synthetic unless it is run on a real Intel macOS host, or add an explicit CI/local note that Rosetta AVX warnings are expected and not a help-parity failure. If older Intel Macs without AVX are in scope, evaluate whether a Bun baseline target is needed before release.
- **Effort estimate:** xs

## Completed checks

```text
pwd && git status --short --branch
Exit: 0
Output: /Users/ozzy-mac/Projects/code-oz; ## finalize/v0.20.1-first-run-polish...origin/main

bun --version
Exit: 0
Output: 1.3.9

uname -s && uname -m
Exit: 0
Output: Darwin; arm64

bun run scripts/build-binaries.ts
Exit: 2 in sandbox
Output excerpt: TOOLCHAIN_FAIL: linux-x64 build failed with exit code 1; Failed to extract executable for 'bun-linux-x64-v1.3.9'. The download may be incomplete.

bun run scripts/build-binaries.ts
Exit: 0 after approved rerun outside sandbox
Output: produced darwin-arm64, darwin-x64, linux-x64, linux-arm64 rows in dist/handoff/manifest.json

jq -r '.version as $v | .targets[] | [.os,.arch,.bunTarget,.binaryRelativePath,.version,.sizeBytes] | @tsv' dist/handoff/manifest.json
Exit: 0
Output:
darwin  arm64  bun-darwin-arm64  darwin-arm64/code-oz  0.20.0-alpha.0  61645792
darwin  x64    bun-darwin-x64    darwin-x64/code-oz    0.20.0-alpha.0  66537712
linux   x64    bun-linux-x64     linux-x64/code-oz     0.20.0-alpha.0  103723011
linux   arm64  bun-linux-arm64   linux-arm64/code-oz   0.20.0-alpha.0  101287771

file dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz dist/handoff/linux-x64/code-oz dist/handoff/linux-arm64/code-oz
Exit: 0
Output: Mach-O arm64, Mach-O x86_64, ELF x86-64, ELF ARM aarch64

du -h dist/handoff/darwin-arm64/code-oz dist/handoff/darwin-x64/code-oz dist/handoff/linux-x64/code-oz dist/handoff/linux-arm64/code-oz dist/code-oz-v0.20.0-alpha.0-darwin.tar.gz
Exit: 0
Output: 59M, 63M, 99M, 97M, 128M

dist/handoff/darwin-arm64/code-oz --version
Exit: 0
Output: 0.20.0-alpha.0

dist/handoff/darwin-arm64/code-oz --help
Exit: 0
Output: help printed cleanly

dist/handoff/darwin-x64/code-oz --version
Exit: 0
Output: 0.20.0-alpha.0 plus Bun AVX warning on stderr under Rosetta

dist/handoff/darwin-x64/code-oz --help
Exit: 0
Output: help stdout matches arm64; Bun AVX warning on stderr under Rosetta

diff -u /tmp/a4-arm64-version.txt /tmp/a4-x64-version.txt
Exit: 0

diff -u /tmp/a4-arm64-help.txt /tmp/a4-x64-help.txt
Exit: 0

bun run scripts/smoke-test.ts
Exit: 0
Output: layout ok, install ok, version ok, help ok, init ok for host target darwin-arm64; tarball validated

env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz init
Exit: 0

env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz doctor
Exit: 1

env HOME=/tmp/code-oz-a4-home-jE1U3w /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-arm64/code-oz doctor tools
Exit: 0

env HOME=/tmp/code-oz-a4-x64-home-319DcC /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-x64/code-oz init
Exit: 0

env HOME=/tmp/code-oz-a4-x64-home-319DcC /Users/ozzy-mac/Projects/code-oz/dist/handoff/darwin-x64/code-oz doctor tools
Exit: 0

dist/handoff/linux-x64/code-oz --version
Exit: 126
Output: exec format error on Darwin host

dist/handoff/linux-arm64/code-oz --version
Exit: 126
Output: exec format error on Darwin host
```

## Gaps

- Linux `--version`, `--help`, `init`, and `doctor` were not runnable on this Darwin arm64 host. Synthetic checks covered manifest rows, file type, executable presence, size, and SHA via `scripts/smoke-test.ts`.
- darwin-x64 was runnable only through Rosetta on Apple Silicon, not on a native Intel Mac.
- No actual GitHub release artifact was generated in this audit; asset naming was checked statically in `.github/workflows/release.yml` and against local `scripts/build-binaries.ts` output.
