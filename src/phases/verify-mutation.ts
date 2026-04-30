// VERIFY's mutation gate (per docs/contracts/VERIFY.md § "Mutation gate"
// + CODEX_RESPONSE_M8.md decisions 1, 3, 11, and risks).
//
// What the gate checks: "the new tests fail on reverted code." If the
// PLAN task added a test file, mutation revives the question of whether
// the new test actually catches the source change — by running the test
// against the source code BEFORE the patch was applied. If the test
// fails on reverted code, mutation passes (the test genuinely tests new
// behavior). If it passes on reverted code, mutation fails (tautology).
//
// Locked design choices:
//
//   - Applicability is conservative (CODEX_RESPONSE_M8.md decision 3
//     reject): no `Asserts:` flag in PLAN. Mutation is applicable iff
//     the changed-file manifest has at least one entry with
//     change='added' AND a path matching the configured test suffix
//     (default '.test.ts'), AND expectedExitCode === 0 (M8 risk: expected
//     non-zero exit makes mutation semantics muddy).
//
//   - Revert covers behavior (non-test) files only (CODEX_RESPONSE_M8.md
//     decision 11 reject-with-alternative). Test files — added OR
//     modified — stay at post-patch contents during replay. Reverting
//     the new test file would make `bun test new.test.ts` fail because
//     the file vanished, which would look like mutation pass even when
//     the source change wasn't tested.
//
//   - Status mapping rejects fake-pass (CODEX_RESPONSE_M8.md decision 1
//     + risks): mutation pass requires terminationReason='exit' AND
//     exitCode !== expectedExitCode. Timeout, stdout-cap, stderr-cap,
//     and spawn-error are all mutation FAILS — they tell us nothing
//     about whether the test catches the source change, so the gate
//     errs on the side of failure, not pass.
//
// The seams (RunnerSeam, RevertSeam) are dependency-injection
// surfaces so this module is fully testable offline and the actual
// revert plumbing (git checkout, file restore) lands in commit 10's
// orchestrator.

// --- types ---------------------------------------------------------

export interface ChangedFileEntry {
  readonly path: string
  readonly sha256: string
  readonly change: 'added' | 'modified' | 'deleted'
}

/**
 * Default test-file suffix matcher. v0.1 uses suffix matching, not full
 * glob — the contract example `**\/*.test.ts` reduces to a `.test.ts`
 * suffix in practice and avoids pulling in a glob library. Users with
 * non-standard test paths can pass a custom suffix.
 */
export const DEFAULT_TEST_SUFFIX = '.test.ts'

export type MutationStatus = 'pass' | 'fail' | 'not-applicable'

export interface MutationApplicability {
  readonly applicable: boolean
  /** Single-line reason; populated for both branches. */
  readonly reason: string
  /** Test files added by the patch — populated only when applicable. */
  readonly addedTests: readonly ChangedFileEntry[]
  /** Behavior files (non-tests) for revert — populated only when applicable. */
  readonly behaviorFiles: readonly ChangedFileEntry[]
}

export interface MutationStatusResult {
  readonly status: MutationStatus
  /** Single-line, ≤ 500 chars. Forwarded into VERIFY.md Mutation.Notes. */
  readonly notes: string
}

// --- pure helpers --------------------------------------------------

function matchesTest(path: string, suffix: string): boolean {
  return path.endsWith(suffix)
}

/**
 * Conservative mutation applicability per VERIFY.md § Mutation gate.
 * Returns reasons explicitly so the caller can populate Mutation.Notes.
 */
export function evaluateApplicability(input: {
  readonly changedFiles: readonly ChangedFileEntry[]
  readonly expectedExitCode: number
  readonly testSuffix?: string
}): MutationApplicability {
  const suffix = input.testSuffix ?? DEFAULT_TEST_SUFFIX
  const addedTests = input.changedFiles.filter(
    (f) => f.change === 'added' && matchesTest(f.path, suffix),
  )
  if (addedTests.length === 0) {
    return Object.freeze({
      applicable: false,
      reason:
        "no added test files in BUILD's ## Changed files manifest; modifications-only attempts skip the mutation gate.",
      addedTests: Object.freeze([]),
      behaviorFiles: Object.freeze([]),
    })
  }
  if (input.expectedExitCode !== 0) {
    return Object.freeze({
      applicable: false,
      reason: `expectedExitCode is ${input.expectedExitCode}; mutation gate requires expectedExitCode = 0 in v0.1.`,
      addedTests: Object.freeze([]),
      behaviorFiles: Object.freeze([]),
    })
  }
  const behaviorFiles = input.changedFiles.filter((f) => !matchesTest(f.path, suffix))
  return Object.freeze({
    applicable: true,
    reason: `${addedTests.length} added test file(s); ${behaviorFiles.length} behavior file(s) selected for revert.`,
    addedTests: Object.freeze([...addedTests]),
    behaviorFiles: Object.freeze([...behaviorFiles]),
  })
}

/**
 * Partitions a changed-file manifest into behavior (non-test) files for
 * revert. Test files (added or modified) are excluded — they stay at
 * post-patch contents during replay.
 */
export function selectBehaviorFiles(
  changedFiles: readonly ChangedFileEntry[],
  testSuffix: string = DEFAULT_TEST_SUFFIX,
): readonly ChangedFileEntry[] {
  return Object.freeze(changedFiles.filter((f) => !matchesTest(f.path, testSuffix)))
}

// --- runner result → mutation status --------------------------------

export interface RunnerResultShape {
  readonly terminationReason: 'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'
  readonly exitCode: number | null
  readonly durationMs: number
  readonly truncated?: { readonly stdout: boolean; readonly stderr: boolean }
}

/**
 * Maps a runner replay result to the mutation status. The function is
 * the single point where we lock the "abnormal termination is never
 * mutation pass" rule — every consumer of this module routes through
 * this gate. Notes are populated with what diagnostically matters: the
 * termination reason, the exit code (or null), and the
 * mutation-relevant interpretation.
 */
export function mutationStatusFromResult(input: {
  readonly result: RunnerResultShape
  readonly expectedExitCode: number
}): MutationStatusResult {
  const { result, expectedExitCode } = input
  switch (result.terminationReason) {
    case 'timeout':
      return Object.freeze({
        status: 'fail',
        notes: `mutation replay timed out (${result.durationMs} ms); cannot conclude tests catch source change.`,
      })
    case 'stdout-cap':
      return Object.freeze({
        status: 'fail',
        notes: 'mutation replay exceeded stdout cap; output truncated, cannot conclude.',
      })
    case 'stderr-cap':
      return Object.freeze({
        status: 'fail',
        notes: 'mutation replay exceeded stderr cap; output truncated, cannot conclude.',
      })
    case 'spawn-error':
      return Object.freeze({
        status: 'fail',
        notes: 'mutation replay failed to spawn the validation command.',
      })
    case 'exit': {
      if (result.exitCode === null) {
        return Object.freeze({
          status: 'fail',
          notes: 'mutation replay exited with null exit code (anomalous); cannot conclude.',
        })
      }
      if (result.exitCode === expectedExitCode) {
        return Object.freeze({
          status: 'fail',
          notes: `reverted code passed the new tests (exit ${result.exitCode} === expected ${expectedExitCode}); test does not catch the source change (tautological).`,
        })
      }
      return Object.freeze({
        status: 'pass',
        notes: `reverted code failed the new tests (exit ${result.exitCode} !== expected ${expectedExitCode}); mutation gate satisfied.`,
      })
    }
  }
}

// --- orchestration with seams --------------------------------------

export interface MutationRunnerInput {
  readonly command: string
  readonly cwd: string
  readonly timeoutMs: number
  readonly stdoutLogPath: string
  readonly stderrLogPath: string
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
}

export type RunnerSeam = (input: MutationRunnerInput) => Promise<RunnerResultShape>

/**
 * Save→revert→restore seam for behavior-file content. The orchestrator
 * implements this against the run worktree (git checkout for modified
 * files, fs.unlink for added files, etc.). Tests inject mocks. Snapshot
 * is opaque so different implementations can return whatever's needed
 * for restore (file contents, git stash ref, etc.).
 */
export interface RevertSeam {
  /** Save current contents of `paths` for later restore. */
  snapshot(paths: readonly string[]): Promise<unknown>
  /**
   * Make `paths` look like they did at `baseCommitSha`:
   * - For change='added' paths: delete the file (it didn't exist at base).
   * - For change='modified' paths: restore from base.
   * - For change='deleted' paths: re-create from base.
   */
  revert(files: readonly ChangedFileEntry[], baseCommitSha: string): Promise<void>
  /** Roll back to the snapshot taken before revert. */
  restore(snapshot: unknown): Promise<void>
}

export interface EvaluateMutationInput {
  readonly changedFiles: readonly ChangedFileEntry[]
  readonly baseCommitSha: string
  readonly command: string
  readonly cwd: string
  readonly timeoutMs: number
  readonly expectedExitCode: number
  readonly stdoutLogPath: string
  readonly stderrLogPath: string
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
  readonly testSuffix?: string
  readonly runner: RunnerSeam
  readonly revertSeam: RevertSeam
}

/**
 * Full mutation evaluation. Skips when applicability returns false; on
 * applicable, snapshots → reverts → replays → restores → maps result.
 * The restore step runs even on revert/replay errors so the worktree
 * state is preserved.
 */
export async function evaluateMutation(
  input: EvaluateMutationInput,
): Promise<MutationStatusResult> {
  const applicability = evaluateApplicability({
    changedFiles: input.changedFiles,
    expectedExitCode: input.expectedExitCode,
    testSuffix: input.testSuffix,
  })
  if (!applicability.applicable) {
    return Object.freeze({
      status: 'not-applicable',
      notes: applicability.reason,
    })
  }

  const behaviorPaths = applicability.behaviorFiles.map((f) => f.path)
  const snapshot = await input.revertSeam.snapshot(behaviorPaths)

  let result: RunnerResultShape
  try {
    await input.revertSeam.revert(applicability.behaviorFiles, input.baseCommitSha)
    result = await input.runner({
      command: input.command,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      stdoutLogPath: input.stdoutLogPath,
      stderrLogPath: input.stderrLogPath,
      maxStdoutBytes: input.maxStdoutBytes,
      maxStderrBytes: input.maxStderrBytes,
    })
  } finally {
    await input.revertSeam.restore(snapshot)
  }

  return mutationStatusFromResult({ result, expectedExitCode: input.expectedExitCode })
}
