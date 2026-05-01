# Codex M12 implementation review brief

**Date:** 2026-05-01
**Status:** review
**Caller:** Claude (Opus 4.7, 1M context)
**Target:** gpt-5.5 xhigh, sandbox: read-only
**Cycle:** review (implementation review per CLAUDE.md rule 7 + 8)

## What you are reading

M12 (Company roster — shipped roles only) implementation closed across six commits on branch `feat/m12-company-roster`. The planning round you ran 2026-05-01 (thread `019de4bb-9623-7340-98d7-dae01f5aa2d0`) returned `accept-with-modifications` with eight decision flips, seven missed risks, and three full-stop disagreements. The synthesis lives in `docs/design/SESSION_M12_KICKOFF.md`. Each Codex catch is named in the commit messages it closes.

I want a fresh implementation review on the latest commits before tagging `v0.12.0-alpha.0`. Tests pass: 1917 pass / 1 skip / 0 fail offline. Typecheck clean. Verdict enum: `push` / `fix-first` / `debate-required`.

## Where we stand

- **Branch:** `feat/m12-company-roster` cut from `main` at `3078ac6`. Six commits applied; no tag yet.
- **HEAD:** `41d62fa` (`docs(m12): close M12 + status bump v0.12.0-alpha.0`)
- **Six commits in order:**
  1. `b4a947d` docs(m12): pin company roster contract surface — `docs/contracts/COMPANY.md` (new) + 3 planning docs
  2. `4744e06` feat(m12): config schema + loader for company:block — `src/config/{schema,load}.ts` + `tests/config-load-company.test.ts`
  3. `aabca16` feat(m12): apply company overrides at agent load + post-override checks — `src/agents/{errors,loader}.ts` + `tests/agent-loader-company.test.ts`
  4. `b485994` feat(m12): bootstrap loads config before registry — `src/cli/bootstrap.ts` + `src/commands/run.ts` + `tests/cli-bootstrap-company.test.ts`
  5. `78609f5` feat(m12): model propagation through provider invoke — `src/providers/{manifest,invoke}.ts` + `src/state/schemas.ts` + `tests/provider-invoke-model-propagation.test.ts`
  6. `41d62fa` docs(m12): close M12 + status bump v0.12.0-alpha.0 — `docs/design/ROADMAP.md`, `CLAUDE.md`, `docs/contracts/COMPANY.md` (table fix), `src/config/schema.ts`, `src/cli.ts`, `package.json`, `tests/{m5-fix-first,cli-init}.test.ts`
- **Tests:** 1917 pass / 1 skip / 0 fail. Up from M11's 1860 (+57 across the four test files M12 introduced or modified).
- **Typecheck:** clean (`bun run typecheck`).
- **Local main:** still 9 commits ahead of `origin/main` from M11; M12 sits on top of `feat/m12-company-roster`. Push pending Ozzy's explicit approval per CLAUDE.md rule 5.
- **Authority boundary (CLAUDE.md rule 20):** role-to-provider routing only.

## What is locked (do not relitigate)

These are the M12 planning round's locks, applied in this implementation:

1. **Six-name roster only.** `M12_COMPANY_ROLES = ['ba', 'lead', 'builder', 'verifier', 'reviewer', 'scientist']`. Project-local personas with names outside this list are NOT routable as company roles. Custom role routing is M16+.
2. **`{ provider?, model? }` only per row.** Per-role budgets are M13; permissions stay persona-shaped. Unsupported row keys (`permissions`, `budgets`, `bash`) raise `config_invalid_value` (fail-closed).
3. **Config-wins override semantics.** The `company:` block wins over persona frontmatter. Resolved values feed cross-family REVIEW (rule 2), provider eligibility (M11), the post-override debate-family check, and runtime invocation.
4. **Override application point.** Pure `applyCompanyOverrides` between bundled-vs-override merge and the resolved-provider checks in `src/agents/loader.ts`.
5. **One new error code.** `loader_company_role_unknown`. All other failures reuse existing codes (`config_invalid_shape`, `config_invalid_value`, `loader_cross_family_violation`, `loader_provider_phase_not_eligible`, `schema_invalid_permissions`).
6. **Bootstrap wiring fix.** `loadConfig` runs before `bootstrap` at both `src/commands/run.ts` call sites; `bootstrap({ cwd, config })` threads `config.company` through `loadRegistry`.
7. **Model propagation fix.** `req.model ?? req.agent.model` defaulting in `buildManifest`. `agent_invoked.model` records the resolved value (forward-compat optional field).
8. **AgentLoadIssue shape unchanged.** No `actionableSuggestions` field; `rule` + `detail` carry the fix hint. Same lock as M11.
9. **Tests interleave per commit.** No test-only final commit; commit 6 only adjusts existing tests for the version bump.
10. **Subscription-first auth model preserved.** M12 does not touch auth.
11. **No xAI pre-add.** `mergeCompany` validates `provider` against the shared `AGENT_PROVIDERS` enum so PE-1's enum extension flows in without an M12 schema migration.

## What I want you to verify

The block-push budget is concerns that prevent a clean tag. The fix-first budget is concerns that should be addressed before tag but do not require pause-for-debate. The fyi/nit budget is everything below those bars.

Pressure-test against:

1. **Authority creep.** Did anything beyond role-to-provider routing slip in? Specifically: does any commit touch budgets, panels, debate-opponent scheduling, or any of the M16+ deferred items?
2. **Codex Risk #1 (shipped-role boundary).** Verify `loader_company_role_unknown` fires for keys not in `M12_COMPANY_ROLES` even when a project-local persona of that name loads. Both at config-load (`mergeCompany`) and at agent-load (`applyCompanyOverrides` defensive backstop).
3. **Codex Risk #2 (bootstrap order).** Verify both `runCommand()` and `dispatchPlan()` flip the order. The defensive smoke test in `tests/cli-bootstrap-company.test.ts` shows pre-M12 bootstrap (no config) yields claude routing while M12 bootstrap (with config) yields codex routing for the same YAML.
4. **Codex Risk #3 (model propagation).** Verify the wrapper passes `req.model ?? req.agent.model` to the adapter and that `agent_invoked.model` records the resolved value. Latent bug: this also fixes pre-M12 frontmatter `agent.model` being silently dropped.
5. **Codex Risk #4 (post-override debate-family).** Verify `enforceDebateOpposingFamilyAfterOverride` re-runs the opposingProviders cross-family invariant against the resolved family, raising `schema_invalid_permissions` at load time.
6. **Codex Risk #5 (unsupported field silence).** Verify `mergeCompany` rejects unsupported row keys (`permissions`, `budgets`, `bash`) with `config_invalid_value` and surfaces every unsupported key, not just the first.
7. **Codex Risk #6 (override cascade).** Verify the precedence test (bundled < project-local < company) in `tests/agent-loader-company.test.ts`.
8. **Codex Risk #7 (test seam leakage).** Verify M12 loader tests use real `capabilityOf` defaults (e.g., `gemini` for ineligibility), not M11's `capabilityOverrides` registry seam.
9. **Doc/code agreement.** `docs/contracts/COMPANY.md` should match the implementation in `src/config/{schema,load}.ts` + `src/agents/loader.ts` + `src/cli/bootstrap.ts` + `src/providers/manifest.ts`. Look for drift in error codes, field names, or load order.
10. **Backward compatibility.** `defaultProvider` and `models.{primary, reviewer}` should coexist silently with `company:`. Verify M12 did not deprecate them and did not introduce false-fallback prose.
11. **Forward-compat.** `agent_invoked.model` is an optional new field; M11 readers should parse new events identically. M13's role-cost policy will read this against `budgets.global.priceTable`.
12. **Test interleaving discipline.** No test-only final commit (Codex M11 catch). Commit 6 is allowed to adjust test fixtures (version bumps in `tests/m5-fix-first.test.ts` and `tests/cli-init.test.ts`) since those are mechanical fallout, not new test coverage.
13. **Version triplet consistency.** `PKG_VERSION` (`src/cli.ts`), `DEFAULT_CONFIG.version` (`src/config/schema.ts`), and `package.json` `version` should all match `0.12.0-alpha.0`. M11 missed all three; M12 commit 6 catches up. The `m5-fix-first.test.ts` regression test was refactored to use a `CURRENT` constant so future bumps update one place.

## What is OK to defer to nit/fyi

- Cosmetic prose drift in COMPANY.md or other docs (rule + detail field naming, comment wording).
- Test-name renaming or describe-block reorganization.
- Inline comment expansion or contraction.
- The "loader_*" prefix on `loader_company_role_unknown` — the synthesis kickoff acknowledges the prefix names the conceptual layer, not the call site.

## What I want from you

A response in this format (verbatim sections):

```markdown
# Codex M12 implementation review (round 1)

**Thread:** <thread id>
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Brief:** docs/research/CODEX_BRIEFING_M12_REVIEW.md
**HEAD reviewed:** 41d62fa (six commits on feat/m12-company-roster)

## Verdict on the decisions

Overall verdict: <push | fix-first | debate-required>

<one or two paragraphs framing the verdict>

### block-push

<numbered list, each with Where / Why it matters / Remediation; empty if none>

### fix-soon

<numbered list, each with Where / Why it matters / Remediation; empty if none>

### nit

<numbered list>

### fyi

<numbered list>

## Risks the proposing side missed

<numbered list>

## Where I disagree

<paragraph or list>

## What I would defer

<paragraph or list>

## Recommended next step

<one paragraph: tag as-is, one closure round, or pause>
```

Sandbox: read-only. You may read any file in the repo for context. Run any verification commands you want; the test suite is offline-deterministic. Cite thread id verbatim per CLAUDE.md rule 7 + DEBATE.md format.
