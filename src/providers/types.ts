// Provider contract — pinned in docs/references/provider-contract.md.
//
// This module defines the public types every adapter (FakeProvider, Claude,
// Codex, Gemini) implements and every wrapper-layer module consumes. The
// load-bearing piece is the request DTO split:
//
//   - ProviderRequest:        paths-only, what phase logic constructs.
//   - PreparedProviderRequest: content + manifest + metrics, what the
//                              wrapper produces and adapters consume.
//
// Phase code never loads file content — only the wrapper layer reads bytes,
// and only after permissions intersection. This enforces non-negotiable rule
// 13 (privacy by default; explicit file manifests) by construction.

import type { AgentDefinition } from '../agents/schema.ts'
import type { CompanyRole } from '../agents/role.ts'
import type { Phase } from '../state/schemas.ts'
import type { AgentManifest } from '../state/schemas.ts'
import type { ProviderCapability } from './capabilities.ts'

// --- identity ------------------------------------------------------

export const PROVIDER_IDS = ['claude', 'codex', 'gemini', 'fake', 'xai'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

// ProviderFamily groups adapters that count as the same family for
// cross-family REVIEW enforcement (rule 2). In v0.1 every ProviderId maps
// to its same-named family. In W3+ when claude-cli vs anthropic-api adapters
// land, both share family: 'claude' and REVIEW correctly rejects them as
// same-family.
//
// The default ProviderId -> ProviderFamily mapping lives in
// src/providers/families.ts so that load-time code (src/agents/loader.ts,
// which runs before any registry exists) and runtime code (the registry's
// instance method) share a single source of truth.
export const PROVIDER_FAMILIES = ['claude', 'codex', 'gemini', 'fake', 'xai'] as const
export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number]

// --- request DTOs --------------------------------------------------

/**
 * Paths-only file reference. Phase logic constructs these without ever
 * loading content — the wrapper layer is the only path that reads bytes,
 * and only after permissions intersection passes.
 */
export interface ProviderFileRef {
  /** Absolute path or repo-relative path. The wrapper normalizes. */
  readonly path: string
  /**
   * Optional: phase logic recorded which agent-frontmatter or persona-body
   * fields it omitted relative to the upper-bound permissions.read scope.
   * Counted into the fieldsRemovedByScope metric on agent_invoked events.
   */
  readonly droppedFields?: readonly string[]
}

/**
 * Public provider request — what phase logic constructs and passes to the
 * wrapper. Files are paths only; content is never inlined here.
 */
export interface ProviderRequest {
  readonly agent: AgentDefinition
  readonly phase: Phase
  readonly runId: string
  readonly prompt: string
  readonly files: readonly ProviderFileRef[]
  readonly model?: string
  readonly maxOutputTokens?: number
  /**
   * M13 (Codex Q9 lock, CODEX_RESPONSE_M13.md, thread 019de672): explicit
   * `CompanyRole` identity for per-role budget gating + per-role soft
   * warnings. The six bundled-role invocation sites populate this from
   * `canonicalRoleFromAgent` (`src/agents/role.ts`). Synthetic debate
   * opponents and project-local personas omit it; their invocations are
   * still counted against global + per-phase budgets (rule 19), just not
   * against a per-role cap.
   *
   * Tightened from `string` to `CompanyRole | undefined` after the M13
   * implementation review (CODEX_REVIEW_M13.md fix-soon #1 closure):
   * `M12_COMPANY_ROLES` + `CompanyRole` were moved to `src/agents/role.ts`
   * (leaf module, no upstream imports), letting this file import the
   * type directly without re-introducing the cycle. The runtime event
   * validator at `src/state/events.ts` still enforces the same set —
   * type tightening is a compile-time guard, not a runtime change.
   */
  readonly role?: CompanyRole
  /**
   * 09-byterover-cli B3 (Codex thread `019e1318`): orchestrator-operation
   * correlation id. Set by fan-out call sites (REVIEW panel via the
   * production-seam invoker; debate runtime via `requestDebate`) so each
   * `agent_invoked` / `agent_completed` event records the parent
   * orchestrator step. Project-local personas, single-call phase
   * invocations, and synthetic debate opponents that do not belong to a
   * fan-out parent omit it. The wrapper writes the field through verbatim
   * (`src/providers/invoke.ts`); the validator at `src/state/events.ts`
   * accepts only the canonical `T-NNN` task-id pattern when present.
   * Forward-compat: optional, so existing readers parse new events
   * identically (M10/M12/M13 precedent).
   */
  readonly parentTaskId?: string
}

/**
 * A file the wrapper has loaded and hashed. Adapters consume these via
 * PreparedProviderRequest; phase code never sees them.
 */
export interface ProviderFile {
  readonly path: string
  readonly content: Buffer
  readonly sha256: string
  readonly sizeBytes: number
}

export interface ProviderContextMetrics {
  readonly filesSent: number
  readonly bytesSent: number
  readonly tokensEstimate: number
  readonly fieldsRemovedByScope: number
}

/**
 * Internal prepared request — what the wrapper produces and adapters
 * consume. Carries the loaded content, the audit-trail manifest, and the
 * four context metrics that land on agent_invoked events.
 */
export interface PreparedProviderRequest {
  readonly agent: AgentDefinition
  readonly phase: Phase
  readonly runId: string
  readonly prompt: string
  readonly files: readonly ProviderFile[]
  readonly manifest: AgentManifest
  readonly metrics: ProviderContextMetrics
  readonly model?: string
  readonly maxOutputTokens?: number
}

// --- streaming events ---------------------------------------------

export interface ProviderToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'budget_exceeded'
  | 'error'

export interface ProviderResponse {
  readonly content: string
  /**
   * Present only when the adapter has a real usage value from the upstream
   * API. Wrappers MUST NOT post-count tokens from streamed text and report
   * them as tokensUsed (rule 4 in docs/references/provider-contract.md).
   */
  readonly tokensUsed?: number
  readonly toolCalls?: readonly ProviderToolCall[]
  readonly model: string
  readonly stopReason: StopReason
}

export type ProviderEvent =
  | { readonly type: 'turn_started'; readonly model: string }
  | { readonly type: 'content_chunk'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ProviderToolCall }
  | { readonly type: 'tool_result'; readonly result: unknown }
  | { readonly type: 'turn_completed'; readonly response: ProviderResponse }

// --- health -------------------------------------------------------

export type AuthStatus = 'ok' | 'missing' | 'expired' | 'unsupported' | 'unknown'

export interface ProviderHealthError {
  readonly code: string
  readonly rule: string
  readonly detail?: string
}

export interface ProviderHealth {
  readonly provider: ProviderId
  readonly authStatus: AuthStatus
  readonly modelDefaultAvailable: boolean
  readonly latencyMs?: number
  readonly lastError?: ProviderHealthError
}

// --- the interface ------------------------------------------------

/**
 * The contract every adapter implements. Adapters are stateless: every
 * invoke() call reads OAuth fresh, builds the request, returns a stream.
 * No shared mutable state across calls.
 *
 * Adapters never:
 *  - write events.jsonl or any gate file (the wrapper does)
 *  - enforce permissions.read (the wrapper does)
 *  - hold the per-run lock across a network call (the wrapper does, briefly)
 *  - post-count tokens from streamed text and report them as tokensUsed
 */
export interface IAgentProvider {
  readonly id: ProviderId
  readonly family: ProviderFamily
  /**
   * Static capability record. Each adapter declares its capability by
   * reading from `capabilityOf(this.id)` so the data is not duplicated
   * across adapter source and the canonical defaults table. Registry
   * registration cross-checks this value against the registry-resolved
   * capability (defaults + optional overrides) under structural equality
   * to prevent capability laundering — same anti-laundering pattern as
   * the family check, with structural equality replacing the family
   * primitive comparison. Pinned in M11 (CLAUDE.md rule 20: provider
   * eligibility authority).
   */
  readonly capability: ProviderCapability
  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent>
  health(): Promise<ProviderHealth>
}
