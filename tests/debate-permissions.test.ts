// M10 commit 5: debate-permissions manifest preview tests.
//
// Covers the D9 lock (non-interactive audit), the ignore-policy filter,
// and path-safety filtering. The preview is written before any provider
// call (risk #7); the sha is bound to debate_started.manifestPreviewSha256.

import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDebateManifestPreview } from '../src/tools/debate-permissions.ts'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'codeoz-debate-permissions-'))
}

function basicInput(projectRoot: string, files: string[] = []) {
  return {
    topic: 'plan-source-priority',
    callerProvider: 'claude',
    callerFamily: 'claude',
    opposingProvider: 'codex',
    opposingFamily: 'codex',
    files,
    projectRoot,
    date: '2026-05-01T12:00:00Z',
  }
}

describe('buildDebateManifestPreview - happy path', () => {
  test('absent .code-ozignore: all files pass', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, 'src.ts'), 'x')
      const r = await buildDebateManifestPreview(basicInput(dir, ['src.ts']))
      expect(r.allowedFiles).toEqual(['src.ts'])
      expect(r.blockedFiles).toHaveLength(0)
      expect(r.ignorePolicy.source).toBe('absent')
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(r.content).toContain('Allowed files')
      expect(r.content).toContain('plan-source-priority')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preview content is deterministic (same input -> same sha)', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, 'src.ts'), 'x')
      const a = await buildDebateManifestPreview(basicInput(dir, ['src.ts']))
      const b = await buildDebateManifestPreview(basicInput(dir, ['src.ts']))
      expect(a.sha256).toBe(b.sha256)
      expect(a.content).toBe(b.content)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('empty file list produces a valid preview with zero allowed/blocked', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(basicInput(dir, []))
      expect(r.allowedFiles).toEqual([])
      expect(r.blockedFiles).toEqual([])
      expect(r.content).toContain('(no allowed files)')
      expect(r.content).toContain('(no blocked files)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('frozen output (allowedFiles, blockedFiles, ignorePolicy)', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(basicInput(dir, []))
      expect(Object.isFrozen(r)).toBe(true)
      expect(Object.isFrozen(r.allowedFiles)).toBe(true)
      expect(Object.isFrozen(r.blockedFiles)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildDebateManifestPreview - ignore-policy filter', () => {
  test('matching ignore pattern blocks file with reason ignore-policy', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\n**/secrets.json\n')
      writeFileSync(join(dir, '.env'), 'SECRET=x')
      writeFileSync(join(dir, 'src.ts'), 'x')
      const r = await buildDebateManifestPreview(
        basicInput(dir, ['.env', 'src.ts']),
      )
      expect(r.allowedFiles).toEqual(['src.ts'])
      expect(r.blockedFiles).toHaveLength(1)
      expect(r.blockedFiles[0]?.reason).toBe('ignore-policy')
      expect(r.blockedFiles[0]?.relPath).toBe('.env')
      expect(r.blockedFiles[0]?.pattern).toBe('.env')
      expect(r.blockedFiles[0]?.patternLine).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preview content names the blocked files explicitly', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\n')
      const r = await buildDebateManifestPreview(basicInput(dir, ['.env']))
      expect(r.content).toContain('.env')
      expect(r.content).toContain('blocked by .code-ozignore line 1')
      expect(r.content).toContain('Files blocked:** 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('multiple ignore patterns match correctly', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(
        join(dir, '.code-ozignore'),
        '.env\n**/secrets.json\nconfig/credentials/\n',
      )
      const r = await buildDebateManifestPreview(
        basicInput(dir, [
          '.env',
          'src/main.ts',
          'src/data/secrets.json',
          'config/credentials/api.key',
        ]),
      )
      expect(r.allowedFiles).toEqual(['src/main.ts'])
      expect(r.blockedFiles).toHaveLength(3)
      const reasons = r.blockedFiles.map((b) => b.relPath).sort()
      expect(reasons).toEqual([
        '.env',
        'config/credentials/api.key',
        'src/data/secrets.json',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildDebateManifestPreview - path-safety filter', () => {
  test('absolute path is blocked as path-unsafe', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(
        basicInput(dir, ['/etc/passwd']),
      )
      expect(r.blockedFiles).toHaveLength(1)
      expect(r.blockedFiles[0]?.reason).toBe('path-unsafe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('`..` traversal is blocked', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(
        basicInput(dir, ['../escape.ts']),
      )
      expect(r.blockedFiles).toHaveLength(1)
      expect(r.blockedFiles[0]?.reason).toBe('path-unsafe')
      expect(r.blockedFiles[0]?.rule).toContain('..')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('backslash separators rejected (POSIX-only)', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(
        basicInput(dir, ['src\\main.ts']),
      )
      expect(r.blockedFiles).toHaveLength(1)
      expect(r.blockedFiles[0]?.reason).toBe('path-unsafe')
      expect(r.blockedFiles[0]?.rule).toContain('forward slashes')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('empty path string is blocked', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(basicInput(dir, ['']))
      expect(r.blockedFiles).toHaveLength(1)
      expect(r.blockedFiles[0]?.reason).toBe('path-unsafe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('mixed allowed + path-unsafe + ignore-policy in single request', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\n')
      const r = await buildDebateManifestPreview(
        basicInput(dir, ['src/main.ts', '../escape', '.env']),
      )
      expect(r.allowedFiles).toEqual(['src/main.ts'])
      expect(r.blockedFiles).toHaveLength(2)
      const reasons = r.blockedFiles.map((b) => b.reason).sort()
      expect(reasons).toEqual(['ignore-policy', 'path-unsafe'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildDebateManifestPreview - preview content shape', () => {
  test('preview header includes topic, caller, opposing, date, ignore-policy status', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '.env\n')
      const r = await buildDebateManifestPreview(basicInput(dir, []))
      expect(r.content).toContain('# Debate manifest preview - plan-source-priority')
      expect(r.content).toContain('**Date:** 2026-05-01T12:00:00Z')
      expect(r.content).toContain('**Caller:** claude (family: claude)')
      expect(r.content).toContain('**Opposing:** codex (family: codex)')
      expect(r.content).toContain('**Ignore-policy:** present (1 pattern')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('absent ignore-policy is named explicitly in the preview', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(basicInput(dir, []))
      expect(r.content).toContain('absent (no `.code-ozignore` file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preview includes a Notes section pointing operators at events.jsonl', async () => {
    const dir = tmpProject()
    try {
      const r = await buildDebateManifestPreview(basicInput(dir, []))
      expect(r.content).toContain('## Notes')
      expect(r.content).toContain('non-interactive')
      expect(r.content).toContain('events.jsonl')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildDebateManifestPreview - ignore-policy parse failure surface', () => {
  test('invalid .code-ozignore syntax causes loadIgnorePolicy to throw', async () => {
    const dir = tmpProject()
    try {
      writeFileSync(join(dir, '.code-ozignore'), '!negation\n')
      // The unsupported-syntax error from loadIgnorePolicy bubbles out;
      // requestDebate (commit 7) catches it and emits an intervention.
      await expect(buildDebateManifestPreview(basicInput(dir, []))).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
