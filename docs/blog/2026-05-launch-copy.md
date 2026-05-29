---
title: Launch copy — Show HN, X thread, community submissions
status: DRAFT for Ozzy review. Nothing here is published. Personalize voice before posting.
source-of-truth: docs/blog/2026-05-ai-release-gate.md (the essay), docs/RECEIPTS.md, docs/comparisons/ai-coding-agents.md
---

# Launch copy (Phase 5.2 – 5.4)

All copy below tells the same true story as the essay and stays inside the calibrated claims in the comparison table. No claim here is stronger than what `docs/comparisons/ai-coding-agents.md` can defend with a footnote.

Two facts to keep straight while editing, because a skeptical reader will test both:
- The cross-family adversarial REVIEW row is the one capability where every compared competitor is marked `❌`. Lead with it. It is the real wedge.
- "Runs on CLI auth" is `partial` for code-oz, not a clean win — Claude and Codex are keyless through their CLI logins, xAI needs `XAI_API_KEY`. Say "keyless for Claude and Codex" and you stay honest.

---

## 5.2 Show HN

**Title** (74 chars, under the 80 limit):

```
Show HN: code-oz – AI agents through a gated SDLC, with cross-family review
```

**Link:** the GitHub repo (`https://github.com/omerakben/code-oz`), so the click that follows interest is a star, not a scroll.

**First comment** (post immediately after submitting; this is where the story goes):

> I build code-oz, an orchestrator that runs coding agents — Claude and Codex through their own CLI logins, xAI through an API key — across a gated software lifecycle: define, plan, build, verify, review, ship. Each phase writes a Markdown artifact and the next phase is blocked by a schema-validated gate file. The one rule underneath it: REVIEW must run on a different model family than the one that built the code.
>
> The story I want to put in front of you is one where that rule cost me, not one where it looked good in a demo. Before tagging v0.20.0, the cross-family review I run on every release (a Codex pass over the diff) blocked the release. My local suite was green — 3361 pass, 0 fail. The bug: the release workflow built binaries before running `bun install`, so it would have failed on a clean GitHub Actions checkout and shipped zero assets in public. Invisible to me because my laptop always has node_modules. A different model family, with no stake in my deadline, traced the path mine couldn't. Fix is commit 1d520fe, three lines plus a test that pins the ordering. This is not the only one: the receipts page has three more real-model reviews — M14 ran nine cross-family rounds and closed seven block-push findings to zero before shipping, and M15's planning review caught four design gaps before a line of code landed.
>
> Full write-up with the verbatim review excerpt and the SHAs: [essay link]. Receipts page separates the real-model reviews (Tier 1) from the deterministic FakeProvider demos (Tier 2) so the two never get conflated: [receipts link].
>
> It's MIT. The cross-family review needs both Claude and Codex configured. Honest about limits: it's alpha, the macOS binaries aren't signed yet, and the offline demos prove the gate machinery is real, not that any model writes good code. Happy to answer anything for the next few hours.

[OZZY: rewrite the first sentence in your own voice. HN rewards a real person, not a press release. Keep the "it blocked my own release" framing and the 3361/0 number — those are what make it land.]

**Timing:** Tuesday or Wednesday, US morning (roughly 8–10am ET). Not Friday, not the weekend. [OZZY decision: pick the day.]

---

## 5.3 X / Twitter thread

11 tweets. Each is under 280 characters. Asset slots are marked; the GIF and the two screenshots need you (B6). Post the thread the same day as Show HN, after the first HN comments land, so you can link the discussion.

**1/ (hook + GIF)**
> I built an AI release gate for my own coding-agent tool. Last week it blocked my own release. It was right to. 🧵
>
> [OZZY asset: GIF of the `fix-first` verdict / the gate refusing — B6]

**2/ (what it is)**
> code-oz runs coding agents — Claude, Codex, xAI — through a gated lifecycle: define → plan → build → verify → review → ship. Each phase writes an artifact; a schema-validated gate file blocks the next one. The agents are workers. It's the discipline around them.

**3/ (the rule)**
> One rule underneath all of it: REVIEW must run on a different model family than the builder. Claude builds, Codex reviews. Different labs and training mean their mistakes don't line up — same-family review shares the same blind spots. Cross-family is required, not a toggle.

**4/ (the setup)**
> I hold my own releases to that rule. Before tagging v0.20.0 I ran the Codex review over the diff. Local suite: 3361 pass, 0 fail, typecheck silent. Everything I could run on my machine was green.

**5/ (the bug)**
> The review blocked it. The release workflow built the binaries before running `bun install`. On my laptop, invisible — node_modules already exists. On a clean GitHub runner it would fail to resolve `yaml` and ship zero binaries. In public.

**6/ (the catch — screenshot)**
> The reviewer traced the exact failure path my green suite couldn't reach:
>
> [OZZY asset: screenshot of the verbatim Codex finding from RECEIPTS.md lines 19–34]

**7/ (the fix — screenshot)**
> The fix was 3 lines (commit 1d520fe). The part that matters more: the same commit added a test that finds the install and build steps and asserts build runs after install, so it can't rot back.
>
> [OZZY asset: screenshot of the diff + test]

**8/ (the point)**
> This isn't a story about a smart model. It's about a different one. A reviewer from another family isn't better at CI — it's *differently wrong*, which is exactly what you want at a gate. The win came from the disagreement.

**9/ (the bet)**
> That's the whole bet: model bias is real, a single agent inherits one model's blind spots, and trading some speed for a cross-family reviewer catches what self-review can't. On this release it caught a launch-breaking bug.

**10/ (honesty)**
> Fair caveat: code-oz also ships deterministic offline demos. Those prove the gate machinery runs and replays — not that any model writes good code. The release story above is the other kind of evidence: a real model, real bug, fix in git. Both are labeled, never mixed.

**11/ (CTA)**
> MIT. Keyless for Claude and Codex via their CLI logins; xAI needs `XAI_API_KEY`. Cross-family review needs both Claude and Codex.
> npm: `npm i -g @tuel/code-oz`
> brew: `brew tap omerakben/code-oz && brew install omerakben/code-oz/code-oz`
> Repo + receipts: [repo link]
> Full write-up: [essay link]

[OZZY: tweets 1, 8, and 9 are where your voice matters most. The numbers and SHAs are verified — keep them exact.]

---

## 5.4 Community submissions

Same story, fitted to each venue. Submit in the 24 hours after Show HN.

**lobste.rs** (tags: `devops`, `ai`, `practices`)
> Title: code-oz: a gated SDLC around coding agents, with cross-family review
> Link: the essay (lobste.rs prefers the write-up over a repo).
> Note: lobste.rs is invite-only and allergic to marketing. Lead with the bug, not the product.

**r/programming** (link the essay, not the repo)
> Title: My AI release gate blocked my own release — a different model family caught a CI bug my green test suite couldn't

**r/coolgithubprojects**
> Title: code-oz — run coding agents through a gated SDLC with cross-family adversarial review (MIT)
> Body: two sentences + the bug anecdote + repo link.

**dev.to + Hashnode** (cross-post the full essay)
> Add a canonical-URL header pointing back to `docs/blog/2026-05-ai-release-gate.md` so the GitHub copy stays canonical. dev.to flags AI-generated submissions; the essay's specific commits, SHAs, and personal framing are the defense — do not strip them.

**Newsletter pitches** (Ben's Bites, TLDR AI, The Batch — one short paragraph each)
> Subject: A coding-agent tool whose own release gate caught a launch-breaking bug
> Body: I make code-oz (MIT), which runs coding agents through a gated SDLC where REVIEW is forced onto a different model family than the builder. Before my last release, that cross-family review caught a CI bug — the release workflow built before installing deps and would have shipped zero binaries from a clean runner. Write-up with the verbatim review and the fix commit: [link]. Happy to share the receipts page that separates real-model reviews from deterministic demos.

---

## Needs Ozzy before launch

- **[B6] Demo asset (GIF + 2 screenshots).** The X thread has three asset slots: the gate refusing (tweet 1), the verbatim Codex finding (tweet 6), the diff + test (tweet 7). The text in RECEIPTS.md lines 19–56 is the source for the two screenshots. Only you can record/capture these.
- **[B9] Friend reactions / first-impressions pass.** Phase 3.5 asks for 3 unprompted developer reactions to the README + essay before Show HN. Not drafted here — it needs real people.
- **Voice.** The essay and the Show HN first comment are drafted in a plausible first-person voice. They are your launch under your name; personalize the marked spots.
- **Launch day + the live brownfield smoke.** Tue/Wed is recommended; the day is yours. The optional M17 brownfield smoke (a real model fixing a real bug through the AUDIT phase) would be a strong second receipt for tweet 7 / the Show HN secondary link, but it needs live credentials and hasn't been run.

---

## Adversarial review trail

These drafts went through a three-lens adversarial pass (fact/overclaim auditor, hostile HN reader, writing-rules/authenticity) before this commit. The writing-rules lens returned clean. Applied fixes: xAI auth precision in the essay and Show HN comment (xAI needs a key, it is not a CLI login); the X thread `brew` command now includes `brew tap` (the bare `brew install` fails with "formula not found"); the Show HN comment now names the M14/M15 receipts up front to answer the "n=1 anecdote" attack; a grounded one-line reason for why different families have different blind spots (uncorrelated errors from independent training, not an unverifiable "Claude does correctness, Codex does velocity" claim).

Two findings were not applied as suggested:

- **Flagged for you (not applied):** the comparison page (`docs/comparisons/ai-coding-agents.md`) says "external `gpt-5.5` review." The HN lens noted a reader may assume that is Claude reviewing its own product. Naming it as a Codex / OpenAI-family review would strengthen the cross-model-fact-check credibility. It is a one-line clarity fix on a canonical, already-shipped doc, so it is your call, not folded into this launch branch.
- **Rejected (would introduce an inaccuracy):** the HN lens wanted the essay to say the release catch used "the same `code-oz run` command users get." That is false — the catch was the milestone Codex-review discipline, not the product's automated REVIEW phase running on itself. The essay keeps the honest distinction: the product enforces cross-family review inside `code-oz run`; the release story is the human-orchestrated version of the same principle. Conflating them is exactly the overclaim a skeptic would catch.
