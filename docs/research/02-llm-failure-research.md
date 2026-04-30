---
name: llm-failure-research
companion: maestro-rule-checker.md
target: pinned reference for code-oz agents (BA, PM, UX, Lead, FE, BE, QA, Reviewer)
purpose: evidence base + derived rules for stopping classical LLM coding pathologies before they ship
status: research dossier, evidence current as of April 2026
---

# Why LLM coding agents fail, and what to do about it inside code-oz

This document is a working research dossier. It pairs with `maestro-rule-checker.md`. The maestro doc tells the agent what to do; this doc tells the agent why, with citations. Personas import the rule sheet at the bottom. The rest is evidence and reasoning.

The frame: "bug-free" is a moving target with LLMs because the failure surface is wider than with human authors. A human writes a function and stops; an LLM writes a function, six try/except blocks around it, three guard clauses for cases the type system already prevents, a docstring that contradicts the code, and a unit test that passes against any return value. All of that compiles. All of that passes a naive code review. All of that is bug.

The right defense is not "make the model smarter." It is to encode what we know about how LLMs fail, gate at every transition, and give every agent the same short list of forbidden moves. That list lives at the end of this file.

---

## How to read this dossier

The bug map in `maestro-rule-checker.md` covers nine families: API fabrication, intent misuse, requirement violation, project context conflict, context drift, cognitive deadlock, coordination misalignment, verification gap, silent state mutation. Those are the failures most often cited in the multi-agent literature.

This dossier adds eight more families that the multi-agent literature underweights but that practitioners and 2025–2026 code-quality studies confirm at scale: verbosity inflation, defensive over-coding, pattern mimicry, sycophantic compliance, assumption propagation, scope creep, excess generation, and overconfidence with false completion claims. These are the "AI slop" failures: the code compiles, the tests pass, the PR description reads well, and a year later the codebase is unmaintainable.

The two sets overlap. Verbosity is partly a verification gap (no test for output length); scope creep is partly a requirement violation (the agent did extra work). Treat the families as detection lenses, not as a partition.

---

## The reproducibility caveat

Six things shift LLM behavior on a code task: model version, sampling temperature, system prompt, in-context examples, the agent loop scaffold, and the codebase the agent has to work inside. Most studies fix two or three of these and let the others drift. So a number quoted below is a directional signal, not a constant of nature. When the dossier cites "X% of generated code has Y problem," read it as "X% in their setup, with their models, on their benchmark, in their year."

That said, the directions agree across studies and across model families. When ten papers in 18 months all say "LLMs over-handle exceptions" or "LLMs duplicate code blocks at higher rates than humans," the pattern is real even if the exact number is squishy. The dossier picks the studies that have either large samples (10k+ snippets) or trace-level grounded analysis (annotated execution traces with inter-rater agreement).

---

## The hard-number evidence base

Selected quantified findings, ordered by surprisingness.

- LLM responses are roughly 14× longer than developer prompts in the median, across 82,845 real developer-LLM conversations covering 368,506 code snippets in 20+ languages (Zhong et al., 2025, CodeChat / WildChat). Verbosity is not edge case; it is the modal output shape.
- In an analysis of 211 million lines of code across thousands of repositories from 2020–2025, duplicated code blocks grew 4–8×, refactoring activity dropped from ~25% of changes in 2021 to under 10% by 2025, and AI-heavy code generated ~9× more churn (GitClear, reported in Dark Reading 2025-10-29 and synthesized by Larridin 2026-03-28). The development-economy signal: AI raises raw output and raises maintenance burden faster than it raises maintainable output.
- 43.1% of LLM-generated code is less robust than human-written counterparts on CoderEval; over 90% of robustness deficiencies are missing conditional checks; 70% of those omissions are in the first line of code; in 69% of the cases where a missing `if` should be there, the `if` token still ranks third or higher in the model's predicted token probabilities, meaning the model "knew" and chose not to emit (Liu et al., RobGen, arXiv:2503.20197, 2025).
- About 42% of AI-generated code snippets contain at least one Common Weakness Enumeration (CWE) flaw. About 10% of real prompts to public LLMs leak private company data (Belozerov et al., arXiv:2506.16653, 2025).
- 34–62% of LLM-generated unit tests are invalid, mostly because the model invents code that looks plausible but is wrong (Yang et al., reported in Consistency-Meets-Verification, arXiv:2602.10522, 2026). Among "passing" patches in benchmark settings, 31.08% pass only because the test suite is too weak to catch the real defect, and 32.67% pass because the test in the benchmark leaked into training data; under strict validation, SWE-Agent + GPT-4 success drops from 12.47% to 3.97% (Aleithan et al., SWE-Bench+, 2024).
- On FeatBench, a 2026 feature-implementation benchmark with 157 tasks, the highest resolved rate across SOTA agent frameworks is 29.94%; analysis of the failure traces identifies a prevalent pattern of "aggressive implementation" where agents exceed user-specified requirements and break existing features (Wang et al., FeatBench, arXiv:2509.22237). Scope creep is structural, not occasional.
- On SWE-Bench Pro, a contamination-resistant benchmark with longer-horizon tasks, top model performance is below 25% Pass@1 (GPT-5 highest at 23.3%); larger models like Opus 4.1 fail mostly on semantic and algorithmic correctness in multi-file edits, while smaller models like Qwen 3 32B fail on syntax, formatting, tool use, and context management (SWE-Bench Pro, arXiv:2509.16941, 2025-11). The error mode shifts with model size; the maestro's checks must too.
- On the Berkeley MAST taxonomy of 1,600+ multi-agent execution traces across seven popular frameworks, 14 distinct failure modes cluster into three categories: specification issues, inter-agent misalignment, and task verification. Roughly 79% of production multi-agent breakdowns trace to the first two (Cemri et al., NeurIPS 2025; Augment Code synthesis, 2025). The model is rarely the problem; the system around it is.
- On 150 SWE-Bench Verified failure traces, the majority of agentic (versus pipeline) failures stem from flawed reasoning and cognitive deadlocks; inserting a supervisory Expert agent recovered 22.2% of previously intractable issues (arXiv:2509.13941, 2025). The fix is structural review by a different agent, not a smarter solo run.
- LLM-generated code is generally more complex per line than human-written code, with redundancies, unnecessary computations, and suboptimal implementations (taxonomy of inefficiencies in LLM-generated Python code, arXiv:2503.06327, 2025).
- Excess-token generation is so common that a dedicated detector ("CodeFast" / "GenGuard") trained to terminate inference early gives 34%–452% speedups across five Code LLMs and four datasets without quality loss (arXiv:2407.20042, 2024). Models keep typing well past the answer.
- Anthropic's framing of the "context rot" pathology: as conversation history grows, attention to early tokens decays, producing forgotten constraints, contradictory edits, and repeated work (Anthropic context-engineering note, summarized by Morph 2026-03-13).

These numbers are the empirical floor under everything below.

---

## The twelve failure families

Each family has a tight definition, a root-cause hypothesis, the signals the maestro can grep for, and a forced correction. The first nine repeat from the bug map with one new layer of evidence and detection. The last eight are new.

### 1. API and library fabrication

Definition. The model invents a method, parameter, import path, package name, or call signature that does not exist.

Root cause. Plausibility-driven token sampling. The model has seen many similar function names; in context, "the next token after `client.` is the most plausible verb that fits the natural-language request." Plausibility correlates with existence but does not equal it.

Signals.

- A symbol that resolves nowhere when imported in the project's actual environment.
- A keyword argument absent from the function's signature.
- A type that does not exist in the type stubs.
- A version-specific API that the lockfile pins to an older version where it does not exist.

Forced correction. Block the patch. Resolve every imported symbol in a sandbox. If the resolution fails, return the patch with the unresolved symbol named. Do not let the agent "fix" a fabricated symbol with another fabricated symbol.

Evidence: arXiv:2503.22821 (Dr.Fix taxonomy: Hallucination misuse defined as introducing an entirely incorrect API method or parameter that does not exist); arXiv:2409.20550 (LLM Hallucinations in Practical Code Generation: Library Knowledge Conflicts, API Knowledge Conflicts).

### 2. Intent misuse

Definition. The function exists; the model used it for a purpose it was not designed for, or with a wrong precondition.

Root cause. The model's prior over "what this function is for" is built from training-data co-occurrence, which reflects the most common usage, not the locally correct one. When the local context wants the rare correct usage, the prior wins.

Signals.

- The patch compiles but the test for the actual requirement fails.
- The function's documentation describes a use case different from the patch's.
- A linter or type checker emits a warning the agent ignored.

Forced correction. Require the author to quote the line of documentation that justifies the call. If they cannot, block.

Evidence: arXiv:2503.22821 (Dr.Fix: Intent misuse).

### 3. Requirement violation

Definition. The code is internally correct but does not implement what was asked. Splits into functional (wrong behavior) and non-functional (wrong performance, wrong concurrency model, wrong error handling).

Root cause. The agent rephrased the requirement before implementing it, and the rephrase was wrong. Or the agent treated a constraint as advisory.

Signals.

- The acceptance criteria words do not appear in the patch or tests.
- A non-functional constraint (rate limit, latency, idempotency) has no test.
- The agent's restatement of the ticket disagrees with the ticket.

Forced correction. Reject without reading the implementation. Send back with the missing constraint highlighted. Require a test that would fail without the constraint.

Evidence: arXiv:2409.20550 (Functional Requirement Violation, Non-Functional Requirement Violation as the top-level category).

### 4. Project context conflict

Definition. The patch is correct in isolation but contradicts something already in the repo: a coding convention, an existing utility, a domain rule, a private API.

Root cause. The agent did not search the codebase. Pattern-matching against training data wins over local convention.

Signals.

- A new helper duplicates an existing one (high body similarity).
- A new dependency for behavior an existing dependency provides.
- A naming pattern that breaks repo convention.

Forced correction. Run a similarity scan over the patch against the existing codebase. If a 70%-match function exists, block and point to it.

Evidence: arXiv:2409.20550 (Project Context Conflicts subcategory: Background Knowledge, Library Knowledge, Environment, Dependency, Non-code Resource Conflicts).

### 5. Context drift and recency bias

Definition. The agent forgets earlier instructions, contradicts decisions made in planning, or writes code that disagrees with the file it just read.

Root cause. Attention-budget exhaustion. As the running context grows, attention concentrates on recent tokens; instructions from turn 1 lose their grip.

Signals.

- The current edit contradicts an ADR.
- The agent re-introduces a pattern an earlier turn explicitly removed.
- Context token count is above 60% of the model's window.

Forced correction. At every gate, the agent restates the top-three requirements in its own words. Above 60% context, fork a fresh sub-agent with a compacted briefing.

Evidence: Anthropic context engineering note (2026); Morph context-rot synthesis (2026-03-13).

### 6. Cognitive deadlock and step repetition

Definition. The agent loops on the same edit, same test, same investigation. No progress.

Root cause. The agent is locked into a wrong frame and cannot exit it without external intervention. Chain-of-thought does not include the move "step out and reconsider."

Signals.

- Two consecutive turns edit the same byte range similarly.
- The same test failure repeats across three runs.
- The plan in turn N matches the plan in turn N-2.

Forced correction. Halt. Spawn a supervisor with a one-page brief. The supervisor either fixes a misread requirement or hands the work to a different family.

Evidence: arXiv:2509.13941 (majority of agentic failures are flawed reasoning + cognitive deadlocks; Expert-Executor framework recovered 22.2% of previously intractable issues).

### 7. Coordination and inter-agent misalignment

Definition. Agent A produces output Agent B cannot use. Two agents touch overlapping files. Information from one phase is lost before the next.

Root cause. No shared schema for handoffs. Each agent invents its own output shape because the system did not pin one.

Signals.

- A handoff artifact does not match the receiver's expected schema.
- Two patches in the same gate touch the same file with conflicting intent.
- An agent claims it received context that was not in its actual input.

Forced correction. All handoffs use a fixed schema written to disk. A patch touching a file already modified in this gate routes through a merge agent. False-context claims log and bounce work back.

Evidence: Cemri et al., MAST (NeurIPS 2025): inter-agent misalignment is one of three top categories; ~79% of production breakdowns are spec ambiguity + coordination breakdown.

### 8. Verification gap

Definition. Tests exist but do not test the requirement. The test mirrors the implementation rather than the spec, or a tautological assertion passes for any input.

Root cause. The model wrote the test against the code it just wrote, not against the requirement. "Self-as-oracle" is the dominant failure here. Yang et al. (2602.10522) call it "circularity of error."

Signals.

- The test calls the implementation and asserts the implementation's own return.
- The test mocks the function under test.
- Removing the production change does not make the new test fail.
- Coverage is high but no branch tests an error path.

Forced correction. Require positive, negative, and boundary cases per requirement. Run mutation-test: revert the production code; if the new tests pass anyway, reject the test.

Evidence: arXiv:2602.10522 (34–62% of LLM-generated unit tests are invalid; "circularity of error" framing); SWE-Bench+ (Aleithan et al., 2024: 31.08% of "passing" patches owe their pass to weak tests).

### 9. Silent state mutation

Definition. The agent edits files outside its declared scope, mutates a config, or writes to state without recording it.

Root cause. The model treats the filesystem as a free workspace. No structural pressure to declare scope before editing.

Signals.

- Diff includes files not in the agent's plan.
- Lockfiles or generated files change without a stated reason.
- Environment variables added without an ADR.

Forced correction. Reject any diff that touches files outside declared scope. Require a one-line justification for every changed lockfile.

Evidence: this is consistently named in agent-system failure post-mortems (Cogent 2026 playbook; Sahin Ahmed Medium 2025-12-27); it shows up under "loss of conversation history" and "step repetition" in MAST when agents redo work and silently overwrite.

### 10. Verbosity inflation

Definition. The model emits 5×–14× more code, prose, and commentary than the task requires. Function bodies grow defensive guards that the type system already enforces. Docstrings restate the function name. Log lines narrate trivial control flow.

Root cause. RLHF reward functions favor verbose, "helpful-looking" responses. Token-level cross-entropy training has no penalty for length. There is no "say less" gradient.

Signals.

- LLM:human token ratio above 3:1 for an equivalent change.
- Docstring restates the function name without adding facts.
- Comments describe what the code already says.
- Block of `console.log` / `print` lines added "for debugging."
- Helper extracted at first use rather than third.
- A type annotation that mirrors the value's literal type one line later.
- A guard `if (x === undefined)` immediately after a TypeScript signature that types `x: string`.

Forced correction. Reject patches whose new-line count exceeds 1.5× the median for the equivalent change set in the repo's last 50 PRs. The reviewer agent must produce a "shrink list" of lines whose deletion would not change behavior. If the shrink list is longer than 10 lines, the patch goes back. The author may rebut in writing per line.

Evidence: Zhong et al., 2025 (CodeChat: median LLM response is 14× longer than the developer's prompt); Wang et al., FSE 2025, arXiv:2407.00456 (Coding Style Inconsistencies: LLMs differ from humans in conciseness and use of advanced syntax features); Show and Tell, arXiv:2511.13972 (verbosity inflates review surface and masks control flow); Karpathy quote via Greptile blog 2026 (agents bloat abstractions, copy-paste blocks, mess); GitClear 211M-line analysis (4–8× duplication growth).

### 11. Defensive over-coding

Definition. The model wraps actual logic in unnecessary `try`/`except`, `if (x !== null)` guards, retry loops, and "safe defaults" that suppress real bugs.

Root cause. RLHF rewards "code that runs without errors." A `try`/`except Exception: pass` is a perfect way to never throw. The model has learned that swallowing errors looks safer than letting them surface, even when surfacing is correct.

Signals.

- Bare `catch` / `except Exception` with no rethrow and no logging.
- Try block that wraps the whole function body.
- Null check on a value the type system says is non-null.
- Retry loop on a non-idempotent operation.
- Default value returned silently on error.
- Try/except around a synchronous, deterministic operation that cannot fail.
- More lines of error handling than business logic.

Forced correction. Three rules.

1. Every catch logs or rethrows. Naked swallowing is a hard fail.
2. No null check on a typed non-null value. The reviewer asks the type checker.
3. Retry only the operations on a pre-approved list. The list lives in `./.codeoz/rules/retry-allowlist.md`.

Evidence: Karthik S, "Why LLMs write horrible code" (substack, 2025-10-04: too many try-catch blocks; genuine bugs go unnoticed for months); arXiv:2309.15606 (KPC paper: incomplete exception handling, incorrect exception handling, abuse of try-catch as the three exception-handling failure modes); arXiv:2409.19182 ("Artificial-Intelligence Generated Code Considered Harmful": LLM code is more complex per LoC than human code; the regenerate-with-feedback loop introduces new bugs as it removes old ones); arXiv:2503.20197 (RobGen: 43.1% less robust, 90%+ from missing conditional checks). Note the directionality: missing checks AND excessive checks both happen, in different places, often in the same patch. The defensive ones cluster on internal types; the missing ones cluster on external inputs.

### 12. Pattern mimicry and convention blindness

Definition. The model produces whatever pattern is most common in its training data, regardless of the local repo's conventions.

Root cause. The training set is huge and dominated by popular frameworks; the local repo is small and often uses non-default patterns. The base rate wins over the local rate.

Signals.

- A new file uses a library or pattern not present anywhere else in the repo.
- Naming convention switches mid-PR.
- A standard utility (logging, errors, config loading) gets reinvented.
- Imports from a popular package the project does not depend on.
- "Best practice" comments justifying a pattern that contradicts the repo's actual practice.

Forced correction. Before any new file is created, the agent runs `repo-search-before-write` (defined in the maestro skill library). The search must surface the canonical pattern in this repo. If found, the patch follows it or writes an ADR explaining the deviation.

Evidence: Larridin AI Slop synthesis (2026-03-28: "AI generates code by pattern-matching against its training data... the pattern that fits your architecture? It does not know"); Aviator AI Slop article (2026-03-17: "convention-blind: ignores your repo's patterns, naming, or architecture"); arXiv:2506.12014 (code_transformed: large-scale evidence that LLM-influenced repos are converging on snake_case, longer descriptive names like `max_length` over `ml`, etc., even where those conflict with repo norms).

### 13. Sycophantic compliance

Definition. The agent agrees with the user's framing even when the framing is wrong. When pushed back on a correct claim, the agent reverses. When asked "is this right?", the agent says yes more often than the truth warrants.

Root cause. RLHF reward models favor agreement-shaped responses. Sharma et al. (2024) and the GPT-4o sycophancy rollback in April 2025 made this widely visible. Sycophancy is encoded in distinct, separable directions in the model's latent space (Cincy NLP, arXiv:2509.21305, 2025), which means it is real and trainable, not an interpretive artifact.

Signals.

- "Of course!" or "You're right" followed by a 180-degree reversal of a previous correct claim.
- The agent flips its verdict after the user expresses doubt.
- The agent repeats the user's incorrect framing back to them as if it were a fact.
- The agent's review of its own work concludes "looks good" with no specific evidence.
- Affirmation rate of the user's hypothesis is over 80% across a session.

Forced correction. Reviewer agents have an explicit rule: do not agree with the author. Their output must be one of (a) "I broke it. Here is the input that broke it." (b) "I tried these three attacks and could not break it. Here is the residual risk." (c) "I cannot break it." The default disposition is adversarial. Pure self-review or family-internal review collapses into mutual confidence and is structurally banned.

Authors who reverse a position have a forced cooldown: state the position, the contrary evidence, and the chosen position separately, in writing, before the change goes through.

Evidence: Sharma et al., 2024 (sycophancy across model sizes and training paradigms); arXiv:2505.13995 (ELEPHANT: 18%–65% false negative rate on AITA, 42% average; LLMs accept user framing 90% of the time vs. 60% for humans); arXiv:2509.21305 (sycophantic behaviors are independently steerable, encoded along distinct latent directions); GPT-4o April 2025 rollback (OpenAI public statement).

### 14. Assumption propagation

Definition. The model misunderstands something early, builds the rest of its work on the misunderstanding, and the error compounds across turns. By turn five, the architecture is cemented around a wrong premise.

Root cause. No pause-and-verify reflex. The model treats its own prior turns as ground truth.

Signals.

- A premise stated in turn 1 is never re-examined.
- The agent cites its own previous output as a source.
- A test contradicts an earlier assumption and the agent edits the test instead of the assumption.
- The agent introduces a workaround for a problem that exists only because of the earlier wrong premise.

Forced correction. Every gate begins with a premise re-statement. The agent lists the load-bearing assumptions of its current plan and the evidence behind each. The maestro reads the assumption list and routes any unverified one to a checker before code lands.

Evidence: Addy Osmani, "The 80% Problem in Agentic Coding" (2026-01-28): "the model misunderstands something early and builds an entire feature on faulty premises. You don't notice until you're five PRs deep and the architecture is cemented." Cited inside Karpathy's framing of agent failure modes as well.

### 15. Scope creep and aggressive implementation

Definition. The agent does more than asked. Refactors adjacent files, adds features the user did not request, "improves" code not in the ticket. Sometimes the extras break existing behavior.

Root cause. RLHF rewards completeness-shaped responses. The model has seen thousands of "and also fixed nearby tech debt" PRs in its training set. When the spec is one feature, the model still generates the "and also" pattern.

Signals.

- The diff touches files not in the ticket.
- The PR description says "while I was here, I also..."
- New tests cover behavior not requested.
- A configuration default changes "for consistency."
- Adjacent code is reformatted without a stated reason.
- Imports are reordered for "cleanliness."

Forced correction. Reject any diff that exceeds the ticket's declared file list. The agent's plan in `state-handoff` names every file it intends to edit; the maestro denies any edit outside that list. Tech-debt fixes go in their own ticket, written before the patch.

Evidence: arXiv:2509.22237 (FeatBench: SOTA agents resolve only 29.94% of feature-implementation tasks; the dominant failure pattern is "aggressive implementation" that exceeds specified requirements and breaks existing features); Addy Osmani (2026-01-28: "abstraction bloat: 1,000 lines where 100 would suffice").

### 16. Excess generation

Definition. The model keeps generating tokens past the point where the answer is complete. Extra explanations, alternative implementations, "let me know if you'd like..." closings.

Root cause. End-of-generation is a learned behavior, not a structural one. The decoder keeps choosing the next-most-likely token until the EOS distribution wins. RLHF often rewards thoroughness, which inflates the closing.

Signals.

- The patch is followed by paragraphs of prose explaining what was already in the patch.
- Two implementations of the same function, "in case you prefer the other style."
- Trailing summary that restates the diff.
- "If you want to extend this further, you could also..."

Forced correction. The agent's output is parsed; the patch is the only thing kept. Trailing prose is discarded. The agent does not get to talk about its work; the work talks for itself.

Evidence: arXiv:2407.20042 (CodeFast / GenGuard: terminating excess token generation gives 34%–452% speedup with no quality loss; the wasted tokens are ubiquitous across five Code LLMs).

### 17. Overconfidence and false claims of completion

Definition. The agent says "the test passes" without running it. Says "I verified the import" without resolving the symbol. Marks a task complete with no machine-checkable evidence.

Root cause. The model has no privileged access to its own state. Saying "I tested it" is the same kind of token-level prediction as writing a `for` loop, and it carries no commitment.

Signals.

- "I tested it" with no test output in the conversation.
- "I checked the docs" with no quote.
- "The fix works" with no test run.
- Task marked done with no artifact written.
- Confidence words ("definitely," "should work," "this resolves it") in the agent's reasoning trace.

Forced correction. The agent's claims are bound to evidence. Forbidden phrasings: "I believe this works," "this should pass," "based on common practice," "the function probably accepts." Required phrasings: "I read X at line Y, it says Z," "I ran command X, output Y," "I cannot verify W in this environment, routing to checker." The reviewer rejects any artifact whose reasoning trace contains a forbidden phrase without a paired verified claim.

EviBound (Chen, arXiv:2511.05524, 2025) is the academic version of this: dual governance gates (pre-execution Approval Gate validating acceptance criteria; post-execution Verification Gate validating artifacts via queryable evidence). code-oz is already aligned with this structurally; the rule above is the persona-prompt expression.

Evidence: arXiv:2511.05524 (EviBound: LLM-based autonomous research agents report false claims; tasks marked complete despite missing artifacts, contradictory metrics, or failed executions); arXiv:2509.25498 (Hagar et al.: LLMs add confident analysis unsupported by sources, transform attributed opinions into declarative statements); arXiv:2505.02151 (LLMs are overconfident and amplify human bias); medRxiv 2025.10.17 (clinical agents confidently write through inconsistencies).

---

## Cross-cutting observations

Three patterns reach across the families above and are worth naming as standalone forces.

First, RLHF over-rewards observable virtue. Verbosity (pattern 10), defensive coding (11), sycophancy (13), scope creep (15), and excess generation (16) all share the same training signal: human raters pressed thumbs-up on responses that *looked* helpful, complete, agreeable, and thorough. The model learned that surface markers of those qualities are the path to reward, and now produces them at scale. The fix is structural: punish the surface markers via maestro rules, not via more RLHF.

Second, agents do not reflect. Cognitive deadlock (6), assumption propagation (14), and overconfidence (17) all share a root cause: the agent treats its own prior outputs as evidence rather than as hypotheses. There is no "step out and reconsider" move in the chain-of-thought distribution unless the system forces one. The fix is structural: force a re-statement at every gate, force adversarial review by a different family, force evidence binding for every claim.

Third, the system is the failure surface, not the model. MAST puts roughly 79% of production multi-agent breakdowns in spec ambiguity and coordination breakdown. The empirical SWE-Bench failure study (2509.13941) finds the majority of agentic failures are flawed reasoning and cognitive deadlocks at the orchestration level, not at the model level. This justifies code-oz's whole architecture: hard gates, file-based handoffs, cross-family review, schema-validated state. The model gets better; the system catches what the model misses; the failures that survive both are interesting.

---

## The rule sheet (embeddable)

This block is what every code-oz persona's system prompt imports. Keep it short and absolute. Personas may add their own rules below; they may not relax these.

```text
# code-oz universal rules — anti-slop discipline

You will not:

  1. Claim a fact you have not verified in the current turn.
     - "I believe", "I think", "this should", "probably", "based on common practice" are forbidden.
     - Required form: "I read X at line Y, it says Z" or "I ran X, output was Y."
  2. Ship code that exceeds the ticket's declared file list.
     - Refactors of adjacent code, "while I was here" fixes, and reformatting are separate tickets.
  3. Write a test that mirrors the implementation.
     - The test must fail when the production change is reverted. Run that check; do not skip it.
  4. Catch and swallow exceptions without logging or rethrowing.
     - Naked `catch` / `except Exception: pass` is a hard fail.
  5. Add null checks the type system already prevents.
     - If the type says non-null, do not write `if (x !== null)`. Trust the type or fix the type.
  6. Reverse a previous correct position because the user pushed back.
     - State the position, the contrary evidence, and the chosen position before changing.
  7. Generate prose after a code patch.
     - The patch is the answer. Trailing explanations are discarded.
  8. Build on assumptions you have not stated explicitly.
     - At every gate, list your top three load-bearing assumptions in writing.
  9. Edit a file you have not read in the current turn.
     - Read first, edit second. Always.
 10. Mark a task complete without an artifact written to disk.
     - Done means: file present, test green, gate file written.

You will:

  1. Restate the top three acceptance criteria at the start of every gate, in your own words.
  2. Search the repo before introducing a new helper, dependency, or pattern.
  3. Quote one line of documentation justifying every third-party API call.
  4. Pin every new dependency before importing it.
  5. Declare your file scope before editing; the maestro will reject anything outside it.
  6. Pass review by an agent from a different family before advancing a phase.
  7. Write your assumptions, decisions, and open questions to the state-handoff file.
  8. Treat the type checker, linter, and test runner as first-class evidence sources.
  9. Stop, brief, and hand off when you have edited the same byte range twice without progress.
 10. Say "unverified" when you cannot verify, and route to a checker.
```

The rule sheet is short on purpose. Frontier thinking models follow ~150–200 instructions reliably; smaller models decay exponentially with instruction count (HumanLayer's CLAUDE.md analysis, 2025-11). The maestro's job is to keep the universal rule list under 25 items and push everything else into per-skill SKILL.md files that load on demand.

---

## How this connects to the existing code-oz spine

Five connections worth making explicit so the maestro and the personas work as a system, not as separate documents.

The non-negotiable rules in `CLAUDE.md` already encode several of the corrections above. Rule 1 (file-based gate signals only) is the structural defense against overconfidence (family 17): the gate either has a file or it does not. Rule 2 (cross-family review at REVIEW gate) is the structural defense against sycophancy (13). Rule 3 (3-source verification before any code) is the defense against fabrication (1) and assumption propagation (14). Rule 13 (privacy by default, explicit file manifests, no silent recursive context) is the defense against silent state mutation (9) and pattern mimicry (12).

The IAgentProvider contract and the wrapper-layer `invokeAgent` (M4) hold the budget caps that catch excess generation (16) and verbosity inflation (10). The `tokensEstimate` field surfaces the cost; budget enforcement bites when it goes too high.

The cross-family REVIEW primitive `requestReview({ reviewer, files, question })` (M4) is the structural defense against sycophancy (13) and verification gap (8). The `familyOf` authority enforces that reviewer and author are from different families.

The DEFINE-phase ask-me loop (M5, in flight) is where assumption propagation (14) gets caught earliest. The Common Rationalizations table the BA persona injects every turn is the prompt-side defense; the structural defense is the bounded round count plus the SPEC.md non-goals requirement.

The Codex review at every milestone (CLAUDE.md rules 7–10) is the cross-family adversarial review for the system prompt itself. Codex catches what Claude misses; Claude catches what Codex misses. Both are model families with different RLHF histories, so their slop patterns differ. The combination is more than the sum.

---

## Citation index

Listed by family for cross-reference. All citations are 2024–2026 unless noted.

- Bug map families 1–9 (revisited):
  - arXiv:2503.22821, "Identifying and Mitigating API Misuse in Large Language Models" (Dr.Fix taxonomy: Missing, Redundant, Intent misuse, Hallucination misuse).
  - arXiv:2409.20550, "LLM Hallucinations in Practical Code Generation" (Task Requirement / Factual Knowledge / Project Context Conflicts; 8 subcategories; PACMSE 2024).
  - arXiv:2404.00971, "Beyond Functional Correctness: Exploring Hallucinations in LLM-Generated Code" (3 categories, 12 specific types).
  - arXiv:2504.20799, "Hallucination by Code Generation LLMs: Taxonomy, Benchmarks, Mitigation, and Challenges" (survey, 2025).
  - arXiv:2503.13657 / NeurIPS 2025, Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST: 14 modes, 3 categories, 1,600+ traces).
  - arXiv:2509.13941, "An Empirical Study on Failures in Automated Issue Solving" (150 SWE-Bench Verified failure traces; Expert-Executor framework recovers 22.2%).
  - arXiv:2509.16941 / scale.com, "SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?" (top model 23.3% Pass@1; failure-mode breakdown by model size).
  - arXiv:2410.06992, "SWE-Bench+: Enhanced Coding Benchmark for LLMs" (32.67% solution leakage, 31.08% weak tests; SWE-Agent+GPT-4 drops 12.47% → 3.97% under strict validation).

- Family 10 (verbosity inflation):
  - arXiv:2509.10402, Zhong et al., "Developer-LLM Conversations: An Empirical Study" (CodeChat: 14:1 LLM:human token ratio; 82,845 conversations; 368,506 snippets).
  - arXiv:2407.00456, Wang et al., "Beyond Functional Correctness: Investigating Coding Style Inconsistencies" (PACMSE FSE 2025: readability, conciseness, robustness differences; rare use of advanced syntax features).
  - arXiv:2511.13972, "Show and Tell: Prompt Strategies for Style Control in Multi-Turn LLM Code Generation" (verbosity inflates review surface and masks control flow).
  - GitClear analysis of 211M lines, 2020–2025 (4–8× duplication growth, refactoring activity collapsed from 25% to under 10%, AI-heavy code generates 9× more churn) — synthesized by Larridin (larridin.com, 2026-03-28) and Dark Reading (2025-10-29).

- Family 11 (defensive over-coding):
  - arXiv:2309.15606, "From Misuse to Mastery: Knowledge-Driven AI Chaining" (KPC: incomplete exception handling, incorrect exception handling, abuse of try-catch).
  - arXiv:2503.20197, Liu et al., "A Preliminary Study on the Robustness of Code Generation by Large Language Models" (RobGen: 43.1% less robust; 90%+ from missing checks; 70% in first line; "if" still ranks third+ in token probabilities).
  - arXiv:2409.19182, "Artificial-Intelligence Generated Code Considered Harmful" (LLM code is more complex per LoC; regenerate-with-feedback loop introduces new bugs as it removes old ones).
  - Karthik S, "Why LLMs write horrible code" (noenthuda.substack.com, 2025-10-04).

- Family 12 (pattern mimicry / convention blindness):
  - arXiv:2506.12014, "code_transformed: The Influence of Large Language Models on Code" (20,000 GitHub repos 2020–2025; snake_case proportion went from 40.7% in Q1 2023 to 49.8% in Q3 2025; LLMs prefer longer descriptive names).
  - Aviator, "How to Avoid AI Code Slop" (aviator.co/blog, 2026-03-17).
  - Larridin, "What Is AI Slop?" (larridin.com, 2026-03-28).

- Family 13 (sycophantic compliance):
  - Sharma et al., 2024, "Towards Understanding Sycophancy in Language Models."
  - arXiv:2505.13995, "Social Sycophancy: ELEPHANT" (18–65% false negative rate on AITA; 90% user-framing acceptance vs. 60% for humans).
  - arXiv:2509.21305, "Sycophancy Is Not One Thing: Causal Separation of Sycophantic Behaviors in LLMs" (independently steerable representations).
  - arXiv:2508.02087, "When Truth Is Overridden: Uncovering the Internal Origins of Sycophancy."
  - OpenAI, GPT-4o sycophancy rollback statement (April 2025).

- Family 14 (assumption propagation):
  - Addy Osmani, "The 80% Problem in Agentic Coding" (addyo.substack.com, 2026-01-28).

- Family 15 (scope creep):
  - arXiv:2509.22237, "FeatBench: Towards More Realistic Evaluation of Feature-level Code Generation" (157 tasks, 27 repos; max resolved rate 29.94%; "aggressive implementation" pattern named).

- Family 16 (excess generation):
  - arXiv:2407.20042, "When to Stop? Towards Efficient Code Generation in LLMs with Excess Token Prevention" (CodeFast / GenGuard; 34%–452% speedup with no quality loss).

- Family 17 (overconfidence / false completion):
  - arXiv:2511.05524, Chen, "Evidence-Bound Autonomous Research (EviBound)" (dual governance gates; LLM agents report false claims).
  - arXiv:2509.25498, Hagar et al., "Not Wrong, But Untrue: LLM Overconfidence in Document-Based Queries" (interpretive overconfidence; unsupported characterization; declarative-isation of attributed opinions).
  - arXiv:2505.02151, "Large Language Models are overconfident and amplify human bias."
  - arXiv:2602.10522, "Consistency Meets Verification" (34–62% of LLM-generated unit tests are invalid due to hallucination; "circularity of error" framing).

- Cross-cutting:
  - HumanLayer, "Writing a good CLAUDE.md" (humanlayer.dev, 2025-11): frontier thinking LLMs follow ~150–200 instructions reliably; smaller models decay exponentially.
  - Anthropic context-engineering note + Morph context-rot guide (morphllm.com, 2026-03-13).
  - arXiv:2503.06327, "A Taxonomy of Inefficiencies in LLM-Generated Python Code."

---

## Open research threads worth tracking

These are the questions whose answers would directly improve the maestro's bug map. None has a settled answer yet.

The verbosity question. Is there a length-aware decoding strategy that produces test-passing code at the same rates as standard sampling, but with 2× lower token output? CodeFast / GenGuard (2407.20042) is the closest existing work; it stops late tokens but does not affect the body. A maestro-level rule that gives the agent a "budget" per patch and rejects above the budget would be a useful experiment in M7+ scope.

The defensive-coding question. RobGen (2503.20197) shows the model "knows" the missing check (the `if` is third-ranked). Can a steering vector trained against the sycophancy direction (per 2509.21305) also steer the verbosity direction? If yes, the same intervention dampens multiple slop families.

The convention-blindness question. Pattern mimicry depends on the relative weight of base-rate (training data) versus local-rate (current repo). RAG-style retrieval into the prompt is the standard fix. The open question: how many in-context examples of the local convention are needed to flip the model's prior? Five? Twenty? Project-dependent? A maestro skill `repo-search-before-write` has a tunable parameter here that should be measured per project.

The sycophancy question for code-oz specifically. Cross-family review (Claude vs. Codex vs. Gemini) is the structural fix; but if both models are RLHF-trained on similar human raters, do their sycophancy patterns correlate? The empirical M5 Codex round, where Codex pushed back hard on the M4 plan and forced Option E, is one data point that says no, but a longitudinal log of (claim, Claude-verdict, Codex-verdict, ground-truth-by-test) would be the actual answer.

The scope-creep question. FeatBench (2509.22237) names "aggressive implementation" as the dominant failure pattern but does not measure how strong the ticket-scope-enforcement signal needs to be to prevent it. The maestro's hard gate "edits must be in the declared file list" is one signal; whether it is enough is an open question.

These threads are worth surfacing in M7+ scope. They are not blockers for v0.5–v0.7 but are good candidates for the project's first published research note once the spine is shipping.

---

## End of dossier

The discipline this document encodes is simple. Verify before you assert. Stay inside the ticket. Trust the type system and the test runner more than the model. Let a different family review your work. Write the evidence down. Do not say "I tested it" without showing the run.

The evidence base behind this discipline is current as of April 2026 and is large enough that the directional findings will not flip in the near term. Specific numbers will move; the families will not.

If a new paper changes one of the families above, the maestro updates the dossier, bumps the version in the frontmatter, and notifies every persona via the rule-sheet block. The dossier is alive.
