#!/usr/bin/env bun
// scripts/demo/01-todo-cli/run-demo.ts
//
// Drives `code-oz` through one full DEFINE → PLAN → BUILD → VERIFY → REVIEW
// → SHIP cycle for the todo CLI example defined in
// docs/demo/01-todo-cli/SPEC.md. Uses FakeProvider with custom canned
// responses authored for the todo CLI.
//
// Output: docs/demo/01-todo-cli/output/<effort>/{events.jsonl, gates/, artifacts/}.
//
// Designed for asciinema recording — each step prints a clear progress
// header before invoking the CLI binary.
//
// Flags:
//   --effort <lite|balanced|max|beast>   default: balanced (no flag passed)
//   --keep-tmp                            default: true (leave tmp dir)
//   --rm-tmp                              clean up tmp dir on success

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { initProject } from '../../../src/commands/init.ts'

// ---------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')
const SPEC_SOURCE = join(REPO_ROOT, 'docs/demo/01-todo-cli/SPEC.md')
const OUTPUT_BASE = join(REPO_ROOT, 'docs/demo/01-todo-cli/output')

// ---------------------------------------------------------------------
// canned content for the todo CLI demo
// ---------------------------------------------------------------------

const TODO_TS = `#!/usr/bin/env bun
// Tiny todo CLI: add | list | done. Persists to ./todos.json with atomic writes.
import { existsSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

interface Todo { id: number; text: string; done: boolean }
interface Store { todos: Todo[] }

const FILE = './todos.json'

async function load(): Promise<Store> {
  if (!existsSync(FILE)) return { todos: [] }
  return JSON.parse(await readFile(FILE, 'utf8'))
}

async function save(store: Store): Promise<void> {
  const tmp = \`\${FILE}.tmp-\${randomBytes(4).toString('hex')}\`
  await writeFile(tmp, JSON.stringify(store, null, 2) + '\\n', 'utf8')
  await rename(tmp, FILE)
}

function nextId(store: Store): number {
  return Math.max(0, ...store.todos.map((t) => t.id)) + 1
}

async function add(text: string): Promise<void> {
  if (text.length === 0) { process.stderr.write('error: text required\\n'); process.exit(1) }
  const store = await load()
  store.todos.push({ id: nextId(store), text, done: false })
  await save(store)
}

async function list(): Promise<void> {
  const store = await load()
  for (const t of store.todos.sort((a, b) => a.id - b.id)) {
    console.log(\`\${t.id}. [\${t.done ? 'x' : ' '}] \${t.text}\`)
  }
}

async function done(idStr: string): Promise<void> {
  const id = parseInt(idStr, 10)
  const store = await load()
  const t = store.todos.find((t) => t.id === id)
  if (!t) { process.stderr.write(\`error: id \${id} not found\\n\`); process.exit(1) }
  t.done = true
  await save(store)
}

const [cmd, ...rest] = process.argv.slice(2)
const arg = rest.join(' ')
if (cmd === 'add') await add(arg)
else if (cmd === 'list') await list()
else if (cmd === 'done') await done(arg)
else { process.stderr.write('usage: todo <add|list|done> [arg]\\n'); process.exit(1) }
`

const TODO_TEST_TS = `import { test, expect, beforeEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const FILE = './todos.json'
function run(...args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('bun', ['run', 'src/todo.ts', ...args], { encoding: 'utf8' })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 }
}

beforeEach(() => {
  if (existsSync(FILE)) rmSync(FILE)
})

test('add creates todos.json with the first entry', () => {
  const r = run('add', 'Write the demo')
  expect(r.code).toBe(0)
  const store = JSON.parse(readFileSync(FILE, 'utf8'))
  expect(store.todos).toEqual([{ id: 1, text: 'Write the demo', done: false }])
})

test('list prints all todos in id order', () => {
  run('add', 'First')
  run('add', 'Second')
  const r = run('list')
  expect(r.stdout).toBe('1. [ ] First\\n2. [ ] Second\\n')
})

test('done flips the done flag', () => {
  run('add', 'X')
  const r = run('done', '1')
  expect(r.code).toBe(0)
  const store = JSON.parse(readFileSync(FILE, 'utf8'))
  expect(store.todos[0].done).toBe(true)
})

test('done with missing id exits non-zero', () => {
  const r = run('done', '99')
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('not found')
  expect(existsSync(FILE)).toBe(false)
})

test('add with empty text exits non-zero', () => {
  const r = run('add', '')
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('required')
  expect(existsSync(FILE)).toBe(false)
})
`

function newFileDiff(path: string, content: string): string {
  const lines = content.split('\n')
  // If content ends with newline, last element is empty — drop it from line count
  const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  const body = lines
    .filter((_, i) => !(i === lines.length - 1 && lines[lines.length - 1] === ''))
    .map((l) => `+${l}`)
    .join('\n')
  return `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,${lineCount} @@
${body}`
}

const BA_REPLY = await readFile(SPEC_SOURCE, 'utf8').then((spec) => `<spec-ready/>\n${spec}`)

const PLAN_REPLY = `<plan-ready/>
# PLAN

## Goals

- Implement the todo CLI per SPEC.md acceptance criteria.

## Tasks

### T-001: Implement todo CLI add/list/done with atomic file persistence

- Files: src/todo.ts, tests/todo.test.ts
- Validation: test -f src/todo.ts
- Risk: file corruption on concurrent writes (mitigated by atomic temp+rename).
- Hypotheses: H-001
- Sources: SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001

## Sources

- SPEC.md acceptance criteria 1-6.

## Out of scope

- Delete subcommand; editing existing task text; interactive REPL; multi-list support.

## Open questions

- None known at plan time.

# SOURCE_CHECK

## Spec sources

### SC-SPEC-001: todo CLI feature surface

- Spec: SPEC.md ## Acceptance criteria, bullets 1-6
- Quote: bun run src/todo.ts add "Write the demo" writes todos.json with one entry whose id is 1.

## Reference sources

### SC-REF-NONE-001: No reference patterns required

- Searched: src/**/*.ts
- Result: 0 hits
- Why explicit: greenfield project; no prior file persistence patterns to reuse.

## Docs sources

### SC-DOC-NONE-001: No external library

- Why explicit: Bun built-ins only (node:fs/promises, node:crypto); no third-party APIs.

## Coverage

- T-001 -> SC-SPEC-001, SC-REF-NONE-001, SC-DOC-NONE-001
`

const BUILDER_REPLY = `<build-ready/>

\`\`\`diff
${newFileDiff('src/todo.ts', TODO_TS)}
${newFileDiff('tests/todo.test.ts', TODO_TEST_TS)}
\`\`\`

## Title
Implement todo CLI add/list/done with atomic file persistence

## Notes
- Atomic write via temp + rename mitigates the file-corruption risk noted in PLAN.md T-001.
`

const VERIFIER_REPLY = `<verify-ready/>

## Rationale
validation command \`test -f src/todo.ts\` exited 0; mutation gate passed (reverted code fails the file check).
`

const REVIEWER_REPLY = `<review-ready/>

## Findings

- None.

## Score

- Final score: 8
`

function scientistReply(phase: 'plan' | 'build' | 'verify' | 'review'): string {
  return `<scientist-ready/>
# HYPOTHESES

## H-001: todo CLI persistence is atomic under crash

- Phase: ${phase}
- Status: open
- Falsifier: A crash mid-write leaves a corrupt todos.json that subsequent invocations cannot parse.
- Evidence: SPEC.md AC-1 + AC-2 + AC-3 (load/parse/write round-trip).
- Risk if false: data loss on power failure during write.

# OPEN QUESTIONS

## Q-001: Should ids be reusable after a future delete subcommand?

- Phase: ${phase}
- Status: open
- Importance: low
- DueBy: 2026-12-31
- Context: SPEC.md non-goal explicitly excludes delete; reservation policy carries forward.
- Resolution attempts: none yet.
`
}

// ---------------------------------------------------------------------
// fake-script writing
// ---------------------------------------------------------------------

interface FakeEntry {
  matcher: { phase?: string; agent?: string }
  response: { content: string }
}

async function writeFakeScript(path: string, entries: readonly FakeEntry[]): Promise<void> {
  const lines = entries.map((e) => JSON.stringify(e))
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
}

// ---------------------------------------------------------------------
// project setup
// ---------------------------------------------------------------------

interface DemoProject {
  tmpRoot: string
  projectRoot: string
  stateDir: string
  artifactsDir: string
  scriptDir: string
}

async function setupProject(): Promise<DemoProject> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-demo-todo-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), '# todo CLI demo\n', 'utf8')

  // initProject scaffolds .code-oz/
  await initProject({ cwd: projectRoot, force: false })

  // Bump per-phase budgets so default caps don't trip on a deliberate cycle
  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const cfg = parseYaml(await readFile(configPath, 'utf8')) as Record<string, unknown>
  const budgets = (cfg.budgets ??= {}) as Record<string, unknown>
  budgets.perPhase = {
    define: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    plan: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    build: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    verify: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    review: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    ship: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
    audit: { maxTurns: 60, maxProviderCalls: 60, maxTokensEstimate: 1_000_000 },
  }
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  // git init so the worktree wrapper has a base commit
  const git = async (args: string[]) => {
    const r = Bun.spawn(['git', ...args], { cwd: projectRoot, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    await r.exited
    if (r.exitCode !== 0) {
      const stderr = await new Response(r.stderr).text()
      throw new Error(`git ${args.join(' ')} failed: ${stderr}`)
    }
  }
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'demo@example.com'])
  await git(['config', 'user.name', 'demo'])
  await git(['config', 'commit.gpgsign', 'false'])
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'init todo CLI demo project'])

  const scriptDir = join(tmpRoot, 'scripts')
  await mkdir(scriptDir, { recursive: true })

  return {
    tmpRoot,
    projectRoot,
    stateDir: join(projectRoot, '.code-oz', 'state'),
    artifactsDir: join(projectRoot, '.code-oz', 'artifacts'),
    scriptDir,
  }
}

// ---------------------------------------------------------------------
// CLI spawn
// ---------------------------------------------------------------------

interface CliResult { exitCode: number; stdout: string; stderr: string }

async function runCli(project: DemoProject, args: readonly string[]): Promise<CliResult> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
    cwd: project.projectRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
  })
  await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode: proc.exitCode ?? -1, stdout, stderr }
}

// ---------------------------------------------------------------------
// progress UI
// ---------------------------------------------------------------------

const ANSI = {
  bold: '\x1b[1m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  off: '\x1b[0m',
}

function header(s: string): void {
  console.log()
  console.log(`${ANSI.bold}${ANSI.blue}━━━ ${s} ━━━${ANSI.off}`)
}

function step(s: string): void {
  console.log(`${ANSI.green}→${ANSI.off} ${s}`)
}

function ok(s: string): void {
  console.log(`${ANSI.green}✓${ANSI.off} ${s}`)
}

function fail(s: string): void {
  console.log(`${ANSI.red}✗${ANSI.off} ${s}`)
}

// ---------------------------------------------------------------------
// phase orchestration
// ---------------------------------------------------------------------

let scriptCounter = 0
async function dispatch(
  project: DemoProject,
  label: string,
  script: readonly FakeEntry[],
  args: readonly string[],
  skipFakeProvider = false,
): Promise<CliResult> {
  scriptCounter += 1
  const filename = `${String(scriptCounter).padStart(2, '0')}-${label}.jsonl`
  const scriptPath = join(project.scriptDir, filename)
  await writeFakeScript(scriptPath, script)

  const finalArgs = skipFakeProvider
    ? args
    : [...args, '--provider', 'fake', '--fake-script', scriptPath]

  step(`code-oz ${finalArgs.join(' ')}`)
  const result = await runCli(project, finalArgs)
  if (result.exitCode !== 0) {
    fail(`${label} exited ${result.exitCode}`)
    console.log(`stdout:\n${result.stdout}`)
    console.log(`stderr:\n${result.stderr}`)
    throw new Error(`dispatch ${label}: exit ${result.exitCode}`)
  }
  ok(`${label}`)
  return result
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

interface CliArgs { effort?: string; keepTmp: boolean }

function parseArgs(argv: string[]): CliArgs {
  let effort: string | undefined
  let keepTmp = true
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--effort') { effort = argv[i + 1]; i += 1 }
    else if (a === '--keep-tmp') keepTmp = true
    else if (a === '--rm-tmp') keepTmp = false
  }
  return { effort, keepTmp }
}

async function copyOutputs(project: DemoProject, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  // events.jsonl + gates from the active run
  const runs = await readdir(join(project.stateDir, 'runs')).catch(() => [] as string[])
  if (runs.length !== 1) {
    throw new Error(`expected exactly 1 run dir, got ${runs.length}`)
  }
  const runDir = join(project.stateDir, 'runs', runs[0]!)
  await cp(join(runDir, 'events.jsonl'), join(outputDir, 'events.jsonl'))

  const gatesDir = join(outputDir, 'gates')
  await mkdir(gatesDir, { recursive: true })
  const runFiles = await readdir(runDir)
  for (const f of runFiles) {
    if (f.startsWith('GATE_') && f.endsWith('.json')) {
      await cp(join(runDir, f), join(gatesDir, f))
    }
  }

  // artifacts dir (SPEC, PLAN, SOURCE_CHECK, HYPOTHESES, OPEN_QUESTIONS, etc.)
  const artifactsOut = join(outputDir, 'artifacts')
  await cp(project.artifactsDir, artifactsOut, { recursive: true })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const effortLabel = args.effort ?? 'balanced'

  header(`code-oz demo — todo CLI greenfield cycle (effort: ${effortLabel})`)
  step(`SPEC source: docs/demo/01-todo-cli/SPEC.md`)
  step(`CLI:         bun run src/cli.ts (from ${REPO_ROOT})`)

  const project = await setupProject()
  step(`tmp project: ${project.projectRoot}`)

  const effortFlag = args.effort ? ['--effort', args.effort] : []
  const intent = 'Build a tiny todo CLI with add, list, and done subcommands.'

  // ===== DEFINE =====
  header('DEFINE — BA elicits intent, emits <spec-ready/> + SPEC.md')
  await dispatch(project, 'define', [
    { matcher: { phase: 'define', agent: 'ba' }, response: { content: BA_REPLY } },
  ], ['run', '--request', intent, ...effortFlag])
  await dispatch(project, 'approve-define', [], ['approve', 'define'], true)

  // ===== PLAN =====
  header('PLAN — Lead writes PLAN.md + SOURCE_CHECK.md; scientist emits HYPOTHESES + OPEN_QUESTIONS')
  await dispatch(project, 'plan', [
    { matcher: { phase: 'plan', agent: 'lead' }, response: { content: PLAN_REPLY } },
    { matcher: { phase: 'plan', agent: 'scientist' }, response: { content: scientistReply('plan') } },
  ], ['run'])
  await dispatch(project, 'approve-plan', [], ['approve', 'plan'], true)

  // ===== BUILD T-001 =====
  header('BUILD — Builder emits new-file diffs for src/todo.ts + tests/todo.test.ts')
  await dispatch(project, 'build', [
    { matcher: { phase: 'build', agent: 'builder' }, response: { content: BUILDER_REPLY } },
    { matcher: { phase: 'build', agent: 'scientist' }, response: { content: scientistReply('build') } },
  ], ['run'])
  await dispatch(project, 'approve-build', [], ['approve', 'build'], true)

  // ===== VERIFY =====
  header('VERIFY — runs validation command, mutation gate revert+replay, verifier emits ready + rationale')
  await dispatch(project, 'verify', [
    { matcher: { phase: 'verify', agent: 'verifier' }, response: { content: VERIFIER_REPLY } },
    { matcher: { phase: 'verify', agent: 'scientist' }, response: { content: scientistReply('verify') } },
  ], ['run'])
  await dispatch(project, 'approve-verify', [], ['approve', 'verify'], true)

  // ===== REVIEW =====
  header('REVIEW — Reviewer emits ready + score 8 → no needs-revision restart')
  await dispatch(project, 'review', [
    { matcher: { phase: 'review', agent: 'reviewer' }, response: { content: REVIEWER_REPLY } },
    { matcher: { phase: 'review', agent: 'scientist' }, response: { content: scientistReply('review') } },
  ], ['run'])
  await dispatch(project, 'approve-review', [], ['approve', 'review'], true)

  // ===== Output capture =====
  header('Capturing artifacts')
  const outputDir = join(OUTPUT_BASE, effortLabel)
  await rm(outputDir, { recursive: true, force: true })
  await copyOutputs(project, outputDir)
  ok(`copied to ${outputDir}`)

  // ===== Summary =====
  header('Summary')
  console.log(`tmp project: ${project.projectRoot}`)
  console.log(`output:      ${outputDir}`)
  console.log()
  console.log(`Inspect:`)
  console.log(`  tail -20 ${join(outputDir, 'events.jsonl')} | jq -c`)
  console.log(`  ls ${join(outputDir, 'gates')}`)
  console.log(`  cat ${join(outputDir, 'artifacts', 'SPEC.md')}`)

  if (!args.keepTmp) {
    await rm(project.tmpRoot, { recursive: true, force: true })
    step(`tmp dir removed`)
  } else {
    step(`tmp dir preserved (--rm-tmp to clean up)`)
  }
}

await main()
