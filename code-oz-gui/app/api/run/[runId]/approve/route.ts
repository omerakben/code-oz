import { assertFixtureRunId, writeApprovalRequest } from '@/lib/run-store';

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly runId: string }>;
};

const VALID_ACTIONS = new Set(['approve', 'revise', 'answer-question', 'skip-question']);

type ApprovalAction = 'approve' | 'revise' | 'answer-question' | 'skip-question';

function parseBody(
  runId: string,
  value: unknown,
):
  | {
      readonly runId: string;
      readonly phase: string;
      readonly taskId?: string;
      readonly action: 'approve' | 'revise';
      readonly feedback?: string;
    }
  | {
      readonly runId: string;
      readonly phase: string;
      readonly action: 'answer-question';
      readonly questionId: string;
      readonly answer: string;
    }
  | {
      readonly runId: string;
      readonly phase: string;
      readonly action: 'skip-question';
      readonly questionId: string;
    }
  | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const bodyRunId = body.runId;
  const phase = body.phase;
  const action = body.action;
  const taskId = body.taskId;

  if (
    typeof bodyRunId !== 'string'
    || bodyRunId !== runId
    || typeof phase !== 'string'
    || typeof action !== 'string'
    || !VALID_ACTIONS.has(action)
  ) {
    return null;
  }

  if (taskId !== undefined && typeof taskId !== 'string') {
    return null;
  }

  const typedAction = action as ApprovalAction;

  if (typedAction === 'approve' || typedAction === 'revise') {
    const feedback = body.feedback;

    if (feedback !== undefined && typeof feedback !== 'string') {
      return null;
    }

    return { runId: bodyRunId, phase, taskId, action: typedAction, feedback };
  }

  const questionId = body.questionId;

  if (typeof questionId !== 'string') {
    return null;
  }

  if (typedAction === 'answer-question') {
    const answer = body.answer;

    if (typeof answer !== 'string') {
      return null;
    }

    return { runId: bodyRunId, phase, action: typedAction, questionId, answer };
  }

  return { runId: bodyRunId, phase, action: typedAction, questionId };
}

export async function POST(request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runIdError = assertFixtureRunId(runId);

  if (runIdError) {
    return runIdError;
  }

  const body = parseBody(runId, await request.json().catch(() => null));

  if (!body) {
    return Response.json(
      { ok: false, error: 'Expected body { runId, phase, taskId?, action, feedback?, questionId?, answer? }.' },
      { status: 400 },
    );
  }

  if (body.action === 'answer-question' || body.action === 'skip-question') {
    console.log('Question action received', body);
    return Response.json({ ok: true });
  }

  const requestId = await writeApprovalRequest({
    phase: body.phase,
    decision: body.action,
    revisionNotes: body.feedback,
  });

  return Response.json({ ok: true, requestId });
}
