---
session: 1000-star plan R0-revision-3 review
thread: R0-revision-3-current-thread-id-not-provided
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: revise-again-3
plan-under-review: docs/planning/1000_STAR_PLAN.md
prior-verdicts: R0, R0-revision, R0-revision-2
---

# Codex R0-revision-3 response - 1000-star plan

## Verdict line

Verdict: revise-again-3. The main R0-revision-3 repairs are directionally correct, and C1 / Cursor footnote / core rule-16 / core budget wording are mostly fixed. Approval is still blocked because stale R0-revision-2 text remains in the plan and reintroduces the old dollar-hard-cap and C1 simultaneous-failure claims. A few risk/request rows also still carry the old narrower rule-16 grep scope.

## Closure-by-closure verification

### Closure 1 - C1 anti-stub acceptance

Status: closed in the normative Phase 2.1 implementation section, but stale appendix text must be cleaned.

The C1 row now locks the test to the real CLI path: binary-spawn `code-oz run`, not state-level construction; assertion that `currentPhase === 'audit'` is reached; and failure before fallback because `dispatchAudit` is missing. It also explicitly rejects the weaker pattern already present at `tests/state-regression.test.ts:402-416`, where the test manually initializes brownfield state, writes `AUDIT.md`, emits `gate_required`, and calls approve without exercising the active-run dispatcher.

The staged-failure paragraph before the table is also correct: before Phase 1.6 the first failure is the fresh-run `profile: 'greenfield'` hardcode at `src/commands/run.ts:309-316`; after Phase 1.6, C1 should fail on missing `audit` dispatch at `src/commands/run.ts:942-1140`; later commits expose missing phase module, persona, and schema/parser.

However, the bottom review-request appendix still says C1 "MUST fail today" on missing dispatch and absent module/persona/schema together at `docs/planning/1000_STAR_PLAN.md:459`. That is the old overclaim. The execution spec is fixed; the document still needs cleanup so future reviewers do not copy the wrong failure shape.

### Closure 4 - Cursor footnote 1

Status: closed.

Footnote 1 now cites only Cursor's shell installer for `cursor-agent` and removes the Homebrew/npm claim. Current official Cursor CLI installation docs show a single shell install command (`curl https://cursor.com/install -fsS | bash`), verification with `cursor-agent --version`, PATH setup, and `cursor-agent update` / `upgrade`; I found no official Homebrew or npm install channel on that page. The revised footnote is accurate enough.

Source checked: https://cursor.com/docs/cli/installation

### Closure 5 - Rule 16 enforcement framing

Status: partial due document inconsistency.

The main section 2.1 rule-16 section is now honest. It explicitly says the mechanisms are "best-effort operational guardrails (not authorship proof)," names the caveat for each mechanism, and scopes the grep guard to both `docs/research/CODEX_*` / `docs/research/CLAUDE_*` and `docs/planning/CODEX_*` / `docs/planning/CLAUDE_*`.

That closes the conceptual problem: the plan no longer pretends CI can prove human authorship of `auditor.md`.

The doc still has stale narrower wording in two places. The Phase 2 risk row at `docs/planning/1000_STAR_PLAN.md:231` mentions only `docs/research/CODEX_*` and `docs/research/CLAUDE_*`. The bottom request item at `docs/planning/1000_STAR_PLAN.md:467` also mentions only research artifacts. Those rows should be synced with section 2.1 and should avoid saying "enforced" where the intended claim is "guarded best-effort."

### Cost cap realism

Status: partial/open at document level.

The core budget framing is now technically accurate in the important sections. Frontmatter says `<=$50 LLM spend advisory ceiling`, with Claude dollar spend tracked externally and hard enforcement limited to `budgets.global.maxTokensEstimate`. The Phase 2 risk row says Claude API review runs under `budgets.global.maxTokensEstimate` <=600k tokens/round, enforced by `assertWithinBudget()`, while the `$30` target is advisory telemetry via `priceTable`. Locked decision #14 repeats the same split.

That matches the code. `src/providers/cost.ts:14-20` says USD helpers are advisory and "never enforce, never refuse." `assertWithinBudget()` at `src/providers/cost.ts:213-318` enforces token, call, turn, and wall-time caps. `src/config/schema.ts:315-342` supplies the default 2M token cap and Claude `priceTable` telemetry, not a dollar kill switch.

The problem is stale contradictory text later in the same plan. The cross-phase risk row at `docs/planning/1000_STAR_PLAN.md:398` still says "Multi-round REVIEW exceeds $30" and mitigates by aborting on a budget warning, which conflates dollar spend with token warnings. Worse, the bottom request block at `docs/planning/1000_STAR_PLAN.md:469` still says the budget moved to a "`<=$50 hard cap`" and "Claude API <= `$30 hard cap`." That is the exact overclaim R0-revision-2 left open.

Until those rows are updated, the cost closure is not fully closed.

### Editorial drift findings from R0-revision-2

Status: closed.

The Phase 1.7 drift is fixed: the closure list now says Phase 1.6 at `docs/planning/1000_STAR_PLAN.md:31`, matching the actual prerequisite section.

The brownfield auto-detection pointer is fixed: section 2.0 points to `src/commands/init.ts:94-114` for detection and `src/commands/run.ts:309-316` for profile handoff at `docs/planning/1000_STAR_PLAN.md:162`, not `bundled-defaults.ts`.

The frontmatter and timeline are synchronized: frontmatter says 65h at `docs/planning/1000_STAR_PLAN.md:14`, and the timeline totals 65h at `docs/planning/1000_STAR_PLAN.md:424`.

## New findings introduced by R0-revision-3

1. Block-approve: the bottom "Codex R0-revision-2 request" appendix is stale and contradicts the fixed plan. It still asks for `revise-again-2`, still describes the old simultaneous C1 failure shape, and still claims `$50` / `$30` hard caps at `docs/planning/1000_STAR_PLAN.md:453-473`.

2. Medium: rule-16 grep scope is fixed in the main section 2.1 mechanism but stale in summary/risk/request rows. `docs/planning/1000_STAR_PLAN.md:231` and `docs/planning/1000_STAR_PLAN.md:467` should include `docs/planning/CODEX_*` and `docs/planning/CLAUDE_*`, and should frame the mechanism as best-effort leakage detection, not authorship proof.

3. Low: document identity still says R0-revision-2 in several places even though this is R0-revision-3. Frontmatter status says `REVISED-2` and pending R0-revision-2 verdict at `docs/planning/1000_STAR_PLAN.md:3`; the closure intro says "This R0-revision-2 closes all five" at `docs/planning/1000_STAR_PLAN.md:28`; the bottom section header repeats R0-revision-2 at `docs/planning/1000_STAR_PLAN.md:453`.

## Top-3 remaining concerns

1. Remove or rewrite the stale bottom appendix. It should reflect R0-revision-3, not preserve the old prompts that caused R0-revision-2's partial/open findings.

2. Sync budget language everywhere: token caps are enforced; `$30` / `$50` are advisory targets only. No row should call them hard caps.

3. Sync rule-16 guard language everywhere: best-effort guardrails, planning + research artifacts, no authorship-proof claim.

## Revised probability

R0-revision-2 estimate: P(1000 stars at 90d) = 7-10%.

R0-revision-3 estimate: 8-11%. The substantive plan is better than R0-revision-2: C1 is now a real CLI e2e, Cursor footnote 1 is accurate, and the main cost/rule-16 sections are honest. I am not moving to 8-12% yet because the plan still contains stale contradictory text that could mislead execution or the next review pass. Once those doc-level contradictions are removed without expanding M17 scope, 8-12% is reasonable.
