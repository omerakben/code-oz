# Codex M11 implementation review (round 1)

**Thread:** `019de46d-b8c9-7f13-8257-81b572121306`
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** [`docs/research/CODEX_BRIEFING_M11_REVIEW.md`](./CODEX_BRIEFING_M11_REVIEW.md)
**HEAD reviewed:** `ac7c1c5` (`main..HEAD` = 4 commits)

## Verdict on the decisions

Overall verdict: fix-first

M11 is mostly correctly scoped: the TypeScript capability shape is strict-minimal, `authSource` is mechanism-specific, the loader uses pure `capabilityOf()`, `AgentLoadIssue` did not grow `actionableSuggestions`, and registry anti-laundering uses structural equality. I did not find hidden M12 company-roster surface or new parallel-provider surface.

The branch should not tag yet because the provider eligibility authority has one bypass through M10's synthetic debate opponent path.

### block-push

1. Where: `src/agents/schema.ts:416`, `src/tools/debate-request.ts:696`.

   Why it matters: Rule 20 says M11's authority is provider eligibility. The loader enforces `capabilityOf(agent.provider).eligiblePhases.includes(agent.phase)` only for loaded personas, but `requestDebate` creates a synthetic `AgentDefinition` at runtime with `provider: opts.opposingProvider`. A project-local PLAN persona can declare `tool_use.debate.opposingProviders: ['gemini']`; schema validation accepts it when the caller is not gemini, and then `requestDebate` can route a synthetic plan-phase opponent to gemini even though `capabilityOf('gemini').eligiblePhases` is `[]`. That bypasses the "gemini is never eligible in v0.1" lock and moves the failure back to runtime.

   Remediation: close this in the load path, not by adding a new provider-role runtime error. Extend the loader/schema validation for `permissions.tool_use.debate.opposingProviders` so every declared opposing provider for the persona's phase is checked against `capabilityOf(provider).eligiblePhases.includes(agent.phase)`. Reuse `loader_provider_phase_not_eligible`, keep the issue shape `{ file, code, rule, detail? }`, and add a regression test where a `phase: plan`, `provider: claude` persona with `opposingProviders: ['gemini']` fails before bootstrap returns. If you also add a defensive runtime assertion in `requestDebate`, keep it secondary and avoid introducing a new M11 authority surface.

### fix-soon

1. Where: `docs/references/provider-contract.md:31`.

   Why it matters: This is the canonical provider contract, but the `IAgentProvider` snippet still omits `readonly capability: ProviderCapability`. That contradicts `src/providers/types.ts:171` and the M11 contract surface, so future adapter authors can follow the wrong interface while the compiler requires the new field.

   Remediation: update the canonical `IAgentProvider` snippet to include `readonly capability: ProviderCapability`, either directly after `family` or with a short pointer to the M11 capability section.

### nit

1. Where: `docs/references/provider-contract.md:361`.

   Why it matters: The canonical doc says `src/agents/loader.ts` runs `validateProviderPhaseEligibility(loadedAgents)`, but the implementation is `enforceProviderPhaseEligibility(definitions)` at `src/agents/loader.ts:86`. This is minor, but it is a contract/code agreement drift.

   Remediation: rename the prose to `enforceProviderPhaseEligibility(definitions)` or make it function-name neutral.

2. Where: `tests/agent-loader-eligibility.test.ts:51`.

   Why it matters: The happy-path tests say claude/codex/fake are eligible for every `AGENT_PHASES` value, but each loop skips `review` at `tests/agent-loader-eligibility.test.ts:55`, `65`, and `74`. The comment says it avoids a default claude builder, but these tests only build one synthetic agent, so the skip is not needed.

   Remediation: remove the `review` skip, or add explicit review-phase happy-path cases. This is a test clarity gap, not a runtime blocker.

### fyi

1. Where: `src/providers/capabilities.ts:52`.

   Why it matters: The strict-minimal `ProviderCapability` shape held. I saw no TS fields for `editSemantics`, `shellSemantics`, `mcpSupport`, or `sandboxProfile`; they appear only in deferred-prose/comments and tests that guard absence.

   Remediation: none.

2. Where: `src/providers/registry.ts:115`.

   Why it matters: The anti-laundering check uses `capabilitiesEqual()`, not reference equality, and tests cover default mismatch plus override mismatch paths.

   Remediation: none.

## Risks the proposing side missed

The main missed risk is that "load-time provider eligibility" has to account for runtime-created synthetic agents that are authorized by loaded personas. M10 introduced exactly one such path: `requestDebate` builds `debate-opponent` dynamically. M11 does not need a broad tool-use capability matrix, but it does need to ensure the existing debate permission list cannot authorize an ineligible provider for the caller phase.

The secondary risk is doc drift: the new M11 section is accurate, but the older canonical interface snippet is now stale.

## Where I disagree

I disagree with treating loaded persona provider checks as the entire provider eligibility boundary. That is sufficient for normal phase agents and `requestReview`, where the reviewer is a loaded `AgentDefinition`. It is not sufficient for `requestDebate`, because the provider that actually runs the opposing turn is selected from `tool_use.debate.opposingProviders` and then copied into a synthetic `AgentDefinition`.

I do not disagree with the strict-minimal capability shape. The implementation avoided the four deferred W3 fields in TypeScript.

## What I would defer

Defer role naming, company roster, role-cost enforcement, reviewer panels, scheduler policy, and any provider-specific edit/shell/MCP/sandbox semantics. None of those are needed to close the bypass.

Defer order-insensitive `eligiblePhases` equality unless it becomes painful. The current order-sensitive structural equality is stricter than semantic set equality, but the contract and tests explicitly lock it, and it is not a tag blocker.

## Recommended next step

Make one follow-up commit on `feat/m11-provider-capability` before tag:

1. Add the debate-opponent eligibility validation in the loader/schema path.
2. Add the regression test for `opposingProviders: ['gemini']`.
3. Patch the canonical `IAgentProvider` snippet.
4. Optionally clean the test comment/skip and doc function name.

Validation I ran in this sandbox:

- `bun test tests/provider-capabilities.test.ts tests/providers-registry.test.ts tests/agent-loader-eligibility.test.ts`: 60 pass / 0 fail.
- `bun run typecheck`: clean.
- Full `bun test`: not meaningful here because the read-only sandbox blocks `mkdtemp` under `/var/folders/.../T` with `EPERM`, causing cascading failures unrelated to this branch.
