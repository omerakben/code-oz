// `code-oz run` — start a fresh run and execute the DEFINE phase.
//
// v0.1 surface (M5):
//
//   code-oz run --request "build me X"
//     Inline turn-0 user input. Subsequent turns read from TTY stdin
//     (one line per turn). Non-TTY environments without --request-file
//     exit non-zero with actionable text.
//
//   code-oz run --request-file path.md
//     Comment-delimited transcript fixture. All user turns come from the
//     file. Useful for tests, CI, deterministic replays.
//
//   code-oz run
//     Pure TTY mode. Prompts for turn 0 and each subsequent turn.
//
// --request and --request-file are mutually exclusive. --provider is
// reserved for commit 9 (--provider fake runtime override).

import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { stat as statAsync } from 'node:fs/promises'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { bootstrap, getProviderRegistry } from '../cli/bootstrap.ts'
import { loadConfig } from '../config/load.ts'
import {
  initRun,
  loadRun,
  readActiveRun,
  runPathsFor,
} from '../state/run.ts'
import { generateUlid } from '../state/schemas.ts'
import { runDefine, type DefineResult } from '../phases/define.ts'
import type { InvokeContext } from '../providers/invoke.ts'

// --- public CLI entrypoint -----------------------------------------

export async function runCommand(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args)
  if (parsed.kind === 'error') {
    process.stderr.write(`code-oz run: ${parsed.message}\n`)
    if (parsed.help) process.stderr.write(RUN_HELP + '\n')
    process.exit(2)
  }

  const cwd = process.cwd()
  const ctx = await bootstrap({ cwd })

  if (!existsSync(ctx.paths.root)) {
    process.stderr.write(
      [
        `code-oz run: \`.code-oz/\` not found in ${cwd}.`,
        'Run `code-oz init` first to scaffold the project.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }

  const active = await readActiveRun(ctx.paths.activeRun)
  if (active !== null) {
    await handleActiveRun(ctx.paths.state, ctx.paths.artifacts, active)
    return
  }

  const config = await loadConfig({ cwd })

  const ba = ctx.registry.getByName('ba')
  if (ba === undefined) {
    process.stderr.write(
      [
        'code-oz run: BA persona (`ba`) is not registered.',
        'The bundled defaults must include `ba`; check src/agents/defaults/ba.md.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }

  const providerRegistry = getProviderRegistry()
  const runId = generateUlid()
  const runPaths = runPathsFor(ctx.paths.state, ctx.paths.artifacts, runId)
  await initRun({ paths: runPaths, profile: 'greenfield', runId })

  const invokeCtx: InvokeContext = {
    registry: providerRegistry,
    runPaths,
    projectRoot: cwd,
    config,
  }

  const inputSource = await buildInputSource(parsed.input)
  const askMeConfig = config.phases.define.askMe
  const initial =
    inputSource.initial === '__deferred__'
      ? await inputSource.readNext(0)
      : inputSource.initial
  if (initial === null || initial.trim().length === 0) {
    await inputSource.close()
    process.stderr.write('code-oz run: no initial user input provided.\n')
    process.exit(2)
  }

  const result: DefineResult = await runDefine({
    invokeCtx,
    runPaths,
    runId,
    agent: ba,
    config: askMeConfig,
    initialUserInput: initial,
    readNextUserInput: inputSource.readNext,
    fsyncDir: true,
  })

  await inputSource.close()

  if (result.status === 'complete') {
    process.stdout.write(result.userMessage + '\n')
    process.exit(0)
  } else {
    process.stderr.write(result.userMessage + '\n')
    process.exit(1)
  }
}

// --- helpers -------------------------------------------------------

interface InputSourceTTY {
  readonly kind: 'tty'
}
interface InputSourceInline {
  readonly kind: 'inline'
  readonly text: string
}
interface InputSourceFile {
  readonly kind: 'file'
  readonly path: string
}
type InputMode = InputSourceTTY | InputSourceInline | InputSourceFile

interface ParsedOk {
  readonly kind: 'ok'
  readonly input: InputMode
}
interface ParsedError {
  readonly kind: 'error'
  readonly message: string
  readonly help: boolean
}

function parseRunArgs(args: string[]): ParsedOk | ParsedError {
  let request: string | null = null
  let requestFile: string | null = null
  let help = false

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--help' || a === '-h') {
      help = true
      continue
    }
    if (a === '--request') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--request requires a value', help: true }
      }
      request = value
      i++
      continue
    }
    if (a.startsWith('--request=')) {
      request = a.slice('--request='.length)
      continue
    }
    if (a === '--request-file') {
      const value = args[i + 1]
      if (value === undefined) {
        return { kind: 'error', message: '--request-file requires a path', help: true }
      }
      requestFile = value
      i++
      continue
    }
    if (a.startsWith('--request-file=')) {
      requestFile = a.slice('--request-file='.length)
      continue
    }
    return { kind: 'error', message: `unknown argument: ${a}`, help: true }
  }

  if (help) {
    process.stdout.write(RUN_HELP + '\n')
    process.exit(0)
  }

  if (request !== null && requestFile !== null) {
    return {
      kind: 'error',
      message: '--request and --request-file are mutually exclusive',
      help: false,
    }
  }
  if (request !== null) {
    if (request.trim().length === 0) {
      return { kind: 'error', message: '--request must be non-empty', help: false }
    }
    return { kind: 'ok', input: { kind: 'inline', text: request } }
  }
  if (requestFile !== null) {
    return { kind: 'ok', input: { kind: 'file', path: requestFile } }
  }
  return { kind: 'ok', input: { kind: 'tty' } }
}

interface InputSource {
  readonly initial: string
  readNext(turn: number): Promise<string | null>
  close(): Promise<void>
}

async function buildInputSource(mode: InputMode): Promise<InputSource> {
  switch (mode.kind) {
    case 'inline':
      return inlineSource(mode.text)
    case 'file':
      return fileSource(mode.path)
    case 'tty':
      return ttySource()
  }
}

function inlineSource(text: string): InputSource {
  if (input.isTTY) {
    const rl = readline.createInterface({ input, output, terminal: true })
    return {
      initial: text,
      readNext: (turn: number) => promptTty(rl, turn),
      close: async () => rl.close(),
    }
  }
  return {
    initial: text,
    readNext: async () => null,
    close: async () => undefined,
  }
}

async function fileSource(path: string): Promise<InputSource> {
  const exists = existsSync(path)
  if (!exists || !statSync(path).isFile()) {
    process.stderr.write(`code-oz run: --request-file path does not exist: ${path}\n`)
    process.exit(2)
  }
  const raw = await readFile(path, 'utf8')
  const turns = parseUserTurnsFromTranscript(raw)
  if (turns.length === 0) {
    process.stderr.write(
      `code-oz run: --request-file ${path} contains no <!-- turn:user --> blocks\n`,
    )
    process.exit(2)
  }
  let cursor = 1
  return {
    initial: turns[0]!,
    readNext: async () => {
      if (cursor >= turns.length) return null
      return turns[cursor++] ?? null
    },
    close: async () => undefined,
  }
}

function ttySource(): InputSource {
  if (!input.isTTY) {
    process.stderr.write(
      [
        'code-oz run: stdin is not a TTY. Provide --request "..." or --request-file path.md.',
        '',
      ].join('\n'),
    )
    process.exit(2)
  }
  const rl = readline.createInterface({ input, output, terminal: true })
  return {
    initial: '__deferred__',
    readNext: (turn: number) => promptTty(rl, turn),
    close: async () => rl.close(),
  } as InputSource
}

async function promptTty(
  rl: readline.Interface,
  turn: number,
): Promise<string | null> {
  const label = turn === 0 ? 'Describe what you want to build' : 'Your reply'
  const answer = await rl.question(`${label}: `)
  const trimmed = answer.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

// --- transcript fixture parsing -----------------------------------

const USER_TURN_RE = /<!--\s*turn:user\s*-->([\s\S]*?)<!--\s*\/turn\s*-->/g

/**
 * Extract user turns from a comment-delimited transcript fixture. Returns
 * the trimmed body of each <!-- turn:user --> ... <!-- /turn --> block in
 * file order. Other content (frontmatter, ba turn blocks, prose between
 * blocks) is ignored.
 */
export function parseUserTurnsFromTranscript(raw: string): readonly string[] {
  const turns: string[] = []
  for (const match of raw.matchAll(USER_TURN_RE)) {
    const body = (match[1] ?? '').trim()
    if (body.length > 0) turns.push(body)
  }
  return Object.freeze(turns)
}

// --- active-run handling (Codex disagreement #6) ------------------

async function handleActiveRun(
  stateDir: string,
  artifactRoot: string,
  activeRunId: string,
): Promise<void> {
  const runPaths = runPathsFor(stateDir, artifactRoot, activeRunId)

  const loaded = await loadRun(runPaths).catch(() => null)
  if (loaded === null) {
    process.stderr.write(
      [
        `code-oz run: an active run pointer exists (${activeRunId}) but the run state cannot be loaded.`,
        'Inspect `.code-oz/state/runs/<runId>/` and either delete `state/active.json` to start fresh, or restore the run state.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  const phase = loaded.state.currentPhase

  if (phase === 'define') {
    const specStat = await statAsync(`${artifactRoot}/SPEC.md`).catch(() => null)
    if (specStat !== null && specStat.isFile()) {
      process.stderr.write(
        [
          'code-oz run: an active run is awaiting DEFINE approval.',
          '  Review .code-oz/artifacts/SPEC.md and run `code-oz approve define`.',
          '',
        ].join('\n'),
      )
      process.exit(1)
    }
    process.stderr.write(
      [
        `code-oz run: an active DEFINE run is in progress (${activeRunId}) without a SPEC.md.`,
        '  Mid-DEFINE resume is not implemented in v0.1.',
        `  To start over, manually delete .code-oz/state/active.json and .code-oz/state/runs/${activeRunId}/.`,
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  process.stderr.write(
    [
      `code-oz run: an active run is in progress at phase ${phase} (${activeRunId}).`,
      `  Use \`code-oz approve ${phase}\` once the artifact is reviewed, or wait for the in-progress phase to complete.`,
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const RUN_HELP = `
Usage: code-oz run [options]

Options:
  --request "<text>"       Use <text> as the initial user request (turn 0).
  --request-file <path>    Read user turns from a comment-delimited transcript fixture.
                           File must contain <!-- turn:user -->...<!-- /turn --> blocks.
  -h, --help               Show this help.

--request and --request-file are mutually exclusive.

Without flags, code-oz run reads turn 0 (and each subsequent turn) from a TTY.
Non-TTY environments must use --request or --request-file.
`.trim()
