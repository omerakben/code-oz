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

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-doctor-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
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
    expect(ids).toEqual(['claude', 'codex', 'fake', 'gemini'])
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
