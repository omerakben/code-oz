import { parse as parseYaml } from 'yaml'
import { AgentLoadError } from './errors.ts'

export interface ParsedFrontmatter {
  readonly data: Readonly<Record<string, unknown>>
  readonly body: string
}

const BOM = '﻿'

// Two patterns: empty frontmatter (---\n---) and non-empty (---\n...\n---).
// Files (after BOM strip) must START with --- delimiter. Trailing whitespace
// on delimiter lines is tolerated; both LF and CRLF endings are accepted.
const FRONTMATTER_EMPTY = /^---[ \t]*\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/
const FRONTMATTER_FULL = /^---[ \t]*\r?\n([\s\S]+?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

export function parseFrontmatter(raw: string, file: string): ParsedFrontmatter {
  const stripped = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw

  let yamlText: string
  let body: string

  const emptyMatch = stripped.match(FRONTMATTER_EMPTY)
  if (emptyMatch) {
    yamlText = ''
    body = emptyMatch[1] ?? ''
  } else {
    const fullMatch = stripped.match(FRONTMATTER_FULL)
    if (!fullMatch) {
      if (!stripped.startsWith('---')) {
        throw new AgentLoadError([
          {
            file,
            code: 'frontmatter_missing_delimiter',
            rule: 'file must begin with --- frontmatter delimiter',
          },
        ])
      }
      throw new AgentLoadError([
        {
          file,
          code: 'frontmatter_missing_delimiter',
          rule: 'frontmatter has no closing --- delimiter',
        },
      ])
    }
    yamlText = fullMatch[1] ?? ''
    body = fullMatch[2] ?? ''
  }

  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    const isDuplicateKey = /unique|duplicate/i.test(detail)
    throw new AgentLoadError([
      {
        file,
        code: isDuplicateKey ? 'frontmatter_duplicate_key' : 'frontmatter_invalid_yaml',
        rule: isDuplicateKey
          ? 'frontmatter must not have duplicate YAML keys'
          : 'frontmatter must be valid YAML',
        detail,
      },
    ])
  }

  if (parsed === null || parsed === undefined) {
    throw new AgentLoadError([
      {
        file,
        code: 'frontmatter_not_object',
        rule: 'frontmatter must be a non-empty YAML object',
        detail: 'frontmatter parsed to null/undefined',
      },
    ])
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentLoadError([
      {
        file,
        code: 'frontmatter_not_object',
        rule: 'frontmatter must be a YAML object (key/value pairs)',
        detail: `parsed as ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      },
    ])
  }

  return { data: parsed as Record<string, unknown>, body }
}
