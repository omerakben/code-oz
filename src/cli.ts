#!/usr/bin/env bun
import { initCommand } from './commands/init.ts'
import { runCommand } from './commands/run.ts'
import { doctorCommand } from './commands/doctor.ts'
import { approveCommand } from './commands/approve.ts'

export const PKG_VERSION = '0.4.0-alpha.0'

function printHelp(): void {
  process.stdout.write(`code-oz v${PKG_VERSION}

Usage: code-oz <command> [options]

Commands:
  init             Scaffold a code-oz project in the current directory
  run              Execute the phase pipeline (M5+, stub in v0.1-alpha.0)
  approve          Approve the current phase of the active run
  doctor           Probe provider health (subcommand: 'doctor providers')
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
    case 'approve':
      await approveCommand(subArgs)
      return
    case 'doctor':
      await doctorCommand(subArgs)
      return
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
