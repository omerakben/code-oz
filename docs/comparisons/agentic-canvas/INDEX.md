# agentic-canvas comparison — file index

> Quick navigation for the agentic-canvas comparison + followup bundle. The action list lives in `COMPARISON.md` §7; this index maps each action to its deliverable.

## Reading order

1. `COMPARISON.md` — the verdict, framing, ten code-oz wins, five borrows, three rejects + one split, action list (§7).
2. `CODEX_RESPONSE.md` — round 1 raw Codex peer review (verdict: `agree-with-modifications`, 5 fix-first, 2 fyi, 1 nit). All findings integrated into `COMPARISON.md`.
3. Deliverable docs (any order — they're independent specs):
   - `B1_EVIDENCE_CLAIM.md`
   - `B2_RUN_SUMMARY.md`
   - `B3_SKILL_WRAPPERS.md`
   - `B4_VIEWER.md`
   - `B5_PLANNING_ANNOTATIONS.md`
   - `CANVAS_FRONTEND_HYPOTHESIS.md`
4. `CODEX_RESPONSE_R2.md` — round 2 raw Codex peer review on the deliverable bundle.
5. `DOC_ROT_BACKLOG.md` — ticket file for action 1 deferral (Codex R1+R2 finding); captures stale-doc evidence so a future close-out session can fix `CLAUDE.md` + thesis without re-deriving it.

## Action → deliverable map

| Action (`COMPARISON.md` §7) | Status | Deliverable |
|---|---|---|
| 1. Doc-rot fix (`CLAUDE.md` line 9 + `THESIS.md` M9/M10 framing) | Deferred (ticket filed) | `DOC_ROT_BACKLOG.md` in this folder captures the evidence + proposed fix scope. Out of scope for this comparison session per Codex R1+R2 (R2 required a concrete ticket file rather than just a deferral note). Target: next milestone close-out checklist. |
| 2. EvidenceClaim + RunSummary backlog | Specced | `B1_EVIDENCE_CLAIM.md`, `B2_RUN_SUMMARY.md` |
| 3. Skill-wrapper promotion to W3.x strategic | Specced | `B3_SKILL_WRAPPERS.md` |
| 4. Viewer step 1 (`code-oz view <runId>`) | Specced | `B4_VIEWER.md` |
| 5. Canvas-as-frontend hypothesis | Tracked (not committed) | `CANVAS_FRONTEND_HYPOTHESIS.md` |
| 6. Agent-metadata-as-planning-annotations | Specced | `B5_PLANNING_ANNOTATIONS.md` |
| 7. Re-run comparison post-W3 | Pending trigger | Tracked in `CANVAS_FRONTEND_HYPOTHESIS.md` periodic-review-cadence section. |

## Pairing & ordering

- **v0.2 milestone A — derived read-models (B1 + B2):** typed evidence + derived run-summary, both gate-neutral additive schemas. Sub-surface count ~6, paired under one authority (derived projection).
- **v0.2 milestone B — planning annotations (B5):** ships *after* milestone A. Distinct authority (annotation layer over PLAN/SPEC); bundling with A would push sub-surface count to ~9 and violate Rule 20.
- **W3.x strategic:** B3 (skill wrappers). Consumes B2's `RunSummary` for `code-oz status` output.
- **v0.3+:** B4 viewer (consumes both B1 and B2; needs milestone A shipped first).
- **No milestone:** `CANVAS_FRONTEND_HYPOTHESIS.md` (tracker only; activates on measurable trigger criteria).

## Scope discipline

- All deliverables live under `docs/comparisons/agentic-canvas/`. No writes to `docs/research/` or other shared folders to avoid merge conflicts with parallel template-comparison sessions (codegraph, gptme, learn-harness-engineering, ace, archon, aris, agent-skills, byterover-cli, claude-coder, etc., all running in their own worktrees).
- No code patches in this bundle. Spec stubs only — TypeScript-like sketches are illustrative.
- No vendoring of agentic-canvas code. Patterns borrowed; no submodules; no copy-paste. Per CLAUDE.md influence-library rule.

## Codex round trail

| Round | Date | Verdict | Findings | File |
|---|---|---|---|---|
| R1 | 2026-05-10 | `agree-with-modifications` | 5 fix-first, 2 fyi, 1 nit | `CODEX_RESPONSE.md` |
| R2 | 2026-05-10 | `fix-first` | 5 fix-first, 3 nit, 1 fyi | `CODEX_RESPONSE_R2.md` |
| R3 | 2026-05-10 | `fix-first` | 1 blocking (B4 internal) | `CODEX_ROUND_TRAIL.md` |
| R4 | 2026-05-10 | `fix-first` | 1 blocking (cross-doc paired-language) | `CODEX_ROUND_TRAIL.md` |
| R5 | 2026-05-10 | `fix-first` | 2 (1 intentional, 1 section-ref) | `CODEX_ROUND_TRAIL.md` |
| R6 | 2026-05-10 | `agree-with-modifications` | 2 section-ref nits | `CODEX_ROUND_TRAIL.md` |
| R7 | 2026-05-10 | **`agree-push`** | 0 — PR-ready | `CODEX_ROUND_TRAIL.md` |

The session targets `agree-push` on R2 (or later) before the PR ships, per Ozzy's "100% satisfaction" bar.
