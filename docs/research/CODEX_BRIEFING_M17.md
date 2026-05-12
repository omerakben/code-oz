# Briefing — M17 AUDIT runtime (R0 pre-design round)

**Brief date:** 2026-05-12
**Author:** Claude (Opus 4.7, 1M context, xhigh effort)
**Codex config:** `gpt-5.5` xhigh, sandbox: read-only, approval_policy: never
**Trigger:** CLAUDE.md cross-model peer review rule #1 — planning-convergence debate before any code lands; M14-M16 cadence parity for M17
**Branch base:** `main` at `a1d9563` (Phase 1.1 npm publish + Phase 1.6 brownfield detection prerequisite both landed locally)
**Parent plan:** `docs/planning/1000_STAR_PLAN.md` (Codex R0-revision-3-cleanup-2 `approve`, thread `019e1d7a`)

## Trigger and ground

`@tuel/code-oz@0.20.0-alpha.0` shipped to npm earlier today. The 1000-star plan's locked autonomy mode unlocked the Ozzy-approval gate; Phase 1.6 (brownfield profile detection prerequisite) landed at commit `066724e` with `+4` tests (3362 → 3366). With Phase 1.6 closed, the fresh-run path now propagates `config.profile` end-to-end: a brownfield repo correctly initializes a run with `profile: 'brownfield'`, which means `currentPhase` starts at `audit` per `BROWNFIELD_SEQUENCE` at `src/state/schemas.ts:22`.

But the active-run dispatcher in `src/commands/run.ts` has no `audit` branch (lines 942-1140). The phase taxonomy at `src/state/schemas.ts:6` includes `audit`; the canonical-artifact map at `src/state/schemas.ts:35` declares `audit → AUDIT.md`; `BROWNFIELD_SEQUENCE` lists `audit → plan → build → verify → review → ship` at `src/state/schemas.ts:21-28`. The state machine knows AUDIT. The CLI doesn't. The fresh-run path at `run.ts:309-368` ALWAYS calls `runDefine` immediately after `initRun`, so even a brownfield-configured run currently routes through BA.

M17's job: ship the AUDIT runtime as a real milestone matching M14/M15/M16 cadence (pre-design debate + R1 + R2 review rounds, no tech debt at close). Single rule-20 authority: **AUDIT runtime + dispatch + persona.** Profile detection is already in (Phase 1.6); brownfield CLI e2e is the consumer-first RED test (rule 22).

## Why this slipped past M7-M16

Every milestone M7-M16 extended the runtime for the greenfield sequence (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP) with single-axis discipline (rule 20). 3366 tests pass; the greenfield CLI e2e drives DEFINE → SHIP end-to-end. But none of those milestones touched the brownfield entry point, because brownfield profile-detection was silently overridden by a hardcoded `'greenfield'` literal at `run.ts:311` until Phase 1.6 just removed it. Two lies were canceling each other out: the detector said brownfield when source files were present, and the dispatcher hardcoded greenfield. Phase 1.6 fixed both. M17 ships the runtime that brownfield runs now actually flow into.

## Gap analysis — what's missing for AUDIT

### Gap 1 — `dispatchAudit` does not exist in `src/commands/run.ts`

The active-run dispatcher at `run.ts:942-1140` has branches for `plan`, `build`, `verify`, `review` and a fallback at line 1134:

```ts
process.stderr.write(`code-oz run: an active run is in progress at phase ${phase}...`)
```

A run that lands at `currentPhase: 'audit'` hits the fallback. The fresh-run path at `run.ts:309-368` doesn't branch on profile at all — it goes directly to `runDefine` after `initRun`. Both paths need to be M17-aware: the active-run dispatcher needs an `audit` branch, and the fresh-run path needs to route to `dispatchAudit` instead of `runDefine` when `config.profile === 'brownfield'`.

### Gap 2 — `src/phases/audit.ts` does not exist

The greenfield phases each have their own module under `src/phases/`:

```
src/phases/
  define.ts    # runDefine — BA-driven SPEC extraction
  plan.ts      # runPlan — Lead-driven PLAN.md construction
  build.ts     # runBuild — Builder-driven patches
  verify.ts   # runVerify — Verifier-driven validation
  review.ts    # runReview — Reviewer-driven REVIEW.md
```

No `audit.ts`. The Auditor persona has no runtime entry point that composes the system prompt, invokes the provider, parses the output, and writes `AUDIT.md` + `gate_required(audit)`.

### Gap 3 — No `auditor.md` persona in bundled defaults

`src/agents/bundled-defaults.ts:1-21` registers six personas: `ba`, `lead`, `builder`, `verifier`, `reviewer`, `scientist`. No `auditor`. `tests/agents-defaults.test.ts:51-56` asserts AUDIT has no default persona — that's the explicit "deferred to M17" marker landed in earlier work.

The auditor persona body MUST be hand-authored per rule 16 (no LLM-generated persona prompts). The universal-rules import (`src/prompts/universal-rules.md`) is mechanical text concatenation only. Codex may review for rule violations but must NOT draft the persona body.

### Gap 4 — `AUDIT.md` schema + parser do not exist

`docs/references/file-based-gates.md` declares `audit → AUDIT.md` as canonical, but there's no schema module under `src/artifacts/` and no parser. The greenfield phases have `src/artifacts/spec.ts`, `src/artifacts/plan.ts`, etc. with parser + schema validator + serializer trios. AUDIT needs the same shape:

- Schema validator rejects malformed AUDIT.md (no localization OR no reproduction OR no constraints sections)
- Parser extracts likely-files list, reproduction steps, constraints, and the Scientist tail
- Serializer for tests + replay

### Gap 5 — No `GATE_AUDIT_PASSED.json` writer code path

Mitigated by rule 1: gate writes route through orchestrator-owned primitives in `src/state/gates.ts` / `src/state/run.ts`. The generic `approveGate()` at `src/state/run.ts:466-519` already accepts ANY canonical phase including `audit`:

- `isPhase(opts.gate.phase)` validates the phase token at line 467
- `nextPhase(opts.gate.phase, opts.profile)` computes the transition at line 517

For brownfield, `nextPhase('audit', 'brownfield')` returns `'plan'`. The primitive already handles AUDIT correctly. M17 does NOT introduce a standalone `approveAuditGate` (per R0-revision-2 closure #2). The dispatchAudit's gate emission reuses the generic primitive.

## M17 scope — locked authority boundary

**Rule 20 boundary statement:** M17's single authority is "**AUDIT runtime + dispatch + persona.**" The runtime that takes a brownfield repo with a problem statement and produces an `AUDIT.md` localization + reproduction + constraints + Scientist tail, plus its CLI dispatch wiring and hand-authored Auditor persona.

**Explicitly excluded** (deferred to future milestones):

- New gate authority surfaces (reuse generic `approveGate`; no `approveAuditGate`)
- Brownfield profile-detection completion (Phase 1.6, already landed)
- BUILD/VERIFY/REVIEW changes downstream of AUDIT (those phases already run; M17 only opens the door)
- Live brownfield smoke test against a real OSS repo (optional, post-tag)
- AUDIT phase analytics / outcomes tracking (post-stable)
- Cross-family AUDIT review (single-provider AUDIT only in M17; cross-family is implicit at REVIEW)

## AUDIT phase contract

### Input

```
{
  problem_statement: string,           // Operator-provided. The bug, regression,
                                        // feature gap, or "audit this codebase"
                                        // brief that the run was started with.
  repo_root: string,                   // Brownfield repo root (where .git/ lives)
  repo_context: ToolUseRepoContext,    // glob/grep/read at locked caps per rule 18
                                        // (NO execute, NO write, NO network)
  config: CodeOzConfig,                // Run's effective config + budgets envelope
  events: readonly Event[],             // Per-run events.jsonl for projection
  agent: AgentDefinition,              // Auditor persona (from bundled-defaults)
  invokeContext: InvokeContext,        // Provider + registry + paths
}
```

### Output

```
{
  status: 'complete' | 'budget_exhausted' | 'audit_inconclusive',
  artifact: {
    path: '.code-oz/artifacts/AUDIT.md',
    sha256: string,                    // For gate-binding + audit trail
  },
  scientistTail: {
    hypothesesPath: '.code-oz/artifacts/HYPOTHESES.md',
    openQuestionsPath: '.code-oz/artifacts/OPEN_QUESTIONS.md',
    hypothesisCount: number,
    openQuestionCount: number,
  },
  events: [
    'phase_entered(audit)',
    'repo_context_searched(*)',         // 0+ per agent's autonomous searches
    'persona_invocation_started(auditor)',
    'persona_invocation_completed(auditor)',
    'artifact_recorded(AUDIT.md)',
    'gate_required(audit)',
  ],
}
```

### How AUDIT differs from PLAN and SPEC

| Surface | DEFINE / SPEC | PLAN | **AUDIT** |
|---|---|---|---|
| Input | Operator brief | SPEC.md + source check | Brownfield repo + problem statement |
| Output | SPEC.md | PLAN.md (task list) | AUDIT.md (localization + reproduction + constraints) |
| Files modified | None | None | None — **read-only phase** |
| Patches proposed | None | None | None — **fix is PLAN's job** |
| Tools needed | None | None | repo_context (glob/grep/read) only |
| Persona | BA | Lead | **Auditor** (new in M17) |
| Authority | SPEC artifact | PLAN artifact | AUDIT artifact |

AUDIT is the brownfield analog of SPEC + the first half of PLAN's source-check: it grounds the run in the existing codebase BEFORE PLAN proposes any changes. Critical: AUDIT does NOT propose fixes. The output is "here's where the problem lives, here's how I reproduced it, here's what constrains the fix" — handing off to PLAN with a concrete, sourced understanding.

## AUDIT.md schema

```markdown
---
runId: <ulid>
phase: audit
brief: "<operator problem statement, verbatim or paraphrased>"
profile: brownfield
auditor:
  persona: auditor
  provider: <claude|codex|...>
  model: <model id>
---

# AUDIT — <one-sentence summary of the diagnosis>

## Localization

Where the problem lives. Required: 1+ entries.

- `src/path/to/file.ts:NN-MM` — <why this region matters>
- `src/path/to/other.ts:line NN` — <relationship to the brief>
- ...

## Reproduction

How to surface the problem on the current codebase. Required: 1+ entries. Each entry MUST be reproducible by the operator. If reproduction requires data, runtime, or environment unavailable to AUDIT, the entry MUST say so and the run MUST emit an OPEN_QUESTIONS.md item.

- Command sequence: `<argv-only command>` followed by `<argv-only command>`
- Expected vs observed: <what happens vs what should happen>
- Environment context: <runtime, OS, dep versions if relevant>

## Constraints

What the fix MUST honor. Required: 1+ entries. Each constraint identifies a contract the fix cannot violate (existing tests, API surface, contract docs, gate file shape, etc.).

- <Existing contract or behavior the fix must preserve>
- <Test or invariant that must remain green>
- ...

## Scientist tail

(Required per rule 15. Renders into HYPOTHESES.md + OPEN_QUESTIONS.md by the existing scientist-tail-parser; AUDIT does not own its own scientist tail format.)

### Hypotheses

Ranked-and-falsifiable hypotheses about the root cause:

1. **H1** [confidence: <high|medium|low>] — <hypothesis statement>. **Falsifiable test:** <command or check that would reject this hypothesis>.
2. **H2** ...

### Open questions

Things AUDIT couldn't resolve without additional input or runtime access:

- **Q1** [blocks: <yes|no>] — <question>. **Owner:** <operator|audit retry|skip>. **By:** <date or "before PLAN">.
- ...
```

Schema validator (the `src/artifacts/audit-schema.ts` module M17 ships) rejects any AUDIT.md that:

1. Has no `## Localization` section OR the section has 0 entries.
2. Has no `## Reproduction` section OR the section has 0 entries.
3. Has no `## Constraints` section OR the section has 0 entries.
4. Has no Scientist tail (HYPOTHESES + OPEN_QUESTIONS).
5. Has `## Hypotheses` with 0 entries (rule 15: ranked + falsifiable required).

## Persona shape — `src/agents/defaults/auditor.md`

**Critical rule-16 compliance.** The persona body MUST be hand-authored. No LLM-generated draft, even as an outline. Three best-effort operational guardrails (per the 1000-star plan):

- **(a) Deterministic universal-rules import test** in `tests/agents-defaults.test.ts`: asserts `auditor.md`'s body begins with a verbatim copy of `src/prompts/universal-rules.md` and that the persona cannot relax any rule. Failure blocks the commit. Catches mechanical-concatenation drift; does NOT prove human authorship of the body below it.
- **(b) M17 R1 review-packet persona-provenance attestation** in `docs/handoffs/2026-05-M17-R1-PACKET.md`: a one-line attestation listing which sections of `auditor.md` Ozzy authored, which Claude authored, and that no LLM draft was committed. Reviewer (Codex) verifies against the diff.
- **(c) Grep-test guard** in CI: forbids any committed file under `docs/research/CODEX_*`, `docs/research/CLAUDE_*`, `docs/planning/CODEX_*`, or `docs/planning/CLAUDE_*` from containing the auditor persona's body (matched by the universal-rules import sentinel + a fixed persona-block hash recorded in C4). Catches generation-pass leakage after the fixed persona exists; does NOT prevent original LLM authorship of `auditor.md` itself.

Persona body structure (proposed; final wording is Ozzy + Claude hand-authoring):

```markdown
---
name: auditor
type: persona
phase: audit
provider: <claude|codex|...>
modelPolicy: ...
permissions:
  tool_use:
    repo_context:
      glob: true
      grep: true
      read: true
      symbol: false                   # Reserved for codegraph backend
    write: false                       # AUDIT does NOT modify files
    execute: false                     # NO execute permission (deferred)
    review_request: false
    debate: false
---

[VERBATIM CONTENT OF src/prompts/universal-rules.md]

# Auditor role

You are the Auditor. Your job is to take a brownfield repository and an
operator problem statement, then produce a localized, reproducible
diagnosis with explicit constraints that bound any future fix. You do
NOT propose fixes — that is PLAN's job. You do NOT modify files. You
read code, you search for patterns, and you write AUDIT.md.

## How you investigate

Use repo_context (glob, grep, read) to ground every claim in actual
file content. Every entry in your AUDIT.md Localization section MUST
cite a specific file:line range that you have read. Every Reproduction
entry MUST be derivable from what's in the repo. Every Constraint MUST
reference an actual contract, test, or invariant you have observed.

## What you write

AUDIT.md following the schema in docs/contracts/AUDIT.md (locked at
M17). Three required sections:

- Localization — where the problem lives (file:line + why).
- Reproduction — how to surface it (commands + expected vs observed).
- Constraints — what the fix must honor (contracts, tests, invariants).

Plus the Scientist tail (rule 15): ranked-and-falsifiable hypotheses
+ open questions.

## What you refuse

- You refuse to propose fixes. If you find an obvious fix, record it as
  an open question for PLAN, NOT as a Localization entry.
- You refuse to modify files. Your runtime permissions deny write and
  execute scopes.
- You refuse to fabricate file:line references. Every citation comes
  from a read you actually performed; if you couldn't read it, you say
  so and emit an open question.
```

The actual persona body lands in `src/agents/defaults/auditor.md` (C4 commit). The above is a sketch for Codex's review of the contract — the FINAL body is hand-authored by Ozzy + Claude collaboratively, with provenance recorded in the M17 R1 packet.

## Permissions — `tool_use.repo_context` only

Rule 18: codebase context retrieval has its own permission scope. AUDIT's persona frontmatter declares:

```yaml
permissions:
  tool_use:
    repo_context:
      glob: true                       # Discovery of file paths
      grep: true                       # Pattern search over file contents
      read: true                       # Reading specific file:line ranges
      symbol: false                    # Codegraph backend reserved for v0.x
    write: false                       # AUDIT does NOT write code
    execute: false                     # NO execute permission for first cut
    review_request: false
    debate: false
```

Explicit non-grants:

- **No execute.** First-cut AUDIT does NOT run commands or scripts. If reproduction requires execution, the Auditor records that in `Reproduction` as a command the operator must run, AND records an open question. Adding `execute` for AUDIT is deferred until measurable need (per rule 21 — no new parallel-provider/capability surface without measurable effect).
- **No write.** AUDIT does not modify files. Output is `AUDIT.md` + Scientist tail, written by the orchestrator's artifact-recording primitive, not by the persona.
- **No network.** Per rule 18, repo_context tools deny network access. The Auditor cannot fetch external docs or examples; everything cited must live in the repo.

Audit invariant per `docs/contracts/REPO_CONTEXT.md`: search results are audited via `repo_context_searched` events. Selected paths enter the NEXT invocation's `ProviderRequest.files`, never the search invocation's hidden context. The Auditor sees only what the orchestrator passes via the file manifest; agentic search adds files to the next manifest, not the current one.

## Gate file shape

`GATE_AUDIT_PASSED.json` is the canonical gate file at `.code-oz/state/runs/<runId>/GATE_AUDIT_PASSED.json`. Schema is the existing `RunGate` shape (defined in `src/state/schemas.ts`); the gate writer is the existing generic `approveGate()` primitive. No new schema, no new writer — reuse the existing rule-1-compliant authority.

Approval flow:

1. Operator runs `code-oz approve audit` after reading AUDIT.md.
2. `src/commands/approve.ts` resolves the active run, asserts `currentPhase === 'audit'`, calls `approveGate({ gate: { phase: 'audit', runId, sha256: <AUDIT.md sha256> }, profile: 'brownfield' })`.
3. `approveGate` writes `GATE_AUDIT_PASSED.json`, appends `gate_passed(audit)` event, and computes `nextPhase('audit', 'brownfield') === 'plan'`.
4. State transitions to `currentPhase: 'plan'`.
5. Next `code-oz run` dispatches to PLAN (existing M5 runtime).

The brownfield CLI e2e fixture (C1 RED test) MUST exercise this complete flow:

```
brownfield repo with .git/ + untracked source
  → code-oz init (Phase 1.6 → profile: brownfield)
  → code-oz run --request "<problem statement>"
    → C2-C6 path: dispatchAudit, runAudit, persona invoked, AUDIT.md
      written, gate_required(audit) emitted
  → code-oz approve audit
    → approveGate writes gate, advances to plan
  → code-oz run
    → dispatches to existing PLAN runtime
```

If C1's e2e ends before `currentPhase === 'plan'`, the consumer-first test is incomplete.

## Commit sequence (8 commits, ~24h)

Per the 1000-star plan's Phase 2.1 implementation table:

| # | What | RED test (fails BEFORE the commit, green AFTER) | Hours |
|---|---|---|---|
| C1 | brownfield CLI e2e fixture + failing test (no implementation; pure test scaffolding) | full `audit → approve → PLAN` cycle against fixture; MUST invoke `code-oz run` CLI path (binary-spawn, not state-level construction) and assert `currentPhase === 'audit'` is reached AND that the run fails before fallback BECAUSE `dispatchAudit` is missing (not because of profile hardcode — Phase 1.6 fixes that first). Anti-stub: a test that manually writes `AUDIT.md` + calls `approve` via state-level primitives does NOT count as C1 — that pattern at `tests/state-regression.test.ts:402-416` bypasses the dispatch gap entirely. | 4 |
| C2 | `dispatchAudit` branch added to active-run dispatcher in `src/commands/run.ts` AND fresh-run path routes to `dispatchAudit` instead of `runDefine` when `config.profile === 'brownfield'` | C1 advances past dispatch; now fails on missing phase module | 3 |
| C3 | `src/phases/audit.ts` skeleton + integration with `dispatchAudit` | C1 advances past phase entry; now fails on missing persona | 3 |
| C4 | `src/agents/defaults/auditor.md` (hand-authored persona) + bundled-defaults wiring + universal-rules import RED test + rule-16 grep-guard CI test | C1 advances past persona load; rule-16 deterministic import test passes; now fails on artifact validation | 3 |
| C5 | `src/artifacts/audit-schema.ts` + `src/artifacts/audit-parser.ts` | C1 advances past artifact validation; schema rejects malformed AUDIT.md; parser extracts likely-files + reproduction + constraints; now fails on gate approval | 5 |
| C6 | gate approval reuses generic `approveGate()` at `src/state/run.ts:466-519` (NO `approveAuditGate`); add audit-specific regression coverage only | C1 advances past gate approval into PLAN; rule 1 gate authority preserved; canonical phase `audit` from `src/state/schemas.ts:6` flows through existing primitive | 2 |
| C7 | brownfield CLI e2e turns green; add greenfield regression coverage to confirm no path divergence | C1 passes; existing greenfield e2e remains green | 3 |
| C8 | M17 closure synthesis + ROADMAP M17 entry + handoff doc | — | 1 |

Total: 24h across 8 commits. Each downstream commit advances exactly one consumer-test failure mode at a time. Rule 22(a) consumer-first ordering preserved; rule 22(b) RED-first TDD preserved.

## Risk register (M17)

| Risk | Mitigation |
|---|---|
| AUDIT scope creep into PLAN/BUILD changes | Pre-design debate (this doc) locks contract; rule 20 enforced via "AUDIT runtime + dispatch + persona" boundary |
| Cross-family review picks up secondary refactors | Each fix-first finding gets follow-up commit (no amend); per the no-tech-debt-at-close memory |
| Persona regenerated by LLM mid-development (rule 16 leak) | Three best-effort guardrails (deterministic import test + R1 packet provenance attestation + CI grep guard over docs/research/ + docs/planning/ CODEX_*/CLAUDE_* artifacts); rule itself is policy commitment verified at authorship time |
| AUDIT execution requires runtime access AUDIT doesn't have | Persona records reproduction as command-for-operator + emits open question; runtime stays read-only for first cut |
| AUDIT.md schema too strict, rejects valid diagnoses | C5 parser tests cover 5+ valid AUDIT.md fixtures across different problem shapes (regression, feature gap, "audit this codebase" open-ended); strictness lives in three required sections (localization, reproduction, constraints) + 1+ entries each |
| M17 cross-family review exceeds token budget | `budgets.global.maxTokensEstimate` ≤ 600k tokens/round enforced by `assertWithinBudget()` (per rule 19); $30 advisory dollar target tracked externally via `priceTable`; abort and replan scope if token warning fires twice in one round |
| Live brownfield smoke fails | OPTIONAL phase per plan; W3a R2 carries the launch demo regardless |
| AUDIT persona regresses greenfield demo | C1 + C7 e2e fixtures assert both greenfield and brownfield paths stay green |

## Open questions for Codex pre-design

These are the questions the M17 R0 round must close before code lands:

**Q1 — Anti-stub strictness:** Is C1's anti-stub acceptance condition strict enough? The plan forbids the state-level pattern at `tests/state-regression.test.ts:402-416`; the test MUST invoke `bun src/cli.ts run` and observe the dispatch fallthrough. Are there OTHER weaker substitutes that could sneak in? (e.g., calling `dispatchAudit` directly with a hand-built context, mocking the active-run reducer, etc.)

**Q2 — Fresh-run dispatch:** The plan's C2 description says "dispatchAudit branch added to active-run dispatcher" — but the fresh-run path at `run.ts:309-368` ALSO needs to route to `dispatchAudit` for brownfield, not `runDefine`. Is C2 the right place for both changes, or should it split (C2a fresh-run routing + C2b active-run dispatcher)? My current view: keep C2 as one commit since both edits are within `run.ts` and share a dispatchAudit consumer; smaller commits would hide the wiring.

**Q3 — AUDIT.md schema strictness vs flexibility:** The schema requires 1+ entries each in Localization, Reproduction, Constraints. Is that the right floor? Should "audit this codebase" (no specific problem) be supported via a separate AUDIT.md kind, or should the operator be required to articulate a problem statement before AUDIT runs? My current view: enforce 1+ entries; if the brief is "audit this codebase," the Auditor's job is to find at least one specific concern to surface as Localization, otherwise the audit hasn't produced value.

**Q4 — Permissions for AUDIT execute:** Plan locks `execute: false` for first cut. Is there a reproduction shape that's COMMON enough in real brownfield audits that omitting execute kills the value proposition? My view: no — most reproductions are command-shaped, and recording them as "operator runs this" is honest. Execute can land as M17.1 if usage data shows demand. Codex pushback welcome.

**Q5 — Cross-family REVIEW for AUDIT:** REVIEW (single-axis, M9) requires BUILD and REVIEW providers be different families. AUDIT happens BEFORE BUILD. Does AUDIT need its own cross-family discipline? My current view: no — AUDIT is read-only and produces a diagnostic artifact; the eventual REVIEW phase already runs cross-family on the BUILD that addresses the diagnosis. Adding cross-family at AUDIT would be a second authority axis for M17, which rule 20 forbids.

**Q6 — Scientist tail for AUDIT:** The existing scientist-tail-parser handles HYPOTHESES.md + OPEN_QUESTIONS.md across DEFINE/PLAN/BUILD/VERIFY/REVIEW. Should AUDIT use the same parser, or is there an AUDIT-specific structure? My view: reuse. The hypotheses in AUDIT are "root cause hypotheses" (slightly different framing than PLAN's "approach hypotheses") but the same shape: ranked + falsifiable. The parser stays generic; the persona's wording reflects the phase.

**Q7 — Brownfield fixture shape for C1:** The fixture needs `.git/` + at least one untracked source file (so Phase 1.6's detector flags brownfield) + a `.code-oz/config.yaml` with `profile: brownfield`. What's the canonical "minimal brownfield repo" shape? My view: a `src/app.ts` with one obvious bug (e.g., off-by-one in a counter) + a `tests/app.test.ts` that fails because of it. Auditor can localize the bug, reproduce via `bun test`, and constrain the fix to preserve the test contract.

**Q8 — M17 R1 review-packet provenance attestation enforcement:** The plan says R1 packet includes a one-line provenance attestation. What's the enforcement teeth? Just that R1 reviewer verifies it against the diff? My view: yes, plus an explicit checkbox in the R1 packet template (we ship the template as part of C8 closure handoff so future milestones have the same shape).

**Q9 — Persona ownership of file manifests:** AUDIT uses repo_context to discover relevant files. Per rule 18, selected paths enter the NEXT invocation's manifest. Does AUDIT need multiple invocations (search → diagnose) or single (diagnose with autonomous search)? My view: prefer single — the Auditor uses repo_context inline during one invocation, the orchestrator records `repo_context_searched` events, AUDIT.md cites the discovered files. Multiple invocations adds complexity without obvious value.

**Q10 — Open question routing:** AUDIT's OPEN_QUESTIONS.md may contain blockers that PLAN cannot resolve without operator input. Today, OPEN_QUESTIONS overdue checks block phase advancement (rule 15). Does AUDIT-generated open questions block PLAN, or just inform it? My view: blocking is correct — if AUDIT has an unresolved open question marked `blocks: yes`, `code-oz approve audit` refuses until operator addresses it. Consistent with greenfield's PLAN→BUILD blocking behavior.

## Codex pre-design ask

Codex, please read this briefing and return verdict `accept` / `accept-with-modifications` / `revise` / `debate`. Specifically:

1. **Rule 20 boundary:** does "AUDIT runtime + dispatch + persona" stay as a single authority across C1-C8, or do any of the proposed commits subtly introduce a second axis?
2. **Rule 22 consumer-first:** does C1's anti-stub acceptance condition genuinely lock to a real CLI e2e? Are there weaker substitutes worth forbidding explicitly that I missed?
3. **Rule 16 enforcement:** are the three best-effort guardrails (import test + provenance attestation + grep guard) adequate? Anything you'd add?
4. **AUDIT.md schema:** is "1+ entries each in Localization, Reproduction, Constraints" the right floor? Too strict, too loose?
5. **Permissions:** is `tool_use.repo_context` only (no execute, no write, no network) the right first cut, or does first-cut without execute kneecap real brownfield audits?
6. **AUDIT vs PLAN handoff:** are the AUDIT outputs (localization + reproduction + constraints + open questions) sufficient for PLAN to do its job? Is there a missing handoff field?
7. **Risk register:** any missed risks specific to AUDIT runtime that the M14/M15/M16 history doesn't capture?
8. **Q1-Q10:** answer each (or flag which require debate vs which are trivially acceptable).

Return your verdict at `docs/research/CODEX_RESPONSE_M17.md` with the standard frontmatter (session, thread, model, reasoning-effort, sandbox, verdict, briefing-under-review).

The M17 implementation cannot start until this round converges to `accept` or `accept-with-modifications`. Iterating to `revise` rounds is expected; matches M14-M16 history.
