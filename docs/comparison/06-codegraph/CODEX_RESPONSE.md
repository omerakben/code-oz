---
name: codex-response-06-codegraph
target: capture Codex's debate verdict for code-oz vs codegraph
companion: COMPARISON.md, CODEX_BRIEFING.md (this folder)
status: captured
codex-thread: 019e12ed-a84c-7092-959d-8d57bd323e19
codex-model: gpt-5.5 @ xhigh effort
top-level-verdict: accept-with-modifications
date: 2026-05-10
---

# Codex response — code-oz vs codegraph

## Top-level verdict

`accept-with-modifications`

## Numbered answers (verbatim, lightly formatted)

### 1. Category drift check

Your framing is right: codegraph is category-different, and importing its whole graph/index worldview would be category drift. The real overlap is not "MCP tools" or "SQLite search," it is whether code-oz personas need richer repo-context retrieval than `glob`/`grep`/`read`.

Do not say persona value is zero, though. PLAN, BUILD, and REVIEW can benefit from semantic traversal for questions like "what calls this," "what changes if this interface moves," and "which handler owns this route." That is still one overlap surface: `tool_use.repo_context`, not a new orchestrator category.

**Verdict:** Treat codegraph as one possible backend for a future semantic `repo_context` tool, not as an architectural template.

### 2. The B1 verdict

Pick **D**, with a modification: do not "defer indefinitely" as a vague parking lot. Close the active schema surface now, or mark `symbol` as reserved-but-not-permissionable until telemetry reopens it. **A tool name that appears in permissions/events but cannot run is contract debt.**

Second choice is **A** (native LSP), but only if the first demand signal is TypeScript/Python definition/reference lookup inside PLAN or BUILD. I would not pick C unless demand is broad-language semantic graph traversal and you are willing to spend a full milestone on MCP-client authority plus wrapping.

Reopen signal: real runs show repeated broad `repo_context_searched` churn in one task, selected paths hitting the cap, large result-token volume, and a later VERIFY/REVIEW failure attributable to missed call sites, definitions, or impact radius that `grep/read` did not surface.

**Verdict:** Choose D now, but convert it into an explicit contract cleanup plus telemetry-gated reopen condition.

### 3. Rule 20 vs rule 21 framing for B1

They are not redundant. Rule 20 applies directly if you choose B or C, and probably A if the LSP client becomes a durable capability domain. It says semantic graph or external MCP consumption consumes the milestone's authority budget.

Rule 21 is less literal here. `symbol` is not a parallel-provider surface. It is a richer instance of an existing permissioned tool family. But the rule 21 discipline still applies by analogy: do not add complexity unless you can measure the risk-reduction effect. The load-bearing argument for D is not "rule 21 forbids this." It is "rule 20 charges a real milestone cost, and current `events.jsonl` has not shown demand."

**Verdict:** Rule 20 is the hard constraint; rule 21 supplies the measurement standard, not the formal prohibition.

### 4. The B2 borrow

Accept B2, but start smaller than codegraph's full seven-test language battery. A big harness can absolutely rot if it tries to prove broad language coverage or LLM usefulness in CI.

Smallest viable shape: three deterministic evals under `bun run eval:repo_context`.

1. **Symbol/file discovery**: given a task prompt, `grep/glob/read` should surface expected files within cap.
2. **Usage discovery**: broad symbol query should return the expected call-site files without hitting max results.
3. **Budget pressure**: fixture should prove selected files and result bytes stay below caps while preserving recall.

Measure recall@k for expected files, result bytes/tokens, tool-call count, selected-path count, and truncation. Do not measure "LLM-perceived usefulness" in the default CI path. Keep any LLM-judged eval optional/manual.

**Verdict:** Borrow the methodology as a three-case deterministic repo-context quality harness, not the full codegraph verification matrix.

### 5. The B3 conditional

Wrapping codegraph through rule 18 would break some affordances, and that is the point. `projectPath` cannot mean arbitrary cross-project reads. `codegraph_explore`'s 35k-character output exceeds code-oz's 16KB per-result default. Codegraph's "complete source included, do not reread" style fights code-oz's manifest discipline unless normalized into paths, compact relationships, and capped snippets.

If C is chosen, do not expose eight codegraph tools directly. Expose one `symbol` shape inside `repo_context`: search, definition, callers/callees, maybe impact. Strip global side effects, reject roots outside permissions, emit `repo_context_searched`, and cap bytes. If that makes codegraph less magical, that is the compatibility cost.

**Verdict:** Wrapping is mandatory if C lands, but the amount of wrapping needed is evidence that C is not the right default.

### 6. The five rejections

- **B4** stays no-borrow unless native tree-sitter exists.
- **B5** should move from "no-borrow" to "deferred-with-trigger." Framework-aware route detection is not needed for today's file-level personas, but it becomes credible if W4 AUDIT adds routing/API-surface audit, endpoint-to-handler tracing, or web-app brownfield mapping.
- **B6** stays no-borrow for the authority substrate. A read-only derived index over `events.jsonl` could be reconsidered at v0.3 scale for operator UX, but not as a source of truth and not as a gate dependency.
- **B7** is anti-borrow.

**Verdict:** Reclassify B5 as deferred-with-trigger; keep B4/B6/B7 rejected for current architecture.

### 7. Authority boundary count

If B1 is B or C, it displaces the Researcher phase-tail first. Both compete for the same problem space: improving PLAN/source context. Researcher phase-tail is higher leverage right now because it can use existing `repo_context` tools, artifacts, and budgets without adding SQLite, tree-sitter, LSP daemons, or MCP-client authority.

Parallel builder candidates and multi-opponent debate should stay demand-gated under rule 21, but they target different risks: solution diversity and disagreement resolution. A `symbol` backend should not jump ahead of them unless actual repo-context telemetry shows missed semantic impact is the dominant failure mode.

**Verdict:** A semantic backend would consume the Researcher/context milestone budget, and it has not yet earned that displacement.

### 8. Anything missed

The strongest hostile critique is that **"reserved but unsupported" is already bad governance**. `symbol` appears in the permission and event vocabulary, while the runner rejects it. That is neither a clean deferral nor a usable feature. A reviewer will say the comparison is too forgiving because it treats the slot as harmless optionality.

The second critique is that codegraph's benchmark, 94 percent fewer tool calls and 77 percent faster exploration, measures exploration efficiency, not code-oz risk reduction. Your synthesis should refuse to translate speed into SDLC correctness without code-oz-native evidence: fewer missed files, fewer review findings, fewer verify restarts, or lower context waste.

**Verdict:** The missing action is contract cleanup now, plus a code-oz-native eval before any semantic backend decision.

---

## Synthesis (lead author response)

Codex caught one thing I missed and tightened three things I left loose. Lifting the modifications into a synthesis row.

### What Codex got right that COMPARISON.md was wrong about

**Q8 catch — `symbol` is already contract debt.** I framed the slot as "reserved, harmless optionality." Codex correctly named that as bad governance: a tool name that appears in `RepoContextToolName` (`src/tools/repo-context/types.ts`), in `permissions.ts` validation, and in error-type unions, while `runner.ts` rejects it with `"unsupported tool 'symbol'"`, is neither cleanly deferred nor usable. The "reserved" label hides the cost. Two cleanup choices, both are improvements over today:

- **Option D-strict (close the slot)**: remove `'symbol'` from `RepoContextToolName`; remove `symbol` from the `tools[]` enum in `AgentPermissions`; remove the unsupported-tool branch from `runner.ts`; remove the mention from `REPO_CONTEXT.md` § "The three tools" subsection (rename it). Recoverable via M-x revert if telemetry reopens demand.
- **Option D-reserved (explicit reservation)**: keep the type member but mark it `'symbol' /* RESERVED — not permissionable in v0.x */` with a doc anchor; runner returns a typed `tool_unavailable` error (consistent with the existing doctor probe pattern), not a generic "unsupported"; permission-validation rejects `'symbol'` in `tools[]` at config-load time so it never reaches runtime. This is contract-explicit and telemetry-friendly.

**Lead author lean**: Option D-reserved. It preserves the schema slot for the telemetry-gated reopen Codex named in Q2, while moving the cost of the slot from runtime confusion to a single visible reservation marker. The cleanup is a v0.2 W3 follow-up item, not a milestone of its own — it touches one type union, one validator, and one doc paragraph.

### Modifications I'm taking

| ID | Original | After Codex | Action |
|---|---|---|---|
| **B1** | "Defer indefinitely (Option D)" | "Option D-reserved: contract cleanup + telemetry-gated reopen condition" | New v0.2 W3 follow-up item: tighten reservation; document `events.jsonl` reopen signal |
| **B2** | "Borrow the 7-test methodology" | "Three-case deterministic harness only — discovery + usage + budget pressure; recall@k + bytes + tool-call counts; no LLM-judged path in default CI" | v0.2 W3 polish item with explicit fixture-set bound |
| **B3** | "Conditional on B1=C" | "If C ever lands, expose one `symbol` shape (search + definition + callers/callees + impact), wrap to one `repo_context_searched` event per call, cap to `maxBytesPerResult`; do NOT pass codegraph's 8 tools through" | Spec note added to ROADMAP for the conditional path |
| **B5** | "No-borrow today" | "Deferred-with-trigger: routing/API-surface audit persona" | Reclassify in COMPARISON.md borrow ranking |
| **B4, B6, B7** | "No-borrow / Anti-borrow" | Same | No change |

### What stays unchanged

- **Category verdict**: code-oz is ahead on category. Codegraph is a code-intelligence indexer for chat agents, not an SDLC orchestrator. The 90 percent of codegraph's surface that is structurally orthogonal stays orthogonal.
- **B1 base direction**: Option D, not A/B/C. Codex confirms the rule-20 cost is the load-bearing reason and `events.jsonl` has not shown demand.
- **The five hard authorities** (rules 13, 18, 19, 20, 21) hold; codegraph cannot be adopted without preserving them through wrapping if Option C is ever chosen.
- **Cross-model peer review process**: this debate is itself the discipline that produced the contract-debt catch in Q8. Without it, Option D-reserved would not have replaced Option D-vague.

### Reopen-the-slot telemetry signal (locked from Codex Q2)

Reopen the `symbol` slot decision when `events.jsonl` shows, on the same task or run:

1. Repeated broad `repo_context_searched` churn (≥ 5 invocations within one phase against the same root subset), AND
2. Selected paths hitting `maxFilesForNextManifest=20` cap, AND
3. Cumulative result-token volume > 200k for a single phase, AND
4. A later VERIFY/REVIEW failure with a fingerprint attributable to missed call sites, missed definitions, or missed impact radius that grep/read did not surface.

If all four trigger together on at least three runs across at least two repos, reopen B1 with current empirical evidence in hand. The four-condition AND is intentional — any one of them firing alone is noise. The fourth condition is the load-bearing one (it ties the symptom to actual SDLC outcome failure, not just retrieval inefficiency).

### Borrow ranking — final

| ID | Borrow | Final verdict | Milestone target |
|---|---|---|---|
| **B1** | Symbol tool backend | **Option D-reserved**: contract cleanup + telemetry-gated reopen | v0.2 W3 follow-up (cleanup); reopen on telemetry |
| **B2** | Tool-quality eval harness | **Borrow** — 3-case deterministic only | v0.2 W3 polish |
| **B3** | MCP-consume codegraph | **No-borrow today**; wrapping spec recorded if reopened as C | conditional |
| **B4** | WASM worker recycling | No-borrow | n/a |
| **B5** | Framework-aware route detection | **Deferred-with-trigger**: routing/API audit persona | reclassified |
| **B6** | SQLite + FTS5 substrate | No-borrow (architecture-lock) | n/a |
| **B7** | Interactive global-config installer | Anti-borrow | n/a |

### Final decision

**YES, code-oz is ahead on category, with two action-bearing borrows (B1 contract cleanup + B2 eval harness) and one reclassified deferred-with-trigger (B5).** The codegraph comparison surfaced one piece of contract debt that today's architecture would not have caught without a category-different reviewer. That single catch (Q8) justifies the comparison session.

## References

- Codex thread: `019e12ed-a84c-7092-959d-8d57bd323e19`
- Codex model: `gpt-5.5` at `xhigh` reasoning effort
- COMPARISON.md (this folder)
- CODEX_BRIEFING.md (this folder)
- `docs/contracts/REPO_CONTEXT.md`
- `CLAUDE.md` rules 13, 18, 19, 20, 21
