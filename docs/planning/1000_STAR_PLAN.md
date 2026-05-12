---
name: 1000-star plan — Option D (M17 AUDIT runtime + W3a R2 launch demo)
status: REVISED-3-cleanup after Codex R0-revision-3 doc-cleanup feedback (substance approval-worthy in R0-revision-3); pending R0-revision-3-cleanup verdict + Ozzy final approval
date-revised: 2026-05-12
target: 1000 GitHub stars within 90 days; base case 200–500
codex-debate-thread: 019e1c94 (strategy) → 019e1cda (R0 revise on Path B) → 019e1d48 (R0-revision revise-again) → 019e1d5b (R0-revision-2 revise-again-2) → 019e1d68 (R0-revision-3 review)
locked-decisions:
  scope: Option D (M17 AUDIT runtime + W3a R2 self-hosted demo; SWE-bench deferred to v0.22 M18)
  launch-demo: W3a R2 self-hosted "AI release gate caught CI bug" story (receipts already exist)
  essay-venue: docs/blog/ canonical + dev.to cross-post
  audience: >1k existing following (Phase 5 amplification leveraged)
  autonomy-mode: plan-first → Codex R0-revision → Ozzy approval → autonomous execute
  maestro-role: explicitly invoked by Ozzy 2026-05-12
budget-ceiling: ≤$50 LLM spend advisory ceiling (M17 cross-family review only; Codex via ChatGPT subscription auth = $0 incremental; Claude API spend tracked externally with $30 advisory target — hard enforcement is `budgets.global.maxTokensEstimate` per review round, NOT dollars; see Phase 2 cost realism), 65h engineering across 6 weeks
deferred-to-v0.22-m18: SWE-bench Verified adapter + benchmark pilot
---

# 1000-star plan — Option D

## Revision context

Codex R0 returned `revise` on the original Path B plan (`docs/planning/CODEX_RESPONSE_1000_STAR_R0.md`). The biggest hard miss: **`code-oz run` has no `audit` dispatch branch** (verified at `src/commands/run.ts:942`). Adding `auditor.md` alone does not make brownfield runnable — the runtime needs a new phase module, new dispatch, new artifact schema, new gate logic. Codex correctly flagged this as W4-roadmap-scale work being compressed into a launch sprint.

Option D treats this discovery as a **product opportunity, not a planning failure.** M17 ships AUDIT runtime as a real milestone with Codex review rounds (matching M14/M15/M16 cadence). The launch uses the W3a R2 self-hosted demo whose receipts already exist in this repo — no SWE-bench dependency. SWE-bench Verified adapter lands cleanly as M18 in v0.22 after AUDIT runtime stabilizes.

### R0-revision-3 closures (this revision)

Revision chain so far: R0 returned `revise` → R0-revision returned `revise-again` (three block-approve + two medium findings) → R0-revision-2 returned `revise-again-2` (four partial/open closures: C1 anti-stub, footnote 1 overclaim, rule 16 honesty, cost cap enforcement honesty) + three editorial drift findings. R0-revision-2 verdict is at `docs/planning/CODEX_RESPONSE_1000_STAR_R0_REVISION_2.md` (thread `019e1d5b`); R0-revision-3 verdict at `docs/planning/CODEX_RESPONSE_1000_STAR_R0_REVISION_3.md` (thread `019e1d68`) closed substance but flagged stale doc text. This R0-revision-3 + R0-revision-3-cleanup pass closes all remaining items:

1. **Consumer-first ordering (block-approve R0-revision #1 + R0-revision-2 anti-stub):** Phase 2.1 commit sequence is reordered so C1 is the failing brownfield CLI e2e RED test invoking the actual `code-oz run` binary path. The failure progression is *staged*, not simultaneous: today (before Phase 1.6) C1 fails at the greenfield hardcode at `src/commands/run.ts:309-316`; once Phase 1.6 lands, C1 fails at the missing `phase === 'audit'` dispatch branch between `run.ts:942` and the active-run fallback at `run.ts:1134`; only then do later commits expose missing phase module, persona, and artifact schema. C1 explicitly forbids the weaker state-level substitute at `tests/state-regression.test.ts:402-416` that bypasses dispatch entirely.
2. **Rule 20 boundary (block-approve R0-revision #3):** Brownfield profile-detection completion moves OUT of M17 into a new **Phase 1.6 prerequisite bugfix**. M17's authority becomes purely "AUDIT runtime + dispatch + persona" — a single capability domain.
3. **Rule 1 gate authority (block-approve R0-revision #2):** C6 (formerly C4 in the prior numbering) no longer introduces a standalone `approveAuditGate`. The generic `approveGate()` at `src/state/run.ts:466-518` already accepts canonical phases (including `audit`, see `src/state/schemas.ts:6` and `src/state/schemas.ts:33-40`). M17 reuses it and adds audit-specific regression coverage only.
4. **Cost realism — token cap enforced, dollars advisory (R0 finding #4 partial → closed honestly per R0-revision-2 + R0-revision-3):** The repo's budget machinery enforces tokens/calls/turns/wall-time, not dollars (`src/providers/cost.ts:14-20` is explicit that USD helpers are advisory telemetry; `assertWithinBudget()` at `src/providers/cost.ts:213-318` is the kill switch). Closure structure: (a) Codex via ChatGPT subscription auth = $0 incremental (no API call surface); (b) Claude API M17 R1+R2 review runs under `budgets.global.maxTokensEstimate` ≤ 600k tokens per round (`src/config/schema.ts:315-342` default 2M trimmed for M17), enforced; (c) external dollar tracking targets $30 advisory ceiling using `priceTable` telemetry per `src/config/schema.ts:329-331`, NOT a kill switch; (d) if the token-budget warning fires twice in one M17 review round, abort the round and replan scope. The plan no longer claims dollar enforcement that the code cannot provide.
5. **Comparison table accuracy (medium R0-revision #4) + rule-16 best-effort guardrails (medium R0-revision #5 + R0-revision-2 honesty):** Footnotes corrected per Codex's verified URLs (R0-revision-3 confirmed footnote 1 against `cursor.com/docs/cli/installation` — Cursor CLI shell-installer only, no Homebrew/npm). Rule 16 gains three **best-effort operational guardrails** (NOT authorship proof): deterministic universal-rules import test (proves import present, not body authorship); M17 R1 review-packet persona-provenance attestation (process evidence, not automated proof); grep guard against LLM-drafted persona body leakage in `docs/research/CODEX_*` / `docs/research/CLAUDE_*` AND `docs/planning/CODEX_*` / `docs/planning/CLAUDE_*` artifacts (catches post-authorship drift, does not prevent original LLM authorship).

## Executive summary

`code-oz` shipped v0.20.0-alpha.0 with three install channels and 3362 offline tests. The public surface signals "alpha toy" (dense README, FakeProvider demo only, no AUDIT runtime, 1 star). Option D closes the public-surface gap and ships M17 AUDIT runtime as a real product capability, plus a viral-quality launch artifact (the W3a R2 self-hosted catch) without committing to SWE-bench's expensive multi-instance pilot.

Probability-weighted outcome (revised, 90-day window):
- **Base case: 200–500 stars**
- **Upside case: 600–1000 stars** (if Show HN breaks top-10 OR Twitter thread crosses a notable amplifier)
- **P(reach 1000): ~6–9%** — lower than Path B's claimed 10–15%, but Path B had only 20% probability of clean execution; Option D's probability-adjusted EV is higher.

## Phase 1 — Foundation (target: 6h, cost: <$5)

### Goal
Make `code-oz` instantly installable via all three channels with trust-signal infrastructure in place. Everything a first-time visitor checks in 30 seconds: badges, install commands, asciicast, discussions.

### Sub-steps + file specs

**1.1 npm publish — IMMEDIATE BLOCKER (Ozzy interactive, ~10min)**

Per Codex R0 missed-risks: npm name squatting is an immediate threat, not a normal Phase 1 task. Run this FIRST, before any other Phase 1 work:

```sh
npm adduser                              # Ozzy interactive
npm view code-oz versions --json         # confirm 404 still
npm publish --access public
npm view code-oz versions                # confirm 0.20.0-alpha.0 listed
```

Exit criteria: `npm install -g @tuel/code-oz` on a fresh machine resolves; first invocation downloads + SHA-verifies binary; execs successfully. Note: unscoped `code-oz` was rejected by npm's similarity guard against the existing `codecov` package on 2026-05-12; scoping under the TUEL AI publisher (`@tuel/code-oz`) bypasses the similarity check while keeping the binary name `code-oz`.

**1.2 Homebrew tap creation (Claude executes, ~30min)**

```sh
gh repo create omerakben/homebrew-code-oz \
  --public \
  --description "Homebrew tap for the code-oz CLI" \
  --homepage "https://github.com/omerakben/code-oz"

git clone git@github.com:omerakben/homebrew-code-oz.git ~/Projects/homebrew-code-oz
mkdir -p ~/Projects/homebrew-code-oz/Formula
```

Render formula from `docs/homebrew/code-oz.rb.template` using v0.20.0-alpha.0 `checksums.txt`. `brew audit --strict --online`. Commit + push.

Exit criteria: `brew tap omerakben/code-oz && brew install omerakben/code-oz/code-oz` succeeds on a clean macOS shell.

**1.3 README trust strip (Claude executes, ~30min)**

Badges added above the fold (between tagline and Status):

```markdown
[![Tests](https://github.com/omerakben/code-oz/actions/workflows/test.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)
[![Release](https://github.com/omerakben/code-oz/actions/workflows/release.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@tuel/code-oz.svg)](https://www.npmjs.com/package/@tuel/code-oz)
[![Homebrew](https://img.shields.io/badge/Homebrew-omerakben%2Fcode--oz-orange)](https://github.com/omerakben/homebrew-code-oz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/omerakben/code-oz/releases)
[![Tests passing](https://img.shields.io/badge/tests-3362%20passing-brightgreen)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)
```

Per Codex R0 missed-risk: add **explicit macOS unsigned-binary caveat** below the badges:

> macOS users: code-oz binaries are not yet Apple-Developer-signed (deferred to v0.x stable). Gatekeeper may prompt on first launch; the install script applies `xattr -d com.apple.quarantine` as a workaround.

**1.4 GitHub Discussions enable (Claude executes, ~5min)**

```sh
gh repo edit omerakben/code-oz --enable-discussions
```

Pin one Q&A thread: "What is code-oz, in 2 minutes?"

**1.5 Lightweight README polish (Claude executes, ~30min — was originally Phase 3.1 lite)**

Per Codex R0 sequencing recommendation: ship a Phase 1.6 README rewrite WITHOUT the demo GIF. Tagline, install commands, badges, one short "what it does," and a clearly labeled current demo. Keep comparison table, "real bug fix" claims, and full rewrite gated on M17 success.

Specifically:
- Move dense status block, milestone inventory, and influence-library table to `docs/ABOUT.md`
- Lead with: tagline, badges, install commands, one-paragraph "what it does," demo link
- Comparison table + receipts page deferred to Phase 3 (post-M17)

**1.6 Brownfield profile-detection prerequisite (Claude executes, ~2h — split out of M17 per R0-revision finding #3)**

Brownfield profile selection is a separate authority from AUDIT runtime execution. Per rule 20, it lands as a prerequisite bugfix in Phase 1, NOT as a step inside M17.

Current detector at `src/commands/init.ts:94-114` marks a repo brownfield only when `git ls-files` returns tracked files OR known marker files exist. A plain `.git/` directory with no tracked files does not trigger brownfield. The fresh-run path at `src/commands/run.ts:309-312` also hardcodes `profile: 'greenfield'`, so even a corrected detector would not flow through.

Fix sequence (one RED test + one minimal commit):
- Failing test: brownfield fixture (a `.git/`-bearing repo with one untracked source file) drives `code-oz init` to write `profile: brownfield` to config, AND `code-oz run` to call `initRun({ profile: 'brownfield', ... })` instead of literal `'greenfield'`.
- Implementation: tighten `src/commands/init.ts:94-114` heuristic; replace the literal `'greenfield'` at `src/commands/run.ts:311` with a read from the resolved config.
- Regression: existing greenfield e2e remains green; FakeProvider full-cycle test unchanged.

Exit criteria: brownfield fixture exits Phase 1.6 with `profile: 'brownfield'` propagated end-to-end. M17's consumer-first RED test (Phase 2.1 C1) then fails purely on AUDIT runtime gaps — not profile-selection bugs.

### Phase 1 exit criteria

- All three install commands work end-to-end on a clean machine
- README top renders cleanly mobile + desktop with 7 badges, install commands, macOS caveat, 1-paragraph what-it-does
- Discussions tab visible, pinned thread published
- `docs/ABOUT.md` carries the depth content; lean above-fold preserved
- Brownfield profile detection (1.6) lands as a separate commit before M17; brownfield fixture flows through `init → run` with `profile: 'brownfield'` end-to-end

### Risk register (Phase 1)

| Risk | Mitigation |
|---|---|
| npm name `code-oz` taken before publish | RUN 1.1 FIRST. Verified 404 as of 2026-05-12. **OUTCOME**: unscoped `code-oz` was rejected on first publish attempt — not by squatting but by npm's similarity guard against `codecov`. Mitigation locked: scope under `@tuel/code-oz` (TUEL AI publisher) — bypasses similarity check, keeps binary name `code-oz`. |
| `brew audit --strict --online` fails on first render | Pre-render locally + fix audit findings before push |
| macOS Gatekeeper bounces users on first run | Explicit caveat in README + install.sh xattr workaround; signing remains v0.x stable |

---

## Phase 2 — M17 AUDIT runtime as real milestone (target: 30–40h, cost: <$30)

### Goal
Ship M17 to v0.21 as a proper milestone matching M14/M15/M16 cadence. This is NOT a launch sprint — it's a production capability with Codex pre-design debate + R1 + R2 review rounds + no-tech-debt-at-close discipline.

The runtime work answers the "does code-oz work on real brownfield code" question by enabling the brownfield path that's been advertised in CLAUDE.md and ROADMAP but absent at runtime.

### Sub-steps

**2.0 M17 pre-design Codex debate (~3h)**

Write `docs/design/M17_BRIEFING.md` covering:
- AUDIT phase contract (input: brownfield repo + problem_statement; output: AUDIT.md with localization + reproduction + constraints)
- Where AUDIT differs from PLAN (no fix proposed; no files modified)
- Gate file shape (`GATE_AUDIT_PASSED.json`)
- Brownfield auto-detection (lives at `src/commands/init.ts:94-114` for detector heuristic + `src/commands/run.ts:309-316` for profile handoff; Phase 1.6 has already closed both surfaces before M17 begins, so the pre-design just inventories the post-fix state)
- Permissions: `tool_use.repo_context` (glob/grep/read) only; NO `execute` for first cut
- Scientist tail integration (`HYPOTHESES.md` ranked + falsifiable per rule 15)
- Universal-rules import mechanical (rule 16 compliant)

Codex pre-design round: read briefing, return accept/revise/debate. Iterate to "accept with modifications" before writing code (matches M16 pattern).

**2.1 M17 implementation with RED-first TDD (~24h)**

**Consumer-first ordering per rule 22 (revised per R0-revision finding #1 + R0-revision-2 anti-stub tightening).** The brownfield CLI e2e is the FIRST commit as a failing RED test. The failure progression is *staged*, not simultaneous: today (before Phase 1.6) the test fails at the greenfield hardcode at `src/commands/run.ts:309-316`; once Phase 1.6 lands, the test then fails at the missing `phase === 'audit'` dispatch branch between `src/commands/run.ts:942` and the active-run fallback at `src/commands/run.ts:1134`; only then do later commits expose missing phase module, persona, and artifact schema. Every downstream M17 commit advances exactly one consumer-test failure mode at a time:

| Commit | What | RED test (fails BEFORE the commit, green AFTER) | Hours |
|---|---|---|---|
| C1 | brownfield CLI e2e fixture + failing test (no implementation; pure test scaffolding) | full `audit → approve → PLAN` cycle against fixture; **MUST invoke `code-oz run` CLI path** (binary-spawn, not state-level construction) and assert `currentPhase === 'audit'` is reached AND that the run fails before fallback BECAUSE `dispatchAudit` is missing (not because of profile hardcode — Phase 1.6 fixes that first). Anti-stub acceptance: a test that manually writes `AUDIT.md` + calls `approve` via state-level primitives does NOT count as C1; that pattern exists at `tests/state-regression.test.ts:402-416` and bypasses the dispatch gap entirely. After C1 lands, downstream commits expose persona/schema/parser failures *in staged sequence* (C2 fixes dispatch → C3 exposes missing phase module → C4 exposes missing persona → C5 exposes missing artifact validation → C6 exposes gate routing → C7 turns test green). | 4 |
| C2 | `dispatchAudit` branch added to active-run dispatcher in `src/commands/run.ts` (between line 942 and the line-1134 fallback) | C1 advances past dispatch; now fails on missing phase module | 3 |
| C3 | `src/phases/audit.ts` skeleton + integration with `dispatchAudit` | C1 advances past phase entry; now fails on missing persona | 3 |
| C4 | `src/agents/defaults/auditor.md` (hand-authored persona) + bundled-defaults wiring + universal-rules import RED test | C1 advances past persona load; rule-16 deterministic import test passes; now fails on artifact validation | 3 |
| C5 | `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` | C1 advances past artifact validation; schema rejects malformed AUDIT.md; parser extracts likely-files + reproduction + constraints; now fails on gate approval | 5 |
| C6 | gate approval reuses generic `approveGate()` at `src/state/run.ts:466-518` (NO `approveAuditGate`); add audit-specific regression coverage only | C1 advances past gate approval into PLAN; rule 1 gate authority preserved; canonical phase `audit` from `src/state/schemas.ts:6` flows through existing primitive | 2 |
| C7 | brownfield CLI e2e turns green; add greenfield regression coverage to confirm no path divergence | C1 passes; existing greenfield e2e remains green | 3 |
| C8 | M17 closure synthesis + ROADMAP M17 entry + handoff doc | — | 1 |

Total: 24h across 8 commits. Former C7 (profile detection) moved to Phase 1.6. Former C4 (`approveAuditGate`) collapsed into C6 as regression coverage on the existing `approveGate()` primitive (rule 1 preserved — no new gate authority).

**Rule 20 boundary statement.** M17's single authority is "AUDIT runtime + dispatch + persona." Profile detection is Phase 1.6 (prerequisite). Gate writes reuse the existing primitive. Artifact schema + parser are implementation details of the AUDIT runtime, not separate authority axes.

**Critical rule-16 compliance — three best-effort operational guardrails (not authorship proof).** Step C4 hand-authors `auditor.md`. NO LLM generation of the persona body is the rule. The mechanisms below are **best-effort guardrails that catch the most likely drift modes** — they cannot cryptographically prove a human typed the file. Honest framing per R0-revision-2 closure #5:

- **(a) Deterministic universal-rules import test (automated).** `tests/agents-defaults.test.ts` asserts `auditor.md`'s body begins with a verbatim copy of `src/prompts/universal-rules.md` and that the persona cannot relax any rule. Mechanical text concatenation only; failure blocks the commit. **Caveat:** this proves the import is present, not that the role-specific body below it was hand-authored. Codex may review for rule violations but must not draft the persona.
- **(b) M17 R1 review-packet persona-provenance attestation (process, partly automated).** The R1 handoff (`docs/handoffs/2026-05-M17-R1-PACKET.md`) carries a one-line attestation listing which sections of `auditor.md` Ozzy authored, which Claude authored, and that no LLM draft was committed. Auditor reviewing R1 verifies this against the diff. **Caveat:** truth of the attestation depends on reviewer judgment + diff review, not automated proof.
- **(c) Grep-test guard against LLM-drafted persona leakage (automated).** A CI test (added in C4) forbids any committed file under `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, **`docs/planning/CODEX_*`, or `docs/planning/CLAUDE_*`** from containing the auditor persona's body (matched by the universal-rules import sentinel + a fixed persona-block hash recorded in C4). Catches generation-pass leakage *after* the fixed persona exists. **Caveat:** does not prevent the original `auditor.md` from being LLM-drafted; only catches subsequent leakage.

Together these guardrails make the most common rule-16 drift modes catchable in CI. The rule itself remains a policy commitment that Ozzy + Claude verify at authorship time.

**2.2 M17 Codex R1 review (~3h)**

Standard pattern: read-only review of the M17 commit series. Verdict: push / fix-first / debate. Address fix-first findings as follow-up commits (never amended) per the "no tech debt at milestone close" memory.

**2.3 M17 Codex R2 review (~2h)**

Workspace-write follow-up. Must verdict push before tag.

**2.4 Tag + release v0.21.0-alpha.0 (~1h)**

Same publish ops cycle as W3a: push main + tag + watch release.yml CI + verify assets + smoke install + push to Homebrew tap.

**2.5 Live brownfield smoke (no SWE-bench harness) (~2h)**

Pick one small real bug fixed in code-oz's own git history (or a tiny scoped issue from a small OSS repo if Ozzy prefers). Run code-oz against it with real providers (Claude BUILD + Codex REVIEW). Capture artifacts.

This is OPTIONAL — the W3a R2 launch artifact carries the brownfield story regardless. The live smoke is for our own confidence + a bonus receipt to link from docs.

### Phase 2 exit criteria

- M17 shipped as v0.21.0-alpha.0 with Codex R2 push verdict
- Brownfield CLI e2e green (offline FakeProvider, no live LLM required for tests)
- AUDIT.md schema + parser stable
- `src/commands/run.ts:dispatchAudit` registered, no fallthrough to "active run" error
- One optional live brownfield smoke captured

### Risk register (Phase 2)

| Risk | Mitigation |
|---|---|
| M17 scope creep into PLAN/BUILD changes | Pre-design debate locks contract; rule 20 enforced via "AUDIT runtime + dispatch + persona" boundary statement |
| Cross-family review for M17 picks up secondary refactors | Each fix-first finding gets follow-up commit (no amend) |
| Live brownfield smoke fails | OPTIONAL phase; W3a R2 carries the launch demo regardless |
| AUDIT persona regresses greenfield demo | C1 + C7 e2e fixtures assert both paths stay green |
| LLM spend exceeds budget | Codex via ChatGPT subscription auth = $0 incremental; Claude API M17 R1+R2 runs under `budgets.global.maxTokensEstimate` ≤ 600k tokens/round (enforced by `assertWithinBudget()` per rule 19); $30 advisory dollar target tracked externally via `priceTable` telemetry (NOT enforced — `src/providers/cost.ts:14-20`); abort and replan scope if token-budget warning fires twice in one round |
| Persona regenerated by LLM mid-development (rule 16 leak) | Best-effort guardrails (NOT authorship proof): (a) C4 deterministic universal-rules import test catches non-mechanical concat; (b) M17 R1 packet persona-provenance attestation; (c) CI grep test catches LLM-drafted persona body landing in `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, `docs/planning/CODEX_*`, or `docs/planning/CLAUDE_*` artifacts; rule itself is policy commitment verified at authorship time |

---

## Phase 3 — README rewrite + comparison (target: 18h, cost: $0)

### Goal
After M17 ships, rewrite README so a first-time visitor with prior Cursor/Claude Code/Aider experience understands what code-oz does, why it's different, and how to try it — all in 30 seconds above the fold. Address Codex R0's comparison-table accuracy findings.

### Sub-steps

**3.1 README structural rewrite (8h)**

Structure (top to bottom):
1. Tagline + 1-line answer + macOS caveat
2. Trust strip (Phase 1 badges)
3. 30-second demo GIF (from M17 brownfield smoke if captured, else from FakeProvider demo with clear labeling)
4. What it does in one paragraph (max 3 sentences)
5. Install (three commands)
6. Comparison table (Phase 3.2 — accuracy-hardened)
7. Real bug fix receipts (W3a R2 essay link + M17 brownfield smoke if captured)
8. How it works (collapsed `<details>` with rules + thesis)
9. Roadmap + status + license

**3.2 Comparison table — softened per Codex R0 (4h)**

Original 10-row table softened to avoid HN reputation damage:

```markdown
| Feature | Cursor | Claude Code | Aider | Continue | Devin | **code-oz** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Same SHA-pinned native release across npm/Homebrew/curl | partial¹ | partial² | partial⁸ | partial⁹ | ❌ | ✅ |
| Orchestrated cross-provider phase roles (different LLM per phase) | partial³ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-family adversarial REVIEW (different LLM family) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| File-based gates with sha256 binding | ❌ | ❌ | ❌ | ❌ | partial⁴ | ✅ |
| Worktree-per-run isolation | ❌ | ❌ | ❌ | ❌ | partial⁴ | ✅ |
| Full SDLC artifact trail (SPEC/PLAN/BUILD_REPORT/VERIFY/REVIEW) | ❌ | ❌ | partial⁵ | ❌ | partial⁴ | ✅ |
| Debate-policy scheduler on disagreement | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Run-level cost budget enforcement with kill-switch | partial⁶ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Runs on CLI auth (no API keys required) | ❌ | ✅ | ❌ | partial | ❌ | partial⁷ |
| Open source (MIT) | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |

¹ Cursor's CLI (`cursor-agent`) installs via a shell installer per the current Cursor docs (`cursor.com/docs/cli/installation`), but ships separately from the Cursor IDE; the row stays partial because Cursor's official install surface is a single channel today, not the same SHA-pinned native release across npm/Homebrew/curl.
² Claude Code ships Native Install, Homebrew, WinGet, and Linux package-manager installers per `code.claude.com/docs/en/quickstart`; each channel is its own installer, not a single SHA-pinned release asset shared across npm/Homebrew/curl.
³ Cursor supports multiple model providers (OpenAI, Claude, Gemini per `cursor.com/pricing`) but does not assign different providers to different SDLC phases as orchestrated phase roles.
⁴ Devin exposes sessions, PR links, Session Insights/timeline, and audit logs per `docs.devin.ai/get-started/first-run` + `docs.devin.ai/enterprise/api-reference/audit-logs`, but does not document file-based gate machinery or worktree-per-run isolation; "partial" reflects an opaque audit trail, not equivalent mechanics.
⁵ Aider captures commit messages + diff history per `aider.chat/docs/git.html`; not the full gated artifact set.
⁶ Cursor has token budgets at the chat level; not per-orchestration phase.
⁷ code-oz runs xAI on API key today; Claude/Codex CLI-auth via SDKs is the v0.x roadmap.
⁸ Aider distributes via shell installer + `uv` + `pipx` + `pip` per `aider.chat/docs/install.html` — Python packaging channels, not native binaries pinned across npm/Homebrew/curl by SHA.
⁹ Continue CLI installs via shell installer and npm per `docs.continue.dev/cli/quickstart`; the install row is partial because the same binary isn't released as a SHA-pinned asset across Homebrew + curl + npm together.
```

Every claim links to competitor's own docs (verified by Codex against current docs on 2026-05-12). No row claims ✅ for code-oz where the runtime doesn't actually deliver yet — the "Runs on CLI auth" row is HONEST partial because xAI uses an API key today and Claude/Codex CLI auth is the roadmap.

**Per Codex R0 + R0-revision explicit fixes applied:**
- Dropped "Multi-provider (Claude+Codex+Gemini)" — Gemini stub is not honestly defensible (`src/providers/gemini.ts:24-34` throws; no eligible phases in `src/providers/capabilities.ts:101-105`)
- Cursor multi-provider corrected to "orchestrated cross-provider phase roles" with partial-Cursor (Cursor CLI exists; phase-role orchestration does not)
- "Single binary install" replaced with "Same SHA-pinned native release" with calibrated partials per Codex's verified URLs (Cursor CLI exists but separately shipped; Claude Code has Homebrew/WinGet but each is its own channel; Aider is Python distribution; Continue ships shell + npm but not all three channels SHA-pinned)

**3.3 "Show me the receipts" linking page (3h)**

NEW FILE: `docs/RECEIPTS.md`

Links to:
- W3a R2 self-review story (Phase 5.1 essay + the original commits + Codex review trail)
- M17 brownfield smoke if captured
- Cross-family review excerpts from M14
- Debate-policy scheduler examples from M15
- `events.jsonl` ledgers from real runs

**3.4 ABOUT.md preservation (1h)**

Move the existing "AI software company" framing + product thesis + influence-library + 23-rule inventory to `docs/ABOUT.md` (already started in Phase 1.5). Link prominently from README "How it works" section.

**3.5 First-impressions test (2h)**

Send rewritten README to 3 trusted developer friends. Ask: "What does this tool do? Would you try it? What's missing?" Iterate.

### Phase 3 exit criteria

- Above-fold renders cleanly on github.com mobile + desktop
- 3 unprompted friend reactions parsed and incorporated
- Every competitor claim in comparison table verified against current docs (no overclaiming)
- `docs/RECEIPTS.md` linked from README + discoverable

---

## Phase 5 — Launch (target: 12h, cost: $0)

### Goal
Convert the W3a R2 self-hosted story into a multi-channel launch leveraging Ozzy's >1k audience plus cold-channel amplification.

### Sub-steps

**5.1 W3a R2 essay (8h)**

NEW FILE: `docs/blog/2026-05-ai-release-gate.md`

Structure (same as Path B plan; receipts already exist):
1. Hook: "I built an AI release gate. It just blocked my own release."
2. Setup: what code-oz does, why REVIEW phase uses a different LLM family
3. The bug: `release.yml` missing `bun install --frozen-lockfile`
4. The catch: Codex R2 review excerpt verbatim
5. The fix: one-line workflow diff + ordering test
6. Takeaway: cross-family review catches what single-model loops can't
7. Try it yourself: install commands + Phase 3 receipts page

Cross-post to dev.to with canonical URL header pointing back to `docs/blog/`.

**5.2 Show HN submission (1h)**

Title: "Show HN: code-oz – AI agents through a gated SDLC, with cross-family review"

Lead: W3a R2 essay. Brownfield M17 smoke as secondary link if captured. Discussion-ready for ~4 hours after submission.

Timing: Tuesday or Wednesday US-morning. Not Friday/weekend.

**5.3 Twitter/X thread (2h) — primary amplification surface**

Given Ozzy's >1k audience, this is the highest-leverage launch channel after Show HN.

10–14 tweet thread:
1. Hook: "I built an AI release gate. It blocked my own release this morning. [GIF]"
2. What code-oz is (1 tweet)
3. The bug (1 tweet)
4. The catch — Codex review excerpt screenshot (1 tweet)
5. The fix — one-line diff screenshot (1 tweet)
6. Mechanism — cross-family review (2 tweets)
7. M17 brownfield smoke if captured (2 tweets) or "v0.21 is the brownfield path" (1 tweet)
8. Install commands (1 tweet)
9. Closer: MIT, open source, runs on your CLI auth (1 tweet)

**5.4 Community submissions (1h)**

- lobste.rs (programming tag)
- r/programming (Show & Tell)
- r/coolgithubprojects
- dev.to + Hashnode (essay cross-post)
- 3–5 AI engineering newsletters (Ben's Bites, TLDR AI, The Batch)

### Phase 5 exit criteria

- Essay live at docs/blog/ + dev.to within 1 week of M17 + Phase 3 landing
- Show HN submitted on Tue/Wed morning
- Twitter thread fires same day as Show HN, after first HN feedback signal
- Community submissions in the 24h following

### Risk register (Phase 5)

| Risk | Mitigation |
|---|---|
| Show HN flops (<30 upvotes in first 4h) | Don't relaunch within 30 days; pivot to dev.to + targeted newsletter outreach |
| Audience mismatch — Ozzy's >1k may be wrong segment | Pre-launch segment test: post a small teaser to gauge engagement before Show HN day |
| dev.to flags AI-generated | Essay has clear personal voice, cites specific commits, has receipts |
| HN finds a real flaw | Pre-publish W3a R2 essay + comparison table for friend critique before Show HN |

---

## Cross-phase risk register (R0 missed-risks integrated)

| Risk | Trigger | Mitigation |
|---|---|---|
| npm name squatting | Anyone publishes `code-oz` before 1.1 | Phase 1.1 is IMMEDIATE blocker, runs before any other Phase 1 work |
| Audience mismatch (R0 missed-risk) | Pre-launch teaser engagement <20 | Pivot Phase 5 weight to cold channels (HN, lobste.rs, newsletters) |
| macOS Gatekeeper friction (R0 missed-risk) | User reports "macOS won't run binary" | Explicit caveat in README + install.sh xattr workaround; signing v0.x stable |
| SWE-bench harness compatibility (R0 missed-risk for v0.22 M18) | M18 local eval diverges from official Docker harness | Use official harness for publishable result in M18 |
| M17 cross-family review exceeds token budget | Multi-round REVIEW hits `budgets.global.maxTokensEstimate` warning twice in one round (advisory $30 dollar telemetry separately exceeded via `priceTable`) | Cap `--effort balanced`; abort the round and replan scope if `assertWithinBudget()` token warning fires twice; external dollar tracking is advisory only — no dollar kill switch in code |
| Comparison table sparks pushback | "Cursor's X feature is mismarked" | Every claim sourced + linkable; "partial" used generously |

## Success metrics (revised)

90-day window:
- **Primary:** GitHub stars (base 200–500, upside 600–1000)
- **Secondary:** v0.21 release with M17 AUDIT runtime shipped; npm weekly downloads; Homebrew installs; Show HN comment count + upvote ratio; Twitter impressions
- **Tertiary:** inbound contributor PRs; GitHub Discussions activity; mentions in newsletters

Failure thresholds (trigger re-evaluation):
- <50 stars at 30 days
- M17 doesn't ship by week 4
- Show HN <30 upvotes in first 4h
- 0 inbound PRs by day 60

## Timeline (revised, 6 weeks)

| Week | Phase | Hours | Key deliverable |
|---|---|---:|---|
| 1 | Phase 1.1–1.6 (foundation + brownfield profile prereq) + M17 pre-design + Codex debate | 12 | npm/Homebrew/badges live; profile-detection bug fixed; M17 briefing accepted |
| 2 | M17 implementation C1–C5 (consumer test + dispatch + phase + persona + schema/parser) | 18 | Brownfield CLI e2e drives consumer-first impl; audit runtime advancing test |
| 3 | M17 implementation C6–C8 (gate reuse + green + closure) + R1 review | 9 | Persona + e2e green + closure; Codex R1 |
| 4 | M17 R2 push + v0.21.0-alpha.0 tag + Phase 3 start | 10 | v0.21 shipped; README rewrite begun |
| 5 | Phase 3 finish + Phase 5.1 (essay) | 10 | README rewrite live; W3a R2 essay drafted |
| 6 | Phase 5.2–5.4 (Show HN + Twitter + community) | 6 | Launch |
| | **Total** | **65** | |

## Decision points

### Locked (Option D + R0-revision-3-cleanup)
1. ✅ M17 AUDIT runtime as real milestone shipped to v0.21
2. ✅ W3a R2 self-hosted story as launch demo (no SWE-bench dependency)
3. ✅ SWE-bench Verified deferred to v0.22 as M18 focused milestone
4. ✅ Comparison table claims softened per Codex R0
5. ✅ macOS unsigned-binary caveat explicit in README
6. ✅ npm publish runs as Phase 1.1 immediate blocker
7. ✅ Plan-first → Codex R0-revision → Ozzy approval → autonomous execute
8. ✅ Maestro discipline invoked
9. ✅ Phase 1.6 brownfield profile-detection prerequisite split out of M17 (rule 20 per R0-revision block-approve #3)
10. ✅ M17 commits reordered to consumer-first: C1 = failing brownfield CLI e2e (rule 22 per R0-revision block-approve #1)
11. ✅ Generic `approveGate()` reused for AUDIT; no standalone `approveAuditGate` authority (rule 1 per R0-revision block-approve #2)
12. ✅ Rule 16 guarded best-effort via deterministic universal-rules import test + R1-packet provenance attestation + CI grep-test against LLM-drafted persona body leakage in `docs/research/CODEX_*` / `docs/research/CLAUDE_*` / `docs/planning/CODEX_*` / `docs/planning/CLAUDE_*` artifacts (per R0-revision medium #5 + R0-revision-2 honesty + R0-revision-3 scope sync — rule itself remains a policy commitment, not automated authorship proof)
13. ✅ Comparison table footnotes ¹/²/⁸/⁹ corrected against current competitor docs as of 2026-05-12 (per R0-revision medium #4)
14. ✅ Cost ceiling honest split: Codex via ChatGPT subscription auth = $0 incremental; Claude API M17 R1+R2 enforced via `budgets.global.maxTokensEstimate` ≤ 600k tokens/round (token-based, NOT dollar-based); $30 dollar target is advisory telemetry per `priceTable`, tracked externally (per R0-revision-2 closure of cost realism)

### Pending mid-execution
| Decision | When | Default if not chosen |
|---|---|---|
| Optional Phase 2.5 live brownfield smoke target | After M17 R2 push | Tiny scoped issue from code-oz's own git history |
| Comparison-table competitor list final | Phase 3.2 | Cursor, Claude Code, Aider, Continue, Devin |
| Show HN exact date | After Phase 3 + 5.1 land | First Tue/Wed in launch window |
| Twitter launch timing (same day vs 24h later) | After Show HN first-hour signal | Same day, 6h after HN |
| Pre-launch audience segment test method | Phase 5 prep | Single small teaser tweet 7d before Show HN |

## Codex R0-revision-3 request (this doc)

R0-revision-3 review at `docs/planning/CODEX_RESPONSE_1000_STAR_R0_REVISION_3.md` (thread `019e1d68`) confirmed the substantive plan is approval-worthy — C1 anti-stub closed, Cursor footnote 1 closed, rule-16 framing closed, cost framing closed in primary sections. The verdict was `revise-again-3` only because stale R0-revision-2-era text remained in (a) this appendix, (b) the cross-phase risk register row, and (c) two rule-16 summary rows. This R0-revision-3-cleanup pass removes those contradictions.

**Closures in R0-revision-3-cleanup (this revision):**

1. **Stale appendix replaced:** the previous bottom-of-doc request block is replaced with this cleanup-pass summary. Old verdict-ask wording, old C1 failure-shape wording, and old dollar-overrun wording have all been removed from the active appendix; this item describes the replacement neutrally. Verify: does the appendix now match the rest of the plan?

2. **Rule-16 grep scope sync:** the Phase 2 risk row and the closure section item #5 now both include `docs/planning/CODEX_*` / `docs/planning/CLAUDE_*` in the grep guard scope, and frame the mechanism as best-effort leakage detection (not authorship proof). Verify: is the language consistent across all three locations (§2.1 mechanism (c), Phase 2 risk row, and Locked decision #12)?

3. **Cross-phase risk row reframed:** the cross-phase risk register row at "M17 cross-family review exceeds token budget" is reframed away from old dollar-overrun wording toward token-cap overrun with the actual enforcement path (`assertWithinBudget()` enforces tokens; dollars are advisory telemetry). Verify: is the row consistent with frontmatter, Phase 2 risk row, and Locked decision #14?

4. **Document identity:** frontmatter status now says `REVISED-3`; closure section header now says R0-revision-3 closures; this appendix is now the R0-revision-3 request appendix. Verify: does the doc consistently identify itself as R0-revision-3 (plus this cleanup pass)?

**Substantive closures already verified in R0-revision-3 (no changes needed — confirm still closed):**

- Closure 1 (C1 anti-stub): confirmed closed in Phase 2.1 implementation table by R0-revision-3
- Closure 2 (gate authority reuse): confirmed closed by R0-revision-2
- Closure 3 (rule 20 boundary): confirmed closed by R0-revision-2 and re-verified by R0-revision-3
- Closure 4 (footnote 1): confirmed closed by R0-revision-3 against current Cursor docs
- Closure 5 (rule 16 framing): confirmed closed in §2.1 by R0-revision-3 (this cleanup syncs the summary rows)
- Cost cap honesty: confirmed closed in frontmatter + Phase 2 risk row + Locked decision #14 by R0-revision-3 (this cleanup syncs the cross-phase risk row)
- Editorial drift (Phase 1.6, init.ts pointer, 65h): confirmed closed by R0-revision-3

Codex, return verdict `approve` or `revise-again-cleanup`. If `revise-again-cleanup`, list specifically which doc-level contradiction is still present.
