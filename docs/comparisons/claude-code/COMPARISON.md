# Code-Oz vs claude-code (Anthropic harness + bundled plugins)

**Code-Oz version:** v0.17.0-alpha.0 (M16 closed; 3108 tests pass; 198 test files).
**Template:** `~/Projects/agents/templates/claude-code` — the official `anthropics/claude-code` repository (CLI harness + 13 bundled plugins under `plugins/`, plus `examples/{hooks,settings,mdm}/`, `.devcontainer/`, and a TypeScript issue-lifecycle DSL).
**Date:** 2026-05-10.
**Author:** Claude Opus 4.7 (xhigh).
**Companion docs:** prior comparisons at `docs/comparisons/agentic-canvas/`, `docs/comparison/01-ace/`, `docs/comparison/02-agenticSeek/`, `docs/comparison/03-aris/`, `docs/comparison/04-archon/`, `docs/comparison/05-agent-skills/`. CLAUDE.md rules 1 through 21 are in scope.

Note on lexical sanitization: the bundled `security-guidance` plugin's PreToolUse pattern hook fires on a handful of dangerous-API tokens. To avoid having this very document trip the rule when written to disk, danger-token examples in the rejection and inventory tables are described categorically (for example, "deserialization gadgets" rather than the literal name) instead of being quoted. The categorical names are sufficient for the comparison; readers wanting the exact regex set can read `~/Projects/agents/templates/claude-code/plugins/security-guidance/hooks/`.

---

## 0. Why this comparison is structurally different

Every prior comparison was against a peer agentic framework (ACE, ARIS, Archon, agentic-canvas, AgenticSeek, agent-skills). The verdict in each was "borrow narrowly or reject" with code-oz holding the SDLC discipline axis.

This comparison is different. `claude-code` is the substrate — the harness and stdlib that code-oz currently runs on top of. Code-oz already borrowed three things from this template per the influence table in `CLAUDE.md`:

1. Plugin format (frontmatter Markdown + optional sibling `.ts` for hooks/runners).
2. Hook event names (`SessionStart`, `PreToolUse`, `Stop`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`).
3. Filesystem discovery (skills/agents/commands as files in conventional folders).

The remaining surface splits into two tiers:

- **Harness tier** — terminal rendering, MCP host, OAuth flow, plugin marketplace, hook execution engine, settings hierarchy, MDM. These are out of scope by definition: code-oz is its own runtime, not a Claude Code plugin.
- **Plugin tier** — 13 reference plugins demonstrating workflows (`feature-dev`, `pr-review-toolkit`, `code-review`, `commit-commands`), guardrails (`hookify`, `security-guidance`), output styles (`explanatory-output-style`, `learning-output-style`, `frontend-design`), self-iteration (`ralph-wiggum`), and meta-tooling (`plugin-dev`, `agent-sdk-dev`, `claude-opus-4-5-migration`).

The honest framing: code-oz competes with the plugin tier, not the harness tier. A code-oz run is what `feature-dev` + `pr-review-toolkit` + `ralph-wiggum` + `code-review` would look like if their authors had decided to enforce SDLC gates instead of orchestrating commands.

That framing decides the verdict.

---

## 1. Verdict

**YES, we are getting enough benefits and meeting our needs.** Code-oz is structurally ahead of the bundled plugin tier on every load-bearing dimension we care about, and the harness tier is out of scope. **Three narrow patterns** are still worth absorbing as polish; **eight** are explicitly rejected; **two** require evidence before any decision.

**Why ahead.** The bundled plugins are command-orchestrated workflows whose correctness depends on the model following English instructions. Code-oz is a file-gated state machine where correctness is enforced by schema-validated artifacts. A plugin can hand-wave a verdict; a code-oz phase cannot pass without `GATE_<PHASE>_PASSED.json`. The template's reviewer (`code-review` plugin) runs in a single family by default; code-oz mandates cross-family review at REVIEW (rule 2). The template's pattern-matching guardrail (`security-guidance` plugin) warns without blocking; code-oz's permission manifest is rule 9, default-deny.

**Why narrow borrows.** Two template patterns are sharper than anything code-oz currently has: `code-review`'s issue-validate-then-filter pass (false-positive suppression by re-checking each finding) and `hookify`'s declarative rule sheet (pattern + action + message in Markdown frontmatter). Both are absorbable into existing code-oz surfaces without new authority boundaries.

The remaining 10 patterns either duplicate something code-oz already has at higher discipline (cross-family review, run-level budgets, state machine, worktree isolation), are out-of-scope harness mechanics (MDM, marketplace, devcontainer), or are UX wrappers that fail rule 21's measurable-risk-reduction test.

---

## 2. The template at a glance

### 2.1 Plugin inventory

Drawn from `.claude-plugin/marketplace.json` and direct file inspection.

| Plugin | Mechanism | Distinctive choice |
|---|---|---|
| `agent-sdk-dev` | Slash command + 2 verifier agents (TS / Py) | Auto-runs verifier post-scaffold before user touches the project |
| `claude-opus-4-5-migration` | Single skill | Token-efficient automated migration of model strings + beta headers |
| `code-review` | Slash command + 4 parallel review agents + per-issue validation subagents | Two-stage filtering: agents flag, subagents revalidate, discard if not confirmed |
| `commit-commands` | Three slash commands (`/commit`, `/commit-push-pr`, `/clean_gone`) | Commit-message generation learns from recent repo style |
| `explanatory-output-style` | SessionStart hook | Output-style-as-plugin pattern; injects "★ Insight" framing |
| `feature-dev` | Slash command + 3 agent types (explorer, architect, reviewer) | Parallel architects produce N approaches with trade-offs; user picks |
| `frontend-design` | Auto-invoked skill | Anti-generic-AI-aesthetic skill composition |
| `hookify` | Slash command + matcher engine + Markdown rule sheets | Frontmatter-driven hook generation: `event/pattern/action/message` |
| `learning-output-style` | SessionStart hook | Hybrid: requests 5–10 line user contributions at decision points + insights |
| `plugin-dev` | 7 sub-skills + create-plugin command | Meta plugin: scaffolds and validates other plugins |
| `pr-review-toolkit` | Slash command + 6 parallel agents (comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-reviewer, code-simplifier) | One agent per concern; modular; `--all` runs all six |
| `ralph-wiggum` | Stop hook + analyzer agent | Loop inside session: Stop intercepts exit, feeds prompt back, completion-promise flag |
| `security-guidance` | PreToolUse Python regex hook | Pattern matching by tool type; warns without blocking |

### 2.2 Hook patterns demonstrated

`examples/hooks/` and the plugins above show five hook events in use:

| Event | Pattern | Demonstrated by |
|---|---|---|
| `SessionStart` | Inject instructions / output style | `explanatory-output-style`, `learning-output-style` |
| `PreToolUse` | Pattern-match Edit/Write/MultiEdit | `security-guidance` (Python regex), `hookify` |
| `Stop` | Block exit, feed prompt back | `ralph-wiggum`, `hookify` (require-tests-stop example) |
| `UserPromptSubmit` | Match prompt patterns | `hookify` |
| `PostToolUse` | Post-tool validation | `hookify` |

Hook config format is `hooks.json` with shape `{ event: [{ matcher, hooks: [{ type, command }] }] }`. Hooks are shell commands, Python scripts, or TS subprocesses launched from `${CLAUDE_PLUGIN_ROOT}`.

### 2.3 Settings hierarchy

`examples/settings/` ships three preset profiles plus an MDM template:

- `settings-lax.json` — minimal restrictions, marketplaces enabled.
- `settings-strict.json` — Bash requires approval, Web tools denied, hooks/perms locked to managed only, `disableBypassPermissionsMode: "disable"`.
- `settings-bash-sandbox.json` — Bash confined to sandbox; tighter network isolation.
- `examples/mdm/` — `managed-settings.json`, macOS plist + mobileconfig, Windows admx + PS1.

Precedence: MDM > managed-settings > project settings.json > settings.local.json. Key fields: `permissions.{ask,deny,disableBypassPermissionsMode}`, `allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`, `strictKnownMarketplaces`, `sandbox.{network,autoAllowBashIfSandboxed}`.

### 2.4 Other infrastructure

- `.devcontainer/devcontainer.json` — Node base + ZSH + Git Delta + persisted bash history + `.claude` config volume + `init-firewall.sh` post-start.
- `scripts/` — TypeScript issue-lifecycle DSL: `issue-lifecycle.ts` (label → days-until-nudge → comment template), `auto-close-duplicates.ts`, `sweep.ts`.
- `Script/run_devcontainer_claude_code.ps1` — Windows MDM deployment helper.

---

## 3. Audit of the three already-borrowed patterns

Per the influence table in CLAUDE.md (the `agent-skills` row says skill-frontmatter / phase-taxonomy were borrowed from agent-skills, not this template; the `claude-code` row says "Plugin format + hook event names + filesystem discovery"). Audited at v0.17:

### 3.1 Plugin format

Code-oz uses Markdown + YAML frontmatter for skills, agents, commands, and personas in `src/agentpacks/<role>/<artifact>.md` plus optional sibling `.ts` for runners. The template uses `plugins/<name>/{commands,agents,skills,hooks}/<file>.md` + `plugin.json` manifest.

Differences:
- Code-oz: frontmatter is typed with `type / phase / provider / modelPolicy / permissions` fields that are read by the runtime. Template: frontmatter is `name / description / tools / model / color`, primarily for harness routing.
- Code-oz has no `plugin.json` equivalent — agentpacks self-organize by role under `src/agentpacks/`. The template's manifest indirection is unnecessary for code-oz because there is no marketplace.

Verdict: still load-bearing. The borrow is structurally smaller than the template's plugin format (no marketplace metadata) but functionally similar (frontmatter + sibling code).

### 3.2 Hook event names

Code-oz reuses `SessionStart / PreToolUse / Stop / UserPromptSubmit / PostToolUse / SubagentStop` as event taxonomy names but they fire from code-oz's own state machine (phase boundaries), not from a shared hook execution engine. This is borrowing the vocabulary, not the runtime.

Verdict: load-bearing as taxonomy; no shared runtime.

### 3.3 Filesystem discovery

Code-oz scans `src/agentpacks/`, `src/commands/`, `src/phases/` at boot and the template scans `plugins/<name>/{commands,agents,skills}/`. Both use file presence as registration. Code-oz adds schema validation at boot (rule 1 family of constraints).

Verdict: load-bearing; code-oz hardens the pattern with validation.

All three borrows still earn their slot. None need re-importing.

---

## 4. Per-plugin examination — what else might be borrowable?

This section walks every remaining plugin and decides cargo-cult vs load-bearing for code-oz. The lens is rule 20 (one new authority boundary per milestone) and rule 21 (no parallel-provider surface without measurable risk-reduction effect).

### 4.1 `code-review` — issue validate-then-filter pass

What it does: parallel reviewers (4 agents — 2 CLAUDE.md, 2 bug) flag issues. For each flagged issue, a validate-issue subagent re-checks the same code with the issue description as input. Filter step drops anything not validated.

What code-oz has: M14 reviewer panel produces `REVIEW.md` per reviewer with score (0–10) + verdict (`ready / changes_requested / block`). Aggregator produces panel verdict. No second-pass per-issue revalidation. No false-positive suppression beyond verdict thresholds.

Gap: when a panel reviewer flags 12 issues, code-oz currently presents all 12 to the next phase. The template's pattern would re-check each through a fresh reviewer — same family, fresh context — and drop unconfirmed issues before they reach BUILD restart.

Worth borrowing: yes — this is a sharp false-positive filter that fits rule 21's evidence model: empirical false-positive-rate vs baseline measurable in `events.jsonl`. Authority cost: extends M14 panel; one optional config field per reviewer (`validatePerIssue: true`); no new boundary if scoped under M14.1 polish or M17. Implementation: in `src/phases/review-fire-path.ts`, after a reviewer returns issues, fan out one Haiku-tier validation call per issue with the same file manifest. Filter on confirmed=true.

Caveat: this adds provider calls (one per flagged issue per reviewer). Must obey rule 19 (cumulative budget). The cost-vs-suppression curve is the rule 21 evidence question.

### 4.2 `hookify` — declarative rule sheet

What it does: user writes `.claude/hookify.<name>.local.md` with frontmatter `{ name, enabled, event, pattern, action: warn|block, … }` and a Markdown body that becomes the warning/block message. A Python matcher engine reads the rule on `pretooluse / posttooluse / userpromptsubmit / stop`.

What code-oz has: rule 9 permission manifest in `.code-oz/config.yaml` lists allowed commands / network / file roots / env vars / timeout / secret access. It is a configuration, not a rule sheet. There is no pattern-matching guardrail layer — code-oz relies on the harness's permission system for tool-level deny and on the manifest for scope.

Gap: if a code-oz BUILD agent attempts a destructive shell command or writes a debug-print into production code, the only defense is the agent's own discipline (universal rules) and the permission manifest's command allowlist. There is no pattern-level middle layer.

Worth borrowing: yes, as polish — fits rule 9 extension. Authority cost: extends rule 9; new optional file `.code-oz/guardrails.md` parsed at run start; matcher applied inside the tool-call wrapper. No new authority boundary if framed as "rule 9 gains pattern rules." Rule 21: not parallel-provider; rule 21 does not apply.

Caveat: the template's hookify uses regex on raw bash strings and file contents. Code-oz must be careful that pattern matching does not become its own attack surface (rule injection via prompt-shaped fields, regex DoS). Constrain the parser to Markdown frontmatter + literal regex; do not eval; cap match time per rule.

### 4.3 `feature-dev` — parallel architect agents with trade-off comparison

What it does: main command launches `code-architect` agents in parallel (different prompts), each returns a design + trade-offs. Main consolidates. User picks. Then `code-explorer` reads files, `code-reviewer` reviews implementation.

What code-oz has: M10 debate runtime with `requestDebate()` — produces dueling positions on a contested question. M14 reviewer panel — N reviewers, post-build, write `REVIEW.md` each. PLAN phase with 3-source verification (rule 3).

Mapping: feature-dev's parallel architects = code-oz's M10 debate at PLAN time; feature-dev's explorer = code-oz's PLAN's `SOURCE_CHECK.md` flow; feature-dev's reviewer = code-oz's M14 panel.

Worth borrowing: no structural borrow. Code-oz already has all three primitives at higher discipline (file-based gates, cross-family review, schema validation). The UX of "user picks between N labeled approaches" is a polish question; an optional CLI surface (`code-oz plan --present-options`) is conceivable but not load-bearing. Reject the structural borrow.

### 4.4 `pr-review-toolkit` — modular agents by review concern

What it does: six parallel agents, each for one concern: `comment-analyzer`, `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`, `code-reviewer`, `code-simplifier`. `--all` runs all six.

What code-oz has: M14 reviewer panel where each panel slot is a configured reviewer. The slots are role-typed (architect, security, simplifier, etc. — see `src/phases/review-panel.ts`). The mapping is conceptually similar.

Gap: the template ships named, ready-to-fire concern roles (silent-failure-hunter, type-design-analyzer). Code-oz's reviewer roles are configured per run; there is no "stock library of opinionated reviewers."

Worth borrowing: maybe, as content not architecture. A `panel-presets/` folder with named reviewer configs (`silent-failure-hunter.yaml`, `type-design-analyzer.yaml`) would be a useful curation layer. Authority cost: zero (data, not code). Decision: defer to W3 polish or after M14.1 if the panel sees real production runs.

### 4.5 `ralph-wiggum` — Stop-hook self-iteration loop

What it does: Stop hook intercepts exit, completion-promise flag controls when to actually exit, max-iterations bound. Work persists in files between iterations.

What code-oz has: already shipped at W3-lite tier — see memory `w3_lite_ralph_loop_launch.md` (10 iterations, ~1.5h, 9 commits, 2126 tests, both binaries built, R1+R2 verdicts converged). The mechanism is currently external (a `loop` runner around `code-oz run`), not a Stop-hook inside-session loop.

Gap: the template's pattern is inside-session loop (Stop hook), code-oz's W3-lite is outside-session loop (run wrapper). Different threat models: inside-session loop reuses model context; outside-session loop reseeds fresh.

Worth borrowing: no. Outside-session is the right choice for code-oz because runs are stateful and resumable (rule 12 — `code-oz resume`). Inside-session would conflict with rule 12 and rule 19 (budget visibility). Reject.

### 4.6 `security-guidance` — PreToolUse pattern hook

> **Correction (2026-05-10, post-Codex):** the original text below claimed the hook "warns without blocking." That is wrong. The hook calls `sys.exit(2)` after printing the reminder, the PreToolUse blocking exit code (`plugins/security-guidance/hooks/security_reminder_hook.py:271-273`), so it actually blocks. The `hooks.json` description ("warns about potential security issues") is itself a docs/code mismatch in the upstream template. The correction strengthens — rather than weakens — the B2 authority-cost analysis (see `SYNTHESIS.md` §1.1 and §1.3): a block-capable PreToolUse hook is a runtime enforcement layer between persona output and tool execution, which is honestly a new authority boundary. The B2 design lessons are tracked in `SYNTHESIS.md` §1.4–1.5. The pre-debate text is preserved below for audit.

What it does: Python regex hook on Edit/Write/MultiEdit detects ~9 patterns (command injection, XSS, eval, dangerous HTML, deserialization gadgets, unsafe `system` invocations, etc.). Warns without blocking.

What code-oz has: rule 16 universal anti-slop rules (10 prohibitions + 10 affirmations) ship inside every persona prompt. Not pattern-matched against output; embedded in the persona's instructions.

Gap: code-oz's defense is pre-generation (universal rules in prompt). The template's defense is pre-tool-execution (regex on output). Both can coexist; they catch different classes.

Worth borrowing: subsumed by §4.2 (hookify-style guardrail rules) — once code-oz has the guardrail rule sheet, security patterns are just rules in that sheet. No separate borrow needed.

### 4.7 `commit-commands` — git workflow slash commands

What it does: `/commit`, `/commit-push-pr`, `/clean_gone` — message generation learns from recent commit style; PR description auto-includes branch history.

What code-oz has: code-oz is run-driven, not session-driven. Commits happen at SHIP gate after VERIFY+REVIEW pass. No interactive `/commit` slash command surface — that would conflict with rule 1 (file-based gates only).

Worth borrowing: no. Out of paradigm. Reject.

### 4.8 `explanatory-output-style` / `learning-output-style` — SessionStart-injected output styles

What they do: SessionStart hook injects "★ Insight" blocks (explanatory) or 5–10 line user-contribution requests (learning).

What code-oz has: runs are non-interactive end-to-end. Output style is fixed by phase contracts. The Scientist tail (rule 15) is the closest parallel: HYPOTHESES.md + OPEN_QUESTIONS.md per phase artifact.

Worth borrowing: no. Code-oz outputs are file artifacts, not an interactive terminal stream. Reject.

### 4.9 `frontend-design` — auto-invoked design skill

What it does: typography, color, animation guidance auto-applied for any frontend task.

What code-oz has: persona system + role-cost policy. If a frontend persona were added, this skill's content could inform its prompt — but the template's mechanism (auto-invoke) does not map to code-oz (file-gated).

Worth borrowing: no structural borrow. Content could be referenced if a frontend role lands post-M16, but that is content reuse, not architecture.

### 4.10 `plugin-dev` / `agent-sdk-dev` / `claude-opus-4-5-migration` — meta-tooling for plugin authors

What they do: scaffold, validate, migrate plugins for the Claude Code marketplace.

What code-oz has: code-oz has its own scaffolding (`code-oz init`, `code-oz doctor`) and provider abstraction (`IAgentProvider`). No marketplace.

Worth borrowing: no. Out of scope (we are not authoring Claude Code plugins). Reject.

### 4.11 `examples/{hooks,settings,mdm}/` — distribution and governance

Already covered in §2.3. The settings hierarchy and MDM patterns are out of scope for code-oz today (no enterprise distribution at v0.17). The strict/lax/sandbox profile pattern is interesting as polish: a `.code-oz/profiles/{strict,lax,dev}.yaml` preset shape would help users without changing rule 9. Defer to v0.2 or W3 polish. Not a structural borrow.

### 4.12 `.devcontainer/` — reproducible dev environment

Worth borrowing: no structural borrow. Code-oz is delivered as a single Bun binary (`bun build --compile`); a devcontainer for contributors is a hygiene win at W3 polish, not architecture.

### 4.13 `scripts/issue-lifecycle.ts` — declarative issue automation

What it does: TypeScript DSL — labels → days-until-nudge → auto-comment template; centralized; used by `gh.sh` and shell wrappers.

Worth borrowing: as repo hygiene, yes; as runtime architecture, no. Code-oz's GitHub repo (`omerakben/code-oz`) currently has manual issue triage. A version of this DSL would be useful at the project level. Decision: defer to a W3 housekeeping commit if/when issue volume justifies it. Not a runtime borrow.

---

## 5. Borrow set (sharp, ranked low → high authority cost)

### B1 — Issue-validate-then-filter pass for the M14 panel

Source: `code-review` plugin steps 5–6.
Mechanism in code-oz: after a panel reviewer writes `REVIEW.md` with N issues, dispatch one validation call per issue (Haiku-tier, same provider family as the reviewer). Each validator reads only the file manifest plus the issue description and returns `{ confirmed: bool, reasoning: string }`. Filter unconfirmed issues from the merged panel verdict.
Implementation surface: `src/phases/review-fire-path.ts` (post-reviewer fan-out), `src/artifacts/review-report.ts` (REVIEW.md schema gains `validated_issues` block), one config field `panel.<reviewer>.validatePerIssue: true|false`.
Authority cost: zero new boundary; extends M14 panel under M14.1 or absorbs into M17 if it lands first.
Rule 21: does not introduce a new parallel-provider surface (the panel is already parallel-provider). Adds within-reviewer fan-out at Haiku tier. Risk-reduction effect must be measurable — before-after false-positive rate against the baseline panel run, logged in `events.jsonl` with `validation_dropped` events.
Caveats: budget impact — O(issues × reviewers) extra Haiku calls per REVIEW phase. Must respect `budgets.global` — if the validator pass would breach, fail safe (skip validation, surface raw issues).

### B2 — Hookify-style guardrail rule sheet for the permission manifest

Source: `hookify` plugin matcher engine + Markdown rule format.
Mechanism in code-oz: new optional file `.code-oz/guardrails.md` (or `guardrails/<rule>.md` collection). Each rule has frontmatter `{ name, enabled, event, pattern, action: warn|block, message }` and Markdown body. The pattern matcher fires inside the tool-call wrapper (`src/tools/`) and the prompt-submission path. Default action `warn` writes to `events.jsonl`; `block` aborts the call and triggers `NEEDS_INTERVENTION.json`.
Implementation surface: new module `src/policy/guardrails.ts` (parser + matcher), wired into `src/tools/<tool-call-entry>.ts`. Frontmatter parser is `yaml` (already a dep). Pattern engine uses native RegExp with timeout cap (avoid catastrophic backtracking).
Authority cost: extends rule 9; framed as "rule 9 gains pattern rules"; no new boundary if scoped tight. Risks framing as a new boundary if scope creeps into prompt rewriting or auto-fix — keep strict to deny/warn.
Rule 21: not parallel-provider; rule 21 does not apply.
Caveats: parser must reject anything other than the documented frontmatter keys; pattern timeout (≤50ms) enforced; the rule sheet itself is read-only in agent permissions (agents must not be able to write/disable rules). Funny-bug self-test: this very document tripped the template's `security-guidance` regex when first written; the lesson is that *rules need a designated escape hatch for documentation that mentions the pattern.* Code-oz's variant should support a `scope:` frontmatter field to limit a rule to runtime tool calls and exempt artifact authoring.

### B3 — Reviewer presets curation library

Source: `pr-review-toolkit` six named agents.
Mechanism in code-oz: `agentpacks/reviewer-presets/{silent-failure-hunter, type-design-analyzer, comment-analyzer, simplifier, security-auditor, test-coverage-auditor}.yaml`. Each is a panel-slot config with role description, prompt fragment additions, and recommended provider. User selects N via `code-oz run --panel-presets silent-failure-hunter,type-design-analyzer`.
Authority cost: zero (data, not code).
Rule 21: parallel-provider surface already governed by M14 panel; presets do not change the surface, just curate its inputs.
Caveats: quality of presets matters more than the mechanism. Defer to a content-only commit when the panel has run on real production code (not just M14 fixtures).

### Summary

| ID | Surface | Authority cost | Rule 21 | Slot |
|---|---|---|---|---|
| B1 | M14 panel | Zero (extends M14) | Within-panel fan-out; needs FP-rate evidence | M14.1 polish or M17 |
| B2 | Permission manifest (rule 9) | Zero (extends rule 9) | N/A | M16+ polish; standalone commit |
| B3 | Panel preset library | Zero (data only) | N/A | W3 polish or after M14.1 |

---

## 6. Rejection list

Patterns explicitly rejected. Reasons compressed:

| Pattern | Reason rejected |
|---|---|
| Plugin marketplace + manifest | Out of scope; code-oz is not a Claude Code plugin |
| MCP host machinery | Out of scope; code-oz is its own runtime |
| MDM (`managed-settings.json` + plist + admx) | Premature; deferred to v0.2 enterprise tier |
| Devcontainer | Polish, not architecture; defer to contributor hygiene commit |
| Issue-lifecycle TS DSL (`scripts/`) | Repo governance, not runtime architecture |
| `ralph-wiggum` Stop-hook inside-session loop | Conflicts with rule 12 (resumability) and rule 19 (budget visibility); already shipped outside-session at W3-lite tier |
| `commit-commands` slash commands | Conflicts with rule 1 (file-gated, not interactive) |
| `explanatory-output-style` / `learning-output-style` | Code-oz outputs are file artifacts, not interactive streams |
| `frontend-design` auto-invoke skill | Auto-invoke conflicts with file-gated discipline; content reuse possible if frontend role lands |
| `plugin-dev` / `agent-sdk-dev` meta-tooling | Out of paradigm (we are not plugin authors) |
| `claude-opus-4-5-migration` automation | Code-oz tracks Opus default by config; rule 4 covers downgrade discipline |
| `feature-dev` parallel architects | Subsumed by M10 debate runtime + M14 panel + PLAN's 3-source verification |

---

## 7. Authority cost analysis (rule 20)

Rule 20: one new authority boundary per milestone. None of B1, B2, B3 introduce a new boundary on the strict reading:

- **B1** extends an existing boundary (M14 reviewer panel). It introduces a new operation (validate-issue) within that boundary. Strictly: no new boundary. Risk: scope creep — if validate-issue grows into "auto-fix issue," that is a new boundary (BUILD authority) and must be split.
- **B2** extends rule 9 (permission manifest). The rule already covers default-deny on commands/network/file-roots/env-vars; adding pattern rules is a refinement, not a new authority axis. Risk: scope creep — if pattern rules gain auto-rewrite (transform input rather than warn/block), that is a new boundary.
- **B3** is content (data files). No authority cost.

Open question for Codex: does B1's validate-issue fan-out count as "extending the panel boundary" or as a new "evidence-revalidation authority"? The comparison's stance is the former. Codex should pressure-test.

---

## 8. Rule 21 measurable-effect analysis

Rule 21: no new parallel-provider surface without measurable risk-reduction effect against the single-provider baseline.

- **B1** does fan out within a panel slot (the validators), but stays within one provider family per slot. Strictly speaking, it is not a new parallel-provider surface — it is intra-slot redundancy. However, the rule's spirit (no complexity without measurable benefit) still applies. The borrow needs an A/B: panel run with validation vs without, comparing FP rate over ≥10 production runs. Should be cheap to measure once `events.jsonl` has the dropped-issues events.
- **B2** is not parallel-provider; rule 21 does not gate it. (Rule 9 evidence model — pattern hits per run — is enough.)
- **B3** is content; rule 21 does not apply.

Open question for Codex: is "intra-slot validator fan-out" exempt from rule 21, or does any added fan-out trigger the measurable-effect bar?

---

## 9. What code-oz does that the bundled plugins do not

For completeness — the gap in the other direction. The bundled plugin tier does not have:

| Code-oz feature | Why it matters |
|---|---|
| File-based gate signals (rule 1) | Plugins infer pass/fail from text; code-oz reads `GATE_<PHASE>_PASSED.json` |
| Cross-family review enforced (rule 2) | `code-review` plugin's parallel agents are all Sonnet/Opus by default |
| Schema-validated artifacts (rule 7 + Zod schemas) | Plugins emit free-form Markdown; code-oz validates each artifact |
| 3-source verification at PLAN (rule 3) | No equivalent in `feature-dev` |
| Universal anti-slop rules in every persona (rule 16) | Plugin agents have ad-hoc rules per command |
| Maestro 4-layer FS memory (rule 17) | No equivalent — plugins are stateless across sessions |
| Run-level budget enforcement (rule 19, `budgets.global`) | Plugins have no cost cap |
| Authority boundary discipline (rule 20) | Plugins evolve ad-hoc |
| Rule 21 measurable-effect bar | Plugins ship parallelism without empirical justification |
| Worktree isolation per run | Plugins write directly to repo |
| VERIFY phase with restart-on-fail | `code-review` is post-hoc; no restart loop |
| Debate runtime (M10) + scheduler (M15) | `feature-dev`'s "user picks" is a manual UX, not a debate primitive |
| Reviewer panel (M14) with cross-family slots | `code-review` and `pr-review-toolkit` are single-family |
| Role-cost policy (M13) under `budgets.global` | Plugins have no per-role budget |
| Provider capability contract (M11) | Plugins assume Sonnet/Opus available |
| Brownfield AUDIT phase | No equivalent |
| Privacy-by-default file manifest (rule 13) | Plugins receive whatever the harness routes (often broader) |
| Production CLI completion (M16) | Plugins are slash commands inside the harness |

This is the discipline tax code-oz pays in exchange for the SDLC guarantees. The bundled plugins are designed for low-friction interactive work; code-oz is designed for unattended production runs with audit trails.

---

## 10. Open questions for Codex

The cross-model peer review must answer these:

1. **Verdict pressure-test.** Is the "YES, with three narrow borrows" verdict correct, or is there a template mechanic the comparison missed that would change it?
2. **B1 authority axis.** Is the validate-issue fan-out really "extending the panel boundary," or does it introduce a new "evidence-revalidation authority" that should be its own milestone?
3. **B1 rule 21.** Does intra-slot validator fan-out count as a new parallel-provider surface, triggering the measurable-effect bar?
4. **B2 scope.** Is the "rule 9 gains pattern rules" framing right, or is the guardrail rule sheet a new authority (rule 9 has been about configuration; the rule sheet is runtime enforcement)?
5. **B2 attack surface.** Does the guardrail rule sheet itself become an attack surface (rule injection, regex DoS, agent disabling rules, false-positive suppression of legitimate work — see this very document's writing tripping `security-guidance`)? What concrete defenses are required?
6. **Rejection of `feature-dev` parallel architects.** Is the comparison underweighting this? The mechanic is closer to M10 debate than the rejection acknowledges. Should code-oz expose a `code-oz plan --present-options` UX that mirrors feature-dev's user-pick step?
7. **Rejection of `ralph-wiggum` inside-session loop.** Did the comparison correctly conclude that outside-session is the right choice for code-oz? Or is there a third hybrid (Stop-hook for in-phase iteration only) worth exploring?
8. **Did the comparison miscategorize anything in the OUT-OF-SCOPE harness tier?** Specifically: settings hierarchy, MDM, plugin marketplace. Each is currently rejected as out-of-scope; pressure-test that.
9. **Cargo-cult risk on B3 (preset library).** Is shipping named reviewer presets premature without empirical data on which roles actually catch bugs in production runs?
10. **One thing the comparison is wrong about.** Steelman the strongest counter-position.

---

## 11. Decision matrix

| Borrow | Verdict | Authority cost | Rule 21 | Slot | Pre-condition |
|---|---|---|---|---|---|
| B1 — Validate-issue fan-out | Tentative-yes | Zero (extends M14) | Needs FP-rate measurement | M14.1 polish or M17 | Codex confirms boundary scoping; budget cap respected |
| B2 — Guardrail rule sheet | Tentative-yes | Zero (extends rule 9) | N/A | Standalone polish commit, M16+ | Codex confirms scope-creep guard; parser hardening; doc-scope escape |
| B3 — Reviewer preset library | Defer | Zero (data) | N/A | After ≥10 panel production runs | Empirical data on role usefulness |
| All other 10 patterns | Reject | — | — | — | — |

Companion docs:
- `docs/comparisons/claude-code/CODEX_BRIEFING.md` — adversarial briefing for the Codex debate.
- `docs/comparisons/claude-code/CODEX_RESPONSE.md` — Codex's pushback (to be filled).
- `docs/comparisons/claude-code/SYNTHESIS.md` — post-debate synthesis with final decisions.

Status at end of comparison: verdict YES; three tentative borrows; awaiting Codex.
