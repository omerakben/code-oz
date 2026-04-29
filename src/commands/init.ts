import { mkdir, writeFile, access, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { stringify } from 'yaml'
import { paths, type CodeOzPaths } from '../paths.ts'
import { DEFAULT_CONFIG, type Profile } from '../config/schema.ts'

export interface InitOptions {
  cwd?: string
  force?: boolean
}

export interface InitResult {
  paths: CodeOzPaths
  profile: Profile
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const BROWNFIELD_LOCKFILES = [
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'mix.exs',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'build.sbt',
  'stack.yaml',
  'cabal.project',
  'project.clj',
]

const BROWNFIELD_MARKER_FILES = [
  'Makefile',
  'GNUmakefile',
  'deno.json',
  'deno.jsonc',
  'Package.swift',
  'Package.resolved',
  'pubspec.yaml',
  'pubspec.lock',
  'flake.nix',
  'shell.nix',
  'default.nix',
  'elm.json',
  'CMakeLists.txt',
  'meson.build',
  'BUILD.bazel',
  'BUILD',
  'WORKSPACE',
]

const BROWNFIELD_MARKER_EXTENSIONS = ['.sln', '.csproj', '.fsproj', '.vbproj', '.xcodeproj', '.xcworkspace']

const BROWNFIELD_SOURCE_DIRS = ['src', 'app', 'lib', 'pkg', 'cmd', 'tests', 'test', 'spec']

async function gitTracksFiles(cwd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, 'ls-files'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return text.trim().length > 0
  } catch {
    return false
  }
}

export async function detectProfile(cwd: string): Promise<Profile> {
  if (await gitTracksFiles(cwd)) return 'brownfield'

  for (const f of BROWNFIELD_LOCKFILES) {
    if (await pathExists(join(cwd, f))) return 'brownfield'
  }

  const entries = await readdir(cwd).catch(() => [] as string[])
  for (const e of entries) {
    if (BROWNFIELD_MARKER_FILES.includes(e)) return 'brownfield'
    if (BROWNFIELD_MARKER_EXTENSIONS.some((ext) => e.endsWith(ext))) return 'brownfield'
  }

  for (const dir of BROWNFIELD_SOURCE_DIRS) {
    const dirPath = join(cwd, dir)
    if (!(await pathExists(dirPath))) continue
    const dirEntries = await readdir(dirPath).catch(() => [] as string[])
    if (dirEntries.length > 0) return 'brownfield'
  }

  return 'greenfield'
}

export async function initProject(opts: InitOptions = {}): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd()
  const p = paths(cwd)

  if (await pathExists(p.root)) {
    if (!opts.force) {
      throw new Error(
        `${p.root} already exists. Pass --force to overwrite (this is destructive — the entire .code-oz/ directory will be removed and recreated).`,
      )
    }
    await rm(p.root, { recursive: true, force: true })
  }

  const profile = await detectProfile(cwd)

  await mkdir(p.root, { recursive: true })
  await mkdir(p.agents, { recursive: true })
  await mkdir(p.artifacts, { recursive: true })
  await mkdir(p.state, { recursive: true })
  await mkdir(p.runs, { recursive: true })

  const config = { ...DEFAULT_CONFIG, profile }
  await writeFile(p.config, stringify(config), 'utf8')
  await writeFile(join(p.root, '.gitignore'), renderScaffoldGitignore(), 'utf8')
  await writeFile(join(p.root, 'README.md'), renderProjectReadme(profile), 'utf8')

  return { paths: p, profile }
}

function renderScaffoldGitignore(): string {
  return `# code-oz runtime artifacts. Per-run state and worktrees are gitignored by
# default; sharing a run is an explicit bundle/export step (W4+).
runs/
state/active.json
state/runs/

# Tooling and editor scratch
*.tmp
*.bak
.DS_Store
`
}

function renderProjectReadme(profile: Profile): string {
  return `# .code-oz

This directory was scaffolded by \`code-oz init\`.

- **Profile:** \`${profile}\` (auto-detected at init time; edit \`config.yaml\` to override)
- **agents/** — agent and skill Markdown files (frontmatter + system prompt)
- **artifacts/** — phase outputs (\`SPEC.md\`, \`PLAN.md\`, \`SOURCE_CHECK.md\`, etc.)
- **state/** — top-level state directory. The active-run pointer lives at \`state/active.json\`; per-run state (events, gate files, current.json) lives at \`state/runs/<runId>/\`.
- **runs/** — per-run worktrees (M7+). Distinct from \`state/runs/\`.
- **config.yaml** — provider, model, and budget configuration
- **.gitignore** — runtime artifact paths excluded from version control

Commit \`config.yaml\`, \`agents/\`, and the contents of \`artifacts/\` so the team shares agent definitions and phase outputs. The bundled \`.gitignore\` excludes \`state/active.json\`, \`state/runs/\`, and \`runs/\` — runs are local by default; sharing a run is an explicit bundle/export step (W4+).

See https://github.com/omerakben/code-oz for the full milestone plan.
`
}

export async function initCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  })

  if (values.help) {
    process.stdout.write(`code-oz init — scaffold a code-oz project in the current directory

Usage: code-oz init [--force]

Options:
  --force      Destructively reset an existing .code-oz/ directory: the entire
               directory is removed and recreated from scratch
  -h, --help   Show this help
`)
    return
  }

  const { paths: p, profile } = await initProject({ force: values.force })
  process.stdout.write(
    `code-oz: initialized ${profile} project at ${resolve(p.root)}\n` +
      `code-oz: profile = ${profile} (auto-detected from working directory)\n` +
      `code-oz: next: review ${p.config} and adjust models/budgets\n`,
  )
}
