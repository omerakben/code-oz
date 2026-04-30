import { basename } from 'node:path'
import { AgentLoadError, type AgentLoadIssue } from './errors.ts'
import type { ParsedFrontmatter } from './frontmatter.ts'

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

export const AGENT_PROVIDERS = ['claude', 'codex', 'gemini', 'fake'] as const
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

export interface ToolUsePermissions {
  readonly repo_context?: RepoContextPermissions
  readonly write?: WriteToolPermissions
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

function validatePermissions(perms: unknown, file: string): AgentLoadIssue | null {
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
    const issue = validateToolUse(p.tool_use, file)
    if (issue !== null) return issue
  }
  return null
}

function validateToolUse(value: unknown, file: string): AgentLoadIssue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use' must be an object",
    }
  }
  const tu = value as Record<string, unknown>
  const KNOWN_SUB_SCOPES = ['repo_context', 'write'] as const
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
  for (const r of w.roots as string[]) {
    if (r.length === 0) {
      return {
        file,
        code: 'schema_invalid_permissions',
        rule: "'permissions.tool_use.write.roots' entries must be non-empty strings",
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
  }
  // roots
  if (!isStringArray(rc.roots)) {
    return {
      file,
      code: 'schema_invalid_permissions',
      rule: "'permissions.tool_use.repo_context.roots' must be an array of strings",
    }
  }
  // numeric caps
  const numericFields = [
    ['maxResults', REPO_CONTEXT_HARD_CAPS.maxResults],
    ['maxBytesPerResult', REPO_CONTEXT_HARD_CAPS.maxBytesPerResult],
    ['maxFilesForNextManifest', REPO_CONTEXT_HARD_CAPS.maxFilesForNextManifest],
    ['timeoutMs', REPO_CONTEXT_HARD_CAPS.timeoutMs],
  ] as const
  for (const [field, cap] of numericFields) {
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

  if ('model' in data && data.model !== undefined && typeof data.model !== 'string') {
    issues.push({
      file,
      code: 'schema_invalid_value',
      rule: "'model' must be a string when present",
    })
  }

  if ('permissions' in data) {
    const issue = validatePermissions(data.permissions, file)
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
