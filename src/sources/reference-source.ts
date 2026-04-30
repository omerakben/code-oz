// Reference-source resolver: uses the repo-context tools (glob + grep) to
// locate reference patterns in the influence library or the project itself.
// Emits SC-REF-NNN blocks for found matches; SC-REF-NONE-NNN with rationale
// when nothing is found and the persona explicitly recorded a search.
//
// This resolver is a programmatic helper. The PLAN persona is the authority
// on which patterns are reusable; the resolver structures the searches and
// records what was tried.

import { execGlob } from '../tools/repo-context/glob.ts'
import { execGrep } from '../tools/repo-context/grep.ts'
import type {
  RefNoneSource,
  RefSource,
} from '../artifacts/source-check.ts'
import { allocateSourceId } from '../artifacts/source-check.ts'

export interface ReferenceSearchSpec {
  /** Human-readable title for the H3 source block. */
  readonly title: string
  /** Glob pattern (relative to roots). */
  readonly globPattern?: string
  /** grep pattern. Either globPattern or grepPattern is required. */
  readonly grepPattern?: string
  /** Roots to search; defaults to current working directory. */
  readonly roots?: readonly string[]
  /** When non-empty and `globPattern`/`grepPattern` find nothing, the
   *  resolver returns a NONE block with this rationale. */
  readonly noneRationale?: string
  /** Optional explanation for why this reference is relevant when found. */
  readonly whyOnFound?: string
}

export interface ResolveReferenceSourcesOptions {
  readonly searches: readonly ReferenceSearchSpec[]
  readonly projectRoot: string
  readonly maxResults?: number
  readonly maxBytesPerResult?: number
  readonly timeoutMs?: number
}

export type ReferenceSource = RefSource | RefNoneSource

/**
 * Run each search in order. For each search:
 *   - run glob first (when pattern present), else grep
 *   - if results, emit a SC-REF-NNN block citing the first match
 *   - if no results and noneRationale is set, emit SC-REF-NONE-NNN
 *   - if no results and no rationale, the search contributes nothing
 *
 * Returns the aggregate list of source blocks (can be empty).
 */
export async function resolveReferenceSources(
  opts: ResolveReferenceSourcesOptions,
): Promise<readonly ReferenceSource[]> {
  const out: ReferenceSource[] = []
  const allocate = (kind: 'REF' | 'REF-NONE'): string =>
    allocateSourceId(kind, out.map((s) => s.id))

  const maxResults = opts.maxResults ?? 50
  const maxBytesPerResult = opts.maxBytesPerResult ?? 16_384
  const timeoutMs = opts.timeoutMs ?? 5_000
  const effectiveRoots = opts.searches[0]?.roots && opts.searches[0]!.roots!.length > 0
    ? [...opts.searches[0]!.roots!]
    : [opts.projectRoot]

  for (const spec of opts.searches) {
    if (!spec.globPattern && !spec.grepPattern) {
      throw new Error(`reference search "${spec.title}" requires globPattern or grepPattern`)
    }
    const roots = spec.roots && spec.roots.length > 0 ? [...spec.roots] : effectiveRoots
    let firstHit: { path: string; line?: number } | null = null
    let triedDescription = ''
    if (spec.globPattern !== undefined) {
      triedDescription = `glob '${spec.globPattern}' in ${roots.join(', ')}`
      try {
        const result = await execGlob(
          { pattern: spec.globPattern },
          { maxResults, maxBytesPerResult, timeoutMs, projectRoot: opts.projectRoot, effectiveRoots: roots },
        )
        if (result.paths.length > 0) firstHit = { path: result.paths[0]! }
      } catch {
        // tool failures are surfaced via NONE rationale below
      }
    }
    if (firstHit === null && spec.grepPattern !== undefined) {
      triedDescription = `grep '${spec.grepPattern}' in ${roots.join(', ')}`
      try {
        const result = await execGrep(
          { pattern: spec.grepPattern },
          { maxResults, maxBytesPerResult, timeoutMs, projectRoot: opts.projectRoot, effectiveRoots: roots },
        )
        if (result.matches.length > 0) {
          firstHit = { path: result.matches[0]!.path, line: result.matches[0]!.line }
        }
      } catch {
        // tool failures surfaced via NONE rationale
      }
    }

    if (firstHit !== null) {
      out.push(
        Object.freeze<RefSource>({
          id: allocate('REF'),
          kind: 'REF',
          title: spec.title,
          path: firstHit.path,
          lines: firstHit.line !== undefined ? `${firstHit.line}` : '-',
          why: spec.whyOnFound ?? `match found via ${triedDescription}`,
        }),
      )
    } else if (spec.noneRationale !== undefined) {
      out.push(
        Object.freeze<RefNoneSource>({
          id: allocate('REF-NONE'),
          kind: 'REF-NONE',
          title: spec.title,
          searched: triedDescription,
          result: 'no relevant pattern found.',
          whyExplicit: spec.noneRationale,
        }),
      )
    }
  }
  return Object.freeze(out)
}
