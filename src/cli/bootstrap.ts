// Shared CLI bootstrap. Every command that needs the agent registry imports
// this module so the bundled-defaults asset imports stay alive across the
// compiled binary's tree-shaker. Closes the M2 commit fae4064 deferred-liveness
// loose thread.
//
// Two registries live here: AgentRegistry (loaded personas + project-local
// overrides) and ProviderRegistry (the four IAgentProvider adapters). Both
// keepalives matter — without the explicit imports below, the compiled
// binary's tree-shaker would drop unused adapter modules and the registry
// would be empty in production.
//
// The bootstrap is also where commands resolve their CodeOzPaths once. M5+
// commands (`run`, `status`, `resume`) will share this same shape.

import { loadBundledDefaults } from '../agents/bundled-defaults.ts'
import { loadRegistry, type AgentRegistry } from '../agents/loader.ts'
import { paths, type CodeOzPaths } from '../paths.ts'

import { ProviderRegistry } from '../providers/registry.ts'
import { FakeProvider } from '../providers/fake.ts'
import { ClaudeProvider } from '../providers/claude.ts'
import { CodexProvider } from '../providers/codex.ts'
import { GeminiProvider } from '../providers/gemini.ts'
import type { Runner } from '../providers/runner.ts'

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

export interface ProviderRegistryOptions {
  /** Inject a runner shared across the subprocess-backed adapters (tests only). */
  readonly runner?: Runner
}

/**
 * Build the ProviderRegistry containing every v0.1 adapter. Imported by
 * `code-oz doctor providers` (M4 commit 10) and by M5+ phase logic that
 * needs to call provider.invoke() through the wrapper.
 *
 * Importing all four adapter modules in this file is what keeps them alive
 * in the compiled binary — same keepalive pattern that closes M2's
 * fae4064 deferred-liveness loose thread for bundled defaults.
 *
 * The runner option lets tests share one mock runner across both
 * subprocess-backed adapters (claude + codex) without instantiating them
 * separately. Production callers omit it so each adapter uses defaultRunner.
 */
export function getProviderRegistry(opts: ProviderRegistryOptions = {}): ProviderRegistry {
  return new ProviderRegistry({
    providers: [
      new FakeProvider(),
      new ClaudeProvider(opts.runner !== undefined ? { runner: opts.runner } : {}),
      new CodexProvider(opts.runner !== undefined ? { runner: opts.runner } : {}),
      new GeminiProvider(),
    ],
  })
}
