# Synthesis — code-oz vs claude-code template borrow audit (post-debate)

**Date:** 2026-05-10.
**Author:** Claude Opus 4.7 (xhigh) after debate with Codex (gpt-5.5 xhigh).
**Inputs:** `COMPARISON.md` (pre-debate), `CODEX_BRIEFING.md` (briefing), `CODEX_RESPONSE.md` (Codex pushback).
**Status:** Final post-debate decisions and revised milestone shape.

---

## TL;DR

Codex landed three substantive corrections. After accepting them, the borrow set shrinks to **two conditional borrows + one example-tier deferral**, and one factual error in `COMPARISON.md` is corrected. The verdict — code-oz is structurally ahead of the bundled plugin tier — does not change, but the slot and authority-cost accounting do.

| Borrow | Pre-debate status | Post-debate status |
|---|---|---|
| **B1** — Issue-validate-then-filter | Tentative-yes, M14.1 polish, "zero new boundary" | Conditional: ship as **B1-lite** (advisory metadata only) at M14.1, OR as **B1-full** at a dedicated M-N (M17 or later) with new schema + events + 2-validator quorum to drop voter-impact findings + false-negative tracking |
| **B2** — Guardrail rule sheet | Tentative-yes, M16+ polish, "zero new boundary, rule 9 gains pattern rules" | Accept-with-modifications: ship as a **named rule-9 enforcement milestone** with typed condition model (not flat regex), `scope` frontmatter, `events.jsonl` de-dup, no env-var bypass, fail-closed on malformed rules |
| **B3** — Reviewer presets library | Defer to W3 polish, "zero (data only)" | Demote to `docs/examples/reviewer-presets/` with **no runtime loader** until ≥10 panel production runs produce promotion data |
| **+B4** — `code-oz doctor agentpacks` | Not in original set | New deferred follow-up surfaced by Codex: validator command for agentpacks/presets/guardrails before a run accepts local extensions. v0.2 polish |

Codex's pushbacks accepted: 7 of 10. Pushbacks where Claude holds: 2 of 10. Disagreements where neither side fully wins: 1 of 10.

---

## 1. Concessions — where Codex is right

### 1.1 The factual error on `security-guidance`

`COMPARISON.md` §4.6 claims `security-guidance` "warns without blocking." That is wrong. Verified by direct read: the hook prints the reminder to stderr and calls `sys.exit(2)`, the PreToolUse blocking exit code (`plugins/security-guidance/hooks/security_reminder_hook.py:271-273`). The hook's own `hooks.json` description ("warns about potential security issues") does not match the code's actual behavior — a docs/code mismatch in the upstream template itself.

This error matters in two ways:

1. It strengthens Codex's B2 framing. A block-capable PreToolUse hook *is* a runtime enforcement layer between persona output and tool execution. Calling B2 "rule 9 gains pattern rules" without acknowledging the new enforcement plane was lazy framing.
2. It is an empirical case study for B2's design rules: *a guardrail layer's documentation and code must agree*. The template's own implementation has a docs/code drift; B2 must engineer against that drift via schema-validated frontmatter + linted message bodies.

**Correction landed:** see §3 below. `COMPARISON.md` §4.6 will be amended in a follow-up commit (the historical pre-debate reading is preserved in this synthesis for audit).

### 1.2 B1 introduces evidence-revalidation authority

Codex: "If a validator can remove [a `block` or `fix-first`] finding, it can change gate outcome. That is not just M14 polish."

Verified against `src/phases/review-panel-verdict.ts:262-313`: voter-impact `block` and `fix-first` findings drive the panel verdict mechanically. A validator that filters one of those findings before aggregation directly changes whether the gate passes. That is a new authority axis: "which finding is allowed to affect the gate after an LLM re-checks another LLM."

**Decision:** split B1 into two variants and pick one consciously, not both:

- **B1-lite (advisory only)** — validators run, write `validation_outcome` metadata onto each finding (`confirmed | unconfirmed | disagreed`), but the panel verdict aggregator continues to count *all* voter-impact findings regardless of validation. This is pure telemetry. Authority cost: zero. Slot: M14.1 polish. Goal: collect data on validator agreement rates over ≥10 production panel runs *before* deciding if filtering is safe.
- **B1-full (filtering)** — validators may suppress findings, but only `info` and `nit` severities by default; `block` and `fix-first` require **two independent validators** (different model + fresh context) to agree on suppression, AND the original eligible voter must not retract its protest, AND the finding must not match a deny-list of "never auto-suppress" patterns (security CVE markers, contract-breaking wording). New events: `issue_validation_started`, `issue_validation_completed`, `issue_validation_dropped`, `issue_validation_disagreed`. New schema field on `ReviewFinding`. Authority cost: new boundary (evidence-revalidation). Slot: dedicated M-N (M17 or later). Pre-condition: B1-lite ran first and produced ≥10 runs of agreement-rate data showing low risk of false-negative laundering.

Pre-debate `COMPARISON.md` only described B1-full and called it zero-cost. That was wrong. Going forward, B1-lite is the polish-tier borrow; B1-full is a separate milestone gated on B1-lite's evidence.

### 1.3 B2 is a new enforcement boundary

Codex: "Pattern-based deny is a new enforcement plane. It can still be the one new authority boundary for a milestone under rule 20, but it should be named honestly."

Concur. Rule 20 says one new authority boundary per milestone, not zero. The error in `COMPARISON.md` §7 was framing B2 as "rule 9 gains pattern rules" to dodge the boundary count. The honest framing: **B2 is a new "rule-9 enforcement layer" authority that takes its own milestone slot.** Rule 9 today covers default-deny scopes (commands / network / file-roots / env-vars / timeout / secret access) as configuration. B2 introduces *runtime content inspection* between persona output and tool execution. That is a different authority plane — one that can deny a tool call based on emitted content, not just the configured scope.

**Decision:** B2 lands as its own milestone (call it M-N "rule-9 enforcement layer"), with the design hardening list below.

### 1.4 Hookify is multi-condition, not single-pattern

Codex: "B2 should not flatten that into one regex. A code-oz guardrail rule should use a typed condition list."

Concur. Reading `plugins/hookify/core/config_loader.py:15-73` and `plugins/hookify/core/rule_engine.py:120-253` confirms Hookify supports `Condition` objects with `field`/`operator`/`pattern`, multi-condition AND with all-must-match semantics, and per-tool field extraction (Bash/Write/Edit/MultiEdit/Stop/UserPromptSubmit). Flattening to single regex would lose expressiveness AND give us regex DoS by default.

**Decision:** B2's rule schema becomes:

```yaml
---
name: deny-prod-debug-print
enabled: true
event: PreToolUse
tool: Edit | Write | MultiEdit
scope: runtime-tool-call    # not artifact-authoring
conditions:
  - field: file_path
    operator: glob
    value: src/**/*.ts
  - field: new_content
    operator: contains       # substring, not regex
    value: console.log
action: warn                 # or block
message: |
  Production code should not contain debug-print statements.
dedupKey: "{rule.name}:{file_path}"
maxMatchesPerRun: 5
priority: 100
---
```

Operators (in order of preference): `equals`, `contains`, `glob`, `prefix`, `suffix`, then `regex` (with timeout cap and length cap). Reject unknown frontmatter keys. Reject unknown operators. Reject regex without a `maxLength` field. Pre-compile patterns at boot. The default action is `warn`, not `block`. Block requires explicit operator approval. `scope: runtime-tool-call` is required by default; `scope: artifact-authoring` (the documentation case) is allowed but auto-skips on Markdown writes inside `docs/`. This is the design lesson the meta-bug taught us.

### 1.5 De-dup state lives in `events.jsonl`, not hidden files

Codex: "Use `events.jsonl` for de-dup and history. Do not allow an env var equivalent to `ENABLE_SECURITY_REMINDER=0`."

Concur. The bundled hook stores per-session state under `~/.claude/security_warnings_state_<session>.json`. That hides which rules fired across runs and makes it un-auditable. Code-oz already has `events.jsonl` as the source of truth for budget enforcement (rule 19); guardrail decisions belong in the same log. New event types: `guardrail_evaluated`, `guardrail_warned`, `guardrail_blocked`, `guardrail_skipped_dedup`. No env-var bypass. Operator override requires an explicit config edit (e.g., `enabled: false` on the rule itself) which is itself logged at run start.

### 1.6 B3 is not a runtime borrow yet

Codex: "Defer. I would reject shipping B3 as an agentpack surface until at least 10 production panel runs identify which reviewer roles found real issues. A safe interim is `docs/examples/reviewer-presets/` with no runtime loader."

Concur. `COMPARISON.md` had B3 at "zero (data only)" but suggested a `code-oz run --panel-presets …` CLI flag. That flag would steer panel composition and family mix, which gives presets indirect gate authority. Pre-empirical-data, that is preset cargo-culting (the `silent-failure-hunter` name sounds useful even when poorly fit to the run).

**Decision:** B3 lands as `docs/examples/reviewer-presets/<role>.yaml` files with a README explaining how a user can copy-paste them into their own `.code-oz/config.yaml`. **No runtime loader.** No CLI flag. After ≥10 panel production runs produce data on which preset content correlates with confirmed findings, revisit promotion to a runtime surface.

### 1.7 Plugin-dev is later opportunity, not now

Codex: "The concrete later borrow is `code-oz doctor agentpacks`: validate frontmatter, permission scopes, prompt-body required sections, model policy, reviewer preset metadata, and guardrail rule schemas before a run can use local extensions."

Concur. Code-oz already has typed agent loading at `src/agents/schema.ts:275-384`, so the foundation exists. What is missing is a user-facing validator command. **Adding B4 to the deferred backlog:** `code-oz doctor agentpacks` runs at v0.2 polish tier, after B2 lands (so guardrail rule schemas can be part of the validator). Authority cost: zero (it is a validator over data, not a gate). Slot: post-B2.

---

## 2. Pushbacks — where Claude holds

### 2.1 `feature-dev` parallel architects: prompt content, not new artifact

Codex (§3.6): "A `PLAN_OPTIONS.md` artifact could be useful for ambiguous specs."

Hold. Code-oz's PLAN already produces `SPEC.md`, `PLAN.md`, `SOURCE_CHECK.md`, plus the optional Scientist tail (`HYPOTHESES.md`, `OPEN_QUESTIONS.md`). Adding a sixth artifact for the rare ambiguous-spec case is over-engineering. The prompt-content insight (Codex: "code-architect demands pattern analysis, file-line references, component design, data flow, and build sequence") is right and absorbable into the **Lead persona prompt itself** without a new artifact.

**Decision:** absorb the rich prompt content from `plugins/feature-dev/agents/code-architect.md:13-32` into `src/agents/defaults/lead.md`'s planning prompt as a "consider these dimensions when there are multiple valid approaches" section. No new artifact. No new milestone.

### 2.2 Settings strict/lax/sandbox profiles: defer, not adopt

Codex (§3.8): "One exception: strict/lax/sandbox profiles are useful as operator presets later."

Partially hold. The profile pattern is genuinely useful as future config-profile UX. But attaching it to this comparison's borrow set risks scope creep. **Decision:** record as a v0.2 backlog item (`config-profiles` candidate); no slot in the v0.x polish cycle. The reason: presets at the config level are a different concern from rule 9 enforcement (B2). Conflating them muddies the milestone shape.

---

## 3. Updates required to other docs

### 3.1 `COMPARISON.md` — factual correction

§4.6 ("`security-guidance` — PreToolUse pattern hook") incorrectly states the hook "warns without blocking." The hook calls `sys.exit(2)` after printing the reminder, which blocks the tool call (PreToolUse blocking exit code). The hook's `hooks.json` description ("warns about potential security issues") is itself a docs/code mismatch in the upstream template.

**Action:** add a correction note at the top of `COMPARISON.md` pointing to this synthesis section, *or* edit §4.6 in place with a "Correction (2026-05-10):" annotation. The pre-debate text is preserved here for audit purposes. (Per project convention with the maestro dossier and `## Update <date>` annotations.)

### 3.2 `CLAUDE.md` influence library — no change yet

The influence table currently credits `claude-code` with "Plugin format + hook event names + filesystem discovery." When B2 ships, append: "+ guardrail rule schema (typed conditions, scope-aware, events-logged)". Do not pre-emptively edit the table.

### 3.3 ROADMAP — add B2 milestone, B1-lite slot, B3 example folder, B4 deferred

Update `docs/design/ROADMAP.md`:

- **M16+ polish slot — B1-lite (validator advisory metadata)**. Authority cost: zero. Pre-req: M14 panel landed (already shipped). Exit criterion: ≥10 production panel runs with `validation_outcome` metadata recorded; agreement-rate data summarized in `docs/research/B1_VALIDATOR_AGREEMENT.md`.
- **New milestone slot — Rule-9 enforcement layer (B2)**. Authority cost: one new boundary (rule 20 spend). Cross-model peer review required at planning convergence and implementation completion (durable rule). Pre-req: B1-lite landed and stable. Exit criterion: schema-validated `.code-oz/guardrails/<rule>.md` parser; events emitted to `events.jsonl`; rule files read-only to agents; `scope` field enforced; ≥3 example rules in `docs/examples/guardrails/` covering the doc-authoring escape case; live test that artifact-authoring scope skips correctly.
- **W3 polish slot — `docs/examples/reviewer-presets/` (B3 deferred)**. Authority cost: zero. Pre-req: none. No runtime loader.
- **v0.2 backlog — `code-oz doctor agentpacks` (B4)**. Authority cost: zero (validator). Pre-req: B2 landed. Validates agentpack frontmatter + permission scopes + prompt-body sections + model policy + reviewer preset metadata + guardrail rule schemas.
- **v0.2 backlog — config profiles (settings strict/lax/sandbox analogue)**. Authority cost: zero (UX layer over rule 9). Pre-req: B2 landed.
- **B1-full (filtering)** — explicitly NOT scheduled. Becomes a candidate only after B1-lite produces ≥10 runs of agreement-rate data showing low risk of false-negative laundering. No slot reserved.

### 3.4 Memory updates

Add a memory entry once the milestone schedule is committed (after Ozzy's review of this synthesis):

- `claude_code_template_comparison.md` — lists the four post-debate decisions, the security-guidance factual correction, and the doc-authoring scope lesson. Fits the existing `template_comparison_series.md` index pattern.

---

## 4. The disagreement seed (Section 5 of Codex's response)

Codex picked the security-guidance misread as the steelman target. Conceded fully — the misread is a factual error and the steelman is correct: B2 cannot be called zero-boundary with a straight face. This reinforces, rather than contradicts, the locked rules, and the synthesis adopts every defensive safeguard Codex listed.

There is no remaining disagreement seed. Both reviewers converge on:

1. The verdict is YES.
2. The borrow set shrinks to B1-lite + B2 + B3-as-examples + B4-deferred.
3. B2 takes its own milestone slot honestly.
4. The doc-authoring scope is a real failure mode B2 must engineer against.

---

## 5. Final decision matrix

| Borrow | Decision | Authority cost | Rule 21 | Slot | Pre-condition |
|---|---|---|---|---|---|
| B1-lite (advisory metadata) | Approved | Zero (extends M14) | Spirit applies; advisory mode skips fan-out cost concern | M14.1 polish slot | None |
| B1-full (filtering with quorum) | Deferred | New boundary (evidence-revalidation) | Measurable FP-reduction + no FN-rise required | Dedicated milestone (M17+) | B1-lite produces ≥10-run agreement data |
| B2 (rule-9 enforcement layer) | Approved | One new boundary (named honestly) | N/A (no provider fan-out) | New milestone slot post-B1-lite | None; cross-model debate at planning + implementation per durable rule |
| B3 (reviewer presets) | Demoted to examples-only | Zero (data, no loader) | N/A | W3 polish; `docs/examples/reviewer-presets/` | None |
| B4 (`code-oz doctor agentpacks`) | Deferred to v0.2 | Zero (validator) | N/A | v0.2 polish | B2 landed |
| Lead persona prompt enrichment from `feature-dev/code-architect.md` | Approved as content reuse | Zero | N/A | Standalone polish commit | None |
| Settings strict/lax/sandbox profiles (config-profile UX) | Deferred to v0.2 | Zero | N/A | v0.2 backlog | B2 landed |
| All other 10 patterns from `COMPARISON.md` §6 | Reject (unchanged) | — | — | — | — |

---

## 6. Status

- `COMPARISON.md` — pre-debate analysis preserved as historical record; one factual correction needed for §4.6 (track via §3.1 above).
- `CODEX_BRIEFING.md` — briefing preserved.
- `CODEX_RESPONSE.md` — Codex pushback captured verbatim.
- **`SYNTHESIS.md` — final post-debate decisions (this document).**

Ready to land the ROADMAP updates and the `COMPARISON.md` correction note when Ozzy gives the go. No code changes implied by this comparison cycle alone — the borrows fall into milestone slots that need their own design + cross-model debate at planning convergence per the durable rule.
