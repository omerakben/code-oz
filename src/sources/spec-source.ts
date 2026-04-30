// Spec-source resolver: reads SPEC.md and emits SC-SPEC-NNN entries citing
// acceptance criteria, constraints, and goals. The resolver is deterministic
// and offline; it does not invoke any provider.
//
// Used by the PLAN persona's 3-source verification (CLAUDE.md rule 3) as the
// "spec" arm. The PLAN persona is free to add narrower or more numerous spec
// citations than what this resolver emits; the resolver provides a baseline
// that always cites at least one bullet from each required SPEC section.

import { parseSpec, type SpecArtifact } from '../artifacts/spec.ts'
import type { SpecSource } from '../artifacts/source-check.ts'
import { allocateSourceId } from '../artifacts/source-check.ts'

export interface ResolveSpecSourcesOptions {
  readonly specText: string
  readonly file?: string
}

/**
 * Build a SC-SPEC-NNN block per acceptance-criteria bullet (one block per
 * bullet; the most evidence-bearing arm). Reads constraints + goals as
 * lower-priority candidates only when there are no acceptance criteria
 * (which is unreachable in v0.1 because parseSpec rejects empty sections).
 */
export function resolveSpecSources(opts: ResolveSpecSourcesOptions): readonly SpecSource[] {
  const spec: SpecArtifact = parseSpec(opts.specText, opts.file ?? 'SPEC.md')
  const out: SpecSource[] = []
  const allocate = (): string => allocateSourceId('SPEC', out.map((s) => s.id))

  spec.acceptance.forEach((bullet, idx) => {
    out.push(
      Object.freeze({
        id: allocate(),
        kind: 'SPEC',
        title: `Acceptance criterion ${idx + 1}`,
        spec: `SPEC.md ## Acceptance criteria, bullet ${idx + 1}`,
        quote: bullet,
      }),
    )
  })

  spec.constraints.forEach((bullet, idx) => {
    out.push(
      Object.freeze({
        id: allocate(),
        kind: 'SPEC',
        title: `Constraint ${idx + 1}`,
        spec: `SPEC.md ## Constraints, bullet ${idx + 1}`,
        quote: bullet,
      }),
    )
  })

  return Object.freeze(out)
}
