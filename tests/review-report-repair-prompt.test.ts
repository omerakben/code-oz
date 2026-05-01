// M9 commit 4: bounded repair prompt grammar.
//
// CODEX_RESPONSE_M9.md decision 9 pinned the format: error_code +
// violated_rule + ≤ 5 clipped offending_lines. Full failed drafts are
// NEVER appended (otherwise repair prompts grow unbounded across
// rounds and the persona drifts).

import { describe, test, expect } from 'bun:test'
import {
  renderRepairPrompt,
  REVIEW_REPAIR_OFFENDING_LINES_MAX,
} from '../src/artifacts/review-report.ts'

describe('renderRepairPrompt — bounded grammar', () => {
  test('emits error_code, violated_rule, offending_lines headers', () => {
    const out = renderRepairPrompt({
      errorCode: 'review_severity_invalid',
      violatedRule: 'Severity must be one of: block, fix-first, nit, fyi',
      offendingLines: ['- Severity: critical'],
    })
    expect(out).toContain('error_code: review_severity_invalid')
    expect(out).toContain('violated_rule: Severity must be one of:')
    expect(out).toContain('offending_lines:')
  })

  test('clips to REVIEW_REPAIR_OFFENDING_LINES_MAX (default 5)', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    const out = renderRepairPrompt({
      errorCode: 'x',
      violatedRule: 'y',
      offendingLines: lines,
    })
    // Body must contain the first 5 lines but not lines 6-10.
    for (let i = 1; i <= REVIEW_REPAIR_OFFENDING_LINES_MAX; i++) {
      expect(out).toContain(`line ${i}`)
    }
    expect(out).not.toContain('line 6')
    expect(out).not.toContain('line 10')
    expect(out).toContain(
      `(${10 - REVIEW_REPAIR_OFFENDING_LINES_MAX} more lines omitted)`,
    )
  })

  test('does NOT include the prior failed draft body', () => {
    const out = renderRepairPrompt({
      errorCode: 'x',
      violatedRule: 'y',
      offendingLines: ['- Severity: critical'],
    })
    // The repair prompt must explicitly forbid prior-draft regurgitation.
    expect(out).toContain('Do not include the prior draft in your response.')
  })

  test('emits a hint to re-emit canonical REVIEW.md', () => {
    const out = renderRepairPrompt({
      errorCode: 'x',
      violatedRule: 'y',
      offendingLines: ['line'],
    })
    expect(out).toContain('Re-emit the canonical REVIEW.md draft')
  })

  test('handles empty offending_lines (no clip notice)', () => {
    const out = renderRepairPrompt({
      errorCode: 'x',
      violatedRule: 'y',
      offendingLines: [],
    })
    expect(out).not.toContain('more lines omitted')
  })

  test('exact-boundary case (5 lines): no clip notice', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`)
    const out = renderRepairPrompt({
      errorCode: 'x',
      violatedRule: 'y',
      offendingLines: lines,
    })
    expect(out).not.toContain('more lines omitted')
  })

  test('REVIEW_REPAIR_OFFENDING_LINES_MAX is exactly 5 (CODEX_RESPONSE_M9.md decision 9)', () => {
    expect(REVIEW_REPAIR_OFFENDING_LINES_MAX).toBe(5)
  })
})
