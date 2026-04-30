# code-oz — research synthesis Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. This is a meta-layer round, not a milestone implementation round. M5 has shipped (`v0.5.0-alpha.0`, 542 tests passing offline, three-round Codex review trail closed with `push` verdict). M6 is next on the spine path. This briefing debates how research findings from a 7-dossier bundle should adapt to existing features — specifically, which findings become durable CLAUDE.md rules vs. milestone-local discipline, and how the proposed Scientist meta-agent and codebase-context-retrieval capabilities slot into the M6/M7 sequence without breaking Option E.

The synthesis you are reviewing is in `docs/research/SYNTHESIS.md` (commit `e5191aa` on branch `docs/research-synthesis`). The 7 underlying dossiers are in `docs/research/01-` through `07-` (commit `a3eea10`). I have leans on **four prompts**. Push back hard where they are wrong. Confirm fast where they hold up. Mirror the verdict format from `CODEX_RESPONSE_M5.md`: "Where I agree", "Where I disagree (with specific alternative)", "Decisions you must lock before merge".

---

## What you should already have read

- **`CLAUDE.md`** — non-negotiable rules 1–14 plus cross-model peer review rules 7–10. The "Architecture locks" section pins the spine, the file format, the phase taxonomy, the state model, the cross-provider primitive. The current rule sheet has 14 entries; this synthesis proposes adding 5 more (rules 15–19).

- **`docs/research/SYNTHESIS.md`** — the proposed deltas this round debates. Five proposed CLAUDE.md additions, milestone scope changes for M6/M7/W2/W3/W4, five user decisions, and the four prompts you are about to debate. Also reconciles the bundle's M5-in-flight assumption against M5-now-closed.

- **`docs/research/01-maestro-rule-checker.md`** — the maestro discipline (rule-checker role, 9-family bug map, 10 forced-correction skills, four-layer file-system memory). Synthesis rule 17 proposes pinning this dossier as authoritative.

- **`docs/research/02-llm-failure-research.md`** — 17-family failure research with 2024–2026 citations. The "rule sheet (embeddable)" section near the end is the 20-item universal anti-slop list synthesis rule 16 proposes shipping into every persona prompt.

- **`docs/research/04-missing-pieces-brainstorm.md`** — gap analysis. Item 1 (codebase context retrieval), item 2 (iterative BUILD loop), item 6 (run-level budgets) are flagged as M6/M7 spine-completion blockers. Item 4 (AUDIT depth), item 8 (telemetry feedback) are cross-cutting always-on.

- **`docs/research/05-scientist-and-open-questions-agent.md`** — the Scientist meta-agent proposal. HYPOTHESES.md and OPEN_QUESTIONS.md as plain-Markdown sidecar artifacts; phase-tail run after every phase before the gate fires; gate-blocks-on-overdue-questions extends the existing file-based gate model.

- **`docs/research/06-templates-reference.md`** — extended influence-library map. Notes that the CLAUDE.md table is out of date: the templates folder has 15 directories, only 7 are credited. Most consequential uncredited template: `claude-code-main`, which is the leaked Anthropic Claude Code source from the March 2026 npm map-file leak. Synthesis prompt 2 debates whether to borrow from it.

- **`docs/design/ROADMAP.md`** — the locked Option E plan. M6 is PLAN with 3-source verification; M7 is BUILD/VERIFY/REVIEW-lite spine end-to-end. W2+ is post-MVP. Adopting synthesis recommendations grows M6 from 10 commits to ~12 (Scientist phase-tail + codebase-context-retrieval) and M7 from existing scope to ~12 (iterative BUILD loop + mutation-test gate + universal rule sheet shipped).

- **`docs/design/CODEX_RESPONSE_M5.md`** — format reference for what your reply should look like.

You do not need to read the full source tree. Glance at:

- **`src/providers/invoke.ts`** — the wrapper layer (`invokeAgent`). This is where run-level budget enforcement lands (synthesis rule 19) and where tool-use permission scopes are enforced (rule 18). The wrapper's existing `assertWithinBudget` reads `events.jsonl` per-call; prompt 4 below debates whether to keep that or maintain a running counter.

- **`src/agents/schema.ts`** — current `AgentPermissions` shape. `read`/`write`/`bash` exist; `tool_use` does not. Rule 18 proposes adding it.

- **`src/state/events.ts`** — open-type-union event schema (validation rule 12). Already accepts unknown event types; Scientist's `science_started` / `science_completed` / `hypothesis_added` / `question_resolved` events land without a version bump.

- **`src/artifacts/spec.ts`** — SPEC.md parser. Currently rejects anything beyond bullets + blank lines in section bodies. The Scientist proposal wants primary artifacts to cite `H-NNN` ids; synthesis recommends sidecar pattern (HYPOTHESES.md is a sibling) to avoid relaxing the SPEC schema.

---

## What's locked (not up for debate)

These come from CLAUDE.md, the locked ROADMAP, and M5's closed Codex review trail.

1. **Option E spine-first sequencing.** M6 (PLAN) before M7 (BUILD/VERIFY/REVIEW-lite). No new phases inserted between them. Scientist must ride existing milestones, not slot a new one (synthesis prompt 3 debates how).

2. **File-based gate signals only (rule 1).** Anything Scientist adds (HYPOTHESES.md, OPEN_QUESTIONS.md) extends the existing gate model — never a substitute. The maestro reads files; LLM text is never the source of truth.

3. **Cross-family review at REVIEW gate (rule 2 + rules 7–10).** The Codex round at planning convergence is durable. Adding more cross-family review surfaces (e.g., on INTENT.md, on HYPOTHESES.md) is a milestone-local extension; the universal rule stays as-is.

4. **Privacy by default + explicit file manifests (rule 13).** Codebase-context retrieval (rule 18 candidate) cannot bypass the manifest model. Search results land in the *next* invocation's manifest, not the search invocation's.

5. **Permission upper bounds, not glob expansion (rule 13 + agent-skill-format.md).** Adding `tool_use` to AgentPermissions extends but does not relax this discipline.

6. **CLAUDE.md is for universally applicable rules only (HumanLayer 150–200 instruction budget, dossier 02 §"The rule sheet").** Five additions takes it from 14 to 19 rules. Anything more goes in milestone docs / persona prompts.

7. **M5 is closed.** Synthesis must reconcile against M5 shipped, not M5 in-flight as the bundle assumed.

8. **Pattern-borrowing discipline (CLAUDE.md "Influence library").** Patterns are borrowed; no code dependencies, no submodules, no copy-paste. Audit and credit. Synthesis prompt 2 debates whether borrowing from a leaked source preserves this discipline or breaks it.

---

## The four prompts

### Prompt 1 — Should rule 15 (Scientist) be a CLAUDE.md universal rule, or should it stay in dossier 01/05 as the maestro discipline that personas adopt by reference?

**My lean:** Add as rule 15 (CLAUDE.md). Body: "Every phase that produces a primary artifact (SPEC, AUDIT, PLAN, BUILD_REPORT, VERIFY, REVIEW) also produces or updates HYPOTHESES.md and OPEN_QUESTIONS.md. The phase gate cannot fire while an open question carries a `Latest phase: <this phase>` deadline. Hypotheses without falsifiers and questions without resolution criteria are rejected by the maestro before the gate is consulted."

**Reasoning:** The discipline applies across every phase, not one. Without a universal rule, each future phase author has to re-discover it. Assumption propagation (dossier 02 family 14) and overconfidence (family 17) are two of the highest-impact failure families that survive even strong structural defenses; the Scientist is the structural fix. Putting it in CLAUDE.md makes it inheritable from the rule book; putting it in a referenced dossier makes it discoverable but not enforced.

**Counter-argument I am aware of:** CLAUDE.md is for orchestration-layer rules; the Scientist is a phase-tail, which is closer to phase execution than to orchestration. Adopting it as a CLAUDE.md rule conflates layers. The cleaner alternative: a new doc `docs/contracts/SCIENTIST.md` with the discipline; CLAUDE.md adds one line "every phase contract pins a phase-tail Scientist step per `docs/contracts/SCIENTIST.md`."

The shorter rule shape would also let the discipline evolve (e.g., add new artifact types) without bumping CLAUDE.md every time. Push back if you think the layered rule is right; confirm if the universal rule is right.

### Prompt 2 — Should the codebase context retrieval (Glob + Grep + LSP for M6) borrow patterns from `claude-code-main` (the publicly leaked Anthropic source), or is the legal/provenance posture too risky?

**My lean:** Borrow patterns with explicit "leaked-source" annotation in the templates table. Pattern-borrowing rules (no copy-paste, no code dependencies, audit and credit) apply unchanged. Naming the source as leaked is the auditable move; refusing to look at a publicly-available source is performative when the patterns it embodies (Glob+Grep+LSP+Hooks+MCP) are also available in Anthropic's own public docs and skills repo.

**Reasoning:** The alternative — designing Glob+Grep+LSP fresh from public Anthropic docs + the agent-skills + opencode templates — costs M6 weeks of work for capabilities Anthropic has already designed and debugged. The user's 1000-star ambition path benefits from shipping M6 sooner; weeks of clean-room re-design delays the spine demo without buying defensible IP (the patterns are not novel). Crediting the leaked template accurately preserves auditability. The bundle's templates dossier already names the leak provenance; the synthesis just makes the credit explicit.

**Counter-argument I am aware of:** Borrowing from a leak — even publicly available — signals a posture that may hurt the project's recruitability and community signal. The 1000-star ambition path may be hurt more by the provenance question than it is helped by time saved. Future contributors may decline to associate with a project that borrows from leaked corporate source, even if the borrow is patterns-only. The conservative move is clean-room: design from agent-skills + opencode + claude-code (the credited legitimate source) + Anthropic public docs. Weeks of work but no provenance asterisk.

I want a verdict on the pattern-borrowing posture, not on the legal question (which the user owns).

### Prompt 3 — Phase-tail Scientist (commits inside M6/M7) vs. dedicated M-Scientist milestone — which best preserves Option E?

**My lean:** Phase-tail, inside M6/M7. The HYPOTHESES.md / OPEN_QUESTIONS.md artifact contracts land in M6 commits (1–2 commits in M6's existing budget); phase-tail wiring lands per-phase in M6 (PLAN tail) and M7 (BUILD/VERIFY/REVIEW tails). Inserting M-Scientist between M6 and M7 adds a planning round, Codex briefing, and tag, which delays the spine demo at v0.7.0-alpha.0+.

**Reasoning:** Option E's whole motivation was "ship spine end-to-end with FakeProvider before adding more phases." The Scientist is a phase tail, not a phase; treating it as a phase deserves a separate milestone, but the bundle's design treats it as the discipline-after-each-phase, which is closer to a hook than to a milestone. Phase-tail commits also have lower planning overhead because they extend an existing milestone's Codex briefing rather than spawning a new one.

**Counter-argument I am aware of:** Phase-tail scope bleed risks under-shipping the Scientist. If M6 is already 10 commits and Scientist adds 2 more, pressure to skip or stub the harder bits — gate-blocking on overdue questions, retroactive falsification of prior hypotheses, the controller-executor-designer loop — is real. A dedicated M-Scientist forces the discipline to land complete; phase-tail risks it landing partial. The trade-off is "ship spine sooner with possibly-stubby Scientist" vs. "ship spine slightly later with Scientist done right."

The synthesis assumes the phase-tail bits that *can* land partial (controller-executor-designer's designer is W2 anyway; only artifact contracts and gate-blocking need to land in M6/M7) are clearly separable. Confirm or push back.

### Prompt 4 — Run-level budget computation: read cumulative spend from `events.jsonl` per-call, or maintain a running counter in `current.json`?

**My lean:** Read cumulative spend from `events.jsonl` per-call. The wrapper's pre-call short-lock already reads events; summing four counters (turns, providerCalls, tokensEstimate, optional dollar estimate) across that read is constant overhead per call. No new state means no new sync semantics to debug. Discipline: `events.jsonl` is the truth, `current.json` is the cache.

**Reasoning:** `current.json` is already a derived convenience state in the existing M3 model. Adding budget summary to it is consistent with the cache role, but every counter is one more thing to keep in sync. The existing wrapper discipline ("events.jsonl is truth") is hard-won; preserving it preserves auditability. As runs grow long (50+ provider calls, large transcripts), the per-call read cost grows but stays bounded by the typical event count per run; pre-emptive optimization is W3+ territory when concurrent runs land.

**Counter-argument I am aware of:** As `events.jsonl` grows past 1k events (long runs, transcripts in events), the per-call read cost is real (parse, validate, sum). Pre-emptively maintaining a running counter in `current.json` avoids a future migration when the read cost matters. The migration cost — adding a counter, ensuring it's consistent under crash recovery, handling the "counter exists but events disagree" case — is non-trivial; doing it from the start is cheaper than retrofitting under load.

Confirm if read-per-call is the right discipline trade-off; push back if running-counter is cheaper amortized.

---

## What I want from you

**Verdict** at the top — one of `proceed`, `proceed-with-modifications`, `debate-required`. Then mirror the M5 response format:

- **Where I agree** — sanity-check, don't rubber-stamp. If a lean is right but for a reason I missed, flag the better reason.
- **Where I disagree (with specific alternative)** — push back hard where I am wrong. Name the alternative concretely (file path, schema shape, commit-sequence change).
- **Decisions you must lock before merge** — what the user must answer before this synthesis becomes a milestone scope change. Number them.

If you flag rule 15 or rule 18 as wrong-shaped, give me the right shape. If you flag prompt 2 (the leak provenance) as a no, name what we lose by not borrowing and what the clean-room timeline looks like. If you flag prompt 3 (phase-tail vs. dedicated milestone) as wrong, name which Scientist bits are genuinely separable and which need to land together.

Constraints on your reply:
- Cite file paths and lines where they matter.
- Keep verdict-relevant claims to one paragraph each.
- If you flag something `debate-required`, name what evidence would resolve it.

Begin.
