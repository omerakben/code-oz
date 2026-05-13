import { assertFixtureRunId, isArtifactName, readArtifact } from '@/lib/run-store';

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly runId: string; readonly name: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { runId, name } = await context.params;
  const runIdError = assertFixtureRunId(runId);

  if (runIdError) {
    return runIdError;
  }

  if (!isArtifactName(name)) {
    return Response.json({ ok: false, error: `Unsupported artifact: ${name}` }, { status: 400 });
  }

  try {
    return new Response(await readArtifact(name, runId), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return Response.json({ ok: false, error: `Artifact not written yet: ${name}` }, { status: 404 });
    }

    throw error;
  }
}
