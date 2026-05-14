# code-oz vs other AI coding tools

This page exists because every developer who finds `code-oz` immediately asks: *"why not just use Claude Code, Codex, Cursor, or Aider directly?"* The answer is that those tools are coding agents; `code-oz` is a governed delivery loop **around** them. The two are complementary, not competitive.

The table below compares mechanics, not marketing. Every row corresponds to a feature you can verify in the linked competitor's own documentation. Every footnote sources its claim. The table was authored by `code-oz` maintainers and independently reviewed by an external `gpt-5.5` reviewer to catch overclaim drift; partial-credit ratings (`partial`) are used wherever the competitor delivers a related capability with different mechanics, so we never claim a competitor lacks a feature they actually ship.

This is the canonical public comparison. The README's short table is a summary that links here.

## Feature-by-feature comparison

| Feature | Cursor | Claude Code | Aider | Continue | Devin | **code-oz** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Same SHA-pinned native release across npm/Homebrew/curl | partial¹ | partial² | partial⁸ | partial⁹ | ❌ | ✅ |
| Orchestrated cross-provider phase roles (different LLM per phase) | partial³ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-family adversarial REVIEW (different LLM family) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| File-based gates with sha256 binding | ❌ | ❌ | ❌ | ❌ | partial⁴ | ✅ |
| Worktree-per-run isolation | ❌ | ❌ | ❌ | ❌ | partial⁴ | ✅ |
| Full SDLC artifact trail (SPEC/PLAN/BUILD_REPORT/VERIFY/REVIEW) | ❌ | ❌ | partial⁵ | ❌ | partial⁴ | ✅ |
| Debate-policy scheduler on disagreement | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Run-level cost budget enforcement with kill-switch | partial⁶ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Runs on CLI auth (no API keys required) | ❌ | ✅ | ❌ | partial | ❌ | partial⁷ |
| Open source (MIT) | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |

### Footnotes

¹ Cursor's CLI (`cursor-agent`) installs via a shell installer per the current Cursor docs (`cursor.com/docs/cli/installation`), but ships separately from the Cursor IDE; the row stays partial because Cursor's official install surface is a single channel today, not the same SHA-pinned native release across npm/Homebrew/curl.

² Claude Code ships Native Install, Homebrew, WinGet, and Linux package-manager installers per `code.claude.com/docs/en/quickstart`; each channel is its own installer, not a single SHA-pinned release asset shared across npm/Homebrew/curl.

³ Cursor supports multiple model providers (OpenAI, Claude, Gemini per `cursor.com/pricing`) but does not assign different providers to different SDLC phases as orchestrated phase roles.

⁴ Devin exposes sessions, PR links, Session Insights/timeline, and audit logs per `docs.devin.ai/get-started/first-run` + `docs.devin.ai/enterprise/api-reference/audit-logs`, but does not document file-based gate machinery or worktree-per-run isolation; "partial" reflects an opaque audit trail, not equivalent mechanics.

⁵ Aider captures commit messages + diff history per `aider.chat/docs/git.html`; not the full gated artifact set.

⁶ Cursor has token budgets at the chat level; not per-orchestration phase.

⁷ `code-oz` runs xAI on API key today; Claude/Codex CLI-auth via SDKs is the v0.x roadmap.

⁸ Aider distributes via shell installer + `uv` + `pipx` + `pip` per `aider.chat/docs/install.html` — Python packaging channels, not native binaries pinned across npm/Homebrew/curl by SHA.

⁹ Continue CLI installs via shell installer and npm per `docs.continue.dev/cli/quickstart`; the install row is partial because the same binary isn't released as a SHA-pinned asset across Homebrew + curl + npm together.

## Best used with

| If you already use... | `code-oz` adds |
|---|---|
| Claude Code | The same Claude as your builder, plus a Codex (or other family) reviewer at the REVIEW gate; SHA-bound approvals; an inspectable lifecycle trail. |
| Codex CLI | Same pattern with Codex as builder; Claude (or other family) as the cross-family reviewer. |
| Cursor | An external lifecycle layer outside the editor — useful when a change needs an audit trail beyond what the IDE captures. |
| Aider | A multi-phase artifact set on top of Aider's git-native model edits, with cross-family review and approvals. |
| Devin / Factory | Local-first lifecycle governance for changes you want to keep on your machine. |
| Qodo / Sonar | An EARLIER gate stage — the SPEC, PLAN, and approval artifacts produce inputs that Qodo / Sonar then review at PR time. |

## What `code-oz` is NOT

- **Not a coding agent itself.** The persona prompts orchestrate Claude / Codex / xAI / Fake. They do not contain a model.
- **Not a replacement for direct agent use.** Use Claude Code or Codex directly when you want the fastest possible loop. Use `code-oz` when you want a governed loop around them.
- **Not a static analyzer.** Sonar, Qodo, ESLint, and Bandit do that better.
- **Not an enterprise SaaS.** No hosted runtime, no team dashboard, no RBAC. Local CLI only.
- **Not a benchmark for "which model writes better code."** The deterministic FakeProvider demo proves lifecycle gates and ledger determinism, not model quality. The [`Agent Gate Bench`](../benchmarks/agent-gate-bench.md) protocol is the path to measured comparisons; the runner ships in v0.21.

## Methodology note

Footnote URLs were verified by an external `gpt-5.5` review against the competitor's own published docs as of 2026-05-12. If a competitor ships a feature that this table marks as `❌` or `partial`, that is a documentation gap on our side — please open an issue with a link to the competitor's published doc.

For the underlying provider matrix code-oz ships today (Claude / Codex / xAI / Fake live; Gemini stub; OpenCode and Roo Code as future candidates), see [`docs/contracts/PROVIDERS.md`](../contracts/PROVIDERS.md) § "Provider status (v0.1)".
