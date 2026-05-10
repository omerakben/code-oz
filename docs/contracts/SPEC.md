# SPEC.md (v0.1)

User-facing summary of the artifact the DEFINE phase produces. The
canonical contract — section schema, validation rules, draft-vs-canonical
discipline, ready-token grammar — lives in
[`docs/references/spec-contract.md`](../references/spec-contract.md).

*Gate philosophy: Reversed Conversation (see [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](../product/AI_SOFTWARE_COMPANY_THESIS.md)).*

## What SPEC.md is

The output of the DEFINE phase. A plain Markdown document at
`.code-oz/artifacts/SPEC.md` that captures what the user wants built,
who it's for, and how everyone will know it's done.

A SPEC.md looks like this:

```markdown
# SPEC

## Goals

- Help a parent name their newborn.
- Suggest names balanced across given-name and surname pairings.

## Users

- New parents with a fixed surname who want suggestions for given names.

## Constraints

- Runs locally on a phone-class device.
- No internet access required after install.

## Acceptance criteria

- Given a surname, the app produces 5 candidate given names.
- Each candidate's syllable count and rhythm are scored against the surname.

## Open questions

- Does the parent want gender-neutral suggestions only?

## Explicit non-goals

- Not building a name registry or social-sharing surface.
- Not generating surnames.
```

## How SPEC.md gets written

The DEFINE phase runs an ask-me conversation between the user and the BA
persona. Each turn:

1. The user types a reply to the BA's question (or, on turn 0, the
   initial request).
2. The BA persona asks the next focused question.
3. When the BA has enough information, it emits `<spec-ready/>` on a line
   by itself, then a complete SPEC.md draft.
4. The orchestrator parses the draft, validates the section schema,
   serializes a canonical version, and writes `.code-oz/artifacts/SPEC.md`
   atomically.

The conversation runs up to `maxRounds` (default 8). If the BA hasn't
signaled by round 8, the orchestrator runs one **finalize** turn asking
the BA to produce the best SPEC it can with the information so far. If
validation fails on the draft, the orchestrator runs one **repair** turn
asking the BA to fix specific missing or malformed sections.

If validation still fails after both rituals, the orchestrator writes
`SPEC.draft.md` (the unvalidated content for inspection) and a
`NEEDS_INTERVENTION.json` gate file. **The orchestrator never writes an
invalid `SPEC.md`** — that would poison the gate writer's sha256 binding.

## Six required sections

| Section | What it answers | Min content |
|---|---|---|
| `## Goals` | What you want built | ≥ 1 bullet |
| `## Users` | Who uses it and what they care about | ≥ 1 bullet |
| `## Constraints` | Technical, time, scope limits | ≥ 1 bullet |
| `## Acceptance criteria` | How everyone knows it's done | ≥ 1 verifiable bullet |
| `## Open questions` | What still needs the user's input | ≥ 1 bullet (use `- None known at define time.` if none) |
| `## Explicit non-goals` | What this SPEC explicitly does NOT cover | ≥ 1 bullet |

Sections appear in canonical order. Section bodies contain only bullets
(`- `) and blank lines — no paragraphs, code fences, or sub-headings.
This is intentional: deterministic structure makes pass/fail
machine-checkable per non-negotiable rule 1.

## Why explicit non-goals matter

Non-goals is the most-skipped, most-load-bearing section. Implicit
non-goals are how scope creep happens: nobody noticed we never agreed
"this is not a SaaS platform" until BUILD started provisioning AWS.

The validator requires at least one non-goal. Filler is acceptable
("Not building a SaaS platform"); absence is not. Filler is *visible*
filler — easy to see and discuss. Absent non-goals are invisible.

## Approving SPEC.md

DEFINE writes `SPEC.md` and exits 0 with a message like:

```text
DEFINE phase complete. Review .code-oz/artifacts/SPEC.md, then run:
  code-oz approve define
```

The user reviews, edits if needed (SPEC.md is plain Markdown — edit it
in any editor), and runs `code-oz approve define`. The approve command
sha256-binds the artifact at approval time, writes
`GATE_DEFINE_PASSED.json`, appends the transition events, and rebuilds
`current.json` so the run is now positioned at PLAN.

If you edit SPEC.md after approving, the next read fails with
`gate_artifact_sha256_mismatch`. To redo DEFINE, start a new run.

## What's local; what's worth committing

- **`SPEC.md`** is a project artifact. Once approved and stable, commit it.
- **`SPEC.draft.md`** is local and transient. Never commit; the next run
  overwrites or removes it.
- **`.code-oz/state/runs/`** is gitignored by the bundled scaffold.
  This includes `events.jsonl`, which contains your conversation with
  the BA persona verbatim. If you handle sensitive intent, inspect or
  rotate `state/runs/` before sharing logs.
- **`.code-oz/agents/`** is the place to add or override personas
  (e.g., a domain-specific BA). Project-local agents win on collision
  with bundled defaults.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `spec_missing_section` | A required H2 section is absent | Edit SPEC.md to add the section, or rerun DEFINE |
| `spec_section_out_of_order` | Sections are present but not in canonical order | Reorder; serializer will normalize on next write |
| `spec_section_empty` | A required section has no bullets | Add at least one bullet |
| `spec_unexpected_content` | A section body has paragraphs, code fences, or sub-headings | Convert to bullets or remove |
| `spec_validation_failed` | Persona produced a draft that failed validation after both repair and finalize rituals | Inspect `SPEC.draft.md`; rerun DEFINE; or edit and rename to SPEC.md manually (skips approval gate) |
| `spec_truncated` | Persona response was cut off (`stopReason: 'max_tokens'`) | Inspect `SPEC.draft.md`; raise model output budget; rerun |
| `ask_me_max_rounds_exceeded` | `onMaxRounds: 'fail'` was configured and the loop hit the cap | Raise `phases.define.askMe.maxRounds`, change to `'finalize'`, or rerun with clearer initial input |

## Reference

- **Pinned spec:** [`docs/references/spec-contract.md`](../references/spec-contract.md) — section schema, ready-token grammar, draft-vs-canonical rule, ask-me events, validation rules, anti-patterns
- **Gate contract:** [`GATES.md`](./GATES.md) — how `code-oz approve define` sha256-binds SPEC.md
- **Provider contract:** [`PROVIDERS.md`](./PROVIDERS.md) — how the BA persona's calls flow through `invokeAgent`
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M5.md`](../design/CODEX_RESPONSE_M5.md) — the M5 planning round + locked 11-commit order
- **M5 implementation:** `src/phases/define.ts`, `src/phases/ask-me.ts`, `src/artifacts/spec.ts`, `src/prompts/`
