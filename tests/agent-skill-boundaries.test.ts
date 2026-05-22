import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL = readFileSync(join(import.meta.dir, '..', 'agent-skills', 'code-oz', 'SKILL.md'), 'utf8')

describe('code-oz agent skill boundaries', () => {
  test('has agentskills.io frontmatter (name + description)', () => {
    expect(SKILL).toMatch(/^---/)
    expect(SKILL).toMatch(/\nname:\s*code-oz/)
    expect(SKILL).toMatch(/\ndescription:\s*\S/)
  })

  for (const phrase of [
    'CODE_OZ_OPERATOR',
    '--operator',
    '--non-interactive',
    '.code-oz/',
    'fake',
    'NEEDS_INTERVENTION',
  ]) {
    test(`mentions the boundary token: ${phrase}`, () => {
      expect(SKILL).toContain(phrase)
    })
  }

  test('forbids writing .code-oz and deciding pass/fail', () => {
    expect(SKILL.toLowerCase()).toContain('never write')
    expect(SKILL.toLowerCase()).toMatch(/pass\/fail|pass or fail/)
  })
})
