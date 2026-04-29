import { join } from 'node:path'

export const CODE_OZ_DIR = '.code-oz'

export interface CodeOzPaths {
  root: string
  config: string
  agents: string
  artifacts: string
  state: string
  runs: string
  events: string
  current: string
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
    events: join(state, 'events.jsonl'),
    current: join(state, 'current.json'),
  }
}
