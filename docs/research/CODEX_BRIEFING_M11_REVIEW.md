# Codex briefing — M11 implementation review (CLAUDE.md rule 8)

**Branch:** `feat/m11-provider-capability` (cut from `main` at `c870d06`)
**Range:** `main..HEAD` = 4 commits
**HEAD:** `ac7c1c5` (M11 commit 4/4)
**Tag target:** `v0.11.0-alpha.0` (not yet cut)
**Tests:** 1857 pass / 1 skip / 0 fail (`bun test`, ~10.7s offline)
**Typecheck:** clean (`bun run typecheck`)

This briefing requests Codex's implementation review of the four M11
commits implementing the **Provider capability contract** authority
boundary (CLAUDE.md rule 20).

Per CLAUDE.md rule 8: "Codex review at implementation completion fires
before tag." Per the `no_tech_debt_at_milestone_close` memory, all
`block-push` + `block-next-milestone` + `fix-soon` findings get closed
in follow-up commits before tag. Only `nit` + `fyi` defer.

The M11 planning-convergence debate (thread `019de44e-e8a7-7441-9d82-d79a0595f591`,
captured as `docs/research/CODEX_RESPONSE_M11.md`) returned
`accept-with-modifications` with eight decisions A-H, three substantive
flips (C strict-minimal; E mechanism-not-SKU; F sandbox deferred), and
four bug catches (error code namespace; loader path typo; loader/registry
coupling; `actionableSuggestions` shape). All twelve modifications
landed before commit 1.

## Commit set

```
ac7c1c5 feat(m11): loader eligibility check + tests          commit 4/4
391bf51 feat(m11): adapter capability + registry authority   commit 3/4 (bundled)
fa7e9cb feat(m11): provider capability defaults + tests      commit 2/4
534b56e docs(m11): pin provider capability contract surface  commit 1/4
```

## Authority boundary closed (CLAUDE.md rule 20)

M11 introduces exactly one new authority boundary: **provider
eligibility**. The capability record (`ProviderCapability`) declares
auth source + eligible phases; the load-time loader rejects
`(provider, phase)` combinations the capability says are impossible.
No other new authority surface lands.

No new persona-side frontmatter field. No company roster (M12). No
role-cost gating (M13). No reviewer panel (M14). No scheduler (M15).
No new parallel-provider surface (rule 21 — capability metadata is
sequential).

## What the M11 planning debate locked (A-H + Codex catches)

| # | Lock | Landed |
|---|---|---|
| A | List-on-provider eligibility (`eligiblePhases: readonly AgentPhase[]`); no stored reverse map | commit 2 (`src/providers/capabilities.ts`) |
| B | Restrictive defaults: claude/codex/fake = full `AGENT_PHASES`; gemini = `[]` (rule-20 teeth) | commit 2 |
| C | **Strict-minimal TS shape (Decision C flip)**: drop `editSemantics`/`shellSemantics`/`mcpSupport`/`sandboxProfile` from v0.1; document as deferred W3. v0.1 `tool_use` runtime is provider-uniform, so those fields would mark orchestrator-owned behavior as provider-owned and turn decorative slots into accidental enforcement hooks. | commit 1 (contract docs) + commit 2 (TS shape) |
| D | Doctor unchanged; no `--probe` flag; no capability probe in `health()` | commit 1 (anti-patterns), no source change |
| E | **`authSource` mechanism-specific (Decision E flip)**: `'claude-cli-oauth' \| 'chatgpt-cli-oauth' \| 'gemini-stub' \| 'in-process-fake'`; SKU labels (Max/Plus/Pro) live in prose only | commit 2 (`AUTH_SOURCES` enum) |
| F | **`sandboxProfile` deferred (Decision F flip)**: consequent of strict-minimal C; no `sandboxProfile` field at all | absent by construction |
| G | No M12 forward-compat hook in M11; check is `(provider, phase)` only | commit 4 (`enforceProviderPhaseEligibility`) |
| H | Constructor `capabilityOverrides` only (mirror `familyOverrides`); structural equality (composite — `capabilitiesEqual`) NOT reference equality; no `FakeProvider({ capability })` seam | commit 3 (`capabilitiesEqual`, registry cross-check) |
| Catch 1 | Error code in loader namespace, phase-named: `loader_provider_phase_not_eligible` (NOT `provider_role_not_eligible`) | commit 4 (`AgentLoadErrorCode`) |
| Catch 2 | Loader file is `src/agents/loader.ts` (not `load.ts`) | commit 4 |
| Catch 3 | Loader imports pure `capabilityOf()` from `src/providers/capabilities.ts`, NOT `ProviderRegistry.capabilityOf()` (registry doesn't exist at load time) | commit 4 |
| Catch 4 | `AgentLoadIssue` does NOT carry `actionableSuggestions`; rule + detail carry the fix hint | commit 4 (regression test guards this) |

## Files for review

In rough order of authority density / load-bearing-ness:

### M11 runtime (the new authority)

- **`src/providers/capabilities.ts`** (~152 lines, new) — pure
  `DEFAULT_CAPABILITY_BY_ID` lookup + `capabilityOf(id)` function +
  `capabilitiesEqual(a, b)` structural-equality helper. Frozen,
  declarative, no I/O, no test seams. Mirrors `families.ts` (M9).
- **`src/providers/registry.ts`** (changed, ~30 added lines) — adds
  `capabilityOverrides` constructor field; `capabilityOf(id)` instance
  method; structural-equality cross-check at adapter registration
  paralleling the existing family check. Anti-laundering shape: an
  adapter declaring a capability that does not match the
  registry-resolved value (with overrides applied) throws.
- **`src/providers/types.ts`** (changed, ~14 added lines) — adds
  `readonly capability: ProviderCapability` to `IAgentProvider`. Type-only
  import from `capabilities.ts` to avoid runtime cycle.
- **`src/providers/{claude,codex,gemini,fake}.ts`** (each changed) — each
  adapter declares `readonly capability: ProviderCapability =
  capabilityOf(this.id)`. Single source of truth stays in
  `capabilities.ts`.
- **`src/cli/bootstrap.ts`** (changed) — `aliasFakeProvider()` declares
  `capability: capabilityOf(targetId)` paralleling its existing family
  shape (M5). Tests that need non-default capability for an aliased
  FakeProvider construct an inline IAgentProvider literal rather than
  going through this helper.
- **`src/agents/loader.ts`** (changed) — `enforceProviderPhaseEligibility`
  step runs after `enforceCrossFamilyReview` in `buildRegistry`. Imports
  pure `capabilityOf()` (NOT registry).
- **`src/agents/errors.ts`** (changed) — `loader_provider_phase_not_eligible`
  added to `AgentLoadErrorCode`.

### Contract docs

- **`docs/references/provider-contract.md`** (changed) — § "Capability
  and eligibility (M11)" extension: TypeScript shape, default eligibility
  table, advisory cost/rate-limit guidance, authority-where-capabilities-live
  block, eligibility check shape, doctor-unchanged note, forward-compat
  for M12-M15, anti-patterns rejected by the M11 spec.
- **`docs/contracts/PROVIDERS.md`** (changed) — § "Capabilities and
  eligibility (M11)" thin user-facing extension: v0.1 defaults table,
  what M11 does and does not do.
- **`docs/research/CODEX_BRIEFING_M11.md`** (new) — planning briefing.
- **`docs/research/CODEX_RESPONSE_M11.md`** (new) — Codex round-1 response.
- **`docs/design/SESSION_M11_KICKOFF.md`** (new) — synthesis with locked
  decisions + 4-commit sequence + verification checklist.

### Tests

- **`tests/provider-capabilities.test.ts`** (~250 lines, new) — 33 tests:
  AUTH_SOURCES enum, default capability table, capabilityOf, structural
  equality (12 cases including order sensitivity, asymmetric optional
  fields, default-vs-default cross-equality), W3-deferred-fields regression
  guards.
- **`tests/providers-registry.test.ts`** (extended) — 5 new tests for the
  capability-authority surface: capabilityOf default + override path;
  cross-check rejects mismatched adapter capability without override;
  cross-check rejects adapter declaring default when override is
  non-default (laundering protection); unknown id throws.
- **`tests/agent-loader-eligibility.test.ts`** (~210 lines, new) — 11
  tests for the loader eligibility check: happy paths for claude/codex/fake
  across every phase; gemini-as-builder rejection (rule, detail, file,
  loader-namespace code, no `actionableSuggestions`); multi-issue
  aggregation; rule-order vs cross-family check; capability-source guard.
- **Existing test sites updated** to honor the new `IAgentProvider.capability`
  field: `TestProvider`/`ProxyAdapter` classes (4 files), inline
  `IAgentProvider` literals (2 files). All updates declare
  `capability: capabilityOf(id)` by default; tests requiring custom
  capability remain free to construct ad-hoc literals.

## What to verify

Per CLAUDE.md rule 8 verdict enum (`push | fix-first | debate-required`):

1. **Authority discipline (rules 20 + 21).** Has anything quietly
   preempted M12 (company roster) / M13 (role-cost) / M14 (reviewer
   panel) / M15 (scheduler)? Any new parallel-provider surface? The
   capability metadata should be sequential, the eligibility check
   load-time-only.

2. **The Codex catches really landed.** Verify:
   - Error code is `loader_provider_phase_not_eligible` (not
     `provider_role_not_eligible`); no "role" vocabulary anywhere in
     M11 code.
   - Loader imports `capabilityOf` from `src/providers/capabilities.ts`;
     loader does NOT call `ProviderRegistry.capabilityOf()`.
   - `AgentLoadIssue` has not gained `actionableSuggestions`.
   - `ProviderCapability` TS shape carries no `editSemantics`,
     `shellSemantics`, `mcpSupport`, or `sandboxProfile` field.
   - `AUTH_SOURCES` enum contains exactly the four mechanism values; no
     SKU labels in the type.

3. **Anti-laundering.** The structural-equality cross-check actually
   blocks the laundering paths the briefing claims it does. The
   registry test for "adapter declaring default when override is
   non-default" goes red without the cross-check. The `capabilitiesEqual`
   function compares every field that is part of the public TS shape
   (no silent omissions).

4. **No regression.** Existing 1761-baseline tests pass: cross-family
   REVIEW (M9), Debate runtime (M10), bootstrap aliasing,
   debate request, plan debate extract. Updated test classes and
   inline literals still exercise their original assertions.

5. **Contract / code agreement.** What `docs/references/provider-contract.md`
   § "Capability and eligibility (M11)" promises matches what
   `src/providers/capabilities.ts` and `src/agents/loader.ts` deliver.
   The defaults table in `docs/contracts/PROVIDERS.md` matches
   `DEFAULT_CAPABILITY_BY_ID`.

6. **Test rigor.** Are the loader eligibility tests load-bearing or
   merely shape-asserting? Especially the rule-order test (cross-family
   wins when both apply) — is the assertion that cross-family fires
   first actually a load-bearing claim, or a documentation of current
   ordering that could silently flip?

## Format requested

Per `docs/contracts/DEBATE.md` § "Locked first-line `Overall verdict:`
grammar" (M10), the **first non-empty line** under `## Verdict on the
decisions` MUST be:

```
Overall verdict: <enum>
```

Where `<enum>` is one of `push | fix-first | debate-required` (rule 8
review verdict enum).

Use the H2 anchors per `docs/contracts/DEBATE.md` § "RESPONSE.{codex,
claude}.md required H2 sections":

- `## Verdict on the decisions`
- `## Risks the proposing side missed`
- `## Where I disagree`
- `## What I would defer`
- `## Recommended next step`

Group findings by severity: `block-push` (must close before pushing
main), `block-next-milestone` / `fix-soon` (must close before M11 tag),
`nit` (defer ok), `fyi` (informational).

For each finding, name:
1. **Where**: file:line.
2. **Why it matters**: which rule / lock / contract surface it touches.
3. **Remediation**: concrete shape of the fix (not narrative).

The `Overall verdict` line is operational: `push` means the milestone is
ready to tag and push to `main`; `fix-first` means address the
findings on this branch first; `debate-required` means the design is
unresolved and a new planning round is needed before more code.

Sandbox: read-only.
