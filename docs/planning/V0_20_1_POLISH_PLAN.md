# v0.20.1-alpha.0 first-run polish — implementation plan

> **For agentic workers (Codex / Claude sub-agents):** Each commit (C1–C20) is bite-sized work. Steps within a commit are 2-5 minutes each. Mark progress via TodoWrite. The plan ASSUMES the spec at `docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md` is read first; that doc is the contract for what to build, this doc is the contract for HOW to build it.

**Goal:** Ship v0.20.1-alpha.0 with truth-corrected README + provider claims, GitHub Community Standards green, failure demo proving the gates block what they claim to block, benchmark protocol doc, and the BP-1..BP-6 backlog (already drained). No new gate authority, no new milestone.

**Architecture:** Single finalize branch (`finalize/v0.20.1-first-run-polish`). 20 commits in 5 tracks. Maestro (Claude) drives; Codex reviews on failure-demo code track + one public-claims bundle + final pre-tag. Per-task verdicts skipped for mechanical doc/template commits.

**Tech Stack:** Bun + TypeScript (existing). No new runtime dependencies. New tooling: nothing beyond what's already in `package.json`.

**Spec authority:** `docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md` (REVISED-1, all R0 closures folded).

**Codex R0 thread:** `019e26b5-340c-7842-8c6d-5f73e0ef8829`.

---

## Commit sequencing (with dependencies)

```
C1  README hero + sections rewrite                  ────┐
C2  package.json description + keywords + script    ────┤
C3  PROVIDERS.md restructure                        ────┤
C4  ABOUT.md absorb metaphor                        ────┤
C5  CLAUDE.md top-matter truth-sync (B1)            ────┤── public-claims bundle (C19 Codex review)
C6  SECURITY.md                                     ────┤
C7  CONTRIBUTING.md                                 ────┤
C8  CODE_OF_CONDUCT.md (M1)                         ────┤
C9  .github/ issue templates + PR template          ────┤
C10 docs/TRUST.md                                   ────┤
C11 docs/comparisons/ai-coding-agents.md            ────┤
C12 docs/benchmarks/agent-gate-bench.md (protocol)  ────┤
C13 docs/design/ROADMAP.md Now/Next/Later (B2)      ────┘

C14 failure demo scaffolding (docs + fixture dirs)  ─┐
C15 failure demo run-demo + RED-first tests         ─┤── failure-demo code track (Codex R1 verdict)
                                                     └── B5 audit: cut fixture to v0.21 if new gate authority needed

C16 CHANGELOG.md entry                              ──┐
C17 release-notes drafts (v0.20.0 backfill + v0.20.1)─┤
C18 scripts/release/fresh-clone-smoke.sh (M3)       ──┤── pre-tag drift pass + Codex final review (C20)
                                                      │
C19 Codex public-claims bundle review               ──┤
C20 Drift pass + Codex pre-tag review               ──┘

Tag v0.20.1-alpha.0 (Ozzy posts; gh release create with notes-file)
```

---

## Track 1: Truth correction (C1–C5, ≈4h)

### C1: README hero + sections rewrite

**Files:**
- Modify: `README.md` (current 76 lines; will grow to ~150 after restructure)

**Owner:** Claude (Opus 4.7 lead)

**Codex review:** Bundled into C19 public-claims review (not per-task).

- [ ] **Step 1: Read current `README.md` end-to-end** (1 min)
- [ ] **Step 2: Replace hero** (3 min)

  Current line 3: `Repo-native agentic SDLC runtime that makes AI code pass through debate, evidence, and cross-family review before it can ship.`

  Replace with:

  ```md
  **CI-style gates for AI coding agents.**

  `code-oz` runs coding agents through a repo-local delivery loop:

  **DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP**

  Use it when direct AI coding is too unconstrained and you want every change to pass through inspectable artifacts, approval gates, verification evidence, and independent review before it ships.

  AI agents are fast. `code-oz` makes their work auditable. Use it for risky repos, not fastest-loop coding.
  ```

- [ ] **Step 3: Update test count badge** (1 min) — find `tests-3366` → replace with `tests-3390`. Per Codex R0 N1.

- [ ] **Step 4: Add "What you get" bullets after hero** (2 min)

  ```md
  What you get:

  - file-based phase gates you can inspect in the repo
  - approvals bound to exact artifact SHA-256s
  - isolated worktrees for agent changes
  - an `events.jsonl` ledger for reconstructing what happened
  - cross-family review so the builder and reviewer are not the same model family

  Status: public alpha. The deterministic demo uses `FakeProvider` so you can inspect the lifecycle without spending tokens — this proves lifecycle gates and ledger determinism, NOT model quality.
  ```

- [ ] **Step 5: Replace "What it is" architecture-first section** with plain-English `## What it is` (3 min) — remove "hybrid phase-graph + agentic sub-orchestration spine"; link to `docs/ABOUT.md` for architecture detail.

- [ ] **Step 6: Add "## Why not just Claude Code or Codex?" section** per GPT Pro audit §7 exact block (3 min)

- [ ] **Step 7: Add "## What is real today?" matrix** per GPT Pro audit §7 (3 min)

- [ ] **Step 8: Add "## What is simulated or not ready yet?" matrix** per GPT Pro audit §7 (3 min)

- [ ] **Step 9: Add "## How is this different?" comparison table** — short version with link to canonical `docs/comparisons/ai-coding-agents.md` (2 min)

- [ ] **Step 10: Add "## Who is this for?" section** (2 min) — per GPT Pro audit §7. Emphasize "for risky repos, not fastest-loop coding" per Codex R0 missed-risk #4.

- [ ] **Step 11: Add "## Star this repo if..." CTA** (1 min) — per GPT Pro audit §7

- [ ] **Step 12: Add links** to SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, docs/TRUST.md, docs/design/ROADMAP.md#now-next-later (2 min)

- [ ] **Step 13: Run markdown render check** (1 min)

  Run: `cat README.md | head -50` — verify hero renders. No `Repo-native agentic SDLC runtime` text. No `simulation` text. No `AI software company` text.

- [ ] **Step 14: Commit** (1 min)

  ```bash
  git add README.md
  git commit -m "docs(readme): rewrite hero with CI-style gates positioning

  - Replace dense architecture-first hero with 'CI-style gates for AI coding agents'
  - Add Why-not-Claude-Code, Real-today, Simulated, Who-for sections per GPT Pro audit
  - Update test badge count 3366 → 3390
  - Frame FakeProvider honestly (proves lifecycle gates, not model quality)
  - Add for-risky-repos framing per Codex R0 missed-risk #4

  Closes Codex R0 prompt #1, N1; opens C19 public-claims bundle review.
  Spec: docs/design/V0_20_1_FIRST_RUN_POLISH_DESIGN.md Track 1"
  ```

### C2: package.json description + keywords + demo:failure-gates script

**Files:**
- Modify: `package.json`

**Owner:** Codex (mechanical edit) OR Claude (either is fine — small surface)

- [ ] **Step 1: Read current `package.json`** (1 min)

- [ ] **Step 2: Change description field** (1 min)

  ```diff
  - "description": "Multi-agent software-company simulation CLI with hard SDLC gates",
  + "description": "CI-style gates for AI coding agents — local-first governed delivery loop",
  ```

- [ ] **Step 3: Add keywords array** (2 min)

  After `"license": "MIT",`:

  ```json
  "keywords": [
    "ai",
    "coding-agent",
    "cli",
    "sdlc",
    "devtools",
    "agentic-ai",
    "claude-code",
    "codex",
    "typescript",
    "open-source"
  ],
  ```

  **No `gemini` keyword until Gemini is live** (Codex R0 N4).

- [ ] **Step 4: Add `demo:failure-gates` script** (1 min, Codex R0 B4)

  Inside `"scripts": { ... }`:

  ```json
  "demo:failure-gates": "bun run scripts/demo/02-failure-gates/run-demo.ts",
  ```

- [ ] **Step 5: Validate JSON** (1 min)

  Run: `bun run -e 'console.log(JSON.parse(require("fs").readFileSync("package.json","utf8")).description)'`

  Expected output: `CI-style gates for AI coding agents — local-first governed delivery loop`

- [ ] **Step 6: Commit** (1 min)

  ```bash
  git add package.json
  git commit -m "chore(package): retitle description, add keywords, add demo:failure-gates script

  - description: kill 'simulation' word per GPT Pro audit issue #19
  - keywords: 10 entries; no 'gemini' until live (Codex R0 N4)
  - scripts: add 'demo:failure-gates' canonical command (Codex R0 B4 closure)

  Closes Codex R0 B4, N4."
  ```

### C3: PROVIDERS.md restructure (live/stub/future-candidate)

**Files:**
- Modify: `docs/contracts/PROVIDERS.md`

**Owner:** Claude

- [ ] **Step 1: Read current `docs/contracts/PROVIDERS.md`** (2 min) — understand current structure before restructure.

- [ ] **Step 2: Add explicit three-section structure** (8 min) per Codex R0 M2:

  - `## Live adapters`: Claude (CLI subprocess), Codex (CLI subprocess), xAI (HTTP + `XAI_API_KEY`), FakeProvider (deterministic).
  - `## Stubs (listed for transparency, not for use)`: Gemini — `throws` on invocation; rationale; link to "future" section below.
  - `## Future adapter candidates, not in v0.1`: OpenCode, Roo Code. Explicit: "phantom contract entries (treating these as live) are forbidden per CLAUDE.md non-negotiables."

- [ ] **Step 3: Cross-check `src/providers/gemini.ts`** (2 min)

  Run: `grep -n 'throw\|TODO\|stub' src/providers/gemini.ts | head -10`

  Verify the file actually throws, so the "stub" claim is honest.

- [ ] **Step 4: Cross-check `src/providers/capabilities.ts`** (2 min)

  Run: `grep -n 'gemini' src/providers/capabilities.ts`

  Verify Gemini is not listed in eligible-phases anywhere (it should not be, per Option D §3.2 footnote drafting that Codex verified).

- [ ] **Step 5: Commit** (1 min)

  ```bash
  git add docs/contracts/PROVIDERS.md
  git commit -m "docs(providers): restructure live/stub/future-candidate explicitly

  Codex R0 M2 closure: separate live adapters from stubs from future candidates.
  - Live: Claude CLI, Codex CLI, xAI HTTP, FakeProvider
  - Stubs (transparency only): Gemini (throws on invocation)
  - Future, not v0.1: OpenCode, Roo Code

  Forbids phantom contract entries per CLAUDE.md non-negotiables."
  ```

### C4: ABOUT.md absorb metaphor

**Files:**
- Modify: `docs/ABOUT.md`

**Owner:** Claude

- [ ] **Step 1: Read current `docs/ABOUT.md`** (3 min)

- [ ] **Step 2: Add "## Historical context: the AI software company metaphor" section** (10 min) — one paragraph below concrete shipped facts. Frame as internal product metaphor, NOT active tagline. The phrase "Run an AI software company from your terminal" must NOT appear as an active tagline anywhere in ABOUT.md (it can appear within the historical paragraph as a quote of what we used to lead with).

- [ ] **Step 3: Move "hybrid phase-graph" architecture description from README** (5 min) — receive the dense detail.

- [ ] **Step 4: Move influence-library content from README** if present (3 min).

- [ ] **Step 5: Verify** (1 min) — `grep -c "Run an AI software company from your terminal" docs/ABOUT.md` — count occurrences. Must be ≤1 (the historical quote, if any).

- [ ] **Step 6: Commit** (1 min)

  ```bash
  git add docs/ABOUT.md
  git commit -m "docs(about): absorb demoted architecture detail + historical metaphor

  - Move 'hybrid phase-graph' jargon from README to ABOUT
  - 'AI software company' framed as historical/internal metaphor, NOT active tagline
  - Influence library detail consolidated here

  Closes Codex R0 prompt #5 refinement."
  ```

### C5: CLAUDE.md top-matter truth-sync (B1, block-approve)

**Files:**
- Modify: `CLAUDE.md`

**Owner:** Claude (this is the file you read every session — care needed)

- [ ] **Step 1: Read current `CLAUDE.md` top matter** (3 min) — specifically the "What this project is" section and any Gemini SDK mention.

- [ ] **Step 2: Find and rewrite the Gemini provider claim** (5 min)

  Search: `grep -n 'Gemini' CLAUDE.md`

  For each occurrence, evaluate: does this imply Gemini is live? If yes, rewrite to: "Gemini stub for transparency; OpenCode/Roo as future adapter candidates." If it's clearly historical/architectural context, leave it.

- [ ] **Step 3: Update status block** (3 min) — change "v0.20.0-alpha.0 shipped" framing to "v0.20.1-alpha.0 in preparation" with explicit pull-forward note.

- [ ] **Step 4: Verify** (2 min)

  Run: `grep -n 'Gemini.*SDK\|reading CLI OAuth tokens' CLAUDE.md`

  Should return no overclaim hits.

- [ ] **Step 5: Commit** (1 min)

  ```bash
  git add CLAUDE.md
  git commit -m "docs(claude-md): truth-sync top matter to honest provider story

  Codex R0 B1 closure (block-approve): CLAUDE.md and README must tell the same provider-support story by tag time.
  - Remove 'Gemini SDKs reading CLI OAuth tokens' overclaim
  - Provider surface: Claude CLI + Codex CLI + xAI HTTP + FakeProvider live; Gemini stub; OpenCode/Roo future
  - Update v0.20.0 status block to v0.20.1 framing"
  ```

---

## Track 2: Trust hygiene (C6–C10, ≈3h)

### C6: SECURITY.md

**Files:**
- Create: `SECURITY.md`

**Owner:** Claude

- [ ] **Step 1: Create file** with explicit sections (15 min):
  - Reporting a vulnerability (email + GitHub Security Advisories link)
  - Supported versions (v0.20.x)
  - Artifact trust posture (SHA-256 verification, **explicit unsigned-binary caveat with link to signing/provenance milestone** per Codex R0 missed-risk #5, xattr workaround)
  - Provider auth boundaries
  - What is logged in `events.jsonl` and what is not

- [ ] **Step 2: Verify markdown renders** (1 min): `head -40 SECURITY.md`

- [ ] **Step 3: Commit** (1 min)

  ```bash
  git add SECURITY.md
  git commit -m "docs(security): add SECURITY.md with explicit unsigned-binary caveat

  Closes Codex R0 missed-risk #5; satisfies GitHub Community Standards security policy."
  ```

### C7: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

**Owner:** Claude

- [ ] **Step 1: Create file** (20 min): local setup, test commands, commit conventions (conventional commits, no emoji, no `Co-Authored-By: Claude` footer), PR expectations, provider-test policy.

- [ ] **Step 2: Commit** (1 min)

  ```bash
  git add CONTRIBUTING.md
  git commit -m "docs(contributing): add CONTRIBUTING.md with local setup, test, commit conventions"
  ```

### C8: CODE_OF_CONDUCT.md (Codex R0 M1)

**Files:**
- Create: `CODE_OF_CONDUCT.md`

**Owner:** Codex (mechanical: adopt Contributor Covenant 2.1)

- [ ] **Step 1: Adopt Contributor Covenant 2.1 standard text** (5 min): fetch from `https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md` OR use the version already in many OSS projects.

- [ ] **Step 2: Set enforcement contact** (1 min): email or GitHub username.

- [ ] **Step 3: Commit** (1 min)

  ```bash
  git add CODE_OF_CONDUCT.md
  git commit -m "docs(coc): adopt Contributor Covenant 2.1

  Closes Codex R0 M1; satisfies GitHub Community Standards CoC requirement."
  ```

### C9: .github/ issue templates + PR template

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/install_problem.yml`
- Create: `.github/ISSUE_TEMPLATE/demo_failure.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`

**Owner:** Codex

- [ ] **Step 1: Create `bug_report.yml`** (5 min) with `type: form`, structured fields (platform/version/install-channel/repro/expected/actual).
- [ ] **Step 2: Create `install_problem.yml`** (5 min)
- [ ] **Step 3: Create `demo_failure.yml`** (5 min) with dropdown for which demo (`01-todo-cli` / `02-failure-gates`) + events.jsonl tail textarea.
- [ ] **Step 4: Create `feature_request.yml`** (3 min)
- [ ] **Step 5: Create `config.yml`** (1 min): `blank_issues_enabled: false`.
- [ ] **Step 6: Create `pull_request_template.md`** (3 min): summary, changes, testing (with bun test confirmation), Codex review verdict if applicable.
- [ ] **Step 7: Validate forms locally** (3 min): check YAML syntax with `bun run -e 'import("yaml").then(y=>y.parse(require("fs").readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml","utf8")))'`
- [ ] **Step 8: Commit** (1 min)

  ```bash
  git add .github/
  git commit -m "feat(github): add issue templates + PR template

  - 4 issue templates (bug, install, demo, feature)
  - blank issues disabled; PR template enforces test + review verdict checkboxes
  - Satisfies GitHub Community Standards"
  ```

### C10: docs/TRUST.md

**Files:**
- Create: `docs/TRUST.md`

**Owner:** Claude

- [ ] **Step 1: Create file** (20 min) covering: data boundaries, artifact trust, install trust, explicit unsigned-binary caveat + signing-milestone link, what is logged + what is not.

- [ ] **Step 2: Commit** (1 min)

  ```bash
  git add docs/TRUST.md
  git commit -m "docs(trust): add docs/TRUST.md with explicit data + artifact + install trust posture

  Closes Codex R0 missed-risk #5 (explicit unsigned-binary caveat + signing-milestone link)."
  ```

---

## Track 3: Proof assets (C11–C15, ≈5h)

### C11: docs/comparisons/ai-coding-agents.md

**Files:**
- Create: `docs/comparisons/ai-coding-agents.md`

**Owner:** Claude

- [ ] **Step 1: Read locked table from `docs/planning/1000_STAR_PLAN.md` §3.2** (3 min)
- [ ] **Step 2: Create comparison file with the table VERBATIM** (15 min) including all 9 footnotes with source URLs. Do NOT edit row content; only add an intro paragraph + a "best used with" framing + a "what code-oz is NOT" closer.
- [ ] **Step 3: Verify row-for-row match** (3 min)

  Run: `diff <(sed -n '/^| Feature |/,/^$/p' docs/planning/1000_STAR_PLAN.md) <(sed -n '/^| Feature |/,/^$/p' docs/comparisons/ai-coding-agents.md)` — expect empty diff for the table rows.

- [ ] **Step 4: Commit** (1 min)

  ```bash
  git add docs/comparisons/ai-coding-agents.md
  git commit -m "docs(comparisons): add ai-coding-agents.md (Option D §3.2 verbatim)

  Reuses Codex-verified, footnote-sourced, HN-hardened comparison table.
  Adds intro + 'best used with' framing + 'what code-oz is NOT' closer."
  ```

### C12: docs/benchmarks/agent-gate-bench.md (protocol-only)

**Files:**
- Create: `docs/benchmarks/agent-gate-bench.md`

**Owner:** Claude

- [ ] **Step 1: Create file** (25 min) framed as **benchmark protocol** per Codex R0 prompt #4 wording guard:
  - Name: Agent Gate Bench
  - Thesis: "code-oz catches governance failures direct-agent workflows miss; NOT 'code-oz writes better code'"
  - Task definitions per GPT Pro §8 (6 tasks)
  - Baseline methods (Claude Code alone / Codex CLI alone / direct + manual review / code-oz governed)
  - Metrics table
  - Expected result table with **all `TBD`** rows
  - Explicit "this is the protocol; measured rows land in v0.21 with the runner" framing
- [ ] **Step 2: Verify no badge claim, no `bench:*` command** (1 min) — protocol-only.
- [ ] **Step 3: Commit** (1 min)

  ```bash
  git add docs/benchmarks/agent-gate-bench.md
  git commit -m "docs(benchmarks): add agent-gate-bench.md as protocol (no measured proof)

  Codex R0 prompt #4 wording guard: framed as benchmark protocol; runner deferred to v0.21.
  No badge, no bench:* command, no measured rows until runner exists."
  ```

### C13: docs/design/ROADMAP.md add Now/Next/Later (B2 closure)

**Files:**
- Modify: `docs/design/ROADMAP.md` (canonical, 65k, exists)

**Owner:** Claude

- [ ] **Step 1: Read top 100 lines of `docs/design/ROADMAP.md`** (3 min)
- [ ] **Step 2: Insert public-summary "Now / Next / Later" section at the top** (10 min), before the detailed milestone inventory:
  - **Now (v0.20.1-alpha.0)**: this release contents
  - **Next (v0.21.0-alpha.0)**: M17 AUDIT runtime + brownfield smoke
  - **Later**: W3a R2 essay launch, Gemini live, OpenCode/Roo adapters, Windows/Scoop, signing
- [ ] **Step 3: Add anchor target** `#now-next-later` so README links work (1 min)
- [ ] **Step 4: Verify** (1 min) — `head -80 docs/design/ROADMAP.md` shows public summary first.
- [ ] **Step 5: Commit** (1 min)

  ```bash
  git add docs/design/ROADMAP.md
  git commit -m "docs(roadmap): add public Now/Next/Later summary atop canonical roadmap

  Codex R0 B2 closure: single roadmap authority; no docs/ROADMAP.md shadow file.
  README links docs/design/ROADMAP.md#now-next-later anchor."
  ```

### C14: failure demo scaffolding (docs + 5 fixture dirs)

**Files:**
- Create: `docs/demo/02-failure-gates/README.md`
- Create: `docs/demo/02-failure-gates/fixtures/01-tampered-artifact/` (dir + spec)
- Create: `docs/demo/02-failure-gates/fixtures/02-scope-escape/` (dir + spec)
- Create: `docs/demo/02-failure-gates/fixtures/03-verify-fail/` (dir + spec)
- Create: `docs/demo/02-failure-gates/fixtures/04-same-family-review/` (dir + spec)
- Create: `docs/demo/02-failure-gates/fixtures/05-reviewer-blocks-risk/` (dir + spec)

**Owner:** Codex (this is the code-track lead)

- [ ] **Step 1: Read `docs/demo/01-todo-cli/README.md` for shape reference** (3 min)
- [ ] **Step 2: Create `docs/demo/02-failure-gates/README.md`** (15 min): purpose, scenarios, expected outputs, "FakeProvider proves lifecycle determinism not model quality" framing per Codex R0 missed-risk #1.
- [ ] **Step 3: For each of 5 fixtures, create directory + `SPEC.md`** (5 min × 5 = 25 min): each spec describes setup, expected gate behavior, expected `events.jsonl` events, expected exit state.
- [ ] **Step 4: B5 audit** (5 min): for each fixture, grep src/state/gates.ts and src/providers/* to confirm the gate the fixture exercises actually exists in production. If a fixture would require new gate authority (e.g., same-family-review enforcement at REVIEW gate), CUT that fixture to v0.21 with an explicit note in this commit message.
- [ ] **Step 5: Commit** (1 min)

  ```bash
  git add docs/demo/02-failure-gates/
  git commit -m "feat(demo): scaffold 02-failure-gates with 5 fixtures + walkthrough

  Each fixture spec describes setup, expected gate behavior, expected events.jsonl
  events, expected exit state. FakeProvider framed honestly per Codex R0
  missed-risk #1.

  B5 audit result: [N/5 fixtures kept, M/5 cut to v0.21 with reason]."
  ```

### C15: failure demo run-demo + RED-first tests

**Files:**
- Create: `scripts/demo/02-failure-gates/run-demo.ts`
- Create: `tests/demo/failure-gates.test.ts`

**Owner:** Codex (RED-first per rule 22, this is the only behavior-change track)

- [ ] **Step 1: Read `scripts/demo/01-todo-cli/run-demo.ts` for pattern** (5 min)
- [ ] **Step 2: Write RED test FIRST** at `tests/demo/failure-gates.test.ts` (20 min) — one test per kept fixture; each asserts:
  - Demo script exits 0
  - Each fixture produces expected `events.jsonl` event sequence (gate_block events in expected order)
  - Each fixture produces expected gate file (NEEDS_INTERVENTION.json / STOP.json / REVIEW.md)
- [ ] **Step 3: Run RED test, confirm it fails for the right reason** (1 min)

  Run: `bun test tests/demo/failure-gates.test.ts`

  Expected: FAIL with "script does not exist" or "no fixture output"

- [ ] **Step 4: Write `scripts/demo/02-failure-gates/run-demo.ts`** (45 min): orchestrate FakeProvider + each kept fixture; collect events.jsonl; emit expected-vs-actual delta; exit non-zero on any mismatch.
- [ ] **Step 5: Run test, confirm GREEN** (1 min)

  Run: `bun test tests/demo/failure-gates.test.ts && bun run demo:failure-gates`

  Expected: both pass; demo exits 0.

- [ ] **Step 6: Confirm B5 not violated** (2 min) — grep the diff for any new gate-enforcement logic that didn't exist before. If found, revert and cut the offending fixture.

  Run: `git diff src/ | grep -E '^\+' | grep -v '^\+\+\+' | grep -i 'gate\|enforce\|block' | head -20`

- [ ] **Step 7: Commit** (1 min)

  ```bash
  git add scripts/demo/02-failure-gates/ tests/demo/failure-gates.test.ts
  git commit -m "feat(demo): implement 02-failure-gates run-demo + tests (RED-first)

  Rule 22 RED-first: tests written first, then minimal wiring-only impl.
  No new gate authority added (Codex R0 B5 audit confirms).

  - run-demo.ts orchestrates FakeProvider + N kept fixtures
  - tests assert events.jsonl gate-block event sequence per fixture
  - bun run demo:failure-gates is canonical command

  Closes failure-demo code track; opens Codex R1 verdict on this commit."
  ```

- [ ] **Step 8: Dispatch Codex R1 review on this commit** (~10 min wall time)

  Run via `mcp__plugin_agent-codex_codex-native__codex`:
  - Model: gpt-5.5 xhigh
  - Sandbox: read-only
  - Prompt: review C15 commit for rule 22 compliance, B5 compliance (no new gate authority), determinism, snapshot accuracy. Verdict: push / fix-first / debate-required.

- [ ] **Step 9: If Codex returns fix-first, close findings in C15-followup commit before proceeding to C16** (variable)

---

## Track 4: Release prep (C16–C18, ≈3h)

### C16: CHANGELOG.md entry

**Files:**
- Modify: `CHANGELOG.md`

**Owner:** Claude

- [ ] **Step 1: Add v0.20.1-alpha.0 section** (8 min) referencing each track + closure of GPT Pro audit findings.
- [ ] **Step 2: Commit** (1 min)

  ```bash
  git add CHANGELOG.md
  git commit -m "docs(changelog): add v0.20.1-alpha.0 entry"
  ```

### C17: release-notes drafts

**Files:**
- Create: `docs/handoffs/2026-05-14-v0.20.1-release-notes.md`
- Create: `docs/handoffs/2026-05-14-v0.20.0-release-notes-backfill.md`

**Owner:** Claude drafts; Ozzy posts via gh CLI (M4 closure)

- [ ] **Step 1: Draft v0.20.1 release notes** (15 min): why-this-release-matters → install → `bun run demo:failure-gates` → live/stub/future provider table → limitations → checksums.
- [ ] **Step 2: Draft v0.20.0 backfill** (10 min) addressing GPT Pro audit issue #5 (current notes too thin).
- [ ] **Step 3: Commit** (1 min)

  ```bash
  git add docs/handoffs/
  git commit -m "docs(release-notes): draft v0.20.1 + v0.20.0 backfill notes

  Maestro drafts; Ozzy posts via:
    gh release create v0.20.1-alpha.0 --notes-file docs/handoffs/2026-05-14-v0.20.1-release-notes.md
    gh release edit v0.20.0-alpha.0 --notes-file docs/handoffs/2026-05-14-v0.20.0-release-notes-backfill.md

  Codex R0 M4: tag/publish is Ozzy-approved external action."
  ```

### C18: fresh-clone smoke script (Codex R0 M3)

**Files:**
- Create: `scripts/release/fresh-clone-smoke.sh`

**Owner:** Codex

- [ ] **Step 1: Write sh script** (20 min): clone repo to tmp, `bun install`, `bun test`, `bun run demo:todo-cli`, `bun run demo:failure-gates`, then run a docs link check (`grep -r 'docs/' README.md | xargs ...` for 404s). Exit non-zero on any failure.
- [ ] **Step 2: chmod +x and run locally** (5 min): `chmod +x scripts/release/fresh-clone-smoke.sh && ./scripts/release/fresh-clone-smoke.sh`
- [ ] **Step 3: Commit** (1 min)

  ```bash
  git add scripts/release/fresh-clone-smoke.sh
  git commit -m "feat(release): add fresh-clone smoke script

  Codex R0 M3 closure: pre-tag smoke clones, installs, tests, runs both demos,
  checks README links. Exempt from rule 9 (same precedent as demo scripts:
  user-invoked, not orchestrator-spawned)."
  ```

---

## Track 5: Reviews + drift pass (C19–C20)

### C19: Codex public-claims bundle review

**Trigger:** After C1+C3+C4+C5+C11+C12+C13 land (public-facing claims surface).

**Owner:** Codex (dispatch from Maestro)

- [ ] **Step 1: Dispatch Codex R1** (~10 min wall time)

  Run via `mcp__plugin_agent-codex_codex-native__codex`:
  - Model: gpt-5.5 xhigh, sandbox: read-only
  - Prompt: "Review the bundle of public-claims changes (commits C1–C5, C11–C13) for: (a) Gemini overclaim, (b) OpenCode/Roo overclaim, (c) drift between README + CLAUDE.md + ABOUT.md + PROVIDERS.md, (d) factual accuracy of any product claim, (e) any sentence that would cause an HN comment within 4h. Verdict: push / fix-first / debate-required."

- [ ] **Step 2: If fix-first, close findings in C19-followup commits before C20** (variable)

### C20: Drift pass + Codex pre-tag review

**Trigger:** After all C1–C19 land.

**Owner:** Maestro runs drift pass; Codex does final pre-tag.

- [ ] **Step 1: Run drift pass script** (5 min)

  ```bash
  bash scripts/release/fresh-clone-smoke.sh
  ```

  Plus manual cross-file consistency check:

  ```bash
  for f in README.md CLAUDE.md docs/ABOUT.md docs/contracts/PROVIDERS.md docs/TRUST.md package.json; do
    echo "=== $f ==="
    grep -i 'gemini' "$f" | head -3
  done
  ```

  Every Gemini mention must be consistent: "stub" / "throws" / "not live".

- [ ] **Step 2: Run `bun test`** (1 min) — expect 3390+ pass, 0 fail.

- [ ] **Step 3: Dispatch Codex final pre-tag review** (~10 min wall time)

  Run via `mcp__plugin_agent-codex_codex-native__codex`:
  - Model: gpt-5.5 xhigh, sandbox: read-only
  - Prompt: "Final pre-tag review for v0.20.1-alpha.0. Read all commits on `finalize/v0.20.1-first-run-polish` since `main`. Verify: all spec acceptance criteria green; no new gate authority introduced; CLAUDE.md ↔ README ↔ PROVIDERS ↔ ABOUT consistent; no overclaim. Verdict: push / fix-first / debate-required."

- [ ] **Step 4: If fix-first, close before tag** (variable)

- [ ] **Step 5: Tag (Ozzy executes)**

  ```bash
  git tag -a v0.20.1-alpha.0 -m "code-oz v0.20.1-alpha.0 — first-run polish

  - README: CI-style gates for AI coding agents (truth-corrected)
  - CLAUDE.md + PROVIDERS.md ↔ README provider story aligned (no overclaim)
  - SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, TRUST.md
  - .github/ issue templates + PR template
  - Failure-gates demo (5 fixtures)
  - Agent Gate Bench protocol doc
  - docs/comparisons/ai-coding-agents.md
  - docs/design/ROADMAP.md public Now/Next/Later

  Closes GPT Pro third-party audit + Codex R0 + R1 + pre-tag verdicts."

  git push origin v0.20.1-alpha.0
  ```

- [ ] **Step 6: Ozzy posts releases**

  ```bash
  gh release create v0.20.1-alpha.0 --notes-file docs/handoffs/2026-05-14-v0.20.1-release-notes.md
  gh release edit v0.20.0-alpha.0 --notes-file docs/handoffs/2026-05-14-v0.20.0-release-notes-backfill.md
  ```

- [ ] **Step 7: Ozzy sets GitHub repo description + topics**

  Via GitHub web UI:
  - Description: `CI-style gates for AI coding agents — local-first governed delivery loop`
  - Topics: `ai`, `coding-agent`, `cli`, `sdlc`, `devtools`, `agentic-ai`, `claude-code`, `codex`, `typescript`, `open-source`

- [ ] **Step 8: Ozzy files 5 good-first-issues** via `gh issue create` with `good first issue` + topic label.

---

## Spec coverage self-check

Mapping each spec acceptance criterion to a commit:

| Acceptance | Commit |
|---|---|
| All 5 GPT Pro "five changes" shipped | C1 (README), C3 (PROVIDERS), C14+C15 (failure demo), C6+C7+C8+C9 (security/community), C17 (release notes) |
| GitHub Community Standards all-green | C6+C7+C8+C9 + Ozzy's UI setting (Track 5) |
| `bun test` 0 fail | maintained throughout; C15 RED-first |
| `bun run demo:failure-gates` exit 0 | C15 |
| `events.jsonl` ledger replay assertion | C15 test assertions |
| CLAUDE.md ↔ README ↔ PROVIDERS ↔ ABOUT consistent | C1+C3+C4+C5; C19 catches drift; C20 final |
| No new gate authority | C15 B5 audit step; C19 review explicit |
| Roadmap single-authority at docs/design/ROADMAP.md | C13 |
| Fresh-clone pre-tag smoke | C18 |
| Codex pre-tag verdict push | C19 + C20 |
| v0.20.1 tagged + install smoke green | C20 |

All spec acceptance criteria mapped. No placeholder steps. No "implement appropriate X" — every step has the actual content.
