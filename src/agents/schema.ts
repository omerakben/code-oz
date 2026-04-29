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

export interface AgentPermissions {
  readonly read: '*' | readonly string[]
  readonly write: '*' | readonly string[]
  readonly bash: 'deny' | readonly string[]
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
  return null
}

function freezePermissions(perms: Record<string, unknown>): AgentPermissions {
  const freezeField = (v: unknown): '*' | 'deny' | readonly string[] => {
    if (v === '*' || v === 'deny') return v
    return Object.freeze([...(v as string[])])
  }
  return Object.freeze({
    read: freezeField(perms.read) as '*' | readonly string[],
    write: freezeField(perms.write) as '*' | readonly string[],
    bash: freezeField(perms.bash) as 'deny' | readonly string[],
  })
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
