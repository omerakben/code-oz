# W3-lite scope contract

**Branch:** `feat/w3-lite-demo`
**Off:** `main` at `3408b45` (tag `v0.14.0-alpha.0`)
**Cycle:** Ralph loop, overnight 2026-05-01 → 2026-05-02
**Authority status:** **Scaffold / pre-planning artifact, NOT a milestone close-out.** The formal W3.1 cycle (full discipline per `SESSION_W3_KICKOFF.md`) runs in the morning with these artifacts as evaluable input. This branch will not tag, will not merge to `main`, will not push without explicit operator approval at morning review.

## Why W3-lite exists

Friends-tomorrow demo forces a working `code-oz` binary in their hands by morning. The full W3.1 surface (npm + Homebrew + Scoop + GH Actions + curl|sh + 6-7 commits + planning round) cannot land overnight without inverting the cross-family review discipline (rule 7) or claiming authority W3.1 has not earned (rule 20). W3-lite produces the strict subset that makes the demo work without violating either rule.

## In scope

1. **Multi-target binary build script.** `scripts/build-binaries.ts` invokes `bun build --compile --target=<target>` for `bun-darwin-arm64` and `bun-darwin-x64`, writing to `dist/<os>-<arch>/code-oz`. Tests cover target-resolution + path layout + non-zero exit on toolchain failure.
2. **Local install script.** `scripts/install.sh` (POSIX, no bash-isms): detects `uname -s` + `uname -m`, copies the matching binary from `dist/handoff/<os>-<arch>/code-oz` to `~/.local/bin/code-oz`, strips the macOS quarantine attribute (`xattr -d com.apple.quarantine` if present), prints PATH instructions if `~/.local/bin` is not in `$PATH`. Idempotent: re-running upgrades the binary, doesn't duplicate state.
3. **Handoff bundle.** `dist/handoff/` directory contains `darwin-arm64/code-oz`, `darwin-x64/code-oz`, `install.sh`, and `README.md` with one-page operator-friendly instructions. Friends receive this directory as a tarball.
4. **Smoke test.** `scripts/smoke-test.sh` (or `.ts`) installs the darwin-arm64 binary into a tempdir, runs `code-oz --version`, runs `code-oz init` against a tempdir, asserts both succeed and the version matches `package.json.version`.
5. **Tests.** All new TypeScript code has tests where mockable (target resolution, version-trio invariant, install-script POSIX validation via shellcheck if available, smoke-test result parsing). The 2086 baseline test count must not regress.

## Out of scope (anti-scope-creep, locked)

- **No** GitHub Actions release workflow. `.github/workflows/release.yml` is W3.1 territory.
- **No** npm publish config beyond what already exists in `package.json`. No `prepublishOnly` hook, no `np` integration.
- **No** Homebrew tap, no Scoop bucket. Both need separate repos under `omerakben` org.
- **No** `curl | sh`-from-network install variant. The install script reads from a local `dist/handoff/` directory, not GitHub Releases.
- **No** Linux or Windows targets. Only `bun-darwin-arm64` + `bun-darwin-x64`.
- **No** code signing, no notarization, no Apple Developer ID work. Quarantine is stripped via `xattr`.
- **No** version bump. `package.json.version` stays at `0.14.0-alpha.0` for the demo (Ralph loop must not bump it; W3.1 owns the `v0.15.0-alpha.0` tag candidate).
- **No** changes to existing source under `src/` except surgical additions if the binary build needs a manifest read. If `src/` changes are required, the loop halts on hard escalation.
- **No** new production dependencies. `bun-types` already devDep; `commander` not needed (use Bun's built-in arg parsing or a minimal switch). Adding any prod dep halts the loop.
- **No** changes to `CLAUDE.md`, `docs/design/ROADMAP.md`, `docs/design/SESSION_CYCLE.md`, or any rule contract. W3-lite is implementation, not authority.

## Halt criteria (the loop stops when ANY fires)

**Goal-state (success path):**
- `dist/darwin-arm64/code-oz` exists, executable, `file` command identifies it as Mach-O arm64.
- `dist/darwin-x64/code-oz` exists, executable, `file` command identifies it as Mach-O x86_64.
- `scripts/install.sh` smoke-test passes: install to tempdir, `code-oz --version` prints `0.14.0-alpha.0`, `code-oz init` against a tempdir succeeds.
- `bun test` passes (2086+ tests; W3-lite adds N tests, baseline stays green).
- `bun run typecheck` passes.
- Codex implementation review verdict is `push` or `fix-first` with all block-push and fix-soon findings closed. `block-push` open findings keep the loop running. `debate-required` halts on hard escalation.
- All of the above written to `.code-oz/state/W3_LITE_DONE.json` by the orchestrator.

**Caps (failure path):**
- 12 iterations executed. Loop halts and writes `.code-oz/state/RALPH_HALT.md` with a summary of what's done and what's blocked.
- 8 hours wall-clock from launch. Loop halts and writes the same.

**Sentinel (escalation path):**
- Orchestrator writes `.code-oz/state/RALPH_HALT.md` and stops on:
  - New production dependency requested by Codex sub-agent.
  - npm package name conflict (defer to morning).
  - Apple notarization requirement surfaced (defer to morning).
  - Test regression on the existing 2086 baseline.
  - `bun build --compile --target=bun-darwin-x64` failing with an unfixable toolchain issue.
  - Codex returns `debate-required` verdict.
  - Any change requested to files outside W3-lite scope (`CLAUDE.md`, `ROADMAP.md`, etc.).
  - Working tree contains uncommitted changes that don't belong to W3-lite (foreign drift).

## Codex sub-agent dispatch shape

Each iteration, the orchestrator dispatches **one** bounded Codex task via `mcp__plugin_agent-codex_codex-native__codex`:

- **Model:** `gpt-5.5` (per CLAUDE.md cross-model peer review rule 4 fallback; do NOT use `gpt-5.5-codex` or `gpt-5.1-codex-max`).
- **Reasoning effort:** `xhigh` (default for code work).
- **Sandbox:** `workspace-write` (Codex needs to edit files and run `bun test`).
- **Approval policy:** `never` (no interactive approvals; the orchestrator IS the approval).
- **CWD:** `/Users/ozzy-mac/Projects/code-oz`.
- **Task contract template:** see `docs/contracts/W3_LITE_DISPATCH.md` (written by Ralph iteration 1 if absent).
- **Permissions Codex MAY use:** read repo, write files matching `scripts/**`, `dist/**`, `tests/**`, and the W3-lite docs paths; run `bun test`, `bun run typecheck`, `bun run build:binary`, `git status`, `git diff`, `git add`, `git commit`. Codex MAY NOT push, tag, merge, fetch, pull, or run `gh` commands.
- **Per-iteration deliverable:** Codex appends a one-section summary to `.code-oz/state/ralph-state.md` describing what changed, what tests ran, and the resulting commit SHA (if any).

## Per-iteration loop shape (Opus orchestrator)

1. **Read state** — `.code-oz/state/ralph-state.md` (small, append-only summary file). Read the LAST ~50 lines only; never re-read the full history.
2. **Decide next task** — based on state, pick from the iteration phase ladder (below).
3. **Dispatch Codex** — single MCP call with bounded task.
4. **Verify** — `bun test 2>&1 | tail -5`, `bun run typecheck 2>&1 | tail -3`, `git log --oneline -1`. Never read full diffs into Opus context unless verification fails.
5. **Halt-check** — read `.code-oz/state/W3_LITE_DONE.json` if present; check iteration count; check wall clock.
6. **Write iteration footer** — append to `.code-oz/state/ralph-state.md`: iteration N, decision made, dispatch result, verify result, next phase. Stay under 300 chars per iteration footer.
7. **Re-enter loop** — back to step 1.

## Iteration phase ladder (the loop's progression)

The loop walks this ladder. Each phase may take multiple iterations; advance only when the phase's exit criterion is met.

- **Phase 0 (this commit):** launch prep — branch + scope contract + Codex briefing + `ralph-state.md` initialized.
- **Phase 1:** Codex planning round on W3-lite scope. Codex reads `CODEX_BRIEFING_W3_LITE.md`, returns synthesis `CODEX_RESPONSE_W3_LITE.md`. Orchestrator reads ONLY the synthesis, locks decisions for the rest of the loop. **Exit criterion:** `CODEX_RESPONSE_W3_LITE.md` exists with synthesis section.
- **Phase 2:** Implement `scripts/build-binaries.ts` + tests. Codex writes the script + tests; orchestrator verifies; commits via Codex on success. **Exit criterion:** `bun run scripts/build-binaries.ts` produces both binaries; tests cover target resolution.
- **Phase 3:** Implement `scripts/install.sh` + tests. POSIX-clean (validate via `bash -n` and `shellcheck` if available). **Exit criterion:** install.sh runs against `dist/handoff/` in a tempdir; PATH instructions print correctly.
- **Phase 4:** Implement `scripts/smoke-test.sh` (or `.ts`). Builds both binaries, installs darwin-arm64, runs `code-oz --version` + `code-oz init`. **Exit criterion:** smoke test passes end-to-end.
- **Phase 5:** Build `dist/handoff/` bundle. Both arch binaries + install.sh + a one-page README.md. **Exit criterion:** tarball-able directory exists at `dist/handoff/`.
- **Phase 6:** Codex implementation review (R1) on the W3-lite branch. Verdict drives next phase. **Exit criterion:** review verdict landed in `CODEX_REVIEW_W3_LITE.md`.
- **Phase 7:** Address R1 findings. Each block-push and fix-soon gets a fix commit. Nits/fyis are documented for morning, not necessarily fixed.
- **Phase 8:** Codex review R2 (per the new feedback memory `feedback_review_rounds_catch_different_classes.md` — R2 lens is contract drift / doc consistency). **Exit criterion:** R2 verdict is `push` or `fix-first` with no block-push.
- **Phase 9:** Address R2 findings. Same rules as Phase 7.
- **Phase 10:** Final smoke test + write `W3_LITE_DONE.json`. Loop halts on success.

If the loop hits its iteration cap or wall clock before reaching Phase 10, it writes `RALPH_HALT.md` summarizing where it stopped and what remains.

## Discipline carried forward from the new feedback memories

These shape Codex briefing + every implementation iteration:

1. **Canonical doc precedence chain (`feedback_canonical_doc_precedence_chain.md`)** — W3-lite does NOT introduce a new contract that defers to a canonical doc the W3-lite branch doesn't update. If the install script needs a config-format reference, point at the existing `docs/contracts/COMPANY.md` or skip the reference entirely. The Codex briefing must verify any precedence pointers it proposes.
2. **Explicit at writer = explicit at reader (`feedback_explicit_at_writer_and_reader.md`)** — if the build script writes a manifest (`dist/handoff/manifest.json` describing arch + version + sha256), every reader (install script, smoke test, future GH Actions job) consumes the manifest fields explicitly. No re-derivation from filename or directory name.
3. **R1 vs R2 review classes (`feedback_review_rounds_catch_different_classes.md`)** — the loop plans for two Codex review rounds (Phases 6 + 8), not one. R1 catches behavioral; R2 catches contract drift / doc consistency. Halting after R1 alone violates the lesson.

## Known stale items (cosmetic, do not gate the loop)

- `docs/design/SESSION_W3_KICKOFF.md` line 25 says tag is "Local-only; not pushed" — stale after the M13 push. Per `.remember/remember.md` handoff: cosmetic, fix opportunistically. Loop may fix it as a single-line edit on the launch-prep commit.

## Morning-review handoff format

When the loop halts (success or cap), the orchestrator writes `.code-oz/state/ralph-summary.md` with:

- Loop status (success / capped / escalated).
- Iteration count and wall-clock duration.
- Phase reached.
- Commits landed (SHAs + one-line subjects).
- Codex review verdicts and findings (block-push, fix-soon, nits separately).
- What's in `dist/handoff/` (tarball-ready or not).
- Open questions for the morning's W3.1 planning round.
- Whether `W3_LITE_DONE.json` was written.

## What the morning operator decides

- Whether `feat/w3-lite-demo` cherry-picks into the formal W3.1 branch, rebases, or stays as a forward-compat artifact.
- Whether `dist/handoff/` ships to friends as-is or needs polish.
- Push grant for `feat/w3-lite-demo` (default no, per CLAUDE.md rule 5; M13's grant was milestone-scoped).
- Whether the formal W3.1 planning round adopts any W3-lite design choices or revisits them.
