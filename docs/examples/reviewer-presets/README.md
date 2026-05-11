# Reviewer presets — examples (no runtime loader)

This folder is **inert example content** for the M14 reviewer panel. Files here are not loaded automatically. There is no `--panel-presets` CLI flag at v0.17. This is the deliberate post-debate position from `docs/comparisons/claude-code/SYNTHESIS.md` §1.6.

## Why presets are not a runtime surface yet

The bundled `pr-review-toolkit` plugin in the influence library (`~/Projects/agents/templates/claude-code/plugins/pr-review-toolkit/`) ships six named reviewer agents (`comment-analyzer`, `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`, `code-reviewer`, `code-simplifier`). Each is concern-oriented, parallelizable, and bundled.

Code-oz could ship a similar curation library at `agentpacks/reviewer-presets/` and let users select N via `code-oz run --panel-presets <ids>`. That borrow was tentatively scoped as **B3** in the comparison.

Codex's adversarial review (`docs/comparisons/claude-code/CODEX_RESPONSE.md` §3.9, §4) raised the right concern: **preset cargo-culting**. A name like `silent-failure-hunter` sounds useful even when the role is poorly fit to the change under review. Promoting the library to a runtime surface before empirical data exists invites users to stack roles by intuition rather than evidence.

The post-debate decision (`SYNTHESIS.md` §1.6) is to **demote B3 to inert examples** until ≥10 panel production runs produce data on which preset content correlates with confirmed findings. Promotion to a runtime surface (with a CLI flag and a loader) is gated on that evidence under rule 21's measurable-effect bar, even though presets do not themselves add a parallel-provider surface.

## How to use these examples

If you want to try one of these reviewer roles in a real run, copy the relevant fields into your own `.code-oz/config.yaml` panel block. Treat each preset as a *content draft*, not a turnkey configuration. Adapt the role description, prompt fragment, and provider recommendation to your specific change.

When a preset content draft catches a real bug in your run, log the finding id alongside the preset id in your run notes. That is the empirical data the promotion question depends on.

## Files

- `silent-failure-hunter.yaml` — finds error-suppressing patterns: try/catch that swallows, defaulted error returns, fallback values that hide upstream failures.
- `type-design-analyzer.yaml` — checks new type introductions for invariant expression, encapsulation, usefulness, and runtime enforcement.
- `comment-analyzer.yaml` — verifies comment accuracy against the code, flags rot, drops promotional or vague-attribution language.
- `simplifier.yaml` — proposes simplifications that preserve behavior; never expands surface, never adds abstractions, never re-shapes data without reason.
- `security-auditor.yaml` — pattern-matches against OWASP Top 10 risks (input validation, deserialization gadgets, dangerous shell composition, secrets in commits) inside the diff, never against unchanged code.
- `test-coverage-auditor.yaml` — names load-bearing branches in the diff that lack test coverage; explicitly does not reward coverage percentage.

## Status

- Created: 2026-05-10 (post-debate per `SYNTHESIS.md`).
- Promotion gate: ≥10 panel production runs with preset-attribution metadata in `events.jsonl`.
- Authority cost when promoted: zero if the preset only steers prompt content; non-zero if it expands voter slot count or family mix (rule 21 applies in that case).
