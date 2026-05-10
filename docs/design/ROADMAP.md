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

Files (repo-context MVP, patterns borrowed from `claude-code`/`opencode`/`agent-skills`):
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

One new authority boundary per CLAUDE.md rule 20: **VERIFY evidence authority + restart-on-fail policy**. Restart-on-fail is the discipline that keeps the gate authoritative (Ozzy: "if VERIFY fails we should be starting over to process — why is VERIFY important then?"). Briefing + Codex debate trail: `docs/design/CODEX_BRIEFING_M8.md` + `docs/design/CODEX_RESPONSE_M8.md` (thread `019ddf5f`, 2026-04-30 — 4 rejects + 9 accept-with-modifications across 13 decisions). Synthesis: `docs/design/SESSION_M8_KICKOFF.md`.

Files (commit 1: PLAN change-kind grammar — depended on by BUILD preflight + mutation applicability):
- `docs/contracts/PLAN.md` extends `Files:` bullet to accept inline change kind: `path (modified | added | deleted)`. Default `modified` for backward compatibility.
- `src/artifacts/plan.ts` parser update + atomic write
- `tests/plan-grammar-change-kind.test.ts`
- Existing fixture PLAN.md files updated with explicit change kinds

Files (commit 2: tool_use.execute schema + load validation + no-shell command grammar):
- `src/agents/schema.ts` adds `tool_use.execute` per VERIFY.md
- `src/agents/load.ts` validates: only one tool (`test-runner`), only one root (worktree path), bounded timeouts and stream caps, **argv-only command grammar** (rejects shell operators, redirects, env-prefix tricks, command substitution, absolute executable paths)
- `tests/agent-load-tool-use-execute.test.ts`

Files (commit 3: verify event types + validators):
- `src/state/schemas.ts` adds 4 `verify_*` event types
- `src/state/events.ts` validators
- `tests/state-events-verify.test.ts`

Files (commit 4: test-runner with no-shell argv-only spawn + scrubbed env):
- `src/tools/test-runner.ts` — `Bun.spawn` with streaming stdout/stderr to forensics paths, AbortController timeout, scrubbed env (whitelist), no shell, argv-only command grammar. Returns `terminationReason: "exit" | "timeout" | "stdout-cap" | "stderr-cap" | "spawn-error"`.
- `tests/test-runner-{spawn,timeout,truncation,exit-code,abnormal-termination,env-scrub,no-shell-grammar}.test.ts`

Files (commit 5: verify-report parser/serializer with orchestrator-owned binary Verdict):
- `src/artifacts/verify-report.ts` — orchestrator owns binary `Verdict.Verdict` (computed from Evidence + Mutation.Status), persona owns `Verdict.Rationale` + `Mutation.Notes` + `Failure summary` + `Constraint`
- `tests/verify-report-{parse,serialize,grammar,build-ref,failure-constraint,verdict-authority}.test.ts`

Files (commit 6: mutation gate — source-only revert + abnormal-termination semantics):
- `src/phases/verify-mutation.ts` — applicability requires `Expected exit code: 0` AND added test path matches `phases.verify.testGlob`; revert non-test changed paths to base; replay validation command; **mutation pass requires `terminationReason: "exit"` AND non-expected exit code** (timeouts, caps, spawn errors are never mutation pass)
- `tests/verify-mutation-{revert,replay,applicable,not-applicable,fail-tautology,abnormal-termination}.test.ts`

Files (commit 7: restart-policy + BUILD failureCarryForward propagation — closes M7 debt):
- `src/phases/restart-policy.ts` — typed `VerifiedFailedAttempt` input; counter from `events.jsonl` reduction over max `build_completed.attempt`; cross-check vs `BUILD_REPORT.md.Task.Attempt`; 4-cap; attempt 5 → `NEEDS_INTERVENTION.json`. **BUILD-protocol failures, runner spawn failures, and BUILD-ref mismatches bypass the cap** (go straight to intervention).
- `src/phases/build.ts` — wire failureCarryForward propagation (closes M7 debt: `build.ts:462` currently serializes `null`)
- `phases.build.maxAttempts` in `src/config/schema.ts` (default 4)
- `tests/restart-policy-{cap-counter,carry-forward,intervention,events,verified-only}.test.ts`
- `tests/build-failure-carry-forward-restart.test.ts`

Files (commit 8: forensics extras + event ordering):
- `src/worktree/forensics.ts` wires three M8 extras (frozen `VERIFY.md`, frozen `attempt-<N>.patch`, `build-prompt-snapshot.md`) via the extensible `extras` parameter shipped in M7 commit 8
- `tests/forensics-extras-{verify,patch,prompt}.test.ts`
- `tests/event-ordering-verify-fail.test.ts` — asserts strict order: logs → VERIFY.md → forensics → `worktree_forensics_preserved` → `verify_failed` → worktree remove → `worktree_destroyed` → `verify_restart_initiated` (or `NEEDS_INTERVENTION` for cap)

Files (commit 9: VERIFY persona + composer):
- `src/agents/defaults/verifier.md` (3.5-4.5k; replaces M2 stub; long grammar lives in parser tests and contract files, not in prose)
- `src/prompts/verify-system.md` — universal-rules import, schema excerpts, one compact pass example + one compact fail example

Files (commit 10: VERIFY orchestrator + cleanup-on-approval; M8 fix 4 finalized):
- `src/phases/verify.ts` (orchestrator: BUILD ref bind → command execute → evidence record → mutation gate → persona invoke → repair → finalize → forensics-on-fail; **cleanup is gate-driven, not event-driven**)
- `src/commands/approve.ts` `preApproveVerifyHook` (extracted helper): validates VERIFY.md → confirms verdict=pass → removes worktree → emits `worktree_destroyed` BEFORE the gate file is written. **Removal failure throws and the gate is not written.**
- `src/phases/schedule-attempt.ts` `scheduleAttemptNPlus1`: emits `worktree_destroyed` + `verify_restart_initiated` after a VERIFY-fail. The full run-loop wiring (creating attempt N+1's BUILD invocation) lands in M9.
- `src/worktree/revert-seam.ts` `createGitRevertSeam`: production RevertSeam backed by `git checkout BASE -- path` for the mutation gate.
- VERIFY's Scientist phase-tail runs on **both** pass and fail branches (rule 15).
- Phase-level e2e tests: `tests/verify-phase.test.ts` (pass + repair-turn pass + fail + timeout-fail + cap-exhaustion + real-RevertSeam mutation), `tests/revert-seam.test.ts`, `tests/schedule-attempt.test.ts`, `tests/commands-approve.test.ts` (preApproveVerifyHook coverage).

Acceptance:
- VERIFY runs validation command via `Bun.spawn` (no shell, scrubbed env, cwd pinned to worktree, argv-only); emits `VERIFY.md` with the six required H2 sections per VERIFY.md schema
- Orchestration ordering: validate BUILD_REPORT → run validation → evaluate mutation → compute orchestrator-owned verdict → invoke persona for persona-owned fields ONLY → parse → repair-once on grammar fail → merge → write VERIFY.md → Scientist tail (both branches) → emit verdict event. Persona never authors the binary verdict, Mutation.Status, or full VERIFY.md text.
- Failed VERIFY does NOT enter a soft patch loop. Forensics preserved with all nine entries (M7's six + M8's three); `verify_failed` event records terminationReason + exitCode + persona-authored failureSummary. The remaining canonical events on fail (`worktree_destroyed`, `verify_restart_initiated`) fire from `scheduleAttemptNPlus1` after runVerify returns; the full run-loop wiring (scheduling attempt N+1's BUILD invocation) lands in M9. attempt N+1 starts clean from same approved PLAN with failureConstraint surfaced into the BUILD prompt via the carry-forward block.
- Hard cap of 4 clean BUILD attempts (counted by completed BUILD reports cross-checked against `BUILD_REPORT.md.Task.Attempt`); attempt 5 lands in `NEEDS_INTERVENTION.json` per CLAUDE.md rule 11. BUILD-protocol failures, runner spawn failures, and BUILD-ref mismatches bypass the cap.
- Mutation gate rejects tautological tests for new-behavior tasks; source-only revert (test files preserved at post-patch); applicability requires `Expected exit code: 0` AND added test in changed-file manifest matching `phases.verify.testGlob`; mutation pass requires `terminationReason: "exit"` AND non-expected exit code. Production `createGitRevertSeam` exercises the gate against real worktree state.
- Cleanup-on-VERIFY-pass fires inside `code-oz approve verify` via `preApproveVerifyHook`, not on `verify_completed` event; failed removal blocks gate write.
- Every intervention path produces durable `NEEDS_INTERVENTION.json` + `intervention` event (CLAUDE.md rule 1, 11) — including cap exhaustion, runner throws, mutation throws, persona repair-turn failures, Scientist tail failures, and forensics write failures.
- All M7 tests still pass (1005 carried). M8 final delta: 1005 → 1325+ (verified after fix-first cycle).
- Codex implementation review (CLAUDE.md rule 8) returns `push` after fix-first commits land.
- Tag: `v0.8.0-alpha.0`.

NOT in M8: REVIEW-lite (M9), Debate runtime (M10), explicit `Asserts:` flag in PLAN (deferred per Codex Decision 3 verdict; conservative manifest-driven applicability is enough for M8), persona-authored binary `Verdict.Verdict` (Codex Decision 10 tightened to orchestrator-owned), retry framework for flaky tests (W3+), real OS-level sandboxing (W4 containerization), the full run-loop integration that drives attempt N+1's BUILD invocation after `scheduleAttemptNPlus1` (M9 ships this as part of the REVIEW orchestration that consumes M8's VERIFY-pass gate).

### M9 — `feat(spine): REVIEW-lite with cross-family handoff`

One new authority boundary per CLAUDE.md rule 20: **cross-family REVIEW authority**. Loop discipline (4-round cap + score+verdict exit) and cross-family enforcement are inseparable halves of one authority — same shape as M8's "VERIFY evidence + restart-on-fail policy" inseparability. Briefing + Codex debate trail: `docs/research/CODEX_BRIEFING_M9.md` + `docs/research/CODEX_RESPONSE_M9.md` (thread `019de05a`, 2026-04-30 — 3 rejects + 10 accept-with-modifications across 13 decisions; 8 risks). Synthesis: `docs/design/SESSION_M9_KICKOFF.md`. Topic-1 sub-decisions for `review-system.md` plumbed from the agent-skills-borrow synthesis (`docs/research/SYNTHESIS_AGENT_SKILLS_AND_PRODUCT_THESIS.md`, 2026-04-30): five-axis scaffolding + tests-first + exact false-security-coverage caveat + REVIEW.md schema unchanged.

Files (commit 1: substrate — worktree lifetime + BUILD provider durability + family-aware loader):
- `src/commands/approve.ts` — remove worktree-removal from `preApproveVerifyHook`; add `preApproveReviewHook` that removes worktree on REVIEW approve. Worktree preserved through REVIEW.
- `src/state/schemas.ts` — new `build_provider_recorded` event (`runId`, `taskId`, `attempt`, `provider`, `family`, `model`); resume-safe.
- `src/phases/build.ts` — emit `build_provider_recorded` after `build_completed`.
- `src/agents/loader.ts` — family-aware comparison via shared `familyOf()` lookup.
- `src/providers/families.ts` (new) — pure `familyOf(providerId) → family` lookup; shared by loader and runtime `ProviderRegistry`.
- `docs/contracts/WORKTREE.md` — cleanup-on-VERIFY-pass deleted; cleanup-on-REVIEW-pass added.
- `docs/contracts/REVIEW.md` — `fix-first` unresolved blocks `ready` (lock stricter rule per Codex catch on contradiction).
- `tests/{worktree-lifetime-through-review,build-provider-recorded,family-aware-loader,fix-first-unresolved-blocks-ready}.test.ts`

Files (commit 2: tool_use.review_request schema + load validation):
- `src/agents/schema.ts` adds `tool_use.review_request` per REVIEW.md
- `src/agents/load.ts` validates: bounded `maxRounds ≤ 4`, providers list, bounded `timeoutMsPerRound`, `network: 'provider-only'`
- `tests/agent-load-tool-use-review-request.test.ts`

Files (commit 3: review event types + validators):
- `src/state/schemas.ts` adds 4 `review_*` events per REVIEW.md
- `src/state/events.ts` validators
- `tests/state-events-review.test.ts`

Files (commit 4: review-report parser + serializer with orchestrator-owned binary verdict):
- `src/artifacts/review-report.ts` — orchestrator owns `Round timeline.<verdict>` per round AND `Score.Final verdict`; persona owns `Findings`, `Score.Final score`, recommendation text. Canonical verdict rule: any current `block` finding → `block`; otherwise unresolved `block` or `fix-first` OR `score < 6` → `needs-revision`; otherwise `ready`. Fingerprint-based `F-NNN` canonicalizer (file + normalized title + recommendation intent); ping-pong recurrence reopens original id. Bounded repair prompt grammar (error code + violated rule + clipped offending lines only — never full failed drafts). Deleted-file findings rejected.
- `tests/review-report-{parse,serialize,grammar,upstream-refs,timeline,findings,score,cap-status,verdict-authority,fingerprint-canonicalize,ping-pong-reopen,path-validation,fix-first-blocks-ready,deleted-file-rejected}.test.ts`

Files (commit 5: review-system.md template + composer with `{{REVIEW_CONTEXT}}` token):
- `src/prompts/review-system.md` (~3.5-4.2k; universal-rules + tests-first directive + five-axis scaffolding + exact false-security-coverage caveat + 1 needs-revision example + 1 tiny ready example + 2 inline rebuttals)
- `src/prompts/index.ts` `composeReviewPromptPure` with new `{{REVIEW_CONTEXT}}` token (round number + upstream refs + changed-file manifest + VERIFY pass summary + prior scores/verdicts + prior findings)
- `tests/prompts-review-{compose,tokens,topic1-content-snapshot}.test.ts`

Files (commit 6: reviewer persona — replaces M2 stub):
- `src/agents/defaults/reviewer.md` (~3.5-4k; universal-rules-injection + cross-family framing + `tool_use.repo_context` scope)

Files (commit 7: one-round REVIEW orchestrator):
- `src/phases/review.ts` — orchestrator: BUILD ref bind → cross-family invocation-time check (recorded BUILD family vs reviewer adapter family) → persona invoke → finalize with two-draft cap + bounded repair prompt → orchestrator computes binary Round-1 verdict + Final verdict → if `ready` exit; if `needs-revision` intervene with M9-followup pointer; if `block` intervention.
- `src/phases/scientist.ts` extension for REVIEW phase-tail (3/3 cap)
- `src/phases/review-resume.ts` — per-round atomic resume; partial drafts persisted under `.code-oz/runs/<runId>/review-drafts/round-N-attempt-M.md`; mismatch on resume → intervention.
- `tests/review-phase-{round-1-pass,round-1-needs-revision,round-1-block,cross-family-check,scientist-tail,partial-draft-resume,resume-mismatch-intervention}.test.ts`

Files (commit 8: one-round REVIEW e2e):
- `tests/e2e/review-lite-greenfield-pass.test.ts`
- FakeProvider keying extended to `(phase, agent, taskId, attempt, reviewRound)` with explicit object keying; fresh provider instance per test.

Files (commit 9: typed carry-forward source field for round 2+):
- `src/artifacts/build-report.ts` — `Failure carry-forward.Source` field added (`verify-fail | review-needs-revision`)
- `src/artifacts/review-report.ts` — REVIEW round 1 needs-revision exit writes typed carry-forward block (REVIEW.md path/sha + summary + constraint)
- `src/phases/build.ts` — BUILD prompt accepts attempt > 1 from either source
- `docs/contracts/BUILD.md` — carry-forward `Source` field documented
- `tests/build-report-typed-carry-forward.test.ts`, `tests/review-needs-revision-typed-carry-forward.test.ts`

Files (commit 10: REVIEW remediation coordinator + multi-round orchestrator):
- `src/phases/review-remediation.ts` (NEW coordinator — NOT `scheduleAttemptNPlus1` which is VERIFY-specific). Two monotonic global counters of 4 each per `(runId, taskId)`: max 4 clean BUILD attempts AND max 4 REVIEW provider rounds; whichever trips first owns intervention. Authority overlap: VERIFY-restart-cap-exhausted owns intervention with "while addressing REVIEW round N" context; REVIEW round count does not advance during VERIFY restart. Fingerprint-based ping-pong detection consumed from canonicalizer.
- `src/phases/review.ts` updated to call `review-remediation` on `needs-revision` exit
- `tests/review-remediation-{round-2-pass,round-2-block,review-cap-exhausted,build-cap-exhausted-during-review,authority-overlap-verify-owns,ping-pong-cap-naming}.test.ts`

Files (commit 11: multi-round e2e + spine e2e):
- `tests/e2e/review-lite-greenfield-multi-round.test.ts` (T-003: round 1 needs-revision → BUILD attempt 2 → round 2 ready)
- `tests/e2e/spine-greenfield.test.ts` — full DEFINE → PLAN → BUILD → VERIFY → REVIEW path
- `tests/fixtures/greenfield-baby-name` extended with T-003
- `docs/demo/v0.9-spine.md`

Acceptance:
- REVIEW receives changed file paths from BUILD's manifest (CLAUDE.md rule 2: never curated summaries).
- Cross-family enforcement layered: load-time in `loader.ts` (family-aware via `familyOf()`), invocation-time in `phases/review.ts` (recorded BUILD family vs reviewer adapter family), recorded post-condition in `REVIEW.md` `Reviewer.Cross-family check: passed`.
- Loop capped at 4 REVIEW rounds AND 4 BUILD attempts per `(runId, taskId)`, both monotonic; whichever trips first owns the intervention. VERIFY-restart cap exhaustion during REVIEW round N is VERIFY-owned with "while addressing REVIEW round N" context.
- Exit on `score ≥ 6` AND `verdict: ready` AND no unresolved `block` or `fix-first` (locked stricter `fix-first` rule).
- Worktree preserved through REVIEW; removed at REVIEW approval via `preApproveReviewHook`. Removal failure blocks gate write and emits intervention.
- Findings ping-pong detection: fingerprint-matched recurrence reopens original `F-NNN` id; cap-exhausted intervention names reopened findings explicitly.
- Repair prompts bounded: error code + violated rule + clipped offending lines only.
- Per-round atomic resume; partial drafts persisted; mismatch on resume → intervention.
- Topic-1 plumb-through verified via prompt-snapshot tests (`review-system.md` contains tests-first language, five-axis scaffolding, exact false-coverage caveat).
- REVIEW-lite e2e with FakeProvider: success path (one-round ready exit) and multi-round path (round 1 needs-revision → BUILD attempt 2 → round 2 ready). FakeProvider keyed by `(phase, agent, taskId, attempt, reviewRound)`.
- Full v0.9 spine e2e test passes.
- All M8 tests still pass (1325 carried).
- Codex implementation review (CLAUDE.md rule 8) returns `push` after fix-first commits land.
- Tag: `v0.9.0-alpha.0`.

NOT in M9: SHIP (W4), Debate runtime (M10), reviewer panels (M14 per post-M10 productization), runtime axis metrics for the five axes (M14 panel measurement territory), deleted-file findings (locked convention deferred), persona-authored binary verdicts (orchestrator-owned per M8 lesson), `scheduleAttemptNPlus1` reuse for REVIEW findings (VERIFY-specific; M9 commit 10 introduces separate coordinator), 16-iteration cap interpretation (two global monotonic counters of 4 each).

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

- **Product north star:** `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` names the durable product direction. Market category: repo-native agentic SDLC runtime. Product metaphor: AI software company. Competitors give you agents; `code-oz` gives you the company structure that makes agents define, debate, delegate, build, verify, review, and ship together. Category and metaphor split confirmed 2026-04-30 by Codex thesis pressure-test (`docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md`, thread `019de031`). Positioning and post-M10 roadmap input only — not a reason to expand M9 or M10.

- **Post-M10 productization (locked sequence, one authority boundary per milestone, per CLAUDE.md rule 20). Sequence revised 2026-05-01 after the xAI expansion debate (`docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`, thread `019de497`) — PE-1 inserted between M12 and M13:**
  - **M11 — Provider capability contract.** Authority boundary: provider eligibility. Strict-minimal `ProviderCapability` shape (`authSource | eligiblePhases | costPerMTok? | rateLimits?`). Load-time rejection of impossible (provider, phase) combinations including debate opposing-providers. No new roles. Landed as `docs/contracts/PROVIDERS.md` extension + `src/providers/capabilities.ts` defaults module + `IAgentProvider.capability` static field + `ProviderRegistry.capabilityOf` + `enforceProviderPhaseEligibility` loader walk. **Closed 2026-05-01 (v0.11.0-alpha.0, 1860 tests).**
  - **M12 — Company roster for shipped roles only.** Authority boundary: role-to-provider routing. `.code-oz/config.yaml` `company:` block routes the six bundled personas (BA + Lead + Builder + Verifier + Reviewer + Scientist) via the locked `M12_COMPANY_ROLES` constant; rows accept `{ provider?, model? }` only. Per-role budgets defer to M13; permissions stay persona-shaped; debate-opponent stays per-persona via `tool_use.debate.opposingProviders` (M15); orchestrator is the runtime, not a persona. **Ships before PE-1 because Company roster is the product-thesis differentiator; shipping M12 first means PE-1's xAI provider drops directly into a `company:` block on day one.** Contract trail: `docs/contracts/COMPANY.md`. Closure trail: `docs/research/CODEX_RESPONSE_M12.md` + `docs/research/CODEX_REVIEW_M12.md` + the post-tag inter-milestone refactor session (`docs/research/REFACTOR_AUDIT_2026-05-01.md`, blank-model + bootstrap-precision fixes). **Closed 2026-05-01 (v0.12.0-alpha.0, 1917 tests).**
  - **PE-1 — xAI direct HTTP adapter.** Authority boundary: outbound HTTP from `code-oz` itself + API-key trust-boundary expansion. `XaiProvider` reads `XAI_API_KEY` and posts to `https://api.x.ai/v1/chat/completions` (buffered, OpenAI-compatible subset). New `xai-api-key` authSource + `xai` row on `DEFAULT_CAPABILITY_BY_ID` (no `transport` field, M11 strict-minimal preserved). Strict request-body allowlist (`model` + `messages` + optional `max_tokens`); built-in xAI tools (`web_search`, `x_search`, `code_interpreter`) disabled by field omission. New `provider_model_missing` error code fires before any HTTPS request when `req.model` is undefined. `sanitizeFetchError` redacts the literal API key + `Bearer <token>` + auth-header patterns. `getProviderRegistry` + `runDoctorProviders` accept an optional `fetchRunner` test-injection seam. Trail: `docs/design/SESSION_XAI_EXPANSION_KICKOFF.md`, `docs/research/CODEX_BRIEFING_PE1.md`, `docs/research/CODEX_RESPONSE_PE1.md`, `docs/research/CODEX_BRIEFING_PE1_REVIEW.md`, `docs/research/CODEX_REVIEW_PE1.md` (rounds 1+2, both blockers closed). **Closed 2026-05-01 (v0.13.0-alpha.0, 1983 offline tests + opt-in live integration).**
  - **M13 — Role-cost policy under `budgets.global`.** Authority boundary: per-role budget gating + preflight estimates. Must precede any simultaneous-provider surface so the cost story is solid before parallelism lands. M11's `costPerMTok` and `rateLimits` advisory fields populate here.
  - **M14 — Reviewer panel v1.** Authority boundary: panel quorum + cross-family enforcement + synthesis. First simultaneous-provider surface. Same-family panelists are advisory only; cross-family quorum is required for `verdict: ready`. REVIEW.md schema extension may be needed; subject to its own pre-implementation Codex debate. Trail: `docs/research/CODEX_BRIEFING_M14.md`, `docs/research/CODEX_RESPONSE_M14.md` (R0 accept-with-modifications, thread `019deb75`), `docs/design/SESSION_M14_KICKOFF.md`, `docs/design/RALPH_M14_PROMPT.md`, `docs/research/CODEX_REVIEW_M14.md` (R1 fix-first → R8 push → R9 final pre-tag verification, all converged push). 35 single-axis implementation commits + 8 review rounds + R9 verification on `feat/m14-reviewer-panels`; runtime panel orchestrator now resolves `providerFamily` via `registry.familyOf()`, `runReview` dispatches to `runReviewPanel`, panel `REVIEW.md` passes `approve review`. **Closed 2026-05-03 (v0.15.0-alpha.0, 2425 tests).**
  - **M15 — Debate-policy scheduler v1.** Authority boundary: orchestrator-side automatic-trigger policy for the existing single-opponent `requestDebate()`. NOT multi-opponent debate. Trigger surface (post-REVIEW only): single-mode score grey-zone OR needs-revision-with-high-score; panel-mode eligible-voter disagreement only (Codex Risk #1 — panel REVIEW has no numeric Score.Final score). Default mode `manual` preserves M10 behavior; `auto` is opt-in via `debatePolicy:` block. Bundled `reviewer.md` granted `tool_use.debate` (Path A) so the rule-21 baseline measures on the canonical-fixture-friendly path. Lock-collision fix via executor seam — production fire path runs INSIDE the outer `runReview` lock envelope (Codex Risk #4). Failure surface partitions operator-actionable errors (auth / permission / concurrent / topic-collision / manifest-blocked → NEEDS_INTERVENTION) from transient/parse (degrade to original REVIEW + `debate_scheduler_error`). Rule-21 ship gate: `code-oz doctor --debate-policy-baseline tests/fixtures/debate-scheduler-baseline` requires `correctiveDeltaRate >= 0.10 AND newActionableFindingRate >= 0.30`. Two-phase delivery: Phase 1 telemetry + fixture math (10 commits, Ralph loop), Phase 2 production fire-path wiring under Codex R1 fix-first → replan Path B accept-with-modifications (10 commits including `runReviewRoundLocked` extraction, recursive post-debate REVIEW round inside the outer lock, fingerprint+severity finding diff in production, baseline reducer denominator counts every fire, scheduler-resume mismatch detection, and a production FakeProvider e2e via `buildProviderRegistry({ providerOverride: 'fake' })` that would fail on the no-op base SHA). Trail: `docs/research/CODEX_BRIEFING_M15.md` + `_REVIEW.md` + `_REPLAN.md` + `_R2.md`, `docs/research/CODEX_RESPONSE_M15.md` + `_REPLAN.md`, `docs/research/CODEX_REVIEW_M15.md` (R1 fix-first, 5 block-push + 4 fix-soon) + `_R2.md` (R2 push, all 9 R1 findings closed, one non-blocking N1 nit on briefing meta-drift deferred), `docs/design/SESSION_M15_IMPL_KICKOFF.md` + `SESSION_M15_PHASE2_KICKOFF.md`, `docs/contracts/DEBATE_POLICY.md`. **Closed 2026-05-08 (v0.16.0-alpha.0, 2706 tests).**
  - **M16 — Production CLI completion.** Authority boundary: production-runtime dispatch from `code-oz run` for the full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on greenfield multi-task PLANs. Pre-M16 the runtime functions (`runBuild`, `runVerify`, `runReview`) had full test coverage but were never wired into `src/commands/run.ts`; e2e tests bypassed the CLI and called runtime functions directly with hand-built option records. M16 closes that gap. New surfaces: per-task lifecycle cursor + projection helper (C1); cross-process fake-replay JSONL fixture (C2); production seams + exit-code contract (C3); idempotent worktree wrapper + `build.lock`/`verify.lock` mutual exclusion (C4); BUILD prompt persistence + sha256 + `preApproveBuildHook` (C5); `dispatchBuild` with `--task` override (C6); `dispatchVerify` with restart-loop routing + sha re-validation (C7); `dispatchReview` with single/panel mode + remediation event + sha re-validation (C8); task-loop dispatch with cursor-aware approve + worktree task-boundary recreate (C9); read-only `code-oz doctor run` inspector (C10); `--provider fake` stderr warning banner + emission event (C11); multi-task BUILD/VERIFY/REVIEW e2e via CLI binary spawn (C12); this docs closure (C13). 13 planned commits + 7 unplanned C9 follow-on fixes that closed 8 production bugs surfaced only by the C12 e2e — all bugs sat in the C9 task-loop dispatch surface (coupling between `approveReviewTaskGate` and adjacent helpers: `completeIncompleteTransitions`, `completeTransitionForPhase`, `requireGate`, `recoverOrphanGates`, `validateRunIntegrity`, `clearStaleGateFile`, `resolveNextReviewRound`, `dispatchReview`'s `task_review_passed` emission). Per-commit Codex pre-design caught contract intent but missed implementation drift; only the milestone-level e2e exposed coupling. Empirical evidence for CLAUDE.md rule 19 (integration tests are non-negotiable). Implications for M17 retrospective: rule 20 (one authority per milestone) needs sharper application — C9 bundled six sub-surfaces under "task-loop dispatch" and the breadth let coupling bugs through. **R1 review (2026-05-09) returned fix-first** with 4 block-push + 1 fix-soon findings, all closed in 6 follow-on commits before re-review: `(taskId, attempt)`-scoped crash window + `task_started` idempotency (R1 1/6, findings 1+5); `loadOrCreateRunWorktree` self-lock at `.worktree.lock` (R1 2/6, finding 2); audit-completeness recovery for crash-during-recreate (R1 3/6, finding 3); multi-task-friendly default per-phase budgets (R1 4/6, finding 4 — closes the M17-deferred UX gap above); VERIFY-fail restart e2e through the binary (R1 5/6) which surfaced + closed a sixth uncaught bug (verify-fail restart had no worktree recreation pattern; `isPostVerifyFailRecreation` added alongside `isPostTaskCompletedRecreation`); doc updates (R1 6/6, this row + KICKOFF + cli --help). Trail: `docs/design/SESSION_M16_KICKOFF.md`, `docs/design/SESSION_M16_C6_C13_LOOP_PLAN.md`, `docs/research/CODEX_BRIEFING_M16.md`, `docs/research/CODEX_RESPONSE_M16.md` (R0 feature-with-modifications). Pre-R1 HEAD: `9384522`; post-R1 fix-first HEAD: see commit log on `feat/m16-cli-completion`. **Closed locally 2026-05-09 (27 production commits + 6 R1 fix-first commits = 33 on `feat/m16-cli-completion`, 2706 → 3108 tests, +402 tests, 0 fail / 1 skip; tag pending R2 verdict + push approval).**
  - **M16+ (deferred until measurable need):** Researcher phase-tail (when Lead-persona source verification overflows), parallel builder candidates (security-wedge trigger), multi-opponent debate (when single-opponent proves insufficient on real disagreement cases), Skills layer architecture (when M9/M10 produce duplication pain).
  - Discipline: many agents may reason in parallel; only isolated builders mutate worktrees; only the orchestrator writes canonical artifacts and gates. CLAUDE.md rule 21 (Agentless-promoted-to-rule): no parallel-provider surface lands without measurable risk reduction in `events.jsonl` against the simpler baseline.

- **Provider expansion track (PE-N, demand-gated insertion points). Pattern locked 2026-05-01 after the xAI expansion debate:**
  - **PE-1 — xAI direct HTTP adapter (committed, inserts between M12 and M13).** First adapter that reads/transmits an API key + first outbound HTTP from `code-oz` itself. Trust-boundary discipline locked in `docs/references/provider-contract.md` § "Auth model" before PE-1 commit 1: env var naming (`XAI_API_KEY`), redaction (no API key in `events.jsonl`, gate files, `NEEDS_INTERVENTION.json`, doctor output, error messages, request/response logs), "never log Authorization headers", HTTP error-code mapping (401 → `provider_auth_missing`; 403 → `provider_permissions_violation`; 429 → `provider_rate_limit`; 5xx → `provider_io_error`).
  - **PE-2 — OpenRouter adapter (demand-gated insertion point).** May insert between PE-1 and M13, or between M13 and M14, depending on the post-PE-1 friend-survey checkpoint result. Owner of the lineage-resolution authority: when upstream is hidden behind a router, REVIEW/Debate proof roles require a resolved provider binding (not just `familyOf(providerId)`). Typed error: `loader_provider_lineage_unknown` (or pre-invoke equivalent), NOT a phase-eligibility overload. Commits only if measurable demand confirms routed retail access matters.
  - **PE-3+ — Gateway (LiteLLM / Portkey) and cloud routes (Azure AI Foundry, AWS Bedrock, Google Vertex AI).** Each is its own milestone with its own planning round, implementation review, and tag. Each commits only with measurable per-route demand. Cloud routes defer to v0.2 because each carries separate IAM + region + catalog discipline (Azure Foundry currently surfaces Grok models; Bedrock and Vertex do not as of 2026-05-01 per Codex fact-check). No batch "cloud routes" milestone.
  - **Demand-checkpoint discipline:** after PE-1 ships, after M13, after M14 — survey friends on which route they actually use before committing to PE-2/PE-3+. New pattern parallel to CLAUDE.md rule 21's measurable-risk-reduction: measurable-demand-evidence earns insertion slots. Without survey signal, no PE-2+ commit; cloud routes defer to v0.2.

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

- **Deferred-with-trigger items** (not on the critical path; reopen only when the named trigger fires):
  - `symbol` repo-context tool backend — Option D-reserved per the codegraph comparison synthesis. The slot stays reserved at the type union, rejected at config-load and at runtime, until the 4-condition AND telemetry signal in `docs/contracts/REPO_CONTEXT.md` § "Reservation and reopen-the-slot signal" fires (high search churn + manifest-cap saturation + phase result-tokens > 200k + downstream VERIFY/REVIEW failure attributable to missed semantic context, on three runs across two repos). When the signal fires, reopen the four-way decision in `docs/comparison/06-codegraph/COMPARISON.md` § "The real question Codex must answer" (LSP / native tree-sitter+SQLite / consume codegraph as MCP / extend the deferral). Replaces the prior "Optional `symbol` LSP integration" line.
  - Framework-aware route detection (B5 from the codegraph comparison) — pattern that emits `route` nodes for 13 web frameworks, linking URL patterns to handler symbols. Reopen if a routing/API-surface audit persona enters the company roster (W4 candidate); until then no orchestrator persona consumes the data and the borrow does not earn its rule-20 cost.

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
