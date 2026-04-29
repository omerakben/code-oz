# Agent skill format — canonical spec for code-oz

This document is the **pinned spec** for the Markdown-with-frontmatter format `code-oz` uses for agents, skills, phases, gates, and hooks. It extends the upstream `agent-skills` convention.

The upstream is the influence; this file is the authority for `code-oz`. When upstream and this file disagree, this file wins for `code-oz` purposes.

## Provenance

- **Upstream:** `~/Projects/agents/templates/agent-skills`
- **Upstream HEAD pinned at:** `19e49a094d79540e635b107cb3490926ddeac7a3` (2026-04-27)
- **Canonical upstream files used:**
  - `docs/skill-anatomy.md` — frontmatter and section spec
  - `agents/code-reviewer.md` — example of a persona-style agent file
  - `skills/spec-driven-development/SKILL.md` — example of the full SKILL.md anatomy
  - `README.md` — phase taxonomy (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP) and the table of 20 skills

Sync policy: upstream changes do not auto-propagate. When upstream introduces a frontmatter field or convention `code-oz` should adopt, update this file and bump the pinned hash above. Document the diff in the same commit.

## Canonical frontmatter (from agent-skills)

The upstream baseline:

```yaml
---
name: skill-name-with-hyphens
description: |
  Guides agents through [task/workflow]. Use when [specific trigger conditions].
---
```

Rules carried over without change:

- `name`: lowercase, hyphen-separated. Must match the file or directory name.
- `description`: starts with what the artifact does in third person, then includes one or more clear "Use when" trigger conditions. Maximum **1024 characters**. The description is injected into the discovery prompt — it must convey both *what* and *when*. Do not summarize the workflow inside the description; if it contains process steps, the agent may follow the summary instead of reading the body.

## Canonical section anatomy (from agent-skills)

Recommended body structure for skill-style artifacts:

```markdown
# Title

## Overview
One-two sentences explaining what this artifact does and why it matters.

## When to Use
- Bullet list of triggering conditions
- When NOT to use (exclusions)

## [Core Process / Workflow / Steps]
Numbered or phased steps. Specific and actionable.
Code examples where they help. ASCII flowcharts at decision points.

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| Excuse used to skip a step | Why the excuse is wrong |

## Red Flags
- Behavioral patterns indicating the workflow is being violated

## Verification
- [ ] Checklist of exit criteria — every item verifiable with evidence
```

Persona-style agent files (e.g., `code-reviewer`) skip `Common Rationalizations` and `Red Flags` and instead define a Review Framework or comparable role-shaped structure. Both shapes are valid in `code-oz`.

## Writing principles (carried over)

1. **Process over knowledge.** Workflows, not reference docs.
2. **Specific over general.** "Run `bun test`" beats "verify the tests".
3. **Evidence over assumption.** Every verification checkbox requires proof.
4. **Anti-rationalization.** Every skip-worthy step needs a counter-argument.
5. **Progressive disclosure.** Main file is the entry point; supporting files load only when needed.
6. **Token-conscious.** Every section must justify its inclusion.

## Code-oz extensions to the frontmatter

`code-oz` adds five required fields the upstream does not have. These encode the typed FSM, provider routing, model policy, and permission manifest the project's non-negotiable rules require.

```yaml
---
name: ba-discovery
type: agent                       # agent | skill | phase | gate | hook
phase: define                     # define | plan | build | verify | review | ship | audit
provider: claude                  # claude | codex | gemini | fake
model: claude-opus-4-7            # optional; falls back to provider default
modelPolicy: opus-default         # opus-default | strict-opus | any
permissions:
  read: '*'
  write: ['./docs/**', './specs/**']
  bash: deny
description: |
  One-paragraph trigger description following the agent-skills convention:
  third-person action sentence + "Use when ..." trigger phrases.
---
```

### Field reference

| Field | Required | Allowed values | Notes |
|---|---|---|---|
| `name` | yes | lowercase-hyphen | Must match the file name without extension. |
| `type` | yes | `agent`, `skill`, `phase`, `gate`, `hook` | Typed discriminator. The loader rejects any other value. |
| `phase` | yes | `define`, `plan`, `build`, `verify`, `review`, `ship`, `audit` | Drives the phase-graph routing. `audit` is brownfield-only. |
| `provider` | yes | `claude`, `codex`, `gemini`, `fake` | `fake` is the offline `FakeProvider` used by spine tests. |
| `model` | no | provider-defined string | Falls back to the provider's configured default. |
| `modelPolicy` | yes | `opus-default`, `strict-opus`, `any` | `opus-default` warns on downgrade. `strict-opus` errors on downgrade. `any` allows free model selection. |
| `permissions.read` | yes | `'*'` or array of glob strings | What the agent may read. |
| `permissions.write` | yes | `'*'`, `[]`, or array of glob strings | What the agent may write. Empty array means read-only agent. |
| `permissions.bash` | yes | `deny` or array of allowed commands | Default `deny`. Any other value requires the per-file permission manifest contract (rule 9). |
| `description` | yes | string ≤ 1024 chars | Same upstream rule. |

### Why these extensions exist

- **`type`** — different artifact types route differently. Agents run in phases; gates emit gate signal files; hooks fire on lifecycle events. The loader cannot infer this from the body.
- **`phase`** — non-negotiable rule 1 (file-based gate signals only) requires a typed phase tag so `state/GATE_<PHASE>_PASSED.json` can be schema-validated against the agent that produced it.
- **`provider`** — non-negotiable rule 2 (cross-family review) requires REVIEW agents to be in a different provider family from BUILD. The loader enforces this; provider must be a frontmatter field, not inferred.
- **`modelPolicy`** — non-negotiable rule 4 (Opus default; warn on downgrade). Encoding the policy per agent (rather than globally) lets the M3 state machine warn or error at run time.
- **`permissions`** — non-negotiable rule 9 (permission manifest required for any `.ts` escape hatch). The frontmatter is the manifest; default-deny is the safe posture.

## File layout in code-oz

`code-oz` does not use the `skills/<name>/SKILL.md` convention from upstream. It uses the simpler `agents/<name>.md` convention from upstream, applied to all artifact types:

```
src/agents/defaults/<name>.md        # bundled defaults shipped in the binary
.code-oz/agents/<name>.md            # project-local overrides (project-local wins on collision)
```

Naming:

- File names are `lowercase-hyphen.md` (matches `name` frontmatter, lowercase extension).
- Bundled default names are short single-word identifiers where possible (`ba.md`, `lead.md`, `builder.md`, `verifier.md`, `reviewer.md`).
- Project-local overrides may use any kebab-case name; collision with a bundled default by `name` frontmatter (not file name) means the project file wins.

Supporting files for an agent live next to it as `<name>.<topic>.md` or in `src/agents/defaults/_shared/` for cross-agent references. Supporting files do not require frontmatter.

## Validation rules (loader contract)

The M2 loader enforces:

1. Frontmatter is valid YAML and contains all required fields.
2. `name` is `lowercase-hyphen` and matches the file name.
3. `type`, `phase`, `provider`, `modelPolicy` are in their allowed sets.
4. `permissions` has all three sub-fields (`read`, `write`, `bash`).
5. `description` is a non-empty string ≤ 1024 characters.
6. The body has at least an `Overview` section (skill-style) or a top-level role declaration (persona-style). Empty bodies are rejected.

Any violation produces a typed error citing the file path and the violated rule. The loader never accepts a partially-valid file (rule 1: no LLM-text-parsed pass/fail; the same discipline applies to artifact loading).

## What this file is not

- **Not a tutorial.** See `docs/design/ROADMAP.md` for the M2 plan and the bundled default agents shipped in v0.2.
- **Not a substitute for reading the upstream.** When designing a new persona, read upstream `agents/code-reviewer.md` for shape, then add the `code-oz` extensions from this file.
- **Not the marketplace contract.** Agent-pack manifests (W3+) extend this format with packaging metadata. See `src/agentpacks/schema.ts` once it exists.
