// Phase 1.6 prerequisite (1000-star plan, R0-revision-3 closure #3).
//
// Bug B (the wiring half of Phase 1.6): `src/commands/run.ts:311` used
// to hardcode `profile: 'greenfield'` regardless of `config.profile`.
// The fresh-run path of `code-oz run` therefore wrote a `run_started`
// event with `profile: greenfield` even when `.code-oz/config.yaml`
// declared `profile: brownfield` after init's brownfield detection.
//
// This test spawns the binary against a brownfield-configured project
// and inspects events.jsonl for the run_started event's profile field.
// We do NOT depend on full phase completion — for brownfield, the
// fresh-run code in M17's C2 (dispatch) is not yet wired, so the run
// will exit non-zero downstream. The only invariant under test is
// that `run_started.profile` reflects the loaded config profile.
//
// Greenfield regression coverage is the second test: a greenfield
// config should keep emitting profile: greenfield (proves the fix
// reads from config, not from a flipped literal).

import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { initProject } from '../../src/commands/init.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'
import { runGit } from '../../src/worktree/create-run-worktree.ts'

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..')
})()
const CLI_ENTRY = join(REPO_ROOT, 'src/cli.ts')

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('Phase 1.6 e2e requires git >= 2.40 on PATH')
  }
})

interface FixtureLayout {
  readonly projectRoot: string
  readonly stateDir: string
}

async function setupProject(profile: 'greenfield' | 'brownfield'): Promise<FixtureLayout> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'code-oz-phase16-'))
  const projectRoot = join(tmpRoot, 'project')
  await mkdir(projectRoot, { recursive: true })

  // Minimal seed file so the worktree base-commit lands cleanly.
  await writeFile(join(projectRoot, 'README.md'), '# fixture\n', 'utf8')
  await runGit(projectRoot, ['init', '-q', '-b', 'main'])
  await runGit(projectRoot, ['config', 'user.email', 'phase16@test'])
  await runGit(projectRoot, ['config', 'user.name', 'Phase16'])
  await runGit(projectRoot, ['config', 'commit.gpgsign', 'false'])
  await runGit(projectRoot, ['add', '-A'])
  await runGit(projectRoot, ['commit', '-q', '-m', 'init fixture'])

  await initProject({ cwd: projectRoot, force: false })

  const configPath = join(projectRoot, '.code-oz', 'config.yaml')
  const cfg = parseYaml(await readFile(configPath, 'utf8')) as Record<string, unknown>
  cfg.profile = profile
  await writeFile(configPath, stringifyYaml(cfg), 'utf8')

  return Object.freeze({
    projectRoot,
    stateDir: join(projectRoot, '.code-oz', 'state'),
  })
}

async function findRunEventsFile(stateDir: string): Promise<string | null> {
  // .code-oz/state/runs/<runId>/events.jsonl — accept the first one.
  const { readdir } = await import('node:fs/promises')
  const runsDir = join(stateDir, 'runs')
  try {
    const runIds = await readdir(runsDir)
    if (runIds.length === 0) return null
    return join(runsDir, runIds[0]!, 'events.jsonl')
  } catch {
    return null
  }
}

async function readRunStartedEvent(
  eventsFile: string,
): Promise<Record<string, unknown> | null> {
  const text = await readFile(eventsFile, 'utf8').catch(() => '')
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const evt = JSON.parse(line) as Record<string, unknown>
      if (evt.type === 'run_started') return evt
    } catch {
      // ignore malformed lines
    }
  }
  return null
}

async function spawnCodeOzRun(cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', CLI_ENTRY, 'run', '--provider', 'fake', '--request', 'hello'],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe('Phase 1.6 — fresh `code-oz run` propagates config.profile to run_started', () => {
  let fixture: FixtureLayout | null = null

  afterEach(async () => {
    if (fixture !== null) {
      const tmpRoot = dirname(fixture.projectRoot)
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
      fixture = null
    }
  })

  test('brownfield config -> run_started.profile === brownfield', async () => {
    fixture = await setupProject('brownfield')
    await spawnCodeOzRun(fixture.projectRoot)

    const eventsFile = await findRunEventsFile(fixture.stateDir)
    expect(eventsFile).not.toBeNull()
    const evt = await readRunStartedEvent(eventsFile!)
    expect(evt).not.toBeNull()
    expect(evt!.profile).toBe('brownfield')
  }, 30_000)

  test('greenfield config -> run_started.profile === greenfield', async () => {
    fixture = await setupProject('greenfield')
    await spawnCodeOzRun(fixture.projectRoot)

    const eventsFile = await findRunEventsFile(fixture.stateDir)
    expect(eventsFile).not.toBeNull()
    const evt = await readRunStartedEvent(eventsFile!)
    expect(evt).not.toBeNull()
    expect(evt!.profile).toBe('greenfield')
  }, 30_000)
})
