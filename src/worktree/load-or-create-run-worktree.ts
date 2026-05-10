// Idempotent wrapper over `createRunWorktree` (per M16 R0 Q2 + C4).
//
// The runtime calls this every time a phase needs the per-run worktree:
// dispatchBuild creates it on first BUILD; dispatchVerify and dispatchReview
// re-load it without creating a second one. The contract:
//
//   - On a fresh runId (run dir absent), delegate to `createRunWorktree`,
//     emit `worktree_created` exactly once, and return ok with
//     `created: true`.
//   - On a complete prior run (run dir present, base.txt parseable, worktree
//     subdir present, prior `worktree_created` event in events.jsonl with
//     matching baseCommitSha), return ok with `created: false`. No event
//     re-emission — the audit trail must record creation exactly once.
//   - On a complete-on-disk run with the latest `worktree_created` BEFORE
//     the latest `worktree_destroyed` (or no `worktree_created` event at
//     all), audit-recover by emitting a fresh `worktree_created` event
//     and returning ok with `created: true`. Per R1 finding 3 (locked
//     decision): the recreateAfterTaskBoundary path can crash AFTER
//     `git worktree add` but BEFORE `appendEvent(worktree_created)`,
//     leaving the dir on disk without an event. The prior shape's
//     first-match `find` silently matched the pre-destroy event;
//     recovery surfaces the truth and lets the run continue.
//   - On any partial state (base.txt missing/malformed, worktree subdir
//     missing, sha mismatch between event and base.txt), refuse with
//     `worktree_partial_state` and a SPECIFIC detail naming the
//     inconsistency. Per Codex C4 review M3: generic "partial state" is
//     unactionable; operators need to know whether to delete the dir,
//     restore from backup, or file a bug.
//
// Self-lock contract (R1 finding 2 fix, supersedes C4 R1 caveat):
// the wrapper acquires a worktree-level lock at `<runDir>/.worktree.lock`
// for the duration of the probe-then-create / probe-then-classify body.
// Per-phase locks are held by `runBuild` / `runVerify` / `runReview`
// (see C4 Mod #2: dispatchers do NOT hold the phase lock; runtime
// functions self-lock). Without a wrapper-level lock, two concurrent
// `code-oz run` processes that both reach the dispatcher's
// `loadOrCreateRunWorktree` call BEFORE entering the runtime function
// can race the probe-then-create path; the loser writes a false
// `NEEDS_INTERVENTION` (case 4 / 4d). The lock makes the wrapper safe
// to call from any dispatcher / approve hook without coordinating
// caller-side serialization.
//
// On `LockBusyError`, the wrapper returns a `worktree_already_in_flight`
// intervention without writing a gate file — mirrors runBuild's
// `build_already_in_flight` shape (no durable orchestration outcome to
// record beyond the in-memory result; another process is mid-load).
//
// Refusal paths (cases 3 + 4) write `NEEDS_INTERVENTION.json` and append
// an `intervention` event before returning, so the run is durably
// blocked. The caller propagates the result; phase-function intervention
// short-circuits guarantee the run halts at the next gate.

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runPaths as worktreeRunPaths, type WorktreePaths } from './paths.ts'
import {
  createRunWorktree,
  runGit,
  type DirtyTreePolicy,
} from './create-run-worktree.ts'
import { appendEvent, type EventLogPaths, readEvents } from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import { LockBusyError, withLock } from '../state/lock.ts'
import {
  isKnownPhaseEvent,
  type LoggedEvent,
  type NeedsInterventionGate,
  type Phase,
} from '../state/schemas.ts'
import type { RunPaths } from '../state/run.ts'

type WorktreeCreatedEvent = Extract<LoggedEvent, { type: 'worktree_created' }>

const SHA_REGEX = /^[0-9a-f]{40}$/

export interface LoadOrCreateRunWorktreeOptions {
  /** Project root for git worktree creation. */
  readonly cwd: string
  readonly runId: string
  /**
   * State-side run paths (`.code-oz/state/runs/<runId>/...`). Used for
   * event-log reads + writes and intervention-gate writes. Must point at
   * a directory created by `initRun` so `lockDir` is acquirable.
   */
  readonly runPaths: RunPaths
  /**
   * Phase that owns the call. Recorded on the `worktree_created` event
   * and on the intervention-gate file. Typical: 'build' (first creator),
   * 'verify' / 'review' (idempotent reload).
   */
  readonly phase: Phase
  /**
   * Persona that owns the call. Recorded on the intervention-gate file
   * for case 3/4 refusals. Typical: 'builder' / 'verifier' / 'reviewer'.
   */
  readonly agent: string
  readonly dirtyTreePolicy?: DirtyTreePolicy
  readonly now?: () => string
}

export type LoadOrCreateInterventionCode =
  | 'worktree_partial_state'
  | 'worktree_created_event_missing'
  | 'worktree_create_path_exists'
  | 'worktree_create_base_unknown'
  | 'worktree_create_supporting_dirs_failed'
  | 'worktree_create_metadata_write_failed'
  | 'worktree_create_not_a_repo'
  | 'worktree_base_sha_invalid'
  | 'worktree_base_head_unknown'
  | 'worktree_stash_create_failed'
  | 'worktree_add_failed'
  | 'worktree_already_in_flight'

export interface LoadOrCreateRunWorktreeOk {
  readonly status: 'ok'
  /** True on first creation; false on idempotent reload. */
  readonly created: boolean
  readonly baseCommitSha: string
  readonly worktreePath: string
  readonly paths: WorktreePaths
}

export interface LoadOrCreateRunWorktreeIntervention {
  readonly status: 'intervention'
  readonly code: LoadOrCreateInterventionCode
  readonly rule: string
  readonly detail?: string
}

export type LoadOrCreateRunWorktreeResult =
  | LoadOrCreateRunWorktreeOk
  | LoadOrCreateRunWorktreeIntervention

export async function loadOrCreateRunWorktree(
  opts: LoadOrCreateRunWorktreeOptions,
): Promise<LoadOrCreateRunWorktreeResult> {
  // R1 finding 2 — wrapper-level self-lock. The lock dir lives under
  // the state-side run dir (NOT the worktree-side run dir), so it sits
  // beside the existing per-phase locks (.build.lock / .verify.lock /
  // .review.lock) and shares the same `withLock` primitive.
  //
  // The lock is held for the entire probe-then-create / probe-then-
  // classify / recreate body, including the appendEvent calls (which
  // serialize via runPaths.lockDir under the hood). Two concurrent
  // dispatchers will then either both observe a complete fresh worktree
  // (loser takes the idempotent-reload path inside the same critical
  // section) or one returns `worktree_already_in_flight` if the loser
  // races IN the kernel layer.
  const worktreeLockDir = join(opts.runPaths.runDir, '.worktree.lock')
  try {
    return await withLock(worktreeLockDir, () => loadOrCreateRunWorktreeLocked(opts))
  } catch (err) {
    if (err instanceof LockBusyError) {
      return Object.freeze({
        status: 'intervention' as const,
        code: 'worktree_already_in_flight' as const,
        rule: `another loadOrCreateRunWorktree is in progress for run ${opts.runId} (lock at ${worktreeLockDir})`,
      })
    }
    throw err
  }
}

async function loadOrCreateRunWorktreeLocked(
  opts: LoadOrCreateRunWorktreeOptions,
): Promise<LoadOrCreateRunWorktreeResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const wtPaths = worktreeRunPaths(opts.cwd, opts.runId)

  const runDirExists = await pathExists(wtPaths.run)
  if (!runDirExists) {
    return await createFresh(opts, now)
  }
  return await classifyExisting(opts, wtPaths, now)
}

async function createFresh(
  opts: LoadOrCreateRunWorktreeOptions,
  now: () => string,
): Promise<LoadOrCreateRunWorktreeResult> {
  const policy: DirtyTreePolicy = opts.dirtyTreePolicy ?? 'clean-base'
  const result = await createRunWorktree({
    cwd: opts.cwd,
    runId: opts.runId,
    dirtyTreePolicy: policy,
  })
  if (!result.ok) {
    return await refuseWithIntervention(opts, now, {
      code: result.code as LoadOrCreateInterventionCode,
      rule: `worktree creation failed at step ${result.step}: ${result.code}`,
      detail: result.reason,
    })
  }
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'worktree_created',
    ts: now(),
    runId: opts.runId,
    phase: opts.phase,
    baseCommitSha: result.baseCommitSha,
    worktreePath: result.worktreePath,
    dirtyTreePolicy: result.dirtyTreePolicy,
  })
  return Object.freeze({
    status: 'ok' as const,
    created: true,
    baseCommitSha: result.baseCommitSha,
    worktreePath: result.worktreePath,
    paths: result.paths,
  })
}

async function classifyExisting(
  opts: LoadOrCreateRunWorktreeOptions,
  wtPaths: WorktreePaths,
  now: () => string,
): Promise<LoadOrCreateRunWorktreeResult> {
  const baseRead = await readBaseTxt(wtPaths.baseFile)
  if (baseRead.kind === 'missing') {
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_partial_state',
      rule: `worktree dir present but base.txt missing (expected at ${wtPaths.baseFile})`,
      detail: 'either createRunWorktree was interrupted between step 2 (worktree add) and step 4 (base.txt write), or the dir was created by something other than code-oz',
    })
  }
  if (baseRead.kind === 'malformed') {
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_partial_state',
      rule: `worktree dir present but base.txt malformed (expected 40-char lower-hex sha + newline at ${wtPaths.baseFile})`,
      detail: baseRead.detail,
    })
  }
  const onDiskSha = baseRead.sha

  if (!(await pathExists(wtPaths.worktree))) {
    // Two recreation patterns recognise the missing-subdir case as
    // legitimate (NOT a partial-state refusal):
    //
    //   - M16 C9 Mod #6: post-task-completed re-creation. After
    //     approve-review for task N, preApproveReviewHook destroys
    //     the worktree but preserves the run dir + base.txt +
    //     patches/. Pattern = latest `worktree_destroyed` followed
    //     by `task_completed` AND no later `worktree_created`.
    //
    //   - M16 R1 fix-first: verify-fail re-creation. Codex flagged
    //     the verify-fail restart e2e as a coverage gap; running it
    //     surfaces a previously-untested production path. After
    //     `scheduleAttemptNPlus1` removes the failed worktree (emits
    //     `worktree_destroyed` + `verify_restart_initiated`), the
    //     next BUILD attempt for the same task needs the worktree
    //     back. Pattern = latest `worktree_destroyed` followed by
    //     `verify_restart_initiated{nextAction:'restart'}` AND no
    //     later `worktree_created`.
    //
    // Both patterns recreate from base.txt's sha (NOT a fresh
    // capture — the run's base commit is already pinned). When
    // neither pattern matches we fall through to the
    // `worktree_partial_state` refusal (the dir was destroyed by
    // something other than the recognised flows).
    const events = await readEvents(eventPathsFor(opts.runPaths))
    if (
      isPostTaskCompletedRecreation(events, opts.runId) ||
      isPostVerifyFailRecreation(events, opts.runId)
    ) {
      return await recreateAfterTaskBoundary(opts, wtPaths, onDiskSha, now)
    }
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_partial_state',
      rule: `run dir present but worktree subdir missing (expected at ${wtPaths.worktree})`,
      detail: `base.txt records sha ${onDiskSha} but the git worktree at ${wtPaths.worktree} is gone`,
    })
  }

  const events = await readEvents(eventPathsFor(opts.runPaths))
  // R1 finding 3 — audit completeness for crash-during-recreate.
  // Walk for the LATEST `worktree_created` and the LATEST
  // `worktree_destroyed` for this runId. Three buckets:
  //
  //   A. latest_created exists AND (no destroy OR latest_created >
  //      latest_destroyed): the existing happy idempotent-reload path.
  //   B. subdir is present but the latest `worktree_created` is BEFORE
  //      the latest `worktree_destroyed` (i.e., a destroy happened and
  //      the recreate event was lost — `git worktree add` succeeded
  //      but appendEvent crashed). Audit-completeness recovery: emit
  //      a fresh `worktree_created` event so events.jsonl matches
  //      reality, then proceed to the sha-equality check via the
  //      next call into the wrapper.
  //   C. no `worktree_created` event ever exists. Per locked R1
  //      decision (Codex finding 3, third bullet): also recovery —
  //      silently treating the dir as foreign was the prior behavior
  //      and is too brittle when the audit log was truncated/lost
  //      between sessions. Recovery emits a fresh event and proceeds.
  //
  // The prior shape used a first-match `find` which would silently
  // match the ORIGINAL pre-destroy worktree_created in bucket B,
  // letting events.jsonl claim "destroyed-then-never-recreated" while
  // a real worktree sat on disk.
  let latestCreatedIdx = -1
  let latestCreated: WorktreeCreatedEvent | undefined
  let latestDestroyedIdx = -1
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (!isKnownPhaseEvent(e)) continue
    if (e.runId !== opts.runId) continue
    if (e.type === 'worktree_created') {
      if (i > latestCreatedIdx) {
        latestCreatedIdx = i
        latestCreated = e as WorktreeCreatedEvent
      }
    } else if (e.type === 'worktree_destroyed') {
      if (i > latestDestroyedIdx) latestDestroyedIdx = i
    }
  }

  const matchedAfterDestroy =
    latestCreatedIdx !== -1 && latestCreatedIdx > latestDestroyedIdx
  if (matchedAfterDestroy && latestCreated !== undefined) {
    if (latestCreated.baseCommitSha !== onDiskSha) {
      return await refuseWithIntervention(opts, now, {
        code: 'worktree_partial_state',
        rule: `prior worktree_created.baseCommitSha (${latestCreated.baseCommitSha}) does not match on-disk base.txt sha (${onDiskSha}) for run ${opts.runId}`,
        detail: `events.jsonl asserts ${latestCreated.baseCommitSha}; ${wtPaths.baseFile} contains ${onDiskSha}`,
      })
    }
    return Object.freeze({
      status: 'ok' as const,
      created: false,
      baseCommitSha: onDiskSha,
      worktreePath: wtPaths.worktree,
      paths: wtPaths,
    })
  }

  // Recovery branch (bucket B + bucket C). Emit an audit-completeness
  // `worktree_created` event so the on-disk reality is durable in
  // events.jsonl. The new event re-uses the on-disk base.txt sha; the
  // sha-equality check on the next call into the wrapper will then
  // succeed (matchedAfterDestroy → ok).
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'worktree_created',
    ts: now(),
    runId: opts.runId,
    phase: opts.phase,
    baseCommitSha: onDiskSha,
    worktreePath: wtPaths.worktree,
    dirtyTreePolicy: 'clean-base',
  })
  return Object.freeze({
    status: 'ok' as const,
    created: true,
    baseCommitSha: onDiskSha,
    worktreePath: wtPaths.worktree,
    paths: wtPaths,
  })
}

type BaseTxtReadResult =
  | { readonly kind: 'ok'; readonly sha: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed'; readonly detail: string }

async function readBaseTxt(path: string): Promise<BaseTxtReadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'missing' }
    throw err
  }
  const trimmed = raw.trim()
  if (!SHA_REGEX.test(trimmed)) {
    const preview = trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed
    return {
      kind: 'malformed',
      detail: `base.txt contents (${trimmed.length} chars after trim) did not match /^[0-9a-f]{40}$/: ${JSON.stringify(preview)}`,
    }
  }
  return { kind: 'ok', sha: trimmed }
}

interface InterventionPayload {
  readonly code: LoadOrCreateInterventionCode
  readonly rule: string
  readonly detail?: string
}

async function refuseWithIntervention(
  opts: LoadOrCreateRunWorktreeOptions,
  now: () => string,
  payload: InterventionPayload,
): Promise<LoadOrCreateRunWorktreeIntervention> {
  const gate: NeedsInterventionGate = {
    version: 1,
    runId: opts.runId,
    phase: opts.phase,
    agent: opts.agent,
    code: payload.code,
    rule: payload.rule,
    ...(payload.detail !== undefined ? { detail: payload.detail } : {}),
    actionableSuggestions: actionableSuggestionsFor(payload.code),
    createdAt: now(),
  }
  await writeNeedsInterventionGate(gatePathsFor(opts.runPaths), gate)
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'intervention',
    ts: now(),
    runId: opts.runId,
    phase: opts.phase,
    code: payload.code,
  })
  return Object.freeze({
    status: 'intervention' as const,
    code: payload.code,
    rule: payload.rule,
    ...(payload.detail !== undefined ? { detail: payload.detail } : {}),
  })
}

function actionableSuggestionsFor(
  code: LoadOrCreateInterventionCode,
): readonly string[] {
  switch (code) {
    case 'worktree_partial_state':
      return Object.freeze([
        'Inspect .code-oz/runs/<runId>/ for the specific inconsistency named in the intervention rule (base.txt, worktree subdir, or sha mismatch).',
        'If the dir was created by an interrupted prior run, remove .code-oz/runs/<runId>/ and re-run; the run will recreate the worktree from the same base sha.',
        'If the dir contains operator data you need to keep, back it up before removal — code-oz will not auto-delete user content.',
      ])
    case 'worktree_created_event_missing':
      return Object.freeze([
        'The run dir + base.txt are present but events.jsonl has no worktree_created event for this run.',
        'This means events.jsonl was lost / rotated, OR the run dir was copied from a different run.',
        'Confirm the source of the run dir; if events.jsonl was truly lost, the run cannot be safely resumed (mid-run state is gone).',
        'Manual remediation: remove .code-oz/runs/<runId>/ and start a fresh run.',
      ])
    case 'worktree_create_path_exists':
      return Object.freeze([
        'createRunWorktree refused to overwrite an existing run path.',
        'This usually means the wrapper was called with a stale runId or the run state was reset without clearing the worktree.',
        'Manual remediation: remove .code-oz/runs/<runId>/ and re-run.',
      ])
    case 'worktree_create_not_a_repo':
      return Object.freeze([
        'git refused to create the worktree because cwd is not a git repository.',
        'Run `git init` in the project root, or check that you are running code-oz from the correct directory.',
      ])
    case 'worktree_create_base_unknown':
      return Object.freeze([
        'git refused to create the worktree because the base commit could not be resolved.',
        'Confirm HEAD points at a real commit (run `git log -1`); fresh repos with no commits cannot host a worktree.',
      ])
    case 'worktree_create_supporting_dirs_failed':
      return Object.freeze([
        'createRunWorktree could not create patches/forensics/build-drafts subdirs after the worktree was added.',
        'Likely a filesystem permission or quota issue. Inspect .code-oz/runs/<runId>/ and the surrounding fs state; fix the root cause and re-run.',
      ])
    case 'worktree_create_metadata_write_failed':
      return Object.freeze([
        'createRunWorktree could not write base.txt / README.md after the worktree was added.',
        'Likely a filesystem permission or quota issue. Best-effort rollback removed the worktree subdir; remove the run dir and re-run.',
      ])
    case 'worktree_base_sha_invalid':
    case 'worktree_base_head_unknown':
      return Object.freeze([
        'git could not resolve the base commit for the worktree.',
        'Confirm the project is a git repo with at least one commit and HEAD is valid; re-run after the underlying git state is healthy.',
      ])
    case 'worktree_stash_create_failed':
      return Object.freeze([
        'git stash create failed under stash-and-pin policy.',
        'Inspect the working tree for unrecoverable state (broken merge, conflicted files); resolve manually before re-running.',
      ])
    case 'worktree_add_failed':
      return Object.freeze([
        'git worktree add failed for an unclassified reason.',
        'Inspect the surrounding git state, including .git/worktrees/, and remove stale worktree entries before re-running.',
      ])
    case 'worktree_already_in_flight':
      return Object.freeze([
        'Another `code-oz run` process is currently loading this run\'s worktree.',
        'Wait for it to complete, then re-run.',
        'If you suspect the previous process crashed, remove `<runDir>/.worktree.lock` and re-run.',
      ])
  }
}

function eventPathsFor(p: RunPaths): EventLogPaths {
  return { file: p.eventsFile, lockDir: p.lockDir }
}

function gatePathsFor(p: RunPaths): GatePaths {
  return { runDir: p.runDir, artifactRoot: p.artifactRoot, lockDir: p.lockDir }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * M16 C9 Mod #6 — detect "the worktree subdir is missing because
 * approve-review just destroyed it for the task boundary" pattern.
 *
 * The pattern: the latest `worktree_destroyed` event for this runId
 * is followed by a `task_completed` event AND no later
 * `worktree_created` event has re-created the worktree. The order
 * matters because `task_completed` is appended AFTER worktree
 * removal (preApproveReviewHook + approveReviewTaskGate sequence
 * the writes inside the same approval transaction).
 */
function isPostTaskCompletedRecreation(
  events: readonly { readonly type: string; readonly runId?: string }[],
  runId: string,
): boolean {
  let latestDestroyedIdx = -1
  let latestCreatedAfterIdx = -1
  let taskCompletedAfterDestroyed = false
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (e.runId !== runId) continue
    if (e.type === 'worktree_destroyed') {
      latestDestroyedIdx = i
      latestCreatedAfterIdx = -1
      taskCompletedAfterDestroyed = false
      continue
    }
    if (latestDestroyedIdx === -1) continue
    if (e.type === 'worktree_created') {
      latestCreatedAfterIdx = i
      continue
    }
    if (e.type === 'task_completed') {
      taskCompletedAfterDestroyed = true
    }
  }
  if (latestDestroyedIdx === -1) return false
  if (latestCreatedAfterIdx > latestDestroyedIdx) return false
  return taskCompletedAfterDestroyed
}

/**
 * M16 R1 fix-first companion to `isPostTaskCompletedRecreation` —
 * the verify-fail restart variant. After `scheduleAttemptNPlus1`
 * removes the failed worktree, it appends `worktree_destroyed`
 * followed by `verify_restart_initiated{nextAction:'restart'}`.
 * The next BUILD attempt for the same task expects the worktree
 * back (M16 C9 Mod #1 derives attempt N+1 from carryForward; the
 * orchestration assumes the wrapper provides a fresh worktree).
 *
 * Pattern: latest `worktree_destroyed` is followed by a
 * `verify_restart_initiated` whose `nextAction === 'restart'`,
 * AND no later `worktree_created` has re-created the worktree.
 * The order matches scheduleAttemptNPlus1's emission sequence.
 *
 * The detector deliberately does NOT match
 * `nextAction === 'intervention'` — that path means the 4-attempt
 * cap was reached and the run is durably paused; recreating the
 * worktree silently would mask the operator-required halt.
 */
function isPostVerifyFailRecreation(
  events: readonly { readonly type: string; readonly runId?: string; readonly nextAction?: string }[],
  runId: string,
): boolean {
  let latestDestroyedIdx = -1
  let latestCreatedAfterIdx = -1
  let verifyRestartAfterDestroyed = false
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (e.runId !== runId) continue
    if (e.type === 'worktree_destroyed') {
      latestDestroyedIdx = i
      latestCreatedAfterIdx = -1
      verifyRestartAfterDestroyed = false
      continue
    }
    if (latestDestroyedIdx === -1) continue
    if (e.type === 'worktree_created') {
      latestCreatedAfterIdx = i
      continue
    }
    if (e.type === 'verify_restart_initiated' && e.nextAction === 'restart') {
      verifyRestartAfterDestroyed = true
    }
  }
  if (latestDestroyedIdx === -1) return false
  if (latestCreatedAfterIdx > latestDestroyedIdx) return false
  return verifyRestartAfterDestroyed
}

/**
 * M16 C9 Mod #6 — re-create the worktree subdir from the pinned
 * base.txt sha after a post-task-completed destruction. Emits a fresh
 * `worktree_created` event so the audit trail records the
 * re-creation; the new event re-uses the same `baseCommitSha` so the
 * sha-equality check in `classifyExisting` (which the next call into
 * this wrapper performs) remains satisfied.
 *
 * `git worktree add --detach` is the same primitive `createRunWorktree`
 * uses; we re-use `runGit` for the call. The supporting dirs (patches
 * /, forensics/, build-drafts/) are preserved by removeRunWorktree, so
 * we only re-add the worktree subdir itself.
 */
async function recreateAfterTaskBoundary(
  opts: LoadOrCreateRunWorktreeOptions,
  wtPaths: WorktreePaths,
  baseCommitSha: string,
  now: () => string,
): Promise<LoadOrCreateRunWorktreeResult> {
  const addResult = await runGit(opts.cwd, [
    'worktree',
    'add',
    '--detach',
    wtPaths.worktree,
    baseCommitSha,
  ])
  if (!addResult.ok) {
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_add_failed',
      rule: `task-boundary recreation: git worktree add failed for sha ${baseCommitSha}`,
      detail: addResult.stderr.trim().slice(0, 200) || 'git worktree add returned non-zero',
    })
  }
  await appendEvent(eventPathsFor(opts.runPaths), {
    version: 1,
    type: 'worktree_created',
    ts: now(),
    runId: opts.runId,
    phase: opts.phase,
    baseCommitSha,
    worktreePath: wtPaths.worktree,
    dirtyTreePolicy: 'clean-base',
  })
  return Object.freeze({
    status: 'ok' as const,
    created: true,
    baseCommitSha,
    worktreePath: wtPaths.worktree,
    paths: wtPaths,
  })
}
