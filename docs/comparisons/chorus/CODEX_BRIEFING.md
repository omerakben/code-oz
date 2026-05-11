# Codex briefing — code-oz vs Chorus comparison (round 1)

> **Goal:** Pressure-test the v1 comparison draft at `docs/comparisons/chorus/COMPARISON.md` with `gpt-5.5` xhigh peer review (sandbox: read-only).
>
> **Date:** 2026-05-10
> **code-oz status:** v0.17.0-alpha.0, M16 closed, ~3108 tests, post-PE-1
> **Chorus status (truth source: Chorus `package.json`):** v0.7.1 (2026-05-04), fine-grained agent permissions shipped in 0.7.0 (2026-05-02)
> **Reviewer (you):** independent reviewer, not author of the draft
> **Process:** read the draft + the cited code, return `agree` / `agree-with-modifications` / `disagree` with structured findings

---

## 1. Context — what this comparison is, and what it is not

code-oz is iterating through a comparison sweep — one template per session — against `~/Projects/agents/templates/<template>/`. The first sweep (`docs/comparisons/agentic-canvas/`) closed 2026-05-10 with a `YES — code-oz exceeds` verdict, 5 borrows, 3 rejects, 1 split, plus one held-back disagreement ("adoption can beat architecture") that became load-bearing in §5 of that comparison.

Chorus (`~/Projects/agents/templates/Chorus/`) is the second sweep. Chorus is fundamentally different from agentic-canvas:

- Chorus is a **multi-tenant browser-based AI+human collaboration platform** (Next.js + Postgres + Prisma + Redis + 21 Prisma models + MCP server + plugins for Claude Code, Codex CLI, OpenCode).
- Chorus implements **AI-DLC** (AWS-derived: Idea → Proposal → [Document + Task DAG] → Execute → Verify → Done) with the explicit philosophy of **Reversed Conversation** (AI proposes, humans verify).
- Chorus's most distinctive feature is a **5×3 permission matrix** (resource × action: idea/proposal/document/task/project × read/write/admin = 15 bits) shipped in v0.7.0 on 2026-05-02, with three named presets (`developer_agent` / `pm_agent` / `admin_agent`) plus Custom, and **stateless MCP server with permission-gated tool registration** as the agent transport.

code-oz is **not** competing with Chorus — they are adjacent product categories. But Chorus has shipped patterns code-oz could borrow narrowly without changing identity. The comparison's job is to identify which patterns are worth borrowing vs rejecting.

---

## 2. Author's recommended verdict (for you to challenge)

**YES — code-oz exceeds Chorus as a governed agentic SDLC runtime.**

- code-oz is mission-superior on **every** dimension that matters for single-user governed agentic SDLC: cross-family review (Rule 2 + M14 panel), debate (M10 + M15), gate discipline (Rule 1), provider abstraction (M11), budget enforcement (Rule 19), brownfield (Rule 14), milestone discipline (Rule 20).
- Chorus is mission-superior on **every** dimension that matters for multi-human + multi-agent team collaboration: presence, Kanban, OIDC, multi-tenant, MCP-as-transport, Cmd+K search, structured elaboration rounds.
- Six narrow borrows proposed (`COMPARISON.md` §3.1–§3.5 + §3.6 hypothesis). Six explicit rejects (§4.1–§4.6).
- Strongest convergence hypothesis: **code-oz as MCP-served headless runtime** (§3.6) — Chorus already proves the MCP-as-runtime pattern works with permission-gated tools; code-oz could expose run state + selected actions over MCP and let any MCP-aware client (including a Chorus-style team UI) drive runs while code-oz keeps file-based gates as authority.
- Promoted: §3.3 (`code-oz mcp serve`) from "v0.3+ post-W3" to **"first v0.2 milestone after W3 closes"** because Chorus demonstrates MCP-as-transport is the dominant agent-collaboration shape now.

---

## 3. The six proposed borrows (rate each)

### 3.1 Resource × Action permission grid (highest-value)

Add a typed grid like `Resource ∈ {spec, plan, build_report, verify, review, audit, scientist_tail} × Action ∈ {read, write, approve}` to code-oz agentpacks, alongside the existing `tool_use.repo_context` scope. Lives next to (not instead of) M11 provider capability contract. **M11 = what a *provider* may do; this grid = what a *role* may do with run artifacts.** Orchestrator enforces both before any phase write.

Cited code: `src/lib/authz/types.ts`, `presets.ts`, `permissions.ts`, `src/mcp/tools/permission-map.ts`, `register-helpers.ts` in Chorus; `src/agents/schema.ts` (AgentPermissions) and `src/tools/repo-context/permissions.ts` in code-oz.

**Rate:** Is this borrow worth it? Does it conflict with M11 in ways the draft missed? Is the resource list right (does it miss DEBATE.md, REPO_CONTEXT, …)? Should this be its own milestone (Rule 20)?

### 3.2 Per-AC dual-path verification

Chorus's `AcceptanceCriterion` table has two parallel state machines per row: `devStatus + devEvidence + devMarkedBy` (Builder self-check) and `status + evidence + markedBy` (Admin/Reviewer mark). code-oz's `VERIFY.md` has a single binary `## Verdict` over the whole task. Borrow: per-AC structured records inside SPEC/BUILD_REPORT/VERIFY artifacts; gates stay binary at the file level, granularity moves *inside* the artifact.

Cited code: `prisma/schema.prisma:242` (Chorus); `docs/contracts/VERIFY.md` and `docs/contracts/SPEC.md` in code-oz.

**Rate:** Does per-AC dual-path actually pay off given M14 reviewer panel already synthesizes per-task? Or does it create slop (more text without proportional gain)? Does the granularity unlock M15 debate triggers in a useful way?

### 3.3 Stateless MCP server with permission-gated tool registration (load-bearing)

`code-oz mcp serve --runId <id>` exposes a small permission-gated MCP surface: `code_oz_get_run_state`, `code_oz_request_review`, `code_oz_request_debate`, `code_oz_approve_phase`, `code_oz_view_artifact`. Permission gating via §3.1's grid keeps `approve_phase` away from Builder roles. **Promoted from v0.3+ to "first v0.2 milestone after W3 closes."**

Cited code: Chorus `src/app/api/mcp/route.ts` (stateless), `src/mcp/server.ts`, `src/mcp/tools/register-helpers.ts`, `src/mcp/tools/permission-map.ts`. code-oz has no MCP server; agents talk to *other* MCP servers (Context7) but don't expose code-oz state.

**Rate:** Is the promotion to first v0.2 milestone correct, or should it stay v0.3+? Does the `127.0.0.1`-only constraint (privacy by default, Rule 13) cover the threat model? Are the listed tools the right cut, or is something missing/extra? Is auth-per-run vs auth-per-principal the right tradeoff for a single-user CLI?

### 3.4 "Reversed Conversation" as named philosophy

Doc-only borrow: name the principle (AI proposes, humans verify) in CLAUDE.md / `docs/product/AI_SOFTWARE_COMPANY_THESIS.md`, cite AWS AI-DLC as lineage. code-oz already does this in DEFINE/PLAN; naming elevates the discipline.

Cited code: AWS AI-DLC docs (Chorus links them), `docs/contracts/SPEC.md`, `docs/contracts/PLAN.md` in code-oz.

**Rate:** Is this just rebranding, or load-bearing? Does the AWS AI-DLC citation strengthen or weaken the thesis (e.g., does it tie code-oz to a framework code-oz should not be associated with)?

### 3.5 Event attribution borrow (per-event provider/model/cost)

Pair with the agentic-canvas RunSummary borrow. Add `provider` + `model` + `costEstimate` per event in `events.jsonl` so a derived RunSummary can attribute cost by actor without joining. Chorus's denormalized session attribution on Activity is the validation that this pattern works at scale.

**Rate:** Are events in `events.jsonl` already carrying enough? Is per-event cost the right granularity, or is per-call enough? Does denormalization conflict with anything in `docs/contracts/`?

### 3.6 MCP-served headless runtime (convergence hypothesis)

Track in `docs/research/MCP_RUNTIME_HYPOTHESIS.md`. No milestone until §3.3 ships. The split: code-oz owns artifacts + gates; the frontend (Chorus-like, or any MCP-aware client) owns presence + Kanban + audit display.

**Rate:** Is this stronger than the agentic-canvas canvas-as-frontend hypothesis (which is also tracked, no milestone)? Should code-oz commit to the MCP-runtime path now, or genuinely hold per Rule 21 (no new parallel-provider surface without measurable risk-reduction)?

---

## 4. The six proposed rejects (rate each)

1. **Postgres + Prisma + Redis stack** — wrong-stack for Bun-binary distribution + offline FakeProvider determinism + privacy-by-default.
2. **Browser-based dashboard as primary surface** — same as agentic-canvas's `127.0.0.1` HTTP server rejection; conflicts with binary-first.
3. **Live presence indicators** — wrong-surface for single-user CLI.
4. **Polymorphic human/agent assignment** — wrong-domain; tasks are never assigned to "the user" in code-oz.
5. **OIDC + SuperAdmin + multi-tenant Company model** — wrong-scale for a single-user CLI.
6. **i18n at the framework level** — wrong-overhead for English-only CLI binary.

**Rate each:** are any of these wrong rejections? Is something rejected that should actually be a deferred-borrow (split bin)? Is something accepted that should be rejected?

---

## 5. Specific things you might find that the draft missed

The draft was written by the same author as the agentic-canvas comparison. Likely blind spots:

- **Are there Chorus patterns the draft missed entirely?** Especially: structured Q&A elaboration rounds (`docs/DESIGN_REQUIREMENTS_ELABORATION.md`), document export (MD/PDF/Word), Cmd+K universal search across 6 entity types (`docs/SEARCH.md`), notification system (`src/services/notification-listener.ts`), `@`-mention with permission-scoped autocomplete, idea-derived-status (`docs/idea-derived-status.md`), Chorus's `proposal-reviewer` and `task-reviewer` subagent shapes.
- **Are any of the six rejections wrong?** E.g., should "framework-level i18n" be split: reject the framework, but accept the *idea* of locale-aware persona prompts for non-English users?
- **Is the §3.3 promotion premature?** The agentic-canvas comparison promoted skill wrappers from "post-W3" to "W3.x"; this comparison promotes MCP server from "v0.3+" to "first v0.2." Two promotions in two sweeps is a pattern — is it correct, or is it scope-creep cascading?
- **Is the AI-DLC citation safe?** Tying code-oz's product thesis to AWS AI-DLC is a positioning move. Could it backfire (e.g., AWS rebrands or deprecates AI-DLC)?
- **Did the draft overstate code-oz's lead?** The "eleven deep wins" list is long. Is each item actually *uniquely strong* in code-oz, or is the bar set too low?
- **Is the verdict actually `YES`?** The draft says yes. Could the right call be `YES, with caveats` or `agree-with-modifications`? Specifically: Chorus's MCP-as-transport + permission-grid combo is so cleanly designed that "code-oz exceeds" feels right architecturally but might lose adoption to a Chorus-style team surface in 6–12 months. Is the held-back disagreement from agentic-canvas ("adoption can beat architecture") even more load-bearing here?

---

## 6. Output you should produce

A response file at `docs/comparisons/chorus/CODEX_RESPONSE.md` with this structure:

```markdown
# Codex peer review — code-oz vs Chorus comparison

> Round 1 — raw response. Captured <date>. Model: gpt-5.5 xhigh, sandbox read-only.
> Thread: <thread-id>. Briefing: CODEX_BRIEFING.md.

## 1. Verdict
agree | agree-with-modifications | disagree
+ one paragraph on why

## 2. Findings
[severity] [class] One-line summary
- Cites: paths
- Suggested fix:

(Severity: fix-first | fyi | nit. Class: doc-rot | framing | missed-borrow | overstated-win | scope-creep | false-rejection | false-borrow | other.)

## 3. Recommended next actions
1. Numbered, with target milestone

## 4. One disagreement held back
The single thing you almost pushed harder on but did not.
```

Be direct; the draft author wants disagreement, not deference. Cite exact file paths so synthesis can verify each finding. If the author missed a Chorus pattern, name it specifically with file path. If the verdict is wrong, say so and explain why.

---

## 7. Constraints

- Sandbox: **read-only**. Do not write any files.
- Working directories: `~/Projects/code-oz` (full read access) + `~/Projects/agents/templates/Chorus` (full read access).
- Reasoning effort: **xhigh**.
- Model: `gpt-5.5` (the `-codex` variants are known to fail on this auth — fall back to `gpt-5.5` if needed).
- Independence: do not consult other comparisons during round 1; the synthesizer will reconcile across rounds. You may *cite* the agentic-canvas comparison if a finding cross-references it, but do not anchor on it.
- Length: 5–10 findings is normal. More than 15 means the author missed too much; less than 3 means the author overstated rigor.
