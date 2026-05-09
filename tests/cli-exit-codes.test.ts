// CLI exit code contract tests — pinned by Codex R0 Risk #8.
//
// The contract has exactly three values (0/1/2) and one mapping helper.
// The helper is a switch on PhaseResultStatus; if a future phase result
// adds a status, TypeScript fails compilation here until the helper is
// updated. These tests lock the runtime mapping.

import { describe, expect, test } from 'bun:test'
import {
  EXIT_INTERVENTION,
  EXIT_OK,
  EXIT_USAGE,
  exitCodeForPhaseResult,
  type PhaseResultStatus,
} from '../src/cli/exit-codes.ts'

describe('CLI exit code constants', () => {
  test('EXIT_OK is 0', () => {
    expect(EXIT_OK).toBe(0)
  })

  test('EXIT_INTERVENTION is 1', () => {
    expect(EXIT_INTERVENTION).toBe(1)
  })

  test('EXIT_USAGE is 2', () => {
    expect(EXIT_USAGE).toBe(2)
  })

  test('the three constants are all distinct', () => {
    const values = new Set([EXIT_OK, EXIT_INTERVENTION, EXIT_USAGE])
    expect(values.size).toBe(3)
  })
})

describe('exitCodeForPhaseResult — gate-ready statuses map to EXIT_OK', () => {
  test("DEFINE/PLAN/BUILD 'complete' → 0", () => {
    expect(exitCodeForPhaseResult({ status: 'complete' })).toBe(EXIT_OK)
  })

  test("VERIFY 'completed' → 0", () => {
    expect(exitCodeForPhaseResult({ status: 'completed' })).toBe(EXIT_OK)
  })

  test("REVIEW 'resolved' → 0", () => {
    expect(exitCodeForPhaseResult({ status: 'resolved' })).toBe(EXIT_OK)
  })
})

describe('exitCodeForPhaseResult — non-gate-ready statuses map to EXIT_INTERVENTION', () => {
  test("any phase 'intervention' → 1", () => {
    expect(exitCodeForPhaseResult({ status: 'intervention' })).toBe(EXIT_INTERVENTION)
  })

  test("REVIEW 'needs_revision' → 1 (Codex R0 Risk #8 lock)", () => {
    // The load-bearing case: needs_revision is an EXPECTED outcome of the
    // review-debate loop but NOT gate-ready. Mapping to 0 would let CI
    // green-light a run with open findings; lock it to 1.
    expect(exitCodeForPhaseResult({ status: 'needs_revision' })).toBe(EXIT_INTERVENTION)
  })

  test("REVIEW 'blocked' → 1", () => {
    expect(exitCodeForPhaseResult({ status: 'blocked' })).toBe(EXIT_INTERVENTION)
  })

  test("VERIFY 'failed' → 1", () => {
    expect(exitCodeForPhaseResult({ status: 'failed' })).toBe(EXIT_INTERVENTION)
  })
})

describe('exitCodeForPhaseResult — exhaustiveness', () => {
  test('every PhaseResultStatus produces a defined exit code', () => {
    const statuses: readonly PhaseResultStatus[] = [
      'complete',
      'completed',
      'resolved',
      'intervention',
      'needs_revision',
      'blocked',
      'failed',
    ]
    for (const status of statuses) {
      const code = exitCodeForPhaseResult({ status })
      expect([EXIT_OK, EXIT_INTERVENTION]).toContain(code)
    }
  })

  test('return type is the union of EXIT_OK | EXIT_INTERVENTION (never EXIT_USAGE)', () => {
    // EXIT_USAGE is for argv/config errors detected before phase dispatch;
    // it is never produced by a phase result. The helper's return-type
    // annotation guarantees this at compile time, and we lock it at
    // runtime: walk every status and confirm none returns 2.
    const statuses: readonly PhaseResultStatus[] = [
      'complete',
      'completed',
      'resolved',
      'intervention',
      'needs_revision',
      'blocked',
      'failed',
    ]
    for (const status of statuses) {
      expect(exitCodeForPhaseResult({ status })).not.toBe(EXIT_USAGE)
    }
  })
})
