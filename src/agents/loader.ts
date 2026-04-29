import { readFile, readdir, stat, lstat, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import { validateAgent, type AgentDefinition, type AgentPhase } from './schema.ts'
import { AgentLoadError } from './errors.ts'

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

  return makeRegistry(Array.from(map.values()))
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

  const entries = await readdir(projectDir, { withFileTypes: true })
  const names = entries
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))

  const sources: SourceFile[] = []
  for (const name of names) {
    const full = join(projectDir, name)
    const linkStat = await lstat(full)
    if (linkStat.isSymbolicLink()) {
      const target = await realpath(full)
      const targetRel = relative(projectDir, target)
      if (targetRel.startsWith('..') || isAbsolute(targetRel)) {
        throw new AgentLoadError([
          {
            file: relative(cwd, full),
            code: 'loader_invalid_symlink',
            rule: 'symlinks in agents/ must not escape the agents directory',
            detail: `target=${target}`,
          },
        ])
      }
    }
    const content = await readFile(full, 'utf8')
    sources.push({ file: relative(cwd, full), content })
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
