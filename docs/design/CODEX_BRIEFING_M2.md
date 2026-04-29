# code-oz — M2 Codex briefing

**You are GPT-5.5 at xhigh effort, sandbox: read-only.** Your counterpart is Claude Opus 4.7. M1 shipped (`v0.1.0-alpha.0`, three commits, 19 tests passing). M2 is the next milestone: the Markdown agent loader and the 5 default personas. The scope is locked by the kickoff doc — you are not debating *what* to build. You are debating *how* to build it.

The point of this round is to interrogate the implementation shape before code lands. I have leans on six decisions. Push back hard where my leans are wrong; confirm fast where they're fine. Where you confirm, sanity-check rather than rubber-stamp.

---

## What you should already have read

- `CLAUDE.md` — non-negotiable rules 1–14 plus the cross-model peer review rules 7–10. The non-negotiables are the implicit constraint set on every decision below.
- `docs/design/ROADMAP.md` § M2 (lines 90–93) — files to create + acceptance criteria.
- `docs/design/SESSION_M2_KICKOFF.md` — full M2 task description, acceptance, and constraint set.
- `docs/references/agent-skill-format.md` — the canonical pinned spec for the frontmatter and section anatomy `code-oz` extends from `agent-skills`. The validation rules at the bottom are the loader contract.
- `docs/adr/0001-mvp-option-e.md` — the MVP scope decision M2 is implementing the next slice of.

You don't need to read the M1 source — M2 is additive and doesn't refactor M1.

---

## What's locked (not up for debate)

These come from the kickoff doc and the non-negotiable rules. Do not reopen them in your reply.

1. **Frontmatter schema is locked.** Required fields: `name`, `type`, `phase`, `provider`, `modelPolicy`, `permissions`, `description`. Allowed values per `docs/references/agent-skill-format.md`. The `type`/`phase`/`provider`/`modelPolicy`/`permissions` extensions are non-negotiable per rules 1, 2, 4, 9.
2. **File layout is locked.** Files to create are exactly what the kickoff lists. No restructuring (e.g., "use `src/lib/agents/` instead").
3. **Number of default personas is fixed at 5** in the kickoff acceptance, but I'm reopening it as debate prompt #5 below — argue if you think it's wrong.
4. **No live provider deps in M2.** Pure loader, no SDK calls, no network, no real provider auth. M4 lands the providers; M2 does not.
5. **Tests must be offline.** No `bun test` may touch network or real provider auth. `FakeProvider` does not exist yet (M4); M2 is loader-only.
6. **Bun + TypeScript stack.** Don't propose Node, Deno, or pnpm.

---

## M2 acceptance summary (from kickoff)

- `name`, `type`, `phase`, `provider`, `modelPolicy`, `permissions` required; `description` required and ≤1024 chars.
- Loader merges bundled defaults with project-local overrides at `.code-oz/agents/*.md`. Project-local wins on `name` collision; bundled defaults are never mutated.
- Invalid frontmatter (missing field, unknown phase, wrong type) fails fast with a typed error citing file path and violated rule. No partial loads, no silent skips.
- `bun test` passes offline; `bun run typecheck` clean; M1 regression suite still passes.

---

## My proposed design (the thing to debate)

### Module shape

```text
src/agents/
  frontmatter.ts          # parseFrontmatter(raw: string): { data: unknown; body: string }
  schema.ts               # validate(data: unknown, ctx: { file: string }): AgentDefinition
  loader.ts               # loadRegistry({ defaultsDir, projectDir }): AgentRegistry
  defaults/
    ba.md
    lead.md
    builder.md
    verifier.md
    reviewer.md
src/agentpacks/
  schema.ts               # forward-compat manifest type; not validated in M2 (W3+)
tests/
  agents-loader.test.ts
  fixtures/agents/
    valid/
      ba-discovery.md
      reviewer-with-permissions.md
      builder-strict-opus.md
    invalid/
      missing-name.md
      unknown-phase.md
      empty-body.md
      description-too-long.md
      permissions-bash-string.md
      name-filename-mismatch.md
```

`AgentRegistry` is a small typed object: `getByName(name) | getByPhase(phase) | listAll()`, backed by a `Map<string, AgentDefinition>`. No singletons, no module-level state — the registry is a value the CLI passes around.

### My six leans (the prompts)

For each: I state my lean, my reasoning, and the counter-argument I'm aware of. You either agree (with sanity check), disagree with a specific better path, or flag a third option I haven't seen.

#### 1. Schema validation: hand-rolled vs zod

**Lean: hand-rolled.** A single-file binary built with `bun build --compile` weighs every dependency. Zod is ~12 KB minified and pulls a tax we pay forever for a schema that's ~10 fields and stable. The validation rules (description ≤ 1024 chars, name matches filename, allowed enum sets, permissions sub-shape) are short imperative checks. Hand-rolled gives full control over the typed-error shape — which matters because rule 11 says provider failures become `NEEDS_INTERVENTION.json` with file paths and rule names, and the loader's error shape should match that future shape.

**Counter:** zod is battle-tested, gives discriminated unions for free, integrates with TypeScript inference, and "just write a tiny schema lib" is a classic trap. Reinventing parser combinators poorly costs more than 12 KB.

**Push back if** hand-rolled is the wrong call here, or if there's a third option (valibot — ~1 KB; a `parser` for just the YAML side and hand-rolled rules layer on top; etc.).

#### 2. Error model: single class with enum codes vs typed hierarchy

**Lean: single `AgentLoadError` class with an `AgentLoadErrorCode` enum.** Every instance has `{ file: string; code: AgentLoadErrorCode; rule: string; detail?: string }`. One catch site for callers. Matches the future `NEEDS_INTERVENTION.json` schema (rule 11) one-to-one — same fields. Aggregating errors (when you want to report all violations in a file at once, not just the first) is a `AgentLoadError[]` instead of mixing classes.

**Counter:** typed class hierarchy (`MissingFieldError extends AgentLoadError`) gives selective `instanceof` catches, better stack traces per error type, and extensibility if M3+ wants to throw new variants. The "one class with codes" pattern is closer to a Result-type than to idiomatic Node errors.

**Push back if** a typed hierarchy is meaningfully better here. Or if a third pattern (e.g., a discriminated `LoadResult = { ok: true; agent } | { ok: false; errors: ValidationError[] }` instead of throws) is the right call for a loader.

#### 3. How bundled defaults reach the compiled binary

**Lean: `Bun.embeddedFiles()` (or equivalent — embed the markdown into the executable as build assets).** This is the Bun-native pattern for `bun build --compile`. No codegen step, no runtime path resolution drift between `bun run dev` and the compiled binary, no ad-hoc string-importing.

**Counter:** the docs around `Bun.embeddedFiles` for `--compile` aren't bulletproof; if there's an edge case where embedded markdown is corrupted or the API changes, we ship a broken binary and it's hard to test (the failure only shows up in the compiled artifact, not in `bun test`). Codegen (a build script that turns each `.md` into a TS module exporting the string content) is uglier but far more robust — it works in dev, prod, and tests identically because there's no special embedding.

**Push back if** you know of a `Bun.embeddedFiles` gotcha with markdown content (UTF-8, BOM, line-ending normalization). Or if codegen-via-build-script is the right call for a v0.1 binary that has to "just work" on first install.

#### 4. Invalid project-local agent file: fail the whole load, or warn-and-continue?

**Lean: fail-fast on the whole load.** Rule 1 says no LLM-text-parsed pass/fail; the same authority applies to the loader — if a file in `.code-oz/agents/` is broken, the loader cannot pretend the registry is healthy. The error message points the user at the file and the rule, and they fix it before the next run. Partial loads are footguns: a user thinks they overrode the BA persona, but their override silently dropped because of a typo'd `phase` field.

**Counter:** rule 11 says provider failures become "actionable NEEDS_INTERVENTION.json, never opaque SDK stack traces." The same principle could argue for "load valid agents, warn about broken ones in a NEEDS_INTERVENTION.json so the user can still run with bundled defaults." Especially for non-technical users, a hard crash on first run after a typo is worse UX than a warning that names the file.

**Push back if** warn-and-continue is the better stance here, or if there's a hybrid (fail on bundled defaults, warn on project-local) worth considering.

#### 5. Default persona count: 5 (full v0.1 spine), 2 (BA+Lead, defer rest), or 7+ (PM/UX/QA splits)

**Lean: 5, exactly the kickoff acceptance.** The v0.1 spine (Option E) runs DEFINE → PLAN → BUILD-lite → VERIFY-lite → REVIEW-lite. Each phase needs one default persona. Shipping 2 in M2 means M5/M6/M7 each duplicates the M2 agent file work for the persona it adds; shipping 7+ puts effort into personas whose phases don't exist yet. 5 is the matched set.

**Counter:** the bodies of `builder.md`, `verifier.md`, `reviewer.md` would be skeleton placeholders in M2 because the BUILD/VERIFY/REVIEW phase machinery doesn't land until M5/M6/M7. We'd be shipping markdown bodies that *will be rewritten* once the phases exist. M2 = 2 personas (BA + Lead, the only ones whose phases are concrete in M5/M6) is the more honest scope.

**Push back if** 2 is meaningfully better. Or if there's a way to ship 5 such that the three later-phase bodies aren't dead weight (e.g., minimal-but-correct review framework so `reviewer.md` is real even before REVIEW phase machinery exists).

#### 6. Override `phase` mismatch: project-local sets a different phase from a same-named bundled default — allow or reject?

**Lean: allow.** Override is conceptually complete replacement. If the user wants to retarget a persona to a different phase, that's their decision; the override mechanic is "I'm replacing your default with mine." Forbidding phase changes treats the registry as a typed slot system rather than a dictionary lookup.

**Counter:** an unintentional `phase` mismatch is the kind of typo that's invisible until a run produces silently wrong artifacts (BA persona running in PLAN phase produces a mis-aimed PRD). Rejecting on phase mismatch surfaces this class of bug at load time, which matches the "fail-fast" stance from prompt 4.

**Push back if** rejecting is the right default. Or if the right answer is "allow, but emit a warning at load time" — and where that warning lives.

---

## How to reply

Four sections. Be terse. No hedging. If you'd recommend a different structure, say so first.

1. **Where I agree (sanity-checked).** For each of my 6 leans you confirm: one sentence on why my reasoning holds up under scrutiny, not just that you agree. If you only nod without checking, you're not earning your seat at this round.

2. **Where I disagree (with specific alternative).** For each of my leans you reject: the better path, concretely. Naming a library, a code shape, a rule.

3. **What's missing.** Categories I haven't asked about that the M2 loader still has to get right. Candidates I'm aware I haven't thought hard about: thread safety / concurrent loads, watch-mode reloading for `code-oz dev`, agent-pack manifest forward-compat (the `src/agentpacks/schema.ts` file is in the kickoff but I haven't designed it), what happens if `.code-oz/agents/` doesn't exist (greenfield first run), file encoding handling (BOM, CRLF on Windows), unicode in `name` fields. Tell me which of these matter and which don't, and what I missed.

4. **Concrete M2 implementation order.** Five-to-seven file commits in the order you'd land them. Not just "do these files" — the order they get written so each commit is self-contained and tested. Ground this in the locked acceptance: project-local override must work, fail-fast on invalid frontmatter, M1 regression suite stays green.

The verdict at the end: `proceed-with-leans`, `proceed-with-modifications`, or `reopen-design`. Use the strongest verdict you can defend.
