# CODEX_RESPONSE — Distribution pivot debate

Date: 2026-05-20
Model/effort: gpt-5.5, xhigh, sandbox read-only
Thread: 019e476c-2463-7791-bc6c-a7909b2f824e
Briefing: CODEX_BRIEFING_DISTRIBUTION_PIVOT.md

> Verdict is data, not authority. Two verifiable claims in this response were checked against the repo before synthesis and both confirmed: `docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md` exists (skills-as-discovery-shells prior art), and `npm-wrapper/index.cjs` is a Node launcher that downloads + checksum-verifies the Bun binary on first run with no postinstall. Codex's correction that the briefing overclaimed `MCP_TRUST_BOUNDARY.md` is also confirmed correct — that contract governs code-oz *consuming* MCP servers, not a host-plugin→engine control plane.

---

## 1. Is the Tier-1 skills funnel coherent, or a trap?

Position: the advisory Tier 1 as briefed is a trap. A Tier 1 discovery wrapper is viable.

An advisory prompt pack that teaches 3-source checks, RED-first TDD, and anti-slop discipline would look like code-oz while lacking the product guarantees: orchestrator-owned gates, event evidence, budgets, worktrees, and cross-family review. That quietly trains users to treat prompt compliance as gate compliance.

Minimum honesty if an advisory pack ships anyway: do not call it `code-oz`; call it `code-oz-discipline`; banner every skill as `advisory only`; refuse to emit `GATE_*`, `VERIFY.md`, `REVIEW.md`, `AUDIT.md`, or any `passed`/`approved` language; never simulate cross-family review. My recommendation is cleaner: reject the advisory tier and ship only engine wrappers.

## 2. A vs B vs C

Position: choose a B variant: engine kept, host plugins as thin discovery/exec wrappers.

Reject A. It deletes the moat and turns code-oz into a weaker superpowers clone.

Reject C as briefed. "Two products with a funnel" is brand confusion. The repo already has a stronger shape in `docs/comparisons/agentic-canvas/B3_SKILL_WRAPPERS.md`: skills are discovery shells around the binary, not a second product.

The correct architecture is: official host surface discovers `code-oz`, checks version, invokes the engine, and surfaces stdout/stderr plus `NEEDS_INTERVENTION.json` paths verbatim. The binary remains the only writer of gates, artifacts, events, provider calls, and budget decisions.

Also: the briefing overclaims the MCP contract. `MCP_TRUST_BOUNDARY.md` mainly governs code-oz consuming MCP tools/servers. A host-plugin-to-engine MCP control plane is adjacent, not already settled.

## 3. The install-friction reality check

Position: near-zero install is plausible without retargeting the runtime to Node.

The current npm package is already the cheap bootstrap: `npm-wrapper/index.cjs` is a Node launcher that downloads and checksum-verifies the Bun-compiled binary on first run, with no `postinstall`. Use that. Do not rewrite the engine as a Node MCP server just to fit the distribution story.

Cheaper credible path:

- wrapper skill first checks `command -v code-oz`
- if present, run the binary directly
- if missing, offer a single pinned bootstrap path: `npm install -g @tuel/code-oz` or, if host policy allows, `npx -y @tuel/code-oz@<pinned-version> <command>`
- hard-stop if neither path is available

Do not bundle the Bun binary inside a plugin until marketplace policy and binary-size/signing behavior are verified. That is likely harder than using the existing npm wrapper.

## 4. Cross-family review inside single-family hosts

Position: acceptable only if the host surface invokes the engine. Not acceptable for an advisory code-oz-branded tier.

A Claude Code skill that merely advises "go get independent review" lacks the headline feature. A Claude Code skill that runs `code-oz run` can still produce cross-family review because Claude Code is only the user interface; the engine can spawn Codex/Claude/xAI through the existing provider contract.

If provider auth is missing, the wrapper must stop and surface the engine's intervention. No fallback "I can review it here" path.

## 5. Rule-20 staging

Position: D1 is a new boundary. Calling it "no authority" is rationalization.

Markdown skills shape agent behavior. Superpowers' `SessionStart` hook proves that a zero-runtime plugin can be a strong behavioral authority. Even without gate writes, host distribution plus skill-trigger behavior is a new capability boundary.

Correct decomposition:

- D0: no-code channel proof. Verify current Claude/Cursor/Codex plugin mechanics and revise the B3 wrapper plan against current host rules.
- D1: Claude Code wrapper only. No MCP. No advisory discipline pack. Version check, PATH/npx bootstrap, no shadow writes, smoke test.
- D2: Codex `AGENTS.md` wrapper only, same contract.
- D3: Cursor wrapper only, same contract.
- D4: host-to-engine MCP bridge contract and implementation, only if wrapper metrics prove subprocess/npx is insufficient.

Do not combine D1 with MCP. Do not combine all hosts into one milestone unless rule 20 is explicitly amended.

## 6. Sequencing vs M17

Position: pre-empt narrowly.

Do D0/D1 before M17. The user feedback says discovery/install is a wall, and the current engine is already distributable enough to wrap. A Claude wrapper is small, read/write-light, and does not change runtime authority.

Do not pause M17 for Node retargeting, MCP bridge work, or a full multi-host sweep. Those are real architecture work and should wait for evidence from D1. After Claude wrapper validation, return to M17 AUDIT runtime.

Opportunity cost: D1 is probably worth the interruption; D2-D4 before M17 are not.

## 7. The one thing most likely wrong

The load-bearing false assumption is that a zero-runtime advisory plugin will convert users into the enforced engine. More likely it becomes a confusing substitute: users install the easy thing, believe they are "using code-oz," and never reach the guarantees.

Evidence that would settle it: publish/test a Claude wrapper that actually invokes the engine, then measure first-session completion: install/open plugin, run `code-oz init`, run one fake-provider lifecycle, inspect whether users object to npm/npx/PATH. If they still refuse, the product problem is not "marketplace presence"; it is "local engine required."

## Verdict

- Distribution architecture: B variant — engine-first discovery wrappers
- Milestone decomposition: D0 channel proof, no code; D1 Claude Code binary wrapper; D2 Codex `AGENTS.md` binary wrapper; D3 Cursor binary wrapper; D4 host-to-engine MCP bridge only after D1-D3 metrics justify it
- Honesty mechanism for any advisory tier: N/A — reject advisory tier; wrapper honesty is hard binary/version prerequisite, no gate-shaped output, no fallback runtime, stdout/stderr passthrough, and smoke tests proving no skill-side `.code-oz` writes
- Sequencing vs M17: pre-empt — only D0/D1 before M17, because discovery is the current adoption blocker and D1 should not touch runtime authority
- Single biggest risk in the chosen path: Users may still reject the engine because a wrapper that requires npm/npx/PATH has not fully removed the "new CLI" objection.
- The briefing's most-likely-false assumption: It assumes an advisory zero-runtime funnel will create engine adoption instead of becoming a confusing, weaker substitute.
