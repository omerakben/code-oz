# COMPANY (v0.1)

User-facing contract for the AI-software-company role roster: the `.code-oz/config.yaml` `company:` block, the locked six-name shipped roster, and the role-to-provider routing semantics. Authoritative for v0.1.

**Status:** ships in M12 (`v0.12.0-alpha.0`). The contract is the user-facing surface; the runtime is the company-aware agent loader pipeline (`src/config/{schema,load}.ts` + `src/agents/loader.ts` + the bootstrap-before-loadConfig wiring fix in `src/cli/bootstrap.ts` and `src/commands/run.ts` + the resolved-model propagation fix in `src/providers/manifest.ts`).

## Why this exists

`code-oz` orchestrates role-specialized agents through artifacts, evidence gates, debate, verification, and cross-family review (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`). The product metaphor is "AI software company": Claude Opus is the Builder, GPT-5.5 is the Reviewer, and so on — the same way a hiring manager fills seats on a real team. M12 is where that metaphor lands as code. Without `company:`, the user cannot declare "who plays which role"; the bundled persona frontmatter is the only routing authority. With `company:`, the user owns role-to-provider routing as a config surface.

The authority boundary M12 introduces is **role-to-provider routing only** (CLAUDE.md rule 20: one new authority per milestone). M13 will add per-role cost policy under `budgets.global`. M14 will add the reviewer panel. M15 will add the debate-policy scheduler. M12 ships none of those.

## The shipped roster (locked)

```ts
export const M12_COMPANY_ROLES = [
  'ba',
  'lead',
  'builder',
  'verifier',
  'reviewer',
  'scientist',
] as const
export type CompanyRole = (typeof M12_COMPANY_ROLES)[number]
```

These six names are the only valid keys under `company:` in v0.1. They match the six bundled personas at `src/agents/defaults/{ba,lead,builder,verifier,reviewer,scientist}.md`. Project-local personas (e.g., `.code-oz/agents/agile-coach.md`) load as normal personas but are **not** routable as company roles in v0.1. Per CLAUDE.md rule 20, expanding the roster is M16+ work, gated on measurable need.

Two roles intentionally absent from the YAML surface:

- **Debate opponent.** Already governed per persona by `tool_use.debate.opposingProviders` (DEBATE.md, M10 runtime authority). Adding a second authority for debate-opponent provider would create a precedence conflict with no clean answer.
- **Orchestrator.** The orchestrator is the runtime, not an employee — it has no provider or model to bind. The metaphor lands in prose, not in a decorative YAML row.

## The shape (locked TypeScript)

```ts
import type { AgentProvider } from '../agents/schema.ts'

export interface CompanyRoleOverride {
  readonly provider?: AgentProvider
  readonly model?: string
}

export type CompanyConfig = Readonly<
  Partial<Record<CompanyRole, CompanyRoleOverride>>
>
```

Both fields are optional. Absence means "use the persona's frontmatter value." `CodeOzConfig` extends with `company?: CompanyConfig`; `DEFAULT_CONFIG.company` is undefined.

`AgentProvider` is the shared enum (`src/agents/schema.ts` `AGENT_PROVIDERS = ['claude', 'codex', 'gemini', 'fake', 'xai']` as of PE-1). `mergeCompany` validates `provider` against this exact enum, so future PE-N expansions extend `AGENT_PROVIDERS` and automatically flow into M12's accepted values without a schema migration.

## Default behavior

```yaml
# .code-oz/config.yaml — no company: block
version: '0.12.0-alpha.0'
profile: greenfield
# ...
```

No `company:` block means identity routing: every persona's frontmatter `provider` and `model` are the resolved values. The bundled defaults are unchanged (five `claude` personas, one `codex` reviewer to satisfy the cross-family REVIEW invariant).

## Override semantics (config-wins)

When both the persona's frontmatter and the company:block declare a value, the company:block wins. Two surfaces consume the resolved values:

1. **Load-time validation.** `enforceCrossFamilyReview` (CLAUDE.md rule 2), `enforceProviderPhaseEligibility` (M11 capability check), and a new post-override debate-family check all see the *resolved* provider — not the persona's frontmatter provider.
2. **Runtime invocation.** The provider wrapper consumes the resolved provider via the `ProviderRegistry` lookup; the resolved model flows through to the adapter via `req.model ?? req.agent.model` defaulting in `buildManifest` (so the resolved model reaches the adapter even when a phase call omits `req.model`).

```yaml
# .code-oz/config.yaml — full override example
version: '0.12.0-alpha.0'
profile: greenfield
company:
  ba:
    provider: codex
    model: gpt-5.5
  lead:
    model: claude-opus-4-8
  reviewer:
    provider: gemini
```

In this example the resolved values are: `ba` runs on `codex` with model `gpt-5.5`; `lead` keeps its frontmatter provider (`claude`) but runs on `claude-opus-4-8`; `reviewer` runs on `gemini`. The third row will fail load-time validation today because `gemini` is not eligible for any phase in v0.1 (`capabilityOf('gemini').eligiblePhases === []`); the resolved-provider eligibility check raises `loader_provider_phase_not_eligible` before the run starts.

## Validation rules

The `company:` block is validated at two layers — config-load and agent-load — because each layer has different authority and different error codes.

### Config-load (`src/config/load.ts` `mergeCompany`)

| Failure | Code | When it fires |
|---|---|---|
| `company` is not a YAML mapping | `config_invalid_shape` | top-level type is array or scalar |
| `company:` declares a key not in `M12_COMPANY_ROLES` | `loader_company_role_unknown` | the locked roster is the authority — e.g. `company.agile-coach: ...` is rejected even when a same-named project-local persona file loads |
| a row is not a YAML mapping | `config_invalid_shape` | e.g. `company.ba: "codex"` (scalar instead of mapping) |
| a row contains a key other than `provider` or `model` | `config_invalid_value` | fail-closed; e.g. `company.builder.permissions`, `company.builder.budgets`, `company.builder.bash` |
| `provider` is not in `AGENT_PROVIDERS` | `config_invalid_value` | typo or unknown provider |
| `model` is present and not a non-empty string | `config_invalid_value` | empty string, number, null |

`company` missing or `null` resolves to `undefined` (no override) — the same default-on-absence pattern `mergeBudgets` and `mergePermissions` already use.

The fail-closed rule on unsupported row keys is load-bearing: silently dropping `company.builder.permissions` would give the user false authority over a surface M12 deliberately defers (permissions stay persona-shaped; per-role budgets are M13). The error code `loader_company_role_unknown` carries the conceptual layer name (role roster is a loader-of-personas concern) but fires here at config-load to fail fast — `applyCompanyOverrides` repeats the check defensively for callers that bypass `loadConfig`.

### Agent-load (`src/agents/loader.ts`)

The loader applies overrides between the bundled-vs-override merge step and the existing enforcement checks:

```
buildRegistry(opts):
  for source in defaults: validateOne → AgentDefinition
  for source in overrides: validateOne → AgentDefinition (project-local merge)
  ────────────── M12 overlay ──────────────
  applyCompanyOverrides(definitions, opts.company)
    ├── reject keys not in M12_COMPANY_ROLES → loader_company_role_unknown
    └── for each definition, replace provider/model from matching role row
  enforceDebateOpposingFamily(resolvedDefinitions)   // M12 post-override check
  ────────────── /M12 overlay ─────────────
  enforceCrossFamilyReview(resolvedDefinitions)      // M9 — now against resolved
  enforceProviderPhaseEligibility(resolvedDefinitions) // M11 — now against resolved
  makeRegistry(resolvedDefinitions)
```

| Failure | Code | When it fires |
|---|---|---|
| `company:` declares a key not in `M12_COMPANY_ROLES` | `loader_company_role_unknown` | defensive backstop in `applyCompanyOverrides` for callers that bypass `loadConfig` (e.g., tests that construct `CompanyConfig` via TypeScript escape hatch) — the primary site is `mergeCompany` at config-load |
| resolved provider's family appears in the persona's frontmatter `tool_use.debate.opposingProviders` | `schema_invalid_permissions` | post-override re-check; the schema-time check at `validateDebate` ran against the frontmatter provider |
| BUILD and REVIEW resolve to the same provider family | `loader_cross_family_violation` | reuses M9's existing check, run against the resolved providers; `detail` names the resolved providers and families (the bundled-vs-override merge layer drops pre-override metadata) |
| resolved (provider, phase) is not in `capabilityOf(provider).eligiblePhases` | `loader_provider_phase_not_eligible` | reuses M11's existing check; debate-opposing-provider walk also runs against the resolved phase |

Per the locked AgentLoadIssue shape (M11), every loader issue carries `{ file, code, rule, detail? }`. There is no `actionableSuggestions` field — `rule` and `detail` carry the fix hint.

## Override cascade and precedence

The merge layers run in this order, lowest authority first:

1. Bundled persona frontmatter (`src/agents/defaults/<role>.md`)
2. Project-local persona override (`.code-oz/agents/<role>.md`, when present)
3. `company:` block row (this contract)

Each layer can replace `provider` and `model`. The company row wins when present, regardless of what layer 2 set. The cascade test at `tests/agent-loader-company.test.ts` proves this with a three-layer fixture: bundled `claude`, project-local override `codex`, company row `gemini` — resolved provider is `gemini`, and the eligibility check fails with `loader_provider_phase_not_eligible` because `gemini` is ineligible in v0.1.

## Bootstrap order (M12 wiring fix)

Before M12, `runCommand()` invoked `bootstrap()` (which built the agent registry) before `loadConfig()` ran. The company config arrived too late to affect routing. M12 flips the order at both call sites — `src/commands/run.ts:61-62` (the entry point) and `src/commands/run.ts:507-508` (the active-run PLAN dispatch). Each call loads config first, then threads `config.company` through `loadRegistry` and into `buildRegistry`.

Routing is **config-current, not config-snapshotted**. Both call sites read `.code-oz/config.yaml` from disk on every dispatch, so a saved edit between DEFINE-approve and PLAN dispatch is honored on the next phase. Snapshot-on-init (freezing the company:block at run start) is not implemented; if a future milestone needs it, that is M16+ design space.

Concurrent partial writes to the YAML file are out of scope for v0.1: `loadConfig` reads non-atomically and may observe truncated content during a competing write. The fix is an atomic-save discipline on the writer side, not a read-side change here.

## Model propagation (M12 wiring fix)

`buildManifest` (`src/providers/manifest.ts`) previously forwarded only `req.model` to the adapter. Phase logic generally constructs `ProviderRequest` without setting `req.model`, so the agent's bound model (`req.agent.model`) was silently dropped during prepare. M12 defaults `req.model ?? req.agent.model` so the resolved model reaches the adapter, and the `agent_invoked.model` event records the resolved value (not the request-time override or undefined).

The fix is independent of the company override — the latent bug was present from M11 — but it becomes externally visible the moment `company.<role>.model` exists. M12 ships the fix because the company surface depends on it.

## Backward compatibility

`defaultProvider`, `models.primary`, and `models.reviewer` continue to load and validate. They coexist silently with `company:`; M12 does not deprecate them and does not emit deprecation warnings. They are not active fallback paths in v0.1: persona frontmatter requires `provider`, so `defaultProvider` is effectively legacy, and `models.{primary, reviewer}` is consulted only by code paths that explicitly read it (today, none in the resolved-agent invocation flow). Future-Ozzy reading this should not assume a fallback chain that the runtime does not implement.

## What this contract does not ship

- **Per-role budgets.** Deferred to M13 under `budgets.global`. Cost policy is one new authority; M12 carries one already (role routing).
- **Per-role permissions.** Deferred indefinitely. Permissions are persona-shaped — a Builder's `tool_use.write` is what makes it a Builder, not a config switch.
- **Reviewer panels.** Deferred to M14. Panel shapes are panel-shaped, not role-shaped.
- **Debate-opponent row.** Deferred to M15. Per-persona `tool_use.debate.opposingProviders` is the M10 authority; a competing config-side row would create a precedence conflict.
- **Orchestrator row.** The orchestrator is the runtime, not a persona; no decorative reserved-namespace row.
- **Custom role routing.** M16+. Project-local personas with names outside `M12_COMPANY_ROLES` cannot be routed via `company:`.
- **xAI provider.** Deferred to PE-1. M12 reuses `AGENT_PROVIDERS` so PE-1's enum extension flows in cleanly.
- **AgentLoadIssue surface change.** No `actionableSuggestions` field — same shape as M11.
- **Reverse `phase → ProviderId[]` map.** M11 anti-pattern; derive on demand if M14 ever needs it.

## Forward-compat

| Future milestone | What it adds | How M12's surface accommodates |
|---|---|---|
| **M13 — role-cost policy (CLOSED 2026-05-01, `v0.14.0-alpha.0`)** | `budgets.global.byRole.<role>` per-role spend caps; `priceTable[provider:model]` (operator-configured, model-level) feeds advisory `costEstimateUSD` / `costActualUSD` telemetry; registry `capabilityOf` per-provider fallback. Reads role identity from `M12_COMPANY_ROLES` via `canonicalRoleFromAgent`. No M12 schema change. See [`docs/references/budgets.md`](../references/budgets.md). |
| **M14 — reviewer panel v1** | First simultaneous-provider surface; multiple reviewers run in parallel under one role | Adds an explicit `panels:` block alongside `company:`. Does not extend `company.reviewer` into a list. |
| **M15 — debate-policy scheduler** | Single-opponent debate scheduling rules | Reads from per-persona `tool_use.debate.opposingProviders`, not from `company:`. |
| **PE-1 — xAI direct provider** | `AGENT_PROVIDERS` gains `'xai'`; new `authSource` mechanism | `company.<role>.provider: xai` works automatically once PE-1 lands. No COMPANY.md migration. |

## Worked example (mixed pass/fail override)

The example below overrides every persona row to demonstrate both the
happy path (most rows resolve cleanly) and the post-override
debate-family check (`lead.provider: codex` overrides the bundled
`claude` provider into a family that already appears in the bundled
`lead.md`'s `tool_use.debate.opposingProviders: ['codex']` — load-time
fail). Real configs typically declare a few targeted overrides, not a
full sweep.


```yaml
# .code-oz/config.yaml
version: '0.12.0-alpha.0'
profile: greenfield
company:
  ba:
    model: claude-opus-4-8
  lead:
    provider: codex
    model: gpt-5.5
  builder:
    provider: claude
    model: claude-opus-4-8
  verifier:
    provider: claude
  reviewer:
    provider: codex
    model: gpt-5.5
  scientist:
    provider: claude
    model: claude-opus-4-8
```

Resolved registry after `bootstrap({ cwd, config })`:

| Role | Frontmatter provider | Resolved provider | Resolved model |
|---|---|---|---|
| `ba` | claude | claude | claude-opus-4-8 |
| `lead` | claude | codex | gpt-5.5 |
| `builder` | claude | claude | claude-opus-4-8 |
| `verifier` | claude | claude | persona frontmatter value |
| `reviewer` | codex | codex | gpt-5.5 |
| `scientist` | claude | claude | claude-opus-4-8 |

Cross-family REVIEW holds: `reviewer` (codex) and `builder` (claude) resolve to different families. Eligibility holds: every (provider, phase) pair is in `capabilityOf(provider).eligiblePhases`. The `lead` override changes the debate-opposing-family calculation: if the bundled `lead.md` declares `opposingProviders: ['codex']`, the resolved family (`codex`) now appears in its own debate list — the post-override check raises `schema_invalid_permissions` at load time, before any debate call.

The fix in that case is to update either `lead.md` frontmatter (`opposingProviders: ['claude']` after override) or to flip the override (`lead.provider: claude` and let the codex reviewer carry the cross-family seam alone). The contract surfaces the conflict; the user makes the choice.

## See also

- [`PROVIDERS.md`](./PROVIDERS.md) — provider adapters, capabilities and eligibility (M11), subscription-first auth model
- [`docs/references/provider-contract.md`](../references/provider-contract.md) — `IAgentProvider`, `ProviderCapability` (M11) shape, error codes
- [`DEBATE.md`](./DEBATE.md) — debate runtime (M10), `tool_use.debate.opposingProviders` per-persona authority
- [`REVIEW.md`](./REVIEW.md) — cross-family REVIEW (CLAUDE.md rule 2), `tool_use.review_request` per-persona authority
- [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](../product/AI_SOFTWARE_COMPANY_THESIS.md) — product north star, market positioning, role model
- [`docs/research/CODEX_BRIEFING_M12.md`](../research/CODEX_BRIEFING_M12.md) and [`docs/research/CODEX_RESPONSE_M12.md`](../research/CODEX_RESPONSE_M12.md) — M12 planning-convergence debate (thread `019de4bb-9623-7340-98d7-dae01f5aa2d0`)
- [`docs/design/SESSION_M12_KICKOFF.md`](../design/SESSION_M12_KICKOFF.md) — synthesized M12 locks and 6-commit sequence
