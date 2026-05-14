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

// v0.20.3 #2 — INTENT.md is the explicit greenfield-seed marker. A directory
// whose only contentful files are INTENT.md (plus neutral git metadata) is
// greenfield by design, regardless of tracked vs untracked status. Caught
// from the v0.20.2 quizr greenfield-friend dogfood (2026-05-14): a fresh
// `git init` + write INTENT.md was misclassifying as brownfield because
// the untracked-files scan picked up INTENT.md and treated it like
// ordinary source content.
const GREENFIELD_SEED_FILES = ['INTENT.md']
const NEUTRAL_METADATA_ENTRIES = new Set([
  '.git',
  '.code-oz',
  '.gitignore',
  '.gitattributes',
])

async function listGitTrackedPaths(cwd: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, 'ls-files'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('.code-oz/'))
  } catch {
    return []
  }
}

async function isOnlyGreenfieldSeed(cwd: string): Promise<boolean> {
  // 1. Walk top-level entries. Anything outside {seed, neutral metadata}
  //    disqualifies — a real brownfield project has source files or
  //    lockfiles at root that would show up here.
  const entries = await readdir(cwd).catch(() => [] as string[])
  for (const e of entries) {
    if (GREENFIELD_SEED_FILES.includes(e)) continue
    if (NEUTRAL_METADATA_ENTRIES.has(e)) continue
    return false
  }
  // 2. If the directory is a git repo, also confirm git tracks nothing
  //    outside the seed list. A user could have committed INTENT.md
  //    (`git add INTENT.md && git commit`) and the dirent walk still
  //    looks seed-only — but tracked content elsewhere in the tree
  //    would disqualify. Filtering on the basename matches the
  //    top-level seed pattern (nested INTENT.md is not a seed).
  if (!(await pathExists(join(cwd, '.git')))) return true
  const tracked = await listGitTrackedPaths(cwd)
  for (const f of tracked) {
    if (GREENFIELD_SEED_FILES.includes(f)) continue
    return false
  }
  return true
}

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

// Phase 1.6 prerequisite (1000-star plan, R0-revision-3 closure #3).
// Why: a git-initialized repo with untracked source files (typical of
// "I just dropped this code into a fresh git init and ran code-oz")
// was misclassified as greenfield by the prior heuristic when the
// file extension fell outside the BROWNFIELD_MARKER_EXTENSIONS set.
// `git ls-files --others --exclude-standard` lists untracked files
// while honoring .gitignore, so explicitly ignored files don't
// trigger brownfield (preserves the empty-git-init greenfield case).
// .code-oz/ entries are filtered defensively in case detection runs
// after initialization.
async function gitHasContentfulUntrackedFiles(cwd: string): Promise<boolean> {
  if (!(await pathExists(join(cwd, '.git')))) return false
  try {
    const proc = Bun.spawn(
      ['git', '-C', cwd, 'ls-files', '--others', '--exclude-standard'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const text = await new Response(proc.stdout).text()
    await proc.exited
    const untracked = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('.code-oz/'))
    return untracked.length > 0
  } catch {
    return false
  }
}

export async function detectProfile(cwd: string): Promise<Profile> {
  // Greenfield-seed early exit (v0.20.3 #2): INTENT.md is the explicit
  // seed marker. A directory whose only contentful files are INTENT.md
  // (plus neutral git metadata like .gitignore) is greenfield by design,
  // regardless of whether INTENT.md is tracked or untracked.
  if (await isOnlyGreenfieldSeed(cwd)) return 'greenfield'

  if (await gitTracksFiles(cwd)) return 'brownfield'
  if (await gitHasContentfulUntrackedFiles(cwd)) return 'brownfield'

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

## Getting started

\`\`\`bash
code-oz run --request "build me X"     # starts the DEFINE phase
# review .code-oz/artifacts/SPEC.md
code-oz approve define                 # advances to PLAN (stub in v0.1)
\`\`\`

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
