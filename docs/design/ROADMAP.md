# code-oz — Final roadmap (Opus 4.7 max-effort × GPT-5.5 xhigh debate, 2026-04-29)

**Verdict:** Opus's Option C (DEFINE+PLAN vertical slice) is rejected. Codex's **Option E (spine-first end-to-end MVP)** is adopted. All other Q1–Q5 architectural locks stand, with refinements from the debate baked in.

---

## What was debated

| Question | Opus 4.7 (max effort) | GPT-5.5 (xhigh) | Final |
|---|---|---|---|
| MVP scope | Option C — DEFINE + PLAN only | **Option E — DEFINE → PLAN → BUILD-lite → VERIFY-lite → REVIEW-lite** | **Option E** |
| Provider strategy v0.1 | IAgentProvider designed, Claude only implemented | FakeProvider + Claude on day 1, Codex stub for review, no Gemini in v0.1 | **Codex's** |
| Cross-provider tool | `consult(agent, question)` available to every agent | Narrow `requestReview({ reviewer, files, question })` at REVIEW gate only | **Codex's** |
| State model | File-based gate signals | State machine + `events.jsonl` event log + schema-validated gate files (no SQLite v0.1) | **Codex's** |
| Brownfield AUDIT | "Skip DEFINE" | Own artifact `AUDIT.md` with repo map, stack, risks, owners | **Codex's** |
| Architecture spine, file format, phase taxonomy, distribution stack, file-based gates as the user-facing signal | (locked Q1–Q5, unchanged by debate) | (Codex confirms) | **Unchanged** |

---

## Locked decisions (final)

1. **Project posture:** Greenfield code-oz, borrow patterns only. Not a fork.
2. **Stack:** Bun + TypeScript → compiled native single-file binary. Distribution: npm + Homebrew + Scoop, opencode-style auto-PATH-patching install script. No Node required on user's machine.
3. **Orchestration spine:** Hybrid phase-graph + agentic sub-orchestration. Greenfield: DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP. Brownfield: AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP. Auto-detect on boot via git + lockfiles. Hard gates between phases.
4. **Agent file format:** Markdown + YAML frontmatter (agent-skills schema, extended with `type`, `phase`, `provider`, `modelPolicy`, `permissions`). Optional sibling `.ts` escape hatch with permission manifest required before execution. Phase taxonomy verbatim from agent-skills.
5. **Provider model:** Multi-provider via `IAgentProvider` interface. Three implementations on day 1: `FakeProvider` (deterministic, offline, for tests), `ClaudeProvider` (CLI OAuth), `CodexProvider` (CLI OAuth, used as second-family reviewer). `GeminiProvider` is a stub behind `experimental: true` flag — frontmatter cannot claim Gemini support until it runs.
6. **Cross-provider primitive (refined):** Not `consult()` in v0.1. Only `requestReview({ reviewer, files, question })`, callable at REVIEW gates. Broad consult is v0.3.
7. **State model:** Typed state machine in `src/state/machine.ts` owns legal phase transitions. `.code-oz/state/events.jsonl` is the append-only run trace. `.code-oz/state/current.json` is derived convenience state. `.code-oz/state/GATE_<PHASE>_PASSED.json` are durable gate signals validated by `src/state/gates.ts` schemas. No SQLite in v0.1.
8. **Model policy:** Opus 4.7 default for primary work; warn on downgrade. Cross-family REVIEW required (Claude built → Codex/GPT reviews via `requestReview`, or vice versa). Pass file paths, not summaries.

## Non-negotiable rules (now expanded)

From audits (unchanged):
1. File-based gate signals only — never parse LLM text for pass/fail (maestro lesson)
2. Cross-family review at REVIEW gate (ARIS lesson)
3. 3-source verification before code: spec + reference code + library docs (maestro lesson)
4. Opus default; warn on downgrade
5. Wave-based execution + grep verification between phases
6. Hard cap on review loops: max 4 rounds, exit on score≥6 + verdict=ready (ARIS)
7. Artifact contracts in plain Markdown — never JSON serialization for inter-phase handoffs

Added by Codex debate:
8. **FakeProvider must run the full lifecycle offline** — every spine test runs without network or real provider auth
9. **Permission manifest required for any `.ts` escape hatch execution** — allowed commands/network/file roots/env vars/timeout/secret access. Default: no execution.
10. **Cost budgets are config, not vibes** — `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxReviewRounds`, per-phase budgets in `.code-oz/config.yaml`. Premium-model calls require approval if budget would be exceeded.
11. **`code-oz doctor providers`** must check Claude/Codex/Gemini auth without starting a run. Provider failures become actionable `NEEDS_INTERVENTION.json`, never opaque SDK stack traces.
12. **Resume is a v0.1 feature, not a v0.2 feature** — `runId`, idempotent gate writes, `code-oz resume`. Terminal death after PLAN must not restart DEFINE.
13. **Privacy by default** — `.code-ozignore`, secret redaction, file-size caps, binary-file exclusion, "files sent to provider" preview per phase. Agents receive explicit file manifests, not silent recursive repo context.
14. **Brownfield AUDIT has its own artifact** — `AUDIT.md` (repo map, detected stack, existing commands, risk areas, test surface, owner assumptions) → constrained `SPEC.md` or `CHANGE_REQUEST.md`. Never treat existing code as a blank canvas.

---

## v0.1 scope — Option E (spine-first)

`code-oz init` and `code-oz run` execute the full lifecycle on a deliberately tiny target end to end. The target is small (one file, one test). The architecture exercised is complete (gates, worktree, patches, review).

**v0.1 spine:**
- `code-oz init` — scaffolds `.code-oz/`, installs default agents, writes config, detects greenfield/brownfield
- `code-oz run` — executes DEFINE → PLAN → BUILD-lite → VERIFY-lite → REVIEW-lite
- `code-oz approve <PHASE>` — writes the gate file
- `code-oz resume <runId>` — picks up at last completed gate
- `code-oz doctor providers` — checks Claude/Codex/Gemini auth health
- `code-oz pack validate <path>` — validates an agent pack against the schema (forward-compat)

**Phases delivered in v0.1:**
- **DEFINE:** BA persona runs ask-me-style intent elicitation. Output: `SPEC.md` (goals, users, constraints, acceptance criteria, open questions, explicit non-goals). Gate: user approval.
- **PLAN:** Lead persona runs 3-source verification (spec + reference repos + library docs via Context7 MCP). Outputs: `PLAN.md` (atomic tasks with file targets, validation commands, risk notes) and `SOURCE_CHECK.md`. Gate: user approval; PLAN cannot pass without all three sources or explicit none-found rationale.
- **BUILD-lite:** Builder persona executes exactly one atomic task from PLAN.md, in an isolated worktree, through a patch contract (writes patches, not raw shell). Output: `BUILD_REPORT.md`.
- **VERIFY-lite:** Verifier persona runs configured command or generated smoke test. Output: `VERIFY.md`.
- **REVIEW-lite:** `requestReview()` passes file paths to a different-family reviewer. Capped at 4 rounds. Output: `REVIEW.md`.
- **SHIP:** stub.
- **AUDIT (brownfield):** stub but with `AUDIT.md` artifact contract defined.

**v0.1 acceptance:**
- One offline e2e test (`tests/e2e/spine-greenfield.test.ts`) runs DEFINE → REVIEW-lite end to end with `FakeProvider` only
- `code-oz run --provider fake --fixture greenfield-web` produces a complete local trace and stops at REVIEW gate
- `code-oz run` against a real Claude subscription completes the same path with real artifacts
- All non-negotiable rules enforced

---

## Day 1–7 milestone plan (from Codex's PR sequence)

**These are milestones, not strict calendar days** — solo-engineer realistic calendar is 2–4 weeks. Each milestone = one PR.

### M1 (Day 1) — `feat(cli): bootstrap code-oz binary and project layout`
Files: `package.json`, `bun.lock`, `tsconfig.json`, `src/cli.ts`, `src/commands/init.ts`, `src/commands/run.ts`, `src/commands/doctor.ts`, `src/paths.ts`, `src/config/schema.ts`, `tests/cli-init.test.ts`, `docs/adr/0001-mvp-option-e.md`
Acceptance: `bun test` passes; `bun run build:binary` produces a local executable; `code-oz init` scaffolds `.code-oz/{config.yaml,agents/,artifacts/,state/,runs/}`.

### M2 — `feat(agents): load markdown agent packs with schemas`
Files: `src/agents/{frontmatter,loader,schema}.ts`, `src/agents/defaults/{ba,lead,builder,verifier,reviewer}.md`, `src/agentpacks/schema.ts`, `tests/agents-loader.test.ts`, `tests/fixtures/agents/`
Acceptance: required frontmatter (`name`, `type`, `phase`, `provider`, `modelPolicy`, `permissions`); project-local overrides without mutating bundled defaults; invalid phase names fail fast.

### M3 — `feat(state): add phase machine, event log, and gate files`
Files: `src/state/{machine,events,gates,run,schemas}.ts`, `src/commands/approve.ts`, `tests/{state-machine,gates}.test.ts`, `docs/contracts/GATES.md`
Acceptance: no phase advances by parsing LLM text; `code-oz approve DEFINE` writes `GATE_DEFINE_PASSED.json`; event log records all transitions and provider calls.

### M4 — `feat(providers): add provider contract and deterministic test provider`
Files: `src/providers/{types,fake,claude,codex,gemini,registry,health}.ts`, `src/tools/review-request.ts`, `tests/{provider-contract,provider-health}.test.ts`, `docs/contracts/PROVIDERS.md`
Acceptance: `FakeProvider` runs the whole lifecycle offline; real adapters fail with actionable `NEEDS_INTERVENTION.json` if auth missing; `consult()` deliberately not added — only `requestReview()`.

### M5 — `feat(define): implement ask-me flow and SPEC contract`
Files: `src/phases/define.ts`, `src/artifacts/spec.ts`, `src/prompts/{define-system,common-rationalizations}.md`, `docs/contracts/SPEC.md`, `tests/define-phase.test.ts`, `tests/fixtures/transcripts/nontechnical-baby-game.md`
Acceptance: DEFINE writes `.code-oz/artifacts/SPEC.md`; SPEC includes goals/users/constraints/acceptance/open-questions/non-goals; gate waits for user approval before PLAN.

### M6 — `feat(plan): implement PLAN, 3-source verification, repo-context MVP, scientist substrate, run-level budgets`

Scope expanded by the synthesis round (`docs/research/MERGE_PLAN.md`, 2026-04-30) from the original 10-commit budget to ~14 commits, ~6–8 working days.

Files (PLAN core):
- `src/phases/plan.ts`, `src/artifacts/{plan,source-check}.ts`, `src/sources/{spec,reference,docs}-source.ts`
- `src/prompts/plan-system.md`, `docs/contracts/{PLAN,SOURCE_CHECK}.md`
- `tests/{plan-phase,sources}.test.ts`

Files (repo-context MVP, clean-room from public `claude-code`/`opencode`/`agent-skills` patterns; **`claude-code-main` leaked source is excluded** per CLAUDE.md influence library):
- `src/tools/repo-context/{glob,grep,read,symbol}.ts`, `src/tools/repo-context/permissions.ts`
- `docs/contracts/REPO_CONTEXT.md`
- New event type `repo_context_searched` in `src/state/schemas.ts`
- `AgentPermissions.tool_use.repo_context` extension in `src/agents/schema.ts`

Files (Scientist substrate + PLAN tail):
- `docs/contracts/{SCIENTIST,HYPOTHESES,OPEN_QUESTIONS}.md`
- `src/artifacts/{hypotheses,open-questions}.ts` (parsers, serializers, atomic writers)
- New event types `science_started`, `science_completed`, `hypothesis_added`, `hypothesis_falsified`, `question_opened`, `question_resolved` in `src/state/schemas.ts`
- `src/phases/scientist.ts` (phase-tail runner)
- Gate-preflight validation hook in `src/state/gates.ts` (or `src/state/run.ts`)
- `src/agents/defaults/scientist.md` (v0.1 persona body)

Files (`budgets.global` extension):
- `src/config/schema.ts` adds `maxWallTimeMinutes`, `softWarnAtRatio`, optional `priceTable`
- `src/providers/cost.ts` `assertWithinBudget` extended; `budget_warning` event added

Acceptance:
- PLAN cannot pass without `SOURCE_CHECK.md` naming spec, reference (or explicit none-found rationale), and docs (or explicit no-library rationale); PLAN emits atomic tasks with file targets, validation commands, risk notes; gate waits before BUILD-lite.
- Repo-context tools (`glob`, `grep`, `read`; `symbol` optional) callable by PLAN persona under `tool_use.repo_context` scope; results cap at configurable defaults; selected paths flow into next-invocation `ProviderRequest.files`; `repo_context_searched` events log every call.
- HYPOTHESES.md and OPEN_QUESTIONS.md atomic writes survive crashes; PLAN's gate preflight validates both sidecars before writing `GATE_PLAN_PASSED.json`; overdue open questions block the gate.
- Cumulative `budgets.global` enforces wall-time + token + call caps with soft warnings at 75% and hard kills at 100%.
- DEFINE retro-seed (HYPOTHESES.md / OPEN_QUESTIONS.md generated from SPEC.md) is opt-in via `phases.scientist.retroSeedDefine: true`; never reopens M5.

Deferred to W2 per merge plan: CLI commands `code-oz hypotheses list` / `code-oz questions list` / `code-oz questions resolve <Q-NNN>`; cross-run `.codeoz/memory/scientist/`; primary-artifact H-NNN/Q-NNN citation requirement; designer/reflection loop.

### Pre-M7 — handoff contract convergence (no tag, no code)

Per the M7-M10 shape debate (2026-04-30, `docs/research/CODEX_RESPONSE_M7_M10_SHAPE.md`, thread `019ddea0`), splitting BUILD/VERIFY/REVIEW into three milestones (M7, M8, M9) requires writing the shared contract surface once up front. Without it, M8's VERIFY either rewrites M7's contract or validates the wrong abstraction. This is a **separate session before M7 starts**; no code, no version tag.

User decision (2026-04-30): three sibling contracts, not one combined doc — sibling docs avoid merge-conflict pressure as each phase accumulates detail.

Files:
- `docs/contracts/BUILD.md` — BUILD phase contract; names `BUILD_REPORT.md` schema, changed-file manifest format, base-commit binding, patch provenance, command-shape declaration, failure carry-forward shape, what M8's VERIFY reads from this
- `docs/contracts/VERIFY.md` — VERIFY phase contract; names `VERIFY.md` schema, expected validation command shape, evidence-attached failure record, restart-on-fail policy interface, what M9's REVIEW reads from this
- `docs/contracts/REVIEW.md` — REVIEW phase contract; names `REVIEW.md` schema, cross-family requirement, file-paths-only handoff, 4-round loop cap, score+verdict exit, what SHIP reads from this

Acceptance: each contract names its referenced artifact schema, the event types it emits, the permissions it requires, and a one-paragraph "what M_N+1 reads from this" handoff section. Contracts cross-reference each other for the handoff surface; no orphan fields.

Session starter: `docs/design/SESSION_M7_PREP_KICKOFF.md`.

### M7 — `feat(spine): worktree isolation + BUILD-lite + DEBATE process contract`

One new authority boundary per CLAUDE.md rule 20: **isolation + BUILD artifact authority**. Scope per the M7-M10 shape debate.

Files (contracts; commits 1-2):
- `docs/contracts/WORKTREE.md` (commit 1) — pins `.code-oz/runs/<runId>` layout, base-commit binding, dirty-tree policy, `git --version >= 2.40` doctor check, creation/removal commands, cleanup-on-success, preserve-on-failure (diff + logs + artifact-hashes + prompt-constraints), changed-file manifest format, patch application boundary, allowed roots, failure events. Worktree isolation is NOT a security sandbox — secrets/network/shell-execution protection is W4 containerization (per Codex's risk #1)
- `docs/contracts/DEBATE.md` (commit 2) — process contract for the Claude+Codex debate-during-design pattern; **no runtime in M7**. Names: artifact layout (`.code-oz/artifacts/debates/<phase>-<topic>/{BRIEFING,RESPONSE.codex,RESPONSE.claude,DECISION}.md`), event types (`debate_started`, `debate_resolved`), `tool_use.debate` permission scope (definition only — runtime in M10), DECISION.md mandatory rationale (per Codex: "without DECISION.md, debate becomes archived theater")

Files (BUILD-lite implementation; commits 3+):
- `src/worktree/{create,remove,inspect}-run-worktree.ts`, `src/worktree/manifest.ts`, `src/worktree/forensics.ts`
- `src/patches/{apply,validate}-agent-patch.ts`
- `src/phases/build.ts`, `src/artifacts/build-report.ts`
- `src/agents/defaults/builder.md` (full BUILD persona with universal-rules.md injection)
- `src/prompts/build-system.md`
- BUILD's Scientist phase-tail (M6 substrate consumed)
- `src/commands/doctor.ts` adds `git --version` check
- `tests/{worktree-create,worktree-cleanup,worktree-preserve,patch-apply,build-phase,build-scientist-tail}.test.ts`
- `tests/e2e/build-lite-greenfield.test.ts`

Acceptance:
- BUILD applies one atomic PLAN task into an isolated worktree; writes `BUILD_REPORT.md` with full changed-file manifest + base-commit + patch hash + command-shape; runs Scientist tail; **stops before VERIFY** (M8 picks up)
- Worktree cleanup-on-success destroys the worktree; failure preserves diff + logs + artifact hashes + prompt constraints in `.code-oz/runs/<runId>/forensics/`
- DEBATE.md process contract pinned (no runtime; runtime is M10)
- BUILD-lite e2e with FakeProvider: DEFINE → PLAN → BUILD produces complete worktree, BUILD_REPORT.md, Scientist sidecars; stops at BUILD gate
- All M6 tests still pass (783 carried)
- Tag: `v0.7.0-alpha.0`

NOT in M7 (deferred): VERIFY-lite (M8), iterative build-patch loop (M8 with VERIFY restart policy), mutation-test gate (M8), REVIEW-lite (M9), Debate runtime (M10), Prompter experiment (W2). Per CLAUDE.md rule 20, M7 introduces exactly one new authority boundary.

### M8 — `feat(spine): VERIFY-lite + restart-on-fail policy + mutation-test gate`

One new authority boundary per CLAUDE.md rule 20: **VERIFY evidence authority + restart-on-fail policy**. Restart-on-fail is the discipline that keeps the gate authoritative (Ozzy: "if VERIFY fails we should be starting over to process — why is VERIFY important then?").

Files:
- `src/phases/verify.ts`, `src/artifacts/verify-report.ts`
- `src/phases/verify-mutation.ts` — revert-and-replay gate; new tests must fail on reverted code; flagged for tests with `asserts: new-behavior`
- `src/agents/defaults/verifier.md`, `src/prompts/verify-system.md`
- `src/tools/test-runner.ts` (language-agnostic test-runner abstraction)
- VERIFY's Scientist phase-tail
- `src/phases/restart-policy.ts` — failed VERIFY destroys worktree as active candidate, preserves forensics, attempt N+1 starts from same approved PLAN with compact failure constraint; 4-attempt cap on clean BUILD; attempt 5 → `NEEDS_INTERVENTION.json`
- `phases.build.maxAttempts` in `src/config/schema.ts` (default 4)
- `tests/{verify-phase,verify-mutation,restart-policy,verify-scientist-tail}.test.ts`
- `tests/e2e/verify-lite-greenfield.test.ts`

Acceptance:
- VERIFY runs configured command or generated smoke test; emits `VERIFY.md` with command shape + evidence + verdict
- Failed VERIFY does NOT enter a soft patch loop. Worktree destroyed as active candidate, forensics preserved, attempt N+1 starts clean from same approved PLAN with failure constraint surfaced into the BUILD prompt
- Hard cap of 4 clean attempts; attempt 5 lands in `NEEDS_INTERVENTION.json` per CLAUDE.md rule 11
- Mutation-test gate rejects tautological tests for new-behavior tests
- VERIFY-lite e2e with FakeProvider: success path (DEFINE → PLAN → BUILD → VERIFY) and failure-then-retry path (tests the restart policy with attempt N + N+1)
- All M7 tests still pass
- Tag: `v0.8.0-alpha.0`

NOT in M8: REVIEW-lite (M9), Debate runtime (M10).

### M9 — `feat(spine): REVIEW-lite with cross-family handoff`

One new authority boundary per CLAUDE.md rule 20: **cross-family REVIEW authority**.

Files:
- `src/phases/review.ts`, `src/artifacts/review-report.ts`
- `src/agents/defaults/reviewer.md`, `src/prompts/review-system.md`
- REVIEW's Scientist phase-tail
- `src/tools/review-request.ts` consumed (M4 primitive); review loop bounded at 4 rounds (CLAUDE.md rule 6)
- `tests/{review-phase,review-loop-cap,review-cross-family,review-scientist-tail}.test.ts`
- `tests/e2e/review-lite-greenfield.test.ts`
- `tests/e2e/spine-greenfield.test.ts` — full DEFINE → PLAN → BUILD → VERIFY → REVIEW path
- `fixtures/greenfield-web/` — toy fixture used across e2e tests
- `docs/demo/v0.9-spine.md` — the v0.9 demo trail

Acceptance:
- REVIEW receives changed file paths from BUILD's manifest (CLAUDE.md rule 2: never curated summaries)
- Cross-family enforcement at load time (M2): BUILD persona's `provider` family ≠ REVIEW persona's `provider` family
- Loop capped at 4 rounds; exit on score ≥ 6 + verdict = ready (CLAUDE.md rule 6)
- Full v0.9 spine e2e test passes
- All M8 tests still pass
- Tag: `v0.9.0-alpha.0`

NOT in M9: SHIP (W4), Debate runtime (M10).

### M10 — `feat(debate): Debate runtime + requestDebate() primitive`

One new authority boundary per CLAUDE.md rule 20: **Debate runtime authority**. Cross-family debate-during-design (not just review-at-the-gate) becomes a callable primitive. Empirically validated through M2-M9 manual debates; M10 makes it programmatic. The user's framing (2026-04-30): "the prompts you are prompting Codex with — this is what we find the most valuable things."

Files:
- `src/tools/debate-request.ts` — `requestDebate({ phase, topic, files, question, opposingProvider })` callable from any phase persona with `tool_use.debate` permission
- `src/artifacts/debate.ts` — BRIEFING / RESPONSE.codex / RESPONSE.claude / DECISION serializers, atomic writers, parsers
- `src/agents/schema.ts` — `tool_use.debate` permission sub-scope (intersect-with-scope per existing pattern); manifest preview required (per Codex risk: "Debate can violate privacy and budgets faster than REVIEW")
- `src/state/schemas.ts` — `debate_started`, `debate_resolved` event types
- `src/state/events.ts` — validators for new event types
- `src/tools/debate-permissions.ts` — manifest preview before send (privacy preview per CLAUDE.md rule 13); blocks files matching `.code-ozignore`
- `src/providers/cost.ts` — Debate-specific budget accounting under `budgets.global` (Debate calls increment `maxProviderCalls` and contribute to `maxTokensEstimate`)
- `docs/contracts/DEBATE.md` upgraded from process contract (M7) to runtime contract
- `tests/{debate-request,debate-artifact,debate-permissions,debate-budget,debate-decision-required}.test.ts`
- `tests/e2e/debate-from-plan.test.ts` — PLAN phase invokes `requestDebate` on a design question; full artifact trail produced

Acceptance:
- Any phase persona with `tool_use.debate` permission can invoke `requestDebate`; events recorded; artifacts written
- DECISION.md is mandatory; debate without recorded DECISION → `NEEDS_INTERVENTION.json` per Codex's "archived theater" risk
- Manifest preview blocks before send if any file would violate `.code-ozignore`
- Budget accounting under `budgets.global` (no parallel namespace)
- Hybrid artifact: canonical Markdown + `events.jsonl` audit trail; never JSON as canonical artifact (rule 7)
- e2e: PLAN persona hits a design question, invokes `requestDebate`, both providers respond, DECISION.md authored, PLAN continues; full audit in `events.jsonl`
- All M9 tests still pass
- Tag: `v0.10.0-alpha.0`

NOT in M10: broad `consult()` primitive (still v0.3, distinct from `requestDebate`), debate skill marketplace (W5+), Debate UI surfaces (W2 TUI inspector).

---

## Beyond v0.1 (post-MVP queue, ordered)

Reshaped 2026-04-30 by the synthesis round (`docs/research/MERGE_PLAN.md`).

- **W2 — Non-expert workflow (coordinated milestone):**
  - W2.1 — DEFINE-0 / Prompter front door (gated on M7 mini-experiment outcome). Tier-1 only (cheap meta-prompt). Default-off via `--prompter` opt-in for v0.1; default-on after exemplars mature. INTENT.md as separate artifact, sampled cross-family review at 20%.
  - W2.2 — TUI inspector + failure-recovery UX. Ink/charmbracelet-based diff viewer, hunk-level accept/reject, `events.jsonl` reader, `code-oz resume-after-intervention` command.
  - W2.3 — Onboarding + tour mode. Example project, `code-oz tour` walks through one DEFINE→SHIP cycle on a toy repo. 5–10 hand-written exemplars in the Prompter library for cold-start.
  - W2.4 — `code-oz reflect` designer job + skill outcomes JSONL log substrate. On-demand reflection over the last N runs; promotes successful (raw-request, INTENT) pairs into the exemplar library.
  - W2.5 — Scientist completion: CLI commands (`code-oz hypotheses list`, `code-oz questions list`, `code-oz questions resolve <Q-NNN>`), cross-run `.codeoz/memory/scientist/`, primary-artifact H-NNN/Q-NNN citation requirement.

- **W3 — Production extension:**
  - Codex/Gemini provider integration; cross-family REVIEW with real providers; installer (`curl | sh`, npm, Homebrew tap).
  - Multi-language LanguagePack abstraction (TypeScript/Node, Python; C# scoped if OneStream-internal use is realistic v1).
  - Real-world `IIntegration` interface (events-log-as-substrate): GitHub (read issues into INTENT.md, open PRs at SHIP), Slack (NEEDS_INTERVENTION notifications), Linear/Jira (ticket round-trip).
  - Tier-2 DSPy MIPRO compile for Prompter (opt-in via `code-oz run --deep`).
  - Concurrent runs + multi-active-run pointer (worktree-per-run isolation, Archon pattern).
  - Optional `symbol` LSP integration for repo-context tools (deferred from M6).

- **W4 — AUDIT depth + privacy hardening:**
  - Brownfield AUDIT phase fully implemented (`AUDIT.md` contract with architecture map, convention sniffer, dependency graph, hot-files report, test coverage map, doc extraction).
  - `.code-ozignore`, secret redaction, "files sent to provider" preview, `code-oz upgrade --check`.
  - Containerized BUILD execution (devcontainer or firecracker microVM) — required if real-world integrations move agents toward writing code that touches user data.

- **W5+:** Full SHIP phase, more personas (PM/UX/FE/BE/QA splits), agent pack marketplace contract validation, Playwright MCP for VERIFY, `consult()` broad primitive (v0.3), telemetry bundles via `code-oz doctor --bundle`.

---

## Open questions (parking lot, low-stakes for v0.1)

- Which directory holds `code-oz` source? — `~/Projects/code-oz/` (new repo, GitHub `omerakben/code-oz`?). Confirm before M1.
- License? — Suggest MIT to match agent-skills, opencode, ARIS.
- README + repo brand kit? — Defer to W3.
- Does `code-oz init` ship the 5 default agents inline, or fetch from a default agent pack repo? — Suggest inline for v0.1, fetch later.

## Files to create on Day 1 (resume aid)

When ready to start M1, in this order:
1. New repo: `~/Projects/code-oz/` (or chosen path)
2. `package.json` with Bun + TypeScript + `bun build --compile` script
3. `tsconfig.json` (strict mode)
4. `src/cli.ts` (commander or built-in arg parser)
5. `src/commands/init.ts`
6. `tests/cli-init.test.ts` (Bun's test runner)
7. `docs/adr/0001-mvp-option-e.md` — record this decision so the rationale survives
