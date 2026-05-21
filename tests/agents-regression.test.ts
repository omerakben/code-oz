import { describe, test, expect } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadRegistry } from '../src/agents/loader.ts'
import { loadBundledDefaults } from '../src/agents/bundled-defaults.ts'
import { AgentLoadError } from '../src/agents/errors.ts'

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/agents/', import.meta.url))

const fix = (name: string) => join(FIXTURES_DIR, name)

async function loadWithBundled(projectDir: string) {
  const defaults = await loadBundledDefaults()
  return loadRegistry({ defaults, projectDir, cwd: FIXTURES_DIR })
}

async function expectLoadError(
  projectDir: string,
  expectedCode: string,
): Promise<AgentLoadError> {
  try {
    await loadWithBundled(projectDir)
  } catch (err) {
    expect(err).toBeInstanceOf(AgentLoadError)
    const e = err as AgentLoadError
    expect(e.issues.some((i) => i.code === expectedCode)).toBe(true)
    return e
  }
  throw new Error(`expected AgentLoadError with code ${expectedCode}`)
}

describe('M2 regression fixtures', () => {
  test('valid project-local override replaces the bundled persona body', async () => {
    const reg = await loadWithBundled(fix('valid-override'))
    expect(reg.listAll()).toHaveLength(7)
    const ba = reg.getByName('ba')!
    expect(ba.body).toContain('# BA (project override)')
    // Type and phase are preserved
    expect(ba.type).toBe('agent')
    expect(ba.phase).toBe('define')
  })

  test('phase mismatch on same-named override is rejected', async () => {
    await expectLoadError(fix('phase-mismatch'), 'loader_phase_mismatch_override')
  })

  test('description longer than 1024 characters is rejected', async () => {
    await expectLoadError(fix('description-too-long'), 'schema_description_too_long')
  })

  test('name field that disagrees with file basename is rejected', async () => {
    await expectLoadError(fix('name-filename-mismatch'), 'schema_name_file_mismatch')
  })

  test('unknown phase value is rejected with schema_invalid_value', async () => {
    await expectLoadError(fix('unknown-phase'), 'schema_invalid_value')
  })

  test('M1 init regression: bundled defaults still load standalone with no project dir', async () => {
    const defaults = await loadBundledDefaults()
    const reg = await loadRegistry({ defaults, cwd: FIXTURES_DIR })
    expect(reg.listAll().map((d) => d.name).sort()).toEqual([
      'auditor',
      'ba',
      'builder',
      'lead',
      'reviewer',
      'scientist',
      'verifier',
    ])
  })
})
