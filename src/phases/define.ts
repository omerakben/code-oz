// DEFINE phase orchestrator.
//
// Wires the bounded ask-me runner (src/phases/ask-me.ts) to artifact I/O,
// gate signaling, and intervention bookkeeping. The discipline pinned in
// docs/references/spec-contract.md:
//
//   - On success: serialize the validated SpecArtifact to canonical
//     Markdown, atomically write `<artifactRoot>/SPEC.md`, then call
//     requireGate(define, ...) to record a gate_required event and rebuild
//     current.json. NEVER a SPEC.draft.md on the success path.
//
//   - On validation_failed: write the unvalidated draft to
//     `<artifactRoot>/SPEC.draft.md`, write NEEDS_INTERVENTION.json
//     (`code: 'spec_validation_failed'`), append `intervention` event.
//     NEVER a canonical SPEC.md.
//
//   - On truncated: write whatever extractable draft to
//     SPEC.draft.md (if non-empty), write NEEDS_INTERVENTION
//     (`code: 'spec_truncated'`), append intervention.
//
//   - On max_rounds_exhausted: write NEEDS_INTERVENTION
//     (`code: 'ask_me_max_rounds_exceeded'`) + intervention. No draft.
//
//   - On provider_error: invokeAgent already wrote NEEDS_INTERVENTION +
//     intervention; we just exit non-zero and surface the issue.

import { join } from 'node:path'

import { runAskMe, type AskMeResult } from './ask-me.ts'
import { serializeSpec } from '../artifacts/spec.ts'
import { atomicWriteFile } from '../artifacts/atomic-write.ts'
import { CANONICAL_ARTIFACTS } from '../state/schemas.ts'
import { requireGate, type RunPaths } from '../state/run.ts'
import {
  writeNeedsInterventionGate,
  type GatePaths,
} from '../state/gates.ts'
import { appendEvent, type EventLogPaths } from '../state/events.ts'
import { withLock } from '../state/lock.ts'
import type { InvokeContext } from '../providers/invoke.ts'
import type { AgentDefinition } from '../agents/schema.ts'
import type { AskMeConfig } from '../config/schema.ts'
import type { ProviderError } from '../providers/errors.ts'

// --- public API ----------------------------------------------------

export type DefineStatus = 'complete' | 'intervention'

export interface DefineComplete {
  readonly status: 'complete'
  /** Absolute path to the written SPEC.md. */
  readonly specPath: string
  /** A short message the CLI prints on success. */
  readonly userMessage: string
}

export interface DefineIntervention {
  readonly status: 'intervention'
  /** The reason code recorded on NEEDS_INTERVENTION.json. */
  readonly code: string
  readonly rule: string
  readonly actionableSuggestions: readonly string[]
  /** Path to SPEC.draft.md if one was written; absent otherwise. */
  readonly draftPath?: string
  /** Optional underlying provider error if status came from invokeAgent. */
  readonly providerError?: ProviderError
  /** Message the CLI prints to the user. */
  readonly userMessage: string
}

export type DefineResult = DefineComplete | DefineIntervention

export interface RunDefineOptions {
  readonly invokeCtx: InvokeContext
  readonly runPaths: RunPaths
  readonly runId: string
  readonly agent: AgentDefinition
  readonly config: AskMeConfig
  readonly initialUserInput: string
  readonly readNextUserInput: (turn: number) => Promise<string | null>
  readonly now?: () => string
  /** When false, skips dir-fsync after artifact rename (test ergonomics). */
  readonly fsyncDir?: boolean
}

// --- helpers -------------------------------------------------------

function eventPathsFor(paths: RunPaths): EventLogPaths {
  return { file: paths.eventsFile, lockDir: paths.lockDir }
}

function gatePathsFor(paths: RunPaths): GatePaths {
  return {
    runDir: paths.runDir,
    artifactRoot: paths.artifactRoot,
    lockDir: paths.lockDir,
  }
}

function specPath(paths: RunPaths): string {
  return join(paths.artifactRoot, CANONICAL_ARTIFACTS.define) // SPEC.md
}

function draftPath(paths: RunPaths): string {
  return join(paths.artifactRoot, 'SPEC.draft.md')
}

async function recordIntervention(args: {
  paths: RunPaths
  runId: string
  agent: string
  code: string
  rule: string
  detail?: string
  actionableSuggestions: readonly string[]
  now: () => string
}): Promise<void> {
  await withLock(args.paths.lockDir, async () => {
    await writeNeedsInterventionGate(
      gatePathsFor(args.paths),
      {
        version: 1,
        runId: args.runId,
        phase: 'define',
        agent: args.agent,
        code: args.code,
        rule: args.rule,
        ...(args.detail !== undefined ? { detail: args.detail } : {}),
        actionableSuggestions: args.actionableSuggestions,
        createdAt: args.now(),
      },
      { skipLock: true },
    )
    await appendEvent(
      eventPathsFor(args.paths),
      {
        version: 1,
        type: 'intervention',
        ts: args.now(),
        runId: args.runId,
        code: args.code,
        phase: 'define',
      },
      { skipLock: true },
    )
  })
}

// --- runDefine -----------------------------------------------------

export async function runDefine(opts: RunDefineOptions): Promise<DefineResult> {
  const now = opts.now ?? (() => new Date().toISOString())

  const askMeResult: AskMeResult = await runAskMe({
    invokeCtx: opts.invokeCtx,
    eventPaths: eventPathsFor(opts.runPaths),
    runId: opts.runId,
    agent: opts.agent,
    config: opts.config,
    initialUserInput: opts.initialUserInput,
    readNextUserInput: opts.readNextUserInput,
    now,
  })

  switch (askMeResult.status) {
    case 'success': {
      const text = serializeSpec(askMeResult.spec)
      const target = specPath(opts.runPaths)
      await atomicWriteFile(target, text, { fsyncDir: opts.fsyncDir })
      await requireGate({
        paths: opts.runPaths,
        runId: opts.runId,
        phase: 'define',
        blockedOn: 'user approval via `code-oz approve define`',
        now,
      })
      return Object.freeze({
        status: 'complete',
        specPath: target,
        userMessage: [
          `DEFINE phase complete. Review ${target}, then run:`,
          `  code-oz approve define`,
        ].join('\n'),
      })
    }

    case 'validation_failed': {
      const target = draftPath(opts.runPaths)
      await atomicWriteFile(target, askMeResult.draft, { fsyncDir: opts.fsyncDir })
      const firstIssue = askMeResult.issues[0]
      const code = 'spec_validation_failed'
      const rule = 'BA persona produced a SPEC draft that failed structural validation after the configured repair budget'
      const actionableSuggestions = [
        `inspect ${target} for the unvalidated draft`,
        'rerun `code-oz run` with a clearer initial request',
        'or raise phases.define.askMe.maxRepairTurns in .code-oz/config.yaml',
      ]
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.agent.name,
        code,
        rule,
        detail: firstIssue !== undefined
          ? `${firstIssue.code}: ${firstIssue.rule}${firstIssue.detail ? ` (${firstIssue.detail})` : ''}`
          : undefined,
        actionableSuggestions,
        now,
      })
      return Object.freeze({
        status: 'intervention',
        code,
        rule,
        actionableSuggestions,
        draftPath: target,
        userMessage: [
          'DEFINE phase did not produce a valid SPEC.md.',
          `Draft saved at: ${target}`,
          `Inspect the draft and rerun \`code-oz run\` to start fresh.`,
        ].join('\n'),
      })
    }

    case 'truncated': {
      const code = 'spec_truncated'
      const rule = 'provider returned stopReason: max_tokens before completing the SPEC draft'
      const actionableSuggestions = [
        'raise the model output token budget on the provider configuration',
        'or rerun with a more focused initial request to reduce reply size',
      ]
      let target: string | undefined
      if (askMeResult.draft.length > 0) {
        target = draftPath(opts.runPaths)
        await atomicWriteFile(target, askMeResult.draft, { fsyncDir: opts.fsyncDir })
      }
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.agent.name,
        code,
        rule,
        actionableSuggestions,
        now,
      })
      return Object.freeze({
        status: 'intervention',
        code,
        rule,
        actionableSuggestions,
        ...(target !== undefined ? { draftPath: target } : {}),
        userMessage: [
          'DEFINE phase response was truncated by the provider.',
          ...(target !== undefined ? [`Partial draft saved at: ${target}`] : []),
          'Inspect (if any) and rerun `code-oz run` after raising output token budget.',
        ].join('\n'),
      })
    }

    case 'max_rounds_exhausted': {
      const code = 'ask_me_max_rounds_exceeded'
      const rule = 'BA persona did not emit the ready signal within the configured maxRounds and finalize budget'
      const actionableSuggestions = [
        'raise phases.define.askMe.maxRounds in .code-oz/config.yaml',
        'or set phases.define.askMe.onMaxRounds to "finalize" with maxFinalizeTurns >= 1',
        'or rerun with a clearer initial request',
      ]
      await recordIntervention({
        paths: opts.runPaths,
        runId: opts.runId,
        agent: opts.agent.name,
        code,
        rule,
        actionableSuggestions,
        now,
      })
      return Object.freeze({
        status: 'intervention',
        code,
        rule,
        actionableSuggestions,
        userMessage: [
          'DEFINE phase reached the conversation cap without converging on a SPEC.',
          'Rerun `code-oz run` with a clearer initial request, or raise the round budgets in .code-oz/config.yaml.',
        ].join('\n'),
      })
    }

    case 'provider_error': {
      // The wrapper (src/providers/invoke.ts) already wrote
      // NEEDS_INTERVENTION + intervention before the error surfaced. We
      // do NOT write a second one here. We surface the existing failure
      // info to the CLI for display.
      const issue = askMeResult.error.issues[0]!
      return Object.freeze({
        status: 'intervention',
        code: issue.code,
        rule: issue.rule,
        actionableSuggestions: issue.actionableSuggestions,
        providerError: askMeResult.error,
        userMessage: [
          'DEFINE phase failed: provider error.',
          ...issue.actionableSuggestions.map((s) => `  - ${s}`),
        ].join('\n'),
      })
    }
  }
}
