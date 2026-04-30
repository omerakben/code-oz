// Load and validate `.code-oz/config.yaml`. Falls back to DEFAULT_CONFIG when
// the file is absent. User overrides merge over defaults via deep-merge on the
// nested budgets shape; missing keys take their default values.
//
// Hand-rolled validation mirrors src/agents/schema.ts and src/state/events.ts:
// typed errors with { file, code, rule, detail? } issue arrays, no zod.

import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { paths as codeOzPaths } from '../paths.ts'
import {
  DEFAULT_CONFIG,
  type CodeOzConfig,
  type PhaseBudget,
  type GlobalBudget,
  type Budgets,
} from './schema.ts'
import type { Phase, Profile } from '../state/schemas.ts'

export interface LoadConfigOptions {
  /** Working directory containing `.code-oz/`. Defaults to process.cwd(). */
  readonly cwd?: string
  /** Override the config file path (test ergonomics). */
  readonly configPath?: string
}

export interface ConfigLoadIssue {
  readonly file: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
}

export class ConfigLoadError extends Error {
  constructor(public readonly issues: readonly ConfigLoadIssue[]) {
    const summary = issues
      .map((i) => `[${i.code}] ${i.rule}${i.detail ? ` (${i.detail})` : ''}`)
      .join('\n')
    super(`config load failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${summary}`)
    this.name = 'ConfigLoadError'
  }
}

const PHASES: readonly Phase[] = ['define', 'plan', 'build', 'verify', 'review', 'ship', 'audit']
const PROFILES: readonly Profile[] = ['greenfield', 'brownfield']
const PROVIDERS = ['claude', 'codex', 'gemini', 'fake'] as const

/**
 * Load the project config. Missing file returns DEFAULT_CONFIG (no error).
 * Invalid YAML or schema violations produce a ConfigLoadError with an issue
 * array. Partial configs are merged over defaults — every absent key takes
 * its default value.
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<CodeOzConfig> {
  const cwd = opts.cwd ?? process.cwd()
  const configPath = opts.configPath ?? codeOzPaths(cwd).config

  let content: string
  try {
    content = await readFile(configPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG
    }
    throw new ConfigLoadError([
      {
        file: configPath,
        code: 'config_io_error',
        rule: 'failed to read config file',
        detail: (err as Error).message,
      },
    ])
  }

  let raw: unknown
  try {
    raw = parseYaml(content)
  } catch (err: unknown) {
    throw new ConfigLoadError([
      {
        file: configPath,
        code: 'config_invalid_yaml',
        rule: 'config must be valid YAML',
        detail: (err as Error).message,
      },
    ])
  }

  // YAML may legitimately parse to null on an empty/comments-only file —
  // treat that as 'no overrides; use defaults'.
  if (raw === null || raw === undefined) {
    return DEFAULT_CONFIG
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigLoadError([
      {
        file: configPath,
        code: 'config_invalid_shape',
        rule: 'config must be a YAML mapping (key/value pairs)',
        detail: `got ${Array.isArray(raw) ? 'array' : typeof raw}`,
      },
    ])
  }

  return mergeConfig(raw as Record<string, unknown>, configPath)
}

function mergeConfig(raw: Record<string, unknown>, file: string): CodeOzConfig {
  const issues: ConfigLoadIssue[] = []

  const version = stringOrDefault(raw.version, DEFAULT_CONFIG.version, 'version', file, issues)
  const profile = enumOrDefault(
    raw.profile,
    DEFAULT_CONFIG.profile,
    PROFILES,
    'profile',
    file,
    issues,
  )
  const defaultProvider = enumOrDefault(
    raw.defaultProvider,
    DEFAULT_CONFIG.defaultProvider,
    PROVIDERS,
    'defaultProvider',
    file,
    issues,
  )

  const models = mergeModels(raw.models, file, issues)
  const budgets = mergeBudgets(raw.budgets, file, issues)
  const permissions = mergePermissions(raw.permissions, file, issues)

  if (issues.length > 0) {
    throw new ConfigLoadError(issues)
  }

  return Object.freeze({
    version,
    profile,
    defaultProvider,
    models,
    budgets,
    permissions,
  })
}

function mergeModels(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): CodeOzConfig['models'] {
  if (raw === undefined || raw === null) return { ...DEFAULT_CONFIG.models }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'models must be a mapping',
    })
    return { ...DEFAULT_CONFIG.models }
  }
  const m = raw as Record<string, unknown>
  return {
    primary: stringOrDefault(m.primary, DEFAULT_CONFIG.models.primary, 'models.primary', file, issues),
    reviewer: stringOrDefault(m.reviewer, DEFAULT_CONFIG.models.reviewer, 'models.reviewer', file, issues),
  }
}

function mergeBudgets(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): Budgets {
  if (raw === undefined || raw === null) return cloneBudgets(DEFAULT_CONFIG.budgets)
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ file, code: 'config_invalid_shape', rule: 'budgets must be a mapping' })
    return cloneBudgets(DEFAULT_CONFIG.budgets)
  }
  const b = raw as Record<string, unknown>
  const global = mergeGlobalBudget(b.global, file, issues)
  const perPhase = mergePerPhase(b.perPhase, file, issues)
  return { global, perPhase }
}

function mergeGlobalBudget(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): GlobalBudget {
  const def = DEFAULT_CONFIG.budgets.global
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ file, code: 'config_invalid_shape', rule: 'budgets.global must be a mapping' })
    return { ...def }
  }
  const g = raw as Record<string, unknown>
  return {
    maxTurns: nonNegIntOrDefault(g.maxTurns, def.maxTurns, 'budgets.global.maxTurns', file, issues),
    maxProviderCalls: nonNegIntOrDefault(
      g.maxProviderCalls,
      def.maxProviderCalls,
      'budgets.global.maxProviderCalls',
      file,
      issues,
    ),
    maxTokensEstimate: nonNegIntOrDefault(
      g.maxTokensEstimate,
      def.maxTokensEstimate,
      'budgets.global.maxTokensEstimate',
      file,
      issues,
    ),
    maxReviewRounds: nonNegIntOrDefault(
      g.maxReviewRounds,
      def.maxReviewRounds,
      'budgets.global.maxReviewRounds',
      file,
      issues,
    ),
    maxToolCallsPerTurn: nonNegIntOrDefault(
      g.maxToolCallsPerTurn,
      def.maxToolCallsPerTurn,
      'budgets.global.maxToolCallsPerTurn',
      file,
      issues,
    ),
    ...(g.toolCallBudgetMultiplier !== undefined
      ? {
          toolCallBudgetMultiplier: positiveFiniteNumberOrDefault(
            g.toolCallBudgetMultiplier,
            def.toolCallBudgetMultiplier ?? 1.5,
            'budgets.global.toolCallBudgetMultiplier',
            file,
            issues,
          ),
        }
      : { toolCallBudgetMultiplier: def.toolCallBudgetMultiplier }),
  }
}

function mergePerPhase(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): Record<Phase, PhaseBudget> {
  const def = DEFAULT_CONFIG.budgets.perPhase
  if (raw === undefined || raw === null) {
    return clonePerPhase(def)
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'budgets.perPhase must be a mapping',
    })
    return clonePerPhase(def)
  }
  const p = raw as Record<string, unknown>
  const out: Record<Phase, PhaseBudget> = clonePerPhase(def)
  for (const phase of PHASES) {
    const phaseRaw = p[phase]
    if (phaseRaw === undefined) continue
    if (phaseRaw === null || typeof phaseRaw !== 'object' || Array.isArray(phaseRaw)) {
      issues.push({
        file,
        code: 'config_invalid_shape',
        rule: `budgets.perPhase.${phase} must be a mapping when present`,
      })
      continue
    }
    const ph = phaseRaw as Record<string, unknown>
    const defPhase = def[phase]
    out[phase] = {
      maxTurns: nonNegIntOrDefault(
        ph.maxTurns,
        defPhase.maxTurns,
        `budgets.perPhase.${phase}.maxTurns`,
        file,
        issues,
      ),
      maxProviderCalls: nonNegIntOrDefault(
        ph.maxProviderCalls,
        defPhase.maxProviderCalls,
        `budgets.perPhase.${phase}.maxProviderCalls`,
        file,
        issues,
      ),
      maxTokensEstimate: nonNegIntOrDefault(
        ph.maxTokensEstimate,
        defPhase.maxTokensEstimate,
        `budgets.perPhase.${phase}.maxTokensEstimate`,
        file,
        issues,
      ),
    }
  }
  return out
}

function mergePermissions(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): CodeOzConfig['permissions'] {
  const def = DEFAULT_CONFIG.permissions
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'permissions must be a mapping',
    })
    return { ...def }
  }
  const p = raw as Record<string, unknown>
  return {
    allowEscapeHatch: booleanOrDefault(
      p.allowEscapeHatch,
      def.allowEscapeHatch,
      'permissions.allowEscapeHatch',
      file,
      issues,
    ),
    requireApprovalForBuild: booleanOrDefault(
      p.requireApprovalForBuild,
      def.requireApprovalForBuild,
      'permissions.requireApprovalForBuild',
      file,
      issues,
    ),
  }
}

// --- helpers -------------------------------------------------------

function stringOrDefault(
  v: unknown,
  fallback: string,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): string {
  if (v === undefined) return fallback
  if (typeof v !== 'string') {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a string`,
      detail: `got ${typeof v}`,
    })
    return fallback
  }
  return v
}

function enumOrDefault<T extends string>(
  v: unknown,
  fallback: T,
  allowed: readonly T[],
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): T {
  if (v === undefined) return fallback
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be one of: ${allowed.join(' | ')}`,
      detail: `got ${JSON.stringify(v)}`,
    })
    return fallback
  }
  return v as T
}

function nonNegIntOrDefault(
  v: unknown,
  fallback: number,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a non-negative integer`,
      detail: `got ${JSON.stringify(v)}`,
    })
    return fallback
  }
  return v
}

function positiveFiniteNumberOrDefault(
  v: unknown,
  fallback: number,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a finite positive number`,
      detail: `got ${JSON.stringify(v)}`,
    })
    return fallback
  }
  return v
}

function booleanOrDefault(
  v: unknown,
  fallback: boolean,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a boolean`,
      detail: `got ${typeof v}`,
    })
    return fallback
  }
  return v
}

function cloneBudgets(b: Budgets): Budgets {
  return {
    global: { ...b.global },
    perPhase: clonePerPhase(b.perPhase),
  }
}

function clonePerPhase(p: Record<Phase, PhaseBudget>): Record<Phase, PhaseBudget> {
  return {
    define: { ...p.define },
    plan: { ...p.plan },
    build: { ...p.build },
    verify: { ...p.verify },
    review: { ...p.review },
    ship: { ...p.ship },
    audit: { ...p.audit },
  }
}
