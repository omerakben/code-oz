# Contributing to code-oz

Thanks for your interest in `code-oz`. This guide covers the setup, the test discipline, the commit and PR conventions, and the cross-model review rule that every substantive change passes through.

`code-oz` is a public alpha. Contributions that sharpen the truth, fix bugs, add deterministic tests, harden the install channels, or improve docs are very welcome. Contributions that add new gate authority, new providers, or new milestones need to land via the milestone process described in [`docs/design/ROADMAP.md`](docs/design/ROADMAP.md) and the [`CLAUDE.md`](CLAUDE.md) non-negotiables — open a discussion first.

## Local setup

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
```

Requirements:

- **Bun 1.3.0 or newer** (`bun --version`). The repo's lock file is Bun's; `npm` and `pnpm` are not supported for local development.
- **Node 18 or newer** for the npm wrapper smoke (`node --version`).
- macOS arm64, macOS x64, Linux x64, or Linux arm64. Windows local development is not currently supported (the npm wrapper and binaries are Unix-only).

The full offline test suite runs in under 30 seconds on a recent machine and should report `3395 pass / 0 fail / 2 skip` against `main`. The two skipped tests are the opt-in live-provider tests described below.

## Test discipline

### Offline by default

Every test in `tests/` runs offline against `FakeProvider`. No live LLM call, no network egress, no provider credentials. CI does not have provider credentials and must stay green.

```sh
bun test               # full suite
bun test --watch       # iterative loop
bun test path/to/file  # one file
```

### Opt-in live-provider tests

A small number of tests exercise a real live provider (today only xAI). They are gated behind two env vars and skipped by default:

```sh
export CODE_OZ_LIVE_PROVIDER_TESTS=xai
export CODE_OZ_LIVE_XAI_MODEL=grok-2-1212  # or another supported variant
export XAI_API_KEY=...                      # your xAI key
bun test tests/providers-xai-live.test.ts
```

Live-provider tests must:

- Remain opt-in (skipped when env flags are missing).
- Cost less than $0.50 per full run.
- Be deterministic against the live provider's documented response contract; if the provider drifts, the test reports the drift, not a flaky failure.

### RED-first for behavior changes

Any change that alters runtime behavior (a new gate, a new provider error code, a new artifact field, a new CLI flag that changes a decision) follows **rule 22** from `CLAUDE.md`: write the failing test first, run it to confirm it fails for the right reason, then write the minimal implementation, then run the test again to confirm it passes. The detailed sequence lives in `src/agents/defaults/builder.md`.

Pure documentation changes, dependency bumps that pass existing tests, and refactors that preserve external behavior are exempt from RED-first.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): one-line subject

Optional body explaining what changed and why.
References to design docs or Codex review threads in the body.
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.

Common scopes: `readme`, `providers`, `gates`, `cli`, `demo`, `package`, the milestone identifier (`m17`, `w3a`), or a directory.

### What NOT to put in commits

- **No emojis** in commit messages, code, or PR descriptions.
- **No `Co-Authored-By: Claude` footers** unless the contributor explicitly requested them.
- **No squash-commit messages with raw model output.** Edit the message before committing.
- **No secret material** (API keys, tokens, customer data, internal hostnames) anywhere in the diff or message.

### Branch naming

- `feat/<scope>-<topic>` for new features
- `fix/<scope>-<topic>` for bug fixes
- `refactor/<scope>-<topic>` for refactors
- `docs/<scope>-<topic>` for docs-only changes
- `test/<scope>-<topic>` for test-only additions

`main` is tag-only. Pushes to `main` happen at release time.

## Pull request expectations

### The basics

- One coherent change per PR. If the PR description grows past three bullet points, consider splitting.
- Tests pass locally (`bun test`) before opening the PR.
- The PR template (`.github/pull_request_template.md`) walks you through the checklist: summary, files changed, testing, breaking-change flag.
- Link any relevant design doc, GitHub issue, or Codex review thread in the description.

### Cross-model peer review (substantive changes only)

The project enforces a **cross-model peer review** discipline for changes that touch the orchestrator spine, the provider contract, the gate machinery, the CLI surface, or the release workflow. The discipline is named in [`CLAUDE.md`](CLAUDE.md):

1. **Planning convergence**: write a `docs/design/CODEX_BRIEFING_<topic>.md`, dispatch it to Codex with `model: gpt-5.5` and `sandbox: read-only`, capture the response, and synthesize before any code lands.
2. **Implementation completion**: dispatch Codex again on the implementation commit. Codex returns one of `push` / `fix-first` / `debate-required`. Block-push findings close in a follow-up commit before the PR merges.

Pure documentation changes, typo fixes, and dependency bumps that pass existing tests do not require the Codex review pass.

If you are unsure whether your change is "substantive": open a draft PR and ask. The maintainers will tag it `cross-review-needed` or `cross-review-skip`.

## Provider test policy

When adding a new provider adapter or modifying an existing one:

1. **Stub coverage first.** Add a unit test that exercises the adapter through `FakeProvider` (or with the adapter's HTTP path mocked at the fetch boundary). This keeps CI offline.
2. **Live-provider test gated by env vars.** Add a separate file under `tests/providers-<name>-live.test.ts` that runs only when `CODE_OZ_LIVE_PROVIDER_TESTS` includes the provider id. Document the env-var contract at the top of the file.
3. **Redaction test required.** Every HTTP adapter must include a test that verifies API keys never appear in serialized `events.jsonl`, error messages, or `NEEDS_INTERVENTION.json` payloads. Pattern at `tests/providers-xai-redaction.test.ts`.

## What to expect after opening a PR

- A maintainer triages within a few days. Triage adds labels and may ask for clarification.
- Substantive PRs get a Codex review pass (see above). The review verdict is recorded in the PR conversation.
- Block-push findings close in a follow-up commit on the PR branch before merge.
- The merge strategy is squash-merge to `finalize/<release>` branches or rebase to feature branches. `main` only receives release tags.

## Code of conduct

Participation in this project is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Be excellent to one another.

## Questions

Open a discussion at [github.com/omerakben/code-oz/discussions](https://github.com/omerakben/code-oz/discussions) for design questions, "is this the right approach" questions, and roadmap discussions.

Open an issue at [github.com/omerakben/code-oz/issues](https://github.com/omerakben/code-oz/issues) for confirmed bugs, install problems, demo failures, and concrete feature requests. The four issue templates will guide you.

For security issues, see [`SECURITY.md`](SECURITY.md).
