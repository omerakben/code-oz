# xAI demand checkpoint — 2026-05-01

**Boot prerequisite for the post-PE-1 milestone selection.** Per
`docs/design/SESSION_XAI_EXPANSION_KICKOFF.md` § "Demand-checkpoint
discipline" and `docs/research/CODEX_RESPONSE_PE1.md` Q7 lock, the route
friends actually use to access xAI determines whether the next milestone
is M13 (default) or PE-2 (OpenRouter) / PE-3 (gateway) / cloud (v0.2
deferred).

## Scope

- No keys, account names, screenshots, or operator-side identifiers
  recorded in this file. Light signal capture only, per PE-1 redaction
  discipline.
- One paragraph of context, one paragraph of result, one decision line.
  The doc exists so the next session can audit *why* the milestone shifted
  (or did not).

## Context

PE-1 closed `2026-05-01` at `v0.13.0-alpha.0`. The xAI direct HTTP
adapter (`XaiProvider`) is live; `XAI_API_KEY` env var is the documented
auth path. The post-M10 productization sequence locks M13 as the next
M-track milestone (per CLAUDE.md rule 20: one new authority boundary per
milestone — M13 = per-role budget gating + preflight cost estimates).
The locked sequence allows demand-gated insertion of PE-2 / PE-3 between
M-track milestones, but only with measurable demand evidence; absent
that signal, the default sequence stands.

## Result

Ozzy elected to proceed with the **default sequence** without a friend
survey. The signal underlying the choice is operator-side: friends in
the test cohort use xAI direct (PE-1 already covers them). Routed
retail (OpenRouter), gateway (LiteLLM / Portkey), and cloud routes
(Azure / Bedrock / Vertex) carry no measurable demand at this
checkpoint. PE-2 / PE-3 / cloud are deferred per the demand-checkpoint
discipline.

A separate ordering note: after M13 closes, the next focus is **W3
distribution** (npm + Homebrew + Scoop + auto-PATH-patching install
script) ahead of M14 reviewer panel, so testers can install `code-oz`
via standard package managers before the first simultaneous-provider
surface lands. M14's kickoff stays drafted but parked behind W3's
distribution work. This ordering does not affect M13 scope; it shapes
the M13 handoff.

## Decision

**M13 is next.** No PE-2 insertion. M14 reviewer panel parks behind W3
distribution after M13 closes. Tag candidate for M13: `v0.14.0-alpha.0`.
