import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeGate,
  readGate,
  gateFilename,
  validateGate,
  writeNeedsInterventionGate,
  writePauseGate,
  writeStopGate,
  type GatePaths,
} from '../src/state/gates.ts'
import { GateLoadError } from '../src/state/errors.ts'
import { generateUlid, type GateFile, type NeedsInterventionGate } from '../src/state/schemas.ts'

let tmp: string
let runDir: string
let artifactRoot: string
let lockDir: string
let paths: GatePaths
const RUN = generateUlid({ now: 1_000_000_000_000, random: new Uint8Array(10) })

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-gates-'))
  runDir = join(tmp, 'state', 'runs', RUN)
  artifactRoot = join(tmp, 'artifacts')
  lockDir = join(runDir, '.lock')
  await mkdir(runDir, { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  paths = { runDir, artifactRoot, lockDir }
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function validGate(overrides: Partial<GateFile> = {}): GateFile {
  return {
    version: 1,
    runId: RUN,
    phase: 'define',
    artifact: 'SPEC.md',
    agent: 'ba',
    agentProvider: 'claude',
    approvedBy: 'user',
    approvedAt: '2026-04-29T17:00:00Z',
    ...overrides,
  }
}

async function writeArtifact(name: string, content: string): Promise<void> {
  await writeFile(join(artifactRoot, name), content, 'utf8')
}

describe('gateFilename', () => {
  test('returns GATE_<PHASE>_PASSED.json with uppercase phase', () => {
    expect(gateFilename('define')).toBe('GATE_DEFINE_PASSED.json')
    expect(gateFilename('plan')).toBe('GATE_PLAN_PASSED.json')
    expect(gateFilename('audit')).toBe('GATE_AUDIT_PASSED.json')
  })
})

describe('validateGate (in-memory)', () => {
  test('happy path returns null', () => {
    expect(validateGate(validGate(), 'X.json')).toBeNull()
  })

  test('rejects wrong version', () => {
    expect(validateGate({ ...validGate(), version: 2 }, 'X.json')?.code).toBe('gate_invalid_version')
  })

  test('rejects non-ULID runId', () => {
    expect(validateGate({ ...validGate(), runId: 'not-a-ulid' }, 'X.json')?.code).toBe('gate_invalid_runid')
  })

  test('rejects unknown phase', () => {
    expect(validateGate({ ...validGate(), phase: 'pumpkin' as never }, 'X.json')?.code).toBe('gate_invalid_phase')
  })

  test('rejects malformed approvedAt', () => {
    expect(validateGate({ ...validGate(), approvedAt: 'yesterday' }, 'X.json')?.code).toBe('gate_invalid_timestamp')
  })

  test('rejects empty agent', () => {
    expect(validateGate({ ...validGate(), agent: '' }, 'X.json')?.code).toBe('gate_invalid_value')
  })

  test('rejects malformed artifactSha256', () => {
    expect(validateGate({ ...validGate(), artifactSha256: 'short' }, 'X.json')?.code).toBe('gate_invalid_value')
    expect(validateGate({ ...validGate(), artifactSha256: 'A'.repeat(64) }, 'X.json')?.code).toBe('gate_invalid_value')
  })

  test('rejects missing required field', () => {
    const { runId, ...rest } = validGate()
    void runId
    expect(validateGate(rest, 'X.json')?.code).toBe('gate_missing_field')
  })
})

describe('writeGate — path safety on `artifact`', () => {
  test('rejects absolute paths', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await expect(
      writeGate({ paths, gate: validGate({ artifact: '/etc/passwd' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })

  test('rejects `..` segments', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await expect(
      writeGate({ paths, gate: validGate({ artifact: '../escape' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
    await expect(
      writeGate({ paths, gate: validGate({ artifact: 'docs/../../escape' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })

  test('rejects raw `..` segments that would normalize away (foo/../SPEC.md)', async () => {
    // Regression for the path-safety bug Codex flagged in M3 review:
    // path.normalize collapses `foo/../SPEC.md` to `SPEC.md`, so a
    // post-normalize check alone misses this attack vector. The pre-
    // normalize raw-segment check is what catches it.
    await writeArtifact('SPEC.md', 'spec body')
    await expect(
      writeGate({ paths, gate: validGate({ artifact: 'foo/../SPEC.md' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
    await expect(
      writeGate({ paths, gate: validGate({ artifact: './SPEC.md' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })

  test('rejects backslash separators', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await expect(
      writeGate({ paths, gate: validGate({ artifact: 'sub\\dir\\X.md' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })

  test('rejects symlink escape from artifact root', async () => {
    // Create a target outside artifactRoot, then a symlink inside artifactRoot
    // pointing at it. resolveArtifactPath should reject via realpath.
    const outsideTarget = join(tmp, 'outside.md')
    await writeFile(outsideTarget, 'forbidden', 'utf8')
    await symlink(outsideTarget, join(artifactRoot, 'SPEC.md'))
    await expect(
      writeGate({ paths, gate: validGate({ artifact: 'SPEC.md' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })
})

describe('writeGate — happy path', () => {
  test('writes the gate file with computed sha256', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    const result = await writeGate({ paths, gate: validGate() })
    expect(result.filename).toBe('GATE_DEFINE_PASSED.json')
    expect(result.existed).toBe(false)
    expect(result.artifactSha256).toMatch(/^[0-9a-f]{64}$/)

    const content = await readFile(join(runDir, result.filename), 'utf8')
    const parsed = JSON.parse(content)
    expect(parsed.runId).toBe(RUN)
    expect(parsed.phase).toBe('define')
    expect(parsed.artifactSha256).toBe(result.artifactSha256)
  })

  test('computeSha256: false uses the gate.artifactSha256 verbatim', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    // Compute the actual hash, then ask writeGate to use it without recomputing.
    const expected = (await writeGate({ paths, gate: validGate() })).artifactSha256!
    // Clean up and try again with computeSha256: false.
    await rm(join(runDir, 'GATE_DEFINE_PASSED.json'))

    const result = await writeGate({
      paths,
      gate: validGate({ artifactSha256: expected }),
      computeSha256: false,
    })
    expect(result.artifactSha256).toBe(expected)
  })

  test('computeSha256: false rejects a mismatching supplied hash', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await expect(
      writeGate({
        paths,
        gate: validGate({ artifactSha256: 'a'.repeat(64) }),
        computeSha256: false,
      }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })

  test('writeGate fails when the artifact file is missing', async () => {
    await expect(writeGate({ paths, gate: validGate() })).rejects.toBeInstanceOf(GateLoadError)
  })

  test('no leftover .tmp files after success', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await writeGate({ paths, gate: validGate() })
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(runDir)
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false)
  })
})

describe('writeGate — idempotency', () => {
  test('re-writing identical content is a no-op', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    const first = await writeGate({ paths, gate: validGate() })
    expect(first.existed).toBe(false)

    const second = await writeGate({ paths, gate: validGate() })
    expect(second.existed).toBe(true)
    expect(second.artifactSha256).toBe(first.artifactSha256)
  })

  test('re-writing different content fails', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await writeGate({ paths, gate: validGate() })

    // Same phase, different agent — should reject.
    await expect(
      writeGate({ paths, gate: validGate({ agent: 'lead' }) }),
    ).rejects.toBeInstanceOf(GateLoadError)
  })
})

describe('writeGate — locking', () => {
  test('busy lock surfaces as gate_lock_busy', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await mkdir(lockDir)
    try {
      await writeGate({ paths, gate: validGate() })
      throw new Error('expected GateLoadError')
    } catch (err) {
      const e = err as GateLoadError
      expect(e.issues[0]?.code).toBe('gate_lock_busy')
    }
  })

  test('lock is released after successful write', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    await writeGate({ paths, gate: validGate() })
    await expect(stat(lockDir)).rejects.toThrow()
  })
})

describe('readGate', () => {
  test('round-trips a gate file', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    const written = await writeGate({ paths, gate: validGate() })
    const gate = await readGate(join(runDir, written.filename), artifactRoot)
    expect(gate.runId).toBe(RUN)
    expect(gate.phase).toBe('define')
    expect(gate.artifactSha256).toBe(written.artifactSha256)
    expect(Object.isFrozen(gate)).toBe(true)
  })

  test('rejects sha256 mismatch (artifact changed after gate written)', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    const written = await writeGate({ paths, gate: validGate() })
    // Mutate the artifact after the gate is written.
    await writeArtifact('SPEC.md', 'spec body modified')

    try {
      await readGate(join(runDir, written.filename), artifactRoot)
      throw new Error('expected GateLoadError')
    } catch (err) {
      const e = err as GateLoadError
      expect(e.issues[0]?.code).toBe('gate_artifact_sha256_mismatch')
    }
  })

  test('accepts gate without artifactSha256 (per spec)', async () => {
    await writeArtifact('SPEC.md', 'spec body')
    // Write a gate manually without sha256.
    const gate = validGate()
    const filename = gateFilename(gate.phase)
    await writeFile(join(runDir, filename), JSON.stringify(gate, null, 2))
    const read = await readGate(join(runDir, filename), artifactRoot)
    expect(read.artifactSha256).toBeUndefined()
  })

  test('rejects missing file', async () => {
    try {
      await readGate(join(runDir, 'GATE_DEFINE_PASSED.json'), artifactRoot)
      throw new Error('expected GateLoadError')
    } catch (err) {
      const e = err as GateLoadError
      expect(e.issues[0]?.code).toBe('gate_io_error')
    }
  })

  test('rejects malformed JSON', async () => {
    await writeFile(join(runDir, 'GATE_DEFINE_PASSED.json'), 'not json{', 'utf8')
    try {
      await readGate(join(runDir, 'GATE_DEFINE_PASSED.json'), artifactRoot)
      throw new Error('expected GateLoadError')
    } catch (err) {
      const e = err as GateLoadError
      expect(e.issues[0]?.code).toBe('gate_invalid_json')
    }
  })
})

describe('intervention/control gates', () => {
  test('writeNeedsInterventionGate writes a valid file', async () => {
    const gate: NeedsInterventionGate = {
      version: 1,
      runId: RUN,
      phase: 'build',
      agent: 'builder',
      code: 'provider_auth_missing',
      rule: 'CodexProvider could not read OAuth token',
      actionableSuggestions: ['run codex login', 'rerun code-oz approve'],
      createdAt: '2026-04-29T17:00:00Z',
    }
    await writeNeedsInterventionGate(paths, gate)
    const parsed = JSON.parse(await readFile(join(runDir, 'NEEDS_INTERVENTION.json'), 'utf8'))
    expect(parsed.code).toBe('provider_auth_missing')
    expect(parsed.actionableSuggestions.length).toBe(2)
  })

  test('writePauseGate / writeStopGate write valid files', async () => {
    await writePauseGate(paths, {
      version: 1,
      runId: RUN,
      reason: 'stepping away',
      createdAt: '2026-04-29T17:00:00Z',
    })
    await writeStopGate(paths, {
      version: 1,
      runId: RUN,
      reason: 'scope changed',
      createdAt: '2026-04-29T17:00:00Z',
    })
    const pause = JSON.parse(await readFile(join(runDir, 'PAUSE.json'), 'utf8'))
    const stop = JSON.parse(await readFile(join(runDir, 'STOP.json'), 'utf8'))
    expect(pause.reason).toBe('stepping away')
    expect(stop.reason).toBe('scope changed')
  })

  test('rejects missing required NEEDS_INTERVENTION fields', async () => {
    const incomplete = {
      version: 1,
      runId: RUN,
      phase: 'build',
      // missing: agent, code, rule, actionableSuggestions, createdAt
    }
    await expect(
      writeNeedsInterventionGate(paths, incomplete as unknown as NeedsInterventionGate),
    ).rejects.toBeInstanceOf(GateLoadError)
  })
})
