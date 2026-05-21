// AUDIT.md parser (brownfield entry-phase artifact).
//
// `parseAuditMarkdown` validates the document (via validateAuditMarkdown in
// audit-schema.ts) and, on success, extracts the structured AuditArtifact that
// PLAN's brownfield handoff consumes: frontmatter, localization entries +
// likely-files, the observed/proposed/unresolved reproduction split,
// constraints, and audit sources. On validation failure it throws
// AuditLoadError carrying the schema's issue list (mirrors parseSpec /
// SpecLoadError discipline).
//
// The Scientist sidecars (HYPOTHESES.md, OPEN_QUESTIONS.md) are NOT parsed
// here: they are written by the Scientist phase-tail and consumed by
// validateScientistSidecars at gate-preflight. This parser stays compatible
// with that flow (it never reads or rewrites the sidecars) but does not
// reimplement their parsing (rule 15 separation).

import { AuditLoadError } from './errors.ts'
import {
  validateAuditMarkdown,
  parseLocalizationCitation,
  extractSectionBullets,
  type AuditArtifact,
  type AuditLocalizationEntry,
  type AuditReproduction,
  type ValidateAuditOptions,
} from './audit-schema.ts'

export interface ParseAuditOptions extends ValidateAuditOptions {}

/**
 * Parse an AUDIT.md document into a frozen AuditArtifact. Throws AuditLoadError
 * (with the validator's frozen issues array) when the document is invalid.
 */
export function parseAuditMarkdown(raw: string, opts: ParseAuditOptions = {}): AuditArtifact {
  const result = validateAuditMarkdown(raw, opts)
  if (!result.ok || result.frontmatter === undefined) {
    // result.issues is guaranteed non-empty when !ok. If frontmatter parsed but
    // body issues remain, issues is still non-empty here.
    throw new AuditLoadError(
      result.issues.length > 0
        ? [...result.issues]
        : [
            {
              file: opts.file ?? 'AUDIT.md',
              code: 'audit_frontmatter_malformed',
              rule: 'AUDIT.md could not be parsed',
            },
          ],
    )
  }

  const bullets = extractSectionBullets(raw)

  // --- Localization → entries + likely-files -----------------------
  const localization: AuditLocalizationEntry[] = []
  const likely: string[] = []
  const seenPaths = new Set<string>()
  for (const text of bullets.localization) {
    const cite = parseLocalizationCitation(text)
    if (cite === null) continue // validator already rejected; defensive
    localization.push(
      Object.freeze({
        path: cite.path,
        startLine: cite.startLine,
        endLine: cite.endLine,
        rationale: cite.rationale,
        raw: text,
      }),
    )
    if (!seenPaths.has(cite.path)) {
      seenPaths.add(cite.path)
      likely.push(cite.path)
    }
  }

  // --- Reproduction split ------------------------------------------
  const proposed: string[] = []
  const observed: string[] = []
  const unresolved: string[] = []
  for (const text of bullets.reproduction) {
    const m = text.match(/^(Proposed|Observed|Unresolved):\s*(.*)$/i)
    if (m === null) continue // validator allows untagged? contract requires tags; skip defensively
    const kind = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (kind === 'proposed') proposed.push(value)
    else if (kind === 'observed') observed.push(value)
    else unresolved.push(value)
  }
  const reproduction: AuditReproduction = Object.freeze({
    proposed: Object.freeze(proposed),
    observed: Object.freeze(observed),
    unresolved: Object.freeze(unresolved),
  })

  return Object.freeze({
    title: 'AUDIT',
    frontmatter: result.frontmatter,
    localization: Object.freeze(localization),
    likelyFiles: Object.freeze(likely),
    reproduction,
    constraints: Object.freeze([...bullets.constraints]),
    auditSources: Object.freeze([...bullets.auditSources]),
  })
}

// Re-export the artifact types so consumers can import the parser surface from
// one module (PLAN's brownfield handoff in C7 imports from here).
export type {
  AuditArtifact,
  AuditFrontmatter,
  AuditLocalizationEntry,
  AuditReproduction,
} from './audit-schema.ts'
