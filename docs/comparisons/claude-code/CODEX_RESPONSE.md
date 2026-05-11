# Codex response — code-oz vs claude-code template borrow audit

**Reviewer:** Codex (gpt-5.5 xhigh, sandbox: read-only).
**Thread ID:** 019e12f2-d3ba-7880-93ce-37c8b0a0262f.
**Date:** 2026-05-10.
**Mode:** Adversarial cross-family review per the project's cross-model peer-review rule.
**Companion docs:** `docs/comparisons/claude-code/CODEX_BRIEFING.md` (briefing), `docs/comparisons/claude-code/COMPARISON.md` (Claude's analysis).

---

## Section 1 — Verdict on the verdict

Concur with the broad verdict: YES, code-oz is ahead of the bundled plugin tier, and the useful borrow surface is narrow. I would not accept the comparison's authority accounting as written. B1 is not zero-cost if validators can drop findings before the canonical verdict. B2 is not merely "rule 9 gains pattern rules" if it blocks runtime tool calls. B3 is not a borrow yet; it is a deferred content experiment.

The strongest evidence for code-oz being ahead remains structural: file gates, cross-family review, Markdown artifact schemas, run budgets, and rule 21 are locked in `CLAUDE.md:23-43`. The current M14 panel already uses staging, manifest equality, registry-resolved families, and orchestrator-owned verdicts in `src/phases/review-panel.ts:345-456` and `src/phases/review-panel-verdict.ts:158-172`.

What changes the verdict is not a "NO" gap. It is a slot correction: ship B2 as a standalone authority boundary, measure B1 before it can suppress findings, and keep B3 out of defaults until panel data exists.

## Section 2 — Per-borrow review

### B1: Issue-validate-then-filter pass

Authority cost: Disagree with "zero new boundary." The borrow in the briefing says validators return confirmed status and unconfirmed issues are filtered from the merged verdict (`docs/comparisons/claude-code/CODEX_BRIEFING.md:49`). That is evidence-revalidation authority. In current code-oz, unresolved voter-impact `block` or `fix-first` findings drive the panel verdict mechanically (`src/phases/review-panel-verdict.ts:262-313`). If a validator can remove such a finding, it can change gate outcome. That is not just M14 polish.

Rule 21 risk: Disagree with the exemption framing. It may not be a new parallel-provider surface if validators stay in the same provider family, but it is still added LLM fan-out. Rule 21's spirit applies because complexity is being added to reduce reviewer false positives. The minimum measurable effect is not only "issues dropped." It must track false positives reduced, false negatives introduced, budget overhead, and whether dropped issues later reappear in VERIFY or REVIEW. Log `issue_validation_started`, `issue_validation_completed`, `issue_validation_dropped`, and `issue_validation_disagreed` events.

Milestone fit: Reject M14.1 unless B1 is advisory only. If it filters canonical findings, put it in M17 or a dedicated M14.2 with a baseline. The current `ReviewFinding` schema has no validation field (`src/artifacts/review-report.ts:112-123`), and the serializer writes only file, line, severity, recommendation, and round state (`src/artifacts/review-report.ts:209-224`). That is a schema and verdict-semantics change, not a small patch.

Bug class: False-negative laundering. A fresh same-family validator can miss a real blocker and drop the only voter-impact finding, producing a ready verdict. Concrete strengthening: keep validator output as evidence first. Do not drop `block` or `fix-first` findings unless two independent validators reject the issue or the original eligible voter retracts it in a bounded repair round. If budget would tip under rule 19, skip validation and preserve raw findings, matching the comparison's own caveat in `COMPARISON.md:255-256`.

### B2: Hookify-style guardrail rule sheet

Authority cost: Disagree with "zero." B2 introduces runtime content-inspection authority between persona output and tool execution. Rule 9 currently covers the permission manifest and default-deny scopes (`CLAUDE.md:31`), while code config permissions are only `allowEscapeHatch` and `requireApprovalForBuild` (`src/config/load.ts:845-876`). Pattern-based deny is a new enforcement plane. It can still be the one new authority boundary for a milestone under rule 20, but it should be named honestly.

Rule 21 risk: Agree that rule 21 does not directly gate B2. No provider fan-out is added. The right measurement belongs to rule 9 and rule 19: rule hits, blocks, warnings, false-positive overrides, and match latency in `events.jsonl`.

Milestone fit: Standalone M16+ is right if scoped to warn/block only. It should not rewrite prompts, patch files, auto-fix commands, or mutate rule files. The comparison understates what Hookify already supports: frontmatter can define multi-condition rules (`plugins/hookify/core/config_loader.py:15-20`, `plugins/hookify/core/config_loader.py:50-73`), the engine requires all conditions to match (`plugins/hookify/core/rule_engine.py:120-125`), and it supports operators beyond regex (`plugins/hookify/core/rule_engine.py:166-180`). B2 should inherit the condition model, not only a single `pattern`.

Bug class: Documentation false positives and regex DoS. The briefing already cites a doc-writing tripwire (`docs/comparisons/claude-code/CODEX_BRIEFING.md:112-114`). Concrete strengthening: require `scope`, `event`, `tool`, `conditions`, `action`, `message`, `dedupKey`, and `maxMatchesPerRun`; reject unknown frontmatter keys; cap input length per match; prefer substring/glob/equality operators before regex; store de-dup in `events.jsonl`, not hidden state. Rule files must be read-only to agents.

### B3: Reviewer presets curation library

Authority cost: Partly disagree. If presets are inert examples, authority cost is near zero. If `code-oz run --panel-presets ...` changes panel composition, model choice, or voter/advisory role defaults, it steers M14 authority. The PR toolkit's agents are concern-oriented (`plugins/pr-review-toolkit/commands/review-pr.md:20-43`) and aggregate findings by severity (`plugins/pr-review-toolkit/commands/review-pr.md:57-88`), but code-oz's panel verdict depends on eligible voters and voter-impact findings, not named concern labels.

Rule 21 risk: N/A only if presets do not add panel slots. If a preset expands from two voters to more reviewers or changes family mix, rule 21 applies. Presets can quietly create role theater: "security-auditor" and "silent-failure-hunter" sound useful even when they are poorly fit to a repo.

Milestone fit: Defer. I would reject shipping B3 as an agentpack surface until at least 10 production panel runs identify which reviewer roles found real issues. A safe interim is `docs/examples/reviewer-presets/` with no runtime loader and no default activation.

Bug class: Preset cargo-culting. Users may select impressive names instead of the reviewer that matches the change. Concrete strengthening: record `presetId` on panel events, track unique confirmed findings by preset, and promote only presets with observed signal. Do not give a preset gate authority unless it maps to an existing voter/advisory slot with explicit user selection.

## Section 3 — The ten contested questions

### 1. Verdict pressure-test

The verdict is directionally right, but the borrow count is too generous. I would call it "YES, two conditional borrows plus one deferred content backlog." The missed mechanics do not create a credible gap against code-oz's file-gated runtime. They do change B2 and B1 scope. Hookify is richer than "single regex," and security-guidance is block-capable, not advisory-only.

### 2. B1 authority axis

B1 introduces evidence-revalidation authority if it can suppress findings. It is safe as telemetry or an advisory confidence field. It is not safe as automatic filtering without its own artifact schema, event vocabulary, budget preflight, and false-negative measurement. The authority axis is: "which finding is allowed to affect the gate after an LLM re-checks another LLM."

### 3. B1 rule 21

The literal rule 21 trigger is debatable because validators can stay same-family. The measurable-effect bar still applies. Added LLM fan-out must prove risk reduction against the single-review baseline. Required evidence: confirmed false-positive reduction, no rise in escaped blockers, budget overhead under rule 19, and post-run tracking of dropped issues that recur.

### 4. B2 scope

The guardrail sheet is a new runtime enforcement authority, not just configuration decoration. It can be framed as rule 9's next milestone, but only if it remains warn/block and never rewrites inputs. Calling it "zero new boundary" hides the fact that pattern matches can now deny a tool call before the tool wrapper executes.

### 5. B2 attack surface

Yes. Required defenses: schema-validate frontmatter, reject unknown keys, make guardrail files unavailable for agent writes, limit match input size, avoid arbitrary regex where deterministic operators work, record every warn/block event, support `scope` for runtime versus artifact authoring, and fail closed on malformed blocking rules. Do not copy Hookify's transcript-reading behavior into code-oz by default.

### 6. Feature-dev parallel architects

The comparison underweights the prompt content, not the architecture. `code-architect` demands pattern analysis, file-line references, component design, data flow, and build sequence (`plugins/feature-dev/agents/code-architect.md:13-32`). Code-oz Lead already has 3-source verification and atomic tasks (`src/agents/defaults/lead.md:50-58`). A `PLAN_OPTIONS.md` artifact could be useful for ambiguous specs, but not an automatic parallel-architect surface.

### 7. Ralph inside-session loop

Outside-session remains the right default. The inside-session loop fights rule 12 and rule 19 because it keeps one model context alive while stop hooks recycle prompts. The reusable part is not the hook. It is the bounded control fields: `max_iterations`, `completion_promise`, and corrupted-state escape paths in `plugins/ralph-wiggum/hooks/stop-hook.sh:27-55`.

### 8. Harness tier categorization

Mostly correct. MDM, marketplace, and settings hierarchy are harness governance, not code-oz runtime. One exception: strict/lax/sandbox profiles are useful as operator presets later. The settings examples explicitly distinguish managed hooks, managed permissions, web denial, and Bash sandboxing (`examples/settings/README.md:13-27`). Defer as config-profile UX, not architecture.

### 9. B3 cargo-cult risk

Yes, high risk. Named reviewer presets should not ship as runtime defaults before data exists. The safer path is a disabled example library plus event fields that measure which concern roles produced confirmed findings. Promote a preset only after it catches bugs in real runs and does not inflate reviewer noise.

### 10. One thing the comparison is wrong about

The strongest counter-position is that Claude misread `security-guidance`: the comparison says it "warns without blocking" (`docs/comparisons/claude-code/COMPARISON.md:189-197`), but the hook exits with the blocking PreToolUse code after printing the warning (`plugins/security-guidance/hooks/security_reminder_hook.py:271-273`). That error weakens B2's authority-cost analysis.

## Section 4 — What Claude missed

### 1. Hookify's matcher is multi-condition, not single-pattern

Verdict: load-bearing.

The comparison treats Hookify mostly as `{ event, pattern, action, message }`. The actual model has `Condition` objects with `field`, `operator`, and `pattern` (`plugins/hookify/core/config_loader.py:15-20`), supports a `conditions` list (`plugins/hookify/core/config_loader.py:50-55`), converts legacy `pattern` into a condition (`plugins/hookify/core/config_loader.py:56-73`), and requires all conditions to match (`plugins/hookify/core/rule_engine.py:120-125`). It also extracts different fields for Bash, Write, Edit, MultiEdit, Stop, and UserPromptSubmit (`plugins/hookify/core/rule_engine.py:195-253`).

B2 should not flatten that into one regex. A code-oz guardrail rule should use a typed condition list: `tool`, `field`, `operator`, `value`, `scope`, and `action`. That is enough to express "block Bash command matching X only when cwd is under Y" without regex soup. Reject Hookify's weak spots: no priority, no cooldown, no regex timeout, permissive parse fallback, and transcript reads by default.

### 2. Security-guidance has de-dup state and blocking behavior

Verdict: load-bearing, but not copyable as-is.

Claude caught the pattern list but missed the execution semantics. The hook keeps session-scoped state files under `~/.claude/security_warnings_state_<session>.json` (`plugins/security-guidance/hooks/security_reminder_hook.py:129-180`). It builds a per-file, per-rule warning key (`plugins/security-guidance/hooks/security_reminder_hook.py:258-269`). Then it prints the reminder and exits with code 2, with the source comment saying that blocks tool execution (`plugins/security-guidance/hooks/security_reminder_hook.py:271-273`).

For code-oz, the load-bearing mechanic is not the hidden state file. It is "warn once per scoped condition, then record enough evidence to audit why a tool call was blocked." Use `events.jsonl` for de-dup and history. Do not allow an env var equivalent to `ENABLE_SECURITY_REMINDER=0` (`plugins/security-guidance/hooks/security_reminder_hook.py:219-224`) inside agent-controlled execution. If operators need bypass, require an explicit config edit and make it visible in run metadata.

### 3. Plugin-dev is an agentpack authoring and validation workflow

Verdict: load-bearing later, not for this borrow set.

The comparison rejects `plugin-dev` as marketplace meta-tooling (`docs/comparisons/claude-code/COMPARISON.md:223-229`). That is too narrow. The create-plugin command is a full authoring pipeline: discovery, component planning, detailed questions, implementation, validation, and testing (`plugins/plugin-dev/commands/create-plugin.md:24-40`, `plugins/plugin-dev/commands/create-plugin.md:44-75`, `plugins/plugin-dev/commands/create-plugin.md:79-99`, `plugins/plugin-dev/commands/create-plugin.md:233-260`). The validator checks manifest fields, component structure, hook schema, MCP config, and security issues (`plugins/plugin-dev/agents/plugin-validator.md:56-65`, `plugins/plugin-dev/agents/plugin-validator.md:107-115`, `plugins/plugin-dev/agents/plugin-validator.md:130-141`).

Code-oz already has a typed agent loader, including permissions and tool-use validation (`src/agents/schema.ts:275-384`). What it lacks is a user-facing authoring workflow for new agentpacks, reviewer presets, and guardrail sheets. Borrowing plugin-dev now would be premature. The concrete later borrow is `code-oz doctor agentpacks`: validate frontmatter, permission scopes, prompt-body required sections, model policy, reviewer preset metadata, and guardrail rule schemas before a run can use local extensions.

## Section 5 — One thing Claude is wrong about

The weakest claim is that `security-guidance` "warns without blocking" (`docs/comparisons/claude-code/COMPARISON.md:191`). The implementation blocks. After matching a rule, it prints the reminder and exits with code 2, explicitly described as blocking tool execution (`plugins/security-guidance/hooks/security_reminder_hook.py:271-273`). The hook config is a PreToolUse hook for Edit, Write, and MultiEdit (`plugins/security-guidance/hooks/hooks.json:1-15`), so this is not a passive terminal hint.

Steelman of the opposing position: this makes the template stronger than Claude's comparison admits. It demonstrates a real runtime enforcement layer between model-authored edits and filesystem mutation. That is exactly the kind of layer B2 proposes for code-oz. If the comparison had read this correctly, it could not call B2 "zero new boundary" with a straight face. A block-capable guardrail sheet can change whether a tool call executes, which files get modified, and whether a run reaches the next gate. That is authority.

The right synthesis is not "import security-guidance." Its hardcoded pattern list is coarse, its state is hidden in `~/.claude`, it can be disabled by environment, and it already produced the doc-authoring false positive called out in the briefing. The right synthesis is stricter: make B2 a named rule-9 enforcement milestone; record every decision in `events.jsonl`; require `scope` so documentation can mention risky APIs; keep rules read-only to agents; and treat blocking rules as auditable policy, not reminders.
