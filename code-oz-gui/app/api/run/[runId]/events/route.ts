import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import {
  assertFixtureRunId,
  closeWatcher,
  eventsPathForRun,
  parseEventLines,
  watch,
} from '@/lib/run-store';
import type { PhaseEvent } from '@/lib/event-types';
import type { FSWatcher } from 'node:fs';

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly runId: string }>;
};

const encoder = new TextEncoder();

function toSseFrame(event: PhaseEvent): string {
  return `event: append\ndata: ${JSON.stringify(event)}\n\n`;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function createEventsStream(eventsPath: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let offset = 0;
  let closed = false;
  let cleanupStream: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(frame));
        }
      };

      const cleanup = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }

        closeWatcher(watcher);
        watcher = null;
        signal.removeEventListener('abort', cleanup);

        try {
          controller.close();
        } catch {
          // The stream may already be closed by the client.
        }
      };
      cleanupStream = cleanup;

      const flushNewLines = async () => {
        if (closed) {
          return;
        }

        let nextText = '';

        try {
          nextText = await readFile(eventsPath, 'utf8');
        } catch (error) {
          if (isFileNotFound(error)) {
            return;
          }

          throw error;
        }

        const nextBuffer = Buffer.from(nextText, 'utf8');

        if (nextBuffer.length < offset) {
          offset = 0;
        }

        const newText = nextBuffer.subarray(offset).toString('utf8');
        offset = nextBuffer.length;

        for (const event of parseEventLines(newText)) {
          enqueue(toSseFrame(event));
        }
      };

      const waitForEventsFile = async () => {
        while (!closed && !(await pathExists(eventsPath))) {
          await new Promise<void>((resolvePoll) => {
            pollTimer = setTimeout(resolvePoll, 500);
          });
          pollTimer = null;
        }
      };

      signal.addEventListener('abort', cleanup, { once: true });

      try {
        await waitForEventsFile();

        if (closed) {
          return;
        }

        const initialText = await readFile(eventsPath, 'utf8');
        offset = Buffer.byteLength(initialText, 'utf8');

        for (const event of parseEventLines(initialText)) {
          enqueue(toSseFrame(event));
        }

        watcher = watch(eventsPath, () => {
          if (closed) {
            return;
          }

          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void flushNewLines().catch((error: unknown) => {
              if (!closed) {
                controller.error(error);
                cleanup();
              }
            });
          }, 50);
        });
      } catch (error) {
        if (!closed) {
          controller.error(error);
          cleanup();
        }
      }
    },
    cancel() {
      cleanupStream?.();
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runIdError = assertFixtureRunId(runId);

  if (runIdError) {
    return runIdError;
  }

  const eventsPath = eventsPathForRun(runId);

  if (!eventsPath) {
    return Response.json({ ok: false, error: `Unknown runId: ${runId}` }, { status: 404 });
  }

  return new Response(createEventsStream(eventsPath, request.signal), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
