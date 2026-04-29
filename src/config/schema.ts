export type Profile = 'greenfield' | 'brownfield'

export interface CodeOzConfig {
  version: string
  profile: Profile
  defaultProvider: 'claude' | 'codex' | 'gemini' | 'fake'
  models: {
    primary: string
    reviewer: string
  }
  budgets: {
    maxTurns: number
    maxProviderCalls: number
    maxReviewRounds: number
  }
  permissions: {
    allowEscapeHatch: boolean
    requireApprovalForBuild: boolean
  }
}

export const DEFAULT_CONFIG: CodeOzConfig = {
  version: '0.1.0-alpha.0',
  profile: 'greenfield',
  defaultProvider: 'claude',
  models: {
    primary: 'claude-opus-4-7',
    reviewer: 'gpt-5.5',
  },
  budgets: {
    maxTurns: 100,
    maxProviderCalls: 50,
    maxReviewRounds: 4,
  },
  permissions: {
    allowEscapeHatch: false,
    requireApprovalForBuild: true,
  },
}
