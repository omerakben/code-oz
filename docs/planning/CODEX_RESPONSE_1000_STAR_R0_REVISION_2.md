---
session: 1000-star plan R0-revision-2 review
thread: 019e1d48-2737-71e1-9b42-6b0538c98ce5
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: revise-again-2
plan-under-review: docs/planning/1000_STAR_PLAN.md
prior-verdicts: docs/planning/CODEX_RESPONSE_1000_STAR_R0.md, docs/planning/CODEX_RESPONSE_1000_STAR_R0_REVISION.md
---

# Codex R0-revision-2 response - 1000-star plan

## Verdict line

Verdict: revise-again-2. R0-revision-2 closes the gate-authority issue and mostly closes the rule-20 split, but it still overclaims three things: C1's exact RED failure shape, footnote 1's Cursor install-channel claim, and rule-16/cost enforcement. This is close, but not approvable yet.

## Closure-by-closure verification

### Closure 1 - consumer-first runtime reachability

Status: partial.

The runtime gaps still exist exactly where the revision says they do. Fresh runs still call `initRun({ profile: 'greenfield', ... })` at `src/commands/run.ts:309-316`, and the active-run dispatcher handles `plan`, `build`, `verify`, and `review` before falling through to the generic active-run error at `src/commands/run.ts:942-1140`. There is no `audit` branch. Bundled default persona wiring also has no auditor entry at `src/agents/bundled-defaults.ts:1-21`.

The revised C1 is the right direction: Phase 2.1 says the first implementation commit is a full brownfield CLI e2e for `audit -> approve -> PLAN`, with C2 adding dispatch first and later commits adding phase module, persona, schema/parser, and gate coverage at `docs/planning/1000_STAR_PLAN.md:171-184`.

The remaining problem is test-shape ambiguity. C1 can only exercise the dispatch gap if the test actually invokes the CLI `run` path after Phase 1.6, then observes that `audit` cannot dispatch. A weaker state-level test could initialize `profile: 'brownfield'`, manually write `AUDIT.md`, and call approve without ever touching the missing dispatch branch. The repo already has that weaker pattern: `tests/state-regression.test.ts:402-416` initializes brownfield, writes `AUDIT.md`, emits `gate_required`, and approves `audit`; it fails at missing persona, not missing dispatch. The plan should explicitly forbid that weaker substitute for C1.

The plan also overstates the RED evidence by saying C1 "MUST fail today" on missing dispatch and missing module/persona/schema together at `docs/planning/1000_STAR_PLAN.md:457`. Today, before Phase 1.6, the first failure is the greenfield hardcode at `src/commands/run.ts:309-316`; after Phase 1.6, the first M17 failure should be dispatch fallthrough at `src/commands/run.ts:942-1140`; only later commits can expose persona/schema failures. That sequence is fine, but the wording needs to say staged failure, not simultaneous proof.

Downstream commits are mostly minimum-to-green. C2 dispatch, C3 phase module, C4 persona wiring, C5 schema/parser, C6 gate reuse, and C7 green/regression coverage are reasonable at `docs/planning/1000_STAR_PLAN.md:175-181`. C5 is the widest step because it lands both schema and parser, but that is still inside AUDIT artifact validation. The required next change is narrow: specify that C1 must be a real CLI e2e using `code-oz run`, with assertions that it reaches `currentPhase: 'audit'` and fails before fallback only because `dispatchAudit` is missing.

### Closure 2 - gate authority reuse

Status: closed.

`approveGate()` is already generic over canonical phases. It rejects non-canonical phases through `isPhase()` at `src/state/run.ts:466-476`, writes via `writeGate()` and `completeTransitionForPhase()` at `src/state/run.ts:482-500`, and derives the next phase with `nextPhase(opts.gate.phase, opts.profile)` at `src/state/run.ts:515-518`.

`audit` is canonical today. It appears in `PHASES` at `src/state/schemas.ts:6`, starts the brownfield sequence at `src/state/schemas.ts:21-28`, and maps to `AUDIT.md` at `src/state/schemas.ts:33-40`. The CLI approve path already routes non-review approvals through generic `approveGate()` at `src/commands/approve.ts:314-319`.

R0-revision-2 removes the standalone `approveAuditGate` idea and says C6 reuses `approveGate()` with audit-specific regression coverage only at `docs/planning/1000_STAR_PLAN.md:180` and `docs/planning/1000_STAR_PLAN.md:184`. That is narrow enough if the regression asserts the existing primitive advances `audit -> plan` for `profile: 'brownfield'` and does not add a new wrapper with behavior.

### Closure 3 - rule 20 boundary

Status: closed with editorial cleanup needed.

The split is clean enough. Phase 1.6 is now a prerequisite bugfix that fixes both profile selection surfaces: the detector heuristic at `src/commands/init.ts:94-114` and the fresh-run profile hardcode at `src/commands/run.ts:309-316`. The plan describes that fix and its exit criteria at `docs/planning/1000_STAR_PLAN.md:116-127`, before M17 begins. That lets M17 C1 fail on AUDIT runtime gaps instead of profile-selection bugs.

This is consistent with rule 20's one-authority constraint at `CLAUDE.md:48`: M17's authority is AUDIT runtime, while profile detection lands first as a prerequisite. The M17 boundary statement at `docs/planning/1000_STAR_PLAN.md:186` is operationally enforceable because it explicitly excludes profile detection and new gate authority.

Two cleanup notes remain, but neither is a blocker by itself. The closure summary says "Phase 1.7" at `docs/planning/1000_STAR_PLAN.md:31`, while the actual section is Phase 1.6 at `docs/planning/1000_STAR_PLAN.md:116`. Also, the pre-design bullet says brownfield auto-detection is "already partial in bundled-defaults.ts" at `docs/planning/1000_STAR_PLAN.md:162`, but `src/agents/bundled-defaults.ts:1-21` is persona wiring, not detection. Detection lives in `src/commands/init.ts` and `src/commands/run.ts`.

### Closure 4 - footnote accuracy

Status: partial.

Footnote 1 still overclaims. The plan says Cursor CLI installs via shell installer, Homebrew, and npm "per `docs.cursor.com/en/cli/installation`" at `docs/planning/1000_STAR_PLAN.md:271`. The current Cursor CLI installation page redirects to `https://cursor.com/docs/cli/installation` and documents shell install plus verification/update commands; I did not find official Homebrew or npm install channels on that page. The row can stay `partial`, but the footnote should say the official Cursor CLI install doc shows the shell installer, with any Homebrew/npm claim removed unless another official source is cited.

Footnote 2 is defensible. Claude Code's quickstart lists Native Install, Homebrew, WinGet, and Linux package-manager options, matching the plan's "not a single SHA-pinned release asset shared across npm/Homebrew/curl" claim at `docs/planning/1000_STAR_PLAN.md:272`. Source checked: `https://code.claude.com/docs/en/quickstart`.

Footnote 8 is defensible. Aider's install docs list `aider-install`, shell installer, `uv`, `pipx`, and `pip`, which supports "Python packaging channels, not native binaries pinned across npm/Homebrew/curl" at `docs/planning/1000_STAR_PLAN.md:278`. Source checked: `https://aider.chat/docs/install.html`.

Footnote 9 is defensible. Continue CLI quickstart documents shell installer and npm install surfaces, and the row stays only `partial` at `docs/planning/1000_STAR_PLAN.md:260` and `docs/planning/1000_STAR_PLAN.md:279`. Source checked: `https://docs.continue.dev/cli/quickstart`.

### Closure 5 - rule 16 operational enforcement

Status: partial.

The three mechanisms are mostly automatable, but they do not fully enforce the rule-16 authorship boundary claimed at `docs/planning/1000_STAR_PLAN.md:188-192`. Rule 16 forbids LLM-generated persona prompts, not just missing universal-rule imports, at `CLAUDE.md:42-44`.

Mechanism (a) is automatable but insufficient. `tests/agents-defaults.test.ts` already reads every default persona file and validates the registry at `tests/agents-defaults.test.ts:9-38`, so adding an auditor import test there is straightforward. It can prove `auditor.md` begins with the universal rules and is bundled through `src/agents/bundled-defaults.ts:1-21`. It cannot prove the role-specific body below the import was not LLM-drafted. An LLM could generate both the import and the body.

Mechanism (b) is partly automatable as a required line in `docs/handoffs/2026-05-M17-R1-PACKET.md`, but the truth of "Ozzy authored this, no LLM draft was committed" still depends on reviewer judgment and diff review. That is useful process evidence, not automated enforcement.

Mechanism (c) is automatable because CI already runs typecheck and `bun test` at `.github/workflows/test.yml:36-40`. A grep/hash test can block committed leakage of a fixed auditor body. But the plan scopes it only to `docs/research/CODEX_*` and `docs/research/CLAUDE_*` at `docs/planning/1000_STAR_PLAN.md:192`; this review chain itself lives under `docs/planning/CODEX_RESPONSE_*.md`, so the guard should include `docs/planning/` too. More importantly, it catches leakage after the fixed persona exists; it still does not prove original authorship of `src/agents/defaults/auditor.md`.

The next revision should reframe this as "best-effort operational guardrails" rather than proof. Required checks: deterministic import test, fixed persona-block hash, grep over both `docs/research/` and `docs/planning/`, and a required R1 packet attestation. Do not claim a test can prevent LLM-authored body text.

## Cost hard cap verification

Status: open.

The dollar cap is not hard as written. The plan says Claude API spend is capped at `$30` and ties the mitigation to `budgets.global.maxTokensEstimate` warnings at `docs/planning/1000_STAR_PLAN.md:14`, `docs/planning/1000_STAR_PLAN.md:228`, and `docs/planning/1000_STAR_PLAN.md:467`.

The repo's budget machinery enforces tokens, provider calls, turns, and wall time, not dollars. `src/providers/cost.ts:14-20` explicitly says USD helpers are advisory telemetry and "never enforce, never refuse." `assertWithinBudget()` enforces token/call/time caps at `src/providers/cost.ts:213-318`, and the default config has a 2,000,000 token estimate cap plus Claude price telemetry at `src/config/schema.ts:315-342`. That can warn/refuse on token estimates, but it is not a `$30` API-spend kill switch.

At current Anthropic pricing, Claude Opus 4.7 is `$5/MTok` input and `$25/MTok` output (`https://claude.com/pricing`). A single 100-300k-token R1 review is usually not enough to blow `$30`, but R1 + R2 + rework + output-heavy review can. More importantly, the plan's "abort if budget warning fires twice" is manual policy, not hard enforcement. To close this, either replace "hard cap" with "manual ceiling tracked outside code-oz" or add an explicit per-round token/output budget and a dollar meter for the M17 review packet.

## New findings introduced by R0-revision-2

1. Medium: Footnote 1 introduces a new unsupported Cursor install-channel claim. `docs/planning/1000_STAR_PLAN.md:271` says Homebrew and npm are documented at Cursor's CLI installation URL; the current official page I checked only supports the shell-installer claim.

2. Low: Phase numbering drift. The closure list says Phase 1.7 at `docs/planning/1000_STAR_PLAN.md:31`, but the real prerequisite section and exit criteria are Phase 1.6 at `docs/planning/1000_STAR_PLAN.md:116-127`.

3. Low: Wrong file pointer for brownfield auto-detection. `docs/planning/1000_STAR_PLAN.md:162` points to `bundled-defaults.ts`, but that file only wires bundled personas at `src/agents/bundled-defaults.ts:1-21`; detection is in `src/commands/init.ts:94-114` and the fresh-run profile handoff at `src/commands/run.ts:309-316`.

4. Low: Time budget drift. Frontmatter says about 60h at `docs/planning/1000_STAR_PLAN.md:14`, while the revised timeline totals 65h at `docs/planning/1000_STAR_PLAN.md:422`. This is not approval-blocking, but the plan should stop carrying two totals.

## Top-3 remaining concerns

1. C1 still needs an explicit anti-stub acceptance condition: it must invoke `code-oz run` and fail on the missing `audit` dispatch path, not manually construct brownfield state and approve `AUDIT.md`.

2. The public comparison table still has one reputation-risk overclaim: Cursor footnote 1 should remove Homebrew/npm unless another current official source is cited.

3. Rule 16 and cost need honest wording. The repo can automate import/hash/grep checks and token caps; it cannot automatically prove human authorship or enforce a `$30` API-spend cap through `maxTokensEstimate`.

## Revised probability

Prior R0-revision estimate: P(1000 stars at 90d) = 7-10%.

Revised estimate: 7-10%, unchanged. R0-revision-2 improves execution quality by cleaning up gate authority and moving profile detection out of M17, but the remaining issues are exactly the kind that create launch pushback: a public comparison overclaim, an enforcement claim stronger than the code can prove, and a budget cap stronger than the current machinery can enforce. If the next revision fixes those without expanding M17, I would move the estimate to 8-12%.
