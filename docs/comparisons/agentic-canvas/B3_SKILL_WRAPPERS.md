# B3 — Lightweight skill-wrapper distribution (borrow from agentic-canvas, W3.x strategic)

## Status

Backlog. Target W3.x — promoted from "post-W3 polish" by Codex round 1 of the comparison synthesis. The native binary remains source of truth; skills are thin discovery shells. Pairs naturally with B2 (`RunSummary`) once a read-only summary surface exists, but does not block on B2 because the binary already prints structured exit codes and stderr reports today.

## Source pattern

agentic-canvas ships dual marketplace presence around a single workflow JSON contract.

- `~/Projects/agents/templates/agentic-canvas/plugin-claude/` — Claude Code plugin published to the marketplace as `mustafaakben/agentic-canvas-claude`. Manifest at `plugin-claude/.claude-plugin/plugin.json` (~22 lines, declarative metadata only). Four skills under `plugin-claude/skills/{plan,execute,review,repair}/SKILL.md`. Each `SKILL.md` is ~30–60 lines of YAML frontmatter + Markdown that delegate to a CLI named `agent-canvas`.
- `~/Projects/agents/templates/agentic-canvas/skills-codex/` — five Markdown files (`AGENTS.md` router + `plan.md` / `execute.md` / `repair.md` / `review.md`) that Codex CLI auto-discovers via `AGENTS.md`. Same four skills as the Claude plugin, restated for shell-first runtime. The router (`AGENTS.md`) carries the cross-cutting rules; the per-skill files carry trigger phrases plus shell flow.
- The shared CLI (`~/Projects/agents/templates/agentic-canvas/scripts/canvasctl.mjs`) is what both surfaces actually exec. Subcommands: `open`, `validate`, `new`, `print`, `summarize`, `claims`, `export-plan`. Each skill's "Default Flow" section is essentially "run subcommand, read result, decide next subcommand". A workflow planned in Codex is fully consumable by Claude Code, and vice versa, because the JSON file is the contract.

The pattern is deliberate: skills wrap the CLI, the CLI is the only authority, marketplace presence makes the wrapper discoverable inside the agent surfaces where users already live.

## Why this is W3.x not deferred

The held-back disagreement Codex named in round 1 of the comparison synthesis was "adoption can beat architecture." Discovery vs. authority is the load-bearing distinction here. code-oz's native binary distribution (W3 — npm + Homebrew + Scoop) is correct for *authority*: the binary is the single source of truth, gates are file-based, the orchestrator owns provider invocation, skills cannot bypass any of it. That is intentional and is not loosened by this borrow. But *authority is not adoption*. A binary distributed via three package managers is still invisible inside Claude Code and Codex CLI sessions unless the user knows it exists, knows its subcommands, and remembers to invoke it. agentic-canvas demonstrates that even technically inferior tools win adoption when they are present in the marketplace surfaces users already live in, because the agent's own skill discovery picks them up automatically.

Skill wrappers turn that asymmetry around without giving up anything. Two thin Markdown skill packs (one Claude plugin manifest + four `SKILL.md` files; one Codex `AGENTS.md` router + four routed Markdown skills) make `code-oz init`, `code-oz run`, and `code-oz doctor` discoverable from the first turn an agent encounters a code-oz repo. The skills do not ship runtime, do not embed orchestrator logic, do not add provider behavior, and do not produce gate writes — they are exec shells around the binary. The cost is one to two days of authoring + a CI publish workflow; the benefit is W3.x adoption parity with agentic-canvas and other marketplace-resident tools, plus a discovery story for the binary that does not depend on README scrolling. This is what makes the borrow strategic rather than cosmetic, and what justifies the W3.x target instead of "post-W3 polish, file it for v0.3".

## Proposed shape — Claude Code skill

A single Claude plugin (`code-oz-skills`) with one manifest and five `SKILL.md` files, each ~30 lines of Markdown wrapping a single binary subcommand. Manifest format follows the Claude plugin convention demonstrated by agentic-canvas's `plugin-claude/.claude-plugin/plugin.json` — declarative metadata only, no executable code, no MCP surface. The plugin ships no `bin/`, no vendored CLI, no `scripts/`. Skills exec the user-installed `code-oz` binary from PATH (W3 install lands it there).

Skill set (five), each one wraps one subcommand cleanly:

| Skill | Wraps | Trigger phrases |
|---|---|---|
| `code-oz:init` | `code-oz init` | "scaffold a code-oz project", "set up code-oz here", "init code-oz" |
| `code-oz:run` | `code-oz run` (and `--task`, `--phase` advance) | "drive the active phase", "advance the run", "run the next phase" |
| `code-oz:status` | `code-oz doctor run` + `code-oz doctor providers` + `code-oz doctor tools` + `code-oz doctor git` | "show run state", "what phase am I in", "is my run healthy", "check provider auth" |
| `code-oz:resume` | `code-oz run` after a `NEEDS_INTERVENTION` | "resume the run", "continue after intervention", "the run died, restart it" |
| `code-oz:view` | `code-oz view <runId>` (B4 viewer, when shipped) | "open the run viewer", "show me the canvas", "visualize the run" |

The `code-oz:status` skill bundles the four `doctor` subscopes deliberately — they are all read-only inspections and they answer the same user-level question ("is this run healthy"). Bundling them into one discovery skill matches how the binary already groups them under `doctor`, and it keeps the skill count at five rather than seven.

`code-oz:view` only ships once B4 lands — the skill is included in the W3.x plan because the plan is written once and the B4 milestone closing should add the skill rather than invent it from scratch later. Until B4 ships, the `code-oz:view` skill file declares itself unavailable and points to `code-oz:status` instead.

Manifest sketch (illustrative, mirrors agentic-canvas's manifest shape):

```json
{
  "name": "code-oz-skills",
  "description": "Discovery skills around the code-oz binary: init, run, status, resume, view. The binary is the source of truth; these skills are exec shells.",
  "version": "0.1.0",
  "author": { "name": "Ozzy (Omer Akben)", "url": "https://github.com/omerakben/code-oz" },
  "homepage": "https://github.com/omerakben/code-oz",
  "repository": "https://github.com/omerakben/code-oz",
  "license": "MIT",
  "keywords": ["code-oz", "agentic-sdlc", "multi-agent", "review-panel", "debate", "orchestrator"]
}
```

Per-skill file sketch — the `code-oz:init` skill, written end-to-end (illustrative, ~35 lines):

```markdown
---
description: Use when the user asks to scaffold a code-oz project, set up code-oz in this repo, init a new run, or start a code-oz session in a fresh directory.
argument-hint: "[goal-description]"
user-invocable: true
---

# Initialize a code-oz project

Use this skill to scaffold the `.code-oz/` directory, write the default config,
and prepare the repo for a `code-oz run`.

## Prerequisite

`code-oz` must be on PATH. If `command -v code-oz` returns nothing, ask the user
to install via `npm i -g code-oz`, `brew install omerakben/tap/code-oz`, or
`scoop install code-oz`. Do not fall back to a local copy — the skill never
ships its own runtime.

## Default flow

1. Confirm the working directory is the repo the user wants to scaffold.
2. Run:

   ```bash
   code-oz init
   ```

3. If the binary returns a non-zero exit, read the stderr message verbatim back
   to the user. Common cases: existing `.code-oz/` directory (use `--force`
   only with explicit user approval), missing git repo, write permission
   denied.
4. After a successful `init`, point the user at `code-oz run` (skill
   `code-oz:run`) or `code-oz doctor providers` (skill `code-oz:status`).

## Boundaries

- Never write `.code-oz/` files yourself. The binary is the only writer.
- Never edit `state/events.jsonl` or any `state/GATE_*` file.
- Do not run `code-oz init --force` without explicit user approval — `--force`
  destroys an existing run.
- If `code-oz` exits with `NEEDS_INTERVENTION`, surface the JSON path to the
  user and stop. Do not retry automatically.
```

The other four skills follow the same template — frontmatter trigger description, prerequisite check, default flow, boundaries — keeping each file at ~30 lines. The boundaries section is intentionally repetitive across skills; it is the load-bearing constraint that turns these into discovery shells rather than alternate runtimes.

## Proposed shape — Codex CLI skill

Same five skills, restated for Codex CLI's shell-first model. Structure mirrors `~/Projects/agents/templates/agentic-canvas/skills-codex/`:

- `AGENTS.md` — router. Lists the five skills, the trigger phrase table, the cross-cutting rules (binary-on-PATH check, no gate-bypass, no parallel state). Codex CLI auto-discovers `AGENTS.md` at the workspace root or a parent directory; the router stays small and declarative.
- `init.md` / `run.md` / `status.md` / `resume.md` / `view.md` — five per-skill files, each ~30 lines, each restating the same "prerequisite → default flow → boundaries" structure as the Claude `SKILL.md` files. Codex skills assume shell access and do not reference Claude-specific tools (no `--plugin-dir`, no SkillTool invocation; just `code-oz <subcommand>`).

`AGENTS.md` sketch (illustrative, ~40 lines):

```markdown
# code-oz — Codex CLI Skills

Discovery shells around the `code-oz` binary. The binary is the only writer
of state, gate files, events, and artifacts. These skills exec it; they do
not replicate it.

## When to use which skill

| User intent | Skill file |
|---|---|
| "scaffold code-oz", "init", "set up code-oz here" | [`init.md`](init.md) |
| "drive the run", "advance the phase", "run the next phase" | [`run.md`](run.md) |
| "show run state", "is the run healthy", "what phase am I in" | [`status.md`](status.md) |
| "resume after intervention", "the run died" | [`resume.md`](resume.md) |
| "open the viewer", "visualize the run" (B4 only) | [`view.md`](view.md) |

When in doubt: if `.code-oz/` does not exist, start with `init.md`. If it
exists and the user wants forward motion, use `run.md`. If something looks
wrong, use `status.md`.

## Cross-cutting rules

1. **Always check the binary first.** Run `command -v code-oz`. If not on
   PATH, stop and ask the user to install via npm / Homebrew / Scoop.
2. **Never bypass gates.** Do not write or edit `state/GATE_*.json`,
   `state/events.jsonl`, or any artifact under `.code-oz/artifacts/`. The
   binary is the only writer.
3. **Never override the provider contract.** Do not invoke Claude / Codex /
   xAI directly to "help" the binary. The orchestrator owns provider
   selection and budget enforcement.
4. **Surface exit codes verbatim.** If the binary exits non-zero, show the
   stderr to the user without paraphrasing. `NEEDS_INTERVENTION.json` is the
   structured surface; respect it.
5. **Skill version must declare a binary range.** This `AGENTS.md` works
   against `code-oz` >= 0.18.0 < 0.19.0. Mismatch is a hard stop, not a fallback.

## Reference docs

- `docs/contracts/PROVIDERS.md` — what the binary may invoke
- `docs/references/cli.md` — CLI surface (subcommands, flags)
- `https://github.com/omerakben/code-oz` — source
```

Per-skill file sketch — `run.md`, full body (illustrative):

```markdown
# Drive the active phase

Use this skill when the user wants to advance the current code-oz run:
"drive the phase", "run the next step", "implement the next task", "execute
the plan".

## Prerequisite

`command -v code-oz` must succeed. If not, route the user to install via
`npm i -g code-oz` (or Homebrew / Scoop) before continuing.

## Default flow

1. Read `.code-oz/state/events.jsonl` last event to confirm the active
   phase. Do not write to it.
2. Run:

   ```bash
   code-oz run
   ```

3. The binary advances exactly one phase (or one task within a multi-task
   PLAN.md cycle). On success, exit code 0 + a structured stdout summary.
4. If exit is non-zero, read `state/NEEDS_INTERVENTION.json` (path is in
   stderr). Surface the suggested action to the user. Do not retry without
   explicit approval.
5. After a successful run, the next skill is `status.md` (to inspect) or
   `run.md` again (to advance further).

## Boundaries

- Never call `code-oz run --force-phase <X>` without explicit user approval.
- Never invoke Claude / Codex / xAI directly to "complete" what the run is
  doing. The orchestrator owns provider invocation.
- If the budget warning fires (soft-warn at 0.75 ratio), surface it and
  stop unless the user explicitly raises the budget.
- If `code-oz` is missing, do not synthesize the run by writing artifact
  files yourself. That is a shadow runtime; refuse and route to install.
```

The other four Codex skills follow the same template. The cross-reference between Claude and Codex variants is by subcommand identity — both packs wrap the same five subcommands in the same order, so the contract surface is single-sourced in the binary's `--help` text and `docs/references/cli.md`.

## Boundaries (load-bearing)

Skills MUST NOT, under any circumstance, do any of the following. These constraints define the discovery-vs-authority line that makes the borrow strategic without loosening any code-oz invariant.

- **Modify `state/events.jsonl` or any `state/GATE_*.json` file directly.** All state writes go through the binary. Skills are read-only on these files; reading is allowed for status display.
- **Override the `IAgentProvider` contract.** No invoking Claude / Codex / Gemini / xAI APIs from a skill. Provider selection and capability negotiation are the orchestrator's job.
- **Add new providers via skill side-channel.** A skill cannot register a fifth provider, expose a new model name, or route invocations to a fork of an existing provider. New providers land in `src/providers/` per Rule 11 + the provider capability contract.
- **Bypass budget enforcement (Rule 19).** Skills cannot raise `budgets.global.maxTurns` mid-run, retry past `maxProviderCalls`, or otherwise route around `assertWithinBudget`. If the binary exits with a budget message, the skill surfaces the message and stops.
- **Add hooks beyond what the binary exposes.** No pre-phase or post-phase hooks invented by the skill. If a hook is needed, it lands in the binary first; the skill calls it.
- **Cache run state across invocations.** No skill-side memoization of `RunSummary`, gate status, event tails, or any other run state. Skills read fresh on each invocation. Caching becomes out-of-band state that drifts from the binary's truth.
- **Implement fallback runtimes when the binary is missing.** A missing binary is a hard stop with an install instruction, not a "let me write `.code-oz/` files for you" path. The skill is a discovery shell; without the shell-target it has nothing to do.
- **Bundle vendored copies of `code-oz`.** Skills do not ship the binary. Distribution is the binary's job (npm + Homebrew + Scoop); the skill resolves it from PATH.
- **Embed model-specific prompts that duplicate persona prompts.** Persona prompts live in `src/prompts/`, are governed by Rule 16 (universal anti-slop rules), and are owned by the binary. Skills do not paraphrase, summarize, or wrap them.
- **Translate `NEEDS_INTERVENTION.json` into a different schema.** The intervention surface is the canonical Rule 11 contract. Skills surface the JSON path and the suggested action, verbatim, never a summary.

## Distribution and versioning

**Repo layout.** Skills live in-tree under `plugins/` so they version with the binary. Two siblings:

```
plugins/
  claude-code/
    .claude-plugin/plugin.json
    skills/
      init/SKILL.md
      run/SKILL.md
      status/SKILL.md
      resume/SKILL.md
      view/SKILL.md      # ships disabled until B4 lands
    README.md
    LICENSE
  codex/
    AGENTS.md
    init.md
    run.md
    status.md
    resume.md
    view.md              # ships disabled until B4 lands
    README.md
```

This is one-source-of-truth: when the binary CLI surface changes, the same milestone PR updates the skills. No separate repo, no fork lag, no "skills repo lagging the binary by two milestones" failure mode.

**Versioning.** The plugin manifest version follows the binary version exactly (e.g., `code-oz` v0.18.0 → `code-oz-skills` v0.18.0). Both packs declare a supported binary range in their respective top-level docs (`plugin.json` keywords + `AGENTS.md` cross-cutting-rule 5). The range is **strict equal-major + equal-minor** until v1.0 — alpha + beta lifecycles cannot tolerate skill-vs-binary drift on CLI surface. Once v1.0 ships, the range relaxes to caret (`^1.x`) on stable subcommands.

**Compatibility matrix** (illustrative):

| Skill pack version | Binary range | Subcommands wrapped |
|---|---|---|
| 0.17.x | `code-oz` 0.17.x | init, run, status (no resume yet), no view |
| 0.18.x | `code-oz` 0.18.x | init, run, status, resume |
| 0.19.x | `code-oz` 0.19.x | init, run, status, resume, view (B4) |

A binary outside the declared range is a hard stop, not a soft warning. Skills check `code-oz --version` in the prerequisite step and refuse to proceed on mismatch.

**RunSummary version coupling (depends on B2).** `code-oz status --json` output (B2) carries a top-level `version: 1` field on the `RunSummary` shape. Skills that parse the JSON for templating purposes pin to `RunSummary.version` exactly during alpha/beta — same strict equal-major + equal-minor as the binary range. When B2 bumps `RunSummary.version` (e.g., to `2` because a derivation rule changed), the skill pack bumps in lockstep with the binary version. The two version signals are not independent: skills validate both `code-oz --version` (binary CLI surface) and `RunSummary.version` (parse contract). A binary that emits an unexpected `RunSummary.version` is a hard stop with the same message format as a CLI mismatch.

**Post-v1.0 release rule (Codex R2 finding 6).** Once code-oz ships v1.0, the binary range relaxes to caret (`^1.x`) on stable subcommands but the `RunSummary` schema-version coupling does **not** loosen along with it. Skills must continue to accept only **compatible `RunSummary` schema major versions** (so `RunSummary.version: 1` skills accept any `1.x` schema, but a `RunSummary.version: 2` from a future binary is a hard stop), and they must **ignore additive optional fields** in newer minor versions (so a binary emitting `RunSummary.version: 1` with new optional fields does not break a skill written against a leaner version). The two compatibility rules are independent: binary CLI surface gets caret semver after v1.0, `RunSummary` schema gets strict major-version compatibility plus tolerate-additive-minors. Skill smoke tests must verify both axes after v1.0 — a future skill release that drops major-version compatibility on `RunSummary` would silently break parsers that downstream users have already published.

**Marketplace publishing.** A new CI workflow (`.github/workflows/publish-skills.yml`) runs on every binary release tag (`v*-alpha.*`, `v*`). Steps:

1. Check out the tagged commit.
2. Run `claude plugin validate plugins/claude-code/` (Claude Code plugin validator).
3. Run a Codex pack structural check: `AGENTS.md` exists, all five per-skill files exist, each declares a binary range, no `.ts` siblings, no vendored CLI.
4. Install the freshly-released binary from the same tag (npm fetch from the registry, or local build artifact passed through release workflow output).
5. Run `bun test tests/skills/smoke.test.ts` against the installed binary.
6. On green, push the Claude pack to the marketplace via `claude plugin publish` (or whatever the published-marketplace surface uses at the time).
7. Push the Codex pack to whatever Codex marketplace surface exists at the time, or — if none yet — copy `plugins/codex/` to a public mirror repo `code-oz-codex-skills` for `AGENTS.md` auto-discovery.

The workflow is scoped to `plugins/` only; binary release continues through the existing release workflow. Both publish on the same tag, so the compatibility matrix is enforceable from day one. Failure in any step blocks the publish and surfaces in the release retro — the marketplace listing never lags or leads the binary.

**Smoke test (CI gate before publish).** A bash matrix that, for each subcommand: spawns the binary, invokes the skill's documented flow as plain shell commands (no Claude / Codex CLI required for CI), asserts the documented exit codes, asserts no skill-side write to `.code-oz/` outside what the binary itself wrote. The smoke test is intentionally not a full integration test — that is what the M16 e2e tests already cover. The skill smoke tests assert the wrapper contract: PATH resolution, exit code passthrough, no shadow writes.

## Cost estimate

Sub-surfaces touched (counted per Rule 20 sharper application):

1. `plugins/claude-code/.claude-plugin/plugin.json` — Claude Code plugin manifest (new).
2. `plugins/claude-code/skills/{init,run,status,resume,view}/SKILL.md` — five Claude skill files (new).
3. `plugins/codex/AGENTS.md` — Codex router (new).
4. `plugins/codex/{init,run,status,resume,view}.md` — five Codex skill files (new).
5. `.github/workflows/publish-skills.yml` — CI publish workflow (new).
6. `tests/skills/smoke.test.ts` — smoke test for both packs (new).
7. `docs/references/cli.md` — formalize the CLI surface so skills can declare a binary range (small revision; CLI surface already exists in `--help` text, just needs a canonical doc).

Seven sub-surfaces; one new authority domain (skill-pack distribution) with no gate consequence and no provider consequence. Borderline-larger than B1 (six sub-surfaces) but offset by zero runtime change — every sub-surface is markdown, JSON manifest, CI YAML, or a single test file.

Estimated commits: 3–4. C1 = Claude pack (manifest + five `SKILL.md` files + smoke test for the Claude pack). C2 = Codex pack (`AGENTS.md` + five Markdown skills + smoke test for the Codex pack). C3 = CI publish workflow + `docs/references/cli.md` revision. Optional C4 = first actual marketplace publish (if marketplace upload is gated separately from the workflow merge).

Estimated wall time: 1 to 2 days. No new tests for the binary, no new persona prompt work, no provider work, no contract-doc revision beyond `cli.md`. The dominant cost is the marketplace publishing dance — first-time marketplace setup for Claude Code (account + repo) and whatever Codex requires.

Risk profile: low. Zero runtime change. The two non-trivial risks are (a) drift between skill version and binary version, mitigated by the strict equal-major + equal-minor range and the same-tag CI publish; (b) skill scope creep, mitigated by the boundaries section above and the anti-pattern list below.

## Rule check (compatibility)

- **Rule 8** (single binary distribution): compatible and reinforcing. Skills do not bundle, vendor, or replicate the binary. They resolve it from PATH and exec it. The binary remains the single source of truth for runtime behavior; the skills are the discovery shell.
- **Rule 9** (permission manifest required for `.ts` escape hatches): not applicable. Skills are markdown-only — no `.ts` sibling, no MCP tool, no hook script. The escape-hatch surface is empty by design; if a future skill needs an MCP tool or hook, it lands in the binary first per the boundaries above.
- **Rule 11** (`NEEDS_INTERVENTION.json` is the actionable failure surface): compatible. Skills surface the intervention path and suggested action verbatim. They do not synthesize, paraphrase, or hide the JSON.
- **Rule 13** (privacy by default; explicit file manifests): compatible. Skills do not read repo content beyond what the binary explicitly outputs to stdout. They do not exfiltrate state, do not scan the working directory, do not pass arbitrary files to providers — the orchestrator owns the explicit-manifest discipline.
- **Rule 19** (run-level budget enforcement is mandatory): compatible. Skills cannot raise budgets, cannot retry past kills, and surface budget warnings to the user verbatim. The wrapper's `assertWithinBudget` continues to read cumulative spend from `events.jsonl`; skills cannot influence that read path.
- **Rule 20** (one new authority per milestone): compatible. The borrow introduces one new authority domain (skill-pack distribution) and seven sub-surfaces, all markdown / JSON / CI / one test file. No new gate, no new provider, no new artifact contract, no new state. The implementing milestone should be **only** B3 — no other authority changes in the same milestone.

## Open questions

1. **In-repo `plugins/` vs. separate `code-oz-skills` repo.** Pro in-repo: skills version exactly with the binary; one PR updates both. Pro separate repo: cleaner marketplace metadata, independent lifecycle if skills ever outpace the binary. Proposed default: in-repo for v0.x; revisit at v1.0 if marketplace metadata pressure forces separation. Codex round-2 candidate.
2. **Strict version pinning vs. loose range.** The plan above pins skill version to binary version exactly during alpha/beta. Is that too tight in practice — does it force unnecessary skill releases for binary patches that do not touch the CLI surface? Proposed default: skills pin to `MAJOR.MINOR`, not patch; patch-level binary releases reuse the existing skill pack. Needs verification once the CLI surface stabilizes.
3. **Auto-detect binary location vs. explicit config.** Skills check `command -v code-oz` today. Should skills also accept a `CODE_OZ_BIN` env var to point at a non-PATH binary (e.g., a friend running a freshly-built `dist/code-oz` for evaluation, per the W3-lite Ralph loop demo)? Proposed default: yes, with PATH lookup as the primary path and `CODE_OZ_BIN` as the override. Document it in `cli.md`.
4. **Skill-pack telemetry.** Should the skills emit a structured `skill_invoked` event into `events.jsonl` (so the run knows which skill kicked off the binary)? Pro: full auditability of human-driven invocations. Con: mixes skill identity into run state, which is otherwise binary-owned. Proposed default: no — skills exec the binary cleanly, and any telemetry the binary needs (e.g., "was this an interactive run or a CI run") it computes itself from `argv` and env. Codex round-2 candidate; the cleaner answer might be to emit an event with `source = "skill:claude-code"` only when the skill explicitly opts in via a flag.
5. **Backward-compatible CLI vs. semver-bump skills.** When the binary changes its CLI surface (rename a subcommand, add a required flag), do we bump skills (pin them to the new binary) or maintain a backward-compat layer in the binary itself? Proposed default: bump skills. The binary's CLI surface is the contract; bending it for skill backward-compat is the wrong direction. The semver discipline (MAJOR bump on CLI break, MINOR on additive subcommand, PATCH on internal-only) is what makes the equal-MAJOR+MINOR pin tractable.
6. **`code-oz:view` skill shipping disabled until B4.** The skill file ships in W3.x but is wired to print a "viewer not yet available — use `code-oz:status` instead" message. Is that the right pattern, or should the skill not ship at all until B4 lands and then ship in a later skill-pack release? Proposed default: ship disabled. The trigger phrases in the manifest help users discover that a viewer is on the roadmap; the skill body explains the timeline. Easier than re-publishing the marketplace listing twice.

## Anti-pattern to avoid

1. **Skills implementing a fallback runtime when the binary is missing.** The temptation: "if `code-oz` is not on PATH, the skill could write `.code-oz/config.yaml` itself and walk the user through DEFINE." This is a shadow runtime. It diverges from the binary, ages out of sync, and silently bypasses every gate. The right behavior on a missing binary is a hard stop with an install instruction, every time.
2. **Skills caching state across invocations.** The temptation: "I just read `events.jsonl`'s last 100 lines, let me cache the parsed `RunSummary` for next turn." This is out-of-band state. The cache drifts from the binary's truth, the next skill invocation reads a stale summary, and the user gets confidently wrong status. Skills always read fresh on each invocation; caching is the binary's responsibility, not the wrapper's.
3. **Skills paraphrasing the binary's output.** The temptation: "the binary printed a wall of text — let me summarize it for the user." Two failure modes: the summary loses load-bearing detail (e.g., the budget-warning ratio), and the summary becomes a second source of truth that has to be kept in sync with the binary. Skills surface stdout / stderr verbatim, with at most a one-line framing sentence.
4. **Skills splitting a single binary invocation across multiple turns.** The temptation: "instead of running `code-oz run`, let me run `code-oz doctor` first, then ask the user, then run `code-oz run`." The binary already has a doctor subcommand; the skill should not invent a doctor-then-run wrapper. One skill = one binary invocation, in the documented common case.

## Acceptance criteria for the implementing milestone

- [ ] `plugins/claude-code/.claude-plugin/plugin.json` exists with name, description, version (matching binary `MAJOR.MINOR`), keywords, repo URL.
- [ ] Five `plugins/claude-code/skills/{init,run,status,resume,view}/SKILL.md` files exist. Each has YAML frontmatter (description + argument-hint + user-invocable), a Prerequisite section that asserts `code-oz` on PATH, a Default flow section, and a Boundaries section.
- [ ] `plugins/codex/AGENTS.md` exists as the router with the trigger-phrase table, cross-cutting rules, and reference doc links.
- [ ] Five `plugins/codex/{init,run,status,resume,view}.md` files exist. Each restates the prerequisite + default flow + boundaries pattern for shell-first invocation.
- [ ] `.github/workflows/publish-skills.yml` exists, runs on release tags, validates both packs, runs the smoke test, and publishes to the Claude Code marketplace (and Codex marketplace if available).
- [ ] `tests/skills/smoke.test.ts` exercises the documented flow for each subcommand against a real built binary, asserts exit codes match the skill's documented expectation, and asserts the skill performs no `.code-oz/` writes outside what the binary itself wrote.
- [ ] `docs/references/cli.md` exists as the canonical CLI surface doc, referenced by both packs as the contract source.
- [ ] Skill packs declare and enforce a binary version range; running with a binary outside the range exits the skill flow with a clear install / upgrade instruction.
- [ ] Marketplace listing is live for the Claude Code plugin (account + repo configured).
- [ ] Codex pack discoverable via `AGENTS.md` auto-discovery from the repo root.
- [ ] No skill-side gate writes; no `state/events.jsonl` mutation from the skill side; smoke test asserts both.
- [ ] No regression in binary tests (3108+ tests still pass; skills do not change the binary).
- [ ] Codex round-1 debate completed before implementation; Codex round-2 review completed before tag, both per the cross-model peer review rule.

## Open: relationship to canvas-frontend hypothesis (CANVAS_FRONTEND_HYPOTHESIS.md)

Skill wrappers and the canvas frontend are complementary read/write clients on top of the same binary. The skill packs are the **read/write CLI client** living inside Claude Code and Codex CLI sessions — they invoke binary subcommands, surface exit codes, and stay on the textual surface where agents already operate. The canvas frontend (B4 viewer step 1, then the canvas-as-frontend hypothesis from §3.4) would be the **read-only visual client** running in the user's browser on `127.0.0.1`, rendering the same run state with affordances skills cannot offer (graph layout, debate timeline, evidence drill-down). Both clients consume the same `RunSummary` derived read-model (B2) once it ships, which is why B3 pairs naturally with B2. If both clients ship by W3.x close, the comparison report's §5 adoption-vs-architecture risk has structural mitigations on both the agent surface (skills) and the human surface (viewer); if neither ships, the risk stays open and the comparison should be re-run with adoption metrics per §7 action 7.
