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
// "Canonical phase -> artifact map". Paths are relative to the run's artifact root.
export const CANONICAL_ARTIFACTS: Readonly<Record<Phase, string>> = Object.freeze({
  define: 'artifacts/SPEC.md',
  audit: 'artifacts/AUDIT.md',
  plan: 'artifacts/PLAN.md',
  build: 'artifacts/BUILD_REPORT.md',
  verify: 'artifacts/VERIFY.md',
  review: 'artifacts/REVIEW.md',
  ship: 'artifacts/SHIP.md',
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

export type PhaseEvent =
  | { readonly version: 1; readonly type: 'run_started'; readonly ts: string; readonly runId: string; readonly profile: Profile }
  | { readonly version: 1; readonly type: 'phase_entered'; readonly ts: string; readonly runId: string; readonly phase: Phase }
  | { readonly version: 1; readonly type: 'phase_exited'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly outcome: PhaseOutcome }
  | { readonly version: 1; readonly type: 'agent_invoked'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly agent: string; readonly provider: string; readonly manifest?: AgentManifest }
  | { readonly version: 1; readonly type: 'agent_completed'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly agent: string; readonly tokensUsed?: number }
  | { readonly version: 1; readonly type: 'gate_written'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly file: string }
  | { readonly version: 1; readonly type: 'gate_required'; readonly ts: string; readonly runId: string; readonly phase: Phase; readonly blockedOn: string }
  | { readonly version: 1; readonly type: 'intervention'; readonly ts: string; readonly runId: string; readonly code: string; readonly phase?: Phase }
  | { readonly version: 1; readonly type: 'run_ended'; readonly ts: string; readonly runId: string; readonly outcome: RunOutcome }

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
