# Codex peer review round 2 — agentic-canvas comparison followup deliverables

> **Round 2 — raw response.** Captured 2026-05-10. Model: `gpt-5.5` xhigh, sandbox read-only.
> Thread: `019e1327-e7ee-7841-b985-143546d2a475`. Bundle reviewed: COMPARISON.md + INDEX.md + B1–B5 + CANVAS_FRONTEND_HYPOTHESIS.md (post-cross-doc-review fixes).

## 1. Verdict

`fix-first`

Direction is right. I would not push this bundle unchanged because there are still cross-doc contradictions from the R1 integration, especially B5 milestone ordering and the hypothesis file path.

## 2. Findings

**[fix-first] [cross-doc-drift] B5 still says it ships with B1** — `INDEX.md:32-35` and `B5_PLANNING_ANNOTATIONS.md:5-8` say B5 ships after B1+B2 as its own v0.2 milestone. But B5 later says the implementing milestone should be "only B1 + B5" at `B5_PLANNING_ANNOTATIONS.md:222`, `:240`, `:275`, and `:346`. That directly contradicts the stated R1 fix. Patch all residual "paired with B1" language to "depends on B1/B2 being shipped or available."

**[fix-first] [cross-doc-drift] Hypothesis tracker path points outside the bundle** — The actual file is `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md`, and `INDEX.md:40` says this bundle avoids `docs/research/`. But `COMPARISON.md:131`, `COMPARISON.md:196`, `B2_RUN_SUMMARY.md:148`, `B4_VIEWER.md:5`, and `B4_VIEWER.md:162` point to `docs/research/CANVAS_FRONTEND_HYPOTHESIS.md`. This breaks namespace isolation and future-reader navigation.

**[fix-first] [rule-20-violation] B4's Rule 20 defense is too broad as written** — The "one authority because read-only" argument is mostly honest for a basic viewer, but B4 currently includes HTTP server, config schema, taxonomy mapping, evidence-kind rendering, SSE, shutdown, and file/diff lazy rendering across eight sub-surfaces at `B4_VIEWER.md:96-110`. `B4_VIEWER.md:124` also says the milestone bundles B4+B2, while `INDEX.md:35` says B4 consumes B2 after milestone A ships. Patch B4 to require already-shipped B2, and either trim step 1 to core viewer or split rich taxonomy/evidence rendering into B4b.

**[fix-first] [open-question-load-bearing] Canvas activation criteria are calibrated to almost never fire** — `CANVAS_FRONTEND_HYPOTHESIS.md:92-99` requires at least three of six signals, with both signals 1 and 2 mandatory. For v0.2-v0.3 user volume, requiring ≥5 friction reports and ≥3 abandonment/reset reports likely keeps the hypothesis dormant even if viewer users explicitly ask for edit affordances. Use "2 of 6, including at least one post-viewer or edit-specific signal" or lower the early-user thresholds.

**[fix-first] [authority-creep] B5 needs runtime enforcement, not parser-layer enforcement only** — B5 correctly states the risk at `B5_PLANNING_ANNOTATIONS.md:293-295` and `:348-354`, but "parser layer rejects any attempt to read `recommendedTools[]` as authority" is not enforceable by a parser alone. The parser can emit advisory metadata; only wrapper/provider preflight and reviewer-panel synthesis tests can prove it does not affect permissions or scoring. Add acceptance checks that capability enforcement consults only `ProviderCapability`, and reviewer synthesis may flag mismatches but must not treat `recommendedTools[]` as additive evidence for the verdict score.

**[nit] [open-question-load-bearing] RunSummary version coupling needs a v1.0 rule** — B2 defines `RunSummary.version: 1` at `B2_RUN_SUMMARY.md:24-25`, while `B3_SKILL_WRAPPERS.md:246-258` mixes binary semver, strict alpha/beta pinning, and exact `RunSummary.version` checks. This is fine pre-1.0, but ambiguous once caret versioning starts. State the release rule explicitly: skills may use binary caret ranges after v1.0, but must still accept only compatible `RunSummary` schema major versions and ignore additive optional fields.

**[nit] [coverage-gap] Action 1 says "file as backlog ticket," but no ticket exists** — `COMPARISON.md:192` and `INDEX.md:22` defer the `CLAUDE.md` plus thesis doc-rot fix as a backlog ticket. The bundle contains no actual ticket file, so future readers must re-derive the stale-doc evidence from the comparison. Add `DOC_ROT_BACKLOG.md` in this folder or make `INDEX.md` contain a concrete backlog entry with paths, current stale lines, and target close-out checklist owner.

**[nit] [doc-rot] COMPARISON still says no second round is needed** — `COMPARISON.md:229` says "No second round of Codex review is needed," while `INDEX.md:16` and `INDEX.md:48-49` explicitly reserve `CODEX_RESPONSE_R2.md`. After this review, that line becomes false. Patch the appendix to say R2 was requested and captured.

**[fyi] [coverage-gap] B1 sidecar is the right call, but citations need fallback text** — `B1_EVIDENCE_CLAIM.md:84` and `:127-128` correctly choose a sidecar, and `:97` says missing sidecars do not affect gates. That does not violate Rule 7 because Markdown remains the inter-phase artifact. But `B1_EVIDENCE_CLAIM.md:85` lets REVIEW cite sidecar path + index, so add a rule that every sidecar citation must degrade to a human-readable Markdown reference when the sidecar is absent.

## 3. Specific pressure tests

A. B4 Rule 20: not pure rationalization, but overextended. I would not split solely into "dispatcher" and "taxonomy" if taxonomy stays display-only. I would split or defer B4b if rich evidence rendering includes lazy file/diff reads, because that is more than a minimal viewer.

B. B1 sidecar: sidecar is the right call. A reader with only `VERIFY.md` should still understand and validate the artifact; what breaks is dedupe, UI rendering, and optional REVIEW citation precision. Add fallback citation rules.

C. B2/B3 version coupling: correct in alpha/beta, unclear at v1.0. Binary semver and `RunSummary.version` need separate compatibility rules.

D. Hypothesis triggers: too high and too restrictive. Requiring both user-friction signals makes activation unlikely with early cohorts.

E. B5 non-authority defense: conceptually right, enforcement point incomplete. Parser warning is useful, but runtime provider checks and reviewer-panel scoring invariants must also be tested.

F. Action 1 deferral: deferral is acceptable, but only if the bundle ships a concrete local backlog ticket.

G. Merge conflict risk: filesystem namespace isolation holds. The broken part is the text pointing to `docs/research/`; do not touch `docs/research/`, `docs/comparison/NN-template/`, or sibling comparison folders.

## 4. Recommended next actions

1. Patch all `docs/research/CANVAS_FRONTEND_HYPOTHESIS.md` references to `docs/comparisons/agentic-canvas/CANVAS_FRONTEND_HYPOTHESIS.md` or a local relative path.
2. Patch B5 residual "B1 + B5" pairing language so B5 is consistently separate after B1+B2.
3. Patch B4 to require B2 as a prior dependency, then either trim rich rendering from step 1 or split it into B4b.
4. Recalibrate hypothesis activation to a realistic early-user rule.
5. Add B5 runtime/provider and reviewer-panel invariance acceptance tests.
6. Add `DOC_ROT_BACKLOG.md` in this folder, or expand `INDEX.md` into a concrete backlog ticket.
7. Patch B3's v1.0 compatibility rule and B1's sidecar citation fallback.
8. Update `COMPARISON.md:229` after saving this R2 response.

## 5. One disagreement held back

I almost pushed for `debate-required` on B4 because local HTTP viewers tend to accrete write endpoints, auth shortcuts, and file-serving exceptions. I held back because the read-only, loopback-only, no-runtime-install constraints are strong enough if the current B4 scope is trimmed before push.
