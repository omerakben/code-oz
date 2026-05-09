// `--provider fake` warning surface (M16 C11).
//
// Why: `--provider fake` is a real production CLI flag (M16 C2 unblocked
// it for fake-replay fixtures). Accidental production use of the override
// would replace every model call with a scripted reply — silently — and
// any decision the operator makes off that output is not real evidence.
// CI logs need a loud, greppable signal.
//
// What: a shared helper module for the two surfaces:
//
//   1. `printFakeProviderBanner(stream)` — writes the LOUD stderr banner
//      named in C11. Pure I/O; no events, no runId required.
//
//   2. `recordFakeProviderWarning({ runPaths, runId, fakeScriptPath })` —
//      appends one `fake_provider_warning_emitted` event to events.jsonl
//      under the per-run lock (mirrors every other appendEvent caller).
//
// Both surfaces are designed to fire ONCE per `code-oz run` invocation,
// not once per dispatcher. The caller (`runCommand`) uses an in-process
// guard flag for the banner; the event is similarly emitted at most once
// per invocation by the same guard.
//
// The banner text is exact and pinned by the test suite: changes need a
// follow-up commit (CI greps for the LOUD divider line).

import { appendEvent, type EventLogPaths } from '../state/events.ts'

/** Exact banner text. The "=" divider count + sentence content are
 *  load-bearing for downstream log-grep tooling; never change them
 *  without a paired commit on tests/cli-fake-provider-warning.test.ts. */
export const FAKE_PROVIDER_BANNER_DIVIDER =
  '============================================================' as const

export const FAKE_PROVIDER_BANNER_LINES: readonly string[] = Object.freeze([
  FAKE_PROVIDER_BANNER_DIVIDER,
  'WARNING: --provider fake is active',
  'This is a TEST-ONLY provider that returns scripted responses.',
  'NEVER use --provider fake in production or shipping decisions.',
  FAKE_PROVIDER_BANNER_DIVIDER,
])

/**
 * Write the banner to a stderr-like stream. Default target is
 * `process.stderr`. Tests inject a buffered NodeJS.WritableStream-like
 * shim to capture the bytes without touching the real stderr.
 */
export function printFakeProviderBanner(
  stream: { write: (chunk: string) => boolean | void } = process.stderr,
): void {
  for (const line of FAKE_PROVIDER_BANNER_LINES) {
    stream.write(line + '\n')
  }
}

export interface RecordFakeProviderWarningOptions {
  readonly eventPaths: EventLogPaths
  readonly runId: string
  /** Optional path to the JSONL fake-replay script when --fake-script was
   *  set alongside --provider fake. */
  readonly fakeScriptPath?: string
  /** Test-only seam to inject a deterministic timestamp (matches the
   *  pattern used by appendEvent callers elsewhere in the spine). */
  readonly now?: () => string
}

/**
 * Append one `fake_provider_warning_emitted` event under the per-run
 * lock. Idempotency is the caller's responsibility — `runCommand`
 * tracks emission via an in-process flag so two parallel dispatcher
 * pre-routes inside the same invocation cannot double-emit.
 *
 * Throws on validation failure (mirrors every other appendEvent
 * caller). Expected to be silent on the happy path.
 */
export async function recordFakeProviderWarning(
  opts: RecordFakeProviderWarningOptions,
): Promise<void> {
  const ts = (opts.now ?? (() => new Date().toISOString()))()
  const event = {
    version: 1 as const,
    type: 'fake_provider_warning_emitted' as const,
    ts,
    runId: opts.runId,
    providerAlias: 'fake' as const,
    providerFamily: 'fake' as const,
    ...(opts.fakeScriptPath !== undefined ? { fakeScriptPath: opts.fakeScriptPath } : {}),
  }
  await appendEvent(opts.eventPaths, event)
}
