---
session: Retrospective — full 3-session + demo sweep
phase: retro (one round, sandbox read-only)
authoritative-contract: docs/design/CODEX_SYNTHESIS_3SESSION_HANDOFF.md § "Demo prep — post-Session 3 (locked)" ordered step 7
prior-handoffs: docs/handoffs/2026-05-12-session-1-clean.md → docs/handoffs/2026-05-12-session-2-b1a-effort.md → docs/handoffs/2026-05-12-session-3-opencode-triage.md
---

# Codex retrospective briefing — 3-session + demo sweep

## Goal

One Codex review round on the cumulative work shipped from the planning convergence (2026-05-12) through the demo prep that closes today. Per the locked synthesis § "Demo prep — post-Session 3" ordered step 7: "Codex retrospective. One round on the full 3-session + demo sweep. Anything that should change about how comparison series ships next time? Anything the demo over-promises?"

This is a retrospective, not a final pre-tag gate. The pre-tag review (if any) is Codex R-tag on the v0.19.0-alpha.0 candidate state separately.

## What shipped this sweep (20 commits ahead of pre-plan baseline e64e4ff)

### Session 1 (planning + clean working tree) — 3 commits

| SHA | Commit |
|---|---|
| `2e2bdbc` | docs(handoffs): preserve 2026-05-11 AFK merge loop handoff |
| `daa891c` | chore(gitignore): ignore .claude/ host scratch directory |
| `2e49704` | docs(design+handoffs): three-session handoff briefing + Codex response + synthesis + Session 1 closing handoff |

### Session 2 (B1a --effort flag) — 5 worktree commits + 3 main commits + 1 fix-correction

| SHA | Commit |
|---|---|
| `1176d5d` | docs(comparison): ARIS borrow audit + B1a design doc |
| `252baac` | feat(config): applyEffort() pure transform for B1a (Commit 1 of 2) |
| `b605f48` | feat(config+state): --effort flag wires budget envelope through CLI, events, active-run replay (Commit 2 of 2) |
| `0595a99` | docs(b1a): close Codex R1 doc/comment drift (thread 019e1807) |
| `c075e60` | docs(b1a): Codex R2 narrow-drift verification (thread 019e1810) |
| `3926963` | Merge branch 'worktree-aris-borrows-pre-m17' into main (B1a) |
| `a7f0c57` | chore(release): close v0.18.0-alpha.0 release residue (5-file version sync) |
| `184fa4d` | docs(handoffs): Session 2 closing handoff |
| `e7a24e6` | docs(handoffs): fix commit-count accuracy in Session 2 handoff (5 → 11) |

### Session 3 (opencode triage + branch hygiene) — 4 commits

| SHA | Commit |
|---|---|
| `6fae670` | Merge branch 'worktree-opencode-fixfirst' into main (MCP trust-boundary + 2 candidate slots) |
| `63d18c2` | docs(opencode-r-merge): Codex R-merge briefing + response (thread 019e1837, verdict push) |
| `89feb0b` | docs(handoffs): Session 3 closing handoff |
| `f65d1f9` | docs(handoffs): fix commit-count accuracy in Session 3 handoff (15 → 16) |

### Demo prep — 4 commits

| SHA | Commit |
|---|---|
| `818835f` | docs(demo): scope greenfield todo CLI demo — SPEC.md (step 1) |
| `5c1b6a7` | docs(demo): runner architecture for 01-todo-cli (step-2 design pre-implementation) |
| `7cbe4a3` | feat(demo): shell-driven greenfield todo CLI runner + 3-effort captures |
| `da13deb` | docs(demo): walkthrough README + root README Demo section (steps 5 + 6) |

Plus this retrospective and (later) its response, then the tag commit.

### Test count delta

| State | Count | Source |
|---|---|---|
| Pre-plan baseline (2e49704 era) | 3244 / 0 fail / 2 skip | Session 1 closing handoff |
| Post-B1a (b605f48) | 3163 (on the worktree branch baseline) | Session 2 handoff |
| Post-merge to main (3926963) | 3292 / 7 fail | Session 2 handoff |
| Post-v0.18-residue fix (a7f0c57) | 3299 / 0 / 2 | Session 2 closing handoff |
| Post-opencode merge + R-merge (89feb0b) | 3299 / 0 / 2 | Session 3 closing handoff |
| Post-demo prep (da13deb) | 3299 / 0 / 2 | Session 4 (this) — demo is docs+script-only |

## What the demo actually exercises

`scripts/demo/01-todo-cli/run-demo.ts` (~560 LOC) drives a full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle via the FakeProvider. The demo is honest about the FakeProvider trade-off; the demo README has a "What's real and what's simulated" table.

Real:
- Orchestrator phase machine, gate file writes + sha256 binding, `parseSpec` / `parsePlan` / `parseSourceCheck` / `parseBuildReport` / `parseVerifyPersonaResponse` / `parseReviewReport` running on the canned content
- Cross-family REVIEW: BUILD's `agent_invoked.provider = claude`, REVIEW's reviewer provider family = codex; cross-family check passes per `M14 Reviewer panel v1` enforcement
- `--effort` envelope captured at run start; all three levels (lite 0.4×, balanced 1.0×, beast 6.0×) produce distinct `effort_envelope_applied` events at position 2
- Mutation gate revert + replay: `Validation: test -f src/todo.ts` makes the gate non-tautological (reverted file → command fails → mutation status pass)

Simulated:
- Persona responses (canned JSONL via FakeProvider; no live LLM calls)
- Outbound network (no provider HTTPS)
- `bun test` against the built todo CLI is NOT the validation command (the cycle uses `test -f src/todo.ts` instead so it's reproducible offline without bun-test config; the actual `src/todo.ts` and `tests/todo.test.ts` BUILDER diff is committed and would run if invoked)

## Specific questions for Codex

### 1. Comparison series retrospective

The sweep closed 22 template comparisons + several follow-up borrows + the 3-session reframe (Sessions 2/3 strictly serial due to schema conflict, Session 3 reframed from "Commit A 2/3" to "opencode triage" per the synthesis H4 reframe).

- **Cadence**: Is the locked-synthesis-then-execute pattern (Codex pre-design → R0 → R1 → R2 push for behavior changes; R-merge alone for docs-only merges) holding? Session 2 ran four Codex rounds (pre-design + R0 + R1 + R2) for one CLI flag + one rule; Session 3 ran one Codex round for a docs-only merge. Is that calibrated correctly?
- **Memory hygiene**: 4 memory entries landed during this sweep (`feedback_preflight_worktree_state`, `session_1_3session_plan`, `session_2_b1a_v018_residue`, and the Session 3 entry yet to land). All under `~/.claude/projects/.../memory/`. Are these too granular (per-session memory entries that should be consolidated) or appropriately scoped?
- **Per-session handoff doc discipline**: Each session closes with a `docs/handoffs/2026-05-12-session-N-<topic>.md`. Two of the three sessions needed a follow-up correction commit for off-by-one commit-count math (`e7a24e6`, `f65d1f9`). Is the off-by-one a memory-worthy pattern, or a one-off noise class?

### 2. Demo over-promises check

Read `docs/demo/01-todo-cli/README.md` carefully. The README has a "What's real and what's simulated" table at the bottom.

- Anything in the README that claims more than the cycle actually does? Particular concerns:
  - The "Cross-family REVIEW" highlight cites BUILD on Claude family / REVIEW on Codex family — but both invocations are FakeProvider scripts. The `provider` field reflects the registry route, not a real Anthropic/Codex API call. Is that adequately disclosed?
  - The `--effort` flag highlight quotes events.jsonl multipliers. Are these multipliers obviously *budget* knobs (not assurance)? Rule 23 says assurance invariants stay fixed; the demo's `EVENTS.json` proves this but the README walkthrough may not make it crisp enough.
  - The validation command swap (`true` → `test -f src/todo.ts`) is honest in the README's "What's real and what's simulated" row ("PLAN's validation command is `test -f src/todo.ts` so the cycle is reproducible offline"). Is the disclosure prominent enough, or should the README also include the runner's `bun test` honest output in a separate "bonus" section?

### 3. Runner architecture risks

`scripts/demo/01-todo-cli/run-demo.ts` (~560 LOC) inlines:
- `initProject` import from `src/commands/init.ts` (programmatic, not subprocess)
- Per-phase budget bumps via `yaml` parse/stringify
- Git init + commit per project
- Per-spawn JSONL fake-script writes
- Output capture (`cp -r` of artifacts + gates + events.jsonl)

Concerns to validate:
- The runner is committed under `scripts/demo/` not `tests/`. It does NOT import from `tests/e2e/helpers/multi-task-cli.ts`. If the helper's `setupMultiTaskProject` ever drifts (e.g., adds a new required config key), would the demo runner silently break? Or are the two surfaces independent enough?
- The runner authors canned responses inline (~150 LOC of constants). Each canned response went through individual `parseSpec` / `parsePlan` / etc. validation during authoring. If a future change to those parsers rejects a previously-valid shape, the demo runner breaks. Is that an acceptable coupling, or should the demo runner run its own pre-flight validation against the parsers before invoking the CLI?
- The runner does NOT execute the actual `bun test` against the built todo CLI source. The diff is real; the tests are real; they're just not exercised by VERIFY in this demo. Should the runner have a `--real-validation` flag that swaps `Validation: test -f src/todo.ts` for `Validation: bun test`, runs an actual `npm i bun-types` step in the tmp project first, and exercises the tests? Or is that out of scope for v0.19.0-alpha.0?

### 4. Tag readiness for v0.19.0-alpha.0

The locked synthesis § "Demo prep" step 8 says: "Request explicit tag approval from Ozzy. On approval: bump package.json to `0.19.0-alpha.0`, tag `v0.19.0-alpha.0`, push tag, publish GitHub release."

Lessons from v0.18 release residue (`a7f0c57`): the release commit `e64e4ff` silently missed 5 version-bearing surfaces beyond `package.json` (`src/cli.ts:PKG_VERSION`, `src/config/schema.ts:DEFAULT_CONFIG.version`, `tests/m5-fix-first.test.ts:CURRENT`, `tests/cli-init.test.ts` expected literal, `tests/smoke-test.test.ts:VERSION` fixture). The version-consistency guard tests caught it on the merge but ONLY after baseline tests were re-run.

- Should v0.19.0-alpha.0 ship with a single tag commit that touches ALL 5 surfaces? Or is there a single canonical source-of-truth pattern that should land FIRST (e.g., a `src/version.ts` constant that the others import from) so future releases don't repeat the residue lesson?
- The opencode-fixfirst merge brought in 4 new opencode comparison docs + 1 new contract + 2 roadmap candidate slots. The B1a flag added rule 23 to CLAUDE.md. Any of these need additional sanity checks before tagging?
- The asciicast (`docs/demo/01-todo-cli/cast.cast`) is NOT yet recorded. Synthesis says "asciinema rec ... against the dry-run script." Should the asciicast land BEFORE the tag, or can it be a v0.19.x.0 follow-up?

### 5. Anything I missed

Open question class. Anything in the sweep — Sessions 1/2/3, demo prep, or the cumulative branch state — that violates a CLAUDE.md rule (1-23), drifts from the locked synthesis, or warrants a memory entry that wasn't captured?

## Recommended response format

Verdict: `tag-ready` / `fix-first` / `debate-required`, with severity-tagged findings:
- **block-tag** — must close before `v0.19.0-alpha.0` ships.
- **block-next-comparison** — must close before the next template comparison or major borrow lands.
- **fix-soon** — should close within 1-2 sessions but not blocking the tag.
- **nit / fyi** — no action expected.

Cite file paths + line numbers for every finding (`docs/...:NN`). Pull from `git log --oneline e64e4ff..HEAD` for the cumulative diff scope.

## Sandbox

`gpt-5.5` xhigh, `sandbox: read-only`. Single round.
