---
name: missing-pieces-for-real-world-use
companion-docs: 01-maestro-rule-checker.md, 02-llm-failure-research.md, 03-prompt-optimizer-front-door.md
target: scope guidance for code-oz milestones beyond M5–M7
status: brainstorm written up; each item ready to become a milestone or W2/W3/W4 scope item
---

# What code-oz is missing to build real software

Stand back from the spine and ask: with M5 locked, M6 and M7 designed, the maestro discipline encoded, and a prompter front door planned — what stops code-oz from being run on a real project tomorrow? Ten gaps, ranked by how hard they block real-world use.

## 1. Codebase context retrieval

Today the manifest is paths-only and the agent gets exactly what the orchestrator hands over. Real repos are 50k+ lines and the agent cannot fit them in a single context window.

What is missing: an agentic search loop. Claude Code does this with `Glob` + `Grep` + targeted file reads, optionally backed by an LSP for symbol-level navigation. code-oz has none of this.

Without this, code-oz demos on toy repos but cannot touch OneStream's codebase or any client project of meaningful size. A `requestReview` over selected files is fine; an actual implementation phase that needs to find where the email-template logic lives is not.

Slot: probably a dedicated milestone before or inside M7. Could be M6.5 ("Codebase context"). Should not be deferred to W2.

Integration hooks: the existing `IAgentProvider` contract already supports tool calls; this is a tool, not a new abstraction. The maestro's `repo-search-before-write` skill is the consumer side; the search backend is the new piece.

## 2. The iterative BUILD loop

M7 is "BUILD-lite + VERIFY-lite + REVIEW-lite" but the actual write-code → run-tests → see-error → patch loop is not yet designed. This is what Voyager calls the "iterative prompting mechanism" — environment feedback, execution errors, self-verification, then commit to skill library.

Without this, the agent writes code once and either it works or it does not. There is no recovery, no learning from the test runner, no error-driven refinement.

Slot: this IS M7. The current M7 scope needs to expand to include: a test-runner abstraction, an error-message-to-prompt translator, a patch loop with bounded rounds, a self-verification gate before a patch is committed.

Integration hooks: the prompter dossier's controller-executor-designer pattern applies here too. Test failures become signal for the designer to update skills. The maestro's `null-check` skill consumes lessons learned during the build loop.

## 3. Multi-language support

Stack lock for code-oz itself is Bun + TypeScript. Real software is polyglot: Python services, Next.js apps, Go microservices, mobile.

What is missing: an abstraction over language-specific tooling. A `LanguagePack` interface that mirrors `IAgentProvider` and exposes:

- test runner command + output parser
- package manager (install, audit, pin)
- linter + formatter
- type checker
- canonical project layout detector

Each language pack is a plugin. Bundled packs for v0.1: TypeScript / Node, Python, maybe Go. C# / .NET ships in a follow-up since OneStream is the eventual target.

Slot: W3. Until the spine is stable on a single language, multi-language is premature.

Integration hooks: the `code-oz init` brownfield detection already sniffs the project; this extends to picking a language pack. The maestro skill `dependency-pin` becomes language-specific via the pack.

## 4. Brownfield AUDIT depth

W4 names AUDIT as a placeholder. What does it actually produce on a real codebase? Without a real AUDIT, code-oz cannot be dropped into an existing repo.

What an AUDIT phase needs to produce:

- architecture map (top-level directory roles, module boundaries, public-vs-internal surfaces)
- convention sniffer (naming, file structure, the project's actual style not the framework's defaults)
- dependency graph (what depends on what; circular dependencies; high-fan-in modules)
- hot-files report (most-edited files in the last N commits = highest-risk-of-change)
- test coverage map (where coverage is dense, where it is empty, where it is fake)
- doc extraction (what is documented; what is documented but the code disagrees)

Slot: W4 is the right milestone but the scope needs to be defined now so the artifact contract does not surprise W4. AUDIT.md schema should land alongside SPEC.md schema in M5, with sections marked TBD for now.

Integration hooks: every AUDIT output is a memory artifact. The convention sniffer feeds project rules; the hot-files report feeds the maestro's project-context-conflict detection.

## 5. Human-in-the-loop UX past the CLI flag

`code-oz approve define` works for power users. For non-experts it is a barrier. They need:

- diff viewer with syntax highlighting
- hunk-level accept / reject
- "what did the agent do and why" inspector that reads the state events log
- undo (revert the last gate, restore prior state)

Could be terminal TUI (ink, blessed, charmbracelet/bubbletea) or a small web UI launched on demand. The TUI is more in-keeping with the CLI-first philosophy; the web UI scales better to non-developers.

Slot: W2 or W3. Pairs with the prompter dossier: prompter solves the input side, this solves the review side.

Integration hooks: every gate file already contains the artifact hash and the events log already contains the trajectory. The UX is a renderer over existing data, not new state.

## 6. Cost and performance budgets at the run level

Per-phase budgets exist (M4 wrapper enforces `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`). What is missing:

- run-level total budget (cumulative across all phases)
- wall-time circuit breaker (kill a run that exceeds N minutes)
- spend telemetry (real dollar amount, not just token estimate)
- soft warnings before hard kills

For non-experts, surprise bills are the dealbreaker. "I ran this and it cost $200" kills trust faster than any bug.

Slot: M5 or M6, not W3. The budget hooks belong in the wrapper layer that already exists.

Integration hooks: extend `InvokeContext` with run-level budget tracking. The maestro reads cumulative spend at every gate and refuses to advance if the next phase's projected spend exceeds remainder.

## 7. Real-world integrations

GitHub, Slack, Linear / Jira, Sentry. Without these, code-oz is a sandbox.

Specifically:

- GitHub: read issues into INTENT.md, open PRs at SHIP, post status checks
- Slack: notify on NEEDS_INTERVENTION, optionally channel-per-run for status
- Linear / Jira: round-trip ticket state (in-progress, in-review, done)
- Sentry: production errors become tickets that auto-create code-oz runs

Slot: W3 or later, but the integration boundary needs design now so it does not require a rewrite. An `IIntegration` interface (event-based, hookable into the state events log) is the right shape; the events log is already append-only and observable.

Integration hooks: the events log is the integration substrate. Every integration is a consumer of events; some integrations also produce events (a GitHub PR comment becomes a `review_received` event).

## 8. Telemetry feedback for the self-improving layer

The MemSkill / designer pattern in the prompter dossier needs a quality signal. Right now there is no hook into "did this PR get merged, did it cause a production bug, did the user revert it."

Without that, the reflection job is graded on its own opinion of itself. That is the sycophancy trap (family 13 in the failure-research dossier) at the system level.

What is needed:

- git history reader (merged vs reverted vs amended)
- CI-status webhook (test pass / fail post-merge)
- post-merge metrics ingestion (latency, error rate from Sentry, churn)

Slot: build the hooks early; the data compounds. Could land in M7 alongside the build loop, since both depend on the same git introspection layer.

Integration hooks: a `RunOutcome` event type, written by the reflect job after consulting external signals. The designer in the prompter dossier reads RunOutcome events as ground truth.

## 9. The friends-can-onboard problem

Tied to the original observation. The prompter handles "I do not know how to phrase this." The friends will also hit:

- "I do not know how to install this"
- "I do not know what to do first"
- "I do not know what just happened"

What is needed:

- example project (TUEL AI's blueprint format would be a great seed)
- tour mode that walks through one DEFINE → SHIP cycle on a toy repo
- "show me what you did" inspector that summarizes a run in one screen
- hand-written exemplars in the prompter's skill library so the cold-start problem is bounded

Slot: W2. Pairs with the prompter milestone since both are non-expert-facing.

Integration hooks: the prompter's exemplar library is the same memory layer that powers the tour mode. The tour walks through canned transcripts (already in the M5 fixture format) on a hand-curated toy repo.

## 10. Failure recovery UX

`NEEDS_INTERVENTION.json` exists. After it gets written, nothing happens. The user has to notice.

What is needed:

- notification (terminal beep, OS notification, optionally Slack DM)
- smart context handoff (3-paragraph summary, what was tried, what to check)
- `code-oz resume-after-intervention` command that loads the intervention context and continues
- escalation path when the intervention itself fails (kill the run, not retry forever)

Slot: W2. Triple with prompter (#9) and HITL UX (#5) into a coordinated "non-expert workflow" milestone.

Integration hooks: NEEDS_INTERVENTION.json schema already exists from M4. This adds: notification dispatcher (pluggable backend), context-summary generator (a small LLM call dedicated to summarizing the intervention), and the resume command.

---

## Priority sequencing

Reading this list, three groupings emerge.

**Spine completion (must land before M7 ships).** Items 1, 2, 6. Codebase context retrieval, the iterative BUILD loop, and run-level budgets. Without these, M7 demos but does not deliver.

**Non-expert workflow (W2, coordinated push).** Items 5, 9, 10. HITL UX, onboarding, failure recovery. Plus the prompter dossier's W2 milestone. These four together turn code-oz from a tool for power users into a tool for the user's friends. Treating them as one coordinated milestone is more honest than four separate features.

**Production extension (W3+).** Items 3, 7. Multi-language, real-world integrations. Without these, code-oz is a TypeScript-only sandbox. With them, it is an actual product surface.

**Always-on (do not defer).** Item 8 (telemetry) and item 4 (AUDIT depth). Telemetry hooks are cheap to build early and the data compounds; AUDIT depth needs design now even if implementation is W4.

## Two items that did not make the top ten

Container / devcontainer support for sandboxed execution. Security posture for running agent-written code. Probably deferrable to W3 but worth deciding now whether it is "v1 must-have" or "v2 nice-to-have." If real-world integrations (#7) move agents toward writing code that touches user data or production systems, the sandbox question gets sharper.

Concurrent runs. The user's friends will want three tickets in flight, not one. Today the M3 single-active-run pointer is a constraint, not a feature. W2 or W3 work; the schema change is small (multi-active-run pointer with worktree isolation, already inspired by the Archon template) but the UX implications cascade.

---

## How this connects to the existing milestone plan

The brainstorm above is gap analysis. It does not modify M5 (locked, Codex-approved), M6 (PLAN phase, designed, three-source verification), or M7 (BUILD/VERIFY/REVIEW spine).

What it does suggest:

- M6 should expand to include codebase context retrieval (item 1) since PLAN cannot do three-source verification without finding the three sources.
- M7 should explicitly include the iterative BUILD loop (item 2) since BUILD-lite without iteration is single-shot code generation, which the failure-research dossier shows is the dominant failure mode.
- Run-level budgets (item 6) should land somewhere in M5–M7; cheapest to do during M6 since the wrapper layer is the integration point.
- W2 becomes a coordinated non-expert milestone covering items 5, 9, 10, plus the prompter dossier.
- W3 covers items 3 (multi-language) and 7 (real-world integrations).
- W4 keeps AUDIT but with the deeper scope from item 4.
- Item 8 (telemetry) is cross-cutting; build the hooks during M7 and W2.

This sequencing assumes the user's "real software solutions" target is shipping to friends + small consulting clients in 2026 H2, not enterprise. If the target is OneStream-internal use of code-oz on the C# / Selenium / Telerik codebase, item 3 (multi-language) climbs to before W3.
