import { mkdir, writeFile, access, readdir } from 'node:fs/promises'
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
]

const BROWNFIELD_SOURCE_DIRS = ['src', 'app', 'lib', 'pkg', 'cmd']

export async function detectProfile(cwd: string): Promise<Profile> {
  for (const f of BROWNFIELD_LOCKFILES) {
    if (await pathExists(join(cwd, f))) return 'brownfield'
  }
  for (const dir of BROWNFIELD_SOURCE_DIRS) {
    const dirPath = join(cwd, dir)
    if (!(await pathExists(dirPath))) continue
    const entries = await readdir(dirPath).catch(() => [] as string[])
    if (entries.length > 0) return 'brownfield'
  }
  return 'greenfield'
}

export async function initProject(opts: InitOptions = {}): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd()
  const p = paths(cwd)

  if (await pathExists(p.root)) {
    if (!opts.force) {
      throw new Error(
        `${p.root} already exists. Pass --force to overwrite (this is destructive).`,
      )
    }
  }

  const profile = await detectProfile(cwd)

  await mkdir(p.root, { recursive: true })
  await mkdir(p.agents, { recursive: true })
  await mkdir(p.artifacts, { recursive: true })
  await mkdir(p.state, { recursive: true })
  await mkdir(p.runs, { recursive: true })

  const config = { ...DEFAULT_CONFIG, profile }
  await writeFile(p.config, stringify(config), 'utf8')

  const readme = renderProjectReadme(profile)
  await writeFile(join(p.root, 'README.md'), readme, 'utf8')

  return { paths: p, profile }
}

function renderProjectReadme(profile: Profile): string {
  return `# .code-oz

This directory was scaffolded by \`code-oz init\`.

- **Profile:** \`${profile}\` (auto-detected at init time; edit \`config.yaml\` to override)
- **agents/** — agent and skill Markdown files (frontmatter + system prompt)
- **artifacts/** — phase outputs (\`SPEC.md\`, \`PLAN.md\`, \`SOURCE_CHECK.md\`, etc.)
- **state/** — run state machine, event log (\`events.jsonl\`), gate signals (\`GATE_*_PASSED.json\`)
- **runs/** — per-run worktrees (gitignored)
- **config.yaml** — provider, model, and budget configuration

This directory should be committed to your project repo so the team shares the same agent definitions and gate history. The \`runs/\` and \`state/events.jsonl\` paths are gitignored by default.

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
  --force      Overwrite an existing .code-oz/ directory (destructive)
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
