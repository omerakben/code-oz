# B5 — Agent metadata as typed planning annotations (borrow from agentic-canvas, Codex R1)

## Status

Backlog.

Target: v0.2 series, **separate milestone from B1+B2** (Rule 20 sub-surface count: B1+B2 alone is ≥6 sub-surfaces; bundling B5 would push to ≥9 in one milestone). B5 ships *after* B1+B2 in the v0.2 series; it touches artifact contracts (PLAN.md, SPEC.md) and is gate-neutral but is a distinct annotation authority, not a paired derived read-model.

**Critical: NON-AUTHORITATIVE.** This borrow does not loosen the M11 provider capability contract, does not introduce a new gate, does not feed budget enforcement, and does not block any phase. Annotations are advisory metadata consumed by viewers, summaries, and human reviewers.

**Relationship to B1.** B5 *consumes* B1 evidence indirectly (B4 viewer renders B5's `riskLevel` as a badge alongside B1 evidence claims; reviewer-panel synthesis ingests B5's `acceptanceCriteria[]` next to B1's `test_result` evidence). It does not co-author the same authority surface — that distinction is what keeps Rule 20 satisfied.

Codex round 1 surfaced this as a missed-borrow finding. References:

- `docs/comparisons/agentic-canvas/COMPARISON.md` § 3.5 — borrow framing and target milestone
- `docs/comparisons/agentic-canvas/CODEX_RESPONSE.md` § "Findings" — original Codex framing

The Codex framing is load-bearing: *"Agent metadata fields are useful if kept non-authoritative — `recommendedTools`, `riskLevel`, and `acceptanceCriteria` should not loosen M11 provider capability checks, but they map well to PLAN/SPEC/VIEW summaries."* The non-authority discipline is the only way this borrow is safe.

## Source pattern

agentic-canvas attaches an optional `agent` block to every node in the workflow DAG.

Schema location:

- `~/Projects/agents/templates/agentic-canvas/schemas/agent-canvas.schema.json` — `$defs.agent`, lines 124–166
- `~/Projects/agents/templates/agentic-canvas/SCHEMA.md` § "Agent Metadata", lines 31–44

The eight fields in the agentic-canvas `agent` block:

| Field                | Type             | Notes                                        |
|----------------------|------------------|----------------------------------------------|
| `role`               | string           | display name; collides with M12 in code-oz   |
| `intent`             | string           | free text; duplicates SPEC `## Goals`        |
| `inputs`             | string[]         | collides with PLAN `Files:` in code-oz       |
| `outputs`            | string[]         | collides with PLAN `Files:` in code-oz       |
| `acceptanceCriteria` | string[]         | structured planning vocab — borrow candidate |
| `recommendedTools`   | string[]         | advisory tool hints — borrow candidate       |
| `riskLevel`          | low / med / high | three-bin enum — borrow candidate            |
| `notes`              | string           | free text — borrow candidate                 |

All fields are optional. The schema is permissive (`additionalProperties: true`) — agentic-canvas plugins extend the block freely.

The agentic-canvas philosophy on this block is captured in their schema doc:

> "These fields are optional. Empty fields should not make the UI heavy or prevent simple workflows."

The block is never authoritative for execution — the agentic-canvas plugins (Claude Code skills, Codex skills) interpret these fields as hints for the agent, not as a contract the runtime enforces. That is exactly the discipline code-oz needs to copy: hints, not authority.

## Proposed shape in code-oz

A typed annotation block addable to `PLAN.md` and `SPEC.md` via YAML frontmatter (or, alternatively, a small JSON sidecar file — see open question 1). The sketch below uses frontmatter; semantics are identical for either physical layout.

```yaml
---
planning:
  acceptanceCriteria:
    - "Given a surname, the app produces five candidate given names."
    - "Each candidate is scored against the surname for syllable balance."
  recommendedTools:
    - "tool_use.repo_context.read"   # advisory, not authority
    - "tool_use.web.fetch"           # advisory, not authority
  riskLevel: medium
  notes: "Stress-pattern detection is heuristic; flag if scoring drift is observed."
---

# SPEC

## Goals
...
```

Field semantics, in detail:

**`acceptanceCriteria: string[]`**

Structured planning vocab that complements (does not replace) the existing `## Acceptance criteria` section in `SPEC.md` and the per-task acceptance reasoning in `PLAN.md`.

- Consumed by reviewer-panel synthesis to score verdict coverage
- Consumed by the §3.4 viewer (B4) to render acceptance status as a checklist
- The Markdown section remains the canonical human-readable surface
- The frontmatter list is the typed projection (mirroring B1's projection-not-gate-signal pattern)
- If frontmatter and Markdown disagree, Markdown wins (see anti-pattern 4)

**`recommendedTools: string[]`**

Advisory hints from the planner about which `tool_use` capabilities a downstream BUILD or VERIFY persona is expected to use.

- Strictly advisory
- The M11 provider capability contract authoritatively decides what tools a provider can call
- Surfacing recommended tools helps human reviewers spot planner-implementer drift
- Example: a task tagged `recommendedTools: ['tool_use.web.fetch']` assigned to a persona whose capability contract denies network access — the viewer flags this as an amber pill; the wrapper still denies the call. That is a planner mistake, not an authority loosening
- Recommended tool ids should match the `tool_use.*` namespace used in capability contracts (e.g., `tool_use.repo_context.read`, `tool_use.shell.exec`, `tool_use.web.fetch`); arbitrary strings are allowed but produce a less useful warning surface

**`riskLevel: "low" | "medium" | "high"`**

Three-bin enum advising downstream readers.

- Consumed by viewer badges (B4), reviewer-panel weighting suggestions, and human reviewers triaging where to spend attention
- **Not** a budget multiplier — Rule 19 keeps `budgets.global` as the single namespace
- **Not** a gate signal — Rule 1 keeps `GATE_<PHASE>_PASSED.json` as the only gate authority
- **Not** a debate-policy trigger today — open question 3 below proposes that any wiring into the M15 scheduler is a separate authority decision in a future milestone

**`notes: string`**

Free-text planner note, ≤ 500 chars. Longer notes go to a sidecar path mirroring B1 § Open question 1.

- Used for one-line caveats or rationale that does not fit the structured fields
- Example: `"Stress-pattern detection is heuristic; flag if scoring drift is observed."`
- Not consumed by any automated downstream — purely for human reviewers and viewers

The four fields above are the borrow's full shape. agentic-canvas's `role`, `intent`, `inputs`, `outputs` are intentionally dropped:

- **`role`** collides with M12 company-roster role naming, which is authoritative (per `docs/contracts/COMPANY.md`)
- **`intent`** duplicates SPEC `## Goals` and PLAN `## Goals` prose
- **`inputs` / `outputs`** collide with PLAN's `Files:` task-bullet grammar, which is authoritative for BUILD entry preflight (per `docs/contracts/PLAN.md` § "Files entry grammar (M8 extension)")

Borrowing those four would either contradict an authoritative contract or duplicate prose that already exists. The four kept fields (`acceptanceCriteria`, `recommendedTools`, `riskLevel`, `notes`) are the slice that adds vocabulary without conflict.

## What this is NOT (load-bearing)

The non-authority status is the only reason this borrow is safe. The following constraints are load-bearing — implementers and reviewers must enforce all of them.

**This is NOT the provider capability contract (M11).**

The capability contract is the authoritative source for what a provider may do. It lives at:

- `docs/contracts/PROVIDERS.md` § "Capabilities and eligibility (M11)"
- `docs/references/provider-contract.md` § "Capability and eligibility (M11)"

The capability contract owns: `ProviderCapability.eligiblePhases`, `authSource`, advisory `costPerMTok`, advisory `rateLimits`, plus the future `editSemantics` / `shellSemantics` / `mcpSupport` / `sandboxProfile` fields when they land in W3+.

`recommendedTools[]` is advisory metadata consumed by viewers and human reviewers. In any conflict, capability contract wins; the recommendation is silently dropped or surfaced as a warning. See § "Open: relationship to M11 capability contract" below for the precedence rule in full.

**`riskLevel` is NOT a budget multiplier.**

Rule 19 keeps cumulative caps under a single namespace (`budgets.global`):

- `maxTurns`
- `maxProviderCalls`
- `maxTokensEstimate`
- `maxWallTimeMinutes`
- optional `priceTable` for dollar telemetry

The wrapper's `assertWithinBudget` reads cumulative spend from `events.jsonl`, not from frontmatter. A future debate-policy heuristic *may* read `riskLevel` (open question 3), but that path goes through the M15 scheduler's existing config surface, not through the budget enforcer.

**`acceptanceCriteria[]` is structured planning vocab; it does NOT replace the existing prose.**

`SPEC.md` § "Acceptance criteria" and `PLAN.md` task-block reasoning remain canonical:

- Markdown bullets are the human-readable surface
- Frontmatter list is the typed projection that viewers and reviewer panels can index by
- If the frontmatter list is missing or malformed, the Markdown section still validates the gate
- If frontmatter and Markdown disagree, Markdown wins (see anti-pattern 4)

**Annotations are CONSUMED by viewers, summaries, and reviewers; they do NOT trigger gates or block phases.**

- No `gate-preflight.ts` check parses the planning annotation block
- A SPEC.md or PLAN.md without `planning:` frontmatter validates exactly as it does today (additive, optional)
- The implementing milestone's regression bar requires existing fixtures to continue passing without modification
- `state/gates.ts` is unchanged — gate file shapes do not gain a `planning` field

**Annotations are NOT a parallel-provider surface.**

Rule 21 forbids new multi-provider surfaces without measurable risk-reduction effect. Planning annotations are a single-provider authoring artifact:

- They do not add a second provider's surface
- They do not fan out (one PLAN, one author)
- They do not enter the reviewer panel as a separate vote
- They enter the panel only as content the panelists read

If a future milestone wants to compare two planners' annotations on the same task, that is a new authority decision under Rule 21 — not a property of this borrow.

## Where it lands

Specific files affected by the implementing milestone:

- **`docs/contracts/PLAN.md`** — add a new section, `## Planning annotations (optional)`, after `## Atomic write discipline` and before `## Approving PLAN.md`. The section documents the four fields, their semantics, the non-authority status, and the precedence rule against M11.
- **`docs/contracts/SPEC.md`** — add a parallel section, `## Planning annotations (optional)`, after `## Why explicit non-goals matter` and before `## Approving SPEC.md`. Same four fields, same non-authority constraints. Consistency between PLAN and SPEC is enforced by the canonical-doc-precedence-chain rule (memory: `feedback_canonical_doc_precedence_chain.md`).
- **`docs/contracts/PLANNING_ANNOTATIONS.md` (new)** — short canonical contract for the annotation block (one page, similar shape to `docs/contracts/SCIENTIST.md`). Referenced from PLAN.md, SPEC.md, and the §3.4 viewer doc when it lands. Contains the four field definitions, the non-authority constraints, the precedence rule against M11, and the anti-pattern list.
- **`src/state/schemas.ts`** — optional typed schema (`PlanningAnnotation` interface) so parsers can produce a typed projection from frontmatter or sidecar JSON. Not required for v1 of the borrow if the implementing milestone keeps the projection prose-only. The interface lives next to (not paired with) B1's `EvidenceClaim` types — both are projection-only schema additions, but they belong to separate milestones (B1+B2 first, B5 after).
- **`src/artifacts/plan.ts` and `src/artifacts/spec.ts`** — optional parser extensions that surface the typed projection alongside the existing Markdown parse output. Existing parsers must accept both `planning:` frontmatter present and absent without behavior change for gate writes.
- **`docs/references/spec-contract.md`** — pinned reference is updated to mention the optional frontmatter block. Not authoritative for parser semantics; that lives in `PLANNING_ANNOTATIONS.md`.

`src/phases/gate-preflight.ts` is **not** modified. `state/gates.ts` is **not** modified. The annotation block is invisible to gate authority by construction.

## Consumers

Three downstream surfaces benefit from the typed projection. None of them depend on the projection — every consumer must continue to function if `planning:` is absent.

**B4 read-only viewer (`code-oz view <runId>`)**

- Renders `riskLevel` as a visual badge (low = grey, medium = amber, high = red)
- Surfaces `acceptanceCriteria[]` as a checklist beside the canonical `## Acceptance criteria` section
- Flags `recommendedTools[]` mismatches against the loaded persona's capability contract as warnings (not errors)
- Renders `notes` as a one-line caveat on the task header
- Falls back to a "no annotations" empty state when `planning:` is absent — never errors

**Reviewer panel synthesis (M14 + B1 follow-up)**

- Picks up `acceptanceCriteria[]` to score whether each criterion is addressed in the panelist's REVIEW.md draft
- The synthesizer aggregates per-panelist coverage and emits a coverage table in the canonical `REVIEW.md`
- The canonical REVIEW.md cites which acceptance criteria were addressed and which were not, and by which panelist
- The panel's verdict score remains computed by the existing M14 rubric — B5 widens the input vocabulary, not the rubric
- A future M14 revision *may* tighten the score formula to require structured criterion coverage, but that change is its own authority decision (see open question 6)

**Skill wrappers (B3 marketplace presence)**

- Claude Code skill and Codex CLI skill both wrap the `code-oz` binary
- Display planning annotations in `code-oz status` summary output
- Surface `riskLevel` as a one-line risk pill in the status output
- Surface `acceptanceCriteria[]` count as part of the run summary
- Marketplace wrappers do not bypass the binary — they read the annotation block via the same parsers that the viewer and reviewer panel use
- Wrappers are read-only consumers; they never write annotations back

## Why this is borrow-now-not-borrow-later

Two paragraphs.

PLAN and SPEC artifacts already encode this metadata informally. SPEC.md `## Acceptance criteria` is a bullet list that humans read; PLAN.md task blocks already carry per-task `Risk:` and `Validation:` bullets that imply a risk level and recommended tools. Lifting the implicit content into a typed annotation block does three things at once: it gives the §3.4 viewer something semantic to render beyond raw Markdown, it gives the reviewer-panel synthesizer typed input vocabulary to score acceptance coverage against, and it aligns code-oz's planning shape with agentic-canvas's vocabulary so a future canvas-as-frontend-to-runtime integration (the §3.4 step-2 hypothesis) can read the same fields without a translation layer. The cost is one new short contract doc plus four small frontmatter parsers — additive in every consumer.

Critically, the non-authority status means the borrow does **not** cost Rule 20 authority. There is no new gate. There is no new capability domain. There is no new budget surface. There is no new parallel-provider surface. The Rule 20 sub-surface count (per `feedback_rule20_sharper_application.md`) is small: PLAN contract revision, SPEC contract revision, the new `PLANNING_ANNOTATIONS.md` doc, and an optional schema addition — five sub-surfaces under one logical authority (typed planning vocabulary), with no gate consequence. The implementing milestone is **B5 alone** — separate from B1+B2 (which ship in v0.2 milestone A). Bundling B5 with B1+B2 would push the sub-surface count to ~11 in one milestone, which violates Rule 20 sharper application; B5 depends on B1's evidence schema being shipped first (B4 viewer renders B5's `riskLevel` next to B1 evidence claims; reviewer-panel synthesis ingests B5's `acceptanceCriteria[]` next to B1's `test_result`), but dependency is not pairing.

## Cost estimate

Sub-surfaces touched (counted per Rule 20 sharper application):

1. `docs/contracts/PLAN.md` — new optional section, schema reference
2. `docs/contracts/SPEC.md` — new optional section, schema reference
3. `docs/contracts/PLANNING_ANNOTATIONS.md` — new canonical contract (one page)
4. `src/state/schemas.ts` — optional `PlanningAnnotation` interface (depends on B1's `EvidenceClaim` schema being available; same file, separate milestone)
5. `src/artifacts/plan.ts` and `src/artifacts/spec.ts` — frontmatter parser extensions

Five sub-surfaces under one logical authority (typed planning vocabulary, gate-neutral). Estimated commits: 2–4. C1 = `PLANNING_ANNOTATIONS.md` + schema interface. C2 = PLAN.md + SPEC.md contract revisions. C3 = parser extensions in `src/artifacts/`. Optional C4 = test fixtures verifying that present-and-absent frontmatter both validate.

Test count delta: ~30–50 unit tests (frontmatter parse, schema roundtrip, present-and-absent regression, malformed-frontmatter graceful degradation, capability-contract precedence enforcement when `recommendedTools[]` conflicts with the loaded persona).

Risk profile: low if non-authority discipline is enforced at every consumer; medium if scope-creeps into authority. The dominant risk is `recommendedTools[]` drifting into a parallel capability surface (anti-pattern 1 below). The mitigating discipline is precedence enforcement at the parser layer plus an explicit anti-pattern test (acceptance criteria below).

The borrow depends on B1 (`EvidenceClaim`) being shipped first but is **not** paired with B1 in the same milestone. Both are gate-neutral and projection-only, but Rule 20 sub-surface counting forbids bundling them: B1 alone is six sub-surfaces, B5 is five, and a combined milestone would be eleven sub-surfaces under two distinct logical authorities (typed evidence projection + typed planning vocabulary). The right ordering is v0.2 milestone A (B1+B2) followed by v0.2 milestone B (B5) — see `INDEX.md` "Pairing & ordering."

## Rule check

Each non-negotiable rule is checked one line at a time. Compatibility status is the load-bearing column.

**Rule 7 — artifact contracts in plain Markdown:** compatible.

- The Markdown body of PLAN.md and SPEC.md remains the canonical artifact
- Annotations live in YAML frontmatter — a Markdown convention, not a JSON serialization of the artifact body
- Existing artifacts continue to validate without modification (regression bar)

**Rule 11 — NEEDS_INTERVENTION.json schema:** compatible.

- Annotations are not consumed by the intervention writer
- A future enhancement might surface `riskLevel` in intervention payloads as an advisory hint, but that is out of scope for B5

**Rule 15 — epistemic sidecars at phase gates:** compatible.

- `HYPOTHESES.md` and `OPEN_QUESTIONS.md` remain separate, mandatory, and gate-blocking
- The Scientist tail (per `docs/contracts/SCIENTIST.md`) is unchanged
- Planning annotations are an additional, optional, gate-neutral channel — they do not overlap with the Scientist tail and do not relax its preflight check
- An overdue open question still blocks the gate; a missing or malformed `planning:` block does not

**Rule 19 — run-level budget enforcement:** compatible.

- `budgets.global` remains the single budget namespace
- `riskLevel` is advisory; it does not feed the wrapper's `assertWithinBudget`
- Soft-warn at 0.75 and hard-kill at 1.0 still read cumulative spend from `events.jsonl`
- If a future debate-policy heuristic reads `riskLevel`, it does so via the M15 scheduler's existing config surface, not via budget mutation

**Rule 20 — one new authority per milestone:** compatible.

- The borrow introduces no new gate, no new capability domain, no new budget surface, no new parallel-provider surface
- Five sub-surfaces touched under one logical authority (typed planning vocabulary, projection-only)
- The implementing milestone is B5 alone (no other authority changes), and ships *after* the B1+B2 v0.2 milestone — never bundled with it
- Sub-surface count is the metric per `feedback_rule20_sharper_application.md`; B5's five sub-surfaces under one authority is well under the bundled-authority threshold, but adding B1's six sub-surfaces would push to eleven and violate the rule

**Rule 21 — no new parallel-provider surface without measurable risk-reduction:** compatible.

- Planning annotations are a single-provider authoring artifact
- They do not add a second provider's surface, do not fan out, do not enter the panel as a separate vote
- The Agentless caution applies and is satisfied by construction — no new agent / no new provider / no new fan-out

**M11 capability contract — NOT loosened:** compatible-by-design.

- `recommendedTools[]` is advisory; the capability contract is authoritative
- Precedence rule documented in § "Open: relationship to M11 capability contract" below
- The borrow exists *because* M11 is strict — the planning annotation gives planners a place to record intent without diluting the contract
- An anti-pattern test (anti-pattern 1) enforces this at the parser layer

## Open questions

1. **YAML frontmatter or sibling JSON sidecar?** Frontmatter integrates with existing Markdown tooling and is invisible to consumers that ignore it; a sidecar file (`PLAN.planning.json`) is easier to consume programmatically and avoids YAML-vs-Markdown parsing complexity. Proposed default: **frontmatter**, with a sidecar emit as a future enhancement if a consumer needs the typed projection without parsing Markdown. Codex-round-2 candidate.
2. **How do we prevent `recommendedTools[]` from drifting into a parallel capability surface (and thus violating Rule 20)?** The risk is real — once a planner writes `recommendedTools: ['tool_use.web.fetch']`, a future implementer may be tempted to enforce the recommendation. Proposed default: parser layer rejects any attempt to read `recommendedTools[]` as authority. Concretely, an anti-pattern test verifies that capability checks consult only `ProviderCapability`, not the annotation block. Tested at PR-review time; documented in `PLANNING_ANNOTATIONS.md` § Anti-patterns.
3. **Does `riskLevel` feed into the M15 debate-policy scheduler heuristics, or is that a separate authority?** The scheduler currently fires on cost, disagreement, and risk triggers (per `docs/contracts/DEBATE_POLICY.md`). The "risk" trigger today reads from canonical phase artifacts, not from frontmatter. Proposed default: **separate authority** — if M15 wants to consume `riskLevel`, that wiring lands as a separate decision in a future milestone after the borrow has stabilized. Premature wiring would re-bundle authorities (Rule 20).
4. **Backward compat: do existing PLAN.md and SPEC.md without annotations validate?** Proposed default: yes, by construction. The annotation block is optional. Existing fixtures must continue to validate without modification; the implementing milestone's regression bar enforces this.
5. **Schema versioning: does the annotation block need its own minor-version bump?** The artifact contracts (`spec-contract.md`, plan-contract M6 placeholder) carry implicit version semantics. Proposed default: bump the artifact contract minor version when the annotation block is introduced (`spec-contract.md` v0.1 → v0.2 with the new optional section), but keep the gate file `schemaVersion` stable since gate authority is unchanged.
6. **Reviewer panel synthesis: how does `acceptanceCriteria[]` tie back to the canonical REVIEW.md verdict score?** The M14 panel rubric scores per-criterion coverage today via natural-language matching. Proposed default for v1 of the borrow: synthesizer reads `acceptanceCriteria[]` as input vocabulary; verdict score formula remains M14's existing rubric. A future M14 revision *may* tighten the score formula to require structured criterion coverage, but that change is its own authority decision, not part of B5.

## Anti-pattern to avoid

Four anti-patterns are load-bearing for the non-authority discipline. Each ships with a corresponding red-test in the implementing milestone's acceptance criteria.

**Anti-pattern 1: letting `recommendedTools[]` override (or even shadow) the M11 capability contract.**

- Temptation: when a persona's capability contract denies a tool that the planner recommended, an implementer wires the recommendation into the wrapper to "respect the planner's intent" and grants the tool
- Why this is unsafe: silently re-introduces the provider drift problem the comparison report's §4.1 already rejected
- Discipline: capability contract wins always; `recommendedTools[]` mismatches surface as warnings, never overrides
- Red-test: an anti-pattern test verifies that capability checks consult only `ProviderCapability`, not the annotation block

**Anti-pattern 2: using `riskLevel` as a budget multiplier.**

- Temptation: a high-risk task gets a larger token budget; a low-risk task gets a smaller one
- Why this is unsafe: violates Rule 19's single-namespace budget surface; puts runtime budget enforcement at the mercy of planner intent rather than the wrapper's cumulative-spend ledger
- Discipline: `budgets.global` is the only namespace; `riskLevel` is advisory metadata for human reviewers and viewers, never a multiplier
- Red-test: an anti-pattern test verifies that `assertWithinBudget` reads cumulative spend from `events.jsonl` only, never from frontmatter

**Anti-pattern 3: adding new fields to one contract but not the other.**

- Temptation: a future borrow extension adds `riskRationale` to PLAN.md but not SPEC.md, or vice versa
- Why this is unsafe: violates the canonical-doc-precedence-chain rule (memory: `feedback_canonical_doc_precedence_chain.md`); creates drift between sibling contracts
- Discipline: every field addition lands in PLAN.md, SPEC.md, and `PLANNING_ANNOTATIONS.md` in the same commit
- Red-test: the implementing milestone's review checklist enforces parity; a contract-parity test compares the field set in PLAN.md against the field set in SPEC.md and fails when they diverge

**Anti-pattern 4: trusting frontmatter over Markdown when the two disagree.**

- Temptation: the parser is structured and easy to consume, so a future implementer prefers it over the prose section
- Why this is unsafe: the Markdown body is the canonical artifact (Rule 7); frontmatter is a typed projection. Trusting the projection over the source inverts the contract
- Discipline: when frontmatter and Markdown disagree, Markdown wins. The parser surfaces a warning; the gate consumes the Markdown; the viewer renders the discrepancy as a flag for human reviewers
- Red-test: a fixture with disagreeing frontmatter and Markdown verifies that the gate writer reads the Markdown section and ignores the frontmatter when computing artifact identity

## Acceptance criteria for the implementing milestone

- [ ] `docs/contracts/PLANNING_ANNOTATIONS.md` exists as the canonical contract for the annotation block (one page, similar shape to `docs/contracts/SCIENTIST.md`).
- [ ] `docs/contracts/PLAN.md` adds an optional `## Planning annotations (optional)` section that defines the four fields and points to `PLANNING_ANNOTATIONS.md`.
- [ ] `docs/contracts/SPEC.md` adds a parallel optional `## Planning annotations (optional)` section. Field set is identical to PLAN.md (parity enforced by review checklist).
- [ ] `src/state/schemas.ts` exports a `PlanningAnnotation` interface with the four fields. (Lives next to B1's `EvidenceClaim` types — same file, separate milestone.)
- [ ] `src/artifacts/plan.ts` and `src/artifacts/spec.ts` parse the optional frontmatter block when present and ignore it gracefully when absent. Both parsers continue to produce valid PLAN/SPEC parse output for existing fixtures without modification.
- [ ] All existing PLAN.md and SPEC.md fixtures continue to validate. The borrow is additive; no fixture migration is required.
- [ ] B4 viewer (when it lands) renders `riskLevel` as a visual badge. (If B4 has not yet landed when B5 ships, this acceptance criterion is deferred to B4's milestone, with a note in `B4_VIEWER.md`.)
- [ ] Reviewer panel synthesizer documentation (`docs/contracts/REVIEW_PANEL.md`) notes that `acceptanceCriteria[]` is available as typed input vocabulary, and that the existing M14 rubric scores remain authoritative. The handoff is documented; deeper integration is deferred to a follow-up M14 revision.
- [ ] `docs/contracts/PROVIDERS.md` (M11) is **explicitly unchanged**. The implementing milestone's review checklist verifies that no field, no enum, no precedence statement was modified in PROVIDERS.md. The annotation block sits adjacent to the capability contract, never inside it.
- [ ] An anti-pattern test verifies that **wrapper / provider preflight** consults only `ProviderCapability` and rejects any attempt to read `recommendedTools[]` as authority at load-time and invoke-time. The test fails (red) if a future change wires the annotation into capability enforcement. (Codex R2 finding: parser-layer enforcement alone is insufficient; runtime preflight is where authority gets decided.)
- [ ] An anti-pattern test verifies that **reviewer-panel synthesis** flags `recommendedTools[]` mismatches in the canonical `REVIEW.md` draft but does **not** treat the annotation as additive evidence in the verdict-score computation. The existing M14 rubric remains the only score input; `recommendedTools[]` widens the input vocabulary, not the rubric. The test fails (red) if a future change folds annotation matches into the verdict score.
- [ ] An anti-pattern test verifies that `assertWithinBudget` reads cumulative spend from `events.jsonl` only, never from `riskLevel`. The test fails (red) if a future change wires the annotation into budget enforcement.
- [ ] An invariance test verifies that runs with and without `planning:` frontmatter produce identical gate outcomes (same `GATE_*_PASSED.json` content, same `events.jsonl` event sequence) for an otherwise-identical scenario. The annotation is gate-neutral; this test enforces it.
- [ ] Codex round-1 debate completed before implementation; Codex round-2 review completed before tag, both per the cross-model peer review rule.
- [ ] B5 ships as its own milestone, **after** the v0.2 milestone A that ships B1+B2; no other authority domain bundled. Sub-surface count is verified at review time via the cost-estimate table above.

## Open: relationship to M11 capability contract

The relationship between `recommendedTools[]` and the M11 provider capability contract is the single most load-bearing constraint in this borrow. It deserves explicit precedence prose, both in this stub and (when the borrow lands) in `PLANNING_ANNOTATIONS.md`.

`recommendedTools[]` is the planner's answer to *"what tools would help the downstream BUILD or VERIFY persona accomplish this task?"* It is forward-looking, written by the Lead persona during PLAN, and carries no enforcement authority. The capability contract — `ProviderCapability.eligiblePhases`, `authSource`, `costPerMTok`, `rateLimits`, plus the future `editSemantics` / `shellSemantics` / `mcpSupport` / `sandboxProfile` fields when they land in W3+ — is the runtime's answer to *"what can this provider actually do?"* It is enforced at agent-load time (M11 added load-time eligibility checks) and at invoke time (wrapper preflight). The two answers can disagree; the disagreement is informative for human reviewers but never authoritative for the runtime.

The precedence rule, in full: when `recommendedTools[]` lists a tool that the loaded persona's capability contract denies, the runtime ignores the recommendation and the wrapper does not grant the tool. The viewer surfaces this as a warning (badge or amber pill, consumer's choice). The reviewer panel may flag the mismatch in its REVIEW.md draft as evidence of planner-implementer drift. None of this changes the wrapper's behavior — the capability contract is the only thing the wrapper consults. Implementing the borrow without this precedence rule baked into the parser layer would silently re-introduce the provider-drift problem M11 was designed to close, and would convert a low-risk projection into a high-risk parallel authority. That is the trap Codex flagged in round 1; the precedence rule and the anti-pattern test in the acceptance criteria above are the two mitigations that keep the borrow safe.
