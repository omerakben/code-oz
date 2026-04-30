import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-define-config-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function writeConfig(yaml: string): Promise<string> {
  const dir = join(tmp, '.code-oz')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'config.yaml')
  await writeFile(path, yaml, 'utf8')
  return path
}

describe('phases.define.askMe — defaults', () => {
  test('DEFAULT_CONFIG carries the locked v0.1 defaults', () => {
    const askMe = DEFAULT_CONFIG.phases.define.askMe
    expect(askMe.maxRounds).toBe(8)
    expect(askMe.readySignal).toBe('<spec-ready/>')
    expect(askMe.onMaxRounds).toBe('finalize')
    expect(askMe.maxFinalizeTurns).toBe(1)
    expect(askMe.maxRepairTurns).toBe(1)
  })

  test('missing config file yields default ask-me block', async () => {
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe).toEqual(DEFAULT_CONFIG.phases.define.askMe)
  })

  test('missing phases block in YAML yields default ask-me', async () => {
    await writeConfig(`defaultProvider: codex\n`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe).toEqual(DEFAULT_CONFIG.phases.define.askMe)
  })
})

describe('phases.define.askMe — overrides', () => {
  test('partial override merges over defaults', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      maxRounds: 12
      onMaxRounds: fail
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe.maxRounds).toBe(12)
    expect(cfg.phases.define.askMe.onMaxRounds).toBe('fail')
    expect(cfg.phases.define.askMe.readySignal).toBe(
      DEFAULT_CONFIG.phases.define.askMe.readySignal,
    )
    expect(cfg.phases.define.askMe.maxFinalizeTurns).toBe(
      DEFAULT_CONFIG.phases.define.askMe.maxFinalizeTurns,
    )
  })

  test('full override replaces every field', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      maxRounds: 4
      readySignal: '[READY]'
      onMaxRounds: fail
      maxFinalizeTurns: 0
      maxRepairTurns: 2
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe).toEqual({
      maxRounds: 4,
      readySignal: '[READY]',
      onMaxRounds: 'fail',
      maxFinalizeTurns: 0,
      maxRepairTurns: 2,
    })
  })

  test('extra unknown keys under askMe are tolerated', async () => {
    // mergeAskMe only touches the recognized fields; unknown keys are ignored
    // (forward compatibility — same posture as M3 events.ts open-type-union).
    await writeConfig(`
phases:
  define:
    askMe:
      maxRounds: 6
      futureKnob: experimental
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe.maxRounds).toBe(6)
  })
})

describe('phases.define.askMe — validation', () => {
  test('rejects non-positive maxRounds', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      maxRounds: 0
`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    const issues = (err as ConfigLoadError).issues
    expect(issues.some((i) => i.rule.includes('maxRounds'))).toBe(true)
    expect(issues[0]!.code).toBe('config_invalid_value')
  })

  test('rejects empty readySignal', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      readySignal: ""
`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      (err as ConfigLoadError).issues.some((i) => i.rule.includes('readySignal')),
    ).toBe(true)
  })

  test('rejects unknown onMaxRounds value', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      onMaxRounds: yolo
`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      (err as ConfigLoadError).issues.some((i) =>
        i.rule.includes('finalize | fail'),
      ),
    ).toBe(true)
  })

  test('rejects negative maxRepairTurns', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      maxRepairTurns: -1
`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      (err as ConfigLoadError).issues.some((i) => i.rule.includes('maxRepairTurns')),
    ).toBe(true)
  })

  test('accepts maxFinalizeTurns: 0 (disables finalize)', async () => {
    await writeConfig(`
phases:
  define:
    askMe:
      maxFinalizeTurns: 0
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.phases.define.askMe.maxFinalizeTurns).toBe(0)
  })

  test('rejects non-mapping phases block', async () => {
    await writeConfig(`phases: 42\n`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      (err as ConfigLoadError).issues.some((i) =>
        i.rule.includes('phases must be a mapping'),
      ),
    ).toBe(true)
  })

  test('rejects non-mapping askMe block', async () => {
    await writeConfig(`
phases:
  define:
    askMe: 'not a mapping'
`)
    let err: unknown
    try {
      await loadConfig({ cwd: tmp })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigLoadError)
    expect(
      (err as ConfigLoadError).issues.some((i) =>
        i.rule.includes('phases.define.askMe must be a mapping'),
      ),
    ).toBe(true)
  })
})
