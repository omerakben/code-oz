import type { FakeProvider } from './fake.ts'

const FIRST_RUN_TS = `export function firstRunMessage(): string {
  return 'code-oz first-run smoke passed'
}
`

const SPEC_REPLY = `<spec-ready/>
# SPEC

## Goals

- Create a tiny deterministic first-run smoke artifact.
- Keep the flow offline and safe for a new user.

## Users

- New code-oz users validating their local installation.

## Constraints

- No network access is required.
- No new dependencies are added.

## Acceptance criteria

- A source file exports a stable first-run smoke message.
- The validation command succeeds without provider credentials.

## Open questions

- None known at define time.

## Explicit non-goals

- Not implementing a production feature beyond the first-run smoke artifact.
`

const PLAN_REPLY = `<plan-ready/>
# PLAN

## Goals

- Decompose the first-run smoke request into one atomic task.

## Tasks

### T-001: Add first-run smoke message

- Files: src/code-oz-first-run.ts
- Validation: true
- Risk: smoke artifact could be mistaken for product logic.
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1-2.

## Out of scope

- Network provider setup and production feature work.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: first-run smoke artifact

- Spec: SPEC.md ## Acceptance criteria, bullets 1-2
- Quote: A source file exports a stable first-run smoke message.

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: the smoke artifact is a greenfield literal export.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: the task uses TypeScript only and no external APIs.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const BUILDER_REPLY = `<build-ready/>

\`\`\`diff
${newFileDiff('src/code-oz-first-run.ts', FIRST_RUN_TS)}
\`\`\`

## Title
Add first-run smoke message

## Notes
- The artifact is deliberately small and deterministic so first-run validation stays offline.
`

const VERIFIER_REPLY = `<verify-ready/>

## Rationale
validation command \`true\` exited 0; the smoke artifact was created by BUILD.
`

const REVIEWER_REPLY = `<review-ready/>

## Findings

- None.

## Score

- Final score: 8
`

export function applyFirstRunFakeFixture(fake: FakeProvider): void {
  fake.expect({ phase: 'define', agent: 'ba' }).respondWith({ content: SPEC_REPLY })
  fake.expect({ phase: 'plan', agent: 'lead' }).respondWith({ content: PLAN_REPLY })
  fake.expect({ phase: 'plan', agent: 'scientist' }).respondWith({
    content: scientistReply('plan'),
  })
  fake.expect({ phase: 'build', agent: 'builder' }).respondWith({ content: BUILDER_REPLY })
  fake.expect({ phase: 'build', agent: 'scientist' }).respondWith({
    content: scientistReply('build'),
  })
  fake.expect({ phase: 'verify', agent: 'verifier' }).respondWith({ content: VERIFIER_REPLY })
  fake.expect({ phase: 'verify', agent: 'scientist' }).respondWith({
    content: scientistReply('verify'),
  })
  fake.expect({ phase: 'review', agent: 'reviewer' }).respondWith({ content: REVIEWER_REPLY })
  fake.expect({ phase: 'review', agent: 'scientist' }).respondWith({
    content: scientistReply('review'),
  })
}

function scientistReply(phase: 'plan' | 'build' | 'verify' | 'review'): string {
  return `<scientist-ready/>
# HYPOTHESES

## H-001: first-run smoke remains deterministic

- Phase: ${phase}
- Status: open
- Falsifier: the generated smoke message changes between runs.
- Evidence: SPEC.md AC-1.
- Risk if false: first-run smoke output becomes hard to verify.

# OPEN QUESTIONS

## Q-001: should a future release replace the smoke artifact with a sample app?

- Phase: ${phase}
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: v0.20.1 is limited to first-run polish.
- Resolution attempts: none yet.
`
}

function newFileDiff(path: string, content: string): string {
  const lines = content.split('\n')
  const bodyLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  const body = bodyLines.map((line) => `+${line}`).join('\n')
  return `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,${bodyLines.length} @@
${body}`
}
