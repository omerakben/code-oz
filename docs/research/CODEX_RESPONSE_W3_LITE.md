# Codex planning response - W3-lite

**Thread:** `019de6db-17fc-7d32-8581-47d6cd47543d`
**Model:** `gpt-5.5` at `xhigh` reasoning effort
**Sandbox:** `read-only`, `approval-policy: never`, `cwd: /Users/ozzy-mac/Projects/code-oz`
**Date:** 2026-05-02
**Briefing reviewed:** `docs/research/CODEX_BRIEFING_W3_LITE.md`
**Scope contract reviewed:** `docs/contracts/W3_LITE_SCOPE.md`

## Verdict per question

### Q1. Should `scripts/build-binaries.ts` be a Bun script or a `package.json` script?

**Verdict:** `accept-with-modifications`

Use a Bun TypeScript script as the implementation surface, but add a thin `package.json` alias such as `"build:binaries": "bun run scripts/build-binaries.ts"` for discoverability. Keep the existing `"build:binary"` script unchanged because `package.json:15` currently builds the single npm-facing `dist/code-oz`, and W3-lite should not disturb that path unless formal W3.1 chooses to rework npm packaging.

The lean is right because the build matrix has real state: two target triples, output cleanup, handoff copying, manifest writing, hashes, executable bits, and failure reporting. A chained `package.json` command would hide too much behavior in shell syntax and make tests weak. The counter is valid for a one-off local build, but W3-lite is explicitly a scaffold for W3.1, and `docs/contracts/W3_LITE_SCOPE.md:14` already requires tests for target resolution, path layout, and non-zero failure handling.

Specific modifications: export pure helpers from `scripts/build-binaries.ts` so `tests/build-binaries.test.ts` can test target mapping without compiling binaries; inject the command runner so failure paths can be tested without invoking `bun build`; fail closed on unknown targets; and use buffered subprocess handling that avoids the prior Bun stream typing failure class noted in this repo history. The script should use `src/cli.ts` as the entrypoint confirmed at `src/cli.ts:1-7`.

### Q2. Manifest at `dist/handoff/manifest.json`: yes or no?

**Verdict:** `accept-with-modifications`

Yes, write `dist/handoff/manifest.json`, but keep the schema small, versioned, and reader-driven. The feedback memory is directly applicable: if the writer records target, arch, version, path, size, and sha256, then install and smoke readers must consume those exact fields instead of rebuilding meaning from directory names. `docs/contracts/W3_LITE_SCOPE.md:104-106` makes this a hard lesson, and `feedback_explicit_at_writer_and_reader.md:28-37` says writer-only explicitness is incomplete.

The counter has weight because a POSIX installer cannot depend on `jq`, Node, Python, or Bun being installed on a friend's machine. That means the manifest cannot become a rich JSON API that only TypeScript can read. The modification is to use a deliberately flat JSON shape and test the shell reader against that exact shape. Example target row fields: `os`, `arch`, `bunTarget`, `binaryRelativePath`, `sha256`, `sizeBytes`, and `version`. The install script must find exactly one row for the detected `os` and `arch`, read `binaryRelativePath` and `sha256`, verify the file, then copy it. The smoke script should read the same row and assert the installed binary reports `package.json.version`.

Do not let `install.sh` derive `darwin-arm64/code-oz` from `uname` after a manifest exists. That would recreate the M13 reader-side derivation bug in a shell wrapper.

### Q3. Smoke test runs `code-oz init` against a real tempdir, or uses `FakeProvider` end-to-end?

**Verdict:** `accept-with-modifications`

Use a real tempdir and run the compiled binary through `--version`, `help` or `--help`, and `init`. Do not run `code-oz run` with `FakeProvider` in the W3-lite smoke. The compiled binary smoke is about packaging health: the executable starts, argument dispatch works, `PKG_VERSION` is embedded, the YAML dependency is bundled, and `initCommand` can write `.code-oz/` in a clean directory. `src/cli.ts:42-52` gives the exact `--version` and `init` paths, and `src/commands/init.ts:117-143` is enough filesystem behavior to prove the bundle is not dead.

The counter is valid in a milestone close-out: a `FakeProvider` run catches more of the lifecycle. But W3-lite is not closing VERIFY or REVIEW authority, and provider execution expands the smoke into runtime behavior that existing offline tests already cover. `CLAUDE.md:72` says spine tests use `FakeProvider`; it does not require the distribution smoke to repeat the full lifecycle.

Modification: isolate the smoke fully. Set a temp `HOME` or support `CODE_OZ_INSTALL_DIR` in `scripts/install.sh` so the test never touches the operator's real `~/.local/bin`. The smoke should create a temp bundle copy, run its `install.sh`, prepend the temp bin directory to `PATH`, run `code-oz --version`, then `cd` into a separate temp project and run `code-oz init`.

### Q4. Where does `install.sh` live in the repo?

**Verdict:** `accept-with-modifications`

Keep the source script at `scripts/install.sh` and copy it to the handoff bundle root as `dist/handoff/install.sh`. This matches `docs/research/CODEX_BRIEFING_W3_LITE.md:79-83` and avoids making a repo-root `install.sh` look like it installs developer dependencies. The script belongs with other W3-lite operational scripts, not at the project root.

The counter is familiar because many CLI projects use a root installer, but this repo already has a Bun package shape, an existing `bin` field in `package.json:8-10`, and no `scripts/` directory yet. Creating `scripts/` is cleaner than adding a root-level shell file whose meaning changes between repo users and friends receiving the bundle.

Modifications: the script must resolve its bundle root relative to its own path, not the caller's cwd; it must be POSIX `sh` compatible; it must never modify `.zshrc`, `.bashrc`, `.profile`, or any shell startup file; it should print PATH instructions only when the chosen install dir is missing from `PATH`; and `xattr -d com.apple.quarantine` should be best-effort on macOS, not a fatal step. Validate with `sh -n scripts/install.sh`, `bash -n scripts/install.sh`, and `shellcheck` only if available. Missing `shellcheck` should not halt the loop.

### Q5. Tarball naming + bundle layout for friend handoff?

**Verdict:** `accept-with-modifications`

Accept the single Darwin tarball, but reject the `bin/` subdirectory in the briefing lean unless the scope contract is updated first. There is a real contract conflict here: `docs/contracts/W3_LITE_SCOPE.md:15-16` and the pinned source rule in `docs/research/CODEX_BRIEFING_W3_LITE.md:51` say the install script reads from `dist/handoff/<os>-<arch>/code-oz`, while Q5's lean puts binaries under `bin/darwin-arm64/code-oz` and `bin/darwin-x64/code-oz` at `docs/research/CODEX_BRIEFING_W3_LITE.md:87-97`.

Lock the scope-contract layout for overnight:

```text
dist/
  handoff/
    install.sh
    README.md
    manifest.json
    darwin-arm64/
      code-oz
    darwin-x64/
      code-oz
  code-oz-v0.14.0-alpha.0-darwin.tar.gz
```

The tarball should contain a root directory named `code-oz-v0.14.0-alpha.0-darwin/` with the same internal layout as `dist/handoff/`. That keeps the one-tarball friend handoff while preserving the pinned installer source path. If implementation lands the `bin/` layout without updating `W3_LITE_SCOPE.md`, treat that as block-push severity contract drift for R2. The fact that `dist/` is ignored at `.gitignore:2` also means the tarball is a local handoff artifact, not a committed release asset.

### Q6. How does the smoke test run before the binaries exist (cold-start case)?

**Verdict:** `accept-with-modifications`

The smoke test should invoke the build script as its prerequisite, but do not use a plain mtime check as the skip rule. `dist/` is ignored, the W3-lite version intentionally stays at `0.14.0-alpha.0`, and stale local binaries can survive across iterations. A mtime-only skip can pass against old artifacts after script changes.

Preferred behavior: `scripts/smoke-test.ts` runs `bun run scripts/build-binaries.ts --ensure` or the equivalent helper. The build script checks that every manifest target exists, is executable, has the manifest-recorded size and sha256, and reports the expected version for the host-runnable target. Missing or mismatched outputs trigger a rebuild of the W3-lite target directories and handoff directory. A `--force` mode can always clean and rebuild `dist/darwin-arm64`, `dist/darwin-x64`, and `dist/handoff`.

The counter's two-step build-then-smoke flow is acceptable for a human, but the Ralph loop needs a single repeatable command. The counter-counter is correct that orchestration should be small. The modification is replacing the fragile mtime skip with manifest-backed validation. If `bun build --compile --target=bun-darwin-x64` fails because of Bun's toolchain, follow the existing hard halt in `docs/contracts/W3_LITE_SCOPE.md:54`.

### Q7. R1 + R2 review cadence - how does the loop know R2's lens differs from R1?

**Verdict:** `accept-with-modifications`

The lean is right, but the difference must be encoded in `docs/contracts/W3_LITE_DISPATCH.md` before implementation starts. `docs/contracts/W3_LITE_SCOPE.md:68` references that file, but it does not exist in the checkout I inspected. If the loop relies on an absent template, R1 and R2 prompt shape becomes implicit state inside the orchestrator, which is exactly where drift enters.

R1 should ask for behavioral correctness: target mapping, partial build cleanup, executable bits, manifest hash accuracy, shell idempotency, PATH messages, tempdir isolation, and smoke-test failure behavior. R2 should ask for contract and doc consistency: `W3_LITE_SCOPE.md` vs shipped layout, manifest writer vs install/smoke readers, bundle README vs actual install behavior, rule-number references against current `CLAUDE.md`, and no accidental W3.1 claims.

The feedback memory supports this split: `feedback_review_rounds_catch_different_classes.md:14-25` says R1 caught dynamic behavior while R2 caught contract drift in M13. The modification is to make the lens paragraphs concrete and include the universal anti-slop rule sheet in every Codex dispatch prompt. Current `CLAUDE.md` puts universal rules at rule 16, `CLAUDE.md:38`; the W3-lite materials refer to rule 17 in places, so cite file lines or rule names rather than stale numbers.

### Q8. What signals "loop should escalate to morning operator (write `RALPH_HALT.md`)" vs "loop should iterate again"?

**Verdict:** `accept-with-modifications`

Accept the existing sentinel list in `docs/contracts/W3_LITE_SCOPE.md:48-58`, but add a small triage rule so the loop does not halt on normal fixable script failures. Iterate again when failures are confined to new W3-lite files and are clearly closeable: a test expectation mismatch, `sh -n` syntax failure, shellcheck absence, manifest parser bug, README mismatch, missing executable bit, smoke tempdir cleanup issue, or R1/R2 `fix-first` finding with no block-push item. Those are what the loop exists to fix.

Escalate to `RALPH_HALT.md` when the issue crosses a locked boundary: any new production dependency, any requested `src/` change, tag, merge, push, `gh` use, external repo/account work, version bump, package publish work, Linux/Windows target work, network installer work, existing 2086 baseline regression, `debate-required`, unresolved block-push after the review/fix path, foreign uncommitted drift, or Bun darwin-x64 toolchain failure that is not a script bug.

Modification: `RALPH_HALT.md` should always include phase reached, command that failed, last 20-50 lines of relevant output, files changed, latest commit SHA, and whether the halt is scope, toolchain, test regression, review verdict, or state drift. That makes morning review actionable.

## Synthesis - locked plan for Ralph loop iterations 2+

Pinned outcomes:

- Q1: Bun TypeScript build script, plus a thin package script alias. Do not replace existing `build:binary`.
- Q2: Yes to `dist/handoff/manifest.json`, with flat versioned schema and explicit install/smoke readers.
- Q3: Real tempdir smoke with `--version`, `--help` or `help`, and `init`; no `FakeProvider` run.
- Q4: Source installer at `scripts/install.sh`; copied to handoff root.
- Q5: One Darwin tarball, but scope-contract layout wins: no `bin/` subdirectory unless the contract is updated first.
- Q6: Smoke invokes build prerequisite; skip/rebuild decisions use manifest-backed validation, not mtime alone.
- Q7: R1/R2 lens split must be written into `docs/contracts/W3_LITE_DISPATCH.md`; R2 runs even if R1 is clean.
- Q8: Iterate on closeable W3-lite failures; halt on scope, dependency, source, baseline, toolchain, review, or foreign-drift triggers.

Recommended commit order before review phases:

1. Phase 1 to Phase 2 prep
   Subject: `docs(w3-lite): pin dispatch prompts and review lenses`
   Files created/modified: `docs/contracts/W3_LITE_DISPATCH.md`; optionally `docs/contracts/W3_LITE_SCOPE.md` only to point at the dispatch doc and clarify the Q5 layout conflict.
   Test files added: none.
   Verify command: `rg -n "R1|R2|code-oz universal rules|block-push" docs/contracts/W3_LITE_DISPATCH.md docs/contracts/W3_LITE_SCOPE.md`
   Purpose: make Codex sub-agent prompts explicit before any implementation work. Include the universal rule sheet requirement, permissions, write-set limits, no push/tag/merge, R1 behavioral lens, and R2 contract/doc lens.

2. Phase 2
   Subject: `feat(w3-lite): add multi-target binary build script`
   Files created/modified: `scripts/build-binaries.ts`, `tests/build-binaries.test.ts`, `package.json`.
   Test files added: `tests/build-binaries.test.ts`.
   Verify command: `bun test tests/build-binaries.test.ts && bun run typecheck && bun run build:binaries`
   Required behavior: define target rows for `bun-darwin-arm64` and `bun-darwin-x64`; build from `src/cli.ts`; write `dist/darwin-arm64/code-oz` and `dist/darwin-x64/code-oz`; write initial `dist/handoff/manifest.json`; compute sha256 and size; fail closed on target failure; expose pure helpers for tests; preserve `package.json:15` single-binary script.

3. Phase 3
   Subject: `feat(w3-lite): add local manifest-driven installer`
   Files created/modified: `scripts/install.sh`, `scripts/build-binaries.ts`, `tests/install-script.test.ts`.
   Test files added: `tests/install-script.test.ts`.
   Verify command: `sh -n scripts/install.sh && bash -n scripts/install.sh && bun test tests/install-script.test.ts && bun run typecheck`
   Required behavior: copy installer into `dist/handoff/install.sh`; detect `Darwin` plus `arm64` or `x86_64`; read the matching manifest row explicitly; verify sha256 when `shasum` is available; copy to `${CODE_OZ_INSTALL_DIR:-$HOME/.local/bin}/code-oz`; chmod executable; best-effort quarantine removal; no shell startup edits.

4. Phase 4 to Phase 5
   Subject: `test(w3-lite): add handoff smoke test and bundle README`
   Files created/modified: `scripts/smoke-test.ts`, `scripts/build-binaries.ts`, `tests/smoke-test.test.ts`, possibly `tests/handoff-layout.test.ts`.
   Test files added: `tests/smoke-test.test.ts` and optional `tests/handoff-layout.test.ts`.
   Verify command: `bun test tests/smoke-test.test.ts tests/handoff-layout.test.ts && bun run typecheck && bun run scripts/smoke-test.ts`
   Required behavior: build or ensure both binaries; generate `dist/handoff/README.md`; create or validate `dist/code-oz-v0.14.0-alpha.0-darwin.tar.gz`; install into a temp bin dir; run installed `code-oz --version`; run installed `code-oz help` or `--help`; run installed `code-oz init` in a separate temp project; clean tempdirs.

5. Phase 5 final pre-review check
   Subject: `test(w3-lite): verify full offline baseline before review`
   Files created/modified: only if a tiny test harness adjustment is needed; otherwise no commit. If a commit is made, limit it to tests or script robustness.
   Test files added: none expected.
   Verify command: `bun test && bun run typecheck && bun run scripts/smoke-test.ts && git status --short --branch`
   Purpose: ensure the 2086 baseline is still green before Phase 6 R1. If `bun test` regresses outside new W3-lite tests, write `RALPH_HALT.md`.

Review phases:

- Phase 6 R1: write `docs/research/CODEX_REVIEW_W3_LITE.md` with behavioral lens.
- Phase 7: close every block-push and fix-soon item in follow-up commits. Do not amend prior commits.
- Phase 8 R2: write `docs/research/CODEX_REVIEW_W3_LITE_R2.md` or append a clearly separated R2 section if the orchestrator insists on one file. Lens: contract drift and doc consistency.
- Phase 9: close R2 block-push and fix-soon items.
- Phase 10: run `bun test && bun run typecheck && bun run scripts/smoke-test.ts`, verify `dist/handoff/` layout and hashes, then write `.code-oz/state/W3_LITE_DONE.json`.

## Risks

1. Bun darwin-x64 cross-compile may fail under the local Bun/toolchain state. `package.json:18-20` allows Bun `>=1.3.0`, current local Bun is `1.3.9`, and `bun build --help` does not show target triples in its local help text. Cross-compilation may need a cached runtime or network access, and the loop runs without interactive approvals. Mitigation: make the build script classify failures clearly. If `bun-darwin-x64` fails from target/toolchain support rather than script arguments, follow `docs/contracts/W3_LITE_SCOPE.md:54` and halt with output. Do not silently ship arm64-only.

2. Manifest schema drift between build writer and shell readers can recreate the M13 bug class. A JSON manifest is useful only if install and smoke consume it directly. A shell reader that maps `uname -m` to a directory and merely checks that a manifest exists is not compliant. Mitigation: tests must assert that changing `binaryRelativePath` in a fixture changes the install source path, and that missing, duplicate, or mismatched target rows fail closed.

3. `dist/` is ignored, so successful builds are not preserved by git. `.gitignore:2` means `dist/handoff/` and the tarball are local artifacts only. Morning review from another checkout will not see them unless the same machine keeps the worktree. Mitigation: `W3_LITE_DONE.json` and `ralph-summary.md` should record target paths, sha256 values, tarball path, and exact smoke command. Morning can rerun `bun run scripts/smoke-test.ts` to recreate artifacts.

4. Smoke test flakiness can come from temp `HOME`, `PATH`, `git`, `xattr`, or cleanup behavior. `code-oz init` calls git to detect profile in `src/commands/init.ts:80-95`, and the installer touches PATH-sensitive state. Mitigation: use separate temp dirs for bundle, install bin, HOME, and project; pass install dir explicitly or set temp HOME; make `xattr` nonfatal; include command output tails in failures; always clean with force after assertions.

5. Stale rule-number references can confuse R2 and future docs. The current `CLAUDE.md` has cross-family REVIEW at rule 2 (`CLAUDE.md:24`), universal rules at rule 16 (`CLAUDE.md:38`), maestro at rule 17 (`CLAUDE.md:39`), one authority at rule 20 (`CLAUDE.md:42`), no parallel-provider surface at rule 21 (`CLAUDE.md:43`), and no-push under Working in this repo item 5 (`CLAUDE.md:74`). Some W3-lite prose uses older numbers. Mitigation: new W3-lite docs should cite rule names plus file lines, not stale numeric shorthand; R2 should check this directly.

## Pre-implementation discipline checks

1. **Canonical doc precedence chain (`feedback_canonical_doc_precedence_chain.md`)** - PASS with one condition. The proposed plan does not create a new W3-lite doc that claims precedence over `CLAUDE.md`, `ROADMAP.md`, or `SESSION_CYCLE.md`. `docs/contracts/W3_LITE_DISPATCH.md` should be an execution template under `W3_LITE_SCOPE.md`, not a new authority. If it says "conflicts resolve to X," then X must already reflect the W3-lite surface or be updated in the same commit.

2. **Explicit at writer = explicit at reader (`feedback_explicit_at_writer_and_reader.md`)** - PASS if Q2's modifications are followed. The manifest writer records explicit version, target, path, size, and sha256. The installer and smoke test must read those fields explicitly. This becomes FAIL if `install.sh` derives paths from directory names after a manifest exists.

3. **One authority per milestone (CLAUDE.md rule 20)** - PASS. The plan stays scaffold-only. It does not tag, merge, push, bump version, publish npm, create Homebrew/Scoop repos, add GitHub Actions, or claim W3.1 closure. This aligns with `docs/contracts/W3_LITE_SCOPE.md:6` and `docs/research/CODEX_BRIEFING_W3_LITE.md:5`.

4. **Privacy by default (CLAUDE.md rule 13)** - PASS. The installer reads a local bundle, does not call GitHub Releases, does not check remote versions, does not modify shell startup files, and does not add telemetry. PATH guidance is printed, not applied. This follows `CLAUDE.md:35` and the pinned briefing decisions at `docs/research/CODEX_BRIEFING_W3_LITE.md:47-51`.

5. **Universal anti-slop (CLAUDE.md rule 17 references universal-rules.md)** - FAIL as written in the briefing, with a straightforward fix. In the current `CLAUDE.md`, universal rules are rule 16 at `CLAUDE.md:38`; rule 17 is the maestro dossier at `CLAUDE.md:39`. More importantly, neither `docs/contracts/W3_LITE_SCOPE.md` nor `docs/research/CODEX_BRIEFING_W3_LITE.md` proves that the Ralph loop's per-iteration Codex dispatch template imports the universal rule sheet. Fix before Phase 2 by creating `docs/contracts/W3_LITE_DISPATCH.md` with the universal rule requirement and R1/R2 lens split.

## Open questions for the morning operator

1. Should the untracked `.claude/ralph-loop.local.md` be treated as expected Ralph host state or foreign drift? Current `git status --short --branch` shows `?? .claude/`, while `docs/contracts/W3_LITE_SCOPE.md:57` says foreign uncommitted changes trigger halt. I cannot lock this overnight because it is host-tool state, not W3-lite product scope. Recommended provisional answer: classify `.claude/ralph-loop.local.md` as expected local orchestration state, do not commit it, and decide in the morning whether `.claude/` belongs in `.gitignore`.

2. Should the friend handoff be sent as the generated `.tar.gz` or as the raw `dist/handoff/` directory? Q5 locks a tarball name so the loop has one artifact shape, but `docs/design/SESSION_W3_KICKOFF.md:307` says the operator chooses tarball, zip, or plain directory in the morning. Recommended provisional answer: generate the tarball and keep the directory; send whichever is easier after a manual smoke.

3. Should formal W3.1 keep `manifest.json` as the installer's source, or replace it with a platform checksum format? For W3-lite I lock JSON because the briefing asks for it and the feedback memory fits. For W3.1, a POSIX shell installer reading JSON may be too brittle without `jq`. Recommended provisional answer: accept JSON for W3-lite, revisit for W3.1 when GitHub Release assets and Homebrew/Scoop checksums enter scope.

4. Should rule-number drift be cleaned in W3-lite docs or deferred to W3.1 doc cleanup? It is not blocking the binary demo, but R2 should catch it if new docs repeat stale references. Recommended provisional answer: in new W3-lite docs, use rule names plus file lines; defer broad cleanup of older W3 kickoff prose unless it directly affects the loop.

## Final note on Codex's verdict authority

Per `CLAUDE.md` cross-model peer review rule 3, this verdict is data, not authority. I do not disagree with the five pinned operational answers in `docs/research/CODEX_BRIEFING_W3_LITE.md:47-51`. I do disagree with the Q5 lean's `bin/` bundle layout because it conflicts with the locked installer source path in `docs/contracts/W3_LITE_SCOPE.md:15-16` and `docs/research/CODEX_BRIEFING_W3_LITE.md:51`. The orchestrator can proceed, but it should proceed with the scope-contract layout unless it first updates the contract.
