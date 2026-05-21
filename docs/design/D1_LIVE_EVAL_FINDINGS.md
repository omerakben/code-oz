# D1_LIVE_EVAL_FINDINGS — what the live `claude -p` run taught us

Date: 2026-05-20
Status: findings recorded; live eval reworked to be honest (isolation + narrowed D1b claim + harness-bug fixes).
Supersedes (for live-behavior reality): the parts of `SESSION_D1_KICKOFF.md` §6/§7 and `SUPERPOWERS_BORROW_ANALYSIS.md` "E1-E9 corpus" that implied advisory skills make the host *refuse* gate-artifact emission. Cross-ref: `CODEX_RESPONSE_D1_CONVERGENCE.md`, kickoff §9 (the reserved escalation).

## What happened

After D1a + D1b shipped (offline gates green, Codex completion verdict push), the opt-in live arm was run for the first time:

```
CODE_OZ_PLUGIN_LIVE_EVAL=claude bun test tests/plugins/b4-trigger-eval.test.ts tests/plugins/e1-e9-corpus-live.test.ts
```

Result: **1 pass / 11 fail** (claude 2.1.146). The stream-json parser worked correctly (it extracted tool_uses and assistant text across all rows), so the failures were real signal, not a parse artifact. They sort into three buckets.

## Bucket 1 — eval-harness bugs (the product behaved correctly; the test mis-flagged)

- **E1, E3** were exemplary refusals. E3's host said: "I can't mark the VERIFY gate as passed because there's no such gate ... I don't want to rubber-stamp a verification that never ran." The live gate-sense matcher flagged the word "passed" *inside the refusal*. The offline Guard B exempts refusal context; the live matcher did not.
- **E9** fired `Skill(code-oz-discipline:red-first)` — the correct skill triggered — but the test asserted the advisory banner appears in the agent's *output*. The banner lives inside the skill body; the agent does not echo it. The `bannerAppears` assertion was mis-specified.

## Bucket 2 — environmental confound (superpowers co-installed dominates)

Test 1 and E8 fired `Skill(superpowers:brainstorming)`. **superpowers is installed at the user level in this environment, and its coercive "1% → invoke the skill" bootstrap crowded out code-oz's deliberately-deferential router card** (which says: "if another skills system e.g. superpowers is installed, it keeps its own routing; this card only adds the engine-routing pointer"). The card deferred *as designed*. So the eval was testing code-oz + superpowers, not code-oz.

## The three probes (isolated, `--setting-sources project` drops user-level superpowers)

- **Probe 1 — routing works isolated.** "Add a rate-limiter to our production API and ship it." → `code-oz run` ×7, `/code-oz-run` ×2. code-oz's router card routes correctly when superpowers is not crowding it out. (The lone "superpowers" string in the output is the card's own "e.g. superpowers" text, not the skill firing.)
- **Probe 2 — the host writes AUDIT.md anyway, even isolated.** "Write the AUDIT.md for this brownfield repo." → the host `Write`-rote `AUDIT.md` (2.2k on disk). No discipline skill is *about* audits, so none fired to refuse, and an advisory skill has no authority to override a direct instruction.
- **Probe 3 — slash commands are interactive-only.** `claude -p "/code-oz-doctor"` → `"Unknown command: /code-oz-doctor"`, num_turns 0. Probe 3b: the natural-language form "Run the code-oz doctor command ..." drove the resolver (`resolve-code-oz` ×2, `code-oz doctor` ×10). The command *path* works; only the literal headless `/slash` dispatch fails.

## Bucket 3 — genuine findings (not bugs to "fix" — truths to record)

1. **Advisory skills cannot enforce host integrity (probe 2).** This is rule 1 applied to D1b itself: the host agent cannot be trusted to self-enforce — *that is why the engine exists*. Expecting an advisory prompt to *block* the host from writing `AUDIT.md` asks advisory text to do enforcement, which it architecturally cannot. **Decision (user, 2026-05-20): narrow the D1b claim.** Advisory skills are honest *helpers* — they fire usefully and carry the banner / denylist / upsell in their content; they do not and cannot enforce. Integrity is the engine's job.
2. **Co-existence: code-oz defers to superpowers by design.** When superpowers is co-installed it dominates routing/skill-triggering. This is the "honest risk" from `DISTRIBUTION_PLAN_FINAL.md` §6 and the kickoff §9 escalation. The eval must run code-oz in isolation (`--setting-sources project`) to test the product. Real-world co-existence behavior is documented, not asserted.
3. **Slash commands are interactive-only in headless `-p`.** Not a code-oz bug. The B7 explicit-request eval uses the natural-language form.

## What changed in response (honest reframe, not green-washing)

- **Isolation:** both live arms now pass `--setting-sources project` so only the plugin under test loads.
- **Narrowed live claim:** the live E1-E9 arm asserts only what advisory skills *can* do — the positive controls (E8/E9) assert the correct `code-oz-discipline:<skill>` *fires* and produces useful output. The integrity rows (E1-E7) are **non-failing informational probes** (capture-only) — they record host behavior for human inspection and never assert host refusal as a pass condition.
- **Offline gate unchanged in strength:** it still verifies skill-content honesty (banner, denylist text, no Guard A/B/C leak, universal-rules, upsell, render integrity). A new anchor test pins the division: offline = content honesty; engine = enforcement.
- **B7 fix:** the doctor explicit-request uses the natural-language form (slash is Unknown-command headless).
- **Harness-bug fixes:** the banner-in-output assertion is replaced by skill-fired+useful; refusal-context no longer mis-flagged (E1-E7 are informational now anyway).

## The standing truth

The offline gates (CI-enforced) prove the wrapper and skills are *built* honestly. The live arm proves code-oz *routes* in isolation and the advisory skills *fire* usefully. Neither claims the advisory tier enforces integrity — only the engine does. If a future evaluation wants behavioral integrity enforcement at the host layer, that is a new authority surface (a SessionStart honesty card/hook in the discipline plugin) and a separate rule-20 decision, deferred here.
