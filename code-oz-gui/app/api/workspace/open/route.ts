import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { validateWorkspacePath, workspaceSessions } from '@/lib/run-store';

export const runtime = 'nodejs';

const SESSION_COOKIE = 'code-oz-gui-session';

function parseBody(value: unknown): { path: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const path = (value as Record<string, unknown>).path;
  return typeof path === 'string' && path.trim().length > 0 ? { path } : null;
}

export async function POST(request: NextRequest) {
  const body = parseBody(await request.json().catch(() => null));

  if (!body) {
    return Response.json({ ok: false, error: 'Expected body { path }.' }, { status: 400 });
  }

  const session = await validateWorkspacePath(body.path);

  if (!session) {
    return Response.json({ ok: false, error: 'Workspace path is not available for the fixture API.' }, { status: 400 });
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value ?? randomUUID();
  workspaceSessions.set(sessionId, session);

  const response = NextResponse.json({
    ok: true,
    profile: session.profile,
    hasRuns: session.hasRuns,
  });

  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return response;
}
