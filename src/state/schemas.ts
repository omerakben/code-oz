// Shared schemas and types for the M3 state machine, event log, and gate writers.
// The canonical contract is pinned in docs/references/file-based-gates.md.

export const PHASES = ['define', 'plan', 'build', 'verify', 'review', 'ship', 'audit'] as const
export type Phase = (typeof PHASES)[number]

export const PROFILES = ['greenfield', 'brownfield'] as const
export type Profile = (typeof PROFILES)[number]

export const GREENFIELD_SEQUENCE: readonly Phase[] = Object.freeze([
  'define',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
])

export const BROWNFIELD_SEQUENCE: readonly Phase[] = Object.freeze([
  'audit',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
])

// Canonical phase -> artifact mapping. Pinned in docs/references/file-based-gates.md
// "Canonical phase -> artifact map". Paths are relative to the run's artifact
// root (v0.1: .code-oz/artifacts/), so the values here are bare filenames.
export const CANONICAL_ARTIFACTS: Readonly<Record<Phase, string>> = Object.freeze({
  define: 'SPEC.md',
  audit: 'AUDIT.md',
  plan: 'PLAN.md',
  build: 'BUILD_REPORT.md',
  verify: 'VERIFY.md',
  review: 'REVIEW.md',
  ship: 'SHIP.md',
})

// ULID: 26-char Crockford base32. 48-bit timestamp + 80-bit random.
// Crockford alphabet excludes I, L, O, U.
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value)
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LEN = 10
const RAND_LEN = 16
const MAX_TIME_MS = 0xffffffffffff // 2^48 - 1

function encodeBase32(value: bigint, len: number): string {
  let chars = ''
  let n = value
  for (let i = 0; i < len; i++) {
    chars = CROCKFORD[Number(n & 0x1fn)] + chars
    n >>= 5n
  }
  return chars
}

export interface UlidOptions {
  readonly now?: number
  readonly random?: Uint8Array
}

export function generateUlid(opts: UlidOptions = {}): string {
  const now = opts.now ?? Date.now()
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIME_MS) {
    throw new RangeError(`ULID timestamp out of range: ${now} (must be 0..${MAX_TIME_MS})`)
  }
  let randomBytes: Uint8Array
  if (opts.random !== undefined) {
    if (opts.random.length !== 10) {
      throw new RangeError(`ULID requires 10 random bytes, got ${opts.random.length}`)
    }
    randomBytes = opts.random
  } else {
    randomBytes = new Uint8Array(10)
    crypto.getRandomValues(randomBytes)
  }
  let randomBits = 0n
  for (const b of randomBytes) randomBits = (randomBits << 8n) | BigInt(b)
  return encodeBase32(BigInt(now), TIME_LEN) + encodeBase32(randomBits, RAND_LEN)
}

// Event-log line schema — version 1. Future schema bumps increment this number.
// Required on every event: version, type, ts (ISO 8601), runId.

export const EVENT_TYPES = [
  'run_started',
  'phase_entered',
  'phase_exited',
  'agent_invoked',
  'agent_completed',
  'gate_written',
  'gate_required',
  'intervention',
  'run_ended',
  // M5 — ask-me conversation content. Reducer treats both as no-ops; the
  // events exist for the audit trail and W2+ replay tooling.
  'ask_me_user_input',
  'ask_me_persona_reply',
  // M6 — repo-context tool calls (per docs/contracts/REPO_CONTEXT.md).
  // Counts against the existing tool-call cap when model-issued; never
  // increments maxProviderCalls (Codex decision 2 in CODEX_RESPONSE_M6.md).
  'repo_context_searched',
  // M6 — Scientist phase-tail audit trail (per docs/contracts/SCIENTIST.md,
  // HYPOTHESES.md, OPEN_QUESTIONS.md). All no-ops in the reducer.
  'science_emitted',
  'hypothesis_added',
  'hypothesis_updated',
  'question_added',
  'question_resolved',
  'question_deferred',
  // M6 — soft budget warning at budgets.global.softWarnAtRatio. The hard
  // kill at 100% still produces a NEEDS_INTERVENTION; the warning is a
  // forward-looking signal so operators can plan ahead.
  'budget_warning',
  // M7 — worktree subsystem (per docs/contracts/WORKTREE.md). Orchestrator-
  // owned events covering the per-run isolated worktree lifecycle. None of
  // these fire on BUILD-pass alone; cleanup is gated on VERIFY-pass (M8+).
  'worktree_created',
  'worktree_failed',
  'worktree_patch_applied',
  'worktree_patch_failed',
  'worktree_forensics_preserved',
  'worktree_destroyed',
  // M7 — BUILD phase (per docs/contracts/BUILD.md). build_failed is distinct
  // from worktree_patch_failed: the worktree event names the apply-side
  // failure; build_failed names the phase-level failure that produces
  // NEEDS_INTERVENTION (rule 11).
  'build_started',
  'build_patch_applied',
  'build_completed',
  'build_failed',
  // M9 substrate (per docs/contracts/REVIEW.md § "Cross-family enforcement"
  // + CODEX_RESPONSE_M9.md decision 5). Records the BUILD adapter's resolved
  // provider id + family + model durably so REVIEW's invocation-time check
  // can compare BUILD family to reviewer adapter family without re-deriving
  // either. Lighter than a BUILD_REPORT.md schema extension. Emitted
  // immediately after build_completed; durable across resume.
  'build_provider_recorded',
  // M8 — VERIFY phase (per docs/contracts/VERIFY.md). The four-event shape
  // is locked in VERIFY.md § "Event types emitted". Ordering against
  // worktree_destroyed is the orchestrator's responsibility (Codex M8
  // decision 8 modification: verify_restart_initiated only after
  // worktree_destroyed); the schema does not enforce ordering, only event
  // shape.
  'verify_started',
  'verify_completed',
  'verify_failed',
  'verify_restart_initiated',
  // M9 — REVIEW phase (per docs/contracts/REVIEW.md § "Event types
  // emitted"). The four-event shape covers the lifecycle from invocation
  // through one of two terminal events. `review_blocked` is NOT emitted
  // when REVIEW round N's follow-up BUILD attempt exhausts VERIFY's
  // 4-attempt cap (authority overlap rule, CODEX_RESPONSE_M9.md
  // decision 4): VERIFY-restart owns the intervention with "while
  // addressing REVIEW round N" context.
  'review_started',
  'review_round_completed',
  'review_resolved',
  'review_blocked',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const PHASE_OUTCOMES = ['passed', 'failed', 'paused'] as const
export type PhaseOutcome = (typeof PHASE_OUTCOMES)[number]

export const RUN_OUTCOMES = ['shipped', 'stopped', 'paused'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export interface AgentManifestEntry {
  readonly path: string
  readonly sha256: string
  readonly sizeBytes: number
}

export interface AgentManifest {
  readonly files: readonly AgentManifestEntry[]
}

// PhaseEvent is the STRICT write-side type. Code that constructs and appends
// events uses this discriminated union of every known event variant. The
// agent_invoked variant requires manifest + four metric fields per the M4
// contract pinned in docs/references/file-based-gates.md § 13.
export type PhaseEvent =
  | { readonly version: 1; readonly type: 'run_started'; readonly ts: string; readonly runId: string; readonly profile: Profile }
  | { readonly version: 1; readonly type: 'phase_entered'; readonly ts: string; readonly runId: string; readonly phase: Phase }
  | { readonly version: 1; readonly type: 'phase_exited'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly outcome: PhaseOutcome }
  | {
      readonly version: 1
      readonly type: 'agent_invoked'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly provider: string
      readonly manifest: AgentManifest
      readonly filesSent: number
      readonly bytesSent: number
      readonly tokensEstimate: number
      readonly fieldsRemovedByScope: number
    }
  | { readonly version: 1; readonly type: 'agent_completed'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly agent: string; readonly tokensUsed?: number }
  | { readonly version: 1; readonly type: 'gate_written'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly file: string }
  | { readonly version: 1; readonly type: 'gate_required'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly blockedOn: string }
  | { readonly version: 1; readonly type: 'intervention'; readonly ts: string; readonly runId: string; readonly code: string; readonly phase?: Phase }
  | { readonly version: 1; readonly type: 'run_ended'; readonly ts: string; readonly runId: string; readonly outcome: RunOutcome }
  | {
      readonly version: 1
      readonly type: 'ask_me_user_input'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly turn: number
      readonly input: string
    }
  | {
      readonly version: 1
      readonly type: 'ask_me_persona_reply'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly turn: number
      readonly agent: string
      readonly response: string
      readonly ready: boolean
    }
  | {
      readonly version: 1
      readonly type: 'repo_context_searched'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly tool: 'glob' | 'grep' | 'read' | 'symbol'
      readonly query: string
      readonly roots: readonly string[]
      readonly resultPaths: readonly string[]
      readonly selectedPaths: readonly string[]
      readonly resultBytes: number
      readonly resultTokensEstimate: number
    }
  | {
      readonly version: 1
      readonly type: 'science_emitted'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly hypothesesCount: number
      readonly openQuestionsCount: number
    }
  | {
      readonly version: 1
      readonly type: 'hypothesis_added'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly status: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly falsifier: string
    }
  | {
      readonly version: 1
      readonly type: 'hypothesis_updated'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly prevStatus: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly nextStatus: 'open' | 'confirmed' | 'rejected' | 'obsolete'
      readonly changedFields: readonly string[]
    }
  | {
      readonly version: 1
      readonly type: 'question_added'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly status: 'open' | 'resolved' | 'deferred'
      readonly importance: 'low' | 'medium' | 'high' | 'blocking'
      readonly dueBy: string | null
    }
  | {
      readonly version: 1
      readonly type: 'question_resolved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly resolvedAt: string
      readonly resolution: string
    }
  | {
      readonly version: 1
      readonly type: 'question_deferred'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly id: string
      readonly deferredAt: string
    }
  | {
      readonly version: 1
      readonly type: 'budget_warning'
      readonly ts: string
      readonly runId: string
      readonly metric:
        | 'maxTurns'
        | 'maxProviderCalls'
        | 'maxTokensEstimate'
        | 'maxWallTimeMinutes'
      readonly ratio: number
      readonly current: number
      readonly limit: number
    }
  // M7 worktree events (orchestrator-owned).
  | {
      readonly version: 1
      readonly type: 'worktree_created'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** 40-char lower-case hex sha of the base commit. */
      readonly baseCommitSha: string
      /** Absolute path to the worktree directory. */
      readonly worktreePath: string
      readonly dirtyTreePolicy: 'clean-base' | 'stash-and-pin'
    }
  | {
      readonly version: 1
      readonly type: 'worktree_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** Step in the four-step creation sequence (1=rev-parse, 2=worktree add,
       * 3=mkdir supporting dirs, 4=write base.txt+README). */
      readonly step: 1 | 2 | 3 | 4
      readonly code: string
      readonly reason: string
    }
  | {
      readonly version: 1
      readonly type: 'worktree_patch_applied'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /** 64-char lower-case hex sha of the patch file bytes. */
      readonly patchSha256: string
      /** Path relative to project root. */
      readonly patchPath: string
      readonly attempt: number
      readonly taskId: string
    }
  | {
      readonly version: 1
      readonly type: 'worktree_patch_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly code: string
      readonly attempt: number
      readonly taskId: string
      readonly reason: string
    }
  | {
      readonly version: 1
      readonly type: 'worktree_forensics_preserved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly attempt: number
      /** Absolute path to the forensics/<N>/ directory. */
      readonly forensicsPath: string
      /** Names of files written under forensicsPath. */
      readonly entries: readonly string[]
    }
  | {
      readonly version: 1
      readonly type: 'worktree_destroyed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      /**
       * The attempt this destruction belongs to. On a VERIFY-pass approve,
       * this is the just-passed attempt's number. On a VERIFY-fail
       * scheduling, this is the just-failed attempt's number. The field
       * lets the canonical-event-order validator scope worktree_destroyed
       * to a specific attempt without ambiguity in retry chains.
       */
      readonly attempt: number
      readonly worktreePath: string
    }
  // M7 BUILD phase events (per docs/contracts/BUILD.md).
  | {
      readonly version: 1
      readonly type: 'build_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly baseCommitSha: string
      readonly taskId: string
    }
  | {
      readonly version: 1
      readonly type: 'build_patch_applied'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly patchSha256: string
      readonly attempt: number
      readonly taskId: string
    }
  | {
      readonly version: 1
      readonly type: 'build_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly changedFileCount: number
      /** 64-char lower-case hex sha of the canonical BUILD_REPORT.md content. */
      readonly buildReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'build_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly code: string
      readonly reason: string
    }
  // M9 substrate: durable BUILD provider/family/model record. Emitted
  // immediately after build_completed. REVIEW's invocation-time check
  // (M9 commit 7) reads the latest build_provider_recorded for the
  // (runId, taskId) pair and compares its `family` to the reviewer
  // adapter's family. provider is the AgentProvider id from the BUILD
  // agent's frontmatter; family is the resolved ProviderFamily via
  // src/providers/families.ts familyOf(); model is the agent's optional
  // `model` field, omitted when the agent did not pin a model.
  | {
      readonly version: 1
      readonly type: 'build_provider_recorded'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly attempt: number
      readonly taskId: string
      readonly provider: string
      readonly family: string
      readonly model?: string
    }
  // M8 VERIFY phase events (per docs/contracts/VERIFY.md § "Event types
  // emitted"). All four bind to the BUILD attempt being verified via
  // taskId + attempt; verify_started additionally carries the BUILD ref
  // immutable-binding triple (baseCommitSha, patchSha256, buildReportSha256)
  // so the events.jsonl reader can reconstruct what was verified without
  // re-reading BUILD_REPORT.md.
  | {
      readonly version: 1
      readonly type: 'verify_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 40-char lower-case hex; copied from BUILD_REPORT.md Base.Base commit. */
      readonly baseCommitSha: string
      /** 64-char lower-case hex; copied from BUILD_REPORT.md Patch.Patch sha256. */
      readonly patchSha256: string
      /** 64-char lower-case hex of the canonical BUILD_REPORT.md content at VERIFY-read time. */
      readonly buildReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'verify_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 64-char lower-case hex of the canonical VERIFY.md content. */
      readonly verifyReportSha256: string
      /**
       * Verdict: pass requires Mutation.Status ∈ {pass, not-applicable}, so
       * the completed event constrains to those two values. A 'fail'
       * mutation status means VERIFY.md verdict was 'fail', emitting
       * verify_failed instead.
       */
      readonly mutationStatus: 'pass' | 'not-applicable'
    }
  | {
      readonly version: 1
      readonly type: 'verify_failed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      readonly verifyReportSha256: string
      /** Forwarded from the test runner's terminationReason field. */
      readonly terminationReason: 'exit' | 'timeout' | 'stdout-cap' | 'stderr-cap' | 'spawn-error'
      /** Process exit code, or null on spawn-error / never-exited. */
      readonly exitCode: number | null
      /** Persona-authored Failure summary line; ≤ 200 chars per VERIFY.md grammar. */
      readonly failureSummary: string
    }
  | {
      readonly version: 1
      readonly type: 'verify_restart_initiated'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly taskId: string
      /** The just-failed attempt number N (1..4). */
      readonly attempt: number
      /**
       * 'restart' for attempts 1-3 → next BUILD attempt scheduled at attempt+1.
       * 'intervention' for attempt 4 → cap reached, NEEDS_INTERVENTION.json written.
       */
      readonly nextAction: 'restart' | 'intervention'
      /** Present iff nextAction === 'restart'; equals attempt + 1. */
      readonly nextAttempt?: number
      /** Absolute path to the preserved forensics/<N>/ directory for the failed attempt. */
      readonly forensicsPath: string
    }
  // M9 REVIEW phase events. All four bind to the BUILD attempt that
  // produced the artifact under review via taskId + attempt; review_started
  // additionally records the cross-family pair (buildFamily, reviewerFamily)
  // so the events.jsonl reader can reconstruct the cross-family proof
  // without re-reading REVIEW.md.
  | {
      readonly version: 1
      readonly type: 'review_started'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** 40-char lower-case hex; copied from BUILD_REPORT.md Base.Base commit. */
      readonly baseCommitSha: string
      /** 64-char lower-case hex; copied from BUILD_REPORT.md Patch.Patch sha256. */
      readonly patchSha256: string
      /** 64-char lower-case hex of the canonical BUILD_REPORT.md content. */
      readonly buildReportSha256: string
      /** 64-char lower-case hex of the canonical VERIFY.md content (REVIEW
       *  reads VERIFY.md too — REVIEW.md § "Upstream refs" carries both). */
      readonly verifyReportSha256: string
      /** ProviderFamily of the BUILD agent that produced the artifact. */
      readonly buildFamily: string
      /** ProviderFamily of the reviewer agent (must differ from buildFamily). */
      readonly reviewerFamily: string
    }
  | {
      readonly version: 1
      readonly type: 'review_round_completed'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** Round number, 1..4 (CLAUDE.md non-negotiable rule 6). */
      readonly round: number
      /** Persona-authored score, 0..10 inclusive. */
      readonly score: number
      /** Orchestrator-computed verdict per the canonical verdict rule. */
      readonly verdict: 'ready' | 'needs-revision' | 'block'
      /** Count of findings raised in this round (non-negative). */
      readonly findingsRaised: number
      /** Count of findings resolved in this round (non-negative). May
       *  exceed findingsRaised when prior-round findings are resolved. */
      readonly findingsResolved: number
      /** 64-char lower-case hex of the canonical REVIEW.md content
       *  written for this round. M9 commit 13 fs#1: kickoff Decision 10
       *  says a round is complete only when canonical REVIEW.md AND
       *  the round-completed event agree. The sha lets resume probes
       *  verify that agreement instead of trusting event presence
       *  alone. */
      readonly reviewReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'review_resolved'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /** The round that exited with score≥6 + verdict=ready (1..4). */
      readonly finalRound: number
      /** Final score; must be >= 6 for review_resolved. */
      readonly finalScore: number
      /** 64-char lower-case hex of the canonical REVIEW.md content. */
      readonly reviewReportSha256: string
    }
  | {
      readonly version: 1
      readonly type: 'review_blocked'
      readonly ts: string
      readonly runId: string
      readonly phase: Phase
      readonly agent: string
      readonly attempt: number
      readonly taskId: string
      /**
       * Why the loop blocked:
       *   - 'block': any round emitted verdict=block.
       *   - 'cap_exhausted': 4-round cap reached without ready exit.
       * NOT emitted when VERIFY's 4-attempt cap exhausts during a
       * REVIEW round (authority overlap rule, decision 4): that path
       * is VERIFY-owned with context "while addressing REVIEW round N".
       */
      readonly reason: 'block' | 'cap_exhausted'
      /** Round at which the loop blocked (1..4). */
      readonly finalRound: number
      /** 64-char lower-case hex of the canonical REVIEW.md content
       *  (REVIEW.md is written even on block / cap-exhausted exits). */
      readonly reviewReportSha256: string
    }

// UnknownPhaseEvent is the lenient read-side fallback. The validator (rule 12)
// accepts events whose `type` is a non-empty string it doesn't recognize, so
// long as version + ts + runId are valid. Future milestones (e.g., M7's
// failure_recorded) extend the known set without bumping `version: 1`.
export interface UnknownPhaseEvent {
  readonly version: 1
  readonly type: string
  readonly ts: string
  readonly runId: string
}

// LoggedEvent is the READ-side type. readEvents() returns these; reducers and
// recovery code switch on `type` and ignore unknown variants via default:
// no-op.
export type LoggedEvent = PhaseEvent | UnknownPhaseEvent

/**
 * Narrows a LoggedEvent to a known PhaseEvent by checking against EVENT_TYPES.
 * Required for TypeScript discriminant narrowing — UnknownPhaseEvent's
 * `type: string` would otherwise subsume literal types in the PhaseEvent
 * variants, defeating switch-case narrowing on `e.type`.
 */
export function isKnownPhaseEvent(e: LoggedEvent): e is PhaseEvent {
  return (EVENT_TYPES as readonly string[]).includes(e.type)
}

// Success gate: GATE_<PHASE>_PASSED.json
export interface GateFile {
  readonly version: 1
  readonly runId: string
  readonly phase: Phase
  readonly artifact: string
  readonly artifactSha256?: string
  readonly agent: string
  readonly agentProvider?: string
  readonly approvedBy: string
  readonly approvedAt: string
  readonly notes?: string
}

// Intervention/control gates.
export interface NeedsInterventionGate {
  readonly version: 1
  readonly runId: string
  readonly phase: Phase
  readonly agent: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly actionableSuggestions: readonly string[]
  readonly createdAt: string
}

export interface PauseGate {
  readonly version: 1
  readonly runId: string
  readonly reason: string
  readonly createdAt: string
}

export interface StopGate {
  readonly version: 1
  readonly runId: string
  readonly reason: string
  readonly createdAt: string
}

// Active-run pointer at .code-oz/state/active.json
export interface ActiveRunPointer {
  readonly version: 1
  readonly runId: string
}

// Derived state at .code-oz/state/runs/<runId>/current.json
export interface RunState {
  readonly version: 1
  readonly runId: string
  readonly profile: Profile
  readonly currentPhase: Phase
  readonly phasesCompleted: readonly Phase[]
  readonly lastEventAt: string
}

// Helpers shared by validators in events.ts and gates.ts.

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO8601_REGEX.test(value)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

export function isProfile(value: unknown): value is Profile {
  return typeof value === 'string' && (PROFILES as readonly string[]).includes(value)
}

export function sequenceFor(profile: Profile): readonly Phase[] {
  return profile === 'greenfield' ? GREENFIELD_SEQUENCE : BROWNFIELD_SEQUENCE
}
