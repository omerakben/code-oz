# code-oz

Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.

[![Tests](https://github.com/omerakben/code-oz/actions/workflows/test.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)
[![Release](https://github.com/omerakben/code-oz/actions/workflows/release.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@tuel/code-oz.svg)](https://www.npmjs.com/package/@tuel/code-oz)
[![Homebrew](https://img.shields.io/badge/Homebrew-omerakben%2Fcode--oz-orange)](https://github.com/omerakben/homebrew-code-oz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/omerakben/code-oz/releases)
[![Tests passing](https://img.shields.io/badge/tests-3366%20passing-brightgreen)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)

> **macOS note:** code-oz binaries are not yet Apple-Developer-signed (signing + notarization deferred to v0.x stable). Gatekeeper may prompt on first launch; the install script applies `xattr -d com.apple.quarantine` as a workaround, and `brew install` handles this automatically.

## Install

Three channels deliver the same single binary, verified against the same `checksums.txt`.

```sh
# curl | sh
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh \
  | sh -s -- --version v0.20.0-alpha.0

# npm (scoped under the TUEL AI publisher; binary still runs as `code-oz`)
npm install -g @tuel/code-oz

# Homebrew
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
```

Platform support: macOS arm64, macOS x64, Linux x64, Linux arm64. Windows + Scoop are deferred to v0.20.1.

## What it is

`code-oz` is a standalone terminal CLI that runs your favorite coding agents (Claude, Codex, Gemini, OpenCode, Roo Code) through a real software delivery lifecycle. It coordinates role-specialized agents over a hybrid phase-graph + agentic sub-orchestration spine with hard gates between phases, file-based state, and cross-family adversarial review. The tool runs on the user's own Claude / Codex / Gemini CLI subscriptions (via SDKs that read CLI OAuth tokens from disk). No API keys required for the supported families.

Phases (greenfield): `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Phases (brownfield): `AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP`. Auto-detected on boot.

## Demo

A 5-minute runnable end-to-end walkthrough lives in [`docs/demo/01-todo-cli/`](docs/demo/01-todo-cli/README.md). One full DEFINE → SHIP cycle on a greenfield todo CLI via `FakeProvider`, all 5 gate files, cross-family REVIEW (BUILD on Claude family, REVIEW on Codex family), `--effort` envelope captures at three levels, and the full `events.jsonl` ledger. Captured outputs at all three effort levels are committed under `docs/demo/01-todo-cli/output/` so you can read the produced artifacts without running anything.

```sh
bun run demo:todo-cli                # default (balanced)
bun run demo:todo-cli --effort lite  # multiplier 0.4
bun run demo:todo-cli --effort beast # multiplier 6.0
```

## Try it from source

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz && bun install && bun test
bun run build:binary

mkdir /tmp/code-oz-smoke && cd /tmp/code-oz-smoke
~/Projects/code-oz/dist/code-oz init
~/Projects/code-oz/dist/code-oz doctor tools
```

## Status

`v0.20.0-alpha.0` — first release with official install channels (curl|sh, npm, Homebrew). 3366 tests pass offline; live xAI integration gated behind opt-in env flags.

See [`docs/ABOUT.md`](docs/ABOUT.md) for the milestone inventory, product thesis, influence library, and architecture deep-dive. The milestone plan beyond v0.20 lives in [`docs/design/ROADMAP.md`](docs/design/ROADMAP.md).

## License

MIT. See [LICENSE](LICENSE).
