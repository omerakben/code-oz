import type { AgentPermissions } from '../agents/schema.ts'

export const AGENT_PACK_SCHEMA_VERSION = 1 as const

export interface AgentPackAgentRef {
  readonly file: string
  readonly name: string
}

export interface AgentPackManifestV1 {
  readonly schemaVersion: typeof AGENT_PACK_SCHEMA_VERSION
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly codeOzVersion: string
  readonly agents: readonly AgentPackAgentRef[]
  readonly permissions?: AgentPermissions
}

export type AgentPackManifest = AgentPackManifestV1
