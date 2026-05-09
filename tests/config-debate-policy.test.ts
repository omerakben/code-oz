// M15 commit 3 — debatePolicy config surface validation tests.
//
// Coverage discipline (kickoff §11.3): every invalid permutation rejects
// with a specific error code. The default mode is `manual` (preserves M10
// behavior); absent debatePolicy in raw YAML leaves `cfg.debatePolicy` as
// `undefined` and runtime callers resolve via `cfg.debatePolicy ??
// DEFAULT_DEBATE_POLICY`.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigLoadError } from '../src/config/load.ts'
import { DEFAULT_DEBATE_POLICY } from '../src/config/schema.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-debatepolicy-'))
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

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------
describe('mergeDebatePolicy — happy paths', () => {
  test('missing config file leaves debatePolicy undefined (M10 default)', async () => {
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy).toBeUndefined()
  })

  test('config without debatePolicy: block leaves debatePolicy undefined', async () => {
    await writeConfig(`
profile: greenfield
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy).toBeUndefined()
  })

  test('debatePolicy: null leaves debatePolicy undefined', async () => {
    await writeConfig(`
debatePolicy:
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy).toBeUndefined()
  })

  test('debatePolicy with mode only fills defaults', async () => {
    await writeConfig(`
debatePolicy:
  mode: auto
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy).toEqual({
      mode: 'auto',
      maxPerRun: DEFAULT_DEBATE_POLICY.maxPerRun,
      maxPerTask: DEFAULT_DEBATE_POLICY.maxPerTask,
      triggers: {
        reviewScoreGreyZone: { ...DEFAULT_DEBATE_POLICY.triggers.reviewScoreGreyZone },
        panelVoterDisagreement: DEFAULT_DEBATE_POLICY.triggers.panelVoterDisagreement,
        needsRevisionWithHighScore:
          DEFAULT_DEBATE_POLICY.triggers.needsRevisionWithHighScore,
      },
      cooldown: { ...DEFAULT_DEBATE_POLICY.cooldown },
    })
  })

  test('full config round-trips', async () => {
    await writeConfig(`
debatePolicy:
  mode: auto
  maxPerRun: 5
  maxPerTask: 2
  triggers:
    reviewScoreGreyZone:
      min: 4
      max: 8
    panelVoterDisagreement: false
    needsRevisionWithHighScore: false
  cooldown:
    dedupByFingerprint: false
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy).toEqual({
      mode: 'auto',
      maxPerRun: 5,
      maxPerTask: 2,
      triggers: {
        reviewScoreGreyZone: { min: 4, max: 8 },
        panelVoterDisagreement: false,
        needsRevisionWithHighScore: false,
      },
      cooldown: { dedupByFingerprint: false },
    })
  })

  test('mode=off is accepted (rule-21 baseline control)', async () => {
    await writeConfig(`
debatePolicy:
  mode: off
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy?.mode).toBe('off')
  })

  test('mode=manual is accepted (default)', async () => {
    await writeConfig(`
debatePolicy:
  mode: manual
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy?.mode).toBe('manual')
  })

  test('maxPerRun=0 is accepted (kill switch)', async () => {
    await writeConfig(`
debatePolicy:
  mode: auto
  maxPerRun: 0
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy?.maxPerRun).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Shape rejections
// ---------------------------------------------------------------------------
describe('mergeDebatePolicy — shape rejections', () => {
  test('rejects debatePolicy as array', async () => {
    await writeConfig(`
debatePolicy:
  - mode: auto
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects debatePolicy as scalar', async () => {
    await writeConfig(`
debatePolicy: auto
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects unknown row keys', async () => {
    await writeConfig(`
debatePolicy:
  mode: auto
  unknownField: 42
`)
    try {
      await loadConfig({ cwd: tmp })
      expect.unreachable('expected ConfigLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError)
      const issues = (err as ConfigLoadError).issues
      const match = issues.find((i) => i.rule.includes('unknownField'))
      expect(match).toBeDefined()
    }
  })

  test('rejects unknown trigger keys', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    verdictConfidence: 0.4
`)
    try {
      await loadConfig({ cwd: tmp })
      expect.unreachable('expected ConfigLoadError')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError)
      const issues = (err as ConfigLoadError).issues
      const match = issues.find((i) => i.rule.includes('verdictConfidence'))
      expect(match).toBeDefined()
    }
  })

  test('rejects unknown cooldown keys', async () => {
    await writeConfig(`
debatePolicy:
  cooldown:
    expirySeconds: 60
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects unknown reviewScoreGreyZone keys', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: 5
      max: 7
      threshold: 0.5
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects triggers as array', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    - panelVoterDisagreement
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects reviewScoreGreyZone as array', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      - 5
      - 7
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })
})

// ---------------------------------------------------------------------------
// Value rejections
// ---------------------------------------------------------------------------
describe('mergeDebatePolicy — value rejections', () => {
  test('rejects unknown mode', async () => {
    await writeConfig(`
debatePolicy:
  mode: turbo
`)
    try {
      await loadConfig({ cwd: tmp })
      expect.unreachable('expected ConfigLoadError')
    } catch (err) {
      const issues = (err as ConfigLoadError).issues
      const match = issues.find((i) => i.rule.includes('debatePolicy.mode'))
      expect(match?.rule).toContain('off | manual | auto')
    }
  })

  test('rejects negative maxPerRun', async () => {
    await writeConfig(`
debatePolicy:
  maxPerRun: -1
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects non-integer maxPerTask', async () => {
    await writeConfig(`
debatePolicy:
  maxPerTask: 1.5
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects min > max in grey zone', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: 8
      max: 5
`)
    try {
      await loadConfig({ cwd: tmp })
      expect.unreachable('expected ConfigLoadError')
    } catch (err) {
      const issues = (err as ConfigLoadError).issues
      const match = issues.find((i) => i.rule.includes('reviewScoreGreyZone.min must be <='))
      expect(match).toBeDefined()
    }
  })

  test('rejects min < 0', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: -1
      max: 5
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects max > 10', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: 5
      max: 11
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects non-boolean panelVoterDisagreement', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    panelVoterDisagreement: 1
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects non-boolean needsRevisionWithHighScore', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    needsRevisionWithHighScore: "true"
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('rejects non-boolean dedupByFingerprint', async () => {
    await writeConfig(`
debatePolicy:
  cooldown:
    dedupByFingerprint: yes-please
`)
    await expect(loadConfig({ cwd: tmp })).rejects.toBeInstanceOf(ConfigLoadError)
  })

  test('boundary: min=max=5 is valid', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: 5
      max: 5
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy?.triggers.reviewScoreGreyZone).toEqual({ min: 5, max: 5 })
  })

  test('boundary: min=0 max=10 is valid', async () => {
    await writeConfig(`
debatePolicy:
  triggers:
    reviewScoreGreyZone:
      min: 0
      max: 10
`)
    const cfg = await loadConfig({ cwd: tmp })
    expect(cfg.debatePolicy?.triggers.reviewScoreGreyZone).toEqual({ min: 0, max: 10 })
  })
})
