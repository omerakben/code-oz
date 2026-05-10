# Architecture language

This document records the source and maintainer rationale for the
optional architecture vocabulary borrowed into the REVIEW prompt. It is
not a runtime carrier; the operative wording is inlined in
`src/prompts/review-system.md`.

## Status

- Advisory; subordinate to CLAUDE.md and `docs/contracts/*`.
- Maintainer-facing provenance only.
- No REVIEW validity rule, gate, parser, artifact, or scoring rule is
  created here.
- Do not rely on this file being present in `ProviderRequest.files`.

## Source

- Source: `~/Projects/agents/templates/skills/skills/engineering/improve-codebase-architecture/LANGUAGE.md`
- The whole file is the cited source.
- The borrowed terms are Module, Interface, Implementation, Depth, Seam,
  Adapter, Leverage, and Locality.

## Strictness rejected

The upstream source asks agents to use its terms exactly. code-oz rejects
that strictness.

REVIEW may use this vocabulary when it makes an architecture finding
clearer, but absence of these terms is never a REVIEW defect. Do not
raise, downgrade, reject, or repair a REVIEW draft because a reviewer
used another clear local term.

Phase contracts, `docs/contracts/REVIEW.md`, and the locked REVIEW output
schema win on conflict.

## Terms

### Module

Anything with a caller-facing surface and code behind it. A module can be
a function, class, package, command, provider, or phase runner.

### Interface

Everything a caller must know to use a module correctly: inputs, outputs,
ordering, error modes, invariants, configuration, and performance shape.
This is broader than a TypeScript `interface`.

### Implementation

The code inside a module. Use this term when the topic is the internal
behavior, not the slot where the module plugs in.

### Depth

How much behavior a caller gets for the interface it must learn. A deep
module hides meaningful complexity behind a small interface. A shallow
module exposes nearly as much complexity as it hides.

### Seam

A place where behavior can vary without editing the caller. The seam is
where the interface lives.

### Adapter

A concrete implementation that fills a seam. The word names a role in the
design, not the size or technology of the code inside it.

### Leverage

The caller-side payoff from depth: more behavior or safety per unit of
interface learned.

### Locality

The maintainer-side payoff from depth: related change, knowledge, and
verification stay in one place instead of spreading across callers.

## Advisory principles

- Depth is about the interface, not line count inside the implementation.
- Use the deletion test: if removing a module spreads complexity into
  callers, the module was earning its keep; if complexity disappears, it
  may have been pass-through code.
- Treat the interface as the test surface. If tests must reach past the
  interface to prove normal behavior, the module shape may be wrong.
- One adapter usually means a hypothetical seam. Two adapters make the
  variation real enough to consider a named seam.

## Rejected framings

| Framing | Why this doc avoids it |
|---|---|
| Required vocabulary | REVIEW must judge risk, not enforce a glossary. |
| Depth as lines-of-code ratio | More lines inside a module do not prove design payoff. |
| Interface as only a TypeScript keyword | Callers also depend on order, errors, invariants, and configuration. |
| Boundary as the default word | It often carries domain-model meanings that are not needed here. |

## REVIEW usage

Use this vocabulary only when it makes an architecture concern easier to
act on. Good uses include:

- Naming a shallow module whose callers still carry the complexity.
- Pointing out a seam with only one adapter and no current variation.
- Explaining why a test reaches past the module interface.
- Describing locality loss when a patch spreads one rule across callers.

Do not use this vocabulary to create new required REVIEW sections,
findings, severities, or score caps.
