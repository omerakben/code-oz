# Codex planning briefing — W3-lite (overnight scaffold for friends-tomorrow demo)

**Date:** 2026-05-01 23:55 → 2026-05-02 morning. **Branch:** `feat/w3-lite-demo`. **HEAD:** off `main` at `3408b45` (post-M13 W3 kickoff commit, tag `v0.14.0-alpha.0`).

W3-lite is **NOT a milestone close-out**. It is a scaffold / pre-planning artifact. The formal W3.1 cycle (full discipline per `docs/design/SESSION_W3_KICKOFF.md`) runs in the morning with W3-lite's artifacts as evaluable input. This branch will not tag, will not merge to `main`, will not push without explicit operator approval.

The forcing function is operational: Ozzy is meeting friends tomorrow and wants a working `code-oz` binary in their hands. The full W3.1 surface (npm + Homebrew + Scoop + GH Actions + curl|sh) cannot land overnight without violating cross-family REVIEW discipline (CLAUDE.md rule 2 at line 24) or claiming authority W3.1 has not earned (CLAUDE.md rule 20, one authority boundary, at line 42). W3-lite is the strict subset that makes the demo work without violating either rule.

Codex's job in this briefing is to pressure-test the W3-lite design before any implementation commits land. After this round closes (`CODEX_RESPONSE_W3_LITE.md` written), the Ralph loop's overnight iterations execute against the synthesized plan.

## Live state at briefing time (verified)

- **HEAD:** `feat/w3-lite-demo` off `3408b45` on `main`. Latest tag: `v0.14.0-alpha.0` at `ad416f4`.
- **Origin:** `https://github.com/omerakben/code-oz` — public. `v0.14.0-alpha.0` is pushed to `origin/main` and a `gh release` was published. The W3 kickoff text "Local-only; not pushed" is stale (cosmetic; Ralph loop may correct opportunistically).
- **Working tree on `feat/w3-lite-demo`:** uncommitted edit to `docs/design/SESSION_W3_KICKOFF.md` (ask-me appendix from this session) + new `docs/contracts/W3_LITE_SCOPE.md`. Will be committed as launch-prep before this briefing dispatches.
- **Tests:** 2086 pass / 1 skip / 0 fail offline. `bun run typecheck` clean. The 2086 baseline must stay green every iteration.
- **Existing build script:** `package.json` has `"build:binary": "bun build --compile --target=bun src/cli.ts --outfile dist/code-oz"`. Single-target. W3-lite extends to multi-target.
- **Existing distribution config in `package.json`:** `bin.code-oz`, `files`, `repository`, `homepage`, `bugs`, `keywords` already populated. npm-publish-ready in shape but no publish has happened.

## W3-lite scope (locked from ask-me decision record at `docs/design/SESSION_W3_KICKOFF.md` § ask-me 2026-05-01 23:55)

**Authority status:** scaffold, not authority boundary.

In scope:

1. `scripts/build-binaries.ts` — multi-target build orchestrator. Targets: `bun-darwin-arm64`, `bun-darwin-x64`. Output layout: `dist/<os>-<arch>/code-oz`. Tests cover target resolution and non-zero exit on toolchain failure.
2. `scripts/install.sh` — POSIX install script. Detects `uname -s` + `uname -m`, copies binary from `dist/handoff/<os>-<arch>/code-oz` to `~/.local/bin/code-oz`, strips macOS quarantine via `xattr -d com.apple.quarantine`, prints PATH instructions if `~/.local/bin` not in `$PATH`. Idempotent.
3. `dist/handoff/` — bundle directory with both arch binaries, `install.sh`, and a one-page operator-friendly README. Tarball-able for friend handoff.
4. `scripts/smoke-test.sh` (or `.ts`) — end-to-end: build both binaries, install darwin-arm64 to a tempdir, run `code-oz --version` and `code-oz init` against a tempdir, assert success and version match.
5. Tests for the new TypeScript surface. 2086 baseline must not regress.

Out of scope (locked):

- No GitHub Actions, no `.github/workflows/release.yml`.
- No Homebrew tap, no Scoop bucket, no `npm publish`.
- No `curl | sh`-from-network variant. Install reads from local `dist/handoff/`.
- No Linux, no Windows targets.
- No code signing, no notarization, no Apple Developer ID work.
- No version bump. `package.json.version` stays at `0.14.0-alpha.0`.
- No new production dependencies.
- No edits to `src/`, `CLAUDE.md`, `docs/design/ROADMAP.md`, or any contract under `docs/contracts/` other than W3-lite's own.

## Pinned answers (no debate; locked by ask-me + kickoff)

These five questions are pinned by the ask-me decision record + the W3 kickoff doc. Codex MAY note disagreement but must not block on them — they are operational decisions Ozzy made:

1. **Targets:** `bun-darwin-arm64` + `bun-darwin-x64` only. No Linux, no Windows. Pinned by ask-me Q3.
2. **Install location:** `~/.local/bin/code-oz`. Pinned by W3 kickoff § "Open questions" Q3 lean (also matches CLAUDE.md rule 13, privacy by default, at line 35).
3. **Shell modification:** install script does NOT modify `~/.zshrc` / `~/.bashrc` / `~/.profile`. It prints PATH instructions. Pinned by W3 kickoff Q3 lean + CLAUDE.md rule 13, privacy by default, at line 35.
4. **Quarantine handling:** `xattr -d com.apple.quarantine` if attribute present. No code signing, no notarization. Pinned by ask-me Q3 reasoning.
5. **Source of binary for the install script:** local `dist/handoff/<os>-<arch>/code-oz`. NOT GitHub Releases (curl|sh-from-network is W3.1). Pinned by ask-me Q2.

## Open questions for Codex (debate these)

Each has a recommended lean + counter + counter-counter. Codex picks `accept`, `accept-with-modifications`, or `reject` per question and explains.

### Q1. Should `scripts/build-binaries.ts` be a Bun script or a `package.json` script?

**Lean:** Bun script (`bun run scripts/build-binaries.ts`). Programmatic target list, type-checked, tests in `tests/build-binaries.test.ts`.
**Counter:** `package.json` script with `&&` chain (`"build:binary:matrix": "bun build --compile --target=bun-darwin-arm64 ... && bun build ..."`). Simpler, no new TS surface.
**Counter-counter:** `package.json` chains lose error context (one target failing leaves the other half-built), can't atomically clean `dist/`, and don't compose with the smoke-test script. The TS script is the right shape for W3.1 to extend (5 targets + GH Actions calls).

### Q2. Manifest at `dist/handoff/manifest.json`: yes or no?

**Lean:** YES. The build script writes a manifest with `{ version, builtAt, targets: [{ os, arch, sha256, size }] }`. Install script reads the manifest to verify integrity (sha256) before copying the binary. Smoke test reads the manifest to identify which binary it's testing.
**Counter:** No manifest. Install script trusts the binary at `dist/handoff/<os>-<arch>/code-oz`. Smaller surface.
**Counter-counter:** The new feedback memory `feedback_explicit_at_writer_and_reader.md` warns against re-deriving values from filenames or directory paths. A manifest makes writer (build script) explicit and reader (install + smoke) explicit. Even at W3-lite scale, the discipline pays off when W3.1 extends to 5 targets with sha256 attestation.

**Implication if Q2 = YES:** Reader code consumes manifest fields explicitly. No re-derivation of `arch` from `dirname` or `basename`.

### Q3. Smoke test runs `code-oz init` against a real tempdir, or uses `FakeProvider` end-to-end?

**Lean:** Real tempdir, real `code-oz init`, no provider invocation. The smoke test verifies the binary loaded, parsed args, wrote files. It does NOT exercise `code-oz run` because that requires provider auth.
**Counter:** Run a full `code-oz run` against `FakeProvider` to prove the FSM works inside the compiled binary. Catches packaging bugs that `init` alone wouldn't.
**Counter-counter:** `bun build --compile` includes the entire `src/` tree at runtime. If `init` works, the import graph resolved correctly and the binary is healthy. Adding a `run` invocation for the smoke test triples the test surface and isn't load-bearing for the demo (friends will run `init` first; if that works, they're convinced).

**Codex may pick:** `accept` (init only), `accept-with-modifications` (init + a `--help` invocation as a second smoke), or `reject` (run-with-FakeProvider).

### Q4. Where does `install.sh` live in the repo?

**Lean:** `scripts/install.sh` (alongside `scripts/build-binaries.ts`). Copied to `dist/handoff/install.sh` by the build script for tarball.
**Counter:** Top-level `install.sh` (matches opencode + mise + many CLI tools).
**Counter-counter:** Top-level pollutes the repo root and confuses operators (is this for installing my repo deps? for installing code-oz?). `scripts/install.sh` is unambiguous; the tarball renames it on the way out so operators see `install.sh` at the bundle root.

### Q5. Tarball naming + bundle layout for friend handoff?

**Lean:** `dist/code-oz-v0.14.0-alpha.0-darwin.tar.gz` containing:
```
code-oz-v0.14.0-alpha.0-darwin/
├── install.sh
├── README.md
├── manifest.json
└── bin/
    ├── darwin-arm64/code-oz
    └── darwin-x64/code-oz
```
Install script lives at the bundle root; binaries live under `bin/<arch>/`.

**Counter:** Flatter — `code-oz-darwin-arm64` + `code-oz-darwin-x64` separate tarballs (one per arch). Friends pick the matching one.
**Counter-counter:** Two tarballs doubles the handoff surface and forces friends to know their arch. The unified tarball with `install.sh` auto-detecting `uname -m` is the demo's whole point. The 2x size cost (~150MB extra) is acceptable for a friends-handoff bundle.

### Q6. How does the smoke test run before the binaries exist (cold-start case)?

**Lean:** Smoke test invokes the build script as a prerequisite (`scripts/smoke-test.sh` runs `bun run scripts/build-binaries.ts` first). If binaries already exist, skip rebuild via mtime check.
**Counter:** Smoke test fails if binaries missing — operator runs build first, then smoke. Two manual steps.
**Counter-counter:** The Ralph loop runs both, in order, every iteration. Coupling them in the smoke script reduces orchestrator surface. The mtime skip avoids 2-minute rebuild cost on no-op iterations.

### Q7. R1 + R2 review cadence — how does the loop know R2's lens differs from R1?

**Lean:** The Ralph loop dispatches R1 with prompt focused on **behavioral correctness** (does the build script handle target failures? does install.sh idempotency hold? do tests cover edge cases?). R2 dispatches with prompt focused on **contract drift / doc consistency** (does `dist/handoff/README.md` match `install.sh` behavior? does `W3_LITE_SCOPE.md` match what shipped? does the manifest schema match the install script's reader?).

**Counter:** Identical prompt for both rounds. Codex picks the lens itself per `feedback_review_rounds_catch_different_classes.md`.
**Counter-counter:** The feedback memory is descriptive (Codex's natural progression), not prescriptive. But explicitly priming R2 toward contract drift accelerates the catch — and the loop's iteration cap (12) makes acceleration valuable. R1 prompt and R2 prompt diverge only in the "lens" paragraph; the rest is identical.

### Q8. What signals "loop should escalate to morning operator (write `RALPH_HALT.md`)" vs "loop should iterate again"?

**Lean:** Hard escalation triggers (already locked in `W3_LITE_SCOPE.md` § Halt criteria § Sentinel). Soft signals — Codex returning a fix-first verdict with closeable findings — are NOT escalations; they trigger the next iteration's fix-commit phase.
**Counter:** Add: any test fails on the first build attempt → escalate. Don't try to fix overnight.
**Counter-counter:** Test failures on the first build are the MOST common reason to iterate (e.g., shellcheck not installed, target naming convention). Escalating on first failure burns the loop's value. Better: the orchestrator runs `bun test 2>&1 | tail -20`; if the failure is in the new W3-lite tests it dispatches a fix-iteration; if the failure is in the 2086 baseline (a regression caused by a script change) it escalates.

## Discipline carried forward from new feedback memories

The Ralph loop is bound by these as hard rules:

1. **Canonical doc precedence chain (`feedback_canonical_doc_precedence_chain.md`)** — W3-lite must NOT introduce a contract that defers to a canonical doc the W3-lite branch doesn't update. The W3-lite scope contract intentionally does not name any other doc as "authoritative" beyond CLAUDE.md (already authoritative globally) and SESSION_W3_KICKOFF.md (already authoritative for the W3 milestone). If Codex's synthesis proposes a precedence pointer (e.g., "install.sh's behavior is authoritative; manifest.json defers to it"), Codex must verify the named canonical actually reflects the new surface.
2. **Explicit at writer = explicit at reader (`feedback_explicit_at_writer_and_reader.md`)** — if Q2 = YES (manifest), every reader (install, smoke, future GH Actions) consumes manifest fields explicitly. No re-deriving `arch` from filename. No re-deriving `version` from `git describe`. The manifest is the single explicit source.
3. **R1 vs R2 lenses (`feedback_review_rounds_catch_different_classes.md`)** — Q7's lean operationalizes this. R1 prompt = behavioral; R2 prompt = contract/doc drift. The loop plans for both, even if R1 returns `push`.

## Codex deliverable: `docs/research/CODEX_RESPONSE_W3_LITE.md`

Codex writes this file with sections:

1. **Verdict per question** — for Q1 through Q8: `accept` / `accept-with-modifications` / `reject` + reasoning.
2. **Synthesis** — the locked plan for the Ralph loop. Pin every Q1-Q8 outcome. List file paths + commit boundaries (~3-5 commits expected on `feat/w3-lite-demo` for the implementation phases).
3. **Risks** — what could go wrong overnight that wasn't covered. Cap at 5; rank by severity.
4. **Pre-implementation discipline checks** — verify canonical-precedence + explicit-reader rules hold for the proposed plan.
5. **Open questions for the morning operator** — anything Codex declined to lock without operator input.

## Codex invocation parameters

- Model: `gpt-5.5` (per CLAUDE.md cross-model peer review item 4 at line 87).
- Reasoning effort: `xhigh`.
- Sandbox: `read-only` (this is a planning round; no file edits).
- Approval policy: `never`.
- CWD: `/Users/ozzy-mac/Projects/code-oz`.

## Operational note

The Ralph loop's iteration 1 dispatches this briefing. Codex's response gets read by the orchestrator's next iteration; it locks the synthesis decisions for all subsequent iterations. **Codex's verdict is data, not authority** (CLAUDE.md cross-model peer review item 3 at line 85). If Codex pushes back on a pinned answer, the orchestrator notes the disagreement in `.code-oz/state/ralph-state.md` for morning review and proceeds with the pinned answer.
