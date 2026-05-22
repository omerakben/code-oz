import { describe, expect, test } from 'bun:test'
import { parseRunArgs } from '../src/commands/run.ts'

const OK_ENV = { CODE_OZ_TEST_FAKE_SCRIPT_OK: '1' } as const

describe('code-oz run --operator / --non-interactive parsing', () => {
  test('--operator <id> is captured', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.operator).toBe('hermes')
    expect(r.nonInteractive).toBe(false)
  })

  test('--non-interactive sets the flag and requires --operator', () => {
    const ok = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--request', 'hi'])
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') expect(ok.nonInteractive).toBe(true)

    const bad = parseRunArgs(['--non-interactive', '--request', 'hi'])
    expect(bad.kind).toBe('error')
    if (bad.kind === 'error') expect(bad.message).toContain('--operator')
  })

  test('rejects malformed operator id', () => {
    const r = parseRunArgs(['--operator', 'bad id!', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('--operator')
  })

  test('bans --provider fake in non-interactive mode', () => {
    const r = parseRunArgs(['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('bans --fake-script in non-interactive mode (even with env)', () => {
    const r = parseRunArgs(
      ['--operator', 'hermes', '--non-interactive', '--provider', 'fake', '--fake-script', '/x.jsonl', '--request', 'hi'],
      OK_ENV,
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('fake')
  })

  test('fake still works WITHOUT --non-interactive (rule 8 preserved)', () => {
    const r = parseRunArgs(['--provider', 'fake', '--request', 'hi'])
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.providerOverride).toBe('fake')
  })
})
