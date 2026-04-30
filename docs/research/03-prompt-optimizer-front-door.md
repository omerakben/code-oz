---
name: prompt-optimizer-front-door
companion-docs: maestro-rule-checker.md, llm-failure-research.md
target: design proposal for a code-oz milestone (recommended: W2 polish, after M7 spine ships)
status: research + design draft, ready to become CODEX_BRIEFING_W2_PROMPTER if the user agrees
---

# The prompt optimizer front door for code-oz

## The observation, restated

Most non-expert users cannot write prompts that produce reliable agent behavior. Zamfirescu-Pereira et al. (CHI 2023, "Why Johnny Can't Prompt") put this on a research footing: non-experts approach prompt design opportunistically, not systematically; they use human-to-human instructional analogies that do not transfer; they overgeneralize from one success to a strategy. The 17-page CHI paper studies people building chatbots, but the same pattern shows up everywhere LLMs touch a non-technical user, including the friends Ozzy is teaching.

For code-oz the implication is direct. M5's DEFINE phase has a BA persona that runs an ask-me loop with the user. If the user's opening message is well-shaped, the loop converges fast and the SPEC.md is good. If the opening message is vague, contradictory, or shaped by the user's mental model of "talking to a person," the BA spends rounds excavating intent rather than refining it, the round budget runs out, and SPEC.md ends up underspecified. Every downstream phase then inherits that weakness. PLAN's three-source verification cannot fix a missing requirement; BUILD writes the wrong thing efficiently; QA's tests pass for the wrong reason.

The fix is structural: a prompter agent runs before the BA. It does the work the user does not know to do. It reads the raw utterance, pulls the relevant memories and skills, rewrites the request into a structured brief, asks at most one focused clarifying question if the intent is genuinely ambiguous, and hands the BA a clean starting point. This is the front door.

The framing also gives code-oz a place to put self-evolving behavior cleanly. The prompter's outputs are auditable (the rewritten brief is a file). The BA's outcomes are auditable (the SPEC.md is a file). The link between them — "this rewritten brief produced that good SPEC" — is the training signal for the prompter to get better over time without retraining the model. Memory and skills evolve at the prompter layer; the rest of the spine does not change.

## Why this is research, not just engineering

Three arguments make this worth treating as a research milestone rather than a small feature.

The literature has converged on a small set of mechanisms that work. We are not inventing the prompter; we are picking among proven patterns. Four mechanisms recur across 2024–2026 papers: intent-clarity classification (Curiosity by Design, arXiv:2507.21285), adaptive intent elicitation (APE, arXiv:2602.04713), prompt rewriting from minimal input (Promptomatix arXiv:2507.14241; PromptTailor arXiv:2511.21725; Conversational User-AI Intervention arXiv:2503.16789), and self-evolving skill memory (Voyager arXiv:2305.16291; MemSkill arXiv:2602.02474; MemAPO arXiv:2603.21520). The design space is constrained.

The numbers are real. DSPy with MIPRO raised accuracy from 46.2% to 64.0% on prompt-evaluation tasks in one multi-use-case study (arXiv:2507.03620). Voyager's skill library lets the same agent solve Minecraft tasks zero-shot in a new world after lifelong learning. Memento-Skills (the descendant of MemSkill, VentureBeat 2026-04) reports a 13.7-point gain on GAIA test set accuracy (66.0% vs. 52.3%) and more than doubles HLE accuracy (38.7% vs. 17.9%) over a static skill library. These are not pilot-study numbers.

The cost of getting this wrong is high in code-oz specifically. A bad SPEC.md propagates into a bad PLAN.md, a bad BUILD, and unverifiable REVIEW. By the time the user notices, the cost is six commits and a milestone that has to be unwound. The front door catches it once.

## The research base

Listed by the layer of the design they inform.

### Layer 1: intent classification at the front door

The job is binary or three-way: is this prompt clear enough to act on? Curiosity by Design (Liu et al., arXiv:2507.21285, 2025) trains an intent-clarity classifier that decides if the user's request is sufficient for code generation; if not, it defers and produces a clarification question. A fine-tuned model outperforms zero-shot prompting for clarification quality, which says the classifier itself is worth specializing rather than asking a general model to do.

The Adaptive Prompt Elicitation paper (APE, arXiv:2602.04713, IUI 2026) goes further: it formulates intent elicitation as information-theoretic interactive inference, generating queries that maximize information gain about the user's latent intent, then compiling the elicited requirements back into a prompt. That is the same mathematical problem as the BA's ask-me loop. The relevant insight: intent inference is a different problem from intent execution and benefits from being a separate stage.

The Conversational User-AI Intervention study (Chen et al., arXiv:2503.16789, 2025) studies real human-LLM conversations and finds that rewriting suboptimal prompts elicits better responses while preserving original intent. They report three outputs from the rewriter that map cleanly onto code-oz's needs: degree of modification needed, aspects of improvement (clarity, specificity), and assumptions the model had to make. The third output is the most useful for code-oz: every assumption is a load-bearing premise that the maestro should track and re-verify at later phases.

### Layer 2: prompt rewriting and synthesis

Promptomatix (Salesforce AI Research, arXiv:2507.14241, 2025) is the closest published analogue to what we want. It transforms a natural-language task description into a high-quality prompt without manual tuning. The pipeline: analyze user intent, generate synthetic training data, select a prompting strategy, refine with cost-aware objectives. It supports two backends: a lightweight meta-prompt-based optimizer (cheap, runs in seconds) and a DSPy-powered compiler (expensive, runs minutes, higher quality). The two-tier design matters; we should adopt it.

PromptTailor (Xu and Davis, Whitman College, arXiv:2511.21725, 2025) handles the specific problem of expanding minimal user instructions into rich, domain-aware prompts while preserving stated preferences. Their key idea: the optimizer must explicitly check that the optimized prompt does not silently drift from the user's stated intent. They cite this as the main failure mode of naive prompt-rewriters: the rewrite improves the model's behavior but solves the wrong problem.

DSPy (Khattab et al., now in mainstream production) treats prompts as learnable parameters compiled from a declarative program. The relevant DSPy optimizers for code-oz: MIPRO (multi-stage instruction prompt optimization, jointly tunes instructions and few-shot examples), COPRO (cooperative prompt optimization), BootstrapFewShot and its random-search variant. The DSPy comparative study (arXiv:2412.15298, 2024) ranks them on a hallucination-detection task and finds MIPRO leads on aggregate. For code-oz, MIPRO is the natural backbone of the heavy-tier optimizer; the lightweight tier can be a hand-written meta-prompt for speed.

### Layer 3: self-evolving skills and memory

Voyager (Wang et al., arXiv:2305.16291, NeurIPS 2023) is the most-cited prior art on growing a skill library through agent experience. Three components: an automatic curriculum that maximizes exploration, a skill library of executable code (compositional, retrievable), and an iterative prompting mechanism with environment feedback, execution errors, and self-verification. A skill is committed to the library only after self-verification confirms task completion. The lesson for code-oz: skills earn their place; the agent does not get to write to its own skill library at will.

MemSkill (Zhang et al., arXiv:2602.02474, 2026) reframes memory operations themselves as learnable, evolvable skills. Three roles: a Controller selects which skills to load for the current task; an Executor runs the skills to produce skill-guided memory; a Designer periodically reviews hard cases where selected skills failed and evolves the skill set. This is the closed-loop procedure that turns one-off success into reusable knowledge. For code-oz, the maestro is the Controller; the persona agents are Executors; a new reflection job is the Designer.

MemAPO (arXiv:2603.21520, 2026) reframes automatic prompt optimization itself as an experience-accumulation problem rather than a per-task search. The argument: useful prompting knowledge is reusable across queries; the prompt-search formulation throws away that knowledge after every task. MemAPO self-organizes reusable memories across multiple tasks. For code-oz, this is permission to treat the prompter's outputs as accumulating evidence, not transient artifacts.

Memento-Skills (VentureBeat coverage 2026-04, arxiv preprint forthcoming) is the production descendant of these ideas. Reusable skills stored as structured Markdown files; reinforcement-style retraining via a Read-Write Reflective Learning loop; gains of 13.7 points on GAIA and ~20 points on HLE over a static skill library. Most relevant for code-oz: the Markdown-file-as-skill format matches what we already have. Memento-Skills also enforces unit-test gates before committing new skills, which matches code-oz's verify-before-assert discipline.

### Layer 4: orchestration and feedback

The OpenAI cookbook on self-evolving agents (cookbook.openai.com, 2025-11-04) walks through three escalating optimization patterns: a manual Optimize-button loop with thumbs-up/down feedback (rapid but unautomated), a static metaprompt loop that explores section-by-section (limited exploration space, can overfit), and GEPA (Genetic-Pareto framework: samples agent trajectories, reflects on them in natural language, proposes prompt revisions, evolves through iterative feedback). GEPA is heavier but produces revisions informed by both quantitative scores and textual feedback, which is the right shape for code-oz's Codex-review loop.

MARS (Meta-cognitive Agent with Reflective Self-improvement, arXiv:2601.11974, 2026) converts baseline agent failures into principled-and-procedural instructions and synthesizes enhanced prompts from them. The "principled-and-procedural" split is useful: principles are durable rules ("verify before assert"), procedures are concrete steps ("for symbol resolution, run the static check from skill X"). code-oz's existing CLAUDE.md is principled; the prompter's skills should be procedural.

The literature also names the dead ends. Reflexion (Shinn et al., 2023) accumulates self-critiques in the context window without structured retrieval, which means lessons get truncated when the context fills. ExpeL (2024) extracts lessons via keyword matching, which is brittle on near-synonyms. The pattern in both is "useful idea, weak persistence layer." code-oz solves the persistence layer with the file-system memory in `.codeoz/lessons/` and `.codeoz/skills/`; it can borrow Reflexion's self-critique idea and ExpeL's lesson-extraction without inheriting their weak storage.

## Three patterns mapped to code-oz

The research above collapses into three patterns this design needs.

Pattern A: a front-door optimizer phase, named DEFINE-0, that runs before DEFINE. It owns intent classification, memory retrieval, prompt rewriting, and at most one clarifying question. Output: an INTENT.md artifact that the BA consumes.

Pattern B: a controller-executor-designer loop for skills and memory. The maestro is the controller (decides which skills load); persona agents are executors (run the skills to produce work); a new reflection job is the designer (reviews trajectories, proposes new skills, retires unused ones). Designer runs on demand via `code-oz reflect` or scheduled, never inline during a run.

Pattern C: a two-tier optimizer (cheap meta-prompt + heavy DSPy compile). The cheap tier runs every time. The heavy tier runs when the cheap tier's confidence is low or when the user explicitly opts in via `code-oz run --deep`.

These three patterns are independent. Each one delivers value alone. They compose into the full self-evolving prompter.

## Proposed design for code-oz

The shape below is intentionally close to existing code-oz patterns. Same artifact format (Markdown plus YAML frontmatter), same gate model (file-based, schema-validated), same cross-family review discipline. Nothing here asks for a new substrate.

### New phase: `define-0` (the prompter)

Sits between intake and DEFINE in the phase taxonomy. Greenfield phase order becomes:

```
INTAKE → DEFINE-0 → DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Brownfield order:

```
INTAKE → DEFINE-0 → AUDIT → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Phase contract.

- Input: raw user request (`--request "<text>"`, `--request-file path`, or interactive entry). Optionally a project context summary built from `.codeoz/rules/` and the recent `.codeoz/lessons/`.
- Output: `INTENT.md` artifact with a fixed schema.
- Gate: `intent-locked`. The BA cannot read INTENT.md until the gate file exists with a sha256 binding (matches existing gate writer in `src/state/gates.ts`).

INTENT.md schema (six required H2 sections, no frontmatter, mirrors SPEC.md style for consistency):

```
# INTENT

## Restated request
The user's original request, paraphrased into one paragraph. The paraphrase
must preserve every concrete noun, verb, and number from the original.
Drift here is a hard fail of this phase.

## Inferred goals
The top three goals the prompter believes the user is trying to accomplish.
Each goal is one sentence. Goals are inferred, not asserted; the BA will
verify them.

## Stated constraints
Constraints the user named explicitly. Each constraint is one bullet, with
a verbatim quote from the original input where possible.

## Inferred constraints
Constraints the prompter is bringing in from project memory or general
software practice. Each constraint is one bullet with the source named:
"from .codeoz/rules/03-no-amend.md" or "from skill: dependency-pin."

## Assumptions made
Every premise the prompter is treating as true that the user did not
state. Each assumption is one bullet. The BA's first turn explicitly
re-checks each one.

## Open questions
Questions the prompter could not resolve from memory and could not
defer. Maximum of one. If empty, write "- None at this time."
```

### New persona: `prompter`

Lives at `src/agents/defaults/prompter.md`. Provider declaration: `provider: claude` (Opus by default, per CLAUDE.md rule 4). Permissions: read-only over `.codeoz/rules/`, `.codeoz/lessons/`, `.codeoz/skills/`, the agent's own bundled prompt assets. No write permissions to the repo; the orchestrator writes INTENT.md.

Persona body (sketch, gets refined in the planning round):

```
You are the Prompter for code-oz. You stand at the front door of every
run. Your job is to take a user's raw request and prepare it for the
BA persona that follows you.

You will:
  - Read the request twice before producing output.
  - Retrieve relevant rules, lessons, and skills from project memory.
  - Restate the request, preserving every concrete fact in the original.
  - List inferred goals, stated constraints, and inferred constraints.
  - Name every assumption you are making.
  - Ask at most one clarifying question if the intent is genuinely
    ambiguous. If you can defer the question to the BA, defer.

You will not:
  - Solve the problem. That is the BA's job, then PLAN's, then BUILD's.
  - Add requirements the user did not state and that no memory supports.
  - Decide product strategy.
  - Use enthusiastic or affirmative language. State, do not flatter.

Output INTENT.md following the canonical schema. End with the
<intent-ready/> token alone on its line.
```

### New artifact pipeline

`src/phases/prompter.ts` runs the prompter. The orchestration shape mirrors M5's `define.ts`: bounded loop, structured response token, single repair turn, validation against the INTENT.md schema, atomic write to disk, gate file written via existing `state/gates.ts` writer.

Two-tier optimizer.

- Tier 1 (cheap, default): one provider call with the prompter persona and a meta-prompt-based template. Returns INTENT.md draft. If validation passes, gate fires.
- Tier 2 (heavy, opt-in via `--deep`): the cheap-tier output is treated as a candidate. A DSPy MIPRO-shaped optimizer searches over instruction variants using a small synthetic-test-case suite (generated per Promptomatix's recipe). Returns the best candidate. Higher latency, higher token cost, gated by `code-oz run --deep` or a config flag.

The default for v0.1 of this milestone is tier 1 only. Tier 2 lands in a follow-up.

### Skill library evolution

New directory: `.codeoz/skills/prompter/exemplars/`. Each exemplar is a Markdown file showing a successful (raw_request, optimized_INTENT, downstream_outcome) triple. Exemplars are retrievable by tag (project type, domain, request shape).

Designer job (`code-oz reflect`).

Runs on demand or on a cron. Steps:

1. Read the last N runs' state (raw request, INTENT.md, SPEC.md, downstream phases' outcomes).
2. For each run, score the prompter's output: Did the BA accept the inferred goals or revise them? Did the assumptions hold through PLAN? Did SPEC.md preserve the restated request's concrete facts?
3. Promote successful (raw, INTENT) pairs into `prompter/exemplars/`. The prompter retrieves exemplars by tag at start of next run.
4. Demote or retire exemplars that have been retrieved but where downstream outcomes were poor.

This is the controller-executor-designer loop from MemSkill, adapted to file-based storage. The designer does not modify the prompter persona's body; it only modifies the exemplar set the persona retrieves from. The persona stays human-readable and auditable.

### Memory tier integration

The memory architecture from `maestro-rule-checker.md` (project rules, lessons learned, skill outcomes, ADRs) extends to hold prompter-specific entries. New layers:

- `.codeoz/memory/prompter/intents/` — INTENT.md history per run, addressable by run id. Used by the designer to compute prompt-quality scores.
- `.codeoz/memory/prompter/patterns/` — recurring user-request shapes, with the optimization that worked. Indexed by tag; loaded at start of each run as candidate exemplars.
- `.codeoz/memory/prompter/principles/` — durable rules learned across many runs ("for non-technical users, restated request must avoid these five technical terms unless they were in the original"). The principles file is short and reviewed by the user before any new entry lands; this is the human-in-the-loop guardrail.

Memory hygiene rules from the maestro doc still apply: one topic per file, files under 200 lines, tags for retrieval, monthly compaction.

### Cross-family review of the prompter itself

The prompter is a model talking to a model; sycophancy and hallucination apply just as they do to the BA, the Lead, or any other persona. The cross-family review rule from CLAUDE.md (rule 2 and rules 7–10) extends to the prompter:

- The Codex sub-agent reviews INTENT.md before the gate fires for runs flagged as high-risk (greenfield, large scope, or low-confidence tier-1 output).
- For low-risk runs, the review is sampled (every Nth run) to keep latency low.
- The Codex review's mandate matches the maestro's adversarial-review discipline: "find the strongest counterexample to this restated request" rather than "approve."

### Configuration

New section in `.code-oz/config.yaml`:

```yaml
phases:
  prompter:
    enabled: true
    tier: lightweight   # 'lightweight' | 'deep'
    maxClarifyingQuestions: 1
    skillLibrary:
      retrievalTopK: 5
      similarityThreshold: 0.65
    crossFamilyReview:
      mode: sampled     # 'every' | 'sampled' | 'high-risk' | 'off'
      sampleRate: 0.2
    designer:
      schedule: 'on-demand'  # 'on-demand' | 'nightly'
      retainLastNRuns: 50
```

### CLI surface

- `code-oz run` runs the prompter by default.
- `code-oz run --no-prompter` skips DEFINE-0 and goes straight to DEFINE (escape hatch for users who write their own briefs).
- `code-oz run --deep` enables tier-2 optimization.
- `code-oz reflect` runs the designer over the last N runs and updates the exemplar library.
- `code-oz prompter status` shows current exemplar count, last-reflection timestamp, retrieval-hit-rate stats.

## Integration with the existing milestone plan

This is not an M5 expansion. M5 is locked, Codex has signed off, the SPEC contract is staged. Adding the prompter inside M5 would re-open the planning round and delay shipping the spine.

The right slot is W2 (post-MVP polish), after M7 closes the spine. By then:

- The full DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP loop is running offline with FakeProvider.
- M5's BA persona is the source of truth for intent elicitation, and we have data on where it falls short.
- M6's PLAN-phase three-source verification surfaces which BA outputs lacked grounding, which is direct training signal for the prompter.

W2 milestone shape (rough, gets refined in the planning round):

- Commit 1: pin the INTENT.md contract and phase semantics. `docs/contracts/INTENT.md`, `docs/references/intent-contract.md`, the schema and gate definition.
- Commit 2: the prompter persona file and bundled exemplars (3–5 hand-written exemplars for cold start).
- Commit 3: `src/phases/prompter.ts` orchestration. Tier 1 only.
- Commit 4: gate writer integration; INTENT.md atomic write; intent-locked gate semantics.
- Commit 5: `src/state/` event types for the prompter (intent_started, intent_completed, intent_clarifying_question).
- Commit 6: integration with `src/commands/run.ts`; the new `--no-prompter` and `--deep` flags.
- Commit 7: the designer job; `code-oz reflect` command; skill-promotion logic.
- Commit 8: cross-family review hook; sampled Codex review of INTENT.md.
- Commit 9: tests with FakeProvider; deterministic transcript fixtures for the prompter; designer regression tests.
- Commit 10: docs and help updates; tag `v0.7.0-alpha.0`.

A pre-W2 mini-experiment is worth running during M6 or M7: collect the SPEC.md drafts produced by the BA in the canned transcripts, hand-write what an INTENT.md should have looked like for each, and check whether the BA's actual ask-me loop would have converged faster with the hand-written INTENT.md as input. If yes, W2 is justified. If no (the BA already does fine without an upstream prompter), the design is over-engineered and should be cut.

## What to debate with Codex before code lands

The shape below is the substance of what would become `CODEX_BRIEFING_W2_PROMPTER.md` if the user adopts this proposal. Each prompt is structured the same as M2/M3/M4/M5: lean + reasoning + counter-argument I am aware of.

Prompt 1: tier-1 vs. tier-2 default. Lean: tier-1 only in v0.1, tier-2 behind a flag. Reasoning: tier-1 is fast, predictable, and integrates with the existing single-call wrapper. Tier-2 (DSPy MIPRO compile) introduces a second loop that complicates budget enforcement. Counter: tier-2 is where the published gains live (DSPy 46% → 64% in arXiv:2507.03620). Punting it forever is a mistake.

Prompt 2: should the prompter ask any clarifying question, or zero? Lean: at most one. Reasoning: the BA already has an ask-me loop; making the prompter ask too is redundant and confusing. Counter: zero clarifications means the prompter must guess on ambiguous inputs, which violates verify-before-assert. The compromise is one question, only when the intent is genuinely binary-ambiguous in a way memory cannot resolve.

Prompt 3: is INTENT.md a separate artifact from SPEC.md, or does it become a section of SPEC.md? Lean: separate. Reasoning: separation lets the BA's voice own SPEC.md while the prompter's voice owns INTENT.md; the artifacts have different audiences (BA reads INTENT, user reads SPEC). Counter: two artifacts double the maintenance surface and risk drift between them. The fix is to require the BA to cite INTENT.md sections in SPEC.md, not to merge.

Prompt 4: who runs the cross-family review of INTENT.md? Lean: Codex, sampled. Reasoning: Claude wrote INTENT.md, so Claude reviewing it is intra-family and accumulates sycophancy risk. Counter: every Codex call costs latency and money; for trivial requests the review is over-engineering. Sampled review with a high-risk override resolves the cost concern.

Prompt 5: skill-library retrieval algorithm — embeddings or tags? Lean: tags first, embeddings later. Reasoning: tag-based retrieval is deterministic, auditable, and cheap; matches code-oz's current memory model. Counter: tags miss near-synonyms (the user says "a counter app," memory has "tally tracker"). The middle ground is tags as the primary index, with embedding-based fallback for low-recall tag queries.

Prompt 6: designer schedule — on-demand or scheduled? Lean: on-demand for v0.1. Reasoning: scheduled jobs add infrastructure (cron, launchd, GitHub Actions) and operational surface. On-demand keeps everything in the user's flow. Counter: on-demand means the designer never runs unless the user remembers to invoke it, and the skill library stagnates. The W2 ship-it answer is on-demand with a `code-oz status` reminder when the last reflection is older than N runs.

Prompt 7: privacy of the intents log. Lean: the prompter's intent log lives under `.codeoz/state/runs/<runId>/` (already gitignored by `init.ts`). Reasoning: matches M3's existing privacy model. Counter: the intents log may contain user PII (names, emails, business specifics); the privacy model should be explicit per CLAUDE.md rule 13. The fix: document the privacy implication in the intent-contract reference and add a `--scrub-intents` flag for users who want PII-redacted logs.

Prompt 8: how does the prompter handle the user who really does not want help? Lean: `--no-prompter` is the escape hatch. Reasoning: power users want to write their own briefs; forcing them through the prompter is paternalism. Counter: opting out defeats the milestone's purpose for non-experts. The flag is fine for opt-in users; the prompter stays default-on.

Prompt 9: how does the prompter avoid sycophancy in its own output? Lean: forbid affirmative and enthusiastic language in the persona body, plus cross-family review on a sample. Reasoning: matches the discipline in `llm-failure-research.md` family 13. Counter: this is a behavioral rule, and behavioral rules are leaky; some structural mechanism is stronger. The structural fix to consider: have the prompter output a confidence score for each inferred constraint, and route low-confidence outputs to clarification automatically.

Prompt 10: does the designer modify the prompter persona body, or only the exemplar set? Lean: only the exemplar set. Reasoning: persona body changes are user-visible and need explicit review; exemplar changes are recoverable and bounded. Counter: long-term, the persona body itself is what the model attends to most; never updating it caps the system's improvement. The compromise: persona body changes are proposed by the designer as PRs the user reviews, never auto-applied.

## Acceptance criteria for the milestone

A version of W2-Prompter ships when:

- The full DEFINE-0 → DEFINE flow runs end-to-end on the M5 canned transcripts, with the prompter producing a valid INTENT.md and the BA's ask-me loop converging in fewer rounds on average than M5's baseline.
- The designer demonstrably promotes a (raw, INTENT) pair into the exemplar library after a successful run; the next run on a similar request retrieves and uses the exemplar.
- A new transcript fixture for "vague non-technical user" (the canonical Johnny case) lands in `tests/fixtures/transcripts/`, and the prompter's INTENT.md for that fixture matches a hand-graded gold standard.
- Cross-family review of INTENT.md by Codex is wired in, sampled at 20%, and demonstrably catches at least one introduced fault in a regression test (a deliberately bad INTENT.md that the Codex reviewer should reject).
- The `--no-prompter` flag works and routes straight to DEFINE.
- The whole flow runs offline with FakeProvider; no live calls in the test suite.
- The privacy posture of the intents log is documented in `intent-contract.md` and the `--scrub-intents` flag is implemented.

## Open research questions worth tracking

These do not block the milestone; they shape the follow-up work.

The exemplar-cold-start problem. The prompter is most useful after dozens of runs have populated the exemplar library. In the first few runs, the library is sparse and the prompter is essentially a hand-written persona with no retrieval boost. How small can the cold-start library be while still giving useful retrieval? Voyager handles this with hand-authored skills as a base layer. We should ship 5–10 hand-written exemplars covering the canonical user shapes (vague non-technical, technical-but-underspecified, brownfield-audit, etc.) and accept that the early runs are persona-only.

The over-fitting problem. If the designer always promotes "what worked," the exemplar library converges on the user's recent project shape and stops generalizing. MemAPO addresses this by reframing prompt knowledge as cross-task; we need a similar mechanism. Concretely: tag exemplars with project type, retrieve only same-type exemplars, and require a cross-type review every M runs to flag an exemplar set that has narrowed too much.

The trust transfer problem. The user is teaching their friends to use this. The friends need to trust the prompter, which means the INTENT.md must be readable by them, and any inferred constraint must be obvious to them. We should test the INTENT.md format with non-technical readers before shipping.

The model-version drift problem. Voyager and MemSkill both depend on the LLM behaving consistently across the controller-executor-designer loop. Model upgrades change behavior mid-deployment. code-oz's existing CLAUDE.md rule 4 (Opus default; warn on downgrade) helps, but the prompter is more sensitive than other personas because its job is shaping prompts that the executor depends on. A model-version-tagged exemplar (so a 4.7-trained exemplar is only retrieved for 4.7 runs) is a reasonable mitigation; the cost is library fragmentation across model versions.

The cross-family-prompter question. We use Codex to review what Claude wrote. Should the prompter itself also exist as a Codex variant, used on certain types of requests where Codex's training distribution is a better fit? The answer is probably yes for code-heavy non-technical requests ("build me a todo app"), no for domain-heavy non-technical requests ("plan a curriculum"). A per-request router that picks the prompter family is a W3+ feature.

## Citation index

By layer, ordered roughly by relevance to code-oz.

- Foundation problem:
  - Zamfirescu-Pereira et al., "Why Johnny Can't Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts," CHI 2023, ACM 10.1145/3544548.3581388. Non-experts approach prompting opportunistically, use H2H instructional analogies, overgeneralize.

- Intent classification and clarification:
  - Liu et al., "Curiosity by Design: An LLM-based Coding Assistant Asking Clarification Questions," arXiv:2507.21285, 2025. Intent-clarity classifier; defers code generation if under-specified; fine-tuned model outperforms zero-shot for clarification quality.
  - APE, "Adaptive Prompt Elicitation for Text-to-Image Generation," arXiv:2602.04713, IUI 2026. Information-theoretic interactive intent inference.
  - "Clarifying Ambiguities: on the Role of Ambiguity Types in Prompting Methods for Clarification Generation," arXiv:2504.12113, 2025. Ambiguity taxonomy.

- Prompt rewriting and synthesis:
  - Chen et al., "Conversational User-AI Intervention: A Study on Prompt Rewriting for Improved LLM Response Generation," arXiv:2503.16789, 2025. Rewriting suboptimal prompts elicits better responses; outputs include degree of modification, aspects of improvement, assumptions.
  - Murthy et al., "Promptomatix: An Automatic Prompt Optimization Framework for Large Language Models," Salesforce AI Research, arXiv:2507.14241, 2025. Two-tier design: meta-prompt-based + DSPy-powered.
  - Xu and Davis, "PromptTailor: Multi-turn Intent-Aligned Prompt Synthesis for Lightweight LLMs," Whitman College, arXiv:2511.21725, 2025. Intent-aligned expansion preserving stated preferences.

- Optimizer frameworks:
  - Khattab et al., DSPy framework. Treats prompts as learnable parameters compiled from declarative programs.
  - "A Comparative Study of DSPy Teleprompter Algorithms," arXiv:2412.15298, 2024. MIPRO, COPRO, BootstrapFewShot variants compared.
  - "Is It Time To Treat Prompts As Code? A Multi-Use Case Study For Prompt Optimization Using DSPy," arXiv:2507.03620, 2025. DSPy raised accuracy 46.2% → 64.0% on prompt evaluation tasks.

- Self-evolving skills and memory:
  - Wang et al., "Voyager: An Open-Ended Embodied Agent with Large Language Models," arXiv:2305.16291, NeurIPS 2023. Skill library of executable code with self-verification before commit; iterative prompting with environment feedback.
  - Zhang et al., "MemSkill: Learning and Evolving Memory Skills for Self-Evolving Agents," arXiv:2602.02474, 2026. Controller-Executor-Designer loop.
  - Memento-Skills (VentureBeat coverage 2026-04). Reusable skills as Markdown files; Read-Write Reflective Learning loop; 13.7-point GAIA gain over static library.
  - "Generalizable Self-Evolving Memory for Automatic Prompt Optimization (MemAPO)," arXiv:2603.21520, 2026. Reframes APO as experience-accumulation problem.

- Orchestration:
  - OpenAI Cookbook, "Self-Evolving Agents — A Cookbook for Autonomous Agent Retraining," 2025-11-04. Three escalating optimization patterns culminating in GEPA (Genetic-Pareto framework).
  - "Learn Like Humans: Use Meta-cognitive Reflection for Efficient Self-Improvement (MARS)," arXiv:2601.11974, 2026. Converts agent failures into principled-and-procedural instructions.
  - "The Meta-Prompting Protocol: Orchestrating LLMs via Adversarial Feedback Loops," arXiv:2512.15053, 2025. Adversarial self-improvement with strategy refactoring.

- Background and related:
  - Shinn et al., Reflexion (arXiv:2303.11366, 2023). Verbal feedback in context window.
  - Zhao et al., ExpeL (2024). Lessons via keyword matching.
  - Wu et al., Meta-Reflexion (2025). Distills reflections into rules.
  - Wang et al., AutoAgent (2026). Elastic memory with evolving cognition.
  - Schmidhuber, Gödel machines (2007). Theoretical foundation for self-referential self-improvement.

## End of dossier

The prompter is a small structural addition that lets non-expert users get the benefit of code-oz's spine without the prerequisite of being a prompt engineer. The research base is mature; the design is conservative; the milestone fits in W2 without disrupting the M5–M7 sequence Codex has already approved.

The single most important property of the design: the prompter is a separate persona with its own artifact and gate. It is not a hidden pre-processing step inside DEFINE. That separation is what lets it be reviewed, audited, evolved, opted out of, and improved over time. It also lets the user explain the system to their friends in one sentence: "type whatever you want; the prompter will turn it into a brief; you can read the brief before the BA starts; you can rewrite the brief if it got something wrong."

If this proposal is adopted, the next steps are: (1) run the M6 / M7 mini-experiment to confirm the BA falls short on Johnny-shaped inputs; (2) write `CODEX_BRIEFING_W2_PROMPTER.md` from the ten prompts above; (3) run the planning round; (4) merge the verdict into the W2 commit sequence; (5) implement.
