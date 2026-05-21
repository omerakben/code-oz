# DISTRIBUTION_PLAN_FINAL — code-oz multi-host distribution + superpowers borrows

Date: 2026-05-20
Status: **Converged** (Codex gpt-5.5 xhigh, 3 rounds → "Converged: yes, blocking items: none")
Decision authority: Ozzy, 2026-05-20

Source docs (in dependency order):
- `CODEX_BRIEFING_DISTRIBUTION_PIVOT.md` + `CODEX_RESPONSE_DISTRIBUTION_PIVOT.md` — architecture debate (engine-first wrappers)
- `SESSION_DIST_D0_D1_KICKOFF.md` — D0/D1 kickoff
- `SUPERPOWERS_BORROW_ANALYSIS.md` v3 — the borrow set
- `CODEX_RESPONSE_BORROW_R1.md` / `_R2.md` / `_R3.md` — the convergence loop

## 1. The decision in one paragraph

code-oz keeps its engine (the Bun runtime that owns gates, events, cross-family review, budgets) and changes only its *front door*. Instead of asking people to adopt a new CLI, code-oz ships as host plugins that discover and invoke the engine from inside the tools they already use — Claude Code first, then Codex and Cursor. The plugin never writes gates or runs a second model itself; the engine stays the sole authority (rule 1, rule 2 intact). A separate, honestly-labeled `code-oz-discipline` plugin carries the advisory skills (the discipline as prompts) as an on-ramp that upsells to the engine. The near-zero-install path already exists: the npm launcher (`npm-wrapper/index.cjs`) downloads and checksum-verifies the binary on first run, so no engine retarget is needed.

## 2. Architecture (locked)

- **Engine-first wrappers.** Host plugins are thin shells: discover `code-oz`, version-check, invoke it, pass stdout/stderr + `NEEDS_INTERVENTION.json` paths through verbatim. The binary remains the only writer of gates, canonical artifacts, `events.jsonl`, provider calls, and budget decisions.
- **Two plugins, not one.** `code-oz` (wrapper + router, D1a) and `code-oz-discipline` (advisory skills, D1b). On Claude Code the plugin name *is* the skill namespace, so two plugins is the only hard separation between "enforced" and "advisory."
- **No engine retarget.** Reuse the npm launcher; `npx -y @tuel/code-oz@<pinned>` or a global install. No Node rewrite, no bundled-binary plugin asset until marketplace policy is verified.
- **Cross-family review stays engine-owned** (rule 2). The plugin never invokes a second model and never asks the host model to substitute for REVIEW (rule 21 clean).

## 3. Staging (rule 20: one boundary per milestone)

| Stage | Boundary | Borrows | Gate before next |
|-------|----------|---------|------------------|
| **D0** | none (research) | verify host mechanics; confirm `npx` bootstrap from clean env; verify marketplace UX-metadata rules; quoting/no-bash review of the polyglot runner | written D0 findings + frozen D1 contracts |
| **D1a** | Claude Code host distribution + engine invocation | B1 (bounded router), B2a (Claude manifest), B2b (Claude bootstrap branch), B3 (Unix hook, host-exec manifest), B4 (acceptance harness) | B4 acceptance passes |
| **D1b** | advisory behavioral-skill surface (sibling plugin `code-oz-discipline`) | B6 (advisory framing), D1b parameters, E1-E9 eval corpus, B7 (explicit-request harness) | E1-E9 pass |
| **— M17 —** | (return to roadmap: AUDIT runtime) | — | — |
| **D2** | Codex host | B2a/B2b per host, B5 sync | post-M17 |
| **D3** | Cursor host | B2a/B2b per host, B5 sync | post-M17 |
| **D4** | host→engine MCP bridge | own contract + Codex debate | only if D1-D3 metrics prove subprocess/npx insufficient |

Standing discipline (not a milestone): **F2** — no D1b skill change without adversarial eval evidence (E1-E9 + B7/B8 corpus).

## 4. The borrow set (converged)

**Take (implementation):** B1 bounded router bootstrap · B2a per-host manifests + marketplace metadata · B2b host-detection bootstrap (Claude branch only in D1a) · B3 cross-platform hook runner + registration files (host-exec manifest, Unix in D1a, Windows folds into v0.20.2) · B4 acceptance harness (structured parse + FakeProvider engine-invocation + no-`.code-oz/`-write filesystem assertion + negative gate-shaped-output tests) · B5 deterministic sync with destination-metadata preservation (D2/D3) · B6 advisory framing (lowest authority) · B7 explicit-skill-request harness · B8 eval-corpus pattern.

**Take (future signals):** F1 marketplace is the channel · F2 eval-gated skill changes · F3 code-oz is its own plugin (not a superpowers PR) · F4 OpenCode idempotent-bootstrap reference.

**Reject:** R1 zero-runtime gates (violates rule 1 — the moat) · R2 same-family self-review as headline (rule 2) · R3 skills-as-product / freely-edited prompts (rule 16) · R4 maximalist all-caps coercion (not code-oz's voice).

## 5. The three contracts that keep it honest

- **B1 router bound.** May route to the engine; may not declare gate status, parse engine output into pass/fail, write `.code-oz/`, simulate review, or fall back to host-local review. ≤1500-token capped, idempotent-marked, defers to user instructions and to superpowers when co-installed, subagent-skip. `code-oz run` only on explicit request/confirmation; `doctor` may run read-only without asking.
- **B3 host-exec declaration.** A rule-9-shaped manifest validated in CI/review — *not* runtime sandbox enforcement (host hooks run with the user's permissions). Claim file-root/network enforcement only where a real sandbox exists.
- **D1b integrity.** Sibling plugin; advisory banner on every skill; denylist (`GATE_*`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, gate-sense `passed`/`approved`, cross-family-review claims); no canonical writes; mandatory engine upsell; deterministic `universal-rules.md` import (rule 16). Gated by the E1-E9 adversarial corpus.

## 6. Sequencing and the honest risk

- **Pre-empt M17 narrowly.** Do D0 + D1a (+ D1b) before returning to M17 AUDIT runtime. Discovery/install is the live adoption wall, and D1 does not touch runtime authority.
- **The accepted risk.** A wrapper that still needs npm/npx/PATH may not fully kill the "new CLI" objection, and the advisory tier could become a comfortable substitute users never convert from. D1 is itself the experiment: measure first-session completion and whether users object to the bootstrap. If they reject the local engine outright, the real problem is "local engine required" — which points at a hosted engine, a separate and larger decision.

## 7. What is NOT in scope

D2/D3/D4 before M17, engine retarget to Node, bundled-binary plugin asset, hosted engine, OpenCode/Gemini/Copilot hosts. All deferred to post-M17 and/or D1 evidence.

## 8. Immediate next action

Open **D0** (no code): verify Claude Code plugin + hook + skills mechanics against current docs and the superpowers reference, confirm the `npx -y @tuel/code-oz` bootstrap end-to-end from a clean environment, and freeze the D1a/D1b contracts. Output: a D0 findings doc.
