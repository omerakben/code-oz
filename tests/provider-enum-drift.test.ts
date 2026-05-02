// Provider-enum drift regression. PE-1's substrate (commit 1) added 'xai'
// to FIVE separate enumerations plus AUTH_SOURCES, plus the capability
// and family data tables, plus the config-load runtime validation list.
// Those surfaces must agree at all times, or one of two latent failure
// modes appears:
//
//   (A) a persona declaring `provider: xai` passes schema validation but
//       is rejected at runtime when the registry cannot resolve it
//       (or vice versa).
//   (B) a `company.<role>.provider: xai` override passes config-load
//       validation but fails later at agent-load time.
//
// This test fires when ANY of those surfaces drifts. A future milestone
// adding a new provider (PE-2 OpenRouter, PE-3 gateway, etc.) MUST update
// every entry below or this test fails — that is the point.
//
// Pinned in CODEX_RESPONSE_PE1.md "Implementation order changes" #2.

import { describe, test, expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PROVIDER_IDS, PROVIDER_FAMILIES } from '../src/providers/types.ts'
import { DEFAULT_FAMILY_BY_ID } from '../src/providers/families.ts'
import {
  AUTH_SOURCES,
  DEFAULT_CAPABILITY_BY_ID,
} from '../src/providers/capabilities.ts'
import { AGENT_PROVIDERS, AGENT_PHASES } from '../src/agents/schema.ts'
import { loadConfig } from '../src/config/load.ts'

describe('provider-enum drift (PE-1 commit 1 regression guard)', () => {
  test('PROVIDER_IDS, PROVIDER_FAMILIES, and AGENT_PROVIDERS list the same providers', () => {
    const ids = new Set(PROVIDER_IDS as readonly string[])
    const families = new Set(PROVIDER_FAMILIES as readonly string[])
    const agentProviders = new Set(AGENT_PROVIDERS as readonly string[])
    expect(families).toEqual(ids)
    expect(agentProviders).toEqual(ids)
  })

  test('DEFAULT_FAMILY_BY_ID has exactly one entry per PROVIDER_ID', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_FAMILY_BY_ID[id]).toBeDefined()
    }
    expect(Object.keys(DEFAULT_FAMILY_BY_ID).sort()).toEqual([...PROVIDER_IDS].sort())
  })

  test('DEFAULT_CAPABILITY_BY_ID has exactly one entry per PROVIDER_ID', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_CAPABILITY_BY_ID[id]).toBeDefined()
    }
    expect(Object.keys(DEFAULT_CAPABILITY_BY_ID).sort()).toEqual([...PROVIDER_IDS].sort())
  })

  test('every default capability authSource is a declared AUTH_SOURCES value', () => {
    for (const id of PROVIDER_IDS) {
      const cap = DEFAULT_CAPABILITY_BY_ID[id]
      expect((AUTH_SOURCES as readonly string[]).includes(cap.authSource)).toBe(true)
    }
  })

  test('config-load accepts every PROVIDER_ID as a defaultProvider value', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'code-oz-enum-drift-default-'))
    try {
      await mkdir(join(tmp, '.code-oz'), { recursive: true })
      for (const id of PROVIDER_IDS) {
        await writeFile(join(tmp, '.code-oz', 'config.yaml'), `defaultProvider: ${id}\n`)
        const cfg = await loadConfig({ cwd: tmp })
        expect(cfg.defaultProvider).toBe(id)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('config-load accepts every PROVIDER_ID as a company.<role>.provider', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'code-oz-enum-drift-company-'))
    try {
      await mkdir(join(tmp, '.code-oz'), { recursive: true })
      for (const id of PROVIDER_IDS) {
        await writeFile(
          join(tmp, '.code-oz', 'config.yaml'),
          `company:\n  ba:\n    provider: ${id}\n`,
        )
        const cfg = await loadConfig({ cwd: tmp })
        expect(cfg.company?.ba?.provider).toBe(id)
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test('xai is present on every surface (PE-1 lock)', () => {
    // Explicit per-id assertion so a regression that drops xai from any
    // one surface fails with a single clear message instead of a generic
    // set-difference mismatch.
    expect((PROVIDER_IDS as readonly string[]).includes('xai')).toBe(true)
    expect((PROVIDER_FAMILIES as readonly string[]).includes('xai')).toBe(true)
    expect((AGENT_PROVIDERS as readonly string[]).includes('xai')).toBe(true)
    expect(DEFAULT_FAMILY_BY_ID.xai).toBe('xai')
    expect(DEFAULT_CAPABILITY_BY_ID.xai).toBeDefined()
    expect(DEFAULT_CAPABILITY_BY_ID.xai.authSource).toBe('xai-api-key')
    expect((AUTH_SOURCES as readonly string[]).includes('xai-api-key')).toBe(true)
  })

  test('xai eligiblePhases stays the full AGENT_PHASES set (PE-1 lock)', () => {
    // Codex review thread 019de60e fix-soon: a future accidental change
    // from ALL_PHASES to a subset would slip through the membership check
    // above. This direct assertion catches an eligiblePhases shape change
    // even when the xai row still exists.
    expect([...DEFAULT_CAPABILITY_BY_ID.xai.eligiblePhases]).toEqual([...AGENT_PHASES])
  })
})
