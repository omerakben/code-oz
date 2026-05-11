import { basename } from 'node:path'
import { AgentLoadError, type AgentLoadIssue } from './errors.ts'
import type { ParsedFrontmatter } from './frontmatter.ts'
import { PROVIDER_FAMILIES, type ProviderFamily } from '../providers/types.ts'

export const AGENT_TYPES = ['agent', 'skill', 'phase', 'gate', 'hook'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export const AGENT_PHASES = [
  'define',
  'plan',
  'build',
  'verify',
  'review',
  'ship',
  'audit',
] as const
export type AgentPhase = (typeof AGENT_PHASES)[number]

export const AGENT_PROVIDERS = ['claude', 'codex', 'gemini', 'fake', 'xai'] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

export const AGENT_MODEL_POLICIES = ['opus-default', 'strict-opus', 'any'] as const
export type AgentModelPolicy = (typeof AGENT_MODEL_POLICIES)[number]

export const REQUIRED_FRONTMATTER_FIELDS = [
  'name',
  'type',
  'phase',
  'provider',
  'modelPolicy',
  'permissions',
  'description',
] as const

export const MAX_DESCRIPTION_LENGTH = 1024

const NAME_REGEX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

// Permissions are upper bounds, not glob expansions. read/write declare what
// the runtime is allowed to send/accept on this agent's behalf — never a
// signal to recursively scan the repo. See docs/references/agent-skill-format.md
// "Permissions semantics" for the full contract that M3+ must honor.
//
// `tool_use.repo_context` is the M6 sub-scope for agentic codebase search.
// Contract pinned in docs/contracts/REPO_CONTEXT.md. The schema is locked per
// docs/research/CODEX_RESPONSE_SYNTHESIS.md "Where I disagree" 3.

export const REPO_CONTEXT_TOOL_NAMES = ['glob', 'grep', 'read', 'symbol'] as const
export type RepoContextToolName = (typeof REPO_CONTEXT_TOOL_NAMES)[number]

// Subset of REPO_CONTEXT_TOOL_NAMES that is RESERVED — the type-union member
// is preserved so the schema slot is callable for backward-compat when the
// telemetry signal in docs/contracts/REPO_CONTEXT.md § "Reservation and
// reopen-the-slot signal" fires (4-condition AND on three runs across two
// repos), but the config-load and runtime paths reject any agent that
// declares a reserved tool. Closes the contract-debt catch from Codex
// review thread 019e12ed (`docs/comparison/06-codegraph/CODEX_RESPONSE.md`
// Q8). Until the reopen condition fires this list is the explicit
// no-go list; touching it requires a synthesis update to the contract.
export const RESERVED_REPO_CONTEXT_TOOLS: readonly RepoContextToolName[] = Object.freeze([
  'symbol',
])

// Hard caps from CODEX_RESPONSE_M6.md decision 1. Agents may declare lower
// values; declaring higher than these is rejected at schema-validation time.
export const REPO_CONTEXT_HARD_CAPS = Object.freeze({
  maxResults: 50,
  maxBytesPerResult: 16_384,        // 16 KB
  maxFilesForNextManifest: 20,
  timeoutMs: 5_000,
} as const)

export interface RepoContextPermissions {
  readonly tools: readonly RepoContextToolName[]
  readonly roots: readonly string[]
  readonly maxResults: number
  readonly maxBytesPerResult: number
  readonly maxFilesForNextManifest: number
  readonly timeoutMs: number
  readonly network: 'none'
}

// `tool_use.write` is the M7 sub-scope for orchestrator-applied patches
// (per docs/contracts/BUILD.md § "Permissions required" + Codex M7
// implementation review accept-with-modifications on decision 12, thread
// 019ddeea). v0.1 ships only the `apply-patch` tool; the runtime is
// orchestrator-side (extracted from persona response, applied by the
// orchestrator), so the schema is forward-looking. Load-time validation
// pins the templated declaration; runtime resolves <runId> to a concrete
// absolute root and re-checks size + path-safety per call.
export const WRITE_TOOL_NAMES = ['apply-patch'] as const
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

export const WRITE_TOOL_HARD_CAPS = Object.freeze({
  /** Hard cap on patch byte count per BUILD.md. */
  maxBytesPerPatch: 65_536,
  /** Hard cap on per-tool wall-time. */
  timeoutMs: 5_000,
} as const)

export interface WriteToolPermissions {
  readonly tools: readonly WriteToolName[]
  /** Roots in templated form (`<runId>` placeholder allowed); runtime resolves. */
  readonly roots: readonly string[]
  readonly maxBytesPerPatch: number
  readonly timeoutMs: number
}

// `tool_use.execute` is the M8 sub-scope for VERIFY's validation-command
// execution (per docs/contracts/VERIFY.md § "Permissions required" + Codex
// M8 response decision 1, accept-with-modifications, thread 019ddf5f).
// v0.1 ships only the `test-runner` tool; the runtime spawns the bound
// validation command via Bun.spawn in argv form (no shell). Load-time
// validation mirrors M7's `tool_use.write` shape: single templated root
// (`<runId>` placeholder), bounded numeric caps, network: 'none'. The
// argv-only command grammar (src/tools/command-grammar.ts) is what makes
// `bash: deny` meaningful here — the persona cannot smuggle shell
// substitution through the Validation command bullet.
export const EXECUTE_TOOL_NAMES = ['test-runner'] as const
export type ExecuteToolName = (typeof EXECUTE_TOOL_NAMES)[number]

export const EXECUTE_TOOL_HARD_CAPS = Object.freeze({
  /** Hard cap on per-call wall-time (matches VERIFY.md example). */
  timeoutMs: 60_000,
  /** Hard cap on stdout bytes captured per call (1 MiB). */
  maxStdoutBytes: 1_048_576,
  /** Hard cap on stderr bytes captured per call (1 MiB). */
  maxStderrBytes: 1_048_576,
} as const)

export interface ExecuteToolPermissions {
  readonly tools: readonly ExecuteToolName[]
  /** Roots in templated form (`<runId>` placeholder allowed); runtime resolves. */
  readonly roots: readonly string[]
  readonly timeoutMs: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
  readonly network: 'none'
}

// `tool_use.review_request` is the REVIEW persona's reviewer-side
// declaration of the `requestReview` primitive (per
// docs/contracts/REVIEW.md § "Permissions required" + CLAUDE.md
// non-negotiable rule 6 — max 4 rounds, exit on score≥6 + verdict=ready).
// v0.1 ships only the `request-review` tool; the runtime is the wrapper
// in src/tools/review-request.ts which enforces cross-family at
// invocation time.
//
// Load-time validation pins the families list to PROVIDER_FAMILIES (so
// typos like `providers: ['claud']` fail the run before BUILD), and caps
// maxRounds at the CLAUDE.md rule-6 ceiling. timeoutMsPerRound has a
// 10-minute hard cap; REVIEW.md's contract example uses 2 minutes.
export const REVIEW_REQUEST_TOOL_NAMES = ['request-review'] as const
export type ReviewRequestToolName = (typeof REVIEW_REQUEST_TOOL_NAMES)[number]

export const REVIEW_REQUEST_HARD_CAPS = Object.freeze({
  /** CLAUDE.md non-negotiable rule 6: max 4 REVIEW rounds. */
  maxRounds: 4,
  /** Hard cap on per-round wall-time (10 minutes). */
  timeoutMsPerRound: 600_000,
} as const)

export interface ReviewRequestPermissions {
  readonly tools: readonly ReviewRequestToolName[]
  /** Provider families that may request review from this agent. Must be a
   *  non-empty subset of PROVIDER_FAMILIES. The cross-family check at
   *  invocation time (src/tools/review-request.ts) consumes the runtime
   *  ProviderRegistry, not this list — this list is the load-time
   *  declaration of which families the reviewer is willing to serve. */
  readonly providers: readonly ProviderFamily[]
  readonly maxRounds: number
  readonly timeoutMsPerRound: number
  /** v0.1 only allows `provider-only` (provider auth via ambient
   *  credentials; no other network access). W4 containerization will
   *  tighten further. */
  readonly network: 'provider-only'
}

// `tool_use.debate` is the M10 sub-scope for any phase persona that may
// invoke the M10 requestDebate primitive (per docs/contracts/DEBATE.md
// § "Permission sub-scope" — pinned in M7 commit 2 process contract,
// implemented in M10 runtime). Cross-family debate is the rule-2 + rule-7
// generalization to any phase: a phase persona declares which opposing
// provider families it may debate against, and the runtime enforces
// load-time + invocation-time cross-family invariants exactly like
// review_request. M10 default for src/agents/defaults/lead.md is
// opposingProviders=['codex'], maxConcurrent=1.
//
// Load-time validation:
// - opposingProviders is a non-empty subset of PROVIDER_FAMILIES; cannot
//   include the persona's own family (load-time cross-family — fails the
//   run before any debate is invoked).
// - maxConcurrent in [1, 4] inclusive (DEBATE.md DEBATE_HARD_CAPS).
// - maxFiles in [0, 50] inclusive (mirrors REPO_CONTEXT_HARD_CAPS.maxResults).
// - timeoutMs in [1, 600_000] (10-minute ceiling, mirrors review_request).
// - previewBeforeSend MUST be literally `true` — no other value accepted
//   (DEBATE.md pins it as a fixed invariant per CLAUDE.md rule 13).
//
// Network is implicit (debate is a provider call). M10's runtime additions
// (manifest preview, ignore-policy, terminal-directive extraction) live in
// src/tools/debate-{request,permissions}.ts and src/tools/ignore-policy.ts.
export const DEBATE_HARD_CAPS = Object.freeze({
  /** Strict per-phase-invocation cap on open debates. M10 default is 1. */
  maxConcurrent: 4,
  /** Mirrors REPO_CONTEXT_HARD_CAPS.maxResults. */
  maxFiles: 50,
  /** Hard cap on per-debate-turn wall-time (10 minutes; mirrors review_request). */
  timeoutMs: 600_000,
} as const)

export interface DebatePermissions {
  /** Provider families this persona may debate against. Must be a non-empty
   *  subset of PROVIDER_FAMILIES that does NOT include the persona's own
   *  family. Cross-family invariant enforced at load time. The runtime
   *  cross-family invocation-time check in src/tools/debate-request.ts
   *  re-validates against the live ProviderRegistry. */
  readonly opposingProviders: readonly ProviderFamily[]
  /** Max concurrent open debates per phase invocation. M10 defaults to 1
   *  for bundled personas; runtime per-phase event-log scan enforces. */
  readonly maxConcurrent: number
  /** Manifest preview gate: paths matching .code-ozignore are blocked.
   *  Fixed at true per DEBATE.md invariant (cannot be configured false). */
  readonly previewBeforeSend: true
  /** Max files surfaced into BRIEFING.md. */
  readonly maxFiles: number
  /** Per-debate-turn wall-time cap (one round-trip). */
  readonly timeoutMs: number
}

export interface ToolUsePermissions {
  readonly repo_context?: RepoContextPermissions
  readonly write?: WriteToolPermissions
  readonly execute?: ExecuteToolPermissions
  readonly review_request?: ReviewRequestPermissions
  readonly debate?: DebatePermissions
}

export interface AgentPermissions {
  readonly read: '*' | readonly string[]
  readonly write: '*' | readonly string[]
  readonly bash: 'deny' | readonly string[]
  readonly tool_use?: ToolUsePermissions
}

export interface AgentDefinition {
  readonly file: string
  readonly name: string
  readonly type: AgentType
  readonly phase: AgentPhase
  readonly provider: AgentProvider
  readonly model?: string
  readonly modelPolicy: AgentModelPolicy
  readonly permissions: AgentPermissions
  readonly description: string
  readonly body: string
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function validateEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  file: string,
): AgentLoadIssue | null {
  if (typeof value !== 'string') {
    return {
      file,
      code: 'schema_invalid_value',
      rule: `'${field}' must be a string`,
      detail: `got ${typeof value}`,
    }
  }
  if (!(allowed as readonly string[]).includes(value)) {
    return {
      file,
      code: 'schema_invalid_value',
      rule: `'${field}' must be one of: ${allowed.join(' | ')}`,
      detail: `got ${JSON.stringify(value)}`,
    }
  }
  return null
}

function validatePermissions(
  perms: unknown,
  file: string,
  ownProvider: unknown,
): AgentLoadIssue | null {
  if (perms === null || typeof perms !== 'object' || Array.isArray(perms)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions' must be an object with 'read', 'write', and 'bash' fields",
    }
  }
  const p = perms as Record<string, unknown>
  for (const key of ['read', 'write'] as const) {
    const v = p[key]
    if (v === undefined) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.${key}' is required`,
      }
    }
    if (v !== '*' && !isStringArray(v)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.${key}' must be '*' or an array of glob strings`,
      }
    }
  }
  const b = p.bash
  if (b === undefined) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.bash' is required",
    }
  }
  if (b !== 'deny' && !isStringArray(b)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.bash' must be 'deny' or an array of allowed commands",
    }
  }
  if ('tool_use' in p && p.tool_use !== undefined) {
    // The persona's own provider id is needed for the load-time cross-family
    // check in tool_use.debate (CLAUDE.md rule 2 + DEBATE.md § Permission
    // sub-scope: opposingProviders cannot include the persona's own family).
    // validateAgent's validateEnum pass on `provider` runs before this and
    // surfaces a separate error if the value isn't in AGENT_PROVIDERS, so
    // we defend with a null-guard in validateDebate rather than re-checking.
    const issue = validateToolUse(p.tool_use, file, ownProvider)
    if (issue !== null) return issue
  }
  return null
}

function validateToolUse(
  value: unknown,
  file: string,
  ownProvider: unknown,
): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use' must be an object",
    }
  }
  const tu = value as Record<string, unknown>
  const KNOWN_SUB_SCOPES = [
    'repo_context',
    'write',
    'execute',
    'review_request',
    'debate',
  ] as const
  for (const k of Object.keys(tu)) {
    if (!(KNOWN_SUB_SCOPES as readonly string[]).includes(k)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use' may contain only ${KNOWN_SUB_SCOPES.join(' / ')} sub-scopes in v0.1`,
        detail: `unknown sub-scope: ${k}`,
      }
    }
  }
  if ('repo_context' in tu && tu.repo_context !== undefined) {
    const issue = validateRepoContext(tu.repo_context, file)
    if (issue) return issue
  }
  if ('write' in tu && tu.write !== undefined) {
    const issue = validateWriteToolUse(tu.write, file)
    if (issue) return issue
  }
  if ('execute' in tu && tu.execute !== undefined) {
    const issue = validateExecuteToolUse(tu.execute, file)
    if (issue) return issue
  }
  if ('review_request' in tu && tu.review_request !== undefined) {
    const issue = validateReviewRequest(tu.review_request, file)
    if (issue) return issue
  }
  if ('debate' in tu && tu.debate !== undefined) {
    const issue = validateDebate(tu.debate, file, ownProvider)
    if (issue) return issue
  }
  return null
}

function validateDebate(
  value: unknown,
  file: string,
  ownProvider: unknown,
): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.debate' must be an object",
    }
  }
  const d = value as Record<string, unknown>
  // opposingProviders — non-empty subset of PROVIDER_FAMILIES that does
  // NOT include the persona's own family (load-time cross-family invariant
  // per CLAUDE.md rule 2 + DEBATE.md § Permission sub-scope).
  if (!isStringArray(d.opposingProviders)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.debate.opposingProviders' must be an array of strings",
    }
  }
  if (d.opposingProviders.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.debate.opposingProviders' must list at least one provider family",
    }
  }
  for (const p of d.opposingProviders) {
    if (!(PROVIDER_FAMILIES as readonly string[]).includes(p)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.debate.opposingProviders' entries must be one of: ${PROVIDER_FAMILIES.join(', ')}`,
        detail: JSON.stringify(p),
      }
    }
  }
  // Load-time cross-family invariant: opposingProviders cannot include the
  // persona's own family. validateEnum on `provider` runs before this in
  // validateAgent's issue collection, so by the time we get here the
  // provider value should be valid; we still defend with a null-guard so
  // bad provider values surface their own error rather than masking as a
  // confusing cross-family violation.
  if (typeof ownProvider === 'string') {
    const ownFamilyId = (PROVIDER_FAMILIES as readonly string[]).includes(ownProvider)
      ? (ownProvider as ProviderFamily)
      : null
    if (ownFamilyId !== null && d.opposingProviders.includes(ownFamilyId)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule:
          "'permissions.tool_use.debate.opposingProviders' must not include the persona's own family " +
          '(cross-family invariant — CLAUDE.md rule 2 + DEBATE.md § Permission sub-scope)',
        detail: `persona provider=${ownProvider}, opposingProviders=${JSON.stringify(d.opposingProviders)}`,
      }
    }
  }
  // numeric caps
  const numericFields = [
    ['maxConcurrent', DEBATE_HARD_CAPS.maxConcurrent],
    ['timeoutMs', DEBATE_HARD_CAPS.timeoutMs],
  ] as const
  for (const [field, cap] of numericFields) {
    const v = d[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.debate.${field}' must be a positive integer`,
      }
    }
    if (v > cap) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.debate.${field}' must be ≤ ${cap} (M10 hard cap)`,
        detail: `got ${v}`,
      }
    }
  }
  // maxFiles may be 0 (purely-design debates with no codebase context).
  const maxFiles = d.maxFiles
  if (typeof maxFiles !== 'number' || !Number.isInteger(maxFiles) || maxFiles < 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.debate.maxFiles' must be a non-negative integer",
    }
  }
  if (maxFiles > DEBATE_HARD_CAPS.maxFiles) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: `'permissions.tool_use.debate.maxFiles' must be ≤ ${DEBATE_HARD_CAPS.maxFiles} (M10 hard cap)`,
      detail: `got ${maxFiles}`,
    }
  }
  // previewBeforeSend MUST be literally `true` — DEBATE.md pins it as a
  // fixed invariant. Any other value (false, undefined, "true", 1) fails.
  if (d.previewBeforeSend !== true) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.debate.previewBeforeSend' must be the literal `true` (CLAUDE.md rule 13 invariant)",
      detail: JSON.stringify(d.previewBeforeSend),
    }
  }
  return null
}

function validateReviewRequest(value: unknown, file: string): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request' must be an object",
    }
  }
  const r = value as Record<string, unknown>
  // tools — only `request-review` in v0.1
  if (!Array.isArray(r.tools)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request.tools' must be an array",
    }
  }
  if (r.tools.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request.tools' must list at least one tool",
    }
  }
  for (const t of r.tools as unknown[]) {
    if (typeof t !== 'string' || !(REVIEW_REQUEST_TOOL_NAMES as readonly string[]).includes(t)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.review_request.tools' entries must be one of: ${REVIEW_REQUEST_TOOL_NAMES.join(', ')}`,
        detail: JSON.stringify(t),
      }
    }
  }
  // providers — non-empty subset of PROVIDER_FAMILIES. Catches typos like
  // `providers: ['claud']` at load time before the run starts.
  if (!isStringArray(r.providers)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request.providers' must be an array of strings",
    }
  }
  if (r.providers.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request.providers' must list at least one provider family",
    }
  }
  for (const p of r.providers) {
    if (!(PROVIDER_FAMILIES as readonly string[]).includes(p)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.review_request.providers' entries must be one of: ${PROVIDER_FAMILIES.join(', ')}`,
        detail: JSON.stringify(p),
      }
    }
  }
  // numeric caps — maxRounds is the CLAUDE.md rule-6 ceiling, timeoutMsPerRound
  // bounded so a misconfigured persona cannot park the run forever.
  const numericFields = [
    ['maxRounds', REVIEW_REQUEST_HARD_CAPS.maxRounds],
    ['timeoutMsPerRound', REVIEW_REQUEST_HARD_CAPS.timeoutMsPerRound],
  ] as const
  for (const [field, cap] of numericFields) {
    const v = r[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.review_request.${field}' must be a positive integer`,
      }
    }
    if (v > cap) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.review_request.${field}' must be ≤ ${cap} (M9 hard cap)`,
        detail: `got ${v}`,
      }
    }
  }
  // network — must be 'provider-only' in v0.1.
  if (r.network !== 'provider-only') {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.review_request.network' must be 'provider-only' in v0.1",
      detail: JSON.stringify(r.network),
    }
  }
  return null
}

function validateExecuteToolUse(value: unknown, file: string): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute' must be an object",
    }
  }
  const e = value as Record<string, unknown>
  // tools
  if (!Array.isArray(e.tools)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute.tools' must be an array",
    }
  }
  if (e.tools.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute.tools' must list at least one tool",
    }
  }
  for (const t of e.tools as unknown[]) {
    if (typeof t !== 'string' || !(EXECUTE_TOOL_NAMES as readonly string[]).includes(t)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.execute.tools' entries must be one of: ${EXECUTE_TOOL_NAMES.join(', ')}`,
        detail: JSON.stringify(t),
      }
    }
  }
  // roots — same lock as tool_use.write per Codex M7 Decision 12 lean
  // applied to M8 (CODEX_RESPONSE_M8.md decision 1 modification): single
  // templated worktree root; host roots, sibling-under-runs roots, and
  // wildcards are rejected at load time.
  if (!isStringArray(e.roots)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute.roots' must be an array of strings",
    }
  }
  if (e.roots.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute.roots' must list at least one root",
    }
  }
  for (const r of e.roots as string[]) {
    if (r.length === 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: "'permissions.tool_use.execute.roots' entries must be non-empty strings",
      }
    }
    if (!/^\.code-oz\/runs\/<runId>\/worktree\/?$/.test(r)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule:
          "'permissions.tool_use.execute.roots' entries must be the templated worktree root " +
          '`.code-oz/runs/<runId>/worktree/` (M8 mirrors M7 decision 12 lock)',
        detail: r,
      }
    }
  }
  // numeric caps
  const numericFields = [
    ['timeoutMs', EXECUTE_TOOL_HARD_CAPS.timeoutMs],
    ['maxStdoutBytes', EXECUTE_TOOL_HARD_CAPS.maxStdoutBytes],
    ['maxStderrBytes', EXECUTE_TOOL_HARD_CAPS.maxStderrBytes],
  ] as const
  for (const [field, cap] of numericFields) {
    const v = e[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.execute.${field}' must be a positive integer`,
      }
    }
    if (v > cap) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.execute.${field}' must be ≤ ${cap} (M8 hard cap)`,
        detail: `got ${v}`,
      }
    }
  }
  // network — must be 'none' in v0.1 (containerization is W4 scope)
  if (e.network !== 'none') {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.execute.network' must be 'none' in v0.1",
      detail: JSON.stringify(e.network),
    }
  }
  return null
}

function validateWriteToolUse(value: unknown, file: string): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.write' must be an object",
    }
  }
  const w = value as Record<string, unknown>
  // tools
  if (!Array.isArray(w.tools)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.write.tools' must be an array",
    }
  }
  if (w.tools.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.write.tools' must list at least one tool",
    }
  }
  for (const t of w.tools as unknown[]) {
    if (typeof t !== 'string' || !(WRITE_TOOL_NAMES as readonly string[]).includes(t)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.write.tools' entries must be one of: ${WRITE_TOOL_NAMES.join(', ')}`,
        detail: JSON.stringify(t),
      }
    }
  }
  // roots — templated form is allowed in v0.1 (runtime resolves <runId>).
  // We require at least one root and reject empty strings.
  if (!isStringArray(w.roots)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.write.roots' must be an array of strings",
    }
  }
  if (w.roots.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.write.roots' must list at least one root",
    }
  }
  // Per Codex M7 review fix-soon #6 + decision 12: the templated root must
  // be exactly the run worktree (`.code-oz/runs/<runId>/worktree/` with the
  // `<runId>` placeholder). Wider roots (host, project root, '*') are
  // rejected at load time. Runtime resolves <runId> to a concrete absolute
  // path and re-checks per call.
  for (const r of w.roots as string[]) {
    if (r.length === 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: "'permissions.tool_use.write.roots' entries must be non-empty strings",
      }
    }
    if (!/^\.code-oz\/runs\/<runId>\/worktree\/?$/.test(r)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule:
          "'permissions.tool_use.write.roots' entries must be the templated worktree root " +
          '`.code-oz/runs/<runId>/worktree/` (decision 12: load-time validates the templated declaration)',
        detail: r,
      }
    }
  }
  // numeric caps
  const numericFields = [
    ['maxBytesPerPatch', WRITE_TOOL_HARD_CAPS.maxBytesPerPatch],
    ['timeoutMs', WRITE_TOOL_HARD_CAPS.timeoutMs],
  ] as const
  for (const [field, cap] of numericFields) {
    const v = w[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.write.${field}' must be a positive integer`,
      }
    }
    if (v > cap) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.write.${field}' must be ≤ ${cap} (M7 hard cap)`,
        detail: `got ${v}`,
      }
    }
  }
  return null
}

function validateRepoContext(value: unknown, file: string): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context' must be an object",
    }
  }
  const rc = value as Record<string, unknown>
  // tools
  if (!Array.isArray(rc.tools)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.tools' must be an array",
    }
  }
  if (rc.tools.length === 0) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.tools' must list at least one tool",
    }
  }
  for (const t of rc.tools as unknown[]) {
    if (typeof t !== 'string' || !(REPO_CONTEXT_TOOL_NAMES as readonly string[]).includes(t)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.repo_context.tools' entries must be one of: ${REPO_CONTEXT_TOOL_NAMES.join(', ')}`,
        detail: JSON.stringify(t),
      }
    }
    if ((RESERVED_REPO_CONTEXT_TOOLS as readonly string[]).includes(t)) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule:
          `'permissions.tool_use.repo_context.tools' entry '${t}' is RESERVED ` +
          `and not permissionable in v0.x. ` +
          `See docs/contracts/REPO_CONTEXT.md § "Reservation and reopen-the-slot signal".`,
        detail: JSON.stringify(t),
      }
    }
  }
  // roots
  if (!isStringArray(rc.roots)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.roots' must be an array of strings",
    }
  }
  // numeric caps. maxFilesForNextManifest may be 0 (a persona that does
  // not promote paths into the next manifest, e.g., VERIFY per
  // VERIFY.md § Permissions example). Other caps must be positive.
  const positiveFields = [
    ['maxResults', REPO_CONTEXT_HARD_CAPS.maxResults],
    ['maxBytesPerResult', REPO_CONTEXT_HARD_CAPS.maxBytesPerResult],
    ['timeoutMs', REPO_CONTEXT_HARD_CAPS.timeoutMs],
  ] as const
  for (const [field, cap] of positiveFields) {
    const v = rc[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.repo_context.${field}' must be a positive integer`,
      }
    }
    if (v > cap) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: `'permissions.tool_use.repo_context.${field}' must be ≤ ${cap} (M6 hard cap)`,
        detail: `got ${v}`,
      }
    }
  }
  const maxFilesForNextManifest = rc.maxFilesForNextManifest
  if (
    typeof maxFilesForNextManifest !== 'number' ||
    !Number.isInteger(maxFilesForNextManifest) ||
    maxFilesForNextManifest < 0
  ) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.maxFilesForNextManifest' must be a non-negative integer",
    }
  }
  if (maxFilesForNextManifest > REPO_CONTEXT_HARD_CAPS.maxFilesForNextManifest) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: `'permissions.tool_use.repo_context.maxFilesForNextManifest' must be ≤ ${REPO_CONTEXT_HARD_CAPS.maxFilesForNextManifest} (M6 hard cap)`,
      detail: `got ${maxFilesForNextManifest}`,
    }
  }
  // network
  if (rc.network !== 'none') {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.network' must be 'none' in v0.1",
      detail: JSON.stringify(rc.network),
    }
  }
  return null
}

function freezePermissions(perms: Record<string, unknown>): AgentPermissions {
  const freezeField = (v: unknown): '*' | 'deny' | readonly string[] => {
    if (v === '*' || v === 'deny') return v
    return Object.freeze([...(v as string[])])
  }
  const base = {
    read: freezeField(perms.read) as '*' | readonly string[],
    write: freezeField(perms.write) as '*' | readonly string[],
    bash: freezeField(perms.bash) as 'deny' | readonly string[],
  }
  if (perms.tool_use !== undefined) {
    return Object.freeze({
      ...base,
      tool_use: freezeToolUse(perms.tool_use as Record<string, unknown>),
    })
  }
  return Object.freeze(base)
}

function freezeToolUse(tu: Record<string, unknown>): ToolUsePermissions {
  const out: {
    repo_context?: RepoContextPermissions
    write?: WriteToolPermissions
    execute?: ExecuteToolPermissions
    review_request?: ReviewRequestPermissions
    debate?: DebatePermissions
  } = {}
  if (tu.repo_context !== undefined) {
    const rc = tu.repo_context as Record<string, unknown>
    out.repo_context = Object.freeze({
      tools: Object.freeze([...(rc.tools as RepoContextToolName[])]),
      roots: Object.freeze([...(rc.roots as string[])]),
      maxResults: rc.maxResults as number,
      maxBytesPerResult: rc.maxBytesPerResult as number,
      maxFilesForNextManifest: rc.maxFilesForNextManifest as number,
      timeoutMs: rc.timeoutMs as number,
      network: 'none' as const,
    })
  }
  if (tu.write !== undefined) {
    const w = tu.write as Record<string, unknown>
    out.write = Object.freeze({
      tools: Object.freeze([...(w.tools as WriteToolName[])]),
      roots: Object.freeze([...(w.roots as string[])]),
      maxBytesPerPatch: w.maxBytesPerPatch as number,
      timeoutMs: w.timeoutMs as number,
    })
  }
  if (tu.execute !== undefined) {
    const e = tu.execute as Record<string, unknown>
    out.execute = Object.freeze({
      tools: Object.freeze([...(e.tools as ExecuteToolName[])]),
      roots: Object.freeze([...(e.roots as string[])]),
      timeoutMs: e.timeoutMs as number,
      maxStdoutBytes: e.maxStdoutBytes as number,
      maxStderrBytes: e.maxStderrBytes as number,
      network: 'none' as const,
    })
  }
  if (tu.review_request !== undefined) {
    const r = tu.review_request as Record<string, unknown>
    out.review_request = Object.freeze({
      tools: Object.freeze([...(r.tools as ReviewRequestToolName[])]),
      providers: Object.freeze([...(r.providers as ProviderFamily[])]),
      maxRounds: r.maxRounds as number,
      timeoutMsPerRound: r.timeoutMsPerRound as number,
      network: 'provider-only' as const,
    })
  }
  if (tu.debate !== undefined) {
    const d = tu.debate as Record<string, unknown>
    out.debate = Object.freeze({
      opposingProviders: Object.freeze([...(d.opposingProviders as ProviderFamily[])]),
      maxConcurrent: d.maxConcurrent as number,
      previewBeforeSend: true as const,
      maxFiles: d.maxFiles as number,
      timeoutMs: d.timeoutMs as number,
    })
  }
  return Object.freeze(out)
}

function validateBody(body: string, file: string): AgentLoadIssue | null {
  const trimmed = body.trim()
  if (trimmed.length === 0) {
    return {
      file,
      code: 'schema_invalid_body',
      rule: 'body must be non-empty',
    }
  }
  const lines = trimmed.split(/\r?\n/)
  const hasTopHeading = lines.some((l) => /^# [^#]/.test(l.trim()))
  const hasOverview = lines.some((l) => /^## Overview\b/.test(l.trim()))
  if (!hasTopHeading && !hasOverview) {
    return {
      file,
      code: 'schema_invalid_body',
      rule: 'body must contain a "# Title" heading or a "## Overview" section',
    }
  }
  return null
}

export function validateAgent(parsed: ParsedFrontmatter, file: string): AgentDefinition {
  const issues: AgentLoadIssue[] = []
  const data = parsed.data

  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (!(field in data)) {
      issues.push({
        file,
        code: 'schema_missing_field',
        rule: `frontmatter is missing required field '${field}'`,
      })
    }
  }

  if (typeof data.name === 'string') {
    if (!NAME_REGEX.test(data.name)) {
      issues.push({
        file,
        code: 'schema_invalid_name',
        rule: "'name' must match /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/",
        detail: `got ${JSON.stringify(data.name)}`,
      })
    } else {
      const expected = basename(file, '.md')
      if (data.name !== expected) {
        issues.push({
          file,
          code: 'schema_name_file_mismatch',
          rule: "'name' must match the file name without extension",
          detail: `name=${JSON.stringify(data.name)}, file basename=${JSON.stringify(expected)}`,
        })
      }
    }
  } else if ('name' in data) {
    issues.push({
      file,
      code: 'schema_invalid_value',
      rule: "'name' must be a string",
    })
  }

  if ('type' in data) {
    const issue = validateEnum(data.type, AGENT_TYPES, 'type', file)
    if (issue) issues.push(issue)
  }
  if ('phase' in data) {
    const issue = validateEnum(data.phase, AGENT_PHASES, 'phase', file)
    if (issue) issues.push(issue)
  }
  if ('provider' in data) {
    const issue = validateEnum(data.provider, AGENT_PROVIDERS, 'provider', file)
    if (issue) issues.push(issue)
  }
  if ('modelPolicy' in data) {
    const issue = validateEnum(data.modelPolicy, AGENT_MODEL_POLICIES, 'modelPolicy', file)
    if (issue) issues.push(issue)
  }

  if ('model' in data && data.model !== undefined) {
    if (typeof data.model !== 'string') {
      issues.push({
        file,
        code: 'schema_invalid_value',
        rule: "'model' must be a string when present",
      })
    } else if (data.model.trim().length === 0) {
      // M12 made `agent.model` operational via `req.model ?? req.agent.model`
      // in src/providers/manifest.ts. A persona declaring `model: ""` (or
      // whitespace-only) would otherwise forward a blank model to adapters.
      // Mirrors the description rule above and the company-row check in
      // src/config/load.ts mergeCompanyRow. Closes M12 deferred risk #1
      // (Codex CODEX_REVIEW_M12.md "Risks the proposing side missed" #1)
      // and the whitespace-only widening from
      // CODEX_RESPONSE_REFACTOR_2026-05-01.md "Bugs Claude missed".
      issues.push({
        file,
        code: 'schema_invalid_value',
        rule: "'model' must not be blank when present",
        detail: `got ${JSON.stringify(data.model)}`,
      })
    }
  }

  if ('permissions' in data) {
    const issue = validatePermissions(data.permissions, file, data.provider)
    if (issue) issues.push(issue)
  }

  if ('description' in data) {
    if (typeof data.description !== 'string') {
      issues.push({
        file,
        code: 'schema_invalid_value',
        rule: "'description' must be a string",
      })
    } else if (data.description.trim().length === 0) {
      issues.push({
        file,
        code: 'schema_invalid_value',
        rule: "'description' must not be empty",
      })
    } else if (data.description.length > MAX_DESCRIPTION_LENGTH) {
      issues.push({
        file,
        code: 'schema_description_too_long',
        rule: `'description' must be ≤ ${MAX_DESCRIPTION_LENGTH} characters`,
        detail: `got ${data.description.length}`,
      })
    }
  }

  const bodyIssue = validateBody(parsed.body, file)
  if (bodyIssue) issues.push(bodyIssue)

  if (issues.length > 0) {
    throw new AgentLoadError(issues)
  }

  const definition: AgentDefinition = Object.freeze({
    file,
    name: data.name as string,
    type: data.type as AgentType,
    phase: data.phase as AgentPhase,
    provider: data.provider as AgentProvider,
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    modelPolicy: data.modelPolicy as AgentModelPolicy,
    permissions: freezePermissions(data.permissions as Record<string, unknown>),
    description: data.description as string,
    body: parsed.body,
  })

  return definition
}
