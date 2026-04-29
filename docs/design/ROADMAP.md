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

### M6 — `feat(plan): implement 3-source verification and PLAN contract`
Files: `src/phases/plan.ts`, `src/artifacts/{plan,source-check}.ts`, `src/sources/{spec,reference,docs}-source.ts`, `src/prompts/plan-system.md`, `docs/contracts/{PLAN,SOURCE_CHECK}.md`, `tests/{plan-phase,sources}.test.ts`
Acceptance: PLAN cannot pass without `SOURCE_CHECK.md` naming spec, reference (or explicit none-found rationale), and docs (or explicit no-library rationale); PLAN emits atomic tasks with file targets, validation commands, risk notes; gate waits before BUILD-lite.

### M7 — `feat(spine): add build-lite verify-lite review-lite demo path`
Files: `src/phases/{build,verify,review}.ts`, `src/worktree/create-run-worktree.ts`, `src/patches/apply-agent-patch.ts`, `src/artifacts/{build,verify,review}-report.ts`, `fixtures/greenfield-web/`, `tests/e2e/spine-greenfield.test.ts`, `docs/demo/week-1-spine.md`
Acceptance: one offline e2e test runs DEFINE → REVIEW-lite in a temp fixture; REVIEW receives changed file paths, not summaries; review loop is capped; `code-oz run --provider fake --fixture greenfield-web` produces complete local trace and stops at REVIEW gate.

---

## Beyond v0.1 (post-MVP queue, ordered)

- **W2:** Real Claude integration polish, non-technical UX hardening (canned transcripts → expected SPEC snapshots), Common Rationalizations table integrated into all phase prompts
- **W3:** Codex/Gemini provider integration, cross-family REVIEW with real providers, installer (`curl | sh`, npm, Homebrew tap)
- **W4:** Brownfield AUDIT phase fully implemented (`AUDIT.md` contract), `.code-ozignore`, secret redaction, "files sent to provider" preview, `code-oz upgrade --check`
- **W5+:** Full SHIP phase, more personas (PM/UX/FE/BE/QA splits), agent pack marketplace contract validation, Playwright MCP for VERIFY, `consult()` broad primitive (v0.3), telemetry bundles via `code-oz doctor --bundle`

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
