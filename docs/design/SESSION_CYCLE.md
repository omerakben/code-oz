# code-oz — Session cycle

The empirical pattern that produced M1 → M2 → M3 → M4. Codified here so every future session re-enters the same rhythm without re-reading milestone-specific kickoffs to discover the steps. Milestone kickoffs (`SESSION_M<N>_KICKOFF.md`) reference this doc for the cycle and only spell out milestone-specific scope.

## Purpose

A new Claude Code session inside `~/Projects/code-oz/` boots, runs one milestone end-to-end (plan → implement → review → tag → handoff), and writes the next milestone's kickoff before ending. The cycle is the same every time; only the milestone changes.

## The six phases

### 1. Boot

Auto-loads: `CLAUDE.md`. Read in full before any action.

Read in this order:
1. `CLAUDE.md` (rules 1–14, peer review rules 7–10)
2. `docs/design/SESSION_M<N>_KICKOFF.md` (the active milestone) **including any cross-cutting addendum at the end** — addenda capture later locked decisions that override earlier prompts
3. Prerequisites the kickoff cites (ROADMAP § M<N>, pinned references in `docs/references/`, prior CODEX_RESPONSE_M<N-1>.md if present)

Do not skip the addendum. It is the most-recent locked decision and wins on conflict.

### 2. Plan round (Codex debate; before any code)

Per CLAUDE.md rule 7. Mandatory.

1. Sketch the milestone design from the kickoff scope.
2. Write `docs/design/CODEX_BRIEFING_M<N>.md` — locked context, what's not up for debate, proposed design, leans as `lean + reasoning + counter-argument`. Mirror the M3/M4 briefing shape.
3. Invoke Codex:
   ```
   mcp__plugin_agent-codex_codex-native__codex(
     model: 'gpt-5.5',
     config: { model_reasoning_effort: 'xhigh' },
     sandbox: 'read-only',
     approval-policy: 'never',
     cwd: '/Users/ozzy-mac/Projects/code-oz',
     prompt: '<briefing path + structured response request>'
   )
   ```
4. Save Codex's verbatim reply to `docs/design/CODEX_RESPONSE_M<N>.md`.
5. Append the synthesis (per CLAUDE.md rule 9: Codex's verdict is data, not authority — judge each finding). Adopt the locked implementation order.
6. Present to Ozzy. **Wait for explicit approval before any code lands.**

### 3. Implementation

1. Create the milestone branch from `main`: `feat/m<n>-<scope>`.
2. Implement in atomic commits per the synthesized order.
3. **Before each commit:** `bun test` clean (offline, FakeProvider only), `bun run typecheck` clean.
4. Don't expand scope. Items not in the synthesized order go into the next milestone, not this one.
5. Conventional commit messages. No emojis. No "Co-Authored-By: Claude" footers unless asked.

### 4. Review round (Codex review at completion)

Per CLAUDE.md rule 8. Mandatory.

1. Once tests + typecheck are clean and all base commits are landed, invoke Codex review on the new commits with `sandbox: read-only`.
2. Save reply as `docs/design/CODEX_REVIEW_M<N>.md`.
3. Codex returns one of `push` / `fix-first` / `debate-required`.
4. **No-tech-debt rule:** every `block-push` and `block-next-milestone` severity finding gets addressed in the same milestone before tag. Only `nit` and `fyi` may defer (and only with explicit user approval).
5. Fix commits are NEW commits (never `--amend`). Re-invoke review on the fix commits until clean.

### 5. Tag and push (after explicit Ozzy approval only)

Never run these without an explicit "yes, push" from Ozzy in chat.

1. Merge `feat/m<n>-<scope>` → `main` with `--no-ff`.
2. Tag `v0.<N>.0-alpha.0` with annotated message + Codex audit-trail link.
3. Push `main` and the tag.
4. `gh release create v0.<N>.0-alpha.0` with milestone-themed release notes.

### 6. Handoff (write the next kickoff before ending)

The session that ships M<N> writes `docs/design/SESSION_M<N+1>_KICKOFF.md` before ending. The empirical insight from M1→M4: handoffs written by the just-completed session capture loose threads, deferred work, and lessons-learned in fresh context. A handoff written cold by the next session loses signal.

The next kickoff includes:
- State at start (what shipped, test count, binary version)
- What's still stubbed
- Template references (read-only via `/add-dir`)
- Deep-dive: what each template contributes (pre-extracted so the next session doesn't re-discover)
- Task description with files to create + acceptance criteria
- Open design questions (lean + reasoning + counter)
- Cross-model peer review pointer (this doc)
- Don't list (what's NOT in scope)
- First commands to run
- Loose threads from the just-completed milestone

Cross-cutting addenda (like the synthesis from `CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md`) are appended at the end of the kickoff before the cycle pointer, with explicit "addendum wins on conflict" wording.

## Boot prompt — paste-ready (parameterized)

A new Claude Code session in `~/Projects/code-oz/` boots cleanly with this prompt:

```
Read CLAUDE.md and docs/design/SESSION_CYCLE.md, then docs/design/SESSION_M<N>_KICKOFF.md
in full (including any cross-cutting addendum at its end). Boot M<N> per the cycle:
prerequisites → CODEX_BRIEFING_M<N>.md → invoke Codex (gpt-5.5 / xhigh / read-only /
never / cwd=~/Projects/code-oz) → CODEX_RESPONSE_M<N>.md with synthesis → present to
me for approval. Do not start coding until I approve the synthesis.
```

Substitute `<N>` for the active milestone number. Everything else is constant.

## Boot prompt — for the next M4 session (paste-ready)

```
Read CLAUDE.md and docs/design/SESSION_CYCLE.md, then docs/design/SESSION_M4_KICKOFF.md
in full — note the cross-cutting addendum near the end (three locked decisions from
CODEX_RESPONSE_TEMPLATES_PLAN_MEM.md that affect M4: context metrics on agent_invoked,
no contextScope frontmatter, tool-call cap from .code-oz/config.yaml). Boot M4 per the
cycle: read prerequisites → draft CODEX_BRIEFING_M4.md with the 9 prompts plus any items
the addendum opens → invoke Codex (gpt-5.5 / xhigh / read-only / never /
cwd=/Users/ozzy-mac/Projects/code-oz) → save reply as CODEX_RESPONSE_M4.md → append my
synthesis → present to me for approval. Do not start coding until I approve.
```

## Naming convention cheat sheet

| File | Written when | Contents |
|---|---|---|
| `SESSION_M<N>_KICKOFF.md` | At end of M<N-1>, by the just-completed session | State + scope + open questions + template references + cycle pointer |
| `CODEX_BRIEFING_M<N>.md` | Phase 2.2, by the active session | Locked context + leans + structured-reply request |
| `CODEX_RESPONSE_M<N>.md` | Phase 2.4–2.5, by the active session | Verbatim Codex reply + Claude synthesis + locked implementation order |
| `CODEX_REVIEW_M<N>.md` | Phase 4.2, by the active session | Codex review of completed commits + verdict (`push` / `fix-first` / `debate-required`) |
| `CODEX_BRIEFING_<TOPIC>.md` (no `M<N>`) | Forward-looking design rounds outside the milestone cadence | Same shape as milestone briefings; cross-references when those decisions land in milestones |
| `CODEX_RESPONSE_<TOPIC>.md` (no `M<N>`) | Same | Same shape as milestone responses; explicit "no code lands from this round" line |

Topic-named (non-milestone) briefings are valid and have happened (`CODEX_BRIEFING_TEMPLATES_PLAN_MEM.md` on 2026-04-29). They're forward-looking design contracts that inform multiple milestones; the synthesis specifies which milestone adopts each decision.

## End-of-session checklist

Before closing the session, the just-completed session writes:

- [ ] `docs/design/SESSION_M<N+1>_KICKOFF.md` exists and covers the next milestone end-to-end
- [ ] Loose threads from M<N> are captured in the next kickoff's "Loose threads" section
- [ ] Cross-cutting decisions made during M<N> (e.g., new locked rules, schema changes) are appended as an addendum to relevant downstream kickoffs (or to this `SESSION_CYCLE.md` if they affect the cycle itself)
- [ ] `git status` is clean on `main`; no half-finished branches dangling
- [ ] The release tag is pushed (if Ozzy approved push)

Skipping the handoff is the single biggest source of drift. M3→M4 worked because the M3 session wrote SESSION_M4_KICKOFF.md before ending. The next session ships M4 because of that.

## Authority

This doc is the cycle. CLAUDE.md rules 7–10 are the underlying durable rules. Milestone kickoffs are the per-milestone scope. If any of those three conflicts, CLAUDE.md > this doc > kickoff. If a kickoff explicitly overrides a phase here for milestone-specific reasons, the kickoff wins for that milestone only.
