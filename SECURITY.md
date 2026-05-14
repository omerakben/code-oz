# Security policy

`code-oz` is a governance tool for AI-generated code. Trust in the lifecycle, the artifacts, and the binary itself is the product. This document tells you what we promise, what we do not promise yet, and how to report a vulnerability.

## Reporting a vulnerability

Email **security@tuel.ai** with the details:

- A clear description of the issue and the impact.
- A reproduction (steps, fixture, or a public commit hash).
- The release the issue affects (`code-oz --version` plus the install channel: curl, npm, Homebrew, source).

Alternatively, open a private vulnerability advisory at [github.com/omerakben/code-oz/security/advisories/new](https://github.com/omerakben/code-oz/security/advisories/new). The advisory stays private until the issue is fixed and a release is staged.

We aim to acknowledge within 3 business days and ship a fix or mitigation within 30 days for issues that affect the latest release line.

Do not open a public issue for a suspected vulnerability before it is fixed.

## Supported versions

| Version line | Status |
|---|---|
| `v0.20.x-alpha` | Latest alpha. Security fixes ship on the next alpha (`v0.20.x+1-alpha.0`). |
| Older `v0.x-alpha` | Unsupported. Upgrade to the latest line. |

Public alpha caveat: any release in the `v0.x-alpha` line is not a stable security guarantee. The trust posture below describes the alpha contract; production hardening lands at `v0.x stable`.

## Artifact trust posture

Every release on [github.com/omerakben/code-oz/releases](https://github.com/omerakben/code-oz/releases) ships:

- One per-architecture binary (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`).
- A `checksums.txt` file with SHA-256 for each binary.
- The install script (`scripts/install.sh`) and the npm wrapper (`npm-wrapper/index.cjs`) both verify against this checksum chain.

### What is verified today

- **SHA-256 of every downloaded binary** against `checksums.txt`. The install script and npm wrapper both refuse to install if the verification fails.
- **No `postinstall` hook in the npm package.** The package survives `npm ci --ignore-scripts`. On first run the wrapper downloads + verifies the binary, then caches it at `~/.cache/code-oz/<version>/code-oz`.
- **Same SHA across all three channels.** The curl-installed binary, the npm-downloaded binary, and the Homebrew-installed binary on the same architecture for the same version are the identical file with the identical SHA. `checksums.txt` is the single source of truth.

### What is NOT verified yet (deferred to `v0.x stable`)

- **Apple Developer signing and notarization.** The macOS binary is unsigned today. Gatekeeper may prompt on first launch. The install script applies `xattr -d com.apple.quarantine` as the alpha workaround; `brew install` handles this automatically.
- **GPG-signed or Sigstore-signed `checksums.txt`.** The checksum chain protects against accidental corruption and tarball swaps, but not against a determined supply-chain attacker who can also write to the release. Cryptographic signing of `checksums.txt` lands at `v0.x stable` per the roadmap.
- **SLSA provenance attestation.** Build provenance is not yet attested. Lands alongside Sigstore signing.

Track the signing milestone at [`docs/design/ROADMAP.md`](docs/design/ROADMAP.md) under "Later".

## Provider auth boundaries

`code-oz` orchestrates upstream coding agents. The auth model for each provider is bounded:

| Provider | Auth source | What code-oz sees |
|----------|-------------|-------------------|
| Claude   | Claude Max OAuth via the Claude Code CLI subprocess | code-oz never reads or transmits the OAuth token. Auth lives in `~/.claude/auth.json` (or the OS credential store) and is handled by the `claude` CLI subprocess. |
| Codex    | ChatGPT Plus/Pro OAuth via the Codex CLI subprocess | Same pattern. Auth lives in `~/.codex/auth.json` and is handled by the `codex` CLI subprocess. |
| xAI      | Direct HTTPS with `XAI_API_KEY` environment variable | code-oz reads the env var, attaches it to the outgoing `Authorization` header, and redacts it from every artifact-producing path (`events.jsonl`, gate files, doctor output, error messages, request and response logs). The redaction discipline is implemented at `src/providers/xai.ts` (`redactSecrets`) and is required by every adapter that touches an HTTP path. |
| Fake     | None (built-in deterministic adapter)               | No network, no spend, no auth state. |

The Gemini stub takes no auth (it throws on invocation). OpenCode and Roo Code are future adapter candidates and do not exist in v0.1.

## What is logged and what is not

The `events.jsonl` ledger records every gate transition, every provider invocation, every approval, and every intervention. It is the primary audit primitive.

### Logged

- Phase entries and exits (`phase_entered`, `phase_completed`).
- Provider invocation requests at the manifest level (which agent, which provider, which phase, which files in the explicit manifest).
- Gate writes (`gate_passed`, `gate_failed`, `intervention_written`).
- Cost telemetry (tokens estimated, tokens used when reported by the provider, wall-clock duration).
- Approvals (`approval_recorded` with the SHA-256 of the approved artifact).

### NOT logged

- Provider auth credentials (API keys, OAuth tokens, session cookies). The redaction discipline strips these before serialization at every layer.
- Raw provider response bodies. Only the structured `ProviderEvent` stream is recorded; the underlying HTTP body is not persisted.
- File contents outside the explicit `ProviderRequest.files` manifest. The orchestrator never silently sends recursive repo context.

The boundary is reinforced at [`docs/TRUST.md`](docs/TRUST.md), which describes the data leaving the repo, what the install channels do or do not phone home, and how to inspect the artifacts after a run.

## Threat model (alpha-honest)

`code-oz` defends against:

- **Tampered approval artifacts.** SHA-256-bound approvals refuse to advance the lifecycle if the artifact bytes change after approval.
- **Scope escape from BUILD output.** The mutation gate refuses BUILD output that writes files outside the per-run worktree's allowed paths.
- **Same-family rubber-stamp review.** Cross-family review policy refuses a REVIEW call where the reviewer family equals the builder family.
- **Provider credential leakage into artifacts.** Redaction discipline at every artifact-producing path.

`code-oz` does NOT defend against:

- A compromised upstream coding agent or its provider account. If your Claude Code CLI is compromised, code-oz's lifecycle gates do not save you.
- A compromised release publisher. Until cryptographic signing of `checksums.txt` lands at `v0.x stable`, a determined supply-chain attacker with release-write access can publish a malicious tarball with a malicious checksum.
- Malicious code inside the user's own repo. code-oz orchestrates lifecycle; it does not statically analyze the contents of files the user already controls.

## Public alpha disclaimer

This is an alpha release line. The mechanisms described above work as documented and are tested (3395 offline tests, opt-in live-provider tests via `CODE_OZ_LIVE_PROVIDER_TESTS=xai`). The release itself is not yet hardened to production signing or provenance standards. Do not use `v0.x-alpha` as the sole control for code that goes to production without an additional review layer.

Track the signing and provenance milestones at [`docs/design/ROADMAP.md`](docs/design/ROADMAP.md).
