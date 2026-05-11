import { describe, test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition } from '../src/agents/schema.ts'
import { DEFAULT_CONFIG } from '../src/config/schema.ts'
import { FakeProvider, collectProviderResponse } from '../src/providers/fake.ts'
import { invokeAgent } from '../src/providers/invoke.ts'
import { ProviderRegistry } from '../src/providers/registry.ts'
import { capabilityOf, type ProviderCapability } from '../src/providers/capabilities.ts'
import type {
  IAgentProvider,
  PreparedProviderRequest,
  ProviderEvent,
  ProviderFamily,
  ProviderHealth,
  ProviderId,
  ProviderRequest,
  ProviderToolCall,
} from '../src/providers/types.ts'
import { readEvents } from '../src/state/events.ts'
import { generateUlid, type LoggedEvent, type PhaseEvent } from '../src/state/schemas.ts'
import { initRun, runPathsFor } from '../src/state/run.ts'

const HANDOFF_PROVIDER_IDS = ['claude', 'codex', 'gemini', 'xai'] as const
type HandoffProviderId = (typeof HANDOFF_PROVIDER_IDS)[number]

interface DirectionalPair {
  readonly sourceProviderId: HandoffProviderId
  readonly targetProviderId: HandoffProviderId
  readonly index: number
}

type AgentInvokedEvent = Extract<PhaseEvent, { readonly type: 'agent_invoked' }>

interface AssistantMessageSnapshot {
  readonly content: string
  readonly tool_calls: readonly ProviderToolCall[]
}

const DIRECTIONAL_PAIRS: DirectionalPair[] = HANDOFF_PROVIDER_IDS.flatMap(
  (sourceProviderId) =>
    HANDOFF_PROVIDER_IDS.filter((targetProviderId) => targetProviderId !== sourceProviderId).map(
      (targetProviderId) => ({ sourceProviderId, targetProviderId }),
    ),
).map((pair, index) => ({ ...pair, index }))

class FamilyAlias implements IAgentProvider {
  readonly family: ProviderFamily
  readonly capability: ProviderCapability
  readonly seenRequests: PreparedProviderRequest[] = []

  constructor(
    readonly id: ProviderId,
    family: ProviderFamily,
    private readonly delegate: FakeProvider,
  ) {
    this.family = family
    this.capability = capabilityOf(id)
  }

  invoke(req: PreparedProviderRequest): AsyncIterable<ProviderEvent> {
    this.seenRequests.push(req)
    return this.delegate.invoke(req)
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      authStatus: 'ok',
      modelDefaultAvailable: true,
      latencyMs: 0,
    }
  }
}

describe('cross-family assistant message handoff', () => {
  test.each(DIRECTIONAL_PAIRS)(
    '$sourceProviderId -> $targetProviderId keeps REVIEW cross-family and manifest invariants',
    async ({ sourceProviderId, targetProviderId, index }: DirectionalPair) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'code-oz-cross-family-'))
      try {
        const stateDir = join(projectRoot, '.code-oz', 'state')
        const artifactRoot = join(projectRoot, '.code-oz', 'artifacts')
        await mkdir(artifactRoot, { recursive: true })

        const runId = runIdFor(index)
        const runPaths = runPathsFor(stateDir, artifactRoot, runId)
        await initRun({
          paths: runPaths,
          profile: 'greenfield',
          runId,
          now: () => '2026-05-10T12:00:00.000Z',
        })

        const fake = new FakeProvider({ strict: true })
        const aliases = makeAliases(fake)
        const registry = new ProviderRegistry({ providers: aliases })
        const aliasById = new Map(aliases.map((alias) => [alias.id, alias]))

        expect(registry.familyOf(sourceProviderId)).not.toBe(
          registry.familyOf(targetProviderId),
        )

        const sourceAgent = agentFor({
          name: `handoff-source-${sourceProviderId}`,
          provider: sourceProviderId,
          read: [],
        })
        const targetAgent = agentFor({
          name: `handoff-target-${targetProviderId}`,
          provider: targetProviderId,
          read: [sourceMessageRelPath(sourceProviderId, targetProviderId)],
        })

        const toolCalls: readonly ProviderToolCall[] = [
          {
            id: `tool-${sourceProviderId}-to-${targetProviderId}`,
            name: 'review_note',
            input: {
              sourceProviderId,
              targetProviderId,
              verdict: 'preserve-bytes',
            },
          },
        ]
        const sourceContent =
          `assistant message from ${sourceProviderId} to ${targetProviderId}\n` +
          'rule 2 review handoff payload'
        fake.expect({ phase: 'review', agent: sourceAgent.name }).respondWith({
          content: sourceContent,
          tokensUsed: 7,
          model: `${sourceProviderId}-fake-model`,
          stopReason: 'tool_use',
          toolCalls,
          chunks: [sourceContent.slice(0, 24), sourceContent.slice(24)],
        })
        fake.expect({ phase: 'review', agent: targetAgent.name }).respondWith({
          content: `target ${targetProviderId} reviewed source ${sourceProviderId}`,
          tokensUsed: 5,
          model: `${targetProviderId}-fake-model`,
          stopReason: 'end_turn',
        })

        const sourceResponse = await collectProviderResponse(
          invokeAgent(
            {
              registry,
              runPaths,
              config: DEFAULT_CONFIG,
              projectRoot,
              now: () => '2026-05-10T12:01:00.000Z',
            },
            requestFor({ agent: sourceAgent, runId, files: [] }),
          ),
        )
        const sourceMessageBytes = assistantMessageBytes({
          content: sourceResponse.content,
          tool_calls: sourceResponse.toolCalls ?? [],
        })

        const messageRelPath = sourceMessageRelPath(sourceProviderId, targetProviderId)
        const messageAbsPath = join(projectRoot, messageRelPath)
        await writeFile(messageAbsPath, sourceMessageBytes)

        const targetRequest: ProviderRequest = requestFor({
          agent: targetAgent,
          runId,
          files: [{ path: messageRelPath }],
        })
        await collectProviderResponse(
          invokeAgent(
            {
              registry,
              runPaths,
              config: DEFAULT_CONFIG,
              projectRoot,
              now: () => '2026-05-10T12:02:00.000Z',
            },
            targetRequest,
          ),
        )

        const targetPrepared = aliasById.get(targetProviderId)?.seenRequests[0]
        expect(targetPrepared).toBeDefined()
        expect(targetPrepared?.files.map((file) => file.path)).toEqual([messageRelPath])
        expect(Buffer.compare(targetPrepared?.files[0]?.content ?? Buffer.alloc(0), sourceMessageBytes)).toBe(0)

        const persistedMessageBytes = await readFile(messageAbsPath)
        expect(Buffer.compare(persistedMessageBytes, sourceMessageBytes)).toBe(0)

        const invokedEvents = (await readEvents({
          file: runPaths.eventsFile,
          lockDir: runPaths.lockDir,
        })).filter(isAgentInvoked)

        const sourceInvoked = invokedEvents.find((event) => event.agent === sourceAgent.name)
        expect(sourceInvoked?.provider).toBe(sourceProviderId)

        const targetInvoked = invokedEvents.find((event) => event.agent === targetAgent.name)
        expect(targetInvoked?.manifest.files.map((file) => file.path)).toEqual([messageRelPath])
      } finally {
        await rm(projectRoot, { recursive: true, force: true })
      }
    },
  )
})

function makeAliases(fake: FakeProvider): readonly FamilyAlias[] {
  return HANDOFF_PROVIDER_IDS.map((id) => new FamilyAlias(id, id, fake))
}

function agentFor(args: {
  readonly name: string
  readonly provider: HandoffProviderId
  readonly read: readonly string[]
}): AgentDefinition {
  return {
    file: `tests/fixtures/${args.name}.md`,
    name: args.name,
    type: 'agent',
    phase: 'review',
    provider: args.provider,
    modelPolicy: 'any',
    permissions: {
      read: args.read,
      write: [],
      bash: 'deny',
    },
    description: `Cross-family handoff fixture for ${args.provider}`,
    body: '# Cross-family handoff fixture\n',
  }
}

function requestFor(args: {
  readonly agent: AgentDefinition
  readonly runId: string
  readonly files: ProviderRequest['files']
}): ProviderRequest {
  return {
    agent: args.agent,
    phase: 'review',
    runId: args.runId,
    prompt: `Review the explicit file manifest for ${args.agent.name}.`,
    files: args.files,
  }
}

function sourceMessageRelPath(
  sourceProviderId: HandoffProviderId,
  targetProviderId: HandoffProviderId,
): string {
  return `.code-oz/artifacts/assistant-message-${sourceProviderId}-to-${targetProviderId}.json`
}

function assistantMessageBytes(message: AssistantMessageSnapshot): Buffer {
  return Buffer.from(JSON.stringify(message), 'utf8')
}

function isAgentInvoked(event: LoggedEvent): event is AgentInvokedEvent {
  return event.type === 'agent_invoked'
}

function runIdFor(index: number): string {
  const random = new Uint8Array(10)
  random[9] = index
  return generateUlid({ now: 1_778_377_600_000 + index, random })
}
