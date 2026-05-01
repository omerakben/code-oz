# Response — M11 Provider capability contract

**Thread:** 019de44e-e8a7-7441-9d82-d79a0595f591
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_M11.md

## Verdict on the decisions

Overall verdict: accept-with-modifications

A. Verdict: accept. Where I disagree: no flip, use list-on-provider `(a)` and derive any reverse map later. Risks missed: a persisted hybrid map will drift and quietly serve M14 before M14 earns it. Lock before code: `eligiblePhases` is the only eligibility source; any `phase -> providers` lookup is derived, not stored.

B. Verdict: accept. Where I disagree: no flip, use restrictive `(a)`: `gemini` gets `eligiblePhases: []`; `claude`, `codex`, and `fake` get the existing `AGENT_PHASES`. Risks missed: "eligible for ship/audit" can be misread as "phase implemented." Lock before code: eligibility means "provider may run an agent for this phase," not "the phase runtime exists."

C. Verdict: feature-with-modifications. Where I disagree: flip from `(a)` to strict-minimal TS: `authSource`, `eligiblePhases`, optional `costPerMTok`, optional `rateLimits`; document `editSemantics`, `shellSemantics`, `mcpSupport`, and `sandboxProfile` as deferred W3 traits, not v0.1 fields. Load-bearing reason: v0.1 `tool_use` is provider-uniform, so those slots would encode orchestrator-owned behavior as provider-owned behavior. Risks missed: decorative slots become accidental enforcement hooks. Lock before code: no `tool_use.write/execute/debate` gating from capability fields in M11.

D. Verdict: accept. Where I disagree: no flip, load-time only `(a)`. Risks missed: `--probe` is a new diagnostic surface and can become hidden preflight or hidden parallelism. Lock before code: `health()` stays auth/model availability only; doctor does not gain capability probing.

E. Verdict: accept-with-modifications. Where I disagree: flip away from SKU-specific `(a)` to mechanism-specific values, for example `claude-cli-oauth | chatgpt-cli-oauth | gemini-stub | in-process-fake`. Risks missed: Max, Plus, and Pro are platform/SKU labels outside the code-oz trust boundary and may change. Lock before code: docs may name current subscription examples, but the TS enum should not encode subscription tier.

F. Verdict: accept-with-modifications. Where I disagree: no per-phase seat `(b)`; if Decision C stays strict-minimal, defer the TS field entirely. If kept despite that, make it single provider-level only and name it around invocation isolation, not role sandboxing. Risks missed: `perPhase` preempts M12/M14 role policy. Lock before code: no `sandboxProfile.perPhase`.

G. Verdict: accept. Where I disagree: no flip, no M12 hook `(a)`. Risks missed: `eligibleRoles` would create role names before the roster milestone owns them. Lock before code: M11 checks `(provider, phase)` only; M12 can map roles to phases later.

H. Verdict: accept-with-modifications. Where I disagree: keep constructor override only `(a)`, but clarify that a `capabilityOverrides` entry must match the registered adapter capability under the same override. Risks missed: composite object equality is not primitive like `family`; reference equality will be brittle. Lock before code: use structural equality or canonical frozen objects, and do not add a `FakeProvider({ capability })` seam.

7-commit recommended path verdict: accept-with-modifications. Tests should interleave earlier: defaults tests with the defaults module, registry tests with registry authority, loader rejection tests with loader eligibility. A final test-only commit is too late for this kind of contract work. Bundle commits 3 and 4 unless commit 3 has its own meaningful tests; `IAgentProvider.capability`, adapter declarations, `ProviderRegistry.capabilityOf`, override handling, and adapter cross-checking are one anti-laundering unit.

## Risks the proposing side missed

The biggest risk is error-layer drift. The briefing says `provider_role_not_eligible` is a new `ProviderErrorCode`, but the failure is load-time and current load-time failures use `AgentLoadErrorCode` in `src/agents/errors.ts`. Prefer `loader_provider_phase_not_eligible` or `loader_provider_assignment_not_eligible`. "Role" is the wrong M11 word because M11 has no roles.

The loader path is also off: the file is `src/agents/loader.ts`, not `src/agents/load.ts`. More importantly, load-time eligibility should import pure `capabilityOf()` from `src/providers/capabilities.ts`, mirroring `familyOf()`. Do not require a `ProviderRegistry` inside agent loading.

`actionableSuggestions` do not exist on `AgentLoadIssue` today. If M11 wants them for load-time eligibility, add that field deliberately, probably optional for backward compatibility, and update tests. Do not smuggle provider-error shape into loader errors.

Cost and rate-limit metadata can rot quickly. If concrete dollar/token values are added, they need dated source notes or explicit `unknown` placeholders. M11 should not pretend to know current vendor pricing without a verified source.

## Where I disagree

I disagree most with Decision C. The empirical provider-uniform runtime should constrain the TypeScript shape. Add only fields that are real static facts or feed the M11 eligibility gate. Put W3 edit/shell/MCP/sandbox divergence in docs as deferred contract territory.

I also disagree with SKU-specific `authSource` names. code-oz knows "Claude CLI OAuth" and "ChatGPT CLI OAuth"; it does not know or enforce the user's subscription tier.

I disagree with adding `provider_role_not_eligible` as a provider error. This should be a loader error unless a runtime provider path can throw it.

I disagree with the last test commit. Contract code should carry its tests in the same commit that introduces each behavior.

## What I would defer

Defer `eligibleRoles`, `company:`, role-to-provider routing, model/budget roster shape, and any config-side mapping to M12.

Defer role-cost enforcement, price-table preflight, and rate-limit gating to M13.

Defer reviewer-panel quorum, same-family advisory semantics, and any reverse eligibility cache to M14.

Defer doctor probing, HTTP-adapter divergence, MCP support, provider-owned edit/shell semantics, and per-phase sandbox policy until W3 or the milestone that can measure the need.

## Recommended next step

Synthesize M11 as scoped, not too thin. It earns the tag because it creates the provider eligibility authority and moves `gemini` failure from runtime spawn to load-time rejection without adding parallel-provider surface. I would not move M12-adjacent roster work forward. The only reason rule 20 should bend would be if eligibility could not be exercised without a roster, and that is false: current personas already declare `provider` and `phase`.

Recommended implementation locks before commit 1:

1. `ProviderCapability` strict-minimal TS shape.
2. `src/providers/capabilities.ts` mirrors `families.ts`.
3. Loader check lives in `src/agents/loader.ts` and uses pure `capabilityOf()`.
4. Error code is loader-scoped and phase-named.
5. No doctor probe.
6. Tests land with the code they validate.
7. Adapter capability plus registry capability authority ship together.
