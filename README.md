# code-oz

Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.

## Status

`v0.20.0-alpha.0` — first release with official install channels (curl|sh, npm, Homebrew). 3353 tests pass offline; live xAI integration gated behind opt-in env flags. See `docs/design/ROADMAP.md` for the milestone plan and `docs/demo/01-todo-cli/` for a runnable end-to-end demo.

Shipped through M16 + PE-1 + B1a + W3a:

- `code-oz init` / `code-oz run` / `code-oz approve <phase>` / `code-oz doctor` — full production CLI for the DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on greenfield multi-task PLANs (M16).
- File-based gates with sha256 binding; orchestrator never approves an unparseable artifact (M1-M5).
- `tool_use.repo_context` (`glob` / `grep` / `read` at locked caps; `symbol` reserved for a future codegraph backend) and `tool_use.execute` (no-shell argv-only with scrubbed env, timeouts, stream caps).
- BUILD-lite + VERIFY-lite + REVIEW-lite end-to-end with patch contracts, worktree-per-run isolation, mutation gating, restart-on-fail policy, cross-family REVIEW (BUILD and REVIEW provider families must differ), and review-needs-revision restart routing (M7-M9).
- Debate runtime (`requestDebate()`) with topic-collision detection + concurrent-limit caps; debate-policy scheduler triggers debate on score grey-zone and panel disagreement (M10, M15).
- Provider capability contract (M11) + company roster mapping persona roles to providers (M12) + role-cost policy under `budgets.global.byRole` (M13).
- Reviewer panel v1 with cross-family quorum (M14); first simultaneous-provider surface, with `RULE21_BENCHMARK.md` as the canonical risk-reduction measurement methodology.
- PE-1: `XaiProvider` direct HTTP adapter reading `XAI_API_KEY`, posting to `api.x.ai/v1/chat/completions` with strict request-body allowlist, full secret redaction, typed error class.
- `code-oz run --effort lite|balanced|max|beast` (B1a) scales `budgets.global` and `budgets.perPhase` uniformly; never changes assurance invariants (review rounds, panel slot count, mutation gate threshold). Run-shape envelope locked at run start; active-run replay reads the recorded snapshot, not the live config.
- W3a multi-channel distribution: native binaries for darwin-{arm64,x64} + linux-{x64,arm64} built in CI via `bun build --compile`, fail-closed install script with SHA chain + tagged-release fetch, npm Node-launcher wrapper that downloads + SHA-verifies + caches at `~/.cache/code-oz/<version>/`, Homebrew formula template rendered into the `omerakben/homebrew-code-oz` tap at release time. Same `checksums.txt` source of truth across all three channels.

## What it is

> **Run coding agents through an auditable SDLC from your terminal.**

`code-oz` is a standalone terminal CLI that runs your favorite coding agents (Claude, Codex, Gemini, OpenCode, Roo Code) through a real software delivery lifecycle. It coordinates role-specialized agents over a hybrid phase-graph + agentic sub-orchestration spine with hard gates between phases, file-based state, and cross-family adversarial review.

The tool runs on the user's own Claude / Codex / Gemini CLI subscriptions (via SDKs that read CLI OAuth tokens from disk). No API keys required.

Product thesis: [`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`](docs/product/AI_SOFTWARE_COMPANY_THESIS.md). Tagline: *Run an AI software company from your terminal.* The market category is a repo-native agentic SDLC runtime; the AI software company framing is how we explain roles to humans.

## Phases

Greenfield: `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`.

Brownfield: `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Auto-detected on boot.

## Install

Three channels deliver the same single binary, verified against the same `checksums.txt`.

### curl | sh

```sh
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh \
  | sh -s -- --version v0.20.0-alpha.0
```

Installs to `~/.local/bin/code-oz`. Verifies the per-arch tarball SHA against `checksums.txt`. Prints a PATH hint if `~/.local/bin` is not on PATH.

The `--version <TAG>` flag is required in network mode (versioned asset names break the `/releases/latest/download/` redirect; API-based "latest" resolution lands in a future release).

### npm

```sh
npm install -g code-oz
```

The wrapper at `npm-wrapper/index.cjs` reads the package version, downloads the matching per-arch binary from the GitHub release on first invocation, SHA-verifies it, caches it at `~/.cache/code-oz/<version>/code-oz`, and execs it with the user's argv. No `bun` runtime dependency on the user's machine. No `postinstall` hook (survives `npm ci --ignore-scripts`).

### Homebrew

```sh
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
```

Per-arch URLs for `on_macos { on_arm | on_intel }` and `on_linux`. SHAs baked at formula render time from the release's `checksums.txt`.

### Platform support

- macOS arm64, macOS x64, Linux x64, Linux arm64.
- Windows + Scoop are deferred to v0.20.1.
- Apple Developer signing and GPG-signed checksums are deferred to a v0.x stable release; install.sh applies `xattr -d com.apple.quarantine` on macOS as the v0.20 alpha workaround.

## Try it from source

For local development or to run the included demo:

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
bun run build:binary

mkdir /tmp/code-oz-smoke && cd /tmp/code-oz-smoke
~/Projects/code-oz/dist/code-oz init
ls -la .code-oz/

~/Projects/code-oz/dist/code-oz doctor tools
```

See `docs/design/ROADMAP.md` for the milestone plan beyond v0.20.

## Demo

A 5-minute runnable end-to-end walkthrough lives in [`docs/demo/01-todo-cli/`](docs/demo/01-todo-cli/README.md). It drives one full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP cycle on a greenfield todo CLI example via the `FakeProvider`, with all 5 gate files, cross-family REVIEW (BUILD on Claude family, REVIEW on Codex family), `--effort` envelope captures at three levels, and the full `events.jsonl` ledger.

```sh
bun run demo:todo-cli                # default (balanced)
bun run demo:todo-cli --effort lite  # multiplier 0.4
bun run demo:todo-cli --effort beast # multiplier 6.0
```

Captured outputs from all three effort levels are committed under `docs/demo/01-todo-cli/output/` so you can read the produced artifacts without running anything.

## Influence library

Patterns are borrowed (not depended on) from: `agent-skills` (Markdown skill format + SDLC phase taxonomy), `opencode` (distribution + MCP), `Archon` (`IAgentProvider` + worktree isolation), `pi-mono` (streaming events), `maestro` (file-based gates, 3-source verification, Opus-default), `Auto-claude-code-research-in-sleep` (cross-family review loop), `claude-code` (plugin/skill/hook conventions), `byterover-cli` (consumer-first design + RED-first TDD).

See `docs/design/ROADMAP.md` for the full inheritance map.

## License

MIT — see `LICENSE`.
