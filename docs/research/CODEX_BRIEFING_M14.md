# Briefing — M14 Reviewer panel v1

**Brief date:** 2026-05-02
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule (planning convergence) + ROADMAP.md line 379 ("M14 ... subject to its own pre-implementation Codex debate")
**Prior context (load order):**
- `docs/design/ROADMAP.md` lines 374-388 (post-M10 productization sequence)
- `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` (principle 11, post-M10 placement table, open question 3)
- `docs/research/CODEX_RESPONSE_PRODUCT_THESIS.md` (thread `019de031` — origin of rules 20+21; pinned authority-laundering warning under "Risks the thesis misses")
- `CLAUDE.md` non-negotiable rules 1, 2, 6, 7, 13, 19, 20, 21
- `docs/contracts/REVIEW.md` (single-reviewer M9 baseline)
- `src/phases/review.ts` (M9 orchestrator), `src/artifacts/review-report.ts` (M9 schema), `src/providers/capabilities.ts` (M11 contract), `src/providers/cost.ts` (M13 budgets), `src/providers/families.ts` (cross-family taxonomy)
- Memories `pe1_progress.md`, `m13_progress.md`, `cleanup_session_2026-05-02_evening.md` (current state)

---

## 1. Goal

Ship M14 as the **first simultaneous-provider surface** in `code-oz`: extend the M9 single-reviewer REVIEW phase to support a panel of reviewers with cross-family quorum, same-family-advisory enforcement, and orchestrator-owned synthesis. Land as `v0.15.0-alpha.0` after Codex review verdict `push`.

The product north star this milestone serves (per `AI_SOFTWARE_COMPANY_THESIS.md` principle 11 + CLAUDE.md rule 21): **no parallel-provider surface lands without measurable risk reduction in `events.jsonl` against the single-reviewer baseline.** M14 must define and instrument that measurement before shipping, not after.

---

## 2. Non-negotiable constraints (locked, NOT debatable)

These are pinned by prior thread `019de031` (product thesis pressure-test) + ROADMAP line 379 + CLAUDE.md. Codex MUST treat them as load-bearing in the response; deviation requires a full debate.

### 2.1 Authority-laundering prohibition (Codex's own pinned warning)

> "A panel with one same-family reviewer and one cross-family reviewer must not let the same-family reviewer satisfy rule 2 by majority vote. Same-family reviewers can be advisory only; cross-family quorum must be explicit."

Implication: **same-family reviewers are excluded from quorum computation by *construction*, not by configuration.** A user cannot accidentally create a panel where the same-family reviewer's vote enables `verdict: ready`. The orchestrator's canonical verdict computation rejects same-family votes from the cross-family quorum count.

### 2.2 Rule-20 — one new authority boundary per milestone

M14's authority boundary is **panel quorum + cross-family enforcement + synthesis authority** (orchestrator-owned). Everything else is bundling and must be explicitly out-of-scope:
- NO automatic-trigger policy for panels (that is M15's `Debate-policy scheduler` shape)
- NO multi-opponent debate (deferred to M16+)
- NO parallel builder candidates (deferred to M16+ pending security wedge trigger)
- NO new persona roles (Synthesizer-as-persona is bundling; mechanical orchestrator synthesis is the M14 shape)
- NO new gate (panel still writes to `GATE_REVIEW_PASSED.json`)

### 2.3 Rule-21 — measurable risk reduction is the ship gate

Without a defined `events.jsonl` measurement that demonstrates panel-vs-single risk reduction, M14 does not ship. The measurement must:
- Be deterministic (computable from `events.jsonl` alone, no live-provider variance)
- Compare panel-mode vs single-mode on the same FakeProvider fixtures
- Surface as `code-oz doctor --panel-baseline` or equivalent CLI command

Recommended baseline metrics (Codex pressure-test these):
- **Finding-rate delta**: panel raises ≥X% more unique findings than single-reviewer on the same fixture set
- **Cross-family disagreement events**: count of `review_panel_disagreement` events where the panel surfaced a finding the single-reviewer baseline missed
- **Authority-laundering attempt rejections**: count of `panel_quorum_rejected_same_family_vote` events (proves the construction guarantee fires)

### 2.4 Orchestrator-owned verdict (M8 lesson, M9 reaffirmed)

Panelists score findings; **orchestrator computes the canonical panel verdict** by applying a fixed rule. Persona prompts cannot author the panel verdict directly. This pattern is locked from M8 (persona-authored binary verdicts rejected) and M9 (verdict from `computeCanonicalVerdict()`).

### 2.5 File-based gate signals only (rule 1)

Panel verdict still writes to `GATE_REVIEW_PASSED.json` via the same schema-validated path. No new gate file. Panel state lives entirely inside `REVIEW.md` (extended schema) + `events.jsonl` (extended event types).

### 2.6 Cross-family check layered enforcement (M9 pattern)

M9 enforces cross-family at three layers: load-time (loader), invocation-time (review.ts adapter family check), post-condition (`Reviewer.Cross-family check: passed`). M14 adds a **fourth layer**: quorum-time (verdict computation rejects same-family votes from quorum count). All four must agree; mismatch is `NEEDS_INTERVENTION`.

### 2.7 No new parallel-provider surface beyond REVIEW (rule 21 application)

Why REVIEW first (per Codex's original recommendation): "REVIEW already has the tightest artifact grammar and measurable baseline." The M14 design must NOT generalize the parallel-provider primitive into a reusable phase mechanism in v1; it is REVIEW-specific. Generalization is a future authority boundary.

### 2.8 Panel is opt-in for v0.1; single-reviewer remains default

Default config maps `reviewer:` to a single provider (M12 baseline). Panel mode requires explicit `reviewer.panel: [...]` config under the `company:` block. New users get single-reviewer behavior unchanged.

---

## 3. Recommended plan (Claude's draft for Codex pressure-test)

### 3.1 Commit sequence (one authority slice per commit)

| # | Commit subject | Authority slice |
|---|---|---|
| 1 | `docs(contracts/review-panel): panel grammar + quorum semantics + same-family advisory rule` | Contract surface only — no runtime change. Documents the shape `reviewer.panel: [{provider, role: voter\|advisory}]`, the quorum rule (k-of-N cross-family voters required for `ready`), the same-family-advisory enforcement, and the REVIEW.md schema extension. |
| 2 | `feat(config/company): panel config schema + loader validation + same-family-vote rejection` | Config-time enforcement only. `parseCompanyConfig` accepts `reviewer.panel: [...]`; loader rejects panels where same-family providers are listed as `voter`. Tests: schema accept/reject, error messages. No runtime invocation yet. |
| 3 | `feat(artifacts/review-report): multi-reviewer schema + per-reviewer Reviewer blocks + Synthesis block` | Schema extension + serializer/parser. `parseReviewReport` round-trips multi-reviewer artifact. Single-reviewer existing path untouched (back-compat). Tests: round-trip both shapes, malformed panel rejection. |
| 4 | `feat(state/events): review_panel_started + review_panel_completed + review_panel_disagreement + panel_quorum_rejected_same_family_vote events` | Event taxonomy extension. New event types validated by `events.ts`. Tests: emit + replay each event type. No invocation yet. |
| 5 | `feat(phases/review-panel): panel orchestrator + sequential reviewer invocation + canonical verdict computation` | Runtime authority. New file `src/phases/review-panel.ts` exports `runReviewPanel(opts)`. M9 `runReview` delegates when `panel.length > 1`; otherwise existing single-reviewer path runs unchanged. Canonical verdict rule (orchestrator-owned, per §4.1 below). Tests: panel runs sequentially via FakeProvider, all four cross-family check layers fire, same-family-advisory votes are excluded from quorum. |
| 6 | `feat(providers/cost): per-panel preflight aggregate + per-reviewer budget attribution + panel-cost-warn event` | Budget integration. Preflight estimate sums all panelist costs before any panelist invokes. Per-role budget (M13) gates per-reviewer; aggregate panel cost gates the whole panel. New `panel_cost_warn` event at `softWarnAtRatio`. Tests: aggregate gate fires, per-reviewer attribution preserved. |
| 7 | `feat(doctor): panel-baseline measurement command + events.jsonl summarizer` | Rule-21 ship gate. `code-oz doctor --panel-baseline <fixture>` runs same fixture in single-mode then panel-mode and emits a markdown report comparing finding rate, cross-family disagreement count, authority-laundering rejection count. Tests: measurement reproducible across runs, non-zero deltas on the M14 fixture. |
| 8 | `test(e2e/review-panel): full panel round on review-lite fixture + panel-vs-single risk-reduction proof` | E2E proof. New fixture `tests/fixtures/review-panel-baseline/` runs the same baby-name fixture from M9 with panel `[claude-fake-reviewer-A, codex-fake-reviewer-B]`. Asserts: panel raises ≥1 finding single-mode missed; cross-family quorum reaches `ready` only on cross-family agreement; same-family-vote panel attempt rejected at config-load. |
| 9 | `docs(roadmap,thesis): mark M14 closed + record measurement deltas + update memory` | Doc + memory update. ROADMAP M14 row marked closed; thesis post-M10 table updated; `now.md` + new memory `m14_progress.md`. |

**Test target:** 2222 carrying + ~80-100 new = ~2300-2320 pass / 0 fail / 1 skip.

**Tag:** `v0.15.0-alpha.0` after Codex review verdict `push`.

### 3.2 File surface

**New files:**
- `src/phases/review-panel.ts` — panel orchestrator (~400 LOC est.)
- `docs/contracts/REVIEW_PANEL.md` — panel grammar + semantics (~300 lines)
- `tests/fixtures/review-panel-baseline/` — fixture for measurement
- `tests/review-panel-orchestrator.test.ts`
- `tests/review-panel-canonical-verdict.test.ts`
- `tests/review-panel-same-family-advisory.test.ts`
- `tests/review-panel-cross-family-quorum.test.ts`
- `tests/review-panel-cost-aggregate.test.ts`
- `tests/review-panel-config-validation.test.ts`
- `tests/review-panel-events.test.ts`
- `tests/e2e/review-panel-baseline.test.ts`
- `src/cli/doctor-panel-baseline.ts` — measurement command

**Modified files:**
- `src/artifacts/review-report.ts` — schema extension (multi-reviewer Reviewers block + Synthesis block)
- `src/phases/review.ts` — delegation point to `review-panel.ts` when panel size > 1
- `src/config/company.ts` — `reviewer.panel: [...]` schema
- `src/providers/cost.ts` — aggregate panel preflight
- `src/state/events.ts` + `src/state/schemas.ts` — new event types
- `docs/contracts/REVIEW.md` — link to REVIEW_PANEL.md, document panel-mode delegation
- `docs/design/ROADMAP.md` — M14 closure
- `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` — panel role row updated

---

## 4. Locked design choices (Claude's draft — Codex MUST pressure-test these)

These are decisions I'm proposing in the draft. Codex should treat each as a hypothesis and either confirm with reasoning or push back with an alternative.

### 4.1 Canonical panel verdict rule (orchestrator-owned)

```
Inputs:
  - reviewers: array of { providerFamily, role: 'voter'|'advisory', score, verdict }
  - findings: union of all reviewers' findings (deduped by fingerprint(file, title))

Rule:
  1. If any finding (from voter or advisory) is severity='block' AND unresolved:
     → panel verdict = 'block'

  2. Else if any finding (from voter or advisory) is severity='fix-first' AND unresolved:
     → panel verdict = 'needs-revision'

  3. Else compute quorum:
     a. Filter reviewers to role='voter' (advisory excluded)
     b. Filter remaining to those with familyOf(buildFamily) ≠ familyOf(reviewerFamily) (same-family voters excluded)
     c. Require: at least 2 cross-family voters AND all of them have score ≥ 6 AND verdict='ready'
     → if quorum met: panel verdict = 'ready'
     → if quorum not met: panel verdict = 'needs-revision'

Outputs:
  - panel verdict: 'ready' | 'needs-revision' | 'block'
  - synthesis block: union findings, attributed to source reviewer(s), dedup by fingerprint
  - quorum reason: human-readable (e.g., "cross-family quorum reached: 2 of 2 voters from {codex, gemini}")
```

**Rationale:** Findings are inclusive (any voter or advisory raises a block, it blocks); but ready-vote authority is exclusive (only cross-family voters count). Same-family advisory can flag bugs but cannot bless a release.

**Pressure-test:** Is "≥ 2 cross-family voters" the right floor? Or should it be configurable (k-of-N)? What about a 3-reviewer panel where one is same-family advisory + one claude voter + one codex voter — does the single cross-family voter satisfy quorum? Default proposal: NO (≥ 2 required). Configurable via `reviewer.panel.quorum: { minCrossFamilyVoters: 2 }`?

### 4.2 Findings deduplication strategy

Use M9's existing `fingerprintFinding(file, title)` unchanged. Two reviewers raising the same bug get **one** F-NNN id; the synthesis block records `Sources: [reviewer-A, reviewer-B]`. Per-reviewer Reviewer blocks still record their own scoring of that finding.

**Rationale:** M9's ping-pong fingerprint already handles cross-round dedup; cross-reviewer dedup is the same problem at a different axis. Keeping fingerprint stable also preserves the M9 ping-pong-cap ratchet.

**Pressure-test:** Does dedup hide useful disagreement signal? E.g., if claude-reviewer says "this is fix-first" and codex-reviewer says "this is block" on the same finding — current rule is "take strictest severity." Should we instead surface the disagreement as a separate event for measurement?

### 4.3 Sequential vs parallel panelist invocation

**Default M14 shape: sequential.** Panelists invoked one after another, each reviewer sees a fresh provider context (no cross-pollination). Reasoning: simpler, deterministic, debuggable, FakeProvider-friendly. Parallel invocation is a future optimization.

**Pressure-test:** Sequential adds latency. Is parallel worth the complexity for v1? My read: no, because (a) FakeProvider testing is the validation surface for v0.1, and (b) parallel invocation adds atomic-resume complexity that's bundling.

### 4.4 Round-cap with panel

**Proposal: collective panel cap.** A "panel round" = one full pass through all panelists. Cap at 4 panel rounds (matches M9's per-(runId, taskId) cap). Each panelist within a round gets one invocation. Repair-draft logic from M9 (1 retry on validation fail) preserved per-panelist.

**Pressure-test:** Does the round cap need to be lower for panel mode (e.g., 3) since each round costs ~Nx more? Or is the existing 4 fine because BUILD-attempt cap is the real budget bound?

### 4.5 Worktree lifecycle through panel

**Proposal: unchanged from M9.** Worktree preserved through entire panel; removed only at panel-`ready` exit (orchestrator's canonical verdict). All panelists see the same worktree state.

**Pressure-test:** What about partial-completion resume? If reviewer 2 of 3 completes then process dies — does the resume re-run reviewer 1+2 or pick up at reviewer 3? Proposal: per-panelist atomic write to `REVIEW.md` (each panelist's block appended atomically); resume picks up at first missing panelist. Probe `probeReviewResume` extended to validate panel-partial.

### 4.6 REVIEW.md multi-reviewer schema

```yaml
# REVIEW.md (panel mode)
Round: 1
Reviewers:
  - id: reviewer-A
    providerFamily: codex
    providerId: codex
    modelPolicy: gpt-5.5
    role: voter
    score: 8
    verdict: ready
    crossFamilyCheck: passed
    buildFamily: claude
  - id: reviewer-B
    providerFamily: gemini
    providerId: gemini
    modelPolicy: gemini-2.5-pro
    role: voter
    score: 7
    verdict: ready
    crossFamilyCheck: passed
    buildFamily: claude
  - id: reviewer-C
    providerFamily: claude
    providerId: claude
    modelPolicy: claude-opus-4-7
    role: advisory
    score: 9
    verdict: ready
    crossFamilyCheck: same-family (advisory only)
    buildFamily: claude

Synthesis:
  panelVerdict: ready
  quorumReason: "cross-family quorum reached: 2 of 2 voters from {codex, gemini}"
  uniqueFindingsByReviewer: { reviewer-A: 2, reviewer-B: 3, reviewer-C: 1 }
  sharedFindings: 1  # raised by ≥2 reviewers (fingerprint match)

Findings:
  - id: F-001
    title: "Missing null check on user input"
    file: src/handler.ts
    line: 42
    severity: fix-first
    sources: [reviewer-A, reviewer-B]
    recommendation: "Add explicit null guard"
    roundRaised: 1
    roundResolved: unresolved
  ...
```

**Single-reviewer mode preserved:** When `reviewer.panel` is absent or has 1 entry, the existing M9 single-`Reviewer:` block schema is used (no `Reviewers:` plural, no `Synthesis:` block). Both shapes round-trip via the same parser.

**Pressure-test:** Is it worth keeping two schemas (singular + plural) or migrate everything to plural-with-1-element? My instinct: keep both for back-compat (M9 fixtures + tests stay valid), but confirm.

### 4.7 Rule-21 measurement specifics

Three event-derived metrics that prove panel reduces risk:

```
1. unique_findings_delta(panel, single):
     count of findings raised by panel that single-reviewer fixture missed
     measured: count(F where source ∈ panel-only) on same fixture run twice

2. cross_family_disagreement_count:
     count of review_panel_disagreement events
     fires when cross-family voters disagree on severity or verdict for same finding

3. same_family_vote_rejection_count:
     count of panel_quorum_rejected_same_family_vote events
     proves construction guarantee fires (positive control: if NOT firing on
     a same-family-only panel attempt, the construction is broken)
```

Ship gate: on the M14 baseline fixture, panel must show `unique_findings_delta > 0` AND `cross_family_disagreement_count >= 1` AND `same_family_vote_rejection_count >= 1` (the latter via a deliberate same-family-vote attempt fixture that gets rejected at config-load).

**Pressure-test:** Are these the right three? What about false-positive rate (findings panel raises that get rejected on remediation as unfounded)? Or do we measure that in M16+?

### 4.8 What's NOT in M14 (defer list)

Per rule 20, explicitly out:
- Automatic-trigger policy for panels (M15)
- Multi-opponent debate (M16+)
- Parallel builder candidates (M16+)
- Synthesizer-as-persona (M16+ if mechanical synthesis proves insufficient)
- Generalized parallel-provider primitive across phases (M16+)
- Researcher phase-tail (M16+)
- Panel for VERIFY phase (M16+; deterministic runner is the v0.1 verifier)
- Cross-family check enforcement at any layer beyond REVIEW (BUILD stays single-builder; PLAN stays single-Lead)

---

## 5. Open questions for Codex (debate prompts)

Codex MUST answer each of these directly. Vague verdicts ("looks fine") are insufficient — give a recommendation with reasoning.

### Q1. Authority-laundering construction proof

The construction guarantee (§2.1, §4.1) says same-family voters cannot satisfy cross-family quorum. The implementation in §4.1 step 3b filters them out. **Is filter-at-quorum-time enough, or do we need filter-at-config-load (§3.1 commit 2)?** I propose BOTH: config-load rejects panels where same-family providers are configured as `voter` (early rejection); quorum-time filter is a defense-in-depth backstop. Defend or push back.

### Q2. Quorum floor — fixed 2 or configurable k-of-N

§4.1 proposes fixed `minCrossFamilyVoters: 2`. This rejects 1-voter-only panels (which would be authority-laundering by construction since one voter cannot represent cross-family disagreement). It also rejects 0-voter panels (only advisory). But it allows 3+ voter panels. **Is fixed-2 the right floor for v1, or should it be `Math.ceil(crossFamilyVoters / 2)` or fully configurable from the start?** Configurable adds knob complexity; fixed-2 may be wrong for asymmetric panels.

### Q3. Findings dedup vs disagreement signal

§4.2 deduplicates by `fingerprint(file, title)` — same M9 rule. But this **discards the disagreement signal** that two reviewers may have rated the same finding differently (e.g., claude says fix-first, codex says block). The current proposal takes "strictest severity wins." **Should we instead emit a `review_panel_severity_disagreement` event when two reviewers rate the same fingerprint differently, even if the canonical verdict still uses strictest?** Useful for rule-21 measurement and for surfacing real cross-model bias.

### Q4. Sequential vs parallel — is parallel actually bundling

§4.3 proposes sequential. But the thesis sells "simultaneous-provider surface." **Does sequential undermine the marketing claim?** Or is "simultaneous" satisfied by the *result* (multiple reviewers contributing to one verdict) regardless of invocation order? I lean: sequential is fine because the thesis principle is about discipline, not about literal wall-clock parallelism. But this may be a positioning bug.

### Q5. Round-cap reduction for panel

§4.4 proposes keeping the 4-round cap unchanged. But each panel round costs ~Nx more provider calls than a single-reviewer round. **Does the round-cap need to scale down inversely with panel size (e.g., `floor(4 / panelSize)`) to prevent runaway cost?** Or is the per-role budget (M13) sufficient cost gate?

### Q6. Cost preflight aggregate semantics

§3.1 commit 6 proposes summing all panelist preflight estimates before any panelist invokes. But panelists may have different `costPerMTok`. **Should the preflight gate be (a) "if aggregate exceeds budget, refuse the whole panel before any call" or (b) "invoke panelists in order, refuse the next panelist if running aggregate would exceed budget"?** (a) is stricter and avoids partial-panel artifacts; (b) is more useful (you get N-1 reviewers worth of value if budget tight). I lean (a) for simplicity. Defend or push back.

### Q7. Same-family-advisory: useful or noise

§4.1 includes same-family advisory reviewers in finding aggregation (their findings can raise blocks). **Is there a real use case for same-family advisory reviewers, or is it bundling that should be cut?** Argument for keeping: a claude-reviewer reviewing claude-built code may catch things a codex-reviewer misses (different prompt sensitivity). Argument against: rule 2 says cross-family for a reason; same-family review re-introduces the bias rule 2 mitigates. **My instinct: keep advisory but cut "blocking" power — same-family reviewers can raise findings as `nit` or `fyi` only, not `fix-first` or `block`.**

### Q8. Rule-21 measurement: are the three metrics enough

§4.7 proposes three metrics. **Are they sufficient to satisfy rule 21's "measurable risk reduction in events.jsonl"?** What's missing? E.g., per-reviewer score variance, panel-mode wall-clock latency overhead, panel-mode cost overhead per task.

### Q9. Panel resume semantics

§4.5 proposes per-panelist atomic write + resume picks up at first missing panelist. **Does this preserve the M9 ping-pong fingerprint discipline?** If reviewer 1 raised F-001 and reviewer 2 (post-resume) raises a different fingerprint for the same bug, fingerprint dedup fails. Is this a real risk or theoretical?

### Q10. v0.1 default — single-reviewer or panel

§2.8 says single-reviewer remains default. But the product thesis sells panel as the differentiator. **Is single-reviewer-default-with-panel-opt-in the right v0.1 shape, or should we ship panel-default with single-reviewer as a downgrade?** Trade-off: default-panel = stronger marketing claim + higher token cost for new users; default-single = lower friction + panel as power-user mode.

### Q11. Authority bundling check

Look at the §3.1 commit list against rule 20. **Am I bundling anything?** Specifically:
- Commit 5 introduces panel orchestrator AND canonical verdict rule. Is canonical-verdict-rule a separate authority that should be its own commit?
- Commit 6 adds three new event types. Are they all M14-essential or is `review_panel_disagreement` actually M14.5?
- Commit 7 (doctor measurement command) — is this rule-21 ship-gate work or M14.5 polish?

### Q12. Anything else load-bearing I missed

Open prompt: what does the brief miss that would block M14 or surface a bug six months from now? Specifically interested in: privacy/manifest interactions with multi-provider preview (rule 13), event ordering invariants under panel mode, interaction with M10 `requestDebate()` if a panelist invokes debate during review (currently impossible per `tool_use.debate` permission scope, but worth confirming).

---

## 6. Anti-patterns to reject explicitly

If Codex's response includes any of these, that's a failure of the briefing — push back hard.

1. **"Add a Synthesizer persona"** — bundling, violates rule 20.
2. **"Make panel the default"** — see Q10; if Codex pushes for this without addressing the cost story, reject.
3. **"Generalize the parallel-provider primitive"** — out of scope per §2.7.
4. **"Add per-axis scoring (the 5-axis stuff from M9 NOT-in-scope)"** — explicitly deferred to M16+ axis-metrics work.
5. **"Replace the fingerprint dedup"** — breaks M9 ping-pong ratchet.
6. **"Skip the Codex review round before tagging"** — violates CLAUDE.md cross-model peer review rule.
7. **"Defer the rule-21 measurement to a follow-up"** — rule 21 IS the ship gate; deferring it ships an unsubstantiated claim.

---

## 7. Acceptance criteria (Codex's verdict will be measured against these)

Codex's response is acceptable if it:
- ✅ Answers all 12 open questions (Q1-Q12) directly with a recommendation + reasoning, not just "looks fine"
- ✅ Explicitly addresses authority-laundering construction (Q1 + §2.1) — confirms or pushes back on the dual-layer enforcement (config-load + quorum-time)
- ✅ Confirms or pushes back on the §3.1 commit sequence with rule-20 lens (no bundling)
- ✅ Confirms or pushes back on the §4.7 rule-21 measurement metrics — must give a yes/no on whether they satisfy the rule
- ✅ Flags any anti-pattern from §6 if it surfaces in their reasoning
- ✅ Identifies at least one risk or bug Claude's draft missed (because if the draft is perfect, Codex isn't earning its keep)

Verdict types Codex can return:
- `accept-as-is` — Claude's draft holds; proceed to implementation
- `accept-with-modifications` — Claude's draft is directionally right but specific decisions need adjustment (list them)
- `reject-and-redesign` — fundamental issue; M14 needs different shape (justify with reasoning)

---

## 8. Codex configuration

```toml
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
sandbox = "read-only"
approval_policy = "never"
```

Per CLAUDE.md cross-model peer review rule § "Codex model fallback": `gpt-5.5-codex` and `gpt-5.1-codex-max` do NOT work on Ozzy's account; fall back to `gpt-5.5` if invoked variant fails. xhigh effort is set in `~/.codex/config.toml` defaults; explicitly pass in this debate to be sure.

---

## End of brief
