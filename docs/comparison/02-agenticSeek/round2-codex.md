# Round 2 — Codex delta pass

## Verdict: not-converged

### Delta D-CODEX-1: Remove the surviving "ahead on every overlap" overclaim
- **Where:** `## 0. TL;DR`, opening paragraph
- **Current text (verbatim):** **Verdict: YES — code-oz is the right runtime for its category, and is structurally ahead of agenticSeek on every directly-overlapping mechanic when measured under the repo-native SDLC runtime frame** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`).
- **Proposed text (verbatim):** **Verdict: YES — code-oz is the right runtime for its category and is structurally stronger on the SDLC authority mechanics that overlap with agenticSeek** (`docs/product/AI_SOFTWARE_COMPANY_THESIS.md`). agenticSeek is still ahead in shipped MCP discovery, local-provider support, and personal-assistant UX surfaces; those are not category-defining for code-oz, but they should not be described as areas where code-oz is already ahead.
- **Why:** Round 1 pushed back on conflating architecture quality with shipped user capability. The synthesis says that was corrected, but the TL;DR still says "every directly-overlapping mechanic" even though the matrix itself marks MCP discovery and routing as agenticSeek strengths, and B4 exists because local-provider support is not yet shipped in code-oz.
- **Severity:** block-next-round

### Delta D-CODEX-2: Replace the brittle score line
- **Where:** `## 3. Direct overlap matrix`, score paragraph after the table
- **Current text (verbatim):** Score: code-oz ahead on 11 of 13 directly-overlapping rows; tied or behind on 2 (intent routing, MCP breadth); 4 rows are off-mission.
- **Proposed text (verbatim):** Score: under the SDLC-runtime category frame, code-oz is stronger on the core authority mechanics: gates, cross-family review, worktree isolation, audit state, resume, brownfield handling, and budgets. agenticSeek is ahead in shipped MCP discovery and local-provider availability; browser autonomy, voice, and chat UI remain off-category for v0.1 rather than scoreable SDLC gaps.
- **Why:** The current line is arithmetically and conceptually fragile: the table has 17 rows, local-first was moved out of off-mission into B4, and planned/in-flight code-oz surfaces should not be counted as shipped capability. The replacement keeps the useful conclusion without pretending the matrix is a clean numerical scoreboard.
- **Severity:** block-next-round

### Delta D-CODEX-3: Align B1 with the narrowed bad-plan telemetry finding
- **Where:** `## 5. Borrow candidates` → `### B1. Lightweight dynamic re-planning telemetry inside the existing VERIFY → BUILD restart cycle`
- **Current text (verbatim):** **Borrow:** at VERIFY-fail, log a `plan_revision_proposed` event with `(reason, proposed_tail_diff)` *before* deciding restart vs. NEEDS_INTERVENTION. This is telemetry-only in v1 and turns into authority later.
- **Proposed text (verbatim):** **Borrow:** at VERIFY-fail, log telemetry tied to `(failure_class, task_id, attempt_count, repeat_failure_flag)` inside the existing VERIFY-fail / restart-on-fail surface. Do not emit proposed tail diffs, do not create a gate artifact, and do not grant plan-mutation authority.
- **Why:** The synthesis correctly says the real opening is evidence that repeated restarts indicate a bad plan, not proposed plan mutation. Keeping `plan_revision_proposed` and `proposed_tail_diff` preserves the exact authority creep Round 1 rejected.
- **Severity:** block-next-round

### Delta D-CODEX-4: Remove `suggested_path` from B2
- **Where:** `## 5. Borrow candidates` → `### B2. Intent / complexity classifier as a routing input — not a phase replacement`
- **Current text (verbatim):** **Borrow:** an *advisory* complexity classifier at DEFINE that surfaces a `suggested_path: full | abbreviated | direct` hint in DEFINE artifacts. Never authoritative — operator decides. Path-collapsing remains a phase-graph decision, not a classifier decision.
- **Proposed text (verbatim):** **Borrow:** an *advisory* DEFINE risk / effort hint that records expected complexity, likely tool needs, and operator attention points. It must not emit `suggested_path`, imply abbreviated/direct flow, or affect whether DEFINE, PLAN, VERIFY, or REVIEW runs.
- **Why:** This is the clearest surviving unfixed Round 1 issue. The final ranking table says `suggested_path` was dropped, but the B2 body still ships it. That trains operators toward phase skipping before the classifier has earned any authority under Rule 20 or Rule 21.
- **Severity:** block-next-round

### Delta D-CODEX-5: Strengthen B3 as tool-adoption authority, not repo-context scope
- **Where:** `## 5. Borrow candidates` → `### B3. MCP-tool discovery sub-agent`
- **Current text (verbatim):** **Borrow:** a `tool_use.mcp_finder` sub-scope that lets a permitted role (Researcher / Builder) propose adding an MCP server during PLAN. Adoption must go through a gate write so the operator approves the new tool surface. Network access denied for the finder itself; install path goes through an explicit operator step.
- **Proposed text (verbatim):** **Borrow:** a distinct MCP tool-adoption authority, not an extension of `tool_use.repo_context`. A permitted shipped role may propose a pinned MCP server only with identity, version, declared capabilities, file-root access, network access, env-var/secret access, and re-approval semantics captured in the artifact; installation remains an explicit operator step.
- **Why:** The current wording still analogizes B3 to Rule 18 repo-context search and names Researcher, which is deferred. MCP servers are active tool surfaces, so the material risk is post-approval drift or compromise under a trusted name. The proposed text matches the synthesis without granting a new role or implementation slot.
- **Severity:** block-next-round

### Delta D-CODEX-6: Retire stale pre-synthesis questions
- **Where:** `## 7. Open questions for Codex`, opening paragraph
- **Current text (verbatim):** These are the questions for the Codex debate round. Codex should pressure-test the verdict, especially the B1–B4 dispositions.
- **Proposed text (verbatim):** The Codex round-1 questions are answered in §8. The final comparison should not retain them as active open questions; remaining uncertainty is limited to Rule 20 / Rule 21 promotion criteria for B1-B4.
- **Why:** Section 7 still presents resolved debate prompts as active questions, including stale `plan_revision_proposed` and `suggested_path` framing. That makes the post-round-1 document internally inconsistent and forces future readers to re-litigate issues the synthesis already closed.
- **Severity:** nit
