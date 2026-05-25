# Provider setup

`code-oz` has one first-run rule: start cost-free unless you explicitly opt into a live provider. In v0.21.1-alpha.0, no-key CLI runs use `FakeProvider` automatically.

| Surface | What to set | First-run behavior | Notes |
|---|---|---|---|
| CLI demo / smoke | Nothing | `code-oz run` falls back to `FakeProvider`; `code-oz run --provider fake` forces it | Best path for install smoke, CI, and first exploration. |
| Claude CLI family | Claude CLI login | Live Claude-backed personas use the installed CLI's login/session | No direct `ANTHROPIC_API_KEY` adapter ships in v0.21.1-alpha.0. |
| Codex CLI family | Codex CLI login | Cross-family REVIEW uses the installed CLI's login/session | No direct `OPENAI_API_KEY` adapter ships in v0.21.1-alpha.0. |
| xAI HTTP adapter | `XAI_API_KEY` | PE-1 xAI calls use HTTPS Bearer auth with secret redaction | Optional; not required for the fake first-run path. |
| GUI Gemini helper | `GEMINI_API_KEY` in `code-oz-gui/.env` | Enables the drawer's Ask helper | Missing key returns `Set GEMINI_API_KEY to enable the Gemini helper.` |

## Recommended first run

```sh
npm install -g @tuel/code-oz
mkdir /tmp/code-oz-first-run && cd /tmp/code-oz-first-run
code-oz init
code-oz run
```

With no live provider configured, the run should stay on `FakeProvider` and complete without spending provider tokens. When you are ready for live providers, configure the relevant upstream CLI login or `XAI_API_KEY`, then run `code-oz doctor providers` before starting a live run.
