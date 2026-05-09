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
  DEBATE_SCHEDULER_MODE_VALUES,
  DEFAULT_CONFIG,
  DEFAULT_DEBATE_POLICY,
  M12_COMPANY_ROLES,
  PANELIST_ROLES,
  type ByRoleBudget,
  type CodeOzConfig,
  type CompanyConfig,
  type CompanyRole,
  type CompanyRoleOverride,
  type DebatePolicyConfig,
  type DebatePolicyCooldown,
  type DebatePolicyTriggers,
  type DebateSchedulerModeConfig,
  type Panelist,
  type PhaseBudget,
  type GlobalBudget,
  type Budgets,
  type PhasesConfig,
  type DefinePhaseConfig,
  type AskMeConfig,
  type OnMaxRoundsBehavior,
} from './schema.ts'
import { AGENT_PROVIDERS, type AgentProvider } from '../agents/schema.ts'
import { familyOf } from '../providers/families.ts'
import type { ProviderId } from '../providers/types.ts'
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
const PROVIDERS = ['claude', 'codex', 'gemini', 'fake', 'xai'] as const
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
  const company = mergeCompany(raw.company, defaultProvider, file, issues)
  const debatePolicy = mergeDebatePolicy(raw.debatePolicy, file, issues)

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
    ...(debatePolicy !== undefined ? { debatePolicy } : {}),
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
//
// M14 (rule 20: panel quorum + cross-family enforcement + synthesis):
// the `panel` field is allowed ONLY on the `reviewer` role; any other
// role with `panel:` raises `config_invalid_value`. Panel validation
// is layer 1 of the 5-layer defense-in-depth; the agent loader's
// panel-cross-family check is the authoritative pass once the resolved
// build family is known. See docs/contracts/REVIEW_PANEL.md.
const COMPANY_ROW_FIELDS = ['provider', 'model'] as const
const REVIEWER_ROW_FIELDS = ['provider', 'model', 'panel'] as const
const PANELIST_FIELDS = ['provider', 'model', 'role'] as const

function mergeCompany(
  raw: unknown,
  defaultProvider: AgentProvider,
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
  // Pre-resolve build provider (best-effort) so the reviewer panel cross-
  // family check at config-load can fire before the agent loader runs.
  // Authoritative cross-family check happens in src/agents/loader.ts where
  // the resolved BUILD agent's actual provider is known. Layer 1 here is
  // best-effort early rejection; layer 2 is the authoritative loader pass.
  const builderRaw = c.builder
  let builderProvider: AgentProvider | undefined
  if (
    builderRaw !== null &&
    typeof builderRaw === 'object' &&
    !Array.isArray(builderRaw) &&
    typeof (builderRaw as Record<string, unknown>).provider === 'string' &&
    (AGENT_PROVIDERS as readonly string[]).includes(
      (builderRaw as Record<string, unknown>).provider as string,
    )
  ) {
    builderProvider = (builderRaw as Record<string, unknown>).provider as AgentProvider
  }
  const buildProviderForPanelCheck: AgentProvider = builderProvider ?? defaultProvider
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
    const override = mergeCompanyRow(
      rowRaw,
      role,
      buildProviderForPanelCheck,
      file,
      issues,
    )
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
  buildProviderForPanelCheck: AgentProvider,
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
  // Reviewer accepts `panel` in addition to provider/model; other roles do not.
  const allowedFields = role === 'reviewer' ? REVIEWER_ROW_FIELDS : COMPANY_ROW_FIELDS
  for (const k of Object.keys(r)) {
    if (!(allowedFields as readonly string[]).includes(k)) {
      const detail =
        k === 'panel' && role !== 'reviewer'
          ? `'panel' is valid only on company.reviewer (M14 reviewer panel v1)`
          : `unsupported key: '${k}'`
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.${role} may contain only ${allowedFields.join(' / ')} in v0.1 (per-role budgets are M13; permissions stay persona-shaped)`,
        detail,
      })
    }
  }
  const override: { provider?: AgentProvider; model?: string; panel?: readonly Panelist[] } = {}
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
  if (role === 'reviewer' && r.panel !== undefined) {
    const panel = mergeReviewerPanel(r.panel, buildProviderForPanelCheck, file, issues)
    if (panel !== undefined) {
      override.panel = panel
    }
  }
  return Object.freeze(override)
}

/**
 * M14: parse + validate `company.reviewer.panel`. Layer 1 of the 5-layer
 * defense-in-depth (per docs/contracts/REVIEW_PANEL.md § "Five-layer
 * defense-in-depth"). Validates:
 *   - shape (must be array of mappings)
 *   - each panelist has valid provider, role, optional model
 *   - exactly two `voter` panelists (no configurable quorum in v1)
 *   - voter families are cross-family vs the resolved build family
 *     (best-effort here; agent loader runs the authoritative check)
 *   - optional advisory panelists allowed; advisory may be same-family
 *     (advisory has no gate authority — Codex pushback Q7)
 *
 * Errors:
 *   - `panel_voter_count_invalid` if voters !== 2
 *   - `panel_voter_same_family_as_build` if any voter is same-family
 *   - `config_invalid_shape` for malformed array / mapping
 *   - `config_invalid_value` for invalid provider / role / model
 */
function mergeReviewerPanel(
  raw: unknown,
  buildProvider: AgentProvider,
  file: string,
  issues: ConfigLoadIssue[],
): readonly Panelist[] | undefined {
  if (!Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'company.reviewer.panel must be an array of panelists',
      detail: `got ${typeof raw === 'object' && raw !== null ? 'object' : typeof raw}`,
    })
    return undefined
  }
  const buildFamily = familyOf(buildProvider as ProviderId)
  const panelists: Panelist[] = []
  let voterCount = 0
  for (let i = 0; i < raw.length; i++) {
    const itemRaw = raw[i]
    if (itemRaw === null || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) {
      issues.push({
        file,
        code: 'config_invalid_shape',
        rule: `company.reviewer.panel[${i}] must be a mapping with provider + role (model optional)`,
      })
      continue
    }
    const item = itemRaw as Record<string, unknown>
    for (const k of Object.keys(item)) {
      if (!(PANELIST_FIELDS as readonly string[]).includes(k)) {
        issues.push({
          file,
          code: 'config_invalid_value',
          rule: `company.reviewer.panel[${i}] may contain only ${PANELIST_FIELDS.join(' / ')}`,
          detail: `unsupported key: '${k}'`,
        })
      }
    }
    let provider: AgentProvider | undefined
    if (
      typeof item.provider !== 'string' ||
      !(AGENT_PROVIDERS as readonly string[]).includes(item.provider)
    ) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.reviewer.panel[${i}].provider must be one of: ${AGENT_PROVIDERS.join(' | ')}`,
        detail: `got ${JSON.stringify(item.provider)}`,
      })
    } else {
      provider = item.provider as AgentProvider
    }
    let panelistRole: 'voter' | 'advisory' | undefined
    if (
      typeof item.role !== 'string' ||
      !(PANELIST_ROLES as readonly string[]).includes(item.role)
    ) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `company.reviewer.panel[${i}].role must be one of: ${PANELIST_ROLES.join(' | ')}`,
        detail: `got ${JSON.stringify(item.role)}`,
      })
    } else {
      panelistRole = item.role as 'voter' | 'advisory'
    }
    let model: string | undefined
    if (item.model !== undefined) {
      if (typeof item.model !== 'string' || item.model.trim().length === 0) {
        issues.push({
          file,
          code: 'config_invalid_value',
          rule: `company.reviewer.panel[${i}].model must be a non-blank string`,
          detail: `got ${JSON.stringify(item.model)}`,
        })
      } else {
        model = item.model
      }
    }
    if (provider === undefined || panelistRole === undefined) continue

    if (panelistRole === 'voter') {
      voterCount++
      const voterFamily = familyOf(provider as ProviderId)
      if (voterFamily === buildFamily) {
        issues.push({
          file,
          code: 'panel_voter_same_family_as_build',
          rule:
            'company.reviewer.panel voter family must differ from the resolved BUILD family ' +
            '(M14 panel quorum + CLAUDE.md non-negotiable rule 2). ' +
            'Same-family advisory entries are allowed (no gate authority); same-family voters are not.',
          detail:
            `panel[${i}] provider='${provider}' family='${voterFamily}' matches build family ` +
            `'${buildFamily}' (build provider='${buildProvider}'). Use a different family or change role to advisory.`,
        })
      }
    }

    panelists.push(
      Object.freeze({
        provider,
        ...(model !== undefined ? { model } : {}),
        role: panelistRole,
      }),
    )
  }
  if (voterCount !== 2) {
    issues.push({
      file,
      code: 'panel_voter_count_invalid',
      rule:
        'company.reviewer.panel must have exactly 2 voters in v0.1 ' +
        '(M14 fixed-quorum; configurable k-of-N is M16+). Optional advisory entries do not count.',
      detail: `got ${voterCount} voter${voterCount === 1 ? '' : 's'} (panel.length=${raw.length})`,
    })
  }
  return Object.freeze(panelists)
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
    ...(g.byRole !== undefined
      ? (() => {
          const merged = mergeByRole(g.byRole, file, issues)
          return merged !== undefined ? { byRole: merged } : {}
        })()
      : def.byRole !== undefined
        ? { byRole: def.byRole }
        : {}),
  }
}

// M13: byRole validation. Rejects non-canonical role keys with
// `loader_company_role_unknown` (symmetric with M12 `mergeCompany`
// fail-closed). Each row may carry `maxProviderCalls?` and
// `maxTokensEstimate?` only; unsupported row keys (`maxTurns`,
// `permissions`, etc.) raise typed config issues so users do not get
// false authority over deferred surfaces (Codex Blocker 2: maxTurns is
// undefined against the current event model).
const BYROLE_ROW_FIELDS = ['maxProviderCalls', 'maxTokensEstimate'] as const

function mergeByRole(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): Readonly<Partial<Record<CompanyRole, ByRoleBudget>>> | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'budgets.global.byRole must be a mapping',
    })
    return undefined
  }
  const r = raw as Record<string, unknown>
  const out: Partial<Record<CompanyRole, ByRoleBudget>> = {}
  for (const [key, rowRaw] of Object.entries(r)) {
    if (!(M12_COMPANY_ROLES as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'loader_company_role_unknown',
        rule: `budgets.global.byRole.<role> must be one of: ${M12_COMPANY_ROLES.join(' | ')}`,
        detail: `got '${key}' (project-local personas with names outside this list do not gate per-role; global + per-phase budgets still enforce)`,
      })
      continue
    }
    const role = key as CompanyRole
    const row = mergeByRoleRow(rowRaw, role, file, issues)
    if (row !== undefined) {
      out[role] = row
    }
  }
  if (Object.keys(out).length === 0) return undefined
  return Object.freeze(out)
}

function mergeByRoleRow(
  raw: unknown,
  role: CompanyRole,
  file: string,
  issues: ConfigLoadIssue[],
): ByRoleBudget | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: `budgets.global.byRole.${role} must be a mapping`,
    })
    return undefined
  }
  const r = raw as Record<string, unknown>
  for (const k of Object.keys(r)) {
    if (!(BYROLE_ROW_FIELDS as readonly string[]).includes(k)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `budgets.global.byRole.${role} may contain only ${BYROLE_ROW_FIELDS.join(' / ')} in v0.1`,
        detail: `unsupported key: '${k}' (maxTurns is intentionally absent — the existing reducer counts phase_entered, not agent calls; per-role permissions are persona-shaped, not config-shaped)`,
      })
    }
  }
  const row: { maxProviderCalls?: number; maxTokensEstimate?: number } = {}
  if (r.maxProviderCalls !== undefined) {
    if (typeof r.maxProviderCalls !== 'number' || !Number.isInteger(r.maxProviderCalls) || r.maxProviderCalls < 0) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `budgets.global.byRole.${role}.maxProviderCalls must be a non-negative integer`,
        detail: `got ${JSON.stringify(r.maxProviderCalls)}`,
      })
    } else {
      row.maxProviderCalls = r.maxProviderCalls
    }
  }
  if (r.maxTokensEstimate !== undefined) {
    if (typeof r.maxTokensEstimate !== 'number' || !Number.isInteger(r.maxTokensEstimate) || r.maxTokensEstimate < 0) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `budgets.global.byRole.${role}.maxTokensEstimate must be a non-negative integer`,
        detail: `got ${JSON.stringify(r.maxTokensEstimate)}`,
      })
    } else {
      row.maxTokensEstimate = r.maxTokensEstimate
    }
  }
  return Object.freeze(row)
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
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      issues.push({
        file,
        code: 'config_invalid_shape',
        rule: `budgets.global.priceTable.${k} must be a mapping with inputPerMTok and outputPerMTok`,
      })
      continue
    }
    const row = v as { inputPerMTok?: unknown; outputPerMTok?: unknown }
    // M13 Codex Risk #3 + Bug #5 (CODEX_RESPONSE_M13.md): the prior
    // validator only checked `typeof === 'number'` and accepted NaN,
    // Infinity, -Infinity, and negative values silently. The cost-math
    // helper would then produce NaN / Infinity USD figures and propagate
    // them into events.jsonl. Harden to finite + non-negative here, so
    // every downstream consumer can rely on the invariant.
    const inputOk =
      typeof row.inputPerMTok === 'number' &&
      Number.isFinite(row.inputPerMTok) &&
      row.inputPerMTok >= 0
    const outputOk =
      typeof row.outputPerMTok === 'number' &&
      Number.isFinite(row.outputPerMTok) &&
      row.outputPerMTok >= 0
    if (!inputOk || !outputOk) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `budgets.global.priceTable.${k} must have finite non-negative inputPerMTok and outputPerMTok (rejects NaN, Infinity, negatives)`,
        detail: `inputPerMTok=${JSON.stringify(row.inputPerMTok)}, outputPerMTok=${JSON.stringify(row.outputPerMTok)}`,
      })
      continue
    }
    out[k] = {
      inputPerMTok: row.inputPerMTok as number,
      outputPerMTok: row.outputPerMTok as number,
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

// M15 (rule 20: debate-policy scheduler config surface). Returns undefined
// when raw is absent — runtime callers resolve via `cfg.debatePolicy ??
// DEFAULT_DEBATE_POLICY`. When present, validates every field strictly:
// unknown row keys raise `config_invalid_value`; out-of-range numbers raise
// `config_invalid_value` with detail naming the violated bound. The default
// `mode: manual` preserves M10 behavior.
const DEBATE_POLICY_FIELDS = [
  'mode',
  'maxPerRun',
  'maxPerTask',
  'triggers',
  'cooldown',
] as const
const DEBATE_POLICY_TRIGGER_FIELDS = [
  'reviewScoreGreyZone',
  'panelVoterDisagreement',
  'needsRevisionWithHighScore',
] as const
const DEBATE_POLICY_COOLDOWN_FIELDS = ['dedupByFingerprint'] as const
const DEBATE_POLICY_GREY_ZONE_FIELDS = ['min', 'max'] as const
const DEBATE_POLICY_SCORE_MIN = 0
const DEBATE_POLICY_SCORE_MAX = 10

function mergeDebatePolicy(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): DebatePolicyConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'debatePolicy must be a mapping',
    })
    return undefined
  }
  const r = raw as Record<string, unknown>

  // Reject unknown row keys (bundling guard).
  for (const key of Object.keys(r)) {
    if (!(DEBATE_POLICY_FIELDS as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `debatePolicy.${key} is not a recognized field`,
        detail: `allowed: ${DEBATE_POLICY_FIELDS.join(' | ')}`,
      })
    }
  }

  const mode = enumOrDefault<DebateSchedulerModeConfig>(
    r.mode,
    DEFAULT_DEBATE_POLICY.mode,
    DEBATE_SCHEDULER_MODE_VALUES,
    'debatePolicy.mode',
    file,
    issues,
  )

  const maxPerRun = nonNegIntOrDefault(
    r.maxPerRun,
    DEFAULT_DEBATE_POLICY.maxPerRun,
    'debatePolicy.maxPerRun',
    file,
    issues,
  )

  const maxPerTask = nonNegIntOrDefault(
    r.maxPerTask,
    DEFAULT_DEBATE_POLICY.maxPerTask,
    'debatePolicy.maxPerTask',
    file,
    issues,
  )

  const triggers = mergeDebatePolicyTriggers(r.triggers, file, issues)
  const cooldown = mergeDebatePolicyCooldown(r.cooldown, file, issues)

  return {
    mode,
    maxPerRun,
    maxPerTask,
    triggers,
    cooldown,
  }
}

function mergeDebatePolicyTriggers(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): DebatePolicyTriggers {
  const def = DEFAULT_DEBATE_POLICY.triggers
  if (raw === undefined || raw === null) {
    return {
      reviewScoreGreyZone: { ...def.reviewScoreGreyZone },
      panelVoterDisagreement: def.panelVoterDisagreement,
      needsRevisionWithHighScore: def.needsRevisionWithHighScore,
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'debatePolicy.triggers must be a mapping',
    })
    return {
      reviewScoreGreyZone: { ...def.reviewScoreGreyZone },
      panelVoterDisagreement: def.panelVoterDisagreement,
      needsRevisionWithHighScore: def.needsRevisionWithHighScore,
    }
  }
  const t = raw as Record<string, unknown>

  for (const key of Object.keys(t)) {
    if (!(DEBATE_POLICY_TRIGGER_FIELDS as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `debatePolicy.triggers.${key} is not a recognized field`,
        detail: `allowed: ${DEBATE_POLICY_TRIGGER_FIELDS.join(' | ')}`,
      })
    }
  }

  return {
    reviewScoreGreyZone: mergeGreyZone(t.reviewScoreGreyZone, file, issues),
    panelVoterDisagreement: booleanOrDefault(
      t.panelVoterDisagreement,
      def.panelVoterDisagreement,
      'debatePolicy.triggers.panelVoterDisagreement',
      file,
      issues,
    ),
    needsRevisionWithHighScore: booleanOrDefault(
      t.needsRevisionWithHighScore,
      def.needsRevisionWithHighScore,
      'debatePolicy.triggers.needsRevisionWithHighScore',
      file,
      issues,
    ),
  }
}

function mergeGreyZone(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): { min: number; max: number } {
  const def = DEFAULT_DEBATE_POLICY.triggers.reviewScoreGreyZone
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'debatePolicy.triggers.reviewScoreGreyZone must be a mapping',
    })
    return { ...def }
  }
  const z = raw as Record<string, unknown>

  for (const key of Object.keys(z)) {
    if (!(DEBATE_POLICY_GREY_ZONE_FIELDS as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `debatePolicy.triggers.reviewScoreGreyZone.${key} is not a recognized field`,
        detail: `allowed: ${DEBATE_POLICY_GREY_ZONE_FIELDS.join(' | ')}`,
      })
    }
  }

  const min = scoreOrDefault(
    z.min,
    def.min,
    'debatePolicy.triggers.reviewScoreGreyZone.min',
    file,
    issues,
  )
  const max = scoreOrDefault(
    z.max,
    def.max,
    'debatePolicy.triggers.reviewScoreGreyZone.max',
    file,
    issues,
  )
  if (min > max) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: 'debatePolicy.triggers.reviewScoreGreyZone.min must be <= reviewScoreGreyZone.max',
      detail: `min=${min}, max=${max}`,
    })
    return { ...def }
  }
  return { min, max }
}

function scoreOrDefault(
  v: unknown,
  fallback: number,
  field: string,
  file: string,
  issues: ConfigLoadIssue[],
): number {
  if (v === undefined) return fallback
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < DEBATE_POLICY_SCORE_MIN ||
    v > DEBATE_POLICY_SCORE_MAX
  ) {
    issues.push({
      file,
      code: 'config_invalid_value',
      rule: `${field} must be an integer in [${DEBATE_POLICY_SCORE_MIN}, ${DEBATE_POLICY_SCORE_MAX}]`,
      detail: `got ${JSON.stringify(v)}`,
    })
    return fallback
  }
  return v
}

function mergeDebatePolicyCooldown(
  raw: unknown,
  file: string,
  issues: ConfigLoadIssue[],
): DebatePolicyCooldown {
  const def = DEFAULT_DEBATE_POLICY.cooldown
  if (raw === undefined || raw === null) return { ...def }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      file,
      code: 'config_invalid_shape',
      rule: 'debatePolicy.cooldown must be a mapping',
    })
    return { ...def }
  }
  const c = raw as Record<string, unknown>

  for (const key of Object.keys(c)) {
    if (!(DEBATE_POLICY_COOLDOWN_FIELDS as readonly string[]).includes(key)) {
      issues.push({
        file,
        code: 'config_invalid_value',
        rule: `debatePolicy.cooldown.${key} is not a recognized field`,
        detail: `allowed: ${DEBATE_POLICY_COOLDOWN_FIELDS.join(' | ')}`,
      })
    }
  }

  return {
    dedupByFingerprint: booleanOrDefault(
      c.dedupByFingerprint,
      def.dedupByFingerprint,
      'debatePolicy.cooldown.dedupByFingerprint',
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
