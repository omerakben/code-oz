#!/usr/bin/env bun
import { initCommand } from './commands/init.ts'
import { runCommand } from './commands/run.ts'
import { doctorCommand } from './commands/doctor.ts'
import { approveCommand } from './commands/approve.ts'

export const PKG_VERSION = '0.21.0-alpha.0'

function printHelp(): void {
  process.stdout.write(`code-oz v${PKG_VERSION}

Usage: code-oz <command> [options]

Commands:
  init             Scaffold a code-oz project in the current directory
  run              Drive the active phase: DEFINE -> PLAN -> BUILD -> VERIFY
                     -> REVIEW. BUILD applies a per-task patch in an isolated
                     worktree; VERIFY runs the validation command; REVIEW
                     runs single-mode or panel cross-family review.
                     Multi-task PLAN.md cycles BUILD/VERIFY/REVIEW per task
                     until the cursor completes, then advances currentPhase
                     to ship after the final review approval. SHIP runtime
                     (artifact production beyond gate writer) lands in M17.
  approve          Approve the current phase of the active run
  resume           Resume the active run (alias for 'run --resume')
  doctor           Probe environment health
                     'doctor providers' - provider auth + CLI presence
                     'doctor tools'     - required external tools (rg)
                     'doctor git'       - git version (worktree subsystem)
                     'doctor run'       - read-only run inspector
  bench            Run a benchmark
                     'bench agent-gate' - Agent Gate Bench (governance gates;
                       measures the deterministic 'code-oz Fake' column)
  help             Show this help

Run 'code-oz <command> --help' for command-specific options.
Docs: https://github.com/omerakben/code-oz
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command) {
    printHelp()
    process.exit(1)
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${PKG_VERSION}\n`)
    return
  }

  const subArgs = args.slice(1)

  switch (command) {
    case 'init':
      await initCommand(subArgs)
      return
    case 'run':
      await runCommand(subArgs)
      return
    case 'resume':
      await runCommand(['--resume', ...subArgs])
      return
    case 'approve':
      await approveCommand(subArgs)
      return
    case 'doctor':
      await doctorCommand(subArgs)
      return
    case 'bench': {
      const benchSub = subArgs[0]
      if (benchSub === 'agent-gate') {
        const { benchAgentGateCommand } = await import('./commands/bench-agent-gate.ts')
        await benchAgentGateCommand(subArgs.slice(1))
        return
      }
      process.stderr.write(
        `code-oz bench: unknown benchmark '${benchSub ?? '(none)'}'. ` +
          `Available: agent-gate\n`,
      )
      process.exit(1)
      return
    }
    default:
      process.stderr.write(`code-oz: unknown command '${command}'\n\n`)
      printHelp()
      process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`code-oz: ${msg}\n`)
    process.exit(1)
  })
}
