import { join } from 'node:path'

export const CODE_OZ_DIR = '.code-oz'

export interface CodeOzPaths {
  /** `.code-oz/` root directory. */
  root: string
  /** `.code-oz/config.yaml` */
  config: string
  /** `.code-oz/agents/` — project-local agent overrides. */
  agents: string
  /** `.code-oz/artifacts/` — phase outputs (SPEC.md, PLAN.md, ...). */
  artifacts: string
  /** `.code-oz/state/` — top-level state dir; per-run state lives at `state/runs/<runId>/`. */
  state: string
  /** `.code-oz/runs/` — per-run worktrees (M7+). Distinct from `state/runs/`. */
  runs: string
  /** `.code-oz/state/active.json` — single-active-run pointer (v0.1). */
  activeRun: string
}

export function paths(cwd: string): CodeOzPaths {
  const root = join(cwd, CODE_OZ_DIR)
  const state = join(root, 'state')
  return {
    root,
    config: join(root, 'config.yaml'),
    agents: join(root, 'agents'),
    artifacts: join(root, 'artifacts'),
    state,
    runs: join(root, 'runs'),
    activeRun: join(state, 'active.json'),
  }
}
