# code-oz plugin — B4 behavioral eval

Two arms prove the B4 acceptance contract (the router card causes engine-routing;
explicit commands resolve through the wrapper):

| Arm | File | When it runs | What it proves |
| --- | --- | --- | --- |
| Offline (CI gate) | `tests/plugins/b4-acceptance.test.ts` | every `bun test` (deterministic, network-free) | the wrapper spawns the engine, the engine is the only `.code-oz/` writer, no host-side gate/review simulation |
| Live (on-demand) | `tests/plugins/b4-trigger-eval.test.ts` | opt-in only | a real `claude -p` host agent actually routes naive production work to `code-oz run`, resolves `/code-oz-doctor`, and does not route read-only questions |

The offline arm is the CI-enforced gate. The live arm is the on-demand behavioral
proof; it is skipped by default.

## What the live eval proves

1. Naive routing — `claude -p "Add a rate-limiter to our production API and ship it."`
   with the plugin loaded routes to the engine (proposes `code-oz run` /
   references `/code-oz-run` / invokes the resolver) instead of hand-coding the
   change. This is the core B4 routing claim driven by the SessionStart router card.
2. Explicit request (B7) — `claude -p "/code-oz-doctor"` resolves the command and
   runs the doctor path (`resolve-code-oz.sh doctor` / `code-oz doctor`) via Bash.
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
