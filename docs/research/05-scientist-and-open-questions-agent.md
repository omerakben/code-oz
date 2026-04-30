---
name: scientist-meta-agent
companion-docs: 01-maestro-rule-checker.md, 02-llm-failure-research.md
target: a meta-agent persona + two artifact contracts that run alongside every phase in code-oz
status: design draft, ready to land as a bundled persona at src/agents/defaults/scientist.md
---

# The Scientist meta-agent: hypotheses and open questions

## Why this exists

The maestro is the rule checker. The Prompter is the front door. The phase agents (BA, Lead, FE, BE, QA, Reviewer) build the work. None of them tracks epistemic state — what the system believes, why it believes it, what it does not know yet, and what would change its mind.

That gap is where most agentic-system failures hide. The 17-family bug map in the failure-research dossier is full of them: assumption propagation (family 14) is the agent betting the work on a premise it never wrote down; overconfidence with false completion (family 17) is the agent claiming verification it did not perform; sycophancy (family 13) is the agent updating its position without updating its evidence. The structural fix in each case is the same: write the belief down, write the evidence down, write what would falsify it.

Scientific method is the discipline that does this. Hypothesis → experiment → result → revised hypothesis or new question. The Scientist is a meta-agent that runs alongside every phase, applying that discipline to the work code-oz produces. It does not author code, write specs, or run tests. It tracks the epistemic state of the run: what we are betting on, what we have verified, what is open.

Two artifacts hold that state. `HYPOTHESES.md` is the live list of beliefs the run depends on. `OPEN_QUESTIONS.md` is the live list of things we do not know yet. Both files survive across phases, get updated at every gate, and are read by every phase agent before they start work.

This is the same shape as Anthropic's "verify before assert" discipline, the EviBound dual-governance gate pattern (arXiv:2511.05524), and the principled-and-procedural split in MARS (arXiv:2601.11974). It also operationalizes the maestro's ban on forbidden phrasings: "I believe", "I think", "this should" — every such phrase becomes either a hypothesis (logged) or an open question (logged), never an unmarked assertion.

## What the Scientist is not

It is not the BA. The BA elicits requirements; the Scientist tracks beliefs derived from those requirements.

It is not the Reviewer. The Reviewer attacks the work; the Scientist catalogues the attack surface before the Reviewer fires.

It is not the maestro. The maestro enforces rules; the Scientist tracks what is uncertain. The maestro can refuse to advance a phase when the Scientist's open-questions list contains an unresolved load-bearing question.

It is not a research agent in the literature sense. It does not propose experiments to run, then run them. It records what the system already does as if it were a scientific process, and forces the system to behave like one.

## How it runs

The Scientist runs as a phase-tail step. Every phase produces its primary artifact (SPEC, AUDIT, PLAN, BUILD report, VERIFY report, REVIEW); the Scientist then produces or updates HYPOTHESES.md and OPEN_QUESTIONS.md before the gate fires.

Phase contract for the Scientist step:

- Input: the just-finished phase's primary artifact, the previous HYPOTHESES.md and OPEN_QUESTIONS.md, the events log for this run.
- Output: updated HYPOTHESES.md and OPEN_QUESTIONS.md.
- Gate dependency: the phase gate cannot fire until both files exist with valid schemas and the Scientist has signed off.

This gives every phase a uniform tail. DEFINE produces SPEC + HYPOTHESES + OPEN_QUESTIONS. PLAN produces PLAN + updated HYPOTHESES + updated OPEN_QUESTIONS. BUILD produces BUILD_REPORT + updated HYPOTHESES + updated OPEN_QUESTIONS. The two epistemic artifacts thread through the whole run.

## The Scientist persona file

This block is what lives at `src/agents/defaults/scientist.md` once it ships. It is the persona body the orchestrator injects as the system prompt.

```text
---
name: scientist
phase: cross
provider: claude
modelPolicy: opus-default
permissions:
  read:
    - .codeoz/state/runs/*/events.jsonl
    - .codeoz/artifacts/*.md
    - .codeoz/rules/
    - .codeoz/lessons/
  write: []
---

You are the Scientist for code-oz. You run after every phase and before
every gate. You do not write code, specs, plans, or tests. You write
two files: HYPOTHESES.md and OPEN_QUESTIONS.md. You update them at every
gate. They are the epistemic state of this run.

Your discipline:

  1. Every belief the run depends on is a hypothesis. Write it down.
     Each hypothesis has: a claim, the evidence behind it (file:line
     references, command outputs, source quotes), and a falsifier
     (what would prove it wrong).

  2. Every uncertainty is an open question. Write it down. Each
     question has: the question, why it matters (which hypothesis or
     decision depends on it), what would resolve it, and the latest
     phase by which it must be resolved.

  3. A hypothesis without a falsifier is not a hypothesis; it is a
     claim. Convert it: either find a falsifier or downgrade it to
     an open question.

  4. An open question without a resolution criterion is not a question;
     it is a vague worry. Convert it: state what would resolve it or
     drop it.

  5. When the just-finished phase produces evidence that resolves an
     open question, mark the question resolved and add the evidence to
     the corresponding hypothesis. When evidence falsifies a hypothesis,
     retire the hypothesis and surface the consequence as a new open
     question.

  6. You are forbidden from removing a question by re-stating it as a
     hypothesis without evidence. Doing so is a hard fail of your role.

  7. You are forbidden from agreeing with the phase agent's confidence
     when the evidence does not support it. Sycophancy at the
     epistemic layer corrupts every later phase.

You will not:

  - Generate code or product output.
  - Decide what to build.
  - Override the phase agent's primary artifact.
  - Use enthusiastic or affirmative language.
  - Mark a hypothesis verified without naming the verification.
  - Mark a question resolved without naming the evidence.

You will:

  - Read the just-finished phase's artifact.
  - Read the events log for this run.
  - Read the prior HYPOTHESES.md and OPEN_QUESTIONS.md if present.
  - Produce updated versions of both files.
  - End your output with the <science-ready/> token alone on its line.

Format outputs in canonical Markdown. Do not include your reasoning
trace; the trace lives in events.jsonl. Each artifact stands alone.
```

## HYPOTHESES.md schema

Plain Markdown, no YAML frontmatter. Section structure mirrors SPEC.md and INTENT.md for tooling consistency.

```text
# HYPOTHESES

## Active hypotheses
Each entry has the form:

### H-NNN: <one-line claim>
- Status: active | falsified | retired
- Evidence: <file:line, command output, source quote, or commit ref>
- Falsifier: <what would prove this wrong>
- Owners: <which phases or agents depend on this being true>
- Last updated: <YYYY-MM-DD, phase>

## Falsified hypotheses
Same format. Kept for audit; never deleted.

## Retired hypotheses
Hypotheses that became irrelevant (e.g., the requirement they supported
got dropped). Same format. Kept for audit.
```

A hypothesis is identified by a stable `H-NNN` id that survives across phases. The id is assigned the first time the hypothesis is written; later phases reference the same id even when they update evidence or status.

## OPEN_QUESTIONS.md schema

```text
# OPEN QUESTIONS

## Active questions
Each entry has the form:

### Q-NNN: <one-line question>
- Why it matters: <which hypothesis, decision, or artifact depends on this>
- Resolution criterion: <what would answer this>
- Latest phase: <DEFINE | PLAN | BUILD | VERIFY | REVIEW | SHIP>
- Owner: <which phase agent or which user>
- Last updated: <YYYY-MM-DD, phase>

## Resolved questions
Same format plus a `Resolution: <evidence>` field. Kept for audit.

## Deferred questions
Questions intentionally pushed past v0.1 scope. Each has a `Deferred to:`
field naming the milestone. Kept for audit.
```

A question is identified by a stable `Q-NNN` id. When a hypothesis turns out to be false, a new question is opened with a back-reference to the falsified hypothesis.

## How the Scientist interacts with other agents

Reading order at every phase start:

1. Phase agent reads HYPOTHESES.md and OPEN_QUESTIONS.md before starting work.
2. Phase agent's primary artifact (SPEC, PLAN, BUILD report, etc.) cites the H-ids and Q-ids it depends on or addresses. Citations are mandatory; an artifact that does not cite the epistemic state is rejected by the maestro.
3. Phase agent's reasoning trace logs which Q-ids it answered and which it left open.
4. Scientist runs at phase tail, updates both files, signs off.
5. Maestro reads OPEN_QUESTIONS.md before firing the gate. Any unresolved question with `Latest phase: <this phase>` blocks the gate.

This wires the epistemic state into the gate semantics. A phase cannot advance with overdue open questions, and an artifact cannot avoid declaring its dependencies on prior beliefs.

## Anti-patterns the Scientist catches

Every entry in the failure-research dossier's bug map lands somewhere in the HYPOTHESES / OPEN_QUESTIONS workflow.

API and library fabrication (family 1) becomes a hypothesis: "H-NNN: the symbol `client.processEmails` exists in package `@onestream/email@2.3.1`. Evidence: TBD. Falsifier: import resolution fails." The Scientist refuses to mark this hypothesis verified until the orchestrator runs `verify-symbol` and writes the evidence.

Requirement violation (family 3) becomes an open question if any acceptance-criterion word does not appear in the SPEC: "Q-NNN: does the SPEC cover the rate-limit constraint mentioned in the ticket? Resolution criterion: a SPEC.md section explicitly addresses rate limits with a number and a unit."

Verification gap (family 8) shows up as a hypothesis with no falsifier. The Scientist forces conversion: either find a falsifier (e.g., a mutation test that would fail if the implementation were broken) or downgrade to an open question.

Sycophantic compliance (family 13) is structurally banned by the persona body's rule 7. The Scientist cannot agree with a phase agent's confidence without independent evidence; if it does, the maestro samples its output and rejects it.

Assumption propagation (family 14) is the family the Scientist most directly addresses. Every load-bearing premise is logged. The maestro reads the list at every phase start and forces re-verification of any hypothesis older than N phases without re-evidence.

Overconfidence and false completion (family 17) is impossible at the artifact layer because every claim ships with evidence references. A phase cannot ship a SPEC that says "this approach handles concurrency" without a hypothesis H-NNN backing the claim and either a verifier or an open question.

## Cross-cutting integration points

With the maestro: the maestro reads OPEN_QUESTIONS.md as part of every gate check. The maestro's `requirement-restate` skill becomes a check that all H-ids referenced in the artifact appear in HYPOTHESES.md.

With the Prompter (DEFINE-0): the Prompter's INTENT.md "assumptions made" section becomes the seed for HYPOTHESES.md. Every assumption logged at the front door becomes a hypothesis with status `active` and the BA's first job in DEFINE is to either provide evidence (mark verified) or ask the user to confirm (open question).

With cross-family review: Codex reads HYPOTHESES.md as one of its inputs when reviewing a milestone. A Codex review that finds a load-bearing hypothesis with no falsifier reports it as a structural finding, separate from code-level findings.

With memory: hypotheses and open questions accumulate in `.codeoz/memory/scientist/` across runs. Patterns emerge ("we keep introducing the same hypothesis about webhook idempotency, then forgetting to verify it") and become project rules.

## Configuration

Section in `.code-oz/config.yaml`:

```yaml
phases:
  scientist:
    enabled: true
    runs: ['define', 'audit', 'plan', 'build', 'verify', 'review', 'ship']
    blockGateOn:
      - unresolvedQuestionsAtThisPhase: true
      - unfalsifiableHypothesis: true
      - hypothesisOlderThanNPhasesWithoutReverification: 3
    crossFamilyReview:
      mode: every-milestone
```

## What this milestone needs

The Scientist is shippable as a single small milestone. Suggested commit sequence:

1. `docs(scientist): pin HYPOTHESES and OPEN_QUESTIONS contracts.` Adds `docs/contracts/HYPOTHESES.md`, `docs/contracts/OPEN_QUESTIONS.md`, `docs/references/scientist-contract.md`.
2. `feat(artifacts): add hypotheses and open-questions parsers and serializers.` `src/artifacts/hypotheses.ts`, `src/artifacts/open-questions.ts`. Schema validation, id allocation, atomic writes.
3. `feat(state): add scientist event types.` `science_started`, `science_completed`, `hypothesis_added`, `hypothesis_falsified`, `question_opened`, `question_resolved`. Reducer no-op.
4. `feat(personas): add scientist bundled persona.` `src/agents/defaults/scientist.md`. Frontmatter and body per this dossier.
5. `feat(phases): add scientist phase-tail runner.` `src/phases/scientist.ts`. Runs after every phase's primary artifact, before gate.
6. `feat(state): block gate fire on overdue open questions.` Modify `src/state/gates.ts` to consult OPEN_QUESTIONS.md before firing.
7. `feat(commands): expose scientist artifacts.` `code-oz hypotheses list`, `code-oz questions list`, `code-oz questions resolve <Q-NNN>`.
8. `test(scientist): add fixture for full DEFINE-with-scientist flow.` Snapshot tests for both artifacts.
9. `docs(scientist): update SESSION_CYCLE.md and CLAUDE.md to include the scientist phase tail.` Add a non-negotiable rule (#15): "Every phase's gate consults HYPOTHESES.md and OPEN_QUESTIONS.md."
10. `docs: tag v0.6.0-alpha.0.`

Slot recommendation: between M6 and M7. After PLAN's three-source verification ships (M6) so the Scientist has real evidence to track, and before the BUILD/VERIFY/REVIEW spine ships (M7) so the Scientist threads through every phase.

The Scientist is also a candidate for first-implementation right after M5 closes, as a "quick win that demonstrates the spine extends cleanly." It does not require new providers, new sandboxes, or new external integrations. Just two artifacts, one persona, and a phase tail.

## What this changes for non-experts

The user's friends do not need to understand the epistemology. They need to read HYPOTHESES.md and see "we are betting that your spreadsheet has a header row" and either confirm or correct. They need to read OPEN_QUESTIONS.md and see "what email provider do you want to use?" and answer.

The Scientist makes the system's beliefs explicit in a way the friends can audit. It is the cure for the failure mode where a non-expert says "build me X" and the system invents Y silently. With the Scientist running, the system writes down what it inferred, the friend reads what was inferred, the friend corrects what was wrong. No silent invention.

It also gives the friends a learning artifact. After ten runs, OPEN_QUESTIONS.md across runs becomes a list of "things you should think about up front when asking for software." That is teachable.

## Citation note

The Scientist persona is a synthesis, not a single source. The relevant prior art:

- EviBound (Chen, arXiv:2511.05524, 2025): dual-governance gates with machine-checkable evidence; eliminates false completion claims. The Scientist is the persona-level expression of EviBound's logic.
- MARS (arXiv:2601.11974, 2026): principled-and-procedural instruction split. HYPOTHESES.md is the procedural layer; project rules in `.codeoz/rules/` are the principled layer.
- Voyager (arXiv:2305.16291, NeurIPS 2023): self-verification before committing skills to library. The Scientist gate-blocks on unresolved questions for the same structural reason.
- Reflexion (arXiv:2303.11366, 2023): verbal self-critique. HYPOTHESES.md is the structured, persistent version of Reflexion's in-context critique.
- The phase-tail pattern itself draws from agile retrospectives and from Knuth's literate-programming discipline of writing belief and reasoning alongside code.

The novelty is not in any single mechanism. It is in making the epistemic state a first-class artifact alongside the work artifacts, with gate-level enforcement, in a multi-agent setting.
