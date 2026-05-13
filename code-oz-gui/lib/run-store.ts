import { watch, type FSWatcher } from 'node:fs';
import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { FIXTURE_RUN_DIR, FIXTURE_RUN_ID, PROJECT_ROOT, getRunRecord } from './run-registry';
import type { Phase, PhaseEvent, Profile } from './event-types';
import type { CardState, RunBudgets, RunCard, RunState } from './types';

export const FIXTURE_EVENTS_PATH = join(FIXTURE_RUN_DIR, 'events.jsonl');
export const FIXTURE_STATE_PATH = join(FIXTURE_RUN_DIR, 'current.json');
export const FIXTURE_REQUESTS_DIR = join(FIXTURE_RUN_DIR, 'requests');
export { FIXTURE_RUN_DIR, FIXTURE_RUN_ID, PROJECT_ROOT };

export const ARTIFACT_NAMES = ['SPEC.md', 'AUDIT.md', 'PLAN.md', 'SOURCE_CHECK.md', 'BUILD_REPORT.md', 'VERIFY.md', 'REVIEW.md', 'SHIP.md'] as const;
export type ArtifactName = (typeof ARTIFACT_NAMES)[number];
const DECISION_EVENT_TYPES = new Set(['gate_required', 'gate_written', 'intervention', 'review_round_completed', 'question_added', 'budget_warning', 'debate_resolved']);
const PHASE_ARTIFACTS: Readonly<Record<Phase, ArtifactName>> = {
  define: 'SPEC.md',
  audit: 'AUDIT.md',
  plan: 'PLAN.md',
  build: 'BUILD_REPORT.md',
  verify: 'VERIFY.md',
  review: 'REVIEW.md',
  ship: 'SHIP.md',
};
const PHASE_TITLES: Readonly<Record<Phase, string>> = {
  define: 'Define the request',
  audit: 'Audit the repo',
  plan: 'Plan the work',
  build: 'Build the code',
  verify: 'Verify it works',
  review: 'Review for issues',
  ship: 'Prepare to ship',
};
const DEFAULT_BUDGETS: RunBudgets = {
  global: {
    maxTokensEstimate: 500000,
    tokensSpent: 0,
    softWarnAtRatio: 0.75,
    currentRatio: 0,
  },
  priceTable: {},
  spendUSD: 0,
};

export type WorkspaceSession = {
  readonly workspacePath: string;
  readonly profile: 'brownfield';
  readonly hasRuns: boolean;
};

export const workspaceSessions = new Map<string, WorkspaceSession>();

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveWorkspacePath(inputPath: string): string {
  return isAbsolute(inputPath) ? resolve(inputPath) : resolve(PROJECT_ROOT, inputPath);
}

export function isFixtureWorkspace(workspacePath: string): boolean {
  return resolve(workspacePath) === resolve(FIXTURE_RUN_DIR);
}

export async function isCodeOzWorkspace(workspacePath: string): Promise<boolean> {
  if (!isAbsolute(workspacePath)) {
    return false;
  }

  try {
    const runsDir = join(workspacePath, '.code-oz', 'state', 'runs');
    const runsStat = await stat(runsDir);
    return runsStat.isDirectory();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

export async function validateWorkspacePath(inputPath: string): Promise<WorkspaceSession | null> {
  const workspacePath = resolveWorkspacePath(inputPath);

  if (isFixtureWorkspace(workspacePath) && await isDirectory(workspacePath)) {
    return { workspacePath, profile: 'brownfield', hasRuns: true };
  }

  if (isAbsolute(inputPath) && await isCodeOzWorkspace(workspacePath)) {
    return { workspacePath, profile: 'brownfield', hasRuns: true };
  }

  return null;
}

export function assertFixtureRunId(runId: string): Response | null {
  if (getRunRecord(runId)) {
    return null;
  }

  return Response.json({ ok: false, error: `Unknown runId: ${runId}` }, { status: 404 });
}

export function isArtifactName(name: string): name is ArtifactName {
  return ARTIFACT_NAMES.includes(name as ArtifactName);
}

export function resolveRunDir(runId: string): string | null {
  return getRunRecord(runId)?.runDir ?? null;
}

export function eventsPathForRun(runId: string): string | null {
  const runDir = resolveRunDir(runId);
  return runDir ? join(runDir, 'events.jsonl') : null;
}

function liveArtifactPath(runId: string, name: ArtifactName): string | null {
  const record = getRunRecord(runId);

  if (!record) {
    return null;
  }

  return join(record.repoPath, '.code-oz', 'artifacts', runId, name);
}

export async function artifactPathForRun(runId: string, name: ArtifactName): Promise<string | null> {
  const runDir = resolveRunDir(runId);

  if (!runDir) {
    return null;
  }

  const runDirArtifactPath = join(runDir, name);

  if (runId === FIXTURE_RUN_ID || await pathExists(runDirArtifactPath)) {
    return runDirArtifactPath;
  }

  return liveArtifactPath(runId, name);
}

function eventField(event: PhaseEvent, field: string): unknown {
  return (event as PhaseEvent & Record<string, unknown>)[field];
}

function stringEventField(event: PhaseEvent, field: string): string | null {
  const value = eventField(event, field);
  return typeof value === 'string' ? value : null;
}

function numberEventField(event: PhaseEvent, field: string): number | null {
  const value = eventField(event, field);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function eventPhase(event: PhaseEvent): Phase | null {
  const phase = stringEventField(event, 'phase');
  return phase === 'define' || phase === 'audit' || phase === 'plan' || phase === 'build' || phase === 'verify' || phase === 'review' || phase === 'ship'
    ? phase
    : null;
}

function taskIdForEvent(event: PhaseEvent): string | null {
  return stringEventField(event, 'taskId') ?? stringEventField(event, 'parentTaskId');
}

function cardStateForPhase(phase: Phase, events: readonly PhaseEvent[]): CardState {
  const phaseEvents = events.filter((event) => eventPhase(event) === phase);
  const lastGateRequired = phaseEvents.findLast((event) => event.type === 'gate_required');
  const lastApproval = phaseEvents.findLast((event) => event.type === 'intervention' && stringEventField(event, 'code')?.includes('approved'));
  const lastExit = phaseEvents.findLast((event) => event.type === 'phase_exited');
  const lastEntered = phaseEvents.findLast((event) => event.type === 'phase_entered');

  if (lastExit && stringEventField(lastExit, 'outcome') === 'passed') {
    return { kind: 'approved' };
  }

  if (lastGateRequired && (!lastApproval || lastApproval.ts < lastGateRequired.ts)) {
    return { kind: 'awaiting-approval', gateName: stringEventField(lastGateRequired, 'blockedOn') ?? `${phase} approval` };
  }

  if (lastEntered) {
    return { kind: 'in-progress', startedAt: lastEntered.ts };
  }

  return { kind: 'pending' };
}

function cardStateForTask(taskId: string, events: readonly PhaseEvent[]): CardState {
  const taskEvents = events.filter((event) => taskIdForEvent(event) === taskId);
  const latestReview = taskEvents.findLast((event) => event.type === 'review_round_completed');
  const latestVerify = taskEvents.findLast((event) => event.type === 'verify_completed');
  const latestBuild = taskEvents.findLast((event) => event.type === 'build_started');

  if (latestReview) {
    const verdict = stringEventField(latestReview, 'verdict');

    if (verdict && verdict !== 'ready') {
      return { kind: 'awaiting-approval', gateName: `review round ${numberEventField(latestReview, 'round') ?? 1} returned ${verdict}` };
    }

    return { kind: 'approved' };
  }

  if (latestVerify) {
    return { kind: 'approved' };
  }

  if (latestBuild) {
    return { kind: 'in-progress', startedAt: latestBuild.ts };
  }

  return { kind: 'pending' };
}

function decisionsCountFor(events: readonly PhaseEvent[], phase: Phase, taskId?: string): number {
  return events.filter((event) => {
    if (!DECISION_EVENT_TYPES.has(event.type)) {
      return false;
    }

    if (taskId) {
      return taskIdForEvent(event) === taskId;
    }

    return eventPhase(event) === phase;
  }).length;
}

function buildCards(events: readonly PhaseEvent[], profile: Profile): readonly RunCard[] {
  const phases = new Set<Phase>();
  const taskIds = new Set<string>();

  if (profile === 'brownfield') {
    phases.add('audit');
  } else {
    phases.add('define');
  }

  for (const event of events) {
    const phase = eventPhase(event);
    const taskId = taskIdForEvent(event);

    if (phase === 'define' || phase === 'audit' || phase === 'plan') {
      phases.add(phase);
    }

    if (taskId) {
      taskIds.add(taskId);
    }
  }

  return [
    ...Array.from(phases).map((phase): RunCard => ({
      id: phase,
      kind: phase === 'plan' ? 'plan' : 'audit',
      phase,
      title: PHASE_TITLES[phase],
      subtitle: PHASE_ARTIFACTS[phase],
      state: cardStateForPhase(phase, events),
      artifactPath: PHASE_ARTIFACTS[phase],
      decisionsCount: decisionsCountFor(events, phase),
    })),
    ...Array.from(taskIds).sort().map((taskId): RunCard => {
      const latestTaskPhaseEvent = events.findLast((event) => taskIdForEvent(event) === taskId && eventPhase(event));
      const latestPhase = latestTaskPhaseEvent ? eventPhase(latestTaskPhaseEvent) : null;
      const phase = latestPhase === 'verify' || latestPhase === 'review' ? latestPhase : 'build';

      return {
        id: taskId,
        kind: 'task',
        phase,
        title: taskId,
        subtitle: `${taskId} · live task`,
        state: cardStateForTask(taskId, events),
        artifactPath: 'BUILD_REPORT.md',
        decisionsCount: decisionsCountFor(events, phase, taskId),
      };
    }),
  ];
}

function budgetsFromEvents(events: readonly PhaseEvent[]): RunBudgets {
  let tokensSpent = 0;
  let spendUSD = 0;
  let maxTokensEstimate = DEFAULT_BUDGETS.global.maxTokensEstimate;
  let softWarnAtRatio = DEFAULT_BUDGETS.global.softWarnAtRatio;

  for (const event of events) {
    tokensSpent += numberEventField(event, 'tokensUsed') ?? 0;
    spendUSD += numberEventField(event, 'costActualUSD') ?? 0;

    if (event.type === 'config_resolved') {
      const budgets = eventField(event, 'budgets');
      const global = typeof budgets === 'object' && budgets !== null && 'global' in budgets ? budgets.global : null;

      if (typeof global === 'object' && global !== null) {
        const maxTokens = (global as Record<string, unknown>).maxTokensEstimate;
        const softWarn = (global as Record<string, unknown>).softWarnAtRatio;

        if (typeof maxTokens === 'number') {
          maxTokensEstimate = maxTokens;
        }

        if (typeof softWarn === 'number') {
          softWarnAtRatio = softWarn;
        }
      }
    }

    if (event.type === 'budget_warning') {
      tokensSpent = numberEventField(event, 'spent') ?? tokensSpent;
      maxTokensEstimate = numberEventField(event, 'limit') ?? maxTokensEstimate;
    }
  }

  return {
    global: {
      maxTokensEstimate,
      tokensSpent,
      softWarnAtRatio,
      currentRatio: maxTokensEstimate > 0 ? tokensSpent / maxTokensEstimate : 0,
    },
    priceTable: {},
    spendUSD,
  };
}

function stateFromEvents(runId: string, events: readonly PhaseEvent[]): RunState {
  const record = getRunRecord(runId);
  const runStarted = events.find((event) => event.type === 'run_started');
  const lastEvent = events.at(-1);
  const profileValue = runStarted ? eventField(runStarted, 'profile') : null;
  const profile: Profile = profileValue === 'greenfield' || profileValue === 'brownfield' ? profileValue : 'brownfield';
  const latestPhaseEntered = events.findLast((event) => event.type === 'phase_entered');
  const currentPhase = latestPhaseEntered ? eventPhase(latestPhaseEntered) : null;
  const startedAt = runStarted?.ts ?? new Date().toISOString();

  return {
    version: 1,
    runId,
    lifecycle: record?.lifecycle ?? 'running',
    providerMode: record?.providerMode ?? null,
    ...(record?.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record?.exitSignal !== undefined ? { exitSignal: record.exitSignal } : {}),
    profile,
    currentPhase,
    currentOutcome: null,
    request: '',
    repoPath: record?.repoPath ?? '',
    startedAt,
    lastEventAt: lastEvent?.ts ?? startedAt,
    cards: buildCards(events, profile),
    budgets: budgetsFromEvents(events),
  };
}

export async function readRunState(runId = FIXTURE_RUN_ID): Promise<RunState> {
  if (runId === FIXTURE_RUN_ID) {
    const json = await readFile(FIXTURE_STATE_PATH, 'utf8');
    const state = JSON.parse(json) as Omit<RunState, 'lifecycle' | 'providerMode'>;
    return { ...state, lifecycle: 'fixture', providerMode: 'fake' };
  }

  try {
    return stateFromEvents(runId, await readEvents(runId));
  } catch (error) {
    if (isFileNotFound(error)) {
      return stateFromEvents(runId, []);
    }

    throw error;
  }
}

export function parseEventLines(text: string): PhaseEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PhaseEvent);
}

export async function readEvents(runId = FIXTURE_RUN_ID): Promise<PhaseEvent[]> {
  const eventsPath = eventsPathForRun(runId);

  if (!eventsPath) {
    throw new Error(`Unknown runId: ${runId}`);
  }

  const text = await readFile(eventsPath, 'utf8');
  return parseEventLines(text);
}

export async function readArtifact(name: ArtifactName, runId = FIXTURE_RUN_ID): Promise<string> {
  const artifactPath = await artifactPathForRun(runId, name);

  if (!artifactPath) {
    throw new Error(`Unknown runId: ${runId}`);
  }

  return readFile(artifactPath, 'utf8');
}

export async function writeApprovalRequest(input: {
  readonly phase: string;
  readonly decision: 'approve' | 'revise';
  readonly revisionNotes?: string;
}): Promise<string> {
  await mkdir(FIXTURE_REQUESTS_DIR, { recursive: true });

  const requestId = `req-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const requestPath = join(FIXTURE_REQUESTS_DIR, `${requestId}.json`);
  const body = {
    ts: new Date().toISOString(),
    phase: input.phase,
    decision: input.decision,
    revisionNotes: input.revisionNotes,
  };

  await writeFile(requestPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return requestId;
}

export function closeWatcher(watcher: FSWatcher | null): void {
  if (watcher) {
    watcher.close();
  }
}

export { watch };
