// M10 commit 3: ignore-policy module with fail-closed unsupported syntax.
//
// Tests cover:
//   1. Supported syntax (literal, directory-prefix, segment-glob, recursive-prefix)
//   2. Fail-closed unsupported syntax (negation, rooted, brackets, escapes,
//      trailing **, mid-pattern **) — every case throws IgnorePolicyError
//   3. Empty file / absent file → no-op policy
//   4. Comments and blank lines skipped
//   5. matchIgnore + isIgnored against compiled patterns

import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseIgnorePolicy,
  loadIgnorePolicy,
  isIgnored,
  matchIgnore,
  IgnorePolicyError,
} from '../src/tools/ignore-policy.ts'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'codeoz-ignore-policy-'))
}

describe('parseIgnorePolicy — supported syntax', () => {
  test('empty content returns empty patterns (source: present)', () => {
    const p = parseIgnorePolicy('')
    expect(p.source).toBe('present')
    expect(p.patterns).toHaveLength(0)
  })

  test('comments and blank lines are skipped silently', () => {
    const p = parseIgnorePolicy('# top comment\n\n# more\n\n.env\n')
    expect(p.patterns).toHaveLength(1)
    expect(p.patterns[0]?.raw.trim()).toBe('.env')
    expect(p.patterns[0]?.line).toBe(5)
  })

  test('literal pattern matches exact path only', () => {
    const p = parseIgnorePolicy('.env')
    expect(p.patterns[0]?.kind).toBe('literal')
    expect(isIgnored(p, '.env')).toBe(true)
    expect(isIgnored(p, 'src/.env')).toBe(false)
    expect(isIgnored(p, '.env.local')).toBe(false)
  })

  test('directory-prefix pattern matches everything under the directory', () => {
    const p = parseIgnorePolicy('config/credentials/')
    expect(p.patterns[0]?.kind).toBe('directory-prefix')
    expect(isIgnored(p, 'config/credentials/api.key')).toBe(true)
    expect(isIgnored(p, 'config/credentials/nested/deep.json')).toBe(true)
    expect(isIgnored(p, 'config/credentials')).toBe(false) // file with same name, no slash
    expect(isIgnored(p, 'src/credentials/x')).toBe(false)
  })

  test('segment-glob `*` matches single segment only', () => {
    const p = parseIgnorePolicy('config/*.yaml')
    expect(p.patterns[0]?.kind).toBe('segment-glob')
    expect(isIgnored(p, 'config/secrets.yaml')).toBe(true)
    expect(isIgnored(p, 'config/db.yaml')).toBe(true)
    expect(isIgnored(p, 'config/nested/secrets.yaml')).toBe(false) // crosses /
    expect(isIgnored(p, 'src/config/secrets.yaml')).toBe(false)
  })

  test('recursive-prefix `**/` matches at any depth', () => {
    const p = parseIgnorePolicy('**/secrets.json')
    expect(p.patterns[0]?.kind).toBe('recursive-prefix')
    expect(isIgnored(p, 'secrets.json')).toBe(true)
    expect(isIgnored(p, 'config/secrets.json')).toBe(true)
    expect(isIgnored(p, 'src/deep/path/secrets.json')).toBe(true)
    expect(isIgnored(p, 'secrets.json.bak')).toBe(false)
    expect(isIgnored(p, 'mysecrets.json')).toBe(false)
  })

  test('recursive-prefix combined with single-segment glob', () => {
    const p = parseIgnorePolicy('**/*.key')
    expect(isIgnored(p, 'a.key')).toBe(true)
    expect(isIgnored(p, 'config/a.key')).toBe(true)
    expect(isIgnored(p, 'config/nested/a.key')).toBe(true)
    expect(isIgnored(p, 'a.keyring')).toBe(false)
  })

  test('multiple patterns on multiple lines, all-or-nothing matching', () => {
    const p = parseIgnorePolicy('.env\nconfig/credentials/\n**/*.key')
    expect(p.patterns).toHaveLength(3)
    expect(isIgnored(p, '.env')).toBe(true)
    expect(isIgnored(p, 'config/credentials/x')).toBe(true)
    expect(isIgnored(p, 'src/x.key')).toBe(true)
    expect(isIgnored(p, 'src/main.ts')).toBe(false)
  })

  test('literal pattern with regex metacharacters is escaped properly', () => {
    // Period in `.env` is regex metacharacter; the parser must escape it.
    const p = parseIgnorePolicy('.env')
    expect(isIgnored(p, '.env')).toBe(true)
    // Without escaping, '.' would match any single char, including `xenv`.
    expect(isIgnored(p, 'xenv')).toBe(false)
    expect(isIgnored(p, 'aenv')).toBe(false)
  })

  test('matchIgnore returns the matching pattern (forensics)', () => {
    const p = parseIgnorePolicy('.env\n**/secrets.json')
    const m = matchIgnore(p, '.env')
    expect(m?.raw.trim()).toBe('.env')
    expect(m?.line).toBe(1)
    const m2 = matchIgnore(p, 'src/secrets.json')
    expect(m2?.raw.trim()).toBe('**/secrets.json')
    expect(m2?.line).toBe(2)
  })
})

describe('parseIgnorePolicy — fail-closed unsupported syntax', () => {
  test('negation `!pattern` fails closed', () => {
    expect(() => parseIgnorePolicy('!exception.env')).toThrow(IgnorePolicyError)
  })

  test('rooted-absolute `/pattern` fails closed', () => {
    expect(() => parseIgnorePolicy('/foo')).toThrow(IgnorePolicyError)
  })

  test('bracket character class `[abc]` fails closed', () => {
    expect(() => parseIgnorePolicy('foo[abc].txt')).toThrow(IgnorePolicyError)
  })

  test('backslash escape `\\\\` fails closed', () => {
    expect(() => parseIgnorePolicy('foo\\ bar.txt')).toThrow(IgnorePolicyError)
  })

  test('trailing `**` fails closed', () => {
    expect(() => parseIgnorePolicy('vendor/**')).toThrow(IgnorePolicyError)
  })

  test('bare `**` (just two stars) fails closed', () => {
    expect(() => parseIgnorePolicy('**')).toThrow(IgnorePolicyError)
  })

  test('mid-pattern `**` fails closed', () => {
    expect(() => parseIgnorePolicy('foo/**/bar')).toThrow(IgnorePolicyError)
  })

  test('leading `**` without trailing `/` fails closed', () => {
    expect(() => parseIgnorePolicy('**foo')).toThrow(IgnorePolicyError)
  })

  test('error contains line number + offending text', () => {
    try {
      parseIgnorePolicy('.env\n!exception\nconfig/')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(IgnorePolicyError)
      const e = err as IgnorePolicyError
      expect(e.issues).toHaveLength(1)
      expect(e.issues[0]?.line).toBe(2)
      expect(e.issues[0]?.raw).toBe('!exception')
      expect(e.issues[0]?.code).toBe('ignore_policy_unsupported_syntax')
    }
  })

  test('multiple unsupported lines collect all issues, not just the first', () => {
    try {
      parseIgnorePolicy('!neg\n/rooted\nfoo[abc]\nbar/**')
      throw new Error('should have thrown')
    } catch (err) {
      const e = err as IgnorePolicyError
      expect(e.issues.length).toBeGreaterThanOrEqual(4)
      // All four should produce ignore_policy_unsupported_syntax issues.
      const lines = e.issues.map((i) => i.line).sort()
      expect(lines).toEqual([1, 2, 3, 4])
    }
  })

  test('wildcard inside directory-prefix pattern fails closed', () => {
    // E.g., `foo*/` is ambiguous; M10 forbids.
    expect(() => parseIgnorePolicy('foo*/')).toThrow(IgnorePolicyError)
  })

  test('formatted error message names the file path when provided', () => {
    try {
      parseIgnorePolicy('!neg', '/abs/.code-ozignore')
      throw new Error('should have thrown')
    } catch (err) {
      const e = err as IgnorePolicyError
      expect(e.path).toBe('/abs/.code-ozignore')
      expect(e.message).toContain('/abs/.code-ozignore:1')
    }
  })
})

describe('parseIgnorePolicy — invalid pattern shapes (post-syntax-check)', () => {
  test('bare directory-prefix `/` fails as invalid pattern', () => {
    // Just `/` is rejected up-front by leading `/` rule.
    expect(() => parseIgnorePolicy('/')).toThrow(IgnorePolicyError)
  })

  test('bare directory-prefix without stem fails (just trailing slash)', () => {
    // Empty trimmed line is skipped, but a single space + slash is a
    // directory-prefix with empty stem if we trim. The trim happens, so
    // ' /' becomes '/', caught by leading-slash check. This case is just
    // documenting current behavior.
    expect(() => parseIgnorePolicy(' /')).toThrow(IgnorePolicyError)
  })
})

describe('loadIgnorePolicy — filesystem integration', () => {
  test('absent .code-ozignore returns source: absent (not an error)', async () => {
    const dir = tmpProject()
    try {
      const p = await loadIgnorePolicy(dir)
      expect(p.source).toBe('absent')
      expect(p.patterns).toHaveLength(0)
      expect(p.path).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('present .code-ozignore parses and returns source: present', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\n**/secrets.json\n')
      const p = await loadIgnorePolicy(dir)
      expect(p.source).toBe('present')
      expect(p.patterns).toHaveLength(2)
      expect(p.path).toBe(join(dir, '.code-ozignore'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('present-with-unsupported-syntax throws IgnorePolicyError with file path', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '!negation\n')
      await expect(loadIgnorePolicy(dir)).rejects.toThrow(IgnorePolicyError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('isIgnored against absent policy is always false', async () => {
    const dir = tmpProject()
    try {
      const p = await loadIgnorePolicy(dir)
      expect(isIgnored(p, '.env')).toBe(false)
      expect(isIgnored(p, 'anything/at/all')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('CRLF line endings are handled', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\r\n**/secrets.json\r\n')
      const p = await loadIgnorePolicy(dir)
      expect(p.patterns).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('comment-only file produces empty pattern list (source: present)', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '# only comments\n# another\n')
      const p = await loadIgnorePolicy(dir)
      expect(p.source).toBe('present')
      expect(p.patterns).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('matchIgnore — path normalization safety', () => {
  test('rejects backslash paths (Windows-style; runtime forces POSIX)', () => {
    const p = parseIgnorePolicy('.env')
    expect(matchIgnore(p, 'src\\.env')).toBeNull()
  })

  test('rejects absolute paths (must be project-root-relative)', () => {
    const p = parseIgnorePolicy('.env')
    expect(matchIgnore(p, '/abs/.env')).toBeNull()
  })

  test('rejects empty path', () => {
    const p = parseIgnorePolicy('.env')
    expect(matchIgnore(p, '')).toBeNull()
  })

  test('frozen output protects against mutation', () => {
    const p = parseIgnorePolicy('.env\nfoo/')
    expect(Object.isFrozen(p)).toBe(true)
    expect(Object.isFrozen(p.patterns)).toBe(true)
  })
})

describe('parseIgnorePolicy — comprehensive happy-path mix', () => {
  test('a typical .code-ozignore parses and matches correctly', () => {
    const content = [
      '# Block secrets',
      '.env',
      '.env.local',
      '**/secrets.json',
      'config/credentials/',
      'config/*.key',
      '',
      '# Block fixtures',
      '**/fixtures/private/',
    ].join('\n')
    // The last pattern (`**/fixtures/private/`) combines recursive-prefix
    // with directory-prefix: not supported in M10. Should fail closed.
    expect(() => parseIgnorePolicy(content)).toThrow(IgnorePolicyError)
  })

  test('a typical .code-ozignore (without unsupported combos) is fully covered', () => {
    const content = [
      '# Block secrets',
      '.env',
      '.env.local',
      '**/secrets.json',
      'config/credentials/',
      'config/*.key',
    ].join('\n')
    const p = parseIgnorePolicy(content)
    expect(p.patterns).toHaveLength(5)
    expect(isIgnored(p, '.env')).toBe(true)
    expect(isIgnored(p, '.env.local')).toBe(true)
    expect(isIgnored(p, 'src/secrets.json')).toBe(true)
    expect(isIgnored(p, 'config/credentials/api.key')).toBe(true)
    expect(isIgnored(p, 'config/db.key')).toBe(true)
    expect(isIgnored(p, 'src/main.ts')).toBe(false)
    expect(isIgnored(p, 'README.md')).toBe(false)
  })
})
