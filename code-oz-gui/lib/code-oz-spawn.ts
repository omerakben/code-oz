import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn as childSpawn, type ChildProcessByStdio } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { findCodeOzRepoRoot } from './repo-root';

type ReadableChunk = Uint8Array | string;
export type Subprocess = {
  readonly pid: number;
  readonly stdout: AsyncIterable<ReadableChunk>;
  readonly stderr: AsyncIterable<ReadableChunk>;
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};

export type SpawnSubprocessFn = (input: {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}) => Subprocess;

export type SpawnDependencies = {
  readonly spawn?: SpawnSubprocessFn;
  readonly resolveBinary?: () => Promise<CodeOzBinaryResolution>;
  readonly supportsRunIdFlag?: (resolution: CodeOzBinaryResolution) => Promise<boolean>;
};

function wrapChild(child: ChildProcessByStdio<null, Readable, Readable>): Subprocess {
  return {
    pid: child.pid ?? -1,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise<number>((resolveExited) => {
      child.on('exit', (code) => resolveExited(code ?? -1));
    }),
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

function spawnSubprocess(input: {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Subprocess {
  const [command, ...args] = input.cmd;

  if (!command) {
    throw new Error('subprocess command must be non-empty.');
  }

  return wrapChild(childSpawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

export type CodeOzBinaryResolution = {
  readonly kind: 'binary' | 'bun-dev';
  readonly command: string;
  readonly args: string[];
};

export { EFFORT_LEVELS, type EffortLevel } from './code-oz-effort';
import type { EffortLevel } from './code-oz-effort';

export type SpawnInput = {
  readonly repoPath: string;
  readonly description: string;
  readonly providerOverride?: 'fake' | null;
  /**
   * Maximum wait, in milliseconds, for the spawned `code-oz run` to publish a
   * runId via stdout, `active.json`, or the runs directory. Default 60_000.
   * Overridable per-call here, or globally via the `CODE_OZ_GUI_SPAWN_TIMEOUT_MS`
   * environment variable. Raised above the legacy 30s because `bun --cwd ...
   * run src/cli.ts` cold-start can exceed 30s on first invocation.
   */
  readonly runIdTimeoutMs?: number;
  /**
   * Effort envelope passed through as `--effort <value>` to the CLI. Maps to
   * code-oz's rule 23 effort flag which scales `budgets.global` caps but
   * never assurance. Omit (or pass `undefined`) to inherit the CLI's
   * default. The CLI rejects unknown values; the GUI restricts the type
   * at compile time. v0.20.2 finding #5.
   */
  readonly effortOverride?: EffortLevel;
};

export type ApprovalInput = {
  readonly repoPath: string;
  readonly phase: string;
  readonly notes?: string;
};

export type SpawnHandle = {
  readonly runId: string;
  readonly runDir: string;
  readonly pid: number;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly abort: () => void;
  readonly waitForExit: () => Promise<{ exitCode: number | null; signal: string | null }>;
};

const execFileAsync = promisify(execFile);
const HOME_CODE_OZ_SOURCE_DIR = join(homedir(), 'Projects', 'code-oz');
const CODE_OZ_REPO_ROOT = findCodeOzRepoRoot(import.meta.url);
const RUN_ID_STDOUT_REGEX = /\b(run started: )?((?:r-\d{4}-\d{2}-\d{2}-[a-z0-9-]+)|(?:[0-9A-HJKMNP-TV-Z]{26}))\b/i;
const STDOUT_RUN_ID_CAPTURE_LIMIT = 16 * 1024;
const POLL_INTERVAL_MS = 100;
const FALLBACK_RUN_ID_TIMEOUT_MS = 60_000;
const ENV_TIMEOUT_OVERRIDE = 'CODE_OZ_GUI_SPAWN_TIMEOUT_MS';
const activeJsonBaselines = new Map<string, number | null>();

export function resolveRunIdTimeoutMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.floor(override));
  }
  const envRaw = process.env[ENV_TIMEOUT_OVERRIDE];
  if (envRaw !== undefined && /^\d+$/.test(envRaw.trim())) {
    const parsed = Number.parseInt(envRaw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return FALLBACK_RUN_ID_TIMEOUT_MS;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function bunWhich(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [command]);
    const firstLine = stdout.toString().trim().split(/\r?\n/)[0];
    return firstLine && firstLine.length > 0 ? firstLine : null;
  } catch {
    return null;
  }
}

async function readSourceVersion(sourceDir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8')) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };

    if (parsed.name !== '@tuel/code-oz' || typeof parsed.version !== 'string' || parsed.version.length === 0) {
      return null;
    }

    return parsed.version;
  } catch {
    return null;
  }
}

async function sourceCliExists(sourceDir: string): Promise<boolean> {
  return pathExists(join(sourceDir, 'src', 'cli.ts'));
}

async function binaryMatchesSourceVersion(binaryPath: string, expectedVersion: string | null): Promise<boolean> {
  if (!expectedVersion) {
    return true;
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 5_000 });
    return stdout.toString().trim() === expectedVersion;
  } catch {
    return false;
  }
}

export async function resolveCodeOzBinary(): Promise<CodeOzBinaryResolution> {
  const sourceDirs = [
    CODE_OZ_REPO_ROOT,
    HOME_CODE_OZ_SOURCE_DIR,
  ].filter((dir, index, dirs) => dirs.indexOf(dir) === index);
  const sourceDir = (await Promise.all(sourceDirs.map(async (dir) => (
    await sourceCliExists(dir) ? dir : null
  )))).find((dir): dir is string => dir !== null) ?? null;
  const expectedVersion = sourceDir ? await readSourceVersion(sourceDir) : null;

  if (sourceDir) {
    const sourceDistBinary = join(sourceDir, 'dist', 'code-oz');

    if (
      await pathExists(sourceDistBinary)
      && await binaryMatchesSourceVersion(sourceDistBinary, expectedVersion)
    ) {
      return { kind: 'binary', command: sourceDistBinary, args: [] };
    }
  }

  const pathBinary = await bunWhich('code-oz');

  if (pathBinary && await binaryMatchesSourceVersion(pathBinary, expectedVersion)) {
    return { kind: 'binary', command: pathBinary, args: [] };
  }

  if (sourceDir) {
    return {
      kind: 'bun-dev',
      command: 'bun',
      args: ['--cwd', sourceDir, 'run', 'src/cli.ts'],
    };
  }

  throw new Error('code-oz CLI not found. Install via npm i -g @tuel/code-oz or clone ~/Projects/code-oz.');
}

function slugifyDescription(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

  return slug.length > 0 ? slug : 'run';
}

function preGenerateGuiRunId(description: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `r-${date}-${slugifyDescription(description)}`;
}

async function cliSupportsRunIdFlag(resolution: CodeOzBinaryResolution): Promise<boolean> {
  const sourceRunCommand = join(CODE_OZ_REPO_ROOT, 'src', 'commands', 'run.ts');

  if (await pathExists(sourceRunCommand)) {
    const source = await readFile(sourceRunCommand, 'utf8');
    return source.includes('--run-id');
  }

  const help = spawnSubprocess({ cmd: [resolution.command, ...resolution.args, 'run', '--help'] });
  const stdout = await streamToString(help.stdout, STDOUT_RUN_ID_CAPTURE_LIMIT);
  await help.exited.catch(() => 1);
  return stdout.includes('--run-id');
}

async function streamToString(stream: AsyncIterable<ReadableChunk>, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of stream) {
    if (size < limit) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      const next = buffer.slice(0, Math.max(0, limit - size));
      chunks.push(next);
      size += next.byteLength;
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

function runDirFor(repoPath: string, runId: string): string {
  return join(repoPath, '.code-oz', 'state', 'runs', runId);
}

function activeJsonPath(repoPath: string): string {
  return join(repoPath, '.code-oz', 'state', 'active.json');
}

function runsDirFor(repoPath: string): string {
  return join(repoPath, '.code-oz', 'state', 'runs');
}

async function activeJsonMtime(repoPath: string): Promise<number | null> {
  try {
    return (await stat(activeJsonPath(repoPath))).mtimeMs;
  } catch {
    return null;
  }
}

async function recordActiveJsonBaseline(repoPath: string): Promise<void> {
  activeJsonBaselines.set(repoPath, await activeJsonMtime(repoPath));
}

async function readActiveRunId(repoPath: string): Promise<string | null> {
  try {
    const raw = await readFile(activeJsonPath(repoPath), 'utf8');
    const parsed = JSON.parse(raw) as { readonly runId?: unknown };
    return typeof parsed.runId === 'string' && parsed.runId.length > 0 ? parsed.runId : null;
  } catch {
    return null;
  }
}

function createRunIdDeferred(): {
  readonly promise: Promise<string>;
  readonly resolve: (runId: string) => void;
  readonly reject: (error: Error) => void;
  readonly settled: () => boolean;
} {
  let resolveRunId!: (runId: string) => void;
  let rejectRunId!: (error: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveRunId = resolvePromise;
    rejectRunId = rejectPromise;
  });
  let isSettled = false;

  return {
    promise,
    resolve: (runId) => {
      if (isSettled) return;
      isSettled = true;
      resolveRunId(runId);
    },
    reject: (error) => {
      if (isSettled) return;
      isSettled = true;
      rejectRunId(error);
    },
    settled: () => isSettled,
  };
}

function parseRunIdFromStdout(stdout: string): string | null {
  return RUN_ID_STDOUT_REGEX.exec(stdout)?.[2] ?? null;
}

async function pollActiveRunId(
  repoPath: string,
  previousRunId: string | null,
  resolveRunId: (runId: string) => void,
  timeoutMs: number,
): Promise<void> {
  const baselineMtime = activeJsonBaselines.get(repoPath) ?? null;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentMtime = await activeJsonMtime(repoPath);
    const activeJsonUpdated = currentMtime !== null && (baselineMtime === null || currentMtime > baselineMtime);

    if (activeJsonUpdated) {
      const active = await readActiveRunId(repoPath);

      if (active) {
        resolveRunId(active);
        activeJsonBaselines.delete(repoPath);
        return;
      }
    }

    const newestRunId = await newestRunIdWithEvents(repoPath);

    if (newestRunId && (previousRunId === null || newestRunId !== previousRunId || activeJsonUpdated)) {
      const active = await readActiveRunId(repoPath);
      const resolvedRunId = active && (previousRunId === null || active !== previousRunId || activeJsonUpdated) ? active : newestRunId;
      resolveRunId(resolvedRunId);
      activeJsonBaselines.delete(repoPath);
      return;
    }

    await new Promise((resolveAttempt) => setTimeout(resolveAttempt, POLL_INTERVAL_MS));
  }

  activeJsonBaselines.delete(repoPath);
  throw new Error(`code-oz spawn timeout: active.json never updated after ${Math.round(timeoutMs / 1000)}s`);
}

async function newestRunIdWithEvents(repoPath: string): Promise<string | null> {
  try {
    const entries = await readdir(runsDirFor(repoPath), { withFileTypes: true });
    let newest: { readonly runId: string; readonly mtimeMs: number } | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const runDir = join(runsDirFor(repoPath), entry.name);

      try {
        await access(join(runDir, 'events.jsonl'), constants.F_OK);
        const runDirStat = await stat(runDir);

        if (!newest || runDirStat.mtimeMs > newest.mtimeMs) {
          newest = { runId: entry.name, mtimeMs: runDirStat.mtimeMs };
        }
      } catch {
        // A run directory can exist before events.jsonl is written.
      }
    }

    return newest?.runId ?? null;
  } catch {
    return null;
  }
}

async function ensureCodeOzInitialized(repoPath: string, resolution: CodeOzBinaryResolution): Promise<void> {
  if (await pathExists(join(repoPath, '.code-oz'))) {
    return;
  }

  console.info('[code-oz-spawn] auto-init', { repoPath });
  const init = spawnSubprocess({
    cmd: [resolution.command, ...resolution.args, 'init'],
    cwd: repoPath,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    streamToString(init.stdout, STDOUT_RUN_ID_CAPTURE_LIMIT),
    streamToString(init.stderr, STDOUT_RUN_ID_CAPTURE_LIMIT),
    init.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error((stderr || stdout || `code-oz init failed with exit ${exitCode}`).trim());
  }

  console.info('[code-oz-spawn] auto-init complete', { repoPath });
}

function writeBufferedChunks(sink: WriteStream, chunks: readonly Uint8Array[]): void {
  for (const chunk of chunks) {
    sink.write(chunk);
  }
}

async function pumpStream(
  stream: AsyncIterable<ReadableChunk>,
  getSink: () => WriteStream | null,
  beforeSink: (chunk: Uint8Array) => void,
  onStdoutChunk?: (chunk: Uint8Array) => void,
): Promise<void> {
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      onStdoutChunk?.(buffer);
      const sink = getSink();

      if (sink) {
        sink.write(buffer);
      } else {
        beforeSink(buffer);
      }
    }
  } finally {
    getSink()?.end();
  }
}

function commandForRun(
  resolution: CodeOzBinaryResolution,
  description: string,
  runId: string | null,
  providerOverride: 'fake' | null | undefined,
  effortOverride: EffortLevel | undefined,
): readonly string[] {
  return [
    resolution.command,
    ...resolution.args,
    'run',
    '--request',
    description,
    ...(providerOverride === 'fake' ? ['--provider', 'fake'] : []),
    ...(effortOverride !== undefined ? ['--effort', effortOverride] : []),
    ...(runId ? ['--run-id', runId] : []),
  ];
}

/**
 * Spawn a real `code-oz run` subprocess for a repo. The current CLI does not
 * support `--run-id`, so this implements the fallback branch: parse the first
 * 16KB of stdout for a run id and also watch `.code-oz/state/active.json`.
 * The active-file fallback keeps the primitive usable until the CLI grows an
 * explicit `--run-id` flag.
 */
export async function spawnCodeOzRun(input: SpawnInput, deps?: SpawnDependencies): Promise<SpawnHandle> {
  const repoPath = resolve(input.repoPath);
  const description = input.description.trim();

  if (!repoPath.startsWith('/')) {
    throw new Error('repoPath must resolve to an absolute path.');
  }

  if (description.length === 0) {
    throw new Error('description must be non-empty.');
  }

  const spawn = deps?.spawn ?? spawnSubprocess;
  const resolveBinary = deps?.resolveBinary ?? resolveCodeOzBinary;
  const supportsRunIdFlag = deps?.supportsRunIdFlag ?? cliSupportsRunIdFlag;

  const resolution = await resolveBinary();
  await ensureCodeOzInitialized(repoPath, resolution);
  const supportsRunId = await supportsRunIdFlag(resolution);
  const previousActiveRunId = await readActiveRunId(repoPath);
  await recordActiveJsonBaseline(repoPath);
  const generatedRunId = preGenerateGuiRunId(description);
  const runIdForSpawn = supportsRunId ? generatedRunId : null;
  const cmd = commandForRun(resolution, description, runIdForSpawn, input.providerOverride, input.effortOverride);
  const runIdDeferred = createRunIdDeferred();
  const stdoutBuffer: Uint8Array[] = [];
  const stderrBuffer: Uint8Array[] = [];
  let stdoutCapture = '';
  let stdoutCaptureBytes = 0;
  let stdoutSink: WriteStream | null = null;
  let stderrSink: WriteStream | null = null;
  let abortedSignal: string | null = null;

  if (runIdForSpawn) {
    const runDir = runDirFor(repoPath, runIdForSpawn);
    await mkdir(runDir, { recursive: true });
    stdoutSink = createWriteStream(join(runDir, '.gui-stdout.log'), { flags: 'a' });
    stderrSink = createWriteStream(join(runDir, '.gui-stderr.log'), { flags: 'a' });
    runIdDeferred.resolve(runIdForSpawn);
  }

  const subprocess = spawn({
    cmd,
    cwd: repoPath,
    env: { ...process.env },
  });

  const stdoutPump = pumpStream(
    subprocess.stdout,
    () => stdoutSink,
    (chunk) => stdoutBuffer.push(chunk),
    (chunk) => {
      if (runIdForSpawn || stdoutCaptureBytes >= STDOUT_RUN_ID_CAPTURE_LIMIT) {
        return;
      }

      const next = chunk.slice(0, STDOUT_RUN_ID_CAPTURE_LIMIT - stdoutCaptureBytes);
      stdoutCaptureBytes += next.byteLength;
      stdoutCapture += Buffer.from(next).toString('utf8');
      const parsedRunId = parseRunIdFromStdout(stdoutCapture);

      if (parsedRunId) {
        runIdDeferred.resolve(parsedRunId);
      }
    },
  );
  const stderrPump = pumpStream(subprocess.stderr, () => stderrSink, (chunk) => stderrBuffer.push(chunk));

  if (!runIdForSpawn) {
    const timeoutMs = resolveRunIdTimeoutMs(input.runIdTimeoutMs);
    void pollActiveRunId(repoPath, previousActiveRunId, runIdDeferred.resolve, timeoutMs).catch(runIdDeferred.reject);
  }

  void subprocess.exited.then(async (exitCode) => {
    if (runIdDeferred.settled()) {
      return;
    }
    await Promise.allSettled([stdoutPump, stderrPump]);
    const stderrText = Buffer.concat(stderrBuffer).toString('utf8').trim();
    const stdoutText = Buffer.concat(stdoutBuffer).toString('utf8').trim();
    const detail = stderrText || stdoutText || 'no output captured';
    runIdDeferred.reject(new Error(
      `code-oz exited before a runId was detected (exit ${exitCode}): ${detail}`,
    ));
  });

  const runId = await runIdDeferred.promise;
  const runDir = runDirFor(repoPath, runId);
  await mkdir(runDir, { recursive: true });
  const stdoutLogPath = join(runDir, '.gui-stdout.log');
  const stderrLogPath = join(runDir, '.gui-stderr.log');

  if (stdoutSink === null) {
    stdoutSink = createWriteStream(stdoutLogPath, { flags: 'a' });
    writeBufferedChunks(stdoutSink, stdoutBuffer);
    stdoutBuffer.length = 0;
  }

  if (stderrSink === null) {
    stderrSink = createWriteStream(stderrLogPath, { flags: 'a' });
    writeBufferedChunks(stderrSink, stderrBuffer);
    stderrBuffer.length = 0;
  }

  console.info('[code-oz-spawn] spawned', { pid: subprocess.pid, runId, runDir });

  return {
    runId,
    runDir,
    pid: subprocess.pid,
    stdoutLogPath,
    stderrLogPath,
    abort: () => {
      abortedSignal = 'SIGTERM';
      subprocess.kill('SIGTERM');
    },
    waitForExit: async () => {
      const exitCode = await subprocess.exited;
      await Promise.allSettled([stdoutPump, stderrPump]);
      return { exitCode, signal: abortedSignal };
    },
  };
}

export async function runCodeOzApprove(input: ApprovalInput): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const resolution = await resolveCodeOzBinary();
  const args = [
    ...resolution.args,
    'approve',
    input.phase,
    ...(input.notes && input.notes.trim().length > 0 ? ['--notes', input.notes.trim()] : []),
  ];

  try {
    const { stdout, stderr } = await execFileAsync(resolution.command, args, {
      cwd: resolve(input.repoPath),
      env: { ...process.env },
      timeout: 30_000,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    const output = error as { readonly stdout?: unknown; readonly stderr?: unknown; readonly message?: unknown };
    const stderr = typeof output.stderr === 'string' ? output.stderr.trim() : '';
    const stdout = typeof output.stdout === 'string' ? output.stdout.trim() : '';
    const message = typeof output.message === 'string' ? output.message : 'code-oz approve failed';
    throw new Error([stderr, stdout, message].filter((part) => part.length > 0).join('\n'));
  }
}
