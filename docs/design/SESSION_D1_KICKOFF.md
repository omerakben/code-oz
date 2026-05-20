# SESSION KICKOFF — D1 (Claude Code wrapper + honest discipline skills)

Date: 2026-05-20
Status: ready to execute (D0 complete, contracts frozen)
For: the next Claude + Codex session
Read first: `D0_FINDINGS.md` (verification + frozen contracts), `DISTRIBUTION_PLAN_FINAL.md`, `SUPERPOWERS_BORROW_ANALYSIS.md` v3
Cross-model rule: this session runs the full debate-at-convergence + review-at-completion cycle (CLAUDE.md "Cross-model peer review").

## 0. One-paragraph scope

Ship two Claude Code plugins. **D1a `code-oz`**: slash commands + a SessionStart router card that discover and invoke the engine binary; the binary stays the only writer of gates/events/reviews. **D1b `code-oz-discipline`** (sibling plugin): honest advisory skills (brainstorming, source-check, RED-first, anti-slop) that never emit gate-shaped output and always upsell to the engine. darwin/linux only. No engine changes. No new runtime authority.

## 1. Pre-flight (D0 already closed these — confirm still true)

- npx bootstrap works from clean cache (verified); `@tuel` scope-routing caveat documented.
- Plugin namespace = plugin name → two plugins required (sibling split).
- Hooks run unsandboxed → B3 is a declaration, not enforcement.
- No `SubagentStart` hook → subagent-skip is a prose directive in the router card.
- Windows double-blocked → out of scope for D1.

## 2. Rule-20 boundaries (do not bundle)

- **D1a = one boundary:** Claude host distribution + engine invocation. Lands as its own commit set, gated by the B4 acceptance harness.
- **D1b = one boundary:** advisory behavioral-skill surface (separate plugin). Lands AFTER D1a is green, gated by the E1-E9 corpus.
- Nothing in D1a's router card is advisory discipline; nothing in D1b writes or claims gates.

## 3. Codex debate plan (this session)

1. **Convergence debate (before code):** brief Codex (gpt-5.5 xhigh, read-only) on the D1a command/hook surface + the literal router card from D0_FINDINGS §2.2. Question to settle: is the router card's trigger scope safe, is the command set minimal, does anything in the surface smuggle authority past rule 1? Capture `CODEX_RESPONSE_D1_CONVERGENCE.md`, synthesize before writing code.
2. **Completion review (before tag):** Codex review (workspace-write) on the finished D1a + D1b. Verdict push / fix-first / debate-required. Close all block-push and block-next findings before D1 is done.
3. Per-commit cross-model review for the B4 harness and the hook (shared-infra touch points) per the project's per-commit-review feedback.

## 4. D1a build sequence (RED-first per rule 22)

Each step: failing test first, confirm it fails for the right reason, minimal impl, green, refactor.

- **C1 — plugin scaffold + manifest.** `.claude-plugin/plugin.json` (shape in D0_FINDINGS §2.5), `marketplace.json`. Test: `claude plugin validate` passes (or schema test if validate is unavailable in CI).
- **C2 — bootstrap resolver.** A small shell/helper the commands share implementing the D0 §2.1 contract (`command -v code-oz` → `npx -y @tuel/code-oz@<pinned>` with scope-routing caveat → hard-stop). Test: resolver picks PATH binary when present; falls back to npx; hard-stops with the right message when neither exists; rejects Windows with the v0.21+ note.
- **C3 — slash commands.** `/code-oz-run`, `/code-oz-init`, `/code-oz-doctor`, `/code-oz-resume`. Each ~30 lines: prerequisite (bootstrap resolver), default flow (exec subcommand, surface stdout/stderr + `NEEDS_INTERVENTION.json` path verbatim), boundaries (never write `.code-oz/`, never parse pass/fail, `run` needs confirmation, `doctor` is free). Reuse B3_SKILL_WRAPPERS.md skill bodies; drop its single-plugin packaging.
- **C4 — SessionStart router card + hook.** `hooks/hooks.json` (matcher `startup|clear|compact` → `run-hook.cmd session-start`), the Unix `session-start` script emitting `hookSpecificOutput.additionalContext` with the D0 §2.2 card + idempotent marker, and the B3 host-exec declaration. Subagent-skip is the prose line in the card. Per-commit Codex review here (shared infra).
- **C5 — B4 acceptance harness.** See §6. This is the D1a gate.

## 5. D1b build sequence (after D1a green)

- **C6 — `code-oz-discipline` plugin scaffold** (separate `.claude-plugin/plugin.json`).
- **C7 — advisory skills**, each carrying the banner, the denylist refusal, the engine upsell; `universal-rules.md` imported via deterministic templating (rule 16). Start with the smallest useful set (brainstorming, source-check, RED-first) — do not port all of superpowers.
- **C8 — E1-E9 adversarial eval corpus** (from `SUPERPOWERS_BORROW_ANALYSIS.md` v3). This is the D1b gate; it must pass before D1b is done. F2 makes it the standing gate for any future skill change.

## 6. B4 acceptance harness (D1a gate — must pass)

- **Trigger eval:** `claude -p "<naive production-task prompt>" --plugin-dir <code-oz>` and parse stream-json (structured, not grep) to assert the router routes to `/code-oz-run`. Add an explicit-request test (B7) too.
- **Engine-invocation proof (offline):** with `FakeProvider`, assert running the wrapper actually spawns the engine and that all `.code-oz/` gate/artifact/event writes originate from the engine path — zero skill-side `.code-oz/` writes (filesystem assertion).
- **Negative tests:** the wrapper never emits gate-shaped output itself.
- **Auth-failure path:** missing provider auth surfaces the engine's `NEEDS_INTERVENTION.json` with no host-side review fallback.
- `--dangerously-skip-permissions` is harness-isolation only, never the product proof path.

## 7. Acceptance for D1 (definition of done)

- D1a: B4 harness green; `claude plugin validate` clean; manual smoke = fresh Claude Code session installs the plugin and runs one FakeProvider lifecycle end-to-end through the wrapper, gates written by the engine.
- D1b: E1-E9 corpus green; manual check that advisory skills are useful (E8-E9 positive controls) and never leak gate authority (E1-E7).
- Codex completion review verdict = push (all block-push/block-next findings closed).
- No engine source changes. No new runtime authority. Rules 1, 2, 16, 20, 21 intact.

## 8. Explicitly out of scope for D1

D2 (Codex host), D3 (Cursor host), D4 (MCP bridge), Windows, engine retarget, bundled-binary asset, marketplace publication (build/test locally via `--plugin-dir`; pursue listing separately). Return to M17 AUDIT runtime after D1.

## 9. Risk to watch (carry from the debate)

D1b is the highest-risk surface: the thing users may mistake for "using code-oz" while bypassing the engine. The sibling-plugin split + banner + denylist + E1-E9 are the mitigations; if the manual smoke shows users conflating the two, escalate to a sharper visual separation or a naming change before any marketplace listing.
