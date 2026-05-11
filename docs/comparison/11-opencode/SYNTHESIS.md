---
session: 11-opencode
date: 2026-05-10
inputs: COMPARISON.md (Claude verdict) + CODEX_RESPONSE.md (Codex pressure-test, fix-first)
outcome: revised borrow ranking; two block-push findings closed in this doc; B2 graduates to own milestone slot; B3 design pre-loaded, implementation demand-gated; B1/B4/B5 unchanged; N1/N3 stay rejected with empirical guardrails; product-axis assertion re-anchored on governance machinery
status: closed
---

# Synthesis — opencode comparison (session 11)

## What we did

Claude wrote a head-to-head comparison and recommended **selective borrow** with five candidates (B1–B5) and three no-borrows (N1–N3). Codex pressure-tested the verdict and returned **fix-first** with two block-push findings, four lower-severity refinements, and two framing corrections. Per the project's cross-model peer review rule ("Codex's verdict is data, not authority"), we weigh the disagreements and ship the revised plan below. We do not push the plan as written.

## Where Codex was right (and I update the plan)

### 1. B2 wildcard permissions — graduate to its own milestone, deny-dominant only

I had B2 as a sub-milestone refinement. Codex caught the load-bearing asymmetry:

- opencode's `evaluate.ts` uses `findLast` in an **ask-default** world. Last-match-wins is safe there because the default is interactive intervention, not silent allow.
- code-oz operates in a **deny-default** world (rule 9). Last-match-wins lets a permissive late rule override an earlier denial silently. That's the wrong direction for an audit-friendly intersection model.

**Revised position.** B2 becomes its own milestone slot. Semantics:

1. Intersection guarantee preserved: request roots ⊆ agent.roots ⊆ permissions.read.
2. Inside the intersection, allow patterns expand the *expression* of allowed paths.
3. **Deny patterns override allow patterns regardless of declaration order.** Any matching deny denies.
4. No `**` outside the leaf segment.
5. New events: `permission_pattern_evaluated` with the matched rule and final action.

This is now an authority-bearing change (rule 20). It earns its own milestone, not a refinement commit. Slot is open; not pre-locked.

### 2. B3 MCP trust boundary — write the design now, implement demand-gated

I had `tool_use.mcp` denying network by default. Codex caught that opencode's runtime `Object.entries(config)` startup loads MCP servers with unbounded concurrency (`packages/opencode/src/mcp/index.ts:524-560`) — that pattern is structurally hostile to rule 13 (privacy by default).

**Revised position.** Write `docs/contracts/MCP_TRUST_BOUNDARY.md` as part of the next contract pass, *before* any implementation milestone. Required surface:

- **No startup auto-connect.** Servers connect lazily on first tool invocation.
- **Per-server allowlist.** A server outside the allowlist returns `mcp_server_not_allowed` and never spawns / connects.
- **Local servers.** Command path must be in an allowlist of approved binaries; environment vars are redacted from event log; optional sha256 hash pinning.
- **Remote servers.** URL host must be in an allowlist; headers are redacted; OAuth tokens are never logged.
- **Audit events.** `mcp_server_started` (server id + connect time + redacted command/url), `mcp_tool_called` (tool name + arg digest, no payload), `mcp_server_failed` (typed error class).
- **No silent recursive context.** Per rule 18, MCP tool results enter the *next* invocation's `ProviderRequest.files` (or its MCP-equivalent), never the search invocation's hidden context.

Implementation stays demand-gated: the design ships now so we can budget for it, but the milestone slot opens only when a demand checkpoint asks for Researcher-tier capabilities.

### 3. N1 Effect rejection — keep, but add empirical guardrails

Codex agreed Effect rejection but wanted backing beyond "not visible in our 3108 tests." Accept the experiment:

Add three tests using a new `SlowProvider` / `HangProvider`:

- **Panel quorum under timeout.** A slow provider must trigger panel timeout without writing a partial canonical REVIEW.md.
- **Debate cancellation under interrupt.** Simulated `^C` mid-debate must leave no orphan `.review.lock`.
- **Nested `requestDebate()` collision.** A recursion attempt must return a typed `NEEDS_INTERVENTION` (`debate_recursion_blocked`), not deadlock.

If those tests need invasive scaffolding, revisit *structured cancellation* (not necessarily Effect) before assuming the gap doesn't exist. This is a single-commit test addition, no new authority.

### 4. B1 recorded fixtures — accept with explicit metrics

Codex agreed the borrow but wanted measurement. Accept the metric set:

- **Request-body hash stability.** Hash mismatch on replay = test fails. Forces explicit re-record.
- **Response schema coverage.** Track which JSON paths the recorded fixture exercises against the provider's documented schema.
- **Typed error coverage.** Record one fixture per error class in `src/providers/errors.ts` (B5).
- **Live-vs-replay parity.** One opt-in run per Ring confirms recorded shape matches live shape.
- **# of live calls removed from offline CI.** A baseline metric for the borrow's leverage.
- **Fixture age.** Warn at 90 days, block CI at 180 days (forces re-record cadence).

### 5. N3 SQLite — keep rejection, document threshold for secondary index

Codex agreed JSONL stays canonical. Document explicit thresholds in the M19+ telemetry roadmap row: rebuildable secondary index considered when **any** of:

- `events.jsonl` exceeds 10 MB on a single run, OR
- a single run exceeds 50k events, OR
- p95 budget/panel summary exceeds 50 ms on local hardware.

Permission decisions are **never** cached in the secondary index. JSONL is the source of truth.

### 6. Q7 family lineage — harden unknown lineage in M14+

Codex's catch: the OpenRouter / aggregator failure mode (hidden upstream lineage) is already in `docs/design/ROADMAP.md:387` as a future concern. Action item, addable now:

- New event `loader_provider_lineage_unknown` distinct from `loader_provider_loaded`.
- Test: in M14 panel verdict, a voter with `providerFamily === 'unknown'` cannot count toward quorum even if the eligibility check is otherwise satisfied. (Codex confirmed this is already true in `src/phases/review-panel-verdict.ts:158-172`; the missing piece is making that contract testable end-to-end with a synthetic unknown-lineage provider.)

### 7. Q1 framing — trust-boundary incompatibility, not just product-category

Accept Codex's refinement. The decisive reason we don't fork opencode's `packages/llm/` isn't that opencode is a chat assistant and code-oz is an SDLC runtime (true but soft). The decisive reason is:

> code-oz's auth split — "code-oz never reads or transmits OAuth tokens directly" for subscription-first adapters (`docs/references/provider-contract.md:14`) — is structurally incompatible with opencode's direct-SDK auth model. Forking would mean tearing out the trust boundary.

This sharpens the COMPARISON.md framing without changing the verdict.

### 8. Q8 framing — moat is governance machinery, not pipeline labels

Accept Codex's refinement. The SDLC pipeline (DEFINE → SHIP, file gates, panel review, debate) is *copyable* in a milestone by anyone willing to spend the time. The durable moat is the **governance machinery**:

- Cross-model planning + review (rule of cross-model peer review).
- Rule 20 (one authority per milestone, empirically validated by the M16 C9 incident — 8 production bugs that survived per-commit review under a bundled authority axis).
- Rule 21 (no parallel-provider surface without measurable risk reduction).
- Accumulated regression fixtures (3108 tests, including the 12 production bugs caught at M16 closure).

The pipeline UI is the surface; the operating discipline is the substrate. A competitor copying labels still has to build the discipline. That's the moat, and it's load-bearing on the cross-model peer review rule itself.

## Where Codex was off (or where I push back)

None. Codex's six findings are all accepted as written or as refinements that strengthen the original verdict. This is unusual — typically the synthesis pushes back on at least one finding. In this case, all of Codex's catches are first-principles correct under code-oz's stated rules, and the original COMPARISON.md was under-specifying rather than wrong.

## Revised borrow ranking

| ID | Borrow | Original status | Revised status | Slot |
|---|---|---|---|---|
| B1 | Recorded HTTP fixtures | sub-milestone refinement | sub-milestone refinement, with explicit metrics | Before PE-2 |
| B2 | Wildcard permission expressions | sub-milestone refinement | **own milestone slot, deny-dominant only** | Open, not pre-locked |
| B3 | MCP consumer | demand-gated milestone | demand-gated milestone, **with trust-boundary design pre-loaded** | Design now in `docs/contracts/MCP_TRUST_BOUNDARY.md`; implementation post-demand-checkpoint |
| B4 | Install ergonomics | inside W3 install milestone | unchanged | W3 |
| B5 | Provider-error classification table | sub-milestone refinement | unchanged, but co-required for B1 typed-error coverage | Co-shipped with B1 |

## Revised no-borrow set

| ID | No-borrow | Original status | Revised status |
|---|---|---|---|
| N1 | Effect-typed orchestration | rejected | rejected, **with SlowProvider/HangProvider stress tests added** to back the rejection empirically |
| N2 | Plugin system | rejected | unchanged |
| N3 | SQLite-persisted session + permission cache | rejected | rejected for the spine, **with explicit secondary-index thresholds documented for M19+ telemetry** |

## Fix-first actions (before any borrow lands)

These are the block-push items from Codex. They land in this order:

1. **Write `docs/contracts/MCP_TRUST_BOUNDARY.md`** with the surface listed in §2 above. No implementation. (Estimated: 1 commit, design only.)
2. **Open a milestone-slot row in `docs/design/ROADMAP.md`** for B2 (deny-dominant wildcard permissions), with rule-20 justification ("a wildcard matcher that changes allow/deny semantics counts as a new authority surface"). Slot stays open until prioritized.
3. **Update `COMPARISON.md` framing** for Q1 (trust-boundary incompatibility) and Q8 (governance machinery as moat). Already captured in this synthesis; can also be reflected in `README.md` decision column when the index is updated.

The fix-soon items (N1 stress tests, B1 metrics, JSONL thresholds, family lineage hardening) are tracked as backlog items in this synthesis and slotted into the next milestone that touches the relevant surface.

## Recording in autoMemory

The session adds two memory candidates worth saving for future comparison sessions and milestone planning:

- **Pattern memory.** "When borrowing a permission/authorization mechanic from a different-default-stance project (ask-default vs deny-default), check whether the matcher's tie-break semantics survive the default flip. opencode's last-match-wins is safe under ask-default; it's a foot-gun under deny-default." This generalizes beyond opencode and feeds future borrows from `claude-code` (also ask-default) and `pi-mono`.
- **Framing memory.** "The product moat for code-oz is the governance machinery (rules 20/21, cross-model peer review, accumulated regression fixtures), not the SDLC pipeline labels. Defend the moat by defending the rules, not by defending the pipeline." This re-anchors how we describe the project in any external-facing brief.

These should land as `feedback_*.md` files in autoMemory after the synthesis is closed (separate from this comparison commit, since memory writes are session-scoped).

## Final verdict — synthesis row for the index

**11 | opencode | 2026-05-10 | YES, with selective borrows (Codex `fix-first`; B2 graduates to own milestone slot, B3 trust-boundary design pre-loaded; see SYNTHESIS) | [11-opencode/](11-opencode/)**
