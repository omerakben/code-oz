# Provider setup

`code-oz` has one first-run rule: start cost-free unless you explicitly opt into a live provider. For install smoke and first exploration, force the deterministic fake path with `--provider fake`.

| Surface | What to set | First-run behavior | Notes |
|---|---|---|---|
| CLI demo / smoke | Nothing | `code-oz run --provider fake --request "<task>"` uses `FakeProvider` | Best path for install smoke, CI, and first exploration. |
| Claude CLI family | Claude CLI login | Live Claude-backed personas use the installed CLI's login/session | No direct `ANTHROPIC_API_KEY` adapter ships in v0.21.2-alpha.0. |
| Codex CLI family | Codex CLI login | Cross-family REVIEW uses the installed CLI's login/session | No direct `OPENAI_API_KEY` adapter ships in v0.21.2-alpha.0. |
| xAI HTTP adapter | `XAI_API_KEY` | PE-1 xAI calls use HTTPS Bearer auth with secret redaction | Optional; not required for the fake first-run path. |
| GUI Gemini helper | `GEMINI_API_KEY` in `code-oz-gui/.env` | Enables the drawer's Ask helper | Missing key returns `Set GEMINI_API_KEY to enable the Gemini helper.` |

## Recommended first run

```sh
npm install -g @tuel/code-oz@0.21.2-alpha.0
mkdir /tmp/code-oz-first-run && cd /tmp/code-oz-first-run
code-oz init
code-oz run --provider fake --request "Create a tiny hello-world CLI"
```

The run should stay on `FakeProvider`, write `.code-oz/state/runs/<runId>/events.jsonl`, and either stop at the next required approval gate or complete the deterministic fake-provider lifecycle depending on the generated plan shape. It spends no provider tokens.

When you are ready for live providers, configure the relevant upstream CLI login or `XAI_API_KEY`, then run `code-oz doctor providers` before starting a live run. The `--provider` CLI override only supports the fake provider today; live provider selection comes from project config/persona routing and provider availability.
