// M10 commit 1: tool_use.debate schema + load validation.
//
// DEBATE.md § "Permission sub-scope" pins the shape; this validator
// catches misconfiguration at load time before any debate is invoked
// (so a typo like `opposingProviders: ['claud']` or `maxConcurrent: 5`
// fails the run before any phase runs).
//
// Cross-family invariant (CLAUDE.md rule 2 + DEBATE.md): opposingProviders
// cannot include the persona's own family. Load-time enforcement here;
// runtime enforcement in src/tools/debate-request.ts.
//
// previewBeforeSend MUST be literally `true` per CLAUDE.md rule 13
// (privacy by default — manifest preview is non-negotiable).

import { describe, test, expect } from 'bun:test'
import { buildRegistry, type SourceFile } from '../src/agents/loader.ts'
import { AgentLoadError } from '../src/agents/errors.ts'
import { DEBATE_HARD_CAPS } from '../src/agents/schema.ts'
import { PROVIDER_FAMILIES } from '../src/providers/types.ts'

function fmFile(
  permissions: Record<string, unknown>,
  provider: string = 'claude',
): SourceFile {
  const data = {
    name: 'lead-test',
    type: 'agent',
    phase: 'plan',
    provider,
    modelPolicy: 'any',
    permissions,
    description: 'Test PLAN persona declaring tool_use.debate.',
  }
  const yaml = Object.entries(data)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return {
    file: 'src/agents/defaults/lead-test.md',
    content: `---\n${yaml}\n---\n# Lead\n\n## Overview\nTest agent.\n`,
  }
}

const VALID_DEBATE = {
  opposingProviders: ['codex'],
  maxConcurrent: 1,
  previewBeforeSend: true,
  maxFiles: 20,
  timeoutMs: 600_000,
}

describe('tool_use.debate — happy path', () => {
  test('accepts a minimal debate declaration with M10 caps', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: { debate: VALID_DEBATE },
        }),
      ],
      overrides: [],
    })
    const def = reg.listAll()[0]
    expect(def).toBeDefined()
    const d = def?.permissions.tool_use?.debate
    expect(d).toBeDefined()
    expect(d?.opposingProviders).toEqual(['codex'])
    expect(d?.maxConcurrent).toBe(1)
    expect(d?.previewBeforeSend).toBe(true)
    expect(d?.maxFiles).toBe(20)
    expect(d?.timeoutMs).toBe(600_000)
  })

  test('frozen output (opposingProviders, parent object)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: { debate: VALID_DEBATE },
        }),
      ],
      overrides: [],
    })
    const d = reg.listAll()[0]?.permissions.tool_use?.debate
    expect(Object.isFrozen(d)).toBe(true)
    expect(Object.isFrozen(d?.opposingProviders)).toBe(true)
  })

  test('hard caps match DEBATE.md contract', () => {
    expect(DEBATE_HARD_CAPS.maxConcurrent).toBe(4)
    expect(DEBATE_HARD_CAPS.maxFiles).toBe(50)
    expect(DEBATE_HARD_CAPS.timeoutMs).toBe(600_000)
  })

  test('multiple opposingProviders permitted (cross-family list)', () => {
    // M11 update: gemini is no longer valid here because
    // capabilityOf('gemini').eligiblePhases is []. The cross-family
    // invariant still holds (claude persona, opposing list contains
    // only non-claude families), but each entry must also pass the
    // M11 eligibility check at the loader layer (Codex CODEX_REVIEW_M11.md
    // bp#1 — closes the synthetic-debate-opponent bypass).
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: {
            debate: { ...VALID_DEBATE, opposingProviders: ['codex', 'fake'] },
          },
        }),
      ],
      overrides: [],
    })
    const d = reg.listAll()[0]?.permissions.tool_use?.debate
    expect(d?.opposingProviders).toEqual(['codex', 'fake'])
  })

  test('maxFiles=0 permitted (purely-design debate, no codebase context)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: { debate: { ...VALID_DEBATE, maxFiles: 0 } },
        }),
      ],
      overrides: [],
    })
    const d = reg.listAll()[0]?.permissions.tool_use?.debate
    expect(d?.maxFiles).toBe(0)
  })

  test('coexists with other tool_use sub-scopes', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: {
            repo_context: {
              tools: ['glob', 'grep', 'read'],
              roots: ['.'],
              maxResults: 10,
              maxBytesPerResult: 4096,
              maxFilesForNextManifest: 10,
              timeoutMs: 5000,
              network: 'none',
            },
            debate: VALID_DEBATE,
          },
        }),
      ],
      overrides: [],
    })
    const tu = reg.listAll()[0]?.permissions.tool_use
    expect(tu?.debate).toBeDefined()
    expect(tu?.repo_context).toBeDefined()
  })
})

describe('tool_use.debate — opposingProviders field', () => {
  test('rejects non-array opposingProviders', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, opposingProviders: 'codex' } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects empty opposingProviders array', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, opposingProviders: [] } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects opposingProviders entry not in PROVIDER_FAMILIES (typo)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: {
              debate: { ...VALID_DEBATE, opposingProviders: ['claud'] },
            },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('cross-family invariant: opposingProviders cannot include persona own family (claude → claude)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile(
            {
              read: '*',
              write: ['.code-oz/artifacts/PLAN.md'],
              bash: 'deny',
              tool_use: {
                debate: { ...VALID_DEBATE, opposingProviders: ['claude'] },
              },
            },
            'claude',
          ),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('cross-family invariant: codex persona cannot debate codex', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile(
            {
              read: '*',
              write: ['.code-oz/artifacts/PLAN.md'],
              bash: 'deny',
              tool_use: {
                debate: { ...VALID_DEBATE, opposingProviders: ['codex'] },
              },
            },
            'codex',
          ),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('cross-family invariant: persona may debate against any eligible other family', () => {
    // claude persona, opposing list = [codex, fake]. M11 update: this
    // test originally used gemini; per CODEX_REVIEW_M11.md bp#1, gemini
    // is no longer eligible (capabilityOf('gemini').eligiblePhases=[]),
    // so the loader rejects it before bootstrap returns. The
    // cross-family schema invariant is preserved (no entry shares
    // claude's family); the M11 eligibility check narrows the universe
    // of valid opposing providers to those declared eligible.
    const reg = buildRegistry({
      defaults: [
        fmFile(
          {
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: {
              debate: { ...VALID_DEBATE, opposingProviders: ['codex', 'fake'] },
            },
          },
          'claude',
        ),
      ],
      overrides: [],
    })
    expect(reg.listAll()[0]).toBeDefined()
  })

  test('PROVIDER_FAMILIES set contains expected v0.1 families', () => {
    // Sanity: cross-family enforcement only works if PROVIDER_FAMILIES is
    // the source of truth. M10's debate inherits the M9 review_request
    // family list.
    expect(PROVIDER_FAMILIES).toContain('claude')
    expect(PROVIDER_FAMILIES).toContain('codex')
    expect(PROVIDER_FAMILIES).toContain('gemini')
  })
})

describe('tool_use.debate — maxConcurrent field', () => {
  test('rejects non-integer maxConcurrent', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, maxConcurrent: 1.5 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects zero maxConcurrent', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, maxConcurrent: 0 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxConcurrent above hard cap', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, maxConcurrent: 5 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('accepts maxConcurrent at hard cap (4)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: { debate: { ...VALID_DEBATE, maxConcurrent: 4 } },
        }),
      ],
      overrides: [],
    })
    expect(reg.listAll()[0]?.permissions.tool_use?.debate?.maxConcurrent).toBe(4)
  })
})

describe('tool_use.debate — maxFiles field', () => {
  test('rejects negative maxFiles', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, maxFiles: -1 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects maxFiles above hard cap', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, maxFiles: 51 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('accepts maxFiles at hard cap (50)', () => {
    const reg = buildRegistry({
      defaults: [
        fmFile({
          read: '*',
          write: ['.code-oz/artifacts/PLAN.md'],
          bash: 'deny',
          tool_use: { debate: { ...VALID_DEBATE, maxFiles: 50 } },
        }),
      ],
      overrides: [],
    })
    expect(reg.listAll()[0]?.permissions.tool_use?.debate?.maxFiles).toBe(50)
  })
})

describe('tool_use.debate — timeoutMs field', () => {
  test('rejects zero timeoutMs', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, timeoutMs: 0 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects timeoutMs above hard cap (10 minutes)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, timeoutMs: 600_001 } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })
})

describe('tool_use.debate — previewBeforeSend invariant', () => {
  test('rejects previewBeforeSend: false (CLAUDE.md rule 13 invariant)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, previewBeforeSend: false } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects previewBeforeSend missing', () => {
    const partial = { ...VALID_DEBATE } as Record<string, unknown>
    delete partial.previewBeforeSend
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: partial },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })

  test('rejects previewBeforeSend: "true" (string, not literal boolean)', () => {
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { debate: { ...VALID_DEBATE, previewBeforeSend: 'true' } },
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })
})

describe('tool_use.debate — KNOWN_SUB_SCOPES', () => {
  test('debate is a recognized sub-scope (no schema_invalid_permissions for debate key)', () => {
    // The validator enumerates KNOWN_SUB_SCOPES. If `debate` isn't on the
    // allowed list, the debate fixture above would have failed with the
    // "may contain only X / Y / Z sub-scopes" error before any debate
    // validator ran. The happy-path test confirms it's recognized; this
    // test confirms an *unknown* sub-scope still fails.
    expect(() =>
      buildRegistry({
        defaults: [
          fmFile({
            read: '*',
            write: ['.code-oz/artifacts/PLAN.md'],
            bash: 'deny',
            tool_use: { unknown_scope: {} } as Record<string, unknown>,
          }),
        ],
        overrides: [],
      }),
    ).toThrow(AgentLoadError)
  })
})
