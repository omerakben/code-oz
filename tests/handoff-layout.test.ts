import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderHandoffReadme } from '../scripts/build-binaries.ts'
import { validateHandoffLayout } from '../scripts/smoke-test.ts'

const VERSION = '0.17.0-alpha.0'
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('validateHandoffLayout', () => {
  test('accepts a complete handoff fixture', async () => {
    const root = await createHandoffFixture()

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.manifest?.version).toBe(VERSION)
  })

  test('fails when manifest.json is missing', async () => {
    const root = await createHandoffFixture()
    await rm(join(root, 'manifest.json'))

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('manifest.json missing')
  })

  test('fails when a binary is missing', async () => {
    const root = await createHandoffFixture()
    await rm(join(root, 'darwin-x64/code-oz'))

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      `darwin-x64 binary missing at ${join(root, 'darwin-x64/code-oz')}`,
    )
  })

  test('fails when the manifest schemaVersion is wrong', async () => {
    const root = await createHandoffFixture({ schemaVersion: 2 })

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('manifest schemaVersion must be 1')
  })

  test('fails when the manifest version does not match the injected package version', async () => {
    const root = await createHandoffFixture({ version: '0.0.0-test' })

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'manifest version 0.0.0-test does not match package version 0.17.0-alpha.0',
    )
  })

  test('fails when install.sh is not executable', async () => {
    const root = await createHandoffFixture()
    await chmod(join(root, 'install.sh'), 0o644)

    const result = await validateHandoffLayout(root, { expectedVersion: VERSION })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('dist/handoff/install.sh is not executable')
  })

  test('renders the operator README with the injected version', () => {
    const readme = renderHandoffReadme(VERSION)

    expect(readme).toContain(`# code-oz ${VERSION}`)
    expect(readme).toContain(`Should print: \`${VERSION}\`.`)
    expect(readme).toContain('|-- install.sh')
    expect(readme).not.toContain('<version>')
  })
})

async function createHandoffFixture(opts: {
  schemaVersion?: number
  version?: string
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'code-oz-handoff-layout-'))
  tempDirs.push(root)
  const version = opts.version ?? VERSION
  await mkdir(join(root, 'darwin-arm64'), { recursive: true })
  await mkdir(join(root, 'darwin-x64'), { recursive: true })
  await writeFile(join(root, 'darwin-arm64/code-oz'), '#!/bin/sh\necho arm\n')
  await writeFile(join(root, 'darwin-x64/code-oz'), '#!/bin/sh\necho x64\n')
  await chmod(join(root, 'darwin-arm64/code-oz'), 0o755)
  await chmod(join(root, 'darwin-x64/code-oz'), 0o755)
  await writeFile(join(root, 'install.sh'), '#!/bin/sh\necho install\n')
  await chmod(join(root, 'install.sh'), 0o755)
  await writeFile(join(root, 'README.md'), renderHandoffReadme(version))
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: opts.schemaVersion ?? 1,
        version,
        builtAt: '2026-05-02T05:00:00.000Z',
        targets: [
          {
            os: 'darwin',
            arch: 'arm64',
            bunTarget: 'bun-darwin-arm64',
            binaryRelativePath: 'darwin-arm64/code-oz',
            sha256: 'a'.repeat(64),
            sizeBytes: 19,
            version,
          },
          {
            os: 'darwin',
            arch: 'x64',
            bunTarget: 'bun-darwin-x64',
            binaryRelativePath: 'darwin-x64/code-oz',
            sha256: 'b'.repeat(64),
            sizeBytes: 19,
            version,
          },
        ],
      },
      null,
      2,
    ),
  )
  return root
}
