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

import { capabilityOf } from '../providers/capabilities.ts'
import { ProviderRegistry } from '../providers/registry.ts'
import { FakeProvider } from '../providers/fake.ts'
import { ClaudeProvider } from '../providers/claude.ts'
import { CodexProvider } from '../providers/codex.ts'
import { GeminiProvider } from '../providers/gemini.ts'
import type { Runner } from '../providers/runner.ts'
import {
  PROVIDER_IDS,
  type IAgentProvider,
  type ProviderFamily,
  type ProviderId,
} from '../providers/types.ts'

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

// --- runtime provider override (commit 9) -------------------------

export type ProviderOverride = 'fake'

export interface BuildProviderRegistryOptions extends ProviderRegistryOptions {
  /**
   * Runtime override for the provider routing surface. v0.1 accepts only
   * `'fake'`: every ProviderId resolves to a single shared FakeProvider
   * instance, with the per-id `family` set to match the id (so the
   * registry's familyOf() authority still answers correctly per id).
   *
   * The shared FakeProvider lets test fixtures pre-script expectations on
   * one instance and have them consumed regardless of the agent's declared
   * provider — which is the whole point of this override (CODEX_RESPONSE_M5
   * locked it in commit 9 as a separate, explicit CLI surface).
   *
   * Returns the shared FakeProvider via `fakeProvider` so callers (commit
   * 10's e2e) can call `.expect(...)` to script responses before invoking.
   */
  readonly providerOverride?: ProviderOverride
}

export interface BuildProviderRegistryResult {
  readonly registry: ProviderRegistry
  /**
   * The shared FakeProvider instance when providerOverride === 'fake';
   * undefined otherwise. Tests use this to script expectations.
   */
  readonly fakeProvider?: FakeProvider
}

/**
 * Build a ProviderRegistry, optionally overriding all routing to a single
 * shared FakeProvider. When no override is set, behaves identically to
 * getProviderRegistry().
 */
export function buildProviderRegistry(
  opts: BuildProviderRegistryOptions = {},
): BuildProviderRegistryResult {
  if (opts.providerOverride === 'fake') {
    const fake = new FakeProvider()
    const aliased: IAgentProvider[] = (PROVIDER_IDS as readonly ProviderId[]).map(
      (id) => aliasFakeProvider(id, fake),
    )
    return Object.freeze({
      registry: new ProviderRegistry({ providers: aliased }),
      fakeProvider: fake,
    })
  }
  const reg = getProviderRegistry(opts)
  return Object.freeze({ registry: reg })
}

function aliasFakeProvider(targetId: ProviderId, target: FakeProvider): IAgentProvider {
  // Per-id family equals the id (claude → claude, codex → codex, ...). This
  // preserves the cross-family REVIEW invariant: a build call routed to the
  // shared FakeProvider under id 'claude' has family 'claude', and a review
  // call under id 'codex' has family 'codex' — `familyOf(...)` answers per
  // id, never delegating to the underlying FakeProvider's intrinsic family.
  const family: ProviderFamily = targetId as ProviderFamily
  // Per-id capability mirrors the family pattern: the alias declares the
  // default capability for `targetId` (resolved via the pure `capabilityOf`
  // lookup). If the registry is constructed with capabilityOverrides for
  // `targetId`, the registry's adapter cross-check fails — same shape as
  // the family check, on purpose. Tests that need a non-default capability
  // for an aliased FakeProvider construct an inline IAgentProvider literal
  // rather than going through this helper. (M11 Codex Decision H lock:
  // no FakeProvider({ capability }) seam.)
  return {
    id: targetId,
    family,
    capability: capabilityOf(targetId),
    invoke: (req) => target.invoke(req),
    health: async () => {
      const h = await target.health()
      return { ...h, provider: targetId }
    },
  }
}
