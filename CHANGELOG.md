# Changelog

All notable changes to `code-oz` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) within the `0.x-alpha` line — minor bumps may include breaking changes; patch bumps add behavior or fix bugs without breaking the contract.

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

[v0.20.1-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.1-alpha.0
[v0.20.0-alpha.0]: https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0
