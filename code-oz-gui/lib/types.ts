import type { Phase, Profile } from './event-types';

export enum LogType {
  COMMAND = 'command',
  OUTPUT = 'output',
  ERROR = 'error',
  SUCCESS = 'success',
}

export interface LogEntry {
  id: string;
  type: LogType;
  content: string;
  timestamp: Date;
}

export interface SavedAction {
  id: string;
  title: string;
  cmd: string;
}

export type ProjectStatus = 'idle' | 'running' | 'warning' | 'processing';

export type CardKind = 'audit' | 'plan' | 'task';

export type CardState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'in-progress'; readonly startedAt: string }
  | { readonly kind: 'awaiting-approval'; readonly gateName: string }
  | { readonly kind: 'approved' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly reason: string };

export interface RunCard {
  readonly id: string;
  readonly kind: CardKind;
  readonly phase: Phase;
  readonly title: string;
  readonly subtitle: string;
  readonly state: CardState;
  readonly artifactPath: string;
  readonly decisionsCount: number;
}

export interface RunBudgets {
  readonly global: {
    readonly maxTokensEstimate: number;
    readonly tokensSpent: number;
    readonly softWarnAtRatio: number;
    readonly currentRatio: number;
  };
  readonly priceTable: Record<
    string,
    {
      readonly inputPerMTok: number;
      readonly outputPerMTok: number;
    }
  >;
  readonly spendUSD: number;
}

export interface ProviderProvenance {
  readonly family: string;
  readonly provider: string;
  readonly model?: string;
  readonly role?: string;
}

export type RunLifecycle = 'running' | 'exited-ok' | 'exited-fail' | 'aborted' | 'fixture';
export type ProviderMode = 'fake' | 'real' | null;

export interface RunState {
  readonly version: 1;
  readonly runId: string;
  readonly lifecycle: RunLifecycle;
  readonly providerMode: ProviderMode;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
  readonly profile: Profile;
  readonly currentPhase: Phase | null;
  readonly currentOutcome: string | null;
  readonly request: string;
  readonly repoPath: string;
  readonly startedAt: string;
  readonly lastEventAt: string;
  readonly cards: readonly RunCard[];
  readonly budgets: RunBudgets;
  readonly providerProvenance: readonly ProviderProvenance[];
}
