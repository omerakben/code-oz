# Round 2 — Opus delta pass

## Verdict: not-converged

The Codex round closed the load-bearing strategic disagreements (verdict scope, privacy framing, B3 risk model, B2 evidence, denylist kill, B1 narrowing). What remains is internal inconsistency between the synthesis section and the rest of the doc — the table-of-record disagrees with the narrative on B3's rank conditionality, the B3 body section under-specifies the trust boundary that the synthesis demanded, the TL;DR claim contradicts the row 12 / row 13 score-line in section 3, and two source-fidelity bugs (one factual, one verbatim quote) survived because Codex was reading the synthesis prompt, not the body. These are six precise deltas; none are cosmetic.

### Delta D-OPUS-1: B3 rank-1 promotion is unconditional in the table but conditional in the narrative

- **Where:** § 8 "Final ranked borrow list" table, row 1.
- **Current text (verbatim):** `1 | **B3 — MCP finder sub-scope** *(promoted from rank 3)* | Demand-gated. Real new tool-adoption authority with identity / version / capability / file-root / network / env-var / re-approval semantics. Off the spine; uses its own gate.`
- **Proposed text (verbatim):** `1 (conditional) | **B3 — MCP finder sub-scope** *(promoted from rank 3, conditional on MCP-gap evidence)* | Demand-gated. Promotion to rank 1 fires only when repeat `NEEDS_INTERVENTION` events caused by missing MCP tools cross a measurement threshold; until then B3 ranks below B1 telemetry. Real new tool-adoption authority with identity / version / capability / file-root / network / env-var / re-approval semantics. Off the spine; uses its own gate.`
- **Why:** Codex round-1 § 4 wrote "Promote to rank 1 among the borrows *if* missing MCP tools are repeatedly causing interventions" — the conditional is load-bearing. The synthesis bullet (§ 8 item 3) preserves the `if`; the final ranked list drops it and reads as a granted ranking. Future ROADMAP readers will reach for the table, not the bullet, so the table must carry the same condition. This also matches the §5 B3 disposition line ("measurable benefit *only when* an MCP-tool gap is repeatedly hitting `NEEDS_INTERVENTION`").
- **Severity:** block-next-round

### Delta D-OPUS-2: § 5 B3 body still frames trust boundary as install-time only

- **Where:** § 5, B3 paragraph beginning "Borrow:".
- **Current text (verbatim):** `Borrow: a `tool_use.mcp_finder` sub-scope that lets a permitted role (Researcher / Builder) propose adding an MCP server during PLAN. Adoption must go through a gate write so the operator approves the new tool surface. Network access denied for the finder itself; install path goes through an explicit operator step.`
- **Proposed text (verbatim):** `Borrow: a `tool_use.mcp_finder` sub-scope that lets a permitted role (Researcher / Builder) propose adding an MCP server during PLAN. Adoption must go through a gate write capturing server identity, pinned version, declared capability set, allowed file-roots, network surface, env-var access, and a re-approval requirement on any of those changing. Operator approval at install time is necessary but not sufficient — the harder failure (post-approval drift via server update, transitive tool addition, or registry compromise) is what the contract must cover. Network access denied for the finder tool itself; install path goes through an explicit operator step.`
- **Why:** Codex § 4 named the post-approval-drift threat (server updates, drifts, compromises gaining new abilities under a trusted name) as the *primary* failure mode, and the synthesis table captures it. The B3 body section — the section a person designing the sub-scope will read first — still describes only install-time approval. A reader who only consumes § 5 will under-build the trust boundary. The body and the synthesis must say the same thing.
- **Severity:** block-next-round

### Delta D-OPUS-3: Row 5 mis-frames re-planning trigger as "on failure"

- **Where:** § 3 direct overlap matrix, row 5 ("Re-planning after failure"), "agenticSeek" cell.
- **Current text (verbatim):** `Planner re-invoked after each step; rewrites tail of JSON plan when "failure" detected`
- **Proposed text (verbatim):** `Planner re-invoked after each step (success or failure) with `(goal, prior_results, this_step_result, success_flag)`; the LLM decides whether to rewrite the tail or emit `NO_UPDATE`. The success-only short-circuit is present in source but commented out, so re-planning is triggered every step.`
- **Why:** `planner_agent.py` line 299 calls `update_plan` unconditionally inside the step loop, and lines 206–207 contain a commented-out `if success: return agents_tasks` showing the "only on failure" path was deliberately abandoned. The current row text says re-planning fires only on failure, which materially understates how often the planner's own JSON gets rewritten and weakens the §8 item 6 framing that "agenticSeek conflates decomposition failure with implementation failure." The conflation is the *whole point* of B1; the row must describe the actual trigger pattern for the synthesis to land.
- **Severity:** block-next-round

### Delta D-OPUS-4: TL;DR overstates "ahead on every directly-overlapping mechanic"

- **Where:** § 0 TL;DR, sentence 1.
- **Current text (verbatim):** `**Verdict: YES — code-oz is the right runtime for its category, and is structurally ahead of agenticSeek on every directly-overlapping mechanic when measured under the repo-native SDLC runtime frame** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`).`
- **Proposed text (verbatim):** `**Verdict: YES — code-oz is the right runtime for its category, and is structurally ahead of agenticSeek on every directly-overlapping mechanic that the SDLC runtime frame considers in-scope** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`). Two overlap rows — MCP discovery breadth (row 12) and per-turn intent routing (row 13) — show agenticSeek ahead on mechanism; the SDLC frame moves both to off-spine borrows or off-mission, which is a category answer, not a "we already win" answer.`
- **Why:** § 3's own row 12 says "agenticSeek ahead in shipped breadth" and row 13 says "agenticSeek ahead in mechanism." § 3's score line acknowledges "tied or behind on 2 (intent routing, MCP breadth)." So "ahead on every directly-overlapping mechanic" contradicts the matrix two rows below it. Codex round-1 § 1 already pushed back on the broader "ahead on every axis" framing; the TL;DR was edited to add the SDLC qualifier but the "every" claim survived inside the qualifier. The TL;DR should match the score line.
- **Severity:** block-next-round

### Delta D-OPUS-5: Row 7 "bypassable" is single-directional; the bug is over- AND under-inclusive

- **Where:** § 3 direct overlap matrix, row 7 ("Safety / sandboxing"), "Verdict" cell.
- **Current text (verbatim):** `**code-oz ahead** — agenticSeek's substring match is bypassable (e.g. `rm` matches `warm`)`
- **Proposed text (verbatim):** `**code-oz ahead** — agenticSeek's substring match is brittle in both directions: it false-positives on benign substrings (`rm` inside `warm`, `git` blocking all git use) and misses shell-level evasions; the example `rm`/`warm` collision is an over-block, not a bypass.`
- **Why:** `rm` appearing inside `warm` causes a *false positive* that blocks `warm`, not a bypass — the substring check returns true and the command is rejected. Section 6's row already says "brittle in both directions," so the row 7 framing contradicts the off-mission table. Codex round-1 § 7 used both directions ("false-positives on substrings, misses shell-level evasions"); the row should mirror that. The example is also load-bearing for B5 (denylist as test corpus), so getting the directionality right matters for downstream readers reusing this characterization.
- **Severity:** nit

### Delta D-OPUS-6: B1 verbatim quote drops a word

- **Where:** § 5 B1, "Pattern:" line.
- **Current text (verbatim):** `bounded ("Make the plan the same length as the original or with only one additional step. Do not change past tasks.").`
- **Proposed text (verbatim):** `bounded ("Make the plan the same length as the original one or with only one additional step. Do not change past tasks.").`
- **Why:** `planner_agent.py` line 221–222 reads "Make the plan the same length as the original *one* or with only one additional step. Do not change past tasks." The current doc drops the word "one." The text is presented in quotation marks as a verbatim borrow source; verbatim quotes from a GPL-3.0 file are also the place to be exact, both for accuracy and to prevent any drift toward "this is paraphrase, we can edit it" interpretation later.
- **Severity:** nit

## Lower-priority observations (not promoted to deltas)

- **§ 1, last bullet, "side-project" framing**: README.md upstream calls it "zero roadmap and zero funding"; the doc captures this. No edit needed but it is the strongest evidence that agenticSeek's mechanics are not engineered to SDLC-runtime quality bars and is worth keeping in the differentiation case if any reader pushes back on the "off-mission" verdicts.
- **§ 5 B2 "Pattern" claim**: "(LOW complexity bypasses planning entirely)" is a behavior claim about agenticSeek's runtime that I did not directly verify in the first 200 lines of `router.py` (the complexity classifier is loaded but the dispatch decision lives further down). Codex did not contest the claim and the few-shot data clearly intends LOW=skip-planner, so this is likely accurate; flagging only as a sourcing observation.
- **§ 3 row 8 "auditability" cell**: Could mention that agenticSeek's LED summarizer is a *lossy* representation of conversation history (vs. code-oz's append-only `events.jsonl`), which sharpens the "code-oz ahead on auditability" claim. Not load-bearing enough to promote.
