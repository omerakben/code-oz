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
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import {
  parseBriefing,
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
import { canonicalRoleFromAgent } from '../agents/role.ts'
import { buildDebateManifestPreview } from './debate-permissions.ts'
import { IgnorePolicyError } from './ignore-policy.ts'
import { appendEvent, readEvents } from '../state/events.ts'
import { withLock } from '../state/lock.ts'
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
  /** 09-byterover-cli B3 (Codex thread `019e1318`):
   *  orchestrator-operation correlation id (`T-NNN`) threaded onto both
   *  the opposing-party turn and the caller's synthesis turn so per-call
   *  cost rows roll up under one debate. Set by REVIEW debate fire paths
   *  (`src/phases/review.ts`); plan-side `requestDebate` callers omit it
   *  because no `T-NNN` task id is in scope at PLAN debate time. */
  readonly parentTaskId?: string
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

  // 2. Generic permission check (Codex CODEX_REVIEW_M10.md bp#1):
  //    requestDebate is phase-agnostic per D12 lock, so the primitive
  //    enforces tool_use.debate scope itself rather than relying on
  //    PLAN-side clamping. Caller must have tool_use.debate; the YAML's
  //    opposingProvider must be in the declared list; the file count
  //    must not exceed maxFiles.
  const debatePerm = req.caller.permissions.tool_use?.debate
  if (debatePerm === undefined) {
    throw providerError(
      'provider_permissions_violation',
      `caller persona ${req.caller.name} does not declare tool_use.debate; cannot invoke requestDebate`,
      [
        'add tool_use.debate to the persona definition before re-running',
        'or invoke debate from a persona that already declares the scope',
      ],
    )
  }
  if (!debatePerm.opposingProviders.includes(req.opposingProvider)) {
    throw providerError(
      'provider_permissions_violation',
      `opposingProvider '${req.opposingProvider}' is not in caller's tool_use.debate.opposingProviders`,
      [
        `pick an opposingProvider from the persona's declared list (allowed=[${debatePerm.opposingProviders.join(', ')}])`,
        'or extend the persona declaration before re-running',
      ],
      `caller=${req.caller.name}, allowed=[${debatePerm.opposingProviders.join(', ')}]`,
    )
  }
  if (req.files.length > debatePerm.maxFiles) {
    throw providerError(
      'debate_manifest_blocked',
      `request files length ${req.files.length} exceeds caller maxFiles=${debatePerm.maxFiles}`,
      [
        'reduce the file manifest in the <debate-request> block',
        'or raise maxFiles on the persona declaration only after explicit operator approval',
      ],
    )
  }

  // 3. Lock-wrapped state setup (Codex bp#3 closure): event read +
  //    uniqueness check + resume detection + dir create + briefing/preview
  //    write + debate_started append all happen inside the run lock so
  //    two concurrent requestDebate calls cannot both pass the check
  //    before either appends debate_started. Provider invocations happen
  //    AFTER the lock is released — those are long-running and the
  //    serial-uniqueness invariant is preserved by debate_started's
  //    durability.
  const debateDirPath = join(ctx.runPaths.runDir, 'artifacts', 'debates', req.topic)
  const briefingPath = join(debateDirPath, 'BRIEFING.md')
  const previewPath = join(debateDirPath, 'MANIFEST.preview.md')
  const opposingSide: DebateSide = familyToSide(opposingFamily)
  const responsePath = join(debateDirPath, `RESPONSE.${opposingSide}.md`)
  const decisionPath = join(debateDirPath, 'DECISION.md')

  type PrepResult =
    | { kind: 'fresh'; allowedFiles: readonly string[]; previewSha256: string; briefingSha256: string }
    | {
        kind: 'resume-synthesis'
        allowedFiles: readonly string[]
        briefingSha256: string
        previewSha256: string
        existingResponse: ResponseDoc
        existingResponseRaw: string
      }

  const prep: PrepResult = await withLock(ctx.runPaths.lockDir, async () => {
      const events = await readEvents({
        file: ctx.runPaths.eventsFile,
        lockDir: ctx.runPaths.lockDir,
      })

      const priorStarted = events.find(
        (e) => e.type === 'debate_started' && (e as { topic?: string }).topic === req.topic,
      ) as
        | (LoggedEvent & {
            topic: string
            briefingSha256: string
            manifestPreviewSha256: string
            opposingProvider: ProviderId
          })
        | undefined
      const priorResolved = events.find(
        (e) => e.type === 'debate_resolved' && (e as { topic?: string }).topic === req.topic,
      ) as (LoggedEvent & { topic: string }) | undefined

      // D7 collision: same topic already resolved in this run.
      if (priorResolved !== undefined) {
        throw providerError(
          'debate_topic_collision',
          `debate topic '${req.topic}' already resolved in this run`,
          ['pick a more specific topic slug; topics are run-scoped unique'],
          `runId=${req.runId}`,
        )
      }

      // D8 resume path: same topic has prior debate_started but no
      // debate_resolved. Per Codex CODEX_REVIEW_M10.md round-2 bp#4 + bp#5:
      //   - resume only fires for the canonical D8 case (BRIEFING +
      //     RESPONSE present + DECISION absent → re-invoke synthesis).
      //   - the "RESPONSE absent" sub-case is indistinguishable from an
      //     in-flight concurrent debate without process-liveness probing,
      //     so we reject it as concurrent rather than racing the opponent
      //     turn (closes bp#4).
      //   - file manifest on resume comes from the sha-checked BRIEFING.md
      //     frontmatter, NOT from req.files. The original session's
      //     manifest-preview gate already approved those files; the resume
      //     session must not be able to expand the file set (closes bp#5).
      //   - DECISION-present orphan check fires before RESPONSE check
      //     so a completed-but-unresolved state cannot fall through to
      //     resume-from-synthesis (closes fs#4).
      if (priorStarted !== undefined) {
        if (priorStarted.opposingProvider !== req.opposingProvider) {
          throw providerError(
            'debate_topic_collision',
            `debate '${req.topic}' previously started against opposingProvider='${priorStarted.opposingProvider}', cannot resume against '${req.opposingProvider}'`,
            [
              'use the original opposingProvider, or pick a new topic slug',
            ],
          )
        }
        if (!existsSync(briefingPath)) {
          throw providerError(
            'debate_topic_collision',
            `debate '${req.topic}' has prior debate_started but BRIEFING.md is missing at ${briefingPath}`,
            [
              'restore BRIEFING.md from backup or pick a new topic slug',
              'this state should not occur with atomic-write semantics; investigate state corruption',
            ],
          )
        }
        const onDiskBriefing = await readFile(briefingPath, 'utf8')
        const onDiskBriefingSha = debateArtifactSha256(onDiskBriefing)
        if (onDiskBriefingSha !== priorStarted.briefingSha256) {
          throw providerError(
            'debate_topic_collision',
            `debate '${req.topic}' BRIEFING.md sha mismatch on resume: on-disk=${onDiskBriefingSha.slice(0, 16)}..., debate_started=${priorStarted.briefingSha256.slice(0, 16)}...`,
            [
              'do not edit BRIEFING.md after debate_started fires; this would invalidate the audit trail',
              'restore the original BRIEFING.md or pick a new topic slug',
            ],
          )
        }

        // Orphan-DECISION check (fs#4): runs before RESPONSE so a
        // completed-but-unresolved state cannot fall through.
        if (existsSync(decisionPath)) {
          throw providerError(
            'debate_topic_collision',
            `debate '${req.topic}' has DECISION.md on disk but no debate_resolved event; orphaned terminal state`,
            [
              'investigate state corruption: DECISION should always be paired with debate_resolved',
              'pick a new topic slug to make forward progress',
            ],
          )
        }

        // bp#4: no RESPONSE means either a still-running debate or a
        // crash-before-RESPONSE. Without process-liveness detection we
        // cannot distinguish; the safe default is to fail with the
        // concurrent-limit error so the operator can investigate.
        if (!existsSync(responsePath)) {
          throw providerError(
            'debate_concurrent_limit_exceeded',
            `debate '${req.topic}' has prior debate_started but no RESPONSE.${opposingSide}.md yet (in-flight debate or crash-before-RESPONSE)`,
            [
              'wait for the in-flight debate to complete, or remove the topic dir if the prior process is dead',
              `expected RESPONSE.${opposingSide}.md at ${responsePath}`,
            ],
          )
        }

        // Canonical D8 resume case: BRIEFING + RESPONSE present, DECISION
        // absent. Parse the existing artifacts, derive allowedFiles from
        // the SHA-checked BRIEFING.md (bp#5), and resume from synthesis.
        const briefingDoc = parseBriefing(onDiskBriefing, briefingPath)
        const allowedFromBriefing = briefingDoc.frontmatter.files
        const existingResponseRaw = await readFile(responsePath, 'utf8')
        let existingResponse: ResponseDoc
        try {
          existingResponse = parseResponse(existingResponseRaw, opposingSide)
        } catch (err: unknown) {
          throw providerError(
            'debate_response_invalid',
            `RESPONSE.${opposingSide}.md failed parse on resume`,
            [
              'the persisted RESPONSE.md is corrupt; restore from backup or pick a new topic',
              'intervention beats replay (D8 lock)',
            ],
            err instanceof Error ? err.message : String(err),
          )
        }
        return {
          kind: 'resume-synthesis' as const,
          allowedFiles: allowedFromBriefing,
          briefingSha256: onDiskBriefingSha,
          previewSha256: priorStarted.manifestPreviewSha256,
          existingResponse,
          existingResponseRaw,
        }
      }

      // Fresh start path. Topic-collision check: artifact dir exists
      // without a debate_started event → orphan; treat as collision
      // (preserves D7 invariant).
      if (existsSync(debateDirPath)) {
        throw providerError(
          'debate_topic_collision',
          `debate artifact directory already exists at ${debateDirPath} without a debate_started event`,
          [
            'pick a more specific topic slug; artifact directories are run-scoped unique',
            'or remove the orphan directory if state corruption is confirmed',
          ],
        )
      }

      // D3 concurrent-limit check.
      const openDebates = countOpenDebates(events, req.phase)
      const maxConcurrent = getMaxConcurrent(req.caller)
      if (openDebates >= maxConcurrent) {
        throw providerError(
          'debate_concurrent_limit_exceeded',
          `phase ${req.phase} already has ${openDebates} open debate(s); max ${maxConcurrent}`,
          ['resolve open debates before starting a new one'],
        )
      }

      // D6 + D9 manifest preview. fs#1 closure: catch IgnorePolicyError
      // and wrap as ProviderError with debate_manifest_blocked code.
      const filePaths = req.files.map((f) => f.path)
      let preview
      try {
        preview = await buildDebateManifestPreview({
          topic: req.topic,
          callerProvider,
          callerFamily,
          opposingProvider: req.opposingProvider,
          opposingFamily,
          files: filePaths,
          projectRoot: req.projectRoot,
          date: req.date,
        })
      } catch (err) {
        if (err instanceof IgnorePolicyError) {
          throw providerError(
            'debate_manifest_blocked',
            `.code-ozignore parse failed (fail-closed): ${err.message}`,
            [
              'fix .code-ozignore syntax issues before re-running',
              'only the documented subset is supported; unsupported gitignore syntax fails closed',
            ],
          )
        }
        throw err
      }
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

      // Atomic writes + debate_started. mkdir is recursive because the
      // parent `artifacts/debates/` may not exist; the topic dir itself
      // is the unit we serialize. The lock prevents concurrent
      // requestDebate calls from racing on the same topic dir.
      await mkdir(debateDirPath, { recursive: true })
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
      await atomicWriteFile(briefingPath, briefingContent)
      const briefingSha256 = debateArtifactSha256(briefingContent)

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
        { skipLock: true },
      )

      return {
        kind: 'fresh' as const,
        allowedFiles: preview.allowedFiles,
        previewSha256: preview.sha256,
        briefingSha256,
      }
  })

  const briefingRelPath = relativeToRoot(briefingPath, req.projectRoot)
  const opposingAgent = buildOpposingAgent({
    opposingProvider: req.opposingProvider,
    callerPhase: req.phase,
    allowedReadPaths: [briefingRelPath, ...prep.allowedFiles],
  })

  // 4. Opposing-party invocation (Turn A). Skipped on resume-synthesis
  //    (the prior session already wrote RESPONSE.{side}.md).
  let response: ResponseDoc
  let opposingContent: string
  if (prep.kind === 'resume-synthesis') {
    response = prep.existingResponse
    opposingContent = prep.existingResponseRaw
  } else {
    const opposingPrompt = await composeDebateOpponentPrompt({
      readySignal: req.readySignal ?? '<<DEBATE_OPPONENT_DONE>>',
      availableTools: [],
    })
    const opposingFiles: readonly ProviderFileRef[] = [
      { path: briefingRelPath },
      ...prep.allowedFiles.map((p) => ({ path: p })),
    ]
    const opposingReq: ProviderRequest = {
      agent: opposingAgent,
      phase: req.phase,
      runId: req.runId,
      prompt: `${opposingPrompt}\n\n## BRIEFING.md\n\nSee the file manifest. Author your RESPONSE.${familyToSide(opposingFamily)}.md per the schema above.`,
      files: opposingFiles,
      // 09-byterover-cli B3: synthetic opposing turns carry the caller's
      // parent task so the debate's two `agent_invoked` events correlate
      // back to one orchestrator step. Roles still differ (the opposing
      // turn omits role per M13 risk closure); parentTaskId is shared.
      ...(req.parentTaskId !== undefined ? { parentTaskId: req.parentTaskId } : {}),
    }
    let collected = ''
    for await (const ev of invokeAgent(ctx, opposingReq)) {
      if (ev.type === 'content_chunk') collected += ev.text
      if (ev.type === 'turn_completed') {
        // Adapter returned a single non-streaming response.
        collected = (ev.response as ProviderResponse).content
      }
      yield ev
    }
    opposingContent = collected
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
    await atomicWriteFile(responsePath, opposingContent)
  }

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
  // M13 (Codex Q9): the synthesis turn carries the caller's role for
  // per-role budget accounting. Synthetic opposing turns DO NOT carry
  // a role (their `opposingReq` above is intentionally role-less, per
  // Codex risk: "Synthetic opposing turns should carry no role unless
  // a future milestone creates a real role surface for them"). Caller
  // resolves through `canonicalRoleFromAgent`, so a project-local
  // caller outside `M12_COMPANY_ROLES` falls back to no role gating.
  // Computed once per the M13 review nit #1 closure.
  const callerRole = canonicalRoleFromAgent(req.caller)
  const synthesisReq: ProviderRequest = {
    agent: req.caller,
    phase: req.phase,
    runId: req.runId,
    prompt: `${synthesisPrompt}\n\n## You wrote BRIEFING.md and received RESPONSE.${opposingSide}.md\n\nAuthor DECISION.md per the schema. The orchestrator will validate dual-verdict frontmatter, the five required H2 sections, rationale length (>= 50 chars substantive), and reject exact-copy rationale.`,
    files: synthesisFiles,
    ...(callerRole !== undefined ? { role: callerRole } : {}),
    // 09-byterover-cli B3: synthesis turn carries the same parent task
    // id as the opposing turn — they belong to the same debate operation.
    ...(req.parentTaskId !== undefined ? { parentTaskId: req.parentTaskId } : {}),
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
  //     copy rationale check vs opposing RESPONSE; fs#2 closure: also
  //     enforces frontmatter.opposing_verdict matches RESPONSE.overallVerdict).
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
      briefingSha256: prep.briefingSha256,
      decisionSha256,
      manifestPreviewSha256: prep.previewSha256,
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
