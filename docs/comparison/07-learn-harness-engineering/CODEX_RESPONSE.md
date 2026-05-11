---
source: Codex CLI (`gpt-5.5` xhigh, sandbox: read-only)
delegated-via: agent-codex:codex-delegator (single attempt, no fallback)
tokens: 95,938
input: CODEX_BRIEFING.md questions 1–12
session: 07
date: 2026-05-10
---

# Codex response — verbatim

## Verdict-level summary

Accept the comparison with modifications. The category mismatch is mostly right: `learn-harness-engineering` is a course and scaffold skill, while `code-oz` is a gated runtime with locked rules in [CLAUDE.md](<repo-root>/CLAUDE.md:21). But the analysis overclaims when it says code-oz already implements every subsystem: the template has concrete mechanics around benchmarks, fail-closed tools, memory writes, and cache invalidation that are not just pedagogy.

## Per-question response

### 1. Category mismatch claim: accept-with-modifications

Mostly correct. The five-subsystem frame is teaching-oriented in the README: instructions, state, verification, scope, lifecycle [README.md](<templates-root>/learn-harness-engineering/README.md:94). But the reference docs include runtime mechanics, not just pedagogy: per-call concurrency [tool-registry-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md:21), single-level forks [multi-agent-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/multi-agent-pattern.md:101), and bootstrap trust staging [lifecycle-bootstrap-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/lifecycle-bootstrap-pattern.md:57). Treat it as pedagogy plus extracted runtime patterns.

### 2. "Ahead" claim: accept-with-modifications

Code-oz is ahead on enforced gates, review, budgets, and permissioned repo context: rules 1, 2, 18, 19, 20, and 21 are explicit [CLAUDE.md](<repo-root>/CLAUDE.md:23). But "already implements every subsystem" is too generous. The course's benchmark and tool-safety mechanics are more explicit than the comparison admits [SKILL.md.en](<templates-root>/learn-harness-engineering/skills/harness-creator/SKILL.md.en:231), [tool-registry-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md:167).

### 3. B1 scorecard: accept-with-modifications

Accept only as an external-project diagnostic, not an internal code-oz taxonomy. The 1-5 bottleneck scoring is useful [SKILL.md.en](<templates-root>/learn-harness-engineering/skills/harness-creator/SKILL.md.en:70), but `HARNESS_AUDIT.md` must map each subsystem back to DEFINE → SHIP so it does not compete with code-oz's phase model [CLAUDE.md](<repo-root>/CLAUDE.md:45). Defer the `doctor` subcommand until there is demand.

### 4. B2 benchmark methodology: accept-with-modifications

Accept, but tighten heavily. The course's "2-3 tasks, compare success/time/tokens/rework" is a starting sketch [SKILL.md.en](<templates-root>/learn-harness-engineering/skills/harness-creator/SKILL.md.en:235), not enough for rule 21. Code-oz already has a better precedent in `DEBATE_POLICY.md`: control/treatment events, gating floors, corrective-rate floor, actionable-finding floor, no-signal rate, and overhead telemetry [DEBATE_POLICY.md](<repo-root>/docs/contracts/DEBATE_POLICY.md:128). Generalize that into `RULE21_BENCHMARK.md`.

### 5. B3 hook trust: defer

Do not append this to `REPO_CONTEXT.md`. That file is specifically for `tool_use.repo_context`, with network denied and selected paths flowing only through the next manifest [REPO_CONTEXT.md](<repo-root>/docs/contracts/REPO_CONTEXT.md:1). The all-or-nothing hook rule is real [lifecycle-bootstrap-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/lifecycle-bootstrap-pattern.md:18), but it belongs in the first hook or extension contract, not today's repo-context contract.

### 6. B4 trigger language: accept-with-modifications

Accept as authoring guidance for skills or agent-pack metadata, not as a universal runtime rule. The source problem is skill-list truncation around 150 chars [gotchas.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/gotchas.md:151). `src/prompts/universal-rules.md` is anti-slop execution discipline [universal-rules.md](<repo-root>/src/prompts/universal-rules.md:1), so putting description-writing advice there would dilute rule 16.

### 7. R1 five-subsystem replacement: confirm-reject

Confirm. The five subsystems describe harness quality [README.md](<templates-root>/learn-harness-engineering/README.md:130). Code-oz's phases are authority boundaries with gate semantics [ROADMAP.md](<repo-root>/docs/design/ROADMAP.md:20). Do not replace them.

### 8. R2 `feature_list.json`: confirm-reject

Confirm for canonical artifact use. It conflicts with Markdown artifact contracts and gate files [CLAUDE.md](<repo-root>/CLAUDE.md:29). If useful later, make it a generated projection from PLAN plus `events.jsonl`, not source of truth.

### 9. R3 AGENTS.md + CLAUDE.md split: flip-to-borrow-modified

The comparison misses cross-tool compatibility. Code-oz already has the right shape: `AGENTS.md` is a pointer, while `CLAUDE.md` stays canonical [AGENTS.md](<repo-root>/AGENTS.md:1). Keep that. Do not duplicate full instructions, but do keep the pointer file for Codex and generic agents.

### 10. R4 bootstrap pattern: confirm-reject

Confirm rejection for the full four-stage bootstrap. PE-2+ is demand-gated, and roadmap discipline says no cloud route without demand evidence [ROADMAP.md](<repo-root>/docs/design/ROADMAP.md:386). Retain the trust-boundary staging as future acceptance criteria when hooks, server mode, or SDK mode exist [lifecycle-bootstrap-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/lifecycle-bootstrap-pattern.md:57).

### 11. Missed mechanics: accept-with-modifications

Add a B5: fail-closed tool safety review. This is more load-bearing than B3/B4 because code-oz already has tool-use scopes. Borrow per-call concurrency, stateful permission evaluation, protected paths/commands, and a checklist [tool-registry-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md:15).

### 12. Borrow ranking: accept-with-modifications

B2 should be ranked first and marked blocking for any future parallel-provider surface. It should not block unrelated polish. If rule 21 fires before the generalized methodology is pinned, the failure mode is cherry-picked fixtures and "tokens/time" substituting for risk reduction. M15's specific measurement exists [DEBATE_POLICY.md](<repo-root>/docs/contracts/DEBATE_POLICY.md:196), so the work is to generalize it.

## Missed risks

- B5 fail-closed tool registry: strongest missed borrow. Current comparison underweights per-call concurrency and permission side effects [tool-registry-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/tool-registry-pattern.md:39).
- Memory write invariants: two-step topic-file then index write and bounded one-line index are useful for any future code-oz memory layer [memory-persistence-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/memory-persistence-pattern.md:15).
- Cache invalidation: memoized context builders must invalidate at mutation points, or agents see stale repo state [context-engineering-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/context-engineering-pattern.md:38).
- Two-phase eviction: relevant for future background work units or agent forks [lifecycle-bootstrap-pattern.md](<templates-root>/learn-harness-engineering/skills/harness-creator/references/lifecycle-bootstrap-pattern.md:46).

## Final recommendation

Accept the verdict with modifications: keep "code-oz ahead" and the category distinction, but revise the borrow set. Promote B2 to first and blocking for future parallel-provider surfaces, add B5 for fail-closed tool safety, defer B3 until a hook/extension milestone, move B4 out of `universal-rules.md`, and flip R3 to a modified borrow because the pointer-style `AGENTS.md` is already the right cross-agent compatibility pattern.
