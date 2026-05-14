import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveCodeOzBinary, resolveRunIdTimeoutMs } from '@/lib/code-oz-spawn';
import { findCodeOzRepoRoot } from '@/lib/repo-root';

const execFileAsync = promisify(execFile);
const repoRoot = findCodeOzRepoRoot(import.meta.url);

async function rootVersion(): Promise<string> {
  const parsed = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { readonly version: string };
  return parsed.version;
}

describe('resolveRunIdTimeoutMs', () => {
  const envKey = 'CODE_OZ_GUI_SPAWN_TIMEOUT_MS';
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalEnv;
    }
  });

  test('returns 60_000 default when no override and no env var', () => {
    expect(resolveRunIdTimeoutMs()).toBe(60_000);
  });

  test('per-call override wins over env var', () => {
    process.env[envKey] = '15000';
    expect(resolveRunIdTimeoutMs(5000)).toBe(5000);
  });

  test('env var wins over default when no per-call override', () => {
    process.env[envKey] = '90000';
    expect(resolveRunIdTimeoutMs()).toBe(90_000);
  });

  test('ignores non-numeric env var and falls back to default', () => {
    process.env[envKey] = 'forever';
    expect(resolveRunIdTimeoutMs()).toBe(60_000);
  });

  test('ignores non-positive per-call override and falls back to env or default', () => {
    expect(resolveRunIdTimeoutMs(0)).toBe(60_000);
    expect(resolveRunIdTimeoutMs(-1)).toBe(60_000);
    expect(resolveRunIdTimeoutMs(Number.NaN)).toBe(60_000);
  });

  test('floors fractional per-call overrides', () => {
    expect(resolveRunIdTimeoutMs(1234.7)).toBe(1234);
  });

  test('clamps sub-1ms positive overrides to 1ms instead of flooring to 0', () => {
    expect(resolveRunIdTimeoutMs(0.5)).toBe(1);
    expect(resolveRunIdTimeoutMs(0.999)).toBe(1);
  });

  test('uses env var when override is invalid (0, NaN, negative)', () => {
    process.env[envKey] = '12345';
    expect(resolveRunIdTimeoutMs(0)).toBe(12345);
    expect(resolveRunIdTimeoutMs(-1)).toBe(12345);
    expect(resolveRunIdTimeoutMs(Number.NaN)).toBe(12345);
  });
});

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
