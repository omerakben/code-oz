// M17 C5b — RED-first tests for the AUDIT.md schema validator.
//
// validateAuditMarkdown(text, opts?) enforces the docs/contracts/AUDIT.md
// rejection rules and returns a structured result (ok + issues), mirroring
// the spec.ts issue-code style. The five contract fixtures are the VALID
// inputs; each rejection rule has at least one negative case.

import { describe, test, expect } from 'bun:test'
import {
  validateAuditMarkdown,
  AUDIT_ERROR_CODES,
  type AuditErrorCode,
} from '../src/artifacts/audit-schema.ts'
import type { AuditLoadErrorCode } from '../src/artifacts/errors.ts'

// --- the five contract fixtures (docs/contracts/AUDIT.md) -----------

const FIXTURE_REGRESSION = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-regression-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: gate approval silently succeeds on a PLAN.md that is missing the Tasks section
---

# AUDIT

## Localization

- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.
- src/commands/approve.ts:494-498 — preApprovePlanHook calls validatePlanMarkdown but does not assert Tasks presence separately.
- tests/artifacts/plan.test.ts:88-102 — existing test suite has no fixture for a Tasks-absent PLAN.md.

## Reproduction

- Proposed: approving a PLAN.md with no ## Tasks section exits 0 and writes GATE_PLAN_PASSED.json.
- Observed: src/artifacts/plan.ts:214-230 — REQUIRED_SECTIONS array is ['Goals', 'Sources', 'Out of scope', 'Open questions']; 'Tasks' is absent. Confirmed by grep.
- Observed: tests/artifacts/plan.test.ts:88-102 — no test exercises a Tasks-absent fixture. Confirmed by read.

## Constraints

- Preserve: all existing plan validation tests must remain green.
- Preserve: PLAN.md files generated before this fix that contain Tasks are unaffected; the fix adds a check, not a structural change.
- Require: the fix adds 'Tasks' to REQUIRED_SECTIONS in src/artifacts/plan.ts; no schema changes elsewhere.

## Audit sources

- src/artifacts/plan.ts:214-230 — read REQUIRED_SECTIONS array.
- src/commands/approve.ts:494-498 — read preApprovePlanHook call chain.
- tests/artifacts/plan.test.ts:88-102 — read existing fixture coverage.
`

const FIXTURE_FEATUREGAP = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-featuregap-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T10:15:00Z
operatorStatement: code-oz has no command to list open questions across the active run
---

# AUDIT

## Localization

- src/commands/index.ts:1 — command registry; no 'questions' subcommand registered.
- src/artifacts/open-questions.ts:1 — parser + serializer for OPEN_QUESTIONS.md exist; no read-only export for CLI consumption.
- docs/contracts/OPEN_QUESTIONS.md:1 — contract specifies 'code-oz questions list' as a W2 CLI command; not yet implemented.

## Reproduction

- Proposed: running 'code-oz questions list' exits with an unknown-command error.
- Observed: src/commands/index.ts:1 — grep for 'questions' returns zero matches. Confirmed by grep.
- Observed: docs/contracts/OPEN_QUESTIONS.md:1 — 'code-oz questions list' listed under W2 milestone, not shipped. Confirmed by read.

## Constraints

- Require: the new command is read-only; it does not write OPEN_QUESTIONS.md.
- Preserve: existing 'code-oz run' and 'code-oz approve' command surfaces are unchanged.
- Exclude: 'code-oz questions resolve' is a separate command deferred to the same W2 milestone; this AUDIT scopes only 'list'.

## Audit sources

- src/commands/index.ts:1 — grep for 'questions'.
- src/artifacts/open-questions.ts:1 — read exported surface.
- docs/contracts/OPEN_QUESTIONS.md:1 — read W2 milestone row.
`

const FIXTURE_CODEBASE_AUDIT = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-codebaseaudit-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T11:00:00Z
operatorStatement: audit the events.jsonl schema for fields that are documented in contracts but not emitted in practice
---

# AUDIT

## Localization

- src/state/schemas.ts:1 — canonical event schema definitions.
- src/state/events.ts:1 — event emission primitives.
- docs/contracts/SCIENTIST.md:1 — documents science_emitted, hypothesis_added, hypothesis_updated, question_added, question_resolved, question_deferred event types.

## Reproduction

- Proposed: some event types listed in contract docs are never emitted by the runtime.
- Observed: grep:science_emitted in src/ — zero matches in src/state/events.ts. The event type is documented in docs/contracts/SCIENTIST.md but has no emit call. Confirmed by grep.
- Observed: src/state/schemas.ts:1 — science_emitted is declared in the schema but grep of src/phases/ shows no call site. Confirmed by grep.
- Unresolved: whether hypothesis_updated and question_deferred are emitted in practice requires tracing all phase-tail call sites and verifying against a live events.jsonl fixture. Scope exceeds static read. Routed to Q-001.
- Unresolved: whether missing emit calls cause gate-preflight failures or are silent no-ops requires running the full lifecycle. Routed to Q-002.

## Constraints

- Require: any fix emits events only through the orchestrator-owned event-emission primitives in src/state/events.ts (rule 1).
- Exclude: adding new event types is out of scope for this PLAN cycle; only missing emit calls for existing declared types are in scope.
- Preserve: existing event order invariants documented in src/state/schemas.ts must not change.

## Audit sources

- src/state/schemas.ts:1 — read declared event types.
- src/state/events.ts:1 — read emit primitive exports.
- grep:science_emitted in src/ — confirmed zero emit call sites.
- docs/contracts/SCIENTIST.md:1 — read documented event list.
`

const FIXTURE_RUNTIME = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-runtime-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T12:30:00Z
operatorStatement: BUILD phase hangs indefinitely when the provider returns a streaming response that closes without a stop_reason field
---

# AUDIT

## Localization

- src/providers/invoke.ts:312-340 — streaming response consumer loop; stop condition checks stopReason field.
- src/phases/build.ts:88-110 — BUILD phase invokes invokeAgent; timeout handling.
- src/config/schema.ts:145-150 — maxTurns and maxWallTimeMinutes budget config.

## Reproduction

- Proposed: when a streaming provider response closes the connection without a stop_reason field, BUILD hangs until the process is killed externally.
- Observed: src/providers/invoke.ts:312-340 — the consumer loop exits only when stopReason is truthy; there is no timeout path for a stream that closes with stopReason === undefined. Confirmed by read.
- Observed: src/phases/build.ts:88-110 — BUILD passes maxWallTimeMinutes to invokeAgent but invokeAgent's stream loop does not reference it. Confirmed by read.
- Unresolved: whether a real provider (Claude, xAI) can produce a stream that closes without stop_reason under network partition conditions. Requires live provider testing. Routed to Q-001.
- Unresolved: whether the hang is a true indefinite block or eventually times out at the OS socket level. Requires runtime observation. Routed to Q-002.

## Constraints

- Require: the fix must not break the existing streaming consumer for normal responses (stop_reason present).
- Require: timeout enforcement must route through assertWithinBudget per rule 19.
- Preserve: the FakeProvider offline path must remain deterministic; the fix must not add a real timer dependency to offline tests.
- Exclude: fixing underlying provider behavior (stop_reason emission) is out of scope; only the consumer's resilience is in scope.

## Audit sources

- src/providers/invoke.ts:312-340 — read stream consumer loop.
- src/phases/build.ts:88-110 — read BUILD invocation and budget passing.
- src/config/schema.ts:145-150 — read maxWallTimeMinutes field definition.
`

const FIXTURE_MULTIFILE = `---
artifact: AUDIT.md
version: "0.1"
runId: run-2026-05-21-multifile-001
phase: audit
profile: brownfield
generatedAt: 2026-05-21T13:45:00Z
operatorStatement: the --effort flag is accepted by the CLI but has no visible effect on budget caps in events.jsonl
---

# AUDIT

## Localization

- src/commands/run.ts:45-60 — CLI flag parsing; --effort is parsed but value is not passed to applyEffort.
- src/config/effort.ts:1 — applyEffort function; multiplies scalable budget fields.
- src/state/schemas.ts:220-235 — effort_envelope_applied event schema; auditReportSha256 field absent from this event (different event family).
- src/phases/run.ts:80-95 — run entry point; applyEffort should be called here before phase dispatch.
- tests/config/effort.test.ts:1 — effort tests exist for applyEffort in isolation but no test spawns the CLI and checks events.jsonl for effort_envelope_applied.

## Reproduction

- Proposed: running 'code-oz run --effort high' produces the same budget caps in events.jsonl as running without --effort.
- Observed: src/commands/run.ts:45-60 — parsed effort value is stored in a local variable but never passed to applyEffort or the run options. Confirmed by read.
- Observed: src/phases/run.ts:80-95 — applyEffort is imported but the call site is commented out. Confirmed by grep.
- Observed: tests/config/effort.test.ts:1 — no test contains 'effort_envelope_applied' or 'events.jsonl'. Confirmed by grep.

## Constraints

- Require: --effort affects only scalable budget fields per rule 23; maxReviewRounds and panel slot count must not change.
- Require: effort_envelope_applied is emitted at event position 2 (between run_started and phase_entered) per docs/design/B1A_EFFORT_FLAG.md.
- Preserve: runs without --effort continue to use the config file's budget values unchanged.
- Preserve: active-run resume replays effectiveBudgets from the effort_envelope_applied event; changing config.yaml mid-run must not change the envelope.

## Audit sources

- src/commands/run.ts:45-60 — read --effort flag parsing.
- src/config/effort.ts:1 — read applyEffort export.
- src/phases/run.ts:80-95 — read call site (commented out).
- grep:effort_envelope_applied in tests/ — confirmed zero matches.
- docs/design/B1A_EFFORT_FLAG.md:1 — read event-order lock and replay contract.
`

const ALL_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['regression', FIXTURE_REGRESSION],
  ['feature-gap', FIXTURE_FEATUREGAP],
  ['codebase-audit-deferred', FIXTURE_CODEBASE_AUDIT],
  ['operator-runtime-required', FIXTURE_RUNTIME],
  ['multi-file-localization', FIXTURE_MULTIFILE],
]

// --- helpers --------------------------------------------------------

function codes(text: string, expectedRunId?: string): AuditLoadErrorCode[] {
  const res = validateAuditMarkdown(
    text,
    expectedRunId !== undefined ? { expectedRunId } : undefined,
  )
  return res.issues.map((i) => i.code)
}

describe('validateAuditMarkdown — valid fixtures', () => {
  for (const [name, fixture] of ALL_FIXTURES) {
    test(`fixture ${name} validates clean`, () => {
      const res = validateAuditMarkdown(fixture)
      expect(res.ok).toBe(true)
      expect(res.issues).toEqual([])
    })
    test(`fixture ${name} validates clean with matching expectedRunId`, () => {
      // The runId in each fixture frontmatter must match when supplied.
      const runId = fixture.match(/^runId:\s*(\S+)$/m)?.[1] ?? ''
      const res = validateAuditMarkdown(fixture, { expectedRunId: runId })
      expect(res.ok).toBe(true)
      expect(res.issues).toEqual([])
    })
  }
})

describe('AUDIT_ERROR_CODES export', () => {
  test('is the full enumerated parse-time code set', () => {
    expect(new Set(AUDIT_ERROR_CODES)).toEqual(
      new Set<AuditErrorCode>([
        'audit_missing_frontmatter',
        'audit_frontmatter_malformed',
        'audit_frontmatter_wrong_artifact',
        'audit_frontmatter_wrong_phase',
        'audit_frontmatter_wrong_profile',
        'audit_frontmatter_runid_mismatch',
        'audit_missing_section',
        'audit_section_out_of_order',
        'audit_section_empty',
        'audit_localization_missing_citation',
        'audit_localization_citation_format',
        'audit_localization_missing_separator',
        'audit_reproduction_no_proposed',
        'audit_reproduction_observed_unverified',
        'audit_unexpected_content',
        'audit_title_missing',
      ]),
    )
  })
})

describe('validateAuditMarkdown — frontmatter rejection rules', () => {
  test('audit_missing_frontmatter — no frontmatter block', () => {
    const text = '# AUDIT\n\n## Localization\n\n- a.ts:1 — x.\n'
    expect(codes(text)).toContain('audit_missing_frontmatter')
  })

  test('audit_missing_frontmatter — frontmatter not on line 1', () => {
    const text = `\n---\nartifact: AUDIT.md\n---\n# AUDIT\n`
    expect(codes(text)).toContain('audit_missing_frontmatter')
  })

  test('audit_frontmatter_malformed — required field absent', () => {
    const text = FIXTURE_REGRESSION.replace(/^operatorStatement:.*$/m, '')
    expect(codes(text)).toContain('audit_frontmatter_malformed')
  })

  test('audit_frontmatter_malformed — required field blank', () => {
    const text = FIXTURE_REGRESSION.replace(/^runId:.*$/m, 'runId: ')
    expect(codes(text)).toContain('audit_frontmatter_malformed')
  })

  test('audit_frontmatter_malformed — YAML does not parse', () => {
    const text = FIXTURE_REGRESSION.replace(
      /^operatorStatement:.*$/m,
      'operatorStatement: "unterminated',
    )
    expect(codes(text)).toContain('audit_frontmatter_malformed')
  })

  test('audit_frontmatter_wrong_artifact', () => {
    const text = FIXTURE_REGRESSION.replace('artifact: AUDIT.md', 'artifact: SPEC.md')
    expect(codes(text)).toContain('audit_frontmatter_wrong_artifact')
  })

  test('audit_frontmatter_wrong_phase', () => {
    const text = FIXTURE_REGRESSION.replace('phase: audit', 'phase: define')
    expect(codes(text)).toContain('audit_frontmatter_wrong_phase')
  })

  test('audit_frontmatter_wrong_profile', () => {
    const text = FIXTURE_REGRESSION.replace('profile: brownfield', 'profile: greenfield')
    expect(codes(text)).toContain('audit_frontmatter_wrong_profile')
  })

  test('audit_frontmatter_runid_mismatch — when expectedRunId given', () => {
    expect(codes(FIXTURE_REGRESSION, 'run-different-id')).toContain(
      'audit_frontmatter_runid_mismatch',
    )
  })

  test('runId is NOT checked when expectedRunId is absent', () => {
    expect(codes(FIXTURE_REGRESSION)).not.toContain('audit_frontmatter_runid_mismatch')
  })
})

describe('validateAuditMarkdown — title rejection', () => {
  test('audit_title_missing — # AUDIT absent', () => {
    const text = FIXTURE_REGRESSION.replace('# AUDIT\n', '')
    expect(codes(text)).toContain('audit_title_missing')
  })
})

describe('validateAuditMarkdown — section structure', () => {
  test('audit_missing_section — Constraints removed', () => {
    const text = FIXTURE_REGRESSION.replace(
      /## Constraints\n\n(?:- .*\n)+\n/,
      '',
    )
    expect(codes(text)).toContain('audit_missing_section')
  })

  test('audit_section_out_of_order — Reproduction before Localization', () => {
    // Hand-built out-of-order document.
    const text = `---
artifact: AUDIT.md
version: "0.1"
runId: run-x
phase: audit
profile: brownfield
generatedAt: 2026-05-21T09:00:00Z
operatorStatement: x
---

# AUDIT

## Reproduction

- Proposed: x.

## Localization

- a.ts:1 — x.

## Constraints

- Preserve: x.

## Audit sources

- a.ts:1 — read.
`
    expect(codes(text)).toContain('audit_section_out_of_order')
  })

  test('audit_section_empty — Localization has no bullets', () => {
    const text = FIXTURE_REGRESSION.replace(
      /## Localization\n\n(?:- .*\n)+/,
      '## Localization\n\n',
    )
    expect(codes(text)).toContain('audit_section_empty')
  })

  test('audit_unexpected_content — paragraph inside a section', () => {
    const text = FIXTURE_REGRESSION.replace(
      '## Constraints\n\n- Preserve: all existing plan validation tests must remain green.',
      '## Constraints\n\nThis is a paragraph that is not allowed.\n\n- Preserve: all existing plan validation tests must remain green.',
    )
    expect(codes(text)).toContain('audit_unexpected_content')
  })

  test('audit_unexpected_content — sub-heading inside a section', () => {
    const text = FIXTURE_REGRESSION.replace(
      '## Constraints\n',
      '## Constraints\n\n### Sub heading\n',
    )
    expect(codes(text)).toContain('audit_unexpected_content')
  })
})

describe('validateAuditMarkdown — Localization citation rules', () => {
  test('audit_localization_missing_citation — bullet with no file:line', () => {
    const text = FIXTURE_REGRESSION.replace(
      '- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.',
      '- the plan validator is missing the Tasks check entirely.',
    )
    expect(codes(text)).toContain('audit_localization_missing_citation')
  })

  test('audit_localization_missing_separator — citation but no em dash', () => {
    const text = FIXTURE_REGRESSION.replace(
      '- src/artifacts/plan.ts:214-230 — validatePlanMarkdown; Tasks section check is absent from the required-sections array.',
      '- src/artifacts/plan.ts:214-230 validatePlanMarkdown Tasks check absent',
    )
    expect(codes(text)).toContain('audit_localization_missing_separator')
  })

  test('audit_localization_citation_format — line number 0', () => {
    const text = FIXTURE_REGRESSION.replace(
      'src/artifacts/plan.ts:214-230 — validatePlanMarkdown',
      'src/artifacts/plan.ts:0 — validatePlanMarkdown',
    )
    expect(codes(text)).toContain('audit_localization_citation_format')
  })

  test('audit_localization_citation_format — inverted range', () => {
    const text = FIXTURE_REGRESSION.replace(
      'src/artifacts/plan.ts:214-230 — validatePlanMarkdown',
      'src/artifacts/plan.ts:230-214 — validatePlanMarkdown',
    )
    expect(codes(text)).toContain('audit_localization_citation_format')
  })

  test('audit_localization_citation_format — leading slash in path', () => {
    const text = FIXTURE_REGRESSION.replace(
      'src/artifacts/plan.ts:214-230 — validatePlanMarkdown',
      '/src/artifacts/plan.ts:214 — validatePlanMarkdown',
    )
    expect(codes(text)).toContain('audit_localization_citation_format')
  })

  test('audit_localization_citation_format — leading ./ in path', () => {
    const text = FIXTURE_REGRESSION.replace(
      'src/artifacts/plan.ts:214-230 — validatePlanMarkdown',
      './src/artifacts/plan.ts:214 — validatePlanMarkdown',
    )
    expect(codes(text)).toContain('audit_localization_citation_format')
  })
})

describe('validateAuditMarkdown — Reproduction rules', () => {
  test('audit_reproduction_no_proposed — no Proposed bullet', () => {
    const text = FIXTURE_REGRESSION.replace(
      '- Proposed: approving a PLAN.md with no ## Tasks section exits 0 and writes GATE_PLAN_PASSED.json.\n',
      '',
    )
    expect(codes(text)).toContain('audit_reproduction_no_proposed')
  })

  test('audit_reproduction_observed_unverified — Observed bullet with uncertainty language', () => {
    const text = FIXTURE_REGRESSION.replace(
      "- Observed: tests/artifacts/plan.test.ts:88-102 — no test exercises a Tasks-absent fixture. Confirmed by read.",
      '- Observed: tests/artifacts/plan.test.ts:88-102 — cannot confirm whether a test exercises this path.',
    )
    expect(codes(text)).toContain('audit_reproduction_observed_unverified')
  })

  test('Unresolved bullets do NOT trip observed_unverified (codebase-audit fixture)', () => {
    // FIXTURE_CODEBASE_AUDIT has Unresolved bullets with "requires"; must stay clean.
    const res = validateAuditMarkdown(FIXTURE_CODEBASE_AUDIT)
    expect(res.ok).toBe(true)
  })

  test('does NOT emit cross-file routing code at parse time', () => {
    // audit_reproduction_unresolved_not_routed is a gate-preflight check, NOT a
    // parse-time check. It must never appear from validateAuditMarkdown.
    const all = ALL_FIXTURES.flatMap(([, f]) => codes(f))
    expect(all).not.toContain('audit_reproduction_unresolved_not_routed')
  })
})
