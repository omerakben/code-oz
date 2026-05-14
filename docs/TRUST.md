# Trust model

`code-oz` is a tool that mediates between you, your repo, and one or more upstream coding agents. Trust in the tool is the product. This document describes, in detail, what data leaves your machine, what the install channels do or do not phone home, what the orchestrator records and where, and what the alpha does NOT yet guarantee.

[`SECURITY.md`](../SECURITY.md) is the policy face (vulnerability reporting, supported versions, threat model). This document is the mechanics face (data boundaries, artifact provenance, install trust, log payloads).

## Data boundaries

### What leaves the repo on a provider call

When a phase invokes an upstream provider (Claude, Codex, xAI), `code-oz` sends:

1. **The persona prompt** — the agent's `.md` file plus any imported universal rules.
2. **The explicit `ProviderRequest.files` manifest** — only files the agent's frontmatter declared, intersected with the run's per-phase permissions. The orchestrator never silently sends recursive repo context.
3. **The phase contract** — a small set of structured fields (phase id, run id, prior-artifact pointers).
4. **The provider auth credential** — handled differently per adapter (see § "Provider auth boundaries" below).

Nothing else. `code-oz` does not:

- Walk the repo for "context" outside the manifest.
- Send `git log`, `git diff`, branch state, or working-tree state outside the manifest.
- Send environment variables (other than the explicit per-provider key).
- Send `.code-oz/state/` artifacts to the upstream provider (those stay local).
- Send files outside the agent's `permissions.read` allowlist (the loader rejects an agent that declares files outside its declared permissions).

The provider-send path enforced at `src/providers/manifest.ts` is: explicit `ProviderRequest.files`, path safety (no `..`, no symlink escapes), and the agent's `permissions.read`. There is NOT a universal `.gitignore` filter on the provider-send path today; the `.gitignore` discipline applies to the repo-context tools (`tool_use.repo_context`) where it is wired, not to every send. If you need a file specifically excluded from agent invocations, list it in the agent's `permissions.read` denylist or move it outside the agent's allowed roots. A universal `.code-ozignore` is on the roadmap; until it ships, `permissions.read` is the contract.

### What stays on disk

Every provider call produces a structured event that lands in `events.jsonl`. Every gate transition writes a small JSON file under `.code-oz/state/runs/<run-id>/`. Both are local and never transmitted to a third party by `code-oz` itself.

### What the binary does at runtime

The compiled `code-oz` binary:

- Reads files and writes files inside the working directory and the per-run worktree.
- Spawns subprocesses (`claude`, `codex`) when the persona's provider is `claude` or `codex`.
- Makes HTTPS requests to `api.x.ai` when the persona's provider is `xai` and `XAI_API_KEY` is set.
- Does NOT phone home to any code-oz-controlled endpoint. There is no telemetry server, no usage analytics, no crash reporter.

### What the install channels do at install time

| Channel | Network behavior at install |
|---|---|
| curl install script | Downloads the per-arch binary tarball + `checksums.txt` from the GitHub release; verifies SHA-256; installs to `~/.local/bin/code-oz`. |
| npm (`@tuel/code-oz`) | Installs the wrapper package (~10 KB). NO `postinstall` hook. The binary is downloaded + SHA-verified + cached at `~/.cache/code-oz/<version>/code-oz` on the FIRST RUN, not at install time. Survives `npm ci --ignore-scripts`. |
| Homebrew (`omerakben/code-oz`) | Standard Homebrew flow: downloads the per-arch binary URL listed in the formula; verifies the SHA baked into the formula at render time. |
| Built from source | No network at install time. `bun install` resolves the few dev dependencies from npm (yaml, types, typescript). |

The npm wrapper's first-run download contacts `github.com` (release asset) once per version per machine. The cached binary is reused for every subsequent invocation.

## Artifact trust

`code-oz` produces artifacts at every phase. Trust in those artifacts is mechanically enforced:

### SHA-256-bound approvals

When you run `code-oz approve <phase>`, the tool reads the phase's primary artifact (e.g., `PLAN.md`), computes its SHA-256, and writes a `GATE_<PHASE>_PASSED.json` that names both the artifact path and its SHA. The next phase's preflight refuses to advance if the artifact's bytes have changed since approval. Tampered approvals are not silent — they surface as `NEEDS_INTERVENTION.json` with the exact hash mismatch.

### Worktree-per-run isolation

Every run gets its own git worktree under `.code-oz/state/runs/<run-id>/worktree/`. BUILD output writes there, not into your main working tree. Mutation gates refuse output that escapes the per-run worktree boundary. You can compare the run's worktree to your main branch with regular `git diff` before promoting the change.

### `events.jsonl` ledger

Every gate transition, every provider invocation (at the manifest level), every approval, every intervention is appended to `.code-oz/state/runs/<run-id>/events.jsonl` as a structured JSON line. The ledger is the audit primitive: a third party can reconstruct a run's lifecycle by reading the ledger plus the per-phase artifacts. The ledger is local; nothing transmits it.

### Cross-family REVIEW policy

If your config places BUILD and REVIEW on the same provider family (e.g., both anthropic), `requestReview()` at the REVIEW gate refuses. The cross-family policy is mechanical, not advisory.

## Install trust

### What is verified today

- **SHA-256 of every downloaded binary** against `checksums.txt` published with each release.
- **Same SHA across all three install channels.** The curl-installed binary, the npm-downloaded binary, and the Homebrew-installed binary on the same architecture for the same version are byte-identical.
- **No npm postinstall hook.** The package survives `npm ci --ignore-scripts`. The wrapper downloads and verifies the binary on first run, not at install.
- **redirect cap** in the npm wrapper. The download path follows at most a small bounded number of redirects, then refuses.

### What is NOT verified yet

The alpha does not yet ship:

- **Apple Developer signing and notarization.** macOS binaries are unsigned. Gatekeeper may prompt; the install script applies `xattr -d com.apple.quarantine` as the workaround; `brew install` handles this automatically.
- **GPG or Sigstore signing of `checksums.txt`.** The checksum chain protects against accidental tarball corruption and casual tampering, but not against a determined attacker who can also write to the GitHub release.
- **SLSA build provenance.** The release workflow is reproducible via the public GitHub Actions logs, but no provenance attestation is published yet.

All three land at the `v0.x stable` milestone. Until then, treat the alpha install channels as honest-but-not-cryptographically-attested.

### Install gotchas: npm scope routing for `@tuel/code-oz`

`@tuel/code-oz` is published on public npm under the `@tuel` scope. If your `~/.npmrc` (or a project-local `.npmrc`) registers a custom registry for the `@tuel` scope — for example, a private registry from a different `@tuel`-scoped package at a previous employer — `npm install -g @tuel/code-oz` routes to that registry instead of public npm. The install fails with a 404 or an authentication error, not with a useful "scope is overridden" message.

Check your scope routing before installing:

```sh
npm config get @tuel:registry
```

If the output is anything other than `https://registry.npmjs.org/` (or the literal string `null`), the scope is overridden. Two options:

1. Per-command override (preferred, leaves your config untouched):

   ```sh
   npm install -g @tuel/code-oz --registry=https://registry.npmjs.org/
   ```

2. Remove the override if you no longer need it:

   ```sh
   npm config delete @tuel:registry
   ```

The Homebrew tap (`omerakben/code-oz`) and the curl install script do not touch npm scope routing and are unaffected.

This trap is operational, not cryptographic — the eventual binary still SHA-verifies normally on first run via the npm wrapper. The trap only blocks the install from completing.

## Provider auth boundaries

| Provider | Auth source | Where the credential lives | What `code-oz` reads or transmits |
|----------|-------------|----------------------------|------------------------------------|
| Claude   | Claude Max OAuth via Claude Code CLI subprocess     | `~/.claude/auth.json` (handled by `claude` CLI; OS credential store on some platforms) | `code-oz` spawns `claude --print` as a subprocess. The OAuth token is NEVER read by `code-oz` itself. |
| Codex    | ChatGPT OAuth via Codex CLI subprocess              | `~/.codex/auth.json` (handled by `codex` CLI) | `code-oz` spawns `codex exec` as a subprocess. The OAuth token is NEVER read by `code-oz` itself. |
| xAI      | Direct HTTPS with `XAI_API_KEY` env var             | Your shell environment / `.env` file | `code-oz` reads the env var at invoke time, attaches it to the outgoing `Authorization` header, and redacts it from every artifact-producing path. |
| Fake     | None                                                | n/a                                  | No auth, no network, no spend. |

The Gemini stub takes no auth (it throws on invocation). OpenCode and Roo Code are future adapter candidates and do not exist in v0.1; see [`docs/contracts/PROVIDERS.md`](contracts/PROVIDERS.md) for the canonical provider matrix.

### Redaction discipline

API keys must NEVER appear in:

- `events.jsonl` payloads
- `GATE_*.json`, `NEEDS_INTERVENTION.json`, `STOP.json`, or `PAUSE.json` payloads
- `code-oz doctor` output
- `ProviderError` messages or stack traces
- `ProviderRequest` or `ProviderResponse` logs

The redaction is implemented at the adapter (`src/providers/xai.ts` (`redactSecrets`) for xAI). The discipline is a property of every artifact-producing path that touches an HTTP adapter, not of the adapter alone. The redaction test (`tests/providers-xai-redaction.test.ts`) is the regression guard.

## What is logged

Per-run, under `.code-oz/state/runs/<run-id>/`:

- `events.jsonl` — append-only ledger of every gate transition, provider invocation (manifest level), approval, and intervention.
- `gates/` — one JSON file per gate transition (`GATE_DEFINE_PASSED.json`, etc.).
- `artifacts/` — the produced markdown artifacts for each phase (`SPEC.md`, `PLAN.md`, `BUILD_REPORT.md`, `VERIFY.md`, `REVIEW.md`).
- `worktree/` — the per-run git worktree where BUILD output lands.

Per-run, when something blocks:

- `NEEDS_INTERVENTION.json` — when the orchestrator needs human input to continue.
- `STOP.json` — when the run is fatally blocked.
- `PAUSE.json` — when the user asks for a pause.

## What is NOT logged

- Provider auth credentials (API keys, OAuth tokens, session cookies).
- Raw provider HTTP response bodies (only the structured `ProviderEvent` stream is recorded).
- File contents outside the explicit `ProviderRequest.files` manifest.
- Working-tree state outside the per-run worktree.
- Any user-identifying telemetry. There is no analytics pipeline.

## How to inspect what happened

After a run, the easiest way to verify what `code-oz` did:

```sh
# What gate transitions happened, in order?
cat .code-oz/state/runs/<run-id>/events.jsonl | jq -c .

# What was approved with what SHA?
cat .code-oz/state/runs/<run-id>/gates/GATE_*.json | jq

# What did BUILD produce?
git -C .code-oz/state/runs/<run-id>/worktree log --oneline
git -C .code-oz/state/runs/<run-id>/worktree diff main
```

Everything is local, in plain JSON or markdown. There is no opaque database, no remote service to query.

## What we do NOT promise (alpha)

- **No defense against a compromised upstream provider.** If your Claude Code CLI is compromised, code-oz's lifecycle gates do not save you.
- **No defense against a compromised release publisher.** Until cryptographic signing of `checksums.txt` lands at `v0.x stable`, a determined supply-chain attacker with release-write access can publish a malicious tarball with a matching malicious checksum. The integrity guarantee is "the binary you got matches the SHA published with the release"; not "the SHA was published by an authorized signer."
- **No defense against malicious code in your own repo.** code-oz orchestrates lifecycle; it does not statically analyze the contents of files you already control.
- **No production-hardened release line.** This is a public alpha. Treat it as such.

## Roadmap

The signing, provenance, and SBOM milestones live at [`docs/design/ROADMAP.md`](design/ROADMAP.md) under "Later". Signing the checksum file is the highest-priority hardening item.
