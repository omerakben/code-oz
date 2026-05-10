# Response — agent-skills comparison round 2

**Thread:** `019e12ab-f7fc-7ed1-93dc-21f90ac6274c`
**Date:** 2026-05-10
**Model:** `gpt-5.5` xhigh, sandbox: read-only
**Brief:** [`comparison.md`](./comparison.md) section 9 (also extracted to [`codex-briefing.md`](./codex-briefing.md))
**Prior round:** [`docs/research/CODEX_RESPONSE_AGENT_SKILLS_BORROW.md`](../../research/CODEX_RESPONSE_AGENT_SKILLS_BORROW.md) (2026-04-30, thread `019de02f`)

---

## Verdict per claim

Claim 1, section 5: agree-with-modifications. Code-oz structurally exceeds agent-skills on runtime authorities: gates, worktrees, provider capability, budgets, panel quorum, debate scheduler, resume, and privacy all have no real prompt-pack analog. The one axis Claude underweighted is trust classification for context: agent-skills repeatedly treats external docs, browser output, logs, config, and error text as untrusted data. Code-oz controls what files enter context, but the prompts do not consistently tell agents how to treat instruction-like content inside allowed context.

Claim 2, section 6.1: agree-with-modifications. Land source-driven citation language, but the cost is only "30 lines" if it is schema-aware. The hidden SOURCE_CHECK interaction is that agent-skills asks for hierarchy labels and quoted passages, while code-oz's locked `SC-DOC` block has only `Library`, `URL`, `Section`, and `Why`. The prompt must say "prefer official sources, use deep URLs/sections, surface conflicts, use SC-DOC-NONE when unverified," and must also say not to add unsupported bullets like `Hierarchy` or `Quote`.

Claim 3, section 6.2: reframe. The right shape is neither a persona-referenced skill nor a generic phase-tail. The agent-skills file explicitly says doubt-driven belongs to the main orchestrator and must not be loaded into a persona that would spawn another persona. A phase-tail after BUILD_REPORT is better than nothing, but it is still late and risks becoming a second REVIEW. The better code-oz shape is a risk-triggered pre-BUILD checkpoint over a PLAN task block: artifact plus contract only, adversarial prompt, no CLAIM passed to the reviewer, findings reconciled by the orchestrator, events emitted, and optional sidecar only if the checkpoint blocks or changes the plan.

Claim 4, section 6.3: reframe. Duplication has surfaced, but not enough to justify the proposed Skills layer. The proposed initial roster is mostly phase-owned protocol, not reusable skill material: `five-axis-review` belongs to REVIEW, `three-source-verification` belongs to PLAN, `debugging-triage` belongs to VERIFY. Extracting one-persona instructions into skills adds indirection without reuse. The trigger should be concrete prompt drift: the same workflow appears in 3 or more personas, or a postmortem ties a real bug to duplicated prompt instructions diverging across personas.

Claim 5, section 7: agree-with-modifications. The "do not borrow" list is mostly right: no slash-command mirror, no per-skill scripts, no imported persona roster, no rationalization fork. The one item to reconsider later is `simplify-ignore`, not as a hook, but as a future patch-validator concept for protected regions or performance-critical code. Also add two explicit rejects: mandatory skill invocation by description, and Agent Teams-style teammate discussion. Both conflict with code-oz's authority model unless a future milestone proves measurable risk reduction.

## Single highest-leverage borrow we should land first

File: `src/prompts/plan-system.md`.

Diff shape: add a short `## Source-driven discipline` section before the output protocol. It should require reading dependency/version files when framework behavior matters, prefer official docs over blogs or Q&A, use full URLs with specific sections, surface official-docs-vs-existing-code conflicts, mark unverified patterns through `SC-DOC-NONE` plus `Why explicit`, and warn not to add fields outside the locked SOURCE_CHECK schema.

Rule-20 cost: zero new authority boundary if it is prompt-only and schema-preserving. If it changes `docs/contracts/SOURCE_CHECK.md`, adds a docs-fetch permission, adds cache revalidation, or changes parser behavior, it becomes a new authority surface and should not land as a drive-by.

## Single borrow we should reject (or "land all three")

Reject the current Skills-layer proposal for v0.18. Land source-driven citation now. Design doubt-driven as its own future milestone because M16 makes the need credible. Do not land the Skills layer until there is measured prompt-drift pain or a reusable workflow that crosses at least 3 personas.

## One pattern from agent-skills we have not surfaced in this comparison

The missed pattern is: a failing RED test can satisfy the doubt step for behavioral claims. The doubt-driven skill says TDD's failing test is "doubt made concrete." That matters for code-oz because M16's worst bugs were state-machine coupling bugs caught by e2e, not by another model reading the same plan. Before adding a broad Doubter surface, code-oz should strengthen PLAN/BUILD language for behavior-changing tasks: the validation command should prove the new behavior, and bug fixes should name the reproduction test that would fail before the patch.

## What you would have done differently if you were Claude

I would have priced each borrow with a rule-20 sub-surface table before recommending sequence. Source citation is prompt-only if schema-aware. Doubt-driven is at least one new orchestrator checkpoint, and automatic cross-model doubt is also a rule-21 parallel-provider surface. The Skills layer is at least three sub-surfaces: skill anatomy, loader/composition, and persona-reference protocol. M16 just proved that bundling sub-surfaces under one label hides bugs, so that sizing should have been the central analysis.

## Honest answer: is the Skills layer worth shipping at v0.18?

No. If v0.18 is M17, it should not spend its authority slot on Skills. The next user-visible gap is SHIP/runtime completion, and the next reliability gap is better pre-BUILD doubt or e2e discipline for high-risk state-machine work. This is not a reversal of April 30; it keeps the deferral. Reversing the April 30 verdict would cost at least three milestones if done cleanly: anatomy contract, loader/composition, then initial roster plus verification.

## Risks Claude is missing

- Critical: The Skills layer is underpriced after the M16 lesson. "Skills layer" bundles anatomy, discovery, prompt composition, persona protocol, loader asset liveness, verification, and possibly permissions.
- Critical: Doubt-driven can violate rule 21 if cross-model escalation becomes automatic. It needs rule-21 metrics: actionable-findings rate, no-signal rate, token/latency overhead, and bugs caught before BUILD.
- High: Source-driven citation can accidentally violate rule 7 if the prompt asks for `Hierarchy` or `Quote` bullets that SOURCE_CHECK does not accept.
- High: Source-driven citation can violate rule 18 if it implies live web fetching. PLAN currently has `repo_context.network: none`; docs must be cached or already available through the existing permitted path.
- High: A Doubter phase-tail could conflict with REVIEW and Scientist unless its consumer is explicit: does it block BUILD, rewrite PLAN, add a finding, or only emit telemetry?
- High: Loading skills by "description match" conflicts with rule 16 if skills can override universal rules or become mandatory hops.
- Medium: Passing only artifact plus contract to doubt reviewers is correct, but the withheld CLAIM still needs an audit trail in an event or sidecar so the run can explain what was doubted.
- Medium: M16's bug pattern should not be reduced to "need more model review." It also says milestone-level e2e and sharper rule-20 decomposition are non-negotiable.
- Medium: A Skills loader could break compiled binary asset liveness unless skill Markdown files are imported or otherwise packaged with the same rigor as current prompt assets.
- Low: `CLAUDE.md` still says v0.13.0-alpha.0 and 1983 tests, while `package.json` and this comparison say v0.17.0-alpha.0 and 3108 tests. That stale status line is not part of this borrow decision, but it weakens `CLAUDE.md` as the canonical orientation file.

## Anything you want to flag that the prompt did not ask for

No M9 or M10 borrow should be reverted. The review prompt landed the useful parts correctly: tests-first, five-axis internal scaffolding, and the false-security cap. The M10 research-isolation shape also still looks right.
