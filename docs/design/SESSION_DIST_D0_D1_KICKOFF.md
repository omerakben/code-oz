# SESSION KICKOFF — Distribution D0 + D1 (Claude Code wrapper + honest discipline skills)

Date: 2026-05-20
Status: planning (no code yet)
Inputs: `CODEX_BRIEFING_DISTRIBUTION_PIVOT.md`, `CODEX_RESPONSE_DISTRIBUTION_PIVOT.md` (thread 019e476c), `docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md`
Decision authority: Ozzy, 2026-05-20

## Locked decisions

1. **Distribution architecture: engine-first wrappers.** Host plugins are thin shells that discover and invoke the `code-oz` binary. The engine stays the only writer of gate files, canonical artifacts, `events.jsonl`, provider calls, and budget decisions (rule 1 holds unchanged).
2. **A skills tier ships too — but honest.** Ozzy's call, over Codex's "reject advisory tier." Reconciled with rule 1 via the honesty mechanism in §D1b. Advisory discipline skills are an on-ramp that upsells to the engine; they never emit gate-shaped output and never simulate cross-family review.
3. **Sequencing: D0 + D1 pre-empt M17.** Discovery/install is the live adoption wall. D0/D1 do not touch runtime authority. Return to M17 AUDIT after D1 validates. D2 (Codex) and D3 (Cursor) wait until after M17.
4. **No engine retarget.** Reuse the existing `npm-wrapper/index.cjs` Node launcher (downloads + checksum-verifies the Bun binary on first run, no postinstall). No Node rewrite, no bundled-binary plugin asset until marketplace policy is verified.
5. **First host: Claude Code.** Per user feedback ("mostly Cursor and Claude Code, some Codex"). Claude Code is the user's home turf and the engine already shells out to the Claude Code CLI as a provider.

## Rule-20 boundary map (one boundary per milestone)

| Stage | New boundary | Touches runtime authority? |
|-------|-------------|----------------------------|
| D0 | none (research/proof only) | no |
| D1a | host distribution + engine-invocation surface (Claude Code) | no — wrapper only, no gate/artifact/event writes |
| D1b | advisory behavioral-skill surface (Claude Code) | no — advisory only, honesty-gated, no gate-shaped output |
| D2 | Codex host surface | no (after M17) |
| D3 | Cursor host surface | no (after M17) |
| D4 | host→engine MCP control plane | yes — own contract + debate, only if D1–D3 metrics justify |

D1a and D1b are distinct boundaries and land as separate commits/sub-steps; they are not bundled. D1b cannot land before D1a (the wrapper is the thing it upsells to).

## D0 — channel proof (no code)

Goal: fix the D1 wrapper contract against *current* host plugin mechanics before writing any wrapper. Output is a findings doc, not code.

Tasks:

- Confirm Claude Code plugin mechanics from the superpowers reference and current docs: `.claude-plugin/plugin.json` + `marketplace.json` shape, how `skills/`, `commands/`, and `hooks/` register, the `SessionStart` bootstrap pattern, and `${CLAUDE_PLUGIN_ROOT}` resolution.
- Verify the install bootstrap end-to-end from a clean environment: `npx -y @tuel/code-oz@<pinned> doctor` resolves, downloads, checksum-verifies, and runs the binary with no Bun on the machine. Record the exact first-run UX (latency, prompts, failure text).
- Decide the bootstrap contract the skills depend on: `command -v code-oz` → run directly; else `npx -y @tuel/code-oz@<pinned>`; else hard-stop with actionable text. Pin the version source.
- Revise `docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md` against current host rules; carry forward what still holds, flag what is stale.
- Confirm naming: the plugin is `code-oz` (engine wrapper); the advisory skills are namespaced so they cannot be mistaken for enforced gates (candidate: `code-oz:discipline/*` with advisory banners). Final name decided in D0.

D0 acceptance: a written D0 findings doc + a frozen D1 wrapper contract (bootstrap path, manifest shape, skill/command list, passthrough rules, honesty rules for D1b).

## D1a — Claude Code engine wrapper (headline)

A `code-oz` Claude Code plugin whose skills/commands discover and invoke the binary:

- Manifests: `.claude-plugin/plugin.json` + `marketplace.json`.
- Wrapper commands: `code-oz init`, `code-oz run`, `code-oz resume`, `code-oz doctor` invoked via the D0 bootstrap contract.
- Passthrough discipline: surface the engine's stdout/stderr and any `NEEDS_INTERVENTION.json` path verbatim. The skill never parses engine output for pass/fail and never writes under `.code-oz/`.
- Provider-auth failure: the wrapper stops and surfaces the engine's intervention. No "I'll review it here" fallback (preserves rule 2 — cross-family review stays an engine authority).

D1a acceptance: from a fresh Claude Code session, install the plugin → run one `FakeProvider` lifecycle (DEFINE→SHIP) end-to-end through the wrapper → gates and `events.jsonl` are written by the engine, not the skill. Smoke test asserts zero skill-side `.code-oz/` writes. Cross-family review path exercised at least once with real providers (manual, opt-in).

## D1b — honest advisory discipline skills (on-ramp, additive)

Advisory skills that deliver code-oz's *discipline* as prompts for users who have not yet run the engine: brainstorming, 3-source-check, RED-first TDD, the universal anti-slop sheet, the maestro rule-checker discipline.

Honesty mechanism (non-negotiable — this is what keeps rule 1's spirit intact):

- Namespaced distinctly from the engine wrapper; never presented as plain `code-oz` enforcement.
- Every advisory skill carries an `advisory only — not an enforced gate` banner.
- Refuses to emit `GATE_*`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, or any `passed`/`approved` gate-shaped output.
- Never claims to have performed cross-family review (it is single-host, single-family by construction).
- Each advisory skill ends with an explicit upsell: "to enforce this as a gate and get a different-family reviewer, run `code-oz run` (the engine)."

D1b acceptance: adversarial check confirms no advisory skill emits gate-shaped output or claims review it did not perform; the upsell to the engine fires at the right moments.

## Known risk (carried from the debate, accepted)

A wrapper that still needs npm/npx/PATH may not fully kill the "new CLI" objection, and the advisory tier risks becoming a comfortable substitute users never convert from. D1 is itself the experiment that settles this: measure first-session completion and whether users object to the bootstrap. If they reject the local engine outright, the real problem is "local engine required," not "marketplace presence" — and the answer is a hosted engine, a separate and larger decision.

## Open questions for D0 to close

- Exact advisory-skill namespace and banner wording.
- Whether D1b ships in the same plugin as D1a or a sibling plugin (leaning same plugin, distinct skill namespace).
- Pinned-version strategy for the `npx` bootstrap (track latest alpha vs pin per plugin release).
- Whether a `SessionStart` bootstrap (superpowers-style) is needed for auto-trigger, or commands suffice for D1a.

## Not in scope

D2 (Codex), D3 (Cursor), D4 (MCP bridge), engine retarget, bundled-binary plugin asset, hosted engine. All deferred until after M17 and/or D1 evidence.
