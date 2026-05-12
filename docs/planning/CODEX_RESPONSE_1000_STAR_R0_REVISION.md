---
session: 1000-star plan R0-revision review
thread: 019e1d48-2737-71e1-9b42-6b0538c98ce5
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: revise-again
plan-under-review: docs/planning/1000_STAR_PLAN.md
prior-verdict: docs/planning/CODEX_RESPONSE_1000_STAR_R0.md
---

# Codex R0-revision response - 1000-star plan

## Verdict line

Verdict: revise-again. The revision is materially better than R0, but not approvable because several claimed closures are only partial. The hard blocker is still AUDIT runtime reachability: C5 is the right fix area, but current `run.ts` hardcodes fresh runs to `greenfield` at `src/commands/run.ts:309-312` and still has no active-run `phase === 'audit'` dispatch branch between `src/commands/run.ts:942` and the fallback error at `src/commands/run.ts:1134`.

## Closure-by-closure verification

| # | Claimed closure | Status | Verification |
|---:|---|---|---|
| 1 | Rule 22 consumer-first and RED-first ordering | partial | The revision adds RED-first language and C1-C8 tests at `docs/planning/1000_STAR_PLAN.md:145-159`, but the full consumer that R0 asked for, brownfield CLI `AUDIT -> approve audit -> PLAN`, is not first. C1-C4 still define phase module, schema, parser, and gate shape before dispatch and the full CLI cycle. R0 explicitly asked for the failing brownfield CLI/runtime test first at `docs/planning/CODEX_RESPONSE_1000_STAR_R0.md:35-40`. Current runtime also starts new runs as `greenfield` at `src/commands/run.ts:309-312`, so a consumer-first test must fail on that before schema/parser work lands. |
| 2 | Rule 20 one-authority-per-milestone | partial | The revision correctly removes SWE-bench from M17 and defers it to M18 at `docs/planning/1000_STAR_PLAN.md:14-15` and `docs/planning/1000_STAR_PLAN.md:123-129`. It still subtly bundles multiple axes in C1-C9: AUDIT phase runtime, AUDIT schema/parser, an audit-specific gate primitive, bundled persona registration, brownfield profile detection, release ops, and optional live smoke at `docs/planning/1000_STAR_PLAN.md:151-179`. C4 is especially suspect because generic `approveGate()` already accepts any canonical phase at `src/state/run.ts:466-518`; adding `approveAuditGate` risks creating a new gate-authority surface instead of reusing rule 1 gate machinery. C7 is also a distinct profile-selection authority, not just AUDIT runner plumbing. |
| 3 | Rule 16 no LLM-generated personas | partial | The revision states the right rule: C6 hand-authors `auditor.md`, with mechanical universal-rules import, at `docs/planning/1000_STAR_PLAN.md:156-161`. That is compliant with `CLAUDE.md:42-44` as prose. It is not operationally checkable yet. Current bundled defaults import only BA, lead, builder, verifier, reviewer, and scientist at `src/agents/bundled-defaults.ts:1-21`, and tests assert AUDIT has no default persona at `tests/agents-defaults.test.ts:51-56`. C6 needs a concrete acceptance check: reviewer verifies no LLM-drafted persona body appears in briefing/response artifacts, the diff adding `auditor.md` is human-authored or deterministic-template output, and a test verifies the universal-rules import is present and cannot be relaxed. |
| 4 | Cost realism | partial | Removing SWE-bench makes `<$50` defensible in principle. The plan now scopes Phase 2 spend to M17 cross-family review at `docs/planning/1000_STAR_PLAN.md:14` and `docs/planning/1000_STAR_PLAN.md:123`, with a budget-burn mitigation at `docs/planning/1000_STAR_PLAN.md:361`. But it is not fully closed because there is no hard dollar cap or max live-review token budget. The runtime has token/provider-call caps and a Claude price table at `src/config/schema.ts:315-336`, while Codex is treated as subscription/CLI rather than API spend at `src/config/schema.ts:329-331`. If R1/R2 reviews and the optional live smoke stay outside API billing, `<$50` is plausible. If extra live review rounds use paid API calls, it is not proven. |
| 5 | Timeline realism | closed | The revised Phase 2 estimate of 30-40h at `docs/planning/1000_STAR_PLAN.md:123` is credible after SWE-bench is removed. The implementation table is 24h at `docs/planning/1000_STAR_PLAN.md:149-159`; adding pre-design, R1, R2, release, and optional smoke gives about 35h at `docs/planning/1000_STAR_PLAN.md:132-179`. This matches the narrowed M17 scope better than the original 32h plan R0 rejected at `docs/planning/CODEX_RESPONSE_1000_STAR_R0.md:80-88`. |
| 6 | Comparison table fixes | partial | The three explicit R0 fixes are mostly applied: Gemini is removed at `docs/planning/1000_STAR_PLAN.md:249-250`, Cursor is softened to provider support without phase-role orchestration at `docs/planning/1000_STAR_PLAN.md:228` and `docs/planning/1000_STAR_PLAN.md:240`, and "single binary" becomes SHA-pinned native release wording at `docs/planning/1000_STAR_PLAN.md:227` and `docs/planning/1000_STAR_PLAN.md:252`. Local source verifies Gemini is still a stub that throws at `src/providers/gemini.ts:24-34` and has no eligible phases at `src/providers/capabilities.ts:101-105`. However, the new footnotes at `docs/planning/1000_STAR_PLAN.md:238-247` are not accurate enough. Claude Code official docs now list Homebrew casks, so "no Homebrew tap" is misleading. Cursor official docs now include Cursor CLI installation with `cursor-agent`, so "desktop app installer" is incomplete. Aider official install docs use shell installer, uv, pipx, or pip, not a same-SHA native release across npm/Homebrew/curl. |
| 7 | Brownfield should-fail story | closed | The plan no longer depends on a SWE-bench instance for launch proof. It locks W3a R2 as the self-hosted launch artifact at `docs/planning/1000_STAR_PLAN.md:8-10`, makes live brownfield smoke optional at `docs/planning/1000_STAR_PLAN.md:175-179`, and structures the essay around the release-gate catch at `docs/planning/1000_STAR_PLAN.md:289-300`. This closes R0's concern at `docs/planning/CODEX_RESPONSE_1000_STAR_R0.md:111-122`, provided the README avoids "third-party verified real bug fix" language until M18. |
| 8 | R0 missed risks | closed | The R0 missed risks are integrated: npm squatting, audience mismatch, macOS Gatekeeper, and SWE-bench harness compatibility appear in the cross-phase register at `docs/planning/1000_STAR_PLAN.md:353-363`. Phase 1 also makes npm publish an immediate blocker at `docs/planning/1000_STAR_PLAN.md:42-53` and adds the macOS unsigned-binary caveat at `docs/planning/1000_STAR_PLAN.md:85-87`. |
| 9 | Sequencing | closed | The revision moves lightweight README polish before the demo GIF at `docs/planning/1000_STAR_PLAN.md:97-104`, and keeps the full comparison/receipts rewrite gated after M17 at `docs/planning/1000_STAR_PLAN.md:200-220`. This closes the R0 sequencing ask at `docs/planning/CODEX_RESPONSE_1000_STAR_R0.md:145-150`. |

## New findings introduced by revision

1. block-approve: C5 does not close the R0 dispatch hard-miss by itself.

Current `run.ts` has no `audit` dispatch branch in the active-run dispatcher. It handles `plan`, `build`, `verify`, and `review`, then falls through to the active-run error at `src/commands/run.ts:942-1134`. More importantly, fresh `code-oz run` initializes every run with `profile: 'greenfield'` at `src/commands/run.ts:309-312`, so even a new `dispatchAudit()` branch would not make brownfield runs reachable from the normal CLI path. C5 and C7 need to be tested as one consumer path: repo/config is brownfield, fresh run emits `phase_entered(audit)`, `dispatchAudit` writes `AUDIT.md`, `approve audit` advances to PLAN.

2. block-approve: C4 should not introduce `approveAuditGate` unless a real audit-specific invariant exists.

Rule 1 says gate writes stay in the orchestrator-owned gate machinery at `CLAUDE.md:25-27`. Generic `approveGate()` already validates canonical phases and computes the next phase from profile at `src/state/run.ts:466-518`; current schema already includes `audit` and `AUDIT.md` at `src/state/schemas.ts:6` and `src/state/schemas.ts:33-40`. An audit-specific gate writer would be another gate authority unless it is only a thin alias with no new behavior. The plan should change C4 to "reuse `approveGate` for AUDIT and add audit-specific regression coverage" unless it can name a distinct invariant.

3. block-approve: Rule 20 still needs a sharper M17 boundary statement.

The clean M17 authority can be "AUDIT runtime authority" only if C1-C8 are implementation parts of that single capability. Profile detection completion is separate enough to call out. The current detector in `src/commands/init.ts:94-114` marks a repo brownfield only if `git ls-files` returns tracked files or marker files exist; a plain `.git/` directory is not enough. The revision's C7 promise at `docs/planning/1000_STAR_PLAN.md:157` therefore changes project profile selection behavior, not just AUDIT phase execution. Either make C7 an explicit prerequisite bugfix outside M17, or state why profile selection is inside the AUDIT authority boundary.

4. medium: The comparison table still has public-claim risk.

Official docs checked on 2026-05-12:
- Cursor pricing/docs advertise OpenAI, Claude, and Gemini model usage, and Cursor CLI docs describe installing `cursor-agent`; the footnote should not reduce Cursor to a desktop app installer. Sources: `https://cursor.com/pricing`, `https://docs.cursor.com/en/cli/installation`.
- Claude Code quickstart lists Native Install, Homebrew, WinGet, and Linux package-manager options; the footnote should not imply no Homebrew channel. Source: `https://code.claude.com/docs/en/quickstart`.
- Aider install docs recommend shell installer, uv, pipx, or pip, and Aider git docs show commit/diff history. That supports "partial artifact trail", not the same-SHA native-release row as a clean checkmark. Sources: `https://aider.chat/docs/install.html`, `https://aider.chat/docs/git.html`.
- Continue CLI docs show a shell installer, npm path, Continue login, API-key modes, and many model providers. Its "Runs on CLI auth" row being partial is fair. Sources: `https://docs.continue.dev/cli/quickstart`, `https://docs.continue.dev/customize/models`.
- Devin docs expose sessions, PR links, Session Insights/timeline, audit logs, and hosted VM snapshots, but do not document file-based gates or worktree-per-run isolation. "partial" is safer than trying to describe hidden mechanics. Sources: `https://docs.devin.ai/get-started/first-run`, `https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session`, `https://docs.devin.ai/enterprise/api-reference/audit-logs`.

5. medium: The hand-author requirement is process-valid but not self-verifying.

No test can prove a human typed `auditor.md`. The operationally checkable version is narrower: require a deterministic universal-rules import test, require the M17 review packet to include a "persona provenance" note, and forbid any committed `CODEX_*` or `CLAUDE_*` artifact from containing a generated draft of `auditor.md`. That would make violations reviewable even if authorship cannot be cryptographically proven.

## Top-3 remaining concerns

1. Runtime reachability and test order: make the first failing test the full brownfield CLI path, not schema/parser internals. It must fail today on `src/commands/run.ts:309-312` and `src/commands/run.ts:942-1134`.

2. Rule 20 scope creep: remove or narrow `approveAuditGate`, and decide whether `.git/` brownfield profile selection belongs inside M17 or a prerequisite fix.

3. Public README claim accuracy: fix the comparison table footnotes before launch. The new table is better than R0, but Claude Code, Cursor CLI, and Aider install claims would still get corrected publicly.

## Revised probability

R0 estimate: P(1000 stars at 90d) = 6-10%.

Revised estimate: 7-10%.

Why only a small lift: Option D improves execution odds by removing SWE-bench from launch-critical scope and using the real W3a R2 artifact. It also lowers proof strength because the launch no longer has third-party SWE-bench validation. If the runtime reachability, rule-20 boundary, and comparison-footnote issues are fixed before execution, I would move this to 8-12%. As written, it is not ready for approval.
