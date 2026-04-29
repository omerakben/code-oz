# code-oz — M2 Codex response

- **Model:** `gpt-5.5`
- **Effort:** `xhigh`
- **Sandbox:** `read-only`
- **Approval policy:** `never`
- **Date:** 2026-04-29
- **Thread ID:** `019dda66-2e26-7863-b328-6c3b5ac94af3`
- **Briefing:** [`CODEX_BRIEFING_M2.md`](./CODEX_BRIEFING_M2.md)

Verbatim reply below.

---

## Where I agree (sanity-checked)

1. Hand-rolled validation is right: `yaml` is already a dependency, the schema is small, and the hard part is rule-specific diagnostics, not generic structural parsing.

2. A single `AgentLoadError` with stable codes is right: callers need one catch path and future `NEEDS_INTERVENTION.json` wants machine-readable `{ file, code, rule, detail }`, not an `instanceof` taxonomy.

3. Fail-fast on invalid project-local agents is right: an invalid override is configuration corruption, and continuing with bundled defaults would hide the exact mistake M2 is supposed to surface.

4. Five default personas is right: Option E needs a default agent for each exercised phase from DEFINE through REVIEW-lite, and adding them later would duplicate loader/persona work across M5-M7.

## Where I disagree (with specific alternative)

3. Do not use `Bun.embeddedFiles` as the primary default-agent registry. Use explicit asset imports plus `Bun.file(path).text()`:

```ts
import baPath from './defaults/ba.md' with { type: 'file' }

const bundledDefaults = [{ file: 'src/agents/defaults/ba.md', path: baPath }]
```

Official Bun docs say file imports return a disk path in dev and a `$bunfs/...` path after compile, while `Bun.embeddedFiles` is a blob listing with hashed names unless asset naming is configured: https://bun.sh/docs/bundler/executables. Registry discovery should not depend on hashed blob names. If TypeScript complains about `.md`, add the smallest explicit `*.md` declaration or enable arbitrary extensions deliberately.

6. Reject phase mismatch when a project-local file collides with a bundled default name. Override means "replace this persona," not "move a built-in routing slot to another phase." Concrete rule: if `project.name === bundled.name`, then `type` and `phase` must match; `provider`, `model`, `modelPolicy`, `permissions`, description, and body may change. If the user wants a PLAN BA variant, they should create `ba-plan.md`.

2. Small adjustment: keep one error class, but prefer one thrown `AgentLoadError` with `issues: AgentLoadIssue[]` over throwing arrays. Shape:

```ts
type AgentLoadIssue = { file: string; code: AgentLoadErrorCode; rule: string; detail?: string }

class AgentLoadError extends Error {
  readonly issues: readonly AgentLoadIssue[]
}
```

That keeps fail-fast at the registry level while allowing one file to report multiple frontmatter violations cleanly.

## What's missing

Thread safety: low risk if the registry is a value object. Freeze definitions and return copies or readonly arrays from `listAll()`.

Watch mode: do not build watchers in M2. Make the loader pure, cache-free, and deterministic so `code-oz dev` can reload later.

`src/agentpacks/schema.ts`: matters. Add forward-compatible types and shared constants only: `AgentPackManifestV1`, `codeOzVersion`, `agents`, optional `permissions`. Do not build marketplace validation yet.

Missing `.code-oz/agents/`: matters. Treat absent project-local directory as empty overrides. Existing invalid `.md` files still fail.

Encoding/BOM/CRLF: matters. Decode as UTF-8, strip leading BOM, accept CRLF delimiters, reject malformed frontmatter. Do not normalize body content except for validation checks.

Unicode in `name`: reject. The spec says lowercase hyphen; use ASCII-only `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.

Also missing: deterministic load order, duplicate key rejection in YAML, stable path reporting, symlink policy, and precise body validation. Load files sorted by path, reject duplicate YAML keys, report absolute or cwd-relative paths consistently, reject symlinked `.md` files that escape the agents dir, and define body validity mechanically: non-empty body plus either `## Overview` or a top-level `# ...` persona heading.

## Concrete M2 implementation order

1. `feat(agents): parse markdown frontmatter`
   Create `src/agents/frontmatter.ts` plus parser fixtures/tests for valid frontmatter, missing delimiters, BOM, CRLF, and invalid YAML. M1 tests must stay green.

2. `feat(agents): validate agent schema`
   Create `src/agents/schema.ts` with shared enum constants, `AgentDefinition`, `AgentLoadError`, and manual validators. Cover required fields, unknown phase, wrong type, description length, permissions shape, empty body, and name/file mismatch.

3. `feat(agents): load registry from directories`
   Create `src/agents/loader.ts` with `AgentRegistry`, sorted discovery, missing project dir = empty, fail-fast invalid files, project-local wins, no mutation of bundled definitions, and `getByName/getByPhase/listAll`.

4. `feat(agents): add bundled default personas`
   Add `ba.md`, `lead.md`, `builder.md`, `verifier.md`, `reviewer.md`. Validate all five through the same schema. Set BUILD provider and REVIEW provider to different families now, even though M2 makes no provider calls.

5. `feat(agents): wire bundled defaults for compiled binary`
   Add explicit Markdown asset imports in `loader.ts` and adjust the build command only if needed. Validate with `bun run typecheck`, `bun test`, and `bun run build:binary`.

6. `feat(agentpacks): add forward-compatible manifest types`
   Create `src/agentpacks/schema.ts` with type-only manifest scaffolding and shared constants. No marketplace behavior, no network, no pack command.

7. `test(agents): lock override and failure semantics`
   Add final regression fixtures for default collision override, phase mismatch rejection, invalid project-local fail-fast, and unchanged M1 `init` behavior.

Verdict: `proceed-with-modifications`
