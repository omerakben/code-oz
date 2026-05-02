# W3 — Distribution (npm + Homebrew + Scoop + auto-PATH-patch install) — session kickoff

**Date written:** 2026-05-01 (end of M13 session, before close)
**Branch on next session start:** `main` (or fresh `feat/w3-distribution`)
**Tag candidate:** `v0.15.0-alpha.0`

## Why W3 ahead of M14

Per the W3-after-M13 ordering memory (`w3_after_m13_priority.md`,
captured at the post-PE-1 demand checkpoint 2026-05-01): tester
distribution unblocks measurable real-world signal before the first
simultaneous-provider surface (M14 reviewer panel) lands. The locked
post-M10 productization sequence in `docs/design/ROADMAP.md` puts M14
next; this kickoff inserts W3 between M13 and M14 because rule 21's
"earn it with measurable evidence" applies more strongly to a
parallel-provider surface than to a packaging surface.

M14 reviewer panel kickoff stays drafted but parks behind W3.

## State at start

- **HEAD:** `ad416f4 Merge feat/m13-role-cost-policy: M13 Role-cost
  policy under budgets.global (v0.14.0-alpha.0)` on `main`.
- **Tag:** `v0.14.0-alpha.0` (annotated, points at the M13 merge
  commit). Local-only; not pushed.
- **Tests:** 2086 pass / 1 skip / 0 fail offline; `bun run typecheck`
  clean.
- **`origin/main`:** behind by the M13 merge + tag (push pending
  explicit operator approval; default no-push policy stands).
- **Working tree:** clean (M13 close-out).

## Boot sequence

```bash
cd /Users/ozzy-mac/Projects/code-oz
git status --short --branch
git log --oneline --decorate -8
git tag --list 'v0.*' --sort=-v:refname | head -5
bun test 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3
```

If state matches "2086 pass, typecheck clean, HEAD at `ad416f4`, tag
`v0.14.0-alpha.0`," boot W3 per `docs/design/SESSION_CYCLE.md`.

## What W3 (this kickoff) is

**Authority boundary (CLAUDE.md rule 20): distribution + install
path.** How the compiled binary reaches a user's machine, where it
lives on disk, how the install script discovers PATH, and how operator
upgrades flow.

**Scope per `docs/design/ROADMAP.md` § W3, narrowed:**

- Native binary build matrix (`bun build --compile` × target triples).
- Distribution channels: **npm, Homebrew tap, Scoop bucket, `curl | sh`
  install script with auto-PATH-patching**.
- Release automation: GitHub Actions workflow that builds binaries on
  tag push and attaches them to the `gh release`.
- `code-oz --version` continues to print `PKG_VERSION`; no telemetry,
  no remote version check (rule 13 privacy by default).
- Documentation: install instructions in README + a new
  `docs/install/` directory with per-channel guides.

## What W3 is NOT (locked anti-scope-creep)

- **No** Codex/Gemini provider HTTP adapter integration (separate W3.2
  kickoff if/when needed; PE-2 / PE-3 / cloud-route work is
  demand-gated per the post-PE-1 checkpoint).
- **No** LanguagePack abstraction for multi-language targets (W3.3+).
- **No** real-world IIntegration (GitHub / Slack / Linear) — W3.4+.
- **No** Tier-2 DSPy MIPRO compile for Prompter — W3.5+.
- **No** concurrent-runs surface — W3.6+.
- **No** symbol LSP integration — W3.7+.
- **No** M14 reviewer panel work; that kickoff stays drafted but parked.
- **No** `code-oz upgrade` self-update command in W3.1 (subject to
  Codex pressure-test; defer if it expands the binary's network
  surface beyond what this milestone earns).
- **No** auto-upgrade-on-startup (rule 13 — operator authority).
- **No** signed binaries / notarization / Windows code-signing in
  W3.1; document as forward-compat for W3.1.1 if friction surfaces.

## Open questions W3's planning round must answer

The Codex briefing should propose leans on each, with reasoning +
counter-argument:

1. **Native binary build matrix.** Lean: `macos-arm64`, `macos-x64`,
   `linux-x64`, `linux-arm64`, `windows-x64`. Counter: ship arm64
   only (avoids stale x86 baggage). Counter-counter: testers report
   running x64 on Macs and Windows; coverage matters more than
   minimalism for v0.1.

2. **Distribution channels for W3.1.** Lean: all four (npm +
   Homebrew tap + Scoop bucket + `curl | sh`). Counter: ship one
   first (npm) and add the rest after measurable demand.
   Counter-counter: each channel reaches a different operator
   demographic; npm-only excludes brew users who'd never `npm i -g`.

3. **`curl | sh` install script — how aggressively does it touch
   the user's shell?** Lean: install to `~/.local/bin/code-oz` and
   print PATH instructions; do NOT modify `~/.bashrc` /
   `~/.zshrc` / `~/.profile`. Counter: opencode-style modify-with-
   confirmation (interactive append). Counter-counter: silent shell
   modification is a privacy + maintenance hole; explicit
   instructions match the rest of the tool's "operator authority"
   discipline.

4. **Homebrew tap location.** Lean: `homebrew-code-oz` repo under
   `omerakben` GitHub org. Counter: cask-based formula (less
   common). Counter-counter: a binary-attached formula keeps the
   tap simple and matches Bun's own distribution shape.

5. **Scoop bucket location.** Lean: a `scoop-code-oz` repo under
   the same org. Counter: submit to the official `scoop-extras`
   bucket. Counter-counter: own-bucket gives release control;
   official-bucket adds a maintainer-review delay we don't earn yet.

6. **Release automation: GitHub Actions or local-only?** Lean: GH
   Actions workflow that triggers on `v*.*.*` tag push and builds
   the matrix in parallel. Counter: ship local-only `make release`
   for v0.1; CI later. Counter-counter: distribution that depends
   on Ozzy's laptop being awake at release time is fragile; CI
   deserves to land in W3.1 because the matrix is the milestone.

7. **Version provenance: continue tracking `PKG_VERSION` +
   `DEFAULT_CONFIG.version` + `package.json.version` through the
   release automation?** Lean: yes; the M5 finding-#1 invariant
   (all three sources stay in sync) is enforced by
   `tests/m5-fix-first.test.ts`. Add a release-script preflight
   that asserts the trio matches.

8. **Should `code-oz` print a "newer version available" hint at
   startup?** Lean: NO (rule 13 + no telemetry). Counter: opt-in
   via `code-oz config set check-updates true` would let interested
   operators get notified. Counter-counter: even an opt-in version
   check leaks the operator's binary version to a metadata server;
   defer until measurable demand surfaces a real ask.

## Implementation plan sketch (~5-7 commits, locked at planning round)

Tentative — Codex round will pin:

1. `scripts/build-matrix.ts` — TypeScript build orchestrator that
   invokes `bun build --compile` per (os, arch) target and writes
   binaries to `dist/<os>-<arch>/code-oz`. Tests cover the script's
   target-resolution logic.
2. `package.json` `bin` + `files` + `repository` + `homepage` +
   release scripts wired up for npm publish. README install section
   gains a per-channel matrix.
3. `install.sh` (`curl | sh` script) — POSIX-compatible, detects
   uname + arch, downloads the matching binary from the GitHub
   release, places it in `~/.local/bin/code-oz`, prints PATH
   instructions if `~/.local/bin` is not in `$PATH`.
4. `homebrew-code-oz/Formula/code-oz.rb` — Homebrew formula that
   downloads the macOS binary from the GitHub release and installs
   it into `$(brew --prefix)/bin`. Forms its own repo
   (`homebrew-code-oz`) to match `brew tap` conventions.
5. `scoop-code-oz/bucket/code-oz.json` — Scoop manifest that
   downloads the Windows binary from the GitHub release. Forms its
   own bucket repo.
6. `.github/workflows/release.yml` — GitHub Actions workflow
   triggered on `v*.*.*` tag push: build matrix, attach binaries to
   the `gh release`, publish npm package. Preflight check on
   PKG_VERSION + DEFAULT_CONFIG.version + package.json.version
   parity.
7. `docs/install/{macos,linux,windows}.md` — per-platform install
   guides with troubleshooting (PATH missing, gatekeeper on macOS,
   SmartScreen on Windows). README's install section links here.

## Cross-model peer review (durable rule)

CLAUDE.md rules 7+8 stand. Both Codex rounds (planning + implementation
review) run on this milestone. Verdict is data, not authority.

## What earns operator intervention

Stop and ask only for:

- **Push / tag / release / PR** — W3 push grant has not been issued.
- **Production dependency additions** — distribution may need
  `bun-types` or `commander` for the build script; flag if any new
  prod dep enters the tree.
- **Scope conflict with CLAUDE.md** rules 1-21.
- **Codex `debate-required` verdict.**
- **External account / repo creation** — Homebrew tap repo, Scoop
  bucket repo, npm package name reservation (if `code-oz` is
  taken on npmjs, name change is operator decision).
- **Schema decisions that affect M11 / M12 / M13 surfaces** (none
  expected; W3 is packaging-layer only).

## Loose threads from M13 (carry into W3 if they surface)

- **`costActualUSD` output-tokens-only semantics**: documented in
  `docs/contracts/COMPANY.md` and `docs/references/budgets.md`,
  but if W3 ships a release-notes section, call it out
  prominently — operators reading the field as full invoice will
  understate spend. Codex flagged this in R1 review;
  documentation closure is in commit 7 of M13.
- **`byRole.maxTurns` deferred** until role-turn event semantics
  exist. W3 doesn't change this.
- **Per-provider `costPerMTok` defaults** stay omitted for xAI /
  Codex / Gemini / Fake (rotting-data discipline). W3 doesn't
  change this; if the install script ships a sample `config.yaml`
  with a populated `priceTable`, it should mirror
  `DEFAULT_CONFIG.budgets.global.priceTable` and dated source
  comments.
- **`ProviderRequest.role` is now typed `CompanyRole | undefined`**
  via the leaf module `src/agents/role.ts`. W3 may need to import
  the type if any new packaging-layer code constructs requests
  (unlikely; packaging is build-time, not runtime).
- **17+ unpushed commits on local main pending push approval**
  (counts: 17 unpushed before W3, +M13's 11 commits = 28 unpushed
  by W3 start). W3 push grant is its own decision.

## First commands to run

```bash
cd /Users/ozzy-mac/Projects/code-oz
# Verify M13 baseline
git log --oneline --decorate -3
bun test 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3

# Read kickoff + roadmap W3 row
cat docs/design/SESSION_W3_KICKOFF.md
sed -n '/^- \*\*W3/,/^- \*\*W4/p' docs/design/ROADMAP.md | head -30
```

If state matches "2086 pass, typecheck clean, HEAD at `ad416f4`, tag
`v0.14.0-alpha.0`," boot W3 per the cycle:

```
Read CLAUDE.md and docs/design/SESSION_CYCLE.md, then
docs/design/SESSION_W3_KICKOFF.md in full. Boot W3 per the cycle:
prerequisites -> CODEX_BRIEFING_W3.md -> invoke Codex (gpt-5.5 / xhigh
/ read-only / never / cwd=/Users/ozzy-mac/Projects/code-oz) ->
CODEX_RESPONSE_W3.md with synthesis -> present for approval. Do not
start coding until approval lands.
```

## Cycle pointer

Per `docs/design/SESSION_CYCLE.md`. W3 follows the **full discipline**.
Distribution is one new authority boundary (rule 20); the lite-cycle
compromise does not apply.

## Read first (in order)

1. `CLAUDE.md` (rules 1-21; rule 20 + rule 21 are load-bearing for
   any new packaging surface).
2. `docs/design/SESSION_CYCLE.md` (the empirical cycle).
3. **`docs/design/SESSION_W3_KICKOFF.md` (this kickoff — read in
   full).**
4. `docs/design/ROADMAP.md` § "W3 — Production extension" (the W3
   row + the post-M10 productization sequence).
5. `package.json` (existing build scripts: `build:binary`, `dev`,
   `test`, `typecheck`).
6. `tests/m5-fix-first.test.ts` (the version-trio invariant).
7. `docs/research/CODEX_RESPONSE_M13.md` and
   `docs/research/CODEX_REVIEW_M13_R2.md` (M13 review trail; useful
   for the Codex briefing context paragraph).

## Forward-compat (post-W3 sub-tracks)

After W3.1 (this kickoff) ships, the rest of W3 from the roadmap
becomes a sequence of standalone milestones:

- **W3.2** — Codex / Gemini / xAI HTTP adapter unification (PE-2 /
  PE-3 / cloud-route insertion points; demand-gated per the
  post-PE-1 checkpoint).
- **W3.3** — Multi-language LanguagePack (TypeScript + Python first;
  C# scoped if OneStream-internal demand surfaces).
- **W3.4** — Real-world IIntegration (GitHub / Slack / Linear).
- **W3.5** — Tier-2 DSPy MIPRO compile for Prompter.
- **W3.6** — Concurrent runs + multi-active-run pointer.
- **W3.7** — Optional symbol LSP integration for repo-context tools.

Each gets its own kickoff, planning round, implementation review,
and tag. Order is demand-driven (rule 21) — no batched rollout.

After W3.1 closes: M14 reviewer panel kickoff unparks; that's the
first simultaneous-provider surface and earns its own
authority-boundary debate.
