// Helpers for the M16 R1 fix-first VERIFY-fail restart e2e test
// (`tests/e2e/cli-verify-fail-restart.test.ts`).
//
// Codex R1 finding 1 + the C12 coverage gap motivate a dedicated
// e2e: the existing C12 happy + needs-revision-restart cycle never
// drives the verify-fail restart path through the binary. This
// helper supplies a one-task PLAN where attempt 1's validation
// command exits 1 and attempt 2's validation command exits 0 — the
// difference comes from attempt 2's BUILD patch flipping the
// committed verify-script.sh from `exit 1` to `exit 0`.
//
// Mechanics:
//   - Project base commits `verify-script.sh` with `exit 1` and
//     `src/alpha.ts` with the fixture body.
//   - PLAN.md task T-001 declares validation = `sh verify-script.sh`
//     and files = src/alpha.ts plus verify-script.sh.
//   - Attempt 1's BUILDER patch modifies src/alpha.ts only (script
//     stays at exit 1) → VERIFY fails on attempt 1.
//   - Attempt 2's BUILDER patch modifies BOTH verify-script.sh
//     (to exit 0) and src/alpha.ts (different change) → VERIFY
//     passes on attempt 2.
//
// The patch shape stays argv-only (Bun.spawn invocation; no shell)
// per src/tools/command-grammar.ts.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { PLAN_READY_SIGNAL } from '../../../src/phases/plan.ts'
import { BUILD_READY_SIGNAL } from '../../../src/phases/build.ts'
import { VERIFY_READY_SIGNAL } from '../../../src/phases/verify.ts'
import { REVIEW_READY_SIGNAL } from '../../../src/phases/review.ts'
import { runGit } from '../../../src/worktree/create-run-worktree.ts'
import { initProject } from '../../../src/commands/init.ts'

import type { FakeScriptEntryLiteral } from './multi-task-cli.ts'

// --- project setup -------------------------------------------------

export interface VerifyFailProject {
  readonly tmpRoot: string
  readonly projectRoot: string
  readonly stateDir: string
  readonly artifactsDir: string
  readonly scriptDir: string
}

const VERIFY_SCRIPT_FAIL = `#!/bin/sh
exit 1
`
// VERIFY_SCRIPT_PASS lives implicitly in BUILDER_ATTEMPT_2's diff —
// we don't write it to the project root because the BUILD's git apply
// is the only path that should mutate the script (mimics real-world
// builders).

const ALPHA_BASE = `// Source for T-001.
export function alpha(): string {
  return 'alpha'
}
`

/**
 * Create a tmp project with a single-task fixture sized for the
 * verify-fail restart cycle. Attempt 1's BUILD patch modifies
 * src/alpha.ts only; the committed verify-script.sh (`exit 1`)
 * makes VERIFY fail. Attempt 2's patch flips verify-script.sh to
 * `exit 0`.
 */
export async function setupVerifyFailProject(): Promise<VerifyFailProject> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-r1-vf-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })

  await mkdir(join(projectRoot, 'src'), { recursive: true })
  await writeFile(join(projectRoot, 'src', 'alpha.ts'), ALPHA_BASE, 'utf8')
  await writeFile(join(projectRoot, 'verify-script.sh'), VERIFY_SCRIPT_FAIL, {
    encoding: 'utf8',
    mode: 0o755,
  })
  await writeFile(join(projectRoot, 'README.md'), '# verify-fail fixture\n', 'utf8')

  await initProject({ cwd: projectRoot, force: false })

  // Bump per-phase budgets just like the C12 e2e — the new defaults
  // (M16 R1 finding 4) are already comfortable but the explicit
  // override mirrors C12's pattern and isolates this test from any
  // future default tightening.
  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const configRaw = await readFile(configPath, 'utf8')
  const cfg = parseYaml(configRaw) as Record<string, unknown>
  const budgets = (cfg.budgets ??= {}) as Record<string, unknown>
  budgets.perPhase = {
    define: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    plan: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    build: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    verify: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    review: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    ship: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    audit: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
  }
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  // git init so the worktree wrapper has a base commit.
  const requireGit = async (args: readonly string[]): Promise<void> => {
    const r = await runGit(projectRoot, args)
    if (!r.ok) {
      throw new Error(
        `git ${args.join(' ')} failed: exit=${String(r.exitCode)} stderr=${r.stderr}`,
      )
    }
  }
  await requireGit(['init', '-q', '-b', 'main'])
  await requireGit(['config', 'user.email', 'test@example.com'])
  await requireGit(['config', 'user.name', 'Test'])
  await requireGit(['config', 'commit.gpgsign', 'false'])
  await requireGit(['add', '-A'])
  await requireGit(['commit', '-q', '-m', 'init verify-fail fixture'])

  const scriptDir = join(tmpRoot, 'scripts')
  await mkdir(scriptDir, { recursive: true })

  return Object.freeze({
    tmpRoot,
    projectRoot,
    stateDir: join(projectRoot, '.code-oz', 'state'),
    artifactsDir: join(projectRoot, '.code-oz', 'artifacts'),
    scriptDir,
  })
}

// --- canned response constants -------------------------------------

export const BA_READY_REPLY = `<spec-ready/>
# SPEC

## Goals

- Add an identity stamp to the alpha helper so VERIFY can witness it.

## Users

- Repository contributors maintaining the alpha helper.

## Constraints

- The validation command \`sh verify-script.sh\` is the success oracle.
- No new dependencies.

## Acceptance criteria

- The validation command exits 0.
- alpha() returns its identity stamp.

## Open questions

- None known at define time.

## Explicit non-goals

- Not modifying beta or gamma helpers in this milestone.
`

/**
 * One-task PLAN with files = src/alpha.ts + verify-script.sh so that
 * attempt 2 can patch the script as part of the same task. Validation
 * command is `sh verify-script.sh` (argv-only grammar; first token is
 * `sh`, second is the script path; no shell metachars).
 */
export const PLAN_RESPONSE = `${PLAN_READY_SIGNAL}
# PLAN

## Goals

- Stamp the alpha helper while making the validation command pass.

## Tasks

### T-001: Stamp alpha helper, then make VERIFY pass

- Files: src/alpha.ts, verify-script.sh
- Validation: sh verify-script.sh
- Risk: stamp drift if alpha is renamed.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1.

## Out of scope

- Touching beta or gamma helpers.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: alpha identity stamp + green validation

- Spec: SPEC.md ## Acceptance criteria, bullet 1
- Quote: The validation command exits 0.

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: alpha is a literal-string return; no pattern to mirror.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: hand-written helpers + a one-line shell script.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

export function scientistResponse(phase: 'plan' | 'build' | 'verify' | 'review'): string {
  return `<scientist-ready/>
# HYPOTHESES

## H-001: alpha helper retains its identity AND the validation command exits 0

- Phase: ${phase}
- Status: open
- Falsifier: alpha() returns the wrong stamp OR \`sh verify-script.sh\` exits non-zero.
- Evidence: SPEC.md AC-1.
- Risk if false: alpha helper drift OR the verify gate produces false positives.

# OPEN QUESTIONS

## Q-001: should alpha's stamp encode the verify-script's exit shape?

- Phase: ${phase}
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC bullet 1 says exit 0; the helpers don't reference the script today.
- Resolution attempts: none yet.
`
}

/**
 * Attempt 1's BUILDER patch — modifies src/alpha.ts ONLY (verify-script
 * stays at `exit 1`) so VERIFY fails. The 4-line → 5-line shape mirrors
 * the C12 e2e's attempt-1 builderResponse to keep the patch grammar
 * consistent with the BUILD apply path.
 */
export const BUILDER_ATTEMPT_1 = `${BUILD_READY_SIGNAL}

\`\`\`diff
diff --git a/src/alpha.ts b/src/alpha.ts
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,4 +1,5 @@
 // Source for T-001.
+/** Identity stamp: alpha-stamp-a1. */
 export function alpha(): string {
-  return 'alpha'
+  return 'alpha-stamp-a1'
 }
\`\`\`

## Title
Stamp alpha helper (attempt 1 — VERIFY expected to fail)

## Notes
- Risk: validation command still exits 1; attempt 2 will patch verify-script.sh.
`

/**
 * Attempt 2's BUILDER patch — modifies BOTH src/alpha.ts (different
 * stamp from attempt 1; verify-fail restart destroys + recreates the
 * worktree from base, so the diff is again from base, NOT delta on
 * attempt 1's post-state) AND verify-script.sh (flips exit 1 → exit 0).
 *
 * The diff for verify-script.sh is two-hunk-style: full file replace
 * via @@ -1,2 +1,2 @@. The script's mode (0o755) was set on the file
 * before the initial git commit, so `git apply --index` preserves it.
 */
export const BUILDER_ATTEMPT_2 = `${BUILD_READY_SIGNAL}

\`\`\`diff
diff --git a/src/alpha.ts b/src/alpha.ts
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,4 +1,5 @@
 // Source for T-001.
+/** Identity stamp: alpha-stamp-a2. */
 export function alpha(): string {
-  return 'alpha'
+  return 'alpha-stamp-a2'
 }
diff --git a/verify-script.sh b/verify-script.sh
--- a/verify-script.sh
+++ b/verify-script.sh
@@ -1,2 +1,2 @@
 #!/bin/sh
-exit 1
+exit 0
\`\`\`

## Title
Stamp alpha helper (attempt 2 — flip verify-script.sh to exit 0)

## Notes
- Carry-forward addressed: validation command now exits 0 by patching the script.
`

export const VERIFIER_RESPONSE_PASS = `${VERIFY_READY_SIGNAL}

## Rationale
validation command \`sh verify-script.sh\` exited 0; mutation gate not-applicable.
`

/**
 * Verifier response for the FAIL branch. Per src/phases/verify.ts L702
 * the persona must include ## Failure summary and ## Constraint
 * sections when verdict=fail. The orchestrator computes verdict from
 * the runner result; the persona's summary feeds into VERIFY.md.
 */
export const VERIFIER_RESPONSE_FAIL = `${VERIFY_READY_SIGNAL}

## Rationale
validation command \`sh verify-script.sh\` exited 1.

## Failure summary
verify-script.sh exited with status 1; the script unconditionally exits 1 at base, so the BUILD attempt did not flip the gate.

## Constraint
the next BUILD attempt MUST patch verify-script.sh so it exits 0.
`

export const REVIEWER_READY_RESPONSE = `${REVIEW_READY_SIGNAL}

## Findings

- None.

## Score

- Final score: 8
`

// --- script builders -----------------------------------------------

export const buildBuilderEntry = (attempt: 1 | 2): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase: 'build', agent: 'builder' },
    response: { content: attempt === 1 ? BUILDER_ATTEMPT_1 : BUILDER_ATTEMPT_2 },
  })

export const buildScientistEntry = (
  phase: 'plan' | 'build' | 'verify' | 'review',
): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase, agent: 'scientist' },
    response: { content: scientistResponse(phase) },
  })

export const buildVerifierEntry = (verdict: 'pass' | 'fail'): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase: 'verify', agent: 'verifier' },
    response: { content: verdict === 'pass' ? VERIFIER_RESPONSE_PASS : VERIFIER_RESPONSE_FAIL },
  })

export const buildReviewerEntry = (): FakeScriptEntryLiteral =>
  Object.freeze({
    matcher: { phase: 'review', agent: 'reviewer' },
    response: { content: REVIEWER_READY_RESPONSE },
  })
