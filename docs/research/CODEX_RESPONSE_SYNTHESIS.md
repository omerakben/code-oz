# code-oz — research synthesis Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-30
- **Thread ID:** `019ddc5f-0a68-7d42-a864-71095153fb08`
- **Briefing:** [`CODEX_BRIEFING_SYNTHESIS.md`](./CODEX_BRIEFING_SYNTHESIS.md)
- **Synthesis under review:** [`SYNTHESIS.md`](./SYNTHESIS.md) (commit `e5191aa`)
- **Bundle commit:** `a3eea10`

Verbatim reply below.

---

Verdict: proceed-with-modifications

**Where I agree**

1. Phase-tail Scientist is the right direction, not a new milestone. Option E is explicitly spine-first through DEFINE → PLAN → BUILD-lite → VERIFY-lite → REVIEW-lite, with M6 as PLAN and M7 as the end-to-end demo path ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:53), [ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:106), [ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:110)). A standalone M-Scientist would violate the spirit of the spine path even if it does not literally add a new phase.

2. Codebase context retrieval belongs in M6. PLAN cannot honestly produce `SOURCE_CHECK.md` without finding local reference implementations and docs-adjacent files; dossier 04 names this as the first real-world blocker ([04-missing-pieces-brainstorm.md](/Users/ozzy-mac/Projects/code-oz/docs/research/04-missing-pieces-brainstorm.md:12)), and the M6 acceptance requires SOURCE_CHECK to name reference and docs evidence ([ROADMAP.md](/Users/ozzy-mac/Projects/code-oz/docs/design/ROADMAP.md:106)). The better reason is not ambition velocity, it is that rule 3 already makes 3-source verification mandatory before code ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:22)).

3. Prompt 4 should stay event-log-first. The current wrapper already reads `events.jsonl` under the pre-call lock before every provider call ([invoke.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/invoke.ts:91)), `assertWithinBudget` already summarizes per-phase and global totals from events ([cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:72)), and `current.json` is explicitly non-authoritative ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:184)). A running counter in `current.json` is premature state sync risk.

4. The epistemic sidecar idea is real. Assumption propagation and false completion are named failure families with structural corrections, not vibes ([02-llm-failure-research.md](/Users/ozzy-mac/Projects/code-oz/docs/research/02-llm-failure-research.md:290), [02-llm-failure-research.md](/Users/ozzy-mac/Projects/code-oz/docs/research/02-llm-failure-research.md:343)). Dossier 05's key contribution is sound: `HYPOTHESES.md` and `OPEN_QUESTIONS.md` survive across phases and are read before gates ([05-scientist-and-open-questions-agent.md](/Users/ozzy-mac/Projects/code-oz/docs/research/05-scientist-and-open-questions-agent.md:18)).

**Where I disagree (with specific alternative)**

1. Rule 15 is right concept, wrong CLAUDE.md shape. Do not put the full schema and rejection logic into CLAUDE.md as proposed in SYNTHESIS ([SYNTHESIS.md](/Users/ozzy-mac/Projects/code-oz/docs/research/SYNTHESIS.md:17)); it is too detailed for the universal rule sheet budget ([02-llm-failure-research.md](/Users/ozzy-mac/Projects/code-oz/docs/research/02-llm-failure-research.md:422)). Right shape: add one CLAUDE.md rule, then put mechanics in `docs/contracts/SCIENTIST.md`: `15. Epistemic sidecars at phase gates. Every phase contract that produces a primary artifact must include the Scientist tail defined in docs/contracts/SCIENTIST.md; gate preflight validates HYPOTHESES.md and OPEN_QUESTIONS.md and blocks overdue open questions before writing GATE_<PHASE>_PASSED.json.`

2. Prompt 2 should be a no on leaked-source borrowing. The project already says patterns are borrowed with no code dependencies, no submodules, and no copy-paste ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:46)), but leaked corporate source adds a provenance asterisk that will hurt trust more than it helps M6. What we lose: mature edge cases around tool routing, result shaping, hook behavior, permission UX, and LSP heuristics. Clean-room timeline: 4 to 6 working days for an M6-safe MVP using public `claude-code` docs/patterns, `opencode` permissions, and `agent-skills`: contract + permissions, `rg`-backed glob/grep, capped targeted reads into the next manifest, then optional TypeScript symbol lookup. Deeper LSP can move to M7/W3.

3. Rule 18 is also wrong-shaped if it becomes a broad generic `tool_use` without a repo-context sub-scope. The current agent permission shape is only `read`/`write`/`bash` ([schema.ts](/Users/ozzy-mac/Projects/code-oz/src/agents/schema.ts:43)), and provider requests intentionally carry file paths only until the wrapper builds the manifest ([provider-contract.md](/Users/ozzy-mac/Projects/code-oz/docs/references/provider-contract.md:41)). Right shape:

```ts
interface AgentPermissions {
  read: '*' | readonly string[]
  write: '*' | readonly string[]
  bash: 'deny' | readonly string[]
  tool_use?: {
    repo_context?: {
      tools: readonly ('glob' | 'grep' | 'read' | 'symbol')[]
      roots: readonly string[]
      maxResults: number
      maxBytesPerResult: number
      maxFilesForNextManifest: number
      timeoutMs: number
      network: 'none'
    }
  }
}
```

4. Rule 18 also needs the right event and manifest flow. Search should produce candidate paths and audit events, not raw hidden context in the same provider call. Add `repo_context_searched` with `{ phase, agent, tool, query, roots, resultPaths, selectedPaths }`; then selected files become `ProviderRequest.files` on the next invocation so `agent_invoked.manifest` remains the audit source for bytes actually sent ([file-based-gates.md](/Users/ozzy-mac/Projects/code-oz/docs/references/file-based-gates.md:168)). This preserves rule 13's explicit manifest model ([CLAUDE.md](/Users/ozzy-mac/Projects/code-oz/CLAUDE.md:32)).

5. The Scientist phase-tail is separable by phase, but not by substrate. These must land together before any gate blocks on Scientist: `docs/contracts/HYPOTHESES.md`, `docs/contracts/OPEN_QUESTIONS.md`, parsers/serializers, atomic writers, event types, and one gate preflight that can validate the sidecars. These can land later: `src/agents/defaults/scientist.md` polish, list/resolve CLI commands, cross-run `.codeoz/memory/scientist/`, older-than-N re-verification, primary-artifact H/Q citations, and the designer/reflection loop. If gate-blocking lands without the writer/parser package, M6 will deadlock itself.

6. Do not add `budgets.run` as a new namespace. The current schema already has cumulative `budgets.global.maxTurns`, `maxProviderCalls`, and `maxTokensEstimate` ([schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:11), [schema.ts](/Users/ozzy-mac/Projects/code-oz/src/config/schema.ts:92)), and `cost.ts` already enforces global totals ([cost.ts](/Users/ozzy-mac/Projects/code-oz/src/providers/cost.ts:67)). The concrete alternative is to extend `budgets.global` with `maxWallTimeMinutes`, `softWarnAtRatio`, and optional price-table settings, not create a parallel run budget object.

**Decisions you must lock before merge**

1. Rule 15 wording: approve the short CLAUDE.md pointer plus `docs/contracts/SCIENTIST.md`, or explicitly accept detailed Scientist mechanics inside CLAUDE.md.

2. Provenance policy: ban `claude-code-main` leaked-source borrowing and document it as excluded, or accept the provenance risk as a user-owned values call before M6 starts.

3. M6 repo-context MVP: lock the tool set as `glob`, `grep`, `read`, and optional `symbol`; lock result caps; lock the `repo_context_searched` event shape; lock that selected results enter only through the next manifest.

4. Scientist landing package: decide whether M6 wires only PLAN tail first, with BUILD/VERIFY/REVIEW in M7, and whether DEFINE gets retro-seeded from SPEC without reopening M5.

5. Budget naming: keep cumulative run caps under `budgets.global` and add wall-time/dollar fields there, or deliberately rename the existing budget model before M6. My recommendation is keep `budgets.global`.
