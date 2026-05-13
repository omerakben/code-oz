import { getRunRecord, markRunAborted } from '@/lib/run-registry';

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly runId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const record = getRunRecord(runId);

  if (!record) {
    return Response.json({ error: 'run-not-found' }, { status: 404 });
  }

  if (record.lifecycle !== 'running') {
    return Response.json({ error: 'not-running' }, { status: 409 });
  }

  if (!record.handle) {
    return Response.json({ error: 'cannot-abort-fixture' }, { status: 400 });
  }

  record.handle.abort();
  markRunAborted(runId);

  return Response.json({ ok: true, runId });
}
