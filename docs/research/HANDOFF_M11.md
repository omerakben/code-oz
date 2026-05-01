# Handoff — start of M11 (Provider capability contract)

**Last session ended:** 2026-05-01. M10 + 5 follow-up commits pushed to `origin/main` (commit `118a9ab`). All Codex M10 review findings closed; only n#1 (line-anchored `<debate-request>` tag detection) remains deferred per Codex.

**Branch state:** `main` clean, in sync with `origin/main`. Tag `v0.10.0-alpha.0` pushed.

**Next milestone:** M11 — Provider capability contract.

---

## What M11 is

Per `docs/design/ROADMAP.md`: **Authority boundary: provider eligibility.**

Add capability / auth / cost traits per provider:
- edit semantics
- shell semantics
- OAuth source
- MCP support
- sandbox profile
- rate limits
- cost-per-1M-tokens
- role eligibility

**Load-time rejection of impossible role assignments.**

No new roles in M11. Lands as `docs/contracts/PROVIDERS.md` extension.

CLAUDE.md rule 20 (one new authority boundary per milestone): M11's boundary is provider eligibility. Don't bundle anything else in.

## Recommended kickoff sequence

1. **Branch off main:**
   ```
   git checkout -b feat/m11-provider-capability
   ```

2. **Read pinned contracts before drafting decisions** (per the `feedback_contract_first_reading` memory):
   - `docs/contracts/PROVIDERS.md` (existing thin definition)
   - `docs/contracts/REPO_CONTEXT.md`, `docs/contracts/BUILD.md`, `docs/contracts/REVIEW.md`, `docs/contracts/DEBATE.md` (current callers of provider semantics)
   - `src/providers/types.ts`, `src/providers/registry.ts`, `src/providers/families.ts` (current runtime shape)
   - `src/agents/schema.ts` (current persona-side declaration of which provider runs which role)

3. **Codex planning-convergence debate** (CLAUDE.md rule 7):
   - Author `docs/research/CODEX_BRIEFING_M11.md` with: goal, what's locked, what's up for debate, recommended path, decision prompts, what you want from Codex.
   - Lock open questions early so Codex doesn't relitigate v0.1 scope.
   - Likely decisions to lock BEFORE the debate:
     - PROVIDERS.md ships TypeScript shapes (vs. JSON schema)
     - Capability traits live on the registry (vs. on per-persona declarations)
     - Edit/shell semantics use existing M9 family-aware loader pathway
     - Rate-limits & cost-per-1M-tokens are advisory in M11 (enforcement = M13)
   - Likely decisions worth debating:
     - Should role eligibility be expressed as a `roles: string[]` on each provider entry, or as a separate `roleEligibility:` map keyed by role?
     - How does M11 handle a configured provider that fails a runtime capability probe (`code-oz doctor`)? Hard error, soft warning, or degrade-gracefully?
     - Where does the OAuth source declaration belong — provider entry or environment? (Affects M3 ChatGPT-account fallback path.)
     - Per-provider sandbox profile: enum (read-only / workspace-write / danger-full-access) vs. per-role profile.
   - Run Codex via `mcp__plugin_agent-codex_codex-native__codex` with `model: gpt-5.5`, `xhigh` reasoning, `sandbox: read-only`. Capture as `docs/research/CODEX_RESPONSE_M11.md` with the thread id.
   - Synthesize into `docs/design/SESSION_M11_KICKOFF.md` BEFORE any code lands. Lock the absorbed decisions; keep an open list for what's still debatable.

4. **One authority boundary** (rule 20): the M11 commit sequence ships only the capability contract + load-time rejection. No company roster (M12), no per-role cost gating (M13), no panels (M14), no scheduler (M15).

5. **Ship discipline** (CLAUDE.md rule 8): when implementation is ready for tag, run a Codex implementation review on the diff. Round-3 push verdict closes the milestone. Per the `no_tech_debt_at_milestone_close` memory, all bp + fs findings close before tag.

## Open follow-ups still on the books (not M11 scope)

These are noted so they don't get lost; address as appropriate per their own triggers, not as part of M11:

- **n#1 (deferred from M10 round 1)**: `extractDebateRequest` line-anchored tag detection in `src/tools/debate-request-extract.ts`. Quoted-YAML edge case where `<debate-request>` appears inside a YAML scalar would currently false-trigger `multiple`. Fix with line-anchored regex; defer until a real persona response trips it.
- **M9 audit M1 + M2** (deferred from M9 audit): duplicate parsing helpers across `src/artifacts/*.ts`. The "DRY at 3x" rule has not yet triggered. If a third helper is added in M11+, time to abstract.

## Quick reference

- Run dev CLI: `bun run dev init`, `bun run dev run`, `bun run dev doctor`
- Tests: `bun test` (offline; 1808 pass / 1 skip / 0 fail at session close)
- Typecheck: `bun run typecheck` (clean at session close)
- Build native binary: `bun run build:binary` → `dist/code-oz`

## Authority boundary cheat-sheet (CLAUDE.md rule 20)

| Milestone | Authority closed |
|---|---|
| M7 | worktree isolation + BUILD artifact authority |
| M8 | VERIFY evidence authority + restart-on-fail policy |
| M9 | cross-family REVIEW authority |
| M10 | Debate runtime authority (`requestDebate()` primitive) |
| **M11 (NEXT)** | **provider eligibility (capability + role + auth + cost traits)** |
| M12 | Company roster (shipped roles only) |
| M13 | Role-cost policy under `budgets.global` |
| M14 | Reviewer panel v1 (first simultaneous-provider surface) |
| M15 | Debate-policy scheduler v1 (single-opponent only) |
