# First-run audit

Date: 2026-05-13
Branch: `finalize/v0.20.1-first-run-polish`

## Summary

The Phase 1 audit filed 45 findings: 12 block-ship, 29 fix-soon, and 4 nit. The first-run blockers cluster around five surfaces:

- CLI no-key and `--provider fake` runs do not complete the offline lifecycle.
- GUI dev first screen can render as a Next.js 404 and live runs can resolve a stale CLI binary.
- npm wrapper trusts a tampered cached binary.
- GUI has no committed axe baseline gate and the drawer focus trap is incomplete.
- Documentation sends GUI users to a missing repository and overstates brownfield AUDIT readiness.

This audit treats `phase_entered(ship)` plus `currentPhase=ship` as the v0.20.1 shipped-run success signal. A literal `GATE_SHIP_PASSED.json` would introduce a new ship authority and conflicts with the current gate model, so it is recorded as contract drift, not implemented in this polish pass.

## Ranked findings

| id | area | severity | finding | evidence | planned fix |
|---|---|---|---|---|---|
| F1.1 | CLI | block-ship | Packaged `--provider fake` smoke cannot reach DEFINE completion. | [A1-cli-first-run.md](A1-cli-first-run.md#f11---packaged-provider-fake-smoke-cannot-reach-define-completion) | Add no-key fake fallback plus a first-run fake script fixture for full lifecycle smoke. |
| F1.2 | CLI | block-ship | Explicit resume surfaces are missing. | [A1-cli-first-run.md](A1-cli-first-run.md#f12---explicit-resume-surfaces-are-missing) | Add `code-oz resume` and `code-oz run --resume` aliases to the active-run continuation path. |
| F2.1 | GUI | block-ship | GUI live runs resolve a stale hardcoded CLI binary. | [A2-gui-first-run.md](A2-gui-first-run.md#f21---gui-live-runs-resolve-a-stale-hardcoded-cli-binary) | Resolve monorepo source first, verify version, then fall back to `bun --cwd <repo-root> run src/cli.ts`. |
| F2.2 | GUI | block-ship | Live Approve/Revise actions write fixture requests instead of live-run requests. | [A2-gui-first-run.md](A2-gui-first-run.md#f22---live-approverevise-actions-write-fixture-requests-not-run-specific-requests) | Make approval requests run-scoped through the registered live run record. |
| F2.3 | GUI | block-ship | Default `bun run dev` served `/` as 404. | [A2-gui-first-run.md](A2-gui-first-run.md#f23---default-bun-run-dev-reached-ready-but-served-the-app-as-404) | Pin Next monorepo root behavior and add self-starting e2e coverage. |
| F3.1 | Distribution | block-ship | npm wrapper executes a tampered cached binary without verification. | [A3-distribution.md](A3-distribution.md#f31---npm-wrapper-executes-a-tampered-cached-binary-without-verification) | Verify cached binary SHA via sidecar before exec; redownload or fail closed. |
| F4.1 | Binaries | block-ship | Release workflow uploads binaries without W3a smoke commands. | [A4-binaries.md](A4-binaries.md#f41---release-workflow-uploads-binaries-without-running-the-w3a-smoke-commands) | Add release-workflow smoke or synthetic checks before upload. |
| F5.1 | Docs | block-ship | GUI quick start clones a missing repository. | [A5-docs.md](A5-docs.md#f51---gui-quick-start-clones-a-missing-repository) | Point GUI quick start at the monorepo and `code-oz-gui/`. |
| F6.1 | Errors | block-ship | BUILD can write `NEEDS_INTERVENTION.json` with no actionable recovery step. | [A6-errors.md](A6-errors.md#f61---build-can-write-needs_intervention-with-no-actionable-recovery-step) | Require non-empty suggestions and map BUILD failure codes to hints. |
| F7.1 | Providers | block-ship | First-run provider-key contract does not match CLI behavior. | [A7-providers.md](A7-providers.md#f71---first-run-provider-key-contract-does-not-match-the-implemented-cli-surface) | Default no-key first-run to fake; keep live Claude/Codex as CLI-login based. |
| F8.1 | Visual | block-ship | GUI first screen renders Next.js 404 instead of the board. | [A8-visual.md](A8-visual.md#f81---gui-first-screen-renders-nextjs-404-instead-of-the-documented-board) | Same implementation as F2.3. |
| F9.1 | A11y | block-ship | No committed axe baseline gate for Board, Drawer, or Composer. | [A9-a11y.md](A9-a11y.md#f91---no-committed-axe-baseline-gate-for-board-drawer-or-composer) | Add direct axe gate through Playwright. |
| F9.2 | A11y | block-ship | Drawer focus trap only tracks buttons. | [A9-a11y.md](A9-a11y.md#f92---drawer-focus-trap-only-tracks-buttons-so-textareas-and-other-focusable-controls-can-escape-the-modal-cycle) | Use a full focusable selector and restore opener focus. |
| F1.3 | CLI | fix-soon | Doctor UX is not aggregate and nested help can run probes. | [A1-cli-first-run.md](A1-cli-first-run.md#f13---doctor-first-run-ux-is-not-an-aggregate-check-and-per-subcommand-help-runs-probes) | Add aggregate bare doctor and early help handling. |
| F1.4 | CLI | fix-soon | Brownfield init behavior does not match the A1 contract. | [A1-cli-first-run.md](A1-cli-first-run.md#f14---brownfield-init-behavior-does-not-match-the-a1-contract) | Keep auto-brownfield but make M17 AUDIT gap explicit in docs and init copy. |
| F1.5 | CLI | fix-soon | Ctrl-C `STOP.json` path appears unwired. | [A1-cli-first-run.md](A1-cli-first-run.md#f15---ctrl-c-stopjson-path-appears-unwired) | Wire run signal handler after run context is known. |
| F2.4 | GUI | fix-soon | AIHelper no-key UX omits setup hint and logs stack. | [A2-gui-first-run.md](A2-gui-first-run.md#f24---aihelper-no-key-ux-omits-the-setup-hint-and-logs-a-server-stack) | Return exact `GEMINI_API_KEY` hint and avoid stack logging for expected no-key. |
| F2.5 | GUI | fix-soon | Playwright e2e is not self-starting. | [A2-gui-first-run.md](A2-gui-first-run.md#f25---playwright-e2e-is-not-self-starting-and-can-hit-the-wrong-server) | Add Playwright `webServer`. |
| F2.6 | GUI | fix-soon | Drawer provenance and event accents do not show provider family. | [A2-gui-first-run.md](A2-gui-first-run.md#f26---drawer-provenance-and-event-accents-do-not-show-provider-family) | Add provider family chip and row accents from events. |
| F2.7 | GUI | fix-soon | Fixture/demo does not render all five decision row kinds. | [A2-gui-first-run.md](A2-gui-first-run.md#f27---fixturedemo-does-not-render-all-five-decision-row-kinds) | Add fixture events or run-scope rendering. |
| F3.2 | Distribution | fix-soon | npm wrapper permits non-HTTPS URLs and redirect downgrade. | [A3-distribution.md](A3-distribution.md#f32---npm-wrapper-permits-non-https-download-urls-and-redirect-downgrade) | Enforce `https:` for production and `file:` for tests. |
| F3.3 | Distribution | fix-soon | Homebrew audit recipe is not executable on this Homebrew setup. | [A3-distribution.md](A3-distribution.md#f33---homebrew-audit-command-in-the-release-recipe-is-not-executable-on-this-homebrew-setup) | Update recipe to audit in a tap checkout by name. |
| F4.2 | Binaries | fix-soon | Local build script emits misleading aggregate Darwin tarball. | [A4-binaries.md](A4-binaries.md#f42---local-multi-target-build-script-emits-one-misleading-darwin-tarball-instead-of-the-four-release-asset-names) | Rename aggregate tarball to `all-platforms` or emit four release tarballs. |
| F4.3 | Binaries | fix-soon | Literal `doctor` smoke fails while `doctor tools` passes. | [A4-binaries.md](A4-binaries.md#f43---the-literal-a4-doctor-smoke-fails-even-though-doctor-tools-passes) | Same implementation as F1.3. |
| F5.2 | Docs | fix-soon | README presents brownfield AUDIT as usable even though M17 is the gap. | [A5-docs.md](A5-docs.md#f52---readme-presents-brownfield-audit-as-usable-even-though-m17-is-still-the-gap) | Reword brownfield as detected now, AUDIT runtime in M17/v0.21. |
| F5.3 | Docs | fix-soon | Provider/auth setup is split and contradictory. | [A5-docs.md](A5-docs.md#f53---providerauth-setup-is-split-and-contradictory) | Add one provider setup table and link it from first-run docs. |
| F5.4 | Docs | fix-soon | Release notes still read like tag-prep and disagree on test count. | [A5-docs.md](A5-docs.md#f54---releasechangelog-docs-still-read-like-tag-prep-and-disagree-on-test-count) | Update v0.20 notes and add v0.20.1 stub. |
| F6.2 | Errors | fix-soon | Playbook-required `event_pointer` is absent. | [A6-errors.md](A6-errors.md#f62---playbook-required-event_pointer-is-absent-from-the-gate-schema-and-every-writer) | Add `eventPointer` to new intervention writes and docs. |
| F6.3 | Errors | fix-soon | PAUSE/STOP writers have no production event-order path. | [A6-errors.md](A6-errors.md#f63---pausestop-have-schema-writers-but-no-production-event-order-path-to-verify) | Same implementation as F1.5 for STOP; PAUSE remains deferred if no consumer. |
| F6.4 | Errors | fix-soon | Distribution fail-closed errors omit recovery hints. | [A6-errors.md](A6-errors.md#f64---distribution-fail-closed-errors-often-omit-recovery-hints) | Add one-line recovery hints to install and npm launcher failures. |
| F7.2 | Providers | fix-soon | GUI Gemini no-key hint is generic and logs raw error object. | [A7-providers.md](A7-providers.md#f72---gui-gemini-no-key-hint-is-generic-and-the-route-logs-the-raw-provider-error-object) | Same implementation as F2.4. |
| F7.3 | Providers | fix-soon | Expired auth contract exists but subprocess providers do not classify it. | [A7-providers.md](A7-providers.md#f73---expired-auth-is-a-typed-contract-value-but-subprocess-providers-do-not-classify-it) | Add stderr classification tests and map expired login text to `provider_auth_expired`. |
| F8.2 | Visual | fix-soon | Hero alt text can claim Gemini answer when screenshot allows error state. | [A8-visual.md](A8-visual.md#f82---hero-alt-text-can-claim-a-gemini-answer-even-when-the-capture-script-allows-an-error-state-hero) | Make screenshot capture fail on helper-unavailable or change alt text. |
| F8.3 | Visual | fix-soon | Card and drawer typography hard-truncates important text. | [A8-visual.md](A8-visual.md#f83---card-and-drawer-typography-still-hard-truncates-title-subtitle-and-status-text) | Use stable wrapping and layout assertions. |
| F9.3 | A11y | fix-soon | Text inputs and textareas can suppress global focus ring. | [A9-a11y.md](A9-a11y.md#f93---text-inputs-and-textareas-can-suppress-the-global-focus-ring) | Remove `outline-none` or add explicit focus-visible outlines. |
| F9.4 | A11y | fix-soon | Reduced-motion preferences are not wired into animations or scrolling. | [A9-a11y.md](A9-a11y.md#f94---reduced-motion-preferences-are-not-wired-into-css-animations-motion-transitions-or-smooth-scrolling) | Add global reduced-motion CSS and use instant scroll when requested. |
| F10.1 | Hygiene | fix-soon | GUI lint is not a usable hygiene gate. | [A10-hygiene.md](A10-hygiene.md#f101---gui-lint-is-not-a-usable-hygiene-gate) | Ignore generated dirs and fix hook-name false positives. |
| F10.2 | Hygiene | fix-soon | GUI typecheck is not exposed as a script. | [A10-hygiene.md](A10-hygiene.md#f102---gui-typecheck-is-not-exposed-as-a-script-and-root-typecheck-excludes-it) | Add `code-oz-gui` typecheck script. |
| F10.3 | Hygiene | fix-soon | Source TODOs lack tracked issue links. | [A10-hygiene.md](A10-hygiene.md#f103---source-todos-are-unresolved-and-lack-tracked-issue-links) | Resolve or link remaining TODOs. |
| F10.4 | Hygiene | fix-soon | GUI has stale dependency and export surface. | [A10-hygiene.md](A10-hygiene.md#f104---gui-has-stale-dependency-and-export-surface) | Remove confirmed unused dependencies/exports. |
| F1.6 | CLI | nit | Effort vocabulary is inconsistent. | [A1-cli-first-run.md](A1-cli-first-run.md#f16---effort-vocabulary-is-internally-inconsistent-though-event-order-is-correct) | Add aliases and align docs. |
| F4.4 | Binaries | nit | darwin-x64 Rosetta smoke emits Bun AVX warning. | [A4-binaries.md](A4-binaries.md#f44---darwin-x64-local-smoke-under-rosetta-has-matching-stdout-but-emits-a-bun-avx-warning-on-stderr) | Document as Rosetta-only synthetic limitation. |
| F6.5 | Errors | nit | Global CLI stderr fallback lacks hints. | [A6-errors.md](A6-errors.md#f65---top-level-cli-stderr-fallback-hides-stacks-but-does-not-add-a-recovery-hint) | Add hints to common command parse failures. |
| F10.5 | Hygiene | nit | One TS suppression remains in a negative type test. | [A10-hygiene.md](A10-hygiene.md#f105---one-ts-suppression-remains-but-it-is-scoped-to-a-negative-type-test) | No code change; keep explanatory `@ts-expect-error`. |

## Deferred or constrained items

| item | reason |
|---|---|
| Literal `GATE_SHIP_PASSED.json` | Would introduce a new ship gate authority. v0.20.1 uses `phase_entered(ship)` and `currentPhase=ship` as success evidence. |
| Direct `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` CLI adapters | Out of scope for v0.20.1. Current live Claude/Codex path remains CLI-login based. |
| Full PAUSE implementation | No user-facing pause command exists in this milestone. STOP on Ctrl-C is in scope; PAUSE is recorded as future control-surface work. |
| Native Linux runtime smoke on this Mac | Synthetic local checks and CI workflow checks cover this branch; real Linux execution depends on CI. |
