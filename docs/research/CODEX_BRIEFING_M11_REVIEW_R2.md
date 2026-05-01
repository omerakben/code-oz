# Codex briefing — M11 implementation review round 2

**Branch:** `feat/m11-provider-capability`
**Range:** `main..HEAD` = 5 commits
**HEAD:** `0002dc1` (round-1 closure follow-up)
**Tag target:** `v0.11.0-alpha.0` (not yet cut)
**Tests:** 1860 pass / 1 skip / 0 fail (offline)
**Typecheck:** clean

This is the round-2 implementation review for M11 per CLAUDE.md rule 8.
The pattern is empirically validated by M9/M10: round 2 catches bugs
round 1's fix introduced. M9 and M10 both ran three rounds before
verdict `push`.

Round 1 verdict: `fix-first` (CODEX_REVIEW_M11.md, thread
`019de46d-b8c9-7f13-8257-81b572121306`). One block-push, one fix-soon,
two nits — all closed in `0002dc1`.

## What changed since round 1

```
0002dc1 fix(m11): close Codex M11 round-1 review findings
ac7c1c5 feat(m11): loader eligibility check + tests          commit 4/4
391bf51 feat(m11): adapter capability + registry authority   commit 3/4
fa7e9cb feat(m11): provider capability defaults + tests      commit 2/4
534b56e docs(m11): pin provider capability contract surface  commit 1/4
```

The round-1 closure commit (`0002dc1`) made these targeted changes:

### bp#1 closure — synthetic debate-opponent eligibility

**Files touched:**
- `src/agents/loader.ts` — `enforceProviderPhaseEligibility` extended.
  After the existing per-agent (provider, phase) check, the function
  now walks every persona's `permissions.tool_use.debate.opposingProviders`
  and asserts each opposing provider is eligible for the persona's
  own phase. Reuses `loader_provider_phase_not_eligible` — no new
  error code, no new authority surface.
- `tests/agent-loader-eligibility.test.ts` — three new regression
  tests:
  - `phase=plan + opposingProviders=[gemini]` rejects with the
    M11 code, rule cites "opposingProviders", detail names the
    offending opposingProvider + persona phase + `[]` empty
    eligibility list.
  - `phase=plan + opposingProviders=[codex]` passes (codex eligible
    for every phase).
  - Multi-entry list `[codex, gemini]` reports exactly the gemini
    issue (codex passes, only the ineligible entry surfaces).
- `tests/agent-load-tool-use-debate.test.ts` — two existing M10-era
  tests that demonstrated cross-family schema acceptance with
  `opposingProviders: ['codex', 'gemini']` updated to `['codex', 'fake']`
  (both are different families from claude AND eligible). Comments
  added documenting the M11 narrowing: cross-family schema invariant
  stays broad; the loader-layer eligibility check narrows the universe
  of valid opposing providers.

### fs#1 closure — canonical interface snippet

**Files touched:**
- `docs/references/provider-contract.md` — the original `IAgentProvider`
  TS snippet at the top of the doc gained
  `readonly capability: ProviderCapability` with a pointer to the
  § "Capability and eligibility (M11)" section.

### nit#1 closure — function-name drift

**Files touched:**
- `docs/references/provider-contract.md` § "Eligibility check (load
  time)" — prose updated from
  `validateProviderPhaseEligibility(loadedAgents)` to
  `enforceProviderPhaseEligibility(definitions)`. Also updated to
  document the `tool_use.debate.opposingProviders` walk added by bp#1.
- `docs/design/SESSION_M11_KICKOFF.md` — same prose update with a
  pointer to CODEX_REVIEW_M11.md bp#1 thread.

### nit#2 closure — stale review-phase skip

**Files touched:**
- `tests/agent-loader-eligibility.test.ts` — three happy-path loops
  no longer skip `phase: 'review'`. Comment added explaining the
  cross-family enforcement only fires when both BUILD and REVIEW
  agents are present, so a single-agent test does not trigger it.

## What to verify

Per CLAUDE.md rule 8 verdict enum (`push | fix-first | debate-required`):

1. **bp#1 closure is correct.** Does the new opposingProviders walk in
   `enforceProviderPhaseEligibility` actually close the synthetic
   debate-opponent bypass? Does it correctly reject the gemini case
   without false positives on legitimate cross-family-eligible cases?
   Are there other runtime-synthesized agents in the codebase that
   inherit a `(provider, phase)` from a permission list and would
   need the same load-time treatment?

2. **The closure did not introduce new bugs.** This is the empirical
   round-2 catch zone:
   - Are the two tests in `agent-load-tool-use-debate.test.ts` still
     testing what they claimed? Did changing the opposing-provider list
     inadvertently weaken what they assert?
   - The new debate-eligibility check runs inside the same
     `enforceProviderPhaseEligibility` function; does any path produce
     a duplicate issue (e.g., a persona that is itself ineligible AND
     declares ineligible opposingProviders)?
   - The `loader_provider_phase_not_eligible` rule string differs
     between the persona-side check and the opposingProviders-side
     check. Is the rule string disambiguating clearly enough that
     downstream tools or test assertions can distinguish them?

3. **Doc / code agreement.** The canonical interface snippet now
   carries `readonly capability: ProviderCapability`. The function-name
   drift (validate vs enforce) is fixed in two places — are there
   other prose mentions still pointing at the old name?

4. **No new authority surface.** The bp#1 fix lives in the existing
   `enforceProviderPhaseEligibility` function under the existing
   `loader_provider_phase_not_eligible` code. Did anything else creep
   in? CLAUDE.md rule 20 (one boundary per milestone) and rule 21 (no
   new parallel-provider surface) should still hold.

5. **Test count + regression posture.** 1860 pass / 1 skip / 0 fail
   offline. M9/M10 e2e flows still pass.

## Files for review

In rough order of round-1-closure impact:

- `src/agents/loader.ts` — the bp#1 fix.
- `tests/agent-loader-eligibility.test.ts` — three new regression
  tests + the nit#2 comment cleanup.
- `tests/agent-load-tool-use-debate.test.ts` — two updated M10-era
  tests for the M11 narrowing.
- `docs/references/provider-contract.md` — fs#1 + nit#1 fixes.
- `docs/design/SESSION_M11_KICKOFF.md` — nit#1 fix.
- `docs/research/CODEX_REVIEW_M11.md` — round-1 verdict + findings.

## Format requested

Per `docs/contracts/DEBATE.md` § "Locked first-line `Overall verdict:`
grammar": the **first non-empty line** under `## Verdict on the
decisions` MUST be:

```
Overall verdict: <enum>
```

Where `<enum>` is `push | fix-first | debate-required`.

H2 anchors per `docs/contracts/DEBATE.md`:

- `## Verdict on the decisions`
- `## Risks the proposing side missed`
- `## Where I disagree`
- `## What I would defer`
- `## Recommended next step`

Group findings by severity (`block-push` / `fix-soon` / `nit` / `fyi`).
Each finding names where (file:line), why it matters (rule / lock /
contract surface), and remediation (concrete shape, not narrative).

If verdict is `push`: M11 tags as `v0.11.0-alpha.0` and merges to main.
If verdict is `fix-first`: round-3 closure follows the same pattern.

CLAUDE.md rule 9: your verdict is data, not authority. Sandbox:
read-only.
