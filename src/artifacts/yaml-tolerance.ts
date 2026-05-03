// Shared YAML-tolerance helpers used by SPEC, PLAN, and SOURCE_CHECK
// section-level YAML adapters.
//
// Three artifact validators (`spec.ts`, `plan.ts`, `source-check.ts`) accept
// LLM drift where authors emit YAML at the section level — top-level keys
// (`goals:` / `sources:` / `coverage:` / etc.) with indented `- bullet` list
// values or inline flow lists — instead of canonical `## Heading\n\n- bullet`
// Markdown sections. The adapters in each parser pre-rewrite that drift back
// into canonical Markdown before strict parsing.
//
// Every adapter needs the same two helpers to parse inline flow values like
// `[a, b, c]` or comma-separated bare values like `a, b, c`:
//
//   1. A quote-aware top-level comma splitter that respects single- and
//      double-quoted scalars and backslash escapes inside them.
//   2. A flow-list parser that strips an optional `[...]` wrapper, splits on
//      top-level commas, trims, and unquotes leaf values.
//
// Both bodies were identical across all three parsers (named with per-file
// suffixes `*Plan` / `*SourceCheck` for readability). DRY-at-3x per the
// project-wide coding standard — this module owns the canonical
// implementation; the parsers import from here.

/**
 * Quote-aware top-level comma splitter. Splits on top-level commas only,
 * respecting single- and double-quoted scalars and backslash escapes inside
 * them.
 *
 * Examples:
 *   `'a, b', c`       -> [`'a, b'`, ` c`]
 *   `"\"yes, now\""`  -> [`"\"yes, now\""`]   (escape doesn't toggle quote state)
 *
 * Required to honour the "rewrite shape, not semantics" boundary — naive
 * split would silently turn one quoted scalar into multiple accepted bullets
 * (Codex review block-push findings, rounds 1 and 2, on PR #10).
 */
export function splitTopLevelCommas(s: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    // Backslash escape — preserve verbatim, don't toggle quote state.
    // Honors `\"` inside double-quoted scalars and `\'` inside single-quoted
    // scalars; the escaped char passes through to the bullet text untouched.
    if (ch === '\\' && i + 1 < s.length) {
      current += ch + s[i + 1]
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === ',' && !inSingle && !inDouble) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.length > 0) out.push(current)
  return out
}

/**
 * Parse an inline YAML list value into bare strings. Accepts `[a, b, c]`
 * flow-style YAML or comma-separated bare values. Splits on top-level commas
 * only — quoted scalars containing commas are preserved as single items.
 * Leaf values are trimmed and unquoted (single or double).
 */
export function parseInlineList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.length === 0) return []
  const flow = trimmed.match(/^\[(.*)\]$/)
  const inner = flow !== null ? flow[1]! : trimmed
  return splitTopLevelCommas(inner)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0)
}
