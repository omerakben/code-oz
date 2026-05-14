---
name: v0.20.1-alpha.0 first-run polish design
status: REVISED-1 (Codex R0 returned `accept-with-modifications`; 5 block-approve closures folded + 5 medium findings + 5 missed risks integrated; pending Ozzy approval)
date: 2026-05-14
parent-plan: docs/planning/1000_STAR_PLAN.md (Option D, locked 2026-05-12)
parent-section: pull-forward of Phase 3 trust/community/proof tasks from behind M17 into v0.20.1
audit-source: docs/code-oz-gpt-pro-research-prompt.md (GPT-5.5 Pro third-party-eye audit, 2026-05-14)
codex-debate-thread: 019e26b5-340c-7842-8c6d-5f73e0ef8829 (R0 verdict at docs/design/CODEX_RESPONSE_V0_20_1_POLISH_R0.md)
maestro-role: invoked
budget-ceiling: ≤$10 LLM spend advisory (R0 done; one public-claims-bundle review + final pre-tag Codex review remaining; per-task verdicts via ChatGPT subscription auth = $0 incremental)
target-window: ~14h Maestro execution (12h base + 2h R0-closure overhead), single session, finalize/v0.20.1-first-run-polish branch
locked-decisions:
  release-target: v0.20.1-alpha.0 (NOT v0.21 — M17 stays separate)
  headline: "CI-style gates for AI coding agents" (GPT Pro top scorer, beats current hero on all 10 audit axes)
  metaphor-disposition: demote "AI software company" to docs/ABOUT.md as historical/internal metaphor below concrete shipped facts (per Codex R0 prompt #5 refinement — "Run an AI software company from your terminal" must NOT remain as an active tagline anywhere)
  comparison-table: reuse locked Option D §3.2 verbatim (3x Codex-revised, footnote-sourced, HN-reputation-hardened)
  failure-demo-fixtures: 5 (tampered artifact + scope-escape + verify-fail + same-family-review + reviewer-blocks-risk) — per GPT Pro §8 — PLUS events.jsonl ledger replay assertion as required acceptance per Codex R0 prompt #3
  failure-demo-no-new-authority: any fixture that requires new gate authority OR new production policy gets CUT to v0.21, not implemented in v0.20.1 (Codex R0 B5 closure; rule 20 enforcement)
  benchmark: protocol-only doc this release (Agent Gate Bench method + TBD baseline rows); NO runner, NO bench:* command, NO badge with results until runner exists (Codex R0 prompt #4 wording guard)
  demo-gif: deferred to v0.21 (M17 brownfield smoke is better demo material than FakeProvider-only)
  launch-dispatch: NOT in scope (Show HN / Twitter / community stays gated behind M17 per Option D §5)
  demo-script-rule9-exemption: user-invoked CLI demo scripts (`bun run demo:*`) are exempt from rule 9 permission manifests because they are NOT orchestrator-spawned executables — they are developer-driven entry points with the same trust posture as any `bun run *` invocation. Rule 9 covers runtime-spawned executables (the orchestrator-as-launcher path). Precedent: `scripts/demo/01-todo-cli/run-demo.ts` ships without a manifest. The new `scripts/demo/02-failure-gates/run-demo.ts` follows the same pattern. (Codex R0 B3 closure)
  failure-demo-command: `bun run demo:failure-gates` is THE one command everywhere (README, design, release notes, doc walkthrough). Add to package.json scripts. (Codex R0 B4 closure)
  roadmap-authority: edit canonical `docs/design/ROADMAP.md` to add a public-summary "Now / Next / Later" section at the top. Do NOT create a second `docs/ROADMAP.md` authority. (Codex R0 B2 closure)
  claude-md-truth-sync: `CLAUDE.md` top matter is updated in same release to remove Gemini SDK provider-surface claims and align with v0.20.1 honest provider language. README and CLAUDE.md must agree by tag time. (Codex R0 B1 closure)
  codex-cadence: Codex R0 done; Codex review on the failure-demo code track; one Codex public-claims bundle review on the README+ABOUT+PROVIDERS+CLAUDE.md edits if substantial; final pre-tag Codex review. NO per-task Codex verdicts on mechanical doc/template commits. (Codex R0 prompt #6 acceptance)
---

# v0.20.1-alpha.0 first-run polish

## Context

`code-oz` shipped v0.20.0-alpha.0 on 2026-05-12 with three install channels (npm, Homebrew, curl) and 3390 offline tests. The locked Option D plan (`docs/planning/1000_STAR_PLAN.md`) sequences M17 AUDIT runtime (Phase 2, 30–40h, v0.21) before README rewrite + comparison (Phase 3, 18h, behind M17) before launch (Phase 5, 12h).

GPT-5.5 Pro third-party audit (2026-05-14) scored the repo: engineering 8.0/10 real, product 5.8–6.3/10 (overgenerous self-score), **1000-star readiness 3.5/10** (not launch-ready). The audit's central finding: the repo's public surface signals "alpha toy" even though the engineering is real. Trust holes (Gemini overclaim in README, "simulation" in `package.json` description, no `SECURITY.md`, no failure demo) bleed visitors every day M17 ships behind them.

This design pull-forwards the locked Phase 3 trust/community/proof work into a v0.20.1 finalize polish release **before** M17 lands. M17 (v0.21) and Phase 5 (launch) ship as originally locked — no scope change to Option D, only the order of v0.20.1 polish relative to M17.

The branch `finalize/v0.20.1-first-run-polish` already commits to this path. BP-1..BP-6 backlog (5 test failures + 8 critical issues from this morning's Codex audit) is fully drained: `bun test` reports 3390 pass / 0 fail / 2 skip on current HEAD.

## Goal

Repackage the v0.20.0-alpha.0 surface so a first-time visitor — landing on the GitHub repo via Hacker News, Twitter, or a Google search for "AI coding agent governance" — gets a 10/10 first impression in under 90 seconds, without overclaiming what is live. Specifically:

1. Replace the dense architecture-first README hero with a single-sentence value claim.
2. Correct provider support claims so Gemini=stub and OpenCode/Roo=future are honest.
3. Add `SECURITY.md`, `CONTRIBUTING.md`, issue templates, PR template, and `docs/TRUST.md` so the GitHub Community Standards check goes green.
4. Add a failure demo (`docs/demo/02-failure-gates/`) that runs five deterministic FakeProvider scenarios proving the gates block what they claim to block.
5. Add a benchmark doc skeleton with honest TBD baseline rows so the proof framework exists publicly (runner deferred to v0.21).
6. Reuse the locked Option D §3.2 comparison table verbatim — Codex-reviewed, footnote-sourced, HN-reputation-hardened.
7. Demote the "AI software company" metaphor to `docs/ABOUT.md` to remove roleplay perception.
8. Rewrite the v0.20.0-alpha.0 release notes (currently too thin per GPT Pro audit issue #5) and draft v0.20.1-alpha.0 notes.

Acceptance: a developer arriving at the repo via cold link can answer "what does this tool do, why does it exist, what is real today, what is not yet, how do I try it" in under 90 seconds, without finding any overclaim that a 30-minute HN audit could catch.

## Non-goals (explicit)

- **No M17 AUDIT runtime work.** Stays in v0.21 per Option D Phase 2 lock (rule 20: one new authority per milestone).
- **No W3a R2 launch essay.** Stays in Option D Phase 5; M17 brownfield smoke produces stronger receipts.
- **No Show HN / Twitter / Reddit / LinkedIn dispatch.** Launch sequence stays gated behind M17.
- **No demo GIF / asciicast.** Deferred to v0.21 (M17 brownfield smoke is better demo material; capturing GIF now wastes effort if M17 changes the demo path).
- **No real test fixture in demo.** GPT Pro audit recommends but this is M17 brownfield smoke material; deferring keeps Phase 1 of demo (`01-todo-cli`) on its existing FakeProvider footing.
- **No benchmark runner.** Doc skeleton only this release; executable runner deferred to v0.21 alongside M17 brownfield smoke.
- **No Apple signing / GPG / Sigstore.** Already deferred to v0.x stable per CLAUDE.md.
- **No Windows / Scoop.** Already deferred to v0.20.2 per CLAUDE.md.
- **No Gemini live adapter / OpenCode / Roo adapters.** Stays in "future adapter candidates" honest framing.
- **No new persona authority, no broader `consult()`, no multi-cloud.** Out of v0.20.1 scope.
- **No `code-oz-gui` changes.** Separate repo even though monorepo'd; not in v0.20.1 scope.

## Track-by-track scope

### Track 1: Truth correction (≈4h, +1h for CLAUDE.md sync per Codex R0 B1)

Files modified:

| File | Change |
|---|---|
| `README.md` | Replace hero ("Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.") with "CI-style gates for AI coding agents." Replace "What it is" section's "hybrid phase-graph + agentic sub-orchestration spine" formulation with plain-English value statement. Move dense architecture detail to ABOUT.md link. Add "Why not just Claude Code or Codex?", "What is real today?", "What is simulated?" sections per GPT Pro §7 exact replacement blocks. Add "Star this repo if..." section. Add explicit "this is for risky repos, not fastest-loop coding" framing per Codex R0 missed-risk #4. Add explicit "FakeProvider proves lifecycle gates and ledger determinism, not model quality" framing per Codex R0 missed-risk #1. Update test badge count to 3390 (from 3366) per Codex R0 N1. |
| `docs/ABOUT.md` | Receive the demoted dense architecture content + "AI software company" metaphor (one paragraph, framed as historical/internal product metaphor, below concrete shipped facts per Codex R0 prompt #5 refinement) + influence-library detail. The phrase "Run an AI software company from your terminal" must NOT appear as an active tagline anywhere. |
| `docs/contracts/PROVIDERS.md` | Restructure into THREE explicit sections per Codex R0 M2: **Live adapters** (Claude CLI subprocess, Codex CLI subprocess, xAI HTTP+API key, FakeProvider deterministic). **Stubs** (Gemini — throws on invocation, listed for transparency). **Future adapter candidates, not in v0.1** (OpenCode, Roo Code). Phantom contract entries (treating future candidates as if they were live) are explicitly forbidden. |
| `package.json` | `description` field: "Multi-agent software-company simulation CLI with hard SDLC gates" → "CI-style gates for AI coding agents — local-first governed delivery loop". `keywords` array (add): ["ai", "coding-agent", "cli", "sdlc", "devtools", "agentic-ai", "claude-code", "codex", "typescript", "open-source"]. NO `gemini` keyword until Gemini is live (Codex R0 N4). Add `"demo:failure-gates": "bun run scripts/demo/02-failure-gates/run-demo.ts"` to scripts (Codex R0 B4). |
| `CLAUDE.md` | **Codex R0 B1 closure (block-approve).** Update top matter: remove "Gemini SDKs reading CLI OAuth tokens" and similar provider-surface claims that imply Gemini is live; replace with "Claude / Codex CLI subprocess + xAI HTTP + FakeProvider; Gemini stub for transparency; OpenCode/Roo as future candidates." Update status block to v0.20.1 framing. By tag time, README and CLAUDE.md must tell the same provider-support story. |

Acceptance: any reader landing on README cold understands the value in 90 seconds. No string "Gemini" appears as a live provider claim in README, CLAUDE.md, ABOUT.md, PROVIDERS.md, or package.json keywords. No string "OpenCode" or "Roo" appears as a live provider claim in those files. The word "simulation" appears nowhere in `package.json`. The "AI software company" phrase appears nowhere in README.md above the fold and nowhere as an active tagline. The phrase "Run an AI software company from your terminal" appears nowhere as an active tagline.

### Track 2: Trust hygiene (≈3h)

Files created:

| File | Content |
|---|---|
| `SECURITY.md` | Vulnerability reporting (email + GitHub Security Advisories link), supported versions (v0.20.x), artifact trust posture (SHA-256 verification, **explicit unsigned-binary caveat with link to signing/provenance milestone** per Codex R0 missed-risk #5, xattr workaround), provider auth boundaries (no API keys logged, redaction discipline at `src/providers/xai.ts:redact`), what is logged in `events.jsonl` and what is not. |
| `CONTRIBUTING.md` | Local setup (Bun ≥1.3.0, `bun install`, `bun test`), test commands (offline default, live-provider gate via `CODE_OZ_LIVE_PROVIDER_TESTS=xai`), commit conventions (conventional commits, no emoji, no `Co-Authored-By: Claude` footer), PR expectations (Codex review on substantive changes per cross-model rule), provider-test policy (live tests opt-in only, FakeProvider mandatory for CI). |
| `CODE_OF_CONDUCT.md` | **Codex R0 M1 closure.** Standard Contributor Covenant 2.1 adoption (or equivalent), to satisfy GitHub Community Standards CoC requirement explicitly. Alternative: explicitly document in design which Community Standards items are intentionally not satisfied; choosing to add the CoC instead of carrying an exception. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug form (platform/version/install-channel/repro/expected/actual). |
| `.github/ISSUE_TEMPLATE/install_problem.yml` | Install-channel form (curl / npm / Homebrew / source), platform, error output. |
| `.github/ISSUE_TEMPLATE/demo_failure.yml` | Which demo (`01-todo-cli` / `02-failure-gates`), expected output, actual output, `events.jsonl` tail. |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Problem statement, current workaround, proposed change, alternatives considered. |
| `.github/ISSUE_TEMPLATE/config.yml` | `blank_issues_enabled: false`; contact links to Discussions for Q&A and Discord (deferred — `enable: false` for now). |
| `.github/pull_request_template.md` | Summary, changes, testing (with `bun test` confirmation box), Codex review verdict if applicable, breaking-change flag. |
| `docs/TRUST.md` | Data boundaries (what leaves the repo: only the explicit `ProviderRequest.files` payload; no silent recursive context). Artifact trust (SHA-256-bound approvals, `events.jsonl` ledger, gate file authority). Install trust (single binary, three channels, same `checksums.txt`, npm wrapper no postinstall hook, redirect cap, cache verification). **Explicit unsigned-binary caveat** with link to the v0.x stable signing milestone per Codex R0 missed-risk #5. What is logged and what is not. |

Acceptance per Codex R0 M1 (precise target, not "mostly green"): GitHub Community Standards page (`https://github.com/omerakben/code-oz/community`) shows all applicable items green: Description, README, Code of Conduct, Contributing, License (already MIT), Security Policy, Issue Templates, Pull Request Template. The only acceptable not-green is items where GitHub asks for a setting outside repo files (e.g., GitHub-side description, which is part of Track 5). All five issue templates appear in the "New issue" dropdown. README links `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `docs/TRUST.md` from the appropriate sections.

### Track 3: Proof assets (≈4h)

**Scope guard (Codex R0 B5 closure, block-approve)**: Track 3 must NOT introduce new gate authority or new production policy in v0.20.1. The failure demo exercises gates that already exist in `src/state/gates.ts`. If any fixture's RED-first test surfaces a gate that does not yet exist (e.g., the orchestrator currently has no enforcement path that blocks same-family REVIEW), that fixture is CUT from v0.20.1 and deferred to v0.21 — NOT implemented by adding production gate logic in this release. Rule 20 holds: no new authority boundary in finalize work.

Files created/modified:

| File | Content |
|---|---|
| `docs/demo/02-failure-gates/README.md` | Walkthrough doc: purpose ("prove the gates block what they claim to block"), the five scenarios, expected outputs, what to inspect after each run. Frames FakeProvider correctly per Codex R0 missed-risk #1: "this proves lifecycle gates and ledger determinism, NOT model quality". |
| `scripts/demo/02-failure-gates/run-demo.ts` | Orchestration script: runs all 5 fixtures sequentially against FakeProvider, prints expected-vs-actual delta, exits non-zero if any fixture's gate behavior differs from snapshot. **Exempt from rule 9 permission manifest per the locked decision** (user-invoked CLI demo; matches `01-todo-cli` precedent). |
| `docs/demo/02-failure-gates/fixtures/01-tampered-artifact/` | Fixture: PLAN.md approved with SHA-256; PLAN.md edited after approval; expected: next phase preflight refuses with "approved artifact SHA mismatch" + `NEEDS_INTERVENTION.json` written. |
| `docs/demo/02-failure-gates/fixtures/02-scope-escape/` | Fixture: FakeProvider scripted to write file outside allowed `worktreePath`; expected: mutation gate at `src/state/gates.ts` blocks with `STOP.json`. |
| `docs/demo/02-failure-gates/fixtures/03-verify-fail/` | Fixture: FakeProvider scripted to produce code that fails fixture test command; expected: VERIFY phase writes `NEEDS_INTERVENTION.json` and routes to restart-or-intervene policy. |
| `docs/demo/02-failure-gates/fixtures/04-same-family-review/` | Fixture: config sets BUILD and REVIEW to both anthropic-family providers; expected: `requestReview()` at REVIEW gate refuses with "cross-family policy violated". **B5 audit point**: confirm the cross-family policy is currently enforced in production code before authoring this fixture; if not, CUT this fixture to v0.21. |
| `docs/demo/02-failure-gates/fixtures/05-reviewer-blocks-risk/` | Fixture: FakeProvider scripted reviewer flags risky change (e.g., shell injection); expected: run routes back to revision instead of SHIP, with reviewer verdict in `REVIEW.md`. |
| `tests/demo/failure-gates.test.ts` | RED-first per rule 22: write failing test first asserting each fixture's expected gate behavior; then minimal **wiring-only** implementation if needed (B5: NO new gate authority); expected all 5 fixtures pass deterministically with FakeProvider. **Codex R0 prompt #3 closure: required `events.jsonl` ledger replay assertion** — each fixture's test asserts that the produced `events.jsonl` ledger contains the expected gate-block events in the expected order. |
| `docs/benchmarks/agent-gate-bench.md` | **Protocol-only doc** per Codex R0 prompt #4 wording guard: name (Agent Gate Bench), thesis ("not claiming code-oz writes better code; claiming code-oz catches governance failures direct-agent workflows miss"), 6 task definitions per GPT Pro §8, baseline methods, metrics table, expected result table with `TBD` rows. **Explicit framing: this is the benchmark protocol; no measured results until v0.21 runner ships.** No badge with results. No `bench:*` command in package.json. README references it as "benchmark protocol", not "benchmark proof". |
| `docs/comparisons/ai-coding-agents.md` | Reuse locked Option D §3.2 table verbatim (Cursor / Claude Code / Aider / Continue / Devin / code-oz columns, 10 feature rows, 9 footnotes with source URLs). Add intro paragraph + "best used with" framing + "what code-oz is not" closer. **One canonical public comparison path** per Codex R0 N5: all README links to this file, not to other comparison drafts. |
| `docs/design/ROADMAP.md` (canonical, exists at 65k) | **Codex R0 B2 closure (block-approve)**: edit the existing canonical roadmap to add a public-summary "Now / Next / Later" section at the top. Now = what v0.20.1 ships. Next = M17 AUDIT runtime in v0.21. Later = W3a R2 essay launch, Gemini live, OpenCode/Roo adapters, Windows/Scoop, signing. The detailed milestone inventory stays below the public summary. Do NOT create a second `docs/ROADMAP.md` authority. README links to `docs/design/ROADMAP.md#now-next-later` (anchor in canonical file). |

Acceptance: `bun run demo:failure-gates` (the one canonical command per B4) exits 0 with all 5 fixtures producing snapshot-matched outputs AND `events.jsonl` ledger replay matching expected gate-block event sequence. `bun test tests/demo/failure-gates.test.ts` passes. `docs/benchmarks/agent-gate-bench.md` framed as protocol (not proof). `docs/comparisons/ai-coding-agents.md` matches locked Option D §3.2 row-for-row. `docs/design/ROADMAP.md` has top-level public Now/Next/Later section. README links failure demo, benchmark protocol, comparison page, and roadmap (anchor link). No fixture in this track requires new gate authority — any that does is cut to v0.21.

### Track 4: Release prep + drift pass (≈3h, +1h for fresh-clone smoke + drift sweep per Codex R0 M3+M5)

Files modified + actions:

| Item | Detail |
|---|---|
| `CHANGELOG.md` | Add v0.20.1-alpha.0 entry: truth correction, trust hygiene, proof assets, comparison page, roadmap simplification. Reference each track. |
| `docs/handoffs/2026-05-14-v0.20.1-release-notes.md` | Draft release-notes content for GitHub release page. Structure: "why this release matters" (the GPT Pro audit) → install commands → `bun run demo:failure-gates` command → provider support matrix (live/stub/future-candidate) → limitations → checksums note. **Codex R0 M4 + R2 B4 closures: tag/publish is Ozzy-approved external action.** `.github/workflows/release.yml` auto-creates the GitHub release on tag push with thin auto-generated notes; Ozzy then replaces those thin notes with the rich drafts via `gh release edit v0.20.1-alpha.0 --notes-file …` and `gh release edit v0.20.0-alpha.0 --notes-file …`. Maestro does NOT run the gh release commands. |
| **Fresh-clone smoke (NEW, Codex R0 M3 closure)** | Pre-tag check: clone the repo to a tmp directory, `bun install`, `bun test`, `bun run demo:todo-cli`, `bun run demo:failure-gates`, scan README for any internal doc paths that 404 and any provider claim that contradicts PROVIDERS.md. Block tag if any step fails. Captured as `scripts/release/fresh-clone-smoke.sh` (sh, not ts — avoids needing the binary built first; exempt from rule 9 same-precedent as demo scripts). |
| **Public/internal docs drift pass (NEW, Codex R0 M5 closure)** | Pre-tag check: every file in this set tells the same story — `README.md`, `docs/ABOUT.md`, `docs/contracts/PROVIDERS.md`, `docs/TRUST.md`, `docs/design/ROADMAP.md`, `package.json` description+keywords, `CHANGELOG.md`, `CLAUDE.md` top matter, draft v0.20.1 release notes, GitHub repo sidebar (description+topics for Ozzy to set). Specific drift checks: (a) Gemini status consistent (stub everywhere); (b) provider list consistent (Claude/Codex/xAI/Fake live; OpenCode/Roo future); (c) headline consistent across README+ABOUT+release-notes; (d) `simulation` word absent from package.json+README; (e) test count consistent (3390 in badge, README, release notes). |

Acceptance: Ozzy posts v0.20.1-alpha.0 release with notes tracking the story. v0.20.0-alpha.0 release notes backfilled (Ozzy posts). CHANGELOG.md reflects both. Fresh-clone smoke script exists and runs green pre-tag. Drift pass shows no contradictions across the 9 surfaces.

### Track 5: GitHub UI changes (Ozzy, ≈30min)

Outside Maestro automation; tracked here for completeness:

- Repo description on github.com/omerakben/code-oz: set to "CI-style gates for AI coding agents — local-first governed delivery loop".
- Topics: `ai`, `coding-agent`, `cli`, `sdlc`, `devtools`, `agentic-ai`, `claude-code`, `codex`, `typescript`, `open-source`.
- File 5 good-first-issues with `good first issue`, `docs`, `demo`, `DX` labels. Suggested set: (1) add CHANGELOG link to README footer; (2) add `code-oz --version` to install verification doc; (3) add macOS xattr workaround example to TRUST.md; (4) add asciinema-recording instructions skeleton; (5) typo sweep in `docs/comparisons/`.

Acceptance: GitHub repo sidebar shows description + topics. `gh issue list --label "good first issue"` returns ≥5.

## Maestro orchestration

| Stage | Owner | Output |
|---|---|---|
| Planning | Claude (this session) | This design doc + CODEX_BRIEFING_V0_20_1_POLISH.md + V0_20_1_POLISH_PLAN.md |
| Planning-convergence debate | Codex `gpt-5.5` xhigh, read-only sandbox, ~10min | CODEX_RESPONSE_V0_20_1_POLISH_R0.md |
| Synthesis | Claude | Plan amendments + re-write spec sections if Codex returns `revise` |
| Implementation Track 1 (Truth) | Claude (sub-agents in parallel: README, ABOUT.md, PROVIDERS.md, package.json) | 4 commits on `finalize/v0.20.1-first-run-polish` |
| Implementation Track 2 (Trust) | Claude (sub-agents in parallel: SECURITY, CONTRIBUTING, TRUST) + Codex (issue templates + PR template) | 2 commits each |
| Implementation Track 3 (Proof) | Codex (failure demo + fixtures + RED-first tests) — code-heavy track | RED-first per rule 22; 1–2 commits per fixture |
| Implementation Track 3 cont. | Claude (benchmark doc + comparison page + roadmap) — doc-heavy track | 3 commits |
| Implementation Track 4 (Release) | Claude (CHANGELOG + release notes draft) + Ozzy (gh CLI posting) | 1 commit + 2 GitHub UI actions |
| Implementation Track 5 (GitHub UI) | Ozzy | Manual github.com actions |
| Per-commit review | Codex `gpt-5.5` xhigh on substantive commits | Codex verdict (`push` / `fix-first` / `debate-required`) |
| Pre-tag final review | Codex `gpt-5.5` xhigh on tag-ready commit | Block-push and block-next-milestone findings close before tag |
| Tag | `git tag v0.20.1-alpha.0` + release workflow fires + install smoke across all 3 channels | v0.20.1-alpha.0 on origin |

## Locked decisions

1. ✅ Pull-forward Phase 3 trust/community/proof tasks from behind-M17 to v0.20.1. Option D Phase 2 (M17) + Phase 5 (Launch) preserved unchanged.
2. ✅ README headline: "CI-style gates for AI coding agents" (GPT Pro top scorer, 7-option table §6).
3. ✅ "AI software company" metaphor demoted to `docs/ABOUT.md` below fold (one paragraph max).
4. ✅ Comparison table reused verbatim from locked Option D §3.2 (HN-hardened, footnote-sourced, not GPT Pro draft).
5. ✅ Failure demo = 5 fixtures per GPT Pro §8.
6. ✅ Benchmark = doc skeleton only this release; runner deferred to v0.21.
7. ✅ Demo GIF / real test fixture / asciicast deferred to v0.21 (M17 brownfield smoke is better material).
8. ✅ Launch dispatch (Show HN / Twitter / Reddit / community) NOT in v0.20.1 scope — stays in Option D Phase 5 post-M17.
9. ✅ Cross-model peer review: single Codex R0 debate at planning convergence + per-task verdicts + final pre-tag Codex review.
10. ✅ RED-first per rule 22 for any behavior change (failure demo tests; no behavior change in doc-only tracks).

## Acceptance criteria (whole release)

- All 5 GPT Pro "five changes to make first" (audit §16) shipped: README hero, provider claims, failure demo, security/community basics, release notes.
- All 5 GPT Pro "five assets to publish first" (audit §16) partial-shipped: benchmark protocol doc ✅, comparison page ✅, demo polish doc ✅, failure demo ✅, launch blog deferred to Phase 5.
- **GitHub Community Standards: all applicable items green** (Description, README, CoC, Contributing, License, Security Policy, Issue Templates, PR Template). Only acceptable not-green is GitHub-side description (Track 5, Ozzy posts).
- `bun test` reports 0 failures (currently 3390 pass / 0 fail / 2 skip; failure demo test additions stay green).
- `bun run demo:failure-gates` (canonical command per B4) exits 0 with all 5 fixtures snapshot-matched AND `events.jsonl` ledger replay matching expected gate-block event sequence.
- **CLAUDE.md ↔ README ↔ PROVIDERS.md ↔ ABOUT.md ↔ release notes provider story is consistent** (Codex R0 B1 + M5 closure). The drift pass at Track 4 catches any contradiction before tag.
- **No new gate authority introduced** in any track (Codex R0 B5 closure). Any RED-first failure-demo test that would surface missing gate enforcement gets its fixture cut to v0.21.
- **Roadmap stays single-authority** at `docs/design/ROADMAP.md` (Codex R0 B2 closure). No `docs/ROADMAP.md` shadow file.
- **Fresh-clone pre-tag smoke** passes (Codex R0 M3 closure).
- Codex pre-tag review verdict: `push` (or `fix-first` with all block-push findings closed before tag).
- v0.20.1-alpha.0 tagged on origin with release workflow green; install smoke across curl, npm, Homebrew on a clean macOS shell (Track 5 + Track 4 fresh-clone smoke covers).

## Risk register

| Risk | Mitigation |
|---|---|
| Comparison table claim drifts during README rewrite (HN catches "wait, Aider supports X") | Reuse locked Option D §3.2 verbatim, including footnotes. Do not edit row content; only add intro/closer paragraphs. |
| Failure demo fixture exercises a gate that does not actually exist in src/state/gates.ts | **Codex R0 B5 closure**: cut fixture to v0.21, NOT add new gate authority in v0.20.1. Track 3 explicitly forbids new gate authority introduction. |
| Codex R0 returns `revise` requiring rework | RESOLVED: R0 returned `accept-with-modifications`; this revision folds all 5 block-approve closures + 5 medium + 5 missed risks. |
| Demoting "AI software company" metaphor breaks ABOUT.md narrative coherence | Read ABOUT.md before demoting; integrate the metaphor as a paragraph in the "product thesis" section as historical/internal framing, NOT as an active tagline (per Codex R0 prompt #5 refinement). |
| Package.json description change breaks an npm publish workflow or readme renderer | Verify npm wrapper + Homebrew formula still render correctly after description swap; fresh-clone smoke at Track 4 catches. |
| Issue templates use schema fields not supported by GitHub's form schema | Validate against `.github/ISSUE_TEMPLATE/` schema (`type: textarea / dropdown / input` + `validations.required`). Test by previewing on the GitHub UI before merge. |
| Pull-forward creates Option D Phase 3 drift (when M17 ships, Phase 3 README rewrite is now duplicative) | Update Option D Phase 3 to reflect "incremental polish on top of v0.20.1 base" after this release ships, not a full rewrite. Edit `docs/planning/1000_STAR_PLAN.md` after v0.20.1 tag. |
| BP-1..BP-6 backlog is actually still latent despite green tests | `bun test` is clean (3390 pass / 0 fail / 2 skip); treat the morning memory note as resolved. If new failures surface during this release, gate v0.20.1 on their resolution. |
| **HN-class missed risk #1: "FakeProvider proves nothing about LLM quality"** (Codex R0) | Mitigation: README + failure-demo doc explicitly say "FakeProvider proves lifecycle gates and ledger determinism, NOT model quality." Don't pretend otherwise. |
| **HN-class missed risk #2: "Your benchmark is empty"** (Codex R0) | Mitigation: frame `agent-gate-bench.md` as **benchmark protocol**, not benchmark proof. README phrasing: "the protocol; measured rows land in v0.21 with the runner." |
| **HN-class missed risk #3: "Your own docs contradict the README"** (Codex R0 — biggest HN risk) | Mitigation: CLAUDE.md truth-sync (Track 1 B1) + drift pass at Track 4 covering 9 surfaces. By tag time, README and CLAUDE.md tell the same provider story. |
| **HN-class missed risk #4: "This slows developers down"** (Codex R0) | Mitigation: README explicit framing: "for risky repos, not fastest-loop coding"; "use direct agents for low-risk; use code-oz when auditability matters." |
| **HN-class missed risk #5: "Unsigned binaries for a trust tool"** (Codex R0) | Mitigation: SECURITY.md + TRUST.md make unsigned-binary caveat explicit AND link to the signing/provenance milestone (deferred to v0.x stable per CLAUDE.md). Don't bury the caveat. |

## Out-of-band decisions deferred mid-execution

| Decision | Trigger | Default |
|---|---|---|
| Exact wording of v0.20.0-alpha.0 release-notes backfill | After Track 4 commit | Use GPT Pro audit §16 "Release notes rewrite" template |
| Comparison page intro paragraph + "what code-oz is not" closer | After Track 3 commit | Pull from GPT Pro §5 competitive conclusion + §11 comparison page subtitle |
| Whether to ship benchmark runner skeleton (empty file, "TBD" body) in v0.20.1 instead of deferring | After Codex R0 debate | Defer (locked) unless Codex flags as block-push |
| Whether to ship 1–2 good-first-issues in same commit as release-prep, instead of asking Ozzy | After Track 4 | Draft issue bodies, Ozzy files via gh CLI |
