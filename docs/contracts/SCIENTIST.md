# SCIENTIST (v0.1)

The Scientist meta-agent's contract. Authoritative for v0.1; the maestro discipline behind it lives in `docs/research/01-maestro-rule-checker.md`.

## What the Scientist is

Non-negotiable rule 15 (`CLAUDE.md`): every phase contract that produces a primary artifact must include the Scientist tail. The Scientist is the discipline of attaching, to every phase output, two epistemic sidecars:

- **`HYPOTHESES.md`** — the load-bearing claims this phase has made, each with a falsifier.
- **`OPEN_QUESTIONS.md`** — the questions the phase has surfaced but not answered, each with status, importance, and (optionally) a due-by date.

The Scientist is not a separate phase. It runs as a **phase-tail** after each primary phase produces its artifact, before the gate writes. Sidecars survive across phases; ids are stable.

The dossier behind the discipline: `docs/research/05-scientist-and-open-questions-agent.md`. The maestro skill it operationalizes is `requirement-restate` (every gate restates inputs, claims, and falsifiers).

Related sibling discipline: [`CHECKLISTS.md`](./CHECKLISTS.md) captures static gate-readiness yes/no rubrics for SPEC.md and PLAN.md, while Scientist captures hypotheses and open questions. They are siblings, not competitors; CHECKLISTS is advisory in v0.1, while Scientist remains governed by rule 15 and existing gate-preflight sidecar validation. Pinned 2026-05-10 from `docs/comparison/11-mimir/SYNTHESIS.md` § "B5".

## What ships in M6 vs. later

| Capability | Milestone | Where |
|---|---|---|
| `docs/contracts/SCIENTIST.md` (this file) | M6 commit 1 | here |
| `docs/contracts/HYPOTHESES.md`, `docs/contracts/OPEN_QUESTIONS.md` | M6 commit 1 | siblings |
| Parsers / serializers / atomic writers for HYPOTHESES.md, OPEN_QUESTIONS.md | M6 commits 2–3 | `src/artifacts/hypotheses.ts`, `src/artifacts/open-questions.ts` |
| Event types: `science_emitted`, `hypothesis_added`, `hypothesis_updated`, `question_added`, `question_resolved`, `question_deferred` | M6 commit 5 | `src/state/schemas.ts`, `src/state/events.ts` |
| `src/agents/defaults/scientist.md` (v0.1 persona body) | M6 commit 9 | `src/agents/defaults/` |
| `src/phases/scientist.ts` (phase-tail runner) | M6 commit 9 | `src/phases/` |
| `src/phases/gate-preflight.ts` (loose-coupled sidecar validation) | M6 commit 10 | `src/phases/` |
| PLAN-tail wiring (Scientist runs after PLAN persona) | M6 commit 13 | `src/phases/plan.ts` |
| BUILD/VERIFY/REVIEW phase-tail wiring | M7 | three more call sites |
| DEFINE retro-seed (opt-in via `phases.scientist.retroSeedDefine: true`) | M6 (config-only; non-default) | `src/config/schema.ts`, `src/phases/define.ts` (no behavior change unless set) |
| `code-oz hypotheses list`, `code-oz questions list`, `code-oz questions resolve` | W2 | new commands |
| Cross-run `.codeoz/memory/scientist/` | W2 | new directory layout |
| Older-than-N hypothesis re-verification | W2 | scheduler |
| Primary-artifact H/Q citation requirement | W2 | parser strict-mode |
| Designer / reflection loop | W2 | new persona |

Codex's separability point (`docs/research/CODEX_RESPONSE_SYNTHESIS.md` "Where I disagree" 5): substrate **must land together** in M6 — contracts, parsers, atomic writers, event types, and one gate-preflight that can validate the sidecars. CLI commands and cross-run memory can land later. Gate-blocking without the writer/parser package would deadlock the milestone.

## How the phase-tail runs

For every primary-artifact phase (M6: PLAN; M7: BUILD/VERIFY/REVIEW), the orchestrator runs this sequence:

1. Persona emits the primary artifact (e.g., PLAN.md).
2. Orchestrator validates the artifact schema. If invalid, repair/finalize per the artifact's contract; abort to draft + `NEEDS_INTERVENTION` on hard failure.
3. Orchestrator atomically writes the primary artifact.
4. **Scientist phase-tail runs** (`src/phases/scientist.ts`):
   - Read the primary artifact.
   - Read prior `HYPOTHESES.md` / `OPEN_QUESTIONS.md` (if any).
   - Invoke the Scientist persona with the primary artifact + prior sidecars + the universal-rules prompt + Common Rationalizations table.
   - Persona emits a draft `HYPOTHESES.md` and `OPEN_QUESTIONS.md` update.
   - Orchestrator validates, atomically writes both sidecars.
5. **Gate-preflight runs** (`src/phases/gate-preflight.ts`):
   - `validateScientistSidecars({ phase, artifactRoot })`:
     - Both files exist and parse.
     - No overdue open questions (status=open + dueBy < now).
     - No hypothesis missing a falsifier.
   - On failure: write `NEEDS_INTERVENTION.json` with a phase-specific code; do **not** advance to gate.
6. Phase exits successfully; user runs `code-oz approve <phase>`.

## Loose coupling (locked)

Codex push-back on briefing prompt 9 (`docs/design/CODEX_RESPONSE_M6.md` "Where I disagree" 7): `requireGate` in `src/state/run.ts` stays generic state machinery. Sidecar parsing and overdue-question semantics live in `src/phases/gate-preflight.ts` and are called from each phase's runner before `requireGate(phase, ...)`.

```ts
// src/phases/plan.ts (sketch)
await writeArtifact(planPath, plan)
await runScientistPhaseTail({ phase: 'plan', artifactRoot })
const preflight = await validateScientistSidecars({ phase: 'plan', artifactRoot })
if (!preflight.ok) {
  await writeNeedsIntervention(preflight.toIntervention())
  return
}
await requireGate(plan, ...)
```

M7's BUILD/VERIFY/REVIEW phases mechanically repeat this pattern. The duplication is intentional — coupling `run.ts` to every future sidecar discipline would be a migration trap.

## Scientist persona (v0.1 body)

`src/agents/defaults/scientist.md` lands in M6 commit 9 with a minimal v0.1 body. The persona's responsibilities:

- Read the primary artifact (PLAN.md in M6; SPEC.md if `retroSeedDefine` is on).
- Identify the phase's load-bearing claims; each becomes a hypothesis with a falsifier.
- Identify the phase's open questions; each becomes a question with status, importance, dueBy (optional).
- Reuse prior `H-NNN` and `Q-NNN` ids when the same claim or question persists from an earlier phase.
- Emit ONLY the two sidecar drafts; do not edit the primary artifact.

The persona prompt imports the universal rule sheet (`src/prompts/universal-rules.md`) per rule 16 and the Common Rationalizations table.

## DEFINE retro-seed (opt-in)

Config key `phases.scientist.retroSeedDefine: false` (default). When set to `true`, DEFINE runs the Scientist phase-tail after writing SPEC.md, seeding initial HYPOTHESES.md and OPEN_QUESTIONS.md from the SPEC's claims and open questions.

Default-off in M6 because:

- M5 shipped a valid DEFINE flow whose canonical artifact is SPEC.md, not sidecars.
- Reopening M5 would violate the M6 don't-do list.
- Opt-in lets fixture work measure value before flipping the default.

If `retroSeedDefine` is `true`, DEFINE's gate-preflight runs the same sidecar validation. With it `false`, DEFINE's gate is unchanged from M5.

## Permissions for the Scientist persona

```yaml
provider: claude        # cross-family with Lead's claude default is acceptable in M6;
                        # M7 may flip Scientist to a Codex-family default to widen blind-spot coverage.
modelPolicy: { primary: claude-opus-4-7, fallback: claude-sonnet-4-6 }
permissions:
  read: ['.code-oz/artifacts/SPEC.md', '.code-oz/artifacts/PLAN.md',
         '.code-oz/artifacts/HYPOTHESES.md', '.code-oz/artifacts/OPEN_QUESTIONS.md']
  write: ['.code-oz/artifacts/HYPOTHESES.md', '.code-oz/artifacts/OPEN_QUESTIONS.md']
  bash: deny
  # tool_use.repo_context not declared — Scientist does not search the repo;
  # it reasons over the primary artifact and prior sidecars.
```

## Maestro discipline updates

Per `CLAUDE.md` rule 17: updates to the maestro dossier (`docs/research/01-maestro-rule-checker.md`) land as commits with a top-of-file `## Update <date>` annotation. Scientist persona refinements land in `src/agents/defaults/scientist.md` and reference dossier 05.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| `scientist_sidecar_missing` | HYPOTHESES.md or OPEN_QUESTIONS.md absent at gate-preflight | Re-run phase or seed the sidecar |
| `scientist_hypothesis_no_falsifier` | A hypothesis lacks a falsifier bullet | Edit or rerun the Scientist tail |
| `scientist_question_overdue` | An open question's `dueBy` has passed | Resolve, defer, or extend the date |
| `scientist_invalid_id` | An id violates the run-scoped grammar | Renumber via the orchestrator |
| `scientist_persona_failed` | Scientist persona failed to produce parsable sidecars | Retry or escalate via NEEDS_INTERVENTION |

## Reference

- **Dossier:** `docs/research/05-scientist-and-open-questions-agent.md`
- **Maestro discipline:** `docs/research/01-maestro-rule-checker.md`
- **Linked contracts:** [`HYPOTHESES.md`](./HYPOTHESES.md), [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md), [`PLAN.md`](./PLAN.md), [`CHECKLISTS.md`](./CHECKLISTS.md)
- **Non-negotiable rules:** `CLAUDE.md` rules 15 (Scientist tail), 16 (universal rules), 17 (maestro dossier)
- **Design rationale:** [`docs/design/CODEX_RESPONSE_M6.md`](../design/CODEX_RESPONSE_M6.md) decision 5 (loose gate-preflight)
