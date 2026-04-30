// M9 commit 2: tool_use.review_request schema + load validation.
//
// REVIEW.md § "Permissions required" pins the shape; this validator
// catches misconfiguration at load time before BUILD runs (so a typo
// like `providers: ['claud']` or `maxRounds: 5` fails the run before
// any agent is invoked, never at REVIEW invocation time mid-loop).
//
// CLAUDE.md non-negotiable rule 6 caps maxRounds at 4. v0.1 only ships
// the `request-review` tool and the `provider-only` network mode.

import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import {
  REVIEW_REQUEST_HARD_CAPS,
  REVIEW_REQUEST_TOOL_NAMES,
} from '../src/agents/schema.ts'
import { PROVIDER_FAMILIES } from '../src/providers/types.ts'

function fmFile(permissions: Record<string, unknown>): SourceFile {
  const data = {
    name: 'reviewer-test',
    type: 'agent',
    phase: 'review',
    provider: 'codex',
    modelPolicy: 'any',
    permissions,
    description: 'Test reviewer persona declaring tool_use.review_request.',
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return {
    file: 'src/agents/defaults/reviewer-test.md',
    content: `---\n${yaml}\n---\n# Reviewer\n\n## Overview\nTest agent.\n`,
  }
}

const VALID_REVIEW_REQUEST = {
  tools: ['request-review'],
  providers: ['codex', 'gemini'],
  maxRounds: 4,
  timeoutMsPerRound: 120_000,
  network: 'provider-only',
}

describe('tool_use.review_request — happy path', () => {
  test('accepts a minimal request-review declaration with M9 caps', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: { review_request: VALID_REVIEW_REQUEST },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def).toBeDefined()
    const r = def?.permissions.tool_use?.review_request
    expect(r).toBeDefined()
    expect(r?.tools).toEqual(['request-review'])
    expect(r?.providers).toEqual(['codex', 'gemini'])
    expect(r?.maxRounds).toBe(4)
    expect(r?.timeoutMsPerRound).toBe(120_000)
    expect(r?.network).toBe('provider-only')
  })

  test('frozen output (tools, providers, parent object)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: { review_request: VALID_REVIEW_REQUEST },
        }),
      ],
      overrides: [],
    })
    const r = reg.listAll()[0]?.permissions.tool_use?.review_request
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r?.tools)).toBe(true)
    expect(Object.isFrozen(r?.providers)).toBe(true)
  })

  test('hard caps match REVIEW.md contract', () => {
    expect(REVIEW_REQUEST_HARD_CAPS.maxRounds).toBe(4)
    expect(REVIEW_REQUEST_HARD_CAPS.timeoutMsPerRound).toBe(600_000)
    expect(REVIEW_REQUEST_TOOL_NAMES).toEqual(['request-review'])
  })

  test('a single-provider list is permitted', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: {
            review_request: { ...VALID_REVIEW_REQUEST, providers: ['codex'] },
          },
        }),
      ],
      overrides: [],
    })
    const r = reg.listAll()[0]?.permissions.tool_use?.review_request
    expect(r?.providers).toEqual(['codex'])
  })
})

describe('tool_use.review_request — tools field', () => {
  test('rejects non-array tools', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, tools: 'request-review' },
            },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects empty tools array', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, tools: [] } },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain('must list at least one tool')
    }
  })

  test('rejects unknown tool name', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, tools: ['ask-debate'] },
            },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain('request-review')
    }
  })
})

describe('tool_use.review_request — providers field', () => {
  test('rejects non-array providers', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, providers: 'codex' },
            },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects empty providers list', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, providers: [] } },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain('at least one provider family')
    }
  })

  test('rejects typo in provider family name', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, providers: ['claud'] },
            },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      // Error names the valid set so the typo is fixable from the message.
      expect(e.issues[0]!.rule).toContain('one of:')
      for (const fam of PROVIDER_FAMILIES) {
        expect(e.issues[0]!.rule).toContain(fam)
      }
    }
  })

  test('all PROVIDER_FAMILIES are accepted as valid entries', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: {
            review_request: { ...VALID_REVIEW_REQUEST, providers: [...PROVIDER_FAMILIES] },
          },
        }),
      ],
      overrides: [],
    })
    const r = reg.listAll()[0]?.permissions.tool_use?.review_request
    expect(r?.providers).toEqual([...PROVIDER_FAMILIES])
  })
})

describe('tool_use.review_request — numeric caps', () => {
  test('rejects maxRounds = 0', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, maxRounds: 0 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxRounds > 4 (CLAUDE.md rule 6)', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, maxRounds: 5 } },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain('≤ 4')
    }
  })

  test('rejects non-integer maxRounds', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, maxRounds: 2.5 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('accepts maxRounds = 1, 2, 3, 4', () => {
    for (const n of [1, 2, 3, 4]) {
      const reg = buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, maxRounds: n } },
          }),
        ],
        overrides: [],
      })
      expect(reg.listAll()[0]?.permissions.tool_use?.review_request?.maxRounds).toBe(n)
    }
  })

  test('rejects timeoutMsPerRound > 600_000 (10-minute hard cap)', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, timeoutMsPerRound: 600_001 },
            },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain('≤ 600000')
    }
  })

  test('rejects timeoutMsPerRound = 0', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: {
              review_request: { ...VALID_REVIEW_REQUEST, timeoutMsPerRound: 0 },
            },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('accepts timeoutMsPerRound at the boundary (600_000)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: {
            review_request: { ...VALID_REVIEW_REQUEST, timeoutMsPerRound: 600_000 },
          },
        }),
      ],
      overrides: [],
    })
    expect(reg.listAll()[0]?.permissions.tool_use?.review_request?.timeoutMsPerRound).toBe(
      600_000,
    )
  })
})

describe('tool_use.review_request — network field', () => {
  test('rejects network=none (M9 sub-scope requires provider-only)', () => {
    try {
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, network: 'none' } },
          }),
        ],
        overrides: [],
      })
      throw new Error('expected reject')
    } catch (err) {
      const e = err as AgentLoadError
      expect(e.issues[0]!.rule).toContain("'provider-only'")
    }
  })

  test('rejects network=full (no internet escape hatch in v0.1)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { review_request: { ...VALID_REVIEW_REQUEST, network: 'full' } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })
})

describe('tool_use sub-scope set includes review_request', () => {
  test('unknown sub-scope still rejected (review_request was added cleanly)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/REVIEW.md'],
            bash: 'deny',
            tool_use: { ask_debate: { tools: ['ask-debate'] } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('review_request sits alongside repo_context and write on the same agent', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/REVIEW.md'],
          bash: 'deny',
          tool_use: {
            repo_context: {
              tools: ['glob', 'grep', 'read'],
              roots: ['.code-oz/runs/<runId>/worktree/'],
              maxResults: 50,
              maxBytesPerResult: 16384,
              maxFilesForNextManifest: 0,
              timeoutMs: 5000,
              network: 'none',
            },
            review_request: VALID_REVIEW_REQUEST,
          },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def?.permissions.tool_use?.repo_context).toBeDefined()
    expect(def?.permissions.tool_use?.review_request).toBeDefined()
  })
})
