// `code-oz doctor providers` — aggregate provider health probe with a
// required-providers exit policy.
//
// Per docs/references/provider-contract.md "doctor side-effect rule":
// health() never writes events.jsonl or NEEDS_INTERVENTION.json. Doctor
// runs outside any active run; the per-run lock and event log don't exist
// in that context. Invocation failures *inside* an active run write gates
// (that's the wrapper's job, M4 commit 7), but health probes are pure
// reads.
//
// Exit policy: the agent registry tells us which providers are *required*
// (every distinct provider field across loaded agents). For each required
// provider, success means authStatus === 'ok'. For non-required providers
// (e.g., Gemini when no agent declares provider: gemini), 'unsupported' is
// success-by-design and is ignored. Exit 0 when every required provider is
// healthy; exit 1 otherwise.

import { bootstrap, getProviderRegistry } from '../cli/bootstrap.ts'
import type {
  IAgentProvider,
  ProviderHealth,
  ProviderId,
} from '../providers/types.ts'

export interface RunDoctorProvidersOptions {
  readonly cwd?: string
}

export interface DoctorProvidersReport {
  /** Health probe result for every adapter in the provider registry. */
  readonly providers: readonly ProviderHealth[]
  /** ProviderIds declared by at least one loaded agent. */
  readonly required: readonly ProviderId[]
  /** 0 when every required provider is healthy; 1 otherwise. */
  readonly exitCode: 0 | 1
  /** True when bootstrap succeeded; false when no .code-oz/ was found
   * (in which case `required` is empty and the exit policy degrades to a
   * health-only sanity check). */
  readonly bootstrapped: boolean
  /** Optional message about why bootstrap failed, included for context. */
  readonly bootstrapError?: string
}

/**
 * Library entry point for `code-oz doctor providers`. Returns a structured
 * report; callers (including the CLI shim) decide on output formatting and
 * exit code propagation.
 *
 * Never throws on a single provider's health failure — every probe is
 * wrapped in try/catch and surfaces in `lastError`. The report is always
 * complete.
 */
export async function runDoctorProviders(
  opts: RunDoctorProvidersOptions = {},
): Promise<DoctorProvidersReport> {
  let required: ProviderId[] = []
  let bootstrapped = true
  let bootstrapError: string | undefined

  try {
    const ctx = await bootstrap({ cwd: opts.cwd })
    const seen = new Set<ProviderId>()
    for (const agent of ctx.registry.listAll()) {
      seen.add(agent.provider as ProviderId)
    }
    required = [...seen]
  } catch (err) {
    bootstrapped = false
    bootstrapError = (err as Error).message
  }

  const providerRegistry = getProviderRegistry()
  const probes: ProviderHealth[] = []
  for (const provider of providerRegistry.all()) {
    probes.push(await probeOne(provider))
  }

  const exitCode = computeExitCode(probes, required)

  return Object.freeze({
    providers: Object.freeze(probes),
    required: Object.freeze(required),
    exitCode,
    bootstrapped,
    ...(bootstrapError !== undefined ? { bootstrapError } : {}),
  })
}

async function probeOne(provider: IAgentProvider): Promise<ProviderHealth> {
  const start = Date.now()
  try {
    const h = await provider.health()
    const latencyMs = Date.now() - start
    return h.latencyMs !== undefined ? h : Object.freeze({ ...h, latencyMs })
  } catch (err) {
    return Object.freeze({
      provider: provider.id,
      authStatus: 'unknown' as const,
      modelDefaultAvailable: false,
      latencyMs: Date.now() - start,
      lastError: {
        code: 'provider_io_error',
        rule: 'health() probe threw an unexpected error',
        detail: (err as Error).message,
      },
    })
  }
}

function computeExitCode(
  probes: readonly ProviderHealth[],
  required: readonly ProviderId[],
): 0 | 1 {
  const requiredSet = new Set(required)
  for (const h of probes) {
    if (!requiredSet.has(h.provider)) continue
    if (h.authStatus !== 'ok') return 1
  }
  return 0
}

// --- CLI shim -----------------------------------------------------

export async function doctorCommand(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (subcommand === undefined) {
    process.stderr.write(doctorHelp())
    process.exit(1)
  }

  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    process.stdout.write(doctorHelp())
    return
  }

  if (subcommand === 'tools') {
    const subArgs = args.slice(1)
    const json = subArgs.includes('--json')
    const report = await runDoctorTools()
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    } else {
      process.stdout.write(formatToolsTable(report))
    }
    process.exit(report.exitCode)
  }

  if (subcommand !== 'providers') {
    process.stderr.write(`code-oz doctor: unknown subcommand '${subcommand}'\n\n`)
    process.stderr.write(doctorHelp())
    process.exit(1)
  }

  const subArgs = args.slice(1)
  const json = subArgs.includes('--json')

  const report = await runDoctorProviders()

  if (json) {
    process.stdout.write(formatProvidersJson(report))
  } else {
    process.stdout.write(formatProvidersTable(report))
  }

  process.exit(report.exitCode)
}

// --- doctor tools (M6) ----------------------------------------------

export interface DoctorToolReport {
  readonly tool: 'rg'
  readonly available: boolean
  readonly version?: string
  readonly path?: string
  readonly error?: string
}

export interface DoctorToolsReport {
  readonly tools: readonly DoctorToolReport[]
  readonly exitCode: 0 | 1
}

/**
 * `code-oz doctor tools` — checks that the binaries the M6+ repo-context
 * tools rely on are on PATH. Today: `rg` (ripgrep). Missing `rg` does not
 * break code-oz on its own; it only blocks personas that declare
 * permissions.tool_use.repo_context. Exits 0 on success, 1 on missing tool.
 */
export async function runDoctorTools(): Promise<DoctorToolsReport> {
  const probe = await probeRg()
  const exitCode: 0 | 1 = probe.available ? 0 : 1
  return Object.freeze({ tools: Object.freeze([probe]), exitCode })
}

async function probeRg(): Promise<DoctorToolReport> {
  const { spawn } = await import('node:child_process')
  return await new Promise<DoctorToolReport>((resolveProbe) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('rg', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolveProbe({ tool: 'rg', available: false, error: (err as Error).message })
      return
    }
    let stdout = ''
    let errored = false
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.on('error', (err) => {
      errored = true
      const code = (err as NodeJS.ErrnoException).code
      resolveProbe({
        tool: 'rg',
        available: false,
        error: code === 'ENOENT' ? 'rg not on PATH' : err.message,
      })
    })
    child.on('close', (exitCode) => {
      if (errored) return
      if (exitCode !== 0) {
        resolveProbe({ tool: 'rg', available: false, error: `rg exited ${exitCode}` })
        return
      }
      const firstLine = stdout.split('\n')[0]?.trim() ?? ''
      resolveProbe({ tool: 'rg', available: true, version: firstLine })
    })
  })
}

function formatToolsTable(report: DoctorToolsReport): string {
  const lines: string[] = ['TOOL  AVAILABLE  VERSION']
  for (const t of report.tools) {
    lines.push(
      `${t.tool.padEnd(5)} ${(t.available ? 'yes' : 'no').padEnd(10)} ${t.version ?? t.error ?? ''}`,
    )
  }
  lines.push('')
  if (report.exitCode === 0) {
    lines.push('All required tools available.')
  } else {
    lines.push('Missing required tool(s). Personas that declare')
    lines.push('permissions.tool_use.repo_context will fail with tool_unavailable.')
    lines.push('Install: brew install ripgrep   (macOS)')
    lines.push('         sudo apt install ripgrep   (Debian/Ubuntu)')
    lines.push('         see https://github.com/BurntSushi/ripgrep#installation')
  }
  return lines.join('\n') + '\n'
}

export function doctorHelp(): string {
  return `Usage: code-oz doctor <subcommand> [options]

Subcommands:
  providers        Probe each provider adapter (auth + CLI presence)
  tools            Probe required external tools (rg / ripgrep)
  help             Show this help

Options for 'providers':
  --json           Emit the ProviderHealth[] report as JSON

Exit codes:
  0                Every required provider is healthy
  1                At least one required provider is unhealthy

A provider is "required" when at least one loaded agent declares it in
frontmatter. Bundled default agents (claude + codex personas) load even
without a project init, so 'doctor providers' typically runs against
those required providers from anywhere on disk.
`
}

export function formatProvidersJson(report: DoctorProvidersReport): string {
  return JSON.stringify(report, null, 2) + '\n'
}

export function formatProvidersTable(report: DoctorProvidersReport): string {
  const lines: string[] = []
  if (!report.bootstrapped) {
    lines.push(
      '(no .code-oz/ project found — running unfiltered probe; required-provider gating disabled)',
      '',
    )
  }
  const requiredSet = new Set(report.required)

  // Plain ASCII columns; no fancy box drawing so the binary output stays
  // pipe-friendly.
  const header = ['PROVIDER', 'AUTH', 'MODEL', 'LATENCY', 'REQ', 'ERROR']
  const rows: string[][] = [header]
  for (const h of report.providers) {
    rows.push([
      h.provider,
      h.authStatus,
      h.modelDefaultAvailable ? 'yes' : 'no',
      h.latencyMs !== undefined ? `${h.latencyMs}ms` : '-',
      requiredSet.has(h.provider) ? 'yes' : 'no',
      h.lastError ? `${h.lastError.code}: ${h.lastError.rule}` : '',
    ])
  }
  // Compute column widths.
  const widths: number[] = []
  for (let col = 0; col < header.length; col++) {
    let w = 0
    for (const row of rows) {
      const cell = row[col] ?? ''
      if (cell.length > w) w = cell.length
    }
    widths[col] = w
  }
  for (const row of rows) {
    const padded = row.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0))
    lines.push(padded.join('  '))
  }

  lines.push('')
  if (report.exitCode === 0) {
    if (report.required.length === 0) {
      lines.push('No required providers (no agents loaded).')
    } else {
      lines.push(`All required providers healthy: ${report.required.join(', ')}.`)
    }
  } else {
    const unhealthy = report.providers
      .filter((h) => requiredSet.has(h.provider) && h.authStatus !== 'ok')
      .map((h) => `${h.provider} (authStatus=${h.authStatus})`)
    lines.push(`Unhealthy required providers: ${unhealthy.join(', ')}. Exiting 1.`)
  }
  return lines.join('\n') + '\n'
}
