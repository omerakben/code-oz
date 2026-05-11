---
name: codex-briefing-comparison-archon
companion-docs: COMPARISON.md, ../../references/provider-contract.md, ../../contracts/WORKTREE.md
target: Codex pressure-test of the Archon comparison and the proposed B1/B2/B3/B5 borrow set
status: ready for `mcp__plugin_agent-codex_codex-native__codex` invocation, gpt-5.5 xhigh, sandbox: read-only
---

# Codex briefing: Archon comparison and B1/B2/B3/B5 borrow set

## What you are reviewing

I have written a head-to-head comparison between code-oz (the project you have been reviewing since M2) and Archon (`coleam00/archon`, MIT, Bun monorepo at v0.3.10), an open-source **harness builder for AI coding** that ships 17 default workflows and binds them to multi-platform adapters (Web, CLI, Slack, Telegram, GitHub, Discord). Archon is one of the seven templates in the CLAUDE.md influence library, credited with two specific borrows: `IAgentProvider` interface and worktree-per-run isolation. This is the first time we have sat down to ask whether those two borrows aged well, whether Archon has *other* patterns code-oz hasn't extracted, and where the categories diverge.

The full comparison is in `docs/comparison/04-archon/COMPARISON.md`. The bottom line:

- The two seed borrows (`IAgentProvider`, worktree-per-run isolation) have absorbed M11/M13/M16 evolution cleanly without architectural drift. The influence-library policy works.
- code-oz is ahead of Archon on 13 disciplinary axes (gate-file authority, cross-family review, run-level cumulative budgets, universal anti-slop, maestro discipline, scientist tails, 3-source verification, permission manifests, privacy by default, brownfield AUDIT, rule 20, rule 21, cross-model peer review).
- Roughly 60 percent of Archon's surface area is out of category for code-oz: multi-platform adapters, Web UI, auth-service, Docker/Caddy deployment, SQL migrations, DAG flexibility. code-oz is local-first repo-native; Archon is multi-tenant deployable. Borrowing any of the out-of-category set would betray the AI software company thesis.
- Archon contributes four candidate small borrows. Two of them are worth doing now-ish; one is contingent on a future milestone; one is speculative until demand exists:
  - **B1** — Granular `DestroyResult { worktreeRemoved, branchDeleted, remoteBranchDeleted, directoryClean, warnings[] }` shape for cleanup. Becomes load-bearing when M17 `ship` and W2 `prune` grow cleanup beyond a single git op. Defer to M17.
  - **B2** — Explicit `TERMINAL_PHASES` / `RESUMABLE_PHASES` constants + typeguard at the FSM boundary. Small, defensive, ~50 LOC + tests. Inter-milestone refactor candidate.
  - **B3** — Fire-and-forget in-process event emitter for hook fan-out (NOT for gates). Needed only when `code-oz watch` / dashboard demand exists. Track as candidate, defer.
  - **B5** — Add `toolCallId?: string` to `ProviderToolCall` for forward-compatibility with HTTP adapters that surface mid-turn tools. Cheap optionality. Could land in PE-2.
- A4 (discriminated isolation request union) and A6 (wider 13-flag capability set) are explicit no-borrows: A4 requires a multi-trigger harness shape code-oz does not have, and A6 inflates capability authority in violation of rule 20.

## Constraints to respect when evaluating

- **Rule 20 (one new authority per milestone):** Each borrow must fit a single authority boundary. B1 belongs inside M17's `ship` phase authority. B2 is a typeguard that does not introduce new authority. B3 introduces a new in-process emission surface that lives below the gate authority but above pure helpers — confirm this is not an authority drift in disguise.
- **Rule 19 (run-level budget enforcement):** Any new mutator must be visible in `events.jsonl` and respect cumulative caps. None of B1/B2/B3/B5 mutate run state, so rule 19 is not directly invoked. Confirm.
- **Rule 1 (file-based gate signals only):** B3's in-process emitter must NOT carry gate authority — gates stay file-based. The contract is "emitter fans out the same events that `appendEvent` writes; subscribers are advisory; gate decisions never read the emitter." Confirm or push back.
- **Rule 11 (NEEDS_INTERVENTION over silent failure):** Archon's `WorkflowEventEmitter` swallows listener errors. code-oz's analog must do the same for in-process subscribers (a flaky dashboard listener cannot bring down a phase) but must not swallow producer-side failures. Confirm the boundary.
- **Rule 21 (no new parallel-provider surface without measurable risk-reduction):** None of B1/B2/B3/B5 are parallel-provider surfaces. Rule 21 should not apply. Confirm.
- **Influence-library policy:** Borrowed patterns are extracted, not depended on. No npm package import from Archon, no submodule, no copy-paste. Confirm the four proposed borrows respect this.

## The five open questions from COMPARISON.md

These are the points where the comparison is contested or under-evidenced. Please treat each as a separate question and answer with a yes / no / unsure plus a one-paragraph reason.

### Q1. Is B2 (`TERMINAL_PHASES` / `RESUMABLE_PHASES` constants) worth the inter-milestone effort?

My read: yes, weakly. Today `code-oz resume` semantics are correct but implicit — the run loader notices the existing run, skips earlier-passed phases, and re-enters the failed phase. There is no compile-time guard that says "you cannot resume a SHIPped run" or "you cannot resume from an in-progress phase that another process holds the lock for." A typeguard at the FSM boundary would make these failure modes self-explanatory. The cost is small: ~50 LOC, two new constants, one typeguard helper, a handful of tests.

Counter-read I want you to consider: the mechanism that prevents the failure modes today is `withLock` (advisory mkdir per-run / per-phase) plus `validateTransition` in the FSM. A SHIPped run has its terminal phase recorded in the gate file; resuming it would either (a) find no phase to resume because all gates are passed, or (b) fail because no phase is in-progress. The runtime check is already there; the constant is documentation pretending to be code.

Pick a side. If "do B2," name a real bug that compile-time `RESUMABLE_PHASES` would prevent that runtime `validateTransition` does not already catch. If "skip B2," tell me what to do with the M16 R1 audit-completeness recovery code, which has implicit "this phase is recoverable" decisions scattered through `forensics.ts`.

### Q2. Is B3 (in-process event emitter) actually a no-borrow disguised as a defer?

My read: defer, leaning no-borrow. The file-based `events.jsonl` is canonical and any in-process subscriber can `tail -f` it. The marginal value of an in-process emitter is latency (sub-millisecond fan-out vs. file-watch debounce) and ergonomics (typed listeners vs. JSON parsing). For the surfaces code-oz cares about today (CLI output, doctor inspector, post-run summary) the file is fine. The borrow earns its keep only if a real-time UI surface lands — `code-oz watch`, a dashboard, a TUI — and that surface needs sub-millisecond reactivity.

Counter-read: in-process emission lets the producer attach extra context (e.g., a transient `progress` event with a percent-complete) that has no business going into the durable log. This is also what Archon's `WorkflowEventEmitter` does — the workflow_artifact event carries data that is not persisted as events. If code-oz ever wants ephemeral progress signals, the file is the wrong substrate.

Pick a side. If "skip B3 forever," tell me how to handle ephemeral progress signals when the watch surface lands. If "borrow B3 eventually," name the milestone and the trigger condition.

### Q3. Does Archon's discriminated-request isolation pattern (A4) actually predict a code-oz future state?

My read: no, not under the current product thesis. Archon's `IsolationRequest = IssueIsolationRequest | PRIsolationRequest | ReviewIsolationRequest | ThreadIsolationRequest | TaskIsolationRequest` is the right shape for a multi-trigger harness that listens to GitHub webhooks and Slack threads. code-oz is single-trigger today (CLI run) and the only second trigger I can imagine is `code-oz audit-pr <url>` which would reach for a `createPrAuditRun(...)` constructor, not a discriminated union. Rule 20 prefers the simpler constructor.

Counter-read: the discriminated union's value is not just shape — it forces the worktree provider to think about per-trigger metadata at compile time. A flat constructor invites silent drift where each trigger adds parameters and the provider grows ad-hoc branching. Archon's pattern is a Chesterton fence specifically against that drift.

Pick a side. If "no future borrow," confirm that the eventual `audit-pr` milestone (if it ever lands) should reach for per-trigger constructors and not the union. If "borrow when the second trigger lands," name what the discriminator field would be (`workflowType`? `triggerKind`? something else).

### Q4. Where would Archon's authority model break under code-oz's high-stakes constraints?

My read: in three places. (1) Archon's "node completes without error → phase passes" semantics would have missed the M16 C9 production bugs where the phase code returned a structurally valid result that was nonetheless wrong (e.g., the multi-task default budget bug where `dispatchBuild` succeeded with a budget that was secretly per-run-not-per-task — the gate file would have written PASSED). (2) Archon has no cross-family review enforcement; the M16 bugs caught by Codex R1 against an Opus-built spine would have been invisible if the reviewer was the same family. (3) Archon has no run-level cumulative budget; the M16 C8 long-running production failure mode (a runaway task with no cumulative kill switch) would have continued past the per-call cost limit.

Pressure-test: am I overstating? Specifically, would Archon's schema validation on workflow run state (status enums, parent_conversation_id, transition_reason) actually catch some of these? And conversely, are there bugs Archon's model would catch that code-oz's would miss — for example, the explicit `paused` status that code-oz lacks?

### Q5. Is the comparison missing any Archon pattern that becomes load-bearing if code-oz scales beyond single-developer single-run usage?

My read: maybe one — the `adopt(path)` method on `IIsolationProvider`, which lets a worktree provider take ownership of an existing on-disk worktree it didn't create. This matters for crash-recovery in a long-running server; it might also matter for the `code-oz forensics` use case where an operator hands a half-finished run dir back to code-oz for completion. code-oz's `loadOrCreateRunWorktree` (M16) is idempotent on the path side but does not ingest a worktree the operator created externally. The borrow is small and the moral equivalent of B1.

Pressure-test: is there a second pattern I missed? Specifically, scan Archon's `@archon/workflows/event-emitter.ts` for events that have no analog in `events.jsonl` (e.g., `loop_iteration_*`, `rate_limit_*`, `session_transition`) and tell me which ones, if any, are signals code-oz currently throws away.

## Format for your response

I will save your reply as `CODEX_RESPONSE.md` in this folder. Please structure it as:

1. **Verdict**: `accept-with-modifications` / `accept` / `block-soft` / `block-hard` on each of these three:
   - The decision (YES, code-oz is ahead of Archon, with selective borrows).
   - The four-item borrow set (B1, B2, B3, B5) and the two no-borrows (A4, A6).
   - The proposed timing: B2 inter-milestone, B5 in PE-2, B1 in M17, B3 deferred.

2. **Q1-Q5 answers**: One paragraph each, with the yes/no/unsure and the reason. If you disagree with my read, name the file path or interface I am misciting.

3. **Authority boundary check**: Does B3 actually preserve rule 1 ("file-based gate signals only"), or is an in-process emitter authority drift even if subscribers are advisory? Argue the strongest case against B3 ever landing.

4. **Anything I missed**: Archon patterns I should have called out but did not. Specifically scan `@archon/core` (which I did not read) and `@archon/workflows/dag-executor` (also not read) and tell me if there is a load-bearing pattern hiding there.

5. **Risks**: top three risks of the borrow set as written, ranked by severity. Pay particular attention to whether B5 (`toolCallId?` optionality) is a Trojan horse for a wider tool-event redesign.

6. **Verdict on the comparison exercise itself**: this is the fourth template comparison in the series (`01-ace`, `02-agenticSeek`, `03-aris`, `04-archon`). The user has committed to one template per session, with Codex debate, archived in `docs/comparison/`. The remaining audited templates are `agent-skills`, `opencode`, `pi-mono`, `maestro`, `Auto-claude-code-research-in-sleep`, `claude-code` (six left). Plus the unaudited 11 in the README backlog. Are we polishing brass on the Titanic, or is this work load-bearing for the v0.2 (or v1.0) release pitch?

## Operating notes

- Sandbox: read-only. Do not write any files.
- Effort: xhigh.
- Read order: `docs/comparison/04-archon/COMPARISON.md` first (this folder), then for source-level confirmation `~/Projects/agents/templates/Archon/CLAUDE.md` (47k, skim), `~/Projects/agents/templates/Archon/packages/providers/src/types.ts`, `~/Projects/agents/templates/Archon/packages/isolation/src/types.ts`, `~/Projects/agents/templates/Archon/packages/isolation/src/providers/worktree.ts`, `~/Projects/agents/templates/Archon/packages/workflows/src/event-emitter.ts`, `~/Projects/agents/templates/Archon/packages/workflows/src/schemas/workflow-run.ts`. For code-oz cross-references, focus on `src/providers/types.ts`, `src/worktree/`, `src/state/`, and `docs/contracts/WORKTREE.md`.
- If you disagree, disagree concretely — name the file, the line, the assumption.
- Codex model: gpt-5.5. If gpt-5.5-codex / gpt-5.1-codex-max are configured, fall back to gpt-5.5 per CLAUDE.md.
