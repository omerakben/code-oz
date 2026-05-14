# Codex R0 response: v0.20.1-alpha.0 first-run polish

> **Thread:** `019e26b5-340c-7842-8c6d-5f73e0ef8829`
> **Model:** `gpt-5.5` xhigh, sandbox: read-only
> **Briefing:** `docs/design/CODEX_BRIEFING_V0_20_1_POLISH.md`
> **Design under review:** `docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md`
> **Date:** 2026-05-14

## 1. Verdict: `accept-with-modifications`

The pull-forward is the right trade. The design addresses live trust leaks without moving M17 or launch. I would approve implementation after the block-approve items below are folded into the plan.

## 2. Per-prompt response

1. **Pull-forward call**: accept. The current README/package/provider mismatch is a daily credibility leak. M17 is capability work; these are truth, trust, and proof-surface fixes. Keep M17 and Phase 5 locked.

2. **Comparison table reuse**: accept. Reuse locked Option D section 3.2 verbatim in `docs/comparisons/ai-coding-agents.md`. The GPT Pro simpler table is useful for README framing, not for overriding the hardened table.

3. **Failure demo centerpiece**: modify. Keep the 5 fixtures, but add `events.jsonl` ledger replay as required acceptance, not a sixth fixture. Also tighten scope: if any fixture requires new gate authority or new production policy, cut that fixture to v0.21 instead of adding authority in v0.20.1.

4. **Benchmark doc without runner**: accept with wording guard. Ship it as a benchmark spec or method doc with `TBD` rows. Do not imply measured proof, do not add a badge with results, and do not add a `bench:*` command until the runner exists.

5. **AI software company metaphor**: accept option (a), with one refinement. Keep it in `docs/ABOUT.md` as historical/internal metaphor, below concrete shipped facts. Do not keep "Run an AI software company from your terminal" as an active tagline.

6. **Codex review cadence**: modify. Use Codex on the planning debate, the failure-demo code track, one public-claims bundle review if the README/provider/comparison edits are large, and final pre-tag review. Skip per-task Codex verdicts for purely mechanical doc/template commits.

7. **Acceptance criteria gaps**: modify. Add fresh-clone smoke before tag, exact Community Standards target or explicit exceptions, and docs rendering/link checks. Add markdownlint only if using an existing or one-shot tool, not as a new repo dependency without approval.

8. **Missed risks**: modify. The design underweights public-doc drift outside README, especially `CLAUDE.md`, `docs/ABOUT.md`, and roadmap path drift. HN readers will inspect those.

## 3. Block-approve findings (must close before implementation)

- **B1: `CLAUDE.md` top matter must be truth-synced** before implementation proceeds. It currently says Gemini SDKs are part of the provider surface and has stale status language, while v0.20.1's goal is no catchable provider overclaim.
- **B2: Resolve roadmap authority** before edits. The design creates `docs/ROADMAP.md`, but current canonical planning points to `docs/design/ROADMAP.md`. Either make the new file an explicitly derived public summary or update the existing file without creating a second authority.
- **B3: Add the required permission manifest** for `scripts/demo/02-failure-gates/run-demo.ts` per `CLAUDE.md` rule 9, or explicitly document why user-invoked demo scripts are exempt. Without that, the proof asset violates a repo non-negotiable.
- **B4: Normalize the failure-demo command.** The audit wants `bun run demo:failure-gates`, current `package.json` only has `demo:todo-cli`, and the design acceptance uses the direct script path. Add the package script and make README/design/release notes use one command.
- **B5: Tighten Track 3 implementation language**: "minimal implementation if wiring is missing" must not mean new gate authority. Production behavior changes are only allowed for already-claimed gates with RED-first tests.

## 4. Medium findings (close before tag)

- **M1: Define Community Standards** as "all applicable green except listed intentional exceptions" or add a `CODE_OF_CONDUCT.md`. "Mostly green" is too fuzzy.
- **M2: Make `docs/contracts/PROVIDERS.md`** separate live adapters, stubs, and future adapter candidates so OpenCode/Roo do not become phantom contract entries.
- **M3: Add fresh-clone pre-tag smoke**: clone, install, run `bun test`, run `bun run demo:todo-cli`, run `bun run demo:failure-gates`, inspect README links.
- **M4: Treat release-note backfill and tag/publish as Ozzy-approved external actions**, not Maestro automation.
- **M5: Add a public/internal docs drift pass before tag**: README, ABOUT, PROVIDERS, TRUST, roadmap, package metadata, release notes, and GitHub sidebar should tell the same story.

## 5. FYI / nit findings

- N1: Update the README test badge count if 3390 is the release truth.
- N2: Remove or hide `beast` from first-run public copy, or describe it as high-assurance only in deeper docs.
- N3: Remove the current README `GEMINI_API_KEY` GUI-helper mention from the main provider setup story unless it is clearly scoped to the separate GUI helper.
- N4: Keep package keywords free of `gemini` until Gemini is live.
- N5: Prefer one comparison path in public links: `docs/comparisons/ai-coding-agents.md`.

## 6. Missed risks

- "FakeProvider proves nothing" will still land. The mitigation is to say exactly that: FakeProvider proves lifecycle gates and ledger determinism, not model quality.
- "Your benchmark is empty" will land if the doc is framed as evidence. Frame it as the benchmark protocol until measured rows exist.
- "Your own docs contradict the README" is the biggest HN-class risk. `CLAUDE.md` and ABOUT currently still carry old positioning and provider language.
- "This slows developers down" remains unanswered without time/cost data. The README should say this is for risky repos, not fastest-loop coding.
- "Unsigned binaries for a trust tool" remains a fair objection. SECURITY/TRUST docs should make the caveat explicit and point to the signing/provenance milestone.

## 7. Recommended scope cut or scope add

**Scope adds:**

- Add `demo:failure-gates` script.
- Add runner permission manifest.
- Add `CLAUDE.md` top-matter truth sync.
- Add ledger replay assertion to the failure-demo acceptance.
- Add fresh-clone smoke and exact Community Standards target.

**Scope cuts:**

- Do not build a benchmark runner.
- Do not add real-test fixture or demo GIF in v0.20.1.
- Do not add production gate behavior just to satisfy a demo fixture.

## Read-only note

Codex did not run tests or edit files. Treated the competitor table as locked and did not re-verify competitor docs because the briefing explicitly constrained row edits.
