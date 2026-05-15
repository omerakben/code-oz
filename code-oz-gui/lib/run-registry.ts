import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SpawnHandle } from './code-oz-spawn';
import { findCodeOzRepoRoot } from './repo-root';
import type { ProviderMode, RunLifecycle } from './types';

export const PROJECT_ROOT = findCodeOzRepoRoot(import.meta.url);
export const FIXTURE_RUN_ID = 'r-2026-05-12-checkout-safari';
export const FIXTURE_RUN_DIR = join(PROJECT_ROOT, 'code-oz-gui', 'fixtures', 'sample-run');

export type RunRecord = {
  readonly runId: string;
  readonly repoPath: string;
  readonly runDir: string;
  readonly kind: 'fixture' | 'live';
  readonly handle: SpawnHandle | null;
  readonly lifecycle: RunLifecycle;
  readonly providerMode: ProviderMode;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
  readonly startedAt: string;
  readonly endedAt?: string;
};

const runRecords = new Map<string, RunRecord>();

export function registerRun(record: RunRecord): void {
  runRecords.set(record.runId, record);
}

export function getRunRecord(runId: string): RunRecord | null {
  const record = runRecords.get(runId);
  if (!record) return null;
  // v0.20.3 #6 — disk validation. A live run whose runDir was deleted
  // (e.g., `rm -rf .code-oz/state/`) should not surface as `running` in
  // the GUI sidebar. Transition the in-memory record to `stale` on read
  // so the server-side view matches disk and the run history stops
  // showing a ghost "IN PROGRESS" entry.
  if (record.lifecycle === 'running' && record.kind !== 'fixture' && !existsSync(record.runDir)) {
    const stale: RunRecord = {
      ...record,
      lifecycle: 'stale',
      endedAt: new Date().toISOString(),
    };
    runRecords.set(runId, stale);
    return stale;
  }
  return record;
}

export function markRunExited(runId: string, result: { readonly exitCode: number | null; readonly signal: string | null }): void {
  const record = getRunRecord(runId);

  if (!record || record.lifecycle === 'fixture' || record.lifecycle === 'aborted') {
    return;
  }

  runRecords.set(runId, {
    ...record,
    lifecycle: result.exitCode === 0 ? 'exited-ok' : 'exited-fail',
    exitCode: result.exitCode,
    exitSignal: result.signal,
    endedAt: new Date().toISOString(),
  });
}

export function markRunAborted(runId: string): void {
  const record = getRunRecord(runId);

  if (!record || record.lifecycle === 'fixture') {
    return;
  }

  runRecords.set(runId, {
    ...record,
    lifecycle: 'aborted',
    exitSignal: 'SIGTERM',
    endedAt: new Date().toISOString(),
  });
}

registerRun({
  runId: FIXTURE_RUN_ID,
  repoPath: FIXTURE_RUN_DIR,
  runDir: FIXTURE_RUN_DIR,
  kind: 'fixture',
  handle: null,
  lifecycle: 'fixture',
  providerMode: 'fake',
  startedAt: new Date().toISOString(),
});
