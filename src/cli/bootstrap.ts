// Shared CLI bootstrap. Every command that needs the agent registry imports
// this module so the bundled-defaults asset imports stay alive across the
// compiled binary's tree-shaker. Closes the M2 commit fae4064 deferred-liveness
// loose thread.
//
// The bootstrap is also where commands resolve their CodeOzPaths once. M5+
// commands (`run`, `status`, `resume`) will share this same shape.

import { loadBundledDefaults } from '../agents/bundled-defaults.ts'
import { loadRegistry, type AgentRegistry } from '../agents/loader.ts'
import { paths, type CodeOzPaths } from '../paths.ts'

export interface CliContext {
  readonly cwd: string
  readonly paths: CodeOzPaths
  readonly registry: AgentRegistry
}

export interface BootstrapOptions {
  readonly cwd?: string
}

/**
 * Build a CliContext: resolve `.code-oz/` paths against the cwd, load the
 * bundled default personas, merge any project-local overrides at
 * `.code-oz/agents/`, and return the registry as part of the context.
 *
 * Throws AgentLoadError when project-local overrides fail validation.
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<CliContext> {
  const cwd = opts.cwd ?? process.cwd()
  const p = paths(cwd)
  const defaults = await loadBundledDefaults()
  const registry = await loadRegistry({
    defaults,
    projectDir: p.agents,
    cwd,
  })
  return Object.freeze({
    cwd,
    paths: p,
    registry,
  })
}
