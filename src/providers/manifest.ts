// Manifest + permissions builder. Transforms a public ProviderRequest
// (paths-only) into the internal PreparedProviderRequest the wrapper layer
// passes to adapters. Three responsibilities:
//
//   1. Path safety — every file path must be relative or repo-anchored,
//      free of `..` segments before normalization (defense in depth), and
//      must not resolve outside the project root via symlinks. Mirrors
//      src/state/gates.ts.
//
//   2. Permission intersection — every file path must match the agent's
//      permissions.read upper bound. Out-of-bounds files surface a typed
//      provider_permissions_violation. Permissions are NEVER expanded into
//      file lists (rule 13 in agent-skill-format.md); they're upper-bound
//      checks only.
//
//   3. Content load + hashing + metrics — the wrapper is the only path
//      that reads bytes. After permissions intersection passes, the file
//      content is loaded, sha256-hashed, and sized; the four context
//      metrics (filesSent, bytesSent, tokensEstimate, fieldsRemovedByScope)
//      are computed for the agent_invoked event.

import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, normalize, relative, resolve } from 'node:path'
import { providerError } from './errors.ts'
import { estimateTokens } from './cost.ts'
import type {
  PreparedProviderRequest,
  ProviderContextMetrics,
  ProviderFile,
  ProviderRequest,
} from './types.ts'
import type { AgentManifest, AgentManifestEntry } from '../state/schemas.ts'

export interface BuildManifestOptions {
  /**
   * Project root used for relative-path resolution and symlink-escape
   * checks. When omitted, defaults to process.cwd(). The wrapper layer in
   * commit 7 supplies the run's project root from RunPaths.
   */
  readonly projectRoot?: string
}

/**
 * Public path-safety + permissions-aware manifest builder. Reads file
 * content for every path in the request, hashes + sizes each, validates
 * against the agent's permissions.read upper bound, and computes the four
 * context metrics.
 *
 * Throws ProviderError(provider_permissions_violation) on the first file
 * outside the upper bound (most useful failure mode for an interactive
 * agent: stop and tell the user which file violated, not "many files
 * violated, here's a list"). Throws ProviderError(provider_io_error) on
 * unreadable files; throws on path-safety violations with a clear rule.
 */
export async function buildManifest(
  req: ProviderRequest,
  opts: BuildManifestOptions = {},
): Promise<PreparedProviderRequest> {
  const projectRoot = opts.projectRoot ?? process.cwd()
  const projectRootReal = await realpath(projectRoot).catch(() => projectRoot)

  const files: ProviderFile[] = []
  const manifestEntries: AgentManifestEntry[] = []
  let droppedFieldCount = 0

  for (const ref of req.files) {
    if (ref.droppedFields !== undefined) {
      droppedFieldCount += ref.droppedFields.length
    }

    const absPath = await resolveAndCheckPath(ref.path, projectRoot, projectRootReal)
    const relPath = relative(projectRoot, absPath) || ref.path

    if (!isReadAllowed(relPath, req.agent.permissions.read)) {
      throw providerError(
        'provider_permissions_violation',
        `file is outside the agent's permissions.read upper bound`,
        [
          `narrow the file manifest in the phase logic for agent ${req.agent.name}`,
          `or broaden permissions.read in ${req.agent.file}`,
        ],
        `path=${relPath}, agent=${req.agent.name}, permissions.read=${JSON.stringify(req.agent.permissions.read)}`,
      )
    }

    let buf: Buffer
    try {
      buf = await readFile(absPath)
    } catch (err: unknown) {
      throw providerError(
        'provider_io_error',
        'failed to read file declared in provider request manifest',
        [`verify ${relPath} exists and is readable`],
        (err as Error).message,
      )
    }
    const sha256 = sha256Buffer(buf)
    const sizeBytes = buf.length

    files.push({ path: relPath, content: buf, sha256, sizeBytes })
    manifestEntries.push({ path: relPath, sha256, sizeBytes })
  }

  const manifest: AgentManifest = Object.freeze({
    files: Object.freeze(manifestEntries.map((e) => Object.freeze(e))),
  })

  const filesSent = files.length
  const bytesSent = files.reduce((s, f) => s + f.sizeBytes, 0)
  const tokensEstimate = estimateTokens({ prompt: req.prompt, files })
  const metrics: ProviderContextMetrics = Object.freeze({
    filesSent,
    bytesSent,
    tokensEstimate,
    fieldsRemovedByScope: droppedFieldCount,
  })

  const prepared: PreparedProviderRequest = Object.freeze({
    agent: req.agent,
    phase: req.phase,
    runId: req.runId,
    prompt: req.prompt,
    files: Object.freeze(files.map((f) => Object.freeze(f))),
    manifest,
    metrics,
    ...(req.model !== undefined ? { model: req.model } : {}),
    ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
  })

  return prepared
}

// --- helpers -----------------------------------------------------

function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Path-safety check on the raw input string + symlink-escape check on the
 * resolved real path. Mirrors src/state/gates.ts:validateArtifactSyncPath +
 * resolveArtifactPath.
 *
 * Returns the absolute path on success; throws ProviderError otherwise.
 */
async function resolveAndCheckPath(
  rawPath: string,
  projectRoot: string,
  projectRootReal: string,
): Promise<string> {
  if (rawPath === '') {
    throw providerError(
      'provider_permissions_violation',
      'manifest file path must be a non-empty string',
      ['remove the empty entry from ProviderRequest.files'],
    )
  }
  if (rawPath.includes('\\')) {
    throw providerError(
      'provider_permissions_violation',
      'manifest file path must use forward slashes',
      ['rewrite the path with forward slashes'],
      rawPath,
    )
  }

  // Reject `.` or `..` segments BEFORE normalization. After normalization,
  // `foo/../X` collapses to `X` and would otherwise pass — but the literal
  // `..` is a path-traversal attempt and must be refused regardless of how
  // it cancels out. Defense-in-depth mirroring src/state/gates.ts.
  const checkSrc = isAbsolute(rawPath) ? rawPath : rawPath
  const rawSegments = checkSrc.split('/')
  if (rawSegments.some((seg) => seg === '..')) {
    throw providerError(
      'provider_permissions_violation',
      'manifest file path must not contain `..` segments',
      ['rewrite the path without `..` traversal'],
      rawPath,
    )
  }

  const absPath = isAbsolute(rawPath) ? normalize(rawPath) : resolve(projectRoot, rawPath)

  // Check existence early so the symlink-escape resolution gets a real
  // target. ENOENT surfaces as provider_io_error with the offending path.
  try {
    await stat(absPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw providerError(
        'provider_io_error',
        'manifest file does not exist on disk',
        [`verify ${rawPath} exists relative to ${projectRoot}`],
        absPath,
      )
    }
    throw providerError(
      'provider_io_error',
      'failed to stat manifest file',
      ['check filesystem permissions on the project root'],
      (err as Error).message,
    )
  }

  // Symlink-escape: realpath the file and verify it's still inside the
  // project root.
  let absReal: string
  try {
    absReal = await realpath(absPath)
  } catch (err: unknown) {
    throw providerError(
      'provider_io_error',
      'failed to resolve manifest file via realpath',
      ['check filesystem permissions on the project root'],
      (err as Error).message,
    )
  }

  const rel = relative(projectRootReal, absReal)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw providerError(
      'provider_permissions_violation',
      'manifest file resolves outside the project root via symlinks',
      ['remove the symlink or move the target inside the project root'],
      `${absReal} is outside ${projectRootReal}`,
    )
  }

  return absPath
}

/**
 * Permission intersection. The agent's permissions.read is the upper bound
 * — '*' means "any file the runtime decides to send"; an array of glob
 * strings means "files matching at least one of these globs."
 *
 * Glob support for v0.1 is minimal: literal paths, `**` (any depth), and
 * `*` (single segment). Mirrors the agent-skills convention. More
 * sophisticated glob syntax can land later if real personas need it.
 */
function isReadAllowed(relPath: string, allowed: '*' | readonly string[]): boolean {
  if (allowed === '*') return true
  return allowed.some((pattern) => globMatches(relPath, pattern))
}

function globMatches(path: string, pattern: string): boolean {
  // Strip leading `./` from the pattern for ergonomic match against
  // resolved relative paths.
  const cleaned = pattern.startsWith('./') ? pattern.slice(2) : pattern
  const regexSrc = cleaned
    .replace(/[.+^${}()|\[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<DOUBLESTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLESTAR>>/g, '.*')
  const re = new RegExp(`^${regexSrc}$`)
  return re.test(path)
}

// Re-export the helper so other modules (preview, doctor, tests) can reuse
// the same intersection logic without duplicating glob semantics.
export { globMatches as _globMatches, isReadAllowed as _isReadAllowed }
