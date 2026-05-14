// M16 C2 — parseRunArgs CLI flag-parsing tests, with focus on the new
// `--fake-script` gate semantics (Codex R0 Risk #3 + Risk #9 closure).
//
// The gate has two conditions both required for `--fake-script` to be
// accepted:
//   1. `--provider fake` must also be set on the same invocation.
//   2. The env var CODE_OZ_TEST_FAKE_SCRIPT_OK=1 (or =true) must be
//      present.
// Either gate failing must produce an actionable CLI error and NOT a
// silent fallthrough; the test seam can never accidentally enable in a
// real run.

import { describe, test, expect } from 'bun:test'
import { parseRunArgs } from '../src/commands/run.ts'

describe('parseRunArgs — baseline (no --fake-script)', () => {
  test('accepts --request', () => {
    const r = parseRunArgs(['--request', 'hello'], {})
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.input.kind).toBe('inline')
    expect(r.fakeScriptPath).toBeUndefined()
  })

  test('accepts --provider fake', () => {
    const r = parseRunArgs(['--provider', 'fake'], {})
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.providerOverride).toBe('fake')
    expect(r.fakeScriptPath).toBeUndefined()
  })

  test('rejects --provider claude (only fake supported in v0.1)', () => {
    const r = parseRunArgs(['--provider', 'claude'], {})
    expect(r.kind).toBe('error')
  })

  test('accepts --resume as an explicit active-run continuation flag', () => {
    const r = parseRunArgs(['--resume'], {})
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.resumeRequested).toBe(true)
    expect(r.input.kind).toBe('tty')
  })

  test('rejects --resume with new run input', () => {
    const r = parseRunArgs(['--resume', '--request', 'new work'], {})
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('--resume')
  })

  test('maps old effort aliases to canonical effort names', () => {
    const low = parseRunArgs(['--effort', 'low'], {})
    expect(low.kind).toBe('ok')
    if (low.kind === 'ok') expect(low.effort).toBe('lite')

    const medium = parseRunArgs(['--effort=medium'], {})
    expect(medium.kind).toBe('ok')
    if (medium.kind === 'ok') expect(medium.effort).toBe('balanced')

    const high = parseRunArgs(['--effort', 'high'], {})
    expect(high.kind).toBe('ok')
    if (high.kind === 'ok') expect(high.effort).toBe('max')
  })
})

describe('parseRunArgs — --fake-script gate (Codex R0 Risk #3 + #9)', () => {
  test('accepts when --provider fake AND env var = 1 are both set', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/script.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.providerOverride).toBe('fake')
    expect(r.fakeScriptPath).toBe('/tmp/script.jsonl')
  })

  test('accepts env var = "true" as well as "1"', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/x.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: 'true' },
    )
    expect(r.kind).toBe('ok')
  })

  test('rejects --fake-script without --provider fake', () => {
    const r = parseRunArgs(
      ['--fake-script', '/tmp/script.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('--provider fake')
  })

  test('rejects --fake-script when env var is missing', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/script.jsonl', '--request', 'go'],
      {},
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('CODE_OZ_TEST_FAKE_SCRIPT_OK')
  })

  test('rejects --fake-script when env var is empty string', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/script.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '' },
    )
    expect(r.kind).toBe('error')
  })

  test('rejects --fake-script when env var = 0', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/x.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '0' },
    )
    expect(r.kind).toBe('error')
  })

  test('rejects --fake-script when env var = "yes" (only "1" or "true")', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/x.jsonl', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: 'yes' },
    )
    expect(r.kind).toBe('error')
  })

  test('rejects --fake-script with empty path', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('non-empty')
  })

  test('rejects --fake-script missing its value', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('--fake-script')
  })

  test('accepts --fake-script=path= form', () => {
    const r = parseRunArgs(
      ['--provider=fake', '--fake-script=/tmp/x.jsonl', '--request=go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.fakeScriptPath).toBe('/tmp/x.jsonl')
  })

  test('order-independence: --fake-script before --provider also gates correctly', () => {
    // The full-arg parse must not depend on the order users typed flags.
    const r = parseRunArgs(
      ['--fake-script', '/tmp/x.jsonl', '--provider', 'fake', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('ok')
  })

  test('rejects --fake-script when only --provider fake is set with env var ABSENT', () => {
    // Defense-in-depth: the most common misconfiguration is "I set the
    // flag and forgot the env var." This test pins the error message
    // points to the env var name explicitly.
    const r = parseRunArgs(
      ['--provider', 'fake', '--fake-script', '/tmp/x.jsonl', '--request', 'go'],
      {},
    )
    expect(r.kind).toBe('error')
    if (r.kind !== 'error') return
    expect(r.message).toContain('CODE_OZ_TEST_FAKE_SCRIPT_OK=1')
  })
})

describe('parseRunArgs — --fake-script does NOT activate without the flag', () => {
  test('env var alone (no flag) leaves fakeScriptPath unset', () => {
    const r = parseRunArgs(
      ['--provider', 'fake', '--request', 'go'],
      { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' },
    )
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.fakeScriptPath).toBeUndefined()
  })

  test('default (no flag, no env var) leaves fakeScriptPath unset', () => {
    const r = parseRunArgs(['--request', 'go'], {})
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.fakeScriptPath).toBeUndefined()
  })
})
