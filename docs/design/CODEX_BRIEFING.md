# code-oz — Codex second-opinion briefing

**You are GPT-5.5 at xhigh effort.** Your counterpart is Claude Opus 4.7 at max effort. We've been pair-designing `code-oz` with the user (Ozzy) over the last hour using a structured ask-me interview. Five decisions are locked. The MVP scope is open and Opus has a recommendation. Your job: **debate it.** Find blind spots, propose alternatives, and either confirm the roadmap or push back hard with a better one.

---

## What is code-oz

A standalone terminal CLI Ozzy is building from scratch. User runs `code-oz` in a fresh terminal, and code-oz boots an adaptive multi-agent "software company" — BA, PM, UX, Lead, FE, BE, QA, Reviewer, exec personas — over a hybrid phase-graph + agentic sub-orchestration spine. SDLC + STLC enforcement via hard gates. Two profiles: greenfield (Intake → DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP) and brownfield (AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP). Auto-detects which on boot. **Differentiator:** non-technical users can say "create a game for my baby," code-oz runs an ask-me-style intent elicitation, scopes the project, and drives the whole lifecycle with hard quality gates.

The user runs `code-oz` using their own Claude Pro / Codex / Gemini CLI subscriptions — no API keys required. SDKs read CLI OAuth tokens from disk so subscription-first is preserved.

---

## Locked decisions (Q1–Q5)

1. **Greenfield project, borrow patterns only** — not a fork of any existing template.
2. **Bun + TypeScript → compiled native single-file binary** — opencode's distribution pattern (npm + Homebrew + Scoop, auto-PATH-patching shell installer). No Node required on user's machine.
3. **Hybrid phase-graph + agentic sub-orchestration** — top-level lifecycle is a fixed state machine with hard gates between phases (file-based signals, not LLM-text-parsed). Inside each phase, Maestro agentically dispatches role-agents.
4. **Markdown + YAML frontmatter agent format** (extending agent-skills' schema with `type` and `phase` fields), with optional sibling `.ts` escape hatch for hooks/MCP tools/Playwright runners. Phase taxonomy verbatim from agent-skills: **DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP**.
5. **Multi-provider via `IAgentProvider` from day one** — three SDK implementations (Claude Agent SDK, Codex SDK, Gemini SDK) all reading CLI OAuth tokens. Static per-agent provider declared in frontmatter. **Cross-provider agent invocation as a built-in tool**: every agent gets `consult(agent, question)` so a Claude reviewer can ask Codex coder, etc.

## Influence library (7 templates audited)

| Pattern | Source | code-oz inherits |
|---|---|---|
| Native binary distribution + MCP host/client | opencode | `bun build --compile`, MCP-first |
| `IAgentProvider` interface + worktree-per-run | Archon | provider abstraction, run isolation |
| Markdown frontmatter skill format + phase taxonomy | agent-skills | file format, gate names, "Common Rationalizations" pattern |
| Streaming events + provider abstraction | pi-mono | typed event model |
| File-based gate signals + wave verification + 3-source check + Opus-default | maestro (Ozzy's own production-tested template) | gate enforcement mechanics, model policy |
| Cross-family adversarial review + Reviewer Memory + 4-round-cap loop + artifact-contracts | ARIS | REVIEW-phase loop, plain-Markdown handoffs |
| Plugin = directory of Markdown + filesystem discovery + hook event names | claude-code | familiarity for Claude Code users |

## Non-negotiable rules (from audits)

1. **File-based gate signals only** — never parse LLM text output for pass/fail. `NEEDS_INTERVENTION` / `PAUSE` / `STOP` / `GATE_PASSED_<phase>.json` files (maestro's hardest-won lesson; v1 failed by trusting text output).
2. **Cross-family review at REVIEW gate** — REVIEW agent must be a different provider family than BUILD agent. Pass file paths, not curated summaries.
3. **3-source verification** before any code — spec + reference code + current library docs. Bake into PLAN phase as a gate.
4. **Opus default; warn on downgrade** — empirical: maestro session 55 had cascading data errors when Sonnet was used.
5. **Wave-based execution + grep verification** between phases catches "pattern blindness."
6. **Hard cap on auto-loops** — REVIEW loop max 4 rounds (ARIS); explicit exit on score≥6 + verdict=ready.
7. **Artifact contracts in plain Markdown** — `SPEC.md`, `PLAN.md`, etc. — never JSON serialization for inter-phase handoffs.

---

## Opus's MVP recommendation (the thing to debate)

**Option C: Vertical slice — DEFINE + PLAN only, with the killer non-technical UX. Then extend down the lifecycle in a v0.2.**

Concrete v0.1 cut:

- `code-oz init` — scaffolds `.code-oz/` directory in cwd, detects greenfield/brownfield via `git status` + lockfile presence
- `code-oz` — boots Maestro orchestrator into the **DEFINE** phase
- **DEFINE phase**: 1 BA persona runs ask-me-style intent elicitation, outputs `SPEC.md`. User approves to pass gate.
- **GATE**: `.code-oz/state/GATE_DEFINE_PASSED.json` requires user signoff (file-based, not LLM-asserted)
- **PLAN phase**: 1 Lead persona reads `SPEC.md`, runs 3-source verification (spec + any reference repos + library docs via Context7 MCP), outputs `PLAN.md` (broken into atomic tasks)
- **GATE**: `.code-oz/state/GATE_PLAN_PASSED.json` requires user signoff
- Stop. (BUILD/VERIFY/REVIEW/SHIP are stub phases that say "not implemented in v0.1")
- Provider: Claude Agent SDK only for v0.1; `IAgentProvider` interface designed in but only one implementation
- Estimated: 3–4 weeks for one engineer

Three other options Opus considered and rejected:

- **(A) "Maestro v2 in Bun"** — port maestro's session-loop to TS, add IAgentProvider, ship same 5 personas. ~3 weeks. **Rejected:** doesn't earn the rename; differentiator (intent elicitation, non-tech UX) is absent.
- **(B) "One full lifecycle, Claude only"** — DEFINE→SHIP with one agent per phase, all gates wired, 4-round REVIEW loop. ~6 weeks. **Considered as v0.2 follow-up.**
- **(D) "Full vision v0.1"** — 6 phases × 9 personas × 3 providers + Playwright MCP + brownfield. ~5 months. **Rejected:** scope-creep death.

---

## Your debate prompt

I want you to push back hard. Specifically:

1. **Is the MVP scope (option C) right?** Or is it too small to demo the value? Too big to ship in 4 weeks? Should we be shipping (A) maestro-port first to keep momentum, or jumping to (B) full lifecycle to prove the gates work end-to-end?

2. **Is the architecture overengineered for v0.1?** `IAgentProvider` from day one with only one implementation — premature abstraction or correct foundation? Cross-provider `consult` as a built-in tool — is that v0.1 or v0.3?

3. **Is the file-based gate mechanism right?** Or should we use a different state model (event log? finite state machine in TS? SQLite-backed)? Maestro's lesson is real but maybe the implementation can be modernized.

4. **What are we missing entirely?** Categories Opus may have skipped:
   - Telemetry / observability (how do we know an agent is stuck?)
   - Cost controls (Opus tokens at xhigh aren't free)
   - Security / sandboxing of `.ts` escape hatches
   - Testing strategy for code-oz itself (TDD on a multi-agent system is hard)
   - Extension / marketplace story (third-party persona packs)
   - Update mechanism (how does `code-oz` upgrade itself?)
   - Brownfield AUDIT phase — is it really just "skip DEFINE/Design"? Or does it need its own design pass?

5. **If you were starting tomorrow, what's day 1?** Give me a concrete, ordered first-week task list — not just opinions. What gets committed first: the binary skeleton, the Markdown frontmatter loader, the BA persona, the gate file schema?

Write your reply as four sections: **Where I agree**, **Where I disagree (with specific alternative)**, **What's missing**, **My day-1-through-day-7 plan**. Don't hedge. If Opus is wrong, say where and propose the better path.
