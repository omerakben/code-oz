import { runCodeOzApprove } from '@/lib/code-oz-spawn';
import { getRunRecord } from '@/lib/run-registry';
import { writeApprovalRequest } from '@/lib/run-store';

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
  const record = getRunRecord(runId);

  if (!record) {
    return Response.json({ ok: false, error: `Unknown runId: ${runId}` }, { status: 404 });
  }

  const body = parseBody(runId, await request.json().catch(() => null));

  if (!body) {
    return Response.json(
      { ok: false, error: 'Expected body { runId, phase, taskId?, action, feedback?, questionId?, answer? }.' },
      { status: 400 },
    );
  }

  if (body.action === 'answer-question' || body.action === 'skip-question') {
    return Response.json({ ok: true });
  }

  if (record.kind === 'fixture') {
    return Response.json(
      {
        ok: false,
        error: 'fixture-run-read-only',
        detail: 'Fixture runs are read-only. Start or resume a live run, then approve or revise that run.',
      },
      { status: 409 },
    );
  }

  if (record.kind === 'live' && body.action === 'approve') {
    try {
      const result = await runCodeOzApprove({
        repoPath: record.repoPath,
        phase: body.phase,
        notes: body.feedback,
      });
      return Response.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
    } catch (error) {
      return Response.json(
        { ok: false, error: 'approve-failed', detail: error instanceof Error ? error.message : String(error) },
        { status: 503 },
      );
    }
  }

  const requestId = await writeApprovalRequest({
    runId: body.runId,
    phase: body.phase,
    decision: body.action,
    revisionNotes: body.feedback,
  });

  return Response.json({ ok: true, requestId });
}
