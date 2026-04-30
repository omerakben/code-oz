// Argv-only command grammar for VERIFY's validation-command execution.
//
// Parses the `Command` bullet from BUILD_REPORT.md / VERIFY.md into an argv
// vector for `Bun.spawn` (no shell). Rejects every shape that would let the
// persona smuggle shell semantics through what is supposed to be a literal
// argument list.
//
// Locked rejections (per CODEX_RESPONSE_M8.md decision 1, accept-with-mods):
//   - shell operators: `|`, `&&`, `||`, `;`
//   - redirects:       `>`, `<`, `>>`
//   - env-prefix:      `FOO=bar cmd`
//   - command sub:     `$(...)`, backticks
//   - absolute paths:  `/usr/bin/...` as the executable
//
// We reject the underlying metacharacters (`&`, `|`, `;`, `<`, `>`, `$`, `` ` ``)
// so the operator and substitution families collapse into one check. Quotes,
// embedded newlines, and parens are rejected too — v0.1 has a narrow grammar
// because every additional accepted token is a future shell-bypass surface.
//
// Consumers of this module:
//   - M8 commit 3 (src/tools/test-runner.ts) calls `parseValidationCommand`
//     before spawning, then passes `[executable, ...args]` straight to Bun.spawn.
//   - M8 commit 5 (src/artifacts/verify-report.ts) calls it on persona-authored
//     `Validation command` bullets to enforce `verify_command_substitution`.

const SHELL_METACHARS = new Set(['|', '&', ';', '<', '>', '$', '`', '"', "'", '(', ')', '\\'])

const ENV_PREFIX_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/

export type CommandGrammarReason =
  | 'empty'
  | 'shell-metacharacter'
  | 'embedded-newline'
  | 'env-prefix'
  | 'absolute-executable-path'

export interface ParsedCommand {
  /** First argv token — the program name. Never empty, never starts with `/`. */
  readonly executable: string
  /** Remaining argv tokens, in source order. May be empty. */
  readonly args: readonly string[]
}

export class CommandGrammarError extends Error {
  readonly reason: CommandGrammarReason
  readonly detail: string

  constructor(reason: CommandGrammarReason, detail: string) {
    super(`command grammar rejected: ${reason} (${detail})`)
    this.name = 'CommandGrammarError'
    this.reason = reason
    this.detail = detail
  }
}

/**
 * Parse a single-line validation command into an argv vector. Throws
 * `CommandGrammarError` on any rejection.
 */
export function parseValidationCommand(raw: string): ParsedCommand {
  if (typeof raw !== 'string') {
    throw new CommandGrammarError('empty', 'input is not a string')
  }

  // Embedded newlines / CRs would slip through whitespace tokenization
  // silently; reject them before any other check.
  if (raw.includes('\n') || raw.includes('\r')) {
    throw new CommandGrammarError('embedded-newline', 'command must be a single line')
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new CommandGrammarError('empty', 'command is empty after trim')
  }

  for (const ch of trimmed) {
    if (SHELL_METACHARS.has(ch)) {
      throw new CommandGrammarError('shell-metacharacter', `forbidden character ${JSON.stringify(ch)}`)
    }
  }

  const tokens = trimmed.split(/[ \t]+/)
  // After trim + non-empty check + whitespace split, tokens[0] is always defined.
  const first = tokens[0] as string

  if (ENV_PREFIX_REGEX.test(first)) {
    throw new CommandGrammarError('env-prefix', `env-style assignment as executable: ${first}`)
  }

  if (first.startsWith('/')) {
    throw new CommandGrammarError('absolute-executable-path', `executable is an absolute path: ${first}`)
  }

  return Object.freeze({
    executable: first,
    args: Object.freeze(tokens.slice(1)),
  })
}
