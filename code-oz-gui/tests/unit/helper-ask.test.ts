import { afterEach, describe, expect, test } from 'bun:test';
import { POST } from '@/app/api/helper/ask/route';

const ORIGINAL_GEMINI_KEY = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (ORIGINAL_GEMINI_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = ORIGINAL_GEMINI_KEY;
  }
});

describe('/api/helper/ask', () => {
  test('returns setup guidance without logging a stack when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const originalConsoleError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      const response = await POST(new Request('http://localhost/api/helper/ask', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'r-2026-05-12-checkout-safari',
          cardId: 'audit',
          currentTab: 'artifact',
          prompt: 'Explain this.',
        }),
      }));
      const body = await response.json() as { readonly detail?: string };

      expect(response.status).toBe(503);
      expect(body.detail).toBe('Set GEMINI_API_KEY to enable the Gemini helper.');
      expect(logged).toHaveLength(0);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
