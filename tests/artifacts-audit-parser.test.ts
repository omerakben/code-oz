// M17 C5b — RED-first tests for the AUDIT.md parser.
//
// parseAuditMarkdown(text) validates first (via validateAuditMarkdown) and
// then extracts the structured AuditArtifact: frontmatter, likely-files (from
// Localization citations), reproduction (observed / operator-proposed /
// unresolved), constraints, and audit sources. Invalid input throws
// AuditLoadError carrying the schema issues.

import { describe, test, expect } from 'bun:test'
import { parseAuditMarkdown } from '../src/artifacts/audit-parser.ts'
import { AuditLoadError } from '../src/artifacts/errors.ts'

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
- docs/contracts/SCIENTIST.md:1 — documents science_emitted, hypothesis_added event types.

## Reproduction

- Proposed: some event types listed in contract docs are never emitted by the runtime.
- Observed: src/state/events.ts:1 — grep:science_emitted returns zero matches. Confirmed by grep.
- Observed: src/state/schemas.ts:1 — science_emitted is declared in the schema but grep shows no call site. Confirmed by grep.
- Unresolved: whether hypothesis_updated and question_deferred are emitted in practice requires tracing all phase-tail call sites. Routed to Q-001.
- Unresolved: whether missing emit calls cause gate-preflight failures or are silent no-ops requires running the full lifecycle. Routed to Q-002.

## Constraints

- Require: any fix emits events only through the orchestrator-owned event-emission primitives in src/state/events.ts (rule 1).
- Exclude: adding new event types is out of scope for this PLAN cycle; only missing emit calls are in scope.
- Preserve: existing event order invariants documented in src/state/schemas.ts must not change.

## Audit sources

- src/state/schemas.ts:1 — read declared event types.
- src/state/events.ts:1 — read emit primitive exports.
- grep:science_emitted in src/ — confirmed zero emit call sites.
- docs/contracts/SCIENTIST.md:1 — read documented event list.
`

describe('parseAuditMarkdown — frontmatter extraction', () => {
  test('extracts all required frontmatter fields', () => {
    const art = parseAuditMarkdown(FIXTURE_REGRESSION)
    expect(art.frontmatter.artifact).toBe('AUDIT.md')
    expect(art.frontmatter.version).toBe('0.1')
    expect(art.frontmatter.runId).toBe('run-2026-05-21-regression-001')
    expect(art.frontmatter.phase).toBe('audit')
    expect(art.frontmatter.profile).toBe('brownfield')
    expect(art.frontmatter.generatedAt).toBe('2026-05-21T09:00:00Z')
    expect(art.frontmatter.operatorStatement).toBe(
      'gate approval silently succeeds on a PLAN.md that is missing the Tasks section',
    )
  })
})

describe('parseAuditMarkdown — localization + likely-files', () => {
  test('extracts localization entries with path + lines + rationale', () => {
    const art = parseAuditMarkdown(FIXTURE_REGRESSION)
    expect(art.localization).toHaveLength(3)
    const first = art.localization[0]!
    expect(first.path).toBe('src/artifacts/plan.ts')
    expect(first.startLine).toBe(214)
    expect(first.endLine).toBe(230)
    expect(first.rationale).toBe(
      'validatePlanMarkdown; Tasks section check is absent from the required-sections array.',
    )
  })

  test('single-line citation has endLine equal to startLine', () => {
    const art = parseAuditMarkdown(FIXTURE_CODEBASE_AUDIT)
    const first = art.localization[0]!
    expect(first.path).toBe('src/state/schemas.ts')
    expect(first.startLine).toBe(1)
    expect(first.endLine).toBe(1)
  })

  test('likelyFiles is the de-duplicated set of localization paths', () => {
    const art = parseAuditMarkdown(FIXTURE_REGRESSION)
    expect(art.likelyFiles).toEqual([
      'src/artifacts/plan.ts',
      'src/commands/approve.ts',
      'tests/artifacts/plan.test.ts',
    ])
  })
})

describe('parseAuditMarkdown — reproduction split', () => {
  test('splits observed / proposed / unresolved bullets', () => {
    const art = parseAuditMarkdown(FIXTURE_CODEBASE_AUDIT)
    expect(art.reproduction.proposed).toHaveLength(1)
    expect(art.reproduction.observed).toHaveLength(2)
    expect(art.reproduction.unresolved).toHaveLength(2)
    expect(art.reproduction.proposed[0]).toContain('never emitted by the runtime')
    expect(art.reproduction.unresolved[0]).toContain('hypothesis_updated')
  })

  test('regression fixture has no unresolved bullets', () => {
    const art = parseAuditMarkdown(FIXTURE_REGRESSION)
    expect(art.reproduction.unresolved).toEqual([])
    expect(art.reproduction.proposed).toHaveLength(1)
    expect(art.reproduction.observed).toHaveLength(2)
  })
})

describe('parseAuditMarkdown — constraints + audit sources', () => {
  test('extracts constraint bullets verbatim', () => {
    const art = parseAuditMarkdown(FIXTURE_REGRESSION)
    expect(art.constraints).toHaveLength(3)
    expect(art.constraints[0]).toBe(
      'Preserve: all existing plan validation tests must remain green.',
    )
  })

  test('extracts audit-source entries, including grep-form (no citation required)', () => {
    const art = parseAuditMarkdown(FIXTURE_CODEBASE_AUDIT)
    expect(art.auditSources).toHaveLength(4)
    const grepEntry = art.auditSources.find((s) => s.startsWith('grep:'))
    expect(grepEntry).toBe('grep:science_emitted in src/ — confirmed zero emit call sites.')
  })
})

describe('parseAuditMarkdown — rejection', () => {
  test('throws AuditLoadError on invalid input carrying issue codes', () => {
    const bad = '# AUDIT\n\n## Localization\n\n- x.\n'
    let err: unknown
    try {
      parseAuditMarkdown(bad)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AuditLoadError)
    const codes = (err as AuditLoadError).issues.map((i) => i.code)
    expect(codes).toContain('audit_missing_frontmatter')
  })
})
