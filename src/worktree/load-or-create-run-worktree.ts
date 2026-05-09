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
//   - On a complete-on-disk run with NO prior `worktree_created` event,
//     refuse with `worktree_created_event_missing`. Re-emitting silently
//     would blur the file-based-signal discipline (rule 1); the operator
//     must confirm whether events.jsonl was lost or this dir is foreign.
//   - On any partial state (base.txt missing/malformed, worktree subdir
//     missing, sha mismatch between event and base.txt), refuse with
//     `worktree_partial_state` and a SPECIFIC detail naming the
//     inconsistency. Per Codex C4 review M3: generic "partial state" is
//     unactionable; operators need to know whether to delete the dir,
//     restore from backup, or file a bug.
//
// TOCTOU caveat (Codex C4 review R1): the wrapper does not acquire its own
// lock. Callers MUST hold a phase-level lock (build.lock / verify.lock /
// review.lock) before invoking this function, so two concurrent CLI
// processes can't race the probe-then-create. The C4 commit lands the
// build/verify locks; review.lock already exists.
//
// Refusal paths (cases 3 + 4) write `NEEDS_INTERVENTION.json` and append
// an `intervention` event before returning, so the run is durably
// blocked. The caller propagates the result; phase-function intervention
// short-circuits guarantee the run halts at the next gate.

import { access, readFile } from 'node:fs/promises'

import { runPaths as worktreeRunPaths, type WorktreePaths } from './paths.ts'
import {
  createRunWorktree,
  type DirtyTreePolicy,
} from './create-run-worktree.ts'
import { appendEvent, type EventLogPaths, readEvents } from '../state/events.ts'
import { writeNeedsInterventionGate, type GatePaths } from '../state/gates.ts'
import {
  isKnownPhaseEvent,
  type NeedsInterventionGate,
  type Phase,
} from '../state/schemas.ts'
import type { RunPaths } from '../state/run.ts'

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
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_partial_state',
      rule: `run dir present but worktree subdir missing (expected at ${wtPaths.worktree})`,
      detail: `base.txt records sha ${onDiskSha} but the git worktree at ${wtPaths.worktree} is gone`,
    })
  }

  const events = await readEvents(eventPathsFor(opts.runPaths))
  const priorCreated = events
    .filter(isKnownPhaseEvent)
    .find((e) => e.type === 'worktree_created')

  if (priorCreated === undefined) {
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_created_event_missing',
      rule: `worktree dir + base.txt present but no prior worktree_created event in events.jsonl for run ${opts.runId}`,
      detail: `worktree at ${wtPaths.worktree}, base.txt sha ${onDiskSha}; events.jsonl has no record of creation`,
    })
  }

  if (priorCreated.type !== 'worktree_created') {
    // Unreachable: the .find predicate already constrained type. This branch
    // exists for the type narrower; keep the throw so a future refactor can't
    // accidentally widen the predicate without surfacing the contract break.
    throw new Error('loadOrCreateRunWorktree: priorCreated type narrowing bug')
  }

  if (priorCreated.baseCommitSha !== onDiskSha) {
    return await refuseWithIntervention(opts, now, {
      code: 'worktree_partial_state',
      rule: `prior worktree_created.baseCommitSha (${priorCreated.baseCommitSha}) does not match on-disk base.txt sha (${onDiskSha}) for run ${opts.runId}`,
      detail: `events.jsonl asserts ${priorCreated.baseCommitSha}; ${wtPaths.baseFile} contains ${onDiskSha}`,
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
