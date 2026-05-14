import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'bun:test';
import { resolveCodeOzBinary } from '@/lib/code-oz-spawn';
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
