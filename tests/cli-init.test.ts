import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { initProject, detectProfile } from '../src/commands/init.ts'

describe('code-oz init', () => {
  let tempDir: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'code-oz-test-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('scaffolds the .code-oz directory tree', async () => {
    const cwd = tempDir!
    const { paths } = await initProject({ cwd })

    expect((await stat(paths.root)).isDirectory()).toBe(true)
    expect((await stat(paths.agents)).isDirectory()).toBe(true)
    expect((await stat(paths.artifacts)).isDirectory()).toBe(true)
    expect((await stat(paths.state)).isDirectory()).toBe(true)
    expect((await stat(paths.runs)).isDirectory()).toBe(true)
  })

  test('writes a project README inside .code-oz/', async () => {
    const { paths } = await initProject({ cwd: tempDir! })
    const readme = await readFile(join(paths.root, 'README.md'), 'utf8')
    expect(readme).toContain('This directory was scaffolded by')
    expect(readme).toContain('agents/')
    expect(readme).toContain('artifacts/')
  })

  test('writes .code-oz/.gitignore covering runtime paths', async () => {
    const { paths } = await initProject({ cwd: tempDir! })
    const gi = await readFile(join(paths.root, '.gitignore'), 'utf8')
    // Per the M3 spec amendment: runs are local by default; sharing is an
    // explicit bundle/export. Per-run state lives under state/runs/<runId>/.
    expect(gi).toContain('runs/')
    expect(gi).toContain('state/runs/')
    expect(gi).toContain('state/active.json')
  })

  test('writes a valid config.yaml with expected defaults', async () => {
    const { paths } = await initProject({ cwd: tempDir! })
    const raw = await readFile(paths.config, 'utf8')
    const config = parseYaml(raw)

    expect(config.version).toBe('0.20.0-alpha.0')
    expect(config.defaultProvider).toBe('claude')
    expect(config.models.primary).toBe('claude-opus-4-7')
    expect(config.permissions.allowEscapeHatch).toBe(false)
  })

  test('config.yaml includes global and per-phase budgets with maxTokensEstimate', async () => {
    const { paths } = await initProject({ cwd: tempDir! })
    const config = parseYaml(await readFile(paths.config, 'utf8'))

    expect(config.budgets.global.maxTurns).toBeGreaterThan(0)
    expect(config.budgets.global.maxProviderCalls).toBeGreaterThan(0)
    expect(config.budgets.global.maxTokensEstimate).toBeGreaterThan(0)
    expect(config.budgets.global.maxReviewRounds).toBe(4)
    expect(config.budgets.global.maxToolCallsPerTurn).toBeGreaterThan(0)
    expect(config.budgets.global.toolCallBudgetMultiplier).toBeGreaterThan(0)

    for (const phase of ['define', 'plan', 'build', 'verify', 'review', 'ship', 'audit']) {
      expect(config.budgets.perPhase[phase]).toBeDefined()
      expect(config.budgets.perPhase[phase].maxTurns).toBeGreaterThan(0)
      expect(config.budgets.perPhase[phase].maxProviderCalls).toBeGreaterThan(0)
      expect(config.budgets.perPhase[phase].maxTokensEstimate).toBeGreaterThan(0)
    }
  })

  test('detects greenfield in an empty directory', async () => {
    expect(await detectProfile(tempDir!)).toBe('greenfield')
  })

  test('treats empty git-init directory as greenfield', async () => {
    const proc = Bun.spawn(['git', '-C', tempDir!, 'init', '-q'])
    await proc.exited
    expect(await detectProfile(tempDir!)).toBe('greenfield')
  })

  test('detects brownfield via git tracking files', async () => {
    const cwd = tempDir!
    await Bun.spawn(['git', '-C', cwd, 'init', '-q']).exited
    await writeFile(join(cwd, 'README.md'), '# x\n', 'utf8')
    await Bun.spawn(['git', '-C', cwd, 'add', 'README.md']).exited
    expect(await detectProfile(cwd)).toBe('brownfield')
  })

  test('detects brownfield via package.json', async () => {
    await writeFile(join(tempDir!, 'package.json'), '{"name":"existing"}', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via Cargo.toml', async () => {
    await writeFile(join(tempDir!, 'Cargo.toml'), '[package]\nname="x"\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via pyproject.toml', async () => {
    await writeFile(join(tempDir!, 'pyproject.toml'), '[project]\nname="x"\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via Makefile', async () => {
    await writeFile(join(tempDir!, 'Makefile'), 'all:\n\techo hi\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via .csproj extension', async () => {
    await writeFile(join(tempDir!, 'MyApp.csproj'), '<Project/>\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via pubspec.yaml', async () => {
    await writeFile(join(tempDir!, 'pubspec.yaml'), 'name: x\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('detects brownfield via populated src/ directory', async () => {
    await mkdir(join(tempDir!, 'src'), { recursive: true })
    await writeFile(join(tempDir!, 'src', 'main.go'), 'package main\n', 'utf8')
    expect(await detectProfile(tempDir!)).toBe('brownfield')
  })

  test('treats empty src/ directory as greenfield', async () => {
    await mkdir(join(tempDir!, 'src'), { recursive: true })
    expect(await detectProfile(tempDir!)).toBe('greenfield')
  })

  // Phase 1.6 prerequisite (1000-star plan) — close the brownfield
  // detection gap Codex R0 flagged. A repo with `.git/` initialized
  // and at least one untracked source file at root (not matching any
  // known lockfile/marker/extension/source-dir heuristic) was being
  // misclassified as greenfield. Fix: an untracked file inside a
  // git-initialized repo is enough to flag brownfield, since the user
  // has both opted into version control AND dropped in code that
  // needs auditing.
  test('detects brownfield via untracked source file in a git-initialized repo', async () => {
    const cwd = tempDir!
    await Bun.spawn(['git', '-C', cwd, 'init', '-q']).exited
    // Plain `.ts` file — not in BROWNFIELD_LOCKFILES, not a marker
    // file, no marker extension, not under a source-dir name. Before
    // the fix this returned 'greenfield'.
    await writeFile(join(cwd, 'app.ts'), 'export const x = 1\n', 'utf8')
    expect(await detectProfile(cwd)).toBe('brownfield')
  })

  test('honors .gitignore when scanning for contentful untracked files', async () => {
    // If both .gitignore and the source file are git-ignored, the
    // untracked-files scan returns nothing, so detector falls through
    // to the remaining heuristics (no lockfile, no markers, no
    // populated source dir) and stays greenfield. This is the
    // explicit-opt-out regression guard for the new heuristic.
    const cwd = tempDir!
    await Bun.spawn(['git', '-C', cwd, 'init', '-q']).exited
    await writeFile(join(cwd, '.gitignore'), '.gitignore\napp.ts\n', 'utf8')
    await writeFile(join(cwd, 'app.ts'), 'export const x = 1\n', 'utf8')
    expect(await detectProfile(cwd)).toBe('greenfield')
  })

  test('init records the detected profile in config.yaml', async () => {
    await writeFile(join(tempDir!, 'package.json'), '{"name":"x"}', 'utf8')
    const { profile, paths } = await initProject({ cwd: tempDir! })
    expect(profile).toBe('brownfield')
    const config = parseYaml(await readFile(paths.config, 'utf8'))
    expect(config.profile).toBe('brownfield')
  })

  test('refuses to overwrite an existing .code-oz/ without --force', async () => {
    await initProject({ cwd: tempDir! })
    await expect(initProject({ cwd: tempDir! })).rejects.toThrow(/already exists/)
  })

  test('--force destructively resets the .code-oz/ directory', async () => {
    const cwd = tempDir!
    const { paths } = await initProject({ cwd })

    // Place a sentinel that represents stale state from a prior run
    const sentinel = join(paths.state, 'STALE_FROM_PRIOR_RUN.json')
    await writeFile(sentinel, '{"stale":true}', 'utf8')
    expect((await stat(sentinel)).isFile()).toBe(true)

    // --force should remove the entire .code-oz/ tree before recreating
    const result = await initProject({ cwd, force: true })
    expect(result.paths.root).toBe(paths.root)

    // Sentinel must be gone (proves rm -rf happened)
    await expect(stat(sentinel)).rejects.toThrow()

    // Fresh tree should exist with config.yaml + .gitignore + README.md
    expect((await stat(paths.config)).isFile()).toBe(true)
    expect((await stat(join(paths.root, '.gitignore'))).isFile()).toBe(true)
    expect((await stat(join(paths.root, 'README.md'))).isFile()).toBe(true)
  })
})
