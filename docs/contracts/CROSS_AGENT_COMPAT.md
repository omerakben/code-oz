---
name: cross-agent compatibility (AGENTS.md as pointer)
companion-docs: ../../CLAUDE.md (single source of truth), ../../AGENTS.md (the existing pointer file)
target: any agent tool that does not read CLAUDE.md (Cursor, Codex CLI, generic agents); cross-tool ecosystem compatibility
status: convention — already deployed; this doc codifies the shape so future contributors don't break it
source: existing `/Users/ozzy-mac/Projects/code-oz/AGENTS.md` (8 lines, last modified 2026-04-30); Codex Q9 in `docs/comparison/07-learn-harness-engineering/CODEX_RESPONSE.md`
---

# CROSS_AGENT_COMPAT.md — AGENTS.md as pointer file

## 1. The pattern

Code-oz uses a two-file shape at the repository root for agent orientation:

- **`CLAUDE.md`** — canonical project orientation. Single source of truth. All non-negotiable rules, architecture locks, working conventions, and milestone cadence live here. Claude Code reads this file directly.
- **`AGENTS.md`** — one-line pointer to `CLAUDE.md`. Plus 1-2 sentences telling the agent to read `CLAUDE.md` first. Nothing else. Cursor, Codex CLI, and most generic agent tools read this file.

The pointer file is checked in. It is small, stable, and zero-drift. It does not duplicate `CLAUDE.md` content; it routes the reader to it.

This pattern is **already deployed** in code-oz. This document codifies the shape so future contributors do not break it by inflating `AGENTS.md` into a content duplicate.

## 2. Why a pointer, not a duplicate

The original COMPARISON.md for the `learn-harness-engineering` sweep (session 07) initially rejected the AGENTS.md + CLAUDE.md split as "duplication." Codex flipped the verdict (Q9 in `CODEX_RESPONSE.md`): code-oz already has the right shape, and the right shape is *pointer*, not *duplicate*.

The reasoning:

- **Single source of truth.** Changes land in `CLAUDE.md` only. There is exactly one place to update non-negotiable rules, milestone cadence, or working conventions. Drift between the two files is structurally impossible because `AGENTS.md` carries no content to drift from.
- **Cross-tool reach.** Cursor, Codex CLI, and many generic-agent tools scan for `AGENTS.md` at the repo root. A pointer file gives those tools a working entry point without forking the project's instructions.
- **Zero maintenance overhead.** The pointer file is 5-8 lines. It rarely needs editing. Compare against the maintenance cost of keeping two prose files in sync — that cost is real, escalates with project size, and is exactly the maintenance trap the original comparison rightly flagged.
- **Avoids the duplication anti-pattern.** Content duplication across two top-level instruction files is the failure mode behind every "the rules say X but the README says Y" debugging session. The pointer pattern eliminates the failure mode by construction.

The original comparison's instinct (reject duplication) was correct; the missed step was recognizing that code-oz had already solved it the right way. Codex's flip restores the right verdict: borrow-modified, where the modification is "this is already done; document it so it stays done."

## 3. The pointer file shape (canonical example)

The existing `/Users/ozzy-mac/Projects/code-oz/AGENTS.md` is the canonical example. Verbatim:

```markdown
# AGENTS.md — code-oz

This file is a pointer for Codex sessions. The canonical project orientation, non-negotiable rules, architecture locks, working conventions, and milestone cadence live in [`CLAUDE.md`](./CLAUDE.md).

Read `CLAUDE.md` first. Then `docs/design/ROADMAP.md` for the milestone plan.

The two files are kept in sync by treating CLAUDE.md as the single source of truth: changes land there, and this file remains a one-line pointer to avoid drift.
```

Annotated:

| Line | Function |
|------|----------|
| `# AGENTS.md — code-oz` | Title. Identifies the file. |
| `This file is a pointer for Codex sessions. The canonical project orientation... live in [CLAUDE.md](./CLAUDE.md).` | **Pointer line.** Names the canonical file and links to it. The link is relative so the pointer survives repo relocations. |
| `Read CLAUDE.md first. Then docs/design/ROADMAP.md for the milestone plan.` | **First-read instruction line.** Tells the agent the *order* of reads. Two files; nothing more. Resists scope creep. |
| `The two files are kept in sync by treating CLAUDE.md as the single source of truth: changes land there, and this file remains a one-line pointer to avoid drift.` | **Sync-policy line.** Documents the rule that prevents future contributors from inflating this file. This is the line that makes the pattern self-defending. |

The sync-policy line is the load-bearing one. Without it, a well-meaning contributor will eventually copy a paragraph from `CLAUDE.md` into `AGENTS.md` to "make it more useful for Codex sessions," and the duplication anti-pattern reappears. Preserve the sync-policy line in any future edit.

## 4. When NOT to use a pointer

Two cases, in escalating order:

1. **A second pointer file is fine.** Adding `WINDSURF.md`, `CURSOR.md`, or any other tool-specific orientation file is acceptable as long as each one is a thin pointer to `CLAUDE.md`, not a content duplicate. The pattern scales: one canonical file plus N pointers, each 5-8 lines, each carrying the same sync-policy line.

2. **Inflating a pointer is the last resort.** If a tool absolutely cannot follow a Markdown link (rare; most read native linkage today), the pointer file may be expanded to include the *minimum* set of orientation lines that specific tool requires to function. This expansion:
   - must be justified in a Codex review explicitly, naming the tool and the limitation
   - must keep the link to `CLAUDE.md` as the first non-title line
   - must keep the sync-policy line at the end
   - must be revisited whenever the tool gains link-following support, with the goal of reverting to a thin pointer

The default answer to "should I add content to `AGENTS.md`?" is **no**. The exceptions above are for genuine tool limitations, not contributor convenience.

## 5. How to update the pointer

The pointer file changes for exactly three reasons:

1. **`CLAUDE.md` is renamed or moved.** Update the link target. Preserve title, instruction, and sync-policy lines.
2. **A new must-read file joins the orientation set.** The current pointer names `CLAUDE.md` and `docs/design/ROADMAP.md`. If a third file becomes essential reading on every Codex session, add it to the first-read instruction line. Adding a file is a milestone-level decision, not a casual edit.
3. **A new tool-specific pointer file is added** (e.g., `WINDSURF.md`). The new file follows section 3's shape; `AGENTS.md` itself does not change.

What does **not** change the pointer:

- A new non-negotiable rule lands in `CLAUDE.md`. The pointer does not need to know.
- A milestone closes. The pointer does not need to know.
- A new contract file is added under `docs/contracts/`. The pointer does not need to know.

If a contributor finds themselves editing `AGENTS.md` for any reason other than the three above, they should stop and re-read this document. The pointer's stability is its value.

## 6. Audit trail

The pattern was confirmed canonical in session 07 of the comparison sweep (`docs/comparison/07-learn-harness-engineering/`). The original COMPARISON.md missed the existing `AGENTS.md` artifact; Codex's review (Q9) flipped the verdict from reject to borrow-modified, observing that code-oz already had the right shape. The synthesis (rank 4 in the post-Codex borrow set) called for documenting the pattern as canonical. This file is that documentation.

Future audits should verify two invariants:
- `AGENTS.md` remains a thin pointer (no content duplication from `CLAUDE.md`).
- The sync-policy line is present and unmodified.

If either invariant fails, the file has drifted from the convention and should be restored before the next milestone closes.
