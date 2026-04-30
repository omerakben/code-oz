import { describe, test, expect } from 'bun:test'
import {
  validatePatch,
  parseDiffGitLine,
  extractPathsFromHeader,
  unquoteIfQuoted,
  stripABPrefix,
  MAX_PATCH_BYTES,
} from '../src/patches/validate-agent-patch.ts'

const SIMPLE_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 0000000..1111111 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-export const a = 1
+export const a = 2
`

describe('parseDiffGitLine', () => {
  test('parses unquoted paths', () => {
    expect(parseDiffGitLine('a/src/foo.ts b/src/foo.ts')).toEqual(['a/src/foo.ts', 'b/src/foo.ts'])
  })

  test('parses quoted paths with spaces', () => {
    expect(parseDiffGitLine('"a/path with spaces.ts" "b/x.ts"')).toEqual([
      '"a/path with spaces.ts"',
      '"b/x.ts"',
    ])
  })

  test('handles mixed quoted/unquoted', () => {
    expect(parseDiffGitLine('"a/has space" b/plain')).toEqual(['"a/has space"', 'b/plain'])
  })

  test('returns empty for empty input', () => {
    expect(parseDiffGitLine('')).toEqual([])
  })
})

describe('extractPathsFromHeader', () => {
  test('extracts from --- and +++', () => {
    expect(extractPathsFromHeader('--- a/x')).toEqual(['a/x'])
    expect(extractPathsFromHeader('+++ b/y')).toEqual(['b/y'])
  })

  test('extracts /dev/null on creation/deletion', () => {
    expect(extractPathsFromHeader('--- /dev/null')).toEqual(['/dev/null'])
    expect(extractPathsFromHeader('+++ /dev/null')).toEqual(['/dev/null'])
  })

  test('extracts rename from / rename to', () => {
    expect(extractPathsFromHeader('rename from old.ts')).toEqual(['old.ts'])
    expect(extractPathsFromHeader('rename to new.ts')).toEqual(['new.ts'])
  })

  test('extracts copy from / copy to', () => {
    expect(extractPathsFromHeader('copy from src.ts')).toEqual(['src.ts'])
    expect(extractPathsFromHeader('copy to dst.ts')).toEqual(['dst.ts'])
  })

  test('returns empty for non-header lines', () => {
    expect(extractPathsFromHeader('@@ -1,1 +1,1 @@')).toEqual([])
    expect(extractPathsFromHeader('-export const a = 1')).toEqual([])
  })
})

describe('unquoteIfQuoted', () => {
  test('strips surrounding quotes', () => {
    expect(unquoteIfQuoted('"a/x"')).toBe('a/x')
  })
  test('leaves unquoted untouched', () => {
    expect(unquoteIfQuoted('a/x')).toBe('a/x')
  })
})

describe('stripABPrefix', () => {
  test('strips a/', () => {
    expect(stripABPrefix('a/src/foo.ts')).toBe('src/foo.ts')
  })
  test('strips b/', () => {
    expect(stripABPrefix('b/src/foo.ts')).toBe('src/foo.ts')
  })
  test('leaves other prefixes alone', () => {
    expect(stripABPrefix('src/foo.ts')).toBe('src/foo.ts')
    expect(stripABPrefix('c/foo')).toBe('c/foo')
  })
})

describe('validatePatch — happy path', () => {
  test('accepts a simple modification patch', () => {
    const r = validatePatch(SIMPLE_PATCH)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paths).toContain('src/a.ts')
    expect(r.bytes).toBeGreaterThan(0)
  })

  test('accepts an added-file patch (--- /dev/null)', () => {
    const patch = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,1 @@
+export const x = 1
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paths).toContain('src/new.ts')
  })

  test('accepts a deleted-file patch (+++ /dev/null)', () => {
    const patch = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const gone = 1
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paths).toContain('src/gone.ts')
  })

  test('accepts a rename patch', () => {
    const patch = `diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paths).toContain('src/old.ts')
    expect(r.paths).toContain('src/new.ts')
  })
})

describe('validatePatch — size + emptiness', () => {
  test('rejects empty patch', () => {
    const r = validatePatch('')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_grammar_invalid')
  })

  test('rejects whitespace-only patch (no headers)', () => {
    const r = validatePatch('   \n   \n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_grammar_invalid')
  })

  test('rejects oversized patch', () => {
    const huge = 'x'.repeat(MAX_PATCH_BYTES + 1)
    const r = validatePatch(huge)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_size_exceeded')
  })

  test('accepts patch at exactly MAX_PATCH_BYTES', () => {
    // Build a header + padding totaling exactly MAX_PATCH_BYTES bytes
    const prefix = `diff --git a/src/big.ts b/src/big.ts
--- a/src/big.ts
+++ b/src/big.ts
@@ -1,1 +1,1 @@
-x
+`
    const padLen = MAX_PATCH_BYTES - Buffer.byteLength(prefix, 'utf8') - 1 // -1 for trailing \n
    const patch = prefix + 'a'.repeat(padLen) + '\n'
    expect(Buffer.byteLength(patch, 'utf8')).toBe(MAX_PATCH_BYTES)
    const r = validatePatch(patch)
    expect(r.ok).toBe(true)
  })
})

describe('validatePatch — binary rejection', () => {
  test('rejects GIT binary patch marker', () => {
    const patch = `diff --git a/img.png b/img.png
GIT binary patch
literal 1234
zcm...
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_binary_unsupported')
  })

  test('rejects "Binary files .. and .. differ"', () => {
    const patch = `diff --git a/a.png b/a.png
Binary files a/a.png and b/a.png differ
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_binary_unsupported')
  })
})

describe('validatePatch — symlink rejection', () => {
  test('rejects new file mode 120000 (symlink)', () => {
    const patch = `diff --git a/link b/link
new file mode 120000
--- /dev/null
+++ b/link
@@ -0,0 +1,1 @@
+target
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_grammar_invalid')
    expect(r.reason).toContain('symlink')
  })

  test('rejects deleted file mode 120000', () => {
    const patch = `diff --git a/link b/link
deleted file mode 120000
--- a/link
+++ /dev/null
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_grammar_invalid')
  })
})

describe('validatePatch — path safety', () => {
  test('rejects absolute path in --- header', () => {
    const patch = `diff --git a/x b/x
--- /etc/passwd
+++ b/x
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_manifest_path_unsafe')
    expect(r.reason).toContain('absolute')
  })

  test('rejects ..-traversing path', () => {
    const patch = `diff --git a/../escape.ts b/../escape.ts
--- a/../escape.ts
+++ b/../escape.ts
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_manifest_path_unsafe')
    expect(r.reason).toContain('..')
  })

  test('rejects backslash separators (Windows)', () => {
    const patch = `diff --git a/src\\foo.ts b/src\\foo.ts
--- a/src\\foo.ts
+++ b/src\\foo.ts
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_manifest_path_unsafe')
  })

  test('rejects drive-letter prefix', () => {
    const patch = `diff --git a/C:/win.ts b/C:/win.ts
--- a/C:/win.ts
+++ b/C:/win.ts
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_manifest_path_unsafe')
  })

  test('accepts paths with `..` as substring (not segment)', () => {
    const patch = `diff --git a/src/foo..bar.ts b/src/foo..bar.ts
--- a/src/foo..bar.ts
+++ b/src/foo..bar.ts
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(true) // `foo..bar` is a legal filename, not traversal
  })

  test('accepts quoted path with spaces', () => {
    const patch = `diff --git "a/file with spaces.ts" "b/file with spaces.ts"
--- "a/file with spaces.ts"
+++ "b/file with spaces.ts"
@@ -1,1 +1,1 @@
-x
+y
`
    const r = validatePatch(patch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.paths).toContain('file with spaces.ts')
  })
})

describe('validatePatch — header presence', () => {
  test('rejects body without any diff header', () => {
    const r = validatePatch(`@@ -1,1 +1,1 @@
-x
+y
`)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('build_patch_grammar_invalid')
    expect(r.reason).toContain('headers')
  })
})
