# code-oz — M2 session kickoff

**You are starting a fresh Claude Code session inside `~/Projects/code-oz/`.** The project's `CLAUDE.md` loads automatically and is authoritative — read it in full before doing anything else.

## State at start of M2

- **Repo:** `github.com/omerakben/code-oz`, branch `main`
- **Last release:** `v0.1.0-alpha.0` (commits `c0f9727`, `3e29341`)
- **Tests:** 19 passing, offline, ~180ms
- **Binary:** `bun run build:binary` produces `dist/code-oz` (~61 MB)
- **What works:** `code-oz init` scaffolds `.code-oz/` with greenfield/brownfield auto-detection. `run` and `doctor` are stubs that exit non-zero pointing at later milestones.

## Your task — M2: Markdown agent loader + 5 default agents

Canonical scope: `docs/design/ROADMAP.md` § M2.

**Files to create:**

```
src/agents/frontmatter.ts        # parse YAML frontmatter, return typed result
src/agents/schema.ts             # zod-style schema or manual validators for the agent contract
src/agents/loader.ts             # discover + load + validate agent files; merge bundled + project-local
src/agents/defaults/ba.md        # default BA persona (DEFINE phase)
src/agents/defaults/lead.md      # default Lead persona (PLAN phase)
src/agents/defaults/builder.md   # default Builder persona (BUILD phase)
src/agents/defaults/verifier.md  # default Verifier persona (VERIFY phase)
src/agents/defaults/reviewer.md  # default Reviewer persona (REVIEW phase)
src/agentpacks/schema.ts         # agent-pack manifest (forward-compat; full marketplace contract is W3+)
tests/agents-loader.test.ts
tests/fixtures/agents/           # valid + invalid fixtures for tests
```

**Frontmatter schema (locked Q4, extended from agent-skills):**

```yaml
---
name: ba-discovery                  # kebab-case; must match file name
type: agent                         # agent | skill | phase | gate | hook
phase: define                       # define | plan | build | verify | review | ship | audit
provider: claude                    # claude | codex | gemini | fake
model: claude-opus-4-7              # optional; falls back to provider default
modelPolicy: opus-default           # opus-default (warn on downgrade) | strict-opus | any
permissions:
  read: '*'
  write: ['./docs/**', './specs/**']
  bash: deny
description: |
  One-paragraph trigger description following the agent-skills convention:
  third-person action sentence + "Use when ..." trigger phrases.
---

# Agent body — Markdown system prompt
```

**Acceptance criteria:**

- Required fields: `name`, `type`, `phase`, `provider`, `modelPolicy`, `permissions`. Description is required and ≤1024 chars (agent-skills convention).
- Loader merges bundled defaults with project-local overrides at `.code-oz/agents/*.md`. Project-local wins on name collision; bundled defaults are never mutated.
- Invalid frontmatter (missing required field, unknown phase, wrong type) fails fast with a typed error citing the file path and the violated rule. Never let an invalid file load silently — see CLAUDE.md non-negotiable rule 1 (no LLM-text-parsed pass/fail).
- `bun test` passes offline (no network, no real provider calls).
- `bun run typecheck` clean.
- `code-oz init` continues to pass all M1 tests (regression check).

## Cross-model peer review (rules 7–10 in CLAUDE.md, non-negotiable)

This project requires Codex debate at planning convergence and Codex review at implementation completion. Both rounds use `gpt-5.5` at xhigh effort, read-only sandbox, via `mcp__plugin_agent-codex_codex-native__codex` (NOT `gpt-5.5-codex` — that variant fails on Ozzy's ChatGPT-account auth).

### Step 1 — Planning (before any code)

1. Read `CLAUDE.md`, `docs/design/ROADMAP.md` § M2, `docs/adr/0001-mvp-option-e.md`.
2. Sketch the M2 design: file layout, schema design, error type hierarchy, override semantics, fixture strategy, test plan.
3. Write `docs/design/CODEX_BRIEFING_M2.md` with: goal, locked constraints from M1, the proposed design, and 4–6 specific debate prompts (e.g., "Should the schema use zod or hand-rolled validators?", "What's the right error model for invalid agent files?", "Are 5 default personas the right surface or should we ship fewer?").
4. Invoke Codex:
   ```
   mcp__plugin_agent-codex_codex-native__codex(
     model: 'gpt-5.5',
     config: { model_reasoning_effort: 'xhigh' },
     sandbox: 'read-only',
     approval-policy: 'never',
     cwd: '/Users/ozzy-mac/Projects/code-oz',
     prompt: '<the briefing path + structured response request>',
   )
   ```
   Capture Codex's reply, save as `docs/design/CODEX_RESPONSE_M2.md`.
5. Synthesize agreement/disagreement. Where Codex pushes back, judge the argument; where it confirms, sanity-check. Present synthesis to Ozzy. **Do not start coding until Ozzy approves the synthesis.**

### Step 2 — Implementation

1. Create branch `feat/m2-agent-loader` from `main` (rule 2: main only on tagged releases — never commit M2 work directly to main).
2. Implement per the synthesized plan. Conventional commits, no emojis, no Co-Authored-By footers unless asked.
3. `bun test` and `bun run typecheck` clean before committing each chunk.
4. Don't expand scope: M3+ (state machine, providers, phases) is NOT in M2. `consult()` does NOT exist; only `requestReview()` lands at the REVIEW gate in M7.

### Step 3 — Codex review (before push)

1. Once tests pass and typecheck is clean, invoke Codex again with `sandbox: read-only` against the new commit.
2. Codex returns one of `push` / `fix-first` / `debate-required`.
3. Block-push and block-M3 severity findings land as follow-up commits on the same branch (never amend per global rule).
4. Re-review only if Codex flagged debate-required.

### Step 4 — Tag and push

1. Tag the merged result `v0.2.0-alpha.0`.
2. Open PR (or merge to `main` with `--no-ff`) and push only after Ozzy explicitly approves.

## Don't

- Don't bypass the Codex rounds — the rule is durable, not optional.
- Don't push to `main` without a tag.
- Don't implement M3+ scope (state machine, providers, phases, gates).
- Don't add `consult()` — narrowed to `requestReview()` at REVIEW gate only (v0.3+).
- Don't introduce live-provider deps yet — M2 is pure loader, no SDK calls.
- Don't use `git add -A` or `git add .` — stage specific files.
- Don't `git commit --amend` — the global rule requires new commits for fixes.
- Don't push at all without explicit user approval.

## First commands to run

```bash
cd ~/Projects/code-oz
git status                       # confirm clean tree on main
git log --oneline -5             # confirm v0.1.0-alpha.0 is HEAD
bun test                         # confirm 19/19 still pass
git switch -c feat/m2-agent-loader   # only after planning + Codex debate approved
```

Resume reading from `CLAUDE.md` rules 7–10 and `docs/design/ROADMAP.md` § M2.
