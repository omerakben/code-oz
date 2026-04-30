// Patch header / path-safety scanner (per docs/contracts/BUILD.md +
// Codex M7 implementation review accept-with-modifications on decision
// 10, thread 019ddeea).
//
// We do NOT re-implement the unified-diff parser — `git apply --check`
// handles hunk grammar. We DO scan path-bearing headers because git
// will happily apply patches that escape the worktree if `--unsafe-paths`
// is set elsewhere, and because v0.1 rejects symlinks and binaries
// outright (deferred to W3+).
//
// Headers scanned:
//   diff --git a/<path> b/<path>
//   --- a/<path>     (or `--- /dev/null`)
//   +++ b/<path>     (or `+++ /dev/null`)
//   rename from <path>
//   rename to   <path>
//   copy from   <path>
//   copy to     <path>
//   new file mode <mode>     (rejects 120000 = symlink)
//   deleted file mode <mode>
//   GIT binary patch         (rejected in v0.1)
//   Binary files <a> and <b> differ  (rejected in v0.1)
//
// Quoted paths (`"path with spaces"`) are unquoted before path-safety
// checks. Backslash path separators (Windows-style) are rejected.

export interface PatchValidationOk {
  readonly ok: true
  /** Distinct paths the patch touches (post-quote-unwrap). */
  readonly paths: readonly string[]
  readonly bytes: number
}

export interface PatchValidationErr {
  readonly ok: false
  readonly code: string
  readonly reason: string
}

export type PatchValidationResult = PatchValidationOk | PatchValidationErr

/** Hard cap per BUILD.md § Permissions required (tool_use.write.maxBytesPerPatch). */
export const MAX_PATCH_BYTES = 65536

const HEADER_PATH_RE =
  /^(?:diff --git |--- |\+\+\+ |rename from |rename to |copy from |copy to )/

export function validatePatch(patch: string): PatchValidationResult {
  const bytes = Buffer.byteLength(patch, 'utf8')
  if (bytes === 0) {
    return errResult('build_patch_grammar_invalid', 'patch is empty')
  }
  if (bytes > MAX_PATCH_BYTES) {
    return errResult(
      'build_patch_size_exceeded',
      `patch is ${bytes} bytes; max is ${MAX_PATCH_BYTES}`,
    )
  }

  // Reject binary patches outright (v0.1 deferred per ROADMAP).
  if (/^GIT binary patch$/m.test(patch)) {
    return errResult('build_patch_binary_unsupported', 'GIT binary patch marker present')
  }
  if (/^Binary files .* and .* differ$/m.test(patch)) {
    return errResult('build_patch_binary_unsupported', 'Binary files marker present')
  }

  // Reject symlink modes (file mode 120000 means symlink).
  if (/^(?:new|deleted|new file|deleted file) mode 120000\b/m.test(patch)) {
    return errResult('build_patch_grammar_invalid', 'symlink (mode 120000) rejected in v0.1')
  }
  // Walk header lines; collect paths; check each.
  const paths = new Set<string>()
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!HEADER_PATH_RE.test(line)) continue

    const extracted = extractPathsFromHeader(line)
    for (const candidate of extracted) {
      if (candidate === '/dev/null') continue
      const cleaned = unquoteIfQuoted(candidate)
      const issue = checkPathSafety(cleaned)
      if (issue) {
        return errResult(issue.code, `${issue.rule}: ${cleaned}`)
      }
      paths.add(stripABPrefix(cleaned))
    }
  }

  if (paths.size === 0) {
    return errResult('build_patch_grammar_invalid', 'no diff headers detected (`diff --git ` / `--- ` / `+++ ` lines absent)')
  }

  return Object.freeze({
    ok: true as const,
    paths: Object.freeze([...paths].sort()),
    bytes,
  })
}

interface PathIssue {
  readonly code: string
  readonly rule: string
}

function checkPathSafety(path: string): PathIssue | null {
  const stripped = stripABPrefix(path)
  if (stripped.length === 0) {
    return { code: 'build_manifest_path_unsafe', rule: 'empty path in diff header' }
  }
  if (stripped.startsWith('/')) {
    return { code: 'build_manifest_path_unsafe', rule: 'absolute path in diff header' }
  }
  // Windows-style backslash separator. Reject before normalization since
  // the worktree is *nix-rooted.
  if (stripped.includes('\\')) {
    return { code: 'build_manifest_path_unsafe', rule: 'backslash separator in diff header' }
  }
  // Path-traversal segment (`..`). Test as exact segment, not substring,
  // so `..foo` and `foo..` (legitimate filenames) are allowed.
  const segments = stripped.split('/')
  if (segments.includes('..')) {
    return { code: 'build_manifest_path_unsafe', rule: '`..` path-traversing segment' }
  }
  // Drive-letter prefix (Windows). Reject `C:/`, `D:\\`, etc.
  if (/^[A-Za-z]:[/\\]/.test(stripped)) {
    return { code: 'build_manifest_path_unsafe', rule: 'drive-letter prefix in diff header' }
  }
  return null
}

/** Strips the `a/` or `b/` prefix that unified-diff headers add to file paths. */
export function stripABPrefix(path: string): string {
  if (path.startsWith('a/')) return path.slice(2)
  if (path.startsWith('b/')) return path.slice(2)
  return path
}

/**
 * Extracts the path token(s) from a single header line.
 *
 * - `diff --git a/X b/Y`      → ['a/X', 'b/Y']
 * - `--- a/X` / `+++ b/X`     → ['a/X'] / ['b/X']
 * - `rename from X` / `to X`  → ['X']
 *
 * Quoted paths are returned with quotes intact; the caller unquotes.
 */
export function extractPathsFromHeader(line: string): readonly string[] {
  if (line.startsWith('diff --git ')) {
    return parseDiffGitLine(line.slice('diff --git '.length))
  }
  if (line.startsWith('--- ')) {
    const rest = line.slice('--- '.length).trim()
    return rest.length === 0 ? [] : [rest]
  }
  if (line.startsWith('+++ ')) {
    const rest = line.slice('+++ '.length).trim()
    return rest.length === 0 ? [] : [rest]
  }
  if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
    const rest = line.replace(/^(rename from |rename to )/, '').trim()
    return rest.length === 0 ? [] : [rest]
  }
  if (line.startsWith('copy from ') || line.startsWith('copy to ')) {
    const rest = line.replace(/^(copy from |copy to )/, '').trim()
    return rest.length === 0 ? [] : [rest]
  }
  return []
}

/**
 * Parses `a/<X> b/<Y>` after the `diff --git ` prefix. Handles quoted
 * paths with spaces.
 *
 * Examples:
 *   `a/src/foo.ts b/src/foo.ts`         → ['a/src/foo.ts', 'b/src/foo.ts']
 *   `"a/path with spaces.ts" "b/x.ts"`  → ['"a/path with spaces.ts"', '"b/x.ts"']
 */
export function parseDiffGitLine(rest: string): readonly string[] {
  const tokens: string[] = []
  let i = 0
  while (i < rest.length) {
    while (i < rest.length && rest[i] === ' ') i++
    if (i >= rest.length) break
    if (rest[i] === '"') {
      // Quoted path; find the matching close quote (no escape handling
      // beyond what git emits — backslash-escaped chars inside a quoted
      // path are not unwound here, just tolerated).
      let j = i + 1
      while (j < rest.length && rest[j] !== '"') {
        if (rest[j] === '\\' && j + 1 < rest.length) j += 2
        else j += 1
      }
      tokens.push(rest.slice(i, Math.min(j + 1, rest.length)))
      i = j + 1
    } else {
      let j = i
      while (j < rest.length && rest[j] !== ' ') j++
      tokens.push(rest.slice(i, j))
      i = j
    }
  }
  return tokens
}

/** Returns the path with surrounding quotes removed (if quoted). */
export function unquoteIfQuoted(path: string): string {
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1)
  }
  return path
}

function errResult(code: string, reason: string): PatchValidationErr {
  return Object.freeze({ ok: false as const, code, reason })
}
