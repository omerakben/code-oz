---
session: W3a R1 implementation review
status: pending Codex invocation
inputs: 6 W3a impl commits + v0.20 release-prep commit + 51 new tests
authoritative-contract: docs/design/CODEX_SYNTHESIS_W3A.md
prior-session: docs/handoffs/2026-05-12-w3a-continuation.md
expected-verdict: push | fix-first | debate-required
codex-model: gpt-5.5
codex-effort: xhigh
codex-sandbox: read-only (R1)
---

# Codex R1 briefing — W3a multi-channel distribution sweep

The W3a synthesis (`docs/design/CODEX_SYNTHESIS_W3A.md`, Codex thread
`019e18e9`) locked a 6-commit (later 7-commit) implementation plan to
ship v0.20.0-alpha.0's distribution surface. Implementation completed
in one session post-W3a-impl-1. This R1 round is the locked
"implementation completion" review before tag + publish.

## What landed

7 commits since origin/main HEAD `880b0d0` (asciicast + handoff):

| SHA | Subject |
|---|---|
| 6bbb1b9 | feat(install): W3a impl 2 — fail-closed SHA chain + Linux detection + --version flag |
| 564398c | ci(workflows): W3a impl 3 — first project CI (test + release.yml) |
| cced765 | feat(install): W3a impl 4 — network-mode fetch via tagged release URL |
| 76ff91e | feat(npm): W3a impl 5 — Node launcher (npm-wrapper/index.cjs) |
| 22de771 | feat(homebrew): W3a impl 6 — formula template + tap setup doc |
| d9d77b7 | chore(release): W3a impl 7 — bump to 0.20.0-alpha.0 + release notes |

## Scope deviations from the locked synthesis

Three deviations to verify or call:

1. **One extra commit (synthesis projected 6 implementation commits; we
   landed 7).** Synthesis commit #2 (install.sh hardening incl. tagged
   URL) was split into impl 2 (SHA chain + Linux + flag scaffolding)
   and impl 4 (network-mode fetch). Reason: rule 22 consumer-first +
   RED-first TDD — the network-mode consumer needed the per-arch
   artifact contract (impl 3 release.yml) before its failing tests
   could land. Sequence: impl 2 (hardens existing) → impl 3 (defines
   artifact contract) → impl 4 (consumes new contract).

2. **Version surface count: 6 vs synthesis's 7.** Synthesis projected
   "all 7 version surfaces touched in tag commit" (6 + npm-wrapper
   version literal). The wrapper instead reads `../package.json` at
   runtime — eliminates a 7th surface and any tag-time straggler risk.
   See `npm-wrapper/index.cjs:readPackageVersion`.

3. **install.sh network-mode requires `--version <TAG>` (no implicit
   "latest" resolution).** The synthesis acceptance says "curl|sh
   works on macOS arm64"; this requires either `--version v0.20.0-alpha.0`
   on the invocation OR a GitHub API call to resolve `latest`. The
   versioned asset naming locked in the synthesis matrix
   (`code-oz-v${VER}-${OS}-${ARCH}.tar.gz`) is incompatible with the
   `/releases/latest/download/<asset>` redirect (asset names embed
   version). Decision: require explicit `--version` for v0.20 alpha;
   `latest` resolution via API parsing is a v0.x stable polish.
   `scripts/install.sh:fetch_release_bundle` enforces the requirement
   with a fail-closed `--version <TAG> is required` message.

## What to review

Codex, please assess the cumulative sweep against the synthesis lock
and the project's non-negotiable rules. Specific lenses:

### Rule 22 (consumer-first + RED-first TDD)

Each behavior change should have a failing test that landed before the
implementation. The 51 net new tests split:

- 13 (impl 2): SHA chain branches, Linux detection, CLI flag plumbing
- 13 (impl 3): CI workflow structural assertions
- 6 (impl 4): network-mode fetch (file:// release store fixture)
- 7 (impl 5): npm wrapper cache hit/miss/SHA-mismatch
- 12 (impl 6): Homebrew formula template structure

Spot-check: are the failing tests narrow enough to fail for the right
reason on RED? Are there branches that lack a behavioral test?

### Rule 9 (permission manifest for executable runners)

`scripts/install.sh` runs as a user-facing shell script and downloads
+ executes a native binary. Does its surface need entry in any
runner-permission manifest? (Likely not, since install.sh is invoked
by the user on their own machine, not by the orchestrator. Confirm.)

### Rule 1 (file-based gate signals only)

No new gate writes in this sweep — install + npm + Homebrew live
outside the orchestrator's phase loop. Confirm none of the new code
paths can mutate `.code-oz/state/runs/*` or write gate files.

### Workflow injection hardening

`.github/workflows/release.yml` binds every `github.*` and `matrix.*`
context value through `env:` blocks before referencing it in `run:`
scripts. Audit for any direct `${{ ... }}` splicing inside `run:`.

### SHA chain ordering

`scripts/install.sh:sha_tool` resolves sha256sum → shasum → openssl.
The npm wrapper uses Node's crypto.createHash (no chain — single
in-process implementation). The Homebrew formula's sha256 verification
is Homebrew's built-in (Ruby `sha256` DSL). All three channels verify
against the same `checksums.txt`. Audit for consistency in
fail-closed behavior.

### Network-mode fetch contract

install.sh + npm wrapper both fetch from a tagged release URL:
- install.sh: `${CODE_OZ_RELEASE_BASE_URL}/${asset}` (default GitHub release)
- npm wrapper: `${CODE_OZ_NPM_BASE_URL}/${asset}` (same default)

Both verify SHA against `checksums.txt` published alongside. Both
fail-closed on missing entry or mismatch. The Homebrew formula gets
SHAs baked at render time (manual sed substitution per
`docs/homebrew/README.md`). Audit: is there any code path that
silently weakens this contract?

### Per-arch tarball layout

`release.yml` stages each per-arch tarball as
`code-oz-v${VERSION}-${OS}-${ARCH}/{code-oz, install.sh, manifest.json, README.md}`.
install.sh's network-mode extraction expects this exact layout
(`extracted_dir/manifest.json` lookup at
`scripts/install.sh:fetch_release_bundle`). Same for npm wrapper
(`npm-wrapper/index.cjs:ensureBinary`). If `release.yml` ever changes
the staging layout, the two consumers must change in lockstep. Flag
this as a coupling concern if relevant.

### Test infrastructure

The file:// URL test seam is used by both install.sh and npm wrapper
tests. Real curl + real tar run against a local release store;
nothing is mocked except the BASE_URL. Audit: is the seam too thin
(does it skip a real bug class), or right-sized?

### Release notes accuracy

`docs/design/RELEASE_NOTES_v0.20.0-alpha.0.md` enumerates landed
commits, deferred items, and the push sequence. Spot-check the
publish-sequence step ordering — synthesis is explicit that npm
publish must come AFTER GitHub release publish (because the wrapper
downloads from the release on first invocation). Confirm.

## What's locked and should NOT be re-litigated

Per the synthesis (`docs/design/CODEX_SYNTHESIS_W3A.md`):

- npm path-(c) Node binary wrapper (not source-via-bun, not
  postinstall-download).
- 4-target matrix; Windows + Scoop deferred to v0.20.1; Apple
  Developer signing + GPG-signed checksums deferred to v0.x stable.
- Per-arch tarball naming `code-oz-v${VER}-${OS}-${ARCH}.tar.gz`.
- install.sh + npm wrapper + Homebrew formula consume the same
  `checksums.txt`.
- One bumped-versions chore (not amended onto an earlier commit).

## Verdict shape

Please return one of:

- **push** — sweep is shippable as-is, proceed to tag + release.
- **fix-first** — enumerate findings by severity (block-push,
  fix-soon, nit, fyi). block-push items get a follow-up commit
  (NEVER amended) before R2.
- **debate-required** — fundamental disagreement with the synthesis
  or the sweep's interpretation of it. Open a debate round.

## Test summary

`bun test` → 3353 pass / 0 fail / 2 skip. Typecheck silent.

Live xAI tests stay opt-in (`CODE_OZ_LIVE_PROVIDER_TESTS=xai`); the
new `test.yml` workflow leaves that env unset so CI runs the offline
suite only.

## How to invoke

```sh
# From the repo root:
codex --model gpt-5.5 --reasoning-effort xhigh --sandbox read-only \
  --task "Review the 7-commit W3a distribution sweep on local main \
  per docs/design/CODEX_BRIEFING_W3A_R1.md. Return verdict + findings."
```

Or via the MCP tool with sandbox `read-only`. R2 (post-fix-first
closure) uses sandbox `workspace-write` if Codex needs to verify
local repo state after fixes.
