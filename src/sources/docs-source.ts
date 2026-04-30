// Docs-source resolver: returns SC-DOC-NNN blocks for library/API
// documentation. Reads from .code-oz/cache/docs/<library>.md when present;
// FakeProvider e2e never networks (Codex M6 decision 7).
//
// Live Context7 fetch is W3+ scope. M6 ships the cache reader and the
// SC-DOC-NONE-NNN no-library path.

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocSource, DocNoneSource } from '../artifacts/source-check.ts'
import { allocateSourceId } from '../artifacts/source-check.ts'

export interface DocsSearchSpec {
  /** Human-readable title for the H3 block. */
  readonly title: string
  /** Library name; e.g. 'bun'. */
  readonly library: string
  /** URL of the upstream doc page (used in the H3 block's `URL` bullet). */
  readonly url: string
  /** Section heading or anchor inside the cached page. */
  readonly section: string
  /** Why this doc is relevant. */
  readonly why: string
  /** When non-empty and the cache file is missing, returns SC-DOC-NONE-NNN
   *  with this rationale instead of throwing. */
  readonly fallbackNoneRationale?: string
}

export interface NoLibraryRationale {
  readonly title: string
  readonly whyExplicit: string
}

export interface ResolveDocsSourcesOptions {
  /** Library searches with cache hits expected. */
  readonly searches: readonly DocsSearchSpec[]
  /** Explicit no-library rationales (always emitted as SC-DOC-NONE-NNN). */
  readonly noLibrary?: readonly NoLibraryRationale[]
  /** Cache directory; usually `.code-oz/cache/docs`. */
  readonly cacheDir: string
}

export type DocsSource = DocSource | DocNoneSource

export async function resolveDocsSources(
  opts: ResolveDocsSourcesOptions,
): Promise<readonly DocsSource[]> {
  const out: DocsSource[] = []
  const allocate = (kind: 'DOC' | 'DOC-NONE'): string =>
    allocateSourceId(kind, out.map((s) => s.id))

  for (const spec of opts.searches) {
    const cachePath = join(opts.cacheDir, `${spec.library}.md`)
    const present = await fileExists(cachePath)
    if (present) {
      out.push(
        Object.freeze<DocSource>({
          id: allocate('DOC'),
          kind: 'DOC',
          title: spec.title,
          library: spec.library,
          url: `${spec.url} (cached at ${cachePath})`,
          section: spec.section,
          why: spec.why,
        }),
      )
    } else if (spec.fallbackNoneRationale !== undefined) {
      out.push(
        Object.freeze<DocNoneSource>({
          id: allocate('DOC-NONE'),
          kind: 'DOC-NONE',
          title: spec.title,
          whyExplicit: spec.fallbackNoneRationale,
        }),
      )
    } else {
      throw new Error(
        `docs cache miss: ${cachePath} not found and no fallback rationale provided`,
      )
    }
  }

  for (const explicit of opts.noLibrary ?? []) {
    out.push(
      Object.freeze<DocNoneSource>({
        id: allocate('DOC-NONE'),
        kind: 'DOC-NONE',
        title: explicit.title,
        whyExplicit: explicit.whyExplicit,
      }),
    )
  }

  return Object.freeze(out)
}

/**
 * Read the cached doc text for `library`. Returns null when missing. The
 * caller decides whether to surface as a NONE block or fail loudly.
 */
export async function readDocsCache(cacheDir: string, library: string): Promise<string | null> {
  const cachePath = join(cacheDir, `${library}.md`)
  try {
    return await readFile(cachePath, 'utf8')
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}
