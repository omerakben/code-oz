# AI software company thesis

Status: product north star, not an implementation contract.
Date: 2026-04-30 (revised after Codex thesis pressure-test, thread `019de031`).
Current milestone state: M8 shipped at `v0.8.0-alpha.0`; M9 REVIEW-lite and M10 Debate runtime remain.

## Thesis

**Market category:** repo-native agentic SDLC runtime.
**Product metaphor:** AI software company.

`code-oz` coordinates multiple providers and models through a governed software delivery lifecycle:

`define -> debate -> delegate -> build -> verify -> review -> ship`

The core belief: model bias and provider bias are real, but software delivery should not inherit one model's blind spots. `code-oz` uses structured disagreement, artifact contracts, evidence gates, isolated worktrees, and cross-family review to turn AI agents into a production software team. The "AI software company" framing is how we explain roles to humans; the runtime is a governed SDLC, not roleplay.

## What it is

`code-oz` is repo-native software delivery infrastructure for AI agents. The providers are workers. The orchestrator is the company discipline.

The runtime assigns role-specific work to agents, records their outputs as plain Markdown artifacts, verifies those artifacts through schemas and events, and only advances work through explicit gates.

Provider neutrality means **capability-aware routing, not interchangeability**. Claude, Codex, Gemini, OpenCode, Roo Code, and future adapters have different edit models, shell semantics, OAuth paths, sandboxing, MCP support, rate limits, and cost behavior. `code-oz` will reject role assignments that violate provider capability constraints (post-M10).

The product is not the model. The product is the operating system that makes many models useful together.

## What it is not

`code-oz` is not another coding agent, editor sidebar, prompt-to-app toy, or broad enterprise agent platform.

It does not try to beat Claude Code, Codex, Gemini CLI, OpenCode, Roo Code, Replit, Base44, Devin, Factory, Cursor, or other tools at every task. It treats those tools and model families as possible workers inside a governed software company process.

It is also explicitly not:

- **Company cosplay.** Human-sounding roles, exec personas, panels, and parallel workers do not exist because the metaphor is compelling. Every extra agent must have a measurable job: reduce blind spots, produce evidence, or improve a human decision.
- **An unmanaged swarm.** Many agents may reason in parallel; only the orchestrator writes canonical artifacts; only isolated builders mutate worktrees.
- **Benchmark-chasing autonomy.** SWE-bench leaderboards are not the goal. Auditable production code is.
- **Hosted enterprise automation before v1.0.** v0.1 is offline-first, FakeProvider-validated, repo-native CLI. Hosted SaaS is a post-v1.0 question.

## Company roles

The long-term product shape is a role roster, not a single assistant. Roles are split by shipping status:

### Shipped (v0.8)

| Role | Job | Possible provider fit |
| --- | --- | --- |
| BA | Elicit intent and turn messy user language into `SPEC.md` | Gemini, Claude, Codex |
| Lead | Convert the goal into `PLAN.md`, `SOURCE_CHECK.md`, task order, validation commands, and risks | Claude, Codex |
| Builder | Implement one atomic task in an isolated worktree | Claude Code, Codex, OpenCode, Roo Code |
| Verifier | Execute validation, capture evidence, and write `VERIFY.md` | Deterministic runner first, model second |
| Scientist | Track hypotheses, falsifiers, and open questions (phase-tail) | Gemini, Claude, Codex |
| Orchestrator | Own state, gates, budgets, permissions, artifacts, and promotion decisions | `code-oz` runtime |

### Post-M10 (planned, one authority boundary per milestone)

| Role | Lands at | Authority boundary |
| --- | --- | --- |
| Reviewer | M9 (cross-family REVIEW-lite) | Cross-family REVIEW authority |
| Debate opponent | M10 (`requestDebate()` runtime) | Debate runtime authority |
| Per-role provider routing | M12 (company roster for shipped roles) | Role-to-provider routing authority |
| Reviewer panel | M14 | Panel quorum + cross-family enforcement |

### Later (deferred until measurable need)

| Role | Trigger to revisit |
| --- | --- |
| Researcher | Source verification overflow from Lead persona; lifted to its own phase-tail when measurable |
| Parallel builder candidates | Security wedge (e.g., supply-chain or prompt-injection detection) makes one-builder runs insufficient |
| Multi-opponent debate | Single-opponent `requestDebate()` proves insufficient on real disagreement cases |

## Product promise

Bring your favorite coding agents. `code-oz` gives them roles, worktrees, contracts, verification, review, budgets, and an audit trail.

Primary developer-facing pitch:

> Run coding agents through an auditable SDLC from your terminal.

Tagline (memorable metaphor):

> Run an AI software company from your terminal.

Expanded pitch:

> `code-oz` is the repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship. It coordinates Claude, Codex, Gemini, OpenCode, Roo Code, and other agents through a real software delivery lifecycle and reduces single-model bias with structured disagreement.

## Why use it

Use `code-oz` when one coding agent is not enough.

Use it when you need:

- provider diversity
- cross-model debate
- repo-specific planning
- source verification before coding
- isolated implementation attempts
- deterministic verification evidence
- restart-on-fail instead of soft patch loops
- cross-family review
- traceable artifacts
- budget and permission controls
- durable handoff files
- human approval gates
- a durable decision record (BRIEFING / RESPONSE / DECISION trail)
- willingness to spend more tokens for higher confidence on production work

Short market contrast:

> Competitors give you agents. `code-oz` gives you the company structure that makes agents build production software together.

## Market context

The market is validating agentic software delivery, multi-agent orchestration, and governed agent platforms — but the validation is grouped into distinct lanes:

### Broad enterprise agent platforms

- [Google Gemini Enterprise Agent Platform](https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/gemini-enterprise-agent-platform/) frames enterprise agents around runtime, identity, registry, gateway, simulation, evaluation, observability, and model choice.
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) brings multi-agent orchestration, workflow, memory, telemetry, and enterprise agent patterns into one framework.
- [AWS Bedrock multi-agent collaboration](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html) uses supervisor and collaborator agents to split work across specialized agents.

These move horizontally across enterprise automation. `code-oz` stays narrower: software-delivery-specific, repo-native, provider-neutral, CLI-first, artifact-governed.

### Coding agents and harnesses

- [OpenAI Codex / Codex CLI](https://developers.openai.com/codex/cli) and [Codex cloud](https://developers.openai.com/codex/cloud) validate cloud coding agents, parallel work, worktrees, skills, and background tasks.
- [Claude Code](https://www.anthropic.com/product/claude-code) validates project-level terminal coding with repo reads, edits, tests, commits, and CI work.
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) validates open-source terminal agents with file operations, shell commands, MCP, search grounding, and large-context workflows.
- [OpenCode](https://opencode.ai/docs/) and [Roo Code](https://roocode.com/) are local/editor coding agent surfaces.
- [Cursor agents](https://docs.cursor.com/en/background-agents) optimize developer flow inside the editor.

These are workers `code-oz` uses, not competitors. Capability-aware routing decides which provider takes which role.

### Autonomous and platform-shaped tools

- [Devin](https://docs.devin.ai/get-started/devin-intro) is an autonomous AI software engineer for backlog tasks, bugs, migrations, tests, PRs, and parallel work.
- [Factory](https://docs.factory.ai/welcome) is an AI-native development platform with Droid CLI/desktop/exec, missions, code review, QA, governance, and BYOK.

These sell autonomous execution and broad platform shape. `code-oz` sells **bounded** execution: explicit artifacts, gates, budgets, and human approval.

### Prompt-to-app builders

- [Replit](https://replit.com/products/agent) and [Base44](https://base44.com/ai-app-builder) are prompt-to-app builders for quickly generating and deploying apps from natural language.

`code-oz` is for owned repos and production traceability, not "idea to app in minutes."

### Agentic SDLC and review-first tools

- [HivePipe](https://hivepipe.ai/agentic-sdlc-platform) is the closest category neighbor: agentic SDLC with phases, PRDs, gates, audit trails, Git-native output, BYOK. `code-oz` differentiates on local CLI, offline FakeProvider validation, cross-family enforcement, worktree isolation, and plain Markdown artifact contracts.
- [Sonar](https://www.sonarsource.com/resources/library/what-is-agentic-sdlc/) frames quality and verification debt for agentic SDLC. Sonar is a verification authority. `code-oz` orchestrates the lifecycle and integrates deterministic quality tools rather than replacing them.
- [Qodo](https://www.qodo.ai/) is review-first: AI code review, context engineering, multi-agent review workflows, quality, and SDLC governance. `code-oz` is lifecycle-first.

## Research context

The research supports the idea, with caveats that should drive product rules.

Support:

- [ChatDev](https://arxiv.org/abs/2307.07924) models software development as a virtual software company with specialized agents across design, coding, and testing.
- [MetaGPT](https://arxiv.org/abs/2308.00352) uses software-company standard operating procedures and role specialization to structure multi-agent work.
- [Multiagent Debate](https://arxiv.org/abs/2305.14325) shows that debate among model instances can improve reasoning and factual accuracy.
- [LLM-based multi-agent systems for software engineering](https://arxiv.org/abs/2404.04834) surveys multi-agent systems across software lifecycle stages.
- [SWE-agent](https://arxiv.org/abs/2405.15793) shows that the agent-computer interface around a model materially affects software engineering performance.

Caution promoted to product rule:

- [Agentless](https://arxiv.org/abs/2407.01489) argues that simpler, interpretable workflows can outperform complex autonomous agents on software engineering benchmarks. **Product rule:** no new agent or parallel-provider surface lands without measurable risk-reduction effect in `events.jsonl` against the simpler-baseline (candidate `CLAUDE.md` rule #21).

`code-oz` is a governed workflow where agents are added only where they reduce risk: debate, source verification, isolated build candidates, verification, review, and assumption tracking. ChatDev and MetaGPT validate the role-specialization idea; Agentless validates the discipline that keeps it from becoming swarm theater.

## Differentiation

| Market player | What they are | `code-oz` difference |
| --- | --- | --- |
| Microsoft Agent Framework | Developer framework for agents, graph workflows, state, memory, middleware, telemetry, MCP, enterprise integration | `code-oz` is a fixed software-delivery spine with Markdown gates, worktrees, review, verification, offline FakeProvider tests — not a general agent framework |
| AWS Bedrock multi-agent collaboration | Supervisor/collaborator agents for complex Bedrock workflows | `code-oz` is repo-native and SDLC-specific, treats provider calls as budgeted workers under local artifacts |
| Google Gemini Enterprise Agent Platform | Enterprise platform to build, scale, govern, and optimize agents | `code-oz` is narrower: local CLI, owned repo, software gates, provider-neutral execution, no hosted SaaS before v1.0 |
| OpenAI Codex / Codex CLI | Coding agent across CLI, web, IDE, app, cloud tasks, skills, subagents, code review | `code-oz` uses Codex as reviewer, debate opponent, researcher, or builder inside a governed lifecycle |
| Claude Code | Project-level terminal coding agent | `code-oz` uses Claude as builder/lead candidate, then forces output through independent verify/review gates and opposite-family review |
| Gemini CLI | Open-source Gemini terminal agent with MCP and large-context workflows | Gemini becomes a role-specific provider, capability-gated, not assumed interchangeable |
| OpenCode / Roo Code | Local/editor coding agents with configurable providers, modes, permissions, subagents | `code-oz` treats them as builder surfaces while keeping canonical state, gates, budgets, and promotion outside the agent UI |
| Cursor agents | IDE-native and background coding agents | Cursor optimizes developer flow inside the editor; `code-oz` optimizes auditable delivery outside any one editor |
| Devin | Autonomous AI software engineer | Devin sells autonomous execution; `code-oz` sells bounded execution with explicit artifacts, gates, budgets, and human approval |
| Factory | AI-native development platform with Droid CLI/desktop/exec, missions, review, QA, governance, BYOK | Factory is broader and platform-shaped; `code-oz` wins on local-first, offline-testable, Markdown-contract SDLC discipline |
| Replit / Base44 | Prompt-to-app builders | `code-oz` is for owned repos and production traceability, not "idea to app in minutes" |
| HivePipe | Closest category neighbor: agentic SDLC with phases, PRDs, gates, audit trails, Git-native output, BYOK | `code-oz` differentiates on local CLI, offline FakeProvider, cross-family enforcement, worktree isolation, and plain Markdown contracts. We are humble here — HivePipe validates the category, and the wedge is repo-native discipline |
| Sonar | Quality/verification framing for agentic SDLC, verification debt | Sonar is a verification authority; `code-oz` orchestrates the lifecycle and integrates deterministic quality tools, not replaces them |
| Qodo | AI code review, context engineering, multi-agent review workflows | Qodo is review-first; `code-oz` is lifecycle-first: define, plan, build, verify, review, ship with cross-family gates |

## Product principles

1. Trust evidence and bounded process over model confidence.
2. Disagreement is useful only when it is structured.
3. Many agents may reason in parallel; one orchestrator owns canonical artifacts.
4. Builders mutate isolated worktrees, never the user's active tree.
5. Reviewers receive file paths, not curated summaries.
6. Verification is evidence, not confidence.
7. Failed verification restarts the process from a clean attempt, with forensics preserved.
8. Provider neutrality means capability-aware routing, not interchangeability.
9. Budgets, permissions, and manifests are product features.
10. Human approval gates remain part of v0.1 discipline.
11. **No new parallel-provider surface lands without a measurable risk-reduction effect in `events.jsonl` against the simpler baseline.** (Agentless caution promoted to rule.)

## Roadmap placement

Do not interrupt M9 or M10 to implement the full company-roster concept.

Near-term (locked):

- M9 ships REVIEW-lite with cross-family review authority.
- M10 ships Debate runtime with `requestDebate()`.

After M10, the productization sequence is one authority boundary per milestone (per `CLAUDE.md` rule 20):

| Milestone | Authority boundary |
| --- | --- |
| M11 | Provider capability contract — capability/auth/cost traits per provider; load-time rejection of impossible role assignments. No new roles. |
| M12 | Company roster for shipped roles only — BA + Lead + Builder + Verifier + Reviewer + Scientist + Debate opponent + Orchestrator. Maps roles to providers. No Researcher, no panels, no parallel builders. |
| M13 | Role-cost policy under `budgets.global` — per-role budget gating + preflight estimates. Must precede any simultaneous-provider surface. |
| M14 | Reviewer panel v1 — first simultaneous-provider surface. Panel quorum + cross-family enforcement (same-family panelists are advisory only) + synthesis. |
| M15 | Debate-policy scheduler v1 — automatic-trigger policy for the existing single-opponent `requestDebate()`. Not multi-opponent debate. |

Later milestones (M16+, deferred until measurable need): Researcher phase-tail, parallel builder candidates, multi-opponent debate.

The example future shape:

```yaml
company:
  ba:
    provider: gemini
  lead:
    provider: claude
  debate:
    opposingProviders: [codex, gemini]
  builder:
    provider: claude
    candidates: 1
  verifier:
    runner: test-runner
  reviewer:
    panel:
      - { provider: codex, role: voter }
      - { provider: gemini, role: voter }
      - { provider: claude, role: advisory }   # same-family as builder; advisory only
  scientist:
    provider: gemini
```

## Open questions for debate

1. Provider capability matrix shape — what traits matter? Edit semantics, shell semantics, OAuth source, MCP support, sandbox profile, rate limits, cost-per-1M-tokens, role eligibility (which roles each provider may take). Lands as `docs/contracts/PROVIDERS.md` extension at M11.
2. Acceptable cost defaults — what does the user expect to spend on a typical multi-provider run? Single-provider default vs. multi-provider opt-in.
3. Reviewer panel quorum semantics — is it 2-of-2 cross-family, or majority with cross-family minimum? Same-family panelists advisory only — codified how?
4. FakeProvider vs. live-provider validation — offline tests prove orchestration discipline; live-provider behavior is opt-in. How are the two test surfaces kept in sync?
5. Which roles should be provider-diverse by default in v0.1, and which should stay deterministic or single-provider?
6. Which parts of this thesis belong in README/marketing copy, and which belong only in design docs?
7. When does the Researcher role become measurable need (M16+ trigger)?
8. When does parallel builder candidates become measurable need (security wedge trigger)?
