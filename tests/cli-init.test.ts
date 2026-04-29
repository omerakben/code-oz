import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { initProject, detectProfile } from '../src/commands/init.ts'

describe('code-oz init', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'code-oz-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('scaffolds the .code-oz directory tree', async () => {
    const { paths } = await initProject({ cwd: tempDir })

    expect((await stat(paths.root)).isDirectory()).toBe(true)
    expect((await stat(paths.agents)).isDirectory()).toBe(true)
    expect((await stat(paths.artifacts)).isDirectory()).toBe(true)
    expect((await stat(paths.state)).isDirectory()).toBe(true)
    expect((await stat(paths.runs)).isDirectory()).toBe(true)
  })

  test('writes a valid config.yaml with expected defaults', async () => {
    const { paths } = await initProject({ cwd: tempDir })
    const raw = await readFile(paths.config, 'utf8')
    const config = parseYaml(raw)

    expect(config.version).toBe('0.1.0-alpha.0')
    expect(config.defaultProvider).toBe('claude')
    expect(config.models.primary).toBe('claude-opus-4-7')
    expect(config.budgets.maxReviewRounds).toBe(4)
    expect(config.permissions.allowEscapeHatch).toBe(false)
  })

  test('writes a project README inside .code-oz/', async () => {
    const { paths } = await initProject({ cwd: tempDir })
    const readme = await readFile(join(paths.root, 'README.md'), 'utf8')
    expect(readme).toContain('This directory was scaffolded by')
    expect(readme).toContain('agents/')
    expect(readme).toContain('artifacts/')
  })

  test('detects greenfield in an empty directory', async () => {
    const profile = await detectProfile(tempDir)
    expect(profile).toBe('greenfield')
  })

  test('detects brownfield via package.json', async () => {
    await writeFile(join(tempDir, 'package.json'), '{"name":"existing"}', 'utf8')
    expect(await detectProfile(tempDir)).toBe('brownfield')
  })

  test('detects brownfield via Cargo.toml', async () => {
    await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname="x"\n', 'utf8')
    expect(await detectProfile(tempDir)).toBe('brownfield')
  })

  test('detects brownfield via pyproject.toml', async () => {
    await writeFile(join(tempDir, 'pyproject.toml'), '[project]\nname="x"\n', 'utf8')
    expect(await detectProfile(tempDir)).toBe('brownfield')
  })

  test('detects brownfield via populated src/ directory', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true })
    await writeFile(join(tempDir, 'src', 'main.go'), 'package main\n', 'utf8')
    expect(await detectProfile(tempDir)).toBe('brownfield')
  })

  test('treats empty src/ directory as greenfield', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true })
    expect(await detectProfile(tempDir)).toBe('greenfield')
  })

  test('init records the detected profile in config.yaml', async () => {
    await writeFile(join(tempDir, 'package.json'), '{"name":"x"}', 'utf8')
    const { profile, paths } = await initProject({ cwd: tempDir })
    expect(profile).toBe('brownfield')
    const config = parseYaml(await readFile(paths.config, 'utf8'))
    expect(config.profile).toBe('brownfield')
  })

  test('refuses to overwrite an existing .code-oz/ without --force', async () => {
    await initProject({ cwd: tempDir })
    await expect(initProject({ cwd: tempDir })).rejects.toThrow(/already exists/)
  })

  test('overwrites with --force', async () => {
    await initProject({ cwd: tempDir })
    const result = await initProject({ cwd: tempDir, force: true })
    expect(result.paths.root).toBeDefined()
  })
})
