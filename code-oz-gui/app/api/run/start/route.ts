import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { FIXTURE_RUN_ID } from '@/lib/run-store';
import { EFFORT_LEVELS, spawnCodeOzRun, type EffortLevel } from '@/lib/code-oz-spawn';
import { markRunExited, registerRun } from '@/lib/run-registry';

export const runtime = 'nodejs';
const FIXTURE_REPO_PATH = './fixtures/sample-run';

interface ParsedRunStartBody {
  readonly description: string;
  readonly repoPath: string;
  readonly providerOverride?: 'fake' | null;
  readonly effortOverride?: EffortLevel;
}

function parseBody(value: unknown): ParsedRunStartBody | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const description = body.description;
  const repoPath = body.repoPath;
  const providerOverride = body.providerOverride;
  const effortOverride = body.effortOverride;

  if (typeof description !== 'string' || typeof repoPath !== 'string') {
    return null;
  }

  if (providerOverride !== undefined && providerOverride !== null && providerOverride !== 'fake') {
    return null;
  }

  let effortValue: EffortLevel | undefined;
  if (effortOverride !== undefined && effortOverride !== null) {
    if (typeof effortOverride !== 'string' || !(EFFORT_LEVELS as readonly string[]).includes(effortOverride)) {
      return null;
    }
    effortValue = effortOverride as EffortLevel;
  }

  if (description.trim().length === 0 || repoPath.trim().length === 0) {
    return null;
  }

  return {
    description,
    repoPath,
    providerOverride,
    ...(effortValue !== undefined ? { effortOverride: effortValue } : {}),
  };
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return 'Unable to start code-oz.';
}

function isWithinProjectRoot(path: string): boolean {
  const projectRoot = resolve(process.cwd());
  const pathRelativeToRoot = relative(projectRoot, path);
  return pathRelativeToRoot === '' || (!pathRelativeToRoot.startsWith('..') && !isAbsolute(pathRelativeToRoot));
}

async function resolveLiveRepoPath(repoPath: string): Promise<string | null> {
  const resolvedRepoPath = isAbsolute(repoPath) ? resolve(repoPath) : resolve(process.cwd(), repoPath);

  if (!isAbsolute(repoPath) && !isWithinProjectRoot(resolvedRepoPath)) {
    return null;
  }

  try {
    const repoStat = await stat(resolvedRepoPath);
    return repoStat.isDirectory() ? resolvedRepoPath : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = parseBody(await request.json().catch(() => null));

  if (!body) {
    return Response.json({ ok: false, error: 'Expected body { description, repoPath }.' }, { status: 400 });
  }

  if (body.repoPath === FIXTURE_REPO_PATH) {
    return Response.json({ runId: FIXTURE_RUN_ID });
  }

  const repoPath = await resolveLiveRepoPath(body.repoPath);

  if (!repoPath) {
    return Response.json({ error: 'invalid-repo-path', detail: 'repoPath must resolve to an existing directory.' }, { status: 400 });
  }

  try {
    const providerMode = body.providerOverride === 'fake' ? 'fake' : 'real';
    const handle = await spawnCodeOzRun({
      description: body.description,
      repoPath,
      providerOverride: body.providerOverride,
      ...(body.effortOverride !== undefined ? { effortOverride: body.effortOverride } : {}),
    });
    registerRun({
      runId: handle.runId,
      repoPath,
      runDir: handle.runDir,
      kind: 'live',
      handle,
      lifecycle: 'running',
      providerMode,
      startedAt: new Date().toISOString(),
    });
    void handle.waitForExit().then(({ exitCode, signal }) => markRunExited(handle.runId, { exitCode, signal }));
    return Response.json({ runId: handle.runId, runDir: handle.runDir, kind: 'live' });
  } catch (error) {
    console.error('code-oz spawn failed', error);
    return Response.json({ error: 'spawn-failed', detail: safeErrorDetail(error) }, { status: 503 });
  }
}
