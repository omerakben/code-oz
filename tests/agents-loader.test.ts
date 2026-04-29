import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRegistry, loadRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'

function fmFile(name: string, overrides: Record<string, unknown> = {}, body = '# Title\n\nbody\n'): SourceFile {
  const data = {
    name,
    type: 'agent',
    phase: 'define',
    provider: 'claude',
    modelPolicy: 'opus-default',
    permissions: { read: '*', write: ['./docs/**'], bash: 'deny' },
    description: `Stub agent ${name} for testing.`,
    ...overrides,
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return { file: `src/agents/defaults/${name}.md`, content: `---\n${yaml}\n---\n${body}` }
}

describe('buildRegistry — happy path', () => {
  test('builds a registry from defaults only', () => {
    const reg = buildRegistry({
      defaults: [fmFile('ba'), fmFile('lead', { phase: 'plan' })],
      overrides: [],
    })
    expect(reg.listAll()).toHaveLength(2)
    expect(reg.getByName('ba')?.phase).toBe('define')
    expect(reg.getByName('lead')?.phase).toBe('plan')
  })

  test('listAll returns definitions sorted by name', () => {
    const reg = buildRegistry({
      defaults: [fmFile('zulu', { phase: 'ship' }), fmFile('alpha'), fmFile('mike', { phase: 'build' })],
      overrides: [],
    })
    expect(reg.listAll().map((d) => d.name)).toEqual(['alpha', 'mike', 'zulu'])
  })

  test('listAll returns a frozen array', () => {
    const reg = buildRegistry({ defaults: [fmFile('ba')], overrides: [] })
    expect(Object.isFrozen(reg.listAll())).toBe(true)
  })

  test('getByPhase returns only agents for that phase', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile('ba'),
        fmFile('ba2', { name: 'ba2', phase: 'define' }),
        fmFile('lead', { phase: 'plan' }),
      ],
      overrides: [],
    })
    expect(reg.getByPhase('define').map((d) => d.name).sort()).toEqual(['ba', 'ba2'])
    expect(reg.getByPhase('plan').map((d) => d.name)).toEqual(['lead'])
  })

  test('getByPhase returns empty array for phase with no agents', () => {
    const reg = buildRegistry({ defaults: [fmFile('ba')], overrides: [] })
    expect(reg.getByPhase('audit')).toEqual([])
  })

  test('getByName returns undefined for unknown name', () => {
    const reg = buildRegistry({ defaults: [fmFile('ba')], overrides: [] })
    expect(reg.getByName('nobody')).toBeUndefined()
  })
})

describe('buildRegistry — overrides', () => {
  test('project-local override wins on name collision', () => {
    const bundled = fmFile('ba', {}, '# Bundled BA\n')
    const override: SourceFile = {
      file: '.code-oz/agents/ba.md',
      content: bundled.content.replace('# Bundled BA', '# Custom BA'),
    }
    const reg = buildRegistry({ defaults: [bundled], overrides: [override] })
    expect(reg.getByName('ba')?.body).toContain('# Custom BA')
    // Bundled count stayed the same — no doubling
    expect(reg.listAll()).toHaveLength(1)
  })

  test('override does not mutate the bundled default object', () => {
    const bundled = fmFile('ba', {}, '# Bundled\n')
    const overrideContent = bundled.content.replace('# Bundled', '# Custom')
    const override: SourceFile = { file: '.code-oz/agents/ba.md', content: overrideContent }

    const regWithOverride = buildRegistry({ defaults: [bundled], overrides: [override] })
    expect(regWithOverride.getByName('ba')?.body).toContain('# Custom')

    // A second registry built from the same defaults must still see the bundled body
    const regWithoutOverride = buildRegistry({ defaults: [bundled], overrides: [] })
    expect(regWithoutOverride.getByName('ba')?.body).toContain('# Bundled')
  })

  test('rejects override that changes phase of a bundled default', () => {
    const bundled = fmFile('ba')
    const override: SourceFile = {
      file: '.code-oz/agents/ba.md',
      content: fmFile('ba', { phase: 'plan' }).content,
    }
    expect(() => buildRegistry({ defaults: [bundled], overrides: [override] })).toThrow(AgentLoadError)
    try {
      buildRegistry({ defaults: [bundled], overrides: [override] })
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.code).toBe('loader_phase_mismatch_override')
      expect(e.issues[0]!.file).toBe('.code-oz/agents/ba.md')
    }
  })

  test('rejects override that changes type of a bundled default', () => {
    const bundled = fmFile('ba')
    const override: SourceFile = {
      file: '.code-oz/agents/ba.md',
      content: fmFile('ba', { type: 'skill' }).content,
    }
    expect(() => buildRegistry({ defaults: [bundled], overrides: [override] })).toThrow(AgentLoadError)
  })

  test('allows override to change provider, modelPolicy, permissions, description, body', () => {
    const bundled = fmFile('ba')
    const override: SourceFile = {
      file: '.code-oz/agents/ba.md',
      content: fmFile('ba', {
        provider: 'codex',
        modelPolicy: 'any',
        permissions: { read: '*', write: '*', bash: 'deny' },
      }, '# Override\n').content,
    }
    const reg = buildRegistry({ defaults: [bundled], overrides: [override] })
    const def = reg.getByName('ba')!
    expect(def.provider).toBe('codex')
    expect(def.modelPolicy).toBe('any')
    expect(def.permissions.write).toBe('*')
    expect(def.body).toContain('# Override')
  })

  test('override with new name is added alongside bundled defaults', () => {
    const reg = buildRegistry({
      defaults: [fmFile('ba')],
      overrides: [fmFile('extra', { phase: 'verify' })],
    })
    expect(reg.listAll().map((d) => d.name).sort()).toEqual(['ba', 'extra'])
  })
})

describe('buildRegistry — cross-family review (rule 2)', () => {
  test('rejects when BUILD and REVIEW agents share a provider', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    expect(() => buildRegistry({ defaults: [builder, reviewer], overrides: [] })).toThrow(
      AgentLoadError,
    )
    try {
      buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.code).toBe('loader_cross_family_violation')
      expect(e.issues[0]!.file).toBe('src/agents/defaults/reviewer.md')
    }
  })

  test('accepts BUILD and REVIEW agents in different provider families', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const reg = buildRegistry({ defaults: [builder, reviewer], overrides: [] })
    expect(reg.getByName('builder')?.provider).toBe('claude')
    expect(reg.getByName('reviewer')?.provider).toBe('codex')
  })

  test('rejects override that drags REVIEW into BUILD provider family', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'codex' })
    const sneakyOverride: SourceFile = {
      file: '.code-oz/agents/reviewer.md',
      content: fmFile('reviewer', { phase: 'review', provider: 'claude' }).content,
    }
    expect(() =>
      buildRegistry({ defaults: [builder, reviewer], overrides: [sneakyOverride] }),
    ).toThrow(AgentLoadError)
  })

  test('accepts BUILD-only registry (no REVIEW agent to pair with)', () => {
    const builder = fmFile('builder', { phase: 'build', provider: 'claude' })
    const reg = buildRegistry({ defaults: [builder], overrides: [] })
    expect(reg.listAll()).toHaveLength(1)
  })

  test('accepts REVIEW-only registry (no BUILD agent to pair with)', () => {
    const reviewer = fmFile('reviewer', { phase: 'review', provider: 'claude' })
    const reg = buildRegistry({ defaults: [reviewer], overrides: [] })
    expect(reg.listAll()).toHaveLength(1)
  })
})

describe('buildRegistry — fail-fast', () => {
  test('fails on the first invalid bundled default', () => {
    const broken: SourceFile = {
      file: 'src/agents/defaults/broken.md',
      content: '---\nname: broken\n---\n# B\n',
    }
    expect(() => buildRegistry({ defaults: [broken], overrides: [] })).toThrow(AgentLoadError)
  })

  test('fails on an invalid project-local agent', () => {
    const broken: SourceFile = {
      file: '.code-oz/agents/broken.md',
      content: '---\nname: broken\n---\n# B\n',
    }
    expect(() => buildRegistry({ defaults: [], overrides: [broken] })).toThrow(AgentLoadError)
  })

  test('reports issues from project-local file with project-local file path', () => {
    const broken: SourceFile = {
      file: '.code-oz/agents/oops.md',
      content: '---\nname: oops\n---\n# Oops\n',
    }
    try {
      buildRegistry({ defaults: [], overrides: [broken] })
    } catch (err) {
      expect((err as AgentLoadError).issues[0]!.file).toBe('.code-oz/agents/oops.md')
    }
  })
})

describe('loadRegistry — I/O wrapper', () => {
  let tempDir: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'code-oz-loader-test-'))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('treats absent project dir as empty overrides', async () => {
    const reg = await loadRegistry({
      defaults: [fmFile('ba')],
      projectDir: join(tempDir!, 'does-not-exist'),
      cwd: tempDir!,
    })
    expect(reg.listAll().map((d) => d.name)).toEqual(['ba'])
  })

  test('treats empty project dir as empty overrides', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    const reg = await loadRegistry({
      defaults: [fmFile('ba')],
      projectDir: dir,
      cwd: tempDir!,
    })
    expect(reg.listAll().map((d) => d.name)).toEqual(['ba'])
  })

  test('reads project-local agents from disk and applies overrides', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    const overrideContent = fmFile('ba', {}, '# Custom BA\n').content
    await writeFile(join(dir, 'ba.md'), overrideContent, 'utf8')

    const reg = await loadRegistry({
      defaults: [fmFile('ba', {}, '# Bundled\n')],
      projectDir: dir,
      cwd: tempDir!,
    })
    expect(reg.getByName('ba')?.body).toContain('# Custom BA')
  })

  test('discovers files in deterministic sorted order', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'zulu.md'), fmFile('zulu', { phase: 'ship' }).content, 'utf8')
    await writeFile(join(dir, 'alpha.md'), fmFile('alpha').content, 'utf8')
    await writeFile(join(dir, 'mike.md'), fmFile('mike', { phase: 'build' }).content, 'utf8')

    const reg = await loadRegistry({
      defaults: [],
      projectDir: dir,
      cwd: tempDir!,
    })
    expect(reg.listAll().map((d) => d.name)).toEqual(['alpha', 'mike', 'zulu'])
  })

  test('ignores non-.md files in the agents dir', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'ba.md'), fmFile('ba').content, 'utf8')
    await writeFile(join(dir, 'README.txt'), 'ignore me', 'utf8')
    await writeFile(join(dir, 'config.yaml'), 'ignore me', 'utf8')

    const reg = await loadRegistry({ defaults: [], projectDir: dir, cwd: tempDir! })
    expect(reg.listAll().map((d) => d.name)).toEqual(['ba'])
  })

  test('rejects a symlink whose target escapes the agents dir', async () => {
    const dir = join(tempDir!, 'agents')
    const outsideFile = join(tempDir!, 'outside.md')
    await mkdir(dir, { recursive: true })
    await writeFile(outsideFile, fmFile('escapee').content, 'utf8')
    await symlink(outsideFile, join(dir, 'escapee.md'))

    await expect(
      loadRegistry({ defaults: [], projectDir: dir, cwd: tempDir! }),
    ).rejects.toThrow(AgentLoadError)
  })

  test('error file paths are cwd-relative when cwd provided', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken.md'), '---\nname: broken\n---\n# B\n', 'utf8')

    try {
      await loadRegistry({ defaults: [], projectDir: dir, cwd: tempDir! })
    } catch (err) {
      const e = err as AgentLoadError
      // Should be cwd-relative, e.g. "agents/broken.md", not the absolute tempDir path
      expect(e.issues[0]!.file).toBe(join('agents', 'broken.md'))
    }
  })

  test('wraps a broken symlink (target does not exist) as a typed AgentLoadError', async () => {
    const dir = join(tempDir!, 'agents')
    await mkdir(dir, { recursive: true })
    await symlink(join(tempDir!, 'does-not-exist.md'), join(dir, 'broken.md'))

    try {
      await loadRegistry({ defaults: [], projectDir: dir, cwd: tempDir! })
      throw new Error('expected AgentLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentLoadError)
      const e = err as AgentLoadError
      expect(e.issues[0]!.code).toBe('loader_io_error')
      expect(e.issues[0]!.file).toBe(join('agents', 'broken.md'))
    }
  })

  test('rejects when project path is a file, not a directory', async () => {
    const file = join(tempDir!, 'not-a-dir.md')
    await writeFile(file, 'irrelevant', 'utf8')

    await expect(
      loadRegistry({ defaults: [], projectDir: file, cwd: tempDir! }),
    ).rejects.toThrow(AgentLoadError)
  })
})
