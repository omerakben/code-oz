---
session: 1000-star plan R0-revision-3-cleanup review
thread: 019e1c94→019e1cda→019e1d48→019e1d5b→019e1d68→this
model: gpt-5.5
reasoning-effort: xhigh
sandbox: workspace-write
verdict: revise-again-cleanup
plan-under-review: docs/planning/1000_STAR_PLAN.md
prior-verdicts: R0, R0-revision, R0-revision-2, R0-revision-3
---

# Codex R0-revision-3-cleanup response - 1000-star plan

## Verdict line

Verdict: revise-again-cleanup. The substantive R0-revision-3 plan remains approval-worthy, and the core cleanup landed in the normative sections. Approval is still blocked by literal stale-text residue in the bottom appendix and two active document-identity residues. This is a cleanup-only blocker, not a scope or strategy rejection.

## Cleanup verification

### 1. Bottom appendix rewrite

Status: mostly landed, but not clean under the requested whole-file stale-text grep.

The active appendix header is now `Codex R0-revision-3 request (this doc)` at `docs/planning/1000_STAR_PLAN.md:453`, and it no longer asks the reviewer to return `revise-again-2` as the current verdict.

However, the rewritten appendix still contains the stale literal phrases it was supposed to remove:

- `docs/planning/1000_STAR_PLAN.md:459` says the old block asked for `revise-again-2`.
- `docs/planning/1000_STAR_PLAN.md:459` says the old block described the simultaneous C1 failure shape.
- `docs/planning/1000_STAR_PLAN.md:459` contains `$50/$30 hard cap` framing.

These are meta descriptions of the prior bad text, not current operational claims. Still, the cleanup ask explicitly requested an entire-file search for stale text, and this line makes the grep fail.

### 2. Rule-16 grep scope sync

Status: closed.

All three live locations now include both research and planning artifact scopes, and all three frame the mechanism as best-effort guardrails rather than authorship proof:

- `docs/planning/1000_STAR_PLAN.md:34` includes `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, `docs/planning/CODEX_*`, and `docs/planning/CLAUDE_*`.
- `docs/planning/1000_STAR_PLAN.md:192` repeats the same scope in the Phase 2.1 mechanism.
- `docs/planning/1000_STAR_PLAN.md:231` repeats the same scope in the Phase 2 risk row.
- `docs/planning/1000_STAR_PLAN.md:440` repeats the same scope in locked decision #12.

I also checked for `docs/research/CODEX_*` / `docs/research/CLAUDE_*` lines missing the planning scope; there were no hits.

### 3. Cross-phase risk row reframing

Status: normatively closed, but the old exact phrase remains in the appendix.

The active cross-phase risk row is now token-budget based: `docs/planning/1000_STAR_PLAN.md:398` says multi-round REVIEW hits `budgets.global.maxTokensEstimate` warning twice, with dollar tracking advisory only and no dollar kill switch in code. This is consistent with the frontmatter budget ceiling, Phase 2 risk row, and locked decision #14.

The old exact stale phrase still appears in the appendix as a meta description: `docs/planning/1000_STAR_PLAN.md:463` says the row was reframed away from "Multi-round REVIEW exceeds $30". That is not an active risk trigger, but it fails the requested whole-file search for `Multi-round REVIEW exceeds $30`.

### 4. Document identity

Status: partial.

The requested direct identity changes landed:

- Frontmatter status begins with `REVISED-3` at `docs/planning/1000_STAR_PLAN.md:3`.
- The closure section header is `R0-revision-3 closures` at `docs/planning/1000_STAR_PLAN.md:26`.
- The appendix header is `Codex R0-revision-3 request` at `docs/planning/1000_STAR_PLAN.md:453`.

Two active residues remain:

- `docs/planning/1000_STAR_PLAN.md:3` still says `pending R0-revision-3 verdict + Ozzy final approval`, even though the R0-revision-3 verdict already exists and this is the cleanup review.
- `docs/planning/1000_STAR_PLAN.md:428` still says `Locked (Option D choice + R0-revision-2)`.

These are low-risk, but they are active document-identity text, not only historical chain context.

## Stale-text grep

Results from targeted searches over `docs/planning/1000_STAR_PLAN.md`:

| Search | Result |
|---|---|
| `hard cap` | Hit at line 459, appendix meta text |
| `$30 hard` | Hit at line 459 via `$50/$30 hard cap` |
| `$50 hard` | No exact hit |
| `R0-revision-2 closures` | Hit at line 465, appendix meta text |
| `Codex R0-revision-2 request` | Hit at line 465, appendix meta text |
| `Multi-round REVIEW exceeds $30` | Hit at line 463, appendix meta text |
| rule-16 grep scope mentioning only `docs/research/` | No hits |
| `MUST fail today` / simultaneous `(a) ... AND (b)` C1 claim | No hits |

The remaining hits are not substantive contradictions, but they do violate the cleanup pass's literal stale-text removal standard.

## New issues introduced by cleanup

1. Block-cleanup: The appendix summarizes old stale text using the same forbidden strings. Replace line 459 with neutral wording such as "the previous bottom-of-doc request block is replaced with this cleanup summary" and line 463 with "old dollar-overrun wording".

2. Low: Frontmatter still says the file is pending the R0-revision-3 verdict. It should say pending R0-revision-3-cleanup verdict plus Ozzy final approval, or simply pending Ozzy final approval after cleanup approval.

3. Low: `### Locked (Option D choice + R0-revision-2)` still reads like the current lock set belongs to R0-revision-2. Rename it to `### Locked (Option D choice + R0-revision-3-cleanup)` or just `### Locked`.

No new substantive plan issues were introduced by this cleanup pass.

## Revised probability

Current document, with cleanup gate still blocked: P(1000 stars at 90d) = 8-11%.

After the string-level cleanup above, with no M17 scope expansion: P(1000 stars at 90d) = 8-12%. The substantive plan already earned that range in R0-revision-3; the remaining blockers are document hygiene and approval-gate clarity.
