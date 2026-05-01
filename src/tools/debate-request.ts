// M10 commit 7: requestDebate primitive.
//
// The runtime that turns DEBATE.md's process contract into a callable
// primitive. Per CODEX_RESPONSE_M10.md:
//   - D1 lock: debate is a two-turn flow inside the calling phase.
//     Turn A = opposing-party invocation; Turn B = synthesis (DECISION
//     authoring). The PLAN orchestrator (commit 8) treats the
//     `<debate-request>` block as a terminal directive and discards
//     trailing pre-debate prose; it then re-invokes the calling persona
//     with the synthesis prompt and feeds DECISION back to PLAN
//     continuation.
//   - D3 lock: M10 strictly serial; runtime enforces maxConcurrent: 1
//     per (runId, phase) by scanning events.jsonl for open debates.
//   - D4 lock: opposing party is a synthetic AgentDefinition with
//     externalized prompt + scoped read permissions = exact manifest
//     paths (NEVER permissions.read='*').
//   - D5 lock: orchestrator validates DECISION shape; exact-copy
//     rationale check fires against opposing RESPONSE; uses existing
//     debate_decision_no_rationale code (no warning-event drift).
//   - D6 lock: ignore-policy filter via debate-permissions.ts;
//     fail-closed on unsupported syntax in .code-ozignore.
//   - D7 lock: per-run topic uniqueness checked against events.jsonl
//     AND artifact-directory presence (crash before debate_started
//     can leave a directory).
//   - D9 lock: manifest preview is non-interactive audit; sha bound
//     to debate_started.manifestPreviewSha256.
//   - D10 lock: RESPONSE.md first-line `Overall verdict: <enum>` grammar.
//   - D11 lock: opposing + synthesis BOTH count under existing
//     budgets.global; both flow through invokeAgent. No "+0" carve-out.
//   - Risk #4 mitigation: only two events (debate_started,
//     debate_resolved). Failures emit intervention via existing
//     plumbing in invokeAgent.
//
// The primitive is an async generator that yields ProviderEvents from
// both turns. The PLAN orchestrator iterates and passes through to
// the user/operator (or test harness).

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import {
  parseDecision,
  parseResponse,
  serializeBriefing,
  debateArtifactSha256,
  type DebateSide,
  type DebateVerdict,
  type ResponseDoc,
  type DecisionDoc,
} from '../artifacts/debate.ts'
import {
  composeDebateOpponentPrompt,
  composeDebateSynthesisPrompt,
} from '../prompts/index.ts'
import { providerError } from '../providers/errors.ts'
import { invokeAgent, type InvokeContext } from '../providers/invoke.ts'
import type {
  ProviderEvent,
  ProviderFileRef,
  ProviderId,
  ProviderRequest,
  ProviderResponse,
} from '../providers/types.ts'
import type { AgentDefinition, AgentPhase } from '../agents/schema.ts'
import { buildDebateManifestPreview } from './debate-permissions.ts'
import { appendEvent, readEvents } from '../state/events.ts'
import type { LoggedEvent } from '../state/schemas.ts'

export interface DebateRequestInput {
  /** Calling persona invoking the debate. Provider id + family identify
   *  caller for cross-family enforcement and RESPONSE.{side}.md naming. */
  readonly caller: AgentDefinition
  /** Phase the caller is invoking from. Echoed into events + topic prefix. */
  readonly phase: AgentPhase
  /** Topic slug (no phase prefix here; the caller is responsible for
   *  including the phase prefix per DEBATE.md grammar). Lowercase-kebab,
   *  <= 48 chars. */
  readonly topic: string
  /** Opposing provider id. Must be cross-family with caller. */
  readonly opposingProvider: ProviderId
  /** The question to debate. */
  readonly question: string
  /** File manifest the persona requested be surfaced into BRIEFING.md.
   *  Filtered through ignore-policy + path-safety. */
  readonly files: readonly ProviderFileRef[]
  /** Run id. */
  readonly runId: string
  /** ISO 8601 date for artifact frontmatter. */
  readonly date: string
  /** Caller label (e.g., 'Claude'). */
  readonly callerLabel: string
  /** Target descriptor for BRIEFING (e.g., 'gpt-5.5 xhigh'). */
  readonly targetLabel: string
  /** Cycle phase (boot|plan|implement|review|tag|handoff). */
  readonly cycle: string
  /** BRIEFING status (thesis|implementation|review). */
  readonly status: 'thesis' | 'implementation' | 'review'
  /** BRIEFING H2 sections — caller authors. */
  readonly briefingSections: {
    readonly whatYouAreReading: string
    readonly whereWeStand: string
    readonly whatIsLocked: string
    readonly whatIsUpForDebate: string
    readonly recommendedPath: string
    readonly decisionPrompts: string
    readonly whatIWantFromYou: string
  }
  /** Project root for ignore-policy. */
  readonly projectRoot: string
  /** Resolved-by string for DECISION frontmatter (e.g., "Ozzy + Claude Opus 4.7"). */
  readonly resolvedBy: string
  /** Ready signal for prompts (passed through to composer). */
  readonly readySignal?: string
}

export interface DebateResult {
  readonly briefingPath: string
  readonly responsePath: string
  readonly decisionPath: string
  readonly previewPath: string
  readonly callerVerdict: DebateVerdict
  readonly responseVerdict: DebateVerdict
  readonly briefingSha256: string
  readonly decisionSha256: string
  readonly manifestPreviewSha256: string
}

/**
 * The async generator coordinates both turns of the debate. Yields
 * ProviderEvents from opposing-party invocation, then synthesis-turn
 * invocation. After the consumer drains the iterable, all four artifacts
 * (MANIFEST.preview.md, BRIEFING.md, RESPONSE.{side}.md, DECISION.md)
 * are atomically written and debate_started + debate_resolved events
 * have been appended.
 *
 * The result is exposed via the `result` property of the returned
 * iterable wrapper (set after the generator completes).
 *
 * Throws ProviderError on:
 *   - cross-family invariant violation (provider_permissions_violation)
 *   - topic collision (debate_topic_collision)
 *   - concurrent-limit exceeded (debate_concurrent_limit_exceeded)
 *   - manifest blocked (debate_manifest_blocked)
 *   - response or decision parse failure (debate_*_invalid)
 *   - exact-copy rationale (debate_decision_no_rationale)
 */
export interface DebateRunner extends AsyncIterable<ProviderEvent> {
  /** Set after the generator completes successfully. */
  result(): DebateResult | null
}

export function requestDebate(
  ctx: InvokeContext,
  req: DebateRequestInput,
): DebateRunner {
  let resolved: DebateResult | null = null
  const generator = run(ctx, req, (r) => { resolved = r })
  return Object.freeze({
    [Symbol.asyncIterator]: () => generator,
    result: () => resolved,
  })
}

async function* run(
  ctx: InvokeContext,
  req: DebateRequestInput,
  setResult: (r: DebateResult) => void,
): AsyncGenerator<ProviderEvent> {
  // 1. Cross-family invariant (runtime check; load-time check is in
  //    src/agents/schema.ts at validateDebate).
  const callerProvider = req.caller.provider as ProviderId
  const callerFamily = ctx.registry.familyOf(callerProvider)
  const opposingFamily = ctx.registry.familyOf(req.opposingProvider)
  if (callerFamily === opposingFamily) {
    throw providerError(
      'provider_permissions_violation',
      'debate opposing provider must differ from caller family',
      [
        `caller persona ${req.caller.name} declares provider=${callerProvider} (family=${callerFamily})`,
        `pick an opposingProvider whose family is not ${callerFamily}`,
      ],
      `caller=${callerProvider} (family=${callerFamily}), opposing=${req.opposingProvider} (family=${opposingFamily})`,
    )
  }

  // 2. Topic uniqueness check (D7 lock): events.jsonl AND artifact dir.
  const events = await readEvents({
    file: ctx.runPaths.eventsFile,
    lockDir: ctx.runPaths.lockDir,
  })
  for (const e of events) {
    if (e.type === 'debate_started' && (e as { topic?: string }).topic === req.topic) {
      throw providerError(
        'debate_topic_collision',
        `debate topic '${req.topic}' already started in this run`,
        ['pick a more specific topic slug; topics are run-scoped unique'],
        `runId=${req.runId}`,
      )
    }
  }
  const debateDirPath = join(ctx.runPaths.runDir, 'artifacts', 'debates', req.topic)
  if (existsSync(debateDirPath)) {
    throw providerError(
      'debate_topic_collision',
      `debate artifact directory already exists at ${debateDirPath}`,
      ['pick a more specific topic slug; artifact directories are run-scoped unique'],
    )
  }

  // 3. Concurrent-limit check (D3 lock): scan for open debates in this
  //    phase invocation (debate_started without matching debate_resolved).
  //    M10 default maxConcurrent=1 in lead.md; runtime enforces 1.
  const openDebates = countOpenDebates(events, req.phase)
  const maxConcurrent = getMaxConcurrent(req.caller)
  if (openDebates >= maxConcurrent) {
    throw providerError(
      'debate_concurrent_limit_exceeded',
      `phase ${req.phase} already has ${openDebates} open debate(s); max ${maxConcurrent}`,
      ['resolve open debates before starting a new one'],
    )
  }

  // 4. Build manifest preview (D9 lock; D6 ignore-policy filter).
  const filePaths = req.files.map((f) => f.path)
  const preview = await buildDebateManifestPreview({
    topic: req.topic,
    callerProvider,
    callerFamily,
    opposingProvider: req.opposingProvider,
    opposingFamily,
    files: filePaths,
    projectRoot: req.projectRoot,
    date: req.date,
  })
  if (preview.blockedFiles.length > 0) {
    const reasons = preview.blockedFiles
      .map((b) => `  - ${b.relPath}: ${b.rule}`)
      .join('\n')
    throw providerError(
      'debate_manifest_blocked',
      `${preview.blockedFiles.length} file(s) blocked by ignore-policy or path-safety`,
      [
        'edit the calling persona\'s `<debate-request>` block to remove blocked files',
        'or extend .code-ozignore exclusions only after explicit operator approval',
      ],
      reasons,
    )
  }

  // 5. Atomically write MANIFEST.preview.md + BRIEFING.md (D9 lock:
  //    preview is written before BRIEFING.md is sent and before any
  //    provider call).
  await mkdir(debateDirPath, { recursive: true })
  const previewPath = join(debateDirPath, 'MANIFEST.preview.md')
  await atomicWriteFile(previewPath, preview.content)

  const briefingContent = serializeBriefing({
    topic: req.topic,
    opposingProvider: req.opposingProvider,
    date: req.date,
    status: req.status,
    caller: req.callerLabel,
    target: req.targetLabel,
    cycle: req.cycle,
    question: req.question,
    files: preview.allowedFiles,
    sections: req.briefingSections,
  })
  const briefingPath = join(debateDirPath, 'BRIEFING.md')
  await atomicWriteFile(briefingPath, briefingContent)
  const briefingSha256 = debateArtifactSha256(briefingContent)

  // 6. Emit debate_started event.
  await appendEvent(
    { file: ctx.runPaths.eventsFile, lockDir: ctx.runPaths.lockDir },
    {
      version: 1,
      type: 'debate_started',
      ts: (ctx.now ?? (() => new Date().toISOString()))(),
      runId: req.runId,
      phase: req.phase,
      agent: req.caller.name,
      topic: req.topic,
      debateDirPath,
      briefingSha256,
      manifestPreviewSha256: preview.sha256,
      callerFamily,
      opposingProvider: req.opposingProvider,
      opposingFamily,
    },
  )

  // 7. Synthetic opposing AgentDefinition (D4 lock). Read scope includes
  //    BRIEFING.md path (project-root-relative) PLUS the manifest paths.
  //    Without BRIEFING.md in read scope the manifest builder would
  //    reject the opposing-party invocation's primary input.
  const briefingRelPath = relativeToRoot(briefingPath, req.projectRoot)
  const opposingAgent = buildOpposingAgent({
    opposingProvider: req.opposingProvider,
    callerPhase: req.phase,
    allowedReadPaths: [briefingRelPath, ...preview.allowedFiles],
  })
  const opposingPrompt = await composeDebateOpponentPrompt({
    readySignal: req.readySignal ?? '<<DEBATE_OPPONENT_DONE>>',
    availableTools: [],
  })

  // 8. Opposing-party invocation (Turn A). Files include BRIEFING.md so
  //    the opponent can read the framing; the manifest's allowed files
  //    are also surfaced (read-scope constrained at the synthetic agent
  //    permission layer).
  const opposingFiles: readonly ProviderFileRef[] = [
    { path: briefingRelPath },
    ...preview.allowedFiles.map((p) => ({ path: p })),
  ]
  const opposingReq: ProviderRequest = {
    agent: opposingAgent,
    phase: req.phase,
    runId: req.runId,
    prompt: `${opposingPrompt}\n\n## BRIEFING.md\n\nSee the file manifest. Author your RESPONSE.${familyToSide(opposingFamily)}.md per the schema above.`,
    files: opposingFiles,
  }
  let opposingContent = ''
  for await (const ev of invokeAgent(ctx, opposingReq)) {
    if (ev.type === 'content_chunk') opposingContent += ev.text
    if (ev.type === 'turn_completed') {
      // Adapter returned a single non-streaming response.
      opposingContent = (ev.response as ProviderResponse).content
    }
    yield ev
  }

  // 9. Parse and validate the opposing RESPONSE.
  const opposingSide: DebateSide = familyToSide(opposingFamily)
  let response: ResponseDoc
  try {
    response = parseResponse(opposingContent, opposingSide)
  } catch (err: unknown) {
    throw providerError(
      'debate_response_invalid',
      'opposing party RESPONSE.md failed parse',
      ['the opposing provider returned malformed RESPONSE; re-run debate or operator-edit'],
      err instanceof Error ? err.message : String(err),
    )
  }
  const responsePath = join(debateDirPath, `RESPONSE.${opposingSide}.md`)
  await atomicWriteFile(responsePath, opposingContent)

  // 10. Synthesis turn (Turn B). Caller persona authors DECISION.md
  //     given BRIEFING.md + RESPONSE.{side}.md. PLAN orchestrator
  //     (commit 8) constructs synthesisFiles after the persona's first
  //     turn returned the <debate-request> block; M10 runtime keeps
  //     this primitive phase-agnostic by composing the prompt with the
  //     synthesis template.
  const synthesisPrompt = await composeDebateSynthesisPrompt({
    readySignal: req.readySignal ?? '<<DEBATE_SYNTHESIS_DONE>>',
    availableTools: [],
  })
  const synthesisFiles: readonly ProviderFileRef[] = [
    { path: briefingRelPath },
    { path: relativeToRoot(responsePath, req.projectRoot) },
  ]
  const synthesisReq: ProviderRequest = {
    agent: req.caller,
    phase: req.phase,
    runId: req.runId,
    prompt: `${synthesisPrompt}\n\n## You wrote BRIEFING.md and received RESPONSE.${opposingSide}.md\n\nAuthor DECISION.md per the schema. The orchestrator will validate dual-verdict frontmatter, the five required H2 sections, rationale length (>= 50 chars substantive), and reject exact-copy rationale.`,
    files: synthesisFiles,
  }
  let synthesisContent = ''
  for await (const ev of invokeAgent(ctx, synthesisReq)) {
    if (ev.type === 'content_chunk') synthesisContent += ev.text
    if (ev.type === 'turn_completed') {
      synthesisContent = (ev.response as ProviderResponse).content
    }
    yield ev
  }

  // 11. Parse and validate DECISION.md (D5 lock: dual-verdict + exact-
  //     copy rationale check vs opposing RESPONSE).
  let decision: DecisionDoc
  try {
    decision = parseDecision(synthesisContent, response)
  } catch (err: unknown) {
    throw providerError(
      'debate_decision_invalid',
      'DECISION.md failed parse or validation',
      ['caller persona must author DECISION.md per schema with substantive rationale; rule 9: data, not authority'],
      err instanceof Error ? err.message : String(err),
    )
  }
  const decisionPath = join(debateDirPath, 'DECISION.md')
  await atomicWriteFile(decisionPath, synthesisContent)
  const decisionSha256 = debateArtifactSha256(synthesisContent)

  // 12. Emit debate_resolved.
  await appendEvent(
    { file: ctx.runPaths.eventsFile, lockDir: ctx.runPaths.lockDir },
    {
      version: 1,
      type: 'debate_resolved',
      ts: (ctx.now ?? (() => new Date().toISOString()))(),
      runId: req.runId,
      phase: req.phase,
      agent: req.caller.name,
      topic: req.topic,
      debateDirPath,
      decisionSha256,
      callerVerdict: decision.frontmatter.callerVerdict,
      responseVerdict: response.overallVerdict,
      rationaleSummary: decision.rationaleSummary,
    },
  )

  setResult(
    Object.freeze({
      briefingPath,
      responsePath,
      decisionPath,
      previewPath,
      callerVerdict: decision.frontmatter.callerVerdict,
      responseVerdict: response.overallVerdict,
      briefingSha256,
      decisionSha256,
      manifestPreviewSha256: preview.sha256,
    }),
  )
}

function relativeToRoot(absPath: string, projectRoot: string): string {
  if (isAbsolute(absPath)) return relative(projectRoot, absPath)
  return absPath
}

function familyToSide(family: string): DebateSide {
  if (family === 'codex') return 'codex'
  if (family === 'claude') return 'claude'
  // For families without a dedicated suffix (e.g., 'gemini', 'fake'),
  // default to 'codex' as the storage suffix; M10 ships claude+codex
  // only. The DEBATE.md schema explicitly enumerates `RESPONSE.codex.md`
  // and `RESPONSE.claude.md`; expanding to gemini is M11+ scope.
  return 'codex'
}

function countOpenDebates(events: readonly LoggedEvent[], phase: string): number {
  const startedTopics = new Set<string>()
  const resolvedTopics = new Set<string>()
  for (const e of events) {
    if (e.type === 'debate_started' && (e as { phase?: string }).phase === phase) {
      const topic = (e as { topic?: string }).topic
      if (typeof topic === 'string') startedTopics.add(topic)
    } else if (e.type === 'debate_resolved' && (e as { phase?: string }).phase === phase) {
      const topic = (e as { topic?: string }).topic
      if (typeof topic === 'string') resolvedTopics.add(topic)
    }
  }
  let open = 0
  for (const t of startedTopics) {
    if (!resolvedTopics.has(t)) open++
  }
  return open
}

function getMaxConcurrent(caller: AgentDefinition): number {
  return caller.permissions.tool_use?.debate?.maxConcurrent ?? 1
}

function buildOpposingAgent(opts: {
  opposingProvider: ProviderId
  callerPhase: AgentPhase
  allowedReadPaths: readonly string[]
}): AgentDefinition {
  // Synthetic AgentDefinition: read scope = exactly the manifest paths
  // (D4 lock: NEVER permissions.read='*'). All other surfaces denied.
  const readPaths: '*' | readonly string[] = opts.allowedReadPaths.length === 0
    ? Object.freeze([])
    : Object.freeze([...opts.allowedReadPaths])
  return Object.freeze({
    file: '<synthetic:debate-opponent>',
    name: 'debate-opponent',
    type: 'agent' as const,
    phase: opts.callerPhase,
    provider: opts.opposingProvider,
    modelPolicy: 'opus-default' as const,
    permissions: Object.freeze({
      read: readPaths,
      // AgentPermissions.write is '*' | readonly string[]; an empty
      // array denies effectively (manifest builder rejects any write
      // that doesn't match a glob; no globs => no writes).
      write: Object.freeze([] as readonly string[]),
      bash: 'deny' as const,
      // No tool_use sub-scopes — single-shot read-only.
    }),
    description: 'Synthetic debate-opponent agent (M10 runtime; no surface beyond read).',
    body: '# Debate opponent\n\n## Overview\n\nSynthetic; prompt body composed at invocation time from src/prompts/debate-opponent-system.md.\n',
  })
}
