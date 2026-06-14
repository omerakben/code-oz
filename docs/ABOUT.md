# About code-oz

This doc carries the depth content moved out of the lean README per the 1000-star plan (Phase 1.5): milestone inventory, product thesis context, influence library, and architecture overview. The README links here for "the full story." If you came here from the README, the current milestone plan is in [`docs/design/ROADMAP.md`](design/ROADMAP.md).

## What ships in the current v0.21.x alpha line

Shipped through M17 brownfield AUDIT, v0.21.1 external-operator driving, and post-tag plugin fixes on `main`:

- `code-oz init` / `code-oz run` / `code-oz approve <phase>` / `code-oz doctor` — full production CLI for the DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on greenfield multi-task PLANs (M16).
- Brownfield `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP` runtime (M17). The deterministic brownfield e2e is shipped; live brownfield dogfood still requires provider credentials.
- External-operator driving (v0.21.1). Tools such as Hermes/OpenClaw can drive code-oz non-interactively with `--operator`, `--non-interactive`, or project binding while code-oz remains the gate authority.
- Claude Code plugin marketplace metadata at repo root plus two plugins: `code-oz` (thin engine wrapper) and `code-oz-discipline` (advisory skills only).
- File-based gates with sha256 binding; the orchestrator never approves an unparseable artifact (M1-M5).
- `tool_use.repo_context` (`glob` / `grep` / `read` at locked caps; `symbol` reserved for a future codegraph backend) and `tool_use.execute` (no-shell argv-only with scrubbed env, timeouts, stream caps).
- BUILD-lite + VERIFY-lite + REVIEW-lite end-to-end with patch contracts, worktree-per-run isolation, mutation gating, restart-on-fail policy, cross-family REVIEW (BUILD and REVIEW provider families must differ), and review-needs-revision restart routing (M7-M9).
- Debate runtime (`requestDebate()`) with topic-collision detection + concurrent-limit caps; debate-policy scheduler triggers debate on score grey-zone and panel disagreement (M10, M15).
- Provider capability contract (M11) + company roster mapping persona roles to providers (M12) + role-cost policy under `budgets.global.byRole` (M13).
- Reviewer panel v1 with cross-family quorum (M14); first simultaneous-provider surface, with `RULE21_BENCHMARK.md` as the canonical risk-reduction measurement methodology.
- PE-1: `XaiProvider` direct HTTP adapter reading `XAI_API_KEY`, posting to `api.x.ai/v1/chat/completions` with strict request-body allowlist, full secret redaction, typed error class.
- Provider setup contract: first exploration should use `--provider fake`; Claude and Codex stay CLI-login based; xAI uses `XAI_API_KEY`; the GUI helper uses `GEMINI_API_KEY`. See [`docs/PROVIDER_SETUP.md`](PROVIDER_SETUP.md).
- `code-oz run --effort lite|balanced|max|beast` (B1a) scales `budgets.global` and `budgets.perPhase` uniformly; never changes assurance invariants (review rounds, panel slot count, mutation gate threshold). Run-shape envelope locked at run start; active-run replay reads the recorded snapshot, not the live config.
- W3a multi-channel distribution: native binaries for darwin-{arm64,x64} + linux-{x64,arm64} built in CI via `bun build --compile`, fail-closed install script with SHA chain + tagged-release fetch, npm Node-launcher wrapper that downloads + SHA-verifies + caches at `~/.cache/code-oz/<version>/`, Homebrew formula template rendered into the `omerakben/homebrew-code-oz` tap at release time. Same `checksums.txt` source of truth across all three channels.
- Private `code-oz-gui` Next app. It can render fixture and live run state and spawn the CLI locally, but it is not a standalone packaged desktop app and is not published as a Node package.

## Product thesis

Provider and model bias are real. A single LLM is confident even when wrong; cross-family review is the most reliable counter we have today. `code-oz` coordinates role-specialized agents through artifacts, evidence gates, debate, verification, and cross-family review instead of trusting one model's confidence.

Market category: a **repo-native agentic SDLC runtime**. Current public positioning: **CI-style gates for AI coding agents.**

### Architecture (the dense version)

`code-oz` is a standalone terminal CLI that coordinates role-specialized agents over a hybrid phase-graph + agentic sub-orchestration spine. Hard SDLC gates between phases (file-based, schema-validated). Cross-family adversarial review (different model family for BUILD vs REVIEW). Non-technical-user intent elicitation at the front. Multi-provider via `IAgentProvider` (Claude / Codex / xAI / Fake live in v0.1; Gemini stub for transparency; OpenCode/Roo as future adapter candidates). Phase taxonomy: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` for greenfield and `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP` for brownfield. SHIP is a lifecycle boundary and approval state today, not push, merge, publish, or release-artifact automation.

### Historical context: the AI software company metaphor

Through M1–M16 the project framed itself internally as an "AI software company" with role-specialized personas (BA, PM, Architect, Builder, Verifier, Reviewer, Scientist) coordinated by file-based contracts. Early taglines used "Run an AI software company from your terminal." The full historical thesis lives in [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](product/AI_SOFTWARE_COMPANY_THESIS.md).

This metaphor is preserved here for historical and internal context. The project's public positioning is "CI-style gates for AI coding agents" — the same architecture, framed against developers' existing mental model of CI rather than the more abstract software-company simulation framing. The metaphor describes how the codebase is organized; it does not appear as an active public tagline.

## Install channel mechanics

The same SHA-pinned binary lands through all three channels:

**curl | sh.** Installs to `~/.local/bin/code-oz`. Verifies the per-arch tarball SHA against `checksums.txt`. Prints a PATH hint if `~/.local/bin` is not on PATH. The `--version <TAG>` flag is required in network mode (versioned asset names break the `/releases/latest/download/` redirect; API-based "latest" resolution lands in a future release).

**npm.** The wrapper at `npm-wrapper/index.cjs` reads the package version, downloads the matching per-arch binary from the GitHub release on first invocation, SHA-verifies it, caches it at `~/.cache/code-oz/<version>/code-oz`, and execs it with the user's argv. No `bun` runtime dependency on the user's machine. No `postinstall` hook (survives `npm ci --ignore-scripts`).

**Homebrew.** Per-arch URLs for `on_macos { on_arm | on_intel }` and `on_linux`. SHAs baked at formula render time from the release's `checksums.txt`.

**Platform support today.** macOS arm64, macOS x64, Linux x64, Linux arm64. Windows and Scoop are deferred to a future distribution milestone. Apple Developer signing and GPG-signed checksums are deferred to a v0.x stable release; install.sh applies `xattr -d com.apple.quarantine` on macOS as the alpha workaround.

## Influence library

Patterns are borrowed, not depended on. No submodules, no copy-paste.

| Template | Pattern |
|---|---|
| `agent-skills` | Skill frontmatter format + DEFINE→SHIP phase taxonomy + Common Rationalizations table |
| `opencode` | `bun build --compile` distribution + MCP host/client + permission system |
| `Archon` | `IAgentProvider` interface + worktree-per-run isolation |
| `pi-mono` | Streaming event model + multi-provider abstraction |
| `maestro` | File-based gate signals + 3-source verification + Opus-default policy |
| `Auto-claude-code-research-in-sleep` | Cross-family review + Reviewer Memory + 4-round-cap loop + plain-Markdown artifact contracts |
| `claude-code` | Plugin format + hook event names + filesystem discovery |
| `byterover-cli` | Consumer-first design + RED-first TDD ordering (rule 22); `parentTaskId` fan-out cost rollup |

See `docs/comparison/` for per-template head-to-head audits and the synthesis rounds that produced the 23 non-negotiable rules (pinned in [`CLAUDE.md`](../CLAUDE.md)).

## Architecture locks

- **Stack:** Bun + TypeScript, native single-file binary via `bun build --compile`.
- **File format:** Markdown + YAML frontmatter (agent-skills schema, extended with `type` / `phase` / `provider` / `modelPolicy` / `permissions`). Optional sibling `.ts` for hooks/MCP tools/runners.
- **State model:** typed FSM + `state/events.jsonl` event log + schema-validated gate files. No SQLite v0.1.
- **Cross-provider primitive:** narrow `requestReview({ reviewer, files, question })` only at REVIEW gate. Broad `consult()` is v0.3.

## Roadmap context

`docs/design/ROADMAP.md` carries the milestone plan, decision matrix, and per-PR sequencing. Brownfield AUDIT runtime shipped in v0.21.0 and external-operator driving shipped in v0.21.1. The next public roadmap work is Phase 5 launch and M18 SWE-bench Verified adapter work; signing, Windows/Scoop, live Gemini, OpenCode/Roo, cloud IAM, broader `consult()`, and standalone GUI packaging remain future work.
