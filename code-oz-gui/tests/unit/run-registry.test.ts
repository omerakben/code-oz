// v0.20.3 #6 — run-registry disk validation. When a live run's runDir is
// deleted from disk (e.g., `rm -rf .code-oz/state/`), getRunRecord should
// transition the in-memory record to `lifecycle: 'stale'` on read so the
// GUI sidebar stops showing a ghost "IN PROGRESS" entry. Caught from the
// v0.20.2 quizr greenfield-friend dogfood (2026-05-14).

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getRunRecord, registerRun, type RunRecord } from '@/lib/run-registry';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'code-oz-gui-run-registry-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function liveRunFixture(runId: string, runDir: string): RunRecord {
  return {
    runId,
    repoPath: tmp,
    runDir,
    kind: 'live',
    handle: null,
    lifecycle: 'running',
    providerMode: 'real',
    startedAt: new Date().toISOString(),
  };
}

describe('getRunRecord — disk validation', () => {
  test('returns the live record unchanged while runDir exists on disk', async () => {
    const runId = 'r-test-disk-validation-keep';
    const runDir = join(tmp, runId);
    await mkdir(runDir, { recursive: true });

    registerRun(liveRunFixture(runId, runDir));

    const record = getRunRecord(runId);
    expect(record).not.toBeNull();
    if (!record) return;
    expect(record.lifecycle).toBe('running');
    expect(record.kind).toBe('live');
    expect(record.runDir).toBe(runDir);
  });

  test('transitions a running live record to stale when runDir is missing on disk', async () => {
    const runId = 'r-test-disk-validation-stale';
    const runDir = join(tmp, runId);
    // Do NOT create the runDir — simulate `rm -rf .code-oz/state/`.

    registerRun(liveRunFixture(runId, runDir));

    const record = getRunRecord(runId);
    expect(record).not.toBeNull();
    if (!record) return;
    expect(record.lifecycle).toBe('stale');
    expect(record.endedAt).toBeDefined();

    // Idempotent on re-read: stays stale (transitions only happen from
    // 'running', so a follow-up read does not re-stamp endedAt).
    const reread = getRunRecord(runId);
    expect(reread?.lifecycle).toBe('stale');
    expect(reread?.endedAt).toBe(record.endedAt);
  });

  test('does NOT transition fixture records to stale even when runDir is missing', async () => {
    // Fixture runs are server-process state, not on-disk runs; their
    // runDir reference may or may not exist on disk depending on how the
    // server was started. Either way, fixtures must stay healthy.
    const runId = 'r-test-disk-validation-fixture';
    const runDir = join(tmp, 'never-exists');
    registerRun({
      runId,
      repoPath: tmp,
      runDir,
      kind: 'fixture',
      handle: null,
      lifecycle: 'fixture',
      providerMode: 'fake',
      startedAt: new Date().toISOString(),
    });

    const record = getRunRecord(runId);
    expect(record?.lifecycle).toBe('fixture');
  });

  test('returns null for unknown runId', () => {
    expect(getRunRecord('r-test-no-such-run')).toBeNull();
  });
});
