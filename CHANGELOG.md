# Changelog

All notable changes to `code-oz` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) within the `0.x-alpha` line — minor bumps may include breaking changes; patch bumps add behavior or fix bugs without breaking the contract.

## [Unreleased]

## [v0.21.2-alpha.0] — 2026-06-14

### Release-readiness truth sync

- Truth-synced README, provider setup, security policy, contributing guide, receipts, Homebrew docs, GUI README, and release-readiness docs against current implementation.
- Added explicit package/plugin/GUI release-readiness status in `docs/RELEASE_READINESS.md`.
- Corrected CLI help: SHIP is a lifecycle boundary and approval state today; code-oz does not push, merge, publish, or produce release artifacts for the user.
- Fixed `scripts/release/fresh-clone-smoke.sh --help` and made its test summary parser line-oriented so `3815 pass` is not misread as `5 fail`.
- Removed stale Windows `v0.21+` promises from the npm wrapper and Claude Code plugin resolver; Windows/Scoop is deferred to a future distribution milestone.

### Plugin marketplace fixes

- Root Claude Code marketplace metadata is present at `.claude-plugin/marketplace.json`.
- The `code-oz` plugin manifest intentionally omits a redundant `hooks` key; hooks load from plugin files.
- The resolver strips empty-string arguments from plugin command cards so no-argument slash commands such as `/code-oz-doctor` work.

## [v0.21.1-alpha.0] — 2026-05-22

### External-operator driving

- Added fail-closed external-operator driving for Hermes/OpenClaw-style tools while keeping code-oz the gate authority.
- Added three operator binding methods: per-command flags (`--operator <id> --non-interactive`), `CODE_OZ_OPERATOR`, and project binding via `code-oz init --operator <id>`.
- Operator mode records provenance (`run_started.operator`, `approvedBy: operator:<id>`), bans fake provider use, blocks non-interactive SHIP approval, and requires explicit phase names for non-interactive approval.
- Added the text-only `agent-skills/code-oz/` integration surface for agent-first tools.

Detailed notes: [`docs/handoffs/2026-05-22-v0.21.1-release-notes.md`](docs/handoffs/2026-05-22-v0.21.1-release-notes.md).

## [v0.21.0-alpha.0] — 2026-05-21

### M17 brownfield AUDIT runtime

- Added the brownfield entry phase: `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`.
- Added `AUDIT.md` artifact schema, auditor persona/prompt composition, `audit_completed` event, SHA-bound `approve audit`, and brownfield PLAN handoff through `SC-AUDIT-NNN` source IDs.
- Added deterministic spawned-CLI brownfield full-cycle e2e proof while preserving greenfield routing.
- Shipped the Agent Gate Bench runner and first measured deterministic `code-oz Fake` rows. Direct-agent and live-provider columns remain unmeasured until credentials are supplied.

Detailed notes: [`docs/handoffs/2026-05-21-v0.21.0-release-notes.md`](docs/handoffs/2026-05-21-v0.21.0-release-notes.md).

## [v0.20.3-alpha.0] — 2026-05-14

### Friend-experience polish

- Closed seven first-install and first-run findings from real dogfood: empty-repo intervention, INTENT.md greenfield seed detection, verify-fail worktree reset, long BUILD notes diagnostics, GUI persistence, stale-run surfacing, and npm scope-routing recipe correction.
- Kept provider contract unchanged; brownfield AUDIT remained scheduled for v0.21 at this release.

Detailed notes: [`docs/handoffs/2026-05-14-v0.20.3-release-notes.md`](docs/handoffs/2026-05-14-v0.20.3-release-notes.md).

## [v0.20.2-alpha.0] — 2026-05-14

### Real-provider BUILD showstopper fixes

- Injected task blocks into BUILD prompts so Builder receives the per-task PLAN.md content.
- Derived BUILD and REVIEW provider file manifests from `PlanTask` so agents receive real files instead of `filesSent: 0`.
- Added real-provider dogfood evidence for greenfield BUILD and cross-family REVIEW returning substantive findings against actual code.

Detailed notes: [`docs/handoffs/2026-05-14-v0.20.2-release-notes.md`](docs/handoffs/2026-05-14-v0.20.2-release-notes.md).

## [v0.20.1-alpha.0] — 2026-05-14

### First-run polish + public truth sync

Pulls forward the locked Option D Phase 3 trust + community + proof tasks from behind M17 (`docs/planning/1000_STAR_PLAN.md`) so the public surface tells an honest story. **No new gate authority** introduced (rule 20 holds). Provider contract unchanged. M17 AUDIT runtime stays in v0.21.

Triggered by a third-party-eye audit (`docs/code-oz-gpt-pro-research-prompt.md`) that scored engineering 8.0/10 real but 1000-star readiness 3.5/10. The release closes the readiness gap with two parts: small first-run `src/` polish fixes (inherited from earlier branch work), plus a public truth sync (this session's work).

#### First-run polish (src/ fixes)

- `fix(providers): classify expired subprocess auth` — auth-expired errors surface with actionable "re-run `claude login` / `codex login`" suggestion.
- `fix(errors): make intervention pointers line-specific` — `events.jsonl:line=N` pointers in `NEEDS_INTERVENTION.json` are precise, not file-only.
- `fix(cli): close first-run fake and resume paths` — first-run `code-oz init && code-oz run` against `FakeProvider` no longer has resume-path gaps.
- Version bump: `package.json`, `src/cli.ts`, `src/config/schema.ts` (`DEFAULT_CONFIG.version`) → `0.20.1-alpha.0`.

#### Public truth sync

#### Truth correction

- **README hero rewritten** to "CI-style gates for AI coding agents." Replaces the dense "Repo-native agentic SDLC runtime" formulation. Adds "Why not just Claude Code or Codex?", "What is real today?", "What is simulated?", "How is this different?", "Who is this for?", "Failure demo", "Star this repo if..." sections per GPT Pro audit §7.
- **Provider claims corrected.** `package.json` description: "Multi-agent software-company simulation CLI" → "CI-style gates for AI coding agents — local-first governed delivery loop". `keywords` array refreshed (10 entries, no `gemini` until live). `docs/contracts/PROVIDERS.md` restructured into explicit `Live adapters` / `Stubs (transparency only)` / `Future adapter candidates, not in v0.1` sections.
- **CLAUDE.md top matter truth-synced.** Removed "Multi-provider via IAgentProvider (Claude / Codex / Gemini SDKs reading CLI OAuth tokens)" overclaim. Bumped status from v0.20.0 framing to v0.20.1 in-preparation framing.
- **"AI software company" metaphor demoted.** Moved to `docs/ABOUT.md` as historical/internal product framing. Removed as an active tagline. Public positioning is now "CI-style gates for AI coding agents."

#### Trust hygiene

- Added `SECURITY.md` with explicit unsigned-binary caveat and pointer to the v0.x-stable signing milestone.
- Added `CONTRIBUTING.md` with local setup, test discipline, conventional-commit rules, cross-model peer review discipline.
- Added `CODE_OF_CONDUCT.md` adopting Contributor Covenant 2.1 by reference.
- Added `docs/TRUST.md` covering data boundaries, artifact trust, install trust, provider auth boundaries, what is and is not logged.
- Added `.github/ISSUE_TEMPLATE/{bug_report,install_problem,demo_failure,feature_request}.yml` and `.github/ISSUE_TEMPLATE/config.yml`.
- Added `.github/pull_request_template.md` with cross-model review checkboxes.

#### Proof assets

- **Failure-mode demo.** New `docs/demo/02-failure-gates/` walkthrough with five fixtures exercising five production gate APIs (`writeGate` SHA mismatch, `requestReview` cross-family enforcement, `writeNeedsInterventionGate`, the `ReviewStatus` enum distinction, the realpath + worktree-prefix check). New `bun run demo:failure-gates` orchestrator. New `tests/demo/failure-gates.test.ts` characterization tests. Captured outputs committed under `docs/demo/02-failure-gates/output/<fixture>/` with explicit framing distinguishing fixture-author event sketches from real production `events.jsonl`.
- **Comparison page.** New `docs/comparisons/ai-coding-agents.md` reusing the locked Option D §3.2 footnote-sourced table verbatim (Cursor / Claude Code / Aider / Continue / Devin / code-oz; 10 feature rows; 9 footnote citations).
- **Benchmark protocol.** New `docs/benchmarks/agent-gate-bench.md` framed explicitly as the benchmark protocol. All baseline rows are `TBD`. The executable runner ships in v0.21 alongside M17 brownfield smoke.
- **Public roadmap.** Added a "Now / Next / Later" public summary at the top of `docs/design/ROADMAP.md#now-next-later`. Detailed milestone inventory preserved below.

#### Release prep

- `CHANGELOG.md` introduced.
- Release-notes drafts at `docs/handoffs/2026-05-14-v0.20.1-release-notes.md` and `docs/handoffs/2026-05-14-v0.20.0-release-notes-backfill.md`.
- Fresh-clone pre-tag smoke script at `scripts/release/fresh-clone-smoke.sh`.

#### Cross-model peer review

- Codex R0 planning-convergence debate (thread `019e26b5-340c-7842-8c6d-5f73e0ef8829`) returned `accept-with-modifications`. Five block-approve closures + five medium + five missed risks folded into the design before implementation began. Verdict at `docs/design/CODEX_RESPONSE_V0_20_1_POLISH_R0.md`.
- Codex R1 review on the failure-demo code track (thread `019e26f6-be21-7971-bf44-c65c949b0a17`) returned `fix-first` on framing claims (overclaimed `events.jsonl` ledger and incorrect verify-fail semantics). All three block-push findings closed in commit `52f6c4c`. Verdict at `docs/design/CODEX_RESPONSE_V0_20_1_POLISH_R1.md`.

#### Tests

- `bun test`: 3390 → 3395 pass / 0 fail / 2 skip (added 5 demo characterization tests).
- `bun run demo:failure-gates`: 5 / 5 fixtures pass.

#### What did NOT change

- **No new gate authority** introduced. The failure-demo work added zero `src/` changes (`git diff --stat src/ c5fd9ab^..1f35104` is empty). The first-run polish `src/` fixes above are scoped to error-classification, intervention-pointer precision, and first-run UX — they do not introduce new gate primitives or new authority boundaries (rule 20 holds).
- **Provider contract unchanged.** Same four live adapters (Claude, Codex, xAI, Fake). Gemini still a stub. OpenCode and Roo Code still future candidates.
- M17 AUDIT runtime stays scheduled for v0.21.

---

## [v0.20.0-alpha.0] — 2026-05-12

### First public alpha with three install channels

`code-oz` v0.20.0-alpha.0 is the first public alpha shipped through curl, npm, and Homebrew. Same SHA-pinned binary across all three channels, same `checksums.txt` source of truth.

The release closed all of W3a (multi-channel distribution surface): four per-arch native binaries (darwin-{arm64,x64} + linux-{x64,arm64}) compiled via `bun build --compile` in CI, a fail-closed install script, an npm Node-launcher wrapper that downloads + SHA-verifies + caches, and a Homebrew formula rendered into the `omerakben/homebrew-code-oz` tap at release time.

It also folded the locked `--effort lite|balanced|max|beast` flag (B1a), which scales `budgets.global` and `budgets.perPhase` uniformly without changing assurance invariants.

#### Install channels (v0.20.0-alpha.0)

```sh
# curl | sh
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh \
  | sh -s -- --version v0.20.0-alpha.0

# npm
npm install -g @tuel/code-oz

# Homebrew
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
```

#### What shipped

- M14 Reviewer panel v1 (cross-family quorum).
- M15 Debate-policy scheduler v1 (debate on score grey-zone and panel disagreement).
- M16 Production CLI completion authorities (full DEFINE → SHIP runtime on greenfield).
- PE-1 xAI direct HTTP adapter with `XAI_API_KEY` + redaction discipline.
- B1a `--effort` flag.
- W3a multi-channel distribution.
- 3362 offline tests passing.

#### Known limitations (v0.20.0-alpha.0)

- macOS binaries unsigned (xattr workaround in install script).
- No GPG/Sigstore signing of `checksums.txt` yet.
- No Windows or Scoop support yet.
- Gemini provider is a stub.
- OpenCode and Roo Code adapters are future candidates.
- Brownfield AUDIT runtime lands in M17/v0.21.

The notes above the section are a backfill for v0.20.0-alpha.0 — the original release notes were thin and have been rewritten as part of v0.20.1 release prep per GPT Pro audit issue #5.

---

## Earlier releases

For earlier alpha releases (v0.13.x through v0.19.x), see the GitHub Releases page: <https://github.com/omerakben/code-oz/releases>. Per-milestone synthesis docs live under `docs/design/CODEX_RESPONSE_M*.md`.

[Unreleased]: https://github.com/omerakben/code-oz/compare/v0.21.2-alpha.0...HEAD
[v0.21.2-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.21.2-alpha.0
[v0.21.1-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.21.1-alpha.0
[v0.21.0-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.21.0-alpha.0
[v0.20.3-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.3-alpha.0
[v0.20.2-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.2-alpha.0
[v0.20.1-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.1-alpha.0
[v0.20.0-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0
