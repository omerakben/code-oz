# Response — M12 Company roster

**Thread:** 019de4bb-9623-7340-98d7-dae01f5aa2d0
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_M12.md

## Verdict on the decisions

Overall verdict: accept-with-modifications

A. Verdict: accept-with-modifications. Use persona `name` as the technical key, but lock the accepted M12 keys to the six shipped roster names: `ba`, `lead`, `builder`, `verifier`, `reviewer`, `scientist`. Do not accept any arbitrary loaded project-local persona as a company role, or M12 quietly becomes custom role routing.

B. Verdict: accept-with-modifications. Ship `{ provider?, model? }` only. The company metaphor needs "who plays which role" and "which model they use"; budgets are M13 and permissions remain persona-shaped. Add a fail-closed rule for unsupported row keys like `budgets` or `permissions` so users do not think ignored config is enforced.

C. Verdict: accept. Config wins. If `company:` cannot override frontmatter, M12 does not ship role-to-provider routing authority. Cross-family and eligibility must see the resolved provider.

D. Verdict: accept-with-modifications. Add a separate pure `applyCompanyOverrides` in the loader after bundled/project-local persona merge and before resolved-provider checks. Do not fold it into the bundled-vs-override merge, because those surfaces have different authority and error messages. Also update CLI bootstrap order: today `bootstrap()` builds the registry before `loadConfig()` in `run.ts`, so company config would otherwise arrive too late.

E. Verdict: accept-with-modifications. Six rows only. Debate opponent is governed by `tool_use.debate.opposingProviders`; Orchestrator is the runtime and has no provider/model binding. COMPANY.md prose should explain both, but the YAML must not create decorative rows.

F. Verdict: accept-with-modifications. Coexist silently, no deprecation machinery. But do not claim `defaultProvider` or `models.{primary, reviewer}` are active fallbacks unless M12 wires and tests that path. `defaultProvider` is effectively legacy while provider remains required on personas. `company.<role>.model` must at least flow through `AgentDefinition.model` to provider invocation.

G. Verdict: accept-with-modifications. Keep `loader_company_role_unknown`, but define it against the locked six-role M12 roster, not just "no loaded persona." Invalid provider remains a config validation issue. Additional missed failures: unsupported company row fields, invalid row shape, empty/non-string model, and resolved debate same-family after a provider override.

H. Verdict: accept-with-modifications. The sequence is right in spirit, but commit 4 is probably not zero-code. Current provider calls forward `req.model`, while phase requests generally do not set it, so `agent.model` is not enough unless the wrapper defaults `req.model ?? req.agent.model`. Split commit 4 if bootstrap/config wiring and model invocation wiring diverge.

## Risks the proposing side missed

1. Shipped-role boundary: if unknown-role validation checks "any loaded persona," project-local extra agents become routable roles in M12. Close it with a six-name roster constant and a test where `company.extra` is rejected even when `extra.md` loads.

2. Bootstrap order: `runCommand()` calls `bootstrap()` before `loadConfig()`, and `bootstrap()` calls `loadRegistry()`. Close it by loading config before registry resolution or by making bootstrap own config loading, with tests proving `company.ba.provider` affects `ctx.registry`.

3. Model override propagation: `src/providers/manifest.ts` only copies `req.model`; adapters read `req.model`; phase calls generally omit it. Close it by defaulting provider requests to `req.model ?? req.agent.model`, and test adapter args plus `build_provider_recorded.model`.

4. Debate cross-family after override: schema validation checks `opposingProviders` against the frontmatter provider, not the resolved company provider. `lead.provider: codex` with `opposingProviders: ['codex']` should fail at load time, not first debate call. Close it with a post-override debate-family check.

5. Unsupported field silence: if `company.builder.permissions` or `company.builder.budgets` is ignored, the user gets false authority. Close it with config tests that reject unsupported keys under M12 company rows.

6. Override cascade: project-local persona overrides and company overrides can both touch provider/model. Close it with a precedence test: bundled frontmatter < project-local persona override < company row for provider/model only.

7. Test seam leakage: M11 `capabilityOverrides` belongs to `ProviderRegistry`; loader uses pure `capabilityOf()`. M12 loader tests should use real defaults like `gemini` for ineligibility, not expect registry overrides to affect load-time checks.

## Where I disagree

I disagree with using "loaded personas are [list]" as the role authority. M12 is explicitly "shipped roles only"; accepting any loaded persona makes the role surface dynamic before M16 earns it.

I disagree with the assumption that `tool_use.debate.opposingProviders` is unaffected by company overrides. Its meaning survives, but it must be rechecked against the resolved caller family.

I disagree with describing `defaultProvider` and `models.*` as clean fallbacks without implementation proof. Silent coexistence is fine; false fallback documentation is not.

## What I would defer

Defer per-role budgets and any cost preflight to M13.

Defer permissions overrides until there is a concrete permission-authority milestone; v0.1 permissions stay persona-side.

Defer reviewer panels and panel permission semantics to M14.

Defer debate-opponent scheduling policy to M15; do not add a global debate-opponent row now.

Defer xAI enum/schema expansion to PE-1. M12 should use shared provider enums so PE-1 can extend them without a company-schema migration, but M12 should not pre-add `xai`.

## Recommended next step

Write `SESSION_M12_KICKOFF.md` with these locks: M12 ships `docs/contracts/COMPANY.md` and a `.code-oz/config.yaml` `company:` block for only the six shipped roster keys, with `{ provider?, model? }` rows, config-wins semantics, fail-closed unsupported fields, and resolved-provider validation before registry creation. Implementation should add config parsing, loader override application, post-override cross-family/provider-eligibility/debate-family tests, bootstrap config plumbing, and model propagation into provider invocation. Defer budgets, permissions, debate-opponent row, orchestrator row, deprecations, and xAI.
