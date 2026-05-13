export type Profile = 'greenfield' | 'brownfield';

export type Phase = 'define' | 'audit' | 'plan' | 'build' | 'verify' | 'review' | 'ship';

export type PhaseOutcome = 'passed' | 'failed' | 'blocked' | 'stopped';

type EventBase<TType extends string> = {
  readonly version: 1;
  readonly type: TType;
  readonly ts: string;
  readonly runId: string;
};

export type RunStartedEvent = EventBase<'run_started'> & {
  readonly profile: Profile;
};

export type PhaseEnteredEvent = EventBase<'phase_entered'> & {
  readonly phase: Phase;
};

export type PhaseExitedEvent = EventBase<'phase_exited'> & {
  readonly phase: Phase;
  readonly outcome: PhaseOutcome;
};

export type GateRequiredEvent = EventBase<'gate_required'> & {
  readonly phase: Phase;
  readonly blockedOn: string;
};

export type GateWrittenEvent = EventBase<'gate_written'> & {
  readonly phase: Phase;
  readonly file: string;
};

export type AuditCompletedEvent = EventBase<'audit_completed'> & {
  readonly phase?: 'audit';
  readonly auditReportSha256: string;
};

export type PlanCompletedEvent = EventBase<'plan_completed'> & {
  readonly phase?: 'plan';
  readonly planSha256: string;
};

export type ReviewCompletedEvent = EventBase<'review_completed'> & {
  readonly phase?: 'review';
  readonly reviewSha256: string;
  readonly taskId?: string;
  readonly round?: number;
};

export type AgentManifest = {
  readonly tools?: Record<string, unknown>;
  readonly network?: 'allow' | 'deny' | string;
  readonly files?: readonly string[];
  readonly [key: string]: unknown;
};

export type AgentInvokedEvent = EventBase<'agent_invoked'> & {
  readonly phase: Phase;
  readonly agent: string;
  readonly provider: string;
  readonly manifest: AgentManifest;
  readonly filesSent: number;
  readonly bytesSent: number;
  readonly tokensEstimate: number;
  readonly fieldsRemovedByScope: number;
  readonly model?: string;
  readonly role?: string;
  readonly costEstimateUSD?: number;
  readonly parentTaskId?: string;
};

export type AgentCompletedEvent = EventBase<'agent_completed'> & {
  readonly phase: Phase;
  readonly agent: string;
  readonly tokensUsed?: number;
  readonly costActualUSD?: number;
  readonly role?: string;
  readonly parentTaskId?: string;
};

export type BuildStartedEvent = EventBase<'build_started'> & {
  readonly phase?: 'build';
  readonly agent?: string;
  readonly attempt?: number;
  readonly baseCommitSha?: string;
  readonly taskId: string;
};

export type BuildCompletedEvent = EventBase<'build_completed'> & {
  readonly phase?: 'build';
  readonly agent?: string;
  readonly attempt?: number;
  readonly taskId: string;
  readonly changedFileCount?: number;
  readonly buildReportSha256: string;
  readonly promptSnapshotSha256?: string;
};

export type VerifyStartedEvent = EventBase<'verify_started'> & {
  readonly phase?: 'verify';
  readonly agent?: string;
  readonly attempt?: number;
  readonly taskId: string;
};

export type VerifyCompletedEvent = EventBase<'verify_completed'> & {
  readonly phase?: 'verify';
  readonly agent?: string;
  readonly attempt?: number;
  readonly taskId: string;
  readonly verifyReportSha256: string;
  readonly testsRun?: number;
  readonly testsPassed?: number;
  readonly testsFailed?: number;
};

export type ReviewRoundCompletedEvent = EventBase<'review_round_completed'> & {
  readonly phase?: 'review';
  readonly taskId: string;
  readonly round: number;
  readonly verdict: 'ready' | 'fix-first' | 'block' | 'debate-required' | string;
  readonly findingsCount?: number;
};

export type InterventionEvent = EventBase<'intervention'> & {
  readonly code: string;
  readonly phase?: Phase;
};

export type BudgetWarningEvent = EventBase<'budget_warning'> & {
  readonly metric: 'maxTurns' | 'maxProviderCalls' | 'maxTokensEstimate' | 'maxWallTimeMinutes' | string;
  readonly ratio: number;
  readonly current?: number;
  readonly spent?: number;
  readonly limit: number;
  readonly scope?: string;
  readonly role?: string;
};

export type UnknownPhaseEvent = EventBase<string> & {
  readonly [key: string]: unknown;
};

export type PhaseEvent =
  | RunStartedEvent
  | PhaseEnteredEvent
  | PhaseExitedEvent
  | GateRequiredEvent
  | GateWrittenEvent
  | AuditCompletedEvent
  | PlanCompletedEvent
  | ReviewCompletedEvent
  | AgentInvokedEvent
  | AgentCompletedEvent
  | BuildStartedEvent
  | BuildCompletedEvent
  | VerifyStartedEvent
  | VerifyCompletedEvent
  | ReviewRoundCompletedEvent
  | InterventionEvent
  | BudgetWarningEvent
  | UnknownPhaseEvent;
