// M16 C2 — Cross-process fake-replay fixture.
//
// Trigger: Codex R0 Risk #3 (`docs/research/CODEX_RESPONSE_M16.md`).
// `buildProviderRegistry({ providerOverride: 'fake' })` returns a fresh
// shared FakeProvider per process. Full-cycle CLI tests that spawn
// `bun run src/cli.ts` cannot pre-script BUILD/VERIFY/REVIEW
// expectations across processes — every subprocess gets a blank
// FakeProvider. Without a durable replay fixture, the C12 CLI e2e
// either becomes direct-import testing (which would replicate the
// test omission that hid M7-M15's CLI gap) or fails with generic
// fake responses.
//
// Solution: a JSONL transcript on disk. Each line is one
// `{ matcher: FakeMatch, response: FakeResponse }` entry. The loader
// validates and the applier calls `fake.expect(matcher).respondWith(response)`
// in declared order. Every spawned process loads the same script,
// every test gets the same deterministic responses.
//
// Test-only seam. The CLI gates `--fake-script` behind:
//   - `--provider fake` must also be set; and
//   - the env var `CODE_OZ_TEST_FAKE_SCRIPT_OK=1` must be present.
// Both gates are enforced in src/commands/run.ts parseRunArgs. The
// loader itself is gateless — callers other than the CLI (e.g., the
// C12 e2e fixture builder) compose it directly with the FakeProvider.
//
// Format (JSONL, one entry per line):
//   {"matcher": {"phase": "review", "agent": "reviewer"}, "response": {"content": "<review-ready/>\n..."}}
//
// Empty lines + lines starting with `//` (after optional leading
// whitespace) are skipped to make hand-authored fixtures readable.
//
// Ordering: entries are applied to the FakeProvider in file order.
// FakeProvider's matcher API picks the most-specific match per
// invocation; for ties (later expect on the same matcher), the
// FIFO queue inside that matcher determines order. Authoring tip:
// keep one matcher per (phase, agent) pair, queue multiple responses
// in declared order for retry/repair flows.

import { readFile } from 'node:fs/promises'
import type { FakeMatch, FakeProvider, FakeResponse } from './fake.ts'
import { PHASES } from '../state/schemas.ts'

export interface FakeScriptEntry {
  readonly matcher: FakeMatch
  readonly response: FakeResponse
}

/**
 * Test-only env var that must be set to `1` (or `true`) for the CLI
 * to accept `--fake-script`. The loader function does NOT read this
 * env var — it is the CLI's gate, declared here so the constant is
 * a single source of truth shared across run.ts + tests + docs.
 */
export const FAKE_SCRIPT_ENV_VAR = 'CODE_OZ_TEST_FAKE_SCRIPT_OK'

export interface FakeScriptIssue {
  /** 1-based line number in the JSONL file (skipped lines counted). */
  readonly line: number
  readonly code:
    | 'fake_script_invalid_json'
    | 'fake_script_invalid_shape'
    | 'fake_script_invalid_matcher'
    | 'fake_script_invalid_response'
  readonly rule: string
  readonly detail?: string
}

/**
 * Raised by `loadFakeScript` when the file is missing, unreadable, or
 * any line fails validation. Carries every issue so a single load can
 * surface multiple errors at once (operator UX over fail-fast).
 */
export class FakeScriptError extends Error {
  readonly path: string
  readonly issues: readonly FakeScriptIssue[]

  constructor(path: string, issues: readonly FakeScriptIssue[]) {
    const summary =
      issues.length === 1
        ? `fake-script load failed: ${issues[0]!.rule} (${path}:${issues[0]!.line})`
        : `fake-script load failed: ${issues.length} issue(s) in ${path}`
    super(summary)
    this.name = 'FakeScriptError'
    this.path = path
    this.issues = Object.freeze([...issues])
  }
}

/**
 * Read a JSONL file and parse each non-blank, non-comment line into a
 * `FakeScriptEntry`. Every parse + validation issue is collected; on
 * any issue, throws `FakeScriptError` with the full list.
 *
 * Pure (with the readFile boundary): parsing is deterministic on the
 * file content. Validation rules:
 *   - Each line is JSON parseable.
 *   - Top-level shape: `{ matcher, response }` — both required.
 *   - matcher.phase (if present) must be a known Phase value.
 *   - matcher.agent (if present) must be a non-empty string.
 *   - matcher must have at least one of phase or agent (rejecting the
 *     empty matcher prevents hand-edits that match every call by
 *     accident).
 *   - response.content (if present) must be a string. Other
 *     FakeResponse fields are passed through without strict shape
 *     checks (the FakeProvider accepts the same shape).
 */
export async function loadFakeScript(
  path: string,
): Promise<readonly FakeScriptEntry[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    throw new FakeScriptError(path, [
      {
        line: 0,
        code: 'fake_script_invalid_json',
        rule: 'fake-script file is not readable',
        detail: err instanceof Error ? err.message : String(err),
      },
    ])
  }
  const lines = raw.split(/\r?\n/)
  const issues: FakeScriptIssue[] = []
  const entries: FakeScriptEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith('//')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      issues.push({
        line: lineNo,
        code: 'fake_script_invalid_json',
        rule: 'line is not valid JSON',
        detail: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const validation = validateScriptEntry(parsed, lineNo)
    if (validation.kind === 'error') {
      issues.push(...validation.issues)
      continue
    }
    entries.push(validation.entry)
  }
  if (issues.length > 0) {
    throw new FakeScriptError(path, issues)
  }
  return Object.freeze(entries)
}

interface ValidateScriptEntryOk {
  readonly kind: 'ok'
  readonly entry: FakeScriptEntry
}
interface ValidateScriptEntryError {
  readonly kind: 'error'
  readonly issues: readonly FakeScriptIssue[]
}

function validateScriptEntry(
  raw: unknown,
  line: number,
): ValidateScriptEntryOk | ValidateScriptEntryError {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      kind: 'error',
      issues: [
        {
          line,
          code: 'fake_script_invalid_shape',
          rule: 'each line must be a JSON object with `matcher` and `response` fields',
        },
      ],
    }
  }
  const obj = raw as Record<string, unknown>
  if (!('matcher' in obj) || !('response' in obj)) {
    return {
      kind: 'error',
      issues: [
        {
          line,
          code: 'fake_script_invalid_shape',
          rule: 'entry must have both `matcher` and `response` fields',
        },
      ],
    }
  }
  const matcherIssue = validateMatcher(obj.matcher, line)
  if (matcherIssue !== null) {
    return { kind: 'error', issues: [matcherIssue] }
  }
  const responseIssue = validateResponse(obj.response, line)
  if (responseIssue !== null) {
    return { kind: 'error', issues: [responseIssue] }
  }
  // Deep-freeze nested arrays inside the response so the frozen-result
  // invariant holds end-to-end. Object.freeze on a shallow spread leaves
  // chunks/toolCalls arrays mutable; that's a footgun for any future
  // reducer that consumes script entries. Cost is one freeze call per
  // present array.
  const responseRaw = obj.response as Record<string, unknown>
  const responseCopy: Record<string, unknown> = { ...responseRaw }
  if (Array.isArray(responseCopy.chunks)) {
    responseCopy.chunks = Object.freeze([...(responseCopy.chunks as readonly unknown[])])
  }
  if (Array.isArray(responseCopy.toolCalls)) {
    responseCopy.toolCalls = Object.freeze([...(responseCopy.toolCalls as readonly unknown[])])
  }
  return {
    kind: 'ok',
    entry: Object.freeze({
      matcher: Object.freeze({ ...(obj.matcher as FakeMatch) }) as FakeMatch,
      response: Object.freeze(responseCopy) as FakeResponse,
    }),
  }
}

function validateMatcher(raw: unknown, line: number): FakeScriptIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      line,
      code: 'fake_script_invalid_matcher',
      rule: '`matcher` must be an object',
    }
  }
  const m = raw as Record<string, unknown>
  // Reject extra unknown fields FIRST to catch typos like `pahse` before
  // the empty-matcher check fires (a typo'd `phase` would produce an
  // effectively empty matcher and the wrong error message). Operator
  // UX: surface the typo, not the downstream symptom.
  for (const key of Object.keys(m)) {
    if (key !== 'phase' && key !== 'agent') {
      return {
        line,
        code: 'fake_script_invalid_matcher',
        rule: `matcher field \`${key}\` is not recognized (allowed: phase, agent)`,
      }
    }
  }
  if (m.phase !== undefined) {
    if (typeof m.phase !== 'string' || !(PHASES as readonly string[]).includes(m.phase)) {
      return {
        line,
        code: 'fake_script_invalid_matcher',
        rule: `matcher.phase must be one of: ${PHASES.join(' | ')}`,
        detail: `got ${JSON.stringify(m.phase)}`,
      }
    }
  }
  if (m.agent !== undefined) {
    if (typeof m.agent !== 'string' || m.agent.trim().length === 0) {
      return {
        line,
        code: 'fake_script_invalid_matcher',
        rule: 'matcher.agent must be a non-empty string when present',
        detail: `got ${JSON.stringify(m.agent)}`,
      }
    }
  }
  if (m.phase === undefined && m.agent === undefined) {
    return {
      line,
      code: 'fake_script_invalid_matcher',
      rule: 'matcher must have at least one of `phase` or `agent` (empty matcher rejected — would match every call)',
    }
  }
  return null
}

function validateResponse(raw: unknown, line: number): FakeScriptIssue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      line,
      code: 'fake_script_invalid_response',
      rule: '`response` must be an object',
    }
  }
  const r = raw as Record<string, unknown>
  if (r.content !== undefined && typeof r.content !== 'string') {
    return {
      line,
      code: 'fake_script_invalid_response',
      rule: 'response.content must be a string when present',
      detail: `got ${JSON.stringify(r.content)}`,
    }
  }
  // chunks: if present, must be an array of strings. The FakeProvider
  // emits each chunk as a content_chunk event before turn_completed, so
  // a non-array or non-string entry would crash at invoke-time. Catch
  // the malformation at load-time so the operator sees the line number
  // instead of a runtime stack trace.
  if (r.chunks !== undefined) {
    if (!Array.isArray(r.chunks)) {
      return {
        line,
        code: 'fake_script_invalid_response',
        rule: 'response.chunks must be an array of strings when present',
        detail: `got ${JSON.stringify(r.chunks)}`,
      }
    }
    for (let i = 0; i < r.chunks.length; i++) {
      if (typeof r.chunks[i] !== 'string') {
        return {
          line,
          code: 'fake_script_invalid_response',
          rule: `response.chunks[${i}] must be a string`,
          detail: `got ${JSON.stringify(r.chunks[i])}`,
        }
      }
    }
  }
  // toolCalls: if present, must be an array. We don't validate the shape
  // of each entry — that's the FakeProvider's contract and the v0.1 test
  // surface doesn't author tool calls from scripts. Reject non-array to
  // catch hand-edits.
  if (r.toolCalls !== undefined && !Array.isArray(r.toolCalls)) {
    return {
      line,
      code: 'fake_script_invalid_response',
      rule: 'response.toolCalls must be an array when present',
      detail: `got ${JSON.stringify(r.toolCalls)}`,
    }
  }
  // FakeResponse permits content-empty entries (uses the FakeProvider's
  // default content); we still require some signal — at least one of
  // content / chunks / model / stopReason — to catch hand-edits where
  // the response object is empty by accident.
  if (
    r.content === undefined &&
    r.chunks === undefined &&
    r.model === undefined &&
    r.stopReason === undefined &&
    r.tokensUsed === undefined &&
    r.toolCalls === undefined
  ) {
    return {
      line,
      code: 'fake_script_invalid_response',
      rule: 'response must specify at least one field (content, chunks, model, stopReason, tokensUsed, or toolCalls)',
    }
  }
  return null
}

/**
 * Apply a list of script entries to a FakeProvider. Each entry is
 * registered as `fake.expect(matcher).respondWith(response)`. Pure with
 * respect to the entries argument; mutates the FakeProvider's expectation
 * queue.
 *
 * Multiple entries with the same matcher are valid and additive — the
 * FakeProvider consumes responses FIFO within a matcher's queue, so an
 * authoring pattern of "queue three responses for review/scientist" lets
 * tests script retry/repair flows.
 */
export function applyFakeScript(
  fake: FakeProvider,
  entries: readonly FakeScriptEntry[],
): void {
  for (const entry of entries) {
    fake.expect(entry.matcher).respondWith(entry.response)
  }
}
