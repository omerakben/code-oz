# Codex implementation review — refactor session 2026-05-01

**Thread:** 019de514-0165-7eb3-8512-1eb9e8a645c3 (continuation of the planning round)
**Date:** 2026-05-01
**Model:** gpt-5.5 xhigh, sandbox: read-only
**Commits reviewed:** 531c28a, 5f09dc7, 3657e50, be9c0ed, 8e4a259 (5 ahead of origin/main).

> **Post-review status (added after this round):** the audit's F1 (`agentic-coder` provenance) was **withdrawn** when Ozzy removed the folder in question from `~/Projects/agents/templates/` before push. Commit 7 (`chore(provenance): drop leaked-source warnings (templates cleaned)`) lands on top of this review's `push` verdict and reverts the CLAUDE.md exclusion paragraph commit 1 added. Codex's verdict + the synthesis below are preserved verbatim for audit completeness.

## Verdict
push

## Block-push findings
None.

## Fix-soon findings
None.

## Nits
[CLAUDE.md](../../CLAUDE.md) line 9 slightly over-compresses the M12 boundary with "per-role budgets and permissions defer to M13+." The more precise wording is the ROADMAP shape: budgets defer to M13; permissions stay persona-shaped. I would not hold the handoff for this because [docs/design/ROADMAP.md:376](../design/ROADMAP.md) and [docs/contracts/COMPANY.md:160](../contracts/COMPANY.md) are clear.

[docs/research/REFACTOR_AUDIT_2026-05-01.md:165](./REFACTOR_AUDIT_2026-05-01.md) says validation was after commit 4. That is technically fine because commit 5 is docs-only, but "after runtime/docs-surface commits" would read cleaner. Not worth another commit by itself.

## FYI
The provenance rule in [CLAUDE.md:68](../../CLAUDE.md) captures path B correctly. "Regardless of folder name" plus named examples closes the relabel escape hatch. `.gitignore`'s "Session-launch prompts" label for `TODO.md` is reasonable.

The blank-model fix landed across the right three layers: persona schema, company config, and event-log validation. Error codes stay layer-correct: `schema_invalid_value`, `config_invalid_value`, and `event_invalid_value`. `trim()` is present in all changed validators. Null is rejected by the same non-string branch; undefined remains omission. I do not see a need to validate broader model format in this session.

The COMPANY wording now says the real behavior: config-current, not snapshotted. The non-atomic config-write race is stated plainly and deferred to writer-side atomic-save discipline, which is the right scope.

The research artifacts are appropriate to commit. The briefing is a one-use artifact, but it is referenced by the response and audit, and this repo already preserves debate/review provenance as research docs.

No PE-1, M13, M14, M15, or M16+ implementation scope leaked in. `agent_invoked.model` validation only rejects malformed known event data; it does not add a panel surface or change M13 cost semantics.

Validation I ran here: `bun run typecheck` passed, `bun test tests/agents-schema.test.ts` passed 40/0, and a direct `bun -e` smoke test confirmed blank persona/event models reject. `tests/state-events.test.ts` could not run in this read-only sandbox because `mkdtemp` is blocked with `EPERM`; I'm relying on your full local `bun test` result for the temp-dir suites.

## Where I disagree
No substantive disagreement. The implementation follows the planning synthesis.

## Recommended next step
Keep this local-only state as the clean refactor handoff. No follow-up commit is required before Ozzy decides whether to tag, push, or proceed into PE-1 planning.

---

## Synthesis (Claude, 2026-05-01)

**Verdict absorbed:** push, with both nits closed in a single follow-up commit (`docs(refactor): close Codex implementation-review nits`) per the project's no-debt-at-handoff discipline. Codex explicitly said "would not hold the handoff" / "Not worth another commit by itself," but nit #1 is an accuracy fix (permissions are persona-shaped *by design*, not "deferred to M13+"), so closing it costs nothing and reads correctly.

### Final commit chain (6 commits ahead of origin/main)

```
[follow-up] docs(refactor): close Codex implementation-review nits
8e4a259 docs(refactor): commit inter-milestone research artifacts
be9c0ed docs(refactor): tighten v0.12.0-alpha.0 status surfaces
3657e50 docs(refactor): clarify config-current resume routing in COMPANY.md
5f09dc7 feat(agents): reject blank model bindings across schema/config/events
531c28a chore(provenance): hard-exclude leaked-source relabels
```

### What this means for the handoff

- All 10 audit findings have a recorded outcome (closed in commits 1–4 + 6, or deferred in the tech-debt register with explicit Codex concurrence).
- 1923 pass / 1 skip / 0 fail; typecheck clean.
- No push, no tag, no PR. Ozzy decides next step (tag refactor as `v0.12.0-alpha.1`, defer until PE-1 ships, or proceed straight to PE-1 planning).
