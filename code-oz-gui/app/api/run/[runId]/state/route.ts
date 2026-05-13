import { assertFixtureRunId, readRunState } from '@/lib/run-store';

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly runId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runIdError = assertFixtureRunId(runId);

  if (runIdError) {
    return runIdError;
  }

  return Response.json(await readRunState(runId));
}
