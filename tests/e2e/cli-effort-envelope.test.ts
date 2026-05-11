// B1a Commit 2 — `--effort` flag binary-spawn e2e.
//
// Coverage:
//   1. Per level (lite, balanced, max, beast): a fresh `code-oz run`
//      with `--effort <level>` writes exactly one
//      `effort_envelope_applied` event with the correct `effort` +
//      `multiplier` + `effectiveBudgets = applyEffort(originalBudgets,
//      level)`.
//   2. Invariant set: `maxReviewRounds`, `maxToolCallsPerTurn`,
//      `toolCallBudgetMultiplier`, `softWarnAtRatio` are byte-identical
//      between `originalBudgets.global` and `effectiveBudgets.global`.
//   3. Active-run continuation: a run started with `--effort max` then
//      resumed (next `code-oz run` invocation, no flag) reads the same
//      max-scaled envelope from the recorded event — verified by
//      counting events (still exactly one `effort_envelope_applied`)
//      and asserting recorded effort/multiplier persist.
//   4. Active-run mismatch: a run started with `--effort max` then
//      invoked with `--effort lite` exits with code 2 and the
//      documented stderr message.
//
// Driven through `bun run src/cli.ts` (per L4 in
// `docs/design/SESSION_M16_KICKOFF.md`); no in-process dispatcher
// imports for state mutation.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import {
  BA_READY_REPLY,
  PLAN_RESPONSE,
  buildScientistEntry,
  readActiveRunId,
  readEventsRaw,
  rmTmp,
  runCli,
  setupMultiTaskProject,
  writeFakeScript,
  type CliResult,
  type FakeScriptEntryLiteral,
  type MultiTaskProject,
  type RawEvent,
} from './helpers/multi-task-cli.ts'
import {
  applyEffort,
  EFFORT_LEVELS,
  EFFORT_MULTIPLIERS,
  type EffortLevel,
} from '../../src/config/effort.ts'
import { loadConfig } from '../../src/config/load.ts'
import { runDoctorGit } from '../../src/commands/doctor.ts'

// --- preflight -----------------------------------------------------

beforeAll(async () => {
  const probe = await runDoctorGit()
  if (!probe.available || !probe.meetsMinimum) {
    throw new Error('B1a Commit 2 e2e requires git >= 2.40 on PATH')
  }
})

let project: MultiTaskProject
let scriptCounter = 0

// Bun's default hook timeout is 5s. `setupMultiTaskProject` runs git
// init + multiple git config commands + an in-process `code-oz init`,
// which under load exceeds 5s; bump to 30s so transient slowness on
// CI / parallel test runs does not turn into spurious SIGTERMs.
beforeEach(async () => {
  project = await setupMultiTaskProject()
  scriptCounter = 0
}, 30_000)

afterEach(async () => {
  if (project !== undefined) {
    await rmTmp(project.tmpRoot)
  }
}, 30_000)

interface SpawnContext {
  readonly label: string
  readonly script: readonly FakeScriptEntryLiteral[]
  readonly args: readonly string[]
  readonly skipFakeProvider?: boolean
}

async function dispatch(
  expectedExit: number,
  ctx: SpawnContext,
): Promise<CliResult> {
  scriptCounter += 1
  const filename = `${String(scriptCounter).padStart(2, '0')}-${ctx.label}.jsonl`
  const scriptPath = join(project.scriptDir, filename)
  await writeFakeScript(scriptPath, ctx.script)

  const args = ctx.skipFakeProvider
    ? ctx.args
    : [...ctx.args, '--provider', 'fake', '--fake-script', scriptPath]
  const result = await runCli(project.projectRoot, args)
  if (result.exitCode !== expectedExit) {
    throw new Error(
      `dispatch ${ctx.label}: expected exit ${expectedExit}, got ${result.exitCode}\n` +
        `args=${JSON.stringify(args)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

// Events.jsonl has the new event with the post-applyEffort budgets shape.
// We compare structurally via JSON.stringify on a normalized object.
function normalizeBudgetsToJson(b: unknown): unknown {
  return JSON.parse(JSON.stringify(b))
}

describe('B1a Commit 2 — CLI --effort flag (binary spawn)', () => {
  for (const level of EFFORT_LEVELS) {
    test(
      `--effort ${level}: emits effort_envelope_applied with correct multiplier + scaled envelope`,
      async () => {
        await dispatch(0, {
          label: `define-${level}`,
          script: [
            {
              matcher: { phase: 'define', agent: 'ba' },
              response: { content: BA_READY_REPLY },
            },
          ],
          args: ['run', '--request', `--effort ${level} smoke`, '--effort', level],
        })

        const runId = await readActiveRunId(project.stateDir)
        const events = await readEventsRaw(project.stateDir, runId)

        // 1a. Exactly one effort_envelope_applied event.
        const envelopeEvents = events.filter(
          (e) => e.type === 'effort_envelope_applied',
        )
        expect(envelopeEvents.length).toBe(1)

        // 1b. Lands immediately after run_started, BEFORE phase_entered.
        // The fresh-run sequence is run_started, the envelope event,
        // then phase_entered(define). Position 2 is locked per rule 23
        // + docs/design/B1A_EFFORT_FLAG.md § "Event order lock": the
        // envelope is a run-shape property captured at run start ahead
        // of any phase work.
        expect(events[0]!.type).toBe('run_started')
        expect(events[1]!.type).toBe('effort_envelope_applied')
        expect(events[2]!.type).toBe('phase_entered')

        const ev = envelopeEvents[0]! as RawEvent & {
          effort?: string
          multiplier?: number
          originalBudgets?: { global?: Record<string, unknown>; perPhase?: Record<string, unknown> }
          effectiveBudgets?: { global?: Record<string, unknown>; perPhase?: Record<string, unknown> }
        }
        expect(ev.effort).toBe(level)
        expect(ev.multiplier).toBe(EFFORT_MULTIPLIERS[level])

        // 2. Effective budgets match applyEffort(loadConfig output, level).
        const cfg = await loadConfig({ cwd: project.projectRoot })
        const expected = applyEffort(cfg, level).budgets
        const actual = ev.effectiveBudgets
        expect(normalizeBudgetsToJson(actual)).toEqual(
          normalizeBudgetsToJson(expected),
        )
        // The original budgets in the event match the loader output.
        expect(normalizeBudgetsToJson(ev.originalBudgets)).toEqual(
          normalizeBudgetsToJson(cfg.budgets),
        )

        // 3. Invariant-set fields are byte-identical.
        const origGlobal = ev.originalBudgets!.global as Record<string, unknown>
        const effGlobal = ev.effectiveBudgets!.global as Record<string, unknown>
        for (const field of [
          'maxReviewRounds',
          'maxToolCallsPerTurn',
          'toolCallBudgetMultiplier',
          'softWarnAtRatio',
        ] as const) {
          expect(effGlobal[field]).toBe(origGlobal[field] as never)
        }
      },
      120_000,
    )
  }

  test(
    'no --effort flag defaults to balanced (multiplier 1.0; byte-identical envelope)',
    async () => {
      await dispatch(0, {
        label: 'define-default',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'no flag default smoke'],
      })

      const runId = await readActiveRunId(project.stateDir)
      const events = await readEventsRaw(project.stateDir, runId)
      const envelopeEvents = events.filter(
        (e) => e.type === 'effort_envelope_applied',
      )
      expect(envelopeEvents.length).toBe(1)
      const ev = envelopeEvents[0]! as RawEvent & {
        effort?: string
        multiplier?: number
        originalBudgets?: unknown
        effectiveBudgets?: unknown
      }
      expect(ev.effort).toBe('balanced')
      expect(ev.multiplier).toBe(1.0)
      expect(normalizeBudgetsToJson(ev.effectiveBudgets)).toEqual(
        normalizeBudgetsToJson(ev.originalBudgets),
      )
    },
    120_000,
  )

  test(
    'active-run continuation preserves the recorded envelope (no second event)',
    async () => {
      const level: EffortLevel = 'max'
      await dispatch(0, {
        label: 'define-max',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', '--effort max smoke', '--effort', level],
      })
      const runId = await readActiveRunId(project.stateDir)

      await dispatch(0, {
        label: 'approve-define',
        script: [],
        args: ['approve', 'define'],
        skipFakeProvider: true,
      })

      // PLAN dispatch is the first active-run reload site (dispatchPlan
      // path). It calls applyRecordedEffort and would NOT emit a fresh
      // effort_envelope_applied; the recorded one is the only authority.
      await dispatch(0, {
        label: 'plan-resumed',
        script: [
          {
            matcher: { phase: 'plan', agent: 'lead' },
            response: { content: PLAN_RESPONSE },
          },
          buildScientistEntry('plan'),
        ],
        args: ['run'],
      })

      const events = await readEventsRaw(project.stateDir, runId)
      const envelopeEvents = events.filter(
        (e) => e.type === 'effort_envelope_applied',
      )
      // Still exactly one — active-run reload reads, never writes.
      expect(envelopeEvents.length).toBe(1)
      const ev = envelopeEvents[0]! as RawEvent & {
        effort?: string
        multiplier?: number
      }
      expect(ev.effort).toBe(level)
      expect(ev.multiplier).toBe(EFFORT_MULTIPLIERS[level])

      // PLAN actually completed (proxy assertion that the resumed
      // dispatch ran the post-applyRecordedEffort consumers without
      // tripping a budget cap derived from the original — the max
      // multiplier scales caps up, so the test would pass trivially
      // even with a no-op; the negative direction is exercised by
      // tests/config-effort-unit.test.ts).
      const phaseExited = events.find(
        (e) => e.type === 'phase_exited' && e.phase === 'plan',
      )
      // PLAN emits phase_exited only after approve plan; resumed
      // dispatch runs the plan but exits awaiting approval. Verify
      // the run progressed past run_started by counting events.
      void phaseExited
      expect(events.length).toBeGreaterThan(3)
    },
    120_000,
  )

  test(
    'active-run replay uses RECORDED effectiveBudgets, not the currently-loaded config (Codex R0 B1)',
    async () => {
      // Regression test for Codex R0 thread 019e17f8 block-push: editing
      // `.code-oz/config.yaml` mid-run MUST NOT change the recorded
      // envelope the dispatch consumes. The fixture's perPhase budgets
      // are 60 maxProviderCalls; --effort lite scales them to 24
      // (floor(60 * 0.4)). After DEFINE completes we sabotage the YAML
      // to 1 maxProviderCalls. If the dispatch re-applied applyEffort
      // to the new config (the buggy code), the effective cap would
      // become floor(1 * 0.4) = 0 → min-1 = 1 — and PLAN's 2-call
      // script (lead + scientist) would hit the cap at the second call.
      // The fix replays the RECORDED snapshot directly, so PLAN proceeds
      // normally and the run completes through to plan-awaiting-approval.
      await dispatch(0, {
        label: 'define-lite-config-edit',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'config-edit-mid-run', '--effort', 'lite'],
      })
      const runId = await readActiveRunId(project.stateDir)

      await dispatch(0, {
        label: 'approve-define-config-edit',
        script: [],
        args: ['approve', 'define'],
        skipFakeProvider: true,
      })

      // Mid-run config sabotage. Shrink the plan perPhase budget to 1
      // maxProviderCalls. The recorded envelope (24 from lite × 60)
      // must continue to govern.
      const configPath = join(project.projectRoot, '.code-oz', 'config.yaml')
      const configRaw = await readFile(configPath, 'utf8')
      const cfg = parseYaml(configRaw) as {
        budgets: {
          perPhase: Record<string, {
            maxTurns: number
            maxProviderCalls: number
            maxTokensEstimate: number
          }>
        }
      }
      cfg.budgets.perPhase.plan = {
        maxTurns: 1,
        maxProviderCalls: 1,
        maxTokensEstimate: 1_000,
      }
      await writeFile(configPath, stringifyYaml(cfg), 'utf8')

      // PLAN dispatch reads the sabotaged YAML + recorded envelope. The
      // fix ensures the recorded envelope wins.
      await dispatch(0, {
        label: 'plan-after-config-edit',
        script: [
          {
            matcher: { phase: 'plan', agent: 'lead' },
            response: { content: PLAN_RESPONSE },
          },
          buildScientistEntry('plan'),
        ],
        args: ['run'],
      })

      const events = await readEventsRaw(project.stateDir, runId)
      const envelopeEvents = events.filter(
        (e) => e.type === 'effort_envelope_applied',
      )
      // Still exactly one — the recorded event is immutable and the
      // dispatch is read-only on it.
      expect(envelopeEvents.length).toBe(1)
      const ev = envelopeEvents[0]! as RawEvent & {
        effort?: string
        effectiveBudgets?: { perPhase?: { plan?: { maxProviderCalls?: number } } }
      }
      expect(ev.effort).toBe('lite')
      // The recorded effective for plan.maxProviderCalls is the original
      // 60 × 0.4 = 24, NOT the sabotaged value re-applied (which would
      // be floor(1 × 0.4) = 0 → min-1 = 1).
      expect(ev.effectiveBudgets?.perPhase?.plan?.maxProviderCalls).toBe(24)

      // Plan dispatch ran two provider calls (lead + scientist) without
      // a budget-cap kill. If the buggy code path was taken, the
      // dispatch would have died after one call when re-applying lite
      // to the sabotaged 1-call cap.
      const phaseEntered = events.filter((e) => e.type === 'phase_entered')
      // run_started, phase_entered(define), then phase_entered(plan).
      // The plan entry confirms the dispatch advanced past define.
      const planEntered = phaseEntered.find(
        (e) => (e as RawEvent & { phase?: string }).phase === 'plan',
      )
      expect(planEntered).toBeDefined()
    },
    120_000,
  )

  test(
    'active-run rejects explicit --effort when no recorded envelope (legacy run, Codex R0 F5)',
    async () => {
      // Synthesize a legacy active run by deleting the recorded
      // envelope event from events.jsonl after a fresh run. The
      // mismatch entry-point should reject --effort with an explicit
      // legacy-run message rather than silently no-op'ing the flag.
      await dispatch(0, {
        label: 'define-legacy-seed',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'legacy-run rejection', '--effort', 'lite'],
      })
      const runId = await readActiveRunId(project.stateDir)

      // Strip the effort_envelope_applied event line to simulate a
      // pre-B1a run. readEvents will still parse the remaining lines.
      const eventsPath = join(project.stateDir, 'runs', runId, 'events.jsonl')
      const raw = await readFile(eventsPath, 'utf8')
      const stripped = raw
        .split('\n')
        .filter((line) => !line.includes('"type":"effort_envelope_applied"'))
        .join('\n')
      await writeFile(eventsPath, stripped, 'utf8')

      // Now invoke with --effort and assert legacy-run rejection.
      const result = await runCli(project.projectRoot, [
        'run',
        '--effort',
        'lite',
      ])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(
        'this active run pre-dates the --effort flag',
      )
    },
    120_000,
  )

  test(
    'active-run mismatch: --effort lite after --effort max exits with code 2 + documented stderr',
    async () => {
      await dispatch(0, {
        label: 'define-max-mismatch',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'mismatch smoke', '--effort', 'max'],
      })

      // Second invocation passes --effort lite. handleActiveRun's
      // mismatch check fires before any dispatcher.
      const result = await runCli(project.projectRoot, [
        'run',
        '--effort',
        'lite',
      ])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(
        'this run was started with --effort max; pass the same value or omit the flag',
      )
    },
    120_000,
  )

  test(
    'active-run continuation without --effort: omitted flag is permitted on every resume',
    async () => {
      await dispatch(0, {
        label: 'define-max-resume',
        script: [
          {
            matcher: { phase: 'define', agent: 'ba' },
            response: { content: BA_READY_REPLY },
          },
        ],
        args: ['run', '--request', 'omit flag resume smoke', '--effort', 'max'],
      })
      const runId = await readActiveRunId(project.stateDir)

      await dispatch(0, {
        label: 'approve-define-resume',
        script: [],
        args: ['approve', 'define'],
        skipFakeProvider: true,
      })

      // No --effort on the resume — must NOT trigger mismatch.
      await dispatch(0, {
        label: 'plan-no-flag',
        script: [
          {
            matcher: { phase: 'plan', agent: 'lead' },
            response: { content: PLAN_RESPONSE },
          },
          buildScientistEntry('plan'),
        ],
        args: ['run'],
      })

      const events = await readEventsRaw(project.stateDir, runId)
      const envelopeEvents = events.filter(
        (e) => e.type === 'effort_envelope_applied',
      )
      expect(envelopeEvents.length).toBe(1)
    },
    120_000,
  )

  test(
    'unknown --effort value rejected with exit code 2 + help cite',
    async () => {
      const result = await runCli(project.projectRoot, [
        'run',
        '--effort',
        'turbo',
      ])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(
        '--effort must be one of: lite | balanced | max | beast',
      )
    },
    30_000,
  )
})
