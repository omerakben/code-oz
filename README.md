# code-oz

**CI-style gates for AI coding agents.**

`code-oz` runs coding agents through a repo-local delivery loop:

**DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP**

Use it when direct AI coding is too unconstrained and you want every change to pass through inspectable artifacts, approval gates, verification evidence, and independent review before it ships.

AI agents are fast. `code-oz` makes their work auditable. It is for risky repos, not fastest-loop coding.

[![Tests](https://github.com/omerakben/code-oz/actions/workflows/test.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)
[![Release](https://github.com/omerakben/code-oz/actions/workflows/release.yml/badge.svg)](https://github.com/omerakben/code-oz/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@tuel/code-oz.svg)](https://www.npmjs.com/package/@tuel/code-oz)
[![Homebrew](https://img.shields.io/badge/Homebrew-omerakben%2Fcode--oz-orange)](https://github.com/omerakben/homebrew-code-oz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/omerakben/code-oz/releases)
[![Tests passing](https://img.shields.io/badge/tests-3810%20passing-brightgreen)](https://github.com/omerakben/code-oz/actions/workflows/test.yml)

> **macOS note:** code-oz binaries are not yet Apple-Developer-signed (signing + notarization deferred to v0.x stable). Gatekeeper may prompt on first launch; the install script applies `xattr -d com.apple.quarantine` as a workaround, and `brew install` handles this automatically.

## What you get

- file-based phase gates you can inspect in the repo
- approvals bound to exact artifact SHA-256s
- isolated worktrees for agent changes
- an `events.jsonl` ledger for reconstructing what happened
- cross-family review so the builder and reviewer are not the same model family

Status: public alpha. The deterministic demo uses `FakeProvider` so you can inspect the lifecycle without spending tokens. FakeProvider proves lifecycle gates and ledger determinism, not model quality.

## Install

Three channels deliver the same single binary, verified against the same `checksums.txt`.

```sh
# curl | sh
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.21.1-alpha.0/install.sh \
  | sh -s -- --version v0.21.1-alpha.0

# npm (scoped under the TUEL AI publisher; binary still runs as `code-oz`)
npm install -g @tuel/code-oz

# Homebrew
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
```

Platform support: macOS arm64, macOS x64, Linux x64, Linux arm64. Windows and Scoop are deferred to a future distribution milestone.

If `npm install -g @tuel/code-oz` fails with a 404 or authentication error, your `~/.npmrc` is likely overriding the `@tuel` scope — see [`docs/TRUST.md` § Install gotchas](docs/TRUST.md#install-gotchas-npm-scope-routing-for-tuelcode-oz) for the fix.

## Why not just Claude Code or Codex?

Use Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Roo Code, or Aider directly when you want the fastest possible agent loop.

Use `code-oz` when you want a governed loop.

Direct-agent workflow:

1. Ask an agent to make a change.
2. Inspect the result.
3. Hope the prompt, tests, and review were enough.

`code-oz` workflow:

1. Define the task as an artifact.
2. Approve the artifact by SHA-256.
3. Build in an isolated worktree.
4. Verify evidence before review.
5. Require independent review.
6. Write a ledger of what happened.

`code-oz` is not trying to be a smarter coding model. It is the control layer around coding models.

## What is real today?

| Area             | Status                                                               |
| ---------------- | -------------------------------------------------------------------- |
| CLI commands     | `init`, `run`, `approve`, `doctor`                                   |
| Lifecycle        | `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` for greenfield runs |
| Gates            | File-based gates with schema validation                              |
| Approvals        | SHA-256-bound approval artifacts                                     |
| Isolation        | Worktree-per-run isolation                                           |
| Ledger           | `events.jsonl` audit trail                                           |
| Demo provider    | Deterministic `FakeProvider`                                         |
| Live providers   | Claude CLI, Codex CLI, and xAI HTTP adapter                          |
| xAI auth         | `XAI_API_KEY` env var                                                |
| Install channels | curl script, npm package, Homebrew tap                               |
| Platforms        | macOS arm64, macOS x64, Linux arm64, Linux x64                       |
| Tests            | 3812 offline tests (3810 pass, 2 live-gated skips)                  |

The provider contract is intentionally narrow. The alpha is about proving governed delivery, not supporting every agent on day one.

See [`docs/RECEIPTS.md`](docs/RECEIPTS.md) for verifiable evidence — real cross-family review transcripts that caught real bugs, plus event ledgers from gated runs.

## What is simulated or not ready yet?

| Area                           | Current state                                               |
| ------------------------------ | ----------------------------------------------------------- |
| FakeProvider demo              | Simulated model responses, real gates/artifacts/ledger      |
| Gemini                         | Stub provider in v0.1; not a working invocation adapter     |
| OpenCode / Roo Code            | Future adapter candidates, not v0.1 providers               |
| Brownfield AUDIT runtime       | Shipped in v0.21 (M17); proven by a deterministic full-cycle e2e, live brownfield smoke pending credentials |
| Windows / Scoop                | Deferred                                                    |
| Apple signing / notarization   | Deferred to v0.x stable; macOS may show Gatekeeper prompts  |
| GPG/Sigstore-signed checksums  | Deferred to v0.x stable                                     |
| Full benchmark proof           | Runner shipped in v0.21; `code-oz Fake` column measured, direct-agent and live columns pending credentials |
| Broad multi-agent consultation | Deferred                                                    |
| Cloud IAM adapters             | Deferred                                                    |

Do not use the alpha as proof that one model writes better code than another. Use it to inspect whether the governed lifecycle works.

## How is this different?

| Tool                       | Best for                                   | What `code-oz` adds                                                         |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Claude Code                | Fast terminal coding with Claude           | Repo-local gates, approvals, worktree isolation, ledger, independent review |
| Codex CLI                  | Fast terminal coding with OpenAI models    | Same governed lifecycle around Codex output                                 |
| Cursor                     | AI-native IDE workflow                     | External lifecycle governance outside the editor                            |
| Aider                      | Terminal-native git-integrated pair coding | Multi-phase artifacts and cross-family review                               |
| Gemini CLI / OpenCode / Roo Code | Direct AI coding loop                | Future adapter candidates; not supported in v0.1                            |
| Qodo / Sonar               | PR/code quality review                     | Earlier lifecycle gates before the PR review stage                          |
| HivePipe / Devin / Factory | Managed agentic SDLC or agent workforce    | Local-first, source-visible CLI runtime for owned repos                     |

Full footnote-sourced comparison: [`docs/comparisons/ai-coding-agents.md`](docs/comparisons/ai-coding-agents.md). Benchmark protocol and first measured rows (the deterministic `code-oz Fake` column): [`docs/benchmarks/agent-gate-bench.md`](docs/benchmarks/agent-gate-bench.md). Direct-agent and live-provider columns require local credentials and are not yet measured.

`code-oz` is not a replacement for coding agents. It is a governed delivery loop around them.

## Quick demo

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun run demo:todo-cli                # default (balanced)
bun run demo:todo-cli --effort lite  # multiplier 0.4
```

The demo runs one full lifecycle:

```txt
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Then inspect:

```sh
ls docs/demo/01-todo-cli/output/
cat docs/demo/01-todo-cli/output/balanced/events.jsonl | tail
```

The demo uses `FakeProvider`, so it is deterministic and token-free. The value is not that the fake model is smart. The value is that the same gates, approvals, worktree flow, and ledger mechanics are exercised every time.

## Failure demo

Governance only matters if bad runs get blocked. The failure-gates demo runs five deterministic scenarios:

```sh
bun run demo:failure-gates
```

| Failure                                          | Expected result                                  |
| ------------------------------------------------ | ------------------------------------------------ |
| Tampered approved artifact                       | Gate refuses because SHA-256 no longer matches   |
| BUILD output changes files outside allowed scope | Mutation gate blocks the run                     |
| VERIFY evidence fails                            | Run restarts or writes `NEEDS_INTERVENTION.json` |
| REVIEW uses same provider family as BUILD        | Cross-family review check refuses it             |
| Reviewer finds risky change                      | Run routes back to revision instead of SHIP      |

Walkthrough: [`docs/demo/02-failure-gates/`](docs/demo/02-failure-gates/README.md).

This is the demo to watch before trusting the tool.

## Who is this for?

Use `code-oz` if:

- you already use AI coding agents
- you work in repos where mistakes matter
- you want approval artifacts instead of chat transcripts
- you want to compare builder and reviewer model families
- you want a reproducible audit trail for AI-generated changes

Do not use `code-oz` yet if:

- you want the fastest possible one-shot code generation
- you need Windows support today
- you need a polished enterprise SaaS dashboard
- you need every provider family supported today
- you are not willing to run an alpha

## Provider setup

First-run CLI defaults to `FakeProvider` when no live provider is configured, so `code-oz init && code-oz run` can complete without spending provider tokens. Live Claude and Codex use their upstream CLI login sessions; xAI uses `XAI_API_KEY`. The separate `code-oz-gui` helper uses `GEMINI_API_KEY` for an in-app AI assistant; that key is not used by the CLI.

See [`docs/PROVIDER_SETUP.md`](docs/PROVIDER_SETUP.md) for the single provider setup table and [`docs/contracts/PROVIDERS.md`](docs/contracts/PROVIDERS.md) for the live / stub / future-candidate matrix.

## Try it from source

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz && bun install && bun test
bun run build:binary

mkdir /tmp/code-oz-smoke && cd /tmp/code-oz-smoke
~/Projects/code-oz/dist/code-oz init
~/Projects/code-oz/dist/code-oz doctor tools
```

## Trust and security

- Vulnerability reporting and artifact trust posture: [`SECURITY.md`](SECURITY.md)
- Data boundaries, install trust, and what is and is not logged: [`docs/TRUST.md`](docs/TRUST.md)

## Contributing

- Setup, tests, commit conventions, PR expectations: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Community standards: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## Changelog

Release notes and version history are tracked in [`CHANGELOG.md`](CHANGELOG.md).

## Roadmap

Public summary at [`docs/design/ROADMAP.md#now-next-later`](docs/design/ROADMAP.md#now-next-later). The detailed milestone inventory follows in the same file.

- **Now (v0.21.1-alpha.0)**: external-operator driving — an external autonomous agent can drive the gated runtime non-interactively while code-oz stays the gate authority and fails closed. Built on the v0.21.0 M17 brownfield AUDIT runtime, proven by a deterministic full-cycle e2e.
- **Next**: Phase 5 launch (essay, Show HN, thread) and an M18 SWE-bench Verified adapter (v0.22).
- **Later**: signed checksums, broader provider adapters, Windows/Scoop.

## How it works (architecture and historical context)

Read [`docs/ABOUT.md`](docs/ABOUT.md) for how the runtime actually works: the hybrid phase-graph and agentic sub-orchestration spine, the 23 non-negotiable rules that govern every gate, the product thesis, the influence library, and the project's historical "AI software company" framing.

## Star this repo if...

Star `code-oz` if you think AI coding agents need more than clever prompts:

- inspectable specs and plans
- test evidence before review
- independent model-family review
- tamper-evident approvals
- a ledger of what the agent did

Direct agents are fast. Governed agents are auditable.

## License

MIT. See [LICENSE](LICENSE).
