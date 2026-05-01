import { readFile, readdir, stat, lstat, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import { validateAgent, type AgentDefinition, type AgentPhase } from './schema.ts'
import { AgentLoadError, type AgentLoadIssue } from './errors.ts'
import { capabilityOf } from '../providers/capabilities.ts'
import { familyOf } from '../providers/families.ts'
import type { ProviderId } from '../providers/types.ts'

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
}

export interface LoadRegistryOptions {
  readonly defaults: readonly SourceFile[]
  readonly projectDir?: string
  readonly cwd?: string
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

  const definitions = Array.from(map.values())
  enforceCrossFamilyReview(definitions)
  enforceProviderPhaseEligibility(definitions)

  return makeRegistry(definitions)
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
  return buildRegistry({ defaults: opts.defaults, overrides })
}
