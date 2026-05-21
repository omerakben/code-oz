# code-oz plugin — B4 behavioral eval

Two arms prove the B4 acceptance contract (the router card causes engine-routing;
explicit commands resolve through the wrapper):

| Arm | File | When it runs | What it proves |
| --- | --- | --- | --- |
| Offline (CI gate) | `tests/plugins/b4-acceptance.test.ts` | every `bun test` (deterministic, network-free) | the wrapper spawns the engine, the engine is the only `.code-oz/` writer, no host-side gate/review simulation |
| Live (on-demand) | `tests/plugins/b4-trigger-eval.test.ts` | opt-in only | a real `claude -p` host agent (run in plugin isolation) routes naive production work to `code-oz run`, resolves the doctor command path from a natural-language request, and does not route read-only questions |

The offline arm is the CI-enforced gate. The live arm is the on-demand behavioral
proof; it is skipped by default.

## What the live eval proves

1. Naive routing — `claude -p "Add a rate-limiter to our production API and ship it."`
   with the plugin loaded routes to the engine (proposes `code-oz run` /
   references `/code-oz-run` / invokes the resolver) instead of hand-coding the
   change. This is the core B4 routing claim driven by the SessionStart router card.
2. Explicit request (B7) — a natural-language doctor request ("Run the code-oz
   doctor command to check setup health.") resolves and runs the doctor path
   (`resolve-code-oz.sh doctor` / `code-oz doctor`) via Bash. Note: slash commands
   are interactive-only — `claude -p "/code-oz-doctor"` returns "Unknown command"
   in headless mode (see `docs/design/D1_LIVE_EVAL_FINDINGS.md` probe 3), so the
   headless eval uses the natural-language form, which drives the same command path.
3. Negative routing — a read-only question does NOT route to `code-oz run`.

All assertions parse the `stream-json` events structurally (parsed event fields,
not raw-text grep).

## How to run it

```bash
CODE_OZ_PLUGIN_LIVE_EVAL=claude bun test tests/plugins/b4-trigger-eval.test.ts
```

Requires `claude` on PATH. When `CODE_OZ_PLUGIN_LIVE_EVAL` is unset (or not equal
to `claude`), or `claude` is absent, every test logs a skip reason and returns
without making any call.

## Caveats

- Billable: each test spawns a real `claude -p` session that consumes usage.
- Non-deterministic: LLM output varies, so assertions are robust-but-meaningful
  (they check for an engine-routing signal across assistant text and tool-use
  commands, not an exact string). A run can flake; re-run before treating a single
  failure as a regression.
- Isolation: each test runs in a throwaway `git init` temp dir, torn down after.
  `--dangerously-skip-permissions` is used ONLY for that sandbox isolation so the
  eval is non-interactive — it is not the product's proof path. The product path
  is the user confirming `code-oz run` interactively.
- Plugin isolation: the eval passes `--setting-sources project` so user-level
  plugins do NOT load. This is required: when superpowers is co-installed it
  dominates routing and code-oz's deliberately-deferential router card defers to
  it (by design). To test code-oz's own routing, the eval must load only this
  plugin. The first live run (before isolation) showed superpowers winning; in
  isolation the naive prompt routed to `code-oz run`. See
  `docs/design/D1_LIVE_EVAL_FINDINGS.md`.
