---
template: pi-mono
companion-doc: COMPARISON.md
recipient: Codex (gpt-5.5, xhigh effort, sandbox: read-only)
purpose: Adversarial review of code-oz's borrow / reject / split decisions vs pi-mono
expected-verdict: accept / accept-with-modifications / reject / debate-required
---

# Codex briefing — code-oz vs pi-mono comparison

## What I am asking you to do

Stress-test the borrow / reject / split decisions in `COMPARISON.md` (this folder). Push back where my reasoning is thin. Surface bugs I missed. Give a verdict on whether the borrow set is the right size, the right shape, and the right ordering.

This is one template per session under code-oz's template-comparison sweep (see `docs/comparison/README.md`). Pi-mono is row "pi-mono → Streaming event model + multi-provider abstraction" in CLAUDE.md's influence library — already audited, already partially borrowed.

## Why pi-mono matters

`pi-mono` ships three load-bearing packages: `pi-ai` (30+ providers, OpenAI/Anthropic/Google/Bedrock/Vertex/Codex Responses/OpenRouter/Vercel Gateway/xAI/Groq/etc., 445k auto-generated `models.generated.ts`, deep streaming event protocol, OpenAI-compat detection, cache retention, Bun env-recovery), `pi-agent-core` (generic agent runtime with compaction/sessions/skills), and `pi-coding-agent` (CLI). Plus `pi-tui` and `pi-web-ui`.

Code-oz is a vertical SDLC runtime (phase-graph gates, cross-family review, debate runtime, role-cost policy). Provider abstraction is a foundational layer here, not the product.

The two projects live on orthogonal axes. The question is which mechanics from pi-mono's `pi-ai` and `pi-agent-core` packages absorb cleanly into code-oz without polluting authority boundaries (CLAUDE.md rule 20).

## The eight borrows I am proposing

| # | Borrow | Cost | Rule-20 footprint | Target |
|---|---|---|---|---|
| B1 | `ProviderResponse.{responseModel,responseId}` audit fields | ~30 LOC | none | opportunistic |
| B2 | `ProviderRequest.{cacheRetention,sessionId}` | ~30/adapter | budget axis | M13 follow-up |
| B3 | `onPayload`/`onResponse` wrapper callbacks | ~20 LOC | telemetry | with B6 |
| B4 | Cross-family-handoff integration test | ~200 LOC | none | standalone |
| B5 | Bun `/proc/self/environ` env recovery | ~30 LOC | none | with PE-2 |
| B6 | `ProviderDiagnostic` typed shape | ~50 LOC | privacy axis | with B3 |
| B7 | Lazy provider registration via subpath exports | ~40 LOC | none | standalone refactor |
| B8 | Auto-generated model registry seam | 2-3 days | code quality | post-W3 |
| S1 | Declared (not auto-detected) OpenAI-compat records | ~80 LOC | family axis | when 2nd compat provider lands |

## The five rejects

R1: 30-provider matrix (cross-family rule depends on small audited family set; meta-providers like OpenRouter route across families and silently break rule 2).
R2: `pi-tui` / `pi-web-ui` (out of scope — code-oz is a CLI runtime, not chat).
R3: Lockstep monorepo versioning (code-oz is single-package).
R4: TypeBox tool schemas (code-oz uses Zod; switching is churn).
R5: Image generation (out of scope).

## Open questions (answer all five)

### Q1 — B2 framing: milestone or follow-up?

Per-request cache retention (`'none' | 'short' | 'long'` + `sessionId`) extends M13's cost authority on the *output* side. M13 already ships per-role budget caps and a `priceTable`. Argument for M13 follow-up: same authority axis. Argument for new milestone: the wrapper plumbing touches every adapter, and the per-phase policy table (REVIEW=long, debate=long, one-shot DEFINE=short) is a new surface. Verdict?

### Q2 — B4 size: one round-trip test or parametrized matrix?

Pi-mono parametrizes `cross-provider-handoff.test.ts` across the full provider × provider matrix. Code-oz's family count is 4 (claude / codex / gemini / xai); the directional matrix is 12 pairs. FakeProvider can script any pair, so the marginal cost per pair is ~20 fixture lines. Should code-oz parametrize over the full 12, or start with 1-2 representative pairs and parametrize on demand?

### Q3 — B8 timing: schedule before or after PE-2 demand checkpoint?

The CLAUDE.md migration window says `claude-sonnet-4-20250514` and `claude-opus-4-20250514` retire 2026-06-15 (5 weeks out). Today, model strings are hardcoded across config defaults / fixtures / prompts / tests. A user who upgrades after the retirement and runs `code-oz run` against a stale default model will see a 404 stack trace rather than a `NEEDS_INTERVENTION.json` (rule 11 violation). B8 is 2-3 days of work. Push it before PE-2 demand checkpoint, or accept the risk and ship B8 only if a user actually files the bug?

### Q4 — S1 scope: declare compat records now, or YAGNI until second OpenAI-compat provider?

Pi-mono's `OpenAICompletionsCompat` has 14+ knobs because real providers diverge from the OpenAI base API in 14 ways (cache-control format, thinking format, max_tokens field, session affinity, OpenRouter routing, ZAI tool stream, strict mode, etc.). Code-oz has *one* OpenAI-compat provider today (xAI). Borrowing the typed compat record costs ~10 LOC for `XaiCompat`; the catalog of knobs is informative for any future compat adapter. But a one-knob compat record has no edges to test against. Land S1 now (catalog as documentation + future-proofing) or wait for the second compat provider?

### Q5 — Reverse-direction borrows: are there patterns code-oz should *teach* pi-mono?

Pi-mono's AGENTS.md ships parallel-agent git rules (no `git add -A`, no `git stash`, no `git reset --hard`, no `--no-verify`, etc.) as a *manual* discipline — agents are expected to read AGENTS.md and follow it. Code-oz's M7 worktree-per-run is *runtime*-enforced (the orchestrator literally cannot stage files outside its worktree). Are there reverse-direction lessons? E.g., would teaching pi-mono a runtime worktree-per-agent rule be a real win, or is the manual discipline appropriate for their product shape (single coding agent, multi-instance)? This is an audit-by-inversion: anywhere code-oz is "ahead," check that *we* haven't slipped from runtime enforcement to manual discipline ourselves.

## Constraints to keep in mind

1. **CLAUDE.md rule 20** — one new authority boundary per milestone. Borrows that bundle multiple authorities into one milestone fail.
2. **CLAUDE.md rule 21** — no new parallel-provider surface lands without measurable risk-reduction effect in `events.jsonl`. B8 (model registry) is a code-quality refactor, not a new parallel surface; this rule does not gate it. B2 and B3 *are* on the parallel-provider pathway and should justify themselves under rule 21.
3. **CLAUDE.md rule 13** — privacy by default. B5 (Bun env recovery) and B6 (typed diagnostic) both intersect this rule directly.
4. **W3 release status** — code-oz ships compiled `bun build --compile` Mach-O binaries via tarballs (`code-oz-v0.14.0-alpha.0-darwin.tar.gz`). PE-1 (xAI direct) is the first outbound HTTP integration. PE-2 is demand-gated. Borrows that depend on shape decisions for PE-2 should call that out.
5. **No emojis. No "Co-Authored-By: Claude" footers. No pushes to GitHub.** Standard code-oz conventions.

## What good looks like

A response of the form:

```
Verdict: accept / accept-with-modifications / reject / debate-required

Q1: <answer with reasoning>
Q2: <answer with reasoning>
Q3: <answer with reasoning>
Q4: <answer with reasoning>
Q5: <answer with reasoning>

Missed risks:
1. <risk> — severity: block-push / fix-soon / nit
2. ...

Disagreements with the borrow set:
- <borrow> — <reason>
- ...

Confirmations:
- <borrow or reject> — <reason it is correctly classified>
- ...
```

Push back. Don't agree by default. Pi-mono is a mature, opinionated project; if I have miscategorized a borrow as "out of scope" or missed a real cost, say so.
