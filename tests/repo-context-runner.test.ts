import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runRepoContextTool } from '../src/tools/repo-context/runner.ts'
import { readEvents } from '../src/state/events.ts'
import type { AgentPermissions } from '../src/agents/schema.ts'

const RG_AVAILABLE = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { stdio: 'pipe' })
    return r.status === 0
  } catch {
    return false
  }
})()

const PERMS: AgentPermissions = Object.freeze({
  read: '*',
  write: '*',
  bash: 'deny',
  tool_use: Object.freeze({
    repo_context: Object.freeze({
      tools: Object.freeze(['glob', 'grep', 'read'] as const),
      roots: Object.freeze(['.']),
      maxResults: 50,
      maxBytesPerResult: 16384,
      maxFilesForNextManifest: 20,
      timeoutMs: 5000,
      network: 'none',
    }),
  }),
})

let project: string
let eventsFile: string
let lockDir: string

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), 'codeoz-runner-'))
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/a.ts'), 'export const NEEDLE = 1\n')
  await writeFile(join(project, 'src/b.ts'), 'no match here\n')
  eventsFile = join(project, 'events.jsonl')
  lockDir = join(project, '.lock')
})

describe.if(RG_AVAILABLE)('runRepoContextTool — events', () => {
  test('emits repo_context_searched with correct shape on glob success', async () => {
    const out = await runRepoContextTool(
      {
        agentName: 'lead',
        agentPermissions: PERMS,
        phase: 'plan',
        runId: '01J3Z89H5R8K3CZ8B0K4MZTGNH',
        projectRoot: project,
        eventPaths: { file: eventsFile, lockDir },
        now: () => '2026-04-30T12:00:00.000Z',
      },
      { tool: 'glob', args: { pattern: '*.ts' } },
    )
    expect(out.status).toBe('ok')
    if (out.status === 'ok') {
      expect(out.result.tool).toBe('glob')
    }
    const events = await readEvents({ file: eventsFile, lockDir })
    const last = events[events.length - 1]!
    expect(last.type).toBe('repo_context_searched')
    // Defensive type narrowing — readEvents returns LoggedEvent (the lenient
    // read-side union); narrow with `isKnownPhaseEvent` before reading
    // typed fields.
    if (last.type === 'repo_context_searched' && 'tool' in last) {
      expect(last.tool).toBe('glob')
      expect(last.query).toBe('*.ts')
      expect(last.selectedPaths).toEqual([])
      expect(last.resultBytes).toBeGreaterThan(0)
    }
  })

  test('emits a repo_context_searched event even when permission denied', async () => {
    const denied: AgentPermissions = Object.freeze({ read: '*', write: '*', bash: 'deny' })
    const out = await runRepoContextTool(
      {
        agentName: 'no-tool-agent',
        agentPermissions: denied,
        phase: 'plan',
        runId: '01J3Z89H5R8K3CZ8B0K4MZTGNH',
        projectRoot: project,
        eventPaths: { file: eventsFile, lockDir },
        now: () => '2026-04-30T12:00:00.000Z',
      },
      { tool: 'glob', args: { pattern: '*' } },
    )
    expect(out.status).toBe('error')
    const events = await readEvents({ file: eventsFile, lockDir })
    const last = events[events.length - 1]!
    expect(last.type).toBe('repo_context_searched')
    // Defensive type narrowing — readEvents returns LoggedEvent (the lenient
    // read-side union); narrow with `isKnownPhaseEvent` before reading
    // typed fields.
    if (last.type === 'repo_context_searched' && 'tool' in last) {
      expect(last.resultBytes).toBe(0)
      expect(last.resultPaths).toEqual([])
    }
  })
})
