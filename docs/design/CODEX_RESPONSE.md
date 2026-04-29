## Where I agree

Option C is right about the front door. The non-technical intent elicitation is the part that earns the name `code-oz`; a Bun rewrite of Maestro without that UX would be a competent orchestration tool, not a differentiated product.

Opus is also right to reject option D. Six phases, nine personas, three providers, Playwright, brownfield, marketplace, and a polished binary in v0.1 is not an MVP. It is a multi-month platform build pretending to be a release plan.

I also agree that full option B is too large if "full lifecycle" means production-grade BUILD, VERIFY, REVIEW, SHIP with real cross-provider agents, real browser automation, full brownfield support, and all escape hatches working. That is not a 3-4 week solo-engineer v0.1.

The locked architecture direction is mostly correct:

- Markdown plus YAML frontmatter is the right agent package format because agent-skills and claude-code both prove that filesystem discovery beats a database-backed persona registry for local dev tools.
- File-based gate signals are correct because Maestro already learned the expensive lesson: never infer pass/fail from LLM prose.
- Plain Markdown artifact contracts are correct because ARIS-style cross-review works best when reviewers inspect files, not serialized summaries.
- A phase graph is correct because code-oz is an SDLC product, not a general chat router.
- Worktree-per-run isolation from Archon should be treated as early infrastructure, not later cleanup.

But this is where agreement stops: Option C is a good product demo script, not a good MVP architecture. It proves the least risky half of the product and skips the control mechanics that make code-oz more than an ask-me spec writer.

## Where I disagree (with specific alternative)

I reject Option C as the v0.1 MVP. Stopping after PLAN is too small and it validates the wrong risk.

The hardest risk in code-oz is not whether a BA persona can ask a non-technical user good questions. That is important, but it is not the thing that killed earlier multi-agent systems. The hard risk is whether the product can safely move from human intent to repo changes through enforced gates, observable execution, resumable state, provider boundaries, and adversarial review without trusting agent prose.

Option C does not exercise the most important audited lessons:

- Maestro's file-gate lesson matters most when an agent has modified files and wants to claim success.
- ARIS's cross-family review loop matters only after BUILD has produced artifacts to review.
- Pi-mono's streaming event model matters when a run can hang, retry, branch, or require intervention.
- Archon's worktree-per-run isolation matters when code-oz writes into a real project.
- Agent-skills' "Common Rationalizations" pattern matters when agents are tempted to skip verification or overclaim completion.

My alternative is Option E: a spine-first end-to-end MVP.

Option E scope:

- `code-oz init` creates `.code-oz/`, installs default agents, writes config, and detects greenfield or brownfield.
- `code-oz run` executes DEFINE -> PLAN -> BUILD-lite -> VERIFY-lite -> REVIEW-lite on a deliberately tiny target.
- DEFINE still has the killer non-technical ask-me flow and produces `SPEC.md`.
- PLAN still performs 3-source verification and produces `PLAN.md` plus `SOURCE_CHECK.md`.
- BUILD-lite performs exactly one atomic task from `PLAN.md`, in an isolated worktree, through a patch contract.
- VERIFY-lite runs one configured command or generated smoke test and writes `VERIFY.md`.
- REVIEW-lite passes file paths to a reviewer and enforces a capped loop, even if the second provider is initially a contract-tested fake or local CLI adapter.
- SHIP is stubbed. Brownfield AUDIT can be stubbed behind detection, but its artifact contract must be defined.

This is not option B. It is not "full lifecycle." It is one narrow executable thread through the real architecture. It proves the spine before expanding the muscles.

The demo should be tiny by design. For example: user says "make a simple webpage that tracks baby nap times." code-oz asks clarifying questions, writes a small spec, plans one task, creates one file or patch in a fixture app, runs `bun test` or a smoke command, asks a reviewer to inspect changed file paths, and stops at a REVIEW gate. That is more compelling than a polished DEFINE/PLAN demo because it shows the promise of code-oz: not just thinking, but controlled delivery.

I also disagree with "IAgentProvider designed in but only Claude implemented." That is the worst version of an abstraction: real complexity with no proof. Either implement the provider boundary with contract tests and at least two runnable provider paths, or keep v0.1 explicitly single-provider and do not pretend the locked decision is satisfied.

My specific call:

- Keep `IAgentProvider` on day one.
- Add `FakeProvider` on day one for deterministic tests.
- Add `ClaudeProvider` as the first real provider.
- Add `CodexProvider` as the second real or semi-real adapter by v0.1 if cross-family REVIEW is a locked rule.
- Put `GeminiProvider` behind a declared experimental flag if needed, but do not let frontmatter claim Gemini support until it runs.

The cross-provider `consult(agent, question)` tool is not v0.1. It is v0.3. In v0.1, every agent should receive a narrower `requestReview({ reviewer, files, question })` capability at the REVIEW gate only. General-purpose consult will become a hidden coupling mechanism, make runs harder to replay, and create cost explosions. ARIS proves adversarial review is valuable; it does not prove every agent should be able to summon every other agent at any time.

I also disagree with "file-based gate mechanism" as the whole state model. Gate files are the external authority, but code-oz still needs a typed internal finite state machine and append-only event log.

Use this model:

- `.code-oz/state/events.jsonl` is the append-only run trace.
- `.code-oz/state/current.json` is derived convenience state.
- `.code-oz/state/GATE_DEFINE_PASSED.json` and peers are durable gate signals.
- `src/state/machine.ts` owns legal phase transitions.
- `src/state/gates.ts` validates gate files with schemas.

Do not use SQLite in v0.1. SQLite is better later for queryable history, but it adds migration and corruption handling before the product has earned it. JSONL plus schema-validated gate files is enough, aligns with Maestro, and keeps the local filesystem story simple.

## What's missing

Telemetry and observability:

Opus skipped how the user knows code-oz is stuck. Add local-first telemetry from day one: `events.jsonl`, streamed terminal events, phase timers, provider call start/stop events, retry counts, and `NEEDS_INTERVENTION.json` with a concrete reason. No remote telemetry by default. Add an opt-in `code-oz doctor --bundle` that packages redacted logs for debugging.

Cost controls:

Opus skipped budgets. Add `maxTurns`, `maxProviderCalls`, `maxTokensEstimate`, `maxReviewRounds`, and per-phase budgets in `.code-oz/config.yaml`. Before a high-cost model or xhigh reasoning call, code-oz should print a projected budget warning and require approval unless the config explicitly allows it. "Opus default; warn on downgrade" is not enough; premium-model defaulting needs a spend brake.

Security and sandboxing:

The `.ts` escape hatch is dangerous. Add a permission manifest before executing any sibling `.ts`: allowed commands, allowed network, allowed file roots, allowed env vars, timeout, and whether secrets are accessible. Default is no execution. BUILD runs in an isolated worktree. Agents pass patches or artifact files, not arbitrary shell strings.

Testing strategy:

Opus skipped how to test a multi-agent product. Add fake providers, golden transcript fixtures, schema tests for every artifact contract, CLI integration tests against temp directories, state-machine transition tests, and fixture repos for greenfield and brownfield detection. The first test suite should not require Claude, Codex, Gemini, or network access.

Marketplace and extension compatibility:

If plugins are directories of Markdown plus optional hooks, define the package contract now. Add `agentpack.yaml`, semantic versioning, required fields, supported `codeOzVersion`, permission declarations, and validation via `code-oz pack validate`. Do not build a marketplace yet, but prevent local agent packs from becoming incompatible folklore.

Update mechanism:

Opus mentions opencode-style distribution but not update behavior. Add `code-oz version`, `code-oz upgrade --check`, install-channel metadata, checksum verification, and release notes plumbing. The binary can defer self-upgrade implementation, but the command surface and release metadata should exist before public install scripts spread.

Brownfield AUDIT:

Brownfield is not "skip DEFINE." It needs its own artifact: `AUDIT.md` with repo map, detected stack, existing commands, risk areas, test surface, and owner assumptions. Brownfield should then produce a constrained `SPEC.md` or `CHANGE_REQUEST.md`. Without AUDIT, code-oz will treat existing projects like blank canvases and break user code.

Credential and provider health:

Subscription-first depends on local CLI OAuth state. Add `code-oz doctor providers` to check Claude, Codex, and Gemini auth status without starting a run. Provider failures should become actionable `NEEDS_INTERVENTION` files, not opaque SDK stack traces.

Privacy and data boundaries:

The user may run code-oz in private repos. Add `.code-ozignore`, default secret redaction, file-size caps, binary-file exclusion, and a visible "files sent to provider" preview per phase. Agents should receive explicit file manifests, not silent recursive repo context.

Recovery and resume:

Option C does not define interrupted-run behavior. Add `runId`, resumable phase state, idempotent gate writes, and `code-oz resume`. If the terminal dies after PLAN but before approval, the next boot should not restart DEFINE.

UX acceptance criteria:

The ask-me flow needs tests, not vibes. Add canned non-technical transcripts and expected `SPEC.md` snapshots. The BA should ask fewer, better questions, preserve uncertainty, and stop when a spec is actionable. The goal is not an interview; it is a usable build contract.

## My day-1-through-day-7 plan

Day 1: PR 1, `feat(cli): bootstrap code-oz binary and project layout`

Create:

- `package.json`
- `bun.lock`
- `tsconfig.json`
- `src/cli.ts`
- `src/commands/init.ts`
- `src/commands/run.ts`
- `src/commands/doctor.ts`
- `src/paths.ts`
- `src/config/schema.ts`
- `tests/cli-init.test.ts`
- `docs/adr/0001-mvp-option-e.md`

Commit sequence:

- `chore: initialize bun typescript cli`
- `feat: add init command and code-oz directory layout`
- `test: cover init in temporary project directories`

Acceptance:

- `bun test` passes.
- `bun run build:binary` creates a local executable.
- `code-oz init` writes `.code-oz/config.yaml`, `.code-oz/agents/`, `.code-oz/artifacts/`, `.code-oz/state/`, and `.code-oz/runs/`.

Day 2: PR 2, `feat(agents): load markdown agent packs with schemas`

Create:

- `src/agents/frontmatter.ts`
- `src/agents/loader.ts`
- `src/agents/schema.ts`
- `src/agents/defaults/ba.md`
- `src/agents/defaults/lead.md`
- `src/agents/defaults/builder.md`
- `src/agents/defaults/verifier.md`
- `src/agents/defaults/reviewer.md`
- `src/agentpacks/schema.ts`
- `tests/agents-loader.test.ts`
- `tests/fixtures/agents/`

Commit sequence:

- `feat: add markdown frontmatter agent schema`
- `feat: install default phase agents during init`
- `test: reject invalid agent packs`

Acceptance:

- Required frontmatter includes `name`, `type`, `phase`, `provider`, `modelPolicy`, and `permissions`.
- Loader supports project-local overrides without mutating bundled defaults.
- Invalid phase names fail fast.

Day 3: PR 3, `feat(state): add phase machine, event log, and gate files`

Create:

- `src/state/machine.ts`
- `src/state/events.ts`
- `src/state/gates.ts`
- `src/state/run.ts`
- `src/state/schemas.ts`
- `src/commands/approve.ts`
- `tests/state-machine.test.ts`
- `tests/gates.test.ts`
- `docs/contracts/GATES.md`

Commit sequence:

- `feat: add typed lifecycle state machine`
- `feat: append run events to jsonl`
- `feat: add schema validated gate approval command`
- `test: cover illegal phase transitions`

Acceptance:

- No phase can advance by parsing LLM text.
- `code-oz approve DEFINE` writes `GATE_DEFINE_PASSED.json`.
- Event log records phase start, phase end, provider call, gate wait, approval, pause, and intervention.

Day 4: PR 4, `feat(providers): add provider contract and deterministic test provider`

Create:

- `src/providers/types.ts`
- `src/providers/fake.ts`
- `src/providers/claude.ts`
- `src/providers/codex.ts`
- `src/providers/gemini.ts`
- `src/providers/registry.ts`
- `src/providers/health.ts`
- `src/tools/review-request.ts`
- `tests/provider-contract.test.ts`
- `tests/provider-health.test.ts`
- `docs/contracts/PROVIDERS.md`

Commit sequence:

- `feat: define agent provider contract`
- `feat: add fake provider for deterministic runs`
- `feat: add provider health checks`
- `feat: add review request tool contract`
- `test: enforce provider event behavior`

Acceptance:

- Fake provider can run the whole lifecycle offline.
- Real provider adapters fail with actionable `NEEDS_INTERVENTION.json` if auth is missing.
- `consult()` is deliberately not added. Only `requestReview()` exists.

Day 5: PR 5, `feat(define): implement ask-me flow and SPEC contract`

Create:

- `src/phases/define.ts`
- `src/artifacts/spec.ts`
- `src/prompts/define-system.md`
- `src/prompts/common-rationalizations.md`
- `docs/contracts/SPEC.md`
- `tests/define-phase.test.ts`
- `tests/fixtures/transcripts/nontechnical-baby-game.md`

Commit sequence:

- `feat: add define phase runner`
- `feat: write spec artifact from elicitation transcript`
- `test: snapshot nontechnical spec generation with fake provider`

Acceptance:

- DEFINE writes `.code-oz/artifacts/SPEC.md`.
- SPEC includes goals, users, constraints, acceptance criteria, open questions, and explicit non-goals.
- Gate waits for user approval before PLAN.

Day 6: PR 6, `feat(plan): implement 3-source verification and PLAN contract`

Create:

- `src/phases/plan.ts`
- `src/artifacts/plan.ts`
- `src/artifacts/source-check.ts`
- `src/sources/spec-source.ts`
- `src/sources/reference-source.ts`
- `src/sources/docs-source.ts`
- `src/prompts/plan-system.md`
- `docs/contracts/PLAN.md`
- `docs/contracts/SOURCE_CHECK.md`
- `tests/plan-phase.test.ts`
- `tests/sources.test.ts`

Commit sequence:

- `feat: collect spec reference and docs evidence`
- `feat: write source check artifact`
- `feat: write atomic plan artifact`
- `test: block plan without three-source evidence`

Acceptance:

- PLAN cannot pass unless `SOURCE_CHECK.md` names spec, reference code or explicit none-found rationale, and library docs or explicit no-library rationale.
- PLAN emits atomic tasks with file targets, validation commands, and risk notes.
- Gate waits for user approval before BUILD-lite.

Day 7: PR 7, `feat(spine): add build-lite verify-lite review-lite demo path`

Create:

- `src/phases/build.ts`
- `src/phases/verify.ts`
- `src/phases/review.ts`
- `src/worktree/create-run-worktree.ts`
- `src/patches/apply-agent-patch.ts`
- `src/artifacts/build-report.ts`
- `src/artifacts/verify-report.ts`
- `src/artifacts/review-report.ts`
- `fixtures/greenfield-web/`
- `tests/e2e/spine-greenfield.test.ts`
- `docs/demo/week-1-spine.md`

Commit sequence:

- `feat: create isolated run worktree`
- `feat: apply one build task through patch contract`
- `feat: run configured verification command`
- `feat: add capped review-lite loop`
- `test: cover define to review spine with fake providers`

Acceptance:

- One offline e2e test runs DEFINE -> PLAN -> BUILD-lite -> VERIFY-lite -> REVIEW-lite in a temp fixture.
- REVIEW receives changed file paths, not summaries.
- Review loop is capped and writes `REVIEW.md`.
- `code-oz run --provider fake --fixture greenfield-web` produces a complete local trace and stops at the REVIEW gate.

This first week creates a product skeleton that can survive contact with real implementation. Week 2 can deepen Claude integration and non-technical UX. Week 3 can add Codex/Gemini review and installer distribution. Week 4 can harden brownfield AUDIT and public docs. That path is more honest than Option C because it demonstrates code-oz's defining claim: controlled, gate-enforced software delivery from plain-language intent.
