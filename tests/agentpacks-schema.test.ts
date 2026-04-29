import { describe, test, expect } from 'bun:test'
import {
  AGENT_PACK_SCHEMA_VERSION,
  type AgentPackManifestV1,
} from '../src/agentpacks/schema.ts'

describe('AgentPackManifestV1 (forward-compat type surface)', () => {
  test('exports a stable schema version constant', () => {
    expect(AGENT_PACK_SCHEMA_VERSION).toBe(1)
  })

  test('manifest type accepts a minimal valid V1 shape', () => {
    const manifest: AgentPackManifestV1 = {
      schemaVersion: AGENT_PACK_SCHEMA_VERSION,
      name: 'example-pack',
      version: '0.1.0',
      codeOzVersion: '^0.2.0',
      agents: [{ file: 'agents/ba.md', name: 'ba' }],
    }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.agents).toHaveLength(1)
  })

  test('manifest type accepts optional description and permissions', () => {
    const manifest: AgentPackManifestV1 = {
      schemaVersion: AGENT_PACK_SCHEMA_VERSION,
      name: 'example-pack',
      version: '0.1.0',
      description: 'Example agent pack',
      codeOzVersion: '^0.2.0',
      agents: [],
      permissions: { read: '*', write: [], bash: 'deny' },
    }
    expect(manifest.permissions?.read).toBe('*')
    expect(manifest.description).toBe('Example agent pack')
  })

  test('agent ref type pairs a pack-relative path with a name', () => {
    const ref: AgentPackManifestV1['agents'][number] = {
      file: 'agents/lead.md',
      name: 'lead',
    }
    expect(ref.file).toBe('agents/lead.md')
    expect(ref.name).toBe('lead')
  })
})
