import { describe, test, expect } from 'bun:test'
import { parseFrontmatter } from '../src/agents/frontmatter.ts'
import { AgentLoadError } from '../src/agents/errors.ts'

const FILE = '<test-fixture>'

function expectAgentLoadError(fn: () => unknown): AgentLoadError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(AgentLoadError)
    return err as AgentLoadError
  }
  throw new Error('expected AgentLoadError to be thrown')
}

describe('parseFrontmatter', () => {
  test('parses a minimal valid agent file', () => {
    const raw = '---\nname: ba\nphase: define\n---\n# BA\n\nbody\n'
    const { data, body } = parseFrontmatter(raw, FILE)
    expect(data).toEqual({ name: 'ba', phase: 'define' })
    expect(body).toBe('# BA\n\nbody\n')
  })

  test('strips a leading UTF-8 BOM', () => {
    const raw = '﻿---\nname: ba\n---\nbody\n'
    const { data, body } = parseFrontmatter(raw, FILE)
    expect(data).toEqual({ name: 'ba' })
    expect(body).toBe('body\n')
  })

  test('accepts CRLF line endings and preserves them in the body', () => {
    const raw = '---\r\nname: ba\r\n---\r\nbody line\r\nsecond\r\n'
    const { data, body } = parseFrontmatter(raw, FILE)
    expect(data).toEqual({ name: 'ba' })
    expect(body).toBe('body line\r\nsecond\r\n')
  })

  test('preserves body exactly without normalization', () => {
    const raw = '---\nname: ba\n---\n  body with leading spaces\n\nand blank line\n'
    const { body } = parseFrontmatter(raw, FILE)
    expect(body).toBe('  body with leading spaces\n\nand blank line\n')
  })

  test('handles file with frontmatter and empty body', () => {
    const raw = '---\nname: ba\n---\n'
    const { data, body } = parseFrontmatter(raw, FILE)
    expect(data).toEqual({ name: 'ba' })
    expect(body).toBe('')
  })

  test('handles file ending immediately after closing delimiter (no trailing newline)', () => {
    const raw = '---\nname: ba\n---'
    const { data, body } = parseFrontmatter(raw, FILE)
    expect(data).toEqual({ name: 'ba' })
    expect(body).toBe('')
  })

  test('throws when there is no opening delimiter', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('# Just markdown\nname: ba\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_missing_delimiter')
    expect(err.issues[0]!.file).toBe(FILE)
    expect(err.issues[0]!.rule).toContain('begin with')
  })

  test('throws when the frontmatter has no closing delimiter', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\nname: ba\nphase: define\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_missing_delimiter')
    expect(err.issues[0]!.rule).toContain('closing')
  })

  test('throws on invalid YAML inside frontmatter', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\nname: ba\nbroken: [unclosed\n---\nbody\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_invalid_yaml')
    expect(err.issues[0]!.detail).toBeDefined()
  })

  test('throws on duplicate YAML keys', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\nname: first\nname: second\n---\nbody\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_duplicate_key')
  })

  test('throws when frontmatter is empty (yaml parses to null)', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\n---\nbody\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_not_object')
  })

  test('throws when frontmatter is a YAML scalar instead of an object', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\njust-a-string\n---\nbody\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_not_object')
  })

  test('throws when frontmatter is a YAML array instead of an object', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('---\n- one\n- two\n---\nbody\n', FILE),
    )
    expect(err.issues[0]!.code).toBe('frontmatter_not_object')
    expect(err.issues[0]!.detail).toContain('array')
  })

  test('reports the file path in the error issue', () => {
    const err = expectAgentLoadError(() =>
      parseFrontmatter('no frontmatter here\n', '/path/to/agent.md'),
    )
    expect(err.issues[0]!.file).toBe('/path/to/agent.md')
  })

  test('AgentLoadError has frozen issues that cannot be mutated', () => {
    const err = expectAgentLoadError(() => parseFrontmatter('no fm\n', FILE))
    expect(() => {
      ;(err.issues as unknown as AgentLoadError['issues'][number][]).push({
        file: 'x',
        code: 'frontmatter_invalid_yaml',
        rule: 'should not append',
      })
    }).toThrow()
  })
})
