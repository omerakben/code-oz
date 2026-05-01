# Codex M11 implementation review (round 2)

**Thread:** `019de479-49c1-78a1-9d85-b7dce780944a`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`docs/research/CODEX_BRIEFING_M11_REVIEW_R2.md`](./CODEX_BRIEFING_M11_REVIEW_R2.md)
**HEAD reviewed:** `0002dc1` (round-1 closure)

## Verdict on the decisions

Overall verdict: push

The round-1 closure is sufficient to tag M11. `src/agents/loader.ts` now closes the synthetic debate-opponent bypass in the load path, the regression tests cover the `gemini` rejection and eligible opposing-provider cases, and I did not find a new rule-20 authority surface or rule-21 parallel-provider surface.

Validation I ran:
- `bun run typecheck`: clean.
- `bun test tests/agent-loader-eligibility.test.ts tests/agent-load-tool-use-debate.test.ts`: 40 pass / 0 fail.
- `bun test tests/provider-capabilities.test.ts tests/providers-registry.test.ts`: 49 pass / 0 fail.
- Broader tempdir-writing tests could not be meaningfully run in this read-only sandbox because `mkdtemp` under `/var/folders/.../T` fails with `EPERM`.

### block-push

None.

### fix-soon

None.

### nit

1. Where: `docs/contracts/DEBATE.md:192`, `docs/contracts/DEBATE.md:211`, `docs/contracts/DEBATE.md:244`.

   Why it matters: `DEBATE.md` is the canonical debate permission contract, but it still says `opposingProviders` is limited to `claude | codex | gemini`, while the schema uses `PROVIDER_FAMILIES` and the M11-narrowed tests now use `fake` as the eligible second cross-family provider. The same section also names `debate_opposing_provider_same_family` as a load-time error, while the schema emits `schema_invalid_permissions` for same-family declarations and M11 emits `loader_provider_phase_not_eligible` for phase-ineligible opposing providers.

   Remediation: update the snippet to `readonly ProviderFamily[]` or include `fake`; update the prose to name both checks: same-family schema validation and M11 opposing-provider phase eligibility; remove or correct the stale common-error row.

2. Where: `tests/debate-request-codex-review-fixes.test.ts:394`.

   Why it matters: this runtime test still constructs a caller with `opposingProviders: ['codex', 'gemini']` and registers a `gemini` proxy directly, bypassing the loader. The test intent is prior `opposingProvider` mismatch, not Gemini eligibility, but the fixture now contradicts M11's "gemini has no eligible phases" lock.

   Remediation: switch that mismatch fixture to `['codex', 'fake']` and request `opposingProvider: 'fake'`, or add an explicit comment that this unit test bypasses loader eligibility and is only exercising runtime collision behavior.

### fyi

1. Where: `src/agents/loader.ts:116`.

   Why it matters: the new `opposingProviders` walk does not produce duplicate or contradictory issues in the current provider table. A `claude` PLAN persona with `['gemini']` produces exactly the opposing-provider issue; a `gemini` persona with an eligible opposing provider produces exactly the persona eligibility issue. The current schema prevents the only same-provider duplicate case by rejecting own-family opposing providers first.

   Remediation: none.

2. Where: `tests/agent-load-tool-use-debate.test.ts:98`, `tests/agent-load-tool-use-debate.test.ts:260`.

   Why it matters: the two narrowed M10-era tests retained their original cross-family schema intent. They still prove multi-entry and non-own-family acceptance; M11's new negative tests cover the removed `gemini` case.

   Remediation: none.

3. Where: `src/tools/debate-request.ts:681`, `src/tools/review-request.ts:76`, `src/phases/scientist.ts:318`.

   Why it matters: `requestDebate` remains the only runtime-created `AgentDefinition` path that copies provider and phase from a permission list. `requestReview` consumes a loaded reviewer agent, and the phase/scientist paths invoke loaded agents. The closure targets the right bypass.

   Remediation: none.

4. Where: `docs/references/provider-contract.md:31`, `docs/references/provider-contract.md:362`, `docs/design/SESSION_M11_KICKOFF.md:80`.

   Why it matters: the round-1 documentation fixes landed in the closure-impact docs: the canonical `IAgentProvider` snippet now includes `readonly capability`, and the function-name drift is corrected to `enforceProviderPhaseEligibility(definitions)`.

   Remediation: none.

## Risks the proposing side missed

The only residual risk I see is documentation and fixture drift around the old M10 debate contract. The runtime closure itself is correct: the load-time authority now covers the permission list that authorizes the synthetic debate opponent.

The direct `requestDebate` API can still be unit-tested with hand-built invalid callers because it is lower-level than the loader. I do not consider that a production bypass for M11 because CLI/orchestrator callers are loaded through `buildRegistry` / `loadRegistry`, but the remaining test fixture should stop normalizing `gemini` as a valid M11 opposing provider.

## Where I disagree

I do not disagree with the closure strategy. Keeping the fix in `enforceProviderPhaseEligibility` is the right shape because M11's authority is provider eligibility at load time, not a new runtime provider-role error surface.

I do disagree with leaving `DEBATE.md` phrased as if its M10 provider list and error names are still exact. That is not a tag blocker, but it is now behind the schema and tests.

## What I would defer

Defer a defensive runtime eligibility assertion inside `requestDebate` unless `requestDebate` becomes a public API outside the loaded-agent orchestration path. Today it would be defense-in-depth, not the M11 authority.

Defer the `ProviderFamily` versus `ProviderId` naming cleanup in `tool_use.debate` until non-identity provider families arrive. In v0.1 the sets are identical, so the current cast in the loader is not a current behavior bug.

## Recommended next step

Tag M11 as `v0.11.0-alpha.0` and merge to `main`.

Before or immediately after tag, make a small docs/test hygiene commit for the two nits:
1. Sync `docs/contracts/DEBATE.md` with the current `PROVIDER_FAMILIES` and M11 eligibility error behavior.
2. Replace the stale `gemini` runtime-test fixture with `fake` in the prior-opposing-provider mismatch test.
