import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { describe, expect, test } from 'bun:test';
import {
  resolveCodeOzBinary,
  spawnCodeOzRun,
  type CodeOzBinaryResolution,
  type SpawnSubprocessFn,
  type Subprocess,
} from '@/lib/code-oz-spawn';
import { findCodeOzRepoRoot } from '@/lib/repo-root';

const execFileAsync = promisify(execFile);
const repoRoot = findCodeOzRepoRoot(import.meta.url);

async function rootVersion(): Promise<string> {
  const parsed = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { readonly version: string };
  return parsed.version;
}

describe('code-oz CLI resolution', () => {
  test('does not launch a stale checkout dist binary', async () => {
    const resolution = await resolveCodeOzBinary();

    if (resolution.kind === 'binary') {
      const { stdout } = await execFileAsync(resolution.command, [...resolution.args, '--version']);
      expect(stdout.toString().trim()).toBe(await rootVersion());
      return;
    }

    expect(resolution.command).toBe('bun');
    expect(resolution.args).toEqual(['--cwd', repoRoot, 'run', 'src/cli.ts']);
  });
});

function makeFakeSubprocess(opts: {
  readonly exitCode: number;
  readonly stderrChunks?: readonly string[];
  readonly stdoutChunks?: readonly string[];
}): Subprocess {
  const toBuffers = (chunks: readonly string[]): Buffer[] => chunks.map((s) => Buffer.from(s, 'utf8'));
  return {
    pid: 999_999,
    stdout: Readable.from(toBuffers(opts.stdoutChunks ?? [])),
    stderr: Readable.from(toBuffers(opts.stderrChunks ?? [])),
    exited: Promise.resolve(opts.exitCode),
    kill: () => {},
  };
}

async function makeRepoFixture(slug: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `code-oz-spawn-${slug}-`));
  await mkdir(join(repo, '.code-oz'), { recursive: true });
  return repo;
}

const fakeResolution: CodeOzBinaryResolution = {
  kind: 'binary',
  command: '/usr/bin/true',
  args: [],
};

async function raceWithBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T | 'timeout-budget-exceeded'> {
  return Promise.race([
    promise,
    new Promise<'timeout-budget-exceeded'>((resolve) => setTimeout(() => resolve('timeout-budget-exceeded'), budgetMs)),
  ]);
}

describe('spawnCodeOzRun exit-before-runId rejection', () => {
  test('rejects fast when subprocess exits 0 before a runId is detected', async () => {
    const repo = await makeRepoFixture('exit0');
    const fakeSpawn: SpawnSubprocessFn = () => makeFakeSubprocess({ exitCode: 0 });

    const spawnPromise = spawnCodeOzRun(
      { repoPath: repo, description: 'exit0 silent' },
      {
        spawn: fakeSpawn,
        resolveBinary: async () => fakeResolution,
        supportsRunIdFlag: async () => false,
      },
    );

    const settled = await raceWithBudget(
      spawnPromise.then(
        () => ({ kind: 'resolved' as const }),
        (err: unknown) => ({ kind: 'rejected' as const, err: err as Error }),
      ),
      2_000,
    );

    expect(settled).not.toBe('timeout-budget-exceeded');
    if (settled === 'timeout-budget-exceeded') return;
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.err.message).toMatch(/exit 0/);
  });

  test('error surfaces captured stderr content when subprocess exits 0 with a diagnostic', async () => {
    const repo = await makeRepoFixture('stderr');
    const stderrChunks = ['error: budget exhausted before any phase ran\n'];
    const fakeSpawn: SpawnSubprocessFn = () => makeFakeSubprocess({ exitCode: 0, stderrChunks });

    const spawnPromise = spawnCodeOzRun(
      { repoPath: repo, description: 'exit0 with stderr' },
      {
        spawn: fakeSpawn,
        resolveBinary: async () => fakeResolution,
        supportsRunIdFlag: async () => false,
      },
    );

    const settled = await raceWithBudget(
      spawnPromise.then(
        () => ({ kind: 'resolved' as const }),
        (err: unknown) => ({ kind: 'rejected' as const, err: err as Error }),
      ),
      2_000,
    );

    expect(settled).not.toBe('timeout-budget-exceeded');
    if (settled === 'timeout-budget-exceeded') return;
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.err.message).toContain('budget exhausted before any phase ran');
    expect(settled.err.message).toMatch(/exit 0/);
  });

  test('error names exit code for non-zero crash without a runId', async () => {
    const repo = await makeRepoFixture('exit137');
    const stderrChunks = ['killed: OOM at 1.2GB\n'];
    const fakeSpawn: SpawnSubprocessFn = () => makeFakeSubprocess({ exitCode: 137, stderrChunks });

    const spawnPromise = spawnCodeOzRun(
      { repoPath: repo, description: 'crash test' },
      {
        spawn: fakeSpawn,
        resolveBinary: async () => fakeResolution,
        supportsRunIdFlag: async () => false,
      },
    );

    const settled = await raceWithBudget(
      spawnPromise.then(
        () => ({ kind: 'resolved' as const }),
        (err: unknown) => ({ kind: 'rejected' as const, err: err as Error }),
      ),
      2_000,
    );

    expect(settled).not.toBe('timeout-budget-exceeded');
    if (settled === 'timeout-budget-exceeded') return;
    expect(settled.kind).toBe('rejected');
    if (settled.kind !== 'rejected') return;
    expect(settled.err.message).toMatch(/exit 137/);
    expect(settled.err.message).toContain('killed: OOM');
  });
});
