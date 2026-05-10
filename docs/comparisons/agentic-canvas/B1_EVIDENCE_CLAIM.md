# B1 — Typed evidence-claim discriminated union (borrow from agentic-canvas)

## Status

Backlog. Target M17 or earliest v0.2 milestone, paired with B2 (`RunSummary` derived read-model). Non-controversial as additive typing; gate authority unchanged.

## Source pattern

agentic-canvas pins evidence as a typed union on every claim. Each claim carries `evidence[]` where the entry is one of `command` / `file` / `diff` / `screenshot` / `test` / `url` / `human_note`. The schema lives at `~/Projects/agents/templates/agentic-canvas/schemas/agent-canvas.schema.json` (`$defs.evidence`, lines 236–260), and is summarized in `~/Projects/agents/templates/agentic-canvas/SCHEMA.md` § "Progress" (line 71). The pattern stays narrow: one `type` field plus a small set of optional payload fields (`label`, `value`, `result`, `path`, `url`). No nested objects; the schema is permissive (`additionalProperties: true`) so plugins can extend, but the seven kinds are the contract.

## Proposed shape in code-oz

A discriminated union in `src/state/schemas.ts`, consumed by VERIFY and REVIEW artifact parsers and by reviewer-panel synthesis. Sketch (illustrative, not committed):

```typescript
// src/state/schemas.ts (new)
export type EvidenceClaim =
  | { kind: 'command'; payload: CommandPayload }
  | { kind: 'file_diff'; payload: FileDiffPayload }
  | { kind: 'test_result'; payload: TestResultPayload }
  | { kind: 'lint_result'; payload: LintResultPayload }
  | { kind: 'url'; payload: UrlPayload }
  | { kind: 'human_note'; payload: HumanNotePayload }
  | { kind: 'mutation_gate'; payload: MutationGatePayload }

export interface CommandPayload {
  readonly command: string           // verbatim command line
  readonly cwd: string               // worktree-relative
  readonly exitCode: number
  readonly durationMs: number
  readonly stdoutLogPath: string     // forensics path
  readonly stderrLogPath: string     // forensics path
  readonly stdoutBytes: number
  readonly stderrBytes: number
}

export interface FileDiffPayload {
  readonly path: string              // worktree-relative
  readonly patchSha256: string       // mirrors BUILD_REPORT.md
  readonly addedLines: number
  readonly removedLines: number
}

export interface TestResultPayload {
  readonly command: string           // the test invocation
  readonly testFile: string          // worktree-relative
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly durationMs: number
}

export interface LintResultPayload {
  readonly tool: 'tsc' | 'eslint' | 'biome' | string  // open question 5
  readonly errors: number
  readonly warnings: number
  readonly logPath: string
}

export interface UrlPayload {
  readonly url: string               // expected to be local 127.0.0.1 or doc URL
  readonly purpose: string           // one-line why this URL is evidence
}

export interface HumanNotePayload {
  readonly author: string            // operator id, never a model name
  readonly note: string              // ≤ 500 chars; longer goes to a sidecar path
}

export interface MutationGatePayload {
  readonly status: 'pass' | 'fail' | 'not-applicable'
  readonly notes: string             // mirrors VERIFY.md § Mutation
}
```

Five kinds map directly to agentic-canvas (`command`, `file_diff` ← `diff`, `test_result` ← `test`, `url`, `human_note`). Two are code-oz-specific because they correspond to existing artifact fields with no agentic-canvas analogue (`lint_result`, `mutation_gate`). `screenshot` from agentic-canvas is dropped — code-oz has no GUI surface in v0.1, and the §3.4 viewer is read-only.

Open shape questions are flagged in § "Open questions" below.

## Where it lands

- `src/state/schemas.ts` — add the `EvidenceClaim` union and the seven payload interfaces. Pure type addition; no validators wired yet at this stub stage.
- `src/state/evidence.ts` (new) — narrow validators per kind, mirroring the existing per-event validator pattern in `src/state/events.ts`. Validators are tested but not yet referenced from gate preflight.
- `docs/contracts/VERIFY.md` — revise § "Evidence" to reference `EvidenceClaim` as the canonical typed projection of the orchestrator-recorded bullets. The Markdown bullets stay as the human-readable surface (Rule 7); the typed projection lives in a sidecar JSON next to `VERIFY.md` (e.g., `.code-oz/artifacts/VERIFY.evidence.json`). Existing VERIFY.md continues to validate (additive).
- `docs/contracts/REVIEW.md` — revise § "Findings" to allow each finding to optionally cite an `EvidenceClaim` (by sidecar path + index) when the finding references a build artefact, test failure, or diff hunk. Optional, additive; existing REVIEW.md continues to validate.
- `docs/contracts/REVIEW_PANEL.md` — note that panel synthesis may aggregate `EvidenceClaim` entries from per-panelist drafts when the synthesizer emits the canonical `REVIEW.md`. Aggregation rules are out of scope for B1; tracked as an open question.
- `docs/contracts/EVIDENCE.md` (new) — short canonical contract for the union itself (one page). Referenced from VERIFY.md, REVIEW.md, and REVIEW_PANEL.md.

`src/state/events.ts` is **not** modified by B1. The event log already has its own typed event union; cross-referencing happens through the sidecar JSON path, not by embedding `EvidenceClaim` into events.

## Why this is borrow-now-not-borrow-later

Reviewer-panel synthesis (M14) is the load-bearing reason. Panelists run sequentially and emit per-panelist drafts that the synthesizer collapses into one canonical `REVIEW.md`. Today, evidence quoted by a panelist is free-form Markdown — the synthesizer cannot deduplicate "panelist A and panelist B both cited the same failing test" without string matching. A typed `EvidenceClaim` with stable shapes (e.g., `{ kind: 'test_result', payload: { testFile, command } }`) lets the synthesizer key on payload identity, dedupe by content, and surface the few unique pieces of evidence panelists actually disagreed about. This is the cleanest path to the M14 goal of "make cross-family disagreement auditable" without adding a new gate.

The borrow pairs with B2 (`RunSummary`) because both are derived read-models. `RunSummary` aggregates run state for viewers and skill wrappers; `EvidenceClaim` is the schema those viewers render. Building one without the other forces a second sidecar pass later.

It does not loosen any gate. Verdicts remain orchestrator-computed from BUILD_REPORT.md, VERIFY.md, and REVIEW.md per the existing contracts. The typed sidecar is a projection of evidence the orchestrator already records — it adds no new authority and removes none. If the sidecar is missing or malformed, the gate still passes on the Markdown artifact alone (sidecar is best-effort).

## Cost estimate

Sub-surfaces touched (counted per Rule 20 sharper application):

1. `src/state/schemas.ts` — type union addition
2. `src/state/evidence.ts` — new validator module
3. `docs/contracts/EVIDENCE.md` — new canonical contract
4. `docs/contracts/VERIFY.md` — sidecar reference + § Evidence revision
5. `docs/contracts/REVIEW.md` — optional finding-citation pattern
6. `docs/contracts/REVIEW_PANEL.md` — synthesizer note (non-binding)

Six sub-surfaces; one new authority domain (typed evidence projection) with no gate consequence. Borderline for Rule 20 — see § "Rule check" below for the rationale that this is one logical authority because the projection is read-only and gate-neutral.

Estimated commits: 3–5. C1 = schema + validators + EVIDENCE.md. C2 = VERIFY contract + sidecar emit in `src/phases/verify.ts`. C3 = REVIEW contract + optional finding citation parsing. C4 = REVIEW_PANEL note + synthesizer dedupe (small). Optional C5 = test fixtures for the seven kinds. Test count delta: ~40–60 unit tests (validators + sidecar emit + parse roundtrip).

Risk profile: low. Additive typing with no gate behavior change. The dominant risk is scope creep — a future implementer turning `EvidenceClaim` into a runtime gate signal. See § "Anti-pattern to avoid".

## Rule check (compatibility)

- **Rule 1** (file-based gate signals only): compatible. `EvidenceClaim` is a typed projection of artifact contents, not a gate signal. `GATE_<PHASE>_PASSED.json` files remain the only gate authority.
- **Rule 7** (artifact contracts in plain Markdown): compatible. The Markdown artifacts (`VERIFY.md`, `REVIEW.md`) stay primary. The typed sidecar is a derived JSON file, not the inter-phase handoff.
- **Rule 11** (`NEEDS_INTERVENTION.json` schema): compatible. `NEEDS_INTERVENTION` does not consume `EvidenceClaim` in B1. A future enhancement could embed evidence claims in intervention payloads, but that is out of scope.
- **Rule 13** (privacy by default): needs care. Payloads include file paths, command lines, and stdout/stderr log paths. The `.code-ozignore` redaction pipeline must run on the sidecar before it is written, identical to how it runs on `events.jsonl` entries today. Open question 4 below pins this.
- **Rule 15** (epistemic sidecars): compatible and synergistic. `HYPOTHESES.md` and `OPEN_QUESTIONS.md` continue to govern Scientist phase tails. `EvidenceClaim` is a separate, complementary projection; it does not replace or interact with the Scientist tail.
- **Rule 20** (one new authority per milestone): borderline-compatible. The borrow introduces one new domain (typed evidence projection) but touches six sub-surfaces. The mitigating argument: the projection is read-only and gate-neutral, so the authority count is one even if the file count is six. The implementing milestone should be **only** B1 + B2 (paired derived read-models) — no other authority changes in the same milestone.

## Open questions

1. **Inline payload vs. path reference.** Should large payloads (e.g., a 1 MiB stdout log) live inline as a string in the sidecar JSON, or always as a path to the existing forensics file? Proposed default: payloads carry **paths**, never inline blobs. Forensics writers already cap stdout/stderr at 1 MiB per stream; the sidecar references those paths.
2. **Sidecar versus inline JSON in the Markdown.** Should the typed projection be a separate file (`VERIFY.evidence.json`) or a fenced JSON block inside `VERIFY.md`? Proposed default: separate sidecar — keeps the Markdown human-readable and avoids parser complexity. Codex-round-2 candidate.
3. **Synthesizer dedupe rules for reviewer panels.** When two panelists cite the same `test_result`, what is the canonical key — `{ command, testFile }`, full payload hash, or first-citation-wins? Affects M14 follow-up work.
4. **Privacy redaction order.** Does `.code-ozignore` redaction run before or after `EvidenceClaim` typing? Proposed default: typing first, then redaction on the typed projection (so redaction can be payload-aware, e.g., redact a `command` differently from a `human_note`). Needs verification against the existing redaction pipeline.
5. **`lint_result.tool` enum scope.** Should the union enumerate exact tool names (`'tsc' | 'eslint' | 'biome'`) or accept any string? Proposed default: open string with a recommended set documented in `EVIDENCE.md`. Strict enum forces a contract change every time a project adopts a new linter.
6. **Should `EvidenceClaim` carry a stable id (`E-NNN`) like REVIEW findings (`F-NNN`)?** Useful for `REVIEW.md` findings to reference specific evidence. Proposed default: yes, run-scoped `E-NNN` with the same allocation discipline as `F-NNN` and `T-NNN`.

## Anti-pattern to avoid

1. **`EvidenceClaim` as a runtime gate signal.** The temptation: if a sidecar JSON is structured, the orchestrator could parse it and decide pass/fail directly from typed evidence (e.g., "if any `test_result.failed > 0`, fail VERIFY"). This conflicts with Rule 1 — gate authority lives in `GATE_<PHASE>_PASSED.json`. The sidecar is a projection, not a source of truth. Implementers must keep the gate logic reading the Markdown artifact and the orchestrator-computed verdict, not the sidecar.
2. **Schema permissiveness creep.** agentic-canvas's schema is intentionally `additionalProperties: true`. code-oz must not adopt that philosophy on `EvidenceClaim` — the union should be closed (`kind` enum is exhaustive, payload shapes are strict). Open string fields like `lint_result.tool` are the narrow exception, documented per kind. Loosening the union to "any extra fields allowed" silently re-introduces the provider-drift problem the comparison report's §4.1 already rejected.

## Acceptance criteria for the implementing milestone

- [ ] `src/state/schemas.ts` exports the `EvidenceClaim` union with all seven kinds, plus the seven payload interfaces.
- [ ] `src/state/evidence.ts` exports per-kind validators that reject malformed payloads with structured errors mirroring `EventLogError`.
- [ ] `docs/contracts/EVIDENCE.md` exists as the canonical contract for the union (one page, similar in shape to `docs/contracts/SCIENTIST.md`).
- [ ] `docs/contracts/VERIFY.md` § "Evidence" references `EvidenceClaim` and documents the sidecar emit. Existing VERIFY.md fixtures continue to validate without modification.
- [ ] `docs/contracts/REVIEW.md` § "Findings" documents the optional sidecar citation pattern, **including the fallback rule**: every sidecar citation (`see VERIFY.evidence.json#<index>`) must include a human-readable Markdown reference (e.g., the command verbatim, the file path, or the test name) so a reader with only `VERIFY.md` can still understand and validate the finding. Sidecars are an optimization, not a precondition. Codex R2 finding (`CODEX_RESPONSE_R2.md` finding 9): a future reader with `VERIFY.md` but no sidecar must not lose information; only dedupe and UI-rendering precision degrade. Existing REVIEW.md fixtures continue to validate.
- [ ] `docs/contracts/REVIEW_PANEL.md` notes the synthesizer aggregation behavior (or explicitly defers it to a follow-up milestone).
- [ ] VERIFY phase emits `VERIFY.evidence.json` after `VERIFY.md` is finalized, gated by the `.code-ozignore` redaction pipeline. Sidecar absence does not fail the gate.
- [ ] At least one validator test per kind (seven minimum), plus roundtrip tests for sidecar emit + parse.
- [ ] No change to `state/GATE_VERIFY_PASSED.json` or `state/GATE_REVIEW_PASSED.json` shape. Gate authority unchanged.
- [ ] Codex round-1 debate completed before implementation; Codex round-2 review completed before tag, both per the cross-model peer review rule.
- [ ] Paired with B2 (`RunSummary`) in the same milestone; no other authority domain bundled.
