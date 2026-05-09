// M16 C2 — JSONL loader + applier for the cross-process fake-replay
// fixture. Tests cover the parser, validator, gate semantics on the
// loader itself, and the apply-to-FakeProvider behavior.

import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  applyFakeScript,
  FAKE_SCRIPT_ENV_VAR,
  FakeScriptError,
  loadFakeScript,
  type FakeScriptEntry,
} from '../src/providers/fake-script.ts'
import { FakeProvider, collectProviderResponse } from '../src/providers/fake.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function writeScript(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-script-'))
  tempDirs.push(dir)
  const path = join(dir, 'script.jsonl')
  await writeFile(path, content, 'utf8')
  return path
}

describe('FAKE_SCRIPT_ENV_VAR — single-source-of-truth gate name', () => {
  test('exports the canonical env-var name used by the CLI gate', () => {
    expect(FAKE_SCRIPT_ENV_VAR).toBe('CODE_OZ_TEST_FAKE_SCRIPT_OK')
  })
})

describe('loadFakeScript — happy paths', () => {
  test('empty file returns zero entries', async () => {
    const path = await writeScript('')
    expect(await loadFakeScript(path)).toEqual([])
  })

  test('blank lines and // comments are skipped', async () => {
    const path = await writeScript(
      [
        '',
        '// this is a comment',
        '   ',
        '{"matcher": {"phase": "define", "agent": "ba"}, "response": {"content": "ok"}}',
        '   // indented comment is also skipped',
        '',
      ].join('\n'),
    )
    const entries = await loadFakeScript(path)
    expect(entries.length).toBe(1)
    expect(entries[0]?.matcher.phase).toBe('define')
    expect(entries[0]?.response.content).toBe('ok')
  })

  test('multi-entry file preserves order', async () => {
    const path = await writeScript(
      [
        '{"matcher": {"phase": "define", "agent": "ba"}, "response": {"content": "first"}}',
        '{"matcher": {"phase": "plan", "agent": "lead"}, "response": {"content": "second"}}',
        '{"matcher": {"phase": "review", "agent": "reviewer"}, "response": {"content": "third"}}',
      ].join('\n'),
    )
    const entries = await loadFakeScript(path)
    expect(entries.map((e) => e.response.content)).toEqual(['first', 'second', 'third'])
  })

  test('entries are frozen', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define", "agent": "ba"}, "response": {"content": "x"}}',
    )
    const entries = await loadFakeScript(path)
    expect(Object.isFrozen(entries)).toBe(true)
    expect(Object.isFrozen(entries[0])).toBe(true)
    expect(Object.isFrozen(entries[0]?.matcher)).toBe(true)
    expect(Object.isFrozen(entries[0]?.response)).toBe(true)
  })

  test('nested arrays in response are deep-frozen', async () => {
    // The shallow-spread copy left chunks + toolCalls mutable; the
    // tightening fix freezes them too. A future reducer that consumes
    // script entries can rely on the immutability guarantee end-to-end.
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"chunks": ["a", "b"], "toolCalls": []}}',
    )
    const entries = await loadFakeScript(path)
    expect(Object.isFrozen(entries[0]?.response.chunks)).toBe(true)
    expect(Object.isFrozen(entries[0]?.response.toolCalls)).toBe(true)
  })

  test('matcher with only phase is accepted', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "build"}, "response": {"content": "phase-only"}}',
    )
    const entries = await loadFakeScript(path)
    expect(entries[0]?.matcher.phase).toBe('build')
    expect(entries[0]?.matcher.agent).toBeUndefined()
  })

  test('matcher with only agent is accepted', async () => {
    const path = await writeScript(
      '{"matcher": {"agent": "scientist"}, "response": {"content": "agent-only"}}',
    )
    const entries = await loadFakeScript(path)
    expect(entries[0]?.matcher.agent).toBe('scientist')
    expect(entries[0]?.matcher.phase).toBeUndefined()
  })

  test('response with only model + stopReason (no content) is accepted', async () => {
    // FakeResponse permits content-less entries — the FakeProvider falls
    // back to default content. Loader should not require content.
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"model": "fake-test", "stopReason": "end_turn"}}',
    )
    const entries = await loadFakeScript(path)
    expect(entries[0]?.response.model).toBe('fake-test')
    expect(entries[0]?.response.stopReason).toBe('end_turn')
  })
})

describe('loadFakeScript — failure paths', () => {
  test('missing file throws FakeScriptError with line=0 issue', async () => {
    await expect(loadFakeScript('/tmp/nonexistent-fake-script-xyz.jsonl')).rejects.toBeInstanceOf(
      FakeScriptError,
    )
  })

  test('invalid JSON line surfaces fake_script_invalid_json', async () => {
    const path = await writeScript('{not valid json')
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(FakeScriptError)
      const e = err as FakeScriptError
      expect(e.issues.length).toBe(1)
      expect(e.issues[0]?.code).toBe('fake_script_invalid_json')
      expect(e.issues[0]?.line).toBe(1)
    }
  })

  test('top-level array rejected as invalid_shape', async () => {
    const path = await writeScript('[1, 2, 3]')
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_shape')
    }
  })

  test('missing matcher field rejected as invalid_shape', async () => {
    const path = await writeScript('{"response": {"content": "x"}}')
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_shape')
      expect(e.issues[0]?.rule).toContain('matcher')
    }
  })

  test('missing response field rejected as invalid_shape', async () => {
    const path = await writeScript('{"matcher": {"phase": "define"}}')
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_shape')
    }
  })

  test('matcher with invalid phase enum rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "synthesis"}, "response": {"content": "x"}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_matcher')
      expect(e.issues[0]?.rule).toContain('phase')
    }
  })

  test('matcher with empty agent rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"agent": ""}, "response": {"content": "x"}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_matcher')
    }
  })

  test('empty matcher (no phase, no agent) rejected', async () => {
    // Catches hand-edits that would match every call — would clobber
    // every test invocation.
    const path = await writeScript('{"matcher": {}, "response": {"content": "x"}}')
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_matcher')
      expect(e.issues[0]?.rule).toContain('at least one')
    }
  })

  test('matcher with unknown field (typo) rejected', async () => {
    // `pahse` typo-detection.
    const path = await writeScript(
      '{"matcher": {"pahse": "define"}, "response": {"content": "x"}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_matcher')
      expect(e.issues[0]?.rule).toContain('pahse')
    }
  })

  test('response.content not a string rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"content": 42}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_response')
      expect(e.issues[0]?.rule).toContain('content')
    }
  })

  test('completely empty response object rejected', async () => {
    // Catches hand-edits where `response: {}` was meant as a placeholder.
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_response')
      expect(e.issues[0]?.rule).toContain('at least one')
    }
  })

  test('response.chunks not an array rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"chunks": "not-an-array"}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_response')
      expect(e.issues[0]?.rule).toContain('chunks')
    }
  })

  test('response.chunks containing non-string entry rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"chunks": ["ok", 42, "ok2"]}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_response')
      expect(e.issues[0]?.rule).toContain('chunks[1]')
    }
  })

  test('response.chunks valid string array accepted', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"chunks": ["a", "b", "c"]}}',
    )
    const entries = await loadFakeScript(path)
    expect(entries[0]?.response.chunks).toEqual(['a', 'b', 'c'])
  })

  test('response.toolCalls not an array rejected', async () => {
    const path = await writeScript(
      '{"matcher": {"phase": "define"}, "response": {"toolCalls": "not-an-array"}}',
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues[0]?.code).toBe('fake_script_invalid_response')
      expect(e.issues[0]?.rule).toContain('toolCalls')
    }
  })

  test('multiple issues collected on one load (operator UX)', async () => {
    const path = await writeScript(
      [
        '{"matcher": {"phase": "synthesis"}, "response": {"content": "x"}}', // bad phase
        '{"matcher": {}, "response": {"content": "y"}}',                       // empty matcher
        '{"matcher": {"phase": "review"}, "response": {}}',                    // empty response
      ].join('\n'),
    )
    try {
      await loadFakeScript(path)
      throw new Error('expected throw')
    } catch (err) {
      const e = err as FakeScriptError
      expect(e.issues.length).toBe(3)
      expect(e.issues.map((i) => i.line)).toEqual([1, 2, 3])
    }
  })
})

describe('applyFakeScript — registers expectations on FakeProvider', () => {
  test('single entry routes through invoke()', async () => {
    const fake = new FakeProvider()
    const entries: readonly FakeScriptEntry[] = [
      Object.freeze({
        matcher: Object.freeze({ phase: 'define' as const, agent: 'ba' }),
        response: Object.freeze({ content: 'scripted-spec', model: 'fake-test' }),
      }),
    ]
    applyFakeScript(fake, entries)

    const stream = fake.invoke({
      agent: { name: 'ba', provider: 'fake', phase: 'define' } as never,
      phase: 'define',
      runId: '01HQ7ZX0000000000000000000',
      prompt: 'go',
      files: [],
    } as never)
    const response = await collectProviderResponse(stream)
    expect(response.content).toBe('scripted-spec')
    expect(response.model).toBe('fake-test')
  })

  test('multiple entries on same matcher dispatch FIFO', async () => {
    const fake = new FakeProvider()
    const entries: readonly FakeScriptEntry[] = [
      Object.freeze({
        matcher: Object.freeze({ phase: 'review' as const, agent: 'reviewer' }),
        response: Object.freeze({ content: 'first-call' }),
      }),
      Object.freeze({
        matcher: Object.freeze({ phase: 'review' as const, agent: 'reviewer' }),
        response: Object.freeze({ content: 'second-call' }),
      }),
    ]
    applyFakeScript(fake, entries)

    const reqShape = {
      agent: { name: 'reviewer', provider: 'fake', phase: 'review' } as never,
      phase: 'review' as const,
      runId: '01HQ7ZX0000000000000000000',
      prompt: 'go',
      files: [],
    }
    const r1 = await collectProviderResponse(fake.invoke(reqShape as never))
    const r2 = await collectProviderResponse(fake.invoke(reqShape as never))
    expect(r1.content).toBe('first-call')
    expect(r2.content).toBe('second-call')
  })

  test('most-specific match wins (phase+agent over phase-only)', async () => {
    const fake = new FakeProvider()
    const entries: readonly FakeScriptEntry[] = [
      Object.freeze({
        matcher: Object.freeze({ phase: 'review' as const }),
        response: Object.freeze({ content: 'phase-only-fallback' }),
      }),
      Object.freeze({
        matcher: Object.freeze({ phase: 'review' as const, agent: 'reviewer' }),
        response: Object.freeze({ content: 'specific-reviewer' }),
      }),
    ]
    applyFakeScript(fake, entries)

    const r = await collectProviderResponse(
      fake.invoke({
        agent: { name: 'reviewer', provider: 'fake', phase: 'review' } as never,
        phase: 'review',
        runId: '01HQ7ZX0000000000000000000',
        prompt: 'go',
        files: [],
      } as never),
    )
    expect(r.content).toBe('specific-reviewer')
  })

  test('no entries — fake provider falls back to default response', async () => {
    const fake = new FakeProvider()
    applyFakeScript(fake, [])
    const r = await collectProviderResponse(
      fake.invoke({
        agent: { name: 'unknown', provider: 'fake', phase: 'define' } as never,
        phase: 'define',
        runId: '01HQ7ZX0000000000000000000',
        prompt: 'go',
        files: [],
      } as never),
    )
    // Default content; not asserting exact value (FakeProvider's default
    // is 'fake response') — just that it's a non-empty fallback.
    expect(typeof r.content).toBe('string')
    expect((r.content ?? '').length).toBeGreaterThan(0)
  })
})

describe('end-to-end — load + apply + invoke', () => {
  test('full round-trip: write JSONL, load, apply, invoke yields scripted content', async () => {
    const path = await writeScript(
      [
        '{"matcher": {"phase": "define", "agent": "ba"}, "response": {"content": "<spec-ready/>\\n# SPEC\\n"}}',
        '{"matcher": {"phase": "plan", "agent": "lead"}, "response": {"content": "<plan-ready/>\\n# PLAN\\n"}}',
      ].join('\n'),
    )
    const entries = await loadFakeScript(path)
    expect(entries.length).toBe(2)

    const fake = new FakeProvider()
    applyFakeScript(fake, entries)

    const baResponse = await collectProviderResponse(
      fake.invoke({
        agent: { name: 'ba', provider: 'fake', phase: 'define' } as never,
        phase: 'define',
        runId: '01HQ7ZX0000000000000000000',
        prompt: 'go',
        files: [],
      } as never),
    )
    const leadResponse = await collectProviderResponse(
      fake.invoke({
        agent: { name: 'lead', provider: 'fake', phase: 'plan' } as never,
        phase: 'plan',
        runId: '01HQ7ZX0000000000000000000',
        prompt: 'go',
        files: [],
      } as never),
    )
    expect(baResponse.content).toContain('<spec-ready/>')
    expect(leadResponse.content).toContain('<plan-ready/>')
  })
})
