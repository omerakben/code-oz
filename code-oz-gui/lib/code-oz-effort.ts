// Client-safe export of the EFFORT_LEVELS / EffortLevel surface used by
// the Composer UI. Lives in its own file so client components do not pull
// in `node:fs`/`node:path` through `code-oz-spawn.ts`. The server-side
// spawn lib re-exports both names for its own callers.
//
// Values match the CLI's canonical EFFORT_LEVELS at
// `src/config/effort.ts`. The CLI also accepts `low | medium | high` as
// aliases (mapping to `lite | balanced | max`), but the GUI uses the
// canonical names so the validation boundary in /api/run/start can be
// strict (reject unknown values with 400, not pass them through and get
// a 503 from the spawn subprocess). Codex final review caught the
// pre-fix `lite | normal | high` divergence as a block-push.

export const EFFORT_LEVELS = ['lite', 'balanced', 'max', 'beast'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
