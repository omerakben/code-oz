import { readFile, readdir, stat, lstat, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import { validateAgent, type AgentDefinition, type AgentPhase } from './schema.ts'
import { AgentLoadError, type AgentLoadIssue } from './errors.ts'
import { capabilityOf } from '../providers/capabilities.ts'
import { familyOf } from '../providers/families.ts'
import type { ProviderId } from '../providers/types.ts'
import {
  M12_COMPANY_ROLES,
  type CompanyConfig,
  type CompanyRole,
} from '../config/schema.ts'

export interface SourceFile {
  readonly file: string
  readonly content: string
}

export interface AgentRegistry {
  getByName(name: string): AgentDefinition | undefined
  getByPhase(phase: AgentPhase): readonly AgentDefinition[]
  listAll(): readonly AgentDefinition[]
}

export interface BuildRegistryOptions {
  readonly defaults: readonly SourceFile[]
  readonly overrides: readonly SourceFile[]
  /**
   * M12: optional company:block routing overrides. When present, every
   * matching definition has its `provider` and/or `model` replaced before
   * the cross-family + eligibility + debate-family checks run, so all
   * three checks see the resolved values. Per Codex Decision D in
   * CODEX_RESPONSE_M12.md (thread 019de4bb).
   */
  readonly company?: CompanyConfig
}

export interface LoadRegistryOptions {
  readonly defaults: readonly SourceFile[]
  readonly projectDir?: string
  readonly cwd?: string
  readonly company?: CompanyConfig
}

function validateOne(source: SourceFile): AgentDefinition {
  const parsed = parseFrontmatter(source.content, source.file)
  return validateAgent(parsed, source.file)
}

function makeRegistry(definitions: readonly AgentDefinition[]): AgentRegistry {
  const sorted = Object.freeze([...definitions].sort((a, b) => a.name.localeCompare(b.name)))
  const byName = new Map(sorted.map((d) => [d.name, d]))
  const byPhase = new Map<AgentPhase, readonly AgentDefinition[]>()
  for (const d of sorted) {
    const existing = byPhase.get(d.phase) ?? []
    byPhase.set(d.phase, [...existing, d])
  }
  for (const [k, v] of byPhase) {
    byPhase.set(k, Object.freeze(v))
  }
  return Object.freeze({
    getByName: (name: string) => byName.get(name),
    getByPhase: (phase: AgentPhase) => byPhase.get(phase) ?? Object.freeze([] as AgentDefinition[]),
    listAll: () => sorted,
  })
}

export function buildRegistry(opts: BuildRegistryOptions): AgentRegistry {
  const map = new Map<string, AgentDefinition>()

  for (const source of opts.defaults) {
    const def = validateOne(source)
    map.set(def.name, def)
  }

  for (const source of opts.overrides) {
    const def = validateOne(source)
    const bundled = map.get(def.name)
    if (bundled && (bundled.type !== def.type || bundled.phase !== def.phase)) {
      throw new AgentLoadError([
        {
          file: def.file,
          code: 'loader_phase_mismatch_override',
          rule: `override of '${def.name}' must match the bundled default's type and phase`,
          detail: `bundled: type=${bundled.type} phase=${bundled.phase}; override: type=${def.type} phase=${def.phase}`,
        },
      ])
    }
    map.set(def.name, def)
  }

  const merged = Array.from(map.values())
  // M12: apply company:block overrides between the bundled-vs-override merge
  // and the resolved-provider checks. Order is load-bearing — cross-family
  // (rule 2), provider eligibility (M11), and the new post-override
  // debate-family check must all see the resolved provider.
  const resolved = applyCompanyOverrides(merged, opts.company)
  enforceDebateOpposingFamilyAfterOverride(resolved)
  enforceCrossFamilyReview(resolved)
  enforceProviderPhaseEligibility(resolved)
  // M14: authoritative panel cross-family check. Layer 2 of the 5-layer
  // defense (per docs/contracts/REVIEW_PANEL.md). Layer 1 (config-load) is
  // best-effort — it uses defaultProvider when `company.builder.provider`
  // is unset and cannot see the bundled BUILD agent's frontmatter provider.
  // This pass uses the resolved BUILD agent's provider, which is the
  // authoritative value at runtime.
  enforceReviewerPanelCrossFamily(resolved, opts.company)

  return makeRegistry(resolved)
}

/**
 * M12: pure function that overlays the `company:` block on the merged
 * AgentDefinition list. For each definition whose `name` matches a key
 * in the company config, return a new frozen AgentDefinition with
 * `provider` and/or `model` replaced. Definitions without a matching
 * row pass through unchanged. Defends with a runtime role-roster check
 * so callers that bypass loadConfig (e.g., tests using TypeScript escape
 * hatches) still hit `loader_company_role_unknown` for keys outside
 * `M12_COMPANY_ROLES`. Per Codex Decision D + Risk #1 in
 * CODEX_RESPONSE_M12.md (thread 019de4bb).
 */
function applyCompanyOverrides(
  definitions: readonly AgentDefinition[],
  company: CompanyConfig | undefined,
): readonly AgentDefinition[] {
  if (company === undefined) return definitions

  const issues: AgentLoadIssue[] = []
  for (const key of Object.keys(company)) {
    if (!(M12_COMPANY_ROLES as readonly string[]).includes(key)) {
      issues.push({
        file: '.code-oz/config.yaml',
        code: 'loader_company_role_unknown',
        rule:
          `company.<role> must be one of: ${M12_COMPANY_ROLES.join(' | ')} ` +
          '(M12 locked roster — project-local personas with names outside this list are not ' +
          'routable as company roles in v0.1; custom role routing is M16+)',
        detail: `got '${key}'`,
      })
    }
  }
  if (issues.length > 0) {
    throw new AgentLoadError(issues)
  }

  return Object.freeze(
    definitions.map((def) => {
      if (!(M12_COMPANY_ROLES as readonly string[]).includes(def.name)) return def
      const override = company[def.name as CompanyRole]
      if (override === undefined) return def
      if (override.provider === undefined && override.model === undefined) return def
      return Object.freeze({
        ...def,
        ...(override.provider !== undefined ? { provider: override.provider } : {}),
        ...(override.model !== undefined ? { model: override.model } : {}),
      })
    }),
  )
}

/**
 * M12: post-override re-check of the schema-time debate-family invariant.
 * Schema validation in src/agents/schema.ts checks
 * `tool_use.debate.opposingProviders` against the persona's *frontmatter*
 * provider, but a company:block override may change the resolved provider.
 * This pass re-asserts the cross-family invariant against the resolved
 * provider so a same-family conflict surfaces at load time, not at the
 * first debate call. Per Codex Risk #4 in CODEX_RESPONSE_M12.md (thread
 * 019de4bb). Reuses the existing `schema_invalid_permissions` code (the
 * rule is the same; only the surface — frontmatter vs resolved — differs).
 */
function enforceDebateOpposingFamilyAfterOverride(
  definitions: readonly AgentDefinition[],
): void {
  const conflicts: AgentLoadIssue[] = []
  for (const def of definitions) {
    const debate = def.permissions.tool_use?.debate
    if (debate === undefined) continue
    const resolvedFamily = familyOf(def.provider as ProviderId)
    if (debate.opposingProviders.includes(resolvedFamily)) {
      conflicts.push({
        file: def.file,
        code: 'schema_invalid_permissions',
        rule:
          "'permissions.tool_use.debate.opposingProviders' must not include the persona's resolved family " +
          '(M12 post-override re-check — schema-time validateDebate uses frontmatter provider; ' +
          'a company:block override that changes provider can put the resolved family into the ' +
          "persona's opposingProviders list, which would otherwise surface only at first debate call)",
        detail:
          `agent='${def.name}' (file=${def.file}), resolved provider=${def.provider}, ` +
          `resolved family=${resolvedFamily}, opposingProviders=${JSON.stringify([...debate.opposingProviders])}`,
      })
    }
  }
  if (conflicts.length > 0) {
    throw new AgentLoadError(conflicts)
  }
}

function enforceProviderPhaseEligibility(definitions: readonly AgentDefinition[]): void {
  // Load-time eligibility: an agent declaring (provider X, phase Y) must
  // be runnable — provider X's static ProviderCapability declaration must
  // include Y in its eligiblePhases. Pinned in M11 (CLAUDE.md rule 20:
  // provider eligibility authority).
  //
  // This loader uses the pure capabilityOf() lookup from
  // src/providers/capabilities.ts, NOT ProviderRegistry.capabilityOf() —
  // the registry does not exist at agent-load time. Same load/runtime
  // split as familyOf() above (M9 substrate).
  //
  // The check is layered:
  //   (1) the persona's declared (provider, phase) must be eligible
  //       — the obvious case.
  //   (2) every provider declared in `tool_use.debate.opposingProviders`
  //       must be eligible for the persona's own phase. This closes the
  //       M10 synthetic-debate-opponent bypass: requestDebate() builds a
  //       runtime AgentDefinition with `provider = opposingProvider` and
  //       `phase = callerPhase`, copying the opposingProvider directly out
  //       of the persona's permission list. Without (2), a persona
  //       declaring `opposingProviders: ['gemini']` would route a
  //       synthetic plan-phase opponent to gemini even though
  //       capabilityOf('gemini').eligiblePhases is []. Per Codex M11
  //       implementation review (CODEX_REVIEW_M11.md, thread
  //       019de46d-b8c9-7f13-8257-81b572121306, block-push #1).
  //
  // Failures aggregate into AgentLoadError. Per Codex CODEX_RESPONSE_M11.md
  // "Risks the proposing side missed", AgentLoadIssue does NOT carry
  // actionableSuggestions; the rule + detail fields carry the fix hint.
  const conflicts: AgentLoadIssue[] = []
  for (const def of definitions) {
    const cap = capabilityOf(def.provider as ProviderId)
    if (!cap.eligiblePhases.includes(def.phase)) {
      conflicts.push({
        file: def.file,
        code: 'loader_provider_phase_not_eligible',
        rule: "agent's provider is not eligible for the agent's phase (CLAUDE.md rule 20: provider eligibility)",
        detail:
          `agent='${def.name}' (file=${def.file}), provider=${def.provider}, ` +
          `phase=${def.phase}, eligible phases for ${def.provider}=` +
          (cap.eligiblePhases.length === 0 ? '[]' : `[${cap.eligiblePhases.join(', ')}]`),
      })
    }
    const debate = def.permissions.tool_use?.debate
    if (debate !== undefined) {
      for (const opposingProvider of debate.opposingProviders) {
        const opposingCap = capabilityOf(opposingProvider as ProviderId)
        if (!opposingCap.eligiblePhases.includes(def.phase)) {
          conflicts.push({
            file: def.file,
            code: 'loader_provider_phase_not_eligible',
            rule:
              "agent's tool_use.debate.opposingProviders includes a provider that is not eligible " +
              "for the agent's phase (CLAUDE.md rule 20: provider eligibility; closes M10 synthetic-opponent bypass)",
            detail:
              `agent='${def.name}' (file=${def.file}), agent phase=${def.phase}, ` +
              `opposingProvider=${opposingProvider}, eligible phases for ${opposingProvider}=` +
              (opposingCap.eligiblePhases.length === 0
                ? '[]'
                : `[${opposingCap.eligiblePhases.join(', ')}]`),
          })
        }
      }
    }
  }
  if (conflicts.length > 0) {
    throw new AgentLoadError(conflicts)
  }
}

/**
 * M14 (rule 20: panel quorum + cross-family enforcement + synthesis).
 * Authoritative cross-family check for `company.reviewer.panel` voters.
 * Runs after `applyCompanyOverrides` so the BUILD agent's resolved
 * provider is the same one runtime invocation will see.
 *
 * - Detects BUILD agent's resolved provider (the first build-phase agent;
 *   v0.1 ships exactly one builder per CLAUDE.md rule 20).
 * - For each `role: voter` panelist in `company.reviewer.panel`, asserts
 *   `familyOf(voter.provider) !== familyOf(build.provider)`.
 * - Same-family `role: advisory` entries pass (advisory has NO gate
 *   authority; Codex pushback Q7 + REVIEW_PANEL.md § "Same-family
 *   advisory authority").
 * - Voter count enforcement is layer 1 (config-load); this layer skips
 *   that check to avoid double-emission.
 *
 * Error code `panel_voter_same_family_as_build` is the same code config-
 * load uses; the `detail` field disambiguates which layer fired.
 */
function enforceReviewerPanelCrossFamily(
  definitions: readonly AgentDefinition[],
  company: CompanyConfig | undefined,
): void {
  const panel = company?.reviewer?.panel
  if (panel === undefined || panel.length === 0) return

  const buildAgents = definitions.filter((d) => d.phase === 'build')
  if (buildAgents.length === 0) return
  // v0.1 ships exactly one BUILD agent per the M7 single-builder
  // discipline; if a future profile lifts that, all BUILD families must
  // be cross-family with every panel voter for the panel to be valid.
  const buildFamilies = Array.from(
    new Set(buildAgents.map((d) => familyOf(d.provider as ProviderId))),
  )

  const conflicts: AgentLoadIssue[] = []
  for (let i = 0; i < panel.length; i++) {
    const panelist = panel[i]
    if (panelist === undefined || panelist.role !== 'voter') continue
    const voterFamily = familyOf(panelist.provider as ProviderId)
    if (buildFamilies.includes(voterFamily)) {
      const buildAgent = buildAgents.find((d) => familyOf(d.provider as ProviderId) === voterFamily)
      conflicts.push({
        file: '.code-oz/config.yaml',
        code: 'panel_voter_same_family_as_build',
        rule:
          'company.reviewer.panel voter family must differ from the resolved BUILD family ' +
          '(M14 panel quorum + CLAUDE.md non-negotiable rule 2; loader layer 2 — ' +
          'config-load layer 1 is best-effort and may miss this when company.builder.provider is unset). ' +
          'Same-family advisory entries are allowed (no gate authority); same-family voters are not.',
        detail:
          `panel[${i}] provider='${panelist.provider}' family='${voterFamily}' matches build family ` +
          `'${voterFamily}' (build agent='${buildAgent?.name ?? '?'}', provider='${buildAgent?.provider ?? '?'}').`,
      })
    }
  }
  if (conflicts.length > 0) {
    throw new AgentLoadError(conflicts)
  }
}

function enforceCrossFamilyReview(definitions: readonly AgentDefinition[]): void {
  const buildAgents = definitions.filter((d) => d.phase === 'build')
  const reviewAgents = definitions.filter((d) => d.phase === 'review')
  if (buildAgents.length === 0 || reviewAgents.length === 0) return

  // Compare provider FAMILIES, not literal provider ids (Codex M9 substrate
  // catch, CODEX_RESPONSE_M9.md decision 5). A misconfigured adapter could
  // otherwise present a 'codex'-declared reviewer that's operationally the
  // same family as BUILD; the shared familyOf() lookup in
  // src/providers/families.ts is the single source of truth that runtime
  // ProviderRegistry.familyOf() also seeds from.
  const conflicts: AgentLoadIssue[] = []
  for (const review of reviewAgents) {
    const reviewFamily = familyOf(review.provider as ProviderId)
    for (const build of buildAgents) {
      const buildFamily = familyOf(build.provider as ProviderId)
      if (reviewFamily === buildFamily) {
        conflicts.push({
          file: review.file,
          code: 'loader_cross_family_violation',
          rule: 'REVIEW agent provider family must differ from BUILD agent provider family (CLAUDE.md non-negotiable rule 2)',
          detail: `'${review.name}' (review, provider=${review.provider}, family=${reviewFamily}) shares family with '${build.name}' (build, provider=${build.provider}, family=${buildFamily})`,
        })
      }
    }
  }
  if (conflicts.length > 0) {
    throw new AgentLoadError(conflicts)
  }
}

async function wrapIO<T>(
  op: () => Promise<T>,
  file: string,
  rule: string,
): Promise<T> {
  try {
    return await op()
  } catch (err: unknown) {
    throw new AgentLoadError([
      {
        file,
        code: 'loader_io_error',
        rule,
        detail: err instanceof Error ? err.message : String(err),
      },
    ])
  }
}

async function readProjectLocalSources(
  projectDir: string,
  cwd: string,
): Promise<readonly SourceFile[]> {
  let dirStats
  try {
    dirStats = await stat(projectDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw new AgentLoadError([
      {
        file: relative(cwd, projectDir),
        code: 'loader_io_error',
        rule: 'project agents directory could not be accessed',
        detail: err instanceof Error ? err.message : String(err),
      },
    ])
  }
  if (!dirStats.isDirectory()) {
    throw new AgentLoadError([
      {
        file: relative(cwd, projectDir),
        code: 'loader_io_error',
        rule: 'project agents path is not a directory',
      },
    ])
  }

  const entries = await wrapIO(
    () => readdir(projectDir, { withFileTypes: true }),
    relative(cwd, projectDir),
    'failed to enumerate the project agents directory',
  )
  const names = entries
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))

  const sources: SourceFile[] = []
  for (const name of names) {
    const full = join(projectDir, name)
    const fileRel = relative(cwd, full)
    const linkStat = await wrapIO(
      () => lstat(full),
      fileRel,
      'failed to stat agent file',
    )
    if (linkStat.isSymbolicLink()) {
      const target = await wrapIO(
        () => realpath(full),
        fileRel,
        'failed to resolve symlink target',
      )
      const targetRel = relative(projectDir, target)
      if (targetRel.startsWith('..') || isAbsolute(targetRel)) {
        throw new AgentLoadError([
          {
            file: fileRel,
            code: 'loader_invalid_symlink',
            rule: 'symlinks in agents/ must not escape the agents directory',
            detail: `target=${target}`,
          },
        ])
      }
    }
    const content = await wrapIO(
      () => readFile(full, 'utf8'),
      fileRel,
      'failed to read agent file content',
    )
    sources.push({ file: fileRel, content })
  }
  return sources
}

export async function loadRegistry(opts: LoadRegistryOptions): Promise<AgentRegistry> {
  const cwd = opts.cwd ?? process.cwd()
  const overrides = opts.projectDir
    ? await readProjectLocalSources(opts.projectDir, cwd)
    : []
  return buildRegistry({
    defaults: opts.defaults,
    overrides,
    ...(opts.company !== undefined ? { company: opts.company } : {}),
  })
}
