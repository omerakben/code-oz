import {
  assertFixtureRunId,
  artifactPathForRun,
  isArtifactName,
  readArtifact,
  readEvents,
  readRunState,
} from '@/lib/run-store';
import { askGemini } from '@/lib/gemini-server';
import type { PhaseEvent } from '@/lib/event-types';
import type { RunCard } from '@/lib/types';

export const runtime = 'nodejs';

type HelperTab = 'artifact' | 'events' | 'decisions';

type RouteBody = {
  readonly runId: string;
  readonly cardId: string;
  readonly currentTab: HelperTab;
  readonly prompt: string;
};

const SYSTEM_INSTRUCTION =
  [
    'You explain code-oz runs to non-developers who still need accurate approval decisions.',
    'Use plain, direct language. Avoid corporate phrasing like "approving signifies", "facilitates", "alignment", or "stakeholders".',
    'Never invent file paths or line numbers. Cite only paths and line numbers that appear in the provided context.',
    'For GUI run state, events/current/gates live under .code-oz/state/runs/<runId>/; artifact paths may differ.',
    'Cite the exact provided Source path, not a guessed .code-oz/artifacts/... path.',
    'When explaining approval, say what the next code-oz phase will do and what risk remains.',
    'Answer in 4 short sentences or fewer unless asked for detail.',
  ].join(' ');

const DECISION_EVENT_TYPES = new Set([
  'gate_required',
  'gate_written',
  'intervention',
  'review_round_completed',
  'question_added',
  'budget_warning',
  'debate_resolved',
]);

function parseBody(value: unknown): RouteBody | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const currentTab = body.currentTab;

  if (
    typeof body.runId !== 'string'
    || typeof body.cardId !== 'string'
    || typeof body.prompt !== 'string'
    || body.prompt.trim().length === 0
    || (currentTab !== 'artifact' && currentTab !== 'events' && currentTab !== 'decisions')
  ) {
    return null;
  }

  return {
    runId: body.runId,
    cardId: body.cardId,
    currentTab,
    prompt: body.prompt.trim(),
  };
}

function eventRecord(event: PhaseEvent): PhaseEvent & Record<string, unknown> {
  return event as PhaseEvent & Record<string, unknown>;
}

function stringField(event: PhaseEvent, field: string): string | null {
  const value = eventRecord(event)[field];
  return typeof value === 'string' ? value : null;
}

function taskIdForEvent(event: PhaseEvent): string | null {
  return stringField(event, 'taskId') ?? stringField(event, 'parentTaskId');
}

function eventMatchesCardPhaseOrTask(event: PhaseEvent, card: RunCard): boolean {
  const phase = stringField(event, 'phase');
  const taskId = taskIdForEvent(event);

  return phase === card.phase || (card.kind === 'task' && taskId === card.id);
}

function artifactNameForCard(card: RunCard): string {
  return card.artifactPath.split('#')[0] || card.artifactPath;
}

function lineNumbered(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

async function artifactContext(runId: string, card: RunCard): Promise<string> {
  const artifactName = artifactNameForCard(card);

  if (!isArtifactName(artifactName)) {
    return `Artifact unavailable for ${card.id}.`;
  }

  const artifact = await readArtifact(artifactName, runId);
  const sourcePath = await artifactPathForRun(runId, artifactName);
  return [
    `Artifact ${artifactName} for card ${card.id}.`,
    `Source path: ${sourcePath ?? artifactName}`,
    'Artifact content (line-numbered):',
    lineNumbered(artifact),
  ].join('\n');
}

function eventsContext(events: readonly PhaseEvent[]): string {
  const lines = events.slice(-30).map((event) => JSON.stringify(event));
  return `Last ${lines.length} events:\n${lines.join('\n')}`;
}

function decisionsContext(events: readonly PhaseEvent[], card: RunCard): string {
  const lines = events
    .filter((event) => DECISION_EVENT_TYPES.has(event.type) && eventMatchesCardPhaseOrTask(event, card))
    .map((event) => JSON.stringify(event));

  return `Decision-relevant events for card ${card.id} (${card.phase}):\n${lines.length > 0 ? lines.join('\n') : 'None.'}`;
}

async function contextFor(input: {
  readonly runId: string;
  readonly currentTab: HelperTab;
  readonly card: RunCard;
  readonly events: readonly PhaseEvent[];
}): Promise<string> {
  if (input.currentTab === 'artifact') {
    return artifactContext(input.runId, input.card);
  }

  if (input.currentTab === 'events') {
    return eventsContext(input.events);
  }

  return decisionsContext(input.events, input.card);
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message === 'GEMINI_API_KEY is not set.') {
    return 'Set GEMINI_API_KEY to enable the Gemini helper.';
  }

  return 'The helper is unavailable right now.';
}

function isExpectedConfigAbsence(error: unknown): boolean {
  return error instanceof Error && error.message === 'GEMINI_API_KEY is not set.';
}

export async function POST(request: Request) {
  const body = parseBody(await request.json().catch(() => null));

  if (!body) {
    return Response.json(
      { error: 'invalid-request', detail: 'Expected body { runId, cardId, currentTab, prompt }.' },
      { status: 400 },
    );
  }

  const runIdError = assertFixtureRunId(body.runId);

  if (runIdError) {
    return runIdError;
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: 'helper-unavailable', detail: 'Set GEMINI_API_KEY to enable the Gemini helper.' },
      { status: 503 },
    );
  }

  try {
    const [runState, events] = await Promise.all([readRunState(body.runId), readEvents(body.runId)]);
    const card = runState.cards.find((candidate) => candidate.id === body.cardId);

    if (!card) {
      return Response.json({ error: 'card-not-found', detail: `Unknown cardId: ${body.cardId}` }, { status: 404 });
    }

    const relevantContext = await contextFor({ runId: body.runId, currentTab: body.currentTab, card, events });
    const userPrompt = `Context for this run:
Profile: ${runState.profile}
Current phase: ${runState.currentPhase}
Selected card: ${card.id} (${card.kind}, phase ${card.phase})
${relevantContext}

User question (from the GUI): ${body.prompt}`;

    const answer = await askGemini({
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt,
    });

    return Response.json({ answer });
  } catch (error) {
    if (!isExpectedConfigAbsence(error)) {
      console.error('AI helper request failed', error);
    }
    return Response.json(
      { error: 'helper-unavailable', detail: safeErrorDetail(error) },
      { status: 503 },
    );
  }
}
