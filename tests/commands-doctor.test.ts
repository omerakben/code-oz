import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runDoctorProviders,
  formatProvidersTable,
  formatProvidersJson,
  doctorHelp,
} from '../src/commands/doctor.ts'
import { initProject } from '../src/commands/init.ts'

let tmp: string
// PE-1 commit 4 + Codex Risk: XaiProvider.health() makes a real HTTPS GET
// to /v1/models when XAI_API_KEY is set. Tests in this file go through
// the production registry (no FetchRunner injection seam in the doctor
// command surface today), so we clear XAI_API_KEY for the duration of
// each test to keep the suite offline. The xai adapter then short-
// circuits to authStatus: 'missing' without any network call.
let savedXaiKey: string | undefined

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-doctor-'))
  savedXaiKey = process.env.XAI_API_KEY
  delete process.env.XAI_API_KEY
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
  if (savedXaiKey !== undefined) {
    process.env.XAI_API_KEY = savedXaiKey
  }
})

describe('runDoctorProviders — bootstrap success', () => {
  test('discovers required providers from loaded agents', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    expect(report.bootstrapped).toBe(true)
    // The five bundled defaults declare claude (most) + codex (reviewer);
    // both must be in `required`.
    expect(report.required).toContain('claude')
    expect(report.required).toContain('codex')
    // FakeProvider isn't in any bundled persona — must NOT be required.
    expect(report.required).not.toContain('fake')
  })

  test('probes every adapter in the registry, not just required ones', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const ids = report.providers.map((h) => h.provider).sort()
    expect(ids).toEqual(['claude', 'codex', 'fake', 'gemini', 'xai'])
  })

  test('fake provider is always healthy', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const fake = report.providers.find((h) => h.provider === 'fake')
    expect(fake?.authStatus).toBe('ok')
  })

  test('gemini reports unsupported regardless of bootstrap', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const gemini = report.providers.find((h) => h.provider === 'gemini')
    expect(gemini?.authStatus).toBe('unsupported')
  })
})

describe('runDoctorProviders — no project init', () => {
  test('no .code-oz/ directory still bootstraps via bundled defaults', async () => {
    // tmp has no init — bootstrap does NOT fail; the bundled-defaults loader
    // produces the v0.1 personas regardless of project-local agents/. So
    // `required` still includes claude + codex (declared by the bundled
    // personas), and exit semantics work the same as a project init.
    const report = await runDoctorProviders({ cwd: tmp })
    expect(report.bootstrapped).toBe(true)
    expect(report.required).toContain('claude')
    expect(report.required).toContain('codex')
  })
})

describe('runDoctorProviders — exit policy', () => {
  test('exit 1 when any required provider is unhealthy', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    // claude + codex are required. The default ClaudeProvider/CodexProvider
    // shells out to real CLIs. In CI/sandbox where they're not installed or
    // not logged in, the exit policy should fire.
    const requiredHealths = report.providers.filter((h) =>
      report.required.includes(h.provider),
    )
    const allOk = requiredHealths.every((h) => h.authStatus === 'ok')
    expect(report.exitCode).toBe(allOk ? 0 : 1)
  })

  test('non-required providers do not gate exit code', async () => {
    // gemini is unsupported and never required (no agent declares gemini).
    // Its presence must not push exit to 1 on its own.
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const gemini = report.providers.find((h) => h.provider === 'gemini')
    expect(gemini?.authStatus).toBe('unsupported')
    expect(report.required).not.toContain('gemini')
  })
})

describe('formatProvidersTable / formatProvidersJson', () => {
  test('table output includes header + every probe row + summary', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const table = formatProvidersTable(report)
    expect(table).toContain('PROVIDER')
    expect(table).toContain('AUTH')
    expect(table).toContain('LATENCY')
    expect(table).toContain('claude')
    expect(table).toContain('codex')
    expect(table).toContain('fake')
    expect(table).toContain('gemini')
    if (report.exitCode === 0) {
      expect(table).toContain('All required providers healthy')
    } else {
      expect(table).toContain('Exiting 1')
    }
  })

  test('JSON output is parseable and has the expected shape', async () => {
    await initProject({ cwd: tmp })
    const report = await runDoctorProviders({ cwd: tmp })
    const json = formatProvidersJson(report)
    const parsed = JSON.parse(json)
    expect(Array.isArray(parsed.providers)).toBe(true)
    expect(Array.isArray(parsed.required)).toBe(true)
    expect(typeof parsed.exitCode).toBe('number')
    expect(typeof parsed.bootstrapped).toBe('boolean')
  })
})

describe('doctorHelp', () => {
  test('describes subcommands and exit codes', () => {
    const help = doctorHelp()
    expect(help).toContain('Subcommands:')
    expect(help).toContain('providers')
    expect(help).toContain('--json')
    expect(help).toContain('Exit codes:')
  })
})

// PE-1 review-round closure (Codex thread 019de60e block-push #2):
// the doctor's xAI health path with XAI_API_KEY set must not leak the
// key into table output, JSON output, or the structured report. The
// fetchRunner injection seam (added in the same review-round commit)
// lets these tests run the production code path with a sentinel-bearing
// FetchRunner mock. The earlier doctor tests above clear XAI_API_KEY
// for offline-discipline; these tests do the opposite — set the key,
// inject a runner that throws an error containing it, and verify
// nothing leaks.
describe('runDoctorProviders — xAI redaction discipline (PE-1 fetchRunner seam)', () => {
  const KEY_SENTINEL_DOCTOR = 'sk-xai-DOCTOR-LEAK-CANARY-NEVER-IN-OUTPUT-A1B2'
  let savedXaiKeyDoctor: string | undefined

  beforeEach(() => {
    savedXaiKeyDoctor = process.env.XAI_API_KEY
    process.env.XAI_API_KEY = KEY_SENTINEL_DOCTOR
  })

  afterEach(() => {
    if (savedXaiKeyDoctor === undefined) {
      delete process.env.XAI_API_KEY
    } else {
      process.env.XAI_API_KEY = savedXaiKeyDoctor
    }
  })

  test('table output never contains the API-key sentinel even when fetch error embeds it', async () => {
    await initProject({ cwd: tmp })
    const fetchRunner = async (): Promise<Response> => {
      const e = new Error(
        `xai network error embedding key=${KEY_SENTINEL_DOCTOR} and Authorization: Bearer ${KEY_SENTINEL_DOCTOR}`,
      )
      e.name = 'TypeError'
      throw e
    }
    const report = await runDoctorProviders({ cwd: tmp, fetchRunner })

    const xaiHealth = report.providers.find((h) => h.provider === 'xai')
    expect(xaiHealth).toBeDefined()
    // The xai probe ran (status unknown because the runner threw) — proving
    // the seam works AND that the sentinel passed through redaction.
    expect(xaiHealth!.authStatus).toBe('unknown')

    const table = formatProvidersTable(report)
    expect(table.includes(KEY_SENTINEL_DOCTOR)).toBe(false)

    const json = formatProvidersJson(report)
    expect(json.includes(KEY_SENTINEL_DOCTOR)).toBe(false)

    // The structured report (not just its serialized forms) must also be
    // redacted — the JSON form is just `JSON.stringify(report, null, 2)`,
    // so leaks would show up there too, but assert directly on the report
    // for clarity if a future format function rotates output.
    const rawDetail = xaiHealth?.lastError?.detail ?? ''
    expect(rawDetail.includes(KEY_SENTINEL_DOCTOR)).toBe(false)
    // Defense-in-depth: the sanitized detail SHOULD contain the redaction
    // marker, proving the redactSecrets path actually executed.
    expect(rawDetail).toContain('[REDACTED-API-KEY]')
  })

  test('table output never contains a Bearer token pattern when fetch error embeds one', async () => {
    await initProject({ cwd: tmp })
    const tokenLike = 'sk-some-other-bearer-token-shape-CDEF'
    const fetchRunner = async (): Promise<Response> => {
      const e = new Error(`fetch failed; sent Authorization: Bearer ${tokenLike}`)
      e.name = 'TypeError'
      throw e
    }
    const report = await runDoctorProviders({ cwd: tmp, fetchRunner })
    const json = formatProvidersJson(report)
    expect(json.includes(tokenLike)).toBe(false)
    expect(json).toContain('[REDACTED]')
  })
})
