import { describe, test, expect } from 'bun:test'
import { validateAgent } from '../src/agents/schema.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import type { ParsedFrontmatter } from '../src/agents/frontmatter.ts'

const FILE = '/path/to/ba.md'

function fm(data: Record<string, unknown>, body = '# BA\n\nbody\n'): ParsedFrontmatter {
  return { data, body }
}

const VALID_FRONTMATTER: Record<string, unknown> = {
  name: 'ba',
  type: 'agent',
  phase: 'define',
  provider: 'claude',
  modelPolicy: 'opus-default',
  permissions: { read: '*', write: ['./docs/**'], bash: 'deny' },
  description: 'Refines vague intent into a concrete spec. Use when starting DEFINE phase.',
}

function expectIssue(fn: () => unknown, code: string, fileMatch: string = FILE): AgentLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(AgentLoadError)
    const e = err as AgentLoadError
    expect(e.issues.some((i) => i.code === code)).toBe(true)
    expect(e.issues.every((i) => i.file === fileMatch)).toBe(true)
    return e
  }
  throw new Error(`expected AgentLoadError with code ${code}`)
}

describe('validateAgent — happy path', () => {
  test('returns a frozen AgentDefinition for a fully valid file', () => {
    const def = validateAgent(fm(VALID_FRONTMATTER), FILE)
    expect(def.name).toBe('ba')
    expect(def.type).toBe('agent')
    expect(def.phase).toBe('define')
    expect(def.provider).toBe('claude')
    expect(def.modelPolicy).toBe('opus-default')
    expect(def.permissions.read).toBe('*')
    expect(def.permissions.bash).toBe('deny')
    expect(def.description).toContain('Refines vague intent')
    expect(def.body).toContain('# BA')
    expect(Object.isFrozen(def)).toBe(true)
    expect(Object.isFrozen(def.permissions)).toBe(true)
  })

  test('accepts optional model field when string', () => {
    const def = validateAgent(fm({ ...VALID_FRONTMATTER, model: 'claude-opus-4-7' }), FILE)
    expect(def.model).toBe('claude-opus-4-7')
  })

  test('accepts permissions.write as empty array (read-only agent)', () => {
    const def = validateAgent(
      fm({ ...VALID_FRONTMATTER, permissions: { read: '*', write: [], bash: 'deny' } }),
      FILE,
    )
    expect(def.permissions.write).toEqual([])
  })

  test('accepts permissions.bash as array of allowed commands', () => {
    const def = validateAgent(
      fm({ ...VALID_FRONTMATTER, permissions: { read: '*', write: '*', bash: ['bun test'] } }),
      FILE,
    )
    expect(def.permissions.bash).toEqual(['bun test'])
  })

  test('accepts body with ## Overview when no top-level # heading', () => {
    const body = '## Overview\n\nThis agent does X.\n'
    const def = validateAgent(fm(VALID_FRONTMATTER, body), FILE)
    expect(def.body).toBe(body)
  })

  test('description at exactly 1024 chars is accepted', () => {
    const desc = 'x'.repeat(1024)
    const def = validateAgent(fm({ ...VALID_FRONTMATTER, description: desc }), FILE)
    expect(def.description.length).toBe(1024)
  })
})

describe('validateAgent — required fields', () => {
  for (const field of [
    'name',
    'type',
    'phase',
    'provider',
    'modelPolicy',
    'permissions',
    'description',
  ] as const) {
    test(`fails when '${field}' is missing`, () => {
      const data = { ...VALID_FRONTMATTER }
      delete data[field]
      expectIssue(() => validateAgent(fm(data), FILE), 'schema_missing_field')
    })
  }
})

describe('validateAgent — enum fields', () => {
  test("rejects invalid 'type'", () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, type: 'wizard' }), FILE),
      'schema_invalid_value',
    )
  })

  test("rejects invalid 'phase'", () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, phase: 'reflect' }), FILE),
      'schema_invalid_value',
    )
  })

  test("rejects invalid 'provider'", () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, provider: 'mistral' }), FILE),
      'schema_invalid_value',
    )
  })

  test("rejects invalid 'modelPolicy'", () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, modelPolicy: 'flexible' }), FILE),
      'schema_invalid_value',
    )
  })

  test("rejects non-string 'model' when present", () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, model: 42 }), FILE),
      'schema_invalid_value',
    )
  })
})

describe('validateAgent — model rules (M12 frontmatter blank-model fix)', () => {
  test('accepts omitted model (bundled-default shape)', () => {
    const def = validateAgent(fm({ ...VALID_FRONTMATTER }), FILE)
    expect(def.model).toBeUndefined()
  })

  test("rejects empty-string 'model'", () => {
    const err = expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, model: '' }), FILE),
      'schema_invalid_value',
    )
    expect(
      err.issues.some(
        (i) => i.code === 'schema_invalid_value' && i.rule.includes("'model' must not be blank"),
      ),
    ).toBe(true)
  })

  test("rejects whitespace-only 'model'", () => {
    const err = expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, model: '   ' }), FILE),
      'schema_invalid_value',
    )
    expect(
      err.issues.some(
        (i) => i.code === 'schema_invalid_value' && i.rule.includes("'model' must not be blank"),
      ),
    ).toBe(true)
  })
})

describe('validateAgent — name rules', () => {
  test('rejects unicode in name', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, name: 'ba🔥' }), FILE),
      'schema_invalid_name',
    )
  })

  test('rejects uppercase letters in name', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, name: 'BA' }), FILE),
      'schema_invalid_name',
    )
  })

  test('rejects underscores in name', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, name: 'ba_discovery' }), FILE),
      'schema_invalid_name',
    )
  })

  test('rejects leading digit in name', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, name: '1ba' }), FILE),
      'schema_invalid_name',
    )
  })

  test('accepts hyphenated kebab-case', () => {
    const def = validateAgent(
      fm({ ...VALID_FRONTMATTER, name: 'ba-discovery' }),
      '/path/to/ba-discovery.md',
    )
    expect(def.name).toBe('ba-discovery')
  })

  test('rejects when name does not match file basename', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, name: 'lead' }), FILE),
      'schema_name_file_mismatch',
    )
  })
})

describe('validateAgent — description rules', () => {
  test('rejects empty description', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, description: '   ' }), FILE),
      'schema_invalid_value',
    )
  })

  test('rejects description longer than 1024 chars', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, description: 'x'.repeat(1025) }), FILE),
      'schema_description_too_long',
    )
  })

  test('rejects non-string description', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, description: ['line one'] }), FILE),
      'schema_invalid_value',
    )
  })
})

describe('validateAgent — permissions rules', () => {
  test('rejects permissions as non-object', () => {
    expectIssue(
      () => validateAgent(fm({ ...VALID_FRONTMATTER, permissions: 'open' }), FILE),
      'schema_invalid_permissions',
    )
  })

  test('rejects missing permissions.read', () => {
    expectIssue(
      () =>
        validateAgent(
          fm({ ...VALID_FRONTMATTER, permissions: { write: '*', bash: 'deny' } }),
          FILE,
        ),
      'schema_invalid_permissions',
    )
  })

  test('rejects permissions.write as plain string (must be * or array)', () => {
    expectIssue(
      () =>
        validateAgent(
          fm({ ...VALID_FRONTMATTER, permissions: { read: '*', write: './docs/**', bash: 'deny' } }),
          FILE,
        ),
      'schema_invalid_permissions',
    )
  })

  test('rejects permissions.bash as random string', () => {
    expectIssue(
      () =>
        validateAgent(
          fm({ ...VALID_FRONTMATTER, permissions: { read: '*', write: '*', bash: 'allow' } }),
          FILE,
        ),
      'schema_invalid_permissions',
    )
  })

  test('rejects permissions.read array containing non-string', () => {
    expectIssue(
      () =>
        validateAgent(
          fm({ ...VALID_FRONTMATTER, permissions: { read: ['ok', 42], write: '*', bash: 'deny' } }),
          FILE,
        ),
      'schema_invalid_permissions',
    )
  })
})

describe('validateAgent — body rules', () => {
  test('rejects empty body', () => {
    expectIssue(() => validateAgent(fm(VALID_FRONTMATTER, ''), FILE), 'schema_invalid_body')
  })

  test('rejects whitespace-only body', () => {
    expectIssue(() => validateAgent(fm(VALID_FRONTMATTER, '   \n\n   \n'), FILE), 'schema_invalid_body')
  })

  test('rejects body without # heading or ## Overview', () => {
    const body = 'Just a paragraph.\n\nNo headings.\n'
    expectIssue(() => validateAgent(fm(VALID_FRONTMATTER, body), FILE), 'schema_invalid_body')
  })

  test('accepts body where # heading appears after a comment line', () => {
    const body = '<!-- generated -->\n# Title\n\nbody\n'
    const def = validateAgent(fm(VALID_FRONTMATTER, body), FILE)
    expect(def.body).toBe(body)
  })
})

describe('validateAgent — multi-issue aggregation', () => {
  test('reports multiple violations from a single file in one error', () => {
    const broken = {
      // missing name
      type: 'wizard', // invalid enum
      phase: 'reflect', // invalid enum
      provider: 'claude',
      modelPolicy: 'opus-default',
      permissions: { read: '*', write: '*', bash: 'deny' },
      description: 'x'.repeat(2000), // too long
    }
    try {
      validateAgent(fm(broken), FILE)
    } catch (err) {
      const e = err as AgentLoadError
      // At least: missing name + invalid type + invalid phase + description too long
      expect(e.issues.length).toBeGreaterThanOrEqual(4)
      expect(e.issues.some((i) => i.code === 'schema_missing_field')).toBe(true)
      expect(e.issues.some((i) => i.code === 'schema_invalid_value' && i.rule.includes("'type'"))).toBe(true)
      expect(e.issues.some((i) => i.code === 'schema_invalid_value' && i.rule.includes("'phase'"))).toBe(true)
      expect(e.issues.some((i) => i.code === 'schema_description_too_long')).toBe(true)
    }
  })
})
