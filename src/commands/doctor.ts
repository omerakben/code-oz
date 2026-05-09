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
import type { FetchRunner } from '../providers/xai.ts'
import type {
  IAgentProvider,
  ProviderHealth,
  ProviderId,
} from '../providers/types.ts'

export interface RunDoctorProvidersOptions {
  readonly cwd?: string
  /**
   * Test-only seam: inject a fetch-like runner so HTTP-backed adapters
   * (xai) can be exercised offline. Production callers omit this so the
   * adapters use the Bun global fetch. PE-1 review-round closure
   * (Codex thread 019de60e block-push #2) — required to test the
   * doctor's redaction discipline with `XAI_API_KEY` set.
   */
  readonly fetchRunner?: FetchRunner
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

  const providerRegistry =
    opts.fetchRunner !== undefined
      ? getProviderRegistry({ fetchRunner: opts.fetchRunner })
      : getProviderRegistry()
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

  if (subcommand === 'git') {
    const subArgs = args.slice(1)
    const json = subArgs.includes('--json')
    const report = await runDoctorGit()
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    } else {
      process.stdout.write(formatGitReport(report))
    }
    process.exit(report.exitCode)
  }

  // M14 commit 10: `code-oz doctor --panel-baseline <fixture>` (or
  // equivalent subcommand form `doctor panel-baseline <fixture>`).
  // Rule-21 ship-gate metric command. Loads fixture from disk, runs
  // baseline measurement, prints summary, exits 0 on shipGatePasses
  // and 1 otherwise. JSON output via --json.
  if (subcommand === '--panel-baseline' || subcommand === 'panel-baseline') {
    const subArgs = args.slice(1)
    const json = subArgs.includes('--json')
    const fixturePath = subArgs.find((a) => !a.startsWith('--'))
    if (fixturePath === undefined) {
      process.stderr.write('code-oz doctor --panel-baseline: missing <fixture-path> argument\n')
      process.stderr.write('usage: code-oz doctor --panel-baseline <fixture-path> [--json]\n')
      process.exit(1)
    }
    const { loadAndRunPanelBaseline } = await import('./doctor-panel-baseline.ts')
    // F7 (Codex M14 R1 finding #7): construct a deterministic run-local
    // event log so loadAndRunPanelBaseline emits the
    // review_panel_baseline_completed event AND the
    // panel_quorum_rejected_same_family_vote events that back the
    // sameFamilyVoteRejectionCount metric. Without runPaths the metric
    // is fixture-declared, not events-derived. The temp dir lives only
    // for the duration of the command and is cleaned up after.
    const { mkdtemp, rm, mkdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const tmpRoot = await mkdtemp(join(tmpdir(), 'codeoz-doctor-baseline-'))
    try {
      const stateDir = join(tmpRoot, 'state')
      const artifactRoot = join(tmpRoot, 'artifacts')
      const runId = '_doctor-baseline'
      const runDir = join(stateDir, 'runs', runId)
      const lockDir = join(runDir, '.lock')
      const eventsFile = join(runDir, 'events.jsonl')
      await mkdir(runDir, { recursive: true })
      await mkdir(artifactRoot, { recursive: true })
      const runPaths = {
        runDir,
        artifactRoot,
        eventsFile,
        lockDir,
      } as const
      try {
        const report = await loadAndRunPanelBaseline(fixturePath, {
          // Cast to RunPaths — we only populate the fields the baseline
          // emitter and rejection-recorder use (eventsFile, lockDir).
          runPaths: runPaths as never,
        })
        if (json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        } else {
          process.stdout.write(report.summary + '\n')
        }
        process.exit(report.shipGatePasses ? 0 : 1)
      } catch (err) {
        process.stderr.write(`code-oz doctor --panel-baseline: ${(err as Error).message}\n`)
        process.exit(1)
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }

  // M15 commit 6b: `code-oz doctor --debate-policy-baseline <fixture-set> [--json]`.
  // Rule-21 ship-gate command. Loads fixture set from disk, computes
  // corrective verdict delta + new-actionable-finding rate + per-trigger
  // breakdown + no-signal-fire rate + cost/latency overhead, emits
  // debate_policy_baseline_completed event into a temp run dir, prints
  // summary, exits 0 on shipGatePasses and 1 otherwise.
  if (
    subcommand === '--debate-policy-baseline' ||
    subcommand === 'debate-policy-baseline'
  ) {
    const subArgs = args.slice(1)
    const json = subArgs.includes('--json')
    const fixturePath = subArgs.find((a) => !a.startsWith('--'))
    if (fixturePath === undefined) {
      process.stderr.write(
        'code-oz doctor --debate-policy-baseline: missing <fixture-set> argument\n',
      )
      process.stderr.write(
        'usage: code-oz doctor --debate-policy-baseline <fixture-set> [--json]\n',
      )
      process.exit(1)
    }
    const { runDebatePolicyBaseline } = await import('./doctor-debate-baseline.ts')
    const { mkdtemp, rm, mkdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const tmpRoot = await mkdtemp(
      join(tmpdir(), 'codeoz-doctor-debate-baseline-'),
    )
    try {
      const runDir = join(tmpRoot, 'run')
      const eventsFile = join(runDir, 'events.jsonl')
      await mkdir(runDir, { recursive: true })
      try {
        const report = await runDebatePolicyBaseline(fixturePath, {
          eventPaths: { file: eventsFile, lockDir: join(runDir, '.lock') },
        })
        if (json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        } else {
          process.stdout.write(report.summary + '\n')
        }
        process.exit(report.shipGatePasses ? 0 : 1)
      } catch (err) {
        process.stderr.write(
          `code-oz doctor --debate-policy-baseline: ${(err as Error).message}\n`,
        )
        process.exit(1)
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }

  // M15 commit 6a: `code-oz doctor --debate-policy [--events <path>] [--json]`.
  // Read-only inspector: prints effective debatePolicy + tabulates last N
  // debate_scheduler_* events. Resolves events file from --events arg or
  // active-run pointer (.code-oz/state/active.json). No event emitted.
  if (subcommand === '--debate-policy' || subcommand === 'debate-policy') {
    const subArgs = args.slice(1)
    const json = subArgs.includes('--json')
    const eventsIdx = subArgs.indexOf('--events')
    const eventsArg =
      eventsIdx >= 0 && eventsIdx + 1 < subArgs.length ? subArgs[eventsIdx + 1] : undefined
    const limitIdx = subArgs.indexOf('--limit')
    const limitArg =
      limitIdx >= 0 && limitIdx + 1 < subArgs.length
        ? Number.parseInt(subArgs[limitIdx + 1] ?? '', 10)
        : undefined

    const { inspectDebatePolicy, formatDebatePolicyTable, resolveActiveRunEventsFile } =
      await import('./doctor-debate-policy.ts')
    const { loadConfig } = await import('../config/load.ts')
    const { DEFAULT_CONFIG } = await import('../config/schema.ts')
    const { paths: codeOzPaths } = await import('../paths.ts')

    let config = DEFAULT_CONFIG
    try {
      config = await loadConfig({ cwd: process.cwd() })
    } catch {
      // Fall back to defaults if config is missing or invalid; the
      // inspector still prints the effective policy + (empty) events.
    }

    let resolvedEventsFile: string | undefined = eventsArg
    if (resolvedEventsFile === undefined) {
      const p = codeOzPaths(process.cwd())
      const fromPointer = await resolveActiveRunEventsFile({
        stateDir: p.state,
        activeFile: p.activeRun,
      })
      if (fromPointer !== null) resolvedEventsFile = fromPointer
    }

    const report = await inspectDebatePolicy({
      config,
      ...(resolvedEventsFile !== undefined ? { eventsFile: resolvedEventsFile } : {}),
      ...(limitArg !== undefined && Number.isFinite(limitArg) && limitArg >= 0
        ? { limit: limitArg }
        : {}),
    })

    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    } else {
      process.stdout.write(formatDebatePolicyTable(report))
    }
    process.exit(0)
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
  providers              Probe each provider adapter (auth + CLI presence)
  tools                  Probe required external tools (rg / ripgrep)
  git                    Probe git version (>= 2.40 required for M7+ worktree subsystem)
  --panel-baseline <p>   Run M14 reviewer-panel baseline measurement against
                         the JSON fixture at <p>; prints rule-21 ship-gate
                         report and exits 0 on PASS, 1 on FAIL
  --debate-policy        M15 read-only inspector: prints effective
                         debatePolicy config + tabulates last N
                         debate_scheduler_* events from the active run
                         (or --events <path>). Use --limit <n> to change
                         the tail size (default 20).
  --debate-policy-baseline <p>
                         Run M15 debate-policy baseline against the fixture
                         set at <p>; prints rule-21 ship-gate report and
                         exits 0 on PASS (correctiveDeltaRate>=0.10 AND
                         newActionableFindingRate>=0.30), 1 on FAIL.
  help                   Show this help

Options:
  --json                 Emit the report as JSON (all subcommands)

Exit codes:
  0                Probe succeeded
  1                At least one required check failed

A provider is "required" when at least one loaded agent declares it in
frontmatter. Bundled default agents (claude + codex personas) load even
without a project init, so 'doctor providers' typically runs against
those required providers from anywhere on disk.
`
}

// --- doctor git (M7) ------------------------------------------------

/** Required git version for the M7 worktree subsystem (per WORKTREE.md). */
export const MIN_GIT_VERSION: readonly [number, number] = [2, 40]

export interface DoctorGitReport {
  /** True if `git --version` ran successfully. */
  readonly available: boolean
  /** Parsed major.minor (e.g., [2, 47]); only present when available. */
  readonly version?: readonly [number, number]
  /** Raw first line of `git --version` output, when available. */
  readonly versionRaw?: string
  /** True when version >= MIN_GIT_VERSION. */
  readonly meetsMinimum?: boolean
  /** Error message if `git` is missing or `--version` failed. */
  readonly error?: string
  /** 0 when git is available and meets minimum; 1 otherwise. */
  readonly exitCode: 0 | 1
}

/**
 * `code-oz doctor git` — probes `git --version` and checks against
 * MIN_GIT_VERSION. Per WORKTREE.md, git 2.40 is the first version where
 * `git worktree add --detach <path>` is reliable across edge cases.
 *
 * Failure produces exit code 1; runs that reach BUILD will hit the same
 * check at run start and emit `NEEDS_INTERVENTION.json` with code
 * `worktree_git_version_unsupported`.
 */
export async function runDoctorGit(): Promise<DoctorGitReport> {
  const probe = await probeGitVersion()
  if (!probe.ok) {
    return Object.freeze({
      available: false,
      error: probe.error,
      exitCode: 1 as const,
    })
  }
  const meets = compareVersion(probe.version, MIN_GIT_VERSION) >= 0
  return Object.freeze({
    available: true,
    version: probe.version,
    versionRaw: probe.versionRaw,
    meetsMinimum: meets,
    exitCode: meets ? (0 as const) : (1 as const),
  })
}

interface GitProbeOk {
  readonly ok: true
  readonly version: readonly [number, number]
  readonly versionRaw: string
  readonly error?: undefined
}

interface GitProbeErr {
  readonly ok: false
  readonly error: string
  readonly version?: undefined
  readonly versionRaw?: undefined
}

async function probeGitVersion(): Promise<GitProbeOk | GitProbeErr> {
  const { spawn } = await import('node:child_process')
  return await new Promise<GitProbeOk | GitProbeErr>((resolveProbe) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolveProbe({ ok: false, error: (err as Error).message })
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
        ok: false,
        error: code === 'ENOENT' ? 'git not on PATH' : err.message,
      })
    })
    child.on('close', (exitCode) => {
      if (errored) return
      if (exitCode !== 0) {
        resolveProbe({ ok: false, error: `git exited ${exitCode}` })
        return
      }
      const firstLine = stdout.split('\n')[0]?.trim() ?? ''
      const parsed = parseGitVersion(firstLine)
      if (!parsed) {
        resolveProbe({
          ok: false,
          error: `cannot parse git version from: ${firstLine}`,
        })
        return
      }
      resolveProbe({ ok: true, version: parsed, versionRaw: firstLine })
    })
  })
}

/**
 * Parses the major.minor from `git --version` output.
 *
 * Examples:
 *   "git version 2.47.0"            → [2, 47]
 *   "git version 2.40.1.windows.1"  → [2, 40]
 *   "git version 2.43.GIT"          → [2, 43]
 *   "not a git output"              → null
 */
export function parseGitVersion(line: string): readonly [number, number] | null {
  const m = line.match(/git version (\d+)\.(\d+)/)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  return [major, minor] as const
}

/** Returns negative if a < b, 0 if equal, positive if a > b. */
export function compareVersion(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  return a[1] - b[1]
}

function formatGitReport(report: DoctorGitReport): string {
  const lines: string[] = []
  if (!report.available) {
    lines.push(`git: not available (${report.error ?? 'unknown'})`)
    lines.push('')
    lines.push(`code-oz requires git ${MIN_GIT_VERSION[0]}.${MIN_GIT_VERSION[1]} or newer for the M7+ worktree subsystem.`)
    lines.push('Install: brew install git   (macOS)')
    lines.push('         sudo apt install git   (Debian/Ubuntu)')
    return lines.join('\n') + '\n'
  }
  const v = report.version!
  lines.push(`git: ${report.versionRaw}`)
  lines.push(`parsed: ${v[0]}.${v[1]}`)
  lines.push(`required: >= ${MIN_GIT_VERSION[0]}.${MIN_GIT_VERSION[1]}`)
  lines.push('')
  if (report.meetsMinimum) {
    lines.push('git meets minimum required version.')
  } else {
    lines.push('git does NOT meet minimum required version.')
    lines.push('Runs that reach BUILD will fail with worktree_git_version_unsupported.')
    lines.push('Upgrade git to 2.40 or newer.')
  }
  return lines.join('\n') + '\n'
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
