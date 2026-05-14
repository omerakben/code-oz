// Client-safe export of the EFFORT_LEVELS / EffortLevel surface used by
// the Composer UI. Lives in its own file so client components do not pull
// in `node:fs`/`node:path` through `code-oz-spawn.ts`. The server-side
// spawn lib re-exports both names for its own callers.

export const EFFORT_LEVELS = ['lite', 'normal', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
