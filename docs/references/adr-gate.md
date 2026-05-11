# ADR offer gate

This document records the source and maintainer rationale for the ADR
offer gate borrowed into DEFINE and PLAN prompts. It is not a runtime
carrier; the operative wording is inlined in the persona prompts.

## Status

- Advisory; subordinate to CLAUDE.md and `docs/contracts/*`.
- Maintainer-facing provenance only.
- No new gate, artifact, parser, or orchestrator rule is created here.
- Do not rely on this file being present in `ProviderRequest.files`.

## Source

- Source: `~/Projects/agents/templates/skills/skills/engineering/grill-with-docs/SKILL.md`
- The ADR rule lives at lines 78-86 of that source.
- The borrowed rule is: offer an ADR only when a decision is hard to
  reverse, surprising without context, and the result of a real trade-off.

## Rule

An ADR task is optional only when the decision passes this gate:

- Hard to reverse: changing the decision later has real migration,
  user-facing, data, or operational cost.
- Surprising without context: a future maintainer would reasonably ask
  why this path was chosen.
- Real trade-off: viable alternatives existed, and the chosen path gave
  up something specific to gain something else.

If any condition is absent, skip the ADR and record the decision in the
normal artifact prose for the phase.

## DEFINE and PLAN split

DEFINE may detect a load-bearing trade-off and carry it into SPEC.md
bullet text so PLAN can see the decision context.

DEFINE does not propose ADR creation and does not add an ADR section to
SPEC.md.

PLAN is the only surface in this borrow that may add a task for an ADR.
The persona remains the judge; the orchestrator does not enforce this
gate.

## Target repo path

When PLAN adds an ADR task, the `Files:` bullet names the target project
path, for example:

```markdown
- Files: docs/adr/000N-cache-invalidation.md (added)
```

That path means the user's target repository, not code-oz's own
`docs/adr/` directory.

Only code-oz maintainers editing code-oz itself should use code-oz's
own `docs/adr/` directory.

## Worked examples

### Good ADR task: data store choice

- Decision: use Postgres instead of local JSON files for user records.
- Gate: hard to migrate later, surprising in a small app without context,
  and chosen after trading setup cost for transactional behavior.
- PLAN may add `docs/adr/000N-user-record-store.md (added)`.

### No ADR: copy or label choice

- Decision: rename a button from "Start" to "Begin".
- Gate: easy to reverse, not a system-level surprise, and no real
  trade-off.
- PLAN should record it in the task text, not an ADR.

### No ADR: obvious library use

- Decision: use the existing test runner already configured in the repo.
- Gate: not surprising and not a new trade-off.
- PLAN should cite the existing command or source check.

### Good ADR task: auth session model

- Decision: store sessions server-side instead of self-contained client
  tokens.
- Gate: hard to reverse after rollout, surprising without the threat
  model, and trades stateless scaling for revocation control.
- PLAN may add `docs/adr/000N-session-model.md (added)`.
