import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { registerRun } from '@/lib/run-registry';
import { writeApprovalRequest } from '@/lib/run-store';

describe('run-store approval requests', () => {
  test('writes live run requests under the registered live run directory', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'code-oz-gui-live-run-'));
    const runId = 'r-2026-05-13-live-request';
    const runDir = join(tmp, '.code-oz', 'state', 'runs', runId);

    registerRun({
      runId,
      repoPath: tmp,
      runDir,
      kind: 'live',
      handle: null,
      lifecycle: 'running',
      providerMode: 'fake',
      startedAt: new Date().toISOString(),
    });

    const requestId = await writeApprovalRequest({
      runId,
      phase: 'audit',
      decision: 'revise',
      revisionNotes: 'tighten the risk summary',
    });

    const request = JSON.parse(
      await readFile(join(runDir, 'requests', `${requestId}.json`), 'utf8'),
    ) as {
      readonly runId: string;
      readonly phase: string;
      readonly decision: string;
      readonly revisionNotes: string;
    };

    expect(request.runId).toBe(runId);
    expect(request.phase).toBe('audit');
    expect(request.decision).toBe('revise');
    expect(request.revisionNotes).toBe('tighten the risk summary');
  });
});
