# Codex briefing — byterover-cli comparison (2026-05-10)

**Reviewer:** OpenAI Codex CLI, model `gpt-5.5`, reasoning effort `xhigh`, sandbox `read-only`.
**Caller:** Claude Opus 4.7 (1M context).
**Scope:** byterover-cli (`brv`) head-to-head vs code-oz v0.17.0-alpha.0.
**Companion doc:** [`COMPARISON.md`](./COMPARISON.md) — full feature matrix, 6 borrow candidates, 10 rejects, 8 open questions.
**Cross-model peer review rule:** `CLAUDE.md` § "Cross-model peer review (durable rule)" — Codex's verdict is data, not authority. Disagreement is allowed and preferred over rubber-stamps.

---

## 1. Goal

Pressure-test Claude's verdict that **code-oz exceeds byterover-cli on the SDLC-runtime authorities that matter for our category**, with three small borrows (B1, B3, B4) earning their place at v0.17 and three more (B2, B5, B6) deferred. Identify any:

- Borrows Claude misread or misnamed.
- Borrows Claude proposed but that violate code-oz's locked rules (rule 1 file-based gates, rule 7 plain-Markdown contracts, rule 13 file-manifest context, rule 18 `tool_use.repo_context` permission scope, rule 19 cumulative budget enforcement, rule 20 one-authority-per-milestone, rule 21 risk-reduction-for-parallel-providers).
- Rejects Claude over-priced or under-priced (R1-R10 in COMPARISON §6).
- Sub-surfaces Claude under-counted (M16 lesson: under-counting hides bugs).
- byterover-cli surfaces Claude missed entirely.

---

## 2. Constraints (hard, non-negotiable)

These are the locked rules. A proposal that violates them is rejected by definition:

- **Rule 1 — file-based gate signals only.** No parsing LLM text for pass/fail. Any borrow that suggests an LLM-judged gate is rejected.
- **Rule 2 — cross-family review at REVIEW gate.** REVIEW must be a different provider family than BUILD. byterover's `brv review` is HITL by a *human* and is not a substitute.
- **Rule 7 — plain-Markdown artifact contracts.** Any borrow that adds JSON serialization for inter-phase handoffs is rejected.
- **Rule 13 — privacy by default.** No silent recursive repo context. File manifests only.
- **Rule 18 — repo_context is a permission-gated sub-scope.** Any new search surface inherits the permission scope; network access denied for repo_context tools.
- **Rule 19 — cumulative budget enforcement.** New surfaces must price into `budgets.global` and emit per-call telemetry.
- **Rule 20 — one new authority boundary per milestone.** Bundled milestones are rejected. Each borrow must be priced in rule-20 sub-surfaces *before* sequencing.
- **Rule 21 — no new parallel-provider surface without measurable risk reduction.** Any borrow that adds a multi-provider surface needs a metrics plan against the single-provider baseline.

---

## 3. Locked answers (do not relitigate)

These are pinned from prior rounds. Codex should accept them as the floor and only contest with new evidence:

1. **byterover-cli is in an adjacent category (memory layer), not the same category as code-oz (SDLC runtime).** The verdict frame is "where do byterover's mechanics translate," not "is byterover better."
2. **17 of byterover's 21 LLM provider modules are out of scope** under rule 11 (PE-2+ demand-gated). The PE-1 round (Codex thread `019de497`) already settled the demand-driven expansion policy.
3. **REPL + TUI + web UI are intentionally not on the v0.1 surface.** Code-oz is a one-shot CLI by design. Distribution is W3+ (Homebrew/Scoop/npm), not in-product UI.
4. **Daemon architecture is rejected.** Code-oz runs are bounded; daemon adds lifecycle authority without the multi-client benefit byterover gets from REPL+TUI+webui+MCP.
5. **`brv vc` git-like VC over context tree is rejected.** Code-oz's `state/events.jsonl` is forward-only by design; introducing branch/merge of run history would invalidate budget enforcement (rule 19 reads cumulative `events.jsonl` per-call).
6. **`brv swarm` federation is rejected.** Code-oz federates *agents* (M14 reviewer panel, M15 debate scheduler), not memory backends.
7. **The agent-skills round 2 lesson (sub-surface accounting before sequence) is mandatory, not advisory.** Each borrow in COMPARISON §5 is already priced; Codex should sharpen the prices, not skip them.
8. **The post-M10 sequence is locked** (CLAUDE.md rule 20 commentary): M11 capability contract → M12 company roster → M13 role-cost → M14 reviewer panel → M15 debate scheduler. Codex thread `019de031` pinned this. M16 (production CLI completion) shipped 2026-05-10. Borrows compete for M17/M18 slots, not earlier.

---

## 4. Recommended landing plan (Claude's lean)

In priority order. Codex is asked to challenge any of these four lines:

### Commit 1: docs(rules): add rule 22 — Outside-In feature design (B1)

- File: `CLAUDE.md`.
- Add to the non-negotiable rules list:
  > **22. Outside-In feature design.** Every new code path starts from a concrete consumer (CLI subcommand, agent skill, persona prompt). Define the minimal interface the consumer requires; implement the service to fulfill it; extract entities only when shared structure emerges across consumers. Reviewing or planning that defines entities, types, or store interfaces before any consumer exists is Inside-Out and must be flagged.
- Estimated diff: 8-10 lines.
- Rule-20 cost: zero.

### Commit 2: docs(rules): add rule 23 — Strict TDD ordering (B4)

- File: `CLAUDE.md`.
- Add to the non-negotiable rules list:
  > **23. Strict TDD ordering for behavior changes.** For any behavior change, the failing test is written first, run to confirm it fails for the right reason, then minimal implementation lands, then tests run again to confirm green, then refactor. If implementation lands without a prior failing test, STOP and write the test first. The agent-skills round (commit 3) already operationalizes this in PLAN/builder personas; rule 23 is the upstream non-negotiable.
- Estimated diff: 6-8 lines.
- Rule-20 cost: zero.

### Commit 3: feat(role-cost): thread parentTaskId through reviewer panel + debate runtime (B3)

- Files: `src/runtime/role-cost.ts` (or wherever M13's role-cost telemetry lives), `src/runtime/reviewer-panel.ts` (M14), `src/runtime/debate-runtime.ts` (M10/M15).
- Behavior: child provider calls fan out under M14/M15 carry `parentTaskId`. The cost-rollup view shows "M14 reviewer panel run #5: $0.42 across 3 reviewer calls" instead of N detached rows.
- Estimated diff: ~30-50 lines plus tests.
- Rule-20 cost: 1 sub-surface (M13 schema extension; telemetry-only, no behavioral change).
- Rule-21 cost: zero (telemetry, not a new parallel-provider surface).

### Commit 4: docs(comparison): close 09-byterover-cli round + index update

- Files: `docs/comparison/09-byterover-cli/SYNTHESIS.md`, `docs/comparison/README.md`.
- Estimated diff: ~150 lines (SYNTHESIS) + 1 row (README sessions table).
- Rule-20 cost: zero.

### Future milestones

- **M17/M18 candidates (one of, debated next round):**
  - **(a)** SHIP runtime completion (the v0.1 SHIP stub) — already on the M17 short-list from agent-skills round 2.
  - **(b)** Doubt-driven pre-BUILD checkpoint — agent-skills round 2 candidate.
  - **(c)** B2 two-tier search — `code-oz search` BM25 adjacent to `code-oz consult`. Rule-20 cost: 2 sub-surfaces.
- **Pattern-only (apply when surface needs it):** B5 AsyncLocalStorage snapshot for policy-at-task-creation.
- **Track for later:** B6 ESLint-enforced import boundary (M17+ when CLI grows past four subcommands).

---

## 5. Specific debate prompts

Codex is asked to push back on any of these. Disagreement is the value, not consensus.

### 5.1 Verdict honesty (open question 1)

Claude's claim: "code-oz exceeds byterover-cli on SDLC runtime authorities." This is true on the 12 axes in COMPARISON §4. Is the *framing* honest, given that byterover ships:

- a daemon with multi-client transport that code-oz will likely need at some milestone,
- a web UI that gives users a shared surface for state inspection,
- MCP so other agents consume byterover's output,
- 21 providers with mature compression strategies (oldest-removal, middle-removal, escalated, reactive-overflow)?

**Push:** is code-oz under-budgeting future engineering surface that byterover demonstrates is real, just because the *category* is different?

### 5.2 B3 priority (open question 3)

If M14 (reviewer panel) and M15 (debate scheduler) are *already shipped*, the parentTaskId rollup gap may already exist in production `events.jsonl`. Two reads:

- **Claude's read:** ship as M13 follow-up commit (rule-20 cost: 1 sub-surface, telemetry-only).
- **Alternative:** treat as a bug, file as a hotfix, ship before M17.

**Push:** is this a bug fix in disguise, and should it ship today rather than at the next docs commit?

### 5.3 B2 priority (open question 2)

B2 (two-tier search: `code-oz search` BM25 + existing `code-oz consult`) introduces 2 rule-20 sub-surfaces. Three M17/M18 contenders:

- (a) SHIP runtime completion (high-value but unfinished from v0.1 stub).
- (b) Doubt-driven pre-BUILD checkpoint (agent-skills round 2 design; addresses M16's 8-bug pattern).
- (c) B2 two-tier search (cost reduction + bounded latency).

**Push:** which of (a)/(b)/(c) is M17? Which is M18? Is there a reason to bundle (b)+(c)? (Rule 20 says no, but Codex may surface a *measurable* reason.)

### 5.4 Rule-list bloat (open question 4)

Adding rules 22 (Outside-In) and 23 (TDD ordering) takes the non-negotiable count from 21 to 23. Three framings:

- **(a)** Two new top-level rules (Claude's lean).
- **(b)** One consolidated rule "Design and verification discipline."
- **(c)** Keep them in skills/persona prompts and not the non-negotiable list at all (since the agent-skills round 2 already added validation language to PLAN/builder).

**Push:** is the non-negotiable list the right home, or are we diluting the list?

### 5.5 R10 — outbound MCP (open question 5)

Claude rejected outbound MCP. But: code-oz exposing its `events.jsonl` and gate-file artifacts as an MCP server might be the cheapest way to validate the "AI software company" thesis — *other* agents could read code-oz's gate signals as evidence of work shipped.

**Push:** is the rejection too quick? What is the rule-20 cost of an outbound MCP surface that exposes `events.jsonl` + gate files read-only?

### 5.6 RuntimeSignalStore pattern (open question 6)

byterover keeps file-level usage/maturity *outside* synthesized markdown frontmatter, in a separate `RuntimeSignalStore`. Is there a code-oz analog that would matter (e.g., per-file cost attribution for repo_context lookups, or per-file "review burn rate" — how many review rounds a given file pulled in)?

**Push:** any borrow here, or correctly out-of-scope?

### 5.7 Sub-surface accounting (open question 7)

B2 is priced at 2 sub-surfaces (new CLI subcommand + index storage). The M16 lesson was that under-counting hides bugs.

**Push:** does B2 actually cost 3 sub-surfaces if you count the BM25 indexer service itself as separate from the storage? Or 2 if the indexer is just `minisearch`-as-a-library and the only authority is "build-and-cache the index"?

### 5.8 Distribution (open question 8)

byterover ships `curl -fsSL https://byterover.dev/install.sh | sh` (bundled, no Node required). Code-oz's W3+ plan is npm + Homebrew + Scoop with auto-PATH-patching.

**Push:** is `curl | sh` worth one rule-20 sub-surface (release tarball + install script + signature verification) for the friction reduction it gives non-Node users?

---

## 6. Pinned canonical contracts (re-read before answering)

Per memory pin `feedback_contract_first_reading.md`: re-read pinned contracts before drafting decisions.

- `CLAUDE.md` (project root) — non-negotiable rules, influence library, cross-model peer review rule.
- `docs/contracts/REPO_CONTEXT.md` — `tool_use.repo_context` sub-scope (rule 18).
- `docs/contracts/SCIENTIST.md` — epistemic sidecars at gates (rule 15).
- `src/prompts/universal-rules.md` — universal anti-slop rules (rule 16).
- `docs/design/ROADMAP.md` — milestone plan and decision matrix.
- `docs/product/AI_SOFTWARE_COMPANY_THESIS.md` — product thesis pinned 2026-04-30.

---

## 7. Verdict format

Codex returns one of:

- **`push`** — Claude's COMPARISON + landing plan can ship as-is. No block-push or fix-first findings. Nits and FYIs allowed.
- **`fix-first`** — at least one block-push or block-next-milestone severity finding. List findings by severity; Claude addresses in a follow-up commit before SYNTHESIS.md is finalized.
- **`debate-required`** — at least one finding that contests a locked answer in §3, or surfaces a borrow Claude missed entirely. Claude must respond in SYNTHESIS.md and either accept the reframe or pin the disagreement.

Codex output should follow the structure used in `docs/comparison/04-archon/CODEX_RESPONSE.md` and `docs/comparison/05-agent-skills/codex-response.md`:

1. **Verdict line** (push / fix-first / debate-required).
2. **Severity table** (block-push / block-next-milestone / fix-soon / nit / fyi) with one row per finding.
3. **Findings prose** — for each finding, a short paragraph: what, why, where (file/line), recommended fix.
4. **Open questions Codex still has** — to be carried to SYNTHESIS.md.
5. **Reframes** — if any locked answer in §3 should be revisited, name it explicitly.

---

## 8. What Claude is asking Codex to do

1. Read [`COMPARISON.md`](./COMPARISON.md) end-to-end. Pay specific attention to §5 (borrow candidates with rule-20 sub-surfaces) and §6 (reject list with reasons).
2. Read this briefing's §3 (locked answers) and §5 (debate prompts).
3. Re-read the canonical contracts in §6 of this briefing as needed.
4. Return a verdict per §7, with findings prose addressing as many of the eight debate prompts as Codex chooses to engage.
5. Output to `docs/comparison/09-byterover-cli/CODEX_RESPONSE.md`.

This is the sixth template comparison in the series. The first five (ace, agenticSeek, aris, archon, agent-skills) shipped a SYNTHESIS landing plan after the Codex round. This round will follow the same shape.
