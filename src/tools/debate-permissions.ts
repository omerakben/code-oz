// M10 commit 5: debate-permissions manifest preview.
//
// Per docs/contracts/DEBATE.md § Permission sub-scope (M7 process contract,
// M10 runtime), and per CODEX_RESPONSE_M10.md D9 lock: the manifest preview
// is a non-interactive forensic audit artifact written before BRIEFING.md
// is sent and before any provider call. If any file in the request matches
// `.code-ozignore` patterns, the runtime emits debate_manifest_blocked
// intervention before the BRIEFING is written. Operator review of
// MANIFEST.preview.md is post-hoc via events.jsonl + code-oz doctor.
//
// Risk #7 (Codex M10): the ignore-policy check fires before content load
// and before any provider call. We don't attempt to read the file bytes
// from inside this module — the buildManifest in src/providers/manifest.ts
// owns content-load + sha + permissions.read intersection. This module
// only does the policy filter + preview rendering.

import { createHash } from 'node:crypto'
import { isAbsolute, normalize, relative, resolve } from 'node:path'
import {
  loadIgnorePolicy,
  matchIgnore,
  type IgnorePolicy,
  type IgnorePattern,
} from './ignore-policy.ts'

export interface DebateManifestPreviewInput {
  /** Topic slug for the debate. Echoed in the preview header. */
  readonly topic: string
  /** Calling persona's provider id (echoed in preview). */
  readonly callerProvider: string
  /** Calling persona's provider family. */
  readonly callerFamily: string
  /** Opposing party's provider id. */
  readonly opposingProvider: string
  /** Opposing party's provider family. */
  readonly opposingFamily: string
  /** File paths the persona requested be surfaced into BRIEFING.md.
   *  Paths are project-root-relative POSIX-style; absolute or `..`
   *  paths fail with a non-empty `pathErrors` entry. */
  readonly files: readonly string[]
  /** Project root for ignore-policy loading + path-safety checks. */
  readonly projectRoot: string
  /** ISO 8601 timestamp; included in the preview header for forensic
   *  reconstruction. */
  readonly date: string
}

export interface BlockedFileEntry {
  /** The original path string from the persona's request. */
  readonly path: string
  /** Project-root-relative POSIX path that triggered the rule. */
  readonly relPath: string
  /** Reason: 'ignore-policy' (matched .code-ozignore) or 'path-unsafe'
   *  (absolute, contains `..`, or backslash). */
  readonly reason: 'ignore-policy' | 'path-unsafe'
  /** Matching ignore pattern (when reason === 'ignore-policy'). */
  readonly pattern?: string
  /** Line in .code-ozignore the pattern came from. */
  readonly patternLine?: number
  /** Human-readable rule string. */
  readonly rule: string
}

export interface DebateManifestPreviewResult {
  /** Rendered MANIFEST.preview.md content (exact bytes the runtime
   *  atomically writes to disk). */
  readonly content: string
  /** sha256 of `content`; bound to `debate_started.manifestPreviewSha256`. */
  readonly sha256: string
  /** Files that passed every gate. These are what BRIEFING.md cites
   *  and what the opposing-party invocation receives. */
  readonly allowedFiles: readonly string[]
  /** Files blocked by ignore-policy or path-safety. Non-empty means the
   *  runtime emits debate_manifest_blocked intervention. */
  readonly blockedFiles: readonly BlockedFileEntry[]
  /** The ignore policy that was loaded (source: 'absent' when no
   *  .code-ozignore was present). Frozen. */
  readonly ignorePolicy: IgnorePolicy
}

/**
 * Build the debate manifest preview. Loads `.code-ozignore` (absent =
 * empty policy), filters the requested file list, and renders the
 * preview content. Caller (requestDebate) decides whether to throw
 * debate_manifest_blocked based on blockedFiles.length.
 *
 * Path-safety: paths must be relative POSIX-style; absolute, '..'
 * traversal, and backslash separators are blocked as 'path-unsafe'.
 * Symlink-escape is enforced downstream by buildManifest in
 * src/providers/manifest.ts; the preview level rejects only the
 * lexical path-safety violations.
 */
export async function buildDebateManifestPreview(
  input: DebateManifestPreviewInput,
): Promise<DebateManifestPreviewResult> {
  const policy = await loadIgnorePolicy(input.projectRoot)
  const allowed: string[] = []
  const blocked: BlockedFileEntry[] = []
  const projectRootReal = normalize(input.projectRoot)
  for (const rawPath of input.files) {
    const safety = checkPathSafety(rawPath, projectRootReal)
    if (safety.kind === 'unsafe') {
      blocked.push({
        path: rawPath,
        relPath: rawPath,
        reason: 'path-unsafe',
        rule: safety.rule,
      })
      continue
    }
    const match: IgnorePattern | null = matchIgnore(policy, safety.relPath)
    if (match !== null) {
      blocked.push({
        path: rawPath,
        relPath: safety.relPath,
        reason: 'ignore-policy',
        pattern: match.raw.trim(),
        patternLine: match.line,
        rule: `path matches .code-ozignore line ${match.line} (${match.raw.trim()})`,
      })
      continue
    }
    allowed.push(safety.relPath)
  }
  const content = renderPreview(input, policy, allowed, blocked)
  const sha256 = sha256Hex(content)
  return Object.freeze({
    content,
    sha256,
    allowedFiles: Object.freeze(allowed),
    blockedFiles: Object.freeze(blocked),
    ignorePolicy: policy,
  })
}

type PathSafetyResult =
  | { kind: 'ok'; relPath: string }
  | { kind: 'unsafe'; rule: string }

function checkPathSafety(rawPath: string, projectRoot: string): PathSafetyResult {
  if (rawPath.length === 0) {
    return { kind: 'unsafe', rule: 'manifest path must be a non-empty string' }
  }
  if (rawPath.includes('\\')) {
    return { kind: 'unsafe', rule: 'manifest path must use forward slashes (POSIX-style)' }
  }
  // Reject `..` segments before any normalization (defense-in-depth;
  // mirrors src/providers/manifest.ts).
  const segments = rawPath.split('/')
  if (segments.some((seg) => seg === '..')) {
    return { kind: 'unsafe', rule: 'manifest path must not contain `..` segments' }
  }
  const absPath = isAbsolute(rawPath) ? normalize(rawPath) : resolve(projectRoot, rawPath)
  const rel = relative(projectRoot, absPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { kind: 'unsafe', rule: 'manifest path must be inside the project root' }
  }
  return { kind: 'ok', relPath: rel || rawPath }
}

function renderPreview(
  input: DebateManifestPreviewInput,
  policy: IgnorePolicy,
  allowed: readonly string[],
  blocked: readonly BlockedFileEntry[],
): string {
  const policyStatus = policy.source === 'absent'
    ? 'absent (no `.code-ozignore` file at project root; no patterns enforced)'
    : `present (${policy.patterns.length} pattern${policy.patterns.length === 1 ? '' : 's'} loaded from ${policy.path ?? '.code-ozignore'})`
  const allowedSection = allowed.length === 0
    ? '_(no allowed files)_'
    : allowed.map((p) => `- ${p}`).join('\n')
  const blockedSection = blocked.length === 0
    ? '_(no blocked files)_'
    : blocked.map((b) =>
        b.reason === 'ignore-policy'
          ? `- ${b.relPath} — blocked by .code-ozignore line ${b.patternLine} (\`${b.pattern}\`)`
          : `- ${b.relPath} — path-unsafe: ${b.rule}`,
      ).join('\n')
  return [
    `# Debate manifest preview - ${input.topic}`,
    '',
    `**Date:** ${input.date}`,
    `**Caller:** ${input.callerProvider} (family: ${input.callerFamily})`,
    `**Opposing:** ${input.opposingProvider} (family: ${input.opposingFamily})`,
    `**Ignore-policy:** ${policyStatus}`,
    `**Files requested:** ${input.files.length}`,
    `**Files allowed:** ${allowed.length}`,
    `**Files blocked:** ${blocked.length}`,
    '',
    '## Allowed files',
    '',
    allowedSection,
    '',
    '## Blocked files',
    '',
    blockedSection,
    '',
    '## Notes',
    '',
    'This preview is a forensic audit artifact (M10: non-interactive).',
    'If any file is blocked, the runtime emits `debate_manifest_blocked`',
    'intervention before the BRIEFING.md is written and before any',
    'provider call. Operator review is post-hoc via `events.jsonl` and',
    '`code-oz doctor --bundle`.',
    '',
  ].join('\n')
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
