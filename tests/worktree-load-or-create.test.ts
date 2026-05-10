// Tests for src/worktree/load-or-create-run-worktree.ts (M16 C4).
//
// The wrapper is the idempotent face of createRunWorktree: dispatchBuild
// creates the per-run worktree on first call; dispatchVerify and
// dispatchReview re-load it without creating a second one. The contract
// has four observable cases — fresh, idempotent reload, partial state
// (with sub-cases), and an event-missing refusal — verified here against
// the real on-disk shape (a temp git repo + state-side run dir).

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadOrCreateRunWorktree } from '../src/worktree/load-or-create-run-worktree.ts'
import { initRun, runPathsFor, type RunPaths } from '../src/state/run.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, isKnownPhaseEvent } from '../src/state/schemas.ts'
import { runPaths as worktreeRunPaths } from '../src/worktree/paths.ts'
import { createRunWorktree, runGit } from '../src/worktree/create-run-worktree.ts'
import { runDoctorGit } from '../src/commands/doctor.ts'

const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })
const FIXED_NOW = '2026-05-08T12:00:00.000Z'

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error(
      `worktree tests require git >= 2.40 on PATH; doctor reports: ${JSON.stringify(probe)}`,
    )
  }
})

let tmp: string
let projectRoot: string
let stateRunPaths: RunPaths

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'codeoz-load-or-create-'))
  // The project root must be a git repo so createRunWorktree's
  // `git rev-parse HEAD` and `git worktree add` succeed. State lives on
  // a separate path so the worktree-side and state-side trees are clearly
  // independent (two parallel run trees per docs/contracts/WORKTREE.md).
  projectRoot = join(tmp, 'project')
  const stateDir = join(tmp, 'state')
  const artifactRoot = join(tmp, 'artifacts')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })

  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'test@example.com'])
  await runGit(projectRoot, ['config', 'user.name', 'Test'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(projectRoot, 'README.md'), '# fixture\n', { encoding: 'utf8' })
  await runGit(projectRoot, ['add', 'README.md'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init'])

  stateRunPaths = runPathsFor(stateDir, artifactRoot, RUN)
  await mkdir(stateRunPaths.runDir, { recursive: true })
  await initRun({
    paths: stateRunPaths,
    profile: 'greenfield',
    runId: RUN,
    now: () => FIXED_NOW,
  })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function callWrapper(overrides: { readonly cwd?: string } = {}) {
  return loadOrCreateRunWorktree({
    cwd: overrides.cwd ?? projectRoot,
    runId: RUN,
    runPaths: stateRunPaths,
    phase: 'build',
    agent: 'builder',
    now: () => FIXED_NOW,
  })
}

async function readWorktreeCreatedEvents() {
  const events = await readEvents({
    file: stateRunPaths.eventsFile,
    lockDir: stateRunPaths.lockDir,
  })
  return events
    .filter(isKnownPhaseEvent)
    .filter((e) => e.type === 'worktree_created')
}

async function readInterventionEvents() {
  const events = await readEvents({
    file: stateRunPaths.eventsFile,
    lockDir: stateRunPaths.lockDir,
  })
  return events
    .filter(isKnownPhaseEvent)
    .filter((e) => e.type === 'intervention')
}

const NEEDS_INTERVENTION_FILE = (paths: RunPaths) =>
  join(paths.runDir, 'NEEDS_INTERVENTION.json')

// ---- Case 1: fresh runId ------------------------------------------

describe('loadOrCreateRunWorktree — fresh runId', () => {
  test('delegates to createRunWorktree, emits exactly one worktree_created, returns created: true', async () => {
    const result = await callWrapper()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.created).toBe(true)
    expect(result.baseCommitSha).toMatch(/^[0-9a-f]{40}$/)
    const wtPaths = worktreeRunPaths(projectRoot, RUN)
    expect(result.worktreePath).toBe(wtPaths.worktree)
    expect(result.paths.run).toBe(wtPaths.run)

    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(1)
    if (created[0]?.type !== 'worktree_created') return
    expect(created[0].baseCommitSha).toBe(result.baseCommitSha)
    expect(created[0].phase).toBe('build')
  })

  test('does NOT create NEEDS_INTERVENTION.json on the success path', async () => {
    const result = await callWrapper()
    expect(result.status).toBe('ok')
    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(false)
  })
})

// ---- Case 2: idempotent reload ------------------------------------

describe('loadOrCreateRunWorktree — idempotent reload', () => {
  test('second call returns created: false with the same baseCommitSha; no second event', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    const second = await callWrapper()
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.created).toBe(false)
    expect(second.baseCommitSha).toBe(first.baseCommitSha)

    // The audit trail must record creation exactly once. A second
    // `worktree_created` would blur the file-based-signal discipline.
    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(1)
  })

  test('idempotent reload returns the SAME WorktreePaths shape; base.txt + README.md still intact', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    const second = await callWrapper()
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return

    expect(second.paths).toEqual(first.paths)

    const baseTxt = await readFile(second.paths.baseFile, { encoding: 'utf8' })
    expect(baseTxt).toBe(second.baseCommitSha + '\n')
    const readme = await readFile(second.paths.readme, { encoding: 'utf8' })
    expect(readme).toContain(RUN)
    expect(readme).toContain(second.baseCommitSha)
  })
})

// ---- Case 4a: base.txt missing ------------------------------------

describe('loadOrCreateRunWorktree — partial state: base.txt missing', () => {
  test('returns worktree_partial_state with detail naming base.txt missing; files NOT deleted', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // Delete base.txt to simulate an interrupted createRunWorktree between
    // step 2 (worktree add) and step 4 (base.txt write).
    await unlink(first.paths.baseFile)

    const second = await callWrapper()
    expect(second.status).toBe('intervention')
    if (second.status !== 'intervention') return
    expect(second.code).toBe('worktree_partial_state')
    expect(second.rule).toContain('base.txt missing')

    // Side effects: NEEDS_INTERVENTION.json + intervention event present.
    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(true)
    const interventions = await readInterventionEvents()
    expect(interventions).toHaveLength(1)
    if (interventions[0]?.type !== 'intervention') return
    expect(interventions[0].code).toBe('worktree_partial_state')

    // On-disk files must NOT have been deleted by the wrapper.
    expect(existsSync(first.paths.run)).toBe(true)
    expect(existsSync(first.paths.worktree)).toBe(true)
    expect(existsSync(first.paths.readme)).toBe(true)
  })
})

// ---- Case 4b: base.txt malformed ----------------------------------

describe('loadOrCreateRunWorktree — partial state: base.txt malformed', () => {
  test('returns worktree_partial_state with detail naming malformed contents', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // 32-char hex (not the required 40) — common simulation of a
    // partially-written base.txt.
    await writeFile(first.paths.baseFile, '00112233445566778899aabbccddeeff\n', {
      encoding: 'utf8',
    })

    const second = await callWrapper()
    expect(second.status).toBe('intervention')
    if (second.status !== 'intervention') return
    expect(second.code).toBe('worktree_partial_state')
    expect(second.rule).toContain('malformed')
    expect(second.detail).toBeDefined()

    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(true)
    const interventions = await readInterventionEvents()
    expect(interventions).toHaveLength(1)
  })
})

// ---- Case 4c: worktree subdir missing -----------------------------

describe('loadOrCreateRunWorktree — partial state: worktree subdir missing', () => {
  test('returns worktree_partial_state with detail naming missing worktree subdir', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // Remove the worktree subdir but leave base.txt + run dir intact.
    // We use --force so the host git index loses track without erroring;
    // the wrapper's classifyExisting only inspects the filesystem.
    await runGit(projectRoot, ['worktree', 'remove', '--force', first.paths.worktree]).catch(
      () => null,
    )
    await rm(first.paths.worktree, { recursive: true, force: true })

    const second = await callWrapper()
    expect(second.status).toBe('intervention')
    if (second.status !== 'intervention') return
    expect(second.code).toBe('worktree_partial_state')
    expect(second.rule).toContain('worktree subdir missing')

    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(true)
  })
})

// ---- Case 4d: event sha mismatches base.txt -----------------------

describe('loadOrCreateRunWorktree — partial state: sha mismatch event vs base.txt', () => {
  test('returns worktree_partial_state with rule mentioning "does not match"', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // Overwrite base.txt with a DIFFERENT valid 40-hex sha. The
    // worktree_created event still references the original sha, so the
    // wrapper detects the mismatch.
    const otherSha = 'a'.repeat(40)
    await writeFile(first.paths.baseFile, otherSha + '\n', { encoding: 'utf8' })

    const second = await callWrapper()
    expect(second.status).toBe('intervention')
    if (second.status !== 'intervention') return
    expect(second.code).toBe('worktree_partial_state')
    expect(second.rule).toContain('does not match')
    // The rule must call out both the event sha and the on-disk sha so
    // the operator can decide which to trust.
    expect(second.rule).toContain(first.baseCommitSha)
    expect(second.rule).toContain(otherSha)

    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(true)
  })
})

// ---- R1 finding 3: audit-completeness recovery -------------------
//
// The prior shape refused (worktree_created_event_missing) when subdir
// + base.txt were present without a corresponding event, and used a
// first-match `find` for the worktree_created event lookup. Both
// behaviours are wrong when `recreateAfterTaskBoundary`'s git worktree
// add succeeded but its subsequent appendEvent crashed: the next call
// would silently match the pre-destroy event and proceed with the
// audit log saying "destroyed-then-never-recreated."
//
// Per locked R1 decision: the wrapper recovers by emitting a fresh
// `worktree_created` event so events.jsonl matches reality, then
// proceeds. Three matrix points are covered:
//   - subdir + post-destroy worktree_created   → matches (case 2 path)
//   - subdir + only pre-destroy worktree_created → recovery
//   - subdir + no worktree_created event ever  → recovery

describe('loadOrCreateRunWorktree — audit-completeness recovery (R1 finding 3)', () => {
  test('subdir + no prior worktree_created event → emit a fresh event and proceed', async () => {
    // Bypass the wrapper: createRunWorktree directly so the events.jsonl
    // never gets a worktree_created entry.
    const direct = await createRunWorktree({ cwd: projectRoot, runId: RUN })
    expect(direct.ok).toBe(true)
    if (!direct.ok) return

    const result = await callWrapper()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // Recovery branch — created: true (a fresh event was appended),
    // baseCommitSha matches base.txt.
    expect(result.created).toBe(true)
    expect(result.baseCommitSha).toMatch(/^[0-9a-f]{40}$/)

    // No NEEDS_INTERVENTION.json on the recovery path.
    expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(false)

    // Exactly one fresh worktree_created event written by the wrapper.
    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(1)

    // The on-disk run is still intact.
    expect(existsSync(direct.paths.run)).toBe(true)
    expect(existsSync(direct.paths.worktree)).toBe(true)
    expect(existsSync(direct.paths.baseFile)).toBe(true)

    // A subsequent call takes the idempotent-reload path (sha matches).
    const second = await callWrapper()
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.created).toBe(false)
    const createdAfter = await readWorktreeCreatedEvents()
    expect(createdAfter).toHaveLength(1)
  })

  // Crash-during-recreate window: the worktree_destroyed event is the
  // most recent, but the worktree subdir IS present (because git
  // worktree add succeeded before the appendEvent crash). The prior
  // shape's first-match `find` would match the ORIGINAL pre-destroy
  // worktree_created and proceed silently with the audit log saying
  // destroyed-then-never-recreated.
  test('subdir + only pre-destroy worktree_created → recovery branch fires', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // Simulate a destroy — append the event but leave subdir intact
    // (we want to assert the SUBDIR + LATEST_DESTROYED case, NOT the
    // case-5 missing-subdir path).
    const { appendEvent } = await import('../src/state/events.ts')
    await appendEvent(
      { file: stateRunPaths.eventsFile, lockDir: stateRunPaths.lockDir },
      {
        version: 1,
        type: 'worktree_destroyed',
        ts: FIXED_NOW,
        runId: RUN,
        phase: 'review',
        attempt: 1,
        worktreePath: first.paths.worktree,
      },
    )
    // Now a recreate would normally follow; simulate the crash by
    // NOT appending a follow-up worktree_created.

    const second = await callWrapper()
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.created).toBe(true) // recovery emitted a fresh event
    expect(second.baseCommitSha).toBe(first.baseCommitSha)

    // events.jsonl now has TWO worktree_created (initial + recovery).
    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(2)
  })
})

// ---- Case 5 (M16 C9 Mod #6): post-task-completed re-creation ------
//
// After approve-review for task N, preApproveReviewHook destroys the
// worktree subdir but `removeRunWorktree` preserves the run dir +
// base.txt. The wrapper detects the post-task-completed pattern via
// the latest `worktree_destroyed` event followed by a `task_completed`
// (no later `worktree_created`) and re-creates the worktree from
// the pinned base.txt sha.

describe('loadOrCreateRunWorktree — post-task-completed re-creation', () => {
  async function appendWorktreeDestroyed(attempt: number): Promise<void> {
    const { appendEvent } = await import('../src/state/events.ts')
    await appendEvent(
      { file: stateRunPaths.eventsFile, lockDir: stateRunPaths.lockDir },
      {
        version: 1,
        type: 'worktree_destroyed',
        ts: FIXED_NOW,
        runId: RUN,
        phase: 'review',
        attempt,
        worktreePath: worktreeRunPaths(projectRoot, RUN).worktree,
      },
    )
  }
  async function appendTaskCompleted(taskId: string, taskIndex: number): Promise<void> {
    const { appendEvent } = await import('../src/state/events.ts')
    await appendEvent(
      { file: stateRunPaths.eventsFile, lockDir: stateRunPaths.lockDir },
      {
        version: 1,
        type: 'task_completed',
        ts: FIXED_NOW,
        runId: RUN,
        taskId,
        taskIndex,
        reviewGatePath: join(stateRunPaths.runDir, 'GATE_REVIEW_PASSED.json'),
      },
    )
  }

  test('re-creates the worktree subdir + emits a fresh worktree_created event when post-task-completed pattern matches', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    // Simulate approve-review's worktree removal: rm via git + appendEvent(worktree_destroyed)
    await runGit(projectRoot, ['worktree', 'remove', '--force', first.paths.worktree]).catch(
      () => null,
    )
    await rm(first.paths.worktree, { recursive: true, force: true })
    await appendWorktreeDestroyed(1)
    // Then approveReviewTaskGate's task_completed lands.
    await appendTaskCompleted('T-001', 0)

    // Now the next dispatchBuild for task N+1 calls the wrapper. It
    // should re-create the worktree from base.txt's sha.
    const second = await callWrapper()
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.created).toBe(true)
    expect(second.baseCommitSha).toBe(first.baseCommitSha)
    expect(existsSync(first.paths.worktree)).toBe(true)

    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(2)
    if (created[1]?.type !== 'worktree_created') return
    expect(created[1].baseCommitSha).toBe(first.baseCommitSha)
  })

  test('does NOT recreate when worktree_destroyed has no following task_completed (treats as partial state)', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    await runGit(projectRoot, ['worktree', 'remove', '--force', first.paths.worktree]).catch(
      () => null,
    )
    await rm(first.paths.worktree, { recursive: true, force: true })
    await appendWorktreeDestroyed(1)
    // No task_completed appended — the destruction was caused by
    // something OTHER than the post-review cleanup (e.g., manual
    // operator removal). Wrapper must refuse rather than silently
    // re-create.

    const second = await callWrapper()
    expect(second.status).toBe('intervention')
    if (second.status !== 'intervention') return
    expect(second.code).toBe('worktree_partial_state')
    expect(second.rule).toContain('worktree subdir missing')
  })

  test('does NOT recreate when a later worktree_created already exists (idempotency through case-2 path)', async () => {
    const first = await callWrapper()
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    await runGit(projectRoot, ['worktree', 'remove', '--force', first.paths.worktree]).catch(
      () => null,
    )
    await rm(first.paths.worktree, { recursive: true, force: true })
    await appendWorktreeDestroyed(1)
    await appendTaskCompleted('T-001', 0)

    // First wrapper call after task boundary recreates → emits
    // worktree_created.
    const recreated = await callWrapper()
    expect(recreated.status).toBe('ok')
    if (recreated.status !== 'ok') return
    expect(recreated.created).toBe(true)

    // Now a subsequent wrapper call sees the worktree present and the
    // latest worktree_created event ahead of any worktree_destroyed —
    // case 2 (idempotent reload) with created: false.
    const idempotent = await callWrapper()
    expect(idempotent.status).toBe('ok')
    if (idempotent.status !== 'ok') return
    expect(idempotent.created).toBe(false)

    const created = await readWorktreeCreatedEvents()
    expect(created).toHaveLength(2) // initial + post-task-boundary recreate
  })
})

// ---- R1 finding 2: wrapper self-lock -----------------------------
//
// loadOrCreateRunWorktree must self-serialize so dispatchers can call
// it BEFORE entering the per-phase lock body (per C4 Mod #2, runtime
// functions self-lock). Two concurrent calls must NOT race the
// probe-then-create path. The lock primitive uses mkdir-as-mutex; the
// loser observes EEXIST and gets `worktree_already_in_flight`.

describe('loadOrCreateRunWorktree — self-lock (R1 finding 2)', () => {
  test('two simultaneous calls: one wins, one observes worktree_already_in_flight or the existing worktree', async () => {
    const [a, b] = await Promise.all([callWrapper(), callWrapper()])
    const results = [a, b] as const
    const oks = results.filter((r) => r.status === 'ok')
    const interventions = results.filter((r) => r.status === 'intervention')
    // Two outcomes are valid:
    //   1. one wins → ok(created:true), one observes the existing worktree → ok(created:false)
    //   2. one wins → ok(created:true), one races the lock → intervention(worktree_already_in_flight)
    // Both shapes preserve the invariant: at most one `worktree_created`
    // event in events.jsonl.
    expect(oks.length).toBeGreaterThanOrEqual(1)
    if (interventions.length > 0) {
      expect(interventions[0]!.status).toBe('intervention')
      if (interventions[0]!.status === 'intervention') {
        expect(interventions[0]!.code).toBe('worktree_already_in_flight')
      }
    }
    const created = await readWorktreeCreatedEvents()
    expect(created.length).toBe(1)
  })

  test('subsequent call after both finish takes the idempotent-reload path', async () => {
    await Promise.all([callWrapper(), callWrapper()])
    const third = await callWrapper()
    expect(third.status).toBe('ok')
    if (third.status !== 'ok') return
    expect(third.created).toBe(false)
    const created = await readWorktreeCreatedEvents()
    expect(created.length).toBe(1)
  })
})

// ---- Case 9: non-git cwd ------------------------------------------

describe('loadOrCreateRunWorktree — non-git cwd', () => {
  test('returns worktree_create_* intervention; writes NEEDS_INTERVENTION.json + intervention event', async () => {
    const nonGit = await mkdtemp(join(tmpdir(), 'codeoz-load-nogit-'))
    try {
      const result = await loadOrCreateRunWorktree({
        cwd: nonGit,
        runId: RUN,
        runPaths: stateRunPaths,
        phase: 'build',
        agent: 'builder',
        now: () => FIXED_NOW,
      })
      expect(result.status).toBe('intervention')
      if (result.status !== 'intervention') return
      // Allow any of the worktree_create_* failure codes; createRunWorktree
      // classifies "not a git repo" via `git rev-parse HEAD` failing first
      // (worktree_base_head_unknown) on most systems, but the contract just
      // requires one of the create-side intervention codes.
      expect(result.code.startsWith('worktree_create_') || result.code.startsWith('worktree_base_'))
        .toBe(true)

      expect(existsSync(NEEDS_INTERVENTION_FILE(stateRunPaths))).toBe(true)
      const interventions = await readInterventionEvents()
      expect(interventions).toHaveLength(1)
      if (interventions[0]?.type !== 'intervention') return
      expect(interventions[0].code).toBe(result.code)
    } finally {
      await rm(nonGit, { recursive: true, force: true })
    }
  })
})
