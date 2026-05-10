---
name: reviewer-memory
companion-docs: docs/contracts/REVIEW.md, docs/contracts/REVIEW_PANEL.md, docs/design/ROADMAP.md
target: file-based Reviewer Memory hygiene rubric for M17-M20
status: v0.1 rubric only
---

# REVIEWER_MEMORY (v0.1)

File-based memory-hygiene rubric for M17-M20 Reviewer Memory. This defines shape and hygiene only. Storage, retrieval, fingerprinting, deduplication, and ranking land in M17-M20.

No database is introduced here. The durable store is per-repo files under:

```text
.code-oz/reviewer-memory/<lesson-id>.md
```

The directory is repo-local. The repo remains the memory boundary; this contract adds no cross-repo, hosted, vector, graph, or MCP memory.

## What a lesson is

A lesson is a reusable review finding, failure mode, implementation constraint, or repair pattern that should affect future REVIEW behavior in the same repo. It is not a transcript note or scratchpad.

Required fields are `id`, `created`, and `status`. Example shape (with optional fields):

```yaml
---
id: RM-001
created: 2026-05-10T00:00:00Z
status: active
evolved_from: []
superseded_by: []
contradicts: []
tags: [review, provider, gates]
---
```

Frontmatter fields:

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Stable lesson id; file name and frontmatter must match. |
| `created` | yes | ISO timestamp for first write. Do not rewrite on edits. |
| `status` | yes | `active` or `obsolete`. Obsolete lessons remain on disk. |
| `evolved_from` | no | Lesson ids this entry supersedes or refines. |
| `superseded_by` | no | Forward link from an obsolete lesson to replacement lessons. |
| `contradicts` | no | Lesson ids that disagree with this entry. |
| `tags` | no | Small stable vocabulary for retrieval, not free-form prose. |
| `score` | no | Optional ranking signal. Semantics are open until M17. |

## Durable predicate

Store only when the candidate passes the mechanical tests and the M17 human-review criteria.

### Mechanical tests

| Test | Required answer | Store rule |
|---|---|---|
| Is the candidate lesson text non-empty after stripping transcript-only context? | yes | Otherwise skip. |
| Does the candidate cite a concrete evidence pointer: `REVIEW.md` finding id, gate-failure event type from `events.jsonl`, repair artifact path, decision doc path, or repeated-disagreement event? | yes | Otherwise keep it in the run artifact only. |
| Is the source run id frozen as an explicit run id, not `current`, `latest`, or implicit conversation context? | yes | Otherwise skip until the source is stable. |
| If an `RM-NNN` id is assigned, does it match the file name and frontmatter `id`? | yes | Otherwise repair before store. |
| Does the frontmatter parse with required `id`, `created`, and `status` fields? | yes | Otherwise repair before store. |

If any mechanical answer is "no", do not store a lesson.

### M17 human-review criteria

These criteria are intentionally not-yet-mechanical. M17 must either keep them as human review criteria or replace them with different deterministic tests before using them in an automated writer.

| Criterion | Required answer | Store rule |
|---|---|---|
| Does the candidate describe a reusable repo-level lesson? | yes | Otherwise skip. |
| Would a future reviewer make a better decision if this appeared in retrieval? | yes | Otherwise skip. |
| Is the lesson stable after the relevant phase completed? | yes | Otherwise write to `HYPOTHESES.md` or the run artifact. |
| Can the lesson be stated without private conversation context or hidden assumptions? | yes | Otherwise summarize the durable part or skip. |
| Is this more specific than a universal review rule already captured in contracts or prompts? | yes | Otherwise cite the existing contract. |
| Is it non-ephemeral: not debugging noise, discarded code, one-off environment state, or transient provider behavior? | yes | Otherwise skip. |

If any required human-review answer is "no", do not store a lesson.

## Hygiene primitives

### Duplicate-check before store

Before writing a new lesson, search existing `.code-oz/reviewer-memory/*.md` entries for a fingerprint match. If a match exists:

- update the existing lesson only if the new evidence strengthens the same lesson;
- do not write a second entry with the same durable meaning.

The fingerprint algorithm is not defined in v0.1. M17 chooses it.

### `evolved_from` link

When a new lesson supersedes an old lesson, create a new lesson and link it back with `evolved_from`. Mark the old lesson `status: obsolete` and link it forward with `superseded_by`. Do not delete the old lesson; retrieval must be able to show why the pattern changed.

### `contradicts` link

When two lessons disagree, link both entries through `contradicts`. Do not silently pick one as the winner unless later evidence creates an `evolved_from` relationship.

### Store-at-durable-points only

Candidate lessons are considered only at durable points:

- after a REVIEW finding is accepted, resolved, or rejected with rationale;
- after a gate failure exposes a reusable failure mode;
- after a repair changes the rule a reviewer should apply;
- after cross-family disagreement resolves into a project rule;
- after a milestone closes and the lesson still matters outside the run.

Do not store during debugging, while a hypothesis is open, while implementation is being discarded, or merely because a conversation mentioned a useful detail.

## v0.1 boundary

This contract is rubric only.

Not shipped in v0.1: writer, retrieval path, dedup implementation, score calculation, migration command, cross-run index, cross-repo index, MCP surface, or database surface.

M17-M20 consume this contract when Reviewer Memory becomes implementation work.

## Open implementation questions

M17 must settle:

- Fingerprint algorithm: normalized title, file path plus title, semantic hash, or a hybrid.
- Retrieval cap: how many lessons may enter a reviewer prompt.
- `score` semantics: confidence, recency, frequency, severity, reviewer agreement, or a composite.
- Obsolete handling: default retrieval, linked-only retrieval, or explicit query only.
- Contradiction display: whether both contradictory entries always enter retrieval together.
- Run references and approvals: source run ids, artifact hashes, review finding ids, human approval, or some subset.

## Reference

- Source decision: `docs/comparison/11-mimir/SYNTHESIS.md` section "B4".
- Borrowed pattern source: `/Users/ozzy-mac/Projects/agents/templates/Mimir/.agents/claudette-mimir-v3.yaml:28-51`.
- Borrowed pattern, not borrowed code. The Mimir source uses graph memory relationships; code-oz pins a per-repo file-based rubric with no DB.

Pinned 2026-05-10 from the Mimir comparison.
