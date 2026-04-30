# code-oz — M6 Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-30
- **Thread ID:** `019ddc73-7922-7942-bbe0-35cc8c0a800f`
- **Briefing:** [`CODEX_BRIEFING_M6.md`](./CODEX_BRIEFING_M6.md)
- **Prior round (synthesis):** [`docs/research/CODEX_RESPONSE_SYNTHESIS.md`](../research/CODEX_RESPONSE_SYNTHESIS.md), thread `019ddc5f`

Verbatim reply below.

---

Verdict: proceed-with-modifications

**Where I agree**

1. Substrate-first is directionally right. M6 is now explicitly PLAN + repo-context MVP + Scientist substrate + `budgets.global` extension, not just a persona-prompt milestone ([docs/design/ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:106), [docs/design/ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:121), [docs/research/MERGE_PLAN.md](/Users/ozzy-mac/Projects/code-oz/docs/research/MERGE_PLAN.md:110)). Build the contracts, parsers, permission schema, events, budgets, and tools before trusting the PLAN persona.

2. DEFINE retro-seed should stay opt-in in M6. The roadmap already locks this as `phases.scientist.retroSeedDefine: true`, default-off, and explicitly says it must not reopen M5 ([docs/design/ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:137)). That is the right compatibility posture because M5 shipped a valid DEFINE gate flow whose canonical artifact is `SPEC.md`, not Scientist sidecars.

3. Run-scoped H-ids are right for M6. The Scientist dossier already says hypotheses survive across phases and keep stable `H-NNN` ids ([docs/research/05-scientist-and-open-questions-agent.md](/Users/ozzy-mac/Projects/code-oz/docs/research/05-scientist-and-open-questions-agent.md:147)). Cross-run identity belongs with W2 memory, not this milestone.

4. `rg`-backed repo-context is acceptable for M6, but do not pretend `package.json` engines can declare it. The repo currently declares only Bun in `engines` ([package.json](/Users/ozzy-mac/Projects/code-oz/package.json:18)); make `code-oz doctor repo-context` or `doctor tools` check `rg`, and make missing `rg` produce actionable intervention text. A JS fallback is W3 polish, not M6.

5. Auto-generated `## Available tools` in `src/prompts/plan-system.md` is the right prompt shape. Permissions are upper bounds and the runtime sends explicit manifests, not recursive context ([docs/references/agent-skill-format.md](/Users/ozzy-mac/Projects/code-oz/docs/references/agent-skill-format.md:122)). Generate from `agent.permissions.tool_use.repo_context.tools`, then add a test that the rendered prompt cannot name a tool absent from permissions.

**Where I disagree (with specific alternative)**

1. Prompt 1's `maxBytesPerResult: 64KB` is too high as a global default. Current token estimation is prompt + file bytes divided by four ([src/providers/cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:36)), and PLAN's default phase cap is 300,000 tokens ([src/config/schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:103)). Twenty selected 64KB files alone estimate at roughly 327,680 tokens before the prompt, `SPEC.md`, docs cache, or search-result digest. Lock: `maxResults: 50`, `maxBytesPerResult: 16_384`, `maxFilesForNextManifest: 20`, `timeoutMs: 5000`, `network: 'none'`. Do not raise Lead to 30 until fixture data proves it; if large reads matter, add chunked `read` semantics later instead of inflating the default.

2. Prompt 2 is missing two load-bearing commits and has budget accounting too late. Add `docs/contracts/SCIENTIST.md` before sidecar parsers because rule 15 points there as the mechanics authority ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:34), [docs/research/MERGE_PLAN.md](/Users/ozzy-mac/Projects/code-oz/docs/research/MERGE_PLAN.md:26)). Also move universal rules into M6 before `plan-system.md`; current CLAUDE.md says every persona prompt imports `src/prompts/universal-rules.md` ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:35)), so shipping a new PLAN persona without it makes the repo rule false.

3. Alternative commit sequence: 1. contracts for PLAN/SOURCE_CHECK/REPO_CONTEXT/SCIENTIST/HYPOTHESES/OPEN_QUESTIONS, 2. PLAN/SOURCE_CHECK parsers, 3. HYPOTHESES/OPEN_QUESTIONS parsers and atomic writers, 4. `AgentPermissions.tool_use.repo_context`, 5. event types and validators, 6. `budgets.global` extension plus `budget_warning`, 7. repo-context tools, 8. source-check resolvers and offline docs cache, 9. Scientist persona and phase-tail runner, 10. loose gate-preflight helper, 11. universal-rules prompt asset and composer injection, 12. Lead persona plus PLAN prompt, 13. PLAN orchestrator and `run.ts` wiring, 14. e2e, CLI help, docs, tag. This lowers risk because every artifact has a contract before code, budget semantics exist before tool events, and the persona only lands after its prompt substrate is real.

4. Prompt 4 should not count repo-context searches as `maxProviderCalls`. `maxProviderCalls` currently means `agent_invoked` events emitted by the wrapper ([src/providers/cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:95), [src/providers/invoke.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/invoke.ts:98)). Cleaner accounting: provider calls stay provider calls; repo searches count against the existing tool-call cap when model-issued, emit `repo_context_searched` with `resultBytes` and `resultTokensEstimate`, and any rendered search-result digest included in the next prompt is counted by that next `agent_invoked.tokensEstimate`. Selected files are counted through the next manifest, preserving the manifest audit invariant ([docs/references/file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:168)).

5. Prompt 6's PLAN.md task shape is malformed. "Each task is one bullet `### Task N`" mixes a bullet contract with an H3 heading contract. Use H3 task blocks only under `## Tasks`; keep other H2 bodies bullet-only. Sketch: `# PLAN`, `## Goals`, `## Tasks`, `### T-001: <title>`, `- Files: ...`, `- Validation: ...`, `- Risk: ...`, `- Hypotheses: H-001`, `- Sources: SC-SPEC-001, SC-REF-001, SC-DOC-001`, then `## Sources`, `## Out of scope`, `## Open questions`. Drop cross-cutting `## Risks`; per-task `Risk` plus `OPEN_QUESTIONS.md` is cleaner.

6. Prompt 7's SOURCE_CHECK.md should not be only aggregate sections. Aggregate sections without stable source ids make it hard for tasks to prove which evidence they rely on. Use ids: `SC-SPEC-001`, `SC-REF-001`, `SC-DOC-001`, plus a `## Coverage` section mapping `T-001 -> SC-SPEC-001, SC-REF-001, SC-DOC-001`. For none-found cases, keep the explicit rationale but give it an id, e.g. `SC-REF-NONE-001`, so PLAN tasks can cite the absence deliberately.

7. Prompt 9 should use loose coupling, not Scientist-aware `requireGate`. `requireGate` currently appends `gate_required` and rebuilds `current.json` only ([src/state/run.ts](/Users/ozzy-mac/Projects/code-oz/src/state/run.ts:446)); pushing sidecar parsing and overdue-question semantics into it makes state machinery depend on a discipline that will evolve. Put `validateScientistSidecars({ phase, artifactRoot })` in `src/phases/scientist.ts` or `src/phases/gate-preflight.ts`, call it from `plan.ts` before `requireGate`, and have it write `NEEDS_INTERVENTION.json` plus `intervention` when blocked. M7 adds three more call sites, BUILD/VERIFY/REVIEW; that duplication is mechanical and cheaper than coupling `run.ts` to every future sidecar contract.

8. Prompt 12 should flip to M6. The roadmap says universal rules ship in M7 ([docs/design/ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:160)), but CLAUDE.md already states every persona prompt imports them ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:35)). Do not knowingly ship an M6 PLAN persona that violates the repo's own non-negotiable rule. Add `src/prompts/universal-rules.md` and inject it into DEFINE + PLAN in M6; M7 can expand injection to BUILD/VERIFY/REVIEW when those prompts land.

**Decisions you must lock before code**

1. Lock repo-context caps as `50 / 16KB / 20 / 5000ms / none`, with no Lead override above 20 until fixture data proves the need.

2. Lock `repo_context_searched` accounting: not a provider call; event records result bytes/tokens; next prompt and next manifest do the actual token/byte counting.

3. Lock PLAN.md task grammar: H3 task blocks under `## Tasks`, stable `T-NNN` ids, required `Files`, `Validation`, `Risk`, `Hypotheses`, and `Sources`.

4. Lock SOURCE_CHECK.md source ids plus `## Coverage`; do not rely on aggregate section names alone.

5. Lock loose gate-preflight: phase code calls Scientist validation before `requireGate`; `run.ts` remains generic state orchestration.

6. Lock M6 inclusion of `docs/contracts/SCIENTIST.md`, `src/agents/defaults/scientist.md` v0.1 body, and `src/prompts/universal-rules.md`.

7. Lock docs-source offline behavior: Context7/live docs may populate cache, but FakeProvider e2e uses local cached docs or explicit `No library` rationale, never network.

8. Lock missing `rg` behavior: doctor detects it, repo-context tools fail with an actionable typed error, and no JS fallback is required in M6.
