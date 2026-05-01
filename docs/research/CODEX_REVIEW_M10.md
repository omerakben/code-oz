# Codex M10 + PLAN-extraction implementation review

**Thread:** `019de41d-5f59-75b2-8eb6-9cea003cdae2`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh
**Sandbox:** workspace-write (per Ozzy's "give Codex more access" directive)
**Brief:** [`docs/research/CODEX_BRIEFING_M10_REVIEW.md`](./CODEX_BRIEFING_M10_REVIEW.md)
**HEAD reviewed:** `b086387` (origin/main..HEAD = 14 commits)

## Final verdict: `fix-first`

The implementation is close. Validation is green (1795 pass / 1 skip / 0 fail). M10 is **not push-safe**: three block-push issues in the Debate runtime authority surface, mainly around generic permission enforcement, resume, and serial uniqueness.

Per CLAUDE.md `no_tech_debt_at_milestone_close` memory, all `block-push` + `fix-soon` findings must be closed before pushing `main` to GitHub. Only `nit` + `fyi` can defer.

## Block-push findings

### bp#1 — `requestDebate()` does not enforce the generic `tool_use.debate` permission boundary

**Where:**
- `src/tools/debate-request.ts:170` — only the cross-family check fires
- `src/tools/debate-request.ts:224` — manifest preview accepts every requested file
- `src/phases/plan.ts:263` (PLAN-specific clamp; phase-agnostic primitive lacks it)

**Why it matters:** D12 lock says the primitive stays phase-agnostic and any custom non-PLAN persona with valid `tool_use.debate` reaches the generic permission path. As shipped, a direct non-PLAN caller can:
1. Invoke debate without `tool_use.debate` at all,
2. Exceed `maxFiles`,
3. Bypass the declared `opposingProviders` list.

This violates D12 and weakens D9 privacy controls.

**Remediation:** move the permission check into `requestDebate()` itself: require `caller.permissions.tool_use.debate`, check `opposingProvider` is in the declared list, enforce `files.length <= maxFiles`. (timeoutMs enforcement may be deferred / removed from authority claim.)

### bp#2 — D8 resume is not implemented

**Where:**
- `src/tools/debate-request.ts:202` — existing artifact dir always becomes `debate_topic_collision`

**Why it matters:** D8 lock says the resume path detects `BRIEFING + RESPONSE present + DECISION absent`, validates RESPONSE before re-invoking synthesis, rejects briefing-sha mismatch and provider-suffix mismatch. None of that exists; a partially-completed debate becomes a hard collision and the run cannot resume.

**Remediation:** add a sha-bound resume probe before collision failure. Validate existing `BRIEFING.md` against `debate_started.briefingSha256`; validate `RESPONSE.{side}.md`; reject provider-suffix mismatch; resume the missing turn (or mark complete deterministically).

### bp#3 — D3/D7 serial uniqueness is racy

**Where:**
- `src/tools/debate-request.ts:188` — events read + open-debate check + topic-dir check
- `src/tools/debate-request.ts:254` — `mkdir(..., { recursive: true })` writes the dir later

**Why it matters:** Two concurrent callers can both see no open debate and both pass the topic/dir check before either writes `debate_started`. The race reopens the D7 collision-trap path the dual-check was meant to close.

**Remediation:** acquire the run lock around event read + open-debate check + topic-dir creation (with non-recursive final `mkdir`) + preview/briefing write + `debate_started` append. Release before provider I/O.

## Fix-soon findings

### fs#1 — `IgnorePolicyError` does not flow through the promised debate-error surface

**Where:**
- `src/tools/debate-request.ts:224` — `buildDebateManifestPreview()` can throw
- `src/phases/plan.ts:340` — non-`ProviderError` failures map to generic runtime handling

**Why it matters:** D6 documents `ignore_policy_unsupported_syntax` as the bridge to `debate_manifest_blocked`. Today the IgnorePolicyError throw goes through `plan_debate_runtime_error` instead.

**Remediation:** catch `IgnorePolicyError` in `requestDebate()` and wrap as `debate_manifest_blocked` with line details.

### fs#2 — DECISION `opposing_verdict` is never validated against the parsed RESPONSE verdict

**Where:**
- `src/artifacts/debate.ts:421` — `parseDecision()` validates enum shape only
- `src/tools/debate-request.ts:384` — runtime passes the RESPONSE but does not verify cross-consistency

**Why it matters:** `debate_resolved.responseVerdict` uses the real parsed RESPONSE, but the on-disk DECISION audit artifact can lie about what the opposing party actually said.

**Remediation:** when `opposingResponse` is supplied, reject `decision.frontmatter.opposingVerdict !== opposingResponse.overallVerdict` as `debate_decision_no_rationale` (or a tighter code).

### fs#3 — Discarded trailing PLAN prose persists only on the success path

**Where:**
- `src/phases/plan.ts:662` — debate runs first
- `src/phases/plan.ts:671` — `discarded-drafts` write happens after success

**Why it matters:** Permission rejection or runtime failure loses the parsed terminal trailing draft. Forensics are exactly what fail paths need.

**Remediation:** persist `trailingDraft` immediately after successful extraction, before permission clamp and `runPlanDebate` call.

## Nits and FYIs

- **n#1** (`src/tools/debate-request-extract.ts:65,206`): `extractDebateRequest()` counts literal tag strings anywhere in the response. Quoted YAML like `question: "contains <debate-request>"` would false-trigger `multiple`. Line-anchored tags would be cleaner. Deferable.
- **n#2** (`src/phases/plan.ts:642,691`): continuation structurally blocks a second debate via `MAX_DEBATE_ROUNDS`, but the continuation prompt should explicitly say "do not emit another `<debate-request>`".
- **n#3** (`docs/contracts/DEBATE.md:196`): wording still says "presents the manifest to the user before send" while the correct non-interactive wording appears later.
- **fyi#1**: D11 budget arithmetic is coherent. Opposing + synthesis both flow through `invokeAgent()`; PLAN continuation also goes through `invokeAgent()`. `maxProviderCalls` counts `agent_invoked` events.
- **fyi#2**: M9 nit cleanup is behavior-preserving; no necessary context removed.

## Validation run by Codex

- `bun test` passed: 1795 / 1 skip / 0 fail.
- Targeted M10 tests passed: 166 / 0 fail.
- `bun run typecheck` passed.
- No source files modified by Codex; the material fixes are behavior changes, not behavior-preserving cleanup.

## Closure tracker

| Finding | Severity | Status | Closed in |
|---|---|---|---|
| bp#1 | block-push | **closed** | `requestDebate` enforces `tool_use.debate` scope generically (caller must declare it; opposingProvider must be in declared list; files.length must not exceed maxFiles). Tests in `tests/debate-request-codex-review-fixes.test.ts`. |
| bp#2 | block-push | **closed** | D8 sha-bound resume probe inside the run lock: BRIEFING sha + opposingProvider compared against prior `debate_started`; RESPONSE present + DECISION absent → resume from synthesis (skip opposing turn); intervention on mismatch. Three regression tests cover the resume path, sha-mismatch rejection, and opposingProvider-mismatch rejection. |
| bp#3 | block-push | **closed** | Lock-wrapped uniqueness/preview/briefing/`debate_started` window via `withLock(ctx.runPaths.lockDir, ...)`. Provider invocations happen after lock release. Resume detection lives inside the same locked region so it cannot race with concurrent fresh starts. |
| fs#1 | fix-soon | **closed** | `IgnorePolicyError` from `buildDebateManifestPreview` caught and wrapped as `ProviderError` with `debate_manifest_blocked` code (both fresh and resume paths). Test covers a `!exception.env` negation pattern (D6 unsupported syntax). |
| fs#2 | fix-soon | **closed** | `parseDecision` cross-checks `frontmatter.opposing_verdict` against `opposingResponse.overallVerdict`; raises `debate_decision_invalid_frontmatter` on mismatch. Test verifies tampered DECISION rejection + matching DECISION acceptance + null-opposing skip. |
| fs#3 | fix-soon | **closed** | `src/phases/plan.ts` persists `extract.block.trailingDraft` to `<runDir>/discarded-drafts/plan-<topic>.draft.md` immediately after extraction succeeds, BEFORE the round-cap check, permission clamp, and `runPlanDebate` call. Forensics survive permission rejection + runtime failure paths. |
| n#1  | nit | deferred | Line-anchored tag detection in `extractDebateRequest`. Quoted-YAML edge case. Acceptable per Codex deferal. |
| n#2  | nit | **closed** | PLAN continuation prompt now explicitly forbids re-debate ("Do NOT emit another `<debate-request>` in this turn — at most one debate per PLAN invocation in v0.1"). |
| n#3  | nit | **closed** | DEBATE.md tightened: "writes a pre-send manifest preview artifact and blocks on policy violations before any provider call. Interactive operator approval is deferred to W2 / TUI work." |

All `block-push` + `fix-soon` findings are closed per the no-tech-debt-at-milestone-close rule. Only n#1 (deferable per Codex) remains open.

**Re-validation (round 1 fixes):** 1805 tests pass / 1 skip / 0 fail. Typecheck clean.

## Round 2 review (re-review of fixes)

**Thread:** `019de42e-ee97-7b52-8b1f-0d0db4f46fcc`
**Date:** 2026-05-01
**Verdict:** `fix-first`

Codex re-reviewed the round-1 closures and found three NEW findings, all clustered around the resume-opposing branch I added on top of D8.

| Finding | Severity | What | Status | Closed in |
|---|---|---|---|---|
| bp#4 | block-push | An active in-flight debate is indistinguishable from a crash-resume case. After caller 1 appends `debate_started` and releases the run lock, but before writing RESPONSE, caller 2 sees `priorStarted + no RESPONSE` → enters resume-opposing → both call the provider. bp#3 is not fully closed. | **closed** | Removed the resume-opposing branch entirely. `priorStarted && !existsSync(responsePath)` now rejects as `debate_concurrent_limit_exceeded`. The safe default is operator investigation, not racing the in-flight session. |
| bp#5 | block-push | Resume revalidation rebuilt the manifest from current `req.files`, not from the SHA-bound original BRIEFING.md / MANIFEST.preview.md. A resume after `debate_started` could send a different file set to the opponent than the signed briefing recorded. | **closed** | Resume now parses the SHA-checked BRIEFING.md and uses `frontmatter.files` as the only allowed file list. `req.files` is ignored on resume. The manifest preview sha is read from the prior `debate_started` event (no rebuild). |
| fs#4 | fix-soon | DECISION orphan detection was nested under `existsSync(responsePath)`. If DECISION existed without RESPONSE (corruption), the code fell through to resume-opposing instead of collision. | **closed** | DECISION-orphan check fires immediately after BRIEFING sha-validation, before the RESPONSE check. |

**Re-validation (round 2 fixes):** 1808 tests pass / 1 skip / 0 fail (3 new regression tests for bp#4, bp#5, fs#4). Typecheck clean.

## Round 3 expected verdict: `push`

The remaining open finding is n#1 (line-anchored tag detection in `extractDebateRequest`), which Codex marked as deferable.
