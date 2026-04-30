import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execRead } from '../src/tools/repo-context/read.ts'
import { RepoContextError } from '../src/tools/repo-context/errors.ts'

let project: string

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'codeoz-read-'))
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/a.ts'), 'line 1\nline 2\nline 3\nline 4\nline 5\n')
  await writeFile(join(project, 'src/big.txt'), 'x'.repeat(20_000))
})

describe('execRead', () => {
  test('reads full content under cap', async () => {
    const r = await execRead(
      { path: 'src/a.ts' },
      { maxBytesPerResult: 1024, projectRoot: project },
    )
    expect(r.tool).toBe('read')
    expect(r.content).toContain('line 1')
    expect(r.content).toContain('line 5')
    expect(r.truncated).toBe(false)
  })

  test('returns content truncated to maxBytesPerResult', async () => {
    const r = await execRead(
      { path: 'src/big.txt' },
      { maxBytesPerResult: 1024, projectRoot: project },
    )
    expect(r.content.length).toBe(1024)
    expect(r.truncated).toBe(true)
  })

  test('honors lineRange', async () => {
    const r = await execRead(
      { path: 'src/a.ts', lineRange: [2, 4] },
      { maxBytesPerResult: 1024, projectRoot: project },
    )
    expect(r.content).toBe('line 2\nline 3\nline 4')
  })

  test('rejects malformed lineRange', async () => {
    await expect(
      execRead(
        { path: 'src/a.ts', lineRange: [5, 1] },
        { maxBytesPerResult: 1024, projectRoot: project },
      ),
    ).rejects.toThrow(RepoContextError)
  })

  test('throws tool_io_error on missing file', async () => {
    await expect(
      execRead(
        { path: 'src/missing.ts' },
        { maxBytesPerResult: 1024, projectRoot: project },
      ),
    ).rejects.toThrow(RepoContextError)
  })

  test('reports resultBytes for the returned content', async () => {
    const r = await execRead(
      { path: 'src/a.ts', lineRange: [1, 1] },
      { maxBytesPerResult: 1024, projectRoot: project },
    )
    expect(r.resultBytes).toBe(Buffer.byteLength('line 1', 'utf8'))
  })
})
