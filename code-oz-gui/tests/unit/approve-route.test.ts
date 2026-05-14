import { describe, expect, test } from 'bun:test';
import { POST } from '@/app/api/run/[runId]/approve/route';
import { FIXTURE_RUN_ID } from '@/lib/run-registry';

function approveRequest(action: 'approve' | 'revise'): Request {
  return new Request(`http://localhost/api/run/${FIXTURE_RUN_ID}/approve`, {
    method: 'POST',
    body: JSON.stringify({
      runId: FIXTURE_RUN_ID,
      phase: 'audit',
      action,
      feedback: 'tighten the risk summary',
    }),
  });
}

describe('/api/run/[runId]/approve', () => {
  test.each(['approve', 'revise'] as const)('refuses fixture-mode %s requests', async (action) => {
    const response = await POST(approveRequest(action), {
      params: Promise.resolve({ runId: FIXTURE_RUN_ID }),
    });
    const body = await response.json() as { readonly error?: string; readonly detail?: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe('fixture-run-read-only');
    expect(body.detail).toContain('Start or resume a live run');
  });
});
