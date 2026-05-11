// B2 — rule-9 enforcement layer. Tests cover parser shape rejection,
// compiler regex / glob, evaluator decision flow, dedup, scope, fail-closed
// matcher errors, and per-event field allowlists. The runtime wire-in into
// the tool-call wrapper is a separate slice; these tests cover the contract
// + module slice only (docs/contracts/GUARDRAILS.md, B2 from
// docs/comparisons/claude-code/SYNTHESIS.md).

import { describe, test, expect } from 'bun:test'
import {
  parseGuardrailRule,
  parseGuardrailRuleFile,
  compileRuleSet,
  evaluateGuardrails,
  GuardrailParseError,
  type GuardrailRule,
  type GuardrailEvalContext,
} from '../src/policy/guardrails.ts'

function rule(text: string): GuardrailRule {
  return parseGuardrailRule(text).rule
}

function ctx(
  overrides: Partial<GuardrailEvalContext> & Pick<GuardrailEvalContext, 'event' | 'scope'>,
): GuardrailEvalContext {
  return {
    fields: {},
    dedupLedger: new Map(),
    ...overrides,
  }
}

describe('parseGuardrailRule — frontmatter', () => {
  test('rejects a rule without frontmatter', () => {
    expect(() => parseGuardrailRule('no frontmatter here')).toThrow(GuardrailParseError)
  })

  test('rejects unknown frontmatter keys', () => {
    const text = `---
name: bad-rule
event: PreToolUse
scope: runtime-tool-call
actions: warn
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GuardrailParseError)
      const e = err as GuardrailParseError
      expect(e.issues.some((i) => i.code === 'guardrail_unknown_frontmatter_key')).toBe(true)
    }
  })

  test('accepts a minimal valid warn rule', () => {
    const r = rule(`---
name: warn-debug-print
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: new_content
    operator: contains
    value: console.log
---

Production code should not include debug-print statements.
`)
    expect(r.name).toBe('warn-debug-print')
    expect(r.action).toBe('warn')
    expect(r.scope).toBe('runtime-tool-call')
    expect(r.message).toContain('Production code')
    expect(r.conditions).toHaveLength(1)
  })

  test('rejects the deferred regex operator (v0.1; v0.2 re-enables)', () => {
    const text = `---
name: bad-regex
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: command
    operator: regex
    value: rm.*-rf
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(e.issues.some((i) => i.code === 'guardrail_operator_deferred')).toBe(true)
    }
  })

  test('rejects dedupKey on action=block (silent dedup-allow downgrade prevention)', () => {
    const text = `---
name: bad-block-dedup
event: PreToolUse
tool: Bash
scope: runtime-tool-call
action: block
dedupKey: '{rule.name}:{command}'
conditions:
  - field: command
    operator: contains
    value: rm -rf
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(
        e.issues.some((i) => i.code === 'guardrail_dedup_on_block_disallowed'),
      ).toBe(true)
    }
  })

  test('warns on unknown dedupKey placeholder', () => {
    const result = parseGuardrailRule(`---
name: typo-dedup
event: PreToolUse
scope: runtime-tool-call
dedupKey: '{rule.name}:{file_pat}'
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`)
    expect(result.warnings.some((w) => w.code === 'guardrail_dedup_template_invalid')).toBe(true)
    expect(result.rule.dedupKey).toBe('{rule.name}:{file_pat}')
  })

  test('rejects condition.maxLength as unknown (regex deferred)', () => {
    const text = `---
name: stale-maxlen
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
    maxLength: 100
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(
        e.issues.some(
          (i) =>
            i.code === 'guardrail_unknown_frontmatter_key' && i.rule.includes('maxLength'),
        ),
      ).toBe(true)
    }
  })

  test('uses distinct parse codes for invalid_enabled / invalid_tool / invalid_max_matches_per_run', () => {
    const tries: Array<{ text: string; expected: string }> = [
      {
        text: `---
name: bad-enabled
enabled: yes
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`,
        expected: 'guardrail_invalid_enabled',
      },
      {
        text: `---
name: bad-tool
event: PreToolUse
tool: NotATool
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`,
        expected: 'guardrail_invalid_tool',
      },
      {
        text: `---
name: bad-max
event: PreToolUse
scope: runtime-tool-call
maxMatchesPerRun: -1
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`,
        expected: 'guardrail_invalid_max_matches_per_run',
      },
    ]
    for (const t of tries) {
      try {
        parseGuardrailRule(t.text)
        throw new Error(`expected throw for ${t.expected}`)
      } catch (err) {
        const e = err as GuardrailParseError
        expect(e.issues.some((i) => i.code === t.expected)).toBe(true)
      }
    }
  })

  test('rejects malformed condition shape with distinct code', () => {
    const text = `---
name: bad-cond-shape
event: PreToolUse
scope: runtime-tool-call
conditions:
  - "not an object"
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(
        e.issues.some((i) => i.code === 'guardrail_invalid_condition_shape'),
      ).toBe(true)
    }
  })

  test('rejects dedupKey template over the length cap', () => {
    const longTemplate = '{rule.name}:' + 'x'.repeat(300)
    const text = `---
name: long-template
event: PreToolUse
scope: runtime-tool-call
dedupKey: '${longTemplate}'
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(
        e.issues.some(
          (i) => i.code === 'guardrail_invalid_dedup_template' && i.rule.includes('length'),
        ),
      ).toBe(true)
    }
  })

  test('rejects glob pattern over the length cap', () => {
    const longPattern = 'a/'.repeat(200) + '*'
    const text = `---
name: long-glob
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: glob
    value: '${longPattern}'
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(e.issues.some((i) => i.code === 'guardrail_glob_pattern_too_long')).toBe(true)
    }
  })

  test('rejects field not allowed for event', () => {
    // 'prompt' field is allowed only for UserPromptSubmit.
    const text = `---
name: bad-field
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: prompt
    operator: contains
    value: secret
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(e.issues.some((i) => i.code === 'guardrail_field_not_allowed_for_event')).toBe(true)
    }
  })

  test('rejects tool field on Stop event', () => {
    const text = `---
name: bad-tool-on-stop
event: Stop
scope: runtime-tool-call
tool: Edit
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as GuardrailParseError
      expect(e.issues.some((i) => i.code === 'guardrail_tool_not_allowed_for_event')).toBe(true)
    }
  })

  test('uses Markdown body as message when message: is absent', () => {
    const r = rule(`---
name: body-message
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: secrets
---

Files under secrets/ must not be edited from runs.
`)
    expect(r.message.startsWith('Files under secrets/')).toBe(true)
  })

  test('Stop event with no conditions is legal (event-only rule)', () => {
    const r = rule(`---
name: notice-on-stop
event: Stop
scope: runtime-tool-call
---

Run completed.
`)
    expect(r.conditions).toHaveLength(0)
    expect(r.event).toBe('Stop')
  })
})

describe('compileRuleSet — duplicates and regex', () => {
  test('rejects two rules with the same name', () => {
    const a = rule(`---
name: dup
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`)
    const b = rule(`---
name: dup
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: bar
---
`)
    expect(() => compileRuleSet([a, b])).toThrow(GuardrailParseError)
  })

  test('compiles glob to anchored RegExp', () => {
    const r = rule(`---
name: glob-rule
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: glob
    value: src/**/*.ts
---
`)
    const set = compileRuleSet([r])
    const compiled = set.byName.get('glob-rule')
    expect(compiled?.conditions[0]?.regex?.test('src/foo/bar.ts')).toBe(true)
    expect(compiled?.conditions[0]?.regex?.test('src/foo.ts')).toBe(true)
    expect(compiled?.conditions[0]?.regex?.test('docs/foo.ts')).toBe(false)
  })
})

describe('evaluateGuardrails — decision flow', () => {
  test('allow when no rule matches', () => {
    const r = rule(`---
name: r1
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: command
    operator: contains
    value: rm
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Bash',
        fields: { command: 'ls -la' },
      }),
    )
    expect(decision.outcome).toBe('allow')
  })

  test('warn when warn rule matches', () => {
    const r = rule(`---
name: warn-debug-print
event: PreToolUse
scope: runtime-tool-call
tool: Write
conditions:
  - field: new_content
    operator: contains
    value: console.log
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { new_content: '  console.log("debug")\n' },
      }),
    )
    expect(decision.outcome).toBe('warn')
    if (decision.outcome === 'warn') {
      expect(decision.matches[0]?.ruleName).toBe('warn-debug-print')
    }
  })

  test('block when block rule matches; subsequent rules do not run', () => {
    const a = rule(`---
name: block-rm-rf
event: PreToolUse
scope: runtime-tool-call
tool: Bash
action: block
priority: 200
conditions:
  - field: command
    operator: contains
    value: rm -rf
---
`)
    const b = rule(`---
name: warn-after-block
event: PreToolUse
scope: runtime-tool-call
tool: Bash
priority: 100
conditions:
  - field: command
    operator: contains
    value: rm
---
`)
    const set = compileRuleSet([a, b])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Bash',
        fields: { command: 'rm -rf /tmp/foo' },
      }),
    )
    expect(decision.outcome).toBe('block')
    if (decision.outcome === 'block') {
      // The block rule fired and stopped evaluation; warn-after-block did
      // not produce a match entry.
      expect(decision.matches).toHaveLength(1)
      expect(decision.matches[0]?.ruleName).toBe('block-rm-rf')
    }
  })

  test('multi-condition AND: all must match', () => {
    const r = rule(`---
name: warn-debug-in-prod-source
event: PreToolUse
scope: runtime-tool-call
tool: Write
conditions:
  - field: file_path
    operator: glob
    value: src/**/*.ts
  - field: new_content
    operator: contains
    value: console.log
---
`)
    const set = compileRuleSet([r])

    const matchedOnce = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'src/lib/foo.ts', new_content: 'console.log("x")' },
      }),
    )
    expect(matchedOnce.outcome).toBe('warn')

    // Same file_path but no console.log → no match.
    const noContent = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'src/lib/foo.ts', new_content: 'logger.info("x")' },
      }),
    )
    expect(noContent.outcome).toBe('allow')

    // Same content but in a test file (glob mismatch) → no match.
    const wrongPath = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'tests/foo.test.ts', new_content: 'console.log("x")' },
      }),
    )
    expect(wrongPath.outcome).toBe('allow')
  })

  test('scope mismatch: artifact-authoring rule does not fire on runtime-tool-call', () => {
    const r = rule(`---
name: artifact-only
event: PreToolUse
scope: artifact-authoring
tool: Write
conditions:
  - field: new_content
    operator: contains
    value: SECRET_KEY
---
`)
    const set = compileRuleSet([r])
    const runtime = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { new_content: 'export const SECRET_KEY = "..."' },
      }),
    )
    expect(runtime.outcome).toBe('allow')

    const artifact = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'artifact-authoring',
        tool: 'Write',
        fields: { new_content: 'export const SECRET_KEY = "..."' },
      }),
    )
    expect(artifact.outcome).toBe('warn')
  })

  test('priority-descending order; ties broken by name', () => {
    const a = rule(`---
name: aaaa-warn
event: PreToolUse
scope: runtime-tool-call
priority: 100
conditions:
  - field: file_path
    operator: contains
    value: x
---
`)
    const b = rule(`---
name: zzzz-warn
event: PreToolUse
scope: runtime-tool-call
priority: 100
conditions:
  - field: file_path
    operator: contains
    value: x
---
`)
    const high = rule(`---
name: high-warn
event: PreToolUse
scope: runtime-tool-call
priority: 500
conditions:
  - field: file_path
    operator: contains
    value: x
---
`)
    const set = compileRuleSet([a, b, high])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        fields: { file_path: 'src/x.ts' },
      }),
    )
    expect(decision.outcome).toBe('warn')
    if (decision.outcome === 'warn') {
      expect(decision.matches[0]?.ruleName).toBe('high-warn')
      expect(decision.matches[1]?.ruleName).toBe('aaaa-warn')
      expect(decision.matches[2]?.ruleName).toBe('zzzz-warn')
    }
  })

  test('expanded dedup key is hard-capped at 512 chars even with pathological fields', () => {
    const r = rule(`---
name: dedup-hard-cap
event: PreToolUse
scope: runtime-tool-call
tool: Write
dedupKey: '{rule.name}:{new_content}:{file_path}'
conditions:
  - field: new_content
    operator: contains
    value: x
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        // Both substituted values are themselves huge.
        fields: {
          new_content: 'x'.repeat(10_000),
          file_path: 'a/'.repeat(10_000),
        },
      }),
    )
    expect(decision.outcome).toBe('warn')
    const expandedKey = decision.matches[0]?.dedupKey ?? ''
    expect(expandedKey.length).toBeLessThanOrEqual(512)
  })

  test('dedup below cap: rule fires normally; ledger hit < cap', () => {
    const r = rule(`---
name: under-cap-warn
event: PreToolUse
scope: runtime-tool-call
tool: Write
dedupKey: '{rule.name}:{file_path}'
maxMatchesPerRun: 5
conditions:
  - field: file_path
    operator: equals
    value: src/foo.ts
---
`)
    const set = compileRuleSet([r])
    const ledger = new Map<string, number>([['under-cap-warn:src/foo.ts', 2]])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'src/foo.ts' },
        dedupLedger: ledger,
      }),
    )
    expect(decision.outcome).toBe('warn')
    expect(decision.matches).toHaveLength(1)
    expect(decision.matches[0]?.dedupKey).toBe('under-cap-warn:src/foo.ts')
  })

  test('disabled rule does not fire', () => {
    const r = rule(`---
name: off-rule
enabled: false
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: anything
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        fields: { file_path: 'src/anything.ts' },
      }),
    )
    expect(decision.outcome).toBe('allow')
  })

  test('absent input field never matches a condition that wants it', () => {
    const r = rule(`---
name: needs-content
event: PreToolUse
scope: runtime-tool-call
tool: Write
conditions:
  - field: new_content
    operator: contains
    value: secret
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'src/foo.ts' },
      }),
    )
    expect(decision.outcome).toBe('allow')
  })

  test('decision shape: matches and diagnostics are always present (allow)', () => {
    const r = rule(`---
name: never-fires
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: never
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        fields: { file_path: 'src/foo.ts' },
      }),
    )
    expect(decision.outcome).toBe('allow')
    expect(Array.isArray(decision.matches)).toBe(true)
    expect(decision.matches).toHaveLength(0)
    expect(Array.isArray(decision.diagnostics)).toBe(true)
    expect(decision.diagnostics).toHaveLength(0)
  })

  test('dedup-skip emits a diagnostic; warn outcome downgrades to allow when ALL matches are skipped', () => {
    const r = rule(`---
name: dedup-warn-rule
event: PreToolUse
scope: runtime-tool-call
tool: Write
dedupKey: '{rule.name}:{file_path}'
maxMatchesPerRun: 2
conditions:
  - field: file_path
    operator: equals
    value: src/foo.ts
---
`)
    const set = compileRuleSet([r])
    const ledger = new Map<string, number>([['dedup-warn-rule:src/foo.ts', 2]])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        fields: { file_path: 'src/foo.ts' },
        dedupLedger: ledger,
      }),
    )
    // Note: dedup applies only to warn rules (block + dedup is rejected at
    // parse). A saturated dedup on a warn rule returns 'allow' but emits
    // a 'dedup_skip' diagnostic so the wire-in slice can write a
    // `guardrail_skipped_dedup` event.
    expect(decision.outcome).toBe('allow')
    expect(decision.diagnostics).toHaveLength(1)
    expect(decision.diagnostics[0]?.kind).toBe('dedup_skip')
    expect(decision.diagnostics[0]?.dedupKey).toBe('dedup-warn-rule:src/foo.ts')
  })

  test('newline normalization: contains operator matches CRLF input against LF value', () => {
    const r = rule(`---
name: warn-todo
event: PreToolUse
scope: runtime-tool-call
tool: Write
conditions:
  - field: new_content
    operator: contains
    value: "TODO\\nFIX"
---
`)
    const set = compileRuleSet([r])
    const decision = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        tool: 'Write',
        // Input has CRLF; value has LF. Newline normalization should
        // make this match.
        fields: { new_content: 'foo\r\nTODO\r\nFIX bar' },
      }),
    )
    expect(decision.outcome).toBe('warn')
  })

  test('glob normalizes consecutive `**/` (`src/**/**/foo.ts` matches `src/foo.ts`)', () => {
    const r = rule(`---
name: deep-glob
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: glob
    value: src/**/**/foo.ts
---
`)
    const set = compileRuleSet([r])
    const direct = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        fields: { file_path: 'src/foo.ts' },
      }),
    )
    expect(direct.outcome).toBe('warn')
    const nested = evaluateGuardrails(
      set,
      ctx({
        event: 'PreToolUse',
        scope: 'runtime-tool-call',
        fields: { file_path: 'src/a/b/c/foo.ts' },
      }),
    )
    expect(nested.outcome).toBe('warn')
  })
})

describe('GuardrailEvalContext — defaults and clock injection', () => {
  test('uses Date.now when no clock is provided', () => {
    // Smoke test: this should not throw when the context omits `now`.
    const r = rule(`---
name: smoke
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`)
    const set = compileRuleSet([r])
    expect(() =>
      evaluateGuardrails(
        set,
        ctx({
          event: 'PreToolUse',
          scope: 'runtime-tool-call',
          fields: { file_path: 'src/foo.ts' },
        }),
      ),
    ).not.toThrow()
  })
})

describe('FRONTMATTER_RE — CRLF tolerance (Copilot review)', () => {
  // Rule files saved on Windows use \r\n line endings. The original
  // LF-only frontmatter anchor mis-classified those files as having no
  // frontmatter, surfacing as guardrail_frontmatter_missing.

  test('accepts a rule file written with CRLF line endings', () => {
    const lf = `---
name: crlf-rule
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: contains
    value: foo
---

CRLF rule body.
`
    const crlf = lf.replace(/\n/g, '\r\n')
    const r = rule(crlf)
    expect(r.name).toBe('crlf-rule')
    expect(r.conditions).toHaveLength(1)
    expect(r.message).toContain('CRLF rule body.')
  })
})

describe('parseGuardrailRule — invalid condition.field error code', () => {
  // Copilot review: a condition-shape error (bad `field` enum value) was
  // routed through `guardrail_invalid_operator`, masking operator
  // diagnostics. The error now has its own code.

  test('flags an unknown condition.field as guardrail_invalid_condition_field', () => {
    const text = `---
name: bad-field
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: not_a_field
    operator: contains
    value: x
---
`
    try {
      parseGuardrailRule(text)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GuardrailParseError)
      const e = err as GuardrailParseError
      expect(
        e.issues.some((i) => i.code === 'guardrail_invalid_condition_field'),
      ).toBe(true)
      // The operator code stays for actual operator typos only.
      expect(
        e.issues.some(
          (i) => i.code === 'guardrail_invalid_operator' && i.rule.includes('field must be'),
        ),
      ).toBe(false)
    }
  })
})

describe('parseGuardrailRuleFile — fail-open posture (Codex P1)', () => {
  // docs/contracts/GUARDRAILS.md §"Failure mode posture":
  //   - Fail-closed on malformed block rules.
  //   - Fail-open on malformed warn rules.
  // The wrapper turns the asymmetric posture into an explicit ok/skip
  // result and lets the multi-file loader log + continue.

  test('returns ok:true on a valid warn rule', () => {
    const text = `---
name: ok-warn
event: PreToolUse
scope: runtime-tool-call
action: warn
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`
    const r = parseGuardrailRuleFile(text)
    expect(r.ok).toBe(true)
  })

  test('returns ok:false with intendedAction=warn on a malformed warn rule', () => {
    // Default action is warn; the body fails to parse because conditions
    // is missing required fields. The wrapper must report skip, not throw.
    const text = `---
name: bad-warn
event: PreToolUse
scope: runtime-tool-call
action: warn
conditions:
  - field: file_path
    operator: contains
---
`
    const r = parseGuardrailRuleFile(text)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.intendedAction).toBe('warn')
      expect(r.issues.length).toBeGreaterThan(0)
      expect(r.issues.some((i) => i.severity === 'block')).toBe(true)
    }
  })

  test('treats default action (omitted) as warn intent → fail-open', () => {
    // No `action` key → contract default is warn → fail-open.
    const text = `---
name: bad-default
event: PreToolUse
scope: runtime-tool-call
conditions:
  - field: file_path
    operator: not_a_real_op
    value: x
---
`
    const r = parseGuardrailRuleFile(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.intendedAction).toBe('warn')
  })

  test('fail-closed (rethrows) on a malformed block rule', () => {
    const text = `---
name: bad-block
event: PreToolUse
tool: Bash
scope: runtime-tool-call
action: block
conditions:
  - field: command
    operator: not_a_real_op
    value: rm
---
`
    expect(() => parseGuardrailRuleFile(text)).toThrow(GuardrailParseError)
  })

  test('fail-closed on an unreadable rule file (cannot prove warn intent)', () => {
    // No frontmatter at all → we cannot peek the action key → fall back
    // to fail-closed so we never silently drop a rule the operator
    // believed was a block rule.
    const text = `not a rule file at all`
    expect(() => parseGuardrailRuleFile(text)).toThrow(GuardrailParseError)
  })

  test('fail-closed when the action key is present but not a known enum value', () => {
    // `action: enforce` is neither warn nor block; we cannot prove warn
    // intent, so fail-closed.
    const text = `---
name: bad-action
event: PreToolUse
scope: runtime-tool-call
action: enforce
conditions:
  - field: file_path
    operator: contains
    value: foo
---
`
    expect(() => parseGuardrailRuleFile(text)).toThrow(GuardrailParseError)
  })
})
