// M15 Phase 2 C13b — pure helper unit tests for the REVIEW production
// fire path (`src/phases/review-fire-path.ts`).
//
// Coverage focus: the pure helpers the executor closure inside
// `runReviewRoundLocked` calls. Production wiring + lock-collision proof
// land in the C17 generated FakeProvider production e2e (per the Codex
// replan plan in `docs/research/CODEX_RESPONSE_M15_REPLAN.md`).

import { describe, expect, test } from 'bun:test'
import {
  selectEligibleOpponent,
  buildDebateTopicForReview,
  buildDebateBriefingSections,
  diffFindingsForPostDebateBasic,
  mapProviderErrorToFireResult,
  buildSchedulerPreflightInputForSingle,
  buildDebateFilesManifest,
} from '../src/phases/review-fire-path.ts'
import type { AgentDefinition } from '../src/agents/schema.ts'
import type {
  ProviderFamily,
  ProviderId,
} from '../src/providers/types.ts'
import { providerError } from '../src/providers/errors.ts'
import type { ReviewFinding } from '../src/artifacts/review-report.ts'

// Minimal stub registry honoring the two methods selectEligibleOpponent
// uses. The real ProviderRegistry class has more surface; the helper only
// touches `familyOf` and `capabilityOf`, which is exactly what the unit
// test exercises.
type StubRegistry = {
  familyOf: (id: ProviderId) => ProviderFamily
  capabilityOf: (id: ProviderId) => { eligiblePhases: readonly string[] }
}

function reviewerWithOpposing(
  opposing: readonly string[],
  reviewerProvider: ProviderId = 'codex',
): AgentDefinition {
  return Object.freeze({
    file: '/tmp/reviewer.md',
    name: 'reviewer',
    type: 'agent',
    phase: 'review',
    provider: reviewerProvider,
    modelPolicy: 'any',
    permissions: Object.freeze({
      read: '*' as const,
      write: Object.freeze(['.code-oz/artifacts/REVIEW.md']),
      bash: 'deny' as const,
      tool_use: Object.freeze({
        debate: Object.freeze({
          opposingProviders: Object.freeze(opposing) as readonly never[],
          maxConcurrent: 1,
          previewBeforeSend: true as const,
          maxFiles: 16,
          timeoutMs: 120_000,
        }),
      } as never),
    }),
    description: 'test reviewer',
    body: '# reviewer body',
  }) as AgentDefinition
}

function eligibleAll(): StubRegistry {
  return {
    familyOf: (id: ProviderId) => id as unknown as ProviderFamily,
    capabilityOf: (_id: ProviderId) => ({
      eligiblePhases: ['define', 'plan', 'build', 'verify', 'review', 'ship', 'audit'] as readonly string[],
    }),
  }
}

// ---------------------------------------------------------------------------
// selectEligibleOpponent
// ---------------------------------------------------------------------------
describe('selectEligibleOpponent', () => {
  test('returns null when reviewer has no debate permission', () => {
    const reviewer = Object.freeze({
      file: '/tmp/r.md',
      name: 'r',
      type: 'agent',
      phase: 'review',
      provider: 'codex' as ProviderId,
      modelPolicy: 'any',
      permissions: Object.freeze({
        read: '*' as const,
        bash: 'deny' as const,
      }),
      description: 'test',
      body: '#',
    }) as AgentDefinition
    expect(selectEligibleOpponent(reviewer, eligibleAll() as never)).toBeNull()
  })

  test('returns null when opposingProviders is empty', () => {
    const reviewer = reviewerWithOpposing([] as never)
    expect(selectEligibleOpponent(reviewer, eligibleAll() as never)).toBeNull()
  })

  test('picks the first opposing provider that is M11-eligible and cross-family', () => {
    const reviewer = reviewerWithOpposing(['claude'], 'codex')
    expect(selectEligibleOpponent(reviewer, eligibleAll() as never)).toBe('claude')
  })

  test("filters out the reviewer's own family", () => {
    // Hypothetical persona declaration that includes its own family — schema
    // would normally reject this at load time, but the runtime filter is a
    // belt-and-suspenders.
    const reviewer = reviewerWithOpposing(['codex', 'claude'], 'codex')
    expect(selectEligibleOpponent(reviewer, eligibleAll() as never)).toBe('claude')
  })

  test('filters out opponents whose capabilities exclude review', () => {
    const reviewer = reviewerWithOpposing(['gemini', 'claude'], 'codex')
    const registry: StubRegistry = {
      familyOf: (id) => id as unknown as ProviderFamily,
      capabilityOf: (id) =>
        id === 'gemini'
          ? { eligiblePhases: [] as readonly string[] }
          : { eligiblePhases: ['review'] as readonly string[] },
    }
    expect(selectEligibleOpponent(reviewer, registry as never)).toBe('claude')
  })

  test('returns null when every candidate is filtered out', () => {
    const reviewer = reviewerWithOpposing(['gemini'], 'codex')
    const registry: StubRegistry = {
      familyOf: (id) => id as unknown as ProviderFamily,
      capabilityOf: (_id) => ({ eligiblePhases: [] as readonly string[] }),
    }
    expect(selectEligibleOpponent(reviewer, registry as never)).toBeNull()
  })

  test('skips candidates whose capability lookup throws', () => {
    const reviewer = reviewerWithOpposing(['unknown' as never as 'claude', 'claude'], 'codex')
    const registry: StubRegistry = {
      familyOf: (id) => id as unknown as ProviderFamily,
      capabilityOf: (id) => {
        if (id === ('unknown' as ProviderId)) throw new Error('unknown id')
        return { eligiblePhases: ['review'] as readonly string[] }
      },
    }
    expect(selectEligibleOpponent(reviewer, registry as never)).toBe('claude')
  })
})

// ---------------------------------------------------------------------------
// buildDebateTopicForReview
// ---------------------------------------------------------------------------
describe('buildDebateTopicForReview', () => {
  test('produces a lowercase-kebab topic with round + attempt + task tag', () => {
    const t = buildDebateTopicForReview({ taskId: 'T-001', attempt: 1, round: 2 })
    expect(t).toBe('review-r2-a1-t-001')
    expect(t.length).toBeLessThanOrEqual(48)
  })

  test('clips to 48 characters and stays lowercase-kebab', () => {
    const veryLongTaskId = 'TASK-' + 'A'.repeat(80)
    const t = buildDebateTopicForReview({ taskId: veryLongTaskId, attempt: 1, round: 1 })
    expect(t.length).toBeLessThanOrEqual(48)
    expect(t).toMatch(/^[a-z0-9-]+$/)
  })

  test('coerces non-kebab characters to hyphens', () => {
    const t = buildDebateTopicForReview({
      taskId: 'TASK_With.Special@chars',
      attempt: 3,
      round: 4,
    })
    expect(t).toMatch(/^[a-z0-9-]+$/)
    expect(t.startsWith('review-r4-a3-')).toBe(true)
  })

  test('falls back to "task" when the taskId yields no kebab characters', () => {
    const t = buildDebateTopicForReview({ taskId: '!@#$', attempt: 1, round: 1 })
    expect(t).toBe('review-r1-a1-task')
  })

  test('different (round, attempt, taskId) tuples produce different topics', () => {
    const a = buildDebateTopicForReview({ taskId: 'T-1', attempt: 1, round: 1 })
    const b = buildDebateTopicForReview({ taskId: 'T-1', attempt: 1, round: 2 })
    const c = buildDebateTopicForReview({ taskId: 'T-1', attempt: 2, round: 1 })
    const d = buildDebateTopicForReview({ taskId: 'T-2', attempt: 1, round: 1 })
    const set = new Set([a, b, c, d])
    expect(set.size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// buildDebateBriefingSections
// ---------------------------------------------------------------------------
describe('buildDebateBriefingSections', () => {
  const baseInput = (
    overrides: Partial<Parameters<typeof buildDebateBriefingSections>[0]> = {},
  ): Parameters<typeof buildDebateBriefingSections>[0] => ({
    reviewerAgent: reviewerWithOpposing(['claude']),
    opposingProvider: 'claude' as ProviderId,
    round: 2,
    attempt: 1,
    taskId: 'T-001',
    preReviewVerdict: 'needs-revision',
    preReviewScore: 6,
    preReviewFindings: [],
    buildReportPath: '.code-oz/artifacts/BUILD_REPORT.md',
    verifyReportPath: '.code-oz/artifacts/VERIFY.md',
    reviewReportPath: '.code-oz/artifacts/REVIEW.md',
    changedFilePaths: ['src/foo.ts', 'tests/foo.test.ts'],
    fireReason: 'score_in_grey_zone',
    ...overrides,
  })

  test('returns all seven required sections', () => {
    const s = buildDebateBriefingSections(baseInput())
    expect(s.whatYouAreReading.length).toBeGreaterThan(0)
    expect(s.whereWeStand.length).toBeGreaterThan(0)
    expect(s.whatIsLocked.length).toBeGreaterThan(0)
    expect(s.whatIsUpForDebate.length).toBeGreaterThan(0)
    expect(s.recommendedPath.length).toBeGreaterThan(0)
    expect(s.decisionPrompts.length).toBeGreaterThan(0)
    expect(s.whatIWantFromYou.length).toBeGreaterThan(0)
  })

  test('whereWeStand lists the pre-debate verdict + score + findings', () => {
    const findings = makeFindings([
      { id: 'F-001', severity: 'fix-first', file: 'src/a.ts', line: 10 },
      { id: 'F-002', severity: 'block', file: 'src/b.ts', line: 5 },
    ])
    const s = buildDebateBriefingSections(baseInput({ preReviewFindings: findings }))
    expect(s.whereWeStand).toContain('needs-revision')
    expect(s.whereWeStand).toContain('score=6')
    expect(s.whereWeStand).toContain('F-001')
    expect(s.whereWeStand).toContain('F-002')
    expect(s.whereWeStand).toContain('src/a.ts:10')
  })

  test('whereWeStand handles the no-findings case', () => {
    const s = buildDebateBriefingSections(baseInput({ preReviewFindings: [] }))
    expect(s.whereWeStand).toContain('(no findings raised)')
  })

  test('whatYouAreReading names the fire reason in the briefing', () => {
    const grey = buildDebateBriefingSections(baseInput({ fireReason: 'score_in_grey_zone' }))
    expect(grey.whatYouAreReading).toContain('grey zone')
    const high = buildDebateBriefingSections(
      baseInput({ fireReason: 'needs_revision_with_high_score', preReviewScore: 7 }),
    )
    expect(high.whatYouAreReading).toContain('>=6')
    const panel = buildDebateBriefingSections(
      baseInput({ fireReason: 'panel_voter_disagreement' }),
    )
    expect(panel.whatYouAreReading).toContain('panel')
  })

  test('whatIsLocked emphasizes REVIEW gate authority + cross-family invariant', () => {
    const s = buildDebateBriefingSections(baseInput())
    expect(s.whatIsLocked).toContain('REVIEW gate authority')
    expect(s.whatIsLocked).toContain('Cross-family invariant')
    expect(s.whatIsLocked).toContain('rule 1')
  })

  test('recommendedPath adapts to the pre-debate verdict', () => {
    const nr = buildDebateBriefingSections(baseInput({ preReviewVerdict: 'needs-revision' }))
    expect(nr.recommendedPath).toContain('ready')
    const blk = buildDebateBriefingSections(baseInput({ preReviewVerdict: 'block' }))
    expect(blk.recommendedPath).toContain('needs-revision')
    const rdy = buildDebateBriefingSections(baseInput({ preReviewVerdict: 'ready' }))
    expect(rdy.recommendedPath).toContain('regression')
  })
})

// ---------------------------------------------------------------------------
// diffFindingsForPostDebateBasic
// ---------------------------------------------------------------------------
describe('diffFindingsForPostDebateBasic', () => {
  test('counts new ids only', () => {
    const pre = makeFindings([
      { id: 'F-001', severity: 'fix-first', file: 'a.ts', line: 1 },
      { id: 'F-002', severity: 'block', file: 'b.ts', line: 1 },
    ])
    const post = makeFindings([
      { id: 'F-001', severity: 'fix-first', file: 'a.ts', line: 1 }, // carry-over
      { id: 'F-003', severity: 'fix-first', file: 'c.ts', line: 1 }, // new actionable
      { id: 'F-004', severity: 'nit', file: 'd.ts', line: 1 }, // new, not actionable
    ])
    const d = diffFindingsForPostDebateBasic(pre, post)
    expect(d.findingsAddedCount).toBe(2)
    expect(d.actionableFindingsAddedCount).toBe(1)
  })

  test('returns zero when post is empty', () => {
    const pre = makeFindings([
      { id: 'F-001', severity: 'block', file: 'a.ts', line: 1 },
    ])
    const d = diffFindingsForPostDebateBasic(pre, [])
    expect(d.findingsAddedCount).toBe(0)
    expect(d.actionableFindingsAddedCount).toBe(0)
  })

  test('counts ALL post findings as added when pre is empty', () => {
    const post = makeFindings([
      { id: 'F-001', severity: 'block', file: 'a.ts', line: 1 },
      { id: 'F-002', severity: 'fix-first', file: 'b.ts', line: 1 },
      { id: 'F-003', severity: 'nit', file: 'c.ts', line: 1 },
      { id: 'F-004', severity: 'fyi', file: 'd.ts', line: 1 },
    ])
    const d = diffFindingsForPostDebateBasic([], post)
    expect(d.findingsAddedCount).toBe(4)
    expect(d.actionableFindingsAddedCount).toBe(2)
  })

  test('does NOT count nit or fyi as actionable (DEBATE_POLICY § new-actionable-finding rate)', () => {
    const post = makeFindings([
      { id: 'F-100', severity: 'nit', file: 'a.ts', line: 1 },
      { id: 'F-101', severity: 'fyi', file: 'b.ts', line: 1 },
    ])
    const d = diffFindingsForPostDebateBasic([], post)
    expect(d.findingsAddedCount).toBe(2)
    expect(d.actionableFindingsAddedCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// mapProviderErrorToFireResult
// ---------------------------------------------------------------------------
describe('mapProviderErrorToFireResult', () => {
  test('maps provider_auth_missing to intervention auth_missing', () => {
    const err = providerError('provider_auth_missing', 'no token', ['login'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_auth_missing')
    expect(r.underlyingErrorCode).toBe('provider_auth_missing')
  })

  test('maps provider_auth_expired to intervention auth_missing (same recovery)', () => {
    const err = providerError('provider_auth_expired', 'expired', ['re-login'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_auth_missing')
  })

  test('maps provider_permissions_violation to intervention permissions_violation', () => {
    const err = providerError('provider_permissions_violation', 'cross-family', ['fix persona'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_permissions_violation')
  })

  test('maps debate_concurrent_limit_exceeded to intervention concurrent_limit', () => {
    const err = providerError('debate_concurrent_limit_exceeded', 'maxC', ['resolve'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_concurrent_limit')
  })

  test('maps debate_topic_collision to intervention topic_collision', () => {
    const err = providerError('debate_topic_collision', 'dup', ['rename'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_topic_collision')
  })

  test('maps debate_manifest_blocked to intervention manifest_blocked', () => {
    const err = providerError('debate_manifest_blocked', 'ignore', ['fix'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('intervention')
    if (r.status !== 'intervention') return
    expect(r.interventionCode).toBe('debate_scheduler_manifest_blocked')
  })

  test('maps debate_response_invalid to error_degrade artifact_invalid', () => {
    const err = providerError('debate_response_invalid', 'bad', ['fix'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('error_degrade')
    if (r.status !== 'error_degrade') return
    expect(r.errorReason).toBe('artifact_invalid')
  })

  test('maps debate_decision_invalid to error_degrade artifact_invalid', () => {
    const err = providerError('debate_decision_invalid', 'bad', ['fix'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('error_degrade')
    if (r.status !== 'error_degrade') return
    expect(r.errorReason).toBe('artifact_invalid')
  })

  test('maps provider_io_error and provider_rate_limit to error_degrade transient_io', () => {
    for (const code of ['provider_io_error', 'provider_rate_limit'] as const) {
      const err = providerError(code, 'transient', ['retry'])
      const r = mapProviderErrorToFireResult(err, 'claude', 't')
      expect(r.status).toBe('error_degrade')
      if (r.status !== 'error_degrade') continue
      expect(r.errorReason).toBe('transient_io')
    }
  })

  test('maps unrecognized ProviderError codes to error_degrade other', () => {
    const err = providerError('provider_budget_exceeded', 'over', ['tune'])
    const r = mapProviderErrorToFireResult(err, 'claude', 't')
    expect(r.status).toBe('error_degrade')
    if (r.status !== 'error_degrade') return
    expect(r.errorReason).toBe('other')
    expect(r.underlyingErrorCode).toBe('provider_budget_exceeded')
  })

  test('non-ProviderError exceptions degrade with the truncated error message', () => {
    const r = mapProviderErrorToFireResult(new Error('boom'), 'claude', 't')
    expect(r.status).toBe('error_degrade')
    if (r.status !== 'error_degrade') return
    expect(r.errorReason).toBe('other')
    expect(r.underlyingErrorCode).toBe('boom')
  })

  test('non-ProviderError exception messages are clipped to 200 chars', () => {
    const long = 'x'.repeat(500)
    const r = mapProviderErrorToFireResult(new Error(long), 'claude', 't')
    if (r.status !== 'error_degrade') throw new Error('expected error_degrade')
    expect((r.underlyingErrorCode ?? '').length).toBeLessThanOrEqual(200)
  })
})

// ---------------------------------------------------------------------------
// buildSchedulerPreflightInputForSingle
// ---------------------------------------------------------------------------
describe('buildSchedulerPreflightInputForSingle', () => {
  test('returns single-mode preflight with reviewer role + 1 post-review call', () => {
    const i = buildSchedulerPreflightInputForSingle()
    expect(i.phase).toBe('review')
    expect(i.role).toBe('reviewer')
    expect(i.postReviewProviderCalls).toBe(1)
    expect(i.opposingMaxTokens).toBeGreaterThan(0)
    expect(i.synthesisMaxTokens).toBeGreaterThan(0)
    expect(i.postReviewMaxTokens).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// buildDebateFilesManifest
// ---------------------------------------------------------------------------
describe('buildDebateFilesManifest', () => {
  test('always includes the three artifact files first', () => {
    const m = buildDebateFilesManifest({
      buildReportPath: 'BUILD_REPORT.md',
      verifyReportPath: 'VERIFY.md',
      reviewReportPath: 'REVIEW.md',
      changedFilePaths: ['src/a.ts', 'src/b.ts'],
      maxFiles: 16,
    })
    expect(m.slice(0, 3)).toEqual(['BUILD_REPORT.md', 'VERIFY.md', 'REVIEW.md'])
    expect(m).toContain('src/a.ts')
    expect(m).toContain('src/b.ts')
  })

  test('caps at maxFiles', () => {
    const m = buildDebateFilesManifest({
      buildReportPath: 'BUILD_REPORT.md',
      verifyReportPath: 'VERIFY.md',
      reviewReportPath: 'REVIEW.md',
      changedFilePaths: Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`),
      maxFiles: 16,
    })
    expect(m.length).toBe(16)
  })

  test('drops changed-file slots when maxFiles is small', () => {
    const m = buildDebateFilesManifest({
      buildReportPath: 'BUILD_REPORT.md',
      verifyReportPath: 'VERIFY.md',
      reviewReportPath: 'REVIEW.md',
      changedFilePaths: ['src/a.ts'],
      maxFiles: 2,
    })
    expect(m.length).toBe(2)
    expect(m).not.toContain('src/a.ts')
  })

  test('preserves declaration order of changedFilePaths', () => {
    const m = buildDebateFilesManifest({
      buildReportPath: 'BUILD_REPORT.md',
      verifyReportPath: 'VERIFY.md',
      reviewReportPath: 'REVIEW.md',
      changedFilePaths: ['src/z.ts', 'src/a.ts', 'src/m.ts'],
      maxFiles: 16,
    })
    expect(m[3]).toBe('src/z.ts')
    expect(m[4]).toBe('src/a.ts')
    expect(m[5]).toBe('src/m.ts')
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeFindings(
  spec: readonly {
    readonly id: string
    readonly severity: 'block' | 'fix-first' | 'nit' | 'fyi'
    readonly file: string
    readonly line: number
  }[],
): readonly ReviewFinding[] {
  return Object.freeze(
    spec.map(
      (s) =>
        Object.freeze({
          id: s.id,
          severity: s.severity,
          file: s.file,
          line: String(s.line),
          title: `${s.id} title`,
          recommendation: `${s.id} fix`,
          roundRaised: 1,
          roundResolved: 'unresolved' as const,
        }) as unknown as ReviewFinding,
    ),
  )
}
