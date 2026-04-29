// Pure preview helper. Same machinery as src/providers/invoke.ts uses
// pre-call (manifest builder + permissions intersection + metrics) but
// without invoking the adapter. The output is a snapshot of "what would be
// sent to the provider on this call, and what the audit-trail event would
// look like" — useful for `code-oz status --verbose` (M5+) and for
// debugging permission-violation reports.
//
// Doctor explicitly does NOT consume this — `doctor providers` runs outside
// any active run, never reads phase-bound files, and is auth-only. See
// docs/references/provider-contract.md "doctor side-effect rule."

import { buildManifest, type BuildManifestOptions } from './manifest.ts'
import type { PreparedProviderRequest, ProviderRequest } from './types.ts'

export interface ProviderPreview {
  readonly prepared: PreparedProviderRequest
}

/**
 * Build the prepared request without invoking the adapter. Path-safety,
 * permission intersection, content load + hashing, and the four context
 * metrics all run identically to the wrapper's pre-call path. Returns the
 * full PreparedProviderRequest so callers can inspect manifest entries,
 * metrics, and the would-be agent_invoked payload before deciding to
 * invoke.
 *
 * Throws ProviderError on the same conditions as buildManifest:
 * provider_permissions_violation for out-of-bounds files, provider_io_error
 * for unreadable files or path-safety violations.
 */
export async function previewProviderRequest(
  req: ProviderRequest,
  opts: BuildManifestOptions = {},
): Promise<ProviderPreview> {
  const prepared = await buildManifest(req, opts)
  return Object.freeze({ prepared })
}
