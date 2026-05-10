// Rule-9 enforcement layer: pattern-matched guardrails over runtime tool
// calls and persona output. Authoritative contract: docs/contracts/GUARDRAILS.md.
//
// Slice posture (B2 from claude-code template comparison): this file ships
// the contract + parser + matcher only. Runtime wire-in into the tool-call
// wrapper is a separate slice gated on Codex's post-implementation review of
// the contract + this module.
//
// Authority axis: runtime content inspection between persona output and tool
// execution. The matcher never rewrites prompts, patches files, auto-fixes
// commands, or mutates rule files. It returns a typed Decision and the
// caller (the wire-in slice) consumes the decision per the contract's
// decision-flow section.
//
// Read posture per CLAUDE.md rule 9: rule files are operator-authored and
// read-only to agents. The wire-in slice will register
// `.code-oz/guardrails.md` and `.code-oz/guardrails/**` in the default-deny
// path set for every persona's permissions.write.

import { parse as parseYaml } from 'yaml'

// --- enums ----------------------------------------------------------

export const GUARDRAIL_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
] as const
export type GuardrailEvent = (typeof GUARDRAIL_EVENTS)[number]

export const GUARDRAIL_TOOLS = [
  'Edit',
  'Write',
  'MultiEdit',
  'Bash',
  'RepoContext',
  '*',
] as const
export type GuardrailTool = (typeof GUARDRAIL_TOOLS)[number]

export const GUARDRAIL_FIELDS = [
  'file_path',
  'new_content',
  'command',
  'prompt',
  'tool_input',
] as const
export type GuardrailField = (typeof GUARDRAIL_FIELDS)[number]

export const GUARDRAIL_OPERATORS = [
  'equals',
  'contains',
  'prefix',
  'suffix',
  'glob',
  'regex',
] as const
export type GuardrailOperator = (typeof GUARDRAIL_OPERATORS)[number]

/**
 * v0.1 deferred operators. The regex operator depends on a killable match
 * boundary that synchronous JS RegExp cannot provide; per the post-impl
 * Codex review (Category 4 finding 1), shipping regex with a non-enforced
 * timeout is a block-push. v0.1 ships with regex rejected at parse time;
 * v0.2 adds it back with worker-bounded evaluation. Glob remains available
 * because the compiled regex it produces is anchored and non-recursive.
 */
export const GUARDRAIL_OPERATORS_DEFERRED_V0_1: ReadonlySet<GuardrailOperator> =
  new Set(['regex'])

export const GUARDRAIL_ACTIONS = ['warn', 'block'] as const
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number]

export const GUARDRAIL_SCOPES = ['runtime-tool-call', 'artifact-authoring'] as const
export type GuardrailScope = (typeof GUARDRAIL_SCOPES)[number]

/** Per-event allowed `field` values (contract §"Allowed `field` values per `event`"). */
export const GUARDRAIL_FIELDS_BY_EVENT: Readonly<
  Record<GuardrailEvent, readonly GuardrailField[]>
> = Object.freeze({
  PreToolUse: ['file_path', 'new_content', 'command', 'tool_input'],
  PostToolUse: ['file_path', 'tool_input'],
  UserPromptSubmit: ['prompt'],
  Stop: [],
  SubagentStop: [],
})

/** `tool` is meaningful only for the tool-bound events. */
export const GUARDRAIL_TOOL_BOUND_EVENTS: ReadonlySet<GuardrailEvent> = new Set([
  'PreToolUse',
  'PostToolUse',
])

const PRIORITY_DEFAULT = 100
const PRIORITY_MIN = 0
const PRIORITY_MAX = 1000
const MAX_MATCHES_PER_RUN_DEFAULT = 100
const GLOB_PATTERN_MAX_LENGTH = 256

/** Known placeholders for dedupKey templates. Validated at parse time. */
const DEDUP_KEY_KNOWN_PLACEHOLDERS = new Set<string>([
  'rule.name',
  'file_path',
  'new_content',
  'command',
  'prompt',
  'tool_input',
])
const DEDUP_KEY_PLACEHOLDER_RE = /\{([^}]+)\}/g
/** Cap substituted field values inside a dedup key to keep event keys bounded. */
const DEDUP_KEY_FIELD_VALUE_MAX = 128
/** Cap raw dedupKey template length at parse time. */
const DEDUP_KEY_TEMPLATE_MAX = 256
/** Hard cap on the final expanded dedup key length. */
const DEDUP_KEY_EXPANDED_MAX = 512

const ALLOWED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'name',
  'enabled',
  'event',
  'tool',
  'scope',
  'conditions',
  'action',
  'message',
  'dedupKey',
  'maxMatchesPerRun',
  'priority',
])

const NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/

// --- typed shapes --------------------------------------------------

export interface GuardrailCondition {
  readonly field: GuardrailField
  readonly operator: GuardrailOperator
  readonly value: string
}

export interface CompiledCondition {
  readonly field: GuardrailField
  readonly operator: GuardrailOperator
  readonly value: string
  /** Pre-compiled RegExp when operator is 'glob'; null otherwise. */
  readonly regex: RegExp | null
}

export interface GuardrailRule {
  readonly name: string
  readonly enabled: boolean
  readonly event: GuardrailEvent
  readonly tool: GuardrailTool
  readonly scope: GuardrailScope
  readonly conditions: readonly GuardrailCondition[]
  readonly action: GuardrailAction
  readonly message: string
  readonly dedupKey: string | null
  readonly maxMatchesPerRun: number
  readonly priority: number
}

export interface CompiledRule {
  readonly source: GuardrailRule
  readonly conditions: readonly CompiledCondition[]
}

export interface CompiledRuleSet {
  readonly rules: readonly CompiledRule[]
  /** Map from rule name to compiled rule. Names are unique by parse-time check. */
  readonly byName: ReadonlyMap<string, CompiledRule>
}

export interface GuardrailParseIssue {
  readonly file: string
  readonly code: string
  readonly rule: string
  readonly detail?: string
  readonly severity: 'block' | 'warn'
}

export class GuardrailParseError extends Error {
  readonly issues: readonly GuardrailParseIssue[]
  constructor(issues: readonly GuardrailParseIssue[]) {
    const summary = issues
      .filter((i) => i.severity === 'block')
      .map((i) => `${i.code}: ${i.rule}`)
      .join('; ')
    super(`Guardrail rule parse failed: ${summary}`)
    this.name = 'GuardrailParseError'
    this.issues = Object.freeze([...issues])
  }
}

// --- parser --------------------------------------------------------

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/

interface RawFrontmatter {
  readonly fm: Record<string, unknown>
  readonly body: string
}

function splitFrontmatter(text: string): RawFrontmatter | null {
  const trimmed = text.replace(/^﻿/, '')
  const m = trimmed.match(FRONTMATTER_RE)
  if (!m) return null
  const fmText = m[1] ?? ''
  const body = (m[2] ?? '').trim()
  let fm: unknown
  try {
    fm = parseYaml(fmText) ?? {}
  } catch {
    return null
  }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) return null
  return { fm: fm as Record<string, unknown>, body }
}

function isStringEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value)
}

function pushIssue(
  issues: GuardrailParseIssue[],
  file: string,
  code: string,
  rule: string,
  severity: 'block' | 'warn' = 'block',
  detail?: string,
): void {
  issues.push({ file, code, rule, severity, ...(detail ? { detail } : {}) })
}

/**
 * Parse a single guardrail rule file.
 *
 * Returns a `GuardrailRule` on success. Accumulates issues and throws
 * `GuardrailParseError` when any block-severity issue exists. Warn-severity
 * issues are returned alongside the rule via the `warnings` field.
 */
export interface ParseGuardrailRuleResult {
  readonly rule: GuardrailRule
  readonly warnings: readonly GuardrailParseIssue[]
}

export function parseGuardrailRule(
  text: string,
  file = 'guardrail.md',
): ParseGuardrailRuleResult {
  const issues: GuardrailParseIssue[] = []
  const split = splitFrontmatter(text)
  if (split === null) {
    throw new GuardrailParseError([
      {
        file,
        code: 'guardrail_frontmatter_missing',
        rule: 'rule file must begin with a YAML frontmatter block',
        severity: 'block',
      },
    ])
  }
  const { fm, body } = split
  const messageBody = body.length > 0 ? body : null

  // Reject unknown keys early to catch typos like `actions:` instead of
  // `action:` (contract §"Unknown fields rejected").
  for (const key of Object.keys(fm)) {
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      pushIssue(
        issues,
        file,
        'guardrail_unknown_frontmatter_key',
        `unknown frontmatter key: '${key}' (allowed: ${[...ALLOWED_FRONTMATTER_KEYS].sort().join(', ')})`,
      )
    }
  }

  // name (required, kebab-case)
  const nameRaw = fm['name']
  if (typeof nameRaw !== 'string' || !NAME_REGEX.test(nameRaw)) {
    pushIssue(
      issues,
      file,
      'guardrail_missing_required_field',
      'name must be a kebab-case string matching ^[a-z0-9][a-z0-9-]{0,63}$',
    )
  }

  // enabled
  const enabledRaw = fm['enabled']
  let enabled = true
  if (enabledRaw !== undefined) {
    if (typeof enabledRaw !== 'boolean') {
      pushIssue(issues, file, 'guardrail_invalid_enabled', 'enabled must be a boolean')
    } else {
      enabled = enabledRaw
    }
  }

  // event (required)
  const eventRaw = fm['event']
  if (!isStringEnumMember(eventRaw, GUARDRAIL_EVENTS)) {
    pushIssue(
      issues,
      file,
      'guardrail_invalid_event',
      `event must be one of: ${GUARDRAIL_EVENTS.join(', ')}`,
    )
  }

  // scope (required)
  const scopeRaw = fm['scope']
  if (!isStringEnumMember(scopeRaw, GUARDRAIL_SCOPES)) {
    pushIssue(
      issues,
      file,
      'guardrail_invalid_scope',
      `scope must be one of: ${GUARDRAIL_SCOPES.join(', ')}`,
    )
  }

  // tool (optional, defaults to '*')
  const toolRaw = fm['tool']
  let tool: GuardrailTool = '*'
  if (toolRaw !== undefined) {
    if (!isStringEnumMember(toolRaw, GUARDRAIL_TOOLS)) {
      pushIssue(
        issues,
        file,
        'guardrail_invalid_tool',
        `tool must be one of: ${GUARDRAIL_TOOLS.join(', ')}`,
      )
    } else {
      tool = toolRaw
    }
  }

  // event-tool compatibility
  if (
    isStringEnumMember(eventRaw, GUARDRAIL_EVENTS) &&
    toolRaw !== undefined &&
    !GUARDRAIL_TOOL_BOUND_EVENTS.has(eventRaw)
  ) {
    pushIssue(
      issues,
      file,
      'guardrail_tool_not_allowed_for_event',
      `tool field is not allowed for event ${eventRaw}`,
    )
  }

  // action (defaults to warn)
  const actionRaw = fm['action']
  let action: GuardrailAction = 'warn'
  if (actionRaw !== undefined) {
    if (!isStringEnumMember(actionRaw, GUARDRAIL_ACTIONS)) {
      pushIssue(
        issues,
        file,
        'guardrail_invalid_action',
        `action must be one of: ${GUARDRAIL_ACTIONS.join(', ')}`,
      )
    } else {
      action = actionRaw
    }
  }

  // message
  const messageRaw = fm['message']
  let message: string
  if (typeof messageRaw === 'string' && messageRaw.length > 0) {
    message = messageRaw
  } else if (messageBody !== null) {
    message = messageBody
  } else {
    message = `Guardrail rule '${typeof nameRaw === 'string' ? nameRaw : '(unknown)'}' fired.`
  }

  // priority
  const priorityRaw = fm['priority']
  let priority = PRIORITY_DEFAULT
  if (priorityRaw !== undefined) {
    if (typeof priorityRaw !== 'number' || !Number.isInteger(priorityRaw)) {
      pushIssue(issues, file, 'guardrail_priority_out_of_range', 'priority must be an integer')
    } else if (priorityRaw < PRIORITY_MIN || priorityRaw > PRIORITY_MAX) {
      pushIssue(
        issues,
        file,
        'guardrail_priority_out_of_range',
        `priority must be in [${PRIORITY_MIN}, ${PRIORITY_MAX}]`,
        'warn',
      )
      // soft cap; clamp
      priority = Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, priorityRaw))
    } else {
      priority = priorityRaw
    }
  }

  // maxMatchesPerRun
  const maxMatchesRaw = fm['maxMatchesPerRun']
  let maxMatchesPerRun = MAX_MATCHES_PER_RUN_DEFAULT
  if (maxMatchesRaw !== undefined) {
    if (
      typeof maxMatchesRaw !== 'number' ||
      !Number.isInteger(maxMatchesRaw) ||
      maxMatchesRaw < 1
    ) {
      pushIssue(
        issues,
        file,
        'guardrail_invalid_max_matches_per_run',
        'maxMatchesPerRun must be a positive integer',
      )
    } else {
      maxMatchesPerRun = maxMatchesRaw
    }
  }

  // dedupKey
  const dedupKeyRaw = fm['dedupKey']
  let dedupKey: string | null = null
  if (dedupKeyRaw !== undefined) {
    if (typeof dedupKeyRaw !== 'string') {
      pushIssue(issues, file, 'guardrail_invalid_dedup_template', 'dedupKey must be a string')
    } else if (dedupKeyRaw.length > DEDUP_KEY_TEMPLATE_MAX) {
      pushIssue(
        issues,
        file,
        'guardrail_invalid_dedup_template',
        `dedupKey template length must be ≤ ${DEDUP_KEY_TEMPLATE_MAX}`,
      )
    } else {
      dedupKey = dedupKeyRaw
      // Validate placeholders. Unknown placeholders are warn-class per
      // contract §"Validator rules"; a typo in `{file_path}` should not
      // block the run, but the operator deserves a note.
      for (const m of dedupKeyRaw.matchAll(DEDUP_KEY_PLACEHOLDER_RE)) {
        const placeholder = m[1]
        if (placeholder !== undefined && !DEDUP_KEY_KNOWN_PLACEHOLDERS.has(placeholder)) {
          pushIssue(
            issues,
            file,
            'guardrail_dedup_template_invalid',
            `dedupKey references unknown placeholder '{${placeholder}}'; known: ${[
              ...DEDUP_KEY_KNOWN_PLACEHOLDERS,
            ]
              .sort()
              .map((p) => `{${p}}`)
              .join(', ')}`,
            'warn',
          )
        }
      }
    }
  }

  // dedupKey on block: block-class rejection. Without this, a saturated
  // dedup ledger silently downgrades a block rule to allow (Codex
  // post-impl review Category 4 finding 2). Block rules cannot dedup.
  if (
    action === 'block' &&
    dedupKey !== null &&
    isStringEnumMember(actionRaw, GUARDRAIL_ACTIONS)
  ) {
    pushIssue(
      issues,
      file,
      'guardrail_dedup_on_block_disallowed',
      `dedupKey is not allowed on rules with action='block'; remove dedupKey or change action to 'warn'`,
    )
  }

  // conditions (required, non-empty)
  const conditionsRaw = fm['conditions']
  let conditions: readonly GuardrailCondition[] = []
  if (!Array.isArray(conditionsRaw) || conditionsRaw.length === 0) {
    if (eventRaw === 'Stop' || eventRaw === 'SubagentStop') {
      // Stop / SubagentStop are event-only; an empty conditions list is
      // legal for those events (the rule fires on every Stop event).
      conditions = []
    } else {
      pushIssue(
        issues,
        file,
        'guardrail_missing_required_field',
        'conditions must be a non-empty list for tool-bound and prompt events',
      )
    }
  } else {
    const conds: GuardrailCondition[] = []
    for (let i = 0; i < conditionsRaw.length; i++) {
      const raw = conditionsRaw[i]
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        pushIssue(
          issues,
          file,
          'guardrail_invalid_condition_shape',
          `conditions[${i}] must be an object with field/operator/value`,
        )
        continue
      }
      const c = raw as Record<string, unknown>
      const fieldRaw = c['field']
      const operatorRaw = c['operator']
      const valueRaw = c['value']
      // `maxLength` was the regex-tier guard; with regex deferred, it is
      // unused in v0.1. Reject it explicitly so operators do not write
      // dead frontmatter expecting it to do something.
      if ('maxLength' in c) {
        pushIssue(
          issues,
          file,
          'guardrail_unknown_frontmatter_key',
          `conditions[${i}].maxLength is unused in v0.1 (regex operator deferred)`,
        )
      }

      let okField = true
      if (!isStringEnumMember(fieldRaw, GUARDRAIL_FIELDS)) {
        pushIssue(
          issues,
          file,
          'guardrail_invalid_operator',
          `conditions[${i}].field must be one of: ${GUARDRAIL_FIELDS.join(', ')}`,
        )
        okField = false
      } else if (
        isStringEnumMember(eventRaw, GUARDRAIL_EVENTS) &&
        !GUARDRAIL_FIELDS_BY_EVENT[eventRaw].includes(fieldRaw)
      ) {
        pushIssue(
          issues,
          file,
          'guardrail_field_not_allowed_for_event',
          `conditions[${i}].field='${fieldRaw}' not allowed for event '${eventRaw}'`,
        )
        okField = false
      }
      if (!isStringEnumMember(operatorRaw, GUARDRAIL_OPERATORS)) {
        pushIssue(
          issues,
          file,
          'guardrail_invalid_operator',
          `conditions[${i}].operator must be one of: ${GUARDRAIL_OPERATORS.join(', ')}`,
        )
        continue
      }
      if (GUARDRAIL_OPERATORS_DEFERRED_V0_1.has(operatorRaw)) {
        // v0.1 defers regex per Codex post-impl review (synchronous
        // RegExp.test cannot be interrupted, so the documented 50ms
        // timeout is decorative). v0.2 re-introduces it with a
        // worker-bounded evaluator.
        pushIssue(
          issues,
          file,
          'guardrail_operator_deferred',
          `conditions[${i}].operator='${operatorRaw}' is deferred to v0.2; use deterministic operators (equals, contains, prefix, suffix, glob) instead`,
        )
        continue
      }
      if (typeof valueRaw !== 'string' || valueRaw.length === 0) {
        pushIssue(
          issues,
          file,
          'guardrail_missing_required_field',
          `conditions[${i}].value must be a non-empty string`,
        )
        continue
      }
      if (operatorRaw === 'glob' && valueRaw.length > GLOB_PATTERN_MAX_LENGTH) {
        pushIssue(
          issues,
          file,
          'guardrail_glob_pattern_too_long',
          `conditions[${i}].value exceeds glob max length ${GLOB_PATTERN_MAX_LENGTH}`,
        )
        continue
      }
      if (!okField) continue
      conds.push(
        Object.freeze({
          field: fieldRaw as GuardrailField,
          operator: operatorRaw,
          value: valueRaw,
        }),
      )
    }
    conditions = Object.freeze(conds)
  }

  if (issues.some((i) => i.severity === 'block')) {
    throw new GuardrailParseError(issues)
  }

  const rule: GuardrailRule = Object.freeze({
    name: nameRaw as string,
    enabled,
    event: eventRaw as GuardrailEvent,
    tool,
    scope: scopeRaw as GuardrailScope,
    conditions,
    action,
    message,
    dedupKey,
    maxMatchesPerRun,
    priority,
  })
  return { rule, warnings: Object.freeze(issues.filter((i) => i.severity === 'warn')) }
}

// --- compiler ------------------------------------------------------

function normalizeGlobConsecutiveStarStars(glob: string): string {
  // Collapse consecutive `**/` segments into a single `**/`. `**/**/x`
  // means the same as `**/x` and avoids producing adjacent repeated
  // groups in the compiled regex.
  let prev: string
  let cur = glob
  do {
    prev = cur
    cur = cur.replace(/\*\*\/\*\*\//g, '**/')
  } while (cur !== prev)
  return cur
}

function globToRegex(glob: string): RegExp {
  // POSIX-ish glob with the `**/` zero-depth case:
  //   '**/'  -> '(?:[^/]+/)*'  (zero or more directory components)
  //   '**'   -> '.*'           (any sequence including separators)
  //   '*'    -> '[^/]*'        (one segment, no separators)
  //   '?'    -> '[^/]'
  // Anchored at both ends. Consecutive `**/` segments are normalized
  // before compilation to avoid adjacent repeated groups.
  const normalized = normalizeGlobConsecutiveStarStars(glob)
  let out = '^'
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          out += '(?:[^/]+/)*'
          i += 2
        } else {
          out += '.*'
          i++
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if (/[.+^$()|[\]\\{}]/.test(ch)) {
      out += '\\' + ch
    } else {
      out += ch
    }
  }
  out += '$'
  return new RegExp(out)
}

export function compileRule(rule: GuardrailRule): CompiledRule {
  const conds: CompiledCondition[] = []
  for (const c of rule.conditions) {
    let regex: RegExp | null = null
    if (c.operator === 'glob') {
      regex = globToRegex(c.value)
    }
    // regex operator is deferred (rejected at parse); no compile branch.
    conds.push(
      Object.freeze({
        field: c.field,
        operator: c.operator,
        value: c.value,
        regex,
      }),
    )
  }
  return Object.freeze({ source: rule, conditions: Object.freeze(conds) })
}

export function compileRuleSet(rules: readonly GuardrailRule[]): CompiledRuleSet {
  const compiled: CompiledRule[] = []
  const byName = new Map<string, CompiledRule>()
  for (const r of rules) {
    if (byName.has(r.name)) {
      throw new GuardrailParseError([
        {
          file: r.name,
          code: 'guardrail_duplicate_name',
          rule: `two rules share name '${r.name}'`,
          severity: 'block',
        },
      ])
    }
    const c = compileRule(r)
    byName.set(r.name, c)
    compiled.push(c)
  }
  return Object.freeze({
    rules: Object.freeze(compiled),
    byName: Object.freeze(byName),
  })
}

// --- evaluator -----------------------------------------------------

export interface GuardrailEvalContext {
  readonly event: GuardrailEvent
  /** Tool name when applicable; absent for prompt / Stop / SubagentStop events. */
  readonly tool?: GuardrailTool
  readonly scope: GuardrailScope
  /**
   * Field values to match. Keys correspond to GuardrailField; absent fields
   * are treated as not-present (no condition can match an absent field).
   */
  readonly fields: Partial<Record<GuardrailField, string>>
  /**
   * Per-rule dedup ledger. Keys are computed dedupKey expansions; values
   * are running hit counts. The caller owns the ledger across calls.
   * Dedup is warn-only (block rules cannot dedup; rejected at parse time),
   * so a saturated ledger never downgrades a block decision.
   */
  readonly dedupLedger: ReadonlyMap<string, number>
}

export interface GuardrailMatch {
  readonly ruleName: string
  readonly ruleAction: GuardrailAction
  readonly conditionsMatched: number
  readonly dedupKey: string | null
  readonly message: string
  /** Why this match exists. `matched` is the canonical case; `matcher_error`
   *  means the matcher threw and the wire-in slice should treat the match
   *  as a fail-closed block. */
  readonly reason: 'matched' | 'matcher_error'
}

export interface GuardrailDiagnostic {
  readonly kind: 'dedup_skip' | 'matcher_error_caught'
  readonly ruleName: string
  readonly ruleAction: GuardrailAction
  readonly dedupKey?: string
  readonly detail?: string
}

/**
 * Evaluation result. `matches` and `diagnostics` are always present (may be
 * empty). The wire-in slice consumes:
 *   - `outcome` — drives whether the tool call proceeds.
 *   - `matches` — outcome-affecting hits; emit `guardrail_warned` /
 *     `guardrail_blocked` events.
 *   - `diagnostics` — non-outcome-affecting observations; emit
 *     `guardrail_skipped_dedup` / `guardrail_match_timeout` events.
 */
export interface GuardrailDecision {
  readonly outcome: 'allow' | 'warn' | 'block'
  readonly matches: readonly GuardrailMatch[]
  readonly diagnostics: readonly GuardrailDiagnostic[]
}

function expandDedupKey(
  template: string,
  ruleName: string,
  fields: Partial<Record<GuardrailField, string>>,
): string {
  // Bound substituted field values so dedup keys remain manageable inside
  // events.jsonl. A pathological `new_content` of 100 KB would otherwise
  // produce a 100 KB key per match.
  const truncate = (s: string): string =>
    s.length <= DEDUP_KEY_FIELD_VALUE_MAX
      ? s
      : `${s.slice(0, DEDUP_KEY_FIELD_VALUE_MAX)}…(+${s.length - DEDUP_KEY_FIELD_VALUE_MAX})`
  const expanded = template
    .replace(/\{rule\.name\}/g, ruleName)
    .replace(/\{(file_path|new_content|command|prompt|tool_input)\}/g, (_, key: GuardrailField) =>
      truncate(fields[key] ?? ''),
    )
  // True hard cap on the final expanded key. The per-field truncation
  // above bounds normal inputs; this final cap is defense in depth
  // against pathological templates that compose many fields. We reserve
  // 32 chars at the end for the suffix and slice the head so the
  // resulting key length is ≤ DEDUP_KEY_EXPANDED_MAX.
  if (expanded.length <= DEDUP_KEY_EXPANDED_MAX) return expanded
  const SUFFIX_RESERVE = 32
  const headLen = DEDUP_KEY_EXPANDED_MAX - SUFFIX_RESERVE
  const suffix = `…(+${expanded.length - headLen})`
  const truncatedSuffix =
    suffix.length > SUFFIX_RESERVE ? suffix.slice(0, SUFFIX_RESERVE) : suffix
  return expanded.slice(0, headLen) + truncatedSuffix
}

function normalizeNewlines(s: string): string {
  return s.includes('\r\n') ? s.replace(/\r\n/g, '\n') : s
}

function matchCondition(
  c: CompiledCondition,
  rawInput: string | undefined,
): boolean {
  if (rawInput === undefined) return false
  // Normalize CRLF to LF for non-pattern operators per contract
  // §"Operator semantics" (newline-normalized for equals / contains
  // / prefix / suffix). Glob operates on file paths, where CR is
  // not legal in any sane environment; normalize there anyway for
  // consistency.
  const input = normalizeNewlines(rawInput)
  switch (c.operator) {
    case 'equals':
      return input === c.value
    case 'contains':
      return input.includes(c.value)
    case 'prefix':
      return input.startsWith(c.value)
    case 'suffix':
      return input.endsWith(c.value)
    case 'glob':
      return c.regex !== null && c.regex.test(input)
    case 'regex':
      // Defer to v0.2; rejected at parse time. Defensive: never matches.
      return false
    default:
      return false
  }
}

/**
 * Evaluate the rule set against an event context.
 *
 * Returns a Decision the wire-in slice consumes:
 *   - `allow`  — no rules matched.
 *   - `warn`   — at least one warn-action rule matched and no block-action
 *                rule matched. `matches` holds the ordered list.
 *   - `block`  — at least one block-action rule matched. `matches` holds
 *                every match up to and including the first block (rules
 *                evaluated after a block do not run).
 *
 * Matcher exceptions (anything thrown from condition evaluation) translate
 * to `block` with reason `matcher_error` per the contract's fail-closed
 * posture. The wire-in slice surfaces this as `NEEDS_INTERVENTION.json`.
 */
export function evaluateGuardrails(
  ruleSet: CompiledRuleSet,
  ctx: GuardrailEvalContext,
): GuardrailDecision {
  const matches: GuardrailMatch[] = []
  const diagnostics: GuardrailDiagnostic[] = []
  const freezeDecision = (outcome: GuardrailDecision['outcome']): GuardrailDecision =>
    Object.freeze({
      outcome,
      matches: Object.freeze([...matches]),
      diagnostics: Object.freeze([...diagnostics]),
    })

  // Phase 1: select candidates by event, tool, scope, enabled.
  const candidates: CompiledRule[] = []
  for (const r of ruleSet.rules) {
    if (!r.source.enabled) continue
    if (r.source.event !== ctx.event) continue
    if (r.source.scope !== ctx.scope) continue
    if (GUARDRAIL_TOOL_BOUND_EVENTS.has(r.source.event)) {
      if (r.source.tool !== '*' && r.source.tool !== ctx.tool) continue
    }
    candidates.push(r)
  }
  if (candidates.length === 0) return freezeDecision('allow')

  // Phase 2: priority-descending order. Break ties by name for stability.
  candidates.sort((a, b) => {
    if (a.source.priority !== b.source.priority) {
      return b.source.priority - a.source.priority
    }
    return a.source.name.localeCompare(b.source.name)
  })

  let sawBlock = false
  let sawWarn = false

  for (const r of candidates) {
    let allMatched = true
    let conditionsMatched = 0
    try {
      // Stop / SubagentStop with no conditions: treat as match-all on event.
      if (r.conditions.length === 0) {
        allMatched = true
      } else {
        for (const c of r.conditions) {
          if (!matchCondition(c, ctx.fields[c.field])) {
            allMatched = false
            break
          }
          conditionsMatched++
        }
      }
    } catch (err) {
      // Fail-closed on matcher exception (contract §"Failure mode posture").
      // Surfaces as a `matcher_error` match (block) plus a diagnostic so
      // operators can audit. The wire-in slice writes
      // `NEEDS_INTERVENTION.json` from the match.
      const detail = err instanceof Error ? err.message : 'unknown'
      diagnostics.push(
        Object.freeze({
          kind: 'matcher_error_caught' as const,
          ruleName: r.source.name,
          ruleAction: r.source.action,
          detail,
        }),
      )
      matches.push(
        Object.freeze({
          ruleName: r.source.name,
          ruleAction: 'block' as const,
          conditionsMatched,
          dedupKey: null,
          message: `Matcher error evaluating rule '${r.source.name}'.`,
          reason: 'matcher_error' as const,
        }),
      )
      return freezeDecision('block')
    }

    if (!allMatched) continue

    // Dedup check applies only to warn rules. Block rules with `dedupKey`
    // are rejected at parse time (`guardrail_dedup_on_block_disallowed`),
    // so a saturated dedup can never silently downgrade a block to allow.
    let dedupKey: string | null = null
    if (r.source.dedupKey !== null) {
      dedupKey = expandDedupKey(r.source.dedupKey, r.source.name, ctx.fields)
      const hit = ctx.dedupLedger.get(dedupKey) ?? 0
      if (hit >= r.source.maxMatchesPerRun) {
        diagnostics.push(
          Object.freeze({
            kind: 'dedup_skip' as const,
            ruleName: r.source.name,
            ruleAction: r.source.action,
            dedupKey,
          }),
        )
        continue
      }
    }

    matches.push(
      Object.freeze({
        ruleName: r.source.name,
        ruleAction: r.source.action,
        conditionsMatched,
        dedupKey,
        message: r.source.message,
        reason: 'matched' as const,
      }),
    )
    if (r.source.action === 'block') {
      sawBlock = true
      break
    }
    sawWarn = true
  }

  if (sawBlock) return freezeDecision('block')
  if (sawWarn) return freezeDecision('warn')
  return freezeDecision('allow')
}
