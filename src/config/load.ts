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
  M12_COMPANY_ROLES,
  type CodeOzConfig,
  type CompanyConfig,
  type CompanyRole,
  type CompanyRoleOverride,
  type PhaseBudget,
  type GlobalBudget,
  type Budgets,
  type PhasesConfig,
  type DefinePhaseConfig,
  type AskMeConfig,
  type OnMaxRoundsBehavior,
} from './schema.ts'
import { AGENT_PROVIDERS, type AgentProvider } from '../agents/schema.ts'
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
const ON_MAX_ROUNDS: readonly OnMaxRoundsBehavior[] = ['finalize', 'fail']

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
  const phases = mergePhases(raw.phases, file, issues)
  const company = mergeCompany(raw.company, file, issues)

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
    phases,
    ...(company !== undefined ? { company } : {}),
  })
}

// M12: company:block validation. Validates the entire shape at config-load
// time so misconfigurations fail fast — before the agent loader runs and
// before any run starts. Per Codex Decision G in CODEX_RESPONSE_M12.md
// (thread 019de4bb), the new error code `loader_company_role_unknown`
// fires here against the locked `M12_COMPANY_ROLES` constant; per
// Decision B and Risk #5, unsupported row keys (`permissions`, `budgets`,
// `bash`) raise typed config issues so the user does not get false
// authority over deferred surfaces.
const COMPANY_ROW_FIELDS = ['provider', 'model'] as const

function mergeCompany(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): CompanyConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'company must be a mapping',
    })
    return undefined
  }
  const c = raw as Record<string, unknown>
  const out: Partial<Record<CompanyRole, CompanyRoleOverride>> = {}
  for (const [key, rowRaw] of Object.entries(c)) {
    if (!(M12_COMPANY_ROLES as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'loader_company_role_unknown',
        rule: `company.<role> must be one of: ${M12_COMPANY_ROLES.join(' | ')}`,
        detail: `got '${key}' (project-local personas with names outside this list are not routable as company roles in v0.1)`,
      })
      continue
    }
    const role = key as CompanyRole
    const override = mergeCompanyRow(rowRaw, role, file, issues)
    if (override !== undefined) {
      out[role] = override
    }
  }
  if (Object.keys(out).length === 0) return undefined
  return Object.freeze(out)
}

function mergeCompanyRow(
  raw: unknown,
  role: CompanyRole,
  file: string,
  issues: ConfigLoadIssue[],
): CompanyRoleOverride | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: `company.${role} must be a mapping`,
    })
    return undefined
  }
  const r = raw as Record<string, unknown>
  // Surface every unsupported row key, not just the first — users typing a
  // YAML row often add several at once (`permissions`, `budgets`, `bash`).
  for (const k of Object.keys(r)) {
    if (!(COMPANY_ROW_FIELDS as readonly string[]).includes(k)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.${role} may contain only ${COMPANY_ROW_FIELDS.join(' / ')} in v0.1 (per-role budgets are M13; permissions stay persona-shaped)`,
        detail: `unsupported key: '${k}'`,
      })
    }
  }
  const override: { provider?: AgentProvider; model?: string } = {}
  if (r.provider !== undefined) {
    if (
      typeof r.provider !== 'string' ||
      !(AGENT_PROVIDERS as readonly string[]).includes(r.provider)
    ) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.${role}.provider must be one of: ${AGENT_PROVIDERS.join(' | ')}`,
        detail: `got ${JSON.stringify(r.provider)}`,
      })
    } else {
      override.provider = r.provider as AgentProvider
    }
  }
  if (r.model !== undefined) {
    if (typeof r.model !== 'string' || r.model.trim().length === 0) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.${role}.model must be a non-blank string`,
        detail: `got ${JSON.stringify(r.model)}`,
      })
    } else {
      override.model = r.model
    }
  }
  return Object.freeze(override)
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
    maxWallTimeMinutes: nonNegIntOrDefault(
      g.maxWallTimeMinutes,
      def.maxWallTimeMinutes,
      'budgets.global.maxWallTimeMinutes',
      file,
      issues,
    ),
    softWarnAtRatio: ratioOrDefault(
      g.softWarnAtRatio,
      def.softWarnAtRatio,
      'budgets.global.softWarnAtRatio',
      file,
      issues,
    ),
    ...(g.priceTable !== undefined
      ? { priceTable: parsePriceTable(g.priceTable, file, issues) ?? def.priceTable }
      : def.priceTable !== undefined
        ? { priceTable: def.priceTable }
        : {}),
  }
}

function ratioOrDefault(
  raw: unknown,
  fallback: number,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): number {
  if (raw === undefined) return fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw >= 1) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a number in (0, 1)`,
      detail: `got ${JSON.stringify(raw)}`,
    })
    return fallback
  }
  return raw
}

function parsePriceTable(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): GlobalBudget['priceTable'] | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'budgets.global.priceTable must be a mapping',
    })
    return undefined
  }
  const out: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (
      v === null ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      typeof (v as { inputPerMTok?: unknown }).inputPerMTok !== 'number' ||
      typeof (v as { outputPerMTok?: unknown }).outputPerMTok !== 'number'
    ) {
      issues.push({
        file,
        code: 'config_invalid_shape',
        rule: `budgets.global.priceTable.${k} must have numeric inputPerMTok and outputPerMTok`,
      })
      continue
    }
    out[k] = {
      inputPerMTok: (v as { inputPerMTok: number }).inputPerMTok,
      outputPerMTok: (v as { outputPerMTok: number }).outputPerMTok,
    }
  }
  return Object.freeze(out)
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

function mergePhases(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): PhasesConfig {
  const def = DEFAULT_CONFIG.phases
  if (raw === undefined || raw === null) return clonePhases(def)
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ file, code: 'config_invalid_shape', rule: 'phases must be a mapping' })
    return clonePhases(def)
  }
  const p = raw as Record<string, unknown>
  return {
    define: mergeDefinePhase(p.define, file, issues),
    scientist: mergeScientistPhase(p.scientist, file, issues),
  }
}

function mergeScientistPhase(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): { retroSeedDefine: boolean } {
  const def = DEFAULT_CONFIG.phases.scientist
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'phases.scientist must be a mapping',
    })
    return { ...def }
  }
  const s = raw as Record<string, unknown>
  if (s.retroSeedDefine !== undefined && typeof s.retroSeedDefine !== 'boolean') {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: 'phases.scientist.retroSeedDefine must be a boolean',
      detail: `got ${JSON.stringify(s.retroSeedDefine)}`,
    })
    return { ...def }
  }
  return {
    retroSeedDefine: typeof s.retroSeedDefine === 'boolean' ? s.retroSeedDefine : def.retroSeedDefine,
  }
}

function mergeDefinePhase(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): DefinePhaseConfig {
  const def = DEFAULT_CONFIG.phases.define
  if (raw === undefined || raw === null) return cloneDefinePhase(def)
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'phases.define must be a mapping',
    })
    return cloneDefinePhase(def)
  }
  const d = raw as Record<string, unknown>
  return {
    askMe: mergeAskMe(d.askMe, file, issues),
  }
}

function mergeAskMe(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): AskMeConfig {
  const def = DEFAULT_CONFIG.phases.define.askMe
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'phases.define.askMe must be a mapping',
    })
    return { ...def }
  }
  const a = raw as Record<string, unknown>
  return {
    maxRounds: positiveIntOrDefault(
      a.maxRounds,
      def.maxRounds,
      'phases.define.askMe.maxRounds',
      file,
      issues,
    ),
    readySignal: nonEmptyStringOrDefault(
      a.readySignal,
      def.readySignal,
      'phases.define.askMe.readySignal',
      file,
      issues,
    ),
    onMaxRounds: enumOrDefault(
      a.onMaxRounds,
      def.onMaxRounds,
      ON_MAX_ROUNDS,
      'phases.define.askMe.onMaxRounds',
      file,
      issues,
    ),
    maxFinalizeTurns: nonNegIntOrDefault(
      a.maxFinalizeTurns,
      def.maxFinalizeTurns,
      'phases.define.askMe.maxFinalizeTurns',
      file,
      issues,
    ),
    maxRepairTurns: nonNegIntOrDefault(
      a.maxRepairTurns,
      def.maxRepairTurns,
      'phases.define.askMe.maxRepairTurns',
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

function positiveIntOrDefault(
  v: unknown,
  fallback: number,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a positive integer (>= 1)`,
      detail: `got ${JSON.stringify(v)}`,
    })
    return fallback
  }
  return v
}

function nonEmptyStringOrDefault(
  v: unknown,
  fallback: string,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): string {
  if (v === undefined) return fallback
  if (typeof v !== 'string' || v.length === 0) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be a non-empty string`,
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

function clonePhases(p: PhasesConfig): PhasesConfig {
  return {
    define: cloneDefinePhase(p.define),
    scientist: { ...p.scientist },
  }
}

function cloneDefinePhase(d: DefinePhaseConfig): DefinePhaseConfig {
  return {
    askMe: { ...d.askMe },
  }
}
