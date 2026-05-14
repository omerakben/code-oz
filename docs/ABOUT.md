# About code-oz

This doc carries the depth content moved out of the lean README per the 1000-star plan (Phase 1.5): milestone inventory, product thesis context, influence library, and architecture overview. The README links here for "the full story." If you came here from the README, the milestone plan beyond v0.20 is in [`docs/design/ROADMAP.md`](design/ROADMAP.md).

## What ships in v0.20.0-alpha.0

Shipped through M16 + PE-1 + B1a + W3a:

- `code-oz init` / `code-oz run` / `code-oz approve <phase>` / `code-oz doctor` — full production CLI for the DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on greenfield multi-task PLANs (M16).
- File-based gates with sha256 binding; the orchestrator never approves an unparseable artifact (M1-M5).
- `tool_use.repo_context` (`glob` / `grep` / `read` at locked caps; `symbol` reserved for a future codegraph backend) and `tool_use.execute` (no-shell argv-only with scrubbed env, timeouts, stream caps).
- BUILD-lite + VERIFY-lite + REVIEW-lite end-to-end with patch contracts, worktree-per-run isolation, mutation gating, restart-on-fail policy, cross-family REVIEW (BUILD and REVIEW provider families must differ), and review-needs-revision restart routing (M7-M9).
- Debate runtime (`requestDebate()`) with topic-collision detection + concurrent-limit caps; debate-policy scheduler triggers debate on score grey-zone and panel disagreement (M10, M15).
- Provider capability contract (M11) + company roster mapping persona roles to providers (M12) + role-cost policy under `budgets.global.byRole` (M13).
- Reviewer panel v1 with cross-family quorum (M14); first simultaneous-provider surface, with `RULE21_BENCHMARK.md` as the canonical risk-reduction measurement methodology.
- PE-1: `XaiProvider` direct HTTP adapter reading `XAI_API_KEY`, posting to `api.x.ai/v1/chat/completions` with strict request-body allowlist, full secret redaction, typed error class.
- v0.20.1 provider setup contract: no-key CLI first-run defaults to `FakeProvider`; Claude and Codex stay CLI-login based; xAI uses `XAI_API_KEY`; the GUI helper uses `GEMINI_API_KEY`. See [`docs/PROVIDER_SETUP.md`](PROVIDER_SETUP.md).
- `code-oz run --effort lite|balanced|max|beast` (B1a) scales `budgets.global` and `budgets.perPhase` uniformly; never changes assurance invariants (review rounds, panel slot count, mutation gate threshold). Run-shape envelope locked at run start; active-run replay reads the recorded snapshot, not the live config.
- W3a multi-channel distribution: native binaries for darwin-{arm64,x64} + linux-{x64,arm64} built in CI via `bun build --compile`, fail-closed install script with SHA chain + tagged-release fetch, npm Node-launcher wrapper that downloads + SHA-verifies + caches at `~/.cache/code-oz/<version>/`, Homebrew formula template rendered into the `omerakben/homebrew-code-oz` tap at release time. Same `checksums.txt` source of truth across all three channels.

## Product thesis

Provider and model bias are real. A single LLM is confident even when wrong; cross-family review is the most reliable counter we have today. `code-oz` coordinates role-specialized agents through artifacts, evidence gates, debate, verification, and cross-family review instead of trusting one model's confidence.

Market category: a **repo-native agentic SDLC runtime**. Product metaphor: an **AI software company** with roles (BA, PM, Architect, Builder, Verifier, Reviewer, Scientist) coordinated by file-based contracts.

Full thesis: [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](product/AI_SOFTWARE_COMPANY_THESIS.md). Tagline: *Run an AI software company from your terminal.*

## Install channel mechanics

The same SHA-pinned binary lands through all three channels:

**curl | sh.** Installs to `~/.local/bin/code-oz`. Verifies the per-arch tarball SHA against `checksums.txt`. Prints a PATH hint if `~/.local/bin` is not on PATH. The `--version <TAG>` flag is required in network mode (versioned asset names break the `/releases/latest/download/` redirect; API-based "latest" resolution lands in a future release).

**npm.** The wrapper at `npm-wrapper/index.cjs` reads the package version, downloads the matching per-arch binary from the GitHub release on first invocation, SHA-verifies it, caches it at `~/.cache/code-oz/<version>/code-oz`, and execs it with the user's argv. No `bun` runtime dependency on the user's machine. No `postinstall` hook (survives `npm ci --ignore-scripts`).

**Homebrew.** Per-arch URLs for `on_macos { on_arm | on_intel }` and `on_linux`. SHAs baked at formula render time from the release's `checksums.txt`.

**Platform support today.** macOS arm64, macOS x64, Linux x64, Linux arm64. Windows and Scoop are deferred to a future distribution milestone. Apple Developer signing and GPG-signed checksums are deferred to a v0.x stable release; install.sh applies `xattr -d com.apple.quarantine` on macOS as the v0.20 alpha workaround.

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

`docs/design/ROADMAP.md` carries the milestone plan, decision matrix, and per-PR sequencing. Brownfield repositories are detected and represented today, including the `audit` phase in state and GUI surfaces. The next milestone is M17 (AUDIT runtime), shipping to v0.21 per the 1000-star plan locked in `docs/planning/1000_STAR_PLAN.md`; M17 closes the brownfield workflow gap so `code-oz` can audit existing codebases before proposing fixes.
