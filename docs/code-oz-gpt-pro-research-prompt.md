# GPT-5.5 Pro research prompt: make `code-oz` a 10/10 developer-tool project and reach 1,000 GitHub stars

You are GPT-5.5 Pro acting as a senior developer-tools product strategist, open-source growth advisor, technical architecture reviewer, and launch operator.

I need a brutally honest, research-backed plan for the public GitHub project:

`https://github.com/omerakben/code-oz`

Current working assessment:

- Engineering strength today: **8/10**
- Market-ready product strength today: **6.5/10**
- Goal: move both toward **10/10**
- Growth target: reach **1,000 GitHub stars as soon as realistically possible**
- Output audience: Codex, Claude, and me. The final output must be usable as a direct implementation and execution plan.

## Project context

`code-oz` is intended to be a repo-native agentic SDLC runtime. It runs AI coding agents through a governed software delivery lifecycle instead of trusting one model or one coding agent directly.

Current high-level thesis:

> AI coding agents are fast. `code-oz` makes them auditable.

Current public positioning:

> Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.

Current product metaphor:

> Run an AI software company from your terminal.

Current core loop:

1. DEFINE
2. PLAN
3. BUILD
4. VERIFY
5. REVIEW
6. SHIP

Known implementation features already present or claimed in the repo/docs:

- CLI commands: `init`, `run`, `approve`, `doctor`
- file-based phase gates
- sha256-bound approval artifacts
- isolated worktrees
- deterministic FakeProvider demo path
- event ledger via `events.jsonl`
- cross-family review concept
- effort levels: `lite`, `balanced`, `max`, `beast`
- install channels: curl script, npm, Homebrew
- macOS and Linux support today; Windows/Scoop deferred
- public alpha release line around `v0.20.0-alpha.0`
- demo under `docs/demo/01-todo-cli/`
- many offline tests

## Key weaknesses already identified

Please verify, challenge, and expand this list. Do not assume it is complete.

1. **Pitch density**
   - The language is powerful but too heavy for first-time users.
   - Terms like “repo-native agentic SDLC runtime,” “hybrid phase-graph,” “cross-family adversarial review,” and “AI software company” can create friction.
   - Need a simple first sentence for developers.

2. **Adoption friction**
   - Developers may ask: “Why not just use Claude Code, Codex, Cursor, Gemini CLI, OpenCode, or Roo Code directly?”
   - `code-oz` must prove it saves time, catches defects, or prevents expensive mistakes.
   - Process overhead must feel justified.

3. **Market differentiation risk**
   - HivePipe already uses agentic SDLC language around PRDs, approval gates, audit trails, validation, and Git-native output.
   - Qodo, Sonar, Factory, Devin, Cursor, Claude Code, Codex, Gemini CLI, OpenCode, Roo Code, and others cover adjacent space.
   - `code-oz` must own a narrower wedge, likely local-first, CLI-first, repo-native, open-source/source-visible, provider-neutral, cross-family review, FakeProvider-tested, Markdown-contract governed delivery.

4. **README/product storytelling gap**
   - The README should be adoption-first, not architecture-first.
   - It should answer quickly:
     - What problem does this solve?
     - Who is it for?
     - What does it do in 60 seconds?
     - What is real today vs simulated?
     - Why should I star, install, or try it?

5. **Demo gap**
   - The current happy-path demo is useful but may not be enough.
   - Need a failure-mode demo that proves value:
     - bad agent output blocked
     - verification failure triggers clean restart
     - reviewer catches risky change
     - gate refuses tampered artifact
     - event log reconstructs what happened

6. **Trust and install polish**
   - Verify whether install instructions are fully consistent across README, package metadata, release assets, npm, Homebrew, and docs.
   - Check for package name mismatches, old version references, stale release notes, badge accuracy, signing/notarization caveats, checksum clarity, Windows gap, and first-run UX.

7. **Proof gap**
   - Need benchmark or case-study evidence.
   - Need to show `code-oz` catches issues that direct-agent workflows miss.
   - Need a small repeatable benchmark with baseline vs `code-oz`:
     - Claude Code alone
     - Codex alone
     - Gemini CLI alone
     - direct agent + manual review
     - `code-oz` governed flow

8. **Roadmap visibility risk**
   - The project has deep architecture and milestone docs, but public users need a simple Now / Next / Later roadmap.
   - Avoid overwhelming readers with too many future mechanisms before core value is obvious.

9. **Community and contribution gap**
   - To reach 1,000 stars, the repo needs community-facing assets:
     - CONTRIBUTING.md
     - CODE_OF_CONDUCT.md if appropriate
     - issue templates
     - bug report template
     - feature request template
     - good first issues
     - architecture overview
     - demo GIF/asciicast
     - comparison table
     - launch blog post
     - Hacker News / Reddit / X / LinkedIn launch copy
     - release notes that tell a story

10. **Product scope risk**
    - There is a danger of building too many advanced mechanisms before proving the core loop.
    - Need brutal prioritization around the smallest path to real adoption.

## Research requirements

Perform current web research. Do not rely only on prior model memory. Use current official or primary sources wherever possible.

Research these areas:

### A. `code-oz` repo audit

Inspect the public repo deeply:

- README
- package metadata
- release history
- install scripts
- Homebrew tap if linked
- npm package if published
- docs/ABOUT.md
- docs/product thesis
- docs/design roadmap
- demo docs and captured outputs
- tests and test count claims
- CI workflows and badges
- issue tracker
- PRs if available
- contribution files
- license
- security policy
- examples
- screenshots/asciicasts

Produce:

1. Top 20 repo issues ranked by impact.
2. Top 20 product/storytelling issues ranked by impact.
3. Top 20 technical trust issues ranked by impact.
4. Top 20 fastest fixes that improve star conversion.
5. Top 10 things that already look strong and should not be changed.

### B. Competitive landscape

Research and compare at least these categories:

#### Direct/near-direct category

- HivePipe
- Qodo
- Sonar agentic SDLC / quality framing
- Factory
- Devin

#### Coding-agent workers that `code-oz` may orchestrate

- OpenAI Codex CLI / Codex Cloud
- Claude Code
- Gemini CLI
- OpenCode
- Roo Code
- Cursor agents
- GitHub Copilot coding agent if relevant

#### Frameworks / orchestration references

- Microsoft Agent Framework
- AWS Bedrock multi-agent collaboration
- Google Gemini Enterprise Agent Platform or current equivalent
- LangGraph
- AutoGen / AG2 if relevant
- CrewAI if relevant

For each, identify:

- What they claim
- Who they serve
- Their strongest feature
- Their trust/governance story
- Their UX/onboarding advantage
- Their pricing or access model if relevant
- Their public traction signals if available
- How `code-oz` can differentiate honestly
- What `code-oz` should not try to compete on

### C. Open-source growth research

Research how developer-tool repos reach 1,000 stars quickly.

Analyze:

- README conversion patterns
- demo quality patterns
- launch timing and channels
- benchmark posts
- comparison pages
- “awesome list” inclusion
- GitHub topic strategy
- landing page strategy
- docs site strategy
- launch assets
- community loops
- issue labeling
- contributor onboarding
- release cadence
- naming/tagline clarity
- SEO query targeting

Use examples from successful AI/devtool repos where possible.

### D. Product wedge and messaging

Find the strongest wedge for `code-oz`.

Test at least these positioning options:

1. “Auditable SDLC for AI coding agents”
2. “Git-native governance layer for Claude Code, Codex, and Gemini CLI”
3. “Make AI-generated code pass spec, test, and independent review before it ships”
4. “Run an AI software company from your terminal”
5. “The local-first control plane for AI coding agents”
6. “CI-style gates for AI coding agents”
7. “Agentic SDLC runtime for owned repos”

For each option, evaluate:

- clarity
- memorability
- credibility
- differentiation
- SEO potential
- developer appeal
- founder/CTO appeal
- risk of sounding too abstract
- risk of sounding like roleplay

Recommend one primary headline, one subtitle, and three alternate taglines.

### E. Proof and benchmark design

Design a small benchmark suite that can be built quickly and used in public launch material.

Requirements:

- Must be honest.
- Must be reproducible.
- Must compare against a direct-agent baseline.
- Must show where `code-oz` helps.
- Must include at least one failure case.
- Must avoid fake claims.
- Must be useful even if `code-oz` only wins in specific categories.

Output:

- benchmark name
- tasks
- setup commands
- baseline method
- `code-oz` method
- metrics
- expected result table format
- README badge or docs placement
- launch blog framing

### F. README rewrite plan

Create a full README rewrite plan.

Output:

1. Recommended README structure.
2. Exact replacement hero section.
3. Exact “Why not just Claude Code/Codex?” section.
4. Exact “What is real today?” section.
5. Exact “What is simulated?” section.
6. Exact “Quick demo” section.
7. Exact “Failure demo” section.
8. Exact install section.
9. Exact comparison table.
10. Exact “Who is this for?” section.
11. Exact “Roadmap: Now / Next / Later” section.
12. Exact “Star this repo if…” section.

Make the README easy to skim in under 90 seconds.

### G. 1,000-star execution plan

Create a step-by-step execution plan with phases:

#### Phase 0: repo credibility fixes, 1 to 2 days

Focus on anything that would make a visitor bounce.

#### Phase 1: demo and proof, 2 to 5 days

Focus on killer demo, failure demo, benchmark, screenshots/asciicast.

#### Phase 2: public launch package, 3 to 7 days

Focus on launch post, social posts, comparison page, docs, GitHub topics, release notes.

#### Phase 3: distribution, 1 to 3 weeks

Focus on Hacker News, Reddit, X, LinkedIn, dev.to, Medium, GitHub communities, AI coding communities, relevant Discords, newsletters, and direct outreach.

#### Phase 4: conversion loop, ongoing

Focus on issues, good-first-issues, response cadence, release cadence, feedback handling, roadmap updates, star-to-install conversion, install-to-demo conversion.

For each phase provide:

- why it matters
- exact tasks
- owner suggestion: Codex / Claude / human
- files likely to change
- acceptance criteria
- time estimate
- priority
- dependencies
- risk
- expected impact on stars

### H. Implementation backlog for Codex and Claude

Produce a backlog that can be pasted into Codex and Claude.

Format each item like:

```md
## Task: <title>

Type: docs | code | demo | benchmark | release | marketing | DX
Priority: P0 | P1 | P2
Owner: Codex | Claude | Human
Estimated effort: XS | S | M | L
Files likely touched:
- ...

Problem:
...

Why it matters:
...

Implementation steps:
1. ...
2. ...
3. ...

Acceptance criteria:
- ...

Validation command:
...

Notes:
...
```

Include at least:

- README rewrite
- install consistency audit
- demo polish
- failure-mode demo
- benchmark doc
- benchmark runner if needed
- comparison page
- public roadmap simplification
- GitHub issue templates
- good first issues
- contributing guide
- security/trust doc
- release notes rewrite
- landing page outline
- launch blog post
- social launch copy
- HN launch copy
- Reddit launch copy
- LinkedIn post
- X thread
- star history / metrics tracking plan

### I. Brutal objections

List the strongest objections from skeptical developers.

Examples:

- “This is overengineered.”
- “I can just use Claude Code.”
- “Multi-agent workflows are expensive.”
- “This is roleplay.”
- “FakeProvider demo does not prove real LLM value.”
- “I do not want another process layer.”
- “Agent review can still miss bugs.”
- “Why would teams trust this?”
- “Why should I star this?”

For each objection, provide:

- whether the objection is fair
- current weakness behind it
- best honest answer
- required product/doc change
- proof needed

### J. Final scoring rubric

Define what 10/10 means.

Create a rubric with scores from 1 to 10 for:

- engineering quality
- product clarity
- README conversion
- demo quality
- install trust
- competitive differentiation
- proof/benchmark credibility
- community readiness
- launch readiness
- maintainability
- security/trust posture
- star-growth potential

Score current state, target state, and gap.

## Output format required

Produce one large Markdown document with these sections:

1. Executive verdict
2. Current scorecard
3. What is already strong
4. What is weak and why
5. Competitive landscape
6. Best positioning recommendation
7. README rewrite package
8. Demo and benchmark plan
9. 1,000-star plan
10. Codex/Claude implementation backlog
11. Launch assets
12. Objection handling
13. 10/10 rubric
14. 7-day action plan
15. 30-day action plan
16. Appendix: sources and links

## Style requirements

- Be direct and honest.
- Do not flatter the project.
- Separate proven facts from assumptions.
- Use tables where useful.
- Make every recommendation actionable.
- Do not suggest vague tasks like “improve marketing.” Say exactly what to change.
- Prefer concrete examples and replacement copy.
- Do not invent traction numbers.
- Cite sources for competitor claims.
- Flag anything you could not verify.
- Prioritize actions that increase visitor trust, demo conversion, and stars.

## Final instruction

At the end, give me the shortest possible path to 1,000 stars with:

- the 5 changes to make first
- the 5 assets to publish first
- the 5 audiences to target first
- the 5 launch messages to test first
- the 5 metrics to track first

Be very strict. If something should be deleted, say delete it. If something should be simplified, rewrite it. If something is technically impressive but bad for adoption, say so.

===========# GPT-5.5 Pro research report: `code-oz` roadmap to 1,000 GitHub stars

# 1. Executive verdict

`code-oz` is technically more serious than its current public surface suggests, but it is not yet packaged for a 1,000-star launch.

The honest score today is closer to:

| Area                          |    Current score | Your stated score | My verdict                                                                                                                                 |
| ----------------------------- | ---------------: | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering strength          |     **8.0 / 10** |            8 / 10 | Fair. The architecture, tests, gates, worktrees, provider wrappers, and install mechanics are real.                                        |
| Market-ready product strength | **5.8–6.3 / 10** |          6.5 / 10 | Slightly too generous. The repo still asks first-time visitors to understand the architecture before they understand why they should care. |
| 1,000-star readiness          |     **3.5 / 10** |               n/a | Not launch-ready. You need a sharper hero, proof demo, failure demo, community files, and a clean public roadmap first.                    |

Verified facts: the repo is public, has **1 star**, **0 forks**, **1 open PR**, **12 releases**, latest release `v0.20.0-alpha.0`, and the GitHub sidebar still says **“No description, website, or topics provided.”** ([GitHub][1]) The current README says `v0.20.0-alpha.0` ships curl, npm, and Homebrew install channels; macOS/Linux binaries; `3366` offline tests; and live xAI integration gated behind opt-in env flags. ([GitHub][1]) The provider contract is more precise than the README: v0.1 ships Claude, Codex, Fake, xAI, and a **Gemini stub**; Gemini is not a working invocation provider today. ([GitHub][2])

The biggest issue is not that the product is weak. The biggest issue is that the public story is not ruthless enough. The repo currently leads with “repo-native agentic SDLC runtime,” “hybrid phase-graph,” “cross-family adversarial review,” and “AI software company.” Those are founder/architecture phrases. The first-time developer question is simpler:

> “Why should I put another tool between me and Claude Code/Codex?”

The answer should be:

> **Because direct agents are fast, but they do not create a tamper-evident delivery record. `code-oz` makes AI-generated code pass spec, test, approval, and independent review gates before it ships.**

Brutal prioritization: do **not** add advanced mechanisms before launch. Do **not** expand to Windows, cloud IAM, broad `consult()`, generalized multi-agent orchestration, or more provider families before proving the core loop. Get one killer demo, one failure demo, one benchmark, and one clear README.

---

# 2. Current scorecard

| Dimension                     | Current | Target |  Gap | Evidence / reason                                                                                                                                                                                 |
| ----------------------------- | ------: | -----: | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering quality           | **8.0** |    9.3 |  1.3 | Strong TypeScript/Bun implementation, file gates, worktrees, provider contracts, tests, install channels. Current README claims `3366` tests and shipped binaries. ([GitHub][3])                  |
| Product clarity               | **5.8** |    9.5 |  3.7 | The first sentence is accurate but dense. The README explains architecture before value. ([GitHub][1])                                                                                            |
| README conversion             | **5.5** |    9.5 |  4.0 | Missing simple “why this exists,” failure demo, benchmark proof, user personas, and skimmable value.                                                                                              |
| Demo quality                  | **6.8** |    9.3 |  2.5 | The todo demo is honest and reproducible, but it is FakeProvider-first and does not yet prove blocked failure modes. ([GitHub][4])                                                                |
| Install trust                 | **7.2** |    9.2 |  2.0 | Install script verifies checksums and npm wrapper has no postinstall hook, but binaries are unsigned/not notarized and checksums are not GPG/Sigstore-signed. ([GitHub][5])                       |
| Competitive differentiation   | **7.0** |    9.0 |  2.0 | The local-first governance wedge is strong, but HivePipe, Qodo, Sonar, Continue, GitHub Copilot, Claude Code, Codex, Cursor, Devin, and Factory all occupy adjacent trust/agentic SDLC territory. |
| Proof / benchmark credibility | **2.5** |    9.0 |  6.5 | No public benchmark yet showing that `code-oz` catches issues direct-agent workflows miss.                                                                                                        |
| Community readiness           | **1.8** |    9.0 |  7.2 | GitHub Community Standards show missing description, code of conduct, contributing guide, security policy, issue templates, and PR template. ([GitHub][6])                                        |
| Launch readiness              | **3.2** |    9.0 |  5.8 | Current release notes for latest release are thin compared with prior milestone releases. ([GitHub][7])                                                                                           |
| Maintainability               | **7.8** |    9.0 |  1.2 | Architecture is disciplined, but docs expose too much internal planning material for a public newcomer.                                                                                           |
| Security / trust posture      | **6.8** |    9.0 |  2.2 | Strong privacy/secret redaction patterns exist, but no `SECURITY.md`, unsigned artifacts, and deferred GPG/notarization reduce public trust. ([GitHub][8])                                        |
| Star-growth potential         | **6.2** |    9.0 |  2.8 | The idea is timely, but the launch package is not yet tight enough for broad developer sharing.                                                                                                   |

---

# 3. What is already strong

Do not change these fundamentals. Repackage them.

|    # | Strength                                    | Why it matters                                                                                               |
| ---: | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
|    1 | **File-based phase gates**                  | Developers can inspect lifecycle state instead of trusting an opaque agent transcript.                       |
|    2 | **SHA-256-bound approvals**                 | This is one of the clearest trust differentiators. Approval should bind to exact artifacts, not vibes.       |
|    3 | **Isolated worktrees**                      | Strong story for safe agent execution and restartability.                                                    |
|    4 | **`events.jsonl` ledger**                   | Great audit primitive. Make this visible in the demo.                                                        |
|    5 | **Deterministic FakeProvider path**         | Excellent for reproducible tests, demos, CI, and skepticism reduction.                                       |
|    6 | **Claude and Codex subprocess adapters**    | Provider-neutral control layer is more credible when it wraps tools developers already use. ([GitHub][9])    |
|    7 | **xAI HTTP adapter discipline**             | The redaction, allowlist, and typed error discipline are unusually thoughtful for an alpha. ([GitHub][10])   |
|    8 | **Install channels**                        | curl, npm, and Homebrew are the right channels for a CLI launch. ([GitHub][1])                               |
|    9 | **No npm postinstall hook**                 | This is a trust advantage. Keep saying it clearly. ([GitHub][11])                                            |
|   10 | **Honest demo “real vs simulated” section** | The demo already admits FakeProvider and validation limits. Move that honesty into the README. ([GitHub][4]) |

---

# 4. What is weak and why

## Top 20 repo issues ranked by impact

| Rank | Issue                                                                                                                   | Impact                                                                                                                                          | Fix                                                                                                   |
| ---: | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
|    1 | README overclaims provider support by listing Claude, Codex, Gemini, OpenCode, and Roo Code as if all are usable today. | High trust risk. Gemini is explicitly a stub; OpenCode/Roo adapters were not visible in the v0.1 provider contract. ([GitHub][2])               | Replace with “Claude, Codex, Fake, and xAI today; Gemini/OpenCode/Roo planned or adapter candidates.” |
|    2 | GitHub repo has no description, website, or topics.                                                                     | Immediate discovery/conversion loss. GitHub topics help people find projects. ([GitHub][1])                                                     | Add description, website/docs link, and topics today.                                                 |
|    3 | Missing `SECURITY.md`.                                                                                                  | Bad for a trust/governance tool. GitHub reports no security policy. ([GitHub][8])                                                               | Add `SECURITY.md` with vulnerability reporting and artifact trust posture.                            |
|    4 | Missing contribution basics.                                                                                            | Makes repo look closed or immature. GitHub Community Standards show missing contributing guide, issue templates, and PR template. ([GitHub][6]) | Add `CONTRIBUTING.md`, issue templates, PR template.                                                  |
|    5 | Latest release notes are too thin.                                                                                      | A visitor cannot tell why `v0.20.0-alpha.0` matters. ([GitHub][12])                                                                             | Rewrite latest release notes with story, install, demo, limitations, checksums.                       |
|    6 | README hero is architecture-first.                                                                                      | Developers bounce before understanding the value.                                                                                               | Replace hero with “CI-style gates for AI coding agents.”                                              |
|    7 | No failure-mode demo in README.                                                                                         | The product claims governance but only shows happy path.                                                                                        | Add tamper/refuse/review-fail demo.                                                                   |
|    8 | No public benchmark.                                                                                                    | Cannot prove “better than direct agent.”                                                                                                        | Add `docs/benchmarks/agent-gate-bench.md`.                                                            |
|    9 | Demo does not run real todo tests.                                                                                      | Weak proof. The demo admits validation is `test -f src/todo.ts`, not a real app test. ([GitHub][4])                                             | Add one fixture with real tests and intentional failure.                                              |
|   10 | Too many internal planning docs visible in public docs tree.                                                            | Intimidating and noisy.                                                                                                                         | Do not link internal Codex/Claude response docs from public onboarding.                               |
|   11 | “AI software company” metaphor risks sounding like roleplay.                                                            | Skeptical devs will dismiss it.                                                                                                                 | Move metaphor below fold or ABOUT only.                                                               |
|   12 | `beast` effort level sounds toy-like above fold.                                                                        | Hurts enterprise trust.                                                                                                                         | Keep flag, but describe as “high assurance” in README.                                                |
|   13 | Windows/Scoop deferred without public tracking issue.                                                                   | Windows users bounce.                                                                                                                           | Add issue: “Windows/Scoop support roadmap.”                                                           |
|   14 | Homebrew tap exists but has 0 stars and no releases.                                                                    | Fine technically, weak trust signal. ([GitHub][13])                                                                                             | Add tap description, topics, release note pointer.                                                    |
|   15 | No good-first-issues.                                                                                                   | No community loop.                                                                                                                              | Create 5–10 small issues before launch.                                                               |
|   16 | No comparison table in README.                                                                                          | Users ask “why not Claude Code/Codex?”                                                                                                          | Add short direct-agent comparison.                                                                    |
|   17 | No visual proof above fold.                                                                                             | README is text-heavy.                                                                                                                           | Add GIF/asciicast screenshot.                                                                         |
|   18 | No “What is real today?” above fold.                                                                                    | Alpha trust risk.                                                                                                                               | Add real/simulated/not-yet matrix.                                                                    |
|   19 | Package description says “software-company simulation.”                                                                 | Reinforces roleplay concern. ([GitHub][14])                                                                                                     | Change to “Governed SDLC runtime for AI coding agents.”                                               |
|   20 | Release workflow signs checksums only by GitHub release attachment, not cryptographic signature.                        | Acceptable alpha, but weak for trust product. ([GitHub][15])                                                                                    | Add Sigstore/GPG plan; mark unsigned clearly.                                                         |

## Top 20 product/storytelling issues ranked by impact

| Rank | Issue                                                  | Why it hurts                             | Replacement direction                                                        |
| ---: | ------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
|    1 | “Repo-native agentic SDLC runtime”                     | Too abstract.                            | “CI-style gates for AI coding agents.”                                       |
|    2 | “Hybrid phase-graph + agentic sub-orchestration spine” | Architecture jargon.                     | “Spec → plan → build → test → review → ship.”                                |
|    3 | “Cross-family adversarial review”                      | Accurate but dense.                      | “A different model family reviews the change.”                               |
|    4 | “Run an AI software company” above fold                | Sounds like simulation/roleplay.         | Keep as optional metaphor lower down.                                        |
|    5 | No direct answer to “Why not Claude Code?”             | Main adoption objection unanswered.      | Add explicit FAQ section.                                                    |
|    6 | No clear target user.                                  | Everyone/nobody problem.                 | “For developers using coding agents on repos they actually own.”             |
|    7 | No short “what happens in 60 seconds.”                 | Hard to try.                             | Add 3-command demo.                                                          |
|    8 | No public “today vs future” table.                     | Creates overclaim risk.                  | Add shipped/simulated/not-yet matrix.                                        |
|    9 | No outcome promise.                                    | Process sounds like overhead.            | “Catch tampering, failed verification, and same-family rubber-stamp review.” |
|   10 | No screenshot/GIF.                                     | Low shareability.                        | Add terminal GIF.                                                            |
|   11 | No benchmark.                                          | No proof.                                | Add benchmark even if narrow.                                                |
|   12 | No failure story.                                      | Governance claims need failure evidence. | Add “bad agent output blocked” demo.                                         |
|   13 | Too much milestone language.                           | Feels like internal roadmap.             | Compress into Now/Next/Later.                                                |
|   14 | Influence library too prominent in ABOUT.              | Can make project look derivative.        | Keep, but after value/proof.                                                 |
|   15 | No “not for you if…” section.                          | Increases mismatch.                      | Add honest scope.                                                            |
|   16 | “beast” effort level                                   | Sounds unserious in first impression.    | Use “lite/balanced/max/high-assurance” in docs; keep CLI if desired.         |
|   17 | No star CTA.                                           | Missed conversion.                       | Add “Star if you care about auditable AI coding.”                            |
|   18 | No install risk explanation.                           | Unsigned binaries can scare macOS users. | Add trust note with exact verification.                                      |
|   19 | No launch narrative.                                   | Hard for HN/Reddit to discuss.           | “Direct agents are fast; governed agents are auditable.”                     |
|   20 | No examples of expensive mistakes prevented.           | Weak ROI.                                | Add three concrete scenarios: tampered spec, failed tests, risky review.     |

## Top 20 technical trust issues ranked by impact

| Rank | Issue                                                                           | Impact                               | Required change                                         |
| ---: | ------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
|    1 | Gemini is a stub while README names Gemini in the agent list.                   | Overclaim.                           | Correct README. ([GitHub][2])                           |
|    2 | OpenCode/Roo Code named in README but not listed in v0.1 provider contract.     | Overclaim.                           | Mark as future/adapter candidates only.                 |
|    3 | No `SECURITY.md`.                                                               | Trust gap.                           | Add immediately.                                        |
|    4 | Unsigned/not notarized macOS binaries.                                          | Trust gap.                           | Keep caveat, add roadmap/date/issue. ([GitHub][16])     |
|    5 | Checksums not GPG/Sigstore signed.                                              | Supply-chain gap.                    | Add Sigstore/GPG milestone.                             |
|    6 | npm wrapper returns cached binary without visible re-verification on every run. | Cache-tamper concern. ([GitHub][11]) | Add checksum sidecar and verify cache before exec.      |
|    7 | npm wrapper redirect recursion has no visible limit.                            | Defensive hardening. ([GitHub][11])  | Add max redirect count.                                 |
|    8 | Latest release workflow lacks release smoke tests in visible workflow.          | Distribution trust. ([GitHub][15])   | Add install smoke for curl/npm/Homebrew before release. |
|    9 | Release notes do not explain checksums or install verification.                 | Trust gap.                           | Rewrite notes.                                          |
|   10 | FakeProvider demo could be misread as real model proof.                         | Credibility risk.                    | Label FakeProvider everywhere.                          |
|   11 | Demo verification is too weak.                                                  | Proof risk.                          | Add real test fixture.                                  |
|   12 | No SBOM/provenance.                                                             | Supply-chain trust gap.              | Add future SLSA/SBOM plan.                              |
|   13 | No issue tracker seeds.                                                         | Community trust gap.                 | Add public issues.                                      |
|   14 | No public benchmark harness.                                                    | Claim risk.                          | Add benchmark runner.                                   |
|   15 | xAI direct API-key path expands trust boundary.                                 | Acceptable, but needs docs.          | Keep strict redaction docs. ([GitHub][10])              |
|   16 | No Windows support.                                                             | Adoption gap.                        | Track explicitly.                                       |
|   17 | No provider health screenshot.                                                  | Onboarding gap.                      | Add `code-oz doctor providers` output.                  |
|   18 | No “safe uninstall / cache location” docs.                                      | DX gap.                              | Add to install docs.                                    |
|   19 | No public install-channel matrix.                                               | Trust gap.                           | Add table: curl/npm/Homebrew/source.                    |
|   20 | No explicit data boundary diagram.                                              | Trust gap.                           | Add `docs/TRUST.md`.                                    |

## Top 20 fastest fixes that improve star conversion

| Rank | Fix                                                                                                                             | Owner          | Time   |
| ---: | ------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ |
|    1 | Add GitHub repo description: “CI-style gates for AI coding agents.”                                                             | Human          | 5 min  |
|    2 | Add topics: `ai`, `coding-agent`, `cli`, `sdlc`, `devtools`, `agentic-ai`, `claude-code`, `codex`, `typescript`, `open-source`. | Human          | 5 min  |
|    3 | Rewrite README hero.                                                                                                            | Claude         | 1 hr   |
|    4 | Correct provider support table.                                                                                                 | Claude         | 30 min |
|    5 | Change `package.json` description.                                                                                              | Codex          | 10 min |
|    6 | Add `SECURITY.md`.                                                                                                              | Claude         | 45 min |
|    7 | Add `CONTRIBUTING.md`.                                                                                                          | Claude         | 1 hr   |
|    8 | Add issue templates.                                                                                                            | Codex          | 45 min |
|    9 | Add PR template.                                                                                                                | Codex          | 20 min |
|   10 | Add `docs/TRUST.md`.                                                                                                            | Claude         | 2 hr   |
|   11 | Add “What is real / simulated / not yet” table.                                                                                 | Claude         | 45 min |
|   12 | Add failure demo doc.                                                                                                           | Codex          | 3–6 hr |
|   13 | Add README comparison table.                                                                                                    | Claude         | 1 hr   |
|   14 | Add Now/Next/Later roadmap.                                                                                                     | Claude         | 45 min |
|   15 | Rewrite latest release notes.                                                                                                   | Human + Claude | 1 hr   |
|   16 | Add 5 good-first-issues.                                                                                                        | Human          | 45 min |
|   17 | Add terminal GIF/asciicast to README.                                                                                           | Human + Codex  | 2 hr   |
|   18 | Add benchmark doc skeleton.                                                                                                     | Claude         | 1 hr   |
|   19 | Add install verification commands.                                                                                              | Codex          | 1 hr   |
|   20 | Add star CTA.                                                                                                                   | Claude         | 10 min |

---

# 5. Competitive landscape

## Direct / near-direct category

| Product  | What they claim                                                                                                       | Who they serve                                               | Strongest feature                                                                     | Trust/governance story                                                                     | UX/onboarding advantage             | Pricing/access                                                                                                 | Public traction signal                                                             | How `code-oz` can differentiate                                                 | Do not compete on                       |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| HivePipe | Agentic SDLC platform with PRDs, validation, approval gates, audit trails, and Git-native PR output. ([HivePipe][17]) | Teams wanting structured AI SDLC.                            | End-to-end team workflow.                                                             | Approval gates, audit trail, role-aware controls, multi-provider BYOK. ([HivePipe][17])    | SaaS/productized workflow.          | Not fully verified.                                                                                            | Not verified.                                                                      | Be the **local-first, CLI-first, source-visible** governance layer.             | Enterprise SaaS/RBAC/compliance suite.  |
| Qodo     | AI code review, multi-agent review, rule enforcement, PR/IDE/CLI workflow. ([Qodo Documentation][18])                 | Teams with PR quality needs.                                 | PR review and code quality feedback.                                                  | Multi-agent review, rule enforcement, privacy options.                                     | IDE/PR-native.                      | Free developer tier; Teams pricing listed at $38 monthly or $30 annual per user in search result. ([Qodo][19]) | VS Marketplace result shows large install count. ([Visual Studio Marketplace][20]) | Govern work **before** PR review; produce auditable lifecycle artifacts.        | Competing with Qodo as a review engine. |
| Sonar    | AI Code Assurance validates AI-generated code using quality gates and analysis. ([SonarSource][21])                   | Enterprises and teams with static analysis/compliance needs. | Mature static analysis and quality gates.                                             | Quality/security gates, compliance mapping, badges, remediation agent. ([SonarSource][22]) | Existing enterprise adoption.       | Enterprise features vary by product tier. ([Sonar Documentation][23])                                          | Sonar claims millions of developers/orgs for its platform. ([SonarSource][24])     | Integrate with Sonar as VERIFY evidence.                                        | Static analysis/compliance database.    |
| Factory  | Droids automate coding, testing, and deployment. ([Factory.ai][25])                                                   | Startups and enterprises using background agents.            | Cloud/local background agents and enterprise analytics. ([Factory Documentation][26]) | Analytics/observability around agent usage.                                                | Managed agent platform.             | Pro/Plus/Max tiers in docs. ([Factory Documentation][27])                                                      | Not verified.                                                                      | Be a repo-local governance wrapper around agents, not a hosted agent workforce. | Cloud agent compute.                    |
| Devin    | AI coding agent / software engineer for teams; can plan, code, test, ship. ([Devin][28])                              | Engineering teams that want autonomous cloud agents.         | Autonomous cloud workspace.                                                           | Logs, integrations, review workflows.                                                      | Agent-as-worker experience.         | Free/Pro/Max/Teams/Enterprise listed by Cognition. ([Devin][29])                                               | Historical SWE-bench launch claim was prominent. ([Cognition][30])                 | Be the auditable SDLC control layer for local/CLI agents.                       | Autonomous cloud engineer replacement.  |
| Continue | AI checks on PRs as GitHub status checks, with markdown checks in repo. ([GitHub][31])                                | Teams wanting PR-level AI quality control.                   | Source-controlled AI checks.                                                          | GitHub status checks and markdown-defined rules.                                           | Clear “run checks on a PR” framing. | Product/pricing not fully audited here.                                                                        | Not verified.                                                                      | Own the pre-PR lifecycle and approval artifacts.                                | PR-check SaaS.                          |

## Coding-agent workers that `code-oz` may orchestrate

| Worker                         | Claim                                                                                                                                                | Trust/governance story                                                            | UX advantage                                      | Access/pricing                                                                | Public traction signal                                                                 | `code-oz` angle                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| OpenAI Codex CLI / Codex Cloud | Codex CLI runs locally from terminal; Codex web/cloud works in parallel cloud environments. ([GitHub][32])                                           | Sandboxing, local CLI, GitHub code review support. ([OpenAI Developers][33])      | Official OpenAI agent; easy npm/Homebrew install. | Included in ChatGPT plans; pricing/rate tiers vary. ([OpenAI Developers][34]) | Official repo and docs.                                                                | `code-oz` should wrap Codex with phase gates, not compete with it.          |
| Claude Code                    | Agentic coding tool that reads codebase, edits files, runs commands, and integrates with dev tools. ([Claude][35])                                   | Anthropic security/trust docs and GitHub Actions review workflows. ([Claude][36]) | Very strong terminal-native workflow.             | Pro/Max access options. ([Claude Help Center][37])                            | Broad developer mindshare, exact usage not audited.                                    | `code-oz` should answer “when Claude Code is too unconstrained.”            |
| Gemini CLI                     | Open-source terminal AI agent using ReAct loop, tools, and MCP. ([GitHub][38])                                                                       | Google ecosystem, open-source CLI, GitHub Actions integrations.                   | Free/open terminal path. ([blog.google][39])      | Google account/API paths.                                                     | Active releases. ([GitHub][40])                                                        | Do not claim support until adapter works.                                   |
| OpenCode                       | Open-source AI coding agent; free models or connect providers. ([OpenCode][41])                                                                      | Open-source, GitHub Actions integration. ([OpenCode][42])                         | Provider flexibility.                             | Free models / BYO provider.                                                   | Search result showed ~12.5k stars for org repo. ([GitHub][43])                         | Future worker adapter candidate.                                            |
| Roo Code                       | Autonomous VS Code coding agent, model-agnostic, specialized modes, local extension and cloud agents. ([Roo Code Docs][44])                          | Human-in-the-loop local editor workflow.                                          | VS Code integration.                              | Extension / cloud offerings.                                                  | GitHub result showed ~24k stars and Marketplace showed ~1.61M installs. ([GitHub][45]) | Future adapter candidate; do not claim current support.                     |
| Cursor agents                  | Agent mode, Bugbot review, AI IDE/CLI workflow. ([Cursor][46])                                                                                       | Bugbot PR review, repository/team rules. ([Cursor][47])                           | Best-in-class IDE UX.                             | Pro+/Ultra/Teams. ([Cursor][48])                                              | Large mindshare; exact current numbers not audited.                                    | `code-oz` should not compete on IDE UX.                                     |
| GitHub Copilot coding agent    | Cloud agent can plan, code changes on a branch, and open PRs; GitHub says branch protections and human approval remain relevant. ([GitHub Docs][49]) | PR workflow, code review, GitHub-native controls. ([GitHub Docs][50])             | Native GitHub integration.                        | Free/Pro/Pro+/Business/Enterprise tiers. ([GitHub Docs][51])                  | Massive GitHub distribution.                                                           | Compete as local/source-visible governance, not as GitHub-native agent hub. |
| Aider                          | “AI Pair Programming in Your Terminal.” ([GitHub][52])                                                                                               | Git integration, terminal-native repo editing.                                    | Extremely clear positioning and screencast.       | Open-source / package ecosystem.                                              | GitHub org page showed ~44k stars. ([GitHub][53])                                      | Learn README simplicity: one sentence, one demo, one install path.          |

## Frameworks and orchestration references

| Framework/platform                            | Claim                                                                                                                                                  | Relevance to `code-oz`                                                                    | Do not compete on                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Microsoft Agent Framework                     | Open framework for production-grade agents and multi-agent workflows in .NET/Python, succeeding Semantic Kernel/AutoGen ideas. ([Microsoft Learn][54]) | Validates that multi-agent workflows, state, telemetry, and human-in-loop are mainstream. | General enterprise agent framework.             |
| AWS Bedrock multi-agent collaboration         | Supervisor agent coordinates collaborator agents for complex workflows. ([AWS Documentation][55])                                                      | Reinforces supervisor/collaborator architecture as a cloud pattern.                       | AWS cloud agent platform.                       |
| Google Gemini Enterprise Agent Platform / ADK | Platform to build, scale, govern, and optimize agents; ADK offers control, tools, debugging, evaluation. ([Google Cloud][56])                          | Governance and evaluation are core enterprise agent needs.                                | Cloud agent platform / enterprise deployment.   |
| LangGraph                                     | Durable execution, persistence, human-in-the-loop, memory. ([LangChain Docs][57])                                                                      | Good conceptual reference for durable agent workflows.                                    | General agent workflow framework.               |
| AutoGen / AG2                                 | Multi-agent collaboration, human-in-the-loop workflows, tool use. ([Microsoft GitHub][58])                                                             | Shows the multi-agent category is crowded.                                                | General multi-agent research/runtime framework. |
| CrewAI                                        | Multi-agent automation framework/platform with tools and studio/API options. ([CrewAI][59])                                                            | Reinforces that generic “AI workforce” language is commoditized.                          | Role-playing agent framework.                   |

## Competitive conclusion

`code-oz` should not position as “the best coding agent,” “the best multi-agent framework,” or “an AI software company.” That market is crowded and better-funded.

The honest wedge is:

> **A local-first, CLI-first governance layer for AI coding agents that creates inspectable artifacts, SHA-bound approvals, isolated worktrees, verification evidence, and cross-family review.**

That is narrow enough to be believable.

---

# 6. Best positioning recommendation

## Positioning options scored

| Option                                                                            | Clarity | Memorability | Credibility | Differentiation |  SEO | Dev appeal | CTO appeal | Abstract risk | Roleplay risk | Verdict                           |
| --------------------------------------------------------------------------------- | ------: | -----------: | ----------: | --------------: | ---: | ---------: | ---------: | ------------: | ------------: | --------------------------------- |
| 1. Auditable SDLC for AI coding agents                                            |       8 |            7 |           8 |               8 |    8 |          7 |          9 |        Medium |           Low | Good subtitle, not best headline. |
| 2. Git-native governance layer for Claude Code, Codex, and Gemini CLI             |       8 |            6 |     6 today |               8 |    9 |          8 |          8 |           Low |           Low | Too risky until Gemini works.     |
| 3. Make AI-generated code pass spec, test, and independent review before it ships |      10 |            7 |           9 |               8 |    7 |          9 |          9 |           Low |           Low | Best explanatory sentence.        |
| 4. Run an AI software company from your terminal                                  |       7 |            9 |           5 |               7 |    5 |          6 |          6 |        Medium |          High | Keep as metaphor only.            |
| 5. The local-first control plane for AI coding agents                             |       8 |            7 |           8 |               9 |    8 |          8 |          8 |        Medium |           Low | Strong secondary positioning.     |
| 6. CI-style gates for AI coding agents                                            |      10 |            9 |           8 |               9 |    8 |         10 |          8 |           Low |           Low | Best primary headline.            |
| 7. Agentic SDLC runtime for owned repos                                           |       6 |            5 |           8 |               7 |    7 |          5 |          8 |          High |           Low | Too abstract for README hero.     |

## Recommended primary headline

> **CI-style gates for AI coding agents.**

## Recommended subtitle

> `code-oz` runs coding agents through a repo-local delivery loop: define the task, plan the change, build in an isolated worktree, verify evidence, require independent review, and ship only after approved artifacts match their SHA-256s.

## Three alternate taglines

1. **Direct agents are fast. `code-oz` makes them auditable.**
2. **Make AI-generated code pass spec, test, and independent review before it ships.**
3. **The local-first control layer for Claude Code, Codex, FakeProvider, and future coding-agent adapters.**

## Delete / demote

Delete from the README hero:

- “repo-native agentic SDLC runtime”
- “hybrid phase-graph”
- “cross-family adversarial review”
- “Run an AI software company from your terminal”

Move them to `docs/ABOUT.md` or an architecture section.

---

# 7. README rewrite package

## Recommended README structure

1. Hero: one sentence, one subtitle, one 5-bullet trust summary.
2. 60-second demo.
3. Why not just Claude Code/Codex?
4. What is real today?
5. What is simulated?
6. Install.
7. Quick demo.
8. Failure demo.
9. Comparison table.
10. Who this is for.
11. Roadmap: Now / Next / Later.
12. Trust model.
13. Contributing.
14. Star CTA.

## Exact replacement hero section

```md
# code-oz

**CI-style gates for AI coding agents.**

`code-oz` runs coding agents through a repo-local delivery loop:

**DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP**

Use it when direct AI coding is too unconstrained and you want every change to pass through inspectable artifacts, approval gates, verification evidence, and independent review before it ships.

AI agents are fast. `code-oz` makes their work auditable.

What you get:

- file-based phase gates you can inspect in the repo
- approvals bound to exact artifact SHA-256s
- isolated worktrees for agent changes
- an `events.jsonl` ledger for reconstructing what happened
- cross-family review so the builder and reviewer are not the same model family

Status: public alpha. The deterministic demo uses `FakeProvider` so you can inspect the lifecycle without spending tokens.
```

## Exact “Why not just Claude Code/Codex?” section

```md
## Why not just Claude Code or Codex?

Use Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Roo Code, or Aider directly when you want the fastest possible agent loop.

Use `code-oz` when you want a governed loop.

Direct-agent workflow:

1. Ask an agent to make a change.
2. Inspect the result.
3. Hope the prompt, tests, and review were enough.

`code-oz` workflow:

1. Define the task as an artifact.
2. Approve the artifact by SHA-256.
3. Build in an isolated worktree.
4. Verify evidence before review.
5. Require independent review.
6. Write a ledger of what happened.

`code-oz` is not trying to be a smarter coding model.

It is the control layer around coding models.
```

## Exact “What is real today?” section

```md
## What is real today?

Current alpha support:

| Area             | Status                                                               |
| ---------------- | -------------------------------------------------------------------- |
| CLI commands     | `init`, `run`, `approve`, `doctor`                                   |
| Lifecycle        | `DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP` for greenfield runs |
| Gates            | File-based gates with schema validation                              |
| Approvals        | SHA-256-bound approval artifacts                                     |
| Isolation        | Worktree-per-run isolation                                           |
| Ledger           | `events.jsonl` audit trail                                           |
| Demo provider    | Deterministic `FakeProvider`                                         |
| Live providers   | Claude CLI, Codex CLI, and xAI HTTP adapter                          |
| xAI auth         | `XAI_API_KEY` env var                                                |
| Install channels | curl script, npm package, Homebrew tap                               |
| Platforms        | macOS arm64, macOS x64, Linux arm64, Linux x64                       |
| Tests            | Offline test suite in CI                                             |

The provider contract is intentionally narrow. The alpha is about proving governed delivery, not supporting every agent on day one.
```

## Exact “What is simulated?” section

```md
## What is simulated or not ready yet?

| Area                           | Current state                                               |
| ------------------------------ | ----------------------------------------------------------- |
| FakeProvider demo              | Simulated model responses, real gates/artifacts/ledger      |
| Gemini                         | Stub provider in v0.1; not a working invocation adapter yet |
| OpenCode / Roo Code            | Adapter candidates, not current v0.1 providers              |
| Windows / Scoop                | Deferred                                                    |
| Apple signing / notarization   | Deferred; macOS may show Gatekeeper prompts                 |
| GPG/Sigstore-signed checksums  | Deferred                                                    |
| Full benchmark proof           | Planned                                                     |
| Broad multi-agent consultation | Deferred                                                    |
| Cloud IAM adapters             | Deferred                                                    |

Do not use the alpha as proof that one model writes better code than another. Use it to inspect whether the governed lifecycle works.
```

## Exact “Quick demo” section

````md
## Quick demo

Run the deterministic demo:

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun run demo:todo-cli
````

The demo runs one full lifecycle:

```txt
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Then inspect:

```sh
ls docs/demo/01-todo-cli/output/
cat docs/demo/01-todo-cli/output/balanced/state/events.jsonl | tail
```

The demo uses `FakeProvider`, so it is deterministic and token-free. The value is not “the fake model is smart.” The value is that the same gates, approvals, worktree flow, and ledger mechanics are exercised every time.

````

## Exact “Failure demo” section

```md
## Failure demo

Governance only matters if bad runs get blocked.

After adding the failure fixture, run:

```sh
bun run demo:failure-gates
````

Expected failures:

| Failure                                          | Expected result                                  |
| ------------------------------------------------ | ------------------------------------------------ |
| Tampered approved artifact                       | Gate refuses because SHA-256 no longer matches   |
| BUILD output changes files outside allowed scope | Mutation gate blocks the run                     |
| VERIFY evidence fails                            | Run restarts or writes `NEEDS_INTERVENTION.json` |
| REVIEW uses same provider family as BUILD        | Cross-family review check refuses it             |
| Reviewer finds risky change                      | Run routes back to revision instead of SHIP      |

This is the demo to watch before trusting the tool.

````

## Exact install section

```md
## Install

Three install channels ship the same binary and verify against the same release checksums.

### curl

```sh
curl -fsSL https://github.com/omerakben/code-oz/releases/download/v0.20.0-alpha.0/install.sh \
  | sh -s -- --version v0.20.0-alpha.0
````

### npm

```sh
npm install -g @tuel/code-oz
code-oz doctor
```

The npm package installs a small launcher. It does not use a postinstall hook. On first run, it downloads the matching release binary, verifies the checksum, caches it, and executes it.

### Homebrew

```sh
brew tap omerakben/code-oz
brew install omerakben/code-oz/code-oz
code-oz doctor
```

### From source

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
bun run build:binary
./dist/code-oz doctor
```

Supported today: macOS arm64, macOS x64, Linux arm64, Linux x64.

Not supported today: Windows.

````

## Exact comparison table

```md
## How is this different?

| Tool                       | Best for                                   | What `code-oz` adds                                                         |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Claude Code                | Fast terminal coding with Claude           | Repo-local gates, approvals, worktree isolation, ledger, independent review |
| Codex CLI                  | Fast terminal coding with OpenAI models    | Same governed lifecycle around Codex output                                 |
| Cursor                     | AI-native IDE workflow                     | External lifecycle governance outside the editor                            |
| Gemini CLI                 | Open-source terminal agent                 | Future adapter candidate; not supported in v0.1                             |
| OpenCode                   | Open-source provider-flexible coding agent | Future adapter candidate; not supported in v0.1                             |
| Roo Code                   | VS Code agent workflow                     | Future adapter candidate; not supported in v0.1                             |
| Qodo / Sonar               | PR/code quality review                     | Earlier lifecycle gates before the PR review stage                          |
| HivePipe / Devin / Factory | Managed agentic SDLC or agent workforce    | Local-first, source-visible CLI runtime for owned repos                     |

`code-oz` is not a replacement for coding agents.

It is a governed delivery loop around them.
````

## Exact “Who is this for?” section

```md
## Who is this for?

Use `code-oz` if:

- you already use AI coding agents
- you work in repos where mistakes matter
- you want approval artifacts instead of chat transcripts
- you want to compare builder and reviewer model families
- you want a reproducible audit trail for AI-generated changes

Do not use `code-oz` yet if:

- you want the fastest possible one-shot code generation
- you need Windows support today
- you need a polished enterprise SaaS dashboard
- you need every provider family supported today
- you are not willing to run an alpha
```

## Exact “Roadmap: Now / Next / Later” section

```md
## Roadmap

### Now

- Alpha CLI
- Deterministic FakeProvider demo
- Claude CLI adapter
- Codex CLI adapter
- xAI HTTP adapter
- File gates and SHA-bound approvals
- Isolated worktrees
- Event ledger
- macOS/Linux install channels

### Next

- Failure-mode demo
- Reproducible benchmark suite
- Brownfield `AUDIT` runtime
- Better first-run onboarding
- Windows/Scoop support
- Signed checksums / stronger release provenance
- Public docs site or landing page

### Later

- Gemini live adapter
- OpenCode/Roo adapter exploration
- Cloud IAM adapters
- Rich TUI
- PR/CI integration
- Broader multi-agent consultation
```

## Exact “Star this repo if…” section

```md
## Star this repo if...

Star `code-oz` if you think AI coding agents need more than clever prompts:

- inspectable specs and plans
- test evidence before review
- independent model-family review
- tamper-evident approvals
- a ledger of what the agent did

Direct agents are fast.

Governed agents are auditable.
```

---

# 8. Demo and benchmark plan

## Killer demo

Name:

> `docs/demo/02-failure-gates`

Purpose:

> Prove that `code-oz` blocks bad AI delivery, not merely that it can run a happy path.

Required scenarios:

| Scenario               | Setup                                                     | Expected result                               |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------- |
| Tampered artifact      | Approve PLAN, then edit it.                               | `approve` or next phase refuses SHA mismatch. |
| Bad BUILD output       | FakeProvider writes file outside allowed path.            | Mutation gate blocks.                         |
| VERIFY failure         | FakeProvider creates code that fails test command.        | Restart or `NEEDS_INTERVENTION.json`.         |
| Same-family review     | BUILD and REVIEW both configured as same provider family. | Review request refused.                       |
| Risky reviewer finding | Reviewer flags shell injection / unsafe file deletion.    | Routes to revision instead of SHIP.           |
| Ledger replay          | Show `events.jsonl` reconstructing the incident.          | User can see exact failure chain.             |

## Benchmark name

> **Agent Gate Bench**

## Benchmark thesis

Do not claim `code-oz` writes better code. Claim something narrower:

> `code-oz` catches governance failures that direct-agent workflows do not record or block by default.

## Tasks

| Task                  | Type         | Direct-agent risk                        | `code-oz` value                              |
| --------------------- | ------------ | ---------------------------------------- | -------------------------------------------- |
| `todo-cli-real-tests` | Happy path   | Agent may pass superficial check.        | Requires real test evidence.                 |
| `tampered-plan`       | Failure      | Manual reviewer may miss artifact drift. | SHA-bound approval blocks drift.             |
| `scope-escape`        | Failure      | Agent edits extra files.                 | Mutation gate blocks.                        |
| `same-family-review`  | Failure      | Same model rubber-stamps itself.         | Cross-family policy blocks.                  |
| `verify-fail-restart` | Failure      | Direct flow leaves human to notice.      | Run records failure and restarts/intervenes. |
| `risky-shell-change`  | Security-ish | Agent may add unsafe shell execution.    | Reviewer must identify and block.            |

## Setup commands

```sh
git clone https://github.com/omerakben/code-oz.git
cd code-oz
bun install
bun test
bun run bench:agent-gate -- --fixture all --provider fake
```

Optional direct-agent baseline:

```sh
bun run bench:agent-gate -- --fixture all --baseline codex
bun run bench:agent-gate -- --fixture all --baseline claude
```

## Baseline method

For each task:

1. Provide the same task prompt to the direct agent.
2. Allow the direct agent to edit the fixture repo.
3. Run the same test command.
4. Record pass/fail, human interventions, time, and whether the failure was explicitly blocked or merely observed.

Baselines:

- Claude Code alone
- Codex CLI alone
- Gemini CLI alone, once real adapter/baseline exists
- Direct agent + manual review
- `code-oz` governed flow

## `code-oz` method

1. Put task into `DEFINE`.
2. Approve artifact.
3. PLAN.
4. Approve plan.
5. BUILD in isolated worktree.
6. VERIFY with fixture tests.
7. REVIEW with different provider family or FakeProvider-scripted reviewer.
8. SHIP only if all gates pass.

## Metrics

| Metric                | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| Task success          | Final code passes tests and meets acceptance criteria.             |
| Governance block rate | Expected bad cases blocked by gates.                               |
| False block rate      | Good runs incorrectly blocked.                                     |
| Human interventions   | Count and reason.                                                  |
| Audit completeness    | Can a third party reconstruct what happened from artifacts/events? |
| Time                  | Wall-clock duration.                                               |
| Cost                  | Tokens/provider calls where available.                             |
| Reproducibility       | Same result across repeated FakeProvider runs.                     |
| Evidence quality      | Are verify/review outputs inspectable?                             |

## Expected public result table format

```md
| Fixture             |  Baseline: Claude Code |        Baseline: Codex | Direct + manual review | code-oz FakeProvider | code-oz live provider | Notes               |
| ------------------- | ---------------------: | ---------------------: | ---------------------: | -------------------: | --------------------: | ------------------- |
| todo-cli-real-tests |                    TBD |                    TBD |                    TBD |                 Pass |                   TBD | Happy path          |
| tampered-plan       | Not blocked by default | Not blocked by default |    Depends on reviewer |              Blocked |                   TBD | SHA-bound approval  |
| scope-escape        |                    TBD |                    TBD |                    TBD |              Blocked |                   TBD | Mutation gate       |
| same-family-review  |                    n/a |                    n/a |                    n/a |              Blocked |                   TBD | Cross-family policy |
| verify-fail-restart |                    TBD |                    TBD |                    TBD |    Blocked/restarted |                   TBD | Verification gate   |
| risky-shell-change  |                    TBD |                    TBD |                    TBD |  Blocked by reviewer |                   TBD | Review gate         |
```

Use `TBD` until measured. Do not fill optimistic numbers.

## README badge/docs placement

Add after hero:

```md
[Benchmark: Agent Gate Bench](docs/benchmarks/agent-gate-bench.md)
```

Badge text once data exists:

```md
Agent Gate Bench: 4/4 governance failures blocked in FakeProvider fixtures
```

## Launch blog framing

Title:

> **I built CI-style gates for AI coding agents because direct agents are too easy to trust**

Core argument:

1. Coding agents are fast.
2. Speed without evidence creates hidden risk.
3. CI solved this for human code with gates.
4. `code-oz` applies that pattern to agent-generated code.
5. The alpha is small and honest: FakeProvider demo, Claude/Codex/xAI adapters, known limitations.
6. Here is the failure demo.

---

# 9. 1,000-star plan

## Phase 0: repo credibility fixes, 1–2 days

| Task                            | Why it matters                                   | Owner          | Files likely changed                         | Acceptance criteria                               | Priority | Dependencies | Risk | Expected star impact    |
| ------------------------------- | ------------------------------------------------ | -------------- | -------------------------------------------- | ------------------------------------------------- | -------- | ------------ | ---- | ----------------------- |
| Add repo description/topics     | Fixes immediate GitHub discovery and trust.      | Human          | GitHub settings                              | Description + 8–10 topics set.                    | P0       | None         | None | High conversion hygiene |
| README hero rewrite             | First 10 seconds decide bounce/star.             | Claude         | `README.md`                                  | New hero, why-not section, real/simulated matrix. | P0       | None         | Low  | High                    |
| Correct provider support claims | Prevents overclaim.                              | Claude         | `README.md`, `docs/ABOUT.md`                 | Gemini/OpenCode/Roo not claimed as live.          | P0       | None         | Low  | High trust              |
| Add security/community files    | Makes repo look legitimate.                      | Codex + Claude | `SECURITY.md`, `CONTRIBUTING.md`, `.github/` | GitHub Community Standards mostly green.          | P0       | None         | Low  | Medium/high             |
| Rewrite latest release notes    | Current release looks thin.                      | Human + Claude | GitHub release notes, `CHANGELOG.md`         | Release explains install/demo/limits.             | P0       | None         | Low  | Medium                  |
| Package description update      | Removes “simulation” above fold in npm metadata. | Codex          | `package.json`                               | Description uses governance wording.              | P0       | None         | Low  | Medium                  |

## Phase 1: demo and proof, 2–5 days

| Task               | Why it matters               | Owner         | Files likely changed                                  | Acceptance criteria                                     | Priority | Dependencies              | Risk   | Expected star impact |
| ------------------ | ---------------------------- | ------------- | ----------------------------------------------------- | ------------------------------------------------------- | -------- | ------------------------- | ------ | -------------------- |
| Failure demo       | Proves governance.           | Codex         | `docs/demo/02-failure-gates`, `scripts/demo/*`, tests | Demo blocks tamper/scope/verify/review failures.        | P0       | Phase 0 README clarity    | Medium | Very high            |
| Real test fixture  | Avoids fake-only skepticism. | Codex         | `docs/demo/03-real-tests`, fixtures                   | At least one test suite actually runs and fails/passes. | P0       | None                      | Medium | High                 |
| Benchmark doc      | Gives public proof frame.    | Claude        | `docs/benchmarks/agent-gate-bench.md`                 | Honest method, no fake numbers.                         | P0       | Demo scenario definitions | Low    | High                 |
| Benchmark runner   | Makes proof reproducible.    | Codex         | `scripts/bench/*`, `package.json`                     | `bun run bench:agent-gate -- --provider fake` works.    | P1       | Benchmark doc             | Medium | High                 |
| Demo GIF/asciicast | Shareable proof.             | Human + Codex | `docs/assets/*`, README                               | README embeds terminal demo.                            | P0       | Demo stable               | Low    | Very high            |

## Phase 2: public launch package, 3–7 days

| Task                        | Why it matters           | Owner          | Files likely changed                   | Acceptance criteria                          | Priority | Dependencies | Risk   | Expected star impact |
| --------------------------- | ------------------------ | -------------- | -------------------------------------- | -------------------------------------------- | -------- | ------------ | ------ | -------------------- |
| Comparison page             | Answers “why not X?”     | Claude         | `docs/comparisons/ai-coding-agents.md` | Fair table vs Claude/Codex/Cursor/etc.       | P0       | Research     | Medium | High                 |
| Launch blog post            | Creates narrative.       | Human + Claude | `docs/launch/blog.md` or external      | Publishable post with demo GIF.              | P0       | Failure demo | Medium | Very high            |
| HN/Reddit/X/LinkedIn copy   | Reduces launch friction. | Claude         | `docs/launch/*`                        | Ready-to-post drafts.                        | P0       | Blog         | Low    | High                 |
| Docs site / landing outline | Improves SEO.            | Claude         | `docs/site-outline.md`                 | Clear landing page wireframe.                | P1       | README final | Low    | Medium               |
| Release `v0.20.1-alpha.0`   | Ships credibility fixes. | Human + Codex  | release workflow/assets                | Release includes demo/proof/community fixes. | P0       | Phase 0–1    | Medium | High                 |

## Phase 3: distribution, 1–3 weeks

| Channel                   | Why                                   | Exact move                                                         | Owner | Risk                              | Expected impact        |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ----- | --------------------------------- | ---------------------- |
| Hacker News               | Best for devtool debate.              | “Show HN: CI-style gates for AI coding agents.”                    | Human | Harsh comments if overclaimed.    | High if demo is strong |
| Reddit                    | Good skeptical feedback.              | Post to AI coding/devtool communities with failure demo, not hype. | Human | Moderator removal if promotional. | Medium/high            |
| X                         | Good for AI devtool visibility.       | 8-post thread with GIF.                                            | Human | Low engagement without network.   | Medium                 |
| LinkedIn                  | Good for QA/SDLC/engineering leaders. | Governance angle, not “vibe coding.”                               | Human | Less stars, more serious leads.   | Medium                 |
| Discord/Slack communities | Direct users.                         | Ask for feedback, not stars.                                       | Human | Spam perception.                  | Medium                 |
| Newsletters               | Asymmetric upside.                    | Pitch “auditable AI coding” to devtool/AI newsletters.             | Human | Low response.                     | Medium/high            |
| Direct outreach           | High-signal users.                    | 30 maintainers using Claude/Codex in serious repos.                | Human | Time cost.                        | Medium                 |

## Phase 4: conversion loop, ongoing

| Task                               | Why                             | Owner          | Acceptance criteria            |
| ---------------------------------- | ------------------------------- | -------------- | ------------------------------ |
| Respond to issues within 24h       | Early OSS trust.                | Human          | Every launch issue triaged.    |
| Ship weekly alpha releases         | Momentum.                       | Codex + Human  | Changelog tells a story.       |
| Maintain public roadmap            | Reduces uncertainty.            | Claude + Human | Now/Next/Later updated weekly. |
| Add good-first-issues continuously | Contributors need entry points. | Human          | 5+ always open.                |
| Track install-to-demo conversion   | Stars alone are vanity.         | Human          | Manual metrics doc updated.    |
| Publish benchmark updates          | Proof loop.                     | Codex + Claude | New measured rows, not claims. |

---

# 10. Codex/Claude implementation backlog

## Task: Rewrite README for 90-second skimming

Type: docs
Priority: P0
Owner: Claude
Estimated effort: M
Files likely touched:

- `README.md`

Problem:
The current README is technically accurate in places but too dense and overclaims some provider support.

Why it matters:
README conversion is the fastest path to more stars and installs.

Implementation steps:

1. Replace hero with “CI-style gates for AI coding agents.”
2. Add why-not-direct-agent section.
3. Add real/simulated/not-yet table.
4. Add install, quick demo, failure demo, comparison, roadmap, and star CTA.
5. Remove jargon from above the fold.

Acceptance criteria:

- A new visitor understands the tool in under 90 seconds.
- README does not claim Gemini/OpenCode/Roo are working providers today.
- Install commands match package metadata.

Validation command:

```sh
npx markdownlint-cli README.md
```

Notes:
Keep architecture details in `docs/ABOUT.md`.

---

## Task: Install consistency audit

Type: DX
Priority: P0
Owner: Codex
Estimated effort: S
Files likely touched:

- `README.md`
- `package.json`
- `scripts/install.sh`
- `npm-wrapper/index.cjs`
- `docs/ABOUT.md`
- `docs/homebrew/*`

Problem:
Install trust is critical. All channels must agree on version, package name, cache behavior, checksums, and platform support.

Why it matters:
One broken install loses launch trust immediately.

Implementation steps:

1. Verify curl install command.
2. Verify npm package name `@tuel/code-oz`.
3. Verify Homebrew tap formula.
4. Verify macOS/Linux matrix.
5. Add uninstall/cache cleanup instructions.
6. Add install smoke script.

Acceptance criteria:

- `curl`, `npm`, `brew`, and source install docs are consistent.
- No stale version references.
- All channels include verification story.

Validation command:

```sh
bun run smoke
```

Notes:
Add cache re-verification if missing.

---

## Task: Demo polish

Type: demo
Priority: P0
Owner: Codex
Estimated effort: M
Files likely touched:

- `docs/demo/01-todo-cli/README.md`
- `scripts/demo/01-todo-cli/run-demo.ts`
- `docs/assets/`

Problem:
The current demo is useful but not shareable enough.

Why it matters:
A 1,000-star push needs a GIF/asciicast that proves the loop visually.

Implementation steps:

1. Add shorter “watch this first” path.
2. Add expected output summary.
3. Add terminal GIF/asciicast.
4. Add “what to inspect after run.”
5. Add common failure troubleshooting.

Acceptance criteria:

- Demo runs from a clean clone.
- README can embed a GIF or asciicast screenshot.
- Output includes gate files and ledger pointers.

Validation command:

```sh
bun run demo:todo-cli
```

Notes:
Keep FakeProvider honesty.

---

## Task: Failure-mode demo

Type: demo
Priority: P0
Owner: Codex
Estimated effort: M
Files likely touched:

- `docs/demo/02-failure-gates/README.md`
- `scripts/demo/02-failure-gates/*`
- `tests/demo/*`

Problem:
Governance claims need blocked failures.

Why it matters:
This is the strongest proof asset.

Implementation steps:

1. Create tampered-artifact fixture.
2. Create scope-escape fixture.
3. Create verify-fail fixture.
4. Create same-family-review fixture.
5. Create reviewer-blocks-risk fixture.
6. Write expected output snapshots.

Acceptance criteria:

- Each failure is deterministic.
- Each failure produces inspectable evidence.
- README links this demo.

Validation command:

```sh
bun run demo:failure-gates
bun test tests/demo/failure-gates.test.ts
```

Notes:
This should be the launch centerpiece.

---

## Task: Benchmark doc

Type: benchmark
Priority: P0
Owner: Claude
Estimated effort: S
Files likely touched:

- `docs/benchmarks/agent-gate-bench.md`

Problem:
No public proof framework exists.

Why it matters:
Without benchmarks, “auditable” is a claim.

Implementation steps:

1. Define benchmark scope.
2. Define direct-agent baselines.
3. Define `code-oz` method.
4. Define metrics.
5. Add empty result table with `TBD`.

Acceptance criteria:

- No invented results.
- Reproducibility instructions included.
- Explains what benchmark does and does not prove.

Validation command:

```sh
npx markdownlint-cli docs/benchmarks/agent-gate-bench.md
```

Notes:
Use honest language.

---

## Task: Benchmark runner

Type: benchmark
Priority: P1
Owner: Codex
Estimated effort: L
Files likely touched:

- `scripts/bench/agent-gate-bench.ts`
- `fixtures/bench/*`
- `package.json`
- `tests/bench/*`

Problem:
Benchmark needs executable proof.

Why it matters:
A runnable benchmark beats a blog claim.

Implementation steps:

1. Build fixture runner.
2. Add FakeProvider deterministic mode.
3. Add optional baseline command wrappers.
4. Emit JSON and Markdown results.
5. Add CI-safe mode.

Acceptance criteria:

- FakeProvider benchmark runs offline.
- Results are machine-readable.
- Direct-agent baselines can be run manually.

Validation command:

```sh
bun run bench:agent-gate -- --provider fake
```

Notes:
Do not require live provider credentials for CI.

---

## Task: Comparison page

Type: docs
Priority: P0
Owner: Claude
Estimated effort: M
Files likely touched:

- `docs/comparisons/ai-coding-agents.md`

Problem:
Users will compare against Claude Code, Codex, Cursor, Gemini CLI, Roo Code, OpenCode, Qodo, Sonar, HivePipe, Devin, Factory, and GitHub Copilot.

Why it matters:
Comparison pages convert skeptical developers.

Implementation steps:

1. Add fair comparison table.
2. State what `code-oz` is not.
3. Avoid trashing competitors.
4. Link to provider support matrix.
5. Add “best used with” framing.

Acceptance criteria:

- No unsupported claims.
- Clear differentiation.
- README links page.

Validation command:

```sh
npx markdownlint-cli docs/comparisons/ai-coding-agents.md
```

Notes:
Keep it humble.

---

## Task: Public roadmap simplification

Type: docs
Priority: P0
Owner: Claude
Estimated effort: S
Files likely touched:

- `docs/ROADMAP.md`
- `README.md`

Problem:
Deep roadmap docs overwhelm public users.

Why it matters:
Users need Now/Next/Later.

Implementation steps:

1. Create simple public roadmap.
2. Move milestone internals lower.
3. Add dates only where committed.
4. Add links to issues.

Acceptance criteria:

- Public roadmap readable in 2 minutes.
- README links it.
- Future work does not distract from current value.

Validation command:

```sh
npx markdownlint-cli docs/ROADMAP.md
```

Notes:
Do not expose all internal design debate as onboarding.

---

## Task: GitHub issue templates

Type: DX
Priority: P0
Owner: Codex
Estimated effort: S
Files likely touched:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/install_problem.yml`
- `.github/ISSUE_TEMPLATE/demo_failure.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

Problem:
No issue templates.

Why it matters:
Launch feedback needs structure.

Implementation steps:

1. Add bug report template.
2. Add install problem template.
3. Add demo failure template.
4. Add feature request template.
5. Add required environment fields.

Acceptance criteria:

- New issue flow gives structured choices.
- Install/demo issues capture platform/version.

Validation command:

```sh
find .github/ISSUE_TEMPLATE -type f -maxdepth 1
```

Notes:
Add labels after templates.

---

## Task: Good first issues

Type: community
Priority: P0
Owner: Human
Estimated effort: S
Files likely touched:

- GitHub issues

Problem:
There are 0 open issues.

Why it matters:
A repo with no issues looks inactive or closed.

Implementation steps:

1. Create 5–10 small issues.
2. Label `good first issue`, `docs`, `demo`, `DX`.
3. Link relevant files.
4. Add expected acceptance criteria.

Acceptance criteria:

- At least 5 good-first-issues exist.
- Each issue is doable in under 2 hours.

Validation command:

```sh
gh issue list --label "good first issue"
```

Notes:
Do this before launch.

---

## Task: Contributing guide

Type: community
Priority: P0
Owner: Claude
Estimated effort: S
Files likely touched:

- `CONTRIBUTING.md`

Problem:
No public contribution guide.

Why it matters:
Contributors need setup, tests, style, and scope.

Implementation steps:

1. Add local setup.
2. Add test commands.
3. Add docs style.
4. Add PR expectations.
5. Add provider-test policy.

Acceptance criteria:

- New contributor can run tests.
- Live provider tests are clearly opt-in.

Validation command:

```sh
npx markdownlint-cli CONTRIBUTING.md
```

Notes:
Mention Bun version.

---

## Task: Security/trust doc

Type: docs
Priority: P0
Owner: Claude
Estimated effort: M
Files likely touched:

- `SECURITY.md`
- `docs/TRUST.md`

Problem:
Trust posture is scattered.

Why it matters:
This is a governance product; trust docs are product docs.

Implementation steps:

1. Add vulnerability reporting.
2. Add release artifact trust model.
3. Explain checksums, unsigned binaries, xattr workaround.
4. Explain provider auth boundaries.
5. Explain what is logged and not logged.

Acceptance criteria:

- `SECURITY.md` exists.
- `docs/TRUST.md` explains data/artifact boundaries.
- README links both.

Validation command:

```sh
npx markdownlint-cli SECURITY.md docs/TRUST.md
```

Notes:
Be honest about unsigned binaries.

---

## Task: Release notes rewrite

Type: release
Priority: P0
Owner: Human + Claude
Estimated effort: S
Files likely touched:

- GitHub release notes
- `CHANGELOG.md`

Problem:
Latest release notes are too sparse.

Why it matters:
Release page is a conversion surface.

Implementation steps:

1. Add “why this release matters.”
2. Add install commands.
3. Add demo command.
4. Add provider support matrix.
5. Add limitations.
6. Add checksum note.

Acceptance criteria:

- Release notes tell a clear story.
- No unsupported provider claims.

Validation command:

```sh
gh release view v0.20.0-alpha.0
```

Notes:
Backfill if needed, then improve next release.

---

## Task: Landing page outline

Type: marketing
Priority: P1
Owner: Claude
Estimated effort: S
Files likely touched:

- `docs/launch/landing-page-outline.md`

Problem:
GitHub README is not enough for SEO/share.

Why it matters:
A simple landing page can target “AI coding agent governance.”

Implementation steps:

1. Draft page structure.
2. Add hero, demo GIF, problem, proof, install.
3. Add FAQ.
4. Add benchmark section.

Acceptance criteria:

- Can be turned into static page quickly.
- Messaging matches README.

Validation command:

```sh
npx markdownlint-cli docs/launch/landing-page-outline.md
```

Notes:
Do after README final.

---

## Task: Launch blog post

Type: marketing
Priority: P0
Owner: Claude + Human
Estimated effort: M
Files likely touched:

- `docs/launch/blog-post.md`

Problem:
Need narrative asset.

Why it matters:
HN/Reddit need a story, not just repo link.

Implementation steps:

1. Write problem story.
2. Show direct-agent failure.
3. Show `code-oz` gate block.
4. Include install/demo.
5. Include limitations.
6. Ask for feedback.

Acceptance criteria:

- Publishable without editing.
- Contains GIF and benchmark link.
- No hype claims.

Validation command:

```sh
npx markdownlint-cli docs/launch/blog-post.md
```

Notes:
Title should be direct.

---

## Task: Social launch copy

Type: marketing
Priority: P0
Owner: Claude
Estimated effort: S
Files likely touched:

- `docs/launch/social.md`

Problem:
Need ready-to-post copy.

Why it matters:
Launch execution benefits from prewritten variants.

Implementation steps:

1. Write 5 short launch messages.
2. Write X thread.
3. Write LinkedIn post.
4. Write Reddit version.
5. Write HN title/body.

Acceptance criteria:

- Each post includes demo/proof link.
- Tone is honest and technical.

Validation command:

```sh
npx markdownlint-cli docs/launch/social.md
```

Notes:
Avoid “revolutionary.”

---

## Task: HN launch copy

Type: marketing
Priority: P0
Owner: Claude
Estimated effort: XS
Files likely touched:

- `docs/launch/hacker-news.md`

Problem:
HN launch needs concise framing.

Why it matters:
HN can drive a large share of early stars.

Implementation steps:

1. Draft Show HN title.
2. Draft first comment.
3. Include known limitations.
4. Include demo command.

Acceptance criteria:

- No marketing fluff.
- Explains why tool exists.

Validation command:

```sh
npx markdownlint-cli docs/launch/hacker-news.md
```

Notes:
Post after failure demo is ready.

---

## Task: Reddit launch copy

Type: marketing
Priority: P0
Owner: Claude
Estimated effort: XS
Files likely touched:

- `docs/launch/reddit.md`

Problem:
Reddit communities dislike drive-by promotion.

Why it matters:
You need feedback, not just stars.

Implementation steps:

1. Draft technical feedback request.
2. Include what is real/simulated.
3. Ask for criticism.
4. Avoid hype.

Acceptance criteria:

- Post can fit multiple communities with minor edits.
- Includes limitations.

Validation command:

```sh
npx markdownlint-cli docs/launch/reddit.md
```

Notes:
Customize per subreddit.

---

## Task: LinkedIn post

Type: marketing
Priority: P1
Owner: Claude + Human
Estimated effort: XS
Files likely touched:

- `docs/launch/linkedin.md`

Problem:
Engineering leaders need a different angle.

Why it matters:
LinkedIn may drive serious users and contributors.

Implementation steps:

1. Emphasize auditability.
2. Tie to QA/SDLC governance.
3. Include demo and repo.
4. Ask for feedback from teams using coding agents.

Acceptance criteria:

- No startup hype.
- Clear enterprise relevance.

Validation command:

```sh
npx markdownlint-cli docs/launch/linkedin.md
```

Notes:
Use your QA Automation Architect background.

---

## Task: X thread

Type: marketing
Priority: P0
Owner: Claude
Estimated effort: XS
Files likely touched:

- `docs/launch/x-thread.md`

Problem:
Need shareable short-form narrative.

Why it matters:
AI devtool visibility is high on X.

Implementation steps:

1. Write 8-post thread.
2. Include demo GIF.
3. Include failure demo.
4. End with GitHub link and feedback ask.

Acceptance criteria:

- Each post stands alone.
- First post has strong hook.

Validation command:

```sh
npx markdownlint-cli docs/launch/x-thread.md
```

Notes:
Pin after launch.

---

## Task: Star history / metrics tracking plan

Type: marketing
Priority: P1
Owner: Human + Codex
Estimated effort: S
Files likely touched:

- `docs/metrics/launch-metrics.md`
- optional script under `scripts/metrics/`

Problem:
Stars alone do not show conversion.

Why it matters:
Need to know which assets/channels work.

Implementation steps:

1. Track stars, forks, issues, installs if available, demo runs if measurable.
2. Track launch posts and timestamps.
3. Add manual daily log.
4. Add star-history chart link or screenshot plan.

Acceptance criteria:

- Metrics doc exists.
- Daily update template exists.

Validation command:

```sh
npx markdownlint-cli docs/metrics/launch-metrics.md
```

Notes:
Do not collect invasive telemetry in the CLI.

---

# 11. Launch assets

## HN title options

1. **Show HN: CI-style gates for AI coding agents**
2. **Show HN: I built a local-first audit layer for Claude Code and Codex**
3. **Show HN: code-oz – make AI-generated code pass spec, test, and review gates**

## HN first comment

```md
I built code-oz because direct AI coding agents are fast, but the handoff is often just a chat transcript plus whatever tests happened to run.

code-oz is a local-first CLI that runs coding agents through:

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

The current alpha has file-based gates, SHA-256-bound approvals, isolated worktrees, an events.jsonl ledger, a deterministic FakeProvider demo, Claude/Codex CLI adapters, and an xAI HTTP adapter.

The most important demo is not the happy path. It is the failure demo: tampered artifacts, failed verification, same-family review, and risky changes should be blocked before SHIP.

Known limitations: public alpha, macOS/Linux only, unsigned binaries, Gemini is still a stub, OpenCode/Roo adapters are not live yet, and the benchmark is intentionally narrow.

I’m looking for skeptical feedback from people already using coding agents on real repos.
```

## Reddit post

```md
Title: I built a local-first governance layer for AI coding agents — looking for skeptical feedback

I’m building `code-oz`, a CLI that runs AI coding agents through a repo-local SDLC loop instead of letting one model directly change code and call it done.

Core loop:

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

The alpha has:
- file-based phase gates
- SHA-256-bound approvals
- isolated worktrees
- `events.jsonl` audit trail
- deterministic FakeProvider demo
- Claude/Codex CLI adapters
- xAI HTTP adapter

What I’m trying to prove:
- bad agent output should be blocked
- tampered artifacts should fail
- failed verification should restart/intervene
- reviewer and builder should not be the same model family
- a run should be reconstructable from artifacts

What is not ready:
- Windows
- signed/notarized binaries
- Gemini live adapter
- OpenCode/Roo adapters
- broad benchmark claims

I’d appreciate brutal feedback on whether this solves a real pain or just adds process overhead.
```

## LinkedIn post

```md
AI coding agents are moving faster than our review processes.

I’m building `code-oz`, a local-first CLI for developers who want AI-generated code to pass through a governed delivery loop:

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

The goal is not to replace Claude Code, Codex, Cursor, or Gemini CLI.

The goal is to make their work auditable:
- spec and plan artifacts
- SHA-256-bound approvals
- isolated worktrees
- verification evidence
- independent review
- event ledger

As someone who has spent years in QA automation and SDLC quality, I think the next bottleneck is not “can AI write code?” It is “can we prove what happened before it shipped?”

The alpha is intentionally narrow and honest: macOS/Linux, deterministic FakeProvider demo, Claude/Codex adapters, xAI adapter, known limitations.

Looking for feedback from engineers and QA leaders already using AI coding agents in real repos.
```

## X thread

```md
1/ AI coding agents are fast.

But most direct-agent workflows still boil down to:
prompt → code → vibes → maybe tests.

I’m building `code-oz`: CI-style gates for AI coding agents.

2/ The loop is simple:

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

Every phase creates inspectable repo-local artifacts.

3/ The trust primitives:

- file-based gates
- SHA-256-bound approvals
- isolated worktrees
- verification evidence
- independent review
- events.jsonl ledger

4/ The goal is not to beat Claude Code or Codex.

The goal is to govern them.

Direct agents are workers.
`code-oz` is the delivery control layer.

5/ The alpha supports deterministic FakeProvider demos, Claude/Codex CLI adapters, and an xAI HTTP adapter.

Gemini/OpenCode/Roo are not live adapters yet.

6/ The demo I care about most is the failure demo:

- tampered artifact blocked
- failed verify blocked
- same-family review refused
- risky change routed back

7/ This is a public alpha.

Known gaps: Windows, signing/notarization, full benchmark, more provider adapters.

No fake claims. The benchmark will show where it helps and where it does not.

8/ Looking for skeptical feedback from devs using AI coding agents on real repos.

Repo: code-oz
```

## Blog outline

Title:

> **AI coding agents need gates, not just prompts**

Sections:

1. Direct agents are useful but under-governed.
2. The failure mode: speed without evidence.
3. What CI taught us.
4. What `code-oz` does.
5. Happy-path demo.
6. Failure demo.
7. What is real today.
8. What is simulated.
9. Benchmark plan.
10. What I need feedback on.

## Comparison page title

> **code-oz vs direct AI coding agents**

Subtitle:

> `code-oz` is not another coding agent. It is a repo-local governance layer around the agents you already use.

---

# 12. Objection handling

| Objection                                        | Fair? | Current weakness behind it                            | Best honest answer                                                                                                   | Required product/doc change               | Proof needed                        |
| ------------------------------------------------ | ----: | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| “This is overengineered.”                        |   Yes | Jargon-heavy README and deep architecture docs.       | Use direct agents for low-risk tasks. Use `code-oz` when auditability matters.                                       | Simplify README and add “not for you if.” | Failure demo showing avoided risk.  |
| “I can just use Claude Code.”                    |   Yes | README does not answer this fast enough.              | Yes. `code-oz` wraps Claude Code when you need gates, approvals, and review evidence.                                | Add why-not section.                      | Baseline comparison.                |
| “Multi-agent workflows are expensive.”           |   Yes | Effort levels sound like more calls.                  | `lite` exists; assurance invariants are explicit; cost should be measured.                                           | Add cost/budget docs.                     | Benchmark cost table.               |
| “This is roleplay.”                              |   Yes | “AI software company” metaphor.                       | The metaphor is optional; the real product is gates, hashes, worktrees, and ledger.                                  | Remove metaphor from hero.                | Failure demo.                       |
| “FakeProvider proves nothing about LLM quality.” |   Yes | Current demo is FakeProvider-first.                   | Correct. FakeProvider proves lifecycle determinism, not LLM quality.                                                 | Say that explicitly.                      | Add live-provider benchmark later.  |
| “I do not want another process layer.”           |   Yes | Core value not tied to specific risk.                 | Do not use it for trivial edits. Use it for risky repo changes.                                                      | Add use-case examples.                    | Case study.                         |
| “Agent review can still miss bugs.”              |   Yes | Review is not a guarantee.                            | Correct. `code-oz` creates evidence and gates; it does not make models infallible.                                   | Add limitations.                          | Benchmark false-negative reporting. |
| “Why would teams trust this?”                    |   Yes | Missing SECURITY/community files, unsigned artifacts. | They should not blindly trust it. Inspect source, run FakeProvider, verify checksums, wait for signatures if needed. | Add trust doc.                            | Signed artifacts / provenance.      |
| “Why should I star this?”                        |  Fair | No clear CTA.                                         | Star if you want auditable AI coding workflows to exist in OSS.                                                      | Add star section.                         | Strong demo.                        |
| “HivePipe already does agentic SDLC.”            |  Fair | Similar language.                                     | `code-oz` is narrower: local-first, CLI-first, source-visible, repo-native gates.                                    | Add comparison.                           | Demo local CLI flow.                |
| “Qodo/Sonar already review code.”                |  Fair | Review vs lifecycle distinction unclear.              | They are review/quality tools; `code-oz` governs the lifecycle before review.                                        | Add comparison.                           | Integration story.                  |
| “This will slow me down.”                        |  Fair | No time/cost data.                                    | It will slow trivial tasks. It should save time on risky tasks by catching failures earlier.                         | Add benchmark.                            | Time/intervention metrics.          |
| “Provider support is confusing.”                 |   Yes | README names unsupported/stub providers.              | Current support is Claude, Codex, Fake, xAI; Gemini is stub.                                                         | Fix README.                               | Provider matrix.                    |
| “Unsigned binaries scare me.”                    |   Yes | Signing deferred.                                     | Use source install if that matters; checksums exist but signatures are future.                                       | Trust doc.                                | Sigstore/GPG.                       |
| “No Windows means I cannot use it.”              |   Yes | Windows deferred.                                     | Correct; macOS/Linux only today.                                                                                     | Add tracking issue.                       | Windows release.                    |

---

# 13. 10/10 rubric

| Dimension                   | 1/10                  | 5/10                               | 10/10                                                    | Current | Target after 30 days |
| --------------------------- | --------------------- | ---------------------------------- | -------------------------------------------------------- | ------: | -------------------: |
| Engineering quality         | Prototype only        | Works but fragile                  | Tested, modular, stable, provider-safe                   |     8.0 |                  9.0 |
| Product clarity             | Nobody understands it | Some understand after reading docs | Value clear in 10 seconds                                |     5.8 |                  9.2 |
| README conversion           | Wall of text          | Decent install/readme              | Hero, demo, proof, objections, CTA                       |     5.5 |                  9.5 |
| Demo quality                | No demo               | Happy path only                    | Happy path + failure path + GIF                          |     6.8 |                  9.3 |
| Install trust               | Manual build only     | Install works but trust unclear    | Multi-channel, signed/provenance, smoke tested           |     7.2 |                  8.8 |
| Competitive differentiation | Me-too                | Some wedge                         | Narrow, honest, defensible wedge                         |     7.0 |                  9.0 |
| Proof credibility           | Claims                | Demo                               | Benchmark + failure cases + measured baselines           |     2.5 |                  8.5 |
| Community readiness         | No onboarding         | Basic docs                         | Templates, contributing, issues, roadmap, fast response  |     1.8 |                  8.5 |
| Launch readiness            | Not shareable         | Some posts                         | Blog, GIF, benchmark, comparison, social package         |     3.2 |                  9.0 |
| Maintainability             | Spaghetti             | Mostly organized                   | Clear public/internal split                              |     7.8 |                  8.8 |
| Security/trust posture      | No trust story        | Some checks                        | Security policy, signed artifacts, clear data boundaries |     6.8 |                  8.7 |
| Star-growth potential       | No hook               | Niche interest                     | Timely, clear, demoable, controversial-in-good-way       |     6.2 |                  9.0 |

---

# 14. 7-day action plan

## Day 1: Stop visitor bounce

1. Add GitHub description/topics.
2. Rewrite README hero and first 60 seconds.
3. Correct provider support claims.
4. Add real/simulated/not-yet matrix.
5. Add `SECURITY.md`, `CONTRIBUTING.md`, issue templates, PR template.
6. Change package description away from “simulation.”

Acceptance criteria:

- A new visitor can explain the project in one sentence.
- No unsupported provider is claimed as live.
- GitHub Community Standards are mostly green.

## Day 2: Trust and install polish

1. Audit install docs across README, ABOUT, npm wrapper, Homebrew tap, release notes.
2. Add install verification section.
3. Add uninstall/cache cleanup section.
4. Add release trust note.
5. Patch npm cache re-verification and redirect limit if not already merged.
6. Add release smoke checklist.

Acceptance criteria:

- Install channels agree.
- Trust caveats are explicit.
- No “just trust curl | sh” posture.

## Days 3–4: Failure demo

1. Build `docs/demo/02-failure-gates`.
2. Add tamper, scope, verify, same-family, reviewer-risk scenarios.
3. Add tests.
4. Capture outputs.
5. Add README link and GIF/asciicast.

Acceptance criteria:

- One command runs the failure demo.
- At least 4 governance failures are blocked deterministically.

## Day 5: Benchmark skeleton

1. Add `Agent Gate Bench` doc.
2. Add fixture definitions.
3. Add result table with `TBD`.
4. Add FakeProvider benchmark runner if feasible.
5. Add “what this does not prove.”

Acceptance criteria:

- Public benchmark exists.
- No fake numbers.
- Demo and benchmark reinforce each other.

## Days 6–7: Launch package

1. Rewrite release notes.
2. Add comparison page.
3. Add launch blog.
4. Add HN/Reddit/X/LinkedIn copy.
5. Create 5 good-first-issues.
6. Prepare `v0.20.1-alpha.0`.

Acceptance criteria:

- Launch can happen without scrambling.
- Public assets all use same message.

---

# 15. 30-day action plan

## Week 1: Credibility and proof

Ship:

- README rewrite
- trust/community files
- failure demo
- benchmark skeleton
- release notes rewrite
- comparison page
- first launch release

Goal:

> Make the repo worth starring before asking anyone to star it.

## Week 2: Public launch

Ship/post:

- Blog post
- HN Show HN
- Reddit feedback posts
- X thread
- LinkedIn post
- direct outreach to 30 developers using Claude/Codex/Cursor
- 5–10 newsletter/community pitches

Goal:

> Drive the first serious wave of stars and feedback.

## Week 3: Feedback-driven release

Ship:

- Top 5 launch bug fixes
- README clarification based on objections
- better benchmark runner
- `doctor` UX improvements
- more install-channel smoke tests
- more good-first-issues

Goal:

> Convert skeptics into watchers/contributors.

## Week 4: Proof expansion

Ship:

- measured direct-agent baseline rows
- one live-provider case study
- signed checksum plan or first Sigstore/GPG step
- Windows/Scoop decision update
- public roadmap refresh
- second launch post: “What failed after launch and what changed”

Goal:

> Move from interesting alpha to credible devtool.

---

# 16. Appendix: sources and links

## `code-oz` audit sources

- Main repo page: public repo status, star/fork count, README, install, status, missing description/topics. ([GitHub][1])
- Raw README: scoped npm install, status, supported platforms, demo text. ([GitHub][3])
- `package.json`: package name, description, scripts, keywords. ([GitHub][14])
- Provider contract: current v0.1 provider set, auth model, limitations, capability matrix. ([GitHub][2])
- Claude/Codex/Gemini provider source: Claude and Codex subprocess adapters; Gemini stub. ([GitHub][9])
- xAI provider source: env API key, allowlist request body, redaction discipline. ([GitHub][10])
- Demo docs: FakeProvider demo, gates, cross-family review, real vs simulated. ([GitHub][4])
- Install script and npm wrapper: checksum verification, no postinstall hook, cache behavior. ([GitHub][5])
- Homebrew tap and formula. ([GitHub][13])
- Security/community gaps. ([GitHub][8])
- Issues and PRs. ([GitHub][60])
- Open PR #30 details and review comments. ([GitHub][61])
- Release history. ([GitHub][7])

## Competitor/product sources

- HivePipe. ([HivePipe][17])
- Qodo. ([Qodo Documentation][18])
- Sonar AI Code Assurance / AI CodeFix. ([SonarSource][21])
- Factory. ([Factory.ai][25])
- Devin. ([Devin][28])
- OpenAI Codex. ([GitHub][32])
- Claude Code. ([Claude][35])
- Gemini CLI. ([GitHub][38])
- OpenCode. ([OpenCode][41])
- Roo Code. ([Roo Code Docs][44])
- Cursor. ([Cursor][46])
- GitHub Copilot coding agent. ([GitHub Docs][49])
- Aider, Cline, Continue as open-source/devtool examples. ([GitHub][52])

## Framework/orchestration sources

- Microsoft Agent Framework. ([Microsoft Learn][54])
- AWS Bedrock multi-agent collaboration. ([AWS Documentation][55])
- Google Gemini Enterprise Agent Platform / ADK. ([Google Cloud][56])
- LangGraph. ([LangChain Docs][57])
- AutoGen / AG2. ([Microsoft GitHub][58])
- CrewAI. ([CrewAI][59])
- GitHub topics/discovery. ([GitHub Docs][62])

---

# Shortest possible path to 1,000 stars

## The 5 changes to make first

1. **Rewrite the README hero** to “CI-style gates for AI coding agents.”
2. **Correct provider support claims**: Claude, Codex, Fake, xAI today; Gemini stub; OpenCode/Roo future.
3. **Add the failure-mode demo** showing blocked tamper, verify fail, same-family review, and risky review.
4. **Add security/community basics**: `SECURITY.md`, `CONTRIBUTING.md`, issue templates, PR template, good-first-issues.
5. **Rewrite latest release notes** with install, demo, real/simulated, limitations, and checksums.

## The 5 assets to publish first

1. Demo GIF/asciicast.
2. Failure demo doc.
3. Benchmark doc with honest `TBD` baseline rows.
4. Comparison page: `code-oz vs direct AI coding agents`.
5. Launch blog post.

## The 5 audiences to target first

1. Developers already using Claude Code/Codex.
2. AI coding tool skeptics on Hacker News.
3. QA automation / SDLC quality engineers.
4. OSS maintainers worried about AI-generated PRs.
5. Engineering leaders evaluating agent governance.

## The 5 launch messages to test first

1. **“CI-style gates for AI coding agents.”**
2. **“Direct agents are fast. `code-oz` makes them auditable.”**
3. **“Make AI-generated code pass spec, test, and independent review before it ships.”**
4. **“A local-first control layer for Claude Code and Codex.”**
5. **“The failure demo: watch bad AI output get blocked before SHIP.”**

## The 5 metrics to track first

1. GitHub stars per channel/post.
2. README-to-demo conversion: clicks or manual proxy via issues/comments.
3. Install success/failure reports by channel.
4. Demo completion reports.
5. Issues opened by type: install, demo, provider, trust, feature.

Strict verdict: **do not launch broadly until the failure demo exists and the provider support claims are corrected.** The fastest path is not more engineering depth. It is sharper truth, visible proof, and a repo that looks safe to trust.

[1]: https://github.com/omerakben/code-oz "https://github.com/omerakben/code-oz"
[2]: https://raw.githubusercontent.com/omerakben/code-oz/main/docs/contracts/PROVIDERS.md "https://raw.githubusercontent.com/omerakben/code-oz/main/docs/contracts/PROVIDERS.md"
[3]: https://raw.githubusercontent.com/omerakben/code-oz/main/README.md "https://raw.githubusercontent.com/omerakben/code-oz/main/README.md"
[4]: https://github.com/omerakben/code-oz/tree/main/docs/demo/01-todo-cli "https://github.com/omerakben/code-oz/tree/main/docs/demo/01-todo-cli"
[5]: https://raw.githubusercontent.com/omerakben/code-oz/main/scripts/install.sh "https://raw.githubusercontent.com/omerakben/code-oz/main/scripts/install.sh"
[6]: https://github.com/omerakben/code-oz/community "https://github.com/omerakben/code-oz/community"
[7]: https://github.com/omerakben/code-oz/releases "https://github.com/omerakben/code-oz/releases"
[8]: https://github.com/omerakben/code-oz/security "https://github.com/omerakben/code-oz/security"
[9]: https://raw.githubusercontent.com/omerakben/code-oz/main/src/providers/claude.ts "https://raw.githubusercontent.com/omerakben/code-oz/main/src/providers/claude.ts"
[10]: https://raw.githubusercontent.com/omerakben/code-oz/main/src/providers/xai.ts "https://raw.githubusercontent.com/omerakben/code-oz/main/src/providers/xai.ts"
[11]: https://raw.githubusercontent.com/omerakben/code-oz/main/npm-wrapper/index.cjs "https://raw.githubusercontent.com/omerakben/code-oz/main/npm-wrapper/index.cjs"
[12]: https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0 "https://github.com/omerakben/code-oz/releases/tag/v0.20.0-alpha.0"
[13]: https://github.com/omerakben/homebrew-code-oz "https://github.com/omerakben/homebrew-code-oz"
[14]: https://raw.githubusercontent.com/omerakben/code-oz/main/package.json "https://raw.githubusercontent.com/omerakben/code-oz/main/package.json"
[15]: https://raw.githubusercontent.com/omerakben/code-oz/main/.github/workflows/release.yml "https://raw.githubusercontent.com/omerakben/code-oz/main/.github/workflows/release.yml"
[16]: https://raw.githubusercontent.com/omerakben/code-oz/main/docs/ABOUT.md "https://raw.githubusercontent.com/omerakben/code-oz/main/docs/ABOUT.md"
[17]: https://hivepipe.ai/agentic-sdlc-platform "https://hivepipe.ai/agentic-sdlc-platform"
[18]: https://docs.qodo.ai/code-review "https://docs.qodo.ai/code-review"
[19]: https://www.qodo.ai/pricing/ "https://www.qodo.ai/pricing/"
[20]: https://marketplace.visualstudio.com/items?itemName=Codium.codium "https://marketplace.visualstudio.com/items?itemName=Codium.codium"
[21]: https://www.sonarsource.com/solutions/ai/ai-code-assurance/ "https://www.sonarsource.com/solutions/ai/ai-code-assurance/"
[22]: https://www.sonarsource.com/solutions/ai/ "https://www.sonarsource.com/solutions/ai/"
[23]: https://docs.sonarsource.com/sonarqube-server/ai-capabilities/ai-codefix "https://docs.sonarsource.com/sonarqube-server/ai-capabilities/ai-codefix"
[24]: https://www.sonarsource.com/solutions/ai/ai-codefix/ "https://www.sonarsource.com/solutions/ai/ai-codefix/"
[25]: https://factory.ai/ "https://factory.ai/"
[26]: https://docs.factory.ai/enterprise/usage-cost-and-analytics "https://docs.factory.ai/enterprise/usage-cost-and-analytics"
[27]: https://docs.factory.ai/pricing "https://docs.factory.ai/pricing"
[28]: https://devin.ai/ "https://devin.ai/"
[29]: https://devin.ai/pricing/ "https://devin.ai/pricing/"
[30]: https://cognition.ai/blog/introducing-devin "https://cognition.ai/blog/introducing-devin"
[31]: https://github.com/continuedev/continue "https://github.com/continuedev/continue"
[32]: https://github.com/openai/codex "https://github.com/openai/codex"
[33]: https://developers.openai.com/codex/integrations/github "https://developers.openai.com/codex/integrations/github"
[34]: https://developers.openai.com/codex/pricing "https://developers.openai.com/codex/pricing"
[35]: https://code.claude.com/docs/en/overview "https://code.claude.com/docs/en/overview"
[36]: https://code.claude.com/docs/en/github-actions "https://code.claude.com/docs/en/github-actions"
[37]: https://support.claude.com/en/articles/11049741-what-is-the-max-plan "https://support.claude.com/en/articles/11049741-what-is-the-max-plan"
[38]: https://github.com/google-gemini/gemini-cli "https://github.com/google-gemini/gemini-cli"
[39]: https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-cli-open-source-ai-agent/ "https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-cli-open-source-ai-agent/"
[40]: https://github.com/google-gemini/gemini-cli/releases "https://github.com/google-gemini/gemini-cli/releases"
[41]: https://opencode.ai/ "https://opencode.ai/"
[42]: https://opencode.ai/docs/github/ "https://opencode.ai/docs/github/"
[43]: https://github.com/opencode-ai "https://github.com/opencode-ai"
[44]: https://docs.roocode.com/ "https://docs.roocode.com/"
[45]: https://github.com/RooCodeInc/Roo-Code "https://github.com/RooCodeInc/Roo-Code"
[46]: https://cursor.com/ "https://cursor.com/"
[47]: https://cursor.com/docs/bugbot "https://cursor.com/docs/bugbot"
[48]: https://cursor.com/pricing "https://cursor.com/pricing"
[49]: https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent "https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent"
[50]: https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review "https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review"
[51]: https://docs.github.com/en/copilot/get-started/plans "https://docs.github.com/en/copilot/get-started/plans"
[52]: https://github.com/aider-ai/aider "https://github.com/aider-ai/aider"
[53]: https://github.com/orgs/Aider-AI/repositories "https://github.com/orgs/Aider-AI/repositories"
[54]: https://learn.microsoft.com/en-us/agent-framework/overview/ "https://learn.microsoft.com/en-us/agent-framework/overview/"
[55]: https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html "https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html"
[56]: https://cloud.google.com/products/gemini-enterprise-agent-platform "https://cloud.google.com/products/gemini-enterprise-agent-platform"
[57]: https://docs.langchain.com/oss/python/langgraph/durable-execution "https://docs.langchain.com/oss/python/langgraph/durable-execution"
[58]: https://microsoft.github.io/autogen/stable//index.html "https://microsoft.github.io/autogen/stable//index.html"
[59]: https://crewai.com/ "https://crewai.com/"
[60]: https://github.com/omerakben/code-oz/issues "https://github.com/omerakben/code-oz/issues"
[61]: https://github.com/omerakben/code-oz/pull/30 "https://github.com/omerakben/code-oz/pull/30"
[62]: https://docs.github.com/articles/classifying-your-repository-with-topics "https://docs.github.com/articles/classifying-your-repository-with-topics"
