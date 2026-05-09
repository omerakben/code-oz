// M15 commit 6a — `code-oz doctor --debate-policy` inspector tests.
//
// Coverage: inspector module behavior (without invoking the CLI process).
// The CLI integration is covered indirectly — wiring just dispatches to
// inspectDebatePolicy + formatDebatePolicyTable.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectDebatePolicy,
  formatDebatePolicyTable,
  resolveActiveRunEventsFile,
  DEBATE_POLICY_INSPECTOR_LIMIT,
} from '../src/commands/doctor-debate-policy.ts'
import {
  appendEvent,
  type EventLogPaths,
} from '../src/state/events.ts'
import { generateUlid } from '../src/state/schemas.ts'
import {
  DEFAULT_CONFIG,
  DEFAULT_DEBATE_POLICY,
  type CodeOzConfig,
} from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-doctor-policy-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const TS = '2026-05-08T07:00:00.000Z'
const SHA64A = 'a'.repeat(64)

async function writeEvents(events: readonly object[]): Promise<string> {
  const file = join(tmp, 'events.jsonl')
  const paths: EventLogPaths = { file, lockDir: file + '.lock' }
  for (const e of events) {
    await appendEvent(paths, e as never)
  }
  return file
}

// ---------------------------------------------------------------------------
// Effective policy resolution
// ---------------------------------------------------------------------------
describe('inspectDebatePolicy — effective policy', () => {
  test('default config -> effectiveSource=default', async () => {
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG })
    expect(report.effectiveSource).toBe('default')
    expect(report.effectivePolicy.mode).toBe('manual')
    expect(report.effectivePolicy).toEqual(DEFAULT_DEBATE_POLICY)
  })

  test('config with debatePolicy -> effectiveSource=config', async () => {
    const config: CodeOzConfig = {
      ...DEFAULT_CONFIG,
      debatePolicy: {
        ...DEFAULT_DEBATE_POLICY,
        mode: 'auto',
        triggers: { ...DEFAULT_DEBATE_POLICY.triggers, reviewScoreGreyZone: { min: 4, max: 8 } },
        cooldown: { ...DEFAULT_DEBATE_POLICY.cooldown },
      },
    }
    const report = await inspectDebatePolicy({ config })
    expect(report.effectiveSource).toBe('config')
    expect(report.effectivePolicy.mode).toBe('auto')
    expect(report.effectivePolicy.triggers.reviewScoreGreyZone).toEqual({ min: 4, max: 8 })
  })
})

// ---------------------------------------------------------------------------
// Event tabulation
// ---------------------------------------------------------------------------
describe('inspectDebatePolicy — event counts and reasons', () => {
  test('no events file -> all counts zero, eventsSource null', async () => {
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG })
    expect(report.eventsSource).toBeNull()
    expect(report.counts).toEqual({
      evaluated: 0,
      fired: 0,
      skipped: 0,
      error: 0,
      postreview: 0,
    })
    expect(report.recentEvents).toEqual([])
  })

  test('counts skipped + fired correctly', async () => {
    const file = await writeEvents([
      {
        version: 1,
        type: 'debate_scheduler_evaluated',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        decisionId: generateUlid(),
        reviewRound: 1,
        mode: 'auto',
        inputDigest: SHA64A,
        preReviewReportSha256: SHA64A,
        reviewMode: 'single',
      },
      {
        version: 1,
        type: 'debate_scheduler_skipped',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        decisionId: generateUlid(),
        reviewRound: 1,
        reason: 'mode_manual',
        preReviewReportSha256: SHA64A,
      },
      {
        version: 1,
        type: 'debate_scheduler_fired',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-002',
        decisionId: generateUlid(),
        reviewRound: 1,
        reason: 'score_in_grey_zone',
        opposingProvider: 'gemini',
        debateTopic: 'review-grey-zone-001',
        preReviewReportSha256: SHA64A,
      },
    ])

    const report = await inspectDebatePolicy({
      config: DEFAULT_CONFIG,
      eventsFile: file,
    })
    expect(report.counts.evaluated).toBe(1)
    expect(report.counts.skipped).toBe(1)
    expect(report.counts.fired).toBe(1)
    expect(report.skipReasons).toEqual([{ reason: 'mode_manual', count: 1 }])
    expect(report.fireReasons).toEqual([{ reason: 'score_in_grey_zone', count: 1 }])
  })

  test('skip reasons sorted desc by count', async () => {
    const events: object[] = []
    for (let i = 0; i < 3; i++) {
      events.push({
        version: 1,
        type: 'debate_scheduler_skipped',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: `T-${String(100 + i).padStart(3, '0')}`,
        decisionId: generateUlid(),
        reviewRound: 1,
        reason: 'mode_manual',
        preReviewReportSha256: SHA64A,
      })
    }
    for (let i = 0; i < 5; i++) {
      events.push({
        version: 1,
        type: 'debate_scheduler_skipped',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: `T-${String(200 + i).padStart(3, '0')}`,
        decisionId: generateUlid(),
        reviewRound: 1,
        reason: 'no_trigger_matched',
        preReviewReportSha256: SHA64A,
      })
    }
    const file = await writeEvents(events)
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG, eventsFile: file })
    expect(report.skipReasons).toEqual([
      { reason: 'no_trigger_matched', count: 5 },
      { reason: 'mode_manual', count: 3 },
    ])
  })

  test('limit caps the recent-events tail', async () => {
    const events: object[] = []
    for (let i = 0; i < 30; i++) {
      events.push({
        version: 1,
        type: 'debate_scheduler_evaluated',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: `T-${String(300 + i).padStart(3, '0')}`,
        decisionId: generateUlid(),
        reviewRound: 1,
        mode: 'auto',
        inputDigest: SHA64A,
        preReviewReportSha256: SHA64A,
        reviewMode: 'single',
      })
    }
    const file = await writeEvents(events)
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG, eventsFile: file })
    expect(report.recentEvents.length).toBe(DEBATE_POLICY_INSPECTOR_LIMIT)
  })

  test('explicit limit override', async () => {
    const events: object[] = []
    for (let i = 0; i < 10; i++) {
      events.push({
        version: 1,
        type: 'debate_scheduler_evaluated',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: `T-${String(300 + i).padStart(3, '0')}`,
        decisionId: generateUlid(),
        reviewRound: 1,
        mode: 'auto',
        inputDigest: SHA64A,
        preReviewReportSha256: SHA64A,
        reviewMode: 'single',
      })
    }
    const file = await writeEvents(events)
    const report = await inspectDebatePolicy({
      config: DEFAULT_CONFIG,
      eventsFile: file,
      limit: 3,
    })
    expect(report.recentEvents.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Active-run pointer resolution
// ---------------------------------------------------------------------------
describe('resolveActiveRunEventsFile', () => {
  test('valid pointer returns expected events.jsonl path', async () => {
    const stateDir = join(tmp, 'state')
    await mkdir(stateDir, { recursive: true })
    const activeFile = join(stateDir, 'active.json')
    await writeFile(activeFile, JSON.stringify({ runId: RUN }), 'utf8')
    const path = await resolveActiveRunEventsFile({ stateDir, activeFile })
    expect(path).toBe(join(stateDir, 'runs', RUN, 'events.jsonl'))
  })

  test('missing pointer returns null', async () => {
    const stateDir = join(tmp, 'state')
    const path = await resolveActiveRunEventsFile({
      stateDir,
      activeFile: join(stateDir, 'active.json'),
    })
    expect(path).toBeNull()
  })

  test('malformed pointer returns null', async () => {
    const stateDir = join(tmp, 'state')
    await mkdir(stateDir, { recursive: true })
    const activeFile = join(stateDir, 'active.json')
    await writeFile(activeFile, '{not json', 'utf8')
    const path = await resolveActiveRunEventsFile({ stateDir, activeFile })
    expect(path).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Table formatter
// ---------------------------------------------------------------------------
describe('formatDebatePolicyTable', () => {
  test('default config produces sentinel-friendly output', async () => {
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG })
    const text = formatDebatePolicyTable(report)
    expect(text).toContain('# code-oz doctor --debate-policy')
    expect(text).toContain('source: default')
    expect(text).toContain('mode: manual')
    expect(text).toContain('triggers.reviewScoreGreyZone: [5, 7]')
  })

  test('with events the recent-events block is populated', async () => {
    const file = await writeEvents([
      {
        version: 1,
        type: 'debate_scheduler_fired',
        ts: TS,
        runId: RUN,
        phase: 'review',
        agent: 'reviewer',
        attempt: 1,
        taskId: 'T-001',
        decisionId: generateUlid(),
        reviewRound: 2,
        reason: 'score_in_grey_zone',
        opposingProvider: 'gemini',
        debateTopic: 'review-grey-zone-001',
        preReviewReportSha256: SHA64A,
      },
    ])
    const report = await inspectDebatePolicy({ config: DEFAULT_CONFIG, eventsFile: file })
    const text = formatDebatePolicyTable(report)
    expect(text).toContain('debate_scheduler_fired')
    expect(text).toContain('opp=gemini')
    expect(text).toContain('round=2')
  })
})
